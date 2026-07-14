import { CLEARSIG_REPO, TOKENS, addTokens, decodeData } from '../abi/index.ts';
import type { ClearSigResult, ClearSigTokens } from '../clearsig/index.ts';
import { clearSigCallbacks } from './clearsig.ts';
import { throwIfAborted, type RpcClient, type TxInfo, type TxReceipt } from '../net.ts';
import {
  decodeReceiptAllTokenTransfers,
  decodeReceiptTokenTransfers,
  detectTokenContracts,
  tokenInfo,
  tokenURI,
  type DecodedTokenTransfer,
  type TokenError,
  type TokenInfo as TokenInfoResult,
  type TokenRegistry,
} from './tokens.ts';

/*
The history row model and its enrichment: what a transaction *means* for an
address — decoded token movements (with on-the-fly contract discovery),
calldata/ERC-7730 clear-signing tiers, and the JSON codec for persisting rows.
history.ts streams rows; this module gives them their semantics. enrichTx() is
the public per-transaction primitive; the internal helpers (historyRow,
enrichCore) are shared with the history scanners.
*/

const _0n = /* @__PURE__ */ BigInt(0);

export type Transfer = { from: string; to?: string; value: bigint };

/** One address-history row: wallet-grade view of an address transaction. */
export type HistoryTx = {
  hash: string;
  /** Unix seconds; from OTS response extensions when available. */
  timestamp?: number;
  block?: number;
  reverted: boolean;
  /** Signed wei delta for the requested address: value in/out, minus fee on outgoing txs. */
  diff: bigint;
  /** Known-token movements involving the requested address, decoded offline. */
  tokenTransfers: DecodedTokenTransfer[];
  /** Raw normalized tx data, e.g. for detail views; no receipt on pending txs. */
  info: { info: TxInfo; receipt: TxReceipt | undefined };
  /** Present when `internal: true`; recovered with per-transaction tracing only. */
  internal?: Transfer[];
  /** Present on rows produced by the universal eth_getLogs fallback. */
  partial?: 'tokens-only';
};

export function validateEnrichOpts(
  opts: Pick<EnrichOpts, 'discover' | 'onToken' | 'clearSig' | 'address' | 'cache'>,
  name: string
) {
  if (opts.discover !== undefined && typeof opts.discover !== 'boolean')
    throw new Error(`${name}: wrong discover`);
  if (opts.onToken !== undefined && typeof opts.onToken !== 'function')
    throw new Error(`${name}: wrong onToken`);
  if (
    opts.clearSig !== undefined &&
    opts.clearSig !== false &&
    opts.clearSig !== 'offline' &&
    opts.clearSig !== 'resolve'
  )
    throw new Error(`${name}: wrong clearSig`);
  if (opts.address !== undefined && typeof opts.address !== 'string')
    throw new Error(`${name}: wrong address`);
  if (opts.cache !== undefined && !(opts.cache instanceof Map))
    throw new Error(`${name}: wrong cache`);
}

export function txDiff(address: string, info: TxInfo, receipt: TxReceipt | undefined): bigint {
  let diff = _0n;
  const a = address.toLowerCase();
  if (info.to && info.to.toLowerCase() === a) diff += info.value;
  if (info.from && info.from.toLowerCase() === a)
    diff -= info.value + (receipt ? receipt.gasUsed * receipt.effectiveGasPrice : _0n);
  return diff;
}

// `receipt` may be missing: OTS-indexed nodes can return rows without one
// (e.g. pending txs) and decoding must degrade instead of crashing the scan
export function historyRow(
  address: string,
  info: TxInfo,
  receipt: TxReceipt | undefined,
  tokens: TokenRegistry,
  partial?: 'tokens-only'
): HistoryTx {
  const row: HistoryTx = {
    hash: info.hash,
    timestamp: receipt?.timestamp ?? info.blockTimestamp,
    block: receipt?.blockNumber,
    reverted: receipt?.status === 0,
    diff: txDiff(address, info, receipt),
    tokenTransfers: decodeReceiptTokenTransfers(receipt, address, tokens),
    info: { info, receipt },
  };
  if (partial) row.partial = partial;
  return row;
}

/**
 * Shared discovery cache: lowercased contract -> pending/settled tokenInfo().
 * One per app session (or per scan); dedupes probes across rows and binds the
 * clear-signing resolvers to already-fetched metadata.
 */
export type EnrichCache = Map<string, Promise<TokenInfoResult | TokenError>>;

