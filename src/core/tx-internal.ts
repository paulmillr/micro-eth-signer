import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { concatBytes } from '@noble/hashes/utils.js';
import * as P from 'micro-packed';
import {
  amounts,
  astring,
  deepFreeze,
  ethHex,
  initSig,
  isBytes,
  isObject,
  sign,
  strip0x,
  type Bytes,
  type TArg,
  type TRet,
} from '../utils.ts';
import { addr } from './address.ts';
import { RLP } from './rlp.ts';

// Transaction parsers

const _0n = /* @__PURE__ */ BigInt(0);

export type AnyCoder = Record<string, P.Coder<any, any>>;
export type AnyCoderStream = Record<string, P.CoderType<any>>;

// EIP-2718 (very ambigious)
// new tx: [0, 0x7f]
// legacy: [0xc0, 0xfe]
// reserved: 0xff
type VersionType<V extends AnyCoderStream> = {
  [K in keyof V]: { type: K; data: P.UnwrapCoder<V[K]> };
}[keyof V];

export type TxCoder<T extends TxType> = P.UnwrapCoder<(typeof TxVersions)[T]>;

const createTxMap = <T extends AnyCoderStream>(versions: T): P.CoderType<VersionType<T>> => {
  const ent = Object.entries(versions);
  // Typed transaction bytes come from TxVersions insertion order, so that object must stay aligned
  // with the EIP-assigned 0x01/0x02/0x03/0x04 values for eip2930/eip1559/eip4844/eip7702.
  // 'legacy' => {type, ver, coder}
  const typeMap = Object.fromEntries(ent.map(([type, coder], ver) => [type, { type, ver, coder }]));
  // '0' => {type, ver, coder}
  const verMap = Object.fromEntries(ent.map(([type, coder], ver) => [ver, { type, ver, coder }]));
  // @ts-ignore
  return P.wrap({
    encodeStream(w: P.Writer, value: VersionType<T>) {
      const t = value.type as string;
      if (!typeMap.hasOwnProperty(t)) throw new Error(`txVersion: wrong type=${t}`);
      const curr = typeMap[t];
      if (t !== 'legacy') w.byte(curr.ver);
      curr.coder.encodeStream(w, value.data);
    },
    decodeStream(r: P.Reader) {
      const v = r.byte(true);
      if (v === 0xff) throw new Error('reserved version 0xff');
      // TODO: version=0 is legacy, but it is never wrapped in test vectors
      if (v === 0x00) throw new Error('version=0 unsupported');
      if (0 <= v && v <= 0x7f) {
        if (!verMap.hasOwnProperty(v.toString())) throw new Error(`wrong version=${v}`);
        const curr = verMap[v];
        r.byte(false); // skip first byte
        const d = curr.coder.decodeStream(r);
        return { type: curr.type, data: d };
      }
      return { type: 'legacy', data: typeMap.legacy.coder.decodeStream(r) };
    },
  });
};

/**
 * Static struct could have been extracted into micro-packed, but we need a specific behavior:
 * - optional fields maybe either all present or all absent, enforced by type
 * - optional fields change the length of underlying array
 */
const isOptBig = (a: unknown) => a === undefined || typeof a === 'bigint';
const isNullOr0 = (a: unknown) => a === undefined || a === BigInt(0);

function assertYParityValid(elm: number) {
  // All current callers use secp256k1 recovery parity, so only recovery ids 0 and 1 are valid here.
  // TODO: is this correct? elm = 0 default?
  if (elm === undefined) elm = 0;
  if (elm !== 0 && elm !== 1) throw new Error(`yParity wrong value=${elm} (${typeof elm})`);
}
// We don't know chainId when specific field coded yet.
// Address length/checksum validation lives in field validators; this alias only preserves raw RLP bytes as hex.
const addrCoder = ethHex;
// Bytes32: VersionedHash, AccessListKey
function ensure32(b: TArg<Uint8Array>): TRet<Uint8Array> {
  if (!isBytes(b) || b.length !== 32) throw new Error('expected 32 bytes');
  return b as TRet<Uint8Array>;
}
const Bytes32: P.Coder<Bytes, string> = {
  encode: (from) => ethHex.encode(ensure32(from)),
  decode: (to) => ensure32(ethHex.decode(to)),
};

type VRS = Partial<{ v: bigint; r: bigint; s: bigint }>;
type YRS = Partial<{ chainId: bigint; yParity: number; r: bigint; s: bigint }>;

