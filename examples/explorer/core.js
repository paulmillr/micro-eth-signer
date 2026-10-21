import { ftch, jsonrpc } from 'micro-ftch';
import { addr, weieth } from '../../index.js';
import { formatUnits, weigwei } from '../../utils.js';
import { decodeEvent, tokenFromSymbol, TOKENS as REGISTRY } from '../../abi/index.js';
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
  tokenInfo,
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
const STABLECOINS = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'SUSD', 'USDK']);
const TOKENS = SYMBOLS.map((symbol) => ({ ...tokenFromSymbol(symbol), abi: 'ERC20' }));
// the opt-in wide check: every token of the built-in registry, curated first
const ALL_TOKENS = [
  ...TOKENS,
  ...Object.entries(REGISTRY)
    .map(([contract, token]) => ({ ...token, contract }))
    .filter((token) => token.abi === 'ERC20' && !SYMBOLS.includes(token.symbol)),
];
export const KNOWN_TOKEN_COUNT = ALL_TOKENS.length;

// Every request the examples make goes through micro-ftch. The RPC wrapper is
// pinned to the endpoint's exact origin: redirects anywhere else are refused
// and no referrer is sent, so nothing but the configured node sees a query.
export function rpcOrigin(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid RPC URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new Error(`Invalid RPC URL: ${url} (expected http:// or https://)`);
  return parsed.origin;
}
export function createRpc(rpcUrl, opts = { batchSize: 10 }) {
  const net = ftch(globalThis.fetch.bind(globalThis), { allowedHosts: [rpcOrigin(rpcUrl)] });
  return new RpcClient(jsonrpc(net, rpcUrl, opts));
}
// NFT metadata and images sit on whatever hosts each tokenURI names. They are
// fetched only after the user asks for NFTs, through their own wrapper:
// http(s) and data: URLs only, 5s timeout, 10 MB cap, no referrer.
const media = ftch(globalThis.fetch.bind(globalThis), {
  isValidRequest: (url) => /^(https?|data):/i.test(String(url)),
  timeout: 5000,
  maxBodySize: 10 * 1024 * 1024,
  concurrencyLimit: 6,
});
/** Image URL -> blob: URL fetched through the media wrapper (the page never loads it directly). */
export async function imageUrl(url) {
  if (url.startsWith('data:')) return url; // inline, nothing to fetch
  const res = await media(url);
  if (!res.ok) throw new Error(`image: HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }));
}

const CHAINS = {
  1: 'Mainnet',
  10: 'OP Mainnet',
  100: 'Gnosis',
  137: 'Polygon',
  8453: 'Base',
  17000: 'Holesky testnet',
  42161: 'Arbitrum One',
  560048: 'Hoodi testnet',
  11155111: 'Sepolia testnet',
};
export const chainName = (id) => CHAINS[Number(id)] || `Chain ${id}`;

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
const count = (n) => Number(n).toLocaleString('en-US');
// conversion rates show whole dollars from $100 (1987.67 -> $1,987), cents
// below, and 3 significant digits under a dollar (0.094123 -> $0.0941)
const usdRate = (n) => {
  if (!Number.isFinite(n)) return 'n/a';
  if (n >= 100) return usdWholeFormat.format(Math.trunc(n));
  if (n >= 1) return usdFormat.format(n);
  return `$${n.toPrecision(3)}`;
};
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
// dust reads better in small units than as ~0 ETH: wei below 1M wei, gwei
// below 0.000001 ETH (fee parts such as a 0.6 gwei priority tip)
const ethAmount = (v) => {
  const abs = v < 0n ? -v : v;
  if (abs > 0n && abs < 1_000_000n) return `${v} wei`;
  if (abs > 0n && abs < 1_000_000_000_000n) return `${approxUnits(v, 9)} gwei`;
  return `${approxUnits(v, 18)} ETH`;
};
const gwei = (v) => `${weigwei.encode(v)} gwei`;
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
export const isTxHash = (value) => /^0x[0-9a-fA-F]{64}$/.test(value);
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

// "1,000 USDT", "BAYC #42", "3× #7": a token movement without perspective
function transferAmount(transfer) {
  if (transfer.abi === 'ERC20')
    return `${approxUnits(erc20Amount(transfer.tokens) || 0n, transfer.decimals || 0)} ${transfer.symbol || 'TOKEN'}`;
  const tokens = [...transfer.tokens].map(([id, value]) =>
    transfer.abi === 'ERC721' ? `#${idText(id)}` : `${value}× #${idText(id)}`
  );
  return `${transfer.symbol || transfer.abi} ${tokens.join(', ')}`;
}

