/*! micro-eth-signer - MIT License (c) Paul Miller (paulmillr.com) */

import { keccak256 } from 'js-sha3';
import * as rlp from 'micro-rlp';
import * as secp256k1 from 'noble-secp256k1';

export const CHAIN_TYPES = { mainnet: 1, ropsten: 3, rinkeby: 4, goerli: 5, kovan: 42 };

export function add0x(hex: string) {
  return /^0x/i.test(hex) ? hex : `0x${hex}`;
}

export function strip0x(hex: string) {
  return hex.replace(/^0x/i, '');
}

function bytesToHex(uint8a: Uint8Array): string {
  // pre-caching chars could speed this up 6x.
  let hex = '';
  for (let i = 0; i < uint8a.length; i++) {
    hex += uint8a[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  hex = strip0x(hex);
  if (hex.length & 1) hex = `0${hex}`;
  const array = new Uint8Array(hex.length / 2);
  for (let i = 0; i < array.length; i++) {
    const j = i * 2;
    array[i] = Number.parseInt(hex.slice(j, j + 2), 16);
  }
  return array;
}

function hexToBytesUnpadded(num: string) {
  return num === '0x' || BigInt(num) === 0n ? new Uint8Array() : hexToBytes(num);
}

function numberToHex(num: number | bigint, padToBytes: number = 0): string {
  const hex = num.toString(16);
  const p1 = hex.length & 1 ? `0${hex}` : hex;
  return p1.padStart(padToBytes * 2, '0');
}

function hexToNumber(hex: string): bigint {
  if (typeof hex !== 'string') {
    throw new TypeError('hexToNumber: expected string, got ' + typeof hex);
  }
  return hex ? BigInt(add0x(hex)) : 0n;
}

type Chain = keyof typeof CHAIN_TYPES;

// The order is important.
const FIELDS = ['nonce', 'gasPrice', 'gasLimit', 'to', 'value', 'data', 'v', 'r', 's'] as const;
export type Field = typeof FIELDS[number];
export type RawTx = [string, string, string, string, string, string, string, string, string];
export type RawTxMap = Record<Field, string>;

function mapToArray(input: RawTxMap): RawTx {
  return FIELDS.map((key) => input[key as Field]) as RawTx;
}

function rawToSerialized(input: RawTx | RawTxMap) {
  let array = Array.isArray(input) ? input : mapToArray(input);
  for (let i = 0; i < array.length; i++) {
    const value = array[i];
    if (typeof value === 'string') array[i] = add0x(value);
  }
  return add0x(bytesToHex(rlp.encode(array)));
}

export const Address = {
  fromPrivateKey(key: string | Uint8Array): string {
    if (typeof key === 'string') key = hexToBytes(key);
    return Address.fromPublicKey(secp256k1.getPublicKey(key));
  },

  fromPublicKey(key: string | Uint8Array): string {
    if (typeof key === 'string') key = hexToBytes(key);
    const len = key.length;
    if (![33, 65].includes(len)) throw new Error(`Invalid key with length "${len}"`);
    const pub = len === 65 ? key : secp256k1.Point.fromHex(key).toRawBytes(false);
    const addr = keccak256(pub.slice(1, 65)).slice(24);
    return Address.checksum(addr);
  },

  // ETH addr checksum is calculated by hashing the string with keccak.
  // NOTE: it hashes *string*, not a bytearray: keccak('beef') not keccak([0xbe, 0xef])
  checksum(nonChecksummedAddress: string): string {
    const addr = strip0x(nonChecksummedAddress.toLowerCase());
    const hash = strip0x(keccak256(addr));
    let checksummed = '';
    for (let i = 0; i < addr.length; i++) {
      // If ith character is 9 to f then make it uppercase
      const nth = Number.parseInt(hash[i], 16);
      let char = addr[i];
      if (nth > 7) char = char.toUpperCase();
      checksummed += char;
    }
    return add0x(checksummed);
  },

  verifyChecksum(address: string): boolean {
    const addr = strip0x(address);
    if (addr === addr.toLowerCase() || addr === addr.toUpperCase()) return true;
    const hash = keccak256(addr.toLowerCase());
    for (let i = 0; i < 40; i++) {
      // the nth letter should be uppercase if the nth digit of casemap is 1
      const nth = Number.parseInt(hash[i], 16);
      const char = addr[i];
      if (nth > 7 && char.toUpperCase() !== char) return false;
      if (nth <= 7 && char.toLowerCase() !== char) return false;
    }
    return true;
  },
};

export class Transaction {
  static DEFAULT_HARDFORK = 'muirGlacier';
  static DEFAULT_CHAIN: Chain = 'mainnet';
  readonly hex: string;
  readonly raw: RawTxMap;
  readonly isSigned: boolean;

  constructor(
    data: string | Uint8Array | RawTx | RawTxMap,
    readonly chain: Chain = Transaction.DEFAULT_CHAIN,
    readonly hardfork = Transaction.DEFAULT_HARDFORK
  ) {
    let norm;
    if (typeof data === 'string') {
      norm = data;
    } else if (data instanceof Uint8Array) {
      norm = bytesToHex(data);
    } else if (Array.isArray(data) || (typeof data === 'object' && data != null)) {
      norm = rawToSerialized(data);
    } else {
      throw new TypeError('Expected valid serialized tx');
    }
    if (norm.length <= 6) throw new Error('Invalid tx length');
    this.hex = norm;
    const ui8a = rlp.decode(add0x(norm)) as Uint8Array[];
    const arr = ui8a.map(bytesToHex).map((i) => (i ? add0x(i) : i)) as RawTx;
    this.raw = arr.reduce((res, value, i) => {
      const name = FIELDS[i];
      res[name] = value;
      return res;
    }, {} as RawTxMap);
    this.isSigned = !!(this.raw.r && this.raw.r !== '0x');
  }

  get bytes(): Uint8Array {
    return hexToBytes(this.hex);
  }

  equals(other: Transaction) {
    return this.getMessageToSign() === other.getMessageToSign();
  }

  get sender(): string {
    const sender = this.recoverSenderPublicKey();
    if (!sender) throw new Error('Invalid signed transaction');
    return Address.fromPublicKey(sender);
  }

  // Amount in wei
  get amount(): bigint {
    return BigInt(this.raw.value);
  }

  // Total fee in wei
  get fee(): bigint {
    return BigInt(this.raw.gasPrice) * BigInt(this.raw.gasLimit);
  }

  // Amount + fee in wei
  get upfrontCost(): bigint {
    return this.amount + this.fee;
  }

  // Checksummed address
  get to(): string {
    return Address.checksum(this.raw.to);
  }

  // Nonce is a counter that represents a number of outgoing transactions on the acct
  get nonce(): number {
    return Number.parseInt(this.raw.nonce, 16) || 0;
  }

  private prepare(): Uint8Array[] {
    return [
      hexToBytesUnpadded(this.raw.nonce),
      hexToBytesUnpadded(this.raw.gasPrice),
      hexToBytesUnpadded(this.raw.gasLimit),
      hexToBytes(this.raw.to),
      hexToBytesUnpadded(this.raw.value),
      hexToBytesUnpadded(this.raw.data),
      hexToBytesUnpadded(this.raw.v),
      hexToBytesUnpadded(this.raw.r),
      hexToBytesUnpadded(this.raw.s),
    ];
  }

  private supportsReplayProtection() {
    const properBlock = !['chainstart', 'homestead', 'dao', 'tangerineWhistle'].includes(
      this.hardfork
    );
    if (!this.isSigned) return true; // Unsigned, supports EIP155
    const v = Number(hexToNumber(this.raw.v));
    const chainId = CHAIN_TYPES[this.chain];
    const meetsConditions = v === chainId * 2 + 35 || v === chainId * 2 + 36;
    return properBlock && meetsConditions;
  }

  getMessageToSign(): string {
    const values = this.prepare().slice(0, 6);
    if (this.supportsReplayProtection()) {
      values.push(hexToBytes(numberToHex(CHAIN_TYPES[this.chain])));
      values.push(new Uint8Array());
      values.push(new Uint8Array());
    }
    return keccak256(rlp.encode(values));
  }

  // Used in block explorers etc
  get hash(): string {
    if (!this.isSigned) throw new Error('Expected signed transaction');
    return keccak256(rlp.encode(this.prepare()));
  }

  async sign(privateKey: string | Uint8Array): Promise<Transaction> {
    if (this.isSigned) throw new Error('Expected unsigned transaction');
    if (typeof privateKey === 'string') privateKey = strip0x(privateKey);
    const [hex, recovery] = await secp256k1.sign(this.getMessageToSign(), privateKey, {
      recovered: true,
      canonical: true,
    });
    const signature = secp256k1.Signature.fromHex(hex);
    const chainId = CHAIN_TYPES[this.chain];
    const vv = chainId ? recovery + (chainId * 2 + 35) : recovery + 27;
    const [v, r, s] = [vv, signature.r, signature.s].map((n) => add0x(numberToHex(n)));
    const signedRaw: RawTxMap = Object.assign({}, this.raw, { v, r, s });
    return new Transaction(signedRaw, this.chain, this.hardfork);
  }

  recoverSenderPublicKey(): string | undefined {
    if (!this.isSigned) {
      throw new Error('Expected signed transaction: cannot recover sender of unsigned tx');
    }
    const [vv, r, s] = [this.raw.v, this.raw.r, this.raw.s].map((n) => hexToNumber(n));
    if (this.hardfork !== 'chainstart' && s && s > secp256k1.CURVE.n / 2n) {
      throw new Error('Invalid signature: s is invalid');
    }
    const signature = new secp256k1.Signature(r, s).toHex();
    const chainId = CHAIN_TYPES[this.chain];
    const v = Number(vv);
    const recovery = chainId ? v - (chainId * 2 + 35) : v - 27;
    return secp256k1.recoverPublicKey(this.getMessageToSign(), signature, recovery);
  }
}
