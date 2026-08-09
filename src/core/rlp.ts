import { numberToVarBytesBE } from '@noble/curves/utils.js';
// Type-only: RLP must stay composable inside micro-packed structures (tx envelopes pass their
// Reader/Writer into the stream methods below), but needs none of the library at runtime.
import type * as P from 'micro-packed';
import { deepFreeze, ethHex, isBytes, type Bytes, type TRet } from '../utils.ts';

// Spec-compliant RLP. Optimized: the encoder measures the tree first, then writes into a single
// pre-allocated buffer; the decoder is index-based and returns subarrays of the input.
/** Public input accepted by the RLP encoder. */
export type RLPInput = string | number | Bytes | bigint | RLPInput[] | null;

// Ethereum JSON-RPC Data uses 0x-prefixed byte strings; keep that separate from
// plain UTF-8 strings. ethHex.decode pads odd-length hex, which would make distinct
// inputs encode identically — keep rejecting it.
const hexToBytes = (s: string): Bytes => {
  if (s.length % 2) throw new Error(`RLP.encode: hex string with odd length: ${s}`);
  return ethHex.decode(s);
};
const utf8 = /* @__PURE__ */ new TextEncoder();
const empty = Uint8Array.of();

// Number of bytes needed to store a length in the long form of a prefix.
const lenLen = (n: number): number => {
  let res = 1;
  while ((n = Math.floor(n / 256)) > 0) res++;
  return res;
};

// Measured tree: leaves hold their bytes, lists cache the payload size.
// `total` is the full encoded size including the prefix.
type Measured = {
  bytes: Bytes | null;
  items: Measured[] | null;
  payload: number;
  total: number;
};

const leaf = (bytes: Bytes): Measured => {
  const len = bytes.length;
  let total;
  if (len === 1 && bytes[0] < 0x80)
    total = 1; // single byte, encoded as-is without a prefix
  else if (len < 56) total = 1 + len;
  else total = 1 + lenLen(len) + len;
  return { bytes, items: null, payload: 0, total };
};

const numberToBytes = (n: number): Bytes => {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error('RLP.encode: invalid integer as argument, must be unsigned');
  if (n === 0) return empty;
  let len = 0;
  for (let i = n; i >= 1; i /= 256) len++;
  // Split into two 32-bit halves so writing can use bitwise ops (safe integers are up to 2^53).
  let hi = Math.floor(n / 0x100000000);
  let lo = n % 0x100000000;
  const res = new Uint8Array(len);
  let i = len - 1;
  for (; i >= 0 && i >= len - 4; i--) {
    res[i] = lo & 0xff;
    lo >>>= 8;
  }
  for (; i >= 0; i--) {
    res[i] = hi & 0xff;
    hi >>>= 8;
  }
  return res;
};
const maxSafeInteger = /* @__PURE__ */ BigInt(Number.MAX_SAFE_INTEGER);

const measure = (data: RLPInput): Measured => {
  if (data == null) return leaf(empty);
  if (isBytes(data)) return leaf(data);
  if (Array.isArray(data)) {
    const items: Measured[] = new Array(data.length);
    let payload = 0;
    for (let i = 0; i < data.length; i++) payload += (items[i] = measure(data[i])).total;
    const total = payload < 56 ? 1 + payload : 1 + lenLen(payload) + payload;
    return { bytes: null, items, payload, total };
  }
  switch (typeof data) {
    case 'number':
      return leaf(numberToBytes(data));
    case 'bigint':
      if (data < BigInt(0))
        throw new Error('RLP.encode: invalid integer as argument, must be unsigned');
      // Small bigints (nonces, gas, chain ids) take the cheaper number path.
      return leaf(data <= maxSafeInteger ? numberToBytes(Number(data)) : numberToVarBytesBE(data));
    case 'string':
      return leaf(data.startsWith('0x') ? hexToBytes(data) : utf8.encode(data));
    default:
      throw new Error('RLP.encode: unknown type');
  }
};

// Short form: single byte `offset + len`. Long form: `offset + 55 + lenLen(len)`, then the
// big-endian bytes of len itself.
const writePrefix = (out: Uint8Array, pos: number, offset: number, len: number): number => {
  if (len < 56) {
    out[pos++] = offset + len;
    return pos;
  }
  const ll = lenLen(len);
  out[pos++] = offset + 55 + ll;
  for (let i = ll - 1, n = len; i >= 0; i--) {
    out[pos + i] = n % 256;
    n = Math.floor(n / 256);
  }
  return pos + ll;
};

