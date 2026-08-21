/*
The network transport layer: RpcClient over an injected IWeb3Provider (never a
bundled HTTP client), plus the shared fan-out/resilience primitives (mapPool,
withRetry) built on it. Higher-level modules ship as their own entry points:

- micro-eth-signer/net/history.js — address history scanner (history, tokenScanner)
- micro-eth-signer/net/enrich.js — row enrichment and clear signing (enrichTx, rowCodec)
- micro-eth-signer/net/tokens.js — token metadata, balances, transfers, NFTs
- micro-eth-signer/net/quoter.js — asset price quoting (Chainlink, Uniswap, ERC-4626)
- micro-eth-signer/net/resolver.js — ENS + GNS name resolution
- micro-eth-signer/net/uniswap.js — Uniswap V2/V3 swap building
- micro-eth-signer/net/clearsig.js — ERC-7730 resolver callbacks
- micro-eth-signer/net/trace.js — trace_filter-based scanning (archive nodes)
*/
import { createContract, decodeError } from './abi/index.ts';
import type { ContractType, DecodedError, FnArg } from './abi/decoder.ts';
import type { ArrLike, Writable } from './abi/mapper.ts';
import { MULTICALL3, MULTICALL3_ABI } from './abi/multicall.ts';
import { TxVersions, legacySig, type AccessList } from './core/tx-internal.ts';
import { Transaction } from './core/tx.ts';
import {
  ADDRESS_ZERO,
  amounts,
  ethHex,
  ethHexNum,
  isObject,
  type IWeb3Provider,
  type TRet,
  type Web3CallArgs,
} from './utils.ts';

export const ethNum = (n: number | bigint | undefined) => ethHexNum.encode(n === undefined ? 0 : n);
const ethTag = (tag: Web3CallArgs['tag'] | undefined) => {
  if (tag === undefined) return 'latest';
  if (typeof tag === 'number') {
    if (!Number.isSafeInteger(tag) || tag < 0) throw new Error('ethCall: wrong tag');
    return ethNum(tag);
  }
  if (tag === 'latest' || tag === 'earliest' || tag === 'pending') return tag;
  throw new Error('ethCall: wrong tag');
};
const txHashRe = /^0x[0-9a-fA-F]{64}$/;
const addressRe = /^0x[0-9a-fA-F]{40}$/;
const _0n = /* @__PURE__ */ BigInt(0);

export type BlockInfo = {
  baseFeePerGas: bigint;
  difficulty: bigint;
  extraData: string;
  gasLimit: bigint;
  gasUsed: bigint;
  hash: string;
  logsBloom: string;
  miner: string;
  mixHash: string;
  nonce: string;
  number: number;
  parentHash: string;
  receiptsRoot: string;
  sha3Uncles: string;
  size: number;
  stateRoot: string;
  /** Unix seconds. */
  timestamp: number;
  totalDifficulty?: bigint;
  transactions: string[];
  transactionsRoot: string;
  uncles: string[];
};

export type ActionOts = {
  type: string;
  depth: number;
  from: string;
  to: string;
  value: bigint | null;
  input: string;
  output: string;
};

export type Log = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: number;
  transactionHash: string;
  transactionIndex: number;
  blockHash: string;
  logIndex: number;
  removed: boolean;
};

export type TxInfo = {
  blockHash: string | undefined;
  blockNumber: number | undefined;
  hash: string;
  accessList?: AccessList;
  transactionIndex: number | undefined;
  type: number;
  nonce: bigint;
  input: string;
  r: bigint;
  s: bigint;
  chainId: bigint;
  v: bigint;
  yParity?: string;
  gas: bigint;
  maxPriorityFeePerGas?: bigint;
  from: string;
  to: string;
  maxFeePerGas?: bigint;
  value: bigint;
  gasPrice: bigint;
  maxFeePerBlobGas?: bigint;
  blobVersionedHashes?: string[];
  /** Unix seconds. Erigon extension: present on OTS search results. */
  blockTimestamp?: number;
};

export type TxInfoFull = {
  type: 'legacy' | 'eip2930' | 'eip1559' | 'eip4844' | 'eip7702';
  info: TxInfo;
  /** Undefined for pending transactions, which have no receipt yet. */
  receipt: TxReceipt | undefined;
  raw: string | undefined;
};

export type TxReceipt = {
  transactionHash: string;
  blockHash: string;
  blockNumber: number;
  logsBloom: string;
  gasUsed: bigint;
  contractAddress: string | null;
  cumulativeGasUsed: bigint;
  transactionIndex: number;
  from: string;
  to: string;
  type: number;
  effectiveGasPrice: bigint;
  logs: Log[];
  status: number;
  blobGasPrice?: bigint;
  blobGasUsed?: bigint;
  /** Unix seconds. Erigon extension: present on OTS search receipts. */
  timestamp?: number;
};

export type Unspent = {
  symbol: 'ETH';
  decimals: number;
  balance: bigint;
  nonce: bigint;
  active: boolean;
};

