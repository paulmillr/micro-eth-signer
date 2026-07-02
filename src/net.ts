import {
  Web3Provider as _Web3Provider,
  calcTransfersDiff as _calcTransfersDiff,
} from './net/archive.ts';
import _ENS from './net/ens.ts';
import {
  ChainlinkQuoter as _ChainlinkQuoter,
  ERC4626Quoter as _ERC4626Quoter,
  UniswapV2Quoter as _UniswapV2Quoter,
  UniswapV3Quoter as _UniswapV3Quoter,
} from './net/quoter.ts';
import _UniswapV2 from './net/uniswap-v2.ts';
import _UniswapV3 from './net/uniswap-v3.ts';
export type { QuoterOpt, RateDirection, RateQuoter, UniswapPriceOpt } from './net/quoter.ts';
export { QUOTER_TOKENS } from './net/quoter_tokens.ts';

// There are many low level APIs inside which are not exported yet.
/**
 * Chainlink price-feed quoter helpers.
 * @param net - Web3 provider used for on-chain reads.
 * @example
 * Reuse the same RPC wrapper shown in the README network examples.
 * ```ts
 * import { jsonrpc } from 'micro-ftch';
 * import { ChainlinkQuoter, Web3Provider } from 'micro-eth-signer/net.js';
 * const prov = new Web3Provider(jsonrpc(fetch, 'http://localhost:8545'));
 * const link = new ChainlinkQuoter(prov);
 * async function main() {
 *   await link.coinPrice('BTC');
 * }
 * ```
 */
export const ChainlinkQuoter = _ChainlinkQuoter;
/** @deprecated Use {@link ChainlinkQuoter}. */
export const Chainlink = _ChainlinkQuoter;
/**
 * Uniswap V2 spot-rate quoter backed by pair reserves.
 * Forward direction means `token0 -> token1`; reverse means `token1 -> token0`.
 */
export const UniswapV2Quoter = _UniswapV2Quoter;
/**
 * Uniswap V3 spot-rate quoter backed by pool `slot0.sqrtPriceX96`.
 * Forward direction means `token0 -> token1`; reverse means `token1 -> token0`.
 */
export const UniswapV3Quoter = _UniswapV3Quoter;
/**
 * ERC-4626 vault quoter backed by `convertToAssets` and `convertToShares`.
 * Forward direction means vault shares -> underlying asset.
 */
export const ERC4626Quoter = _ERC4626Quoter;
/**
 * ENS lookup helpers backed by a Web3 provider.
 * @param net - Web3 provider used for ENS registry and resolver reads.
 * @example
 * Resolve a name through the same archive/provider wrapper.
 * ```ts
 * import { jsonrpc } from 'micro-ftch';
 * import { ENS, Web3Provider } from 'micro-eth-signer/net.js';
 * const prov = new Web3Provider(jsonrpc(fetch, 'http://localhost:8545'));
 * const ens = new ENS(prov);
 * async function main() {
 *   await ens.nameToAddress('vitalik.eth');
 * }
 * ```
 */
export const ENS = _ENS;
/**
 * Uniswap V2 quoting and transaction helpers.
 * @param net - Web3 provider used for pool reserve lookups.
 * @example
 * Instantiate the Uniswap helper on top of an RPC-backed provider.
 * ```ts
 * import { jsonrpc } from 'micro-ftch';
 * import { UniswapV2, Web3Provider } from 'micro-eth-signer/net.js';
 * const prov = new Web3Provider(jsonrpc(fetch, 'http://localhost:8545'));
 * const u2 = new UniswapV2(prov);
 * ```
 */
export const UniswapV2 = _UniswapV2;
/**
 * Uniswap V3 quoting and transaction helpers.
 * @param net - Web3 provider used for quoter calls.
 * @example
 * Instantiate the Uniswap V3 helper on top of an RPC-backed provider.
 * ```ts
 * import { jsonrpc } from 'micro-ftch';
 * import { UniswapV3, Web3Provider } from 'micro-eth-signer/net.js';
 * const prov = new Web3Provider(jsonrpc(fetch, 'http://localhost:8545'));
 * const u3 = new UniswapV3(prov);
 * ```
 */
export const UniswapV3 = _UniswapV3;
/**
 * Archive-node RPC helpers.
 * @param rpc - Low-level provider used for archive and tracing methods.
 * @example
 * Wrap a JSON-RPC transport before calling the higher-level helpers.
 * ```ts
 * import { jsonrpc } from 'micro-ftch';
 * import { Web3Provider } from 'micro-eth-signer/net.js';
 * const prov = new Web3Provider(jsonrpc(fetch, 'http://localhost:8545'));
 * async function main() {
 *   await prov.height();
 * }
 * ```
 */
export const Web3Provider = _Web3Provider;
/**
 * Reduces per-transfer records into net address deltas.
 * @param transfers - transfer list from a parsed transaction or block.
 * @returns Address map keyed by participant with the aggregated value change.
 * @example
 * Fetch a traced transfer list and fold it into running balances.
 * ```ts
 * import { jsonrpc } from 'micro-ftch';
 * import { calcTransfersDiff, Web3Provider } from 'micro-eth-signer/net.js';
 * const prov = new Web3Provider(jsonrpc(fetch, 'http://localhost:8545'));
 * async function main() {
 *   const txs = await prov.transfers('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
 *   calcTransfersDiff(txs);
 * }
 * ```
 */
export const calcTransfersDiff = _calcTransfersDiff;
