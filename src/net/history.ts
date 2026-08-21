import { ERC1155, ERC20, WETH, TOKENS, events } from '../abi/index.ts';
import { addChecksum } from '../core/address.ts';
import {
  enrichCore,
  historyRow,
  txDiff,
  validateEnrichOpts,
  type EnrichCache,
  type EnrichedTx,
  type HistoryTx,
  type Transfer,
} from './enrich.ts';
import {
  TX_TRACE_REQUIREMENT,
  mapPool,
  requireMethod,
  throwIfAborted,
  withRetry,
  type ActionOts,
  type EthLogsOpts,
  type TxInfo,
  type RpcClient,
} from '../net.ts';
import {
  decodeReceiptAllTokenTransfers,
  type TokenError,
  type TokenInfo as TokenInfoResult,
  type TokenRegistry,
} from './tokens.ts';

const _0n = /* @__PURE__ */ BigInt(0);
const ERC_TRANSFER = /* @__PURE__ */ (() => events(ERC20).Transfer)();
const WETH_DEPOSIT = /* @__PURE__ */ (() => events(WETH).Deposit)();
const WETH_WITHDRAW = /* @__PURE__ */ (() => events(WETH).Withdrawal)();
const ERC1155_SINGLE = /* @__PURE__ */ (() => events(ERC1155).TransferSingle)();
const ERC1155_BATCH = /* @__PURE__ */ (() => events(ERC1155).TransferBatch)();

export type Balances = {
  balances: Record<string, bigint>;
  tokenBalances: Record<string, Record<string, Map<bigint, bigint>>>;
};

type TokenTransferLike = {
  contract: string;
  from: string;
  to: string;
  tokens: Map<bigint, bigint>;
};
type TransfersLike = { transfers: Transfer[]; tokenTransfers: TokenTransferLike[] };

/** Progress reported during discovery; percent is measured independently within each phase. */
export type ScanProgress = {
  /** Active discovery source. */
  source: 'ots' | 'logs' | 'ots+logs';
  /** Which discovery pass produced this event; percent restarts between passes. */
  phase: 'ots' | 'logs';
  /** Percent completed within the current phase. */
  percent: number;
  /** Cumulative number of rows discovered by the whole scan. */
  scannedTxs: number;
  /** OTS cursor, or the lower bound of the completed logs window. */
  currentBlock: number;
};
export type HistoryOpts = {
  /** One OTS/logs page (default), or the complete requested block range. */
  depth?: 'page' | 'full';
  /**
   * Yield direction. `newest` (default) pages backward from the chain head;
   * `oldest` walks forward from the address's first activity — the natural
   * direction for resumable/incremental sync (persist the last `block`, pass
   * it back as `after`).
   */
  order?: 'newest' | 'oldest';
  /** OTS cursor (order `newest`): search strictly before this block; zero means the latest page. */
  before?: number;
  /** OTS cursor (order `oldest`): search strictly after this block; zero means the oldest page. */
  after?: number;
  pageSize?: number;
  /**
   * Discovery backend. `auto` uses `ots+logs` on OTS-capable nodes and `logs`
   * otherwise. Explicit `ots` misses incoming token transfers that do not
   * call-touch the address; explicit `logs` misses plain/internal-ETH-only txs.
   */
  source?: 'auto' | 'ots' | 'logs' | 'ots+logs';
  internal?: boolean;
  tokens?: TokenRegistry;
  fromBlock?: number;
  toBlock?: number;
  /** Blocks per full-depth logs window; zero disables windowing. Default 2,000,000. */
  logsWindow?: number;
  /** Full-depth logs-window prefetch depth. Default 4. */
  concurrency?: number;
  onProgress?: (progress: ScanProgress) => void;
  signal?: AbortSignal;
  /**
   * Probe unknown transfer-shaped contracts with tokenInfo() so their decoded
   * movements carry symbol/decimals (one shared cache per scan); without it
   * they decode from log shape alone, metadata undefined. Rows become EnrichedTx.
   */
  discover?: boolean;
  /** Fired once per contract discovered by this scan; persist as a registry. */
  onToken?: (token: TokenInfoResult | TokenError) => void;
  /** Calldata/ERC-7730 enrichment tier for each row; see EnrichOpts.clearSig. */
  clearSig?: false | 'offline' | 'resolve';
  /** Shared discovery/clear-signing cache; pass one per session to dedupe probes across scans. */
  cache?: EnrichCache;
};

function validateHistoryOpts(opts: HistoryOpts) {
  if (opts.depth !== undefined && opts.depth !== 'page' && opts.depth !== 'full')
    throw new Error('history: wrong depth');
  if (opts.order !== undefined && opts.order !== 'newest' && opts.order !== 'oldest')
    throw new Error('history: wrong order');
  if (
    opts.source !== undefined &&
    opts.source !== 'auto' &&
    opts.source !== 'ots' &&
    opts.source !== 'logs' &&
    opts.source !== 'ots+logs'
  )
    throw new Error('history: wrong source');
  if (opts.before !== undefined && (opts.order ?? 'newest') === 'oldest')
    throw new Error('history: before requires order newest');
  if (opts.after !== undefined && (opts.order ?? 'newest') !== 'oldest')
    throw new Error('history: after requires order oldest');
  for (const i of ['before', 'after', 'fromBlock', 'toBlock', 'pageSize', 'logsWindow'] as const) {
    const val = opts[i];
    if (val === undefined) continue;
    if (!Number.isSafeInteger(val) || val < 0 || (i === 'pageSize' && val === 0))
      throw new Error(`history: wrong ${i}`);
  }
  if (
    opts.concurrency !== undefined &&
    (!Number.isSafeInteger(opts.concurrency) || opts.concurrency <= 0)
  )
    throw new Error('history: wrong concurrency');
  if (opts.onProgress !== undefined && typeof opts.onProgress !== 'function')
    throw new Error('history: wrong onProgress');
  if (opts.internal !== undefined && typeof opts.internal !== 'boolean')
    throw new Error('history: wrong internal');
  validateEnrichOpts(opts, 'history');
}

