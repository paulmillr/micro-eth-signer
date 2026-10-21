// ERC-4527 registry types (eips.ethereum.org/EIPS/eip-4527) over ur.js CBOR:
// crypto-hdkey (cold -> hot: which key to watch), eth-sign-request (hot ->
// cold: what to sign) and eth-signature (cold -> hot: the signature).
// Field numbers and tags follow the ERC and Keystone's ur-registry-eth, whose
// reference URs examples/test/erc4527.test.ts reproduces byte for byte.
//
// The demo pairs a single key, which ERC-4527 calls a "solo key": a
// crypto-hdkey without chain code. Its origin key path has no components and
// carries the key's own BIP-32 fingerprint, so sign requests can name the key
// they are meant for (derivation-path) without any HD derivation.
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { addr } from '../../index.js';
import { cbor, Tagged } from './ur.js';

export const TAG = { uuid: 37, hdkey: 303, keypath: 304 };
export const DATA_TYPE = {
  transaction: 1, // legacy transaction: RLP of the unsigned (EIP-155) fields
  typedData: 2, // EIP-712 typed data JSON
  personalMessage: 3, // EIP-191 personal_sign payload
  typedTransaction: 4, // EIP-2718 typed transaction, unsigned
};

const isMap = (v) => v instanceof Map;
const isBytes = (v, len) => v instanceof Uint8Array && (len === undefined || v.length === len);
const isUint = (v, max) =>
  (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max) ||
  (typeof v === 'bigint' && v >= 0n && v <= BigInt(max));
const optional = (map, key, check, what) => {
  if (!map.has(key)) return undefined;
  const value = map.get(key);
  if (!check(value)) throw new Error(`${what}: invalid field ${key}`);
  return value;
};
const required = (map, key, check, what) => {
  if (!map.has(key)) throw new Error(`${what}: missing field ${key}`);
  return optional(map, key, check, what);
};
const untag = (value, tag, what) => {
  if (!(value instanceof Tagged) || value.tag !== tag)
    throw new Error(`${what}: expected CBOR tag ${tag}`);
  return value.value;
};
const decodeMap = (bytes, what) => {
  const map = cbor.decode(bytes);
  if (!isMap(map)) throw new Error(`${what}: expected a CBOR map`);
  return map;
};

/** BIP-32 key fingerprint: first 4 bytes of HASH160(compressed public key). */
export function fingerprint(publicKey) {
  const h = ripemd160(sha256(publicKey));
  return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}
export const fingerprintHex = (fp) => fp.toString(16).padStart(8, '0');

// --- crypto-keypath (#6.304) -------------------------------------------------
// { components: [{ index, hardened }], sourceFingerprint?, depth? }

export function encodeKeypath({ components, sourceFingerprint, depth }) {
  if (!components.length && !sourceFingerprint)
    throw new Error('crypto-keypath: an empty path needs the source fingerprint');
  const map = new Map([[1, components.flatMap((c) => [c.index, c.hardened])]]);
  if (sourceFingerprint !== undefined) map.set(2, sourceFingerprint);
  if (depth !== undefined) map.set(3, depth);
  return new Tagged(TAG.keypath, map);
}

export function decodeKeypath(value) {
  const what = 'crypto-keypath';
  const map = untag(value, TAG.keypath, what);
  if (!isMap(map)) throw new Error(`${what}: expected a CBOR map`);
  const flat = required(map, 1, (v) => Array.isArray(v) && v.length % 2 === 0, what);
  const components = [];
  for (let i = 0; i < flat.length; i += 2) {
    const [index, hardened] = [flat[i], flat[i + 1]];
    // ranges and wildcards describe key families; a signer needs one key
    if (!isUint(index, 0x7fffffff) || typeof hardened !== 'boolean')
      throw new Error(`${what}: only concrete child indexes are supported`);
    components.push({ index: Number(index), hardened });
  }
  const sourceFingerprint = optional(map, 2, (v) => isUint(v, 0xffffffff) && v !== 0, what);
  const depth = optional(map, 3, (v) => isUint(v, 255), what);
  if (!components.length && sourceFingerprint === undefined)
    throw new Error(`${what}: an empty path needs the source fingerprint`);
  return {
    components,
    sourceFingerprint: sourceFingerprint === undefined ? undefined : Number(sourceFingerprint),
    depth: depth === undefined ? undefined : Number(depth),
  };
}

/** `m/44'/60'/0'` style, prefixed with the source fingerprint when known. */
export function formatKeypath({ components, sourceFingerprint }) {
  const path = ['m', ...components.map((c) => `${c.index}${c.hardened ? "'" : ''}`)].join('/');
  return sourceFingerprint === undefined ? path : `[${fingerprintHex(sourceFingerprint)}] ${path}`;
}

// --- crypto-hdkey (#6.303), public keys only -------------------------------

export function encodeHDKey({ publicKey, chainCode, origin, parentFingerprint, name, source }) {
  if (!isBytes(publicKey, 33)) throw new Error('crypto-hdkey: expected a 33-byte public key');
  const map = new Map([[3, publicKey]]);
  if (chainCode !== undefined) map.set(4, chainCode);
  if (origin !== undefined) map.set(6, encodeKeypath(origin));
  if (parentFingerprint !== undefined) map.set(8, parentFingerprint);
  if (name !== undefined) map.set(9, name);
  if (source !== undefined) map.set(10, source);
  return cbor.encode(map);
}

