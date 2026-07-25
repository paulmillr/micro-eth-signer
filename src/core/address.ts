/*! micro-eth-signer - MIT License (c) 2021 Paul Miller (paulmillr.com) */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  utf8ToBytes,
  type TArg,
} from '@noble/hashes/utils.js';
import {
  add0x,
  amounts,
  astring,
  deepFreeze,
  ethHex,
  isBytes,
  strip0x,
  type TRet,
} from '../utils.ts';
import { RLP } from './rlp.ts';

type ParsedAddress = {
  hasPrefix: boolean;
  data: string;
};
type AddressUtils = {
  parse: (address: string) => ParsedAddress;
  addChecksum: (nonChecksummedAddress: string) => string;
  fromPublicKey: (key: TArg<string | Uint8Array>) => string;
  fromPrivateKey: (key: TArg<string | Uint8Array>) => string;
  random: () => { privateKey: string; address: string };
  isValid: (checksummedAddress: string) => boolean;
  getCreateAddress: (from: string, nonce: bigint | number) => string;
  getCreate2Address: (
    from: string,
    salt: TArg<string | Uint8Array>,
    initCodeHash: TArg<string | Uint8Array>
  ) => string;
};

// keccak output is 32 bytes; an address is its last 20 bytes.
const hashToAddress = (hashed: Uint8Array): string => addChecksum(bytesToHex(hashed).slice(24));
const bytes32 = (value: string | Uint8Array, title: string): Uint8Array => {
  const b = isBytes(value) ? value : ethHex.decode(astring(value, title));
  if (b.length !== 32) throw new Error(`${title} must be 32 bytes, got ${b.length}`);
  return b;
};

// The body is optional so parseAddress() can distinguish bare `0x` / empty input from
// malformed address lengths before enforcing the final non-empty rule.
const ADDR_RE = /^(0[xX])?([0-9a-fA-F]{40})?$/;

// Internal variants below accept `allowEmpty`, which permits the bare `0x` used by the
// transaction `to` field as a contract-creation sentinel. The public `addr` methods
// always require a full 20-byte address.
export function parseAddress(address: string, allowEmpty = false): ParsedAddress {
  astring(address);
  // NOTE: empty address allowed for 'to', but would be mistake for other address fields.
  // '0x' instead of null/undefined because we don't want to send contract creation tx if user
  // accidentally missed 'to' field.
  if (allowEmpty && address === '0x') return { hasPrefix: true, data: '' };
  const res = address.match(ADDR_RE) || [];
  const hasPrefix = res[1] != null;
  const data = res[2];
  if (!data) {
    const len = hasPrefix ? 42 : 40;
    throw new Error(`address must be ${len}-char hex, got ${address.length}-char ${address}`);
  }
  return { hasPrefix, data };
}

export function addChecksum(nonChecksummedAddress: string, allowEmpty = false): string {
  const low = parseAddress(nonChecksummedAddress, allowEmpty).data.toLowerCase();
  const hash = bytesToHex(keccak_256(utf8ToBytes(low)));
  let checksummed = '';
  for (let i = 0; i < low.length; i++) {
    const hi = Number.parseInt(hash[i], 16);
    const li = low[i];
    checksummed += hi <= 7 ? li : li.toUpperCase(); // if char is 9-f, upcase it
  }
  return add0x(checksummed);
}

export function isValidAddress(checksummedAddress: string, allowEmpty = false): boolean {
  let parsed: ParsedAddress;
  try {
    parsed = parseAddress(checksummedAddress, allowEmpty);
  } catch (error) {
    return false;
  }
  const { data: address, hasPrefix } = parsed;
  if (!hasPrefix) return false;
  const low = address.toLowerCase();
  const upp = address.toUpperCase();
  if (address === low || address === upp) return true;
  return addChecksum(low, allowEmpty) === checksummedAddress;
}