export type FeeEstimate =
  | { type: 'eip1559'; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; baseFee: bigint }
  | { type: 'legacy'; gasPrice: bigint };

export type PreparedTx = {
  nonce: bigint;
  gasLimit: bigint;
  chainId: bigint;
  to: string;
  value: bigint;
  data: string;
} & (
  | { type: 'eip1559'; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
  | { type: 'legacy'; gasPrice: bigint }
);

export type WaitReceiptOpts = {
  /** Blocks on top of the inclusion block, default 1 (just included). */
  confirmations?: number;
  /** Give up (reject) after this long; default is to wait forever. */
  timeoutMs?: number;
  /** Delay between eth_getTransactionReceipt polls, default 3000. */
  pollIntervalMs?: number;
  signal?: AbortSignal;
};

/** RPC namespaces supported by a node; see capabilities(). */
export type NodeCapabilities = { eth: boolean; trace: boolean; ots: boolean };

export type OtsSearchTransactionsRaw = {
  txs: TxInfo[];
  receipts: TxReceipt[];
  firstPage: boolean;
  lastPage: boolean;
};

export type OtsSearch = {
  /** `receipt` is undefined when the response carries no receipt for a tx. */
  txs: { info: TxInfo; receipt: TxReceipt | undefined }[];
  firstPage: boolean;
  lastPage: boolean;
};

export type Topics = (string | null | (string | null)[])[];
export type EthLogsOpts =
  | {
      /** Contract address(es) to scope the query to; unset matches every contract. */
      address?: string | string[];
      fromBlock?: number;
      toBlock?: number;
    }
  | {
      /** Contract address(es) to scope the query to; unset matches every contract. */
      address?: string | string[];
      fromBlock: number;
      toBlock: number;
      /** Blocks per eth_getLogs batch; the range is fanned out in disjoint batches. */
      limitLogs: number;
      /** Concurrent batch requests (default 8); tune to the node's useful parallelism. */
      concurrency?: number;
    };

export type RpcTransport = {
  call: (method: string, ...args: any[]) => Promise<any>;
};

const fixOtsSearch = (search: OtsSearchTransactionsRaw): OtsSearch => {
  const receipts: Record<string, TxReceipt> = {};
  for (const r of search.receipts) receipts[r.transactionHash] = fixTxReceipt(r);
  return {
    txs: search.txs.map((tx) => ({ info: fixTxInfo(tx), receipt: receipts[tx.hash] })),
    firstPage: search.firstPage,
    lastPage: search.lastPage,
  };
};

function fixBlock(block: BlockInfo) {
  block.timestamp = Number(block.timestamp);
  block.size = Number(block.size);
  if (block.number && block.number !== null) block.number = Number(block.number);
  for (const i of [
    'baseFeePerGas',
    'difficulty',
    'gasLimit',
    'gasUsed',
    'totalDifficulty',
  ] as const) {
    if (block[i] && block[i] !== null) block[i] = BigInt(block[i]);
  }
}

function fixLog(log: Log) {
  log.blockNumber = Number(log.blockNumber);
  log.transactionIndex = Number(log.transactionIndex);
  log.logIndex = Number(log.logIndex);
  return log;
}

function fixTxInfo(info: TxInfo) {
  // Pending RPC transactions use null location fields; normalized APIs use undefined.
  if (info.blockHash === null) info.blockHash = undefined;
  for (const i of ['blockNumber', 'transactionIndex'] as const)
    info[i] = info[i] === null || info[i] === undefined ? undefined : Number(info[i]);
  info.type = Number(info.type);
  for (const i of [
    'nonce',
    'r',
    's',
    'chainId',
    'v',
    'gas',
    'maxPriorityFeePerGas',
    'maxFeePerGas',
    'value',
    'gasPrice',
    'maxFeePerBlobGas',
  ] as const) {
    if (info[i] !== undefined && info[i] !== null) info[i] = BigInt(info[i]!);
  }
  if (info.blockTimestamp !== undefined && info.blockTimestamp !== null)
    info.blockTimestamp = Number(info.blockTimestamp);
  return info;
}

function fixTxReceipt(receipt: TxReceipt) {
  for (const i of ['blockNumber', 'type', 'transactionIndex', 'status'] as const)
    receipt[i] = Number(receipt[i]);
  for (const i of [
    'gasUsed',
    'cumulativeGasUsed',
    'effectiveGasPrice',
    'blobGasPrice',
    'blobGasUsed',
  ] as const) {
    if (receipt[i] !== undefined) receipt[i] = BigInt(receipt[i]!);
  }
  if (receipt.timestamp !== undefined && receipt.timestamp !== null)
    receipt.timestamp = Number(receipt.timestamp);
  for (const log of receipt.logs) fixLog(log);
  return receipt;
}

function fixOtsAction(action: ActionOts) {
  action.depth = Number(action.depth);
  if (action.value !== null && action.value !== undefined) action.value = BigInt(action.value);
  return action;
}

function validateLogOpts(opts: Record<string, unknown>) {
  for (const i of ['fromBlock', 'toBlock']) {
    const val = opts[i];
    if (val === undefined || (typeof val === 'number' && Number.isSafeInteger(val) && val >= 0))
      continue;
    throw new Error(
      `validatePagination: wrong field ${i}=${opts[i]}. Should be non-negative integer or undefined`
    );
  }
  for (const i of ['limitLogs']) {
    const val = opts[i];
    if (val === undefined || (typeof val === 'number' && Number.isSafeInteger(val) && val > 0))
      continue;
    throw new Error(
      `validateLogOpts: wrong field ${i}=${opts[i]}. Should be positive integer or undefined`
    );
  }
  if (opts.limitLogs !== undefined) {
    if (opts.fromBlock === undefined || opts.toBlock === undefined)
      throw new Error('validateLogOpts: fromBlock/toBlock required if limitLogs is present');
  }
  if (opts.address !== undefined) {
    const list = Array.isArray(opts.address) ? opts.address : [opts.address];
    if (!list.length || list.some((a) => typeof a !== 'string' || !addressRe.test(a)))
      throw new Error(`validateLogOpts: wrong address=${opts.address}`);
  }
  if (opts.concurrency !== undefined) {
    const val = opts.concurrency;
    if (typeof val !== 'number' || !Number.isSafeInteger(val) || val <= 0)
      throw new Error(`validateLogOpts: wrong concurrency=${val}`);
    if (opts.limitLogs === undefined)
      throw new Error('validateLogOpts: limitLogs required if concurrency is present');
  }
}

/**
 * Error thrown by RpcClient methods. Carries the JSON-RPC method that failed,
 * the node's RPC error code (when one was returned) and an `isRevert` flag, so
 * callers can use `instanceof`/fields instead of matching message strings.
 */
export class Web3Error extends Error {
  readonly method: string;
  readonly rpcCode?: number;
  readonly isRevert: boolean;
  constructor(
    message: string,
    opts: { method: string; rpcCode?: number; isRevert?: boolean; cause?: unknown } = {
      method: 'unknown',
    }
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'Web3Error';
    this.method = opts.method;
    this.rpcCode = opts.rpcCode;
    this.isRevert = !!opts.isRevert;
  }
}

const RPC_METHOD_NOT_FOUND = -32601;
export const isMethodNotFound = (e: unknown): boolean => {
  if (!(e instanceof Error)) return false;
  if ((e as { code?: unknown }).code === RPC_METHOD_NOT_FOUND) return true;
  return /method not found|does not exist|is not available|not supported/i.test(e.message);
};

export const requireMethod = (e: unknown, method: string, requirement: string): Error => {
  if (isMethodNotFound(e))
    return new Web3Error(`${method} not available on this node: ${requirement}; see README`, {
      method,
      rpcCode: (e as { code?: number }).code,
      cause: e,
    });
  return e instanceof Error ? e : new Error(String(e));
};

export const TRACE_REQUIREMENT =
  'range trace scanning needs an archive node with an uncapped trace_filter namespace';
export const TX_TRACE_REQUIREMENT =
  'internal history enrichment needs trace_transaction or the ots_* namespace';
export const OTS_REQUIREMENT = 'needs an OtterScan-enabled node (ots_* namespace)';

export const isReverted = (e: Error) =>
  (e instanceof Web3Error && e.isRevert) ||
  (e instanceof Error && e.message.toLowerCase().includes('revert'));

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      done();
      reject(signal!.reason ?? new Error('aborted'));
    };
    const timer = setTimeout(() => {
      done();
      resolve();
    }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });

