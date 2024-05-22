import * as P from 'micro-packed';
import { addr } from './address.js';
import { RLP } from './rlp.js';
import { isBytes, amounts, ethHex } from './utils.js';

// Transaction parsers

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
  // 'legacy' => {type, ver, coder}
  const typeMap = Object.fromEntries(ent.map(([type, coder], ver) => [type, { type, ver, coder }]));
  // '0' => {type, ver, coder}
  const verMap = Object.fromEntries(ent.map(([type, coder], ver) => [ver, { type, ver, coder }]));
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
const isNullOr0 = (a: unknown) => a === undefined || a === 0n;

function assertYParityValid(elm: number) {
  // TODO: is this correct? elm = 0 default?
  if (elm === undefined) elm = 0;
  if (elm !== 0 && elm !== 1) throw new Error(`yParity wrong value=${elm} (${typeof elm})`);
}
// We don't know chainId when specific field coded yet.
const addrCoder = ethHex;

// Parses eip2930 access lists:
// ["0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae", [
//    "0x0000000000000000000000000000000000000000000000000000000000000003",
//    "0x0000000000000000000000000000000000000000000000000000000000000007"
// ]]
export type AccessList = [string, string[]][];
export type BytesAccessList = [Uint8Array, Uint8Array[]][];
function accessListParser<T, K>(coder: (a: T) => K, mapper: (a: T) => K) {
  return (data: [T, T[]][]) => {
    if (!Array.isArray(data)) throw new Error('access list must be an array');
    return data.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2)
        throw new Error('access list must have 2 elements');
      return [coder(pair[0]), pair[1].map(mapper)];
    });
  };
}

// Parses eip4844 blobs:
// ["0x0000000000000000000000000000000000000000000000000000000000000003"...]
function blobParser<T, K>(fn: (item: T) => K) {
  return (data: T[]) => {
    if (!Array.isArray(data)) throw new Error('blobVersionedHashes must be an array');
    return data.map(fn);
  };
}

function ensure32<T>(b: any & { length: number }): T {
  if (b.length !== 32) throw new Error('slot must be 32 bytes');
  return b;
}
function ensureBlob(hash: Uint8Array): Uint8Array {
  if (!isBytes(hash) || hash.length !== 32)
    throw new Error('blobVersionedHashes must contain 32-byte Uint8Array-s');
  return hash;
}

type VRS = Partial<{ v: bigint; r: bigint; s: bigint }>;
type YRS = Partial<{ chainId: bigint; yParity: number; r: bigint; s: bigint }>;

// Process v as (chainId, yParity) pair. Ethers.js-inspired logic:
//   - v=27/28 -> no chainId (pre eip155)
//   - r & s == 0 -> v = chainId
// Non-standard, but there is no other way to save chainId for unsignedTx.
// Case: unsigned tx for cold wallet for different chains, like mainnet & testnet.
//   - otherwise v = yParity + 2*chainId + 35
//   - allows to keep legacy logic here, instead of copying to Transaction
export const legacySig = {
  encode: (data: VRS) => {
    const { v, r, s } = data;
    if (v === undefined) return { chainId: undefined };
    // TODO: handle (invalid?) negative v
    if (typeof v !== 'bigint') throw new Error(`invalid v type=${typeof v}`);
    if ((r === undefined && s === undefined) || (r === 0n && s === 0n)) return { chainId: v };
    if (v === 27n) return { yParity: 0, chainId: undefined, r, s };
    if (v === 28n) return { yParity: 1, chainId: undefined, r, s };
    if (v < 35n) throw new Error(`wrong v=${v}`);
    const v2 = v - 35n;
    return { chainId: v2 >> 1n, yParity: Number(v2 & 1n), r, s };
  },
  decode: (data: YRS) => {
    aobj(data);
    const { chainId, yParity, r, s } = data;
    if (!isOptBig(chainId)) throw new Error(`wrong chainId type=${typeof chainId}`);
    if (!isOptBig(r)) throw new Error(`wrong r type=${typeof r}`);
    if (!isOptBig(s)) throw new Error(`wrong s type=${typeof s}`);
    if (yParity !== undefined && typeof yParity !== 'number')
      throw new Error(`wrong yParity type=${typeof chainId}`);
    if (yParity === undefined) {
      if (chainId !== undefined) {
        if ((r !== undefined && r !== 0n) || (s !== undefined && s !== 0n))
          throw new Error(`wrong unsigned legacy r=${r} s=${s}`);
        return { v: chainId, r: 0n, s: 0n };
      }
      // no parity, chainId, but r, s exists
      if ((r !== undefined && r !== 0n) || (s !== undefined && s !== 0n))
        throw new Error(`wrong unsigned legacy r=${r} s=${s}`);
      return {};
    }
    // parity exists, which means r & s should exist too!
    if (isNullOr0(r) || isNullOr0(s)) throw new Error(`wrong unsigned legacy r=${r} s=${s}`);
    assertYParityValid(yParity);
    const v =
      chainId !== undefined ? BigInt(yParity) + (chainId * 2n + 35n) : BigInt(yParity) + 27n;
    return { v, r, s };
  },
} as P.Coder<VRS, YRS>;