// Process v as (chainId, yParity) pair. Ethers.js-inspired logic:
//   - v=27/28 -> no chainId (pre eip155)
//   - r & s == 0 -> v = chainId
// Non-standard, but there is no other way to save chainId for unsignedTx.
// Case: unsigned tx for cold wallet for different chains, like mainnet & testnet.
//   - otherwise v = yParity + 2*chainId + 35
//   - allows to keep legacy logic here, instead of copying to Transaction
export const legacySig = /* @__PURE__ */ (() => ({
  encode: (data: VRS) => {
    const { v, r, s } = data;
    if (v === undefined) return { chainId: undefined };
    // TODO: handle (invalid?) negative v
    if (typeof v !== 'bigint') throw new Error(`invalid v type=${typeof v}`);
    if ((r === undefined && s === undefined) || (r === _0n && s === _0n)) return { chainId: v };
    if (v === BigInt(27)) return { yParity: 0, chainId: undefined, r, s };
    if (v === BigInt(28)) return { yParity: 1, chainId: undefined, r, s };
    if (v < BigInt(35)) throw new Error(`wrong v=${v}`);
    const v2 = v - BigInt(35);
    return { chainId: v2 >> BigInt(1), yParity: Number(v2 & BigInt(1)), r, s };
  },
  decode: (data: YRS) => {
    aobj(data);
    const { chainId, yParity, r, s } = data;
    if (!isOptBig(chainId)) throw new Error(`wrong chainId type=${typeof chainId}`);
    if (!isOptBig(r)) throw new Error(`wrong r type=${typeof r}`);
    if (!isOptBig(s)) throw new Error(`wrong s type=${typeof s}`);
    if (yParity !== undefined && typeof yParity !== 'number')
      throw new Error(`wrong yParity type=${typeof yParity}`);
    if (yParity === undefined) {
      if (chainId !== undefined) {
        if ((r !== undefined && r !== _0n) || (s !== undefined && s !== _0n))
          throw new Error(`wrong unsigned legacy r=${r} s=${s}`);
        return { v: chainId, r: _0n, s: _0n };
      }
      // no parity, chainId, but r, s exists
      if ((r !== undefined && r !== _0n) || (s !== undefined && s !== _0n))
        throw new Error(`wrong unsigned legacy r=${r} s=${s}`);
      return {};
    }
    // parity exists, which means r & s should exist too!
    if (isNullOr0(r) || isNullOr0(s)) throw new Error(`wrong unsigned legacy r=${r} s=${s}`);
    assertYParityValid(yParity);
    const v =
      chainId !== undefined
        ? BigInt(yParity) + (chainId * BigInt(2) + BigInt(35))
        : BigInt(yParity) + BigInt(27);
    return { v, r, s };
  },
}))() as P.Coder<VRS, YRS>;

type BytesBigintCoder = P.Coder<Bytes, bigint>;
type BytesNumberCoder = P.Coder<Bytes, number>;
// Ethereum scalars are RLP byte strings without leading zeros: a zero value is the empty
// string, any other value's first byte is non-zero. ethereum-tests reject leading-zero
// encodings (e.g. ttGasPrice/TransactionWithLeadingZerosGasPrice, ttEIP1559/maxFeePerGas00prefix),
// so we reject them here too; otherwise distinct byte encodings decode to the same tx and the
// tx hash silently changes on re-serialization.
const noLeadingZeroScalar = (coder: BytesBigintCoder): BytesBigintCoder => ({
  encode(from: Bytes) {
    if (isBytes(from) && from.length > 0 && from[0] === 0)
      throw new Error('non-canonical integer: leading zero bytes');
    return coder.encode(from);
  },
  decode: (to) => coder.decode(to),
});
const U64BE: BytesBigintCoder = noLeadingZeroScalar(
  P.coders.reverse(P.bigint(8, false, false, false))
);
const U256BE: BytesBigintCoder = noLeadingZeroScalar(
  P.coders.reverse(P.bigint(32, false, false, false))
);

// Small coder utils
// TODO: seems generic enought for packed? or RLP (seems useful for structured encoding/decoding of RLP stuff)
// Basic array coder
const array = <F, T>(coder: P.Coder<F, T>): P.Coder<F[], T[]> => {
  const map = <I, O>(items: I[], fn: (item: I) => O): O[] => {
    const res: O[] = [];
    for (let i = 0; i < items.length; i++) {
      // Array.prototype.map skips holes; tx list coders must validate every position.
      if (!Object.hasOwn(items, i)) throw new Error(`missing array item ${i}`);
      res.push(fn(items[i]));
    }
    return res;
  };
  return {
    encode(from: F[]) {
      if (!Array.isArray(from)) throw new Error('expected array');
      return map(from, (i) => coder.encode(i));
    },
    decode(to: T[]) {
      if (!Array.isArray(to)) throw new Error('expected array');
      return map(to, (i) => coder.decode(i));
    },
  };
};
// tuple -> struct
const struct = <
  Fields extends Record<string, P.Coder<any, any>>,
  FromTuple extends {
    [K in keyof Fields]: Fields[K] extends P.Coder<infer F, any> ? F : never;
  }[keyof Fields][],
  ToObject extends { [K in keyof Fields]: Fields[K] extends P.Coder<any, infer T> ? T : never },
