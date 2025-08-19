import * as P from 'micro-packed';

// prettier-ignore
type IntIdxType = ''    | '8'   | '16'  | '24'  | '32'  | '40'  | '48'  | '56'  |
  '64'  | '72'  | '80'  | '88'  | '96'  | '104' | '112' | '120' | '128' | '136' |
  '144' | '152' | '160' | '168' | '176' | '184' | '192' | '200' | '208' | '216' |
  '224' | '232' | '240' | '248' | '256';
type UintType = `uint${IntIdxType}`;
type IntType = `int${IntIdxType}`;
type NumberType = UintType | IntType;
// Basic type support
// int<M>: two’s complement signed integer type of M bits, 0 < M <= 256, M % 8 == 0.
// prettier-ignore
// bytes<M>: binary type of M bytes, 0 < M <= 32.
// prettier-ignore
type ByteIdxType = '' | '1' | '2'  | '3'  | '4'  | '5'  | '6'  | '7'  | '8'  | '9'  |
  '10' | '11' | '12' | '13' | '14' | '15' | '16' | '17' | '18' | '19' | '20' | '21' |
  '22' | '23' | '24' | '25' | '26' | '27' | '28' | '29' | '30' | '31' | '32';
type ByteType = `bytes${ByteIdxType}`;

export type Writable<T> = T extends {}
  ? {
      -readonly [P in keyof T]: Writable<T[P]>;
    }
  : T;
export type IsEmptyArray<T> =
  T extends ReadonlyArray<any> ? (T['length'] extends 0 ? true : false) : true;
export type ArrLike<T> = Array<T> | ReadonlyArray<T>;

export type Component<T extends string> = {
  readonly name?: string;
  readonly type: T;
};
export type NamedComponent<T extends string> = Component<T> & { readonly name: string };
export type BaseComponent = Component<string>;
export type Tuple<TC extends ArrLike<Component<string>>> = {
  readonly name?: string;
  readonly type: 'tuple';
  readonly components: TC;
};

// [{name: 'a', type: 'string'}, {name: 'b', type: 'uint'}] -> {a: string, b: bigint};
export type MapTuple<T> =
  T extends ArrLike<Component<string> & { name: string }>
    ? {
        [K in T[number] as K['name']]: MapType<K>;
      }
    : T extends ArrLike<Component<string>>
      ? // [{name: 'a', type: 'string'}, {type: 'uint'}] -> [string, bigint];
        {
          [K in keyof T]: T[K] extends BaseComponent ? MapType<T[K]> : unknown;
        }
      : unknown;
// prettier-ignore
export type MapType<T extends BaseComponent> =
  T extends Tuple<Array<Component<string>>> ? MapTuple<T['components']> :
  T extends Component<infer Type> ? GetType<Type> :
  unknown; // default
export type UnmapType<T> = T extends MapType<infer U> ? U : never;
// If only one arg -- use as is, otherwise construct tuple by tuple rules
export type ArgsType<T extends ReadonlyArray<any> | undefined> =
  IsEmptyArray<T> extends true
    ? undefined // empty arr
    : T extends ReadonlyArray<any>
      ? T['length'] extends 1 // single elm
        ? MapType<T[0]>
        : MapTuple<T>
      : MapTuple<T>;

// prettier-ignore
export type GetType<T extends string> =
  T extends `${infer Base}[]${infer Rest}` ? GetType<`${Base}${Rest}`>[] : // 'string[]' -> 'string'[]
  T extends `${infer Base}[${number}]${infer Rest}` ? GetType<`${Base}${Rest}`>[] : // 'string[3]' -> 'string'[]
  T extends 'address' ? string :
  T extends 'string' ? string :
  T extends 'bool' ? boolean :
  T extends NumberType ? bigint :
  T extends ByteType ? Uint8Array :
  unknown; // default

export const ARRAY_RE = /(.+)(\[(\d+)?\])$/; // TODO: is this correct?

function EPad<T>(p: P.CoderType<T>) {
  return P.padLeft(32, p, P.ZeroPad);
}
const PTR = EPad(P.U32BE);
const U256BE_LEN = PTR;

// Main difference between regular array: length stored outside and offsets calculated without length
function ethArray<T>(inner: P.CoderType<T>): P.CoderType<T[]> {
  return P.wrap({
    size: undefined,
    encodeStream: (w: P.Writer, value: T[]) => {
      U256BE_LEN.encodeStream(w, value.length);
      w.bytes(P.array(value.length, inner).encode(value));
    },
    decodeStream: (r: P.Reader): T[] =>
      P.array(U256BE_LEN.decodeStream(r), inner).decodeStream(r.offsetReader(r.pos)),
  });
}