const U64BE = P.coders.reverse(P.bigint(8, false, false, false));
const U256BE = P.coders.reverse(P.bigint(32, false, false, false));
/**
 * Field types, matching geth. Either u64 or u256.
 */
const coders = {
  chainId: U256BE, // Can fit into u64 (curr max is 0x57a238f93bf), but geth uses bigint
  nonce: U64BE,
  gasPrice: U256BE,
  maxPriorityFeePerGas: U256BE,
  maxFeePerGas: U256BE,
  gasLimit: U64BE,
  to: addrCoder,
  value: U256BE, // "Decimal" coder can be used, but it's harder to work with
  data: ethHex,
  accessList: {
    decode: accessListParser(addrCoder.decode, (k) => ensure32(ethHex.decode(k))),
    encode: accessListParser(addrCoder.encode, (k) => ethHex.encode(ensure32(k))),
  } as P.Coder<BytesAccessList, AccessList>,
  maxFeePerBlobGas: U256BE,
  blobVersionedHashes: {
    decode: blobParser((b) => ensureBlob(ethHex.decode(b))),
    encode: blobParser((b) => ethHex.encode(ensureBlob(b))),
  } as P.Coder<Uint8Array[], string[]>,
  // U256BE in geth. But it is either 0 or 1. TODO: is this good enough?
  yParity: P.coders.reverse(
    P.validate(P.int(1, false, false, false), (elm) => {
      assertYParityValid(elm);
      return elm;
    })
  ),
  v: U256BE,
  r: U256BE,
  s: U256BE,
};
type Coders = typeof coders;
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
 *   const tx = txStruct(['nonce', 'gasPrice', 'value'] as const, ['v', 'r', 's'] as const)
 *   tx.nonce.decode(...);
 */
const txStruct = <T extends readonly CoderName[], ST extends readonly CoderName[]>(
  reqf: T,
  optf: ST
): FieldCoder<
  OptFields<{ [K in T[number]]: FieldType<Coders[K]> }, { [K in ST[number]]: FieldType<Coders[K]> }>
