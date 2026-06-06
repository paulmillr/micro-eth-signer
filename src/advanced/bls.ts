/**
 * Deterministic producer of ETH validator keys. Implements:
 *
 * - [EIP-2333](https://eips.ethereum.org/EIPS/eip-2333): BLS12-381 Key Generation
 * - [EIP-2334](https://eips.ethereum.org/EIPS/eip-2334): BLS12-381 Deterministic Account Hierarchy
 * - [EIP-2335](https://eips.ethereum.org/EIPS/eip-2335): BLS12-381 Keystore
 *
 * @module
 */
import { ctr } from '@noble/ciphers/aes.js';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { abytes, numberToBytesBE } from '@noble/curves/utils.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  isBytes,
  randomBytes,
  type TArg,
  type TRet,
  utf8ToBytes,
} from '@noble/hashes/utils.js';
import { deepFreeze } from '../utils.ts';

// treeshake: single helpers should not keep the full longSignatures/fields objects live.
const getPublicKey = /* @__PURE__ */ (() => bls12_381.longSignatures.getPublicKey)();
const Fr = /* @__PURE__ */ (() => bls12_381.fields.Fr)();
const _0n = /* @__PURE__ */ BigInt(0);
const _1n = /* @__PURE__ */ BigInt(1);
const _8n = /* @__PURE__ */ BigInt(8);

// Octet Stream to Integer
function os2ip(bytes: TArg<Uint8Array>): bigint {
  let result = _0n;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    result <<= _8n;
    result += BigInt(byte);
  }
  return result;
}

// Integer to Octet Stream
// Narrow RFC 8017 helper: current callers only serialize uint32-scale values,
// so the JS-number + >>> loop is intentionally not a general bigint I2OSP.
function i2osp(value: number, length: number): TRet<Uint8Array> {
  if (value < 0 || value >= _1n << BigInt(8 * length)) {
    throw new RangeError(`bad I2OSP call: value=${value} length=${length}`);
  }
  const res = Array.from({ length }).fill(0) as number[];
  for (let i = length - 1; i >= 0; i--) {
    res[i] = value & 0xff;
    value >>>= 8;
  }
  return new Uint8Array(res);
}

function ikmToLamportSK(ikm: TArg<Uint8Array>, salt: TArg<Uint8Array>) {
  // ERC-2333 IKM_to_lamport_SK: HKDF-Expand uses info="" and L=32*255,
  // so split the OKM into 255 SHA-256-sized Lamport chunks.
  const okm = hkdf(sha256, ikm, salt, undefined, 32 * 255);
  return Array.from({ length: 255 }, (_, i) => okm.slice(i * 32, (i + 1) * 32));
}

function assertUint32(index: number) {
  if (typeof index !== 'number') throw new TypeError('Expected uint32 number');
  if (!Number.isSafeInteger(index) || index < 0 || index > 2 ** 32 - 1)
    throw new RangeError('Expected valid uint32 number');
}

function parentSKToLamportPK(parentSK: TArg<Uint8Array>, index: number): TRet<Uint8Array> {
  // ERC-2333 parent_SK_to_lamport_PK step 1 is IKM = I2OSP(parent_SK, 32),
  // so only the canonical 32-byte parent secret encoding is accepted.
  parentSK = abytes(parentSK, 32, 'parentSK');
  assertUint32(index);
  const salt = i2osp(index, 4);
  const ikm = parentSK;
  const lamport0 = ikmToLamportSK(ikm, salt);
  const notIkm = ikm.map((byte) => ~byte);
  const lamport1 = ikmToLamportSK(notIkm, salt);
  const lamportPK = lamport0.concat(lamport1).map((part) => sha256(part));
  return sha256(concatBytes(...lamportPK));
}

/**
 * Low-level primitive from EIP2333, generates key from bytes.
 * KeyGen from {@link https://www.ietf.org/archive/id/draft-irtf-cfrg-bls-signature-05.html#name-keygen | the CFRG BLS signature draft}.
 * @param ikm - secret octet string
 * @param keyInfo - additional key information
 * @returns Derived BLS secret key bytes.
 * @throws On input keying material shorter than 32 bytes. {@link RangeError}
 * ERC-2333 / draft-04 KeyGen require `ikm` to be at least 32 bytes;
 * shorter inputs are outside the specified domain.
 * @example
 * Feed raw input keying material into the EIP-2333 keygen primitive.
 * ```ts
 * import { randomBytes } from '@noble/hashes/utils.js';
 * import { hkdfModR } from 'micro-eth-signer/advanced/bls.js';
 * hkdfModR(randomBytes(32));
 * ```
 */
