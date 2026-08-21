import {
  DEFAULT_TOKENS,
  TOKENS_BY_SYMBOL,
  createContract,
  tokensBySymbol,
  type TokenDef,
} from '../abi/index.ts';
import { addr } from '../core/address.ts';
import {
  ADDRESS_ZERO,
  astring,
  createDecimal,
  type IWeb3Provider,
  type Web3CallArgs,
} from '../utils.ts';

const _0n = /* @__PURE__ */ BigInt(0);
const _1n = /* @__PURE__ */ BigInt(1);
const _10n = /* @__PURE__ */ BigInt(10);
const _192n = /* @__PURE__ */ BigInt(192);
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const DEFAULT_V3_FEES = [100, 500, 3000, 10000];
const Q192 = /* @__PURE__ */ (() => _1n << _192n)();

const CHAINLINK_COINS: Record<string, { decimals: number; contract: string }> = {
  BCH: { decimals: 8, contract: '0x9f0f69428f923d6c95b781f89e165c9b2df9789d' },
  BTC: { decimals: 8, contract: '0xf4030086522a5beea4988f8ca5b36dbc97bee88c' },
  DOGE: { decimals: 8, contract: '0x2465cefd3b488be410b941b1d4b2767088e2a028' },
  ETH: { decimals: 8, contract: '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419' },
  XMR: { decimals: 8, contract: '0xfa66458cce7dd15d8650015c4fce4d278271618f' },
  ZEC: { decimals: 8, contract: '0xd54b033d48d0475f19c5fccf7484e8a981848501' },
};
type TokenSymbolIndex = Record<string, TokenDef & { contract: string }>;
type TokenRegistry = { byAddress: Record<string, TokenDef>; bySymbol: TokenSymbolIndex };
const DEFAULT_TOKEN_REGISTRY: TokenRegistry = {
  byAddress: DEFAULT_TOKENS,
  bySymbol: TOKENS_BY_SYMBOL,
};

function tokenRegistry(tokens: Record<string, TokenDef> = DEFAULT_TOKENS): TokenRegistry {
  if (tokens === DEFAULT_TOKENS) return DEFAULT_TOKEN_REGISTRY;
  // Runtime addresses are lowercase, so canonicalize caller-owned table keys once at ingress.
  const byAddress: Record<string, TokenDef> = Object.create(null);
  for (const [contract, token] of Object.entries(tokens)) {
    const address = assertAddress(contract, 'token');
    if (Object.hasOwn(byAddress, address))
      throw new Error(`quoter: duplicate token address: ${address}`);
    byAddress[address] = token;
  }
  return { byAddress, bySymbol: tokensBySymbol(byAddress) };
}

function tokenRegistryFromParams(registry: TokenRegistry, params: ObjectParams): TokenRegistry {
  return params.tokens === undefined ? registry : tokenRegistry(params.tokens);
}

function tokenByAddress(
  registry: TokenRegistry,
  contract: string
): (TokenDef & { contract: string }) | undefined {
  return Object.prototype.hasOwnProperty.call(registry.byAddress, contract)
    ? { contract, ...registry.byAddress[contract] }
    : undefined;
}