// `done` = no further pages exist in the traversal direction
type HistoryPage = { txs: HistoryTx[]; done: boolean };

/**
 * One OTS page of an address's history as wallet-grade rows, in traversal
 * order. OTS pages are natively newest-first; for order `oldest` the walk uses
 * ots_searchAfter and each page is reversed. OTS paging caveat: a block with
 * more than `pageSize` address transactions cannot be fully paged past.
 */
async function historyOtsPage(
  prov: Pick<RpcClient, 'ots_searchBefore' | 'ots_searchAfter'>,
  address: string,
  opts: Pick<HistoryOpts, 'order' | 'before' | 'after' | 'pageSize' | 'tokens' | 'signal'> = {}
): Promise<HistoryPage> {
  const oldest = (opts.order ?? 'newest') === 'oldest';
  const page = await withRetry(
    () =>
      oldest
        ? prov.ots_searchAfter(address, opts.after ?? 0, opts.pageSize ?? 25)
        : prov.ots_searchBefore(address, opts.before ?? 0, opts.pageSize ?? 25),
    opts.signal
  );
  const tokens = opts.tokens || (TOKENS as TokenRegistry);
  // Sender is intentionally not re-validated: OTS pages can contain tx types we cannot rebuild.
  const txs = page.txs.map(({ info, receipt }) => historyRow(address, info, receipt, tokens));
  if (oldest) txs.reverse();
  // OTS flags are relative to newest-first: firstPage touches the chain head,
  // lastPage touches the address's first activity.
  return { txs, done: oldest ? page.firstPage : page.lastPage };
}

async function internalForTx(
  prov: Pick<RpcClient, 'call' | 'ots_traceTransaction'>,
  address: string,
  txHash: string,
  useOts: boolean
): Promise<Transfer[]> {
  const addr = address.toLowerCase();
  if (useOts) {
    const actions: ActionOts[] = await withRetry(() => prov.ots_traceTransaction(txHash));
    return actions
      .filter((a) => {
        const value = a.value ?? _0n;
        return (
          a.depth > 0 &&
          value !== _0n &&
          (a.from.toLowerCase() === addr || a.to.toLowerCase() === addr)
        );
      })
      .map((a) => ({ from: a.from, to: a.to, value: a.value ?? _0n }));
  }
  let actions;
  try {
    actions = await withRetry(() => prov.call('trace_transaction', txHash));
  } catch (e) {
    throw requireMethod(e, 'trace_transaction', TX_TRACE_REQUIREMENT);
  }
  const out: Transfer[] = [];
  for (const a of actions) {
    if (!Array.isArray(a.traceAddress) || a.traceAddress.length === 0) continue;
    const from = a.action && a.action.from;
    const to = a.action && a.action.to;
    if (from?.toLowerCase() !== addr && to?.toLowerCase() !== addr) continue;
    const value = BigInt(a.action.value || 0);
    if (value === _0n) continue;
    out.push({ from, to, value });
  }
  return out;
}

function inBlockRange(tx: HistoryTx, opts: HistoryOpts): boolean {
  if (tx.block === undefined) return true;
  if (opts.fromBlock !== undefined && tx.block < opts.fromBlock) return false;
  if (opts.toBlock !== undefined && tx.block > opts.toBlock) return false;
  return true;
}

async function tokenTransferLogs(
  prov: Pick<RpcClient, 'ethLogs'>,
  address: string,
  opts: EthLogsOpts
) {
  return Promise.all([
    prov.ethLogs(ERC_TRANSFER.topics({ from: address, to: null, value: null }), opts),
    prov.ethLogs(ERC_TRANSFER.topics({ from: null, to: address, value: null }), opts),
  ]);
}

async function wethTransferLogs(
  prov: Pick<RpcClient, 'ethLogs'>,
  address: string,
  opts: EthLogsOpts
) {
  const deposit = WETH_DEPOSIT.topics({ dst: address, wad: null });
  const withdrawal = WETH_WITHDRAW.topics({ src: address, wad: null });
  return Promise.all([prov.ethLogs([[deposit[0], withdrawal[0]], deposit[1]], opts)]);
}

async function erc1155TransferLogs(
  prov: Pick<RpcClient, 'ethLogs'>,
  address: string,
  opts: EthLogsOpts
) {
  return Promise.all([
    prov.ethLogs(
      ERC1155_SINGLE.topics({ operator: null, from: address, to: null, id: null, value: null }),
      opts
    ),
    prov.ethLogs(
      ERC1155_SINGLE.topics({ operator: null, from: null, to: address, id: null, value: null }),
      opts
    ),
    prov.ethLogs(
      ERC1155_BATCH.topics({ operator: null, from: address, to: null, ids: null, values: null }),
      opts
    ),
    prov.ethLogs(
      ERC1155_BATCH.topics({ operator: null, from: null, to: address, ids: null, values: null }),
      opts
    ),
  ]);
}