export function hkdfModR(
  ikm: TArg<Uint8Array>,
  keyInfo: TArg<Uint8Array> = Uint8Array.of()
): TRet<Uint8Array> {
  ikm = abytes(ikm, undefined, 'ikm');
  // ERC-2333 hkdf_mod_r input requires IKM to be a secret octet string >= 256 bits.
  if (ikm.length < 32) throw new RangeError('Expected ikm to be at least 32 bytes');
  keyInfo = abytes(keyInfo, undefined, 'key information');
  let salt = utf8ToBytes('BLS-SIG-KEYGEN-SALT-');
  let SK = _0n;
  const input = concatBytes(ikm, Uint8Array.from([0x00]));
  const label = concatBytes(keyInfo, Uint8Array.from([0x00, 0x30]));
  while (SK === _0n) {
    salt = sha256(salt);
    const okm = hkdf(sha256, input, salt, label, 48);
    SK = Fr.create(os2ip(okm));
  }
  return numberToBytesBE(SK, 32);
}

/**
 * Derives the EIP-2333 master secret key from a seed.
 * @param seed - Seed bytes.
 * @returns Master secret key bytes.
 * @throws On seed values shorter than 32 bytes. {@link RangeError}
 * ERC-2333 requires `seed` to contain at least 32 bytes of source entropy.
 * @example
 * Start from fresh entropy and derive the BLS root secret defined by EIP-2333.
 * ```ts
 * import { randomBytes } from '@noble/hashes/utils.js';
 * import { deriveMaster } from 'micro-eth-signer/advanced/bls.js';
 * const seed = randomBytes(32);
 * deriveMaster(seed);
 * ```
 */
export function deriveMaster(seed: TArg<Uint8Array>): TRet<Uint8Array> {
  seed = abytes(seed, undefined, 'seed');
  // ERC-2333 derive_master_SK input requires seed source entropy >= 256 bits.
  if (seed.length < 32) throw new RangeError('Expected seed to be at least 32 bytes');
  return hkdfModR(seed);
}

/**
 * Derives a hardened child secret key from a parent secret key.
 * @param parentKey - Parent secret key bytes.
 * @param index - Child index.
 * @returns Child secret key bytes.
 * @throws On wrong argument types. {@link TypeError}
 * @throws On wrong parent-key length or child-index range. {@link RangeError}
 * @example
 * First derive the master key, then walk one hardened child step.
 * ```ts
 * import { randomBytes } from '@noble/hashes/utils.js';
 * import { deriveChild, deriveMaster } from 'micro-eth-signer/advanced/bls.js';
 * const seed = randomBytes(32);
 * deriveChild(deriveMaster(seed), 0);
 * ```
 */
export function deriveChild(parentKey: TArg<Uint8Array>, index: number): TRet<Uint8Array> {
  return hkdfModR(parentSKToLamportPK(parentKey, index));
}

/**
 * Derives a key by walking an EIP-2334 path from a seed.
 * @param seed - Root seed bytes.
 * @param path - Derivation path starting with `m`.
 * @returns Derived secret key bytes.
 * ERC-2334 paths use whole-integer segments after `m` and must include at least four levels.
 * @throws On wrong argument types. {@link TypeError}
 * @throws On malformed derivation paths or child-index ranges. {@link RangeError}
 * @example
 * Follow a full validator derivation path directly from the seed bytes.
 * ```ts
 * import { randomBytes } from '@noble/hashes/utils.js';
 * import { deriveSeedTree } from 'micro-eth-signer/advanced/bls.js';
 * const seed = randomBytes(32);
 * deriveSeedTree(seed, 'm/12381/3600/0/0');
 * ```
 */
