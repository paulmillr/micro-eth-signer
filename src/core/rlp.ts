import { numberToVarBytesBE } from '@noble/curves/utils.js';
import * as P from 'micro-packed';
import { deepFreeze, isBytes, type Bytes, type TArg, type TRet } from '../utils.ts';

// Spec-compliant RLP coder.
/** Public input accepted by the RLP encoder. */
export type RLPInput = string | number | Bytes | bigint | RLPInput[] | null;

/** Internal tagged RLP tree shape kept for compatibility with older type imports. */
export type InternalRLP =
  | {
      /** Single-byte item encoded without an RLP length prefix. */
      TAG: 'byte';
      /** Byte value in the `0..127` short-form range. */
      data: number;
    }
  | {
      /** Multi-byte string or nested list item. */
      TAG: 'complex';
      /** Tagged payload for one string or list item. */
      data:
        | {
            /** Byte-string payload. */
            TAG: 'string';
            /** Raw string bytes. */
            data: Uint8Array;
          }
        | {
            /** Nested list payload. */
            TAG: 'list';
            /** Nested RLP items. */
            data: InternalRLP[];
          };
    };

// Ethereum JSON-RPC Data uses 0x-prefixed byte strings; keep that separate from
// plain UTF-8 strings.
const phex = P.hex(null, { with0x: true });
const pstr = P.string(null);
const empty = Uint8Array.of();
const SHORT_LENGTH_LIMIT = 56;
const BIGINT_0 = BigInt(0);

type PreparedRLP =
  | { TAG: 'bytes'; length: number; data: Uint8Array }
  | { TAG: 'list'; length: number; payloadLength: number; data: PreparedRLP[] };

function lengthOfLength(length: number): number {
  if (!Number.isSafeInteger(length) || length < 0) throw new Error(`RLP: wrong length=${length}`);
  if (length < SHORT_LENGTH_LIMIT) return 1;
  if (length < 0x100) return 2;
  if (length < 0x10000) return 3;
  if (length < 0x1000000) return 4;
  if (length < 0x100000000) return 5;
  throw new Error(`RLP: wrong length=${length}`);
}

function lengthByteLength(length: number): number {
  if (!Number.isSafeInteger(length) || length < SHORT_LENGTH_LIMIT)
    throw new Error(`RLP: wrong length=${length}`);
  if (length < 0x100) return 1;
  if (length < 0x10000) return 2;
  if (length < 0x1000000) return 3;
  if (length < 0x100000000) return 4;
  throw new Error(`RLP: wrong length=${length}`);
}

function lengthOfBytes(data: Uint8Array): number {
  return data.length === 1 && data[0] < 0x80 ? 1 : lengthOfLength(data.length) + data.length;
}

function encodedLength(data: TArg<RLPInput>): number {
  if (data == null) return lengthOfBytes(empty);
  switch (typeof data) {
    case 'object': {
      if (isBytes(data)) return lengthOfBytes(data);
      if (!Array.isArray(data)) throw new Error('RLP.encode: unknown type');
      let length = 0;
      for (let i = 0; i < data.length; i++) {
        if (!Object.hasOwn(data, i)) throw new Error(`RLP.encode: missing array item ${i}`);
        length += encodedLength(data[i]);
      }
      return lengthOfLength(length) + length;
    }
    case 'number':
      if (data < 0) throw new Error('RLP.encode: invalid integer as argument, must be unsigned');
      return lengthOfBytes(data === 0 ? empty : numberToVarBytesBE(data));
    case 'bigint':
      if (data < BIGINT_0)
        throw new Error('RLP.encode: invalid integer as argument, must be unsigned');
      return lengthOfBytes(data === BIGINT_0 ? empty : numberToVarBytesBE(data));
    case 'string':
      return lengthOfBytes(data.startsWith('0x') ? phex.encode(data) : pstr.encode(data));
    default:
      throw new Error('RLP.encode: unknown type');
  }
}

function writeLength(w: P.Writer, offset: number, length: number) {
  if (!Number.isSafeInteger(length) || length < 0) throw new Error(`RLP: wrong length=${length}`);
  if (length < SHORT_LENGTH_LIMIT) {
    w.byte(offset + length);
    return;
  }
  const lenLen = lengthByteLength(length);
  w.byte(offset + 55 + lenLen);
  for (let shift = (lenLen - 1) * 8; shift >= 0; shift -= 8) w.byte((length >>> shift) & 0xff);
}

function writeBytes(w: P.Writer, data: Uint8Array) {
  if (data.length === 1 && data[0] < 0x80) {
    w.byte(data[0]);
    return;
  }
  writeLength(w, 0x80, data.length);
  w.bytes(data);
}