>(
  fields: Fields
): P.Coder<FromTuple, ToObject> => ({
  encode(from: FromTuple) {
    if (!Array.isArray(from)) throw new Error('expected array');
    // Tuple order is the insertion order of `fields`, so callers must build it in exact on-wire order.
    const fNames = Object.keys(fields);
    if (from.length !== fNames.length) throw new Error('wrong array length');
    return Object.fromEntries(fNames.map((f, i) => [f, fields[f].encode(from[i])])) as ToObject;
  },
  decode(to: ToObject): FromTuple {
    const fNames = Object.keys(fields);
    if (!isObject(to)) throw new Error('wrong struct object');
    return fNames.map((i) => fields[i].decode(to[i])) as FromTuple;
  },
});

// treeshake: authorization-only bundles should not keep extra tx coder locals alive.
const mkYParityCoder = /* @__PURE__ */ (): TRet<BytesNumberCoder> =>
  P.coders.reverse(
    P.validate(P.int(1, false, false, false), (elm) => {
      assertYParityValid(elm);
      return elm;
    })
  ) as TRet<BytesNumberCoder>;
type CoderOutput<F> = F extends P.Coder<any, infer T> ? T : never;

type AccessListItemCoder = P.Coder<
  [Bytes, Bytes[]],
  {
    address: string;
    storageKeys: string[];
  }
>;
const mkAccessListItem = /* @__PURE__ */ (): TRet<AccessListItemCoder> =>
  struct({ address: addrCoder, storageKeys: array(Bytes32) }) as TRet<AccessListItemCoder>;
export type AccessList = CoderOutput<ReturnType<typeof mkAccessListItem>>[];

export const authorizationRequest: TRet<
  P.Coder<
    Bytes[],
    {
      chainId: bigint;
      address: string;
      nonce: bigint;
    }
  >
> = /* @__PURE__ */ struct({
  chainId: U256BE,
  address: addrCoder,
  nonce: U64BE,
}) as TRet<
  P.Coder<
    Bytes[],
    {
      chainId: bigint;
      address: string;
      nonce: bigint;
    }
  >
>;
// [chain_id, address, nonce, y_parity, r, s]
type AuthorizationItemCoder = P.Coder<
  [Bytes, Bytes, Bytes, Bytes, Bytes, Bytes],
  {
    chainId: bigint;
    address: string;
    nonce: bigint;
    yParity: number;
    r: bigint;
    s: bigint;
  }
>;
const mkAuthorizationItem = /* @__PURE__ */ (): TRet<AuthorizationItemCoder> =>
  struct({
    chainId: U256BE,
    address: addrCoder,
    nonce: U64BE,
    yParity: mkYParityCoder(),
    r: U256BE,
    s: U256BE,
  }) as TRet<AuthorizationItemCoder>;
export type AuthorizationItem = CoderOutput<ReturnType<typeof mkAuthorizationItem>>;
export type AuthorizationRequest = CoderOutput<typeof authorizationRequest>;

type AccessListItemWire = [Bytes, Bytes[]];
type AuthorizationItemWire = [Bytes, Bytes, Bytes, Bytes, Bytes, Bytes];
type TxCoders = {
  chainId: BytesBigintCoder;
  nonce: BytesBigintCoder;
  gasPrice: BytesBigintCoder;
  maxPriorityFeePerGas: BytesBigintCoder;
  maxFeePerGas: BytesBigintCoder;
  gasLimit: BytesBigintCoder;
  to: typeof ethHex;
  value: BytesBigintCoder;
  data: typeof ethHex;
  accessList: P.Coder<AccessListItemWire[], AccessList>;
  maxFeePerBlobGas: BytesBigintCoder;
  blobVersionedHashes: P.Coder<Bytes[], string[]>;
  yParity: BytesNumberCoder;
  v: BytesBigintCoder;
  r: BytesBigintCoder;
  s: BytesBigintCoder;
  authorizationList: P.Coder<AuthorizationItemWire[], AuthorizationItem[]>;
};
/** Field types, matching geth. Either u64 or u256. */
const coders: TxCoders = /* @__PURE__ */ (() => ({
  chainId: U256BE, // Can fit into u64 (curr max is 0x57a238f93bf), but geth uses bigint
  nonce: U64BE,
  gasPrice: U256BE,
  maxPriorityFeePerGas: U256BE,
  maxFeePerGas: U256BE,
  gasLimit: U64BE,
  to: addrCoder,
  value: U256BE, // "Decimal" coder can be used, but it's harder to work with
  data: ethHex,
  accessList: array(mkAccessListItem()),
  maxFeePerBlobGas: U256BE,
  blobVersionedHashes: array(Bytes32),
  yParity: mkYParityCoder(),
  v: U256BE,
  r: U256BE,
  s: U256BE,
  authorizationList: array(mkAuthorizationItem()),
}))();
type Coders = TxCoders;
type CoderName = keyof Coders;
const signatureFields = new Set(['v', 'yParity', 'r', 's'] as const);

