/*! micro-eth-signer - MIT License (c) Paul Miller (paulmillr.com) */

import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes as _hexToBytes } from '@noble/hashes/utils';
import * as secp256k1 from '@noble/secp256k1';
import * as RLP from '@ethereumjs/rlp';

export const CHAIN_TYPES = { mainnet: 1, ropsten: 3, rinkeby: 4, goerli: 5, kovan: 42 };
export const TRANSACTION_TYPES = { legacy: 0, eip2930: 1, eip1559: 2 };

export function add0x(hex: string) {
  return /^0x/i.test(hex) ? hex : `0x${hex}`;
}

export function strip0x(hex: string) {
  return hex.replace(/^0x/i, '');
}

export function hexToBytes(hex: string): Uint8Array {
  return _hexToBytes(strip0x(hex));
}

export function numberTo0xHex(num: number | bigint): string {
  const hex = num.toString(16);
  const x2 = hex.length & 1 ? `0${hex}` : hex;
  return add0x(x2);
}

function hexToNumber(hex: string): bigint {
  if (typeof hex !== 'string') {
    throw new TypeError('hexToNumber: expected string, got ' + typeof hex);
  }
  return hex ? BigInt(add0x(hex)) : 0n;
}

function cloneDeep<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(cloneDeep) as unknown as T;
  } else if (typeof obj === 'bigint') {
    return BigInt(obj) as unknown as T;
  } else if (typeof obj === 'object') {
    // should be last, so it won't catch other types
    let res: any = {};
    for (let key in obj) res[key] = cloneDeep(obj[key]);
    return res;
  } else return obj;
}

type Chain = keyof typeof CHAIN_TYPES;
type Type = keyof typeof TRANSACTION_TYPES;

// The order is important.
const FIELDS = ['nonce', 'gasPrice', 'gasLimit', 'to', 'value', 'data', 'v', 'r', 's'] as const;
// prettier-ignore
const FIELDS2930 = [
  'chainId', 'nonce', 'gasPrice', 'gasLimit',
  'to', 'value', 'data', 'accessList', 'yParity', 'r', 's'
] as const;
// prettier-ignore
const FIELDS1559 = [
  'chainId', 'nonce', 'maxPriorityFeePerGas', 'maxFeePerGas', 'gasLimit',
  'to', 'value', 'data', 'accessList', 'yParity', 'r', 's'
] as const;

const TypeToFields = {
  legacy: FIELDS,
  eip2930: FIELDS2930,
  eip1559: FIELDS1559,
};

export type Field =
  | typeof FIELDS[number]
  | typeof FIELDS2930[number]
  | typeof FIELDS1559[number]
  | 'address'
  | 'storageKey';

type str = string;
export type AccessList = [str, str[]][];
// These types will should be serializable by rlp as is
export type RawTxLegacy = [str, str, str, str, str, str, str, str, str];
export type RawTx2930 = [str, str, str, str, str, str, AccessList, str, str, str];
export type RawTx1559 = [str, str, str, str, str, str, str, AccessList, str, str, str];
export type RawTx = RawTxLegacy | RawTx2930 | RawTx1559;
export type RawTxMap = {
  chainId?: string;
  nonce: string;
  gasPrice?: string;
  maxPriorityFeePerGas?: string;
  maxFeePerGas?: string;
  gasLimit: string;
  to: string;
  value: string;
  data: string;
  accessList?: AccessList;
  yParity?: string;
  v?: string;
  r: string;
  s: string;
};

