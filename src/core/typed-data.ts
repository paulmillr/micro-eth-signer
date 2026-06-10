import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { mapComponent, type GetType as AbiGetType } from '../advanced/abi-mapper.ts';
import {
  add0x,
  astring,
  deepFreeze,
  ethHex,
  initSig,
  isObject,
  sign,
  strip0x,
  type TArg,
  type TRet,
  verify,
} from '../utils.ts';
import { addr } from './address.ts';

// EIP-191 signed data (https://eips.ethereum.org/EIPS/eip-191)
export type Hex = string | Uint8Array;
export interface TypedSigner<T> {
  _getHash: (message: TArg<T>) => string;
  sign(message: TArg<T>, privateKey: TArg<Hex>, extraEntropy?: TArg<boolean | Uint8Array>): string;
  recoverPublicKey(signature: string, message: TArg<T>): string;
  verify(signature: string, message: TArg<T>, address: string): boolean;
}
// 0x19 <1 byte version> <version specific data> <data to sign>.
// VERSIONS:
// - 0x19 <0x00> <intended validator address> <data to sign>
// - 0x19 <0x01> domainSeparator hashStruct(message)
// - 0x19 <0x45 (E)> <thereum Signed Message:\n" + len(message)> <data to sign>
function getSigner<T>(
  version: number,
  msgFn: TArg<(message: T) => Uint8Array>
): TRet<TypedSigner<T>> {
  if (version < 0 || version >= 256 || !Number.isSafeInteger(version))
    throw new Error('Wrong version byte');
  //     bytes32 hash = keccak256(abi.encodePacked(
  //       byte(0x19), byte(0), address(this), msg.value, nonce, payload));
  const fn = msgFn as (message: TArg<T>) => Uint8Array;
  const getHash = (message: TArg<T>) =>
    keccak_256(concatBytes(new Uint8Array([0x19, version]), fn(message)));
  // TODO: `v` can contain non-undefined chainId. If it is used, check it with
  // the EIP-712 domain.
  return {
    _getHash: (message: TArg<T>) => ethHex.encode(getHash(message)),
    sign(message: TArg<T>, privateKey: TArg<Hex>, extraEntropy: TArg<boolean | Uint8Array> = true) {
      const hash = getHash(message);
      if (typeof privateKey === 'string') privateKey = ethHex.decode(privateKey);
      const sig = sign(hash, privateKey, extraEntropy);
      const end = sig.recovery === 0 ? '1b' : '1c';
      return add0x(sig.toHex('compact') + end);
    },
    recoverPublicKey(signature: string, message: TArg<T>) {
      astring(signature);
      const hash = getHash(message);
      signature = strip0x(signature);
      if (signature.length !== 65 * 2) throw new Error('invalid signature length');
      const sigh = signature.slice(0, -2);
      const end = signature.slice(-2);
      if (!['1b', '1c'].includes(end)) throw new Error('invalid recovery bit');
      const sig = initSig(hexToBytes(sigh), end === '1b' ? 0 : 1);
      const publicKey = secp256k1.recoverPublicKey(sig.toBytes('recovered'), hash, {
        prehash: false,
      });
      // const pub = sig.recoverPublicKey(hash).toBytes(false);
      if (!verify(sig.toBytes('compact'), hash, publicKey)) throw new Error('invalid signature');
      return addr.fromPublicKey(publicKey);
    },
    verify(signature: string, message: TArg<T>, address: string): boolean {
      const recAddr = this.recoverPublicKey(signature, message);
      const low = recAddr.toLowerCase();
      const upp = recAddr.toUpperCase();
      if (address === low || address === upp) return true; // non-checksummed
      return recAddr === address; // checksummed
    },
  } as TRet<TypedSigner<T>>;
}

// EIP-191/EIP-7749: 0x19 <0x00> <intended validator address> <data to sign>
// export const intendedValidator = getSigner(
//   0x00,
//   ({ message, validator }: { message: Uint8Array; validator: string }) => {
//     const { data } = addr.parse(validator);
//     return concatBytes(hexToBytes(data), message);
//   }
// );