export function decodeHDKey(bytes) {
  const what = 'crypto-hdkey';
  const map = decodeMap(bytes, what);
  // BCR-2020-007 fields ERC-4527 excludes: is-master needs a chain code and
  // is-private means secret material — neither belongs in a watch-only pairing
  if (map.get(2) === true) throw new Error('Refusing a pairing QR that contains a private key.');
  if (map.has(1)) throw new Error(`${what}: master keys are not supported`);
  const publicKey = required(map, 3, (v) => isBytes(v, 33) && (v[0] === 2 || v[0] === 3), what);
  const address = addr.fromPublicKey(publicKey); // throws for points off the curve
  const chainCode = optional(map, 4, (v) => isBytes(v, 32), what);
  const origin = map.has(6) ? decodeKeypath(map.get(6)) : undefined;
  const parentFingerprint = optional(map, 8, (v) => isUint(v, 0xffffffff) && v !== 0, what);
  const name = optional(map, 9, (v) => typeof v === 'string', what);
  const source = optional(map, 10, (v) => typeof v === 'string', what);
  return { publicKey, address, chainCode, origin, parentFingerprint, name, source };
}

// --- eth-sign-request ------------------------------------------------------------

/** UUID v4 bytes from the platform CSPRNG. */
export function randomRequestId() {
  const id = crypto.getRandomValues(new Uint8Array(16));
  id[6] = (id[6] & 0x0f) | 0x40;
  id[8] = (id[8] & 0x3f) | 0x80;
  return id;
}
export const uuidString = (id) =>
  bytesToHex(id).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
export const uuidBytes = (s) => hexToBytes(s.replaceAll('-', ''));

const chainInt = (id) => (id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : id);

export function encodeSignRequest({
  requestId,
  signData,
  dataType,
  chainId,
  derivationPath,
  address,
  origin,
}) {
  const map = new Map();
  if (requestId !== undefined) map.set(1, new Tagged(TAG.uuid, requestId));
  map.set(2, signData);
  map.set(3, dataType);
  map.set(4, chainInt(BigInt(chainId)));
  map.set(5, encodeKeypath(derivationPath));
  if (address !== undefined) map.set(6, hexToBytes(addr.parse(address).data));
  if (origin !== undefined) map.set(7, origin);
  return cbor.encode(map);
}

export function decodeSignRequest(bytes) {
  const what = 'eth-sign-request';
  const map = decodeMap(bytes, what);
  const requestId = map.has(1) ? untag(map.get(1), TAG.uuid, what) : undefined;
  if (requestId !== undefined && !isBytes(requestId, 16))
    throw new Error(`${what}: request id must be 16 bytes`);
  const signData = required(map, 2, (v) => isBytes(v), what);
  // data-type and chain-id carry CDDL defaults (1 and 1)
  const dataType = optional(map, 3, (v) => isUint(v, 0xffff), what) ?? DATA_TYPE.transaction;
  // CBOR decoding yields bigints only above 2^53, and never past 2^64 - 1
  const chain = optional(map, 4, (v) => isUint(v, Number.MAX_SAFE_INTEGER) || v > 0n, what);
  const chainId = chain === undefined ? 1n : BigInt(chain);
  if (chainId === 0n) throw new Error(`${what}: chain id must be positive`);
  if (!map.has(5)) throw new Error(`${what}: missing field 5`);
  const derivationPath = decodeKeypath(map.get(5));
  const addressBytes = optional(map, 6, (v) => isBytes(v, 20), what);
  const origin = optional(map, 7, (v) => typeof v === 'string', what);
  return {
    requestId,
    signData,
    dataType: Number(dataType),
    chainId,
    derivationPath,
    address: addressBytes && addr.addChecksum(bytesToHex(addressBytes)),
    origin,
  };
}

// --- eth-signature -----------------------------------------------------------------

/**
 * `signature` is r || s || v: v is the y-parity (0/1) for typed transactions,
 * the EIP-155 value (chainId * 2 + 35 + parity, big-endian — more than one
 * byte past chain id 109) for legacy ones, and 27/28 for messages.
 */
export function encodeSignature({ requestId, signature, origin }) {
  const map = new Map([
    [1, new Tagged(TAG.uuid, requestId)],
    [2, signature],
  ]);
  if (origin !== undefined) map.set(3, origin);
  return cbor.encode(map);
}

export function decodeSignature(bytes) {
  const what = 'eth-signature';
  const map = decodeMap(bytes, what);
  if (!map.has(1)) throw new Error(`${what}: missing request id`);
  const requestId = untag(map.get(1), TAG.uuid, what);
  if (!isBytes(requestId, 16)) throw new Error(`${what}: request id must be 16 bytes`);
  const signature = required(map, 2, (v) => isBytes(v) && v.length >= 65 && v.length <= 72, what);
  const origin = optional(map, 3, (v) => typeof v === 'string', what);
  return { requestId, signature, origin };
}

/** Splits r || s || v: `{ r, s, v }` as bigints. */
export function splitSignature(signature) {
  const num = (b) => (b.length ? BigInt(`0x${bytesToHex(b)}`) : 0n);
  return {
    r: num(signature.subarray(0, 32)),
    s: num(signature.subarray(32, 64)),
    v: num(signature.subarray(64)),
  };
}