function logsRange(opts: HistoryOpts): EthLogsOpts | undefined {
  const before = opts.before && opts.before > 0 ? opts.before - 1 : undefined;
  const after = opts.after !== undefined ? opts.after + 1 : undefined;
  const toBlock =
    before === undefined ? opts.toBlock : Math.min(before, opts.toBlock ?? Number.MAX_SAFE_INTEGER);
  const fromBlock = after === undefined ? opts.fromBlock : Math.max(after, opts.fromBlock ?? 0);
  if (fromBlock !== undefined && toBlock !== undefined && fromBlock > toBlock) return;
  return { fromBlock, toBlock };
}

// Logs complement for one OTS page: from the cursor bound to the page's far
// edge (its min block for newest, max for oldest); a done/empty page covers
// the whole remaining requested range instead.
function pageLogsRange(page: HistoryPage, opts: HistoryOpts): EthLogsOpts | undefined {
  const range = logsRange(opts);
  if (!range) return;
  const blocks = page.txs
    .map((tx) => tx.block ?? tx.info.blockNumber)
    .filter(
      (block): block is number =>
        typeof block === 'number' && Number.isSafeInteger(block) && block >= 0
    );
  const partialPage = page.txs.length > 0 && !page.done && blocks.length > 0;
  if ((opts.order ?? 'newest') === 'oldest') {
    const toBlock = !partialPage
      ? range.toBlock
      : Math.min(Math.max(...blocks), range.toBlock ?? Number.MAX_SAFE_INTEGER);
    if (range.fromBlock !== undefined && toBlock !== undefined && range.fromBlock > toBlock) return;
    return { fromBlock: range.fromBlock, toBlock };
  }
  const fromBlock = !partialPage
    ? range.fromBlock
    : Math.max(Math.min(...blocks), range.fromBlock ?? 0);
  if (fromBlock !== undefined && range.toBlock !== undefined && fromBlock > range.toBlock) return;
  return { fromBlock, toBlock: range.toBlock };
}

type TxInfoPromise = ReturnType<RpcClient['txInfo']>;

async function historyLogRows(
  prov: RpcClient,
  address: string,
  opts: HistoryOpts,
  logOpts: EthLogsOpts,
  seen: ReadonlySet<string> = new Set(),
  txCache: Map<string, TxInfoPromise> = new Map(),
  partial?: 'tokens-only'
) {
  throwIfAborted(opts.signal, 'history');
  const [erc20, weth, erc1155] = await withRetry(
    () =>
      Promise.all([
        tokenTransferLogs(prov, address, logOpts),
        wethTransferLogs(prov, address, logOpts),
        erc1155TransferLogs(prov, address, logOpts),
      ]),
    opts.signal
  );
  throwIfAborted(opts.signal, 'history');
  const hashes = new Map<string, string>();
  for (const logs of [...erc20, ...weth, ...erc1155]) {
    for (const log of logs) {
      const key = log.transactionHash.toLowerCase();
      if (!seen.has(key) && !hashes.has(key)) hashes.set(key, log.transactionHash);
    }
  }
  const tokens = opts.tokens || (TOKENS as TokenRegistry);
  const getTx = (hash: string) => {
    const key = hash.toLowerCase();
    let tx = txCache.get(key);
    if (!tx) {
      // Sender is intentionally not re-validated for history compatibility.
      // a discovery scan must tolerate txs the library cannot re-serialize
      tx = withRetry(() => prov.txInfo(hash, { verify: false }), opts.signal);
      txCache.set(key, tx);
    }
    return tx;
  };
  // busy addresses can match thousands of logs per window: cap in-flight tx
  // fetches instead of stampeding the node with one giant Promise.all
  const txs = await mapPool([...hashes.values()], getTx, {
    concurrency: 32,
    signal: opts.signal,
    name: 'history',
  });
  throwIfAborted(opts.signal, 'history');
  const direction = (opts.order ?? 'newest') === 'oldest' ? -1 : 1;
  txs.sort((a, b) => direction * newestFirstInfo(a.info, b.info));
  return txs.map(({ info, receipt }) => historyRow(address, info, receipt, tokens, partial));
}

async function historyLogs(prov: RpcClient, address: string, opts: HistoryOpts) {
  const logOpts = logsRange(opts);
  if (!logOpts) return [];
  const rows = await historyLogRows(
    prov,
    address,
    opts,
    logOpts,
    undefined,
    undefined,
    'tokens-only'
  );
  return (opts.depth ?? 'page') === 'page' ? rows.slice(0, opts.pageSize ?? 25) : rows;
}

type LogsWindow = { fromBlock: number; toBlock?: number; opts: EthLogsOpts };
type LogsWindowPlan = { total: number; at: (index: number) => LogsWindow };