function tokenText(transfer, watched) {
  if (transfer.abi === 'ERC20') {
    // signed for the watched set (the token analogue of txDiff)
    const amount = erc20Amount(tokenDiff(transfer, [...watched])) || 0n;
    return `${amount >= 0n ? '+' : ''}${approxUnits(amount, transfer.decimals || 0)} ${transfer.symbol || 'TOKEN'}`;
  }
  const sign = watched.has(transfer.to.toLowerCase()) ? '+' : '-';
  return `${sign}${transferAmount(transfer)}`;
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
  // no price feed (most of the wide token list): the amount alone
  if (!Number.isFinite(balance.price)) return `${balance.symbol.padEnd(5)} ${balance.amount}`;
  // a pegged stablecoin's amount IS its dollar value: rate and total are noise
  if (balance.stable && Math.abs(balance.price - 1) <= 0.03)
    return `${balance.symbol.padEnd(5)} ${balance.amount}`;
  return `${balance.symbol.padEnd(5)} ${balance.amount} · ${usd(Number(balance.amount) * balance.price)} @ ${usdRate(balance.price)}`;
}

/** One line about the account kind: EOA + sent count, 7702 delegation, or contract. */
export function accountText(account) {
  if (account.kind === 'contract') {
    const creator = account.creator
      ? ` · created by ${account.creator} in ${account.creationTx}`
      : '';
    return `Contract${creator}`;
  }
  const sent = `${count(account.sent)} transaction${account.sent === 1n ? '' : 's'} sent`;
  return account.delegate
    ? `EOA · ${sent} · EIP-7702 delegated to ${account.delegate}`
    : `EOA · ${sent}`;
}
/** "Token · USD Coin (USDC) · ERC20 · 6 decimals" for token contracts, else undefined. */
export function tokenLine(account) {
  const token = account.token;
  if (!token) return;
  const name =
    token.name && token.symbol ? `${token.name} (${token.symbol})` : token.name || token.symbol;
  const decimals = token.decimals !== undefined ? ` · ${token.decimals} decimals` : '';
  return `Token · ${name} · ${token.abi}${decimals}`;
}

const TX_TYPES = ['legacy', 'EIP-2930', 'EIP-1559', 'EIP-4844 blob', 'EIP-7702 set-code'];

// "Transfer(address,address,uint256)" for an exact match; a guess from the
// topic signature alone gets a '?' (unknown contract, several candidates)
function eventName(log) {
  let decoded;
  try {
    decoded = decodeEvent(log.address, log.topics, log.data);
  } catch {}
  if (!decoded) return {};
  if (!Array.isArray(decoded)) return { event: decoded.signature, hint: decoded.hint };
  const guesses = [...new Set(decoded.map((d) => d.signature))];
  return { event: `${guesses.join(' / ')} ?` };
}

