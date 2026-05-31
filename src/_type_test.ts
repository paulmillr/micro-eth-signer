import * as P from 'micro-packed';
import * as abic from './advanced/abi-decoder.ts';
import * as abi from './advanced/abi-mapper.ts';
import * as ssz from './advanced/ssz.ts';
import * as typed from './core/typed-data.ts';
// Should not be included in npm package, just for test of typescript compilation
const assertType = <T>(_value: T) => {};
const BytesVal = Uint8Array.of();
const BigIntVal = BigInt(0);
const _1n = /* @__PURE__ */ BigInt(1);
const _100n = /* @__PURE__ */ BigInt(100);
const StringVal = 'string';
StringVal;
export type Bytes = Uint8Array;

// as const returns readonly stuff, remove readonly property
type Writable<T> = T extends {}
  ? {
      -readonly [P in keyof T]: Writable<T[P]>;
    }
  : T;
type A = Writable<Uint8Array>;
const _a: A = Uint8Array.from([]);
_a;
// IsEmptyArray
const isEmpty = <T>(a: T): abi.IsEmptyArray<T> => a as any;
assertType<true>(isEmpty([] as const));
assertType<false>(isEmpty([1] as const));
assertType<false>(isEmpty(['a', 2] as const));
assertType<false>(isEmpty(['a']));
assertType<true>(isEmpty([] as unknown as []));
assertType<false>(isEmpty([] as unknown as [number]));
assertType<false>(isEmpty([] as unknown as [string, number]));
assertType<false>(isEmpty([] as unknown as Array<string>));
assertType<false>(isEmpty([] as never[]));
assertType<false>(isEmpty([] as any[]));
assertType<true>(isEmpty([] as unknown as undefined));
assertType<true>(isEmpty(undefined));
const t = [
  {
    type: 'constructor',
    inputs: [{ name: 'a', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
];
assertType<false>(isEmpty(t));

// Tests
assertType<P.CoderType<string>>(abi.mapComponent({ type: 'string' } as const));
assertType<P.CoderType<string[]>>(abi.mapComponent({ type: 'string[]' } as const));

assertType<P.CoderType<Uint8Array>>(abi.mapComponent({ type: 'bytes' } as const));
assertType<P.CoderType<Uint8Array[]>>(abi.mapComponent({ type: 'bytes[]' } as const));

assertType<P.CoderType<string>>(abi.mapComponent({ type: 'address' } as const));
assertType<P.CoderType<string[]>>(abi.mapComponent({ type: 'address[]' } as const));

assertType<P.CoderType<boolean>>(abi.mapComponent({ type: 'bool' } as const));
assertType<P.CoderType<boolean[]>>(abi.mapComponent({ type: 'bool[]' } as const));

assertType<P.CoderType<bigint>>(abi.mapComponent({ type: 'uint16' } as const));
assertType<P.CoderType<bigint[]>>(abi.mapComponent({ type: 'uint16[]' } as const));

assertType<P.CoderType<bigint>>(abi.mapComponent({ type: 'int' } as const));
assertType<P.CoderType<bigint[]>>(abi.mapComponent({ type: 'int[]' } as const));

assertType<P.CoderType<bigint>>(abi.mapComponent({ type: 'int24' } as const));
assertType<P.CoderType<bigint[]>>(abi.mapComponent({ type: 'int24[]' } as const));

assertType<P.CoderType<Uint8Array>>(abi.mapComponent({ type: 'bytes1' } as const));
assertType<P.CoderType<Uint8Array[]>>(abi.mapComponent({ type: 'bytes1[]' } as const));

assertType<P.CoderType<Uint8Array>>(abi.mapComponent({ type: 'bytes15' } as const));
assertType<P.CoderType<Uint8Array[]>>(abi.mapComponent({ type: 'bytes15[]' } as const));

// Tuples
assertType<P.CoderType<{ lol: bigint; wut: string }>>(
  abi.mapComponent({
    type: 'tuple',
    components: [
      { type: 'uint16', name: 'lol' },
      { type: 'string', name: 'wut' },
    ],
  } as const)
);

assertType<P.CoderType<[bigint, string]>>(
  abi.mapComponent({
    type: 'tuple',
    components: [{ type: 'uint16', name: 'lol' }, { type: 'string' }],
  } as const)
);
//
assertType<P.CoderType<unknown>>(abi.mapComponent({ type: 'tuple' }));
assertType<P.CoderType<unknown>>(abi.mapComponent({ type: 'int25' }));
assertType<P.CoderType<unknown>>(abi.mapComponent({ type: 'bytes0' }));

// Args
// If single arg -- use as is
assertType<abi.ArgsType<[{ type: 'bytes' }]>>(BytesVal);
// no names -> tuple
assertType<abi.ArgsType<[{ type: 'bytes' }, { type: 'uint' }]>>([BytesVal, BigIntVal]);
// has names -> struct
assertType<abi.ArgsType<[{ type: 'bytes'; name: 'lol' }, { type: 'uint'; name: 'wut' }]>>({
  lol: BytesVal,
  wut: BigIntVal,
});
// WHY?!

assertType<P.CoderType<string>>(abi.mapArgs([{ type: 'string' }] as const));
assertType<P.CoderType<Bytes>>(abi.mapArgs([{ type: 'bytes1' }] as const));
assertType<P.CoderType<[string, bigint]>>(
  abi.mapArgs([{ type: 'string' }, { type: 'uint' }] as const)
);
assertType<P.CoderType<{ lol: string; wut: bigint }>>(
  abi.mapArgs([
    { type: 'string', name: 'lol' },
    { type: 'uint', name: 'wut' },
  ] as const)
);
// Without const
assertType<P.CoderType<Record<string, unknown>>>(
  abi.mapArgs([
    { type: 'string', name: 'lol' },
    { type: 'uint', name: 'wut' },
  ])
);
assertType<P.CoderType<unknown[]>>(abi.mapArgs([{ type: 'string' }, { type: 'uint' }]));
// unfortunately, typescript cannot detect single value arr on non-const data
assertType<P.CoderType<unknown[]>>(abi.mapArgs([{ type: 'bytes1' }]));

assertType<{
  lol: {
    encodeInput: (v: [bigint, string]) => Bytes;
    decodeOutput: (b: Bytes) => [Bytes, string];
  };
}>(
  abic.createContract([
    {
      name: 'lol',
      type: 'function',
      inputs: [{ type: 'uint' }, { type: 'string' }],
      outputs: [{ type: 'bytes' }, { type: 'address' }],
    },
  ] as const)
);

assertType<{
  lol: {
    encodeInput: (v: undefined) => Bytes;
    decodeOutput: (b: Bytes) => [Bytes, string];
  };
}>(
  abic.createContract([
    {
      name: 'lol',
      type: 'function',
      outputs: [{ type: 'bytes' }, { type: 'address' }],
    },
  ] as const)
);

assertType<{
  lol: {
    encodeInput: (v: undefined) => Bytes;
    decodeOutput: (b: Bytes) => [Bytes, string];
  };
}>(
  abic.createContract([
    {
      name: 'lol',
      type: 'function',
      inputs: [] as const,
      outputs: [{ type: 'bytes' }, { type: 'address' }],
    },
  ] as const)
);

assertType<{
  lol: {
    encodeInput: (v: [bigint, string]) => Bytes;
    decodeOutput: (b: Bytes) => [Bytes, string];
    call: (v: [bigint, string]) => Promise<[Bytes, string]>;
    estimateGas: (v: [bigint, string]) => Promise<bigint>;
  };
}>(
  abic.createContract(
    [
      {
        name: 'lol',
        type: 'function',
        inputs: [{ type: 'uint' }, { type: 'string' }],
        outputs: [{ type: 'bytes' }, { type: 'address' }],
      },
    ] as const,
    1 as any
  )
);
// Without const there is not much can be derived from abi
assertType<{}>(
  abic.createContract([
    {
      name: 'lol',
      type: 'function',
      inputs: [{ type: 'uint' }, { type: 'string' }],
      outputs: [{ type: 'bytes' }, { type: 'address' }],
    },
  ])
);

const PAIR_CONTRACT = [
  {
    type: 'function',
    name: 'getReserves',
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
  },
] as const;

assertType<{
  getReserves: {
    encodeInput: () => Bytes;
    decodeOutput: (b: Bytes) => { reserve0: bigint; reserve1: bigint; blockTimestampLast: bigint };
  };
}>(abic.createContract(PAIR_CONTRACT));

const TRANSFER_EVENT = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
    name: 'Transfer',
    type: 'event',
  },
] as const;

assertType<{
  Transfer: {
    decode: (topics: string[], data: string) => { from: string; to: string; value: bigint };
    topics: (values: {
      from: string | null;
      to: string | null;
      value: bigint | null;
    }) => (string | null)[];
  };
}>(abic.events(TRANSFER_EVENT));

const SINGLE_NAMED_EVENT = [
  {
    anonymous: false,
    inputs: [{ indexed: true, name: 'value', type: 'uint256' }],
    name: 'SingleNamed',
    type: 'event',
  },
] as const;

assertType<(values: { value: bigint | null }) => (string | null)[]>(
  abic.events(SINGLE_NAMED_EVENT).SingleNamed.topics
);

const SINGLE_UNNAMED_EVENT = [
  {
    anonymous: false,
    inputs: [{ indexed: true, type: 'uint256' }],
    name: 'SingleUnnamed',
    type: 'event',
  },
] as const;

assertType<(values: [bigint | null]) => (string | null)[]>(
  abic.events(SINGLE_UNNAMED_EVENT).SingleUnnamed.topics
);

const SINGLE_NAMED_TUPLE_EVENT = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        name: 'value',
        type: 'tuple',
        components: [{ type: 'uint256' }, { type: 'address' }],
      },
    ],
    name: 'SingleNamedTuple',
    type: 'event',
  },
] as const;

