import Chainlink from './chainlink.js';
import ENS from './ens.js';
import UniswapV2 from './uniswap-v2.js';
import UniswapV3 from './uniswap-v3.js';
import { Web3Provider, Web3CallArgs, hexToNumber } from '../utils.js';

export { Chainlink, ENS, UniswapV2, UniswapV3 };

export const FetchProvider = (
  fetch: (url: string, opt?: Record<string, any>) => Promise<{ json: () => Promise<any> }>,
  url: string,
  headers: Record<string, string> = {}
): Web3Provider => {
  const jsonrpc = async (method: string, ...params: any[]) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method, params }),
    });
    const json = await res.json();
    if (json && json.error)
      throw new Error(`FetchProvider(${json.error.code}): ${json.error.message}`);
    return json.result;
  };
  return {
    ethCall: (args: Web3CallArgs, tag = 'latest') =>
      jsonrpc('eth_call', args, tag) as Promise<string>,
    estimateGas: async (args: Web3CallArgs, tag = 'latest') =>
      hexToNumber(await jsonrpc('eth_estimateGas', args, tag)),
  };
};
