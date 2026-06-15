import { bytesToNumberBE, equalBytes, numberToBytesBE } from '@noble/curves/utils.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { addr } from '../core/address.ts';
import {
  encodeType,
  encoder as typedEncoder,
  type EIP712Domain as EIP712DomainType,
  getDomainType,
  type EIP712Types,
  type TypedData,
} from '../core/typed-data.ts';
import {
  add0x,
  cloneDeep,
  createDecimal,
  deepFreeze,
  ethHex,
  isBytes,
  isObject,
  omit,
  weieth,
  type TArg,
  type TRet,
} from '../utils.ts';
import type { ContractInfo, FnArg } from './abi-decoder.ts';
import { ARRAY_RE, mapArgs, mapComponent, type Component } from './abi-mapper.ts';

type Any = Record<string, any>;
/** ERC-7730 descriptor JSON. Loose: descriptors are schema-driven and wider than local typing. */
export type ClearSigDef = Record<string, any>;
/** Descriptor input accepted by the ABI facade before repository indexing. */
export type ClearSigSource = Record<string, ClearSigDef> | ClearSigDef | ClearSigDef[];
/** Token metadata used to bind generic ERC descriptors and format token values. */
export type ClearSigToken = Omit<Partial<ContractInfo>, 'abi'> & {
  /** ABI family tag used to choose reusable ERC descriptors. */
  abi?: 'ERC20' | 'ERC721' | 'ERC1155' | string;
  /** Alternate ticker key used by ERC-7730 registry metadata. */
  ticker?: string;
  /** Token contract address when metadata is not keyed by address already. */
  address?: string;
  /** Alternate contract-address key accepted by external metadata maps. */
  contract?: string;
  /** EIP-155 chain id for descriptor deployment binding. */
  chainId?: number | bigint | string;
  /** Metadata source label for wallet trust policy. */
  source?: string;
  /** Whether the caller considers the metadata verified. */
  verified?: boolean;
};
/** Token map accepted by `repository`; binds offline metadata without render-time callbacks. */
export type ClearSigTokens = Record<string, ClearSigToken>;
type Named = { name?: string; source?: string; types?: string[]; verified?: boolean };
/** Trusted display name returned by wallet metadata callbacks. */
type ClearSigName = string | (Named & { name: string });
/** NFT display metadata returned by wallet metadata callbacks. */
type ClearSigNft = string | (Named & { tokenName?: string; collectionName?: string });
/** Chain metadata used by chainId and native-amount formatters. */
type ClearSigChain = {
  /** Human-readable EIP-155 chain name. */
  name?: string;
  /** Native asset ticker for amount formatting. */
  ticker?: string;
};
type Deployment = { address: string; chainId: bigint };
/** Transaction/container context visible to ERC-7730 `@` paths. */
export type Ctx = {
  to?: string;
  from?: string;
  data?: Uint8Array;
  value?: bigint;
  chainId?: bigint;
};
/** EIP-712 clear-signing input: the same typed-data object passed to signTyped. */
export type ClearSigTypedInput = TArg<TypedData<EIP712Types, string>>;
/** Formatted field emitted for UI rows and structured intent spans. */
export type ClearSigField = {
  /** Wallet-ready formatted display value. */
  value: string;
  /** ERC-7730 field format that produced `value`. */
  format: string;
  /** Decoded value before formatter conversion. */
  rawValue: unknown;
};
/**
 * Result shape: intent plus label-keyed fields, with interpolation only when
 * the descriptor defines it.
 */
export type ClearSigResult = {
  /** Base ERC-7730 intent. */
  intent: string;
  /** Processed interpolatedIntent, falling back to intent on interpolation failure. */
  interpolatedIntent?: string;
  /** Interpolated text split into literal strings and formatted field objects. */
  structuredIntent?: (string | ClearSigField)[];
  /** Label-keyed formatted fields for custom wallet layouts. */
  fields: Record<string, ClearSigField>;
};
/** Renderer entry selected by ABI/EIP-712 matching code outside this module. */
export type ClearSigRepositoryEntry = ((
  input: Ctx | ClearSigTypedInput,
  opt?: ClearSigOpt
) => Promise<ClearSigResult>) & {
  /** Parsed ABI function used by Decoder.addClearSig() for selector hashing. */
  fn?: FnArg;
  /** Internal descriptor id for duplicate-selector validation in Decoder. */
  source?: number;
};
/** Frozen clear-signing repository index built from descriptor files. */
export type ClearSigRepository = {
  /** Calldata entries keyed by chain id and contract address; Decoder owns selector hashing. */
  contracts: Record<string, Record<string, ClearSigRepositoryEntry[]>>;
  /**
   * Deployment-less calldata entries.
   * Callers may bind these to one concrete target out-of-band.
   */
  generic: ClearSigRepositoryEntry[];
  /** EIP-712 entries keyed by chain id, verifying contract, and type hash. */
  eip712: Record<string, Record<string, Record<string, ClearSigRepositoryEntry>>>;
  /** Factory-backed calldata entries that Decoder.resolve can bind to exact contracts. */
  factories: ClearSigFactoryEntry[];
};
/**
 * Internal decoder bridge for factory descriptors.
 * ERC-7730 factory context needs caller proof before an exact contract binding exists.
 */
export type ClearSigFactoryEntry = {
  factory: Any;
  deployments: Deployment[];
  deployEvent?: string;
  entries: ClearSigRepositoryEntry[];
};
// Resolver requests carry signing context plus the selected descriptor/field.
type Req = { descriptor?: Any; field?: Any; context: Ctx };
type Sources = { sources?: string[]; types?: string[] };
type Factory = { factory: Any; deployments: Deployment[]; deployEvent?: string };
type Resolve<R, T> = (req: Req & { chainId?: bigint } & R) => Promise<T | undefined>;
/**
 * ERC-7730 render options. All callbacks are optional and promise-based; rendering
 * itself never performs network IO, so an airgapped signer works with bundled data.
 */
export type ClearSigOpt = {
  /** Descriptor source for low-level renderers; ABI facade defaults this to the bundled repo. */
  clearSig?: ClearSigSource;
  /** Resolves ERC-20 metadata for tokenAmount and tokenTicker. */
  resolveToken?: Resolve<{ address: string }, ClearSigToken>;
  /** Resolves trusted address names, respecting descriptor sources and types. */
  resolveAddress?: Resolve<{ address: string } & Sources, ClearSigName>;
  /** Resolves NFT collection or token names for nftName fields. */
  resolveNft?: Resolve<{ collection: string; tokenId: bigint }, ClearSigNft>;
  /**
   * Resolves EIP-155 chain names and native asset tickers.
   * @param req - Chain metadata request.
   * @returns Chain metadata, or undefined to use the offline fallback.
   */
  resolveChain?: (req: { chainId: bigint }) => Promise<ClearSigChain | undefined>;
  /** Converts a block height into a Unix timestamp in seconds. */
  resolveBlock?: Resolve<{ block: bigint }, number>;
  /** Resolves ERC-7930 interoperable-address bytes to a trusted display name. */
  resolveInteroperableAddress?: Resolve<{ value: Uint8Array } & Sources, ClearSigName>;
  /** Supplies descriptors for embedded calldata when the current repository misses. */
  resolveCalldata?: Resolve<
    { to: string; data: Uint8Array; selector: string; value?: bigint; from?: string },
    Any | Any[]
  >;
  /** Proves which factory candidate deployed the current target contract. */
  resolveFactory?: Resolve<{ address: string; factories: Factory[] }, number | number[]>;
  /** Decrypts encrypted field values such as fhevm; undefined keeps descriptor fallback. */
  decrypt?: Resolve<{ scheme?: string; encryption: Any; value: unknown }, unknown>;
  /** Allows descriptor/test-specific calldata with non-ABI trailing bytes. */
  allowUnreadBytes?: boolean;
};
// Repository/decoder paths pass token metadata and nested calldata rendering
// through private plumbing so selector matching stays in the ABI decoder.
type RunOpt = ClearSigOpt & {
  contracts?: Record<string, ClearSigToken>;
  renderCalldata?: (
    desc: Any | Any[] | Record<string, ClearSigDef>,
    input: Ctx,
    opt: RunOpt
  ) => Promise<ClearSigResult | undefined>;
};
type Match = { desc: Any; fmt: Any; data: Any; ctx: Ctx };
// Interpolation needs path/visibility metadata that public fields intentionally omit;
// `pub` is the shared public field object, emitted into results without copying.
// prettier-ignore
type RenderField = {
  pub: ClearSigField; label: string; path?: string; separator?: string; interpolate?: true;
};
// Carries the current array item index through path evaluation: ERC-7730 correlated
// `.[]` params reuse the same item index while a wildcard field renders item N.
const PATH_INDEX = Symbol('clearSig.pathIndex');
type PathRoot = { '#': unknown; '@': Ctx; $: Any; [PATH_INDEX]?: number };
type ParsedFn = FnArg & { type: 'function'; name: string; inputs: Component<string>[] };
// Stores the parsed ABI function on decoded calldata: scalar slices such as
// `uint256.[-20:]` are underdefined by ERC-7730 and need the ABI type to rebuild bytes.
const ABI_FN = Symbol('clearSig.abiFn');
// Offline fallback for native amount/chainId display; callers extend via resolveChain.
const CHAINS: Record<number, { name: string; ticker: string }> = {
  1: { name: 'Ethereum Mainnet', ticker: 'ETH' },
  137: { name: 'Polygon', ticker: 'POL' },
  43114: { name: 'Avalanche C-Chain', ticker: 'AVAX' },
};
const _0n = /* @__PURE__ */ BigInt(0);
const _1n = /* @__PURE__ */ BigInt(1);
/**
 * Largest accepted chain id.
 * ERC-7730 descriptor chain ids are JSON numbers; runtime bigint ids stay in
 * that safe integer range so number-keyed repository and metadata lookups agree.
 */