export function deriveSeedTree(seed: TArg<Uint8Array>, path: string): TRet<Uint8Array> {
  if (typeof path !== 'string') throw new TypeError('Derivation path must be string');
  const indices = path.split('/');
  if (indices.shift() !== 'm') throw new RangeError('First character of path must be "m"');
  // ERC-2334 Path has four levels plus the master node and says at least four
  // child levels MUST be used.
  if (indices.length < 4) throw new RangeError('Derivation path must have at least four levels');
  let sk = deriveMaster(seed);
  const nodes = indices.map((i) => {
    // ERC-2334 Path defines tree steps as integers separated by '/', so
    // parseInt-style junk suffixes are not valid segments.
    if (!/^\d+$/.test(i)) throw new RangeError('Derivation path segment must be an integer');
    return Number(i);
  });
  for (const node of nodes) sk = deriveChild(sk, node);
  return sk;
}

/** Supported EIP-2334 key usages. */
export const EIP2334_KEY_TYPES: readonly ['withdrawal', 'signing'] = /* @__PURE__ */ deepFreeze([
  'withdrawal',
  'signing',
] as const);
/** Allowed EIP-2334 key usage names. */
export type EIP2334KeyType = (typeof EIP2334_KEY_TYPES)[number];
/**
 * Derives an EIP-2334 withdrawal or signing key.
 * @param seed - Seed bytes.
 * @param type - Requested key usage.
 * @param index - Validator account index.
 * @returns Derived private key bytes and its derivation path.
 * ERC-2333 / ERC-2334 derivation expects `seed` to contain at least 32 bytes of source entropy.
 * @throws On wrong seed, key-type, or index argument types. {@link TypeError}
 * @throws On unsupported key types or validator-index ranges. {@link RangeError}
 * @example
 * Ask for either the withdrawal or signing branch and keep the returned path string.
 * ```ts
 * import { randomBytes } from '@noble/hashes/utils.js';
 * import { deriveEIP2334Key } from 'micro-eth-signer/advanced/bls.js';
 * const seed = randomBytes(32);
 * deriveEIP2334Key(seed, 'signing', 0).path;
 * ```
 */
export function deriveEIP2334Key(
  seed: TArg<Uint8Array>,
  type: EIP2334KeyType,
  index: number
): TRet<{
  key: Uint8Array;
  path: string;
}> {
  if (!isBytes(seed)) throw new TypeError('Valid seed expected');
  // ERC-2334 validator paths are derived by ERC-2333, whose derive_master_SK
  // input requires seed source entropy >= 256 bits.
  if (seed.length < 32) throw new RangeError('Expected seed to be at least 32 bytes');
  if (typeof type !== 'string') throw new TypeError('Valid keystore type expected');
  if (!EIP2334_KEY_TYPES.includes(type as EIP2334KeyType))
    throw new RangeError('Valid keystore type expected');
  assertUint32(index);
  // m / purpose / coin_type /  account / use
  // - purpose: always 12381
  // - coin_type: always 3600 (eth2 bls12-381 keys)
  // EIP-2334 specifies following derivation paths:
  // m/12381/3600/0/0   for withdrawal
  // m/12381/3600/0/0/0 for signing (sub account for withdrawal)
  const path = `m/12381/3600/${index}/0${type === 'signing' ? '/0' : ''}`;
  return { key: deriveSeedTree(seed, path), path };
}

/**
 * Derives signing key from withdrawal key without access to seed
 * @param withdrawalKey - result of deriveEIP2334Key(seed, 'withdrawal', index)
 * @param index - Child signing index below the withdrawal key.
 * @returns For `index = 0`, the same key as deriveEIP2334Key(seed, 'signing',
 * validatorIndex); nonzero indices derive extra local children below the withdrawal key.
 * @throws On wrong argument types. {@link TypeError}
 * @throws On wrong withdrawal-key length or child-index range. {@link RangeError}
 * @example
 * Show that the signing branch can be reconstructed later from the withdrawal branch.
 * ```ts
 * import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
 * import { deriveEIP2334Key, deriveEIP2334SigningKey } from 'micro-eth-signer/advanced/bls.js';
 * const seed = randomBytes(64);
 * const signing = deriveEIP2334Key(seed, 'signing', 0);
 * const withdrawal = deriveEIP2334Key(seed, 'withdrawal', 0);
 * bytesToHex(deriveEIP2334SigningKey(withdrawal.key)) === bytesToHex(signing.key);
 * ```
 */