const CHAINLINK_ABI = [
  {
    type: 'function',
    name: 'latestRoundData',
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const;

export type ChainlinkPriceOpt = QuoterOpt;

async function chainlinkPrice(
  net: IWeb3Provider,
  contract: string,
  decimals: number,
  opt?: ChainlinkPriceOpt
): Promise<number> {
  const prices = createContract(CHAINLINK_ABI, net, contract);
  const res = await (prices.latestRoundData.call as any)(undefined, callOpt(opt));
  if (res.answer <= _0n || res.updatedAt === _0n || res.answeredInRound < res.roundId)
    throw new Error('micro-web3/chainlink: invalid price data');
  const num = Number.parseFloat(createDecimal(decimals).encode(res.answer));
  if (!Number.isFinite(num)) throw new Error('invalid data received');
  return num;
}

async function chainlinkCoinPrice(
  net: IWeb3Provider,
  symbol: string,
  opt?: ChainlinkPriceOpt
): Promise<number> {
  astring(symbol, 'symbol');
  const coin = CHAINLINK_COINS[symbol.toUpperCase()];
  if (!coin) throw new Error(`micro-web3/chainlink: unknown coin: ${symbol}`);
  return await chainlinkPrice(net, coin.contract, coin.decimals, opt);
}

async function chainlinkTokenPrice(
  net: IWeb3Provider,
  symbol: string,
  registry: TokenRegistry,
  opt?: ChainlinkPriceOpt
): Promise<number> {
  astring(symbol, 'symbol');
  const token = registry.bySymbol[symbol.toUpperCase()];
  if (!token?.feed) throw new Error(`micro-web3/chainlink: unknown token: ${symbol}`);
  return await chainlinkPrice(net, token.feed.contract, token.feed.decimals, opt);
}

const UNISWAP_V2_FACTORY_ABI = [
  {
    type: 'function',
    name: 'getPair',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    outputs: [{ name: 'pair', type: 'address' }],
  },
] as const;

const UNISWAP_V2_PAIR_ABI = [
  {
    type: 'function',
    name: 'token0',
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'token1',
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'getReserves',
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
  },
] as const;

const UNISWAP_V3_FACTORY_ABI = [
  {
    type: 'function',
    name: 'getPool',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
] as const;

const UNISWAP_V3_POOL_ABI = [
  {
    type: 'function',
    name: 'slot0',
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'token0',
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'token1',
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'liquidity',
    outputs: [{ type: 'uint128' }],
  },
] as const;

const ERC4626_ABI = [
  {
    type: 'function',
    name: 'asset',
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'convertToAssets',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'convertToShares',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export type RateDirection = 'forward' | 'reverse' | 'Forward' | 'Reverse';
export type QuoterInit = {
  tokens?: Record<string, TokenDef>;
  /**
   * Memoize default-provider coinPrice/tokenPrice results for this long:
   * oracle quotes are stable second-to-second, so views re-rendering every
   * few seconds shouldn't re-query per render. Failures are not cached (the
   * next call retries); explicit-provider calls bypass the cache. Default 0
   * (no caching).
   */
  ttlMs?: number;
};
export type QuoterOpt = { tag?: Web3CallArgs['tag']; tokens?: Record<string, TokenDef> };
export type UniswapPriceOpt = QuoterOpt & { quoteSymbols?: string[] };
export type UniswapPriceInOpt = {
  priceIn: string;
  priceInDecimals?: number;
  priceInSymbol?: string;
  quoteSymbols?: string[];
};
export type UniswapV2AutoOpt = QuoterOpt & { factory?: string; minLiquidity?: bigint };
export type UniswapV2PriceOpt = UniswapV2AutoOpt & UniswapPriceInOpt;
export type UniswapV3AutoOpt = QuoterOpt & {
  factory?: string;
  fees?: number[];
  minLiquidity?: bigint;
};
export type UniswapV3PriceOpt = UniswapV3AutoOpt & UniswapPriceInOpt;

type RateQuoter = {
  identity(): string;
  tokens(): [string, string];
  resolve?(opt?: QuoterOpt): Promise<void>;
  rate(amountIn: bigint, direction?: RateDirection, opt?: QuoterOpt): Promise<bigint>;
};

export type QuoterPriceProvider = 'chainlink' | 'uniswap-v2' | 'uniswap-v3';
export type QuoterRateProvider = 'uniswap-v2' | 'uniswap-v3' | 'erc4626';
type NormalizeParams = (params: ObjectParams) => ObjectParams;
type QuoterUniswapRateParams = {
  token0?: string;
  token1?: string;
  tokenA?: string;
  tokenB?: string;
  tokenIn?: string;
  tokenOut?: string;
  direction?: RateDirection;
};
export type QuoterUniswapV2RateParams = UniswapV2AutoOpt &
  QuoterUniswapRateParams & { pair?: string; pairAddress?: string };
export type QuoterUniswapV3RateParams = UniswapV3AutoOpt & {
  fee?: number;
} & QuoterUniswapRateParams & { pool?: string; poolAddress?: string };
export type QuoterERC4626RateParams = QuoterOpt & {
  vault?: string;
  vaultAddress?: string;
  asset?: string;
  assetAddress?: string;
  direction?: RateDirection;
};
export type QuoterRateParams =
  | QuoterUniswapV2RateParams
  | QuoterUniswapV3RateParams
  | QuoterERC4626RateParams;

type SymbolToken = { symbol: string; contract: string; decimals: number };
type PairPriceQuoter = RateQuoter & { token0: string; token1: string };
type PriceQuoter = PairPriceQuoter & {
  coinPrice(symbol: string, opt?: UniswapPriceOpt): Promise<number>;
  tokenPrice(symbol: string, opt?: UniswapPriceOpt): Promise<number>;
};
type ResolvedPool = { address: string; token0: string; token1: string; score: bigint };
type RouteCache = Map<string, Promise<ResolvedPool>>;
type ObjectParams = Record<string, any>;

const USD_QUOTE_SYMBOLS = ['USDC', 'USDT', 'DAI'];
const COIN_TOKEN_SYMBOLS: Record<string, string> = { ETH: 'WETH', BTC: 'WBTC' };
const DEFAULT_UNISWAP_PRICE_IN_SYMBOL = 'USDT';
const TOKEN_ALIASES: Record<string, SymbolToken> = {
  EUR: {
    symbol: 'EUR',
    contract: '0x1abaea1f7c830bd89acc67ec4af516284b1bc33c',
    decimals: 6,
  },
  EURC: {
    symbol: 'EURC',
    contract: '0x1abaea1f7c830bd89acc67ec4af516284b1bc33c',
    decimals: 6,
  },
};

function assertAddress(address: string, name: string): string {
  if (typeof address !== 'string' || !addr.isValid(address))
    throw new Error(`quoter: invalid ${name} address`);
  return address.toLowerCase();
}

function assertAmount(amount: bigint): bigint {
  if (typeof amount !== 'bigint' || amount < _0n) throw new Error('quoter: invalid amount');
  return amount;
}

function isForward(direction: RateDirection): boolean {
  if (direction === 'forward' || direction === 'Forward') return true;
  if (direction === 'reverse' || direction === 'Reverse') return false;
  throw new Error('quoter: invalid direction');
}

function callOpt(opt?: QuoterOpt): Web3CallArgs {
  return opt && opt.tag !== undefined ? { tag: opt.tag } : {};
}

function assertFound(address: string, name: string): string {
  address = assertAddress(address, name);
  if (address === ADDRESS_ZERO) throw new Error(`quoter: ${name} not found`);
  return address;
}

function autoOpt(opt?: QuoterOpt, call?: QuoterOpt): QuoterOpt {
  return call && call.tag !== undefined ? { tag: call.tag } : opt || {};
}

function minLiquidity(min?: bigint): bigint {
  if (min === undefined) return _1n;
  return assertAmount(min);
}

function checkLiquidity(score: bigint, min: bigint, name: string) {
  if (score < min) throw new Error(`quoter: ${name} below minimum liquidity`);
}

function validateV3Fees(fees?: number[]): number[] {
  const v3fees = fees || DEFAULT_V3_FEES;
  if (!Array.isArray(v3fees) || v3fees.length === 0) throw new Error('quoter: invalid fees');
  for (const fee of v3fees) {
    if (!Number.isSafeInteger(fee) || fee < 0 || fee > 0xffffff)
      throw new Error('quoter: invalid fee');
  }
  return [...v3fees];
}

function routeCacheKey(id: string, tokenA: string, tokenB: string, opt?: ObjectParams): string {
  const [a, b] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];
  const factory = opt?.factory === undefined ? '' : assertAddress(opt.factory, 'factory');
  const fees = Array.isArray(opt?.fees) ? validateV3Fees(opt.fees).join(',') : '';
  const min = opt?.minLiquidity === undefined ? '' : minLiquidity(opt.minLiquidity).toString();
  const tag = opt?.tag === undefined ? 'latest' : String(opt.tag);
  return [id, a, b, factory, fees, min, tag].join(':');
}

function isPriceInOpt(opt: unknown): opt is UniswapPriceInOpt {
  return typeof opt === 'object' && opt !== null && typeof (opt as any).priceIn === 'string';
}

function assertPriceIn(params: ObjectParams) {
  if (params.priceIn !== undefined && typeof params.priceIn !== 'string')
    throw new Error('quoter: invalid priceIn');
}

function normalizeV3Params(params: ObjectParams): ObjectParams {
  if (params.fee === undefined) return params;
  if (params.fees !== undefined) throw new Error('quoter: pass fee or fees, not both');
  return { ...params, fees: validateV3Fees([params.fee]) };
}

function tokenInfoFromAlias(symbol: string): SymbolToken | undefined {
  return TOKEN_ALIASES[symbol.toUpperCase()];
}

function tokenInfoFromAliasAddress(contract: string): SymbolToken | undefined {
  const tokenContract = contract.toLowerCase();
  const aliases = Object.values(TOKEN_ALIASES);
  return (
    aliases.find((token) => token.symbol === 'EURC' && token.contract === tokenContract) ||
    aliases.find((token) => token.contract === tokenContract)
  );
}

function tokenInfoFromKnownSymbol(
  symbol: string,
  registry: TokenRegistry
): SymbolToken | undefined {
  const tokenSymbol = symbol.toUpperCase();
  const alias = tokenInfoFromAlias(tokenSymbol);
  if (alias) return alias;
  const token = registry.bySymbol[tokenSymbol];
  if (!token) return undefined;
  return {
    symbol: tokenSymbol,
    contract: token.contract.toLowerCase(),
    decimals: token.decimals,
  };
}

function tokenInfoFromSymbol(symbol: string, name: string, registry: TokenRegistry): SymbolToken {
  astring(symbol, name);
  const token = tokenInfoFromKnownSymbol(symbol, registry);
  if (!token) throw new Error(`quoter: unknown token: ${symbol}`);
  return token;
}

function coinInfoFromSymbol(symbol: string, registry: TokenRegistry): SymbolToken {
  astring(symbol, 'symbol');
  const tokenSymbol = COIN_TOKEN_SYMBOLS[symbol.toUpperCase()];
  if (!tokenSymbol) throw new Error(`quoter: unknown coin: ${symbol}`);
  return tokenInfoFromSymbol(tokenSymbol, 'symbol', registry);
}

function quoteTokenInfo(
  contract: string,
  registry: TokenRegistry,
  opt?: UniswapPriceOpt
): SymbolToken | undefined {
  const quoteSymbols = opt?.quoteSymbols || USD_QUOTE_SYMBOLS;
  for (const symbol of quoteSymbols) {
    const token = tokenInfoFromKnownSymbol(symbol, registry);
    if (token && token.contract.toLowerCase() === contract)
      return {
        symbol: token.symbol,
        contract: token.contract.toLowerCase(),
        decimals: token.decimals,
      };
  }
  return undefined;
}

function tokenInfoFromAddress(
  contract: string,
  name: string,
  registry: TokenRegistry,
  opt?: UniswapPriceInOpt
): SymbolToken {
  const known = tokenInfoFromKnownSymbol(contract, registry);
  if (known) return known;
  const tokenContract = assertAddress(contract, name);
  const alias = tokenInfoFromAliasAddress(tokenContract);
  if (alias) return alias;
  const quote = quoteTokenInfo(tokenContract, registry, opt);
  if (quote) return quote;
  const token = tokenByAddress(registry, tokenContract);
  if (token) return { symbol: token.symbol, contract: tokenContract, decimals: token.decimals };
  if (opt?.priceInDecimals !== undefined) {
    if (!Number.isSafeInteger(opt.priceInDecimals) || opt.priceInDecimals < 0)
      throw new Error('quoter: invalid priceIn decimals');
    return {
      symbol: opt.priceInSymbol || tokenContract,
      contract: tokenContract,
      decimals: opt.priceInDecimals,
    };
  }
  throw new Error(`quoter: unknown ${name} token metadata`);
}

function decimalNumber(amount: bigint, decimals: number): number {
  const num = Number.parseFloat(createDecimal(decimals).encode(amount));
  if (!Number.isFinite(num)) throw new Error('invalid data received');
  return num;
}

async function tokenPriceFromPair(
  quoter: PairPriceQuoter,
  token: SymbolToken,
  registry: TokenRegistry,
  opt?: UniswapPriceOpt
): Promise<number> {
  await quoter.resolve?.(opt);
  const quote = isPriceInOpt(opt)
    ? tokenInfoFromAddress(opt.priceIn, 'priceIn', registry, opt)
    : quoteTokenInfo(
        token.contract.toLowerCase() === quoter.token0 ? quoter.token1 : quoter.token0,
        registry,
        opt
      );
  if (!quote)
    throw new Error(`quoter: ${quoter.identity()} is not paired with a supported USD quote token`);
  return await tokenPriceIn(quoter, token, quote, opt);
}

async function tokenPriceIn(
  quoter: PairPriceQuoter,
  token: SymbolToken,
  quote: SymbolToken,
  opt?: QuoterOpt
): Promise<number> {
  const amountIn = _10n ** BigInt(token.decimals);
  return decimalNumber(await tokenRateIn(quoter, token, quote, amountIn, opt), quote.decimals);
}

async function tokenRateIn(
  quoter: PairPriceQuoter,
  token: SymbolToken,
  quote: SymbolToken,
  amountIn: bigint,
  opt?: QuoterOpt
): Promise<bigint> {
  await quoter.resolve?.(opt);
  const tokenContract = token.contract.toLowerCase();
  const forward = tokenContract === quoter.token0;
  if (!forward && tokenContract !== quoter.token1)
    throw new Error(`quoter: token ${token.symbol} is not in ${quoter.identity()}`);
  if ((forward ? quoter.token1 : quoter.token0) !== quote.contract)
    throw new Error(`quoter: ${quoter.identity()} is not paired with ${quote.symbol}`);
  return await quoter.rate(amountIn, forward ? 'forward' : 'reverse', opt);
}

export function quoteReserves(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  amountIn = assertAmount(amountIn);
  if (reserveIn <= _0n || reserveOut <= _0n) throw new Error('quoter: insufficient reserves');
  return (amountIn * reserveOut) / reserveIn;
}

export function quoteSqrtPriceX96(
  amountIn: bigint,
  sqrtPriceX96: bigint,
  direction: RateDirection = 'forward'
): bigint {
  amountIn = assertAmount(amountIn);
  if (sqrtPriceX96 <= _0n) throw new Error('quoter: invalid sqrt price');
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  return isForward(direction) ? (amountIn * priceX192) / Q192 : (amountIn * Q192) / priceX192;
}

async function discoverV2Pool(
  net: IWeb3Provider,
  tokenA: string,
  tokenB: string,
  opt?: UniswapV2AutoOpt
): Promise<ResolvedPool> {
  const factory = createContract(
    UNISWAP_V2_FACTORY_ABI,
    net,
    assertAddress(opt?.factory || UNISWAP_V2_FACTORY, 'factory')
  );
  const pairAddress = assertFound(
    await (factory.getPair.call as any)({ tokenA, tokenB }, callOpt(opt)),
    'pair'
  );
  const pair = createContract(UNISWAP_V2_PAIR_ABI, net, pairAddress);
  const [token0, token1, reserves] = await Promise.all([
    (pair.token0.call as any)(undefined, callOpt(opt)),
    (pair.token1.call as any)(undefined, callOpt(opt)),
    (pair.getReserves.call as any)(undefined, callOpt(opt)),
  ]);
  const score = reserves.reserve0 < reserves.reserve1 ? reserves.reserve0 : reserves.reserve1;
  checkLiquidity(score, minLiquidity(opt?.minLiquidity), 'pair');
  return {
    address: pairAddress,
    token0: assertAddress(token0, 'token0'),
    token1: assertAddress(token1, 'token1'),
    score,
  };
}

async function discoverV3Pool(
  net: IWeb3Provider,
  tokenA: string,
  tokenB: string,
  opt?: UniswapV3AutoOpt
): Promise<ResolvedPool> {
  const factory = createContract(
    UNISWAP_V3_FACTORY_ABI,
    net,
    assertAddress(opt?.factory || UNISWAP_V3_FACTORY, 'factory')
  );
  let best: ResolvedPool | undefined;
  for (const fee of validateV3Fees(opt?.fees)) {
    const poolAddress = await (factory.getPool.call as any)({ tokenA, tokenB, fee }, callOpt(opt));
    if (assertAddress(poolAddress, 'pool') === ADDRESS_ZERO) continue;
    const pool = createContract(UNISWAP_V3_POOL_ABI, net, poolAddress);
    const [token0, token1, score] = await Promise.all([
      (pool.token0.call as any)(undefined, callOpt(opt)),
      (pool.token1.call as any)(undefined, callOpt(opt)),
      (pool.liquidity.call as any)(undefined, callOpt(opt)),
    ]);
    if (!best || score > best.score)
      best = {
        address: poolAddress,
        token0: assertAddress(token0, 'token0'),
        token1: assertAddress(token1, 'token1'),
        score,
      };
  }
  if (!best) throw new Error('quoter: pool not found');
  checkLiquidity(best.score, minLiquidity(opt?.minLiquidity), 'pool');
  return best;
}

type AmmSourceInit<O extends QuoterOpt, P extends O & UniswapPriceInOpt> =
  | { address: string; token0: string; token1: string }
  | { tokenA: string; tokenB: string; opt?: O }
  | { priceIn: P };

type AmmSourceConfig<O extends QuoterOpt> = {
  id: string;
  addressName: string;
  bridgeTokens?(token: SymbolToken, quote: SymbolToken, registry: TokenRegistry): SymbolToken[];
  hopOpt?(
    from: SymbolToken,
    to: SymbolToken,
    path: SymbolToken[],
    registry: TokenRegistry,
    opt?: O
  ): O | undefined;
  discover(net: IWeb3Provider, tokenA: string, tokenB: string, opt?: O): Promise<ResolvedPool>;
  quote(
    net: IWeb3Provider,
    address: string,
    amountIn: bigint,
    direction: RateDirection,
    opt?: QuoterOpt
  ): Promise<bigint>;
};

function uniswapV3BridgeTokens(
  token: SymbolToken,
  quote: SymbolToken,
  registry: TokenRegistry
): SymbolToken[] {
  const usdc = tokenInfoFromSymbol('USDC', 'bridge token', registry);
  if (quote.contract === TOKEN_ALIASES.EUR.contract && token.contract !== usdc.contract)
    return [usdc];
  return [];
}

function uniswapV3HopOpt(
  from: SymbolToken,
  to: SymbolToken,
  _path: SymbolToken[],
  registry: TokenRegistry,
  opt?: UniswapV3AutoOpt
): UniswapV3AutoOpt | undefined {
  const usdc = tokenInfoFromSymbol('USDC', 'bridge token', registry);
  const eurc = TOKEN_ALIASES.EUR.contract;
  if (from.contract === usdc.contract && to.contract === eurc) return { ...opt, fees: [500] };
  return opt;
}

async function tokenPriceInPath<O extends QuoterOpt, P extends O & UniswapPriceInOpt>(
  net: IWeb3Provider,
  token: SymbolToken,
  quote: SymbolToken,
  opt: O | undefined,
  config: AmmSourceConfig<O>,
  registry: TokenRegistry,
  routeCache?: RouteCache
): Promise<number> {
  if (token.contract === quote.contract) return 1;
  let amount = _10n ** BigInt(token.decimals);
  const path = [token, ...(config.bridgeTokens?.(token, quote, registry) || []), quote];
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];
    if (from.contract === to.contract) continue;
    const hopOpt = config.hopOpt?.(from, to, path, registry, opt) || opt;
    amount = await tokenRateIn(
      createAmmSource<O, P>(
        net,
        { tokenA: from.contract, tokenB: to.contract, opt: hopOpt },
        config,
        registry,
        routeCache
      ),
      from,
      to,
      amount,
      hopOpt
    );
  }
  return decimalNumber(amount, quote.decimals);
}

function createAmmSource<O extends QuoterOpt, P extends O & UniswapPriceInOpt>(
  net: IWeb3Provider,
  init: AmmSourceInit<O, P>,
  config: AmmSourceConfig<O>,
  registry: TokenRegistry,
  routeCache?: RouteCache
): PriceQuoter {
  let sourceAddress = ADDRESS_ZERO;
  let token0 = ADDRESS_ZERO;
  let token1 = ADDRESS_ZERO;
  let tokenA: string | undefined;
  let tokenB: string | undefined;
  let lazyOpt: O | undefined;
  let priceIn: SymbolToken | undefined;
  let resolving: Promise<void> | undefined;

  if ('priceIn' in init) {
    priceIn = tokenInfoFromAddress(init.priceIn.priceIn, 'priceIn', registry, init.priceIn);
    lazyOpt = init.priceIn;
    token1 = priceIn.contract;
  } else if ('address' in init) {
    sourceAddress = assertFound(init.address, config.addressName);
    token0 = assertAddress(init.token0, 'token0');
    token1 = assertAddress(init.token1, 'token1');
  } else {
    tokenA = assertAddress(init.tokenA, 'tokenA');
    tokenB = assertAddress(init.tokenB, 'tokenB');
    [token0, token1] = tokenA < tokenB ? [tokenA, tokenB] : [tokenB, tokenA];
    lazyOpt = init.opt;
  }

  async function resolve(opt?: QuoterOpt): Promise<void> {
    if (sourceAddress !== ADDRESS_ZERO) return;
    if (!tokenA || !tokenB) throw new Error(`quoter: missing auto ${config.addressName} tokens`);
    if (!resolving) {
      const discoverOpt = { ...lazyOpt, ...autoOpt(lazyOpt, opt) } as O & ObjectParams;
      const cacheKey = routeCache && routeCacheKey(config.id, tokenA, tokenB, discoverOpt);
      let discovered = cacheKey && routeCache!.get(cacheKey);
      if (!discovered) {
        discovered = config.discover(net, tokenA, tokenB, discoverOpt).catch((error) => {
          if (cacheKey) routeCache!.delete(cacheKey);
          throw error;
        });
        if (cacheKey) routeCache!.set(cacheKey, discovered);
      }
      resolving = discovered
        .then((pool) => {
          sourceAddress = pool.address;
          token0 = pool.token0;
          token1 = pool.token1;
        })
        .catch((error) => {
          resolving = undefined;
          throw error;
        });
    }
    return await resolving;
  }

  async function price(token: SymbolToken, opt?: UniswapPriceOpt): Promise<number> {
    if (priceIn)
      return await tokenPriceInPath<O, P>(
        net,
        token,
        priceIn,
        lazyOpt,
        config,
        registry,
        routeCache
      );
    return await tokenPriceFromPair(quoter, token, registry, opt);
  }

  const quoter: PriceQuoter = {
    get token0() {
      return token0;
    },
    get token1() {
      return token1;
    },
    identity() {
      if (priceIn) return `${config.id}:price:${priceIn.contract}`;
      return sourceAddress === ADDRESS_ZERO
        ? `${config.id}:auto:${token0}:${token1}`
        : `${config.id}:${sourceAddress}`;
    },
    tokens() {
      return [token0, token1];
    },
    resolve,
    async rate(amountIn, direction = 'forward', opt) {
      if (priceIn) throw new Error('quoter: priceIn mode supports coinPrice/tokenPrice only');
      await resolve(opt);
      return await config.quote(net, sourceAddress, amountIn, direction, opt);
    },
    async coinPrice(symbol, opt) {
      return await price(coinInfoFromSymbol(symbol, registry), opt);
    },
    async tokenPrice(symbol, opt) {
      return await price(tokenInfoFromSymbol(symbol, 'symbol', registry), opt);
    },
  };
  return quoter;
}

const UNISWAP_V2_SOURCE: AmmSourceConfig<UniswapV2AutoOpt> = {
  id: 'uniswap-v2',
  addressName: 'pair',
  discover: discoverV2Pool,
  async quote(net, pairAddress, amountIn, direction, opt) {
    const pair = createContract(UNISWAP_V2_PAIR_ABI, net, pairAddress);
    const reserves = await (pair.getReserves.call as any)(undefined, callOpt(opt));
    const reserveIn = isForward(direction) ? reserves.reserve0 : reserves.reserve1;
    const reserveOut = isForward(direction) ? reserves.reserve1 : reserves.reserve0;
    return quoteReserves(amountIn, reserveIn, reserveOut);
  },
};

async function ammFromAddress<O extends QuoterOpt, P extends O & UniswapPriceInOpt>(
  net: IWeb3Provider,
  sourceAddress: string,
  opt: QuoterOpt | undefined,
  abi: any,
  config: AmmSourceConfig<O>,
  registry: TokenRegistry,
  routeCache?: RouteCache
): Promise<PriceQuoter> {
  const address = assertFound(sourceAddress, config.addressName);
  const source = createContract(abi, net, address) as any;
  const [token0, token1] = await Promise.all([
    (source.token0.call as any)(undefined, callOpt(opt)),
    (source.token1.call as any)(undefined, callOpt(opt)),
  ]);
  return createAmmSource<O, P>(net, { address, token0, token1 }, config, registry, routeCache);
}

const UNISWAP_V3_SOURCE: AmmSourceConfig<UniswapV3AutoOpt> = {
  id: 'uniswap-v3',
  addressName: 'pool',
  bridgeTokens: uniswapV3BridgeTokens,
  hopOpt: uniswapV3HopOpt,
  discover: discoverV3Pool,
  async quote(net, poolAddress, amountIn, direction, opt) {
    const pool = createContract(UNISWAP_V3_POOL_ABI, net, poolAddress);
    const slot0 = await (pool.slot0.call as any)(undefined, callOpt(opt));
    return quoteSqrtPriceX96(amountIn, slot0.sqrtPriceX96, direction);
  },
};

async function uniswapV3FromTokens(
  net: IWeb3Provider,
  tokenA: string,
  tokenB: string,
  fee: number = 3000,
  factory: string = UNISWAP_V3_FACTORY,
  opt?: QuoterOpt,
  registry: TokenRegistry = DEFAULT_TOKEN_REGISTRY,
  routeCache?: RouteCache
): Promise<PriceQuoter> {
  return createAmmSource<UniswapV3AutoOpt, UniswapV3PriceOpt>(
    net,
    { tokenA, tokenB, opt: { ...opt, factory, fees: [fee] } },
    UNISWAP_V3_SOURCE,
    registry,
    routeCache
  );
}

async function erc4626FromVault(
  net: IWeb3Provider,
  vaultAddress: string,
  opt?: QuoterOpt
): Promise<RateQuoter> {
  const vaultAddr = assertAddress(vaultAddress, 'vault');
  const vault = createContract(ERC4626_ABI, net, vaultAddr);
  const asset = await (vault.asset.call as any)(undefined, callOpt(opt));
  return createERC4626Source(net, vaultAddr, asset);
}

function createERC4626Source(
  net: IWeb3Provider,
  vaultAddress: string,
  assetAddress: string
): RateQuoter {
  const vaultAddr = assertAddress(vaultAddress, 'vault');
  const assetAddr = assertAddress(assetAddress, 'asset');
  return {
    identity() {
      return `erc4626:${vaultAddr}`;
    },
    tokens() {
      return [vaultAddr, assetAddr];
    },
    async rate(amountIn, direction = 'forward', opt) {
      assertAmount(amountIn);
      const vault = createContract(ERC4626_ABI, net, vaultAddr);
      return isForward(direction)
        ? await (vault.convertToAssets.call as any)(amountIn, callOpt(opt))
        : await (vault.convertToShares.call as any)(amountIn, callOpt(opt));
    },
  };
}

function objectParams(params: unknown, name: string): ObjectParams {
  if (params === undefined) return {};
  if (typeof params !== 'object' || params === null || Array.isArray(params))
    throw new Error(`quoter: invalid ${name}`);
  return params as ObjectParams;
}

function hasParams(params: ObjectParams, names: string[]): boolean {
  return names.some((name) => params[name] !== undefined);
}

function defaultUniswapPriceIn(registry: TokenRegistry): string {
  return tokenInfoFromSymbol(DEFAULT_UNISWAP_PRICE_IN_SYMBOL, 'priceIn', registry).contract;
}

function priceInParams(
  params: ObjectParams,
  registry: TokenRegistry
): ObjectParams & UniswapPriceInOpt {
  assertPriceIn(params);
  return (
    isPriceInOpt(params) ? params : { ...params, priceIn: defaultUniswapPriceIn(registry) }
  ) as ObjectParams & UniswapPriceInOpt;
}

function rateDirection(quoter: RateQuoter, params: ObjectParams): RateDirection {
  if (params.direction !== undefined) return params.direction;
  if (params.tokenIn !== undefined) {
    const tokenIn = assertAddress(params.tokenIn, 'tokenIn');
    const [token0, token1] = quoter.tokens();
    if (tokenIn === token0) return 'forward';
    if (tokenIn === token1) return 'reverse';
    throw new Error('quoter: tokenIn is not in rate pair');
  }
  return 'forward';
}

type PriceKind = 'coin' | 'token';

async function uniswapPrice(
  net: IWeb3Provider,
  symbol: string,
  kind: PriceKind,
  params: ObjectParams,
  routeParams: string[],
  priceSource: (
    net: IWeb3Provider,
    opt: ObjectParams & UniswapPriceInOpt,
    registry: TokenRegistry,
    routeCache?: RouteCache
  ) => PriceQuoter,
  rateSource: (
    net: IWeb3Provider,
    opt: ObjectParams,
    registry: TokenRegistry,
    routeCache?: RouteCache
  ) => Promise<PriceQuoter>,
  registry: TokenRegistry,
  routeCache?: RouteCache,
  normalize?: NormalizeParams
): Promise<number> {
  const opt = normalize ? normalize(params) : params;
  assertPriceIn(opt);
  const source = hasParams(opt, routeParams)
    ? await rateSource(net, opt, registry, routeCache)
    : priceSource(net, priceInParams(opt, registry), registry, routeCache);
  return kind === 'coin'
    ? await source.coinPrice(symbol, opt)
    : await source.tokenPrice(symbol, opt);
}

async function quoterPrice(
  net: IWeb3Provider,
  symbol: string,
  kind: PriceKind,
  provider?: QuoterPriceProvider,
  params?: unknown,
  registry: TokenRegistry = DEFAULT_TOKEN_REGISTRY,
  routeCache?: RouteCache
): Promise<number> {
  const opt = objectParams(params, 'params');
  registry = tokenRegistryFromParams(registry, opt);
  switch (provider || 'chainlink') {
    case 'chainlink': {
      const chainlinkOpt = opt as ChainlinkPriceOpt;
      return kind === 'coin'
        ? await chainlinkCoinPrice(net, symbol, chainlinkOpt)
        : await chainlinkTokenPrice(net, symbol, registry, chainlinkOpt);
    }
    case 'uniswap-v2':
      return await uniswapPrice(
        net,
        symbol,
        kind,
        opt,
        ['pair', 'pairAddress', 'token0', 'token1', 'tokenA', 'tokenB', 'tokenIn', 'tokenOut'],
        (net, opt, registry) =>
          createAmmSource<UniswapV2AutoOpt, UniswapV2PriceOpt>(
            net,
            { priceIn: opt as UniswapV2PriceOpt },
            UNISWAP_V2_SOURCE,
            registry,
            routeCache
          ),
        uniswapV2RateQuoter,
        registry,
        routeCache
      );
    case 'uniswap-v3':
      return await uniswapPrice(
        net,
        symbol,
        kind,
        opt,
        ['pool', 'poolAddress', 'token0', 'token1', 'tokenA', 'tokenB', 'tokenIn', 'tokenOut'],
        (net, opt, registry) =>
          createAmmSource<UniswapV3AutoOpt, UniswapV3PriceOpt>(
            net,
            { priceIn: opt as UniswapV3PriceOpt },
            UNISWAP_V3_SOURCE,
            registry,
            routeCache
          ),
        uniswapV3RateQuoter,
        registry,
        routeCache,
        normalizeV3Params
      );
    default:
      throw new Error(`quoter: unsupported provider: ${provider}`);
  }
}

async function uniswapV2RateQuoter(
  net: IWeb3Provider,
  params: ObjectParams,
  registry: TokenRegistry,
  routeCache?: RouteCache
): Promise<PriceQuoter> {
  const pairAddress = params.pairAddress || params.pair;
  if (pairAddress !== undefined) {
    if (params.token0 !== undefined && params.token1 !== undefined)
      return createAmmSource<UniswapV2AutoOpt, UniswapV2PriceOpt>(
        net,
        { address: pairAddress, token0: params.token0, token1: params.token1 },
        UNISWAP_V2_SOURCE,
        registry,
        routeCache
      );
    return await ammFromAddress<UniswapV2AutoOpt, UniswapV2PriceOpt>(
      net,
      pairAddress,
      params,
      UNISWAP_V2_PAIR_ABI,
      UNISWAP_V2_SOURCE,
      registry,
      routeCache
    );
  }
  const tokenA = params.tokenA || params.tokenIn;
  const tokenB = params.tokenB || params.tokenOut;
  if (tokenA === undefined || tokenB === undefined)
    throw new Error('quoter: uniswap-v2 rate requires pairAddress or tokenIn/tokenOut');
  return createAmmSource<UniswapV2AutoOpt, UniswapV2PriceOpt>(
    net,
    { tokenA, tokenB, opt: params },
    UNISWAP_V2_SOURCE,
    registry,
    routeCache
  );
}

async function uniswapV3RateQuoter(
  net: IWeb3Provider,
  params: ObjectParams,
  registry: TokenRegistry,
  routeCache?: RouteCache
): Promise<PriceQuoter> {
  const poolAddress = params.poolAddress || params.pool;
  if (poolAddress !== undefined) {
    if (params.token0 !== undefined && params.token1 !== undefined)
      return createAmmSource<UniswapV3AutoOpt, UniswapV3PriceOpt>(
        net,
        { address: poolAddress, token0: params.token0, token1: params.token1 },
        UNISWAP_V3_SOURCE,
        registry,
        routeCache
      );
    return await ammFromAddress<UniswapV3AutoOpt, UniswapV3PriceOpt>(
      net,
      poolAddress,
      params,
      UNISWAP_V3_POOL_ABI,
      UNISWAP_V3_SOURCE,
      registry,
      routeCache
    );
  }
  const tokenA = params.tokenA || params.tokenIn;
  const tokenB = params.tokenB || params.tokenOut;
  if (tokenA === undefined || tokenB === undefined)
    throw new Error('quoter: uniswap-v3 rate requires poolAddress or tokenIn/tokenOut');
  if (params.fee !== undefined)
    return await uniswapV3FromTokens(
      net,
      tokenA,
      tokenB,
      params.fee,
      params.factory,
      params,
      registry,
      routeCache
    );
  return createAmmSource<UniswapV3AutoOpt, UniswapV3PriceOpt>(
    net,
    { tokenA, tokenB, opt: params },
    UNISWAP_V3_SOURCE,
    registry,
    routeCache
  );
}

async function erc4626RateQuoter(net: IWeb3Provider, params: ObjectParams): Promise<RateQuoter> {
  const vaultAddress = params.vaultAddress || params.vault;
  if (vaultAddress === undefined) throw new Error('quoter: erc4626 rate requires vaultAddress');
  const assetAddress = params.assetAddress || params.asset;
  if (assetAddress !== undefined) return createERC4626Source(net, vaultAddress, assetAddress);
  return await erc4626FromVault(net, vaultAddress, params);
}

async function quoterRate(
  net: IWeb3Provider,
  amountIn: bigint,
  provider: QuoterRateProvider,
  params?: QuoterRateParams,
  registry: TokenRegistry = DEFAULT_TOKEN_REGISTRY,
  routeCache?: RouteCache
): Promise<bigint> {
  assertAmount(amountIn);
  const opt =
    provider === 'uniswap-v3'
      ? normalizeV3Params(objectParams(params, 'params'))
      : objectParams(params, 'params');
  registry = tokenRegistryFromParams(registry, opt);
  if (provider === 'uniswap-v2' || provider === 'uniswap-v3') {
    const quoter =
      provider === 'uniswap-v2'
        ? await uniswapV2RateQuoter(net, opt, registry, routeCache)
        : await uniswapV3RateQuoter(net, opt, registry, routeCache);
    await quoter.resolve?.(opt);
    return await quoter.rate(amountIn, rateDirection(quoter, opt), opt);
  }
  if (provider !== 'erc4626') throw new Error(`quoter: unsupported provider: ${provider}`);
  const quoter = await erc4626RateQuoter(net, opt);
  return await quoter.rate(amountIn, opt.direction || 'forward', opt);
}

export class Quoter {
  readonly net: IWeb3Provider;
  private readonly tokens: TokenRegistry;
  private readonly routeCache: RouteCache = new Map();
  private readonly ttlMs: number;
  private readonly priceCache = new Map<string, { at: number; promise: Promise<number> }>();

  constructor(net: IWeb3Provider, opt: QuoterInit = {}) {
    this.net = net;
    this.tokens = tokenRegistry(opt.tokens);
    if (opt.ttlMs !== undefined && (!Number.isFinite(opt.ttlMs) || opt.ttlMs < 0))
      throw new Error('quoter: wrong ttlMs');
    this.ttlMs = opt.ttlMs ?? 0;
  }

  // Only the default-provider path memoizes: explicit provider/params are not
  // part of the key and bypass the cache.
  private cachedPrice(key: string, fetch: () => Promise<number>): Promise<number> {
    if (this.ttlMs <= 0) return fetch();
    const entry = this.priceCache.get(key);
    if (entry && Date.now() - entry.at < this.ttlMs) return entry.promise;
    const promise = fetch();
    this.priceCache.set(key, { at: Date.now(), promise });
    promise.catch(() => {
      // failed quotes are not held for the TTL; the next call retries
      if (this.priceCache.get(key)?.promise === promise) this.priceCache.delete(key);
    });
    return promise;
  }

  async coinPrice(symbol: string): Promise<number>;
  async coinPrice<P>(symbol: string, provider: QuoterPriceProvider, params?: P): Promise<number>;
  async coinPrice(
    symbol: string,
    provider?: QuoterPriceProvider,
    params?: unknown
  ): Promise<number> {
    astring(symbol, 'symbol');
    const fetch = () =>
      quoterPrice(this.net, symbol, 'coin', provider, params, this.tokens, this.routeCache);
    return provider === undefined ? await this.cachedPrice(`coin ${symbol}`, fetch) : await fetch();
  }

  async tokenPrice(symbol: string): Promise<number>;
  async tokenPrice<P>(symbol: string, provider: QuoterPriceProvider, params?: P): Promise<number>;
  async tokenPrice(
    symbol: string,
    provider?: QuoterPriceProvider,
    params?: unknown
  ): Promise<number> {
    astring(symbol, 'symbol');
    const fetch = () =>
      quoterPrice(this.net, symbol, 'token', provider, params, this.tokens, this.routeCache);
    return provider === undefined
      ? await this.cachedPrice(`token ${symbol}`, fetch)
      : await fetch();
  }

  async rate<P extends QuoterRateParams>(
    amountIn: bigint,
    provider: QuoterRateProvider,
    params?: P
  ): Promise<bigint>;
  async rate(
    amountIn: bigint,
    provider: QuoterRateProvider,
    params?: QuoterRateParams
  ): Promise<bigint> {
    return await quoterRate(this.net, amountIn, provider, params, this.tokens, this.routeCache);
  }

  clearRoutes(): void {
    this.routeCache.clear();
  }
}