// Because u32 in eth is not real u32, just U256BE with limits...
const ethInt = (bits: number, signed = false) => {
  if (!Number.isSafeInteger(bits) || bits <= 0 || bits % 8 !== 0 || bits > 256)
    throw new Error('ethInt: invalid numeric type');
  const _bits = BigInt(bits);
  const inner = P.bigint(32, false, signed);
  return P.validate(
    P.wrap({
      size: inner.size,
      encodeStream: (w: P.Writer, value: bigint) => inner.encodeStream(w, value),
      decodeStream: (r: P.Reader): bigint => inner.decodeStream(r),
    }),
    (value) => {
      // TODO: validate useful for narrowing types, need to add support in types?
      if (typeof value === 'number') value = BigInt(value);
      P.utils.checkBounds(value, _bits, !!signed);
      return value;
    }
  );
};

// Ugly hack, because tuple of pointers considered "dynamic" without any reason.
function isDyn<T>(args: P.CoderType<T>[] | Record<string, P.CoderType<T>>) {
  let res = false;
  if (Array.isArray(args)) {
    for (let arg of args) if (arg.size === undefined) res = true;
  } else {
    for (let arg in args) if (args[arg].size === undefined) res = true;
  }
  return res;
}

// NOTE: we need as const if we want to access string as values inside types :(
export function mapComponent<T extends BaseComponent>(c: T): P.CoderType<MapType<Writable<T>>> {
  // Arrays (should be first one, since recursive)
  let m;
  if ((m = ARRAY_RE.exec(c.type))) {
    const inner = mapComponent({ ...c, type: m[1] });
    if (inner.size === 0)
      throw new Error('mapComponent: arrays of zero-size elements disabled (possible DoS attack)');
    // Static array
    if (m[3] !== undefined) {
      const m3 = Number.parseInt(m[3]);
      if (!Number.isSafeInteger(m3)) throw new Error(`mapComponent: wrong array size=${m[3]}`);
      let out = P.array(m3, inner);
      // Static array of dynamic values should be behind pointer too, again without reason.
      if (inner.size === undefined) out = P.pointer(PTR, out);
      return out as any;
    } else {
      // Dynamic array
      return P.pointer(PTR, ethArray(inner)) as any;
    }
  }
  if (c.type === 'tuple') {
    const components: (Component<string> & { name?: string })[] = (c as any).components;
    let hasNames = true;
    const args: P.CoderType<any>[] = [];
    for (let comp of components) {
      if (!comp.name) hasNames = false;
      args.push(mapComponent(comp));
    }
    let out: any;
    // If there is names for all fields -- return struct, otherwise tuple
    if (hasNames) {
      const struct: Record<string, P.CoderType<unknown>> = {};
      for (const arg of components) {
        if (struct[arg.name!]) throw new Error(`mapType: same field name=${arg.name}`);
        struct[arg.name!] = mapComponent(arg);
      }
      out = P.struct(struct);
    } else out = P.tuple(args);
    // If tuple has dynamic elements it becomes dynamic too, without reason.
    if (isDyn(args)) out = P.pointer(PTR, out);
    return out;
  }
  if (c.type === 'string')
    return P.pointer(PTR, P.padRight(32, P.string(U256BE_LEN), P.ZeroPad)) as any;
  if (c.type === 'bytes')
    return P.pointer(PTR, P.padRight(32, P.bytes(U256BE_LEN), P.ZeroPad)) as any;
  if (c.type === 'address') return EPad(P.hex(20, { isLE: false, with0x: true })) as any;
  if (c.type === 'bool') return EPad(P.bool) as any;
  if ((m = /^(u?)int([0-9]+)?$/.exec(c.type)))
    return ethInt(m[2] ? +m[2] : 256, m[1] !== 'u') as any;
  if ((m = /^bytes([0-9]{1,2})$/.exec(c.type))) {
    const parsed = +m[1];
    if (!parsed || parsed > 32) throw new Error('wrong bytes<N> type');
    return P.padRight(32, P.bytes(parsed), P.ZeroPad) as any;
  }
  throw new Error(`mapComponent: unknown component=${c}`);
}

// Because args and output are not tuple
// TODO: try merge with mapComponent
export function mapArgs<T extends ArrLike<Component<string>>>(
  args: T
): P.CoderType<ArgsType<Writable<T>>> {
  // More ergonomic input/output
  if (args.length === 1) return mapComponent(args[0] as any) as any;
  let hasNames = true;
  for (const arg of args) if (!arg.name) hasNames = false;
  if (hasNames) {
    const out: Record<string, P.CoderType<unknown>> = {};
    for (const arg of args) {
      const name = (arg as any).name;
      if (out[name]) throw new Error(`mapArgs: same field name=${name}`);
      out[name] = mapComponent(arg as any) as any;
    }
    return P.struct(out) as any;
  } else return P.tuple(args.map(mapComponent)) as any;
}
