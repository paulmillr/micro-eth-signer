import {
  Web3Provider as _Web3Provider,
  calcTransfersDiff as _calcTransfersDiff,
} from './net/archive.ts';
import _Chainlink from './net/chainlink.ts';
import _ENS from './net/ens.ts';
import _UniswapV2 from './net/uniswap-v2.ts';
import _UniswapV3 from './net/uniswap-v3.ts';

// There are many low level APIs inside which are not exported yet.
/**
 * Chainlink price-feed client helpers.
 * @param net - Web3 provider used for on-chain reads.
 * @example
 * Reuse the same RPC wrapper shown in the README network examples.
 * ```ts
 * import { jsonrpc } from 'micro-ftch';
 * import { Chainlink, Web3Provider } from 'micro-eth-signer/net.js';
 * const prov = new Web3Provider(jsonrpc(fetch, 'http://localhost:8545'));
 * const link = new Chainlink(prov);
 * await link.coinPrice('BTC');
 * ```
 */
export const Chainlink = _Chainlink;
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
 * await ens.nameToAddress('vitalik.eth');
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
 * await prov.height();
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
 * const txs = await prov.transfers('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
 * calcTransfersDiff(txs);
 * ```
 */
export const calcTransfersDiff = _calcTransfersDiff;