export function deriveEIP2334SigningKey(
  withdrawalKey: TArg<Uint8Array>,
  index = 0
): TRet<Uint8Array> {
  withdrawalKey = abytes(withdrawalKey, 32, 'withdrawal key');
  assertUint32(index);
  return deriveChild(withdrawalKey, index);
}

function normalizePassword(s: string): string {
  // EIP-2335 applies UTF-8 encoding after this step; this helper only performs
  // the NFKD + control-code stripping phase.
  let out = '';
  for (const chr of s.normalize('NFKD')) {
    const code = chr.charCodeAt(0);
    // C0 are the control codes between 0x00 - 0x1F(inclusive) and C1 codes
    // lie between 0x80 and 0x9F(inclusive). Delete, commonly known as “backspace”,
    // is the UTF - 8 character 7F which must also be stripped.
    // Note that space(Sp UTF - 8 0x20) is a valid character in passwords despite it
    // being a pseudo - control character.
    if ((0x00 <= code && code <= 0x1f) || (0x7f <= code && code <= 0x9f)) continue;
    out += chr;
  }
  return out;
}

function UUIDv4(buf: TArg<Uint8Array>): string {
  // Clone before setting version/variant bits so callers keep the original 16
  // random bytes unchanged.
  buf = Uint8Array.from(buf);
  // UUID version
  buf[6] = (buf[6] & 0x0f) | 0x40;
  // RFC 4122
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const parts = [
    buf.subarray(0, 4),
    buf.subarray(4, 6),
    buf.subarray(6, 8),
    buf.subarray(8, 10),
    buf.subarray(10),
  ];
  return parts.map(bytesToHex).join('-');
}

// Note: dklen, not dkLen, because lowercase is used inside of serialized json keystores
// EIP-2335 uses key[0..15] for AES-128-CTR and key[16..31] for checksum
// verification, so both default KDF outputs stay at 32 bytes.
const KDFS = {
  scrypt: { dklen: 32, n: 262144, r: 8, p: 1 },
  pbkdf2: { dklen: 32, c: 262144, prf: 'hmac-sha256' },
};

type KDFParams<T extends KDFType> = (typeof KDFS)[T];
type KDFType = keyof typeof KDFS;

/** EIP-2335 keystore JSON object. */
export type Keystore<T extends KDFType> = {
  /** Schema version. Always `4` for BLS keystores. */
  version: number;
  /** Optional human-readable description of the protected secret. */
  description?: string;
  /** Optional hex-encoded public key for validating the decrypted secret. */
  pubkey?: string;
  /** EIP-2334 derivation path or an empty string for non-derived secrets. */
  path: string;
  /** RFC 4122 v4 UUID for the keystore object. */
  uuid: string;
  /** Cipher, checksum, and KDF configuration with their serialized payloads. */
  crypto: {
    /** Key-derivation function and its serialized parameters. */
    kdf: { function: T; params: KDFParams<T> & { salt: string }; message: '' };
    /** Checksum algorithm and checksum payload used to verify decryption. */
    checksum: { function: 'sha256'; params: {}; message: string };
    /** Cipher algorithm, IV, and encrypted secret payload. */
    cipher: { function: 'aes-128-ctr'; params: { iv: string }; message: string };
  };
};