async function fullLogsWindowPlan(prov: Pick<RpcClient, 'height'>, opts: HistoryOpts) {
  const range = logsRange(opts);
  if (!range) return;
  // `range` already folds the exclusive after cursor into the effective lower bound.
  const bottom = range.fromBlock ?? 0;
  const size = opts.logsWindow ?? 2_000_000;
  if (size === 0) {
    return {
      total: 1,
      at: () => ({ fromBlock: bottom, toBlock: range.toBlock, opts: range }),
    } satisfies LogsWindowPlan;
  }
  const top = range.toBlock ?? (await prov.height());
  if (bottom > top) return;
  const total = Math.floor((top - bottom) / size) + 1;
  return {
    total,
    at: (index) => {
      const toBlock = top - index * size;
      const fromBlock = Math.max(toBlock - size + 1, bottom);
      return { fromBlock, toBlock, opts: { fromBlock, toBlock } };
    },
  } satisfies LogsWindowPlan;
}

type LogsWindowTask = {
  window: LogsWindow;
  rows: Promise<HistoryTx[]>;
  cancel: () => void;
};

async function* historyFullLogs(
  prov: RpcClient,
  address: string,
  opts: HistoryOpts,
  source: 'logs' | 'ots+logs',
  seen: Set<string>,
  scannedTxs: number,
  partial?: 'tokens-only'
): AsyncGenerator<HistoryTx, void> {
  const plan = await fullLogsWindowPlan(prov, opts);
  throwIfAborted(opts.signal, 'history');
  if (!plan) return;
  // windows are planned top-down; order 'oldest' consumes them bottom-up
  const windowAt = (index: number) =>
    plan.at((opts.order ?? 'newest') === 'oldest' ? plan.total - 1 - index : index);
  const concurrency = Math.min(opts.concurrency ?? 4, plan.total);
  const pool: LogsWindowTask[] = [];
  let nextWindow = 0;
  let stopped = false;

  const start = (window: LogsWindow, deferred = false): LogsWindowTask => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settle: ((rows: HistoryTx[]) => void) | undefined;
    // tx cache is per-window: windows partition block ranges, so a hash never
    // repeats across them, and a scan-wide cache of receipt-bearing promises
    // grows without bound on busy addresses (full receipts of airdrop-scale
    // txs run to hundreds of KB each)
    const fetchRows = () =>
      historyLogRows(prov, address, opts, window.opts, seen, new Map(), partial);
    const rows = deferred
      ? new Promise<HistoryTx[]>((resolve, reject) => {
          settle = resolve;
          timer = setTimeout(() => {
            timer = undefined;
            if (stopped) return resolve([]);
            fetchRows().then(resolve, reject);
          }, 0);
        })
      : fetchRows();
    // A later window may reject while the ordered head is still pending.
    // Mark it handled now; awaiting `rows` below still observes the rejection.
    void rows.catch(() => {});
    return {
      window,
      rows,
      cancel: () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
          settle?.([]);
        }
        void rows.catch(() => {});
      },
    };
  };
  const enqueue = (deferred = false) => {
    throwIfAborted(opts.signal, 'history');
    pool.push(start(windowAt(nextWindow++), deferred));
  };

  try {
    while (pool.length < concurrency) enqueue();
    let completedWindows = 0;
    while (pool.length) {
      throwIfAborted(opts.signal, 'history');
      const head = pool.shift()!;
      const rows = await head.rows;
      throwIfAborted(opts.signal, 'history');
      if (nextWindow < plan.total) enqueue(true);
      const freshRows = rows.filter((row) => {
        const key = row.hash.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      completedWindows++;
      scannedTxs += freshRows.length;
      opts.onProgress?.({
        source,
        phase: 'logs',
        percent: Math.round((completedWindows / plan.total) * 100),
        scannedTxs,
        currentBlock: head.window.fromBlock,
      });
      for (const row of freshRows) {
        throwIfAborted(opts.signal, 'history');
        yield row;
      }
    }
  } finally {
    stopped = true;
    for (const task of pool) task.cancel();
  }
}

function newestFirstInfo(a: TxInfo, b: TxInfo): number {
  // Pending rows have no block and precede every mined row in newest-first order.
  const aBlock = a.blockNumber ?? Infinity;
  const bBlock = b.blockNumber ?? Infinity;
  if (aBlock !== bBlock) return aBlock < bBlock ? 1 : -1;
  const aIndex = a.transactionIndex ?? -1;
  const bIndex = b.transactionIndex ?? -1;
  if (aIndex !== bIndex) return aIndex < bIndex ? 1 : -1;
  return 0;
}

/** Internal comparator for callers/tests that collect both history passes before sorting. */
export function newestFirst(a: HistoryTx, b: HistoryTx): number {
  const aBlock = a.block ?? Infinity;
  const bBlock = b.block ?? Infinity;
  if (aBlock !== bBlock) return aBlock < bBlock ? 1 : -1;
  return newestFirstInfo(a.info, b.info);
}

/** Mirror of newestFirst for order: 'oldest' consumers merging history passes. */
export function oldestFirst(a: HistoryTx, b: HistoryTx): number {
  return -newestFirst(a, b);
}

/**
 * Unified streaming address-history scanner. Source `auto` combines OTS and
 * token logs when OTS is available; otherwise it uses logs, whose rows are
 * partial because plain/internal-ETH-only txs are invisible. Explicit `ots`
 * retains its incoming-token blind spot.
 *
 * `order` sets the traversal direction: `newest` (default) pages backward from
 * the chain head with the `before` cursor; `oldest` walks forward from the
 * address's first activity with the `after` cursor — the natural direction for
 * resumable/incremental sync. OTS rows are yielded first in page order for the
 * chosen direction. Log-discovered rows follow, globally ordered within that
 * pass. Transactions found by both passes are yielded only by OTS. OTS paging
 * caveat: a block with more than `pageSize` address transactions cannot be
 * fully paged past.
 *
 * With `ots+logs` page depth, logs cover the requested range from the cursor
 * bound to the OTS page's far edge. A done or empty OTS page instead scans the
 * whole remaining range; an empty OTS page is capped to `pageSize` rows.
 *
 * An address array (multi-account wallets, favorites pages) merges several
 * addresses into one hash-deduplicated MultiHistoryTx stream in `order`,
 * k-way merged from per-address streams. Rows are re-derived for the whole
 * set as one wallet: `diff` sums every watched address (a transfer between
 * two owned accounts nets to just the fee) and `tokenTransfers` keeps
 * movements touching any of them; `addresses` lists the participants (never
 * empty — participation only via internal transfers falls back to the
 * discovering address), checksummed. All options apply to each underlying
 * stream with one shared discovery cache. Merged ordering is as good as the
 * streams': exact for single-pass sources (`ots`, `logs`), per-pass for
 * `ots+logs`. With `internal: true`, `internal` transfers are those of the
 * address whose stream discovered the row. Page depth yields up to
 * `addresses.length * pageSize` rows; slice as needed.
 *
 * @example Collect rows when buffering is useful; sort afterward (newestFirst
 * or oldestFirst) for one merged order across the OTS and logs passes.
 * ```ts
 * const rows = await Array.fromAsync(history(prov, address, opts));
 * // Then sort `rows` if one merged OTS + logs order is needed.
 * ```
 */
export function history(
  prov: RpcClient,
  address: string,
  opts?: HistoryOpts
): AsyncGenerator<HistoryTx, void>;
export function history(
  prov: RpcClient,
  address: string[],
  opts?: HistoryOpts
): AsyncGenerator<MultiHistoryTx, void>;
export function history(
  prov: RpcClient,
  address: string | string[],
  opts: HistoryOpts = {}
): AsyncGenerator<HistoryTx | MultiHistoryTx, void> {
  if (Array.isArray(address)) {
    if (address.length === 0 || address.some((a) => typeof a !== 'string'))
      throw new Error('history: wrong addresses');
    validateHistoryOpts(opts);
    // Keep the canonical RPC-facing form checksummed; lowercase only values used for comparisons.
    return historyMultiInner(prov, [...new Set(address.map((a) => addChecksum(a)))], opts);
  }
  if (typeof address !== 'string') throw new Error('history: wrong address');
  validateHistoryOpts(opts);
  return historyInner(prov, address, opts);
}

async function* historyInner(
  prov: RpcClient,
  address: string,
  opts: HistoryOpts
): AsyncGenerator<HistoryTx, void> {
  throwIfAborted(opts.signal, 'history');
  const capabilities =
    opts.source === 'auto' || opts.source === undefined || opts.internal
      ? await prov.capabilities()
      : undefined;
  const source =
    opts.source === 'ots' || opts.source === 'logs' || opts.source === 'ots+logs'
      ? opts.source
      : capabilities!.ots
        ? 'ots+logs'
        : 'logs';
  const internalCache = new Map<string, Promise<Transfer[]>>();
  const withInternal = async (tx: HistoryTx): Promise<HistoryTx> => {
    if (!opts.internal) return tx;
    const caps = capabilities || (await prov.capabilities());
    let internal = internalCache.get(tx.hash);
    if (!internal) {
      internal = internalForTx(prov, address, tx.hash, caps.ots);
      internalCache.set(tx.hash, internal);
    }
    throwIfAborted(opts.signal, 'history');
    const transfers = await internal;
    throwIfAborted(opts.signal, 'history');
    return { ...tx, internal: transfers };
  };
  // Enrichment (discovery / clear signing) shares one cache across the scan.
  const enrichmentCache: EnrichCache | undefined =
    opts.discover || opts.clearSig ? (opts.cache ?? new Map()) : undefined;
  const finish = async (tx: HistoryTx): Promise<HistoryTx> => {
    const row = await withInternal(tx);
    if (!enrichmentCache) return row;
    // history enrichment is opt-in per feature, unlike enrichTx's defaults
    const enrichOpts = {
      ...opts,
      discover: opts.discover ?? false,
      clearSig: opts.clearSig ?? false,
    };
    return enrichCore(prov, address, row.info, row.receipt, enrichOpts, enrichmentCache, row);
  };
  if (source === 'logs') {
    if ((opts.depth ?? 'page') === 'full') {
      for await (const row of historyFullLogs(
        prov,
        address,
        opts,
        source,
        new Set(),
        0,
        'tokens-only'
      )) {
        throwIfAborted(opts.signal, 'history');
        yield await finish(row);
      }
      return;
    }
    const rows = await historyLogs(prov, address, opts);
    throwIfAborted(opts.signal, 'history');
    let scannedTxs = 0;
    for (const row of rows) {
      throwIfAborted(opts.signal, 'history');
      scannedTxs++;
      if (opts.onProgress && row.block !== undefined)
        opts.onProgress({
          source,
          phase: 'logs',
          percent: Math.round((scannedTxs / Math.max(rows.length, 1)) * 100),
          scannedTxs,
          currentBlock: row.block,
        });
      yield await finish(row);
    }
    return;
  }

  if ((opts.depth ?? 'page') === 'page') {
    const page = await historyOtsPage(prov, address, opts);
    throwIfAborted(opts.signal, 'history');
    const seen = new Set(page.txs.map((row) => row.hash.toLowerCase()));
    for (const row of page.txs) {
      throwIfAborted(opts.signal, 'history');
      if (!inBlockRange(row, opts)) continue;
      yield await finish(row);
    }
    if (source === 'ots') return;
    const logOpts = pageLogsRange(page, opts);
    if (!logOpts) return;
    let rows = await historyLogRows(prov, address, opts, logOpts, seen);
    throwIfAborted(opts.signal, 'history');
    if (!page.txs.length) rows = rows.slice(0, opts.pageSize ?? 25);
    let scannedTxs = page.txs.length;
    const totalTxs = scannedTxs + rows.length;
    for (const row of rows) {
      throwIfAborted(opts.signal, 'history');
      scannedTxs++;
      if (opts.onProgress && row.block !== undefined)
        opts.onProgress({
          source,
          phase: 'logs',
          percent: Math.round((scannedTxs / Math.max(totalTxs, 1)) * 100),
          scannedTxs,
          currentBlock: row.block,
        });
      yield await finish(row);
    }
    return;
  }
  const pageSize = opts.pageSize ?? 25;
  const oldest = (opts.order ?? 'newest') === 'oldest';
  let cursor = (oldest ? opts.after : opts.before) ?? 0;
  let top = 0; // newest: anchor = first page's max block
  let bottom = 0; // oldest: anchor = first page's min block
  let scannedTxs = 0;
  let completedBlock: number | undefined;
  // progress baseline: the far end of the address's ACTIVE block span, so
  // percent tracks coverage of that span — measured against the whole chain
  // the percent barely moves. One extra indexed call, only when listening.
  let firstBlock = 0;
  let lastBlock = 0;
  if (opts.onProgress) {
    const probe = oldest
      ? await prov.ots_searchBefore(address, 0, 1)
      : await prov.ots_searchAfter(address, 0, 1);
    throwIfAborted(opts.signal, 'history');
    const blocks = probe.txs
      .map((t) => t.receipt?.blockNumber ?? t.info.blockNumber)
      // Pending transactions have no block and cannot anchor scan progress.
      .filter((b): b is number => typeof b === 'number' && b > 0);
    if (blocks.length) {
      if (oldest) lastBlock = Math.max(...blocks);
      else firstBlock = Math.min(...blocks);
    }
  }
  const seen = new Set<string>();
  for (;;) {
    throwIfAborted(opts.signal, 'history');
    const page = await historyOtsPage(prov, address, {
      ...opts,
      before: cursor,
      after: cursor,
      pageSize,
    });
    throwIfAborted(opts.signal, 'history');
    scannedTxs += page.txs.length;
    for (const row of page.txs) {
      throwIfAborted(opts.signal, 'history');
      const key = row.hash.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (!inBlockRange(row, opts)) continue;
      yield await finish(row);
    }
    const blocks = page.txs.map((t) => t.block).filter((i) => i !== undefined);
    if (!page.txs.length) {
      completedBlock = cursor;
      break;
    }
    if (page.done) {
      completedBlock = blocks.length
        ? oldest
          ? Math.max(...blocks)
          : Math.min(...blocks)
        : cursor;
      break;
    }
    if (!blocks.length) break;
    if (oldest) {
      if (!bottom) bottom = Math.min(...blocks);
      const next = Math.max(...blocks);
      if (cursor !== 0 && next <= cursor) break;
      cursor = next;
      if (opts.toBlock !== undefined && cursor > opts.toBlock) {
        completedBlock = cursor;
        break;
      }
      if (opts.onProgress)
        opts.onProgress({
          source,
          phase: 'ots',
          percent: Math.min(
            99,
            Math.round(((cursor - bottom) / Math.max(lastBlock - bottom, 1)) * 100)
          ),
          scannedTxs,
          currentBlock: cursor,
        });
    } else {
      if (!top) top = Math.max(...blocks);
      const next = Math.min(...blocks);
      if (cursor !== 0 && next >= cursor) break;
      cursor = next;
      if (opts.fromBlock !== undefined && cursor < opts.fromBlock) {
        completedBlock = cursor;
        break;
      }
      if (opts.onProgress)
        opts.onProgress({
          source,
          phase: 'ots',
          percent: Math.min(99, Math.round(((top - cursor) / Math.max(top - firstBlock, 1)) * 100)),
          scannedTxs,
          currentBlock: cursor,
        });
    }
  }
  // Reserve 100% for successful exhaustion; defensive non-advancing exits may be incomplete.
  if (opts.onProgress && completedBlock !== undefined)
    opts.onProgress({
      source,
      phase: 'ots',
      percent: 100,
      scannedTxs,
      currentBlock: completedBlock,
    });
  if (source === 'ots') return;
  for await (const row of historyFullLogs(prov, address, opts, source, seen, scannedTxs)) {
    throwIfAborted(opts.signal, 'history');
    yield await finish(row);
  }
}

/** Merged multi-account history row; the watched address set is one wallet. */
export type MultiHistoryTx = HistoryTx & {
  /** Checksummed watched addresses participating in this tx; never empty. */
  addresses: string[];
};

// Re-derives one row for the whole watched set, independent of which
// per-address stream discovered it: dedupe order cannot under-report.
function multiRow(
  row: HistoryTx,
  addresses: string[],
  opts: HistoryOpts,
  discoverer: string
): MultiHistoryTx {
  const { info, receipt } = row;
  const watched = new Set(addresses.map((address) => address.toLowerCase()));
  let diff = _0n;
  for (const address of watched) diff += txDiff(address, info, receipt);
  const all =
    (row as EnrichedTx).allTokenTransfers ??
    decodeReceiptAllTokenTransfers(receipt, opts.tokens || (TOKENS as TokenRegistry));
  const tokenTransfers = all.filter(
    (tt) =>
      (tt.from !== undefined && watched.has(tt.from.toLowerCase())) ||
      watched.has(tt.to.toLowerCase())
  );
  const participates = (address: string) => {
    const a = address.toLowerCase();
    return (
      info.from?.toLowerCase() === a ||
      info.to?.toLowerCase() === a ||
      tokenTransfers.some((tt) => tt.from?.toLowerCase() === a || tt.to.toLowerCase() === a) ||
      (row.internal || []).some((t) => t.from?.toLowerCase() === a || t.to?.toLowerCase() === a)
    );
  };
  const participants = addresses.filter(participates);
  // participation only through internal transfers is invisible here without
  // `internal`: fall back to the address whose stream discovered the row, so
  // callers can always attribute it
  return {
    ...row,
    diff,
    tokenTransfers,
    // Do not pass addChecksum directly: Array.map's index is not its allowEmpty flag.
    addresses: (participants.length ? participants : [discoverer]).map((address) =>
      addChecksum(address)
    ),
  };
}

// The multi-address (string[]) form of history(); semantics documented there.
async function* historyMultiInner(
  prov: RpcClient,
  addresses: string[],
  opts: HistoryOpts
): AsyncGenerator<MultiHistoryTx, void> {
  const cmp = (opts.order ?? 'newest') === 'oldest' ? oldestFirst : newestFirst;
  const cache: EnrichCache = opts.cache ?? new Map();
  const streams = addresses.map((address) => historyInner(prov, address, { ...opts, cache }));
  const heads: (HistoryTx | undefined)[] = new Array(streams.length).fill(undefined);
  // streams advance one at a time: keeps request bursts serialized and
  // replayable, and a k-way merge only ever needs one new head per yield
  const advance = async (index: number) => {
    const item = await streams[index].next();
    heads[index] = item.done ? undefined : item.value;
  };
  try {
    for (let i = 0; i < streams.length; i++) await advance(i);
    const seen = new Set<string>();
    for (;;) {
      throwIfAborted(opts.signal, 'history');
      let best = -1;
      for (let i = 0; i < heads.length; i++) {
        if (heads[i] === undefined) continue;
        if (best < 0 || cmp(heads[i]!, heads[best]!) < 0) best = i;
      }
      if (best < 0) return;
      const row = heads[best]!;
      const key = row.hash.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        // A future-page failure must not suppress the already selected merge head.
        yield multiRow(row, addresses, opts, addresses[best]);
      }
      await advance(best);
    }
  } finally {
    await Promise.allSettled(streams.map((stream) => stream.return(undefined)));
  }
}

