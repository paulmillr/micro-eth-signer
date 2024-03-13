/*! micro-eth-signer - MIT License (c) 2021 Paul Miller (paulmillr.com) */
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex } from '@noble/hashes/utils';
import { astr, add0x, ethHex, strip0x } from './utils.js';

export const addr = {
  RE: /^(0[xX])?([0-9a-fA-F]{40})?$/,
  // Not much support, only RSK for now
  EIP1991_CHAINS: [30n, 31n],

  parse(address: string) {
    astr(address);
    const res = address.match(addr.RE) || [];
    const hasPrefix = res[1] != null;
    const data = res[2];
    if (!data) {
      const len = hasPrefix ? 42 : 40;
      throw new Error(`address must be ${len}-char hex, got ${address.length}-char ${address}`);
    }
    return { hasPrefix, data };
  },

  isValid(address: string) {
    try {
      const a = addr.parse(address);
      return a && a.hasPrefix;
    } catch (error) {
      return false;
    }
  },

  /**
   * Address checksum is calculated by hashing with keccak_256.
   * It hashes *string*, not a bytearray: keccak('beef') not keccak([0xbe, 0xef])
   * @param nonChecksummedAddress
   * @returns checksummed address
   */
  addChecksum(nonChecksummedAddress: string, chainId = 1n): string {
    if (typeof chainId !== 'bigint')
      throw new Error(`address.addChecksum wrong chainId=${chainId}`);
    const hasEIP1191 = addr.EIP1991_CHAINS.includes(chainId);
    const low = addr.parse(nonChecksummedAddress).data.toLowerCase();
    const hashInput = hasEIP1191 ? `${chainId}0x${low}` : low;
    const hash = bytesToHex(keccak_256(hashInput));
    let checksummed = '';
    for (let i = 0; i < low.length; i++) {
      const hi = Number.parseInt(hash[i], 16);
      const li = low[i];
      checksummed += hi <= 7 ? li : li.toUpperCase(); // if char is 9-f, upcase it
    }
    return add0x(checksummed);
  },

  /**
   * Creates address from secp256k1 public key.
   */
  fromPublicKey(key: string | Uint8Array): string {
    if (!key) throw new Error('invalid public key: ' + key);
    const pub65b = secp256k1.ProjectivePoint.fromHex(key).toRawBytes(false);
    const hashed = keccak_256(pub65b.subarray(1, 65));
    const address = bytesToHex(hashed).slice(24); // slice 24..64
    return addr.addChecksum(address);
  },

  /**
   * Creates address from ETH private key in hex or ui8a format.
   */
  fromPrivateKey(key: string | Uint8Array): string {
    if (typeof key === 'string') key = strip0x(key);
    return addr.fromPublicKey(secp256k1.getPublicKey(key, false));
  },

  /**
   * Generates hex string with new random private key and address. Uses CSPRNG internally.
   */
  random() {
    const privateKey = ethHex.encode(secp256k1.utils.randomPrivateKey());
    return { privateKey, address: addr.fromPrivateKey(privateKey) };
  },

  /**
   * Verifies checksum if the address is checksummed.
   * Always returns true when the address is not checksummed.
   */
  verifyChecksum(checksummedAddress: string, chainId = 1n): boolean {
    const { data: address } = addr.parse(checksummedAddress);
    const low = address.toLowerCase();
    const upp = address.toUpperCase();
    if (address === low || address === upp) return true;
    return addr.addChecksum(low, chainId) === checksummedAddress;
  },
};