// Base validation follows the EIP-2335 object shape; strict mode additionally
// narrows accepted algorithms to the local version-4 profile.
// Maybe worth exporting?
function validateKeystore<T extends KDFType>(store: Keystore<T>, strict = true) {
  if (typeof store !== 'object' || store === null) throw new Error('keystore should be object');
  if (store.version !== 4)
    throw new Error('keystore: wrong version, only version=4 is supported for BLS keys for now');
  // RFC 4122 emits UUID hex lowercase, but says hex letters are case-insensitive on input.
  const uuid = typeof store.uuid === 'string' ? store.uuid.toLowerCase() : store.uuid;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid))
    throw new Error('keystore: wrong uuid');
  // ERC-2335 Path is a required string field; use "" when no key-tree path is known or relevant.
  if (typeof store.path !== 'string')
    throw new Error('keystore: wrong path type, should be string');
  if (store.pubkey !== undefined && typeof store.pubkey !== 'string')
    throw new Error('keystore: wrong pubkey type, should be string');
  if (store.description !== undefined && typeof store.description !== 'string')
    throw new Error('keystore: wrong description type, should be string');
  const crypto = store.crypto;
  if (typeof crypto !== 'object' || crypto === null)
    throw new Error('keystore.crypto should be object');
  for (const k in crypto) {
    if (strict && !['kdf', 'checksum', 'cipher'].includes(k))
      throw new Error(`keystore: unknown crypto module: ${k}`);
    const mod = crypto[k as keyof Keystore<T>['crypto']];
    if (typeof mod !== 'object' || mod === null)
      throw new Error(`keystore.crypto.${k} should be object`);
    if (typeof mod.function !== 'string')
      throw new Error(`keystore.crypto.${k}.function should be string`);
    if (typeof mod.params !== 'object' || mod.params === null)
      throw new Error(`keystore.crypto.${k}.params should be object`);
    if (typeof mod.message !== 'string')
      throw new Error(`keystore.crypto.${k}.message should be string`);
  }
  if (strict) {
    if (!KDFS[crypto.kdf.function])
      throw new Error('keystore: only script and pbkdf2 kdf supported in version 4');
    if (crypto.checksum.function !== 'sha256')
      throw new Error('keystore: only sha256 checksum supported in version 4');
    if (crypto.cipher.function !== 'aes-128-ctr')
      throw new Error('keystore: only aes-128-ctr cipher supported in version 4');
    const kdf = crypto.kdf.params;
    if (typeof kdf.salt !== 'string') throw new Error(`keystore.crypto.kdf.salt should be string`);
    // Not sure if we need this validation, if encryption key was derived using insecure params,
    // we cannot do much here (it already happened!), I don't see reasons not to decrypt
    // const expKdf = KDFS[crypto.kdf.function];
    // for (const k in expKdf) {
    //   if (kdf[k] !== expKdf[k]) {
    //     throw new Error(`keystore.crypto.kdf.params.${k} should be ${expKdf[k]}`);
    //   }
    // }
    if (typeof crypto.cipher.params.iv !== 'string')
      throw new Error(`keystore.crypto.cipher.params.iv should be string`);
  }
}

// EIP-2335 "Modules" / "Decryption key" make the KDF params part of the
// keystore file, so imports must derive from stored params.
function deriveEIP2335Key(
  password: string,
  salt: TArg<Uint8Array>,
  kdf: KDFType,
  params: KDFParams<KDFType> = KDFS[kdf]
): TRet<Uint8Array> {
  const pass = utf8ToBytes(normalizePassword(password));
  // EIP-2335 password verification reads decryption_key[16:32] and AES-128-CTR
  // uses [0:16], so require at least 32 bytes.
  if (!Number.isSafeInteger(params.dklen) || params.dklen < 32)
    throw new RangeError('Expected KDF dklen to be at least 32 bytes');
  if (kdf === 'scrypt') {
    const { n: N, r, p, dklen: dkLen } = params as KDFParams<'scrypt'>;
    return scrypt(pass, salt, { N, r, p, dkLen });
  } else if (kdf === 'pbkdf2') {
    const { c, dklen: dkLen, prf } = params as KDFParams<'pbkdf2'>;
    if (prf !== 'hmac-sha256') throw new Error('Unsupported PBKDF2 PRF');
    return pbkdf2(sha256, pass, salt, { c, dkLen });
  } else {
    throw new Error(`Unsupported KDF: ${kdf}`);
  }
}
/**
 * Decrypts EIP2335 Keystore
 * NOTE: it validates publicKey if present (which mean you can use it from store if decryption is success)
 * @param store - js object
 * @param password - Password used by the keystore KDF.
 * @returns decrypted secret bytes
 * @throws If the keystore uses an unsupported KDF or fails checksum/public-key validation. {@link Error}
 * @throws On wrong KDF output length. {@link RangeError}
 * @example
 * Decrypt the keystore back into the original secret bytes.
 * ```ts
 * import { randomBytes } from '@noble/hashes/utils.js';
 * import { EIP2335Keystore, decryptEIP2335Keystore } from 'micro-eth-signer/advanced/bls.js';
 * const ctx = new EIP2335Keystore('password', 'pbkdf2', randomBytes);
 * const store = ctx.create(randomBytes(32));
 * decryptEIP2335Keystore(store, 'password');
 * ctx.clean();
 * ```
 */
