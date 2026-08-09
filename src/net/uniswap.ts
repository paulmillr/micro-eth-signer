import { keccak_256 } from '@noble/hashes/sha3.js';
import { concatBytes, hexToBytes, type TArg } from '@noble/hashes/utils.js';
import { type ContractInfo, createContract } from '../abi/decoder.ts';
import { TOKENS_BY_SYMBOL } from '../abi/index.ts';
import { default as UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_CONTRACT } from '../abi/uniswap-v2.ts';
import { default as UNISWAP_V3_ROUTER, UNISWAP_V3_ROUTER_CONTRACT } from '../abi/uniswap-v3.ts';
import { addr } from '../core/address.ts';
import {
  ADDRESS_ZERO,
  createDecimal,
  ethHex,
  isBytes,
  type IWeb3Provider,
  type TRet,
  weieth,
} from '../utils.ts';

export type SwapOpt = { slippagePercent: number; ttl: number };
export const DEFAULT_SWAP_OPT: SwapOpt = { slippagePercent: 0.5, ttl: 30 * 60 };

// [res?.id, res?.payinAddress, res?.amountExpectedTo]
export type ExchangeTx = {
  address: string;
  amount: string;
  currency: string;
  expectedAmount: string;
  data?: string;
  allowance?: { token: string; contract: string; amount: string };
  txId?: string;
};

export type SwapElm = {
  name: string; // Human readable exchange name
  expectedAmount: string;
  tx: (fromAddress: string, toAddress: string) => Promise<ExchangeTx>;
};

/** Transaction payload produced by SwapQuote.tx. */
export type SwapTxData = {
  amount: string;
  address: string;
  expectedAmount: string;
  data: string;
  allowance?: { token: string; contract: string; amount: string };
};

/** Result of UniswapV2/V3 `swap()`: a quote plus a tx builder. */
export type SwapQuote = {
  name: string;
  expectedAmount: string;
  tx: (fromAddress: string, toAddress: string) => Promise<SwapTxData>;
};

export function addPercent(n: bigint, _perc: number): bigint {
  const perc = BigInt((_perc * 10000) | 0);
  const p100 = BigInt(100) * BigInt(10000);
  return ((p100 + perc) * n) / p100;
}

export function isPromise(o: unknown): boolean {
  if (!o || !['object', 'function'].includes(typeof o)) return false;
  return typeof (o as any).then === 'function';
}

// Promise.all(), but allows to wait for nested objects with promises and to ignore errors.
// It's hard to make ignore_errors argument optional in current TS.
export type UnPromise<T> = T extends Promise<infer U> ? U : T;
type NestedUnPromise<T> = { [K in keyof T]: NestedUnPromise<UnPromise<T[K]>> };
type UnPromiseIgnore<T> = T extends Promise<infer U> ? U | undefined : T;
type NestedUnPromiseIgnore<T> = { [K in keyof T]: NestedUnPromiseIgnore<UnPromiseIgnore<T[K]>> };
export async function awaitDeep<T, E extends boolean | undefined>(
  o: T,
  ignore_errors: E
): Promise<E extends true ? NestedUnPromiseIgnore<T> : NestedUnPromise<T>> {
  // Fresh symbol avoids colliding with user objects that happen to have `awaitDeep` keys.
  const tag = Symbol();
  let promises: Promise<any>[] = [];
  const traverse = (o: any): any => {
    if (Array.isArray(o)) return o.map((i) => traverse(i));
    if (isBytes(o)) return o;
    if (isPromise(o)) return { [tag]: promises.push(o) };
    if (o !== null && typeof o === 'object') {
      let ret: Record<string, any> = {};
      for (let k in o) ret[k] = traverse(o[k]);
      return ret;
    }
    return o;
  };
  let out = traverse(o);
  let values: any[];
  if (!ignore_errors) values = await Promise.all(promises);
  else {
    values = (await Promise.allSettled(promises)).map((i) =>
      i.status === 'fulfilled' ? i.value : undefined
    );
  }
  const trBack = (o: any): any => {
    if (Array.isArray(o)) return o.map((i) => trBack(i));
    if (isBytes(o)) return o;
    if (o !== null && typeof o === 'object') {
      if (tag in o) return values[o[tag] - 1];
      let ret: Record<string, any> = {};
      for (let k in o) ret[k] = trBack(o[k]);
      return ret;
    }
    return o;
  };
  return trBack(out);
}