/**
 * Calculates balances at specific point in time after each tx-like row.
 * Accepts any rows with ETH `transfers` and tokenTransfers; no network calls.
 */
export function calcTransfersDiff<T extends TransfersLike>(transfers: T[]): (T & Balances)[] {
  const balances: Record<string, bigint> = {};
  const tokenBalances: Record<string, Record<string, Map<bigint, bigint>>> = {};
  for (const t of transfers) {
    for (const it of t.transfers) {
      if (it.from) balances[it.from] = (balances[it.from] || _0n) - it.value;
      if (it.to) balances[it.to] = (balances[it.to] || _0n) + it.value;
    }
    for (const tt of t.tokenTransfers) {
      if (!tokenBalances[tt.contract]) tokenBalances[tt.contract] = {};
      const token = tokenBalances[tt.contract];
      for (const [tokenId, value] of tt.tokens) {
        if (token[tt.from] === undefined) token[tt.from] = new Map();
        if (token[tt.to] === undefined) token[tt.to] = new Map();
        const fromTokens = token[tt.from];
        const toTokens = token[tt.to];
        fromTokens.set(tokenId, (fromTokens.get(tokenId) || _0n) - value);
        toTokens.set(tokenId, (toTokens.get(tokenId) || _0n) + value);
      }
    }
    Object.assign(t, {
      balances: { ...balances },
      tokenBalances: Object.fromEntries(
        Object.entries(tokenBalances).map(([k, v]) => [
          k,
          Object.fromEntries(
            Object.entries(v).map(([addr, balances]) => [addr, new Map(balances)])
          ),
        ])
      ),
    });
  }
  return transfers as (T & Balances)[];
}