> => {
  // Check that all fields have known coders
  reqf.concat(optf).forEach((f) => {
    if (!coders.hasOwnProperty(f)) throw new Error(`coder for field ${f} is not defined`);
  });
  // e.g. eip1559 txs have valid lengths of 9 or 12 (unsigned / signed)
  const reql = reqf.length;
  const optl = reql + optf.length;
  const optFieldAt = (i: number) => reql + i;
  const isEmpty = (item: any & { length: number }) => item.length === 0;
  // TX is a bunch of fields in specific order. Field like nonce must always be at the same index.
  // We walk through all indexes in proper order.
  const fcoder: any = P.wrap({
    encodeStream(w, raw: Record<string, any>) {
      // @ts-ignore TODO: fix type
      const values = reqf.map((f) => coders[f].decode(raw[f]));
      // If at least one optional key is present, we add whole optional block
      if (optf.some((f) => raw.hasOwnProperty(f)))
        // @ts-ignore TODO: fix type
        optf.forEach((f) => values.push(coders[f].decode(raw[f])));
      RLP.encodeStream(w, values);
    },
    decodeStream(r): Record<string, any> {
      const decoded = RLP.decodeStream(r);
      if (!Array.isArray(decoded)) throw new Error('txStruct: expected array from inner coder');
      const length = decoded.length;
      if (length !== reql && length !== optl)
        throw new Error(`txStruct: wrong inner length=${length}`);
      const raw = Object.fromEntries(
        // @ts-ignore TODO: fix type
        reqf.map((f, i) => [f, coders[f].encode(decoded[i])])
      );
      if (length === optl) {
        if (optf.every((_, i) => isEmpty(decoded[optFieldAt(i)])))
          throw new Error('all optional fields empty');
        const rawSig = Object.fromEntries(
          // @ts-ignore TODO: fix type
          optf.map((f, i) => [f, coders[f].encode(decoded[optFieldAt(i)])])
        );
        Object.assign(raw, rawSig); // mutate raw
      }
      return raw;
    },
  });

  fcoder.fields = reqf;
  fcoder.optionalFields = optf;
  fcoder.setOfAllFields = new Set(reqf.concat(optf, ['type'] as any));
  return fcoder;
};

// prettier-ignore
const legacyInternal = txStruct([
  'nonce', 'gasPrice', 'gasLimit', 'to', 'value', 'data'] as const,
  ['v', 'r', 's'] as const);

type LegacyInternal = P.UnwrapCoder<typeof legacyInternal>;
type Legacy = Omit<LegacyInternal, 'v'> & { chainId?: bigint; yParity?: number };