assertType<(values: { value: [bigint, string] | null }) => (string | null)[]>(
  abic.events(SINGLE_NAMED_TUPLE_EVENT).SingleNamedTuple.topics
);

// Typed data
const types = {
  Person: [
    { name: 'name', type: 'string' },
    { name: 'wallet', type: 'address' },
  ] as const,
  Mail: [
    { name: 'from', type: 'Person' },
    { name: 'to', type: 'Person' },
    { name: 'contents', type: 'string' },
  ] as const,
  Group: [
    { name: 'members', type: 'Person[]' },
    { name: 'owner', type: 'Person' },
  ] as const,
  Complex0: [
    { name: 'data', type: 'string[][]' }, // Complex array type
    { name: 'info', type: 'Mail' },
  ] as const,
  Complex1: [
    { name: 'data', type: 'string[][][]' }, // Complex array type
    { name: 'info', type: 'Mail' },
  ] as const,
  Complex: [
    { name: 'data', type: 'string[][3][]' }, // Complex array type
    { name: 'info', type: 'Mail' },
  ] as const,
} as const;

assertType<{
  from?: { name: string; wallet: string };
  to?: { name: string; wallet: string };
  contents: string;
}>(1 as any as typed.GetType<typeof types, 'Mail'>);

assertType<{
  name: string;
  wallet: string;
}>(1 as any as typed.GetType<typeof types, 'Person'>);