function encodeStream(w: P.Writer, data: TArg<RLPInput>) {
  if (data == null) return writeBytes(w, empty);
  switch (typeof data) {
    case 'object': {
      if (isBytes(data)) return writeBytes(w, data);
      if (!Array.isArray(data)) throw new Error('RLP.encode: unknown type');
      let length = 0;
      for (let i = 0; i < data.length; i++) {
        if (!Object.hasOwn(data, i)) throw new Error(`RLP.encode: missing array item ${i}`);
        length += encodedLength(data[i]);
      }
      writeLength(w, 0xc0, length);
      for (const item of data) encodeStream(w, item);
      return;
    }
    case 'number':
      if (data < 0) throw new Error('RLP.encode: invalid integer as argument, must be unsigned');
      return writeBytes(w, data === 0 ? empty : numberToVarBytesBE(data));
    case 'bigint':
      if (data < BIGINT_0)
        throw new Error('RLP.encode: invalid integer as argument, must be unsigned');
      return writeBytes(w, data === BIGINT_0 ? empty : numberToVarBytesBE(data));
    case 'string':
      return writeBytes(w, data.startsWith('0x') ? phex.encode(data) : pstr.encode(data));
    default:
      throw new Error('RLP.encode: unknown type');
  }
}

function prepareBytes(data: Uint8Array): PreparedRLP {
  return { TAG: 'bytes', length: lengthOfBytes(data), data };
}

function prepareRLP(data: TArg<RLPInput>): PreparedRLP {
  if (data == null) return prepareBytes(empty);
  switch (typeof data) {
    case 'object': {
      if (isBytes(data)) return prepareBytes(data);
      if (!Array.isArray(data)) throw new Error('RLP.encode: unknown type');
      let payloadLength = 0;
      const items = new Array<PreparedRLP>(data.length);
      for (let i = 0; i < data.length; i++) {
        if (!Object.hasOwn(data, i)) throw new Error(`RLP.encode: missing array item ${i}`);
        const item = prepareRLP(data[i]);
        items[i] = item;
        payloadLength += item.length;
      }
      return {
        TAG: 'list',
        length: lengthOfLength(payloadLength) + payloadLength,
        payloadLength,
        data: items,
      };
    }
    case 'number':
      if (data < 0) throw new Error('RLP.encode: invalid integer as argument, must be unsigned');
      return prepareBytes(data === 0 ? empty : numberToVarBytesBE(data));
    case 'bigint':
      if (data < BIGINT_0)
        throw new Error('RLP.encode: invalid integer as argument, must be unsigned');
      return prepareBytes(data === BIGINT_0 ? empty : numberToVarBytesBE(data));
    case 'string':
      return prepareBytes(data.startsWith('0x') ? phex.encode(data) : pstr.encode(data));
    default:
      throw new Error('RLP.encode: unknown type');
  }
}

function writeLengthTo(out: Uint8Array, pos: number, offset: number, length: number): number {
  if (!Number.isSafeInteger(length) || length < 0) throw new Error(`RLP: wrong length=${length}`);
  if (length < SHORT_LENGTH_LIMIT) {
    out[pos++] = offset + length;
    return pos;
  }
  const lenLen = lengthByteLength(length);
  out[pos++] = offset + 55 + lenLen;
  for (let shift = (lenLen - 1) * 8; shift >= 0; shift -= 8) out[pos++] = (length >>> shift) & 0xff;
  return pos;
}

function writePrepared(out: Uint8Array, pos: number, item: PreparedRLP): number {
  if (item.TAG === 'bytes') {
    const data = item.data;
    if (data.length === 1 && data[0] < 0x80) {
      out[pos++] = data[0];
      return pos;
    }
    pos = writeLengthTo(out, pos, 0x80, data.length);
    out.set(data, pos);
    return pos + data.length;
  }
  pos = writeLengthTo(out, pos, 0xc0, item.payloadLength);
  for (let i = 0; i < item.data.length; i++) pos = writePrepared(out, pos, item.data[i]);
  return pos;
}

function encode(data: TArg<RLPInput>): TRet<Bytes> {
  const prepared = prepareRLP(data);
  const out = new Uint8Array(prepared.length);
  const pos = writePrepared(out, 0, prepared);
  if (pos !== out.length) throw new Error('RLP.encode: internal length mismatch');
  return out as TRet<Bytes>;
}

function readLength(r: P.Reader, lenLen: number, limit: number): number {
  if (r.pos + lenLen > limit) throw r.err('RLP: Unexpected end of buffer');
  const bytes = r.bytes(lenLen);
  if (bytes[0] === 0) throw new Error('Wrong length encoding with leading zeros');
  let length = 0;
  for (const byte of bytes) {
    length = length * 256 + byte;
    if (!Number.isSafeInteger(length)) throw new Error('RLP: length exceeds safe integer range');
  }
  if (length <= 55) throw new Error('RLPLength: less than 55, but used multi-byte flag');
  return length;
}

