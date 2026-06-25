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

function lengthOfLength(length: number): number {
  if (!Number.isSafeInteger(length) || length < 0) throw new Error(`RLP: wrong length=${length}`);
  if (length < SHORT_LENGTH_LIMIT) return 1;
  const lengthBytes = P.U32BE.encode(length);
  let pos = 0;
  for (; pos < lengthBytes.length; pos++) if (lengthBytes[pos] !== 0) break;
  return 1 + lengthBytes.length - pos;
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
      if (data < BigInt(0))
        throw new Error('RLP.encode: invalid integer as argument, must be unsigned');
      return lengthOfBytes(data === BigInt(0) ? empty : numberToVarBytesBE(data));
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
  const lengthBytes = P.U32BE.encode(length);
  let pos = 0;
  for (; pos < lengthBytes.length; pos++) if (lengthBytes[pos] !== 0) break;
  const lenLen = lengthBytes.length - pos;
  w.byte(offset + 55 + lenLen);
  w.bytes(lengthBytes.subarray(pos));
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
      if (data < BigInt(0))
        throw new Error('RLP.encode: invalid integer as argument, must be unsigned');
      return writeBytes(w, data === BigInt(0) ? empty : numberToVarBytesBE(data));
    case 'string':
      return writeBytes(w, data.startsWith('0x') ? phex.encode(data) : pstr.encode(data));
    default:
      throw new Error('RLP.encode: unknown type');
  }
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

/**
 * RLP parser.
 * Real type of rlp is `Item = Uint8Array | Item[]`.
 * Strings/number encoded to Uint8Array, but not decoded back: type information is lost.
 */
export const RLP: TRet<P.CoderType<RLPInput>> = /* @__PURE__ */ deepFreeze(
  P.wrap({
    encodeStream,
    decodeStream,
  })
) as TRet<P.CoderType<RLPInput>>;
