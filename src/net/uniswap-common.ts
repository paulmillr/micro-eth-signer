import { type ContractInfo } from '../abi/decoder.ts';
import { TOKENS_BY_SYMBOL } from '../abi/index.ts';
import { addr } from '../core/address.ts';
import { type IWeb3Provider, createDecimal, ethHex, isBytes, type TRet, weieth } from '../utils.ts';

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