// Normalizes field to format which can easily be serialized by rlp (strings & arrays)
// prettier-ignore
const FIELD_NUMBER = new Set([
  'chainId', 'nonce', 'gasPrice', 'maxPriorityFeePerGas', 'maxFeePerGas',
  'gasLimit', 'value', 'v', 'yParity', 'r', 's'
]);
const FIELD_DATA = new Set(['data', 'to', 'storageKey', 'address']);
function normalizeField(
  field: Field,
  value:
    | number
    | bigint
    | string
    | Uint8Array
    | Record<string, string[]>
    | AccessList
    | { address: string; storageKeys: string[] }[]
): string | AccessList {
  // can be number, bignumber, decimal number in string (123), hex number in string (0x123)
  if (FIELD_NUMBER.has(field)) {
    // bytes
    if (value instanceof Uint8Array) value = add0x(bytesToHex(value));
    if (field === 'yParity' && typeof value === 'boolean') value = value ? '0x1' : '0x0';
    // '123' -> 0x7b (handles both hex and non-hex numbers)
    if (typeof value === 'string') value = BigInt(value === '0x' ? '0x0' : value);
    // 123 -> '0x7b' && 1 -> 0x01
    if (typeof value === 'number' || typeof value === 'bigint') value = numberTo0xHex(value);
    // 21000, default / minimum
    if (field === 'gasLimit' && (!value || BigInt(value as string) === 0n)) value = '0x5208';
    if (typeof value !== 'string') throw new TypeError(`Invalid type for field ${field}`);
    // should be hex string starting with '0x' at this point.
    if (field === 'gasPrice' && BigInt(value) === 0n)
      throw new TypeError('The gasPrice must have non-zero value');
    // '0x00' and '' serializes differently
    return BigInt(value) === 0n ? '' : value;
  }
  // Can be string or Uint8Array
  if (FIELD_DATA.has(field)) {
    if (!value) value = '';
    if (value instanceof Uint8Array) value = bytesToHex(value);
    if (typeof value !== 'string') throw new TypeError(`Invalid type for field ${field}`);
    value = add0x(value);
    return value === '0x' ? '' : value;
  }
  if (field === 'accessList') {
    if (!value) return [];
    let res: Record<string, Set<string>> = {};
    if (Array.isArray(value)) {
      for (let access of value) {
        if (Array.isArray(access)) {
          // AccessList
          if (access.length !== 2 || !Array.isArray(access[1]))
            throw new TypeError(`Invalid type for field ${field}`);
          const key = normalizeField('address', access[0]) as string;
          if (!res[key]) res[key] = new Set();
          for (let i of access[1]) res[key].add(normalizeField('storageKey', i) as string);
        } else {
          // {address: string, storageKeys: string[]}[]
          if (
            typeof access !== 'object' ||
            access == null ||
            !access.address ||
            !Array.isArray(access.storageKeys)
          )
            throw new TypeError(`Invalid type for field ${field}`);
          const key = normalizeField('address', access.address) as string;
          if (!res[key]) res[key] = new Set();
          for (let i of access.storageKeys) res[key].add(normalizeField('storageKey', i) as string);
        }
      }
    } else {
      // {[address]: string[]}
      if (typeof value !== 'object' || value == null || value instanceof Uint8Array)
        throw new TypeError(`Invalid type for field ${field}`);
      for (let k in value) {
        const key = normalizeField('address', k) as string;
        // undefined/empty allowed
        if (!value[k]) continue;
        if (!Array.isArray(value[k])) throw new TypeError(`Invalid type for field ${field}`);
        res[key] = new Set(value[k].map((i) => normalizeField('storageKey', i) as string));
      }
    }
    return Object.keys(res).map((i) => [i, Array.from(res[i])]) as AccessList;
  }
  throw new TypeError(`Invalid type for field ${field}`);
}

function possibleTypes(input: RawTxMap): Set<Type> {
  let types: Set<Type> = new Set(Object.keys(TRANSACTION_TYPES) as Type[]);
  const keys = new Set(Object.keys(input));
  if (keys.has('maxPriorityFeePerGas') || keys.has('maxFeePerGas')) {
    types.delete('legacy');
    types.delete('eip2930');
  }
  if (keys.has('accessList') || keys.has('yParity')) types.delete('legacy');
  if (keys.has('gasPrice')) types.delete('eip1559');
  return types;
}

