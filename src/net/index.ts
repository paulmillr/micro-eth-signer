import Chainlink from './chainlink.js';
import ENS from './ens.js';
import UniswapV2 from './uniswap-v2.js';
import UniswapV3 from './uniswap-v3.js';
import { Web3Provider, Web3CallArgs, hexToNumber } from '../utils.js';

// There are many low level APIs inside which are not exported yet.
export { Chainlink, ENS, UniswapV2, UniswapV3 };

// There is a lot features required for network to make this useful
// This is attempt to create them via small composable wrappers
export type FetchFn = (
  url: string,
  opt?: Record<string, any>
) => Promise<{ json: () => Promise<any> }>;
type Headers = Record<string, string>;
type JsonFn = (url: string, headers: Headers, body: unknown) => Promise<any>;
type PromiseCb<T> = {
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
};

function getJSONUsingFetch(fn: FetchFn): JsonFn {
  return async (url: string, headers: Headers = {}, body: unknown) => {
    const res = await fn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return await res.json();
  };
}

// Unsafe. TODO: inspect for race conditions and bugs.
function limitParallel(jsonFn: JsonFn, limit: number): JsonFn {
  let cur = 0;
  const queue: ({ url: string; headers: Headers; body: unknown } & PromiseCb<any>)[] = [];
  const process = () => {
    if (cur >= limit) return;
    const next = queue.shift();
    if (!next) return;
    try {
      jsonFn(next.url, next.headers, next.body)
        .then(next.resolve)
        .catch(next.reject)
        .finally(() => {
          cur--;
          process();
        });
    } catch (e) {
      next.reject(e);
      cur--;
    }
    cur++;
  };
  return (url, headers, body) => {
    return new Promise((resolve, reject) => {
      queue.push({ url, headers, body, resolve, reject });
      process();
    });
  };
}

type NetworkOpts = {
  limitParallel?: number;
};

export const FetchProvider = (
  fetch: FetchFn,
  url: string,
  headers: Headers = {},
  opts: NetworkOpts = {}
): Web3Provider => {
  let fn = getJSONUsingFetch(fetch);
  if (opts.limitParallel) fn = limitParallel(fn, opts.limitParallel);
  const jsonrpc = async (method: string, ...params: any[]) => {
    const json = await fn(url, headers, { jsonrpc: '2.0', id: 0, method, params });
    if (json && json.error)
      throw new Error(`FetchProvider(${json.error.code}): ${json.error.message || json.error}`);
    return json.result;
  };
  return {
    ethCall: (args: Web3CallArgs, tag = 'latest') =>
      jsonrpc('eth_call', args, tag) as Promise<string>,
    estimateGas: async (args: Web3CallArgs, tag = 'latest') =>
      hexToNumber(await jsonrpc('eth_estimateGas', args, tag)),
    call: (method: string, ...args: any[]) => jsonrpc(method, ...args),
  };
};