type FieldType<T> = T extends P.Coder<any, infer U> ? U : T;
// Could be 'T | (T & O)', to make sure all partial fields either present or absent together
// But it would make accesing them impossible, because of typescript stuff:
type OptFields<T, O> = T & Partial<O>;
type FieldCoder<C> = P.CoderType<C> & {
  fields: CoderName[];
  optionalFields: CoderName[];
  setOfAllFields: Set<CoderName | 'type'>;
};
type TxFieldCoder<T extends readonly CoderName[], ST extends readonly CoderName[]> = FieldCoder<
  OptFields<{ [K in T[number]]: FieldType<Coders[K]> }, { [K in ST[number]]: FieldType<Coders[K]> }>
>;

// Mutates raw. Make sure to copy it in advance
export function removeSig(raw: TxCoder<any>): TxCoder<any> {
  signatureFields.forEach((k) => {
    delete raw[k];
  });
  return raw;
}

/**
 * Defines RLP transaction with fields taken from `coders`.
 * @example
 * // Build a coder for a minimal nonce/gas/value transaction shape.
 *   const tx = txStruct(['nonce', 'gasPrice', 'value'] as const, ['v', 'r', 's'] as const)
 *   tx.nonce.decode(...);
 */
const txStruct = <T extends readonly CoderName[], ST extends readonly CoderName[]>(
  reqf: T,
  optf: ST
): TRet<TxFieldCoder<T, ST>> => {
  const allFields = reqf.concat(optf);
  // Check that all fields have known coders
  allFields.forEach((f) => {
    if (!coders.hasOwnProperty(f)) throw new Error(`coder for field ${f} is not defined`);
  });
  const reqS = struct(Object.fromEntries(reqf.map((i) => [i, coders[i]])));
  const allS = struct(Object.fromEntries(allFields.map((i) => [i, coders[i]])));
  // e.g. eip1559 txs have valid lengths of 9 or 12 (unsigned / signed)
  const reql = reqf.length;
  const optl = reql + optf.length;
  const optFieldAt = (i: number) => reql + i;
  const isEmpty = (item: any & { length: number }) => item.length === 0;
  // TX is a bunch of fields in specific order. Field like nonce must always be at the same index.
  // We walk through all indexes in proper order.
  const fcoder: any = P.wrap({
    encodeStream(w, raw: Record<string, any>) {
      // If at least one optional key is present, we add whole optional block
      const hasOptional = optf.some((f) => Object.hasOwn(raw, f));
      const sCoder = hasOptional ? allS : reqS;
      RLP.encodeStream(w, sCoder.decode(raw));
    },
    decodeStream(r): Record<string, any> {
      const decoded = RLP.decodeStream(r);
      if (!Array.isArray(decoded)) throw new Error('txStruct: expected array from inner coder');
      const length = decoded.length;
      if (length !== reql && length !== optl)
        throw new Error(`txStruct: wrong inner length=${length}`);
      const sCoder = length === optl ? allS : reqS;
      if (length === optl && optf.every((_, i) => isEmpty(decoded[optFieldAt(i)])))
        throw new Error('all optional fields empty');
      // @ts-ignore TODO: fix type (there can be null in RLP)
      return sCoder.encode(decoded);
    },
  });

  fcoder.fields = reqf;
  fcoder.optionalFields = optf;
  fcoder.setOfAllFields = new Set(allFields.concat(['type'] as any));
  return fcoder as TRet<TxFieldCoder<T, ST>>;
};

// prettier-ignore
const legacyInternal: FieldCoder<OptFields<{
  nonce: bigint;
  gasPrice: bigint;
  gasLimit: bigint;
  to: string;
  value: bigint;
  data: string;
}, {
  r: bigint;
  s: bigint;
  v: bigint;
}>> = /* @__PURE__ */ txStruct(
  ['nonce', 'gasPrice', 'gasLimit', 'to', 'value', 'data'] as const,
  ['v', 'r', 's'] as const
);

type LegacyInternal = P.UnwrapCoder<typeof legacyInternal>;
type Legacy = Omit<LegacyInternal, 'v'> & { chainId?: bigint; yParity?: number };