function assertReadable(r: P.Reader, length: number, limit: number) {
  if (!Number.isSafeInteger(length) || length < 0 || r.pos + length > limit)
    throw r.err('RLP: Unexpected end of buffer');
}

function readBytes(r: P.Reader, length: number, limit: number): Uint8Array {
  assertReadable(r, length, limit);
  const bytes = r.bytes(length);
  if (length === 1 && bytes[0] < 0x80)
    throw new Error('RLP.decode: wrong string length encoding, should use single byte mode');
  return bytes;
}

function readList(r: P.Reader, length: number, limit: number): RLPInput[] {
  assertReadable(r, length, limit);
  const end = r.pos + length;
  const res = [];
  while (r.pos < end) res.push(decodeStream(r, end));
  if (r.pos !== end) throw r.err('RLP: list length mismatch');
  return res;
}

function decodeStream(r: P.Reader, limit = r.totalBytes): RLPInput {
  if (r.pos >= limit) throw r.err('RLP: Unexpected end of buffer');
  const first = r.byte(true);
  if (first < 0x80) return r.bytes(1);
  r.byte();
  if (first < 0xb8) return readBytes(r, first - 0x80, limit);
  if (first < 0xc0) return readBytes(r, readLength(r, first - 0xb7, limit), limit);
  if (first < 0xf8) return readList(r, first - 0xc0, limit);
  return readList(r, readLength(r, first - 0xf7, limit), limit);
}

function assertDirectReadable(pos: number, length: number, limit: number) {
  if (!Number.isSafeInteger(length) || length < 0 || length > limit - pos)
    throw new Error('RLP: Unexpected end of buffer');
}

type DecodeCursor = { data: Uint8Array; pos: number };

function readDirectLength(cursor: DecodeCursor, lenLen: number, limit: number): number {
  const { data } = cursor;
  const pos = cursor.pos;
  if (pos + lenLen > limit) throw new Error('RLP: Unexpected end of buffer');
  if (data[pos] === 0) throw new Error('Wrong length encoding with leading zeros');
  let length = 0;
  for (let i = 0; i < lenLen; i++) {
    length = length * 256 + data[pos + i];
    if (!Number.isSafeInteger(length)) throw new Error('RLP: length exceeds safe integer range');
  }
  if (length <= 55) throw new Error('RLPLength: less than 55, but used multi-byte flag');
  cursor.pos = pos + lenLen;
  return length;
}

function readDirectBytes(cursor: DecodeCursor, length: number, limit: number): Uint8Array {
  const { data, pos } = cursor;
  assertDirectReadable(pos, length, limit);
  const bytes = data.subarray(pos, pos + length);
  if (length === 1 && bytes[0] < 0x80)
    throw new Error('RLP.decode: wrong string length encoding, should use single byte mode');
  cursor.pos = pos + length;
  return bytes;
}

function readDirectList(cursor: DecodeCursor, length: number, limit: number): RLPInput[] {
  let { pos } = cursor;
  assertDirectReadable(pos, length, limit);
  const end = pos + length;
  const res: RLPInput[] = [];
  while (pos < end) {
    res.push(decodeAt(cursor, end));
    pos = cursor.pos;
  }
  if (pos !== end) throw new Error('RLP: list length mismatch');
  return res;
}

function decodeAt(cursor: DecodeCursor, limit: number): RLPInput {
  const { data } = cursor;
  let pos = cursor.pos;
  if (pos >= limit) throw new Error('RLP: Unexpected end of buffer');
  const first = data[pos++];
  cursor.pos = pos;
  if (first < 0x80) return data.subarray(pos - 1, pos);
  if (first < 0xb8) return readDirectBytes(cursor, first - 0x80, limit);
  if (first < 0xc0) {
    const length = readDirectLength(cursor, first - 0xb7, limit);
    return readDirectBytes(cursor, length, limit);
  }
  if (first < 0xf8) return readDirectList(cursor, first - 0xc0, limit);
  const length = readDirectLength(cursor, first - 0xf7, limit);
  return readDirectList(cursor, length, limit);
}

function decode(data: TArg<Bytes>, opts: P.ReaderOpts = {}): RLPInput {
  const input = data as Uint8Array;
  const cursor = { data: input, pos: 0 };
  const decoded = decodeAt(cursor, input.length);
  if (!opts.allowUnreadBytes && cursor.pos !== input.length)
    throw new Error('RLP.decode: unexpected trailing bytes');
  return decoded;
}

/**
 * RLP parser.
 * Real type of rlp is `Item = Uint8Array | Item[]`.
 * Strings/number encoded to Uint8Array, but not decoded back: type information is lost.
 */
const rlpStream = /* @__PURE__ */ P.wrap({
  encodeStream,
  decodeStream,
});
export const RLP: TRet<P.CoderType<RLPInput>> = /* @__PURE__ */ deepFreeze({
  ...rlpStream,
  encode,
  decode,
}) as TRet<P.CoderType<RLPInput>>;