export type EnrichOpts = {
  /** Perspective: adds a meaningful `diff` and participation-filters `tokenTransfers`. */
  address?: string;
  /** Seed registry; never mutated. Default: built-in TOKENS. */
  tokens?: TokenRegistry;
  /** Probe unknown transfer-shaped contracts with tokenInfo(). Default true. */
  discover?: boolean;
  /** Fired once per newly discovered contract; persist results as a registry. */
  onToken?: (token: TokenInfoResult | TokenError) => void;
  /**
   * Calldata + ERC-7730 tier. `offline` fills `method`/`intent` using only
   * data already in hand (zero extra RPC); `resolve` also awaits the full
   * resolver-backed pass. Both attach a lazy `clearSig()`. Default `offline`.
   */
  clearSig?: false | 'offline' | 'resolve';
  cache?: EnrichCache;
  signal?: AbortSignal;
};

/** HistoryTx plus perspective-independent decoding and clear-signing tiers. */
export type EnrichedTx = HistoryTx & {
  /** Every decoded token movement in the receipt, including between third parties. */
  allTokenTransfers: DecodedTokenTransfer[];
  /** Calldata signature, `a / b ?` best-guess list, or bare selector. */
  method?: string;
  /**
   * ERC-7730 intent. Offline-bound (display-grade: discovered metadata is
   * unverified) unless produced by `clearSig: 'resolve'`.
   */
  intent?: string;
  /** Tier 2: lazy memoized clear signing; resolvers hit shared caches first. Dropped by rowCodec. */
  clearSig?: () => Promise<ClearSigResult | undefined>;
};

function cachedTokenInfo(
  prov: RpcClient,
  contract: string,
  cache: EnrichCache,
  onToken?: EnrichOpts['onToken']
): Promise<TokenInfoResult | TokenError> {
  const key = contract.toLowerCase();
  let info = cache.get(key);
  if (!info) {
    info = tokenInfo(prov, key).then(
      (value) => value,
      (error) => ({ contract: key, error: (error as Error).message })
    );
    if (onToken)
      info = info.then((value) => {
        onToken(value);
        return value;
      });
    cache.set(key, info);
  }
  return info;
}

// Registry with per-receipt discoveries merged in; the seed is never mutated.
// tokenInfo() failures fall back to the log-shape hint so decoding still works.
async function discoveredRegistry(
  prov: RpcClient,
  receipt: TxReceipt | undefined,
  seed: TokenRegistry,
  opts: EnrichOpts,
  cache: EnrichCache
): Promise<TokenRegistry> {
  const unknown = [...detectTokenContracts(receipt)].filter(([contract]) => !seed[contract]);
  if (!unknown.length) return seed;
  const infos = await Promise.all(
    unknown.map(([contract]) => cachedTokenInfo(prov, contract, cache, opts.onToken))
  );
  throwIfAborted(opts.signal, 'enrichTx');
  const merged: TokenRegistry = { ...seed };
  for (let i = 0; i < unknown.length; i++) {
    const [contract, hint] = unknown[i];
    const info = infos[i];
    // discovered metadata is attacker-controlled (on-chain symbols can be
    // phishing URLs); mark it so decoded transfers carry verified: false
    merged[contract] =
      'error' in info
        ? { abi: hint, verified: false }
        : {
            abi: info.abi,
            symbol: 'symbol' in info ? info.symbol : undefined,
            decimals: 'decimals' in info ? info.decimals : undefined,
            verified: false,
          };
  }
  return merged;
}

function registryClearSigTokens(registry: TokenRegistry, chainId: bigint): ClearSigTokens {
  const out: ClearSigTokens = {};
  for (const [contract, def] of Object.entries(registry)) {
    out[contract] = { abi: def.abi, chainId, symbol: def.symbol, decimals: def.decimals };
    if (def.verified !== undefined) out[contract].verified = def.verified;
  }
  return out;
}

// Standard resolvers, but consulting the enrichment caches first: token
// metadata from discovery, block timestamps from the row itself.
function cachedCallbacks(
  prov: RpcClient,
  row: EnrichedTx,
  cache: EnrichCache
): ReturnType<typeof clearSigCallbacks> {
  const base = clearSigCallbacks(prov);
  return {
    ...base,
    async resolveToken(req) {
      const info = await cachedTokenInfo(prov, req.address, cache);
      if ('error' in info || info.abi !== 'ERC20') return undefined;
      return { name: info.name, symbol: info.symbol, decimals: info.decimals };
    },
    async resolveNft(req) {
      const info = await cachedTokenInfo(prov, req.collection, cache);
      if ('error' in info || info.abi !== 'ERC721' || !info.name) return undefined;
      const uri = await tokenURI(prov, info, req.tokenId);
      return {
        name: `${info.name} #${req.tokenId}`,
        source: typeof uri === 'string' ? uri : undefined,
        verified: true,
      };
    },
    async resolveBlock(req) {
      const block = Number(req.block);
      if (row.block === block && row.timestamp !== undefined) return row.timestamp;
      return base.resolveBlock!(req);
    },
  };
}