export function decryptEIP2335Keystore<T extends KDFType>(
  store: Keystore<T>,
  password: string
): TRet<Uint8Array> {
  validateKeystore(store);
  const c = store.crypto;
  const checksumProvided = c.checksum.message;
  const ciphertext = hexToBytes(c.cipher.message);
  const salt = hexToBytes(c.kdf.params.salt);
  const iv = hexToBytes(c.cipher.params.iv);
  const key = deriveEIP2335Key(password, salt, c.kdf.function, c.kdf.params);
  // verify checksum
  const checksum = bytesToHex(sha256(concatBytes(key.subarray(16, 32), ciphertext)));
  if (checksum !== checksumProvided)
    throw new Error(`Checksum ${checksum} does not match ${checksumProvided}`);
  // decrypt
  const secret = ctr(key.subarray(0, 16), iv).decrypt(ciphertext);
  // verify pubkey
  // NOTE: it is optional, and encrypted value is not neccesarily private key according to EIP2335
  if (store.pubkey !== undefined) {
    const publicKey = bytesToHex(getPublicKey(secret).toBytes());
    if (publicKey !== store.pubkey)
      throw new Error(`Pubkey ${publicKey} does not match ${store.pubkey}`);
  }
  key.fill(0);
  iv.fill(0);
  ciphertext.fill(0);
  return secret;
}

/**
 * Secure random-byte generator.
 * @param bytes - Number of random bytes to produce.
 * @returns Cryptographically secure random bytes.
 */
export type RandFn = (bytes: number) => Uint8Array;

/**
 * Class for generation multiple keystores with same password
 * @param password - Password used by the keystore KDF.
 * @param kdf - Key-derivation function name.
 * @param _random - Optional secure random-byte generator.
 * @example
 * Reuse one keystore context when exporting multiple derived validators with the same password.
 * ```ts
 * import { randomBytes } from '@noble/hashes/utils.js';
 * import { EIP2335Keystore } from 'micro-eth-signer/advanced/bls.js';
 * const ctx = new EIP2335Keystore('password', 'pbkdf2', randomBytes);
 * const seed = randomBytes(32);
 * const stores = [0, 1].map((i) => ctx.createDerivedEIP2334(seed, 'signing', i));
 * ctx.clean();
 * ```
 */
