// Uniform Resources (BCR-2020-005): the QR transport of ERC-4527. A CBOR
// payload becomes `ur:<type>/<bytewords>` — one QR code — or, when it is too
// big for one, a fountain-coded sequence `ur:<type>/<seq>-<len>/<bytewords>`
// shown as an animated QR. Mirrors the bc-ur reference implementation
// (github.com/BlockchainCommons/bc-ur): the fountain part selection must match
// it bit for bit, since sender and receiver re-derive it independently.
// examples/test/ur.test.ts checks every piece against the reference vectors.
import { sha256 } from '@noble/hashes/sha2.js';

// --- CBOR (RFC 8949) ---------------------------------------------------------
// Only what the UR registry types use: unsigned/negative integers, byte and
// text strings, arrays, maps, tags, booleans. Values map to JS as
// number | bigint (integers), Uint8Array, string, Array, Map (insertion order
// is the encoding order), Tagged, boolean. Encoding emits shortest heads and
// definite lengths; decoding rejects indefinite lengths, floats, simple values
// other than true/false, duplicate map keys and trailing bytes.

export class Tagged {
  constructor(tag, value) {
    this.tag = tag;
    this.value = value;
  }
}

const MAX_DEPTH = 16;

function encodeHead(out, major, n) {
  const v = BigInt(n);
  if (v < 0n || v >= 2n ** 64n) throw new Error(`cbor: integer out of range: ${n}`);
  const m = major << 5;
  if (v < 24n) return out.push(m | Number(v));
  const size = v < 0x100n ? 1 : v < 0x10000n ? 2 : v < 0x100000000n ? 4 : 8;
  out.push(m | { 1: 24, 2: 25, 4: 26, 8: 27 }[size]);
  for (let i = size - 1; i >= 0; i--) out.push(Number((v >> BigInt(8 * i)) & 0xffn));
}

function encodeItem(out, value, depth) {
  if (depth > MAX_DEPTH) throw new Error('cbor: nesting too deep');
  if (typeof value === 'number' || typeof value === 'bigint') {
    if (typeof value === 'number' && !Number.isSafeInteger(value))
      throw new Error(`cbor: expected integer, got ${value}`);
    const v = BigInt(value);
    return v >= 0n ? encodeHead(out, 0, v) : encodeHead(out, 1, -1n - v);
  }
  if (typeof value === 'boolean') return out.push(value ? 0xf5 : 0xf4);
  if (value instanceof Uint8Array) {
    encodeHead(out, 2, value.length);
    for (const b of value) out.push(b);
    return;
  }
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    encodeHead(out, 3, bytes.length);
    for (const b of bytes) out.push(b);
    return;
  }
  if (Array.isArray(value)) {
    encodeHead(out, 4, value.length);
    for (const item of value) encodeItem(out, item, depth + 1);
    return;
  }
  if (value instanceof Map) {
    encodeHead(out, 5, value.size);
    for (const [k, v] of value) {
      encodeItem(out, k, depth + 1);
      encodeItem(out, v, depth + 1);
    }
    return;
  }
  if (value instanceof Tagged) {
    encodeHead(out, 6, value.tag);
    return encodeItem(out, value.value, depth + 1);
  }
  throw new Error(`cbor: unsupported value ${value}`);
}

