// NFT viewer core, shared by nft/index.html and its tests: an address's NFT
// inventory (discovered from transfer logs, ownership verified on-chain) and
// single-token pages (owner, metadata, attributes, ERC-721 transfer history).
//
// Off-chain content goes through one policy, mediaSource(). IPFS is the
// default: content addressing makes every IPFS form (ipfs://, a path gateway
// URL https://host/ipfs/<cid>/…, a subdomain gateway URL
// https://<cid>.ipfs.host/…) interchangeable, so all of them are rewritten
// onto the one gateway the user picked — the host a token's creator named is
// never contacted. data: URIs (on-chain art) are inline and need no network.
// Any other http(s) URL is a host the creator controls: fetching it tells
// them your IP and when you looked (airdropped spam uses exactly this as a
// tracking pixel), and its content can change at any time. Those load only
// after the user ticks "Load non-IPFS hosts" (allowHttp).
import { base32nopad, base58 } from '@scure/base';
import { ftch } from 'micro-ftch';
import { ERC1155, ERC721, createContract, events } from '../../abi/index.js';
import { isReverted, mapPool, throwIfAborted, withRetry } from '../../net.js';
import { NameResolver } from '../../net/resolver.js';
import {
  decodeReceiptAllTokenTransfers,
  nftHoldings,
  nftMetadata,
  tokenInfo,
  tokenURI,
} from '../../net/tokens.js';
import { checksumAddress, createRpc, isAddress, isName, RPC_URL } from '../explorer/core.js';

export {
  checksumAddress,
  isAddress,
  isName,
  RPC_URL,
  short,
  withScheme,
} from '../explorer/core.js';

// ~60 NFTs: IPFS collections, on-chain SVGs, and airdropped spam whose
// metadata sits on non-IPFS hosts — the IPFS-only default at work
export const DEMO_ADDRESS = '0x220866B1A2219f40e72f5c628B65D54268cA3A9D';
export const DEFAULT_GATEWAY = 'https://ipfs.io/ipfs/';

const T721 = /* @__PURE__ */ events(ERC721).Transfer;
const T721_SIG = /* @__PURE__ */ T721.topics({ from: null, to: null, tokenId: null })[0];
const T1155_SINGLE = /* @__PURE__ */ events(ERC1155).TransferSingle;
const T1155_BATCH = /* @__PURE__ */ events(ERC1155).TransferBatch;
// Log windows: newest first, GROUP of them in flight at once; a group's
// candidates are verified before the next starts, so tiles stream in.
const WINDOW = 500_000;
const GROUP = 4;
// nftHoldings() call limits: bigger discoveries are verified in chunks
const CHUNK_CONTRACTS = 256;
const CHUNK_IDS = 4096;
const HISTORY_SHOWN = 20; // transfers per token page that get block timestamps

// CIDv0 (base58btc sha2-256) or CIDv1 in base32, the canonical text forms;
// subdomain gateways require the lowercase base32 one
const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,})$/;
// path characters kept as-is; everything else (spaces, unicode) gets escaped
const pathEscape = (path) => path.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@/%]/g, encodeURIComponent);