/** JSON-safe resume cursor for tokenScanner; persist it and pass back as `opts.state`. */
export type ScannerState = {
  /** Chain head at the first step: the baseline for the overall percent. */
  top?: number;
  /** The next step scans blocks [0, toBlock]. */
  toBlock?: number;
  done?: boolean;
};
export type ScannerProgress = {
  phase: 'prepare' | 'logs' | 'complete';
  /** Percent of the current step's block range, 0..total. */
  completed: number;
  total: number;
  /** Rows discovered by the current step so far. */
  scannedTxs: number;
  /** Token movements consumed by this scanner instance. */
  found: number;
  /** Seconds since the step started. */
  elapsed: number;
};
export type ScannerStepOpts = {
  /** Wall-clock budget for one step; the scan pauses at a window boundary once exceeded. Default 120s. */
  budgetMs?: number;
  onProgress?: (progress: ScannerProgress) => void;
  /** Aborting rejects the running step; the scanner stays resumable. */
  signal?: AbortSignal;
};

/**
 * Resumable full-history token scan over `history` in
 * time-budgeted steps, newest era first. Each step consumes whole logs
 * windows until the budget runs out, then pauses at the boundary of the last
 * fully consumed window; the next step resumes exactly below it, so nothing
 * is missed and nothing is scanned twice. Ordinary addresses finish inside
 * the first step and never see the pause.
 *
 * `state` is a JSON-safe cursor: persist `scanner.state` and pass it back via
 * `opts.state` to continue in a later session (rows must be re-merged by the
 * caller — dedupe by hash; a resumed multi-address scan may repeat rows, as
 * its interleaved windows share no resume boundary and retry the whole
 * remaining range).
 *
 * Rows are delivered through `step(onRow)`; the caller owns storage (slim
 * them for tables — full receipts of a busy address add up to gigabytes).
 */
