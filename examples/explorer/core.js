import { jsonrpc } from 'micro-ftch';
import { addr, weieth } from '../../index.js';
import { formatUnits, weigwei } from '../../utils.js';
import { tokenFromSymbol } from '../../abi/index.js';
import { mapPool, RpcClient } from '../../net.js';
import { enrichTx, slimRow } from '../../net/enrich.js';
import { history, tokenScanner as createTokenScanner } from '../../net/history.js';
import { Quoter } from '../../net/quoter.js';
import { NameResolver } from '../../net/resolver.js';
import {
  erc20Amount,
  ipfsToHttp,
  tokenDiff,
  nftCandidates,
  nftHoldings,
  nftMetadata,
  tokenBalances,
  tokenInfos,
  tokenURI,
} from '../../net/tokens.js';

export { formatUnits, parseUnits } from '../../utils.js';
export { slimRow } from '../../net/enrich.js';
export { isResolvableName as isName } from '../../net/resolver.js';

// _build-dist.js can bake a different default endpoint into the .app.html builds
export const RPC_URL = globalThis.BUILD_RPC_URL || 'http://127.0.0.1';
// '192.168.1.1:8545' is a natural thing to type for a LAN node: a bare IPv4
// (optional port) gets http:// filled in; hostnames and URLs pass through
export const withScheme = (url) =>
  /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(url) ? `http://${url}` : url;
export const DEMO_ADDRESS = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
export const SYMBOLS = ['USDT', 'USDC', 'DAI', 'WBTC', 'WETH'];
const STABLECOINS = new Set(['USDT', 'USDC', 'DAI']);
const TOKENS = SYMBOLS.map((symbol) => ({ ...tokenFromSymbol(symbol), abi: 'ERC20' }));

const units = formatUnits; // cached per precision inside the library
const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
// whole dollars: cents are noise on large values and conversion rates
const usdWholeFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const usd = (n) =>
  Number.isFinite(n) ? (Math.abs(n) >= 100_000 ? usdWholeFormat : usdFormat).format(n) : 'n/a';