const legacy: FieldCoder<Legacy> = /* @__PURE__ */ (() => {
  const res = P.apply(legacyInternal, {
    decode: (data: Legacy) => Object.assign({}, data, legacySig.decode(data)),
    encode: (data: LegacyInternal) => {
      const res = Object.assign({}, data);
      (res as any).chainId = undefined;
      if (data.v) {
        const newV = legacySig.encode(data);
        removeSig(res);
        Object.assign(res, newV);
      }
      return res as Legacy;
    },
  }) as FieldCoder<Legacy>;
  res.fields = legacyInternal.fields.concat(['chainId'] as const);
  // v, r, s -> yParity, r, s
  // TODO: what about chainId?
  res.optionalFields = ['yParity', 'r', 's'];
  res.setOfAllFields = new Set(res.fields.concat(res.optionalFields, ['type'] as any));
  return res;
})();

// prettier-ignore
const eip2930: TxFieldCoder<
  readonly ['chainId', 'nonce', 'gasPrice', 'gasLimit', 'to', 'value', 'data', 'accessList'],
  readonly ['yParity', 'r', 's']
> = /* @__PURE__ */ txStruct([
  'chainId', 'nonce', 'gasPrice', 'gasLimit', 'to', 'value', 'data', 'accessList'] as const,
  ['yParity', 'r', 's'] as const);

// prettier-ignore
const eip1559: TxFieldCoder<
  readonly ['chainId', 'nonce', 'maxPriorityFeePerGas', 'maxFeePerGas', 'gasLimit', 'to', 'value', 'data', 'accessList'],
  readonly ['yParity', 'r', 's']
> = /* @__PURE__ */ txStruct([
  'chainId', 'nonce', 'maxPriorityFeePerGas', 'maxFeePerGas', 'gasLimit', 'to', 'value', 'data', 'accessList'] as const,
  ['yParity', 'r', 's'] as const);
// prettier-ignore
const eip4844: TxFieldCoder<
  readonly ['chainId', 'nonce', 'maxPriorityFeePerGas', 'maxFeePerGas', 'gasLimit', 'to', 'value', 'data', 'accessList', 'maxFeePerBlobGas', 'blobVersionedHashes'],
  readonly ['yParity', 'r', 's']
> = /* @__PURE__ */ txStruct([
  'chainId', 'nonce', 'maxPriorityFeePerGas', 'maxFeePerGas', 'gasLimit', 'to', 'value', 'data', 'accessList',
  'maxFeePerBlobGas', 'blobVersionedHashes'] as const,
  ['yParity', 'r', 's'] as const);
// prettier-ignore
const eip7702: TxFieldCoder<
  readonly ['chainId', 'nonce', 'maxPriorityFeePerGas', 'maxFeePerGas', 'gasLimit', 'to', 'value', 'data', 'accessList', 'authorizationList'],
  readonly ['yParity', 'r', 's']
> = /* @__PURE__ */ txStruct([
  'chainId', 'nonce', 'maxPriorityFeePerGas', 'maxFeePerGas', 'gasLimit', 'to', 'value', 'data', 'accessList',
  'authorizationList'] as const,
  ['yParity', 'r', 's'] as const);

export const TxVersions = {
  legacy, // 0x00 (kinda)
  eip2930, // 0x01
  eip1559, // 0x02
  eip4844, // 0x03
  eip7702, // 0x04
};

export const RawTx = /* @__PURE__ */ (() =>
  P.apply(createTxMap(TxVersions), {
    // NOTE: we apply checksum to addresses here, since chainId is not available inside coders
    // By construction 'to' field is decoded before anything about chainId is known
    encode: (data) => {
      data.data.to = addr.addChecksum(data.data.to, true);
      if (data.type !== 'legacy' && data.data.accessList) {
        for (const item of data.data.accessList) {
          item.address = addr.addChecksum(item.address);
        }
      }
      if (data.type === 'eip7702' && data.data.authorizationList) {
        for (const item of data.data.authorizationList) {
          item.address = addr.addChecksum(item.address);
        }
      }
      return data;
    },
    // Nothing to check here, is validated in validator
    decode: (data) => data,
  }))();

/**
 * Unchecked TX for debugging. Returns raw Uint8Array-s.
 * Handles versions - plain RLP will crash on it.
 */
export const RlpTx: TRet<
  P.CoderType<{
    type: string;
    data: import('./rlp.ts').RLPInput;
  }>
> = /* @__PURE__ */ (() =>
  createTxMap(Object.fromEntries(Object.keys(TxVersions).map((k) => [k, RLP]))))() as TRet<
  P.CoderType<{
    type: string;
    data: import('./rlp.ts').RLPInput;
  }>
>;

// Field-related utils
export type TxType = keyof typeof TxVersions;