const writeNode = (node: Measured, out: Uint8Array, pos: number): number => {
  const bytes = node.bytes;
  if (bytes !== null) {
    const len = bytes.length;
    if (len === 1 && bytes[0] < 0x80) {
      out[pos] = bytes[0];
      return pos + 1;
    }
    pos = writePrefix(out, pos, 0x80, len);
    out.set(bytes, pos);
    return pos + len;
  }
  pos = writePrefix(out, pos, 0xc0, node.payload);
  for (const item of node.items!) pos = writeNode(item, out, pos);
  return pos;
};

const rlpEncode = (data: RLPInput): Bytes => {
  const root = measure(data);
  const out = new Uint8Array(root.total);
  writeNode(root, out, 0);
  return out;
};

// Decodes one item starting at offset; strict mode requires it to span exactly [offset, end),
// while the public reader option permits a trailing outer buffer. Canonical item checks remain.
// NOTE: returned Uint8Arrays are subarrays of the input, same as before. Do not modify.
const rlpDecodeSlice = (
  d: Bytes,
  offset: number,
  end: number,
  allowUnreadBytes = false
): RLPInput => {
  let pos = offset;
  const readLength = (lengthLen: number, boundary: number): number => {
    if (pos + lengthLen > boundary) throw new Error('RLP.decode: out of range');
    if (d[pos] === 0) throw new Error('RLP.decode: wrong length encoding with leading zeros');
    let len = 0;
    for (let i = 0; i < lengthLen; i++) len = len * 256 + d[pos++];
    if (len < 56) throw new Error('RLP.decode: length less than 56, but used multi-byte flag');
    return len;
  };
  const item = (boundary: number): RLPInput => {
    if (pos >= boundary) throw new Error('RLP.decode: out of range');
    const first = d[pos++];
    if (first < 0x80) return d.subarray(pos - 1, pos); // single byte, no prefix
    let len: number;
    let isList = false;
    if (first < 0xb8) len = first - 0x80;
    else if (first < 0xc0) len = readLength(first - 0xb7, boundary);
    else if (first < 0xf8) {
      len = first - 0xc0;
      isList = true;
    } else {
      len = readLength(first - 0xf7, boundary);
      isList = true;
    }
    const itemEnd = pos + len;
    if (itemEnd > boundary) throw new Error('RLP.decode: out of range');
    if (!isList) {
      if (len === 1 && d[pos] < 0x80)
        throw new Error('RLP.decode: wrong string length encoding, should use single byte mode');
      const res = d.subarray(pos, itemEnd);
      pos = itemEnd;
      return res;
    }
    const items: RLPInput[] = [];
    while (pos < itemEnd) items.push(item(itemEnd));
    return items;
  };
  const res = item(end);
  if (!allowUnreadBytes && pos !== end) throw new Error('RLP.decode: unread bytes left');
  return res;
};

const rlpDecode = (data: Bytes, opts?: P.ReaderOpts): RLPInput => {
  if (!isBytes(data)) throw new Error('RLP.decode: expected Uint8Array');
  return rlpDecodeSlice(data, 0, data.length, opts?.allowUnreadBytes);
};

// Reads the length bytes of a long-form prefix without advancing the reader.
const peekLength = (r: P.Reader, lengthLen: number): number => {
  const header = r.bytes(1 + lengthLen, true);
  let len = 0;
  for (let i = 1; i < header.length; i++) len = len * 256 + header[i];
  return len;
};

/**
 * RLP parser.
 * Real type of rlp is `Item = Uint8Array | Item[]`.
 * Strings/number encoded to Uint8Array, but not decoded back: type information is lost.
 */
// Plain object with the CoderType shape (P.wrap would only re-derive encode/decode from the
// streams, which the flat implementations replace anyway).
export const RLP: TRet<P.CoderType<RLPInput>> = /* @__PURE__ */ deepFreeze({
  size: undefined,
  encodeStream: (w: P.Writer, value: RLPInput): void => w.bytes(rlpEncode(value)),
  // Consumes exactly one item from the stream: total size is derived from the prefix, then the
  // item is decoded from the consumed slice (which re-validates the prefix canonically).
  decodeStream: (r: P.Reader): RLPInput => {
    const first = r.byte(true);
    let total: number;
    if (first < 0x80) total = 1;
    else if (first < 0xb8) total = 1 + (first - 0x80);
    else if (first < 0xc0) total = 1 + (first - 0xb7) + peekLength(r, first - 0xb7);
    else if (first < 0xf8) total = 1 + (first - 0xc0);
    else total = 1 + (first - 0xf7) + peekLength(r, first - 0xf7);
    return rlpDecodeSlice(r.bytes(total), 0, total);
  },
  encode: rlpEncode,
  decode: rlpDecode,
}) as TRet<P.CoderType<RLPInput>>;