function decodeItem(bytes, pos, depth) {
  if (depth > MAX_DEPTH) throw new Error('cbor: nesting too deep');
  if (pos >= bytes.length) throw new Error('cbor: unexpected end of data');
  const first = bytes[pos++];
  const major = first >> 5;
  const info = first & 31;
  if (major === 7) {
    if (info === 20) return [false, pos];
    if (info === 21) return [true, pos];
    throw new Error(`cbor: unsupported simple/float value 0x${first.toString(16)}`);
  }
  let n;
  if (info < 24) n = BigInt(info);
  else if (info <= 27) {
    const size = 1 << (info - 24);
    if (pos + size > bytes.length) throw new Error('cbor: unexpected end of data');
    n = 0n;
    for (let i = 0; i < size; i++) n = (n << 8n) | BigInt(bytes[pos++]);
  } else throw new Error('cbor: indefinite or reserved length');
  const int = (v) => (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v);
  // strings must fit in what is left; every array/map entry takes at least
  // one byte, so the same bound caps hostile element counts
  const length = () => {
    if (n > BigInt(bytes.length - pos)) throw new Error('cbor: length exceeds data');
    return Number(n);
  };
  switch (major) {
    case 0:
      return [int(n), pos];
    case 1:
      return [int(-1n - n), pos];
    case 2: {
      const len = length();
      return [bytes.slice(pos, pos + len), pos + len];
    }
    case 3: {
      const len = length();
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(pos, pos + len));
      return [text, pos + len];
    }
    case 4: {
      const len = length();
      const items = [];
      for (let i = 0; i < len; i++) {
        let item;
        [item, pos] = decodeItem(bytes, pos, depth + 1);
        items.push(item);
      }
      return [items, pos];
    }
    case 5: {
      const len = length();
      const map = new Map();
      for (let i = 0; i < len; i++) {
        let key, value;
        [key, pos] = decodeItem(bytes, pos, depth + 1);
        [value, pos] = decodeItem(bytes, pos, depth + 1);
        if (typeof key !== 'number' && typeof key !== 'string')
          throw new Error('cbor: unsupported map key');
        if (map.has(key)) throw new Error(`cbor: duplicate map key ${key}`);
        map.set(key, value);
      }
      return [map, pos];
    }
    case 6: {
      let value;
      [value, pos] = decodeItem(bytes, pos, depth + 1);
      return [new Tagged(int(n), value), pos];
    }
  }
}

export const cbor = {
  encode(value) {
    const out = [];
    encodeItem(out, value, 0);
    return Uint8Array.from(out);
  },
  decode(bytes) {
    const [value, pos] = decodeItem(bytes, 0, 0);
    if (pos !== bytes.length) throw new Error('cbor: trailing bytes');
    return value;
  },
};

// --- CRC32 (IEEE, as in zlib) -----------------------------------------------

const CRC_TABLE = /* @__PURE__ */ (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const u32be = (n) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);

// --- Bytewords (BCR-2020-012), minimal style ---------------------------------
// One four-letter word per byte; the minimal style keeps each word's first and
// last letter. A CRC32 of the payload is appended before encoding.

const WORDS =
  'ableacidalsoapexaquaarchatomauntawayaxisbackbaldbarnbeltbetabiasbluebodybragbrewbulbbuzzcalmcashcatschefcityclawcodecolacookcostcruxcurlcuspcyandarkdatadaysdelidicedietdoordowndrawdropdrumdulldutyeacheasyechoedgeepicevenexamexiteyesfactfairfernfigsfilmfishfizzflapflewfluxfoxyfreefrogfuelfundgalagamegeargemsgiftgirlglowgoodgraygrimgurugushgyrohalfhanghardhawkheathelphighhillholyhopehornhutsicedideaidleinchinkyintoirisironitemjadejazzjoinjoltjowljudojugsjumpjunkjurykeepkenokeptkeyskickkilnkingkitekiwiknoblamblavalazyleaflegsliarlimplionlistlogoloudloveluaulucklungmainmanymathmazememomenumeowmildmintmissmonknailnavyneednewsnextnoonnotenumbobeyoboeomitonyxopenovalowlspaidpartpeckplaypluspoempoolposepuffpumapurrquadquizraceramprealredorichroadrockroofrubyruinrunsrustsafesagascarsetssilkskewslotsoapsolosongstubsurfswantacotasktaxitenttiedtimetinytoiltombtoystriptunatwinuglyundouniturgeuservastveryvetovialvibeviewvisavoidvowswallwandwarmwaspwavewaxywebswhatwhenwhizwolfworkyankyawnyellyogayurtzapszerozestzinczonezoom';