// prettier-ignore
// Basically all numbers. Can be useful if we decide to do converter from hex here
// const knownFieldsNoLeading0 = [
//   'nonce', 'maxPriorityFeePerGas', 'maxFeePerGas', 'gasLimit', 'value', 'yParity', 'r', 's'
// ] as const;

function abig(val: bigint) {
  if (typeof val !== 'bigint') throw new Error('value must be bigint');
}
function aobj(val: Record<string, any>) {
  // JS has proxies/classes/null-prototype objects, so this only rejects common accidental containers.
  if (typeof val !== 'object' || val == null || Array.isArray(val) || isBytes(val))
    throw new Error('object expected');
}
function minmax(val: bigint, min: bigint, max: bigint, err?: string): void;
function minmax(val: number, min: number, max: number, err?: string): void;
function minmax(
  val: number | bigint,
  min: number | bigint,
  max: number | bigint,
  err?: string
): void {
  if (!err) err = `>= ${min} and <= ${max}`;
  if (Number.isNaN(val) || val < min || val > max) throw new Error(`must be ${err}, not ${val}`);
}
export const calcIntrinsicGas = (type: TxType, data: Record<string, any>): bigint => {
  let gas = amounts.minGasLimit;
  if (typeof data.data === 'string') {
    let bytes: Uint8Array | undefined;
    try {
      bytes = ethHex.decode(data.data);
    } catch {
      // Let the data coder report malformed hex instead of surfacing it as a gas-limit error.
    }
    if (bytes) {
      for (const byte of bytes) {
        // EIP-2930 §Specification: intrinsic calldata cost is 4 gas for zero bytes and 16 for non-zero bytes.
        gas += byte === 0 ? BigInt(4) : BigInt(16);
      }
      if (data.to === '0x') {
        // EIP-3860 §Specification: create-transaction intrinsic gas includes 2 gas per 32-byte initcode word.
        gas += BigInt(Math.ceil(bytes.length / 32) * 2);
      }
    }
  }
  if (type !== 'legacy' && Array.isArray(data.accessList)) {
    // EIP-2930 §Specification access-list gas charge: 2400 per address and 1900 per storage key.
    gas += BigInt(data.accessList.length) * BigInt(2400);
    for (const item of data.accessList) {
      if (item && Array.isArray(item.storageKeys))
        gas += BigInt(item.storageKeys.length) * BigInt(1900);
    }
  }
  if (type === 'eip7702' && Array.isArray(data.authorizationList)) {
    // EIP-7702 §Gas Costs: add PER_EMPTY_ACCOUNT_COST * authorization list length; PER_EMPTY_ACCOUNT_COST = 25000.
    gas += BigInt(data.authorizationList.length) * BigInt(25000);
  }
  return gas;
};

// strict=true validates if human-entered value in UI is "sort of" valid
// for some new TX. For example, it's unlikely that the nonce would be 14 million.
// strict=false validates if machine-entered value, or something historical is valid.