export const throwIfAborted = (signal: AbortSignal | undefined, name: string) => {
  if (signal && signal.aborted) throw signal.reason ?? new Error(`${name}: aborted`);
};

// Nodes shed load with retryable errors (Erigon: -32005 "server overloaded,
// retry later"), and busy addresses trip them routinely under concurrent
// requests. Long scans back off and retry those instead of aborting; anything
// else propagates unchanged.
const RPC_LIMIT_EXCEEDED = -32005;
// 'extends beyond current head': eth_blockNumber can briefly run ahead of the
// logs index while the node ingests a block; the head catches up in moments
const RETRYABLE_RPC =
  /overloaded|retry later|rate ?limit|too many requests|extends beyond current head/i;
// undici reports dropped/reset connections as generic 'fetch failed'; an
// overloaded node answering a batch with a non-JSON-RPC body surfaces as
// 'invalid response in batch request'; an HTML error page from the node or a
// proxy in front of it fails JSON parsing ("... is not valid JSON")
const RETRYABLE_NET =
  /fetch failed|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|invalid response in batch|not valid JSON|in JSON at position|bad gateway|gateway time-?out|service unavailable/i;
export function isTransientRpcError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError') return false; // user aborts are not transient
  if ((error as { code?: unknown }).code === RPC_LIMIT_EXCEEDED) return true;
  return RETRYABLE_RPC.test(error.message) || RETRYABLE_NET.test(error.message);
}
export async function withRetry<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
  name: string = 'retry'
): Promise<T> {
  // Never start an operation that its caller already canceled.
  throwIfAborted(signal, name);
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= 8 || !isTransientRpcError(error)) throw error;
      // exponential backoff with jitter, ~125ms first: the tail must outlast a
      // node/proxy outage burst (~30s), not just a dropped request
      const delay = Math.min(250 * 2 ** attempt, 8000) * (0.5 + Math.random());
      await sleep(delay, signal);
      throwIfAborted(signal, name);
    }
  }
}