export function tokenScanner(
  prov: RpcClient,
  address: string | string[],
  opts: HistoryOpts & { state?: ScannerState } = {}
): {
  readonly done: boolean;
  readonly percent: number;
  readonly state: ScannerState;
  step(
    onRow: (row: HistoryTx | MultiHistoryTx) => void,
    stepOpts?: ScannerStepOpts
  ): Promise<{ done: boolean; percent: number }>;
} {
  const { state: initial, ...historyOpts } = opts;
  const multi = Array.isArray(address);
  const state: ScannerState = { done: false, ...initial };
  const seen = new Set<string>(); // dedupes within this instance (multi retries ranges)
  let found = 0;
  const percent = () => {
    if (state.done) return 100;
    if (!state.top || state.toBlock === undefined) return 0;
    return Math.min(99, Math.round(((state.top - state.toBlock) / state.top) * 100));
  };
  return {
    get done() {
      return !!state.done;
    },
    get percent() {
      return percent();
    },
    get state() {
      return { ...state };
    },
    async step(onRow, stepOpts = {}) {
      const { budgetMs = 120_000, onProgress = () => {}, signal } = stepOpts;
      if (typeof onRow !== 'function') throw new Error('tokenScanner: wrong onRow');
      if (state.done) return { done: true, percent: 100 };
      if (state.top === undefined)
        state.top = state.toBlock = historyOpts.toBlock ?? (await prov.height());
      const started = Date.now();
      const progress: Omit<ScannerProgress, 'elapsed'> = {
        phase: 'prepare',
        completed: 0,
        total: 100,
        scannedTxs: 0,
        found,
      };
      const notify = () =>
        onProgress({ ...progress, elapsed: Math.round((Date.now() - started) / 1000) });
      notify();
      progress.phase = 'logs';
      notify();
      let stop = false;
      let paused = false;
      let consumed: number | undefined; // fromBlock of the last window whose rows were fully consumed
      let pending: number | undefined; // fromBlock of the window whose rows are streaming now
      // aborting on pause stops the prefetched windows' leftover requests,
      // so a paused scan doesn't keep loading the node between steps
      const aborter = new AbortController();
      const onAbort = () => aborter.abort();
      signal?.addEventListener('abort', onAbort);
      try {
        // window size × concurrency bounds peak memory: every in-flight
        // window buffers its full rows (receipts included) until consumed
        const stream = history(prov, address as any, {
          depth: 'full',
          source: 'logs',
          discover: true,
          logsWindow: 200_000,
          concurrency: 4,
          ...historyOpts,
          toBlock: state.toBlock,
          signal: aborter.signal,
          onProgress: (p) => {
            // a progress event fires when a window completes, before its rows
            // are yielded — so the previously pending window is now consumed
            consumed = pending;
            pending = p.currentBlock;
            if (Date.now() - started > budgetMs) stop = true;
            progress.completed = p.percent;
            progress.scannedTxs = p.scannedTxs;
            notify();
          },
        });
        for await (const row of stream) {
          if (stop) {
            // pause before the next window's rows; the resume range covers them
            paused = true;
            break;
          }
          const key = row.hash.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            found = progress.found += row.tokenTransfers.length;
            onRow(row);
          }
          notify();
        }
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
      if (!paused) state.done = true;
      else {
        aborter.abort();
        // paused with nothing consumed (one window outran the budget): keep
        // the same range, the next step retries it with a fresh budget.
        // Multi streams interleave their windows, so no shared resume
        // boundary exists: retry the whole remaining range (dedupe by hash
        // makes the overlap harmless, just slower).
        if (!multi && consumed !== undefined && consumed > 0) state.toBlock = consumed - 1;
      }
      progress.phase = 'complete';
      progress.completed = progress.total;
      notify();
      return { done: !!state.done, percent: percent() };
    },
  };
}