type ValidationOpts = { strict: boolean; type: TxType; data: Record<string, any> };
// NOTE: non-strict validators can be removed (RawTx will handle that), but errors will be less user-friendly.
// On other hand, we twice per sig because tx is immutable
// data passed for composite checks (gasLimit * maxFeePerGas overflow and stuff) [not implemented yet]
const validators: Record<string, (num: any, { strict, type, data }: ValidationOpts) => void> = {
  nonce(num: bigint, { strict }: ValidationOpts) {
    abig(num);
    if (strict) minmax(num, _0n, amounts.maxNonce);
    // EIP-2681 §Specification: transactions are invalid when nonce >= 2**64 - 1.
    else minmax(num, _0n, amounts.maxUint64 - BigInt(1));
  },
  maxFeePerGas(num: bigint, { strict, data }: ValidationOpts) {
    abig(num);
    if (strict) minmax(num, BigInt(1), amounts.maxGasPrice, '>= 1 wei and < 10000 gwei');
    else minmax(num, _0n, amounts.maxUint256);
    // EIP-1559 §Reference implementation validity checks bounds fee caps as uint256,
    // while tx validity still rejects gasLimit * maxFeePerGas overflow.
    if (typeof data.gasLimit === 'bigint' && data.gasLimit * num > amounts.maxUint256)
      throw new Error('gasLimit * maxFeePerGas overflows uint256');
  },
  maxPriorityFeePerGas(num: bigint, { strict, data }: ValidationOpts) {
    abig(num);
    if (strict) minmax(num, _0n, amounts.maxGasPrice, '>= 1 wei and < 10000 gwei');
    // EIP-1559 §Reference implementation validity checks bounds priority fee as uint256.
    else minmax(num, _0n, amounts.maxUint256);
    if (data && typeof data.maxFeePerGas === 'bigint' && data.maxFeePerGas < num) {
      throw new Error(`cannot be bigger than maxFeePerGas=${data.maxFeePerGas}`);
    }
  },
  gasLimit(num: bigint, { strict, type, data }: ValidationOpts) {
    abig(num);
    if (strict) {
      minmax(num, amounts.minGasLimit, amounts.maxGasLimit);
      // EIP-1559 §Specification uses the EIP-2930 intrinsic-gas formula for typed tx validity.
      const min = calcIntrinsicGas(type, data);
      if (num < min) throw new Error(`intrinsic gas too low: ${num} < ${min}`);
    } else minmax(num, _0n, amounts.maxUint64);
  },
  to(address: string, { strict, type, data }: ValidationOpts) {
    if (!addr.isValid(address, true)) throw new Error('address checksum does not match');
    // EIP-4844 §Blob transaction: `to` MUST NOT be nil and must be a 20-byte address.
    // EIP-7702 §Set code transaction imports the same destination semantics.
    if ((type === 'eip4844' || type === 'eip7702') && address === '0x')
      throw new Error(`${type} transaction destination must not be empty`);
    if (strict && address === '0x' && !data.data)
      throw new Error('Empty address (0x) without contract deployment code');
  },
  value(num: bigint, { strict }: ValidationOpts) {
    abig(num);
    if (strict) minmax(num, _0n, amounts.maxAmount, '>= 0 and < 1M eth');
  },
  data(val: string, { strict, data }: ValidationOpts) {
    if (typeof val !== 'string') throw new Error('data must be string');
    if (strict) {
      if (val.length > amounts.maxDataSize) throw new Error('data is too big: ' + val.length);
    }
    // EIP-3860/EIP-7907 limit initcode bytes; the optional 0x prefix is not initcode.
    const initcodeHexLen = strip0x(val).length;
    if (data.to === '0x' && initcodeHexLen > 2 * amounts.maxInitDataSize)
      throw new Error(`initcode is too big: ${initcodeHexLen}`);
  },
  chainId(num: bigint, { strict, type, data }: ValidationOpts) {
    // chainId is optional for legacy transactions
    if (type === 'legacy' && num === undefined) return;
    abig(num);
    if (strict) {
      // Signed legacy chainId is inferred from EIP-155 v; keep the existing strict cap so invalid-v vectors still fail.
      const max =
        type === 'legacy' && (data.yParity === 0 || data.yParity === 1)
          ? amounts.maxChainId
          : amounts.maxUint256;
      minmax(num, BigInt(1), max);
    }
  },
  accessList(list: AccessList) {
    // NOTE: we cannot handle this validation in coder, since it requires chainId to calculate correct checksum
    for (const { address } of list) {
      if (!addr.isValid(address)) throw new Error('address checksum does not match');
    }
  },
  blobVersionedHashes(list: string[], { strict }: ValidationOpts) {
    if (!Array.isArray(list)) return;
    // EIP-4844 block validity requires at least one blob and version byte 0x01.
    // Empty lists stay non-strict so codec vectors with syntactic type-3 txs can roundtrip.
    if (strict && list.length === 0) throw new Error('must contain at least one versioned hash');
    for (let i = 0; i < list.length; i++) {
      if (!Object.hasOwn(list, i)) continue;
      const hash = list[i];
      if (typeof hash !== 'string') continue;
      const hex = hash[0] === '0' && (hash[1] === 'x' || hash[1] === 'X') ? hash.slice(2) : hash;
      const firstByte = hex.length & 1 ? `0${hex[0] || ''}` : hex.slice(0, 2);
      if (firstByte.toLowerCase() !== '01') throw new Error('versioned hash must start with 0x01');
    }
  },
  authorizationList(list: AuthorizationItem[], opts: ValidationOpts) {
    // EIP-7702 §Set code transaction / Non-empty authorization list required: length zero is invalid.
    if (Array.isArray(list) && list.length === 0)
      throw new Error('must contain at least one authorization');
    for (const { address, nonce, chainId } of list) {
      if (!addr.isValid(address)) throw new Error('address checksum does not match');
      // EIP-7702 uses auth chain_id = 0 as the any-chain sentinel; non-zero ids are uint256-bound.
      abig(chainId);
      if (opts.strict) minmax(chainId, _0n, amounts.maxUint256, '>= 0 and < 2**256');
      this.nonce(nonce, opts);
    }
  },
};

// Validation
type ErrObj = { field: string; error: string };
export class AggregatedError extends Error {
  message: string;
  errors: ErrObj[];
  constructor(message: string, errors: ErrObj[]) {
    super();
    this.message = message;
    this.errors = errors;
  }
}