export async function enrichCore(
  prov: RpcClient,
  address: string | undefined,
  info: TxInfo,
  receipt: TxReceipt | undefined,
  opts: EnrichOpts,
  cache: EnrichCache,
  base?: HistoryTx
): Promise<EnrichedTx> {
  throwIfAborted(opts.signal, 'enrichTx');
  const seed = opts.tokens || (TOKENS as TokenRegistry);
  const registry =
    (opts.discover ?? true) === false
      ? seed
      : await discoveredRegistry(prov, receipt, seed, opts, cache);
  const all = decodeReceiptAllTokenTransfers(receipt, registry);
  const a = address?.toLowerCase();
  const row: EnrichedTx = {
    ...base,
    hash: info.hash,
    timestamp: receipt?.timestamp ?? info.blockTimestamp,
    block: receipt?.blockNumber,
    reverted: receipt?.status === 0,
    diff: address ? txDiff(address, info, receipt) : _0n,
    tokenTransfers: a
      ? all.filter((tt) => tt.from?.toLowerCase() === a || tt.to.toLowerCase() === a)
      : all,
    allTokenTransfers: all,
    info: { info, receipt },
  };
  const tier = opts.clearSig ?? 'offline';
  if (tier === false || info.input === '0x' || !info.to) return row;
  const defs =
    info.chainId === undefined
      ? CLEARSIG_REPO
      : addTokens(CLEARSIG_REPO, registryClearSigTokens(registry, info.chainId), info.chainId);
  const decodeOpt = { from: info.from, clearSig: defs };
  let decoded: ReturnType<typeof decodeData>;
  try {
    decoded = decodeData(info.to, info.input, info.value, decodeOpt);
  } catch {
    decoded = undefined;
  }
  row.method = Array.isArray(decoded)
    ? [...new Set(decoded.map((item) => item.name))].join(' / ') + ' ?'
    : (decoded?.signature ?? info.input.slice(0, 10));
  if (!decoded || Array.isArray(decoded)) return row;
  // tier 1: the decode above ran without resolvers, so this settles offline
  const offline = await decoded.clearSig?.catch(() => undefined);
  if (offline) row.intent = offline.interpolatedIntent || offline.intent;
  let resolved: Promise<ClearSigResult | undefined> | undefined;
  row.clearSig = () =>
    (resolved ||= (async () => {
      let full: ReturnType<typeof decodeData>;
      try {
        full = decodeData(info.to!, info.input, info.value, {
          ...decodeOpt,
          ...cachedCallbacks(prov, row, cache),
        });
      } catch {
        return undefined;
      }
      if (!full || Array.isArray(full)) return undefined;
      return full.clearSig?.catch(() => undefined);
    })());
  if (tier === 'resolve') {
    const full = await row.clearSig();
    if (full) row.intent = full.interpolatedIntent || full.intent;
  }
  return row;
}

/**
 * One transaction as a wallet-grade row: token movements decoded with on-the-fly
 * contract discovery, plus calldata/ERC-7730 clear-signing tiers. The shared
 * primitive behind history(); use it directly for tx detail pages, block views,
 * or receipts already in hand. Accepts a tx hash or an `{ info, receipt }` pair
 * (e.g. an existing row's `info`). Without `opts.address`, `tokenTransfers`
 * equals `allTokenTransfers` and `diff` is zero. Pass one `cache` across calls
 * to dedupe discovery and speed up clear signing.
 */
export async function enrichTx(
  prov: RpcClient,
  tx: string | { info: TxInfo; receipt?: TxReceipt },
  opts: EnrichOpts = {}
): Promise<EnrichedTx> {
  validateEnrichOpts(opts, 'enrichTx');
  let info: TxInfo;
  let receipt: TxReceipt | undefined;
  if (typeof tx === 'string') {
    // enrichment must tolerate txs the library cannot re-serialize
    ({ info, receipt } = await prov.txInfo(tx, { verify: false }));
  } else if (tx !== null && typeof tx === 'object' && tx.info) {
    ({ info, receipt } = tx);
  } else throw new Error('enrichTx: wrong tx');
  return enrichCore(prov, opts.address, info, receipt, opts, opts.cache ?? new Map());
}

/**
 * JSON codec for history/enriched rows: bigint and Map round-trip losslessly,
 * function fields (like `clearSig`) are dropped. For persisting scan results
 * in caller-side caches (localStorage, disk).
 */
export const rowCodec = {
  encode(value: unknown): string {
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return { $bigint: item.toString() };
      if (item instanceof Map) return { $map: [...item] };
      return item;
    });
  },
  decode<T = unknown>(json: string): T {
    return JSON.parse(json, (_key, item) => {
      if (item !== null && typeof item === 'object') {
        if (typeof item.$bigint === 'string') return BigInt(item.$bigint);
        if (Array.isArray(item.$map)) return new Map(item.$map);
      }
      return item;
    }) as T;
  },
};