export type CommonBase = {
  contract: string;
  abi: 'ERC20';
  symbol: string;
  decimals: number;
} & Omit<ContractInfo, 'abi' | 'symbol' | 'decimals'>;
const commonBase = (token: { contract: string; symbol: string; decimals: number }): CommonBase => ({
  contract: token.contract,
  abi: 'ERC20',
  symbol: token.symbol,
  decimals: token.decimals,
});
export const COMMON_BASES: TRet<CommonBase[]> = [
  TOKENS_BY_SYMBOL.WETH,
  TOKENS_BY_SYMBOL.DAI,
  TOKENS_BY_SYMBOL.USDC,
  TOKENS_BY_SYMBOL.USDT,
  TOKENS_BY_SYMBOL.COMP,
  TOKENS_BY_SYMBOL.MKR,
  TOKENS_BY_SYMBOL.WBTC,
  TOKENS_BY_SYMBOL.AMPL,
].map(commonBase);
export const WETH: string = TOKENS_BY_SYMBOL.WETH.contract;

export function wrapContract(contract: string): string {
  contract = contract.toLowerCase();
  return contract === 'eth' ? WETH : contract;
}

export function sortTokens(a: string, b: string): [string, string] {
  a = wrapContract(a);
  b = wrapContract(b);
  if (a === b) throw new Error('uniswap.sortTokens: same token!');
  return a < b ? [a, b] : [b, a];
}

export function isValidEthAddr(address: string): boolean {
  return addr.isValid(address);
}

export function isValidUniAddr(address: string): boolean {
  return address === 'eth' || isValidEthAddr(address);
}

export type Token = { decimals: number; contract: string; symbol: string };

function getToken(token: 'eth' | Token, name: string): Token {
  if (typeof token === 'string') {
    if (token.toLowerCase() === 'eth') return { symbol: 'ETH', decimals: 18, contract: 'eth' };
    // Runtime callers can bypass the union type; keep invalid input distinct from no-route.
    throw new Error(`uniswap.swap: wrong ${name}`);
  }
  if (token === null || typeof token !== 'object') throw new Error(`uniswap.swap: wrong ${name}`);
  const t = token as Partial<Token>;
  if (
    typeof t.contract !== 'string' ||
    !t.contract ||
    typeof t.symbol !== 'string' ||
    typeof t.decimals !== 'number' ||
    !Number.isSafeInteger(t.decimals) ||
    t.decimals < 0
  ) {
    throw new Error(`uniswap.swap: wrong ${name}`);
  }
  return t as Token;
}