const MINIMAL = /* @__PURE__ */ Array.from(
  { length: 256 },
  (_, i) => WORDS[i * 4] + WORDS[i * 4 + 3]
);
const MINIMAL_INDEX = /* @__PURE__ */ new Map(MINIMAL.map((word, i) => [word, i]));

export const bytewords = {
  encode(bytes) {
    let out = '';
    for (const b of bytes) out += MINIMAL[b];
    for (const b of u32be(crc32(bytes))) out += MINIMAL[b];
    return out;
  },
  decode(text) {
    const s = text.toLowerCase();
    // at least one payload byte plus the 4-byte checksum
    if (s.length % 2 || s.length < 10) throw new Error('bytewords: invalid length');
    const all = new Uint8Array(s.length / 2);
    for (let i = 0; i < all.length; i++) {
      const b = MINIMAL_INDEX.get(s.slice(i * 2, i * 2 + 2));
      if (b === undefined) throw new Error('bytewords: invalid word');
      all[i] = b;
    }
    const payload = all.subarray(0, -4);
    const expected = u32be(crc32(payload));
    if (expected.some((b, i) => all[payload.length + i] !== b))
      throw new Error('bytewords: checksum mismatch');
    return payload.slice();
  },
};

// --- Xoshiro256** seeded with SHA-256, and the samplers built on it ---------

const MASK64 = (1n << 64n) - 1n;
const rotl = (x, k) => ((x << k) | (x >> (64n - k))) & MASK64;
export class Xoshiro256 {
  /** @param seed - bytes or a string: SHA-256 of it fills the 256-bit state */
  constructor(seed) {
    const bytes = typeof seed === 'string' ? new TextEncoder().encode(seed) : seed;
    const digest = sha256(bytes);
    this.s = [0, 1, 2, 3].map((i) => {
      let v = 0n;
      for (let n = 0; n < 8; n++) v = (v << 8n) | BigInt(digest[i * 8 + n]);
      return v;
    });
  }
  next() {
    const s = this.s;
    const result = (rotl((s[1] * 5n) & MASK64, 7n) * 9n) & MASK64;
    const t = (s[1] << 17n) & MASK64;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 45n);
    return result;
  }
  // Number(bigint) rounds to nearest like the reference's uint64 -> double
  nextDouble() {
    return Number(this.next()) / 2 ** 64;
  }
  nextInt(low, high) {
    return Math.floor(this.nextDouble() * (high - low + 1)) + low;
  }
  nextData(count) {
    return Uint8Array.from({ length: count }, () => this.nextInt(0, 255));
  }
}

// Walker's alias method, ported operation for operation (index order included)
export class RandomSampler {
  constructor(probs) {
    const n = probs.length;
    const sum = probs.reduce((a, b) => a + b, 0);
    const P = probs.map((p) => (p * n) / sum);
    const S = [];
    const L = [];
    for (let i = n - 1; i >= 0; i--) (P[i] < 1 ? S : L).push(i);
    this.probs = new Array(n).fill(0);
    this.aliases = new Array(n).fill(0);
    while (S.length && L.length) {
      const a = S.pop();
      const g = L.pop();
      this.probs[a] = P[a];
      this.aliases[a] = g;
      P[g] += P[a] - 1;
      (P[g] < 1 ? S : L).push(g);
    }
    while (L.length) this.probs[L.pop()] = 1;
    while (S.length) this.probs[S.pop()] = 1; // numeric instability only
  }
  next(rng) {
    const r1 = rng();
    const r2 = rng();
    const i = Math.trunc(this.probs.length * r1);
    return r2 < this.probs[i] ? i : this.aliases[i];
  }
}

export function shuffled(items, rng) {
  const remaining = [...items];
  const result = [];
  while (remaining.length)
    result.push(...remaining.splice(rng.nextInt(0, remaining.length - 1), 1));
  return result;
}