export class EIP2335Keystore<T extends KDFType> {
  private destroyed = false;
  private readonly kdf: T;
  private readonly randomBytes: RandFn;
  private readonly key: Uint8Array;
  // One random salt and its derived encryption key are reused for every keystore
  // produced by this context; each output still gets a fresh IV and UUID.
  private readonly salt: Uint8Array;
  /**
   * Creates context for EIP2335 Keystore generation
   * @param password - password
   * @param kdf - scrypt | pbkdf2
   * @param _random - Optional secure random-byte generator.
   */
  constructor(password: string, kdf: T, _random: RandFn = randomBytes) {
    this.kdf = kdf;
    // We need this for tests and also to allow usage in context where our randomBytes doesn't work (react-native?)
    this.randomBytes = _random;
    this.salt = this.randomBytes(32);
    this.key = deriveEIP2335Key(password, this.salt, kdf);
  }
  /**
   * Creates keystore in EIP2335 format.
   * @param secret - some secret value to encrypt (usually private keys)
   * @param path - EIP-2334 path string, or `""` when the secret is not derived.
   * @param description - optional description of secret
   * @param pubkey - optional public key. Required if secret is private key.
   */
  create(
    secret: Uint8Array,
    path: string = '', // EIP2335 allows storing not derived keys
    description: string = '',
    pubkey?: Uint8Array
  ): Keystore<T> {
    if (this.destroyed) throw new Error('EIP2335Keystore was destroyed.');
    const iv = this.randomBytes(16);
    const uuid = this.randomBytes(16);
    // seed, keyType, index checked inside deriveEIP2334Key;
    // ERC-2335 Path says `path` is a string defined by ERC-2334, and the
    // keystore JSON schema also types it as string.
    if (typeof path !== 'string') throw new TypeError('path should be string');
    if (typeof description !== 'string') throw new Error('description should be string');
    const { key, kdf, salt } = this;
    const ciphertext = ctr(key.subarray(0, 16), iv).encrypt(secret);
    const checksum = bytesToHex(sha256(concatBytes(key.subarray(16), ciphertext)));
    const res: Keystore<T> = {
      version: 4,
      description,
      path,
      uuid: UUIDv4(uuid),
      crypto: {
        kdf: { function: kdf, params: { ...KDFS[kdf], salt: bytesToHex(salt) }, message: '' },
        checksum: { function: 'sha256', params: {}, message: checksum },
        cipher: {
          function: 'aes-128-ctr',
          params: { iv: bytesToHex(iv) },
          message: bytesToHex(ciphertext),
        },
      },
    };
    if (pubkey !== undefined) res.pubkey = bytesToHex(abytes(pubkey, undefined, 'public key'));
    return res;
  }
  /**
   * Creates keystore for derived private key (based on EIP2334 seed and index)
   * @param seed - EIP2334 seed to derive from; ERC-2333 requires at least 32 bytes.
   * @param keyType - EIP2334 key type (withdrawal/signing)
   * @param index - account index
   * @param description - optional keystore description
   */
  createDerivedEIP2334(
    seed: Uint8Array,
    keyType: EIP2334KeyType,
    index: number,
    description: string = ''
  ): Keystore<T> {
    const { key: privKey, path } = deriveEIP2334Key(seed, keyType, index);
    const pubkey = bls12_381.longSignatures.getPublicKey(privKey).toBytes();
    return this.create(privKey, path, description, pubkey);
  }

  /**
   * Clean cached key material and permanently disable this context.
   */
  clean(): void {
    this.destroyed = true;
    this.key.fill(0);
    this.salt.fill(0);
  }
}

/**
 * Exports multiple keystore from derived seed
 * @param password - password for file encryption
 * @param kdf - scrypt | pbkdf2
 * @param seed - result of mnemonicToSeed()
 * @param keyType - signing | withdrawal
 * @param indexes - array of account indeces
 * @returns Derived keystore list for the requested indexes.
 * @throws If any requested key index is outside the supported range. {@link Error}
 * @example
 * Export several validator keystores from one mnemonic-derived seed.
 * ```ts
 * import { mnemonicToSeedSync } from '@scure/bip39';
 * import { createDerivedEIP2334Keystores } from 'micro-eth-signer/advanced/bls.js';
 * const mnemonic = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
 * const seed = mnemonicToSeedSync(mnemonic, '');
 * createDerivedEIP2334Keystores('password', 'pbkdf2', seed, 'signing', [0, 1, 2, 3]);
 * ```
 */
export function createDerivedEIP2334Keystores<T extends KDFType>(
  password: string,
  kdf: T,
  seed: TArg<Uint8Array>,
  keyType: EIP2334KeyType,
  indexes: number[]
): Keystore<T>[] {
  // NOTE: we can probably also cache key derivation for EIP2334 (since it is hierarchical and seed is same)
  for (const i of indexes) {
    // Local sanity guard for roughly 1M validator indexes / 32M ETH stake;
    // ERC-2333/2334 only require uint32 child indexes.
    if (!Number.isSafeInteger(i) || i < 0 || i > 2 ** 20 - 1) throw new Error('Invalid key index');
  }
  const ctx = new EIP2335Keystore(password, kdf);
  const res = indexes.map((i) => ctx.createDerivedEIP2334(seed, keyType, i));
  ctx.clean();
  return res;
}

// Internal methods for test purposes only
export const _TEST: {
  normalizePassword: typeof normalizePassword;
  deriveEIP2335Key: typeof deriveEIP2335Key;
} = /* @__PURE__ */ deepFreeze({ normalizePassword, deriveEIP2335Key });