export abstract class UniswapAbstract {
  abstract name: string;
  abstract contract: string;
  abstract bestPath(fromCoin: string, toCoin: string, inputAmount: bigint): any;
  abstract txData(
    toAddress: string,
    fromCoin: string,
    toCoin: string,
    path: any,
    inputAmount?: bigint,
    outputAmount?: bigint,
    opt?: { slippagePercent: number }
  ): any;
  readonly net: IWeb3Provider;
  constructor(net: IWeb3Provider) {
    this.net = net;
  }
  // private async coinInfo(netName: string) {
  //   if (!validateAddr(netName)) return;
  //   if (netName === 'eth') return { symbol: 'ETH', decimals: 18 };
  //   //return await this.mgr.tokenInfo('eth', netName);
  // }
  async swap(
    fromCoin: 'eth' | Token,
    toCoin: 'eth' | Token,
    amount: string | bigint,
    opt: SwapOpt = DEFAULT_SWAP_OPT
  ): Promise<SwapQuote | undefined> {
    const fromInfo = getToken(fromCoin, 'fromCoin');
    const toInfo = getToken(toCoin, 'toCoin');
    const fromContract = fromInfo.contract.toLowerCase();
    const toContract = toInfo.contract.toLowerCase();
    const fromDecimal = createDecimal(fromInfo.decimals);
    const toDecimal = createDecimal(toInfo.decimals);
    // bigint amounts are raw token units; strings are human-readable decimals.
    const inputAmount = typeof amount === 'bigint' ? amount : fromDecimal.decode(amount);
    try {
      const path = await this.bestPath(fromContract, toContract, inputAmount);
      const expectedAmount = toDecimal.encode(path.amountOut as bigint);
      return {
        name: this.name,
        expectedAmount,
        tx: async (_fromAddress: string, toAddress: string) => {
          const txUni = this.txData(
            toAddress,
            fromContract,
            toContract,
            path,
            inputAmount,
            undefined,
            opt
          );
          return {
            amount: weieth.encode(txUni.value),
            address: txUni.to,
            expectedAmount,
            data: ethHex.encode(txUni.data),
            allowance: txUni.allowance
              ? {
                  token: txUni.allowance.token,
                  contract: this.contract,
                  amount: fromDecimal.encode(txUni.allowance.amount),
                }
              : undefined,
          };
        },
      };
    } catch (e) {
      // No route is the documented soft-failure; other bestPath failures must stay visible.
      if (e instanceof Error && e.message === 'uniswap: cannot find path') return;
      throw e;
    }
  }
}