const RawTxLength: Record<number, Type> = { 9: 'legacy', 11: 'eip2930', 12: 'eip1559' };
const RawTxLengthRev: Record<Type, number> = { legacy: 9, eip2930: 11, eip1559: 12 };
function rawToSerialized(input: RawTx | RawTxMap, chain?: Chain, type?: Type): string {
  let chainId;
  if (chain) chainId = CHAIN_TYPES[chain];
  if (Array.isArray(input)) {
    if (!type) type = RawTxLength[input.length];
    if (!type || RawTxLengthRev[type] !== input.length)
      throw new Error(`Invalid fields length for ${type}`);
  } else {
    const types = possibleTypes(input);
    if (type && !types.has(type)) {
      throw new Error(
        `Invalid type=${type}. Possible types with current fields: ${Array.from(types)}`
      );
    }
    if (!type) {
      if (types.has('legacy')) type = 'legacy';
      else if (!types.size) throw new Error('Impossible fields set');
      else type = Array.from(types)[0];
    }
    if (input.chainId) {
      if (chain) {
        const fromChain = normalizeField('chainId', CHAIN_TYPES[chain]);
        const fromInput = normalizeField('chainId', input.chainId);
        if (fromChain !== fromInput) {
          throw new Error(
            `Both chain=${chain}(${fromChain}) and chainId=${input.chainId}(${fromInput}) specified at same time`
          );
        }
      }
      chainId = input.chainId;
    } else input.chainId = chainId as any;
    input = (TypeToFields[type] as unknown as Field[]).map((key) => (input as any)[key]) as RawTx;
  }
  if (input) {
    const sign = input.slice(-3);
    // remove signature if any of fields is empty
    if (!sign[0] || !sign[1] || !sign[2]) {
      input = input.slice(0, -3) as any;
      // EIP-155
      if (type === 'legacy' && chainId)
        (input as any).push(normalizeField('chainId', chainId), '', '');
    }
  }
  let normalized = (input as Field[]).map((value, i) =>
    normalizeField(TypeToFields[type as Type][i], value)
  );
  if (chainId) chainId = normalizeField('chainId', chainId);
  if (type !== 'legacy' && chainId && normalized[0] !== chainId)
    throw new Error(`ChainId=${normalized[0]} incompatible with Chain=${chainId}`);
  const tNum = TRANSACTION_TYPES[type];
  return (tNum ? `0x0${tNum}` : '0x') + bytesToHex(RLP.encode(normalized));
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
    const addr = bytesToHex(keccak_256(pub.slice(1, 65))).slice(24);
    return Address.checksum(addr);
  },

  // ETH addr checksum is calculated by hashing the string with keccak.
  // NOTE: it hashes *string*, not a bytearray: keccak('beef') not keccak([0xbe, 0xef])
  checksum(nonChecksummedAddress: string): string {
    const addr = strip0x(nonChecksummedAddress.toLowerCase());
    if (addr.length !== 40) throw new Error('Invalid address, must have 40 chars');
    const hash = strip0x(bytesToHex(keccak_256(addr)));
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
    if (addr.length !== 40) throw new Error('Invalid address, must have 40 chars');
    if (addr === addr.toLowerCase() || addr === addr.toUpperCase()) return true;
    const hash = bytesToHex(keccak_256(addr.toLowerCase()));
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
  static DEFAULT_HARDFORK = 'london';
  static DEFAULT_CHAIN: Chain = 'mainnet';
  static DEFAULT_TYPE: Type = 'eip1559';
  readonly hex: string;
  readonly raw: RawTxMap;
  readonly isSigned: boolean;
  readonly type: Type;

  constructor(
    data: string | Uint8Array | RawTx | RawTxMap,
    chain?: Chain,
    readonly hardfork = Transaction.DEFAULT_HARDFORK,
    type?: Type
  ) {
    let norm;
    if (typeof data === 'string') {
      norm = data;
    } else if (data instanceof Uint8Array) {
      norm = bytesToHex(data);
    } else if (Array.isArray(data) || (typeof data === 'object' && data != null)) {
      norm = rawToSerialized(data, chain, type);
    } else {
      throw new TypeError('Expected valid serialized tx');
    }
    if (norm.length <= 6) throw new Error('Invalid tx length');
    this.hex = add0x(norm);
    let txData;
    const prevType = type;
    if (this.hex.startsWith('0x01')) [txData, type] = [add0x(this.hex.slice(4)), 'eip2930'];
    else if (this.hex.startsWith('0x02')) [txData, type] = [add0x(this.hex.slice(4)), 'eip1559'];
    else [txData, type] = [this.hex, 'legacy'];
    if (prevType && prevType !== type) throw new Error('Invalid transaction type');
    this.type = type;
    const ui8a = RLP.decode(txData) as Uint8Array[];
    this.raw = ui8a.reduce((res: any, value: any, i: number) => {
      const name = TypeToFields[type!][i];
      if (!name) return res;
      res[name] = normalizeField(name, value);
      return res;
    }, {} as RawTxMap);
    if (!this.raw.chainId) {
      // Unsigned transaction with EIP-155
      if (type === 'legacy' && !this.raw.r && !this.raw.s) {
        this.raw.chainId = this.raw.v;
        this.raw.v = '';
      }
    }
    if (!this.raw.chainId) {
      this.raw.chainId = normalizeField(
        'chainId',
        CHAIN_TYPES[chain || Transaction.DEFAULT_CHAIN]
      ) as string;
    }
    this.isSigned = !!(this.raw.r && this.raw.r !== '0x');
  }

  get bytes(): Uint8Array {
    return hexToBytes(this.hex);
  }

  equals(other: Transaction) {
    return this.getMessageToSign() === other.getMessageToSign();
  }

  get chain(): Chain | undefined {
    for (let k in CHAIN_TYPES)
      if (CHAIN_TYPES[k as Chain] === Number(this.raw.chainId!)) return k as Chain;
    return undefined;
  }

  get sender(): string {
    const sender = this.recoverSenderPublicKey();
    if (!sender) throw new Error('Invalid signed transaction');
    return Address.fromPublicKey(sender);
  }

  get gasPrice(): bigint {
    if (this.type === 'eip1559') throw new Error('Field only available for "legacy" transactions');
    return BigInt(this.raw.gasPrice!);
  }

  // maxFeePerGas: Represents the maximum amount that a user is willing to pay for their tx (inclusive of baseFeePerGas and maxPriorityFeePerGas)
  get maxFeePerGas() {
    if (this.type !== 'eip1559') throw new Error('Field only available for "eip1559" transactions');
    return BigInt(this.raw.maxFeePerGas!);
  }

  get maxPriorityFeePerGas() {
    if (this.type !== 'eip1559') throw new Error('Field only available for "eip1559" transactions');
    return BigInt(this.raw.maxPriorityFeePerGas!);
  }

  get gasLimit(): bigint {
    return BigInt(this.raw.gasLimit!);
  }

  // Amount in wei
  get amount(): bigint {
    return BigInt(this.raw.value);
  }
  // Total fee in wei
  get fee(): bigint {
    const price = this.type === 'eip1559' ? this.maxFeePerGas : this.gasPrice;
    return price * this.gasLimit;
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

  private supportsReplayProtection() {
    const properBlock = !['chainstart', 'homestead', 'dao', 'tangerineWhistle'].includes(
      this.hardfork
    );
    if (!this.isSigned) return true; // Unsigned, supports EIP155
    const v = Number(hexToNumber(this.raw.v!));
    const chainId = Number(this.raw.chainId!);
    const meetsConditions = v === chainId * 2 + 35 || v === chainId * 2 + 36;

    return properBlock && meetsConditions;
  }

  getMessageToSign(signed: boolean = false): string {
    let values = (TypeToFields[this.type] as any).map((i: any) => (this.raw as any)[i]);
    if (!signed) {
      // TODO: merge with line #252 somehow? (same strip & EIP-155)
      // Strip signature (last 3 values)
      values = values.slice(0, -3);
      // EIP-155
      if (this.type === 'legacy' && this.supportsReplayProtection())
        values.push(this.raw.chainId! as any, '', '');
    }
    let encoded = RLP.encode(values);
    if (this.type !== 'legacy')
      encoded = new Uint8Array([TRANSACTION_TYPES[this.type], ...Array.from(encoded)]);
    return bytesToHex(keccak_256(encoded));
  }

  // Used in block explorers etc
  get hash(): string {
    if (!this.isSigned) throw new Error('Expected signed transaction');
    return this.getMessageToSign(true);
  }

  async sign(privateKey: string | Uint8Array, extraEntropy = false): Promise<Transaction> {
    if (this.isSigned) throw new Error('Expected unsigned transaction');
    if (typeof privateKey === 'string') privateKey = strip0x(privateKey);
    const [hex, recovery] = await secp256k1.sign(this.getMessageToSign(), privateKey, {
      recovered: true,
      extraEntropy: extraEntropy === false ? undefined : true,
    });
    const signature = secp256k1.Signature.fromHex(hex);
    const chainId = Number(this.raw.chainId!);
    const vv =
      this.type === 'legacy' ? (chainId ? recovery + (chainId * 2 + 35) : recovery + 27) : recovery;
    const [v, r, s] = [vv, signature.r, signature.s].map(numberTo0xHex);
    const signedRaw: RawTxMap =
      this.type === 'legacy'
        ? { ...this.raw, v, r, s }
        : { ...cloneDeep(this.raw), yParity: v, r, s };
    return new Transaction(signedRaw, this.chain, this.hardfork, this.type);
  }

  recoverSenderPublicKey(): Uint8Array | undefined {
    if (!this.isSigned)
      throw new Error('Expected signed transaction: cannot recover sender of unsigned tx');
    const [r, s] = [this.raw.r, this.raw.s].map(hexToNumber);
    const sig = new secp256k1.Signature(r, s);
    // @ts-ignore
    if (this.hardfork !== 'chainstart' && sig.hasHighS()) {
      throw new Error('Invalid signature: s is invalid');
    }
    const signature = sig.toHex();
    const v = Number(hexToNumber(this.type === 'legacy' ? this.raw.v! : this.raw.yParity!));
    const chainId = Number(this.raw.chainId!);
    const recovery = this.type === 'legacy' ? (chainId ? v - (chainId * 2 + 35) : v - 27) : v;
    return secp256k1.recoverPublicKey(this.getMessageToSign(), signature, recovery);
  }
}