// EIP-191: 0x19 <0x45 (E)> <thereum Signed Message:\n" + len(message)> <data to sign>
export const eip191Signer: TRet<TypedSigner<string | Uint8Array>> = /* @__PURE__ */ deepFreeze(
  /* @__PURE__ */ getSigner(0x45, (msg: TArg<string | Uint8Array>) => {
    if (typeof msg === 'string') msg = utf8ToBytes(msg);
    return concatBytes(utf8ToBytes(`thereum Signed Message:\n${msg.length}`), msg);
  })
);

// eip712 typed signed data on top of signed data (https://eips.ethereum.org/EIPS/eip-712)
// - V1: no domain, {name: string, type: string, value: any}[] - NOT IMPLEMENTED
// - V3: basic (no arrays and recursive stuff)
// - V4: V3 + support of arrays and recursive stuff
// TODO:
// https://eips.ethereum.org/EIPS/eip-4361: Off-chain authentication for Ethereum accounts to establish sessions

// There is two API for different usage-cases:
// - encodeData/signTyped, verifyTyped -> wallet like application, when we sign already constructed stuff ('web3.eth.personal.signTypedData')
// - encoder(type).encodeData/sign/verify -> if we construct data and want re-use types for different requests + type safety for static types.

// TODO: type is ABI type, but restricted
export type EIP712Component = { name: string; type: string };
export type EIP712Types = Record<string, readonly EIP712Component[]>;

// This makes 'bytes' -> Uint8Array, 'uint' -> bigint. However, we support 'string' for them (JSON in wallets),
// but for static types it is actually better to use strict types, since otherwise everything is 'string'. Address is string,
// but sending it in uint field can be mistake. Please open issue if you have use case where this behavior causes problems.
// prettier-ignore
type ProcessType<T extends string, Types extends EIP712Types> =
  T extends `${infer Base}[]${infer Rest}` ? ProcessType<`${Base}${Rest}`, Types>[] : // 'string[]' -> 'string'[]
  T extends `${infer Base}[${number}]${infer Rest}` ? ProcessType<`${Base}${Rest}`, Types>[] : // 'string[3]' -> 'string'[]
  T extends keyof Types ? GetType<Types, T> | undefined : // recursive
  AbiGetType<T>;

export type GetType<Types extends EIP712Types, K extends keyof Types & string> = {
  [C in Types[K][number] as C['name']]: ProcessType<C['type'], Types>;
};
type Key<T extends EIP712Types> = keyof T & string;

const isIdentifier = (s: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);

// TODO: merge with abi somehow?
function parseType(s: string): {
  base: string;
  item: string;
  type: string;
  arrayLen: number | undefined;
  isArray: boolean;
} {
  let m = s.match(/^([^\[\]]+)((?:\[[0-9]*\])*)$/);
  if (!m) throw new Error(`parseType: wrong type: ${s}`);
  const base = m[1];
  const arrays = m[2];
  const lastArray = arrays.match(/\[([0-9]*)\]$/);
  const isArray = lastArray !== null;
  const arrayStr = lastArray ? lastArray[1] : undefined;
  const arrayLen = arrayStr !== undefined && arrayStr !== '' ? Number(arrayStr) : undefined;
  if (
    arrayLen !== undefined &&
    (!Number.isSafeInteger(arrayLen) || arrayLen.toString() !== arrayStr)
  ) {
    throw new Error(`parseType: wrong array length: ${s}`);
  }
  let type = 'struct';
  if (['string', 'bytes'].includes(base)) type = 'dynamic';
  else if (['bool', 'address'].includes(base)) type = 'atomic';
  else if ((m = /^(u?)int([0-9]+)?$/.exec(base))) {
    const bits = m[2] ? +m[2] : 256;
    if (!Number.isSafeInteger(bits) || bits <= 0 || bits % 8 !== 0 || bits > 256)
      throw new Error('parseType: invalid numeric type');
    type = 'atomic';
  } else if ((m = /^bytes([0-9]{1,2})$/.exec(base))) {
    const bytes = +m[1];
    if (!bytes || bytes > 32) throw new Error(`parseType: wrong bytes<N=${bytes}> type`);
    type = 'atomic';
  } else if (!isIdentifier(base)) throw new Error(`parseType: wrong type: ${s}`);
  const item = lastArray ? s.slice(0, -lastArray[0].length) : s;
  return { base, item, type, arrayLen, isArray };
}