export function chooseDegree(seqLen, rng) {
  const sampler = new RandomSampler(Array.from({ length: seqLen }, (_, i) => 1 / (i + 1)));
  return sampler.next(() => rng.nextDouble()) + 1;
}

/** Fragment indexes (sorted) mixed into part `seqNum`: the first seqLen parts are pure. */
export function chooseFragments(seqNum, seqLen, checksum) {
  if (seqNum <= seqLen) return [seqNum - 1];
  const seed = new Uint8Array(8);
  seed.set(u32be(seqNum), 0);
  seed.set(u32be(checksum), 4);
  const rng = new Xoshiro256(seed);
  const degree = chooseDegree(seqLen, rng);
  const all = Array.from({ length: seqLen }, (_, i) => i);
  return shuffled(all, rng)
    .slice(0, degree)
    .sort((a, b) => a - b);
}

// --- Fountain encoder / decoder -----------------------------------------------

export function findNominalFragmentLength(messageLen, minFragmentLen, maxFragmentLen) {
  const maxCount = Math.max(1, Math.floor(messageLen / minFragmentLen));
  let fragmentLen = messageLen;
  for (let count = 1; count <= maxCount; count++) {
    fragmentLen = Math.ceil(messageLen / count);
    if (fragmentLen <= maxFragmentLen) break;
  }
  return fragmentLen;
}

export function partitionMessage(message, fragmentLen) {
  const count = Math.ceil(message.length / fragmentLen);
  return Array.from({ length: count }, (_, i) => {
    const fragment = new Uint8Array(fragmentLen); // zero padding at the end
    fragment.set(message.subarray(i * fragmentLen, (i + 1) * fragmentLen));
    return fragment;
  });
}

const xorInto = (target, source) => {
  for (let i = 0; i < target.length; i++) target[i] ^= source[i];
};

export class FountainEncoder {
  constructor(message, maxFragmentLen, firstSeqNum = 0, minFragmentLen = 10) {
    this.messageLen = message.length;
    this.checksum = crc32(message);
    this.fragmentLen = findNominalFragmentLength(message.length, minFragmentLen, maxFragmentLen);
    this.fragments = partitionMessage(message, this.fragmentLen);
    this.seqNum = firstSeqNum;
  }
  get seqLen() {
    return this.fragments.length;
  }
  nextPart() {
    this.seqNum = (this.seqNum + 1) >>> 0;
    const data = new Uint8Array(this.fragmentLen);
    for (const i of chooseFragments(this.seqNum, this.seqLen, this.checksum))
      xorInto(data, this.fragments[i]);
    const { seqNum, seqLen, messageLen, checksum } = this;
    return { seqNum, seqLen, messageLen, checksum, data };
  }
}

export const partToCbor = (p) =>
  cbor.encode([p.seqNum, p.seqLen, p.messageLen, p.checksum, p.data]);
// Generous cap: ERC-4527 payloads are a few hundred bytes, and a hostile part
// must not make the receiver allocate gigabytes.
const MAX_MESSAGE = 1 << 20;
export function partFromCbor(bytes) {
  const v = cbor.decode(bytes);
  const isU32 = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff;
  if (!Array.isArray(v) || v.length !== 5 || !v.slice(0, 4).every(isU32))
    throw new Error('ur: invalid multi-part header');
  const [seqNum, seqLen, messageLen, checksum, data] = v;
  if (!(data instanceof Uint8Array) || !data.length) throw new Error('ur: invalid fragment');
  if (seqNum < 1 || messageLen < 1 || messageLen > MAX_MESSAGE)
    throw new Error('ur: invalid multi-part header');
  if (seqLen !== Math.ceil(messageLen / data.length))
    throw new Error('ur: fragment size does not match the sequence length');
  return { seqNum, seqLen, messageLen, checksum, data };
}