const MAX_CHAIN = /* @__PURE__ */ BigInt(Number.MAX_SAFE_INTEGER);
type TupleArg = Component<string> & { components: Component<string>[] };
// Private nested rendering/tests may use inline descriptors, but Decoder.addClearSig()
// indexes descriptor files. Keep that shape conversion here so abi.ts does not
// need to know how to recognize ERC-7730 descriptor objects.
export const _source = (
  src: TArg<ClearSigSource | undefined>
): { files?: Record<string, ClearSigDef>; inline: boolean } => {
  if (!src) return { inline: false };
  if (Array.isArray(src))
    return {
      files: Object.fromEntries(src.map((desc, i) => [`inline/${i}.json`, desc])),
      inline: true,
    };
  if (
    isObject(src) &&
    ['$schema', 'context', 'display', 'includes', 'metadata'].some((k) => Object.hasOwn(src, k))
  )
    return { files: { 'inline.json': src as ClearSigDef }, inline: true };
  return { files: src as Record<string, ClearSigDef>, inline: false };
};
// ERC-7730 calldata format keys are human-readable ABI signatures; this parser
// accepts the subset present in descriptors, not full Solidity grammar.
const NAME = '[A-Za-z_$][A-Za-z0-9_$]*';
const ARG = new RegExp(`^(${NAME}(?:\\[[0-9]*\\])*)\\s*(${NAME})?$`);
const SUFFIX = new RegExp(`^((?:\\[[0-9]*\\])*)\\s*(${NAME})?$`);
// ERC-7730 EIP-712 format keys are encodeType(primaryType) strings; wallets MUST
// compare their keccak type hash, so the repository indexes by that hash.
const eip712Key = (key: string) => ethHex.encode(keccak_256(utf8ToBytes(key)));
// ERC-7730 EIP-712 format keys are encodeType strings. Use the signer helper
// for canonical messages; fallback is intentionally looser because registry
// vectors include non-standard identifiers that only need descriptor matching.
const typedKey = (typed: TArg<TypedData<EIP712Types, string>>) => {
  try {
    return encodeType(typed.types, typed.primaryType);
  } catch {}
  const types = typed.types as Any;
  const seen = new Set<string>();
  const one = (name: string) =>
    `${name}(${(types[name] || []).map((i: Any) => `${i.type} ${i.name}`).join(',')})`;
  const deps = (name: string) => {
    for (const field of types[name] || []) {
      const dep = field.type.replace(/\[[0-9]*\]$/g, '');
      // encodeType never lists the primary type among its sorted deps, even when a
      // nested type references it back; non-primary self-references are already in
      // `seen` because types are added before recursing.
      if (!types[dep] || dep === typed.primaryType || seen.has(dep)) continue;
      seen.add(dep);
      deps(dep);
    }
  };
  deps(typed.primaryType);
  return one(typed.primaryType) + [...seen].sort().map(one).join('');
};
const matchParen = (s: string, open: number): number => {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && !--depth) return i;
  }
  throw new Error(`clearSig: unclosed function signature in ${s}`);
};
// Splits 'a,(b,c) d,e' on top-level commas only.
const splitArgs = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && !depth) {
      out.push(s.slice(last, i));
      last = i + 1;
    }
  }
  out.push(s.slice(last));
  return out.map((i) => i.trim()).filter((i) => i);
};
const parseArg = (part: string): Component<string> => {
  if (part[0] === '(') {
    const close = matchParen(part, 0);
    const m = SUFFIX.exec(part.slice(close + 1));
    if (!m) throw new Error(`clearSig: expected ABI argument, got ${part}`);
    return {
      type: `tuple${m[1]}`,
      ...(m[2] ? { name: m[2] } : {}),
      components: splitArgs(part.slice(1, close)).map(parseArg),
    } as TupleArg;
  }
  const arg = ARG.exec(part);
  if (!arg) throw new Error(`clearSig: expected ABI argument, got ${part}`);
  let type = arg[1];
  // Live registry files contain Solidity syntax deviations; selectors still need canonical types.
  if (type === 'uint') type = 'uint256';
  else if (type === 'int') type = 'int256';
  return arg[2] ? { type, name: arg[2] } : { type };
};
// JSON descriptors freely use one-or-many values (includes, addresses, indexes).
const arr = <T>(v: T | T[] | undefined): T[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const formats = (desc: Any): Any => {
  const fmts = desc.display && desc.display.formats;
  if (!fmts || typeof fmts !== 'object') throw new Error('clearSig: missing display.formats');
  return fmts;
};
// Merges descriptor includes depth-first; `str` resolves string includes, which only
// descriptor-file maps support (direct inline descriptors must already be resolved).
const resolveIncludes = (desc: Any, str: (inc: string) => Any): Any => {
  let out: Any = {};
  const overlays = [
    ...arr(desc.includes).map((inc) =>
      typeof inc === 'string' ? str(inc) : resolveIncludes(inc, str)
    ),
    omit(desc, 'includes'),
  ];
  for (const over of overlays) {
    const bd = out.display || {};
    const od = over.display || {};
    const fmts = { ...(bd.formats || {}) };
    for (const key of Object.keys(od.formats || {})) {
      const fmt = od.formats[key];
      if (!fmts[key]) {
        fmts[key] = fmt;
        continue;
      }
      // ERC-7730 "Includes": merge fields sharing a path and append new paths, with the
      // including file overriding formatter params. Pathless value fields are our literal
      // descriptor extension, so they merge by value instead of display label.
      const fields: Any[] = (fmts[key].fields || []).slice();
      for (const field of fmt.fields || []) {
        const idx = fields.findIndex(
          (i) =>
            (Object.hasOwn(field, 'path') && Object.hasOwn(i, 'path') && i.path === field.path) ||
            (Object.hasOwn(field, 'value') && Object.hasOwn(i, 'value') && i.value === field.value)
        );
        if (idx >= 0)
          fields[idx] = {
            ...fields[idx],
            ...field,
            params: { ...(fields[idx].params || {}), ...(field.params || {}) },
          };
        else fields.push(field);
      }
      fmts[key] = { ...fmts[key], ...fmt, fields };
    }
    out = {
      ...out,
      ...over,
      context: { ...(out.context || {}), ...(over.context || {}) },
      metadata: { ...(out.metadata || {}), ...(over.metadata || {}) },
      display: {
        ...bd,
        ...od,
        definitions: { ...(bd.definitions || {}), ...(od.definitions || {}) },
        formats: fmts,
      },
    };
  }
  return out;
};
// Raw-value conversion policy lives in this one table: formatters and path slicing
// share integer/bytes/address casts instead of scattered single-purpose helpers.
const cast = {
  // Deterministic fallback display for unsupported/opaque values.
  raw(v: unknown): string {
    if (typeof v === 'bigint' || typeof v === 'number' || typeof v === 'boolean') return `${v}`;
    if (typeof v === 'string') return v;
    if (isBytes(v)) return ethHex.encode(v);
    if (Array.isArray(v)) return v.map((i) => cast.raw(i)).join(', ');
    if (isObject(v))
      return JSON.stringify(v, (_, val) => (typeof val === 'bigint' ? val.toString() : val));
    return `${v}`;
  },
  // ERC-7730 integer values include uint256-sized amounts and EIP-155 chain ids,
  // so normalized integer data stays bigint until an API explicitly needs text.
  integer(v: unknown): bigint {
    if (typeof v === 'number' && !Number.isSafeInteger(v))
      throw new Error(`clearSig: expected safe integer, got ${v}`);
    if (typeof v === 'bigint' || typeof v === 'number' || typeof v === 'string') return BigInt(v);
    if (isBytes(v)) return bytesToNumberBE(v);
    throw new Error(`clearSig: expected integer, got ${cast.raw(v)}`);
  },
  chain(v: unknown): bigint {
    const id = cast.integer(v);
    if (id < _0n || id > MAX_CHAIN)
      throw new Error(`clearSig: expected safe integer chainId, got ${cast.raw(v)}`);
    return id;
  },
  address(v: unknown): string {
    if (typeof v === 'string') {
      // Generic ERC descriptor metadata uses "0x0" as an unresolved token placeholder.
      if (v === '0x0') return v;
      return add0x(addr.parse(v).data);
    }
    if (isBytes(v) && v.length === 20) return ethHex.encode(v);
    throw new Error(`clearSig: expected address, got ${cast.raw(v)}`);
  },
  // ERC-7730 does not define scalar slice byte semantics; with an ABI component,
  // decoded scalars become their canonical ABI bytes (declared-width integers, etc).
  bytes(v: unknown, c?: Component<string>): TRet<Uint8Array> {
    if (c && /^u?int[0-9]*$/.test(c.type))
      return mapComponent(c).encode(v as never) as TRet<Uint8Array>;
    if (c && c.type === 'bool') {
      if (typeof v !== 'boolean') throw new Error(`clearSig: expected bool, got ${cast.raw(v)}`);
      return new Uint8Array([v ? 1 : 0]) as TRet<Uint8Array>;
    }
    let b: Uint8Array | undefined;
    if (c && c.type === 'address') b = ethHex.decode(cast.address(v));
    else if (isBytes(v)) b = v;
    else if (typeof v === 'string' && /^0x[0-9a-fA-F]*$/.test(v)) b = ethHex.decode(v);
    if (!b) throw new Error(`clearSig: expected bytes, got ${cast.raw(v)}`);
    // bytesN keeps its actual payload but validates length through the ABI coder.
    if (c && /^bytes[0-9]{1,2}$/.test(c.type)) mapComponent(c).encode(b as never);
    return b as TRet<Uint8Array>;
  },
};
/**
 * Internal chain-id normalizer shared with the decoder clearSig bridge.
 * ERC-7730 descriptor deployments are JSON-safe numbers; runtime values are
 * bigint, but clearSig indexing still rejects values outside that descriptor range.
 */
export const _chain = (v: unknown = _1n): bigint => cast.chain(v);
// ERC-7730 EIP-712 render context is the typed-data domain, not the message:
// `verifyingContract` is the signing target and `chainId` stays optional for no-match checks.
const typedCtx = (domain: Any): TRet<Ctx> =>
  ({
    to: domain.verifyingContract,
    chainId: domain.chainId === undefined ? undefined : cast.chain(domain.chainId),
  }) as TRet<Ctx>;
const deployments = (context: Any): Any[] => [
  ...((context.contract && context.contract.deployments) || []),
  ...((context.eip712 && context.eip712.deployments) || []),
];
const tokenMeta = (token: Any): TRet<ClearSigToken> =>
  ({
    name: token.name,
    symbol: token.ticker || token.symbol,
    decimals: token.decimals,
  }) as TRet<ClearSigToken>;
// Compiled path evaluator plus the metadata renderers need: shown path, rootedness,
// multi-value, and interpolation aliases for registry `[]` path forms.
type PathEval = ((root: TArg<PathRoot>) => unknown) & {
  path: string;
  root: boolean;
  many: boolean;
};
// prettier-ignore
type Tok =
  | { t: 'root'; root: '#' | '@' | '$' }
  | { t: 'name'; name: string }
  | { t: 'idx'; n: number }
  | { t: 'all' }
  | { t: 'slice'; a?: number; b?: number };
type PathRun = {
  root: TArg<PathRoot>;
  obj: unknown;
  idx: number;
  toks: Tok[];
  abi?: ParsedFn;
};
// ERC-7730 JSONPath-subset evaluator. All descriptor path behavior lives here so
// renderers never parse path strings; RFC 9535 deviations are commented inline.
// Recursive calls pass `PathRun` so path evaluation stays in this function instead
// of drifting into separate ad-hoc walkers.
type JsonPath = {
  (path: string, base?: string): TRet<PathEval>;
  (path: string, base: string, run: TArg<PathRun>): unknown;
};
const jsonPath = ((path: string, base = '', run?: TArg<PathRun>): unknown => {
  if (run) {
    const r = run as PathRun;
    if (r.idx >= r.toks.length) return r.obj;
    const tok = r.toks[r.idx];
    const spread = (items: unknown[]) => {
      const flat = r.toks.some((t, i) => i > r.idx && (t.t === 'all' || t.t === 'slice'));
      const out: unknown[] = [];
      for (const item of items) {
        const v = jsonPath(path, base, { ...r, obj: item, idx: r.idx + 1 });
        if (flat && Array.isArray(v)) out.push(...v);
        else out.push(v);
      }
      return out;
    };
    if (tok.t === 'root')
      return jsonPath(path, base, { ...r, obj: r.root[tok.root], idx: r.idx + 1 });
    if (tok.t === 'name') {
      // ERC-7730 contract examples interpolate `recipients.length`; RFC JSONPath
      // has no length selector, so keep this as an ERC-only compatibility path.
      if (tok.name === 'length') {
        if (Array.isArray(r.obj) || isBytes(r.obj) || typeof r.obj === 'string')
          return jsonPath(path, base, { ...r, obj: r.obj.length, idx: r.idx + 1 });
        throw new Error('clearSig: expected sized value for length path');
      }
      if (!r.obj || typeof r.obj !== 'object' || !Object.hasOwn(r.obj, tok.name))
        throw new Error(`clearSig: missing path part=${tok.name}`);
      return jsonPath(path, base, {
        ...r,
        obj: (r.obj as Any)[tok.name],
        idx: r.idx + 1,
      });
    }
    if (tok.t === 'idx' || tok.t === 'all') {
      if (!Array.isArray(r.obj))
        throw new Error(`clearSig: expected array for ${tok.t === 'all' ? '[]' : 'index'} path`);
      // ERC-7730 formatter params commonly repeat a sibling `.[]` path while a
      // parent wildcard field renders item N; consume that current item index here.
      const at = tok.t === 'idx' ? (tok.n < 0 ? r.obj.length + tok.n : tok.n) : r.root[PATH_INDEX];
      if (at !== undefined) {
        if (at < 0 || at >= r.obj.length)
          throw new Error(`clearSig: path index ${tok.t === 'idx' ? tok.n : at} out of range`);
        return jsonPath(path, base, { ...r, obj: r.obj[at], idx: r.idx + 1 });
      }
      return spread(r.obj);
    }
    // Slice. Primitive scalar slices use the ABI function attached after calldata
    // decode; see cast.bytes for why this is compatibility, not fully specified ERC-7730.
    let comp: Component<string> | undefined;
    if (r.abi)
      for (let i = 0; i < r.idx; i++) {
        const t = r.toks[i];
        if (t.t === 'root') {
          if (t.root !== '#') {
            comp = undefined;
            break;
          }
          comp = undefined;
        } else if (t.t === 'name') {
          const list = !comp
            ? r.abi.inputs
            : comp.type === 'tuple'
              ? (comp as TupleArg).components
              : undefined;
          comp = list && list.find((j) => j.name === t.name);
          if (!comp) break;
        } else {
          // all/idx/slice selectors strip one array dimension; selectors on scalars
          // mid-path have no ABI meaning.
          const array = comp && ARRAY_RE.exec(comp.type);
          if (!array) {
            comp = undefined;
            break;
          }
          comp = { ...comp, type: array[1] };
        }
      }
    const src =
      Array.isArray(r.obj) || typeof r.obj === 'string' || isBytes(r.obj)
        ? r.obj
        : cast.bytes(r.obj, comp);
    // RFC 9535 (referenced by ERC-7730 path rules) clamps normalized slice bounds
    // to [0, len]; passing still-negative values to `.slice()` would re-interpret them.
    const len = src.length;
    const lo = tok.a === undefined ? 0 : tok.a < 0 ? len + tok.a : tok.a;
    const hi = tok.b === undefined ? len : tok.b < 0 ? len + tok.b : tok.b;
    const from = Math.min(Math.max(lo, 0), len);
    const to = Math.min(Math.max(hi, 0), len);
    // ERC-7730 explicitly allows slices on arrays and variable-length primitives.
    if (!Array.isArray(src))
      return jsonPath(path, base, { ...r, obj: src.slice(from, to), idx: r.idx + 1 });
    return spread(src.slice(from, to));
  }
  const rooted = path[0] === '#' || path[0] === '@' || path[0] === '$';
  const shown = base && !rooted ? `${base}.${path}` : path;
  const toks: Tok[] = [];
  // ERC-7730 path rules narrow RFC 9535 to dot notation with name, index, and
  // slice selectors (no step), and add #/$/@ roots over data/spec/container.
  // ERC-7730's main path section says array selectors use dot notation, but the
  // later calldata examples use `recipients[0]`; normalize only that local form.
  for (const part of shown.replace(/([A-Za-z0-9_$\]])\[/g, '$1.[').split('.')) {
    if (!part) continue;
    if (part === '#' || part === '@' || part === '$') toks.push({ t: 'root', root: part });
    else if (part[0] === '[') {
      const sel = /^\[(.*)\]$/.exec(part);
      if (!sel) throw new Error(`clearSig: unclosed path selector in ${shown}`);
      const body = sel[1];
      const slice = /^(-?\d*)?:(-?\d*)?$/.exec(body);
      if (body.includes(':') && !slice)
        throw new Error('clearSig: ERC-7730 path slice step is not supported');
      if (body === '') toks.push({ t: 'all' });
      else if (/^-?\d+$/.test(body)) toks.push({ t: 'idx', n: Number(body) });
      else if (slice)
        toks.push({
          t: 'slice',
          a: slice[1] ? Number(slice[1]) : undefined,
          b: slice[2] ? Number(slice[2]) : undefined,
        });
      else throw new Error(`clearSig: unsupported ERC-7730 path selector [${body}]`);
    } else toks.push({ t: 'name', name: part });
  }
  const many = toks.some((t) => t.t === 'all' || t.t === 'slice');
  return Object.assign(
    (root: TArg<PathRoot>) => {
      const data = root['#'];
      const abi =
        isObject(data) && Object.hasOwn(data, ABI_FN)
          ? ((data as Record<PropertyKey, unknown>)[ABI_FN] as ParsedFn)
          : undefined;
      // ERC-7730 omitted-root paths default to the structured data under '#'.
      return jsonPath(path, base, {
        root,
        obj: toks.length && toks[0].t === 'root' ? root : root['#'],
        idx: 0,
        toks,
        abi,
      });
    },
    { path: shown, root: rooted, many }
  ) as TRet<PathEval>;
}) as JsonPath;
// Descriptor constraints (visible.mustMatch/ifNotIn, eip712.domain) are JSON literals
// compared against runtime values where numbers may decode as bigint (uint256 chainId).
const same = (a: unknown, b: unknown) => {
  // A constraint key absent from the runtime object is a mismatch, not a cast error.
  if (a === undefined || b === undefined) return a === b;
  return typeof a === 'bigint' ||
    typeof b === 'bigint' ||
    typeof a === 'number' ||
    typeof b === 'number'
    ? cast.integer(a) === cast.integer(b)
    : cast.raw(a) === cast.raw(b);
};
// Public 1inch registry descriptors store addresses in uint256 ABI fields
// (V6 makerAsset/takerAsset, NativeOrderFactory receiver); convert the low 20
// bytes only at formatter boundaries, never in the generic address cast.
const packed = (v: unknown) =>
  typeof v === 'bigint' ? add0x(bytesToHex(numberToBytesBE(v, 32).slice(-20))) : v;
// Chain display data: caller resolver wins over the bundled offline table.
const chainMeta = async (id: bigint, opt: TArg<ClearSigOpt>): Promise<ClearSigChain> => {
  const o = opt as ClearSigOpt;
  const resolved = o.resolveChain && (await o.resolveChain({ chainId: id }));
  return { ...CHAINS[Number(id)], ...resolved };
};
const native = async (value: unknown, chainId: unknown, opt: TArg<ClearSigOpt>) => {
  const id = cast.chain(chainId === undefined ? _1n : chainId);
  const ticker = (await chainMeta(id, opt)).ticker || 'ETH';
  return `${weieth.encode(cast.integer(value))} ${ticker}`;
};
// Formatter render argument. `param`/`arg`/`meta`/`sub` are pre-bound to the current
// render position so formatter bodies never thread data/descs/contracts/base/each.
type FormatArg = {
  value: unknown;
  p: Any;
  ctx: Ctx;
  opt: ClearSigOpt;
  /** Constant-or-path formatter param: token/tokenPath, amount/amountPath, ... */
  param: (name: string, fallback?: unknown) => unknown;
  /** Literal, rooted-path, or map-valued param spec. */
  arg: (spec: unknown) => unknown;
  /** Token/contract metadata lookup (resolver -> registry -> descriptor metadata). */
  meta: (v: unknown, chainId?: unknown) => Promise<ClearSigToken | undefined>;
  /** Renders a nested call compactly with the given (or current) descriptor set. */
  sub: (call: Ctx, descs?: Any | Any[]) => Promise<string | undefined>;
  /** Wraps resolver-request extras with the current descriptor/field/context. */
  req: <T extends Any>(extra: T) => T & Req;
  /** Trusted-name lookup via a resolver, restricted by descriptor sources/types. */
  named: <R>(r: Resolve<R, ClearSigName> | undefined, extra: R) => Promise<string | undefined>;
};
const hasAddr = (list: unknown, address: string, arg: TArg<FormatArg['arg']>) =>
  arr(list).some((i: unknown) => address === cast.address(arg(i)).toLowerCase());
// Formatter-specific display behavior stays centralized here, keyed by descriptor
// `format`; unsupported formats fall back to cast.raw in format() below.
const formatters: Record<string, (f: FormatArg) => string | Promise<string>> = {
  async tokenAmount({ value, ctx, opt, p, param, arg, meta }) {
    const n = cast.integer(value);
    const token = param('token', ctx.to);
    const chainId = param('chainId', ctx.chainId);
    const tokenAddr = cast.address(packed(token)).toLowerCase();
    if (hasAddr(p.nativeCurrencyAddress, tokenAddr, arg)) return native(value, chainId, opt);
    const m = await meta(tokenAddr, chainId);
    if (!m || m.decimals === undefined || !m.symbol) return `${n} ???`;
    // ERC-7730: convert using decimals, append ticker; values at/above threshold
    // display message + ticker instead.
    if (p.threshold !== undefined && n >= cast.integer(arg(p.threshold)))
      return `${p.message || 'Unlimited'} ${m.symbol}`;
    return `${createDecimal(m.decimals).encode(n)} ${m.symbol}`;
  },
  amount: ({ value, ctx, opt }) => native(value, ctx.chainId, opt),
  async addressName({ value, ctx, opt, p, arg, meta, named }) {
    const a = cast.address(packed(value));
    if (hasAddr(p.senderAddress, a.toLowerCase(), arg)) return ctx.from || a;
    const resolved = await named(opt.resolveAddress, { address: a.toLowerCase() });
    if (resolved) return resolved;
    // ERC-7730 addressName.sources restricts trusted name providers; bundled
    // metadata is only a local/offline source, and a token ticker is not a name.
    if (Array.isArray(p.sources) && !p.sources.includes('local')) return a;
    const m = await meta(a);
    return (m && m.name) || a;
  },
  async date({ value, ctx, opt, p, req }) {
    const date = (v: unknown) => new Date(Number(cast.integer(v)) * 1000).toUTCString();
    // Blockheight dates need chain timing data; no-network mode must not misread
    // a block number as Unix seconds, so without a resolver show the raw value.
    if (p.encoding === 'blockheight') {
      const resolved =
        opt.resolveBlock &&
        (await opt.resolveBlock(req({ block: cast.integer(value), chainId: ctx.chainId })));
      if (resolved === undefined) return cast.raw(value);
      if (!Number.isSafeInteger(resolved))
        throw new Error(`clearSig: expected unix timestamp number, got ${resolved}`);
      return date(resolved);
    }
    // toUTCString keeps date display deterministic across hosts.
    return date(value);
  },
  duration({ value }) {
    const sec = Number(cast.integer(value));
    const pad = (n: number) => `${n}`.padStart(2, '0');
    return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
  },
  unit({ value, p, arg }) {
    const u = p.base !== undefined ? { ...p, base: arg(p.base) } : p;
    const decimals = u.decimals === undefined ? 0 : Number(u.decimals);
    const n = cast.integer(value);
    if (!u.base) return createDecimal(decimals).encode(n);
    if (!u.prefix) return `${createDecimal(decimals).encode(n)} ${u.base}`;
    const abs = n < _0n ? -n : n;
    const shift = abs.toString().length - decimals - 1;
    const si = ['', 'k', 'M', 'G', 'T', 'P', 'E'];
    // ERC-7730 unit.prefix converts a 10^3 exponent into an SI prefix on the unit.
    const idx = Math.max(0, Math.min(si.length - 1, Math.floor(shift / 3)));
    return `${createDecimal(decimals + idx * 3).encode(n)}${si[idx]}${u.base}`;
  },
  async tokenTicker({ value, ctx, param, meta }) {
    const token = param('token', value);
    const m = await meta(token, param('chainId', ctx.chainId));
    return (m && m.symbol) || cast.address(token);
  },
  // NFT and interoperable-address names rely on wallet trust sources; in
  // no-network mode ERC-7730 permits raw fallback display.
  async nftName({ value, ctx, opt, param, req }) {
    const collection = param('collection', ctx.to);
    const r =
      collection !== undefined &&
      opt.resolveNft &&
      (await opt.resolveNft(
        req({
          collection: cast.address(collection).toLowerCase(),
          tokenId: cast.integer(value),
          chainId: ctx.chainId,
        })
      ));
    if (!r || (typeof r !== 'string' && r.verified === false)) return cast.raw(value);
    if (typeof r === 'string') return r;
    return (
      r.name ||
      r.tokenName ||
      (r.collectionName ? `${r.collectionName} #${cast.raw(value)}` : cast.raw(value))
    );
  },
  async interoperableAddressName({ value, opt, named }) {
    const resolved = await named(opt.resolveInteroperableAddress, { value: cast.bytes(value) });
    return resolved || cast.raw(value);
  },
  // Embedded calldata: resolve another descriptor by callee/selector; if nothing
  // matches, wallets may fall back to opaque calldata display.
  async calldata({ value, ctx, opt, param, sub, req }) {
    const call: Ctx = {
      to: cast.address(param('callee', ctx.to)),
      data: isBytes(value) ? value : ethHex.decode(cast.raw(value)),
      chainId: ctx.chainId,
    };
    const selector = param('selector');
    if (selector !== undefined) {
      const want = cast.bytes(selector).slice(-4);
      if (!equalBytes(call.data!.slice(0, 4), want)) call.data = concatBytes(want, call.data!);
    }
    const amount = param('amount');
    if (amount !== undefined) call.value = cast.integer(amount);
    const chainId = param('chainId');
    if (chainId !== undefined) call.chainId = cast.chain(chainId);
    const spender = param('spender');
    if (spender !== undefined) call.from = cast.address(spender);
    const inner = await sub(call);
    if (inner) return inner;
    const resolved =
      opt.resolveCalldata &&
      (await opt.resolveCalldata(
        req({
          to: call.to!.toLowerCase(),
          data: call.data!,
          selector: add0x(bytesToHex(call.data!.slice(0, 4))),
          chainId: _chain(call.chainId),
          value: call.value,
          from: call.from,
        })
      ));
    if (!resolved) return cast.raw(value);
    return (await sub(call, resolved)) || cast.raw(value);
  },
  enum({ value, p }) {
    const vals = p.values || p;
    // Registry ERC-721 uses `True`/`False` enum keys while decoded ABI booleans
    // stringify to lowercase JavaScript booleans.
    const key = `${value}`;
    const alt = key === 'true' ? 'True' : key === 'false' ? 'False' : key;
    const hit =
      isObject(vals) && (Object.hasOwn(vals, key) ? key : Object.hasOwn(vals, alt) ? alt : '');
    return hit ? vals[hit] : cast.raw(value);
  },
  async chainId({ value, opt }) {
    return (await chainMeta(cast.chain(value), opt)).name || `${value}`;
  },
};
const cleanDeployments = (deployments: Any[] = []): Deployment[] =>
  deployments
    .filter((i) => i && i.address)
    .map((i) => {
      if (i.chainId === undefined) throw new Error('clearSig: missing deployment chainId');
      if (typeof i.chainId === 'number' && !Number.isSafeInteger(i.chainId))
        throw new Error(`clearSig: expected safe number deployment chainId, got ${i.chainId}`);
      return { address: i.address.toLowerCase(), chainId: cast.chain(i.chainId) };
    })
    .filter(
      (d, i, a) => a.findIndex((j) => j.address === d.address && j.chainId === d.chainId) === i
    );
// Repository keys are logical descriptor ids, not filesystem paths. Exact include
// keys win; otherwise includes resolve relative to the current id with only `..` special.
const resolveRepo = (files: Record<string, Any>, key: string, seen: string[] = []): Any => {
  const desc = files[key];
  if (!desc) throw new Error(`clearSig.repository: missing descriptor ${key}`);
  if (seen.includes(key)) throw new Error(`clearSig.repository: recursive include ${key}`);
  const next = seen.concat(key);
  return resolveIncludes(desc, (inc) => {
    let k = inc;
    if (!files[k]) {
      const parts = key.split('/');
      parts.pop();
      for (const part of inc.split('/'))
        if (part === '..') parts.pop();
        else parts.push(part);
      k = parts.join('/');
    }
    return resolveRepo(files, k, next);
  });
};

/**
 * Builds a frozen in-memory ERC-7730 repository index from a descriptor-keyed map.
 * Resolves includes upfront so ABI/EIP-712 decode can look up renderers cheaply;
 * entries are concrete chain, address, and selector bindings only, never wildcards.
 * @param files - Descriptor JSON values keyed by logical descriptor id.
 * @returns Frozen calldata and EIP-712 repository indexes.
 * @throws If descriptor includes cannot be resolved or repository validation fails. {@link Error}
 */
export const repository = (files: Record<string, ClearSigDef>): TRet<ClearSigRepository> => {
  const src: Record<string, Any> = {};
  for (const k of Object.keys(files)) src[k] = cloneDeep(files[k]);
  const descriptors = Object.keys(src).map((name) => ({ name, desc: resolveRepo(src, name) }));
  // Cross-descriptor token metadata comes from the FILES (addTokens synthesizes
  // per-token descriptors with metadata.token): harvest deployed token metadata
  // into the per-render contracts map, so e.g. a router descriptor can name a
  // token that only appears as a calldata argument.
  const contracts: Record<string, ClearSigToken> = {};
  for (const { desc } of descriptors) {
    const token = (desc.metadata || ({} as Any)).token;
    if (!token) continue;
    for (const d of deployments(desc.context || {})) {
      if (!d.address) continue;
      const key = `${d.address}`.toLowerCase();
      const prev = contracts[key] || {};
      const meta = tokenMeta(token);
      // Concrete descriptors such as WETH can carry a trusted name while
      // addTokens-generated generic ERC clones only carry ticker/decimals.
      // Merge without erasing richer metadata with absent fields.
      contracts[key] = {
        name: meta.name || prev.name,
        symbol: meta.symbol || prev.symbol,
        decimals: meta.decimals === undefined ? prev.decimals : meta.decimals,
      };
    }
  }
  const resolved = descriptors.map((i) => i.desc);
  const contractsByChain: ClearSigRepository['contracts'] = {};
  const generic: ClearSigRepositoryEntry[] = [];
  const eip712ByChain: ClearSigRepository['eip712'] = {};
  const factoryEntries: ClearSigFactoryEntry[] = [];
  const env = (opt_: TArg<ClearSigOpt>) => {
    const opt = opt_ as RunOpt;
    const all = { ...contracts, ...opt.contracts };
    return { contracts: all, opt: { ...(opt as ClearSigOpt), contracts: all } as RunOpt };
  };
  const eip712Index = (chainId: bigint, address: string) => {
    const byAddr = eip712ByChain[`${chainId}`] || (eip712ByChain[`${chainId}`] = {});
    const key = cast.address(address).toLowerCase();
    return byAddr[key] || (byAddr[key] = {});
  };
  const callEntry = (
    desc: Any,
    key: string,
    fn: ParsedFn,
    source: number
  ): TRet<ClearSigRepositoryEntry> =>
    Object.assign(
      async (input: TArg<Ctx | ClearSigTypedInput>, opt: TArg<ClearSigOpt> = {}) => {
        const call = input as Ctx;
        const e = env(opt);
        const ctx: Ctx = {
          to: call.to,
          from: call.from,
          data: call.data,
          value: call.value === undefined ? undefined : cast.integer(call.value),
          chainId: _chain(call.chainId),
        };
        if (!ctx.data) throw new Error('clearSig: expected calldata bytes');
        let decoded: Any = {};
        if (fn.inputs.length) {
          decoded = mapArgs(fn.inputs).decode(ctx.data.slice(4), {
            allowUnreadBytes: e.opt.allowUnreadBytes,
          }) as Any;
          if (fn.inputs.length === 1 && fn.inputs[0].name)
            decoded = { [fn.inputs[0].name]: decoded };
          if (isObject(decoded)) Object.defineProperty(decoded, ABI_FN, { value: fn });
        }
        return render(
          { desc, fmt: formats(desc)[key], data: decoded, ctx },
          resolved,
          e.contracts,
          e.opt
        );
      },
      { fn, source }
    ) as TRet<ClearSigRepositoryEntry>;
  const typedEntry = (desc: Any, key: string): TRet<ClearSigRepositoryEntry> =>
    (async (input: TArg<Ctx | ClearSigTypedInput>, opt: TArg<ClearSigOpt> = {}) => {
      const typed = input as TypedData<EIP712Types, string>;
      const e = env(opt);
      const domain = typed.domain as Any;
      return render(
        {
          desc,
          fmt: formats(desc)[key],
          data: typed.message as Any,
          ctx: typedCtx(domain),
        },
        resolved,
        e.contracts,
        e.opt
      );
    }) as TRet<ClearSigRepositoryEntry>;
  let source = 0;
  for (const { desc } of descriptors) {
    const src = source++;
    const context = (desc.context || {}) as Any;
    const eip = context.eip712;
    const contract = context.contract || (!eip ? {} : undefined);
    if (!contract && !eip) continue;
    const deployments = cleanDeployments((contract ? contract.deployments : eip.deployments) || []);
    const entries: ClearSigRepositoryEntry[] = [];
    const keyed: [string, ClearSigRepositoryEntry][] = [];
    for (const key of Object.keys(formats(desc))) {
      if (contract) {
        const open = key.indexOf('(');
        if (open <= 0) throw new Error(`clearSig: expected function signature, got ${key}`);
        const close = matchParen(key, open);
        if (key.slice(close + 1).trim())
          throw new Error(`clearSig: non-calldata format key ${key}`);
        // ABI calldata format keys are parsed to function components only;
        // selector hashing stays in Decoder.addClearSig() through ordinary ABI APIs.
        const fn: ParsedFn = {
          type: 'function',
          name: key.slice(0, open).trim(),
          inputs: splitArgs(key.slice(open + 1, close)).map(parseArg),
        };
        keyed.push([key, callEntry(desc, key, fn, src)]);
      } else keyed.push([eip712Key(key), typedEntry(desc, key)]);
    }
    for (const [selector, e] of keyed) {
      entries.push(e);
      if (contract)
        for (const d of deployments) {
          const byAddr =
            contractsByChain[`${d.chainId}`] || (contractsByChain[`${d.chainId}`] = {});
          (byAddr[d.address] || (byAddr[d.address] = [])).push(e);
        }
      else for (const d of deployments) eip712Index(d.chainId, d.address)[selector] = e;
      if (deployments.length) continue;
      // Without declared deployments nothing binds - empty `context.contract`
      // files in `ercs/` are reusable interfaces; `addTokens` clones them into
      // per-token descriptors WITH deployments. EIP-712 descriptors may still
      // bind through a fully-pinned domain.
      if (contract) {
        if (!contract.factory) generic.push(e);
      } else {
        const domain = eip.domain || {};
        if (domain.chainId !== undefined && domain.verifyingContract !== undefined) {
          eip712Index(cast.chain(domain.chainId), domain.verifyingContract)[selector] = e;
        }
      }
    }
    if (contract && contract.factory)
      factoryEntries.push({
        factory: contract.factory,
        deployments: cleanDeployments(contract.factory.deployments || []),
        deployEvent: contract.factory.deployEvent,
        entries,
      });
  }
  const repo = {
    contracts: contractsByChain,
    generic,
    eip712: eip712ByChain,
    factories: factoryEntries,
  };
  return deepFreeze(repo) as TRet<ClearSigRepository>;
};

// Turns a matched format into the public result: calldata and EIP-712 matching
// differ, but field rendering and interpolation are identical.
const render = async (
  match: TArg<Match>,
  descs: Any[],
  contracts_: TArg<Record<string, ClearSigToken>>,
  opts: TArg<ClearSigOpt>
): Promise<ClearSigResult> => {
  const data = match.data as Any;
  const ctx = match.ctx as Ctx;
  const desc = match.desc as Any;
  const contracts = contracts_ as Record<string, ClearSigToken>;
  const opt = { ...(opts as ClearSigOpt), contracts };
  const root = (each?: number): TRet<PathRoot> => {
    const r: PathRoot = { '#': data, '@': ctx, $: desc };
    if (each !== undefined) r[PATH_INDEX] = each;
    return r as TRet<PathRoot>;
  };
  const val = (path: string, each?: number, base = '') => jsonPath(path, base)(root(each));
  // Formatter params can be literals, rooted paths, or maps over decoded values.
  const arg = (spec: unknown, base = '', each?: number): unknown => {
    if (typeof spec === 'string') {
      const pe = jsonPath(spec);
      if (pe.root) return pe(root(each));
    }
    if (!spec || typeof spec !== 'object' || !Object.hasOwn(spec, 'map')) return spec;
    const s = spec as Any;
    // ERC-7730 maps are "used anywhere a parameter with constant value would be used";
    // missing keys make the descriptor invalid for this transaction.
    const map = val(s.map, each, base);
    const values =
      map && typeof map === 'object' && Object.hasOwn(map, 'values') ? (map as Any).values : map;
    const key = cast.raw(val(s.keyPath, each, base));
    if (!values || typeof values !== 'object' || !Object.hasOwn(values, key))
      throw new Error(`clearSig: missing map value key=${key}`);
    return (values as Any)[key];
  };
  const paramKeys = ['token', 'chainId', 'callee', 'selector', 'amount', 'spender', 'collection'];
  // Renders display fields for a selected format: $ref resolution, group recursion,
  // bundled arrays, visibility rules, and interpolation metadata.
  const fields = async (list: Any[], base = ''): Promise<RenderField[]> => {
    const out: RenderField[] = [];
    for (const original of list) {
      let field = original;
      const r = field.$ref;
      if (r) {
        // ERC-7730 $refs are paths to definitions (`$.display.definitions.NAME`);
        // evaluate them with the same path evaluator as fields/params.
        const ref = typeof r === 'string' ? jsonPath(r) : undefined;
        if (!ref || !ref.root) throw new Error(`clearSig: unsupported $ref=${r}`);
        const def = ref({ '#': {}, '@': {}, $: desc } as PathRoot);
        if (!isObject(def)) throw new Error(`clearSig: missing $ref=${r}`);
        field = { ...def, ...field, params: { ...(def.params || {}), ...(field.params || {}) } };
      }
      if (field.visible === 'never' && !field.fields) continue;
      const pick = field.path ? jsonPath(field.path, base) : undefined;
      if (pick && pick.path === '@.from' && ctx.from === undefined) continue;
      // ERC-7730 group recursion builds leaf paths relative to parent paths;
      // wallets should display fields in the order they appear in the group.
      const nextBase = pick ? pick.path : base;
      if (field.fields) {
        const nested: RenderField[][] = [];
        for (const child of field.fields) nested.push(await fields([child], nextBase));
        if (field.iteration === 'bundled') {
          const max = Math.max(0, ...nested.map((i: RenderField[]) => i.length));
          for (const arr of nested) {
            if (arr.length && arr.length !== max)
              throw new Error('clearSig: bundled arrays must have matching lengths');
          }
          for (let i = 0; i < max; i++) for (const arr of nested) if (arr[i]) out.push(arr[i]);
        } else for (const arr of nested) out.push(...arr);
        continue;
      }
      if (field.path && Object.hasOwn(field, 'value'))
        throw new Error('clearSig: cannot combine path and value');
      let values: unknown[];
      if (field.path) {
        const picked = pick!(root());
        values = pick!.many && Array.isArray(picked) ? picked : [picked];
      } else values = [field.value === undefined ? undefined : arg(field.value)];
      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        // ERC-7730 visible rules: never excludes, optional may display, ifNotIn
        // hides matching values, and mustMatch is hidden but errors on mismatch.
        const v = field.visible;
        if (v === 'never') continue;
        if (v && typeof v === 'object') {
          if (Object.hasOwn(v, 'ifNotIn') && Object.hasOwn(v, 'mustMatch'))
            throw new Error('clearSig: cannot combine visible.ifNotIn and visible.mustMatch');
          if (v.mustMatch && !v.mustMatch.some((j: unknown) => same(value, j)))
            throw new Error(`clearSig: visible.mustMatch failed for ${field.path || field.label}`);
          if (v.mustMatch || (v.ifNotIn && v.ifNotIn.some((j: unknown) => same(value, j))))
            continue;
        }
        let displayField = field;
        let displayValue = value;
        // Effective formatter params: $ref definitions merged under local overrides.
        const fp = displayField.params || {};
        let p = fp;
        if (fp.$ref) {
          const ref = arg(fp.$ref, base, i);
          const { $ref: _ref, ...over } = fp;
          p = ref && typeof ref === 'object' ? { ...(ref as Any), ...over } : over;
        }
        // ERC-7730 schemas model these as "constant or path" alternatives, not both.
        for (const k of paramKeys)
          if (Object.hasOwn(p, k) && Object.hasOwn(p, `${k}Path`))
            throw new Error(`clearSig: cannot combine ${k} and ${k}Path`);
        const req = <T extends Any>(extra: T): TRet<T & Req> =>
          ({
            ...extra,
            descriptor: desc,
            field: displayField,
            context: ctx,
          }) as TRet<T & Req>;
        let formatted: string | undefined;
        // ERC-7730 encryption fallback: real FHEVM decryption is out of scope, so an
        // undecryptable value displays fallbackLabel (or raw) instead of garbage.
        if (displayField.encryption) {
          const plain =
            opt.decrypt &&
            (await opt.decrypt(
              req({
                scheme: displayField.encryption.scheme,
                encryption: displayField.encryption,
                value: displayValue,
              })
            ));
          if (plain === undefined)
            formatted = displayField.encryption.fallbackLabel || cast.raw(value);
          else {
            // `req` closes over `displayField`, so formatters see the decrypted,
            // encryption-free field.
            displayField = omit(displayField, 'encryption');
            displayValue = plain;
          }
        }
        if (formatted === undefined) {
          const fmt = formatters[displayField.format];
          if (!fmt) formatted = cast.raw(displayValue);
          else
            formatted = await fmt({
              value: displayValue,
              p,
              ctx,
              opt,
              // ERC-7730 "constant or path" params: token/tokenPath, amount/amountPath, etc.
              param: (name: string, fallback?: unknown): unknown => {
                const path = p[`${name}Path`];
                if (path !== undefined) return val(path, i, base);
                return p[name] !== undefined ? arg(p[name], base, i) : fallback;
              },
              arg: (spec: unknown): unknown => arg(spec, base, i),
              meta: async (
                v_: unknown,
                chainId?: unknown
              ): Promise<TRet<ClearSigToken | undefined>> => {
                // Token metadata for tokenAmount/tokenTicker stays offline by default:
                // resolver first, then native sentinel, repository/caller metadata,
                // and finally descriptor self-metadata.
                const a = cast.address(v_).toLowerCase();
                const id = chainId === undefined ? ctx.chainId : cast.chain(chainId);
                const resolved =
                  opt.resolveToken &&
                  (await opt.resolveToken({
                    address: a,
                    chainId: id,
                    descriptor: desc,
                    field: displayField,
                    context: ctx,
                  }));
                if (resolved && resolved.verified !== false)
                  return {
                    ...resolved,
                    symbol: resolved.symbol || resolved.ticker,
                  } as TRet<ClearSigToken>;
                // Conventional native-token sentinel; resolveToken above can override per chain.
                if (a === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
                  return { symbol: 'ETH', decimals: 18 } as TRet<ClearSigToken>;
                if (contracts[a]) return contracts[a] as TRet<ClearSigToken>;
                // metadata.token describes the descriptor's own contract; match it only
                // against declared deployments or the current target.
                const token = (desc.metadata || {}).token;
                if (!token) return;
                const ds: Any[] = deployments(desc.context || {});
                if (ctx.to) ds.push({ address: ctx.to });
                for (const d of ds)
                  if (d.address && d.address.toLowerCase() === a)
                    return tokenMeta(token) as TRet<ClearSigToken>;
                return;
              },
              // Nested calls display as one line: interpolation or intent plus labeled fields.
              sub: async (call: TArg<Ctx>, d: Any | Any[] = descs): Promise<string | undefined> => {
                const ropt = opt as RunOpt;
                if (!ropt.renderCalldata) throw new Error('clearSig: no nested calldata renderer');
                const r = await ropt.renderCalldata(
                  d,
                  call as Ctx,
                  { ...ropt, contracts } as RunOpt
                );
                if (!r) return;
                const rows = Object.entries(r.fields as Record<string, ClearSigField>).map(
                  ([label, f]) => `${label} ${f.value}`
                );
                return r.interpolatedIntent || [r.intent, ...rows].join(' ');
              },
              req,
              // ERC-7730 requires wallets to restrict trusted names to requested sources;
              // if the callback omits source/types, it is treated as already filtered.
              named: async <R>(r: TArg<Resolve<R, ClearSigName> | undefined>, extra: R) => {
                const got =
                  r &&
                  (await r(
                    req({ ...extra, chainId: ctx.chainId, sources: p.sources, types: p.types })
                  ));
                const n = typeof got === 'string' ? { name: got } : got;
                if (!n || !n.name || n.verified === false) return;
                if (Array.isArray(p.sources) && n.source && !p.sources.includes(n.source)) return;
                if (
                  Array.isArray(p.types) &&
                  n.types &&
                  !n.types.some((j: string) => p.types.includes(j))
                )
                  return;
                return n.name;
              },
            });
        }
        // Keep absent descriptor keys absent; callers compare this structured output directly.
        const item: RenderField = {
          label: field.label,
          pub: {
            value: formatted,
            format: field.format || 'raw',
            rawValue: value,
          },
        };
        if (pick) item.path = pick.path;
        if (field.separator) item.separator = field.separator.replace('{index}', `${i}`);
        // ERC-7730 interpolatedIntent may only reference always-visible paths; conditional
        // or optional fields are omitted from the interpolation map and force fallback.
        if (item.path && (!field.visible || field.visible === 'always')) item.interpolate = true;
        out.push(item);
      }
    }
    return out;
  };
  const res = await fields(match.fmt.fields || []);
  const md = match.desc.metadata || {};
  const rawIntent = match.fmt.intent || md.contractName || md.owner;
  const intent =
    typeof rawIntent === 'string'
      ? rawIntent
      : rawIntent && typeof rawIntent === 'object'
        ? Object.entries(rawIntent as Any)
            .map(([k, v]) => `${k} ${cast.raw(v)}`)
            .join(' ')
        : 'Sign';
  const shown: Record<string, ClearSigField> = {};
  for (const field of res) {
    let label = field.separator ? `${field.separator} ${field.label}` : field.label;
    if (Object.hasOwn(shown, label)) {
      let i = 2;
      while (Object.hasOwn(shown, `${label} ${i}`)) i++;
      label = `${label} ${i}`;
    }
    shown[label] = field.pub;
  }
  // ERC-7730 interpolation only exists when the descriptor provides it. If
  // processing that string fails, wallets fall back to `intent`.
  if (match.fmt.interpolatedIntent === undefined) return { intent, fields: shown };
  const formatted: Record<string, RenderField | RenderField[]> = {};
  for (const f of res) {
    const p = f.path;
    if (!p || !f.interpolate) continue;
    if (!Object.hasOwn(formatted, p)) formatted[p] = f;
    // Registry intents reference wildcard fields without the trailing `[]`; those
    // aliases collect every rendered item for comma-joined display.
    const alias = p.endsWith('.[]')
      ? p.slice(0, -3)
      : p.endsWith('[]')
        ? p.slice(0, -2)
        : undefined;
    if (alias === undefined) continue;
    if (!Object.hasOwn(formatted, alias)) formatted[alias] = [];
    if (Array.isArray(formatted[alias])) (formatted[alias] as RenderField[]).push(f);
  }
  const structured: (string | RenderField)[] = [];
  const pushText = (text: string) => {
    const last = structured[structured.length - 1];
    if (typeof last === 'string') structured[structured.length - 1] = last + text;
    else structured.push(text);
  };
  let valid = true;
  for (const part of `${match.fmt.interpolatedIntent}`.split(/(\{\{|\}\}|\{[^{}]*\})/)) {
    if (!part) continue;
    if (part === '{{' || part === '}}') pushText(part[0]);
    else if (/^\{[^{}]*\}$/.test(part)) {
      const path = part.slice(1, -1);
      if (!Object.hasOwn(formatted, path)) {
        valid = false;
        break;
      }
      const hit = formatted[path];
      if (!Array.isArray(hit)) structured.push(hit);
      else
        for (let j = 0; j < hit.length; j++) {
          if (j) structured.push(', ');
          structured.push(hit[j]);
        }
    } else if (part.includes('{') || part.includes('}')) {
      valid = false;
      break;
    } else pushText(part);
  }
  if (!valid) return { intent, interpolatedIntent: intent, fields: shown };
  const structuredIntent = structured.map((i) => (typeof i === 'string' ? i : i.pub));
  const interpolatedIntent = structuredIntent
    .map((i) => (typeof i === 'string' ? i : i.value))
    .join('');
  return { intent, interpolatedIntent, structuredIntent, fields: shown };
};

/**
 * Renders ERC-7730 clear-signing display data for EIP-712 typed data.
 * Takes the same typed-data object passed to `signTyped`; matching uses EIP-712
 * type hashes plus deployment/domain/domainSeparator context constraints.
 * @param input - EIP-712 typed-data object to render.
 * @param opts - Optional descriptor source and resolver callbacks. See {@link ClearSigOpt}.
 * @returns Rendered clear-signing intent and fields, or undefined when no descriptor matches.
 * @throws If typed-data input, descriptor definitions, or selected rendering are invalid. {@link Error}
 * @example
 * Render clear-signing data for typed-data before signing.
 * ```ts
 * import { eip712, type ClearSigTypedInput } from 'micro-eth-signer/advanced/abi.js';
 * const descriptor = {
 *   context: {
 *     eip712: {
 *       domain: {
 *         name: 'Demo',
 *         chainId: 1,
 *         verifyingContract: '0x0000000000000000000000000000000000000001',
 *       },
 *     },
 *   },
 *   display: {
 *     formats: {
 *       'Msg(uint256 value)': {
 *         intent: 'Sign',
 *         fields: [{ path: 'value', label: 'Value', format: 'raw' }],
 *       },
 *     },
 *   },
 * };
 * const typed = {
 *   types: {
 *     EIP712Domain: [
 *       { name: 'name', type: 'string' },
 *       { name: 'chainId', type: 'uint256' },
 *       { name: 'verifyingContract', type: 'address' },
 *     ],
 *     Msg: [{ name: 'value', type: 'uint256' }],
 *   },
 *   primaryType: 'Msg',
 *   domain: {
 *     name: 'Demo',
 *     chainId: 1n,
 *     verifyingContract: '0x0000000000000000000000000000000000000001',
 *   },
 *   message: { value: 1n },
 * } as unknown as ClearSigTypedInput;
 * const files = { 'demo.json': descriptor };
 * const res = await eip712(typed, { clearSig: files });
 * ```
 */
export async function eip712(
  input: TArg<ClearSigTypedInput>,
  opts: TArg<ClearSigOpt> = {}
): Promise<ClearSigResult | undefined> {
  const opt = opts as ClearSigOpt;
  const descriptors = opt.clearSig;
  if (!descriptors) return;
  const keys = ['types', 'primaryType', 'domain', 'message'];
  if (!isObject(input) || keys.some((k) => !Object.hasOwn(input, k)))
    throw new Error('clearSig: expected EIP-712 typed data');
  const typed = input as TypedData<EIP712Types, string>;
  if (
    isObject(descriptors) &&
    !Array.isArray(descriptors) &&
    !['$schema', 'context', 'display', 'includes', 'metadata'].some((k) =>
      Object.hasOwn(descriptors, k)
    )
  ) {
    const domain = typed.domain as Any;
    if (domain.chainId === undefined || typeof domain.verifyingContract !== 'string') return;
    const id = cast.chain(domain.chainId);
    const byAddr = repository(descriptors as Record<string, ClearSigDef>).eip712[`${id}`];
    const address = cast.address(domain.verifyingContract).toLowerCase();
    const sign = byAddr && byAddr[address] && byAddr[address][eip712Key(typedKey(typed))];
    return sign ? sign(typed as Ctx | ClearSigTypedInput, opt) : undefined;
  }
  const contracts: Record<string, ClearSigToken> = {};
  const all = (opt as RunOpt).contracts || {};
  for (const k of Object.keys(all)) contracts[k.toLowerCase()] = all[k];
  const descs = arr(descriptors).map((desc) =>
    resolveIncludes(desc, (inc) => {
      throw new Error(`clearSig: unresolved include ${inc}; pass descriptor files`);
    })
  );
  let match: Match | undefined;
  const ttypes = {
    EIP712Domain: getDomainType(typed.domain as EIP712DomainType),
    ...typed.types,
  };
  const enc = typedKey(typed);
  for (const desc of descs) {
    const eip = desc.context && desc.context.eip712;
    if (eip) {
      const domain = typed.domain as Any;
      const chainId = domain.chainId;
      if (eip.deployments) {
        const deployed =
          domain.verifyingContract &&
          chainId !== undefined &&
          cleanDeployments(eip.deployments).some(
            (d) =>
              d.address === `${domain.verifyingContract}`.toLowerCase() &&
              d.chainId === cast.chain(chainId)
          );
        if (!deployed) continue;
      }
      if (eip.domainSeparator) {
        // ERC-7730 domainSeparator is an offline EIP-712 binding check; compute it
        // from the message domain instead of trusting names/versions alone.
        let sep: string | undefined;
        try {
          sep = typedEncoder(ttypes, typed.domain).structHash('EIP712Domain', typed.domain);
        } catch {
          // An unhashable domain cannot satisfy a domainSeparator constraint.
        }
        if (!sep || sep.toLowerCase() !== cast.raw(eip.domainSeparator).toLowerCase()) continue;
      }
      // ERC-7730 eip712.domain constraints are simple key-value pairs that MUST match;
      // `same` tolerates bigint-vs-JSON-number chainId, and verifyingContract compares
      // case-insensitively like every other address comparison in clear signing. The
      // registry has exact-deployment vectors with stale domain names, so deployments
      // win when present.
      if (eip.domain && !eip.deployments) {
        const ok = Object.keys(eip.domain).every((k) =>
          k === 'verifyingContract'
            ? `${domain[k]}`.toLowerCase() === `${eip.domain[k]}`.toLowerCase()
            : same(domain[k], eip.domain[k])
        );
        if (!ok) continue;
      }
    }
    const fmts = formats(desc);
    if (!Object.hasOwn(fmts, enc)) continue;
    const domain = typed.domain as Any;
    match = {
      desc,
      fmt: fmts[enc],
      data: typed.message as Any,
      ctx: typedCtx(domain),
    };
    break;
  }
  if (!match) return;
  return render(match, descs, contracts, opt);
}