// traverse dependency graph, find all transitive dependencies. Also, basic sanity check
function getDependencies(types: EIP712Types): Record<string, Set<string>> {
  if (typeof types !== 'object' || types === null) throw new Error('wrong types object');
  // Collect non-basic dependencies & sanity
  const res: Record<string, Set<string>> = {};
  for (const [name, fields] of Object.entries(types)) {
    // EIP-712 struct names must be valid identifiers; otherwise malformed
    // tokens like `bytes32]` become observable custom types.
    if (!isIdentifier(name)) throw new Error(`getDependencies: wrong struct type name=${name}`);
    const cur: Set<string> = new Set(); // type may appear multiple times in struct
    for (const { type } of fields) {
      const p = parseType(type);
      if (p.type !== 'struct') continue; // skip basic fields
      if (p.base === name) continue; // self reference
      if (!types[p.base]) throw new Error(`getDependencies: wrong struct type name=${type}`);
      cur.add(p.base);
    }
    res[name] = cur;
  }
  // This should be more efficient with toposort + cycle detection, but I've already spent too much time here
  // and for most cases there won't be a lot of types here anyway.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, curDeps] of Object.entries(res)) {
      // Map here, because curDeps will change
      const trDeps = Array.from(curDeps).map((i) => res[i]);
      for (const d of trDeps) {
        for (const td of d) {
          if (td === name || curDeps.has(td)) continue;
          curDeps.add(td);
          changed = true;
        }
      }
    }
  }
  return res;
}

function getTypes(types: EIP712Types) {
  const deps = getDependencies(types);
  const names: Record<string, string> = {};
  // Build names
  for (const type in types)
    names[type] = `${type}(${types[type].map(({ name, type }) => `${type} ${name}`).join(',')})`;
  const fullNames: Record<string, string> = {};
  for (const [name, curDeps] of Object.entries(deps)) {
    const n = [name].concat(Array.from(curDeps).sort());
    fullNames[name] = n.map((i) => names[i]).join('');
  }
  const hashes = Object.fromEntries(
    Object.entries(fullNames).map(([k, v]) => [k, keccak_256(utf8ToBytes(v))])
  );
  // fields
  const fields: Record<string, Set<string>> = {};
  for (const type in types) {
    const res: Set<string> = new Set();
    for (const { name } of types[type]) {
      if (res.has(name)) throw new Error(`field ${name} included multiple times in type ${type}`);
      res.add(name);
    }
    fields[type] = res;
  }
  return { names, fullNames, hashes, fields };
}