/**
 * Maps items through an async fn with at most `concurrency` in flight,
 * preserving input order in the result. The shared worker-pool primitive for
 * batched RPC fan-out (tokenInfos, nftHoldings, history tx fetches).
 */
export async function mapPool<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  opts: { concurrency?: number; signal?: AbortSignal; name?: string } = {}
): Promise<R[]> {
  const name = opts.name ?? 'mapPool';
  if (
    opts.concurrency !== undefined &&
    (!Number.isSafeInteger(opts.concurrency) || opts.concurrency <= 0)
  )
    throw new Error(`${name}: wrong concurrency`);
  const out: R[] = new Array(items.length);
  let cursor = 0;
  let stopped = false;
  const worker = async () => {
    try {
      for (;;) {
        // A rejected pool must not keep starting side-effecting RPC work.
        if (stopped) return;
        throwIfAborted(opts.signal, name);
        const index = cursor++;
        if (index >= items.length) return;
        out[index] = await fn(items[index], index);
      }
    } catch (error) {
      stopped = true;
      throw error;
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 8, items.length) }, worker));
  return out;
}

async function ethLogsSingle(
  prov: Pick<RpcClient, 'call'>,
  topics: Topics,
  opts: EthLogsOpts
): Promise<Log[]> {
  validateLogOpts(opts);
  const req: Record<string, any> = { topics, fromBlock: ethNum(opts.fromBlock || 0) };
  if (opts.toBlock !== undefined) req.toBlock = ethNum(opts.toBlock);
  if (opts.address !== undefined) req.address = opts.address;
  const res = await prov.call('eth_getLogs', req);
  return res.map((i: any) => fixLog(i));
}

const ETH_LOGS_CONCURRENCY = 8;
// A caller can cover a larger span by increasing limitLogs. Bounding the number
// of chunks prevents a tiny limit over a huge safe-integer range from allocating
// millions of batch slots or scheduling an effectively unbounded crawl.
const MAX_BLOCK_RANGE_CHUNKS = 4096;

function blockRangeChunks(fromBlock: number, toBlock: number, step: number, name: string): number {
  if (fromBlock > toBlock) return 0;
  const chunks = Math.floor((toBlock - fromBlock) / step) + 1;
  if (chunks > MAX_BLOCK_RANGE_CHUNKS) {
    throw new RangeError(
      `${name}: block range requires ${chunks} chunks, limit is ${MAX_BLOCK_RANGE_CHUNKS}`
    );
  }
  return chunks;
}

function txInfoRaw(info: TxInfo, receipt: TxReceipt | undefined, verify: boolean): TxInfoFull {
  const type = Object.keys(TxVersions)[info.type] as keyof typeof TxVersions;
  let raw: string | undefined = undefined;
  const rawData: Record<string, any> = {
    nonce: info.nonce,
    gasLimit: info.gas,
    to: info.to === null ? '0x' : info.to,
    value: info.value,
    data: info.input,
    r: info.r,
    s: info.s,
    yParity: Number(info.v),
    chainId: info.chainId,
  };
  if (info.accessList) rawData.accessList = info.accessList;
  if (info.maxFeePerBlobGas) rawData.maxFeePerBlobGas = info.maxFeePerBlobGas;
  if (info.blobVersionedHashes) rawData.blobVersionedHashes = info.blobVersionedHashes;
  if (info.maxFeePerGas !== undefined) {
    rawData.maxFeePerGas = info.maxFeePerGas;
    rawData.maxPriorityFeePerGas = info.maxPriorityFeePerGas;
  } else if (info.gasPrice !== undefined) {
    rawData.gasPrice = info.gasPrice;
  }
  if (type === 'legacy')
    Object.assign(rawData, legacySig.encode({ v: info.v, r: info.r, s: info.s }));
  // Rebuilding re-derives sender and hash from the signature. With
  // `verify: false` a failed rebuild (e.g. a chain-specific tx type) only
  // leaves `raw` undefined instead of making the tx unfetchable.
  try {
    const tx = new Transaction(type, rawData as any, { strict: false });
    if (tx.recoverSender().address.toLowerCase() !== info.from.toLowerCase())
      throw new Error('txInfo: wrong sender');
    if (info.hash !== tx.hash) throw new Error('txInfo: wrong hash');
    // Bind the independently fetched receipt before combining both responses.
    if (
      receipt &&
      (typeof receipt.transactionHash !== 'string' ||
        receipt.transactionHash.toLowerCase() !== info.hash.toLowerCase())
    )
      throw new Error('txInfo: wrong receipt hash');
    raw = tx.toHex();
  } catch (e) {
    if (verify) throw e;
  }
  return { type, info, receipt, raw };
}

