import { createContract, tokenFromSymbol } from '../advanced/abi.ts';
import { addr } from '../core/address.ts';
import { astring, createDecimal, type IWeb3Provider, type Web3CallArgs } from '../utils.ts';
import { QUOTER_TOKENS } from './quoter_tokens.ts';

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const Q192 = 1n << 192n;

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

export class ChainlinkQuoter {
  readonly net: IWeb3Provider;
  constructor(net: IWeb3Provider) {
    this.net = net;
  }
  async price(contract: string, decimals: number): Promise<number> {
    const prices = createContract(CHAINLINK_ABI, this.net, contract);
    let res = await prices.latestRoundData.call();
    const num = Number.parseFloat(createDecimal(decimals).encode(res.answer));
    if (Number.isNaN(num)) throw new Error('invalid data received');
    return num;
  }

  async coinPrice(symbol: string): Promise<number> {
    astring(symbol, 'symbol');
    const COINS: Record<string, { decimals: number; contract: string }> = {
      BCH: { decimals: 8, contract: '0x9f0f69428f923d6c95b781f89e165c9b2df9789d' },
      BTC: { decimals: 8, contract: '0xf4030086522a5beea4988f8ca5b36dbc97bee88c' },
      DOGE: { decimals: 8, contract: '0x2465cefd3b488be410b941b1d4b2767088e2a028' },
      ETH: { decimals: 8, contract: '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419' },
      XMR: { decimals: 8, contract: '0xfa66458cce7dd15d8650015c4fce4d278271618f' },
      ZEC: { decimals: 8, contract: '0xd54b033d48d0475f19c5fccf7484e8a981848501' },
    };
    const coin = COINS[symbol.toUpperCase()];
    if (!coin) throw new Error(`micro-web3/chainlink: unknown coin: ${symbol}`);
    return await this.price(coin.contract, coin.decimals);
  }

  async tokenPrice(symbol: string): Promise<number> {
    astring(symbol, 'symbol');
    const token = QUOTER_TOKENS[symbol.toUpperCase()];
    if (!token) throw new Error(`micro-web3/chainlink: unknown token: ${symbol}`);
    return await this.price(token.contract, token.decimals);
  }
}

export { ChainlinkQuoter as Chainlink };

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
] as const;