// This re-uses domain per multiple requests, which is based on assumption that domain is static for different requests with
// different types. Please raise issue if you have different use case.
export function encoder<T extends EIP712Types>(types: T, domain: TArg<GetType<T, 'EIP712Domain'>>) {
  if (!isObject(domain)) throw Error(`wrong domain=${domain}`);
  if (!isObject(types)) throw Error(`wrong types=${types}`);
  const info = getTypes(types);
  const encodeField = (type: string, data: any, withHash = true): TRet<Uint8Array> => {
    const p = parseType(type);
    if (p.isArray) {
      if (!Array.isArray(data)) throw new Error(`expected array, got: ${data}`);
      if (p.arrayLen !== undefined && data.length !== p.arrayLen)
        throw new Error(`wrong array length: expected ${p.arrayLen}, got ${data}`);
      return keccak_256(concatBytes(...data.map((i) => encodeField(p.item, i))));
    }
    if (p.type === 'struct') {
      const def = types[type];
      if (!def) throw new Error(`wrong type: ${type}`);
      const fieldNames = info.fields[type];
      if (!isObject(data)) throw new Error(`encoding non-object as custom type ${type}`);
      for (const k in data)
        if (!fieldNames.has(k)) throw new Error(`unexpected field ${k} in ${type}`);
      // TODO: use correct concatBytes (need to export from P?). This will easily crash with stackoverflow if too much fields.
      const fields = [];
      for (const { name, type } of def) {
        // This is not mentioned in spec, but used in eth-sig-util
        // Since there is no 'optional' fields inside eip712, it makes impossible to encode circular structure without arrays,
        // but seems like other project use this.
        // NOTE: this is V4 only stuff. If you need V3 behavior, please open issue.
        if (types[type] && data[name] === undefined) {
          fields.push(new Uint8Array(32));
          continue;
        }
        fields.push(encodeField(type, data[name]));
      }
      const res = concatBytes(info.hashes[p.base], ...fields);
      return (withHash ? keccak_256(res) : res) as TRet<Uint8Array>;
    }
    if (type === 'string' || type === 'bytes') {
      if (type === 'bytes' && typeof data === 'string') data = ethHex.decode(data);
      return keccak_256(typeof data === 'string' ? utf8ToBytes(data) : data) as TRet<Uint8Array>; // hashed as is!
    }
    // Type conversion is neccessary here, because we can get data from JSON (no Uint8Arrays/bigints).
    if (type.startsWith('bytes') && typeof data === 'string') data = ethHex.decode(data);
    if ((type.startsWith('int') || type.startsWith('uint')) && typeof data === 'string')
      data = BigInt(data);
    return mapComponent({ type }).encode(data) as TRet<Uint8Array>;
  };
  const encodeData = <K extends Key<T>>(type: K, data: TArg<GetType<T, K>>) => {
    astring(type);
    if (!types[type]) throw new Error(`Unknown type: ${type}`);
    if (!isObject(data)) throw new Error('wrong data object');
    return encodeField(type, data, false);
  };
  const structHash = (type: Key<T>, data: any) => keccak_256(encodeData(type, data) as Uint8Array);
  const domainHash = structHash('EIP712Domain', domain);
  // NOTE: we cannot use Msg here, since its already parametrized and everything will break.
  const signer = getSigner(0x01, (msg: { primaryType: string; message: any }) => {
    if (typeof msg.primaryType !== 'string') throw Error(`wrong primaryType=${msg.primaryType}`);
    if (!isObject(msg.message)) throw Error(`wrong message=${msg.message}`);
    if (msg.primaryType === 'EIP712Domain') return domainHash;
    return concatBytes(domainHash, structHash(msg.primaryType, msg.message));
  });
  return {
    encodeData: <K extends Key<T>>(type: K, message: TArg<GetType<T, K>>): string =>
      ethHex.encode(encodeData(type, message)),
    structHash: <K extends Key<T>>(type: K, message: TArg<GetType<T, K>>): string =>
      ethHex.encode(structHash(type, message)),
    // Signer
    _getHash: <K extends Key<T>>(primaryType: K, message: TArg<GetType<T, K>>): string =>
      signer._getHash({ primaryType, message }),
    sign: <K extends Key<T>>(
      primaryType: K,
      message: TArg<GetType<T, K>>,
      privateKey: TArg<Hex>,
      extraEntropy?: TArg<boolean | Uint8Array>
    ): string => signer.sign({ primaryType, message }, privateKey, extraEntropy),
    verify: <K extends Key<T>>(
      primaryType: K,
      signature: string,
      message: TArg<GetType<T, K>>,
      address: string
    ): boolean => signer.verify(signature, { primaryType, message }, address),
    recoverPublicKey: <K extends Key<T>>(
      primaryType: K,
      signature: string,
      message: TArg<GetType<T, K>>
    ): string => signer.recoverPublicKey(signature, { primaryType, message }),
  };
}