assertType<{
  members: ({ name: string; wallet: string } | undefined)[];
  owner?: { name: string; wallet: string };
}>(1 as any as typed.GetType<typeof types, 'Group'>);

assertType<{
  data: string[][];
  info?: {
    from?: { name: string; wallet: string };
    to?: { name: string; wallet: string };
    contents: string;
  };
}>(1 as any as typed.GetType<typeof types, 'Complex0'>);

assertType<{
  data: string[][][];
  info?: {
    from?: { name: string; wallet: string };
    to?: { name: string; wallet: string };
    contents: string;
  };
}>(1 as any as typed.GetType<typeof types, 'Complex1'>);

assertType<{
  data: string[][][];
  info?: {
    from?: { name: string; wallet: string };
    to?: { name: string; wallet: string };
    contents: string;
  };
}>(1 as any as typed.GetType<typeof types, 'Complex'>);

const recursiveTypes = {
  Node: [
    { name: 'value', type: 'string' },
    { name: 'children', type: 'Node[]' },
  ] as const,
} as const;

type NodeType = typed.GetType<typeof recursiveTypes, 'Node'>;

assertType<{
  value: string;
  children: (NodeType | undefined)[];
}>(1 as any as typed.GetType<typeof recursiveTypes, 'Node'>);

assertType<typed.EIP712Domain>({});
assertType<typed.EIP712Domain>({ name: 'Ether Mail' });
assertType<typed.EIP712Domain>({
  chainId: _1n,
  salt: new Uint8Array(32),
});

// SSZ exported registries must stay precise; broad `SSZCoder<any>` annotations make these
// invalid values type-check and hide consensus-shape mistakes from callers.
ssz.ETH2_TYPES.Checkpoint.encode({ epoch: _1n, root: new Uint8Array(32) });
// @ts-expect-error checkpoint values must contain epoch/root, not arbitrary object data.
ssz.ETH2_TYPES.Checkpoint.encode({ nope: true });
// @ts-expect-error Capella blocks must include the full fork-specific block shape.
ssz.CapellaBeaconBlock.encode({ slot: _1n });

const e = typed.encoder(types, {});
e.encodeData('Person', { name: 'test', wallet: 'x' });
e.sign('Person', { name: 'test', wallet: 'x' }, '');

// @ts-expect-error wallet must match the EIP-712 `address` field type.
e.encodeData('Person', { name: 'test', wallet: _1n });
// @ts-expect-error message is missing the required `wallet` field.
e.sign('Person', { name: 'test' }, '');
// @ts-expect-error message contains an unknown `s` field.
e.sign('Person', { name: 'test', wallet: '', s: 3 }, '');

// constructor

abic.deployContract(
  [{ type: 'constructor', inputs: [], stateMutability: 'nonpayable' }] as const,
  '0x00'
);
const emptyConstructor = [{ type: 'constructor', stateMutability: 'nonpayable' }] as const;
abic.deployContract(emptyConstructor, '0x00');
// @ts-expect-error exact constructorless ABI must not require a third argument.
abic.deployContract(emptyConstructor, '0x00', undefined);

// If we cannot infer type, it becomes `unknown`; user must provide an argument.
abic.deployContract([{ type: 'constructor', stateMutability: 'nonpayable' }], '0x00', undefined);

abic.deployContract(
  [
    {
      type: 'constructor',
      inputs: [{ name: 'a', type: 'uint256' }],
      stateMutability: 'nonpayable',
    },
  ] as const,
  '0x00',
  _100n
);

abic.deployContract(
  [
    {
      type: 'constructor',
      inputs: [{ name: 'a', type: 'uint256' }],
      stateMutability: 'nonpayable',
    },
  ],
  '0x00',
  _100n
);