export const short = (s, n = 10) => (s.length > n * 2 + 3 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
// conversion rates show whole dollars: 1987.67 -> $1,987
const usdRate = (n) => (Number.isFinite(n) ? usdWholeFormat.format(Math.trunc(n)) : 'n/a');
// display at most 7 digits total: integer digits eat the fraction budget
// (339950.136048 -> ~339950.1, 0.000280047 -> ~0.00028), and large integers
// shorten to M/B/T (123157000 -> 123.157M, 261e12 -> 261T); '~' marks rounding
const approxUnits = (n, decimals) => {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  let dec = decimals; // suffixes scale the value by raising the virtual decimal count
  let suffix = '';
  const intLen = () => (abs / 10n ** BigInt(dec)).toString().length;
  if (intLen() >= 14) (suffix = 'T'), (dec += 12);
  else if (intLen() >= 11) (suffix = 'B'), (dec += 9);
  else if (intLen() >= 8) (suffix = 'M'), (dec += 6);
  const fracAllowed = Math.max(0, 7 - intLen());
  if (dec <= fracAllowed) return `${neg ? '-' : ''}${units(abs, dec)}${suffix}`;
  const scale = 10n ** BigInt(dec - fracAllowed);
  const rounded = ((abs + scale / 2n) / scale) * scale;
  return `${neg ? '-' : ''}${rounded === abs ? '' : '~'}${units(rounded, dec)}${suffix}`;
};
// dust below 1M wei reads better as wei than as ~0 ETH
const ethAmount = (v) => (v > 0n && v < 1_000_000n ? `${v} wei` : `${approxUnits(v, 18)} ETH`);
// usd with the same 7-digit budget as token amounts: 12571.60 -> $12,571.6
export const usdApprox = (n) => {
  if (!Number.isFinite(n)) return 'n/a';
  const cents = BigInt(Math.round(Math.abs(n) * 100));
  const s = approxUnits(n < 0 ? -cents : cents, 2);
  return s.replace(/^(-?~?)(\d+)/, (_, prefix, digits) => {
    return `${prefix}$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  });
};
// "7/11 09:39" in local time; years other than the current one get the year
// first, separated by \n — UIs render it as its own line (or fold to '/')
const THIS_YEAR = new Date().getFullYear();
const formatTime = (ts) => {
  const date = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return date.getFullYear() === THIS_YEAR ? time : `${date.getFullYear()}\n${time}`;
};
export const isAddress = (value) => addr.isValid(value);
export const checksumAddress = (value) => addr.addChecksum(value);
// Favorite addresses over any getItem/setItem string store (localStorage in
// the browser, a small file-backed shim in the CLI); kept checksummed, with
// the ENS name captured at favoriting time (never re-resolved afterwards).
export function createFavorites(storage, key = 'eth-explorer-favorites') {
  const read = () => {
    try {
      const list = JSON.parse(storage.getItem(key) || '[]');
      if (!Array.isArray(list)) return [];
      return list
        .map((entry) => (typeof entry === 'string' ? { address: entry } : entry))
        .filter((entry) => entry && typeof entry.address === 'string' && isAddress(entry.address));
    } catch {
      return [];
    }
  };
  return {
    /** [{ address, ens? }], addresses checksummed. */
    list: read,
    has: (address) =>
      read().some((entry) => entry.address.toLowerCase() === address.toLowerCase()),
    /** Returns true when the address was added, false when removed. */
    toggle(address, ens) {
      const checksummed = checksumAddress(address);
      const list = read();
      const lower = checksummed.toLowerCase();
      const kept = list.filter((entry) => entry.address.toLowerCase() !== lower);
      const added = kept.length === list.length;
      if (added) kept.push({ address: checksummed, ...(ens ? { ens } : {}) });
      storage.setItem(key, JSON.stringify(kept));
      return added;
    },
  };
}
const safe = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error })
  );

// hash-like ids (ENS labelhashes are uint256 hashes) are unreadable as
// 78-digit decimals: shorten them as hex
const idText = (id) => {
  const s = id.toString();
  if (s.length <= 12) return s;
  const hex = `0x${id.toString(16)}`;
  return `${hex.slice(0, 10)}…${hex.slice(-4)}`;
};

function tokenText(transfer, watched) {
  if (transfer.abi === 'ERC20') {
    // signed for the watched set (the token analogue of txDiff)
    const amount = erc20Amount(tokenDiff(transfer, [...watched])) || 0n;
    return `${amount >= 0n ? '+' : ''}${approxUnits(amount, transfer.decimals || 0)} ${transfer.symbol || 'TOKEN'}`;
  }
  const sign = watched.has(transfer.to.toLowerCase()) ? '+' : '-';
  const tokens = [...transfer.tokens].map(([id, value]) =>
    transfer.abi === 'ERC721' ? `#${idText(id)}` : `${value}× #${idText(id)}`
  );
  return `${sign}${transfer.symbol || transfer.abi} ${tokens.join(', ')}`;
}

// render loops call this once per row with the same address: memoize the set
let watchedOne = new Set();
let watchedFor;
export function rowSummary(row, address) {
  if (watchedFor !== address) {
    watchedFor = address;
    watchedOne = new Set([address.toLowerCase()]);
  }
  return summarize(row, watchedOne);
}

/** Summary for a merged multi-address row (history over an array): adds participants. */
export function multiRowSummary(row) {
  const summary = summarize(row, new Set(row.addresses.map((a) => a.toLowerCase())));
  return { ...summary, addresses: row.addresses };
}

// direction says whether a watched address initiated the tx; amounts stay
// signed per movement (a swap reads OUT with +tokens, same as before)
function summarize(row, watched) {
  const tx = row.info;
  const tokens = row.tokenTransfers.map((transfer) => tokenText(transfer, watched));
  const outgoing = watched.has(tx.from.toLowerCase());
  // zero-value txs without token movements are contract interactions, not transfers
  const contractCall = tx.value === 0n && tx.to && tx.input && tx.input !== '0x';
  const amounts = tokens.length
    ? tokens
    : [contractCall ? 'contract call' : `${outgoing ? '-' : '+'}${ethAmount(tx.value)}`];
  return {
    time: row.timestamp ? formatTime(row.timestamp) : 'pending',
    direction: outgoing ? 'OUT' : 'IN',
    /** One entry per token movement; render each on its own line where possible. */
    amounts,
    amount: amounts.join(', '),
    hash: row.hash,
  };
}

export function balanceText(balance) {
  if (balance.error) return `${balance.symbol.padEnd(5)} unavailable (${balance.error.message})`;
  // a pegged stablecoin's amount IS its dollar value: rate and total are noise
  if (balance.stable && Number.isFinite(balance.price) && Math.abs(balance.price - 1) <= 0.03)
    return `${balance.symbol.padEnd(5)} ${balance.amount}`;
  return `${balance.symbol.padEnd(5)} ${balance.amount} · ${usd(Number(balance.amount) * balance.price)} @ ${usdRate(balance.price)}`;
}

export function createExplorer(rpcUrl = RPC_URL) {
  const prov = new RpcClient(jsonrpc(globalThis.fetch.bind(globalThis), rpcUrl, { batchSize: 10 }));
  // ttlMs: Chainlink quotes are stable second-to-second — one recent result
  // is shared by load() and the favorites page instead of re-querying per view
  const quoter = new Quoter(prov, { ttlMs: 30_000 });
  const resolver = new NameResolver(prov);
  // one discovery/clear-signing cache for the whole session
  const cache = new Map();
  // Table rows keep only what the list renders: full rows retain complete
  // receipts (an airdrop-scale receipt runs to hundreds of KB), which OOMs the
  // session once a busy address accumulates 100k of them. The most recent
  // normal-sized payloads are remembered in a bounded LRU, so details() only
  // re-downloads a tx when it was huge or has since been evicted.
  const FULL_ROWS_MAX = 10_000;
  const fullRows = new Map(); // hash -> { info, receipt }, insertion-ordered
  const rememberFull = (row) => {
    const { info, receipt } = row;
    // pending rows go stale, outliers defeat the point of slimming
    if (!receipt || info.input.length > 10_000 || (receipt.logs?.length || 0) > 100) return;
    const key = row.hash.toLowerCase();
    fullRows.delete(key);
    fullRows.set(key, { info, receipt });
    if (fullRows.size > FULL_ROWS_MAX) fullRows.delete(fullRows.keys().next().value);
  };
  const slim = (row) => {
    rememberFull(row);
    return slimRow(row);
  };
  // Quick view: 'auto' (ots+logs) instead of plain ots — ots alone misses
  // incoming token transfers that never call-touch the address — and
  // `discover` fills symbol/decimals for tokens outside the curated registry.
  // An address array (favorites page) streams one merged multi-address
  // history; slimRow keeps its `addresses` attribution.
  const collect = async (address, opt = { source: 'auto', pageSize: 25, discover: true, cache }) => {
    const rows = [];
    for await (const row of history(prov, address, opt)) rows.push(slim(row));
    // the ots and logs passes yield separately: merge into one newest-first list
    return rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  };
  const favoritesHistory = (addresses) => collect(addresses);

  const prices = () =>
    Promise.all([
      safe(quoter.coinPrice('ETH')),
      ...SYMBOLS.map((symbol) => safe(quoter.tokenPrice(symbol))),
    ]);

  // Balances for a set of addresses treated as one wallet: per-token sums
  // (favorites page passes every favorite, load() passes one address).
  async function combinedBalances(addresses) {
    // one Multicall3 round for the set's ETH balances; token balances batch
    // through the same contract inside tokenBalances (per address)
    const [eth, tokenResults, quotes] = await Promise.all([
      safe(prov.ethBalances(addresses)),
      Promise.all(addresses.map((address) => safe(tokenBalances(prov, address, TOKENS)))),
      prices(),
    ]);
    const balances = [];
    if (eth.error) balances.push({ symbol: 'ETH', error: eth.error });
    else
      balances.push({
        symbol: 'ETH',
        amount: weieth.encode(Object.values(eth.value).reduce((sum, value) => sum + value, 0n)),
        price: quotes[0].value,
      });
    for (let i = 0; i < TOKENS.length; i++) {
      const token = TOKENS[i];
      let raw = 0n;
      let error;
      for (const result of tokenResults) {
        const amount = erc20Amount(result.value?.[token.contract]);
        if (amount !== undefined) raw += amount;
        else error = result.error || new Error('unavailable');
      }
      if (!error && raw === 0n) continue;
      balances.push({
        symbol: token.symbol,
        amount: error ? undefined : units(raw, token.decimals),
        price: quotes[i + 1].value,
        stable: STABLECOINS.has(token.symbol),
        error,
      });
    }
    // wallet total, shown only when tokens besides ETH are present
    const totalUsd =
      balances.length > 1
        ? balances.reduce(
            (sum, b) => sum + (b.error ? 0 : Number(b.amount) * b.price || 0),
            0
          )
        : undefined;
    return { balances, totalUsd };
  }

  async function load(value) {
    const address = checksumAddress(value);
    const [recent, combined, ensName] = await Promise.all([
      safe(collect(address)),
      combinedBalances([address]),
      safe(resolver.addressToName(address)),
    ]);
    return {
      address,
      ens: ensName.value || undefined,
      balances: combined.balances,
      totalUsd: combined.totalUsd,
      rows: recent.value || [],
      historyError: recent.error,
    };
  }

  // A deep scan of a huge address can run for the better part of an hour, so
  // the scanner works in time-budgeted steps, newest era first: each step
  // consumes whole logs windows until the budget runs out, then pauses at the
  // boundary of the last fully consumed window. The UI shows what it has and
  // asks before digging deeper; the next step resumes exactly below that
  // boundary, so nothing is missed and nothing is scanned twice. Ordinary
  // addresses finish inside the first step and never see the pause.
  function tokenScanner(address, initialRows = []) {
    // The stepped/resumable scan itself is a library primitive now
    // (net/history.js tokenScanner: budgeted steps, pause at a window
    // boundary, serializable cursor); this wrapper only merges its rows with
    // the quick view and slims them for the tables. logsWindow × concurrency
    // bounds peak memory: every in-flight window buffers its full rows
    // (receipts included) until consumed.
    const scanner = createTokenScanner(prov, address, { logsWindow: 200_000, concurrency: 4 });
    const merged = new Map(initialRows.map((row) => [row.hash.toLowerCase(), row]));
    const sorted = () =>
      [...merged.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return {
      get done() {
        return scanner.done;
      },
      /** Overall share of the chain scanned so far, 0..100. */
      get percent() {
        return scanner.percent;
      },
      async step(onProgress = () => {}, budgetMs = 120_000) {
        const result = await scanner.step(
          (row) => merged.set(row.hash.toLowerCase(), slim(row)),
          { onProgress, budgetMs }
        );
        return { rows: sorted(), done: result.done, percent: result.percent };
      },
    };
  }

  // Confirmed txs are immutable: re-opening one renders from cache. Pending
  // txs and failed loads are not pinned, so they refresh on the next open.
  const detailsCache = new Map();
  function details(row) {
    const key = row.hash.toLowerCase();
    if (!detailsCache.has(key)) {
      const promise = loadDetails(row);
      detailsCache.set(key, promise);
      promise.then(
        (result) => result.pending && detailsCache.delete(key),
        () => detailsCache.delete(key)
      );
    }
    return detailsCache.get(key);
  }

  async function loadDetails(row) {
    // rows are slimmed for the table; reuse the payload downloaded by the
    // history/scan stream when it is still remembered, else re-read the tx
    const full =
      fullRows.get(row.hash.toLowerCase()) || (await prov.txInfo(row.hash, { verify: false }));
    const { info, receipt } = full;
    const enriched = await enrichTx(prov, full, { clearSig: 'resolve', cache }).catch(
      () => undefined
    );
    const intent =
      enriched?.intent || (info.input === '0x' ? 'Transfer ETH' : 'Contract call');
    const method = enriched?.method || (info.input !== '0x' ? info.input.slice(0, 10) : '—');
    const status = !receipt
      ? 'pending'
      : receipt.status === 0
        ? 'reverted'
        : `confirmed · block ${receipt.blockNumber}`;
    const gasPrice = receipt?.effectiveGasPrice || info.gasPrice;
    return {
      pending: !receipt,
      normal: [
        ['time', row.timestamp ? formatTime(row.timestamp) : 'pending'],
        ['from', info.from],
        ['to', info.to || '(contract creation)'],
        ['amount eth', ethAmount(info.value)],
        ['intent', intent],
        ['method', method],
      ],
      muted: [
        ['status', status],
        ['fee', receipt ? ethAmount(receipt.gasUsed * receipt.effectiveGasPrice) : '—'],
        ['gas price', gasPrice != null ? `${weigwei.encode(gasPrice)} gwei` : '—'],
        ['gas spent', receipt ? `${receipt.gasUsed} out of ${info.gas}` : '—'],
        ['nonce', String(info.nonce)],
        ['txid', row.hash],
        ['calldata', info.input],
      ],
    };
  }

  // Current NFT inventory as a pager. History is only discovery: ownership is
  // verified on-chain once (nftHoldings), which is cheap; tokenURI/metadata
  // JSON live on slow external hosts, so names and images resolve lazily,
  // one page at a time via next(count). IPFS URIs go through a public gateway.
  async function nfts(address, rows) {
    const candidates = nftCandidates(rows);
    const byContract = new Map(candidates.map((entry) => [entry.contract, entry]));
    const holdings = await nftHoldings(prov, address, candidates, { concurrency: 8 });
    const held = Object.entries(holdings).filter(([, tokens]) => tokens instanceof Map);
    const infos = await tokenInfos(
      prov,
      held.map(([contract]) => contract)
    );
    const pairs = [];
    for (const [contract, tokens] of held)
      for (const [id, amount] of tokens) pairs.push({ contract, id, amount });
    const resolve = async ({ contract, id, amount }) => {
      const candidate = byContract.get(contract);
      const info = infos[contract];
      const named = info && !('error' in info) ? info : undefined;
      const item = {
        contract,
        abi: candidate?.abi,
        id,
        amount,
        symbol: candidate?.symbol || named?.symbol,
        name: named?.name,
      };
      try {
        const uri = await tokenURI(prov, named || contract, id); // {id} already substituted
        if (typeof uri === 'string') {
          const abort = AbortSignal.timeout(5000);
          const metadata = nftMetadata(await (await fetch(ipfsToHttp(uri), { signal: abort })).json());
          if (metadata.name) item.name = metadata.name;
          if (metadata.image) item.image = ipfsToHttp(metadata.image);
        }
      } catch {}
      return item;
    };
    let at = 0;
    return {
      total: pairs.length,
      get remaining() {
        return pairs.length - at;
      },
      async next(count = 24) {
        const slice = pairs.slice(at, at + count);
        at += slice.length;
        return mapPool(slice, resolve, { concurrency: 6 });
      },
    };
  }

  // Forward resolution for search inputs: 'vitalik.eth' and 'alice.gwei' both
  // work — NameResolver routes by TLD. Returns undefined for unknown names.
  const resolveName = (name) => resolver.nameToAddress(name);

  return { load, tokenScanner, details, nfts, resolveName, favoritesHistory, combinedBalances };
}