const ERC4626_ABI = [
  {
    type: 'function',
    name: 'asset',
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'totalAssets',
    outputs: [{ type: 'uint256' }],
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
export type QuoterOpt = { tag?: Web3CallArgs['tag'] };
export type UniswapPriceOpt = QuoterOpt & { quoteSymbols?: string[] };

export type RateQuoter = {
  identity(): string;
  tokens(): [string, string];
  rate(amountIn: bigint, direction?: RateDirection, opt?: QuoterOpt): Promise<bigint>;
};

type SymbolToken = { symbol: string; contract: string; decimals: number };
type PairPriceQuoter = RateQuoter & { token0: string; token1: string };

const USD_QUOTE_SYMBOLS = ['USDC', 'USDT', 'DAI'];
const COIN_TOKEN_SYMBOLS: Record<string, string> = { ETH: 'WETH', BTC: 'WBTC' };

function assertAddress(address: string, name: string): string {
  if (typeof address !== 'string' || !addr.isValid(address))
    throw new Error(`quoter: invalid ${name} address`);
  return address.toLowerCase();
}

function assertAmount(amount: bigint): bigint {
  if (typeof amount !== 'bigint' || amount < 0n) throw new Error('quoter: invalid amount');
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

function tokenInfoFromSymbol(symbol: string, name: string): SymbolToken {
  astring(symbol, name);
  const tokenSymbol = symbol.toUpperCase();
  const token = tokenFromSymbol(tokenSymbol);
  if (!token) throw new Error(`quoter: unknown token: ${symbol}`);
  return { symbol: tokenSymbol, contract: token.contract.toLowerCase(), decimals: token.decimals };
}

function coinInfoFromSymbol(symbol: string): SymbolToken {
  astring(symbol, 'symbol');
  const tokenSymbol = COIN_TOKEN_SYMBOLS[symbol.toUpperCase()];
  if (!tokenSymbol) throw new Error(`quoter: unknown coin: ${symbol}`);
  return tokenInfoFromSymbol(tokenSymbol, 'symbol');
}

function quoteTokenInfo(contract: string, opt?: UniswapPriceOpt): SymbolToken | undefined {
  const quoteSymbols = opt?.quoteSymbols || USD_QUOTE_SYMBOLS;
  for (const symbol of quoteSymbols) {
    const token = tokenFromSymbol(symbol.toUpperCase());
    if (token && token.contract.toLowerCase() === contract)
      return {
        symbol: token.symbol,
        contract: token.contract.toLowerCase(),
        decimals: token.decimals,
      };
  }
  return undefined;
}

function decimalNumber(amount: bigint, decimals: number): number {
  const num = Number.parseFloat(createDecimal(decimals).encode(amount));
  if (Number.isNaN(num)) throw new Error('invalid data received');
  return num;
}

async function tokenPriceFromPair(
  quoter: PairPriceQuoter,
  token: SymbolToken,
  opt?: UniswapPriceOpt
): Promise<number> {
  const tokenContract = token.contract.toLowerCase();
  const forward = tokenContract === quoter.token0;
  if (!forward && tokenContract !== quoter.token1)
    throw new Error(`quoter: token ${token.symbol} is not in ${quoter.identity()}`);
  const quote = quoteTokenInfo(forward ? quoter.token1 : quoter.token0, opt);
  if (!quote)
    throw new Error(`quoter: ${quoter.identity()} is not paired with a supported USD quote token`);
  const amountIn = 10n ** BigInt(token.decimals);
  const amountOut = await quoter.rate(amountIn, forward ? 'forward' : 'reverse', opt);
  return decimalNumber(amountOut, quote.decimals);
}

export function quoteReserves(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  amountIn = assertAmount(amountIn);
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error('quoter: insufficient reserves');
  return (amountIn * reserveOut) / reserveIn;
}

export function quoteSqrtPriceX96(
  amountIn: bigint,
  sqrtPriceX96: bigint,
  direction: RateDirection = 'forward'
): bigint {
  amountIn = assertAmount(amountIn);
  if (sqrtPriceX96 <= 0n) throw new Error('quoter: invalid sqrt price');
  const priceX192 = sqrtPriceX96 * sqrtPriceX96;
  return isForward(direction) ? (amountIn * priceX192) / Q192 : (amountIn * Q192) / priceX192;
}

export class UniswapV2Quoter implements RateQuoter {
  readonly net: IWeb3Provider;
  readonly pairAddress: string;
  readonly token0: string;
  readonly token1: string;

  constructor(net: IWeb3Provider, pairAddress: string, token0: string, token1: string) {
    this.net = net;
    this.pairAddress = assertFound(pairAddress, 'pair');
    this.token0 = assertAddress(token0, 'token0');
    this.token1 = assertAddress(token1, 'token1');
  }

  static async fromPair(
    net: IWeb3Provider,
    pairAddress: string,
    opt?: QuoterOpt
  ): Promise<UniswapV2Quoter> {
    const pair = createContract(UNISWAP_V2_PAIR_ABI, net, assertFound(pairAddress, 'pair'));
    const [token0, token1] = await Promise.all([
      (pair.token0.call as any)(undefined, callOpt(opt)),
      (pair.token1.call as any)(undefined, callOpt(opt)),
    ]);
    return new UniswapV2Quoter(net, pairAddress, token0, token1);
  }

  static async fromTokens(
    net: IWeb3Provider,
    tokenA: string,
    tokenB: string,
    factory: string = UNISWAP_V2_FACTORY,
    opt?: QuoterOpt
  ): Promise<UniswapV2Quoter> {
    const tokenAAddr = assertAddress(tokenA, 'tokenA');
    const tokenBAddr = assertAddress(tokenB, 'tokenB');
    const factoryContract = createContract(
      UNISWAP_V2_FACTORY_ABI,
      net,
      assertAddress(factory, 'factory')
    );
    const pair = await (factoryContract.getPair.call as any)(
      { tokenA: tokenAAddr, tokenB: tokenBAddr },
      callOpt(opt)
    );
    return await UniswapV2Quoter.fromPair(net, assertFound(pair, 'pair'), opt);
  }

  identity(): string {
    return `uniswap_v2:${this.pairAddress}`;
  }

  tokens(): [string, string] {
    return [this.token0, this.token1];
  }

  async rate(
    amountIn: bigint,
    direction: RateDirection = 'forward',
    opt?: QuoterOpt
  ): Promise<bigint> {
    const pair = createContract(UNISWAP_V2_PAIR_ABI, this.net, this.pairAddress);
    const reserves = await (pair.getReserves.call as any)(undefined, callOpt(opt));
    const reserveIn = isForward(direction) ? reserves.reserve0 : reserves.reserve1;
    const reserveOut = isForward(direction) ? reserves.reserve1 : reserves.reserve0;
    return quoteReserves(amountIn, reserveIn, reserveOut);
  }

  async coinPrice(symbol: string, opt?: UniswapPriceOpt): Promise<number> {
    return await tokenPriceFromPair(this, coinInfoFromSymbol(symbol), opt);
  }

  async tokenPrice(symbol: string, opt?: UniswapPriceOpt): Promise<number> {
    return await tokenPriceFromPair(this, tokenInfoFromSymbol(symbol, 'symbol'), opt);
  }
}

export class UniswapV3Quoter implements RateQuoter {
  readonly net: IWeb3Provider;
  readonly poolAddress: string;
  readonly token0: string;
  readonly token1: string;

  constructor(net: IWeb3Provider, poolAddress: string, token0: string, token1: string) {
    this.net = net;
    this.poolAddress = assertFound(poolAddress, 'pool');
    this.token0 = assertAddress(token0, 'token0');
    this.token1 = assertAddress(token1, 'token1');
  }

  static async fromPool(
    net: IWeb3Provider,
    poolAddress: string,
    opt?: QuoterOpt
  ): Promise<UniswapV3Quoter> {
    const pool = createContract(UNISWAP_V3_POOL_ABI, net, assertFound(poolAddress, 'pool'));
    const [token0, token1] = await Promise.all([
      (pool.token0.call as any)(undefined, callOpt(opt)),
      (pool.token1.call as any)(undefined, callOpt(opt)),
    ]);
    return new UniswapV3Quoter(net, poolAddress, token0, token1);
  }

  static async fromTokens(
    net: IWeb3Provider,
    tokenA: string,
    tokenB: string,
    fee: number = 3000,
    factory: string = UNISWAP_V3_FACTORY,
    opt?: QuoterOpt
  ): Promise<UniswapV3Quoter> {
    if (!Number.isSafeInteger(fee) || fee < 0 || fee > 0xffffff)
      throw new Error('quoter: invalid fee');
    const tokenAAddr = assertAddress(tokenA, 'tokenA');
    const tokenBAddr = assertAddress(tokenB, 'tokenB');
    const factoryContract = createContract(
      UNISWAP_V3_FACTORY_ABI,
      net,
      assertAddress(factory, 'factory')
    );
    const pool = await (factoryContract.getPool.call as any)(
      { tokenA: tokenAAddr, tokenB: tokenBAddr, fee },
      callOpt(opt)
    );
    return await UniswapV3Quoter.fromPool(net, assertFound(pool, 'pool'), opt);
  }

  identity(): string {
    return `uniswap_v3:${this.poolAddress}`;
  }

  tokens(): [string, string] {
    return [this.token0, this.token1];
  }

  async rate(
    amountIn: bigint,
    direction: RateDirection = 'forward',
    opt?: QuoterOpt
  ): Promise<bigint> {
    const pool = createContract(UNISWAP_V3_POOL_ABI, this.net, this.poolAddress);
    const slot0 = await (pool.slot0.call as any)(undefined, callOpt(opt));
    return quoteSqrtPriceX96(amountIn, slot0.sqrtPriceX96, direction);
  }

  async coinPrice(symbol: string, opt?: UniswapPriceOpt): Promise<number> {
    return await tokenPriceFromPair(this, coinInfoFromSymbol(symbol), opt);
  }

  async tokenPrice(symbol: string, opt?: UniswapPriceOpt): Promise<number> {
    return await tokenPriceFromPair(this, tokenInfoFromSymbol(symbol, 'symbol'), opt);
  }
}

export class ERC4626Quoter implements RateQuoter {
  readonly net: IWeb3Provider;
  readonly vaultAddress: string;
  readonly assetAddress: string;

  constructor(net: IWeb3Provider, vaultAddress: string, assetAddress: string) {
    this.net = net;
    this.vaultAddress = assertAddress(vaultAddress, 'vault');
    this.assetAddress = assertAddress(assetAddress, 'asset');
  }

  static async fromVault(
    net: IWeb3Provider,
    vaultAddress: string,
    opt?: QuoterOpt
  ): Promise<ERC4626Quoter> {
    const vaultAddr = assertAddress(vaultAddress, 'vault');
    const vault = createContract(ERC4626_ABI, net, vaultAddr);
    const asset = await (vault.asset.call as any)(undefined, callOpt(opt));
    return new ERC4626Quoter(net, vaultAddr, asset);
  }

  identity(): string {
    return `erc4626:${this.vaultAddress}`;
  }

  tokens(): [string, string] {
    return [this.vaultAddress, this.assetAddress];
  }

  async rate(
    amountIn: bigint,
    direction: RateDirection = 'forward',
    opt?: QuoterOpt
  ): Promise<bigint> {
    assertAmount(amountIn);
    const vault = createContract(ERC4626_ABI, this.net, this.vaultAddress);
    return isForward(direction)
      ? await (vault.convertToAssets.call as any)(amountIn, callOpt(opt))
      : await (vault.convertToShares.call as any)(amountIn, callOpt(opt));
  }
}