export const addr: TRet<AddressUtils> = /* @__PURE__ */ deepFreeze({
  /**
   * Splits an address into its optional `0x` prefix and 40-char hex body.
   * Throws on anything that is not a 40-char (or prefixed 42-char) hex string.
   */
  parse: (address: string): ParsedAddress => parseAddress(address),

  /**
   * Address checksum is calculated by hashing with keccak_256.
   * It hashes *string*, not a bytearray: keccak('beef') not keccak([0xbe, 0xef])
   * @param nonChecksummedAddress
   * @returns checksummed address
   */
  addChecksum: (nonChecksummedAddress: string): string => addChecksum(nonChecksummedAddress),

  /**
   * Creates address from secp256k1 public key.
   */
  fromPublicKey: (key: TArg<string | Uint8Array>): string => {
    if (!key) throw new Error('invalid public key: ' + key);
    if (typeof key === 'string') key = hexToBytes(strip0x(key));
    const pub65b = secp256k1.Point.fromBytes(key).toBytes(false);
    const hashed = keccak_256(pub65b.subarray(1, 65));
    const address = bytesToHex(hashed).slice(24); // slice 24..64
    return addChecksum(address);
  },

  /**
   * Creates address from ETH private key in hex or ui8a format.
   */
  fromPrivateKey: (key: TArg<string | Uint8Array>): string => {
    if (typeof key === 'string') key = hexToBytes(strip0x(key));
    return addr.fromPublicKey(secp256k1.getPublicKey(key, false));
  },

  /**
   * Generates hex string with new random private key and address. Uses CSPRNG internally.
   */
  random(): { privateKey: string; address: string } {
    const privateKey = ethHex.encode(secp256k1.utils.randomSecretKey());
    return { privateKey: privateKey, address: addr.fromPrivateKey(privateKey) };
  },

  /**
   * Verifies checksum if the address is checksummed.
   * Always returns true when the address is not checksummed.
   */
  isValid: (checksummedAddress: string): boolean => isValidAddress(checksummedAddress),

  /**
   * Computes the address of a contract deployed with CREATE (a regular deployment tx):
   * `keccak256(rlp([sender, nonce]))[12:]`.
   * @param from - deployer address
   * @param nonce - deployer account nonce at deployment time
   */
  getCreateAddress: (from: string, nonce: bigint | number): string => {
    // Preserve EIP-55 typo detection when the deployer is supplied with mixed casing.
    if (!isValidAddress(from)) throw new Error('address checksum does not match');
    if (typeof nonce === 'number') {
      if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error(`wrong nonce=${nonce}`);
      nonce = BigInt(nonce);
    }
    if (typeof nonce !== 'bigint' || nonce < BigInt(0) || nonce >= amounts.maxUint64)
      throw new Error(`wrong nonce=${nonce}`);
    const fromBytes = hexToBytes(parseAddress(from).data);
    return hashToAddress(keccak_256(RLP.encode([fromBytes, nonce])));
  },

  /**
   * Computes the address of a contract deployed with CREATE2 (EIP-1014):
   * `keccak256(0xff ++ sender ++ salt ++ keccak256(initCode))[12:]`.
   * @param from - deploying contract address
   * @param salt - 32-byte salt
   * @param initCodeHash - keccak-256 hash of the deployment (init) code
   */
  getCreate2Address: (
    from: string,
    salt: TArg<string | Uint8Array>,
    initCodeHash: TArg<string | Uint8Array>
  ): string => {
    // Preserve EIP-55 typo detection when the deployer is supplied with mixed casing.
    if (!isValidAddress(from)) throw new Error('address checksum does not match');
    const fromBytes = hexToBytes(parseAddress(from).data);
    const hashed = keccak_256(
      concatBytes(
        Uint8Array.of(0xff),
        fromBytes,
        bytes32(salt, 'salt'),
        bytes32(initCodeHash, 'initCodeHash')
      )
    );
    return hashToAddress(hashed);
  },
});