/**
 * Core Ethereum JSON-RPC client. The class intentionally stays close to
 * single-endpoint wrappers; scanners and token helpers live as free functions
 * in adjacent modules for tree-shaking.
 */
export class RpcClient implements IWeb3Provider {
  private transport: RpcTransport;
  private capabilitiesPromise?: Promise<NodeCapabilities>;

  constructor(transport: RpcTransport) {
    this.transport = transport;
  }

  call(method: string, ...args: any[]): Promise<any> {
    return this.transport.call(method, ...args);
  }
  ethCall(args: Web3CallArgs, tag = args.tag): Promise<any> {
    const { tag: _tag, ...callArgs } = args;
    return this.transport.call('eth_call', callArgs, ethTag(tag));
  }
  async estimateGas(args: Web3CallArgs, tag = args.tag): Promise<bigint> {
    const { tag: _tag, ...callArgs } = args;
    return ethHexNum.decode(await this.transport.call('eth_estimateGas', callArgs, ethTag(tag)));
  }
  /**
   * Simulates a call/transfer with `eth_call`, without broadcasting anything:
   * a pre-flight "would this revert?" for a transaction about to be signed.
   * On revert, the reason is decoded with `decodeError` when the node's revert
   * data is reachable; transports that drop `error.data` (or nodes that embed
   * it in the message) degrade to the raw node message.
   */
  async dryRun(args: {
    from?: string;
    to: string;
    value?: bigint;
    data?: string;
    tag?: Web3CallArgs['tag'];
  }): Promise<
    | { success: true; returnData: string }
    | { success: false; reason: string; data?: string; decoded?: DecodedError }
  > {
    if (typeof args.to !== 'string') throw new Error('dryRun: wrong to');
    const callArgs: Web3CallArgs = { to: args.to };
    if (args.from !== undefined) callArgs.from = args.from;
    if (args.value !== undefined) callArgs.value = ethNum(args.value);
    if (args.data !== undefined) callArgs.data = args.data;
    try {
      return { success: true, returnData: await this.ethCall(callArgs, args.tag) };
    } catch (e) {
      const err = e as Error & { data?: unknown };
      const hex =
        typeof err.data === 'string' && err.data.startsWith('0x')
          ? err.data
          : /(0x[0-9a-fA-F]{8,})/.exec(err.message)?.[1];
      let decoded: DecodedError | undefined;
      if (hex) {
        try {
          decoded = decodeError(hex);
        } catch {}
      }
      const out: { success: false; reason: string; data?: string; decoded?: DecodedError } = {
        success: false,
        reason: decoded?.message || err.message,
      };
      if (hex) out.data = hex;
      if (decoded) out.decoded = decoded;
      return out;
    }
  }

  async blockInfo(block: number): Promise<BlockInfo> {
    const res = await this.call('eth_getBlockByNumber', ethNum(block), false);
    fixBlock(res);
    return res;
  }