const keyOf = (indexes) => indexes.join(',');
export class FountainDecoder {
  constructor() {
    this.expected = undefined; // { seqLen, messageLen, checksum, fragmentLen }
    this.simple = new Map(); // fragment index -> data
    this.mixed = new Map(); // keyOf(indexes) -> { indexes, data }
    this.queue = [];
    this.result = undefined;
  }
  get received() {
    return this.simple.size;
  }
  /** Returns false for parts that carry no news (duplicates, after completion). */
  receive(part) {
    if (this.result) return false;
    const { seqLen, messageLen, checksum } = part;
    const fragmentLen = part.data.length;
    if (!this.expected) this.expected = { seqLen, messageLen, checksum, fragmentLen };
    const e = this.expected;
    if (
      e.seqLen !== seqLen ||
      e.messageLen !== messageLen ||
      e.checksum !== checksum ||
      e.fragmentLen !== fragmentLen
    )
      throw new Error('ur: part belongs to a different message');
    const before = this.simple.size + this.mixed.size;
    // seqNum 0 never comes from an encoder; it would select fragment -1
    if (part.seqNum < 1) throw new Error('ur: invalid sequence number');
    this.queue.push({ indexes: chooseFragments(part.seqNum, seqLen, checksum), data: part.data });
    while (!this.result && this.queue.length) {
      const p = this.queue.shift();
      if (p.indexes.length === 1) this.processSimple(p);
      else this.processMixed(p);
    }
    return !!this.result || this.simple.size + this.mixed.size !== before;
  }
  // `a` minus `b` when b's fragments are a strict subset of a's
  reduce(a, b) {
    if (b.indexes.length >= a.indexes.length || !b.indexes.every((i) => a.indexes.includes(i)))
      return a;
    const data = a.data.slice();
    xorInto(data, b.data);
    return { indexes: a.indexes.filter((i) => !b.indexes.includes(i)), data };
  }
  reduceMixedBy(p) {
    const mixed = new Map();
    for (const m of this.mixed.values()) {
      const r = this.reduce(m, p);
      if (r.indexes.length === 1) this.queue.push(r);
      else mixed.set(keyOf(r.indexes), r);
    }
    this.mixed = mixed;
  }
  processSimple(p) {
    const index = p.indexes[0];
    if (this.simple.has(index)) return;
    this.simple.set(index, p.data);
    if (this.simple.size === this.expected.seqLen) {
      const { messageLen, fragmentLen, checksum } = this.expected;
      const message = new Uint8Array(this.expected.seqLen * fragmentLen);
      for (const [i, data] of this.simple) message.set(data, i * fragmentLen);
      const result = message.slice(0, messageLen);
      if (crc32(result) !== checksum) {
        // start over rather than stay stuck on a poisoned fragment set
        Object.assign(this, new FountainDecoder());
        throw new Error('ur: message checksum mismatch');
      }
      this.result = result;
    } else this.reduceMixedBy(p);
  }
  processMixed(p) {
    if (this.mixed.has(keyOf(p.indexes))) return;
    let r = p;
    for (const [i, data] of this.simple) r = this.reduce(r, { indexes: [i], data });
    for (const m of this.mixed.values()) r = this.reduce(r, m);
    if (r.indexes.length === 1) return this.queue.push(r);
    this.reduceMixedBy(r);
    this.mixed.set(keyOf(r.indexes), r);
  }
}

// --- UR strings ----------------------------------------------------------------

const isType = (type) => /^[a-z0-9-]+$/.test(type);

/** Single-part UR string for a CBOR payload. */
export function encodeUR(type, payload) {
  if (!isType(type)) throw new Error(`ur: invalid type ${type}`);
  return `ur:${type}/${bytewords.encode(payload)}`;
}

/**
 * Splits a CBOR payload into UR parts. Payloads up to `maxFragmentLen` bytes
 * stay one single-part UR; longer ones become a fountain-coded sequence where
 * the first `seqLen` parts carry the message as-is and later parts mix
 * fragments, so a receiver that missed frames catches up from any of them.
 */
