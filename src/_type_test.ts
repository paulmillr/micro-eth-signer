import * as P from 'micro-packed';
import * as abi from './abi/decoder.js';
// Should not be included in npm package, just for test of typescript compilation
const assertType = <T>(_value: T) => {};
const BytesVal = new Uint8Array();
const BigIntVal = 0n;
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
  abi.createContract([
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
    encodeInput: (v: [bigint, string]) => Bytes;
    decodeOutput: (b: Bytes) => [Bytes, string];
    call: (v: [bigint, string]) => Promise<[Bytes, string]>;
    estimateGas: (v: [bigint, string]) => Promise<bigint>;
  };
}>(
  abi.createContract(
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
  abi.createContract([
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
}>(abi.createContract(PAIR_CONTRACT));

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
}>(abi.events(TRANSFER_EVENT));
