import * as abi from '../web3.js';
export { default as ERC20 } from './erc20.js';
export { default as ERC721 } from './erc721.js';
import { default as UNISWAP_V2_ROUTER } from './uniswap-v2.js';
import { default as UNISWAP_V3_ROUTER } from './uniswap-v3.js';
import { default as KYBER_NETWORK_PROXY } from './kyber.js';
import { default as WETH } from './weth.js';

export { UNISWAP_V2_ROUTER, UNISWAP_V3_ROUTER, KYBER_NETWORK_PROXY, WETH };

export const UNISWAP_V2_ROUTER_CONTRACT = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
export const UNISWAP_V3_ROUTER_CONTRACT = '0xe592427a0aece92de3edee1f18e0157c05861564';
export const KYBER_NETWORK_PROXY_CONTRACT = '0x9aab3f75489902f3a48495025729a0af77d4b11e';

export const WETH_CONTRACT = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

export const COMMON_TOKENS: Record<string, abi.ContractInfo> = {};
const ERC20: [string, string, number?, number?][] = [
  ['UNI', '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'],
  ['BAT', '0x0d8775f648430679a709e98d2b0cb6250d2887ef'],
  // Required for Uniswap multi-hop routing
  ['USDT', '0xdac17f958d2ee523a2206206994597c13d831ec7', 6, 1],
  ['USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 6, 1],
  ['WETH', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'],
  ['WBTC', '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', 8],
  ['DAI', '0x6b175474e89094c44da98b954eedeac495271d0f', 18, 1],
  ['COMP', '0xc00e94cb662c3520282e6f5717214004a7f26888'],
  ['MKR', '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2'],
  ['AMPL', '0xd46ba6d942050d489dbd938a2c909a5d5039a161', 9],
];

for (let item of ERC20) {
  const [symbol, addr, decimals, price] = item;
  COMMON_TOKENS[addr as string] = { abi: 'ERC20', symbol, decimals: decimals || 18, price };
}

export function tokenFromSymbol(symbol: string) {
  for (let c in COMMON_TOKENS) {
    if (COMMON_TOKENS[c].symbol === symbol) return Object.assign({ contract: c }, COMMON_TOKENS[c]);
  }
  throw new Error('unknown token');
}

export const DEFAULT_CONTRACTS: Record<string, abi.ContractInfo> = {
  [UNISWAP_V2_ROUTER_CONTRACT]: { abi: UNISWAP_V2_ROUTER, name: 'UNISWAP V2 ROUTER' },
  [KYBER_NETWORK_PROXY_CONTRACT]: { abi: KYBER_NETWORK_PROXY, name: 'KYBER NETWORK PROXY' },
  [UNISWAP_V3_ROUTER_CONTRACT]: { abi: UNISWAP_V3_ROUTER, name: 'UNISWAP V3 ROUTER' },
  ...COMMON_TOKENS,
  [WETH_CONTRACT]: { abi: WETH, name: 'WETH Token', decimals: 18, symbol: 'WETH' },
};