  /** Balance, nonce and activity flag for an address. */
  async accountState(address: string): Promise<Unspent> {
    let [balance, nonce] = await Promise.all([
      this.call('eth_getBalance', address, 'latest'),
      this.call('eth_getTransactionCount', address, 'latest'),
    ]);
    balance = BigInt(balance);
    nonce = BigInt(nonce);
    return {
      symbol: 'ETH',
      decimals: amounts.ETH_PRECISION,
      balance,
      nonce,
      // RPC quantities are bigint; comparing 0n with numeric zero marks an unused account active.
      active: balance > _0n || nonce !== _0n,
    };
  }
  /**
   * ETH balances of many addresses in one Multicall3 `getEthBalance` round —
   * one RPC instead of one `eth_getBalance` per address. Chains without the
   * deployment (the aggregate call fails) fall back to per-address calls.
   */
  async ethBalances(
    addresses: string[],
    opts: { contract?: string } = {}
  ): Promise<Record<string, bigint>> {
    if (!Array.isArray(addresses) || addresses.some((a) => typeof a !== 'string'))
      throw new Error('ethBalances: wrong addresses');
    if (!addresses.length) return {};
    const m = createContract(MULTICALL3_ABI).getEthBalance;
    const contract = opts.contract === undefined ? MULTICALL3 : opts.contract;
    try {
      const res = await this.multicall(
        addresses.map((address) => ({
          to: contract,
          data: ethHex.encode(m.encodeInput(address)),
          allowFailure: false,
        })),
        opts
      );
      return Object.fromEntries(
        addresses.map((address, i) => [address, m.decodeOutput(ethHex.decode(res[i].data))])
      );
    } catch {
      const balances = await Promise.all(
        addresses.map((address) => this.call('eth_getBalance', address, 'latest'))
      );
      return Object.fromEntries(addresses.map((address, i) => [address, BigInt(balances[i])]));
    }
  }
  async height(): Promise<number> {
    return Number.parseInt(await this.call('eth_blockNumber'));
  }
  async nonce(address: string): Promise<bigint> {
    if (typeof address !== 'string') throw new Error('nonce: wrong address');
    // Confirmed nonce permits replacing a stuck pending tx; callers can override prepared fields to queue.
    return BigInt(await this.call('eth_getTransactionCount', address, 'latest'));
  }
  /**
   * Suggested fees for the next block based on eth_feeHistory, with eth_gasPrice fallback.
   * Assumes the chain has activated London; pre-London nodes can return zero-base-fee history.
   */
  async fees(): Promise<FeeEstimate> {
    try {
      const hist = await this.call('eth_feeHistory', '0x5', 'latest', [25]);
      const baseFee = BigInt(hist.baseFeePerGas[hist.baseFeePerGas.length - 1]);
      const rewards: bigint[] = (hist.reward || [])
        .map((r: string[]) => BigInt(r[0]))
        .filter((i: bigint) => i > _0n);
      const _1gwei = BigInt(1_000_000_000);
      const maxPriorityFeePerGas = rewards.length
        ? rewards.reduce((a, b) => a + b, _0n) / BigInt(rewards.length)
        : _1gwei;
      return {
        type: 'eip1559',
        maxFeePerGas: BigInt(2) * baseFee + maxPriorityFeePerGas,
        maxPriorityFeePerGas,
        baseFee,
      };
    } catch (e) {
      return { type: 'legacy', gasPrice: BigInt(await this.call('eth_gasPrice')) };
    }
  }
  /**
   * Broadcasts a signed transaction.
   * EIP-4844 requires raw hex containing the pooled wrapper with blobs, commitments and proofs;
   * its canonical `Transaction.toHex()` payload does not contain that sidecar data.
   * @param tx - signed raw transaction hex, or a signed Transaction (`.toHex()` is used)
   * @returns transaction hash
   */
  async broadcast(tx: string | Transaction<keyof typeof TxVersions>): Promise<string> {
    const hex = typeof tx === 'string' ? tx : tx.toHex({ includeSignature: true });
    if (typeof hex !== 'string' || !hex.startsWith('0x'))
      throw new Error('broadcast: wrong transaction');
    return await this.call('eth_sendRawTransaction', hex);
  }
  /**
   * Batches multiple read-only calls into a single Multicall3 `aggregate3` eth_call.
   * @param calls - list of `{ to, data }` calls; `allowFailure` (default true) lets a
   * single call revert without failing the whole batch
   * @param opts.tag - block tag, as in `ethCall`
   * @param opts.contract - Multicall3 deployment address, defaults to the canonical one
   * @returns per-call `{ success, data }` with hex-encoded return data
   * @example
   * ```ts
   * const [name, symbol] = await rpc.multicall([
   *   { to: token, data: nameCalldata },
   *   { to: token, data: symbolCalldata },
   * ]);
   * ```
   */
  async multicall(
    calls: { to: string; data: string; allowFailure?: boolean }[],
    opts: { tag?: Web3CallArgs['tag']; contract?: string } = {}
  ): Promise<{ success: boolean; data: string }[]> {
    if (!Array.isArray(calls)) throw new TypeError('multicall: expected array of calls');
    const arg = calls.map((call, i) => {
      if (!isObject(call) || typeof call.to !== 'string' || typeof call.data !== 'string')
        throw new Error(`multicall: wrong call at index ${i}`);
      return {
        target: call.to,
        // Default only an omitted policy; the ABI coder rejects non-booleans.
        allowFailure: call.allowFailure === undefined ? true : call.allowFailure,
        callData: ethHex.decode(call.data),
      };
    });
    const m = createContract(MULTICALL3_ABI).aggregate3;
    const to = opts.contract === undefined ? MULTICALL3 : opts.contract;
    const res = await this.ethCall({ to, data: ethHex.encode(m.encodeInput(arg)) }, opts.tag);
    const decoded = m.decodeOutput(ethHex.decode(res));
    // aggregate3 returns exactly one positionally aligned result per input call.
    if (decoded.length !== calls.length)
      throw new Error(`multicall: expected ${calls.length} results, got ${decoded.length}`);
    return decoded.map(({ success, returnData }) => ({
      success,
      data: ethHex.encode(returnData),
    }));
  }
  /** Polls until the transaction is included (+ optional confirmations). */
  async waitForReceipt(txHash: string, opts: WaitReceiptOpts = {}): Promise<TxReceipt> {
    if (typeof txHash !== 'string' || !txHashRe.test(txHash))
      throw new Error('waitForReceipt: wrong txHash');
    const confirmations = opts.confirmations === undefined ? 1 : opts.confirmations;
    const pollIntervalMs = opts.pollIntervalMs === undefined ? 3000 : opts.pollIntervalMs;
    if (!Number.isSafeInteger(confirmations) || confirmations < 1)
      throw new Error('waitForReceipt: wrong confirmations');
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0)
      throw new Error('waitForReceipt: wrong pollIntervalMs');
    if (
      opts.timeoutMs !== undefined &&
      (!Number.isSafeInteger(opts.timeoutMs) || opts.timeoutMs <= 0)
    )
      throw new Error('waitForReceipt: wrong timeoutMs');
    throwIfAborted(opts.signal, 'waitForReceipt');
    const deadline =
      opts.timeoutMs !== undefined || opts.signal ? new AbortController() : undefined;
    const stopped = deadline
      ? new Promise<never>((_, reject) =>
          deadline.signal.addEventListener('abort', () => reject(deadline.signal.reason), {
            once: true,
          })
        )
      : undefined;
    const wait = <T>(promise: Promise<T>) =>
      stopped ? Promise.race<T>([promise, stopped]) : promise;
    const onAbort = () =>
      deadline!.abort(opts.signal!.reason ?? new Error('waitForReceipt: aborted'));
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(
            () =>
              deadline!.abort(
                new Web3Error('waitForReceipt: timeout', {
                  method: 'eth_getTransactionReceipt',
                })
              ),
            opts.timeoutMs
          );
    try {
      for (;;) {
        throwIfAborted(opts.signal, 'waitForReceipt');
        const receipt = await wait(this.call('eth_getTransactionReceipt', txHash));
        if (receipt !== null && receipt !== undefined) {
          const fixed = fixTxReceipt(receipt);
          // A hash-keyed receipt lookup must never confirm a different transaction.
          if (
            typeof fixed.transactionHash !== 'string' ||
            fixed.transactionHash.toLowerCase() !== txHash.toLowerCase()
          )
            throw new Error('waitForReceipt: wrong receipt hash');
          if (confirmations <= 1) return fixed;
          if ((await wait(this.height())) - fixed.blockNumber + 1 >= confirmations) return fixed;
        }
        await wait(sleep(pollIntervalMs, deadline?.signal));
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    }
  }
  /** Chain id the node is on. */
  async chainId(): Promise<bigint> {
    return BigInt(await this.call('eth_chainId'));
  }
  /**
   * Fetches nonce, fees, gas limit and chain id in one parallel round and returns
   * the fields `Transaction.prepare` expects.
   * `expectedChainId` guards against signing for the wrong network (a stale RPC
   * URL, a UI network switch): prepare throws when the node reports another chain.
   */
  async prepare(args: {
    from: string;
    to: string;
    value?: bigint;
    data?: string;
    expectedChainId?: bigint;
  }): Promise<PreparedTx> {
    if (typeof args.from !== 'string') throw new Error('prepare: wrong from');
    if (typeof args.to !== 'string') throw new Error('prepare: wrong to');
    if (args.expectedChainId !== undefined && typeof args.expectedChainId !== 'bigint')
      throw new Error('prepare: wrong expectedChainId');
    const callArgs: Web3CallArgs = { from: args.from, to: args.to };
    if (args.value !== undefined) callArgs.value = ethNum(args.value);
    if (args.data !== undefined) callArgs.data = args.data;
    const [nonce, fees, gasLimit, chainId] = await Promise.all([
      this.nonce(args.from),
      this.fees(),
      this.estimateGas(callArgs),
      this.call('eth_chainId'),
    ]);
    if (args.expectedChainId !== undefined && BigInt(chainId) !== args.expectedChainId)
      throw new Error(
        `prepare: node reports chain id ${BigInt(chainId)}, expected ${args.expectedChainId}`
      );
    const common = {
      nonce,
      gasLimit,
      chainId: BigInt(chainId),
      to: args.to,
      value: args.value === undefined ? _0n : args.value,
      data: args.data === undefined ? '0x' : args.data,
    };
    if (fees.type === 'legacy') return { ...common, type: 'legacy', gasPrice: fees.gasPrice };
    return {
      ...common,
      type: 'eip1559',
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
  }
  /** Clears the cached probe; in-flight callers keep their result and the next call re-probes. */
  clearCapabilities(): void {
    this.capabilitiesPromise = undefined;
  }
  /**
   * Probes which RPC namespaces the node supports. Probe result is memoized per
   * provider instance.
   */
  async capabilities(): Promise<NodeCapabilities> {
    if (this.capabilitiesPromise) return this.capabilitiesPromise;
    this.capabilitiesPromise = (async () => {
      const probe = async (p: () => Promise<any>) => {
        try {
          await p();
          return true;
        } catch (e) {
          if (isMethodNotFound(e)) return false;
          throw e;
        }
      };
      const [eth, trace, ots] = await Promise.all([
        probe(() => this.call('eth_blockNumber')),
        probe(() =>
          this.call('trace_filter', {
            fromBlock: '0x0',
            toBlock: '0x0',
            fromAddress: [ADDRESS_ZERO],
            toAddress: [ADDRESS_ZERO],
          })
        ),
        probe(() => this.call('ots_getApiLevel')),
      ]);
      return { eth, trace, ots };
    })();
    return this.capabilitiesPromise;
  }
  /** Typed contract bound to this provider; sugar for abi's createContract. */
  contract<T extends ArrLike<FnArg>>(
    abi: T,
    address?: string
  ): TRet<ContractType<Writable<T>, IWeb3Provider>> {
    return createContract(abi, this, address);
  }

  async ots_searchBefore(address: string, block: number, pageSize = 25): Promise<OtsSearch> {
    if (typeof address !== 'string') throw new Error('ots_searchBefore: wrong address');
    if (!Number.isSafeInteger(block) || block < 0) throw new Error('ots_searchBefore: wrong block');
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0)
      throw new Error('ots_searchBefore: wrong pageSize');
    try {
      return fixOtsSearch(
        await this.call('ots_searchTransactionsBefore', address, block, pageSize)
      );
    } catch (e) {
      throw requireMethod(e, 'ots_searchTransactionsBefore', OTS_REQUIREMENT);
    }
  }
  async ots_searchAfter(address: string, block: number, pageSize = 25): Promise<OtsSearch> {
    if (typeof address !== 'string') throw new Error('ots_searchAfter: wrong address');
    if (!Number.isSafeInteger(block) || block < 0) throw new Error('ots_searchAfter: wrong block');
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0)
      throw new Error('ots_searchAfter: wrong pageSize');
    try {
      return fixOtsSearch(await this.call('ots_searchTransactionsAfter', address, block, pageSize));
    } catch (e) {
      throw requireMethod(e, 'ots_searchTransactionsAfter', OTS_REQUIREMENT);
    }
  }
  async ots_traceTransaction(txHash: string): Promise<ActionOts[]> {
    if (typeof txHash !== 'string') throw new Error('ots_traceTransaction: wrong txHash');
    try {
      const actions = await this.call('ots_traceTransaction', txHash);
      return actions.map((action: ActionOts) => fixOtsAction(action));
    } catch (e) {
      throw requireMethod(e, 'ots_traceTransaction', OTS_REQUIREMENT);
    }
  }

  /**
   * eth_getLogs, optionally scoped to contract address(es). With `limitLogs`
   * the range fans out as disjoint `limitLogs`-block batches with capped
   * concurrency (default 8); results are deduplicated across batches.
   */
  async ethLogs(topics: Topics, opts: EthLogsOpts = {}): Promise<Log[]> {
    validateLogOpts(opts);
    const fromBlock = opts.fromBlock || 0;
    if (!('limitLogs' in opts)) return ethLogsSingle(this, topics, opts);
    const chunks = blockRangeChunks(fromBlock, opts.toBlock, opts.limitLogs, 'ethLogs');
    const batches: Log[][] = new Array(chunks);
    let next = 0;
    let stopped = false;
    const worker = async () => {
      try {
        for (;;) {
          if (stopped) return;
          const index = next++;
          if (index >= chunks) return;
          const batchFrom = fromBlock + index * opts.limitLogs;
          batches[index] = await ethLogsSingle(this, topics, {
            address: opts.address,
            fromBlock: batchFrom,
            // limitLogs blocks per batch, inclusive: batches partition the range
            toBlock: Math.min(batchFrom + opts.limitLogs - 1, opts.toBlock),
          });
        }
      } catch (error) {
        stopped = true;
        throw error;
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(opts.concurrency ?? ETH_LOGS_CONCURRENCY, chunks) },
        () => worker()
      )
    );
    const out = [];
    const seen = new Set<string>();
    for (const i of batches) {
      for (const log of i) {
        const key = `${log.blockHash}:${log.logIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(log);
      }
    }
    return out;
  }

  /**
   * Normalized transaction + receipt. By default the raw tx is rebuilt from
   * the response and its sender/hash re-verified against the node's claims;
   * `verify: false` skips the throw for txs that cannot be rebuilt (e.g.
   * chain-specific types such as op-stack deposits) and leaves `raw`
   * undefined. Pending txs return `receipt: undefined`.
   */
  async txInfo(txHash: string, opts: { verify?: boolean } = {}): Promise<TxInfoFull> {
    if (typeof txHash !== 'string' || !txHashRe.test(txHash))
      throw new Error('txInfo: wrong txHash');
    if (opts.verify !== undefined && typeof opts.verify !== 'boolean')
      throw new Error('txInfo: wrong verify');
    const [info, receipt] = await Promise.all([
      this.call('eth_getTransactionByHash', txHash),
      this.call('eth_getTransactionReceipt', txHash),
    ]);
    if (info === null || info === undefined) throw new Error('txInfo: not found');
    return txInfoRaw(
      fixTxInfo(info),
      receipt === null || receipt === undefined ? undefined : fixTxReceipt(receipt),
      opts.verify ?? true
    );
  }
}