export class UREncoder {
  constructor(type, payload, maxFragmentLen = 200, firstSeqNum = 0, minFragmentLen = 10) {
    if (!isType(type)) throw new Error(`ur: invalid type ${type}`);
    this.type = type;
    this.payload = payload;
    this.fountain = new FountainEncoder(payload, maxFragmentLen, firstSeqNum, minFragmentLen);
  }
  get seqLen() {
    return this.fountain.seqLen;
  }
  get isSinglePart() {
    return this.seqLen === 1;
  }
  partString(part) {
    return `ur:${this.type}/${part.seqNum}-${part.seqLen}/${bytewords.encode(partToCbor(part))}`;
  }
  nextPart() {
    const part = this.fountain.nextPart();
    return this.isSinglePart ? encodeUR(this.type, this.payload) : this.partString(part);
  }
  /** The minimal complete set: the seqLen pure parts (one string when single-part). */
  pureParts() {
    if (this.isSinglePart) return [encodeUR(this.type, this.payload)];
    const { fragments, seqLen, messageLen, checksum } = this.fountain;
    return fragments.map((data, i) =>
      this.partString({ seqNum: i + 1, seqLen, messageLen, checksum, data })
    );
  }
}

function parseUR(text) {
  const s = text.trim().toLowerCase();
  if (!s.startsWith('ur:')) throw new Error('Not a UR: expected text starting with "ur:"');
  const [type, ...rest] = s.slice(3).split('/');
  if (!isType(type) || !rest.length || rest.length > 2 || rest.some((c) => !c))
    throw new Error('ur: malformed UR string');
  return { type, rest };
}

/** Decodes a single-part UR string: `{ type, payload }` (CBOR bytes). */
export function decodeUR(text) {
  const { type, rest } = parseUR(text);
  if (rest.length !== 1) throw new Error('ur: multi-part UR needs a URDecoder');
  return { type, payload: bytewords.decode(rest[0]) };
}

/**
 * Collects single- or multi-part UR strings (scanned frames, pasted lines)
 * until a message is complete. `types` restricts what is accepted, so a wrong
 * kind of QR fails on the first frame with a clear message.
 */
export class URDecoder {
  constructor(types) {
    this.types = types;
    this.type = undefined;
    this.fountain = new FountainDecoder();
    this.payload = undefined;
  }
  get isComplete() {
    return this.payload !== undefined;
  }
  /** `{ received, expected }` fragment counts; expected is undefined before the first part. */
  get progress() {
    const e = this.fountain.expected;
    return { received: this.fountain.received, expected: e && e.seqLen };
  }
  /** Feeds one UR string. Throws on malformed or foreign input; false = nothing new. */
  receive(text) {
    if (this.isComplete) return false;
    const { type, rest } = parseUR(text);
    if (this.types && !this.types.includes(type))
      throw new Error(`Expected ${this.types.map((t) => `ur:${t}`).join(' or ')}, got ur:${type}`);
    if (this.type && type !== this.type)
      throw new Error(`Expected more ur:${this.type} parts, got ur:${type}`);
    if (rest.length === 1) {
      this.payload = bytewords.decode(rest[0]);
      this.type = type;
      return true;
    }
    const seq = /^(\d+)-(\d+)$/.exec(rest[0]);
    if (!seq) throw new Error('ur: invalid sequence component');
    const part = partFromCbor(bytewords.decode(rest[1]));
    if (Number(seq[1]) !== part.seqNum || Number(seq[2]) !== part.seqLen)
      throw new Error('ur: sequence component does not match the part');
    this.type = type;
    const e = this.fountain.expected;
    if (
      e &&
      (e.seqLen !== part.seqLen ||
        e.messageLen !== part.messageLen ||
        e.checksum !== part.checksum ||
        e.fragmentLen !== part.data.length)
    )
      this.fountain = new FountainDecoder(); // a new message is on screen: start over
    const news = this.fountain.receive(part);
    if (this.fountain.result) this.payload = this.fountain.result;
    return news;
  }
}