export const EIP712Domain = [
  { name: 'name', type: 'string' }, // the user readable name of signing domain, i.e. the name of the DApp or the protocol.
  { name: 'version', type: 'string' }, // the current major version of the signing domain. Signatures from different versions are not compatible.
  { name: 'chainId', type: 'uint256' }, // the EIP-155 chain id. The user-agent should refuse signing if it does not match the currently active chain.
  { name: 'verifyingContract', type: 'address' }, // the address of the contract that will verify the signature. The user-agent may do contract specific phishing prevention.
  { name: 'salt', type: 'bytes32' }, // an disambiguating salt for the protocol. This can be used as a domain separator of last resort.
] as const;
export type DomainParams = typeof EIP712Domain;

const domainTypes = { EIP712Domain: EIP712Domain as DomainParams };
export type EIP712Domain = Partial<GetType<typeof domainTypes, 'EIP712Domain'>>;

// Filter unused domain fields from type
export function getDomainType(domain: TArg<EIP712Domain>) {
  // EIP-712 domain fields are explicit; inherited props must not affect the type hash.
  return EIP712Domain.filter(
    ({ name }) => Object.hasOwn(domain, name) && domain[name] !== undefined
  );
}
// Additional API without type safety for wallet-like applications
export type TypedData<T extends EIP712Types, K extends Key<T>> = {
  types: T;
  primaryType: K;
  domain: GetType<T, 'EIP712Domain'>;
  message: GetType<T, K>;
};

const getTypedTypes = <T extends EIP712Types, K extends Key<T>>(typed: TArg<TypedData<T, K>>) => ({
  // EIP-712 JSON-RPC payloads may include `types.EIP712Domain`; keep it authoritative
  // and use the derived domain type only as a fallback when the payload omits it.
  EIP712Domain: getDomainType(typed.domain as any),
  ...typed.types,
});

function validateTyped<T extends EIP712Types, K extends Key<T>>(t: TArg<TypedData<T, K>>) {
  if (!isObject(t)) throw new TypeError('"typed" expected object, got type=' + typeof t);
  if (!isObject(t.message)) throw new Error('wrong message');
  if (!isObject(t.domain)) throw new Error('wrong domain');
  if (!isObject(t.types)) throw new Error('wrong types');
  // getTypedTypes normalizes with object spread, so inherited type entries would be dropped later.
  if (typeof t.primaryType !== 'string' || !Object.hasOwn(t.types, t.primaryType))
    throw new Error('wrong primaryType');
}

export function encodeData<T extends EIP712Types, K extends Key<T>>(
  typed: TArg<TypedData<T, K>>
): string {
  validateTyped(typed);
  return encoder(getTypedTypes(typed) as T, typed.domain).encodeData(
    typed.primaryType as K,
    typed.message
  );
}

export function sigHash<T extends EIP712Types, K extends Key<T>>(
  typed: TArg<TypedData<T, K>>
): string {
  validateTyped(typed);
  return encoder(getTypedTypes(typed) as T, typed.domain)._getHash(
    typed.primaryType as K,
    typed.message
  );
}

export function signTyped<T extends EIP712Types, K extends Key<T>>(
  typed: TArg<TypedData<T, K>>,
  privateKey: TArg<Hex>,
  extraEntropy?: TArg<boolean | Uint8Array>
): string {
  validateTyped(typed);
  return encoder(getTypedTypes(typed) as T, typed.domain).sign(
    typed.primaryType as K,
    typed.message,
    privateKey,
    extraEntropy
  );
}

export function verifyTyped<T extends EIP712Types, K extends Key<T>>(
  signature: string,
  typed: TArg<TypedData<T, K>>,
  address: string
): boolean {
  validateTyped(typed);
  return encoder(getTypedTypes(typed) as T, typed.domain).verify(
    typed.primaryType as K,
    signature,
    typed.message,
    address
  );
}

export function recoverPublicKeyTyped<T extends EIP712Types, K extends Key<T>>(
  signature: string,
  typed: TArg<TypedData<T, K>>
): string {
  validateTyped(typed);
  return encoder(getTypedTypes(typed) as T, typed.domain).recoverPublicKey(
    typed.primaryType as K,
    signature,
    typed.message
  );
}

// Internal methods for test purposes only
export const _TEST: any = /* @__PURE__ */ { parseType, getDependencies, getTypes, encoder };