const FACTORY_ADDRESS = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const INIT_CODE_HASH = hexToBytes(
  '96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f'
);
const PAIR_CONTRACT = [
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

export function create2(
  from: TArg<Uint8Array>,
  salt: TArg<Uint8Array>,
  initCodeHash: TArg<Uint8Array>
): string {
  const cat = concatBytes(new Uint8Array([255]), from, salt, initCodeHash);
  return ethHex.encode(keccak_256(cat).slice(12));
}

export function pairAddress(a: string, b: string, factory: string = FACTORY_ADDRESS): string {
  // This is completely broken: '0x11' '0x11' will return '0x1111'. But this is how it works in sdk.
  const data = concatBytes(...sortTokens(a, b).map((i) => ethHex.decode(i)));
  return create2(ethHex.decode(factory), keccak_256(data), INIT_CODE_HASH);
}

async function reserves(net: IWeb3Provider, a: string, b: string): Promise<[bigint, bigint]> {
  a = wrapContract(a);
  b = wrapContract(b);
  const contract = createContract(PAIR_CONTRACT, net, pairAddress(a, b));
  const res = await contract.getReserves.call();
  return a < b ? [res.reserve0, res.reserve1] : [res.reserve1, res.reserve0];
}

// amountIn set: returns amountOut, how many tokenB user gets for amountIn of tokenA
// amountOut set: returns amountIn, how many tokenA user should send to get exact
// amountOut of tokenB
export function amount(
  reserveIn: bigint,
  reserveOut: bigint,
  amountIn?: bigint,
  amountOut?: bigint
): bigint {
  if (amountIn && amountOut) throw new Error('uniswap.amount: provide only one amount');
  if (!reserveIn || !reserveOut || (amountOut && amountOut >= reserveOut))
    throw new Error('Uniswap: Insufficient reserves');
  if (amountIn) {
    const amountInWithFee = amountIn * BigInt(997);
    const amountOut = (amountInWithFee * reserveOut) / (reserveIn * BigInt(1000) + amountInWithFee);
    if (amountOut === BigInt(0) || amountOut >= reserveOut)
      throw new Error('Uniswap: Insufficient reserves');
    return amountOut;
  } else if (amountOut) {
    return (
      (reserveIn * amountOut * BigInt(1000)) / ((reserveOut - amountOut) * BigInt(997)) + BigInt(1)
    );
  } else throw new Error('uniswap.amount: provide only one amount');
}

export type Path = { path: string[]; amountIn: bigint; amountOut: bigint };

async function bestPathV2(
  net: IWeb3Provider,
  tokenA: string,
  tokenB: string,
  amountIn?: bigint,
  amountOut?: bigint
): Promise<Path> {
  if ((amountIn && amountOut) || (!amountIn && !amountOut))
    throw new Error('uniswap.bestPath: provide only one amount');
  const wA = wrapContract(tokenA);
  const wB = wrapContract(tokenB);
  let resP: Promise<Path>[] = [];
  // Direct pair
  resP.push(
    (async () => {
      const pairAmount = amount(...(await reserves(net, tokenA, tokenB)), amountIn, amountOut);
      return {
        path: [wA, wB],
        amountIn: amountIn ? amountIn : pairAmount,
        amountOut: amountOut ? amountOut : pairAmount,
      };
    })()
  );
  const BASES: (ContractInfo & { contract: string })[] = COMMON_BASES.filter(
    (c) => c && c.contract && c.contract !== wA && c.contract !== wB
  ) as (ContractInfo & { contract: string })[];
  for (let c of BASES) {
    resP.push(
      (async () => {
        const [rAC, rCB] = await Promise.all([
          reserves(net, wA, c.contract),
          reserves(net, c.contract, wB),
        ]);
        const path = [wA, c.contract, wB];
        if (amountIn)
          return { path, amountIn, amountOut: amount(...rCB, amount(...rAC, amountIn)) };
        else if (amountOut) {
          return {
            path,
            amountOut,
            amountIn: amount(...rAC, undefined, amount(...rCB, undefined, amountOut)),
          };
        } else throw new Error('Impossible invariant');
      })()
    );
  }
  let res: Path[] = ((await awaitDeep(resP, true)) as any).filter((i: Path) => !!i);
  // biggest output or smallest input
  res.sort((a, b) => Number(amountIn ? b.amountOut - a.amountOut : a.amountIn - b.amountIn));
  if (!res.length) throw new Error('uniswap: cannot find path');
  return res[0];
}

const ROUTER_CONTRACT_V2 = createContract(UNISWAP_V2_ROUTER, undefined, UNISWAP_V2_ROUTER_CONTRACT);

const TX_DEFAULT_OPT = {
  ...DEFAULT_SWAP_OPT,
  // Use Router02 SupportingFeeOnTransferTokens variants for exact-input swaps on taxed tokens.
  feeOnTransfer: false,
};

export function txDataV2(
  to: string,
  input: string,
  output: string,
  path: Path,
  amountIn?: bigint,
  amountOut?: bigint,
  opt: {
    ttl: number;
    deadline?: number;
    slippagePercent: number;
    feeOnTransfer: boolean;
  } = TX_DEFAULT_OPT
): {
  to: string;
  value: bigint;
  data: any;
  allowance:
    | {
        token: string;
        amount: bigint;
      }
    | undefined;
} {
  opt = { ...TX_DEFAULT_OPT, ...opt };
  if (!isValidUniAddr(input) || !isValidUniAddr(output) || !isValidEthAddr(to))
    throw new Error('Invalid address');
  if (input === 'eth' && output === 'eth') throw new Error('Both input and output is ETH!');
  const pathInput = path.path[0] ? wrapContract(path.path[0]) : undefined;
  const pathOutput = path.path[path.path.length - 1]
    ? wrapContract(path.path[path.path.length - 1])
    : undefined;
  if (input === 'eth' && pathInput !== WETH)
    throw new Error('Input is ETH but path starts with different contract');
  if (output === 'eth' && pathOutput !== WETH)
    throw new Error('Output is ETH but path ends with different contract');
  if (input !== 'eth' && pathInput !== wrapContract(input))
    throw new Error('Input token does not match path');
  if (output !== 'eth' && pathOutput !== wrapContract(output))
    throw new Error('Output token does not match path');
  if ((amountIn && amountOut) || (!amountIn && !amountOut))
    throw new Error('uniswap.txData: provide only one amount');
  if (amountOut && opt.feeOnTransfer) throw new Error('Exact output + feeOnTransfer is impossible');
  const method = ('swap' +
    (amountIn ? 'Exact' : '') +
    (input === 'eth' ? 'ETH' : 'Tokens') +
    'For' +
    (amountOut ? 'Exact' : '') +
    (output === 'eth' ? 'ETH' : 'Tokens') +
    (opt.feeOnTransfer ? 'SupportingFeeOnTransferTokens' : '')) as keyof typeof ROUTER_CONTRACT_V2;
  if (!(method in ROUTER_CONTRACT_V2)) throw new Error('Invalid method');
  const deadline = opt.deadline ? opt.deadline : Math.floor(Date.now() / 1000) + opt.ttl;
  const amountInMax = addPercent(path.amountIn, opt.slippagePercent);
  const amountOutMin = addPercent(path.amountOut, -opt.slippagePercent);
  // TODO: remove any
  const data = (ROUTER_CONTRACT_V2 as any)[method].encodeInput({
    amountInMax,
    amountOutMin,
    amountIn,
    amountOut,
    to,
    deadline,
    path: path.path,
  });
  const amount = amountIn ? amountIn : amountInMax;
  const value = input === 'eth' ? amount : BigInt(0);
  const allowance = input === 'eth' ? undefined : { token: input, amount };
  return { to: UNISWAP_V2_ROUTER_CONTRACT, value, data, allowance };
}

// Here goes Exchange API. Everything above is SDK. Supports almost everything
// from official sdk except liquidity stuff.
export class UniswapV2 extends UniswapAbstract {
  name = 'Uniswap V2';
  contract: string = UNISWAP_V2_ROUTER_CONTRACT;
  bestPath(fromCoin: string, toCoin: string, inputAmount: bigint): Promise<Path> {
    return bestPathV2(this.net, fromCoin, toCoin, inputAmount);
  }
  txData(
    toAddress: string,
    fromCoin: string,
    toCoin: string,
    path: any,
    inputAmount?: bigint,
    outputAmount?: bigint,
    opt: SwapOpt = DEFAULT_SWAP_OPT
  ): any {
    return txDataV2(toAddress, fromCoin, toCoin, path, inputAmount, outputAmount, {
      ...TX_DEFAULT_OPT,
      ...opt,
    });
  }
}

const QUOTER_ADDRESS = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';
const QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInput',
    inputs: [
      { name: 'path', type: 'bytes' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'quoteExactOutput',
    inputs: [
      { name: 'path', type: 'bytes' },
      { name: 'amountOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amountIn', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'quoteExactOutputSingle',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
    outputs: [{ name: 'amountIn', type: 'uint256' }],
  },
] as const;

export const Fee: Record<string, number> = {
  LOW: 500,
  MEDIUM: 3000,
  HIGH: 10000,
};

type Route = {
  path?: TArg<Uint8Array>;
  fee?: number;
  amountIn?: bigint;
  amountOut?: bigint;
  p?: any;
};

function basePaths(a: string, b: string, exactOutput: boolean = false) {
  let res: Route[] = [];
  for (let fee in Fee) res.push({ fee: Fee[fee], p: [a, b] });
  const wA = wrapContract(a);
  const wB = wrapContract(b);
  const BASES: (ContractInfo & { contract: string })[] = COMMON_BASES.filter(
    (c) => c && c.contract && c.contract !== wA && c.contract !== wB
  ) as (ContractInfo & { contract: string })[];
  const packFee = (n: string) => Fee[n].toString(16).padStart(6, '0');
  for (let c of BASES) {
    for (let fee1 in Fee) {
      for (let fee2 in Fee) {
        let path = [wA, packFee(fee1), c.contract, packFee(fee2), wB].map((i) => ethHex.decode(i));
        if (exactOutput) path = path.reverse();
        res.push({ path: concatBytes(...path) });
      }
    }
  }
  return res;
}

async function bestPathV3(
  net: IWeb3Provider,
  a: string,
  b: string,
  amountIn?: bigint,
  amountOut?: bigint
) {
  if ((amountIn && amountOut) || (!amountIn && !amountOut))
    throw new Error('uniswapV3.bestPath: provide only one amount');
  const quoter = createContract(QUOTER_ABI, net, QUOTER_ADDRESS);
  const tokenIn = wrapContract(a);
  const tokenOut = wrapContract(b);
  let paths = basePaths(tokenIn, tokenOut, !!amountOut);
  for (let i of paths) {
    if (!i.path && !i.fee) continue;
    const opt = { ...i, tokenIn, tokenOut, amountIn, amountOut, sqrtPriceLimitX96: 0 };
    const method = 'quoteExact' + (amountIn ? 'Input' : 'Output') + (i.path ? '' : 'Single');
    // TODO: remove any
    i[amountIn ? 'amountOut' : 'amountIn'] = (quoter as any)[method].call(opt);
  }
  paths = (await awaitDeep(paths, true)) as any;
  paths = paths.filter((i) => i.amountIn || i.amountOut);
  paths.sort((a: any, b: any) =>
    Number(amountIn ? b.amountOut - a.amountOut : a.amountIn - b.amountIn)
  );
  if (!paths.length) throw new Error('uniswap: cannot find path');
  return paths[0];
}

const ROUTER_CONTRACT_V3 = createContract(UNISWAP_V3_ROUTER, undefined, UNISWAP_V3_ROUTER_CONTRACT);

export type TxOpt = {
  slippagePercent: number;
  ttl: number;
  sqrtPriceLimitX96?: bigint;
  deadline?: number;
  fee?: { fee: number; to: string };
};

export function txDataV3(
  to: string,
  input: string,
  output: string,
  route: TArg<Route>,
  amountIn?: bigint,
  amountOut?: bigint,
  opt: TxOpt = DEFAULT_SWAP_OPT
): TRet<{
  to: string;
  value: bigint;
  data: TRet<Uint8Array>;
  allowance:
    | {
        token: string;
        amount: bigint;
      }
    | undefined;
}> {
  opt = { ...DEFAULT_SWAP_OPT, ...opt };
  const err = 'Uniswap v3: ';
  if (!isValidUniAddr(input)) throw new Error(err + 'invalid input address');
  if (!isValidUniAddr(output)) throw new Error(err + 'invalid output address');
  if (!isValidEthAddr(to)) throw new Error(err + 'invalid to address');
  // Fee recipient is encoded as an ABI address; the `eth` alias only belongs to swap tokens.
  if (opt.fee && !isValidEthAddr(opt.fee.to))
    throw new Error(err + 'invalid fee recepient addresss');
  if (input === 'eth' && output === 'eth')
    throw new Error(err + 'both input and output cannot be eth');
  if ((amountIn && amountOut) || (!amountIn && !amountOut))
    throw new Error(err + 'specify either amountIn or amountOut, but not both');
  if (
    (amountIn && !route.amountOut) ||
    (amountOut && !route.amountIn) ||
    (!route.fee && !route.path)
  ) {
    throw new Error(err + 'invalid route');
  }
  if (route.path && opt.sqrtPriceLimitX96)
    throw new Error(err + 'sqrtPriceLimitX96 on multi-hop trade');
  if (route.path) {
    if (route.path.length < 43 || (route.path.length - 20) % 23 !== 0)
      throw new Error(err + 'invalid route');
    const first = ethHex.encode(route.path.slice(0, 20)).toLowerCase();
    const last = ethHex.encode(route.path.slice(-20)).toLowerCase();
    const wantFirst = wrapContract(amountIn ? input : output);
    const wantLast = wrapContract(amountIn ? output : input);
    if (first !== wantFirst)
      throw new Error(err + `${amountIn ? 'input' : 'output'} token does not match path`);
    if (last !== wantLast)
      throw new Error(err + `${amountIn ? 'output' : 'input'} token does not match path`);
  }
  const deadline = opt.deadline || Math.floor(Date.now() / 1000) + opt.ttl;
  // flags for whether funds should be send first to the router
  const routerMustCustody = output === 'eth' || !!opt.fee;
  // TODO: remove "as bigint"
  let args = {
    ...route,
    tokenIn: wrapContract(input),
    tokenOut: wrapContract(output),
    recipient: routerMustCustody ? ADDRESS_ZERO : to,
    deadline,
    amountIn: (amountIn || route.amountIn) as bigint,
    amountOut: (amountOut || route.amountOut) as bigint,
    sqrtPriceLimitX96: opt.sqrtPriceLimitX96 || BigInt(0),
    amountInMaximum: undefined as bigint | undefined,
    amountOutMinimum: undefined as bigint | undefined,
  };
  args.amountInMaximum = addPercent(args.amountIn, opt.slippagePercent);
  args.amountOutMinimum = addPercent(args.amountOut, -opt.slippagePercent);
  const method = ('exact' + (amountIn ? 'Input' : 'Output') + (!args.path ? 'Single' : '')) as
    | 'exactInput'
    | 'exactOutput'
    | 'exactInputSingle'
    | 'exactOutputSingle';
  // TODO: remove unknown
  const calldatas = [(ROUTER_CONTRACT_V3[method].encodeInput as (v: unknown) => Uint8Array)(args)];
  if (input === 'eth' && amountOut) calldatas.push(ROUTER_CONTRACT_V3['refundETH'].encodeInput());
  // unwrap
  if (routerMustCustody) {
    calldatas.push(
      (ROUTER_CONTRACT_V3 as any)[
        (output === 'eth' ? 'unwrapWETH9' : 'sweepToken') + (opt.fee ? 'WithFee' : '')
      ].encodeInput({
        token: wrapContract(output),
        amountMinimum: args.amountOutMinimum,
        recipient: to,
        feeBips: opt.fee && opt.fee.fee * 10000,
        feeRecipient: opt.fee && opt.fee.to,
      })
    );
  }
  const data =
    calldatas.length === 1 ? calldatas[0] : ROUTER_CONTRACT_V3['multicall'].encodeInput(calldatas);
  const value = input === 'eth' ? (amountIn ? amountIn : args.amountInMaximum) : BigInt(0);
  const allowance =
    input !== 'eth'
      ? { token: input, amount: amountIn ? amountIn : args.amountInMaximum }
      : undefined;
  return { to: UNISWAP_V3_ROUTER_CONTRACT, value, data: data as TRet<Uint8Array>, allowance };
}

// Here goes Exchange API. Everything above is SDK.
export class UniswapV3 extends UniswapAbstract {
  name = 'Uniswap V3';
  contract: string = UNISWAP_V3_ROUTER_CONTRACT;
  bestPath(fromCoin: string, toCoin: string, inputAmount: bigint): Promise<Route> {
    return bestPathV3(this.net, fromCoin, toCoin, inputAmount);
  }
  txData(
    toAddress: string,
    fromCoin: string,
    toCoin: string,
    path: any,
    inputAmount?: bigint,
    outputAmount?: bigint,
    opt: SwapOpt = DEFAULT_SWAP_OPT
  ): any {
    return txDataV3(toAddress, fromCoin, toCoin, path, inputAmount, outputAmount, {
      ...DEFAULT_SWAP_OPT,
      ...opt,
    });
  }
}