export function createExplorer(rpcUrl = RPC_URL) {
  const prov = createRpc(rpcUrl);
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
  // chain head for confirmation counts: one block's worth of reuse, so
  // reopening details right away costs no request
  let headAt = 0;
  let headValue;
  const head = () => {
    if (Date.now() - headAt > 12_000) {
      headAt = Date.now();
      headValue = prov.height();
      headValue.catch(() => (headAt = 0));
    }
    return headValue;
  };

  /** Which node this is: chain, client, and whether it has the ots_ namespace. */
  async function node() {
    const [chainId, client, capabilities] = await Promise.all([
      prov.chainId(),
      safe(prov.call('web3_clientVersion')),
      safe(prov.capabilities()),
    ]);
    return {
      chainId,
      name: chainName(chainId),
      client: typeof client.value === 'string' ? client.value : undefined,
      ots: capabilities.value?.ots,
    };
  }

  // Newest-first history of one address, or of a set (favorites) merged into
  // one list. Pages walk back with one OTS cursor per address: a page holds
  // whole blocks and its logs complement spans the same blocks, so the next
  // page starts strictly below the page's oldest block and nothing is missed;
  // a page shorter than PAGE_SIZE is the last. Without ots_ the page is the
  // newest logs rows, which can end mid-block: that block is read again (the
  // merge dedupes). `discover` fills symbol/decimals for tokens outside the
  // curated registry. The token scan (logs only, whole chain) deepens the
  // same list.
  const PAGE_SIZE = 25;
  function feed(target) {
    const multi = Array.isArray(target);
    const cursors = (multi ? target : [target]).map((address) => ({
      address,
      before: 0,
      done: false,
    }));
    const rows = new Map(); // lowercased hash -> slim row
    let scanner;
    // A set's rows are attributed to the favorites they touch. The same tx can
    // come from several per-address pages: participants and token movements
    // are unioned (as multisets: one tx can repeat an identical transfer).
    const transferKey = (t) => `${t.contract}:${t.from}:${t.to}:${[...t.tokens].join()}`;
    const add = (row, address) => {
      const key = row.hash.toLowerCase();
      const known = rows.get(key);
      if (!known) {
        const slimmed = slim(row);
        if (multi && !slimmed.addresses) slimmed.addresses = [address];
        rows.set(key, slimmed);
        return;
      }
      if (!multi) return;
      for (const a of row.addresses || [address])
        if (!known.addresses.some((b) => b.toLowerCase() === a.toLowerCase()))
          known.addresses = [...known.addresses, a];
      const left = new Map();
      for (const t of known.tokenTransfers)
        left.set(transferKey(t), (left.get(transferKey(t)) || 0) + 1);
      const extra = row.tokenTransfers.filter((t) => {
        const n = left.get(transferKey(t)) || 0;
        if (n) left.set(transferKey(t), n - 1);
        return !n;
      });
      if (extra.length) known.tokenTransfers = [...known.tokenTransfers, ...extra];
    };
    // the ots and logs passes yield separately: merge into one newest-first list
    const sorted = () =>
      [...rows.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    async function page(cursor) {
      const { ots } = await prov.capabilities();
      const opts = {
        source: 'auto',
        pageSize: PAGE_SIZE,
        before: cursor.before,
        discover: true,
        cache,
      };
      let got = 0;
      let oldest = Infinity;
      for await (const row of history(prov, cursor.address, opts)) {
        got++;
        if (row.block !== undefined) oldest = Math.min(oldest, row.block);
        add(row, cursor.address);
      }
      // a cursor that cannot move (one block holding a whole page) ends paging
      const next = ots ? oldest : oldest + 1;
      cursor.done =
        got < PAGE_SIZE || oldest === Infinity || (cursor.before !== 0 && next >= cursor.before);
      cursor.before = next;
    }
    return {
      get rows() {
        return sorted();
      },
      /** True until every address has reached its first transaction. */
      get hasOlder() {
        return cursors.some((cursor) => !cursor.done);
      },
      /** Loads the next page (the newest one on the first call); resolves to all rows. */
      async older() {
        await Promise.all(cursors.filter((c) => !c.done).map(page));
        return sorted();
      },
      get scanStarted() {
        return !!scanner;
      },
      get scanDone() {
        return !!scanner?.done;
      },
      /** Overall share of the chain scanned so far, 0..100. */
      get scanPercent() {
        return scanner ? scanner.percent : 0;
      },
      // A deep scan of a huge address can run for the better part of an hour,
      // so the scanner works in time-budgeted steps, newest era first: each
      // step consumes whole logs windows until the budget runs out, then
      // pauses at the boundary of the last fully consumed window. The UI shows
      // what it has and asks before digging deeper; the next step resumes
      // exactly below that boundary, so nothing is missed and nothing is
      // scanned twice. Ordinary addresses finish inside the first step.
      // logsWindow × concurrency bounds peak memory: every in-flight window
      // buffers its full rows (receipts included) until consumed.
      async scanStep(onProgress = () => {}, budgetMs = 120_000) {
        scanner ||= createTokenScanner(prov, target, { logsWindow: 200_000, concurrency: 4 });
        const result = await scanner.step((row) => add(row, multi ? undefined : target), {
          onProgress,
          budgetMs,
        });
        return { rows: sorted(), done: result.done, percent: result.percent };
      },
    };
  }

  // Balances for a set of addresses treated as one wallet: per-token sums
  // (favorites page passes every favorite, load() passes one address). The
  // curated five by default; `allTokens` checks the whole built-in registry.
  // Token prices are only asked for tokens actually held.
  async function combinedBalances(addresses, { allTokens = false } = {}) {
    const tokens = allTokens ? ALL_TOKENS : TOKENS;
    // one Multicall3 round for the set's ETH balances; token balances batch
    // through the same contract inside tokenBalances (per address)
    const [eth, tokenResults, ethPrice] = await Promise.all([
      safe(prov.ethBalances(addresses)),
      Promise.all(addresses.map((address) => safe(tokenBalances(prov, address, tokens)))),
      safe(quoter.coinPrice('ETH')),
    ]);
    const balances = [];
    if (eth.error) balances.push({ symbol: 'ETH', error: eth.error });
    else
      balances.push({
        symbol: 'ETH',
        amount: weieth.encode(Object.values(eth.value).reduce((sum, value) => sum + value, 0n)),
        price: ethPrice.value,
      });
    const failed = tokenResults.find((result) => result.error);
    if (failed) balances.push({ symbol: 'Tokens', error: failed.error });
    const held = [];
    for (const token of failed ? [] : tokens) {
      let raw = 0n;
      let error;
      for (const result of tokenResults) {
        const amount = erc20Amount(result.value[token.contract]);
        if (amount !== undefined) raw += amount;
        else error = new Error(result.value[token.contract]?.error || 'unavailable');
      }
      if (!error && raw === 0n) continue;
      held.push({ token, raw, error });
    }
    const prices = await Promise.all(
      held.map(({ token, error }) => (error ? {} : safe(quoter.tokenPrice(token.symbol))))
    );
    held.forEach(({ token, raw, error }, i) =>
      balances.push({
        symbol: token.symbol,
        amount: error ? undefined : units(raw, token.decimals),
        price: prices[i].value,
        stable: STABLECOINS.has(token.symbol),
        error,
      })
    );
    // wallet total, shown only when tokens besides ETH are present
    const totalUsd =
      balances.length > 1
        ? balances.reduce(
            (sum, b) => sum + (b.error ? 0 : Number(b.amount) * b.price || 0),
            0
          )
        : undefined;
    // per-address ETH for lists that show each member (favorites)
    return { balances, totalUsd, eth: eth.value, ethPrice: ethPrice.value };
  }

  // What kind of account this is: an EOA with its sent count (the nonce), an
  // EIP-7702-delegated EOA, or a contract — with its creator when the node has
  // ots_, and token metadata when the contract is a token.
  async function account(address) {
    const [code, sent] = await Promise.all([
      prov.call('eth_getCode', address, 'latest'),
      prov.nonce(address),
    ]);
    if (code === '0x') return { kind: 'eoa', sent };
    if (/^0xef0100[0-9a-f]{40}$/i.test(code))
      return { kind: 'eoa', sent, delegate: checksumAddress(`0x${code.slice(8)}`) };
    const [creator, token] = await Promise.all([
      safe(prov.call('ots_getContractCreator', address)),
      safe(tokenInfo(prov, address)),
    ]);
    const info = token.value && !('error' in token.value) ? token.value : undefined;
    return {
      kind: 'contract',
      creator: creator.value?.creator ? checksumAddress(creator.value.creator) : undefined,
      creationTx: creator.value?.hash,
      token: info && (info.symbol || info.name) ? info : undefined,
    };
  }

  async function load(value, opts) {
    const address = checksumAddress(value);
    const recent = feed(address);
    const [page, combined, ensName, kind] = await Promise.all([
      safe(recent.older()),
      combinedBalances([address], opts),
      safe(resolver.addressToName(address)),
      safe(account(address)),
    ]);
    return {
      address,
      ens: ensName.value || undefined,
      account: kind.value,
      balances: combined.balances,
      totalUsd: combined.totalUsd,
      /** History pager: rows, older(), scanStep(). */
      feed: recent,
      historyError: page.error,
    };
  }

  // Favorites page data: combined balances plus each member's own ETH and
  // account kind (sent count / contract).
  async function favoritesOverview(addresses, opts) {
    const [combined, kinds] = await Promise.all([
      combinedBalances(addresses, opts),
      Promise.all(addresses.map((address) => safe(account(address)))),
    ]);
    const members = addresses.map((address, i) => {
      const wei = combined.eth?.[address];
      return {
        address,
        eth: wei === undefined ? undefined : `${approxUnits(wei, 18)} ETH`,
        usd: wei === undefined ? undefined : Number(weieth.encode(wei)) * combined.ethPrice,
        account: kinds[i].value,
      };
    });
    return { balances: combined.balances, totalUsd: combined.totalUsd, members };
  }

  // Confirmed txs are immutable: re-opening one renders from cache. Pending
  // txs and failed loads are not pinned, so they refresh on the next open.
  // Confirmations are the one live field: filled in per open.
  const detailsCache = new Map();
  async function details(target) {
    const row = typeof target === 'string' ? { hash: target } : target;
    const key = row.hash.toLowerCase();
    if (!detailsCache.has(key)) {
      const promise = loadDetails(row);
      detailsCache.set(key, promise);
      promise.then(
        (result) => result.pending && detailsCache.delete(key),
        () => detailsCache.delete(key)
      );
    }
    const info = await detailsCache.get(key);
    if (info.pending) return info;
    const confirmations = await safe(head());
    const text = confirmations.error
      ? 'unavailable'
      : count(Math.max(0, confirmations.value - info.block + 1));
    return {
      ...info,
      normal: info.normal.map((pair) => (pair[0] === 'confirmations' ? [pair[0], text] : pair)),
    };
  }

  async function loadDetails(row) {
    // rows are slimmed for the table; reuse the payload downloaded by the
    // history/scan stream when it is still remembered, else re-read the tx
    const full =
      fullRows.get(row.hash.toLowerCase()) || (await prov.txInfo(row.hash, { verify: false }));
    const { info, receipt } = full;
    const [enriched, block] = await Promise.all([
      enrichTx(prov, full, { clearSig: 'resolve', cache }).catch(() => undefined),
      receipt ? safe(prov.blockInfo(receipt.blockNumber)) : {},
    ]);
    const intent =
      enriched?.intent || (info.input === '0x' ? 'Transfer ETH' : 'Contract call');
    const method = enriched?.method || (info.input !== '0x' ? info.input.slice(0, 10) : '—');
    const timestamp = row.timestamp || block.value?.timestamp;
    const status = !receipt
      ? 'pending'
      : `${receipt.status === 0 ? 'reverted' : 'success'} · block ${receipt.blockNumber}`;
    const type = `${TX_TYPES[info.type] || 'unknown'} · type ${info.type}`;
    const normal = [
      ['time', timestamp ? formatTime(timestamp) : receipt ? '—' : 'pending'],
      ['status', status],
      ...(receipt ? [['confirmations', '…']] : []),
      ['from', info.from, 'address'],
      info.to ? ['to', info.to, 'address'] : ['to', '(contract creation)'],
      ...(receipt?.contractAddress ? [['created', receipt.contractAddress, 'address']] : []),
      ['amount eth', ethAmount(info.value)],
      ['intent', intent],
      ['method', method],
    ];
    // Fee = gas × effective price (+ blob gas on 4844). Since London the base
    // fee part is burnt and the rest tips the block builder; an EIP-1559 cap
    // above the effective price is what the sender saved.
    const fees = [];
    if (receipt) {
      const { gasUsed, effectiveGasPrice: price } = receipt;
      const blobFee = (receipt.blobGasUsed ?? 0n) * (receipt.blobGasPrice ?? 0n);
      const baseFee = block.value?.baseFeePerGas;
      fees.push(['fee', ethAmount(gasUsed * price + blobFee)]);
      if (baseFee !== undefined) {
        fees.push(['burnt', ethAmount(gasUsed * baseFee + blobFee)]);
        fees.push(['priority tip', ethAmount(gasUsed * (price - baseFee))]);
      }
      if (info.maxFeePerGas !== undefined && info.maxFeePerGas >= price)
        fees.push(['saved', ethAmount(gasUsed * (info.maxFeePerGas - price))]);
      fees.push(['gas price', gwei(price)]);
      if (baseFee !== undefined) fees.push(['base fee', gwei(baseFee)]);
    } else if (info.gasPrice !== undefined) fees.push(['gas price', gwei(info.gasPrice)]);
    if (info.maxFeePerGas !== undefined) fees.push(['max fee', gwei(info.maxFeePerGas)]);
    if (info.maxPriorityFeePerGas !== undefined)
      fees.push(['max priority fee', gwei(info.maxPriorityFeePerGas)]);
    if (receipt?.blobGasUsed)
      fees.push(['blob gas', `${receipt.blobGasUsed} @ ${gwei(receipt.blobGasPrice)}`]);
    const percent = receipt && info.gas ? Number((receipt.gasUsed * 10_000n) / info.gas) / 100 : 0;
    const muted = [
      ['type', type],
      ...fees,
      ['gas spent', receipt ? `${receipt.gasUsed} out of ${info.gas} (${percent}%)` : '—'],
      ['nonce', String(info.nonce)],
      ...(info.transactionIndex !== undefined
        ? [['position', `${info.transactionIndex} in block`]]
        : []),
      ['txid', row.hash],
      ['calldata', info.input],
    ];
    // every token movement of the tx, third parties included
    const transfers = (enriched?.allTokenTransfers || []).map((transfer) => ({
      from: transfer.from,
      to: transfer.to,
      amount: transferAmount(transfer),
      contract: transfer.contract,
    }));
    const logs = (receipt?.logs || []).map((log) => ({
      index: log.logIndex,
      address: log.address,
      ...eventName(log),
      topics: log.topics,
      data: log.data,
    }));
    return {
      pending: !receipt,
      hash: info.hash,
      block: receipt?.blockNumber,
      normal,
      muted,
      transfers,
      logs,
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
          const metadata = nftMetadata(await (await media(ipfsToHttp(uri))).json());
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

  return { node, load, feed, details, nfts, resolveName, favoritesOverview, combinedBalances };
}