export function validateFields(
  type: TxType,
  data: Record<string, any>,
  strict = true,
  allowSignatureFields = true
): void {
  aobj(data);
  if (!TxVersions.hasOwnProperty(type)) throw new Error(`unknown tx type=${type}`);
  const txType = TxVersions[type];
  const dataFields = new Set(Object.keys(data));
  const dataHas = (field: string) => dataFields.has(field);
  function checkField(field: TArg<CoderName>) {
    if (!dataHas(field)) {
      // Legacy transactions can be pre-EIP-155, where chainId is absent instead of undefined.
      if (type === 'legacy' && field === 'chainId') return;
      return { field, error: `field "${field}" must be present for tx type=${type}` };
    }
    const val = data[field];
    try {
      if (validators.hasOwnProperty(field)) validators[field](val, { data, strict, type });
      // Pre-EIP-155 legacy txs can carry explicit `chainId: undefined`; real ids still need U256 bounds.
      if (type === 'legacy' && field === 'chainId' && val === undefined) return;
      coders[field].decode(val as never); // decoding may throw an error
    } catch (error) {
      // No early-return: when multiple fields have error, we should show them all.
      return { field, error: (error as Error).message };
    }
    return undefined;
  }
  // All fields are required.
  const reqErrs = txType.fields.map(checkField);
  // Signature fields should be all present or all missing
  const optErrs = txType.optionalFields.some(dataHas) ? txType.optionalFields.map(checkField) : [];

  // Check if user data has unexpected fields
  const unexpErrs = Object.keys(data).map((field) => {
    if (!txType.setOfAllFields.has(field as any))
      return { field, error: `unknown field "${field}" for tx type=${type}` };
    if (!allowSignatureFields && signatureFields.has(field as any)) {
      return {
        field,
        error: `field "${field}" is sig-related and must not be user-specified`,
      };
    }
    return;
  });
  const errors = (reqErrs as (ErrObj | undefined)[])
    .concat(optErrs, unexpErrs)
    .filter((val) => val !== undefined) as ErrObj[];
  if (errors.length > 0) throw new AggregatedError('fields had validation errors', errors);
}

// prettier-ignore
const sortedFieldOrder = [
  'to', 'value', 'nonce',
  'maxFeePerGas', 'maxFeePerBlobGas', 'maxPriorityFeePerGas', 'gasPrice', 'gasLimit',
  'accessList', 'authorizationList', 'blobVersionedHashes', 'chainId', 'data', 'type',
  'r', 's', 'yParity', 'v'
] as const;

// TODO: remove any
export function sortRawData(raw: TxCoder<any>): any {
  const sortedRaw: Record<string, any> = {};
  const sorted = new Set<string>();
  for (const field of sortedFieldOrder) {
    if (!Object.hasOwn(raw, field)) continue;
    sortedRaw[field] = raw[field];
    sorted.add(field);
  }
  // Preserve unknown own fields so validateFields can reject them instead of prepare dropping them.
  for (const field of Object.keys(raw)) {
    if (sorted.has(field)) continue;
    sortedRaw[field] = raw[field];
  }
  return sortedRaw;
}

export function decodeLegacyV(raw: TxCoder<any>): bigint | undefined {
  return legacySig.decode(raw).v;
}

/** EIP-7702 Authorizations. */
type AuthorizationHelpers = {
  _getHash: (req: AuthorizationRequest) => TRet<Uint8Array>;
  sign: (req: AuthorizationRequest, privateKey: string) => AuthorizationItem;
  getAuthority: (item: AuthorizationItem) => string;
};
export const authorization: TRet<AuthorizationHelpers> = /* @__PURE__ */ deepFreeze({
  _getHash(req: AuthorizationRequest): TRet<Uint8Array> {
    const msg = RLP.encode(authorizationRequest.decode(req));
    return keccak_256(concatBytes(new Uint8Array([0x05]), msg));
  },
  sign(req: AuthorizationRequest, privateKey: string): AuthorizationItem {
    astring(privateKey);
    const sig = sign(this._getHash(req), ethHex.decode(privateKey));
    return { ...req, r: sig.r, s: sig.s, yParity: sig.recovery! };
  },
  getAuthority(item: AuthorizationItem): string {
    if (!isObject(item)) throw new TypeError('"item" expected object, got type=' + typeof item);
    const { r, s, yParity, ...req } = item;
    const hash = this._getHash(req);
    const sig = initSig({ r, s }, yParity);
    // const point = sig.recoverPublicKey(hash);
    const bytes = secp256k1.recoverPublicKey(sig.toBytes('recovered'), hash, { prehash: false });
    return addr.fromPublicKey(bytes);
  },
});

// NOTE: for tests only, don't use
export const __tests: any = { legacySig, TxVersions };