/** "<cid>/path" for every IPFS form of a URI, undefined for anything else. */
export function ipfsPath(uri) {
  if (typeof uri !== 'string') return;
  const s = uri.trim();
  // ipfs://<cid>/path and the legacy ipfs://ipfs/<cid>/path
  const native = s.match(/^ipfs:\/\/(?:ipfs\/)?([^/?#]+)([^?#]*)/i);
  if (native) return CID.test(native[1]) ? native[1] + pathEscape(native[2]) : undefined;
  let url;
  try {
    url = new URL(s);
  } catch {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  const path = url.pathname.match(/^\/ipfs\/([^/]+)(\/.*)?$/);
  if (path && CID.test(path[1])) return path[1] + (path[2] || '');
  const sub = url.hostname.match(/^([a-z2-7]+)\.ipfs\./);
  if (sub && CID.test(sub[1])) return sub[1] + (url.pathname === '/' ? '' : url.pathname);
}

/** CIDv1 base32 text of a CID: v0 ('Qm…', dag-pb) is converted, v1 passes through. */
export function cidV1(cid) {
  if (!cid.startsWith('Qm')) return cid;
  const multihash = base58.decode(cid);
  return `b${base32nopad.encode(Uint8Array.of(0x01, 0x70, ...multihash)).toLowerCase()}`;
}

/**
 * Normalizes a user-typed gateway: 'ipfs.io' -> 'https://ipfs.io/ipfs/',
 * '127.0.0.1:8080' -> 'http://127.0.0.1:8080/ipfs/'. Throws on non-http(s).
 */
export function normalizeGateway(input) {
  let s = String(input || '').trim();
  if (!s) return DEFAULT_GATEWAY;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s))
    s = `${/^(localhost|127\.|\d{1,3}(\.\d{1,3}){3})/.test(s) ? 'http' : 'https'}://${s}`;
  let url;
  try {
    url = new URL(s);
  } catch {
    throw new Error(`Invalid IPFS gateway: ${input}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(`Invalid IPFS gateway: ${input} (expected http:// or https://)`);
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${/\/ipfs$/.test(path) ? path : `${path}/ipfs`}/`;
}

/**
 * Where a URI from a contract or its metadata loads from under the policy:
 * { kind: 'ipfs', url } (rewritten onto the gateway), { kind: 'data', url },
 * { kind: 'http', url, host } (allowHttp only), { kind: 'blocked', host }
 * (an http(s) host while allowHttp is off), or { kind: 'unsupported', uri }.
 */
export function mediaSource(uri, { gateway = DEFAULT_GATEWAY, allowHttp = false } = {}) {
  if (typeof uri !== 'string' || !uri.trim()) return { kind: 'unsupported', uri: '' };
  const s = uri.trim();
  if (/^data:/i.test(s)) return { kind: 'data', url: s };
  const ipfs = ipfsPath(s);
  if (ipfs) return { kind: 'ipfs', url: gateway + ipfs };
  let url;
  try {
    url = new URL(s);
  } catch {
    return { kind: 'unsupported', uri: s };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'unsupported', uri: s };
  return allowHttp
    ? { kind: 'http', url: url.href, host: url.host }
    : { kind: 'blocked', host: url.host };
}

/** One-line description of a mediaSource() result, for the token page. */
export function sourceText(source) {
  if (source.kind === 'ipfs') return 'IPFS, via the gateway';
  if (source.kind === 'data') return 'on-chain (data: URI)';
  if (source.kind === 'http') return `non-IPFS host ${source.host}`;
  if (source.kind === 'blocked') return `non-IPFS host ${source.host} — not loaded`;
  return 'unsupported URI scheme — not loaded';
}

/** Body of a data: URI as text: base64 or percent-encoded (raw JSON tolerated). */
export function dataText(uri) {
  const m = String(uri).match(/^data:([^,]*),([\s\S]*)$/i);
  if (!m) throw new Error('malformed data: URI');
  if (/;base64$/i.test(m[1])) {
    const bin = atob(m[2].replace(/\s+/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  // many contracts emit 'data:application/json;utf8,{…}' unescaped, where a
  // literal '%' would make decodeURIComponent throw
  try {
    return decodeURIComponent(m[2]);
  } catch {
    return m[2];
  }
}

// inline images the page may show as-is: <img> renders SVG without running
// its scripts or loading anything it references
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)[;,]/i;
const TEXT_MAX = 10_000;
const text = (value) => (typeof value === 'string' && value ? value.slice(0, TEXT_MAX) : undefined);

/**
 * The fields the viewer shows from an untrusted metadata JSON: nftMetadata()
 * from the library (http(s)/ipfs URL fields only) plus inline data:image art,
 * which it drops but on-chain collections depend on, and the attributes list
 * as plain trait/value strings. Every string ends up in textContent.
 */
export function tokenMetadata(json) {
  const base = nftMetadata(json);
  const out = {};
  if (base.name) out.name = base.name.slice(0, 500);
  if (base.description) out.description = text(base.description);
  const raw = json && typeof json === 'object' ? json : {};
  const image =
    base.image ||
    [raw.image, raw.image_url].find((v) => typeof v === 'string' && DATA_IMAGE.test(v));
  if (image) out.image = image;
  if (base.animationUrl) out.animationUrl = base.animationUrl;
  if (base.externalUrl) out.externalUrl = base.externalUrl;
  const attributes = (Array.isArray(raw.attributes) ? raw.attributes : [])
    .slice(0, 200)
    .flatMap((a) => {
      if (!a || typeof a !== 'object') return [];
      const v = a.value;
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return [];
      const trait = typeof a.trait_type === 'string' ? a.trait_type.slice(0, 200) : '';
      return [{ trait, value: String(v).slice(0, 1000) }];
    });
  if (attributes.length) out.attributes = attributes;
  return out;
}

// hash-like ids (ENS labelhashes are uint256 hashes) are unreadable as
// 78-digit decimals: shorten them as hex
export const idText = (id) => {
  const s = id.toString();
  if (s.length <= 12) return s;
  const hex = `0x${id.toString(16)}`;
  return `${hex.slice(0, 10)}…${hex.slice(-4)}`;
};
/** Token ids from URLs and forms: decimal or 0x-hex, non-negative uint256. */
export function parseTokenId(value) {
  const s = String(value ?? '').trim();
  if (!/^(\d+|0x[0-9a-f]+)$/i.test(s)) throw new Error(`Invalid token id: ${value}`);
  const id = BigInt(s);
  if (id >= 2n ** 256n) throw new Error(`Invalid token id: ${value}`);
  return id;
}

const memo = (map, key, fn) => {
  if (!map.has(key)) {
    const promise = fn();
    map.set(key, promise);
    promise.catch(() => map.delete(key)); // failures are retried on the next ask
  }
  return map.get(key);
};
const safe = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error })
  );
const isTokenError = (v) => v && typeof v === 'object' && typeof v.error === 'string';

export function createNftViewer(rpcUrl = RPC_URL, settings = {}) {
  const prov = createRpc(rpcUrl);
  const resolver = new NameResolver(prov);
  let policy = {
    gateway: normalizeGateway(settings.gateway),
    allowHttp: !!settings.allowHttp,
  };
  // Every off-chain request goes through this wrapper, and each redirect hop
  // is re-checked against the current policy before it is sent: a gateway
  // can only bounce to its own subdomain form (<cid>.ipfs.<gateway host>),
  // never off to some other host while non-IPFS loads are off.
  const allowedRequest = (url) => {
    let u;
    try {
      u = new URL(String(url));
    } catch {
      return false;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (policy.allowHttp) return true;
    const gw = new URL(policy.gateway);
    return u.origin === gw.origin || u.hostname.endsWith(`.ipfs.${gw.hostname}`);
  };
  // Low concurrency: public gateways rate-limit bursts hard (ipfs.io answers
  // 429 with Retry-After: 900 — a 15 minute penalty for the whole page).
  const media = ftch(globalThis.fetch.bind(globalThis), {
    isValidRequest: allowedRequest,
    timeout: 20_000, // public gateways can take a while on uncached content
    maxBodySize: 10 * 1024 * 1024,
    concurrencyLimit: 3,
  });
  // Many gateways (dweb.link, 4everland…) redirect /ipfs/<cid>/… to their
  // subdomain form https://<cidv1>.ipfs.<host>/…. micro-ftch follows
  // redirects itself, hop by hop, to check each target before it is sent —
  // but browsers hide redirect responses from that (type 'opaqueredirect',
  // status 0, no Location). The target is predictable, though: on the first
  // such answer the gateway is switched to its subdomain form for the session.
  const subdomainGateways = new Set(); // gateway origins
  const gatewayHost = (url) => {
    const gw = new URL(policy.gateway);
    const u = new URL(url);
    return u.origin === gw.origin || u.hostname.endsWith(`.ipfs.${gw.hostname}`) ? gw : undefined;
  };
  const subdomainUrl = (url) => {
    const [cid, ...path] = url.slice(policy.gateway.length).split('/');
    const gw = new URL(policy.gateway);
    return `${gw.protocol}//${cidV1(cid)}.ipfs.${gw.host}/${path.join('/')}`;
  };
  // One 429 pauses every request to that gateway (or host) until Retry-After
  // passes: hammering on would only extend the penalty. Errors carry `retryAt`.
  const pausedUntil = new Map(); // gateway origin or host origin -> ms timestamp
  const limitKey = (url) => (gatewayHost(url) || new URL(url)).origin;
  const rateLimited = (key) => {
    const at = pausedUntil.get(key);
    const secs = Math.ceil((at - Date.now()) / 1000);
    return Object.assign(new Error(`${new URL(key).host} rate-limited, retrying in ${secs}s`), {
      retryAt: at,
    });
  };
  async function get(url) {
    const fromGateway = url.startsWith(policy.gateway);
    if (fromGateway && subdomainGateways.has(new URL(policy.gateway).origin))
      url = subdomainUrl(url);
    const key = limitKey(url);
    if ((pausedUntil.get(key) || 0) > Date.now()) throw rateLimited(key);
    let res;
    try {
      res = await media(url, { referrerPolicy: 'no-referrer', credentials: 'omit' });
    } catch (error) {
      // content nobody on the IPFS network serves just hangs until the timeout
      if (error.name === 'AbortError') {
        const gw = gatewayHost(url);
        throw new Error(
          gw ? `${gw.host} timed out (not found on IPFS?)` : `${new URL(url).host} timed out`
        );
      }
      throw error;
    }
    if (res.status === 504 && gatewayHost(url))
      throw new Error('gateway timeout (not found on IPFS?)');
    if (res.type === 'opaqueredirect') {
      if (fromGateway && url.startsWith(policy.gateway)) {
        subdomainGateways.add(new URL(policy.gateway).origin);
        return get(url);
      }
      throw new Error(`${new URL(url).host} redirected; the browser hides where to`);
    }
    if (res.status === 429) {
      const after = Number(res.headers.get('retry-after'));
      const secs = Number.isFinite(after) && after > 0 ? Math.min(after, 900) : 60;
      pausedUntil.set(key, Math.max(pausedUntil.get(key) || 0, Date.now() + secs * 1000));
      throw rateLimited(key);
    }
    return res;
  }

  const infos = new Map(); // contract -> Promise<TokenInfo | TokenError>
  const uris = new Map(); // contract:id -> Promise<string | TokenError>
  const jsons = new Map(); // fetched URL -> Promise<unknown>
  const images = new Map(); // fetched URL -> Promise<blob: URL>
  const collection = (contract) =>
    memo(infos, contract.toLowerCase(), () => tokenInfo(prov, contract.toLowerCase()));

  /** Switches gateway / non-IPFS loading; drops off-chain caches (and their blob: URLs). */
  function setPolicy(next) {
    policy = {
      gateway: normalizeGateway(next.gateway ?? policy.gateway),
      allowHttp: next.allowHttp ?? policy.allowHttp,
    };
    for (const promise of images.values())
      promise.then(
        (url) => url.startsWith('blob:') && URL.revokeObjectURL(url),
        () => {}
      );
    images.clear();
    jsons.clear();
    return policy;
  }

  async function fetchJson(source) {
    if (source.kind === 'data') return JSON.parse(dataText(source.url));
    return memo(jsons, source.url, async () => {
      const res = await get(source.url);
      if (!res.ok) throw new Error(`metadata: HTTP ${res.status}`);
      return res.json();
    });
  }

  /** Image source -> URL safe for <img src>: data: as-is, fetched art as a blob: URL. */
  function image(source) {
    if (source.kind === 'data') return Promise.resolve(source.url);
    if (source.kind !== 'ipfs' && source.kind !== 'http')
      return Promise.reject(new Error(sourceText(source)));
    return memo(images, source.url, async () => {
      const res = await get(source.url);
      if (!res.ok) throw new Error(`image: HTTP ${res.status}`);
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      // a gateway error page or JSON is not art; unlabeled bytes get sniffed
      if (type && !type.startsWith('image/') && type !== 'application/octet-stream')
        throw new Error(`image: unexpected ${type}`);
      const blobType = type.startsWith('image/') ? type : '';
      return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: blobType }));
    });
  }

  // tokenURI with the standard known (from discovery logs or tokenInfo):
  // called directly, so contracts with incomplete ERC-165 answers still work
  function uriOf(contract, abi, id) {
    return memo(uris, `${contract.toLowerCase()}:${id}`, () =>
      tokenURI(prov, { contract: contract.toLowerCase(), abi, metadata: true }, id)
    );
  }

  /**
   * Off-chain half of a token: tokenURI -> metadata JSON -> fields, each step
   * under the current policy. Never throws: problems land in `error`.
   */
  async function resolveMetadata(contract, abi, id) {
    const out = { uri: undefined, uriSource: undefined, metadata: {}, raw: undefined };
    try {
      const uri = await uriOf(contract, abi, id);
      if (isTokenError(uri)) throw new Error(uri.error);
      out.uri = uri;
      out.uriSource = mediaSource(uri, policy);
      if (out.uriSource.kind === 'blocked' || out.uriSource.kind === 'unsupported') {
        out.error = `metadata: ${sourceText(out.uriSource)}`;
        return out;
      }
      out.raw = await fetchJson(out.uriSource);
      out.metadata = tokenMetadata(out.raw);
      if (out.metadata.image) out.imageSource = mediaSource(out.metadata.image, policy);
    } catch (error) {
      out.error = isReverted(error) ? 'tokenURI reverted' : error.message;
      if (error.retryAt) out.retryAt = error.retryAt;
    }
    return out;
  }

  /** Gallery tile data for one held token (discovery already knows the standard). */
  async function tile({ contract, abi, id, amount }) {
    const [info, meta] = await Promise.all([
      safe(collection(contract)),
      resolveMetadata(contract, abi, id),
    ]);
    const named = info.value && !isTokenError(info.value) ? info.value : {};
    return { contract, abi, id, amount, collection: named.name || named.symbol, ...meta };
  }

  /**
   * NFTs an address holds now. Discovery reads incoming ERC-721 Transfer and
   * ERC-1155 TransferSingle/Batch logs (logs only — no receipts or txs) in
   * windows from the chain head back to genesis; every candidate is then
   * checked on-chain (ownerOf / balanceOf), so tokens sent away again drop
   * out. Yields batches of held tokens, newest windows first. Progress
   * `next` is the highest block not yet scanned (-1 when done): pass it back
   * as `toBlock` to resume a stopped scan where it left off.
   */
  async function* holdings(address, { signal, onProgress = () => {}, toBlock } = {}) {
    const head = toBlock ?? (await withRetry(() => prov.height(), signal));
    const t721 = T721.topics({ from: null, to: address, tokenId: null });
    const single = T1155_SINGLE.topics({
      operator: null,
      from: null,
      to: address,
      id: null,
      value: null,
    });
    const batch = T1155_BATCH.topics({
      operator: null,
      from: null,
      to: address,
      ids: null,
      values: null,
    });
    // a 4-entry filter only matches 4-topic logs: ERC-20 Transfers (3 topics) stay out
    const t1155 = [[single[0], batch[0]], null, null, single[3]];
    const windows = [];
    for (let to = head; to >= 0; to -= WINDOW)
      windows.push({ fromBlock: Math.max(0, to - WINDOW + 1), toBlock: to });
    const seen = new Set(); // contract:id already verified
    const progress = { windows: 0, total: windows.length, next: head, found: 0, failed: [] };
    onProgress({ ...progress });
    const logs = (w) =>
      withRetry(
        async () => (await Promise.all([prov.ethLogs(t721, w), prov.ethLogs(t1155, w)])).flat(),
        signal,
        'nft logs'
      );
    for (let i = 0; i < windows.length; i += GROUP) {
      throwIfAborted(signal, 'holdings');
      const group = windows.slice(i, i + GROUP);
      const found = (await Promise.all(group.map(logs))).flat();
      const candidates = new Map(); // contract -> { contract, abi, tokens }
      for (const t of decodeReceiptAllTokenTransfers({ logs: found }, {})) {
        if (t.abi !== 'ERC721' && t.abi !== 'ERC1155') continue;
        for (const id of t.tokens.keys()) {
          const key = `${t.contract}:${id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          let entry = candidates.get(t.contract);
          if (!entry)
            candidates.set(
              t.contract,
              (entry = { contract: t.contract, abi: t.abi, tokens: new Map() })
            );
          entry.tokens.set(id, 1n);
        }
      }
      // chunk to the nftHoldings() limits; one airdrop-heavy contract alone
      // can exceed the id limit, so its ids are split across chunks too
      const chunks = [[]];
      let ids = 0;
      for (const entry of candidates.values()) {
        const all = [...entry.tokens.keys()];
        for (let at = 0; at < all.length; ) {
          let chunk = chunks[chunks.length - 1];
          if (chunk.length >= CHUNK_CONTRACTS || ids >= CHUNK_IDS)
            (chunks.push((chunk = [])), (ids = 0));
          const part = all.slice(at, at + CHUNK_IDS - ids);
          chunk.push({ ...entry, tokens: new Map(part.map((id) => [id, 1n])) });
          ids += part.length;
          at += part.length;
        }
      }
      const items = [];
      for (const chunk of chunks) {
        if (!chunk.length) continue;
        const held = await nftHoldings(prov, address, chunk, { concurrency: 8, signal });
        for (const entry of chunk) {
          const balance = held[entry.contract];
          if (isTokenError(balance)) progress.failed.push(balance);
          else if (balance)
            for (const [id, amount] of balance)
              items.push({ contract: checksumAddress(entry.contract), abi: entry.abi, id, amount });
        }
      }
      progress.windows += group.length;
      progress.next = group[group.length - 1].fromBlock - 1;
      progress.found += items.length;
      onProgress({ ...progress });
      if (items.length) yield items;
    }
  }

  /**
   * On-chain facts for the token page: collection, standard, and the owner
   * (ERC-721) or `owner`'s balance (ERC-1155). Fast; metadata() and
   * transfers() fill in the slow parts separately. Failed reads land in
   * per-field errors instead of throwing.
   */
  async function token(contractInput, idInput, { owner } = {}) {
    if (!isAddress(contractInput)) throw new Error(`Invalid contract address: ${contractInput}`);
    const contract = checksumAddress(contractInput);
    const id = parseTokenId(idInput);
    const info = await collection(contract);
    const named = isTokenError(info) ? {} : info;
    let abi = named.abi;
    if (abi !== 'ERC721' && abi !== 'ERC1155') {
      // no usable ERC-165 answer: whichever metadata call works decides
      const as721 = await safe(uriOf(contract, 'ERC721', id));
      abi = as721.value && !isTokenError(as721.value) ? 'ERC721' : 'ERC1155';
      if (abi === 'ERC1155') {
        const as1155 = await safe(uriOf(contract, 'ERC1155', id));
        if (!as1155.value || isTokenError(as1155.value))
          throw new Error(
            `${contract} is not an NFT contract (${named.error || 'no tokenURI/uri'})`
          );
      }
    }
    const lower = contract.toLowerCase();
    const out = {
      contract,
      id,
      abi,
      name: named.name,
      symbol: named.symbol,
      totalSupply: named.totalSupply,
    };
    if (abi === 'ERC721') {
      const holder = await safe(createContract(ERC721, prov, lower).ownerOf.call(id));
      if (holder.value) {
        out.owner = checksumAddress(holder.value);
        const name = await safe(resolver.addressToName(out.owner));
        if (name.value) out.ownerName = name.value;
      } else
        out.ownerError = isReverted(holder.error)
          ? 'ownerOf reverted (burned or never minted)'
          : holder.error.message;
    } else if (owner && isAddress(owner)) {
      out.holder = checksumAddress(owner);
      const balance = await safe(
        createContract(ERC1155, prov, lower).balanceOf.call({ account: owner, id })
      );
      if (balance.value !== undefined) out.balance = balance.value;
      else out.balanceError = balance.error.message;
    }
    return out;
  }

  /**
   * ERC-721 transfer history of one token, newest first; the newest
   * HISTORY_SHOWN rows get block timestamps. A whole-chain eth_getLogs on one
   * contract + tokenId topic is slow on some nodes (~80s cold on erigon), so
   * the range fans out as parallel 1M-block windows (~9s).
   */
  async function transfers(contract, idInput) {
    const id = parseTokenId(idInput);
    const head = await prov.height();
    // by hand: events().topics() encodes an indexed value that follows a
    // null wildcard with the previous input's encoder (address, here)
    const topics = [T721_SIG, null, null, `0x${id.toString(16).padStart(64, '0')}`];
    const logs = await prov.ethLogs(topics, {
      address: contract.toLowerCase(),
      fromBlock: 0,
      toBlock: head,
      limitLogs: 1_000_000,
      concurrency: 8,
    });
    const rows = logs
      .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex)
      .map((log) => {
        const t = T721.decode(log.topics, log.data);
        return {
          block: log.blockNumber,
          hash: log.transactionHash,
          from: checksumAddress(t.from),
          to: checksumAddress(t.to),
        };
      });
    const stamps = await mapPool(
      rows.slice(0, HISTORY_SHOWN),
      (row) => safe(prov.blockInfo(row.block)),
      {
        concurrency: 4,
      }
    );
    stamps.forEach((stamp, i) => {
      if (stamp.value) rows[i].timestamp = stamp.value.timestamp;
    });
    return rows;
  }

  /** 'nouns.eth' / 'x.gwei' -> address (undefined when unknown); addresses pass through. */
  async function resolveAddress(value) {
    const s = String(value || '').trim();
    if (isAddress(s)) return { address: checksumAddress(s) };
    if (!isName(s)) throw new Error('Invalid Ethereum address.');
    const address = await resolver.nameToAddress(s);
    if (!address) throw new Error(`Name ${s} did not resolve.`);
    return { address: checksumAddress(address), name: s };
  }

  return {
    get policy() {
      return { ...policy };
    },
    setPolicy,
    holdings,
    tile,
    token,
    metadata: resolveMetadata,
    transfers,
    image,
    resolveAddress,
    chainId: () => prov.chainId(),
  };
}