const legacy = (() => {
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
const eip2930 = txStruct([
  'chainId', 'nonce', 'gasPrice', 'gasLimit', 'to', 'value', 'data', 'accessList'] as const,
  ['yParity', 'r', 's'] as const);

// prettier-ignore
const eip1559 = txStruct([
  'chainId', 'nonce', 'maxPriorityFeePerGas', 'maxFeePerGas', 'gasLimit', 'to', 'value', 'data', 'accessList'] as const,
  ['yParity', 'r', 's'] as const);
// prettier-ignore
const eip4844 = txStruct([
  'chainId', 'nonce', 'maxPriorityFeePerGas', 'maxFeePerGas', 'gasLimit', 'to', 'value', 'data', 'accessList',
  'maxFeePerBlobGas', 'blobVersionedHashes'] as const,
  ['yParity', 'r', 's'] as const);

export const TxVersions = {
  legacy, // 0x00 (kinda)
  eip2930, // 0x01
  eip1559, // 0x02
  eip4844, // 0x03
};

export const RawTx = P.apply(createTxMap(TxVersions), {
  // NOTE: we apply checksum to addresses here, since chainId is not available inside coders
  // By construction 'to' field is decoded before anything about chainId is known
  encode: (data) => {
    data.data.to = addr.addChecksum(data.data.to);
    if (data.type !== 'legacy' && data.data.accessList) {
      for (const item of data.data.accessList) {
        item[0] = addr.addChecksum(item[0]);
      }
    }
    return data;
  },
  // Nothing to check here, is validated in validator
  decode: (data) => data,
});

/**
 * Unchecked TX for debugging. Returns raw Uint8Array-s.
 * Handles versions - plain RLP will crash on it.
 */
export const RlpTx = createTxMap(Object.fromEntries(Object.keys(TxVersions).map((k) => [k, RLP])));

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
  if (typeof val !== 'object' || val == null) throw new Error('object expected');
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
    if (strict) minmax(num, 0n, amounts.maxNonce);
    else minmax(BigInt(num), 0n, BigInt(Number.MAX_SAFE_INTEGER)); // amounts.maxUint64
  },
  maxFeePerGas(num: bigint, { strict }: ValidationOpts) {
    abig(num);
    if (strict) minmax(num, 1n, amounts.maxGasPrice, '>= 1 wei and < 10000 gwei');
    else minmax(num, 0n, amounts.maxUint64);
  },
  maxPriorityFeePerGas(num: bigint, { strict, data }: ValidationOpts) {
    abig(num);
    if (strict) minmax(num, 0n, amounts.maxGasPrice, '>= 1 wei and < 10000 gwei');
    else minmax(num, 0n, amounts.maxUint64, '>= 1 wei and < 10000 gwei');
    if (strict && data && typeof data.maxFeePerGas === 'bigint' && data.maxFeePerGas < num) {
      throw new Error(`cannot be bigger than maxFeePerGas=${data.maxFeePerGas}`);
    }
  },
  gasLimit(num: bigint, { strict }: ValidationOpts) {
    abig(num);
    if (strict) minmax(num, amounts.minGasLimit, amounts.maxGasLimit);
    else minmax(num, 0n, amounts.maxUint64);
  },
  to(address: string) {
    if (!addr.isValid(address)) throw new Error('address checksum does not match');
  },
  value(num: bigint) {
    abig(num);
    minmax(num, 0n, amounts.maxAmount, '>= 0 and < 100M eth');
  },
  data(val: string, { strict }: ValidationOpts) {
    if (typeof val !== 'string') throw new Error('data must be string');
    if (strict) {
      if (val.length > amounts.maxDataSize) throw new Error('data is too big: ' + val.length);
    }
  },
  chainId(num: bigint, { strict, type }: ValidationOpts) {
    // chainId is optional for legacy transactions
    if (type === 'legacy' && num === undefined) return;
    abig(num);
    if (strict) minmax(num, 1n, amounts.maxChainId, '>= 1 and <= 2**32-1');
  },
  accessList(list: [string, string[]][]) {
    // NOTE: we cannot handle this validation in coder, since it requires chainId to calculate correct checksum
    for (const [address, _] of list) {
      if (!addr.isValid(address)) throw new Error('address checksum does not match');
    }
  },
};

// Validation
type ErrObj = { field: string; error: string };
export class AggregatedError extends Error {
  constructor(
    readonly message: string,
    readonly errors: ErrObj[]
  ) {
    super();
  }
}

export function validateFields(
  type: TxType,
  data: Record<string, any>,
  strict = true,
  allowSignatureFields = true
) {
  aobj(data);
  if (!TxVersions.hasOwnProperty(type)) throw new Error(`unknown tx type=${type}`);
  const txType = TxVersions[type];
  const dataFields = new Set(Object.keys(data));
  const dataHas = (field: string) => dataFields.has(field);
  function checkField(field: CoderName) {
    if (!dataHas(field))
      return { field, error: `field "${field}" must be present for tx type=${type}` };
    const val = data[field];
    try {
      if (validators.hasOwnProperty(field)) validators[field](val, { data, strict, type });
      if (field === 'chainId') return; // chainId is validated, but can't be decoded
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
    if (!allowSignatureFields && signatureFields.has(field as any))
      return {
        field,
        error: `field "${field}" is sig-related and must not be user-specified`,
      };
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
  'accessList', 'blobVersionedHashes', 'chainId', 'data', 'type',
  'r', 's', 'yParity', 'v'
] as const;

// TODO: remove any
export function sortRawData(raw: TxCoder<any>): any {
  const sortedRaw: Record<string, any> = {};
  sortedFieldOrder
    .filter((field) => raw.hasOwnProperty(field))
    .forEach((field) => {
      sortedRaw[field] = raw[field];
    });
  return sortedRaw;
}

export function decodeLegacyV(raw: TxCoder<any>) {
  return legacySig.decode(raw).v;
}

// NOTE: for tests only, don't use
export const __tests = { legacySig, TxVersions };
