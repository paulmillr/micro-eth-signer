import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, it } from '@paulmillr/jsbt/test.js';
import * as P from 'micro-packed';
import { deepStrictEqual, throws } from 'node:assert';
import { addHints } from '../src/abi/common.ts';
import * as abi from '../src/abi/decoder.ts';
import {
  CLEARSIG_REPO,
  CONTRACTS,
  DEFAULT_TOKENS,
  Decoder,
  MULTICALL3_ABI,
  TOKENS,
  TOKENS_BY_SYMBOL,
  decodeData,
  decodeError,
  decodeEvent,
  decodeTx,
  deployContract,
  parseAbi,
  parseAbiItem,
  tokenFromSymbol,
  tokensBySymbol,
} from '../src/abi/index.ts';
import { mapArgs, mapComponent } from '../src/abi/mapper.ts';
import { Transaction } from '../src/index.ts';
import { ethHex, strip0x } from '../src/utils.ts';

import ERC20, { hints as ERC20_HINTS } from '../src/abi/erc20.ts';
import { default as KYBER_NETWORK_PROXY, KYBER_NETWORK_PROXY_CONTRACT } from '../src/abi/kyber.ts';
import { default as UNISWAP_V2_ROUTER, UNISWAP_V2_ROUTER_CONTRACT } from '../src/abi/uniswap-v2.ts';
import { default as UNISWAP_V3_ROUTER, UNISWAP_V3_ROUTER_CONTRACT } from '../src/abi/uniswap-v3.ts';
import { WETH_CONTRACT } from '../src/abi/weth.ts';

import {
  CUSTOM_TOKENS,
  DECODER_KYBER,
  DECODER_TRANSFER,
  DECODER_UNISWAP_V2,
  DECODER_UNISWAP_V3,
  DECODER_UNISWAP_V3_MULTICALL,
} from './fixtures/abi/clearsig.js';
import {
  KYBER_HINTS,
  UNISWAP_V2_HINTS,
  UNISWAP_V3_HINTS,
  WETH_LEGACY,
} from './fixtures/abi/clearsig-hints.js';
import {
  CLEARSIG_CHAIN,
  CLEARSIG_FACTORY,
  CLEARSIG_FROM,
  CLEARSIG_GENERIC,
  CREATE_TX,
  DECODE_ERROR,
  DECODE_EVENT_BAT,
  DECODE_EVENT_ERC1155,
  DECODE_EVENT_ERC20,
  DECODE_EVENT_WETH,
  DEPLOY_BYTECODE,
  DEPLOY_WITH_ARG,
  MULTICALL3,
  PARSE_ABI_SELECTORS,
  RECEIPT,
  UNISWAP_SWAP,
  USDT_TRANSFER,
} from './fixtures/abi/decoder-api.js';
import { ABI_EVENTS } from './fixtures/abi/events.js';
import { EV_SIGHASH, FN_SIGHASH, SPEC_CONTRACT, TUPLE_ABI } from './fixtures/abi/sighash.js';
import { TYPE_MAPPING } from './fixtures/abi/type-mapping.js';

const hex = { encode: bytesToHex, decode: hexToBytes };
const clearSigFor = (to: string, data: Uint8Array, opt: Record<string, unknown>) => {
  const decoder = new Decoder().addClearSig(CLEARSIG_REPO);
  const res = decodeData(to, hex.encode(data), opt.amount as bigint | undefined, {
    decoder,
    customContracts: opt.contracts as Record<string, any> | undefined,
    chainId: 1n,
    allowUnreadBytes: opt.allowUnreadBytes as boolean | undefined,
  });
  if (!res || Array.isArray(res)) return;
  return res.clearSig;
};

it('fnSigHash', () => {
  deepStrictEqual(abi.fnSigHash(TUPLE_ABI[0]), '6f2be728');
  for (let [exp, fn] of FN_SIGHASH) deepStrictEqual(abi.fnSigHash(fn), exp);
});
it('canonicalizes bare integer aliases in selectors and event topics', () => {
  const transferAlias = {
    type: 'function',
    name: 'transfer',
    inputs: [{ type: 'address' }, { type: 'uint' }],
  } as const;
  deepStrictEqual(abi.fnSigHash(transferAlias), 'a9059cbb');

  const eventAlias = {
    type: 'event',
    name: 'Value',
    inputs: [{ type: 'int', indexed: true }],
  } as const;
  const eventCanonical = {
    type: 'event',
    name: 'Value',
    inputs: [{ type: 'int256', indexed: true }],
  } as const;
  deepStrictEqual(abi.evSigHash(eventAlias), abi.evSigHash(eventCanonical));

  const nestedAlias = {
    type: 'function',
    name: 'nested',
    inputs: [
      {
        type: 'tuple[]',
        components: [{ type: 'uint[]' }, { type: 'int[2]' }],
      },
    ],
  } as const;
  const nestedCanonical = {
    type: 'function',
    name: 'nested',
    inputs: [
      {
        type: 'tuple[]',
        components: [{ type: 'uint256[]' }, { type: 'int256[2]' }],
      },
    ],
  } as const;
  deepStrictEqual(abi.fnSigHash(nestedAlias), abi.fnSigHash(nestedCanonical));
});
it('evSigHash', () => {
  for (let [exp, fn] of EV_SIGHASH) deepStrictEqual(abi.evSigHash(fn), exp);
});

// Ugly and probably broken, but ok for tests.
function unwrapTestType(s) {
  let stack = [];
  let cur = '';
  const top = () => stack[stack.length - 1];
  for (const i of s) {
    if (i === '(') {
      const cur = { type: 'tuple', components: [] };
      if (top()) top().components.push(cur);
      stack.push(cur);
      continue;
    }
    if (i === ' ') continue;
    if (i === ',' || i === ')') {
      if (cur) top().components.push({ type: cur });
      cur = '';
      if (i === ')') {
        if (stack.length === 1) return stack[0];
        stack.pop();
      }
      continue;
    }
    cur += i;
  }
  // can be only if there is no types
  if (cur) return { type: cur };
  return stack[0];
}

it('unwrapTestType', () => {
  deepStrictEqual(unwrapTestType('string'), { type: 'string' });
  deepStrictEqual(unwrapTestType('((uint8,uint8), uint8)'), {
    type: 'tuple',
    components: [
      { type: 'tuple', components: [{ type: 'uint8' }, { type: 'uint8' }] },
      { type: 'uint8' },
    ],
  });
  deepStrictEqual(
    unwrapTestType('(bool,(bytes32,int256,(bytes24,bytes8)),(bool,bool,bool),string)'),
    {
      type: 'tuple',
      components: [
        { type: 'bool' },
        {
          type: 'tuple',
          components: [
            { type: 'bytes32' },
            { type: 'int256' },
            { type: 'tuple', components: [{ type: 'bytes24' }, { type: 'bytes8' }] },
          ],
        },
        { type: 'tuple', components: [{ type: 'bool' }, { type: 'bool' }, { type: 'bool' }] },
        { type: 'string' },
      ],
    }
  );
});

describe('Type mapping', () => {
  for (const { type, value, exp, throws: mustThrow } of TYPE_MAPPING) {
    const p = mapComponent(unwrapTestType(type));
    if (mustThrow) {
      if (value !== undefined) throws(() => hex.encode(p.encode(value)));
      if (exp !== undefined) throws(() => p.decode(hex.decode(strip0x(exp))));
      continue;
    }
    it(`mapType(${type}, ${value}, ${exp})`, () => {
      deepStrictEqual(hex.encode(p.encode(value)), exp);
      deepStrictEqual(p.decode(hex.decode(strip0x(exp))), value);
    });
  }
});

it('ABI named tuple fields can shadow object prototype names', () => {
  const component = {
    type: 'tuple',
    components: [
      { name: 'toString', type: 'uint256' },
      { name: 'hasOwnProperty', type: 'bool' },
    ],
  } as const;
  const coder = mapComponent(component);
  const data =
    '0000000000000000000000000000000000000000000000000000000000000007' +
    '0000000000000000000000000000000000000000000000000000000000000001';
  deepStrictEqual(hex.encode(coder.encode({ toString: 7n, hasOwnProperty: true })), data);
  deepStrictEqual(coder.decode(hex.decode(data)), { toString: 7n, hasOwnProperty: true });
  throws(() =>
    mapComponent({
      type: 'tuple',
      components: [
        { name: 'toString', type: 'uint256' },
        { name: 'toString', type: 'uint256' },
      ],
    })
  );
});
it('bounds raw ABI component depth without exponential named-tuple mapping', () => {
  const nested = (depth: number) => {
    let component: any = { name: 'leaf', type: 'uint256' };
    for (let i = 0; i < depth; i++)
      component = { name: `level${i}`, type: 'tuple', components: [component] };
    return component;
  };
  deepStrictEqual(mapComponent(nested(128)).size, 32);
  throws(() => mapComponent(nested(129)), /mapComponent: schema too deep, limit is 128/);
});
it('mapArgs', () => {
  function t(contract, fn, args, exp) {
    let m = mapArgs(contract.find((i) => i.name == fn).inputs, true);
    deepStrictEqual(hex.encode(m.encode(args)), exp);
  }
  // FROM SPEC: https://docs.soliditylang.org/en/develop/abi-spec.html#argument-encoding
  // If we wanted to call sam with the arguments "dave", true and [1,2,3], we would pass 292 bytes total, broken down into:
  t(
    SPEC_CONTRACT,
    'sam',
    [utf8ToBytes('dave'), true, [1, 2, 3]],
    '0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000464617665000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003'
  );
  // A call to a function with the signature f(uint,uint32[],bytes10,bytes) with values (0x123, [0x456, 0x789], "1234567890", "Hello, world!")
  t(
    SPEC_CONTRACT,
    'd',
    [0x123, [0x456, 0x789], utf8ToBytes('1234567890'), 'Hello, world!'],
    '0000000000000000000000000000000000000000000000000000000000000123' +
      '0000000000000000000000000000000000000000000000000000000000000080' +
      '3132333435363738393000000000000000000000000000000000000000000000' +
      '00000000000000000000000000000000000000000000000000000000000000e0' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '0000000000000000000000000000000000000000000000000000000000000456' +
      '0000000000000000000000000000000000000000000000000000000000000789' +
      '000000000000000000000000000000000000000000000000000000000000000d' +
      '48656c6c6f2c20776f726c642100000000000000000000000000000000000000'
  );
  // Let us apply the same principle to encode the data for a function with a signature g(uint[][],string[]) with values ([[1, 2], [3]], ["one", "two", "three"])
  t(
    SPEC_CONTRACT,
    'g',
    [
      [[1n, 2n], [3n]],
      ['one', 'two', 'three'],
    ],
    '0000000000000000000000000000000000000000000000000000000000000040' + // - offset of [[1, 2], [3]]
      '0000000000000000000000000000000000000000000000000000000000000140' + // - offset of ["one", "two", "three"]
      '0000000000000000000000000000000000000000000000000000000000000002' + // - count for [[1, 2], [3]]
      '0000000000000000000000000000000000000000000000000000000000000040' + // - offset of [1, 2]
      '00000000000000000000000000000000000000000000000000000000000000a0' + // - offset of [3]
      '0000000000000000000000000000000000000000000000000000000000000002' + // - count for [1, 2]
      '0000000000000000000000000000000000000000000000000000000000000001' + // - encoding of 1
      '0000000000000000000000000000000000000000000000000000000000000002' + // - encoding of 2
      '0000000000000000000000000000000000000000000000000000000000000001' + // - count for [3]
      '0000000000000000000000000000000000000000000000000000000000000003' + // - encoding of 3
      '0000000000000000000000000000000000000000000000000000000000000003' + // - count for ["one", "two", "three"]
      '0000000000000000000000000000000000000000000000000000000000000060' + // - offset for "one"
      '00000000000000000000000000000000000000000000000000000000000000a0' + // - offset for "two"
      '00000000000000000000000000000000000000000000000000000000000000e0' + // - offset for "three"
      '0000000000000000000000000000000000000000000000000000000000000003' + // - count for "one"
      '6f6e650000000000000000000000000000000000000000000000000000000000' + // - encoding of "one"
      '0000000000000000000000000000000000000000000000000000000000000003' + // - count for "two"
      '74776f0000000000000000000000000000000000000000000000000000000000' + // - encoding of "two"
      '0000000000000000000000000000000000000000000000000000000000000005' + // - count for "three"
      '7468726565000000000000000000000000000000000000000000000000000000' // - encoding of "three"
  );
  const shadow = mapArgs([
    { name: 'toString', type: 'uint256' },
    { name: 'ok', type: 'bool' },
  ] as const);
  const data =
    '0000000000000000000000000000000000000000000000000000000000000001' +
    '0000000000000000000000000000000000000000000000000000000000000001';
  deepStrictEqual(hex.encode(shadow.encode({ toString: 1n, ok: true })), data);
  deepStrictEqual(shadow.decode(hex.decode(data)), { toString: 1n, ok: true });
  throws(() =>
    mapArgs([
      { name: 'toString', type: 'uint256' },
      { name: 'toString', type: 'uint256' },
    ] as const)
  );
});
it('Decoder', async () => {
  const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const d = new abi.Decoder();
  d.add(USDT, ERC20);
  d.add(UNISWAP_V2_ROUTER_CONTRACT, UNISWAP_V2_ROUTER);
  d.add(KYBER_NETWORK_PROXY_CONTRACT, KYBER_NETWORK_PROXY);
  d.add(UNISWAP_V3_ROUTER_CONTRACT, UNISWAP_V3_ROUTER);
  const contracts = Object.assign({}, CONTRACTS, CUSTOM_TOKENS);
  const optFor = (contract: string) => ({ contract, contracts, contractInfo: CONTRACTS[contract] });

  const transfer = hex.decode(DECODER_TRANSFER.data);
  // Strict-match
  deepStrictEqual(d.decode(USDT, transfer), DECODER_TRANSFER.value);
  // Sig-hash match: we don't know anything about contract, but we know sighash
  deepStrictEqual(d.decode(WETH, transfer), [DECODER_TRANSFER.value]);
  // Hint
  deepStrictEqual(await clearSigFor(USDT, transfer, {}), DECODER_TRANSFER.clearSig);

  const check = async (contract: string, vectors: any[]) => {
    const opt = optFor(contract);
    for (const v of vectors) {
      const data = hex.decode(v.data);
      const vectorOpt = { ...opt, amount: v.amount };
      d.decode(contract, data, vectorOpt);
      deepStrictEqual(await clearSigFor(contract, data, vectorOpt), v.clearSig, v.data);
    }
  };
  await check(UNISWAP_V2_ROUTER_CONTRACT, DECODER_UNISWAP_V2);
  await check(KYBER_NETWORK_PROXY_CONTRACT, DECODER_KYBER);

  // Multi-call signature unwrap
  const UNISWAP3 = UNISWAP_V3_ROUTER_CONTRACT;
  const uni3Opt = optFor(UNISWAP3);
  const mtx0 = hex.decode(DECODER_UNISWAP_V3_MULTICALL.data);
  deepStrictEqual(
    d.decode(
      UNISWAP3,
      mtx0,
      Object.assign(uni3Opt, { amount: DECODER_UNISWAP_V3_MULTICALL.amount })
    ),
    DECODER_UNISWAP_V3_MULTICALL.decoded
  );
  deepStrictEqual(
    await clearSigFor(UNISWAP3, mtx0, uni3Opt),
    DECODER_UNISWAP_V3_MULTICALL.clearSig
  );
  const multicall = (UNISWAP_V3_ROUTER as any).find((i: any) => i.name === 'multicall');
  const refundETH = (UNISWAP_V3_ROUTER as any).find((i: any) => i.name === 'refundETH');
  const unknownAbi = hex.decode('12345678');
  const multicallTx = (data: Uint8Array[]) =>
    hex.decode(abi.fnSigHash(multicall) + hex.encode(mapArgs(multicall.inputs).encode(data)));
  deepStrictEqual(d.decode(UNISWAP3, multicallTx([unknownAbi]), uni3Opt), {
    name: 'multicall(unknownAbi(0x12345678))',
    signature: 'multicall(unknownAbi(0x12345678))',
    value: [unknownAbi],
  });
  deepStrictEqual(
    d.decode(UNISWAP3, multicallTx([hex.decode(abi.fnSigHash(refundETH)), unknownAbi]), uni3Opt),
    {
      name: 'multicall(refundETH, unknownAbi(0x12345678))',
      signature: 'multicall(refundETH(), unknownAbi(0x12345678))',
      value: [undefined, unknownAbi],
    }
  );
  await check(UNISWAP3, DECODER_UNISWAP_V3);
});
it('Decoder rejects trailing calldata for zero-arg functions', () => {
  const contract = '0x1111111111111111111111111111111111111111';
  const unknown = '0x2222222222222222222222222222222222222222';
  const ping = [{ type: 'function', name: 'ping', inputs: [], outputs: [] }] as const;
  const selector = abi.fnSigHash(ping[0]);
  const call = hex.decode(selector);
  const trailing = hex.decode(`${selector}${'00'.repeat(32)}`);
  const d = new abi.Decoder();
  d.add(contract, ping);
  deepStrictEqual(d.decode(contract, call), {
    name: 'ping',
    signature: 'ping()',
    value: undefined,
  });
  deepStrictEqual(d.decode(unknown, call), [
    {
      name: 'ping',
      signature: 'ping()',
      value: undefined,
    },
  ]);
  throws(() => d.decode(contract, trailing), /Unexpected trailing calldata/);
  deepStrictEqual(d.decode(unknown, trailing), undefined);
});
it('Decoder rejects invalid contract keys without prototype pollution', () => {
  const bare = '11'.repeat(20);
  const ping = [{ type: 'function', name: 'auditFinding4', inputs: [] }] as const;
  const selector = abi.fnSigHash(ping[0]);
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, selector);
  try {
    const d = new abi.Decoder();
    deepStrictEqual(Object.getPrototypeOf(d.contracts), null);
    throws(() => d.add('__proto__', ping), /address must be 40-char hex/);
    deepStrictEqual(Object.hasOwn(Object.prototype, selector), false);
    // Preserve the existing prefix-optional API for otherwise valid addresses.
    d.add(bare, ping);
    deepStrictEqual(d.method(`0x${bare}`, hex.decode(selector)), 'auditFinding4');
  } finally {
    if (previous) Object.defineProperty(Object.prototype, selector, previous);
    else delete (Object.prototype as Record<string, unknown>)[selector];
  }
});
it('addHints only annotates events from own hint-map properties', () => {
  const hint = () => 'hint';
  const a = [
    { type: 'function', name: 'transfer' },
    { type: 'event', name: 'Approval' },
    { type: 'function', name: 'toString' },
    { type: 'constructor', name: 'transfer' },
  ] as const;
  const inherited = Object.create({ transfer: hint, Approval: hint, toString: hint });
  deepStrictEqual(addHints(a, inherited), a);
  deepStrictEqual(addHints(a, { toString: hint, Approval: hint }), [
    { type: 'function', name: 'transfer' },
    { type: 'event', name: 'Approval', hint },
    { type: 'function', name: 'toString' },
    { type: 'constructor', name: 'transfer' },
  ]);
});
it('ERC20 event hints accept zero-decimal token metadata', () => {
  const opt = { contractInfo: { decimals: 0, symbol: 'ZERO' } };
  const owner = '0x1111111111111111111111111111111111111111';
  const spender = '0x2222222222222222222222222222222222222222';
  const from = '0x3333333333333333333333333333333333333333';
  const to = '0x4444444444444444444444444444444444444444';
  deepStrictEqual(
    ERC20_HINTS.Approval({ owner, spender, value: 7n }, opt),
    `Allow ${spender} spending up to 7 ZERO from ${owner}`
  );
  deepStrictEqual(
    ERC20_HINTS.Transfer({ from, to, value: 7n }, opt),
    `Transfer 7 ZERO from ${from} to ${to}`
  );
});
it('WETH clearSig maps legacy field names', async () => {
  const contract = abi.createContract(CONTRACTS[WETH_CONTRACT].abi as any);
  for (const v of WETH_LEGACY)
    deepStrictEqual(
      await clearSigFor(WETH_CONTRACT, contract[v.fn].encodeInput(v.args), v.opt),
      v.clearSig,
      v.fn
    );
});
it('built-in registries deep-freeze metadata and ABIs', () => {
  const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const routerABI = CONTRACTS[UNISWAP_V2_ROUTER_CONTRACT].abi as any;
  const wethABI = CONTRACTS[weth].abi as any;
  deepStrictEqual(
    {
      defaultToken: Object.isFrozen(DEFAULT_TOKENS[usdt]),
      symbolToken: Object.isFrozen(TOKENS_BY_SYMBOL.USDT),
      token: Object.isFrozen(TOKENS[usdt]),
      sharedContract: Object.isFrozen(CONTRACTS[usdt]),
      router: Object.isFrozen(CONTRACTS[UNISWAP_V2_ROUTER_CONTRACT]),
      routerABI: Object.isFrozen(routerABI),
      routerABIItem: Object.isFrozen(routerABI[0]),
      weth: Object.isFrozen(CONTRACTS[weth]),
      wethABI: Object.isFrozen(wethABI),
      wethABIItem: Object.isFrozen(wethABI[0]),
    },
    {
      defaultToken: true,
      symbolToken: true,
      token: true,
      sharedContract: true,
      router: true,
      routerABI: true,
      routerABIItem: true,
      weth: true,
      wethABI: true,
      wethABIItem: true,
    }
  );
  throws(() => ((DEFAULT_TOKENS[usdt] as any).symbol = 'MUT'), TypeError);
  throws(() => ((TOKENS_BY_SYMBOL.USDT as any).symbol = 'MUT'), TypeError);
  throws(() => ((TOKENS[usdt] as any).symbol = 'MUT'), TypeError);
  throws(() => ((CONTRACTS[usdt] as any).symbol = 'MUT'), TypeError);
  throws(() => ((CONTRACTS[UNISWAP_V2_ROUTER_CONTRACT] as any).name = 'MUT'), TypeError);
  throws(() => routerABI.push({}), TypeError);
  throws(() => (routerABI[0].name = 'MUT'), TypeError);
  throws(() => ((CONTRACTS[weth] as any).symbol = 'MUT'), TypeError);
  throws(() => wethABI.push({}), TypeError);
  throws(() => (wethABI[0].name = 'MUT'), TypeError);
  deepStrictEqual(DEFAULT_TOKENS[usdt].symbol, 'USDT');
  deepStrictEqual(TOKENS_BY_SYMBOL.USDT.contract, usdt);
  deepStrictEqual(TOKENS[usdt].symbol, 'USDT');
  deepStrictEqual(CONTRACTS[usdt].symbol, 'USDT');
  deepStrictEqual(CONTRACTS[UNISWAP_V2_ROUTER_CONTRACT].name, 'UNISWAP V2 ROUTER');
  deepStrictEqual(CONTRACTS[weth].symbol, 'WETH');
});
it('tokensBySymbol derives symbol indexes and rejects duplicates', () => {
  const tokenA = '0x00000000000000000000000000000000000000a1';
  const tokenB = '0x00000000000000000000000000000000000000b1';
  const table = {
    [tokenA]: {
      symbol: 'TOKA',
      decimals: 7,
      feed: { contract: '0x00000000000000000000000000000000000000f1', decimals: 3 },
    },
  };
  const bySymbol = tokensBySymbol(table);
  deepStrictEqual(Object.getPrototypeOf(bySymbol), null);
  deepStrictEqual(bySymbol.TOKA, { contract: tokenA, ...table[tokenA] });
  // Indexing may freeze its own result, but must not freeze or retain caller-owned metadata.
  deepStrictEqual(Object.isFrozen(table[tokenA].feed), false);
  deepStrictEqual(bySymbol.TOKA.feed === table[tokenA].feed, false);
  table[tokenA].feed.decimals = 4;
  deepStrictEqual(bySymbol.TOKA.feed?.decimals, 3);
  const poisoned = tokensBySymbol({
    [tokenA]: { symbol: 'POISON', decimals: 18, contract: tokenB } as any,
  });
  deepStrictEqual(poisoned.POISON.contract, tokenA);
  throws(() => ((bySymbol.TOKA as any).symbol = 'MUT'), TypeError);
  throws(
    () =>
      tokensBySymbol({
        [tokenA]: { symbol: 'DUP', decimals: 18 },
        [tokenB]: { symbol: 'DUP', decimals: 18 },
      }),
    /duplicate token symbol: DUP/
  );
});
it('tokenFromSymbol returns undefined and supports custom token tables', () => {
  const token = '0x00000000000000000000000000000000000000c1';
  const table = {
    [token]: { symbol: 'CUSTOM', decimals: 5 },
  };
  deepStrictEqual(tokenFromSymbol('SUSD')?.contract, '0x57ab1ec28d129707052df4df418d58a2d46d5f51');
  deepStrictEqual(tokenFromSymbol('UNKNOWN'), undefined);
  deepStrictEqual(tokenFromSymbol('CUSTOM', table), { contract: token, ...table[token] });
});
it('token symbol indexes ignore inherited token registry entries', () => {
  const key = 'evilToken';
  const prev = Object.getOwnPropertyDescriptor(Object.prototype, key);
  const token = '0x00000000000000000000000000000000000000d1';
  const table = {
    [token]: { symbol: 'REAL', decimals: 18 },
  };
  Object.defineProperty(Object.prototype, key, {
    value: { symbol: 'FAKE', decimals: 18 },
    enumerable: true,
    configurable: true,
  });
  try {
    const bySymbol = tokensBySymbol(table);
    deepStrictEqual(bySymbol.FAKE, undefined);
    deepStrictEqual(tokenFromSymbol('FAKE', table), undefined);
    deepStrictEqual(tokenFromSymbol('REAL', table), { contract: token, ...table[token] });
  } finally {
    if (prev) Object.defineProperty(Object.prototype, key, prev);
    else delete (Object.prototype as Record<string, unknown>)[key];
  }
});
it('Uniswap V2 clearSig preserves zero-value hint regressions', async () => {
  const contract = abi.createContract(UNISWAP_V2_ROUTER);
  for (const v of UNISWAP_V2_HINTS)
    deepStrictEqual(
      await clearSigFor(UNISWAP_V2_ROUTER_CONTRACT, contract[v.fn].encodeInput(v.args), v.opt),
      v.clearSig,
      v.fn
    );
});
it('Uniswap V3 clearSig preserves zero-decimal hint regressions', async () => {
  const contract = abi.createContract(UNISWAP_V3_ROUTER);
  for (const v of UNISWAP_V3_HINTS)
    deepStrictEqual(
      await clearSigFor(UNISWAP_V3_ROUTER_CONTRACT, contract[v.fn].encodeInput(v.args), v.opt),
      v.clearSig,
      v.fn
    );
});
it('Kyber clearSig preserves zero-decimal token metadata', async () => {
  const contract = abi.createContract(KYBER_NETWORK_PROXY);
  for (const v of KYBER_HINTS)
    deepStrictEqual(
      await clearSigFor(KYBER_NETWORK_PROXY_CONTRACT, contract[v.fn].encodeInput(v.args), v.opt),
      v.clearSig,
      v.fn
    );
});
describe('ABI events', () => {
  for (let k in ABI_EVENTS) {
    it(k, () => {
      const t = ABI_EVENTS[k];
      const events = abi.events(JSON.parse(t.abi));
      const ev = events[t.fn || 'testEvent'];
      deepStrictEqual(ev.decode(t.topics, t.data), t.decodeOutput, 'decode');
      deepStrictEqual(ev.topics(t.topicsInput), t.topics, 'topics');
    });
  }
});
it('ABI Events: null values', () => {
  const events = abi.events(JSON.parse(ABI_EVENTS.transfer.abi));
  const ev = events.Transfer;
  deepStrictEqual(
    ev.topics({ from: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', to: null, value: null }),
    [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
      null,
    ]
  );
  deepStrictEqual(
    ev.topics({ to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', from: null, value: null }),
    [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      null,
      '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
    ]
  );
});
it('ABI Events: indexed tuples with unnamed components', () => {
  const event = {
    type: 'event',
    name: 'TupleEvent',
    anonymous: false,
    inputs: [
      {
        indexed: true,
        name: 'value',
        type: 'tuple',
        components: [{ type: 'uint256' }, { type: 'address' }],
      },
    ],
  } as const;
  const addr = '0x1111111111111111111111111111111111111111';
  const encoded = bytesToHex(
    keccak_256(
      concatBytes(
        mapComponent({ type: 'uint256' }).encode(7n),
        mapComponent({ type: 'address' }).encode(addr)
      )
    )
  );
  deepStrictEqual(abi.events([event]).TupleEvent.topics({ value: [7n, addr] }), [
    `0x${abi.evSigHash(event)}`,
    `0x${encoded}`,
  ]);
});
it('ABI Events: indexed dynamic composites use Solidity in-place encoding', () => {
  const stringArray = {
    type: 'event',
    name: 'StringArray',
    inputs: [{ indexed: true, name: 'values', type: 'string[]' }],
  } as const;
  const paddedA = new Uint8Array(32);
  paddedA.set(utf8ToBytes('a'));
  deepStrictEqual(
    abi.events([stringArray]).StringArray.topics({ values: ['a'] })[1],
    '0x294587bf977c4010a60dbad811c63531f90f6ec512975bc6c9a93f8f361cad72'
  );

  const components = [
    { name: 'label', type: 'string' },
    { name: 'amount', type: 'uint256' },
  ] as const;
  const tupleArray = {
    type: 'event',
    name: 'TupleArray',
    inputs: [{ indexed: true, name: 'values', type: 'tuple[]', components }],
  } as const;
  const value = [{ label: 'a', amount: 7n }];
  const expected = bytesToHex(
    keccak_256(concatBytes(paddedA, mapComponent({ type: 'uint256' }).encode(7n)))
  );
  deepStrictEqual(
    abi.events([tupleArray]).TupleArray.topics({ values: value })[1],
    `0x${expected}`
  );
});
it('ABI Events: indexed arrays of tuples', () => {
  const components = [
    { name: 'amount', type: 'uint256' },
    { name: 'account', type: 'address' },
  ] as const;
  const dynamicEvent = {
    type: 'event',
    name: 'TupleArrayEvent',
    anonymous: false,
    inputs: [{ indexed: true, name: 'values', type: 'tuple[]', components }],
  } as const;
  const staticEvent = {
    type: 'event',
    name: 'TupleStaticArrayEvent',
    anonymous: false,
    inputs: [{ indexed: true, name: 'values', type: 'tuple[2]', components }],
  } as const;
  const values = [
    { amount: 7n, account: '0x1111111111111111111111111111111111111111' },
    { amount: 8n, account: '0x2222222222222222222222222222222222222222' },
  ];
  const tuple = mapComponent({ type: 'tuple', components });
  const encoded = bytesToHex(
    keccak_256(concatBytes(tuple.encode(values[0]), tuple.encode(values[1])))
  );
  deepStrictEqual(abi.events([dynamicEvent]).TupleArrayEvent.topics({ values }), [
    `0x${abi.evSigHash(dynamicEvent)}`,
    `0x${encoded}`,
  ]);
  deepStrictEqual(abi.events([staticEvent]).TupleStaticArrayEvent.topics({ values }), [
    `0x${abi.evSigHash(staticEvent)}`,
    `0x${encoded}`,
  ]);
  throws(() =>
    abi.events([staticEvent]).TupleStaticArrayEvent.topics({ values: values.slice(0, 1) })
  );
  throws(() =>
    abi.events([staticEvent]).TupleStaticArrayEvent.topics({ values: [...values, values[0]] })
  );
});
it('ABI Events: Decoder', () => {
  const BAT = '0x0d8775f648430679a709e98d2b0cb6250d2887ef';
  let d = new abi.Decoder();
  d.add(BAT, ERC20);
  const usdtOpt = {
    contract: BAT,
    contracts: Object.assign({}, CONTRACTS),
    contractInfo: CONTRACTS[BAT],
  };
  deepStrictEqual(
    d.decodeEvent(
      BAT,
      [
        '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
        '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
        '0x000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564',
      ],
      '0x00000000000000000000000000000000000000000000003635c9adc5dea00000',
      usdtOpt
    ),
    {
      name: 'Approval',
      signature: 'Approval(address,address,uint256)',
      value: {
        value: 1000000000000000000000n,
        owner: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        spender: '0xe592427a0aece92de3edee1f18e0157c05861564',
      },
      hint: 'Allow 0xe592427a0aece92de3edee1f18e0157c05861564 spending up to 1000 BAT from 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    }
  );
});
it('ABI Events: Decoder keeps overloaded events distinct', () => {
  const contract = '0x1111111111111111111111111111111111111111';
  const overloads = [
    {
      type: 'event',
      name: 'Ping',
      anonymous: false,
      inputs: [{ indexed: false, name: 'value', type: 'uint256' }],
    },
    {
      type: 'event',
      name: 'Ping',
      anonymous: false,
      inputs: [{ indexed: false, name: 'value', type: 'address' }],
    },
  ] as const;
  const uintData = `0x${bytesToHex(mapArgs(overloads[0].inputs).encode(7n))}`;
  const address = '0x2222222222222222222222222222222222222222';
  const addressData = `0x${bytesToHex(mapArgs(overloads[1].inputs).encode(address))}`;
  const uintTopics = [`0x${abi.evSigHash(overloads[0])}`];
  const addressTopics = [`0x${abi.evSigHash(overloads[1])}`];
  const d = new abi.Decoder();
  d.add(contract, overloads);
  deepStrictEqual(d.decodeEvent(contract, uintTopics, uintData, {}), {
    name: 'Ping',
    signature: 'Ping(uint256)',
    value: { value: 7n },
  });
  deepStrictEqual(d.decodeEvent(contract, addressTopics, addressData, {}), {
    name: 'Ping',
    signature: 'Ping(address)',
    value: { value: address },
  });
  deepStrictEqual(
    d.decodeEvent('0x3333333333333333333333333333333333333333', uintTopics, uintData, {}),
    [
      {
        name: 'Ping',
        signature: 'Ping(uint256)',
        value: { value: 7n },
      },
    ]
  );
});

it('example/libra', async () => {
  const UNISWAP = UNISWAP_V2_ROUTER_CONTRACT;
  const LABRA = '0x106d3c66d22d2dd0446df23d7f5960752994d600';
  const d = new abi.Decoder();
  d.add(UNISWAP, UNISWAP_V2_ROUTER);
  const uniOpt = {
    contract: UNISWAP,
    contracts: Object.assign({}, CONTRACTS, { [LABRA]: CUSTOM_TOKENS[LABRA] }),
    contractInfo: CONTRACTS[UNISWAP],
  };
  const [v] = DECODER_UNISWAP_V2;
  const tx0 = hex.decode(v.data);
  d.decode(UNISWAP, tx0, Object.assign(uniOpt, { amount: v.amount }));
  deepStrictEqual(await clearSigFor(UNISWAP, tx0, uniOpt), v.clearSig);
});

it('ABI integer inputs reject unsafe numbers', () => {
  const unsafe = Number.MAX_SAFE_INTEGER + 1;
  const uint = mapComponent(unwrapTestType('uint256'));
  const int = mapComponent(unwrapTestType('int256'));
  deepStrictEqual(uint.encode(7 as unknown as bigint), uint.encode(7n));
  deepStrictEqual(int.encode(-7 as unknown as bigint), int.encode(-7n));
  throws(() => uint.encode(unsafe as unknown as bigint));
  throws(() => int.encode(-unsafe as unknown as bigint));
});

it('ZST', () => {
  const payload = hex.decode(
    '000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000FFFFFFFF'
  );
  const TYPES = {
    // Will crash (fixed size, but very big)
    'uint256[0][4294967295]': unwrapTestType('uint256[0][4294967295]'),
    'uint32[0][4294967295]': unwrapTestType('uint32[0][4294967295]'),
    // Make sure that it won't crash
    'uint256[4294967295][4294967295]': unwrapTestType('uint256[4294967295][4294967295]'),
    'uint32[4294967295][4294967295]': unwrapTestType('uint32[4294967295][4294967295]'),
    'uint256[0][]': unwrapTestType('uint32[0][]'),
    'uint256[0][]': unwrapTestType('uint32[0][]'),
    '()[]': { type: 'tuple[]', components: [] }, // not supported in test methods
    '(())[]': { type: 'tuple[]', components: [{ type: 'tuple', components: [] }] },
    '(uint32[0])[]': { type: 'tuple[]', components: [{ type: 'uint32[0]' }] },
    '((uint32[0]))[]': {
      type: 'tuple[]',
      components: [{ type: 'tuple', components: [{ type: 'uint32[0]' }] }],
    },
  };

  for (const type in TYPES) {
    // it would crash process before
    throws(() => mapComponent(TYPES[type]).decode(payload));
  }
  // Empty tuples are disabled too; no built-in ABI needs them, and arrays of ZSTs can DoS decoding.
  const emptyTuple = { type: 'tuple', components: [] } as const;
  throws(() => mapComponent(emptyTuple));
  throws(() => abi.fnSigHash({ type: 'function', name: 'f', inputs: [emptyTuple] }));
  throws(() => abi.fnSigHash({ type: 'event', name: 'E', inputs: [emptyTuple] }));
  throws(() => mapComponent({ type: 'tuple[]', components: [] }));
  throws(() => mapComponent({ type: 'tuple[2]', components: [] }));
  deepStrictEqual(
    mapComponent({ type: 'uint32[]' }).encode([]),
    new Uint8Array([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0,
    ])
  );
});

it('Recursive ptrs', () => {
  //const EPad = (p) => P.padLeft(32, p, P.ZeroPad);
  //const PTR = EPad(P.U32BE);
  const arr2 = mapComponent(unwrapTestType('uint256[][]'));
  const arr4 = mapComponent(unwrapTestType('uint256[][][][]'));
  const arr10 = mapComponent(unwrapTestType('uint256[][][][][][][][][][]'));
  const a = [[], [], [], [], [], [], [], [], [], []];
  const p = arr2.encode(a);
  const ptrArr = mapComponent(unwrapTestType('uint256[]'));
  deepStrictEqual(
    hex.encode(p),

    '0000000000000000000000000000000000000000000000000000000000000020' + // ptr
      '000000000000000000000000000000000000000000000000000000000000000a' + // len=10
      '0000000000000000000000000000000000000000000000000000000000000140' +
      '0000000000000000000000000000000000000000000000000000000000000160' +
      '0000000000000000000000000000000000000000000000000000000000000180' +
      '00000000000000000000000000000000000000000000000000000000000001a0' +
      '00000000000000000000000000000000000000000000000000000000000001c0' +
      '00000000000000000000000000000000000000000000000000000000000001e0' +
      '0000000000000000000000000000000000000000000000000000000000000200' +
      '0000000000000000000000000000000000000000000000000000000000000220' +
      '0000000000000000000000000000000000000000000000000000000000000240' +
      '0000000000000000000000000000000000000000000000000000000000000260' + // ptrs end (10)
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' // 10 values
  );
  const a2 = ptrArr.decode(p, { allowUnreadBytes: true }); // we need to read only ptrs, not values);

  // 0x20 == 32
  const changePtr = ptrArr.encode(a2.map((i) => 32n));
  // default PoC
  const payload =
    '0000000000000000000000000000000000000000000000000000000000000020' +
    '000000000000000000000000000000000000000000000000000000000000000a' +
    '0000000000000000000000000000000000000000000000000000000000000020'.repeat(64);
  throws(() => arr10.decode(hex.decode(payload)));
  // Try to break check
  const p2 = hex.encode(
    ptrArr.encode(Array.from({ length: 10 * 1024 }, (i, j) => BigInt(j + 1) * 32n))
  );
  // Kinda slow, but input is 320 kb
  throws(() => arr10.decode(hex.decode(p2)));
  throws(() => arr4.decode(hex.decode(p2)));
  throws(() => arr2.decode(hex.decode(p2)));
});

it('Recursive ptrs2', () => {
  const arr10 = mapComponent(unwrapTestType('uint256[][][][][][][][][][]'));
  const a = [[], [], [], [], [], [], [], [], [], []];
  const ptrArr = mapComponent(unwrapTestType('uint256[]'));
  const mainPtr = hex.encode(ptrArr.encode(a.map((_, i) => BigInt(a.length - i + 1) * 32n)));
  throws(() => arr10.decode(hex.decode(mainPtr.repeat(10 + 1))));
});

it('ABI dynamic words reject high bits', () => {
  const str = mapComponent(unwrapTestType('string'));
  const arr = mapComponent(unwrapTestType('uint256[]'));
  const high = '0000000000000000000000000000000000000000000000010000000000000020';
  const tail =
    '0000000000000000000000000000000000000000000000000000000000000003' + '616263'.padEnd(64, '0');
  throws(() => str.decode(hex.decode(high + tail)));
  throws(() => arr.decode(hex.decode(high + tail)));
});

it('Interleave ptrs', () => {
  const ptrArr = mapComponent(unwrapTestType('uint256[]'));
  const raw = P.array(null, P.U256BE);
  const arr2 = mapComponent(unwrapTestType('uint256[][]'));

  const getArr = (length) => {
    const arr = Array.from({ length }, (i, j) => BigInt(length - j) * 32n);

    // 10: 32 * (length + 256 + 2*length +2)
    // 11: 32 * (length + 256 + 5*length+3)
    // 12: 32 * (length + 256 + 8*lenght+4)
    //    return hex.encode(ptrArr.encode(arr)) + '00'.repeat(32 * (30 * length + 3));

    const repeats = {
      4: 47, // 6kb -> 6kb (+0x)
      8: 109, // 15kb -> 30kb (+1x)
      16: 233, // 30kb -> 123kb (+3x)
      32: 481, // 63kb -> 510kb (+7x)
      64: 977, // 129kb -> 2mb (+15x)
      128: 1969, // 260kb -> 8mb (+31x)
      256: 3953, // 522kb -> 33mb (+63x)
      512: 7921, // 1mb -> 133mb (+127x)
      1024: 15857, // 2mb -> 533mb (+255x)
      2048: 32000, // 4mb -> 2gb (+511x)
      4096: 64000, // 8mb -> est: 8gb (+1023x)
    };

    return hex.encode(ptrArr.encode(arr)) + '00'.repeat(32 * 2 * repeats[length]);
  };

  for (const l of [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096]) {
    const ptrEnc = getArr(l);
    // console.log('encoding ptr', l, ptrEnc.length);
    //console.log('PTR', ptrArr.decode(hex.decode(ptrEnc)));
    //console.log('RAW', raw.decode(hex.decode(ptrEnc)));
    throws(() => arr2.encode(arr2.decode(hex.decode(ptrEnc))));
    // will bypass check, very slow and crash at the end)
    const TRY_POC = false;
    if (TRY_POC) {
      const realSz = arr2.encode(
        arr2.decode(hex.decode(ptrEnc), { allowMultipleReads: true })
      ).length;
      // console.log('REAL', realSz);
      // console.log(
      //   'DIFF',
      //   realSz - ptrEnc.length,
      //   `+${Math.floor((realSz - ptrEnc.length) / ptrEnc.length)}x`
      // );
      // console.log(
      //   'ARR2',
      //   arr2.decode(hex.decode(ptrEnc)).map((i) => i.length)
      // );
    }
  }
});

it('Junk data', () => {
  const t = mapComponent(unwrapTestType('uint256[]'));
  const DATA = [1n, 2n, 3n, 4n];
  const encoded = hex.encode(t.encode(DATA));
  const dataWithFingerpint = encoded + '11'.repeat(32);
  // by default: catch unread bytes even with pointers!
  throws(() => t.decode(hex.decode(dataWithFingerpint)));
  // allow to read tx if user insists
  const decoded = t.decode(hex.decode(dataWithFingerpint), { allowUnreadBytes: true });
  deepStrictEqual(decoded, DATA);
});

it('Junk data from real tx', () => {
  // https://etherscan.io/tx/0x62d0afd1d7815ee9b2da236ddc6af07386072acea20eef27497ad29e37533fdd
  const tx =
    '7ff36ab50000000000000000000000000000000000000000000000164054d8356b4f5c2800000000000000000000000000000000000000000000000000000000000000800000000000000000000000006994ece772cc4abb5c9993c065a34c94544a40870000000000000000000000000000000000000000000000000000000062b348620000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000106d3c66d22d2dd0446df23d7f5960752994d6007a6572696f6e';
  // uniswap v2
  const ABI = [
    {
      inputs: [
        { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
        { internalType: 'address[]', name: 'path', type: 'address[]' },
        { internalType: 'address', name: 'to', type: 'address' },
        { internalType: 'uint256', name: 'deadline', type: 'uint256' },
      ],
      name: 'swapExactETHForTokens',
      outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
      stateMutability: 'payable',
      type: 'function',
    },
  ];
  const sh = abi.fnSigHash(ABI[0]);
  const inputs = mapArgs(ABI[0].inputs);
  const txBytes = hex.decode(tx);

  const txSigHash = hex.encode(txBytes.slice(0, 4));
  const txData = txBytes.slice(4);
  // verify function signature hash to make sure we decode correct ABI
  deepStrictEqual(sh, txSigHash);
  // Error: Reader(): unread byte ranges: (224/6)[7a6572696f6e] (total=230)
  throws(() => inputs.decode(txData));
  const params = inputs.decode(txData, { allowUnreadBytes: true });
  /*
  Exactly same data as shown in etherscan:
  {
  amountOutMin: 410463937262026447912n,
  path: [
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    '0x106d3c66d22d2dd0446df23d7f5960752994d600'
  ],
  to: '0x6994ece772cc4abb5c9993c065a34c94544a4087',
  deadline: 1655916642n
  }
  */

  // Lets try manual decoding

  deepStrictEqual(
    tx,
    '7ff36ab5' + // function signature hash
      /*  00 */ '0000000000000000000000000000000000000000000000164054d8356b4f5c28' + // amountMin 410463937262026447912n in hex (uint256be)
      /*  32 */ '0000000000000000000000000000000000000000000000000000000000000080' + // array pointer (128 byte)
      /*  64 */ '0000000000000000000000006994ece772cc4abb5c9993c065a34c94544a4087' + // to param
      /*  96 */ '0000000000000000000000000000000000000000000000000000000062b34862' + // deadline (1655916642n in hex)
      /* 128 */ '0000000000000000000000000000000000000000000000000000000000000002' + // array length (array pointer points here)
      /* 160 */ '000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' + // first element of path
      /* 192 */ '000000000000000000000000106d3c66d22d2dd0446df23d7f5960752994d600' + // second element of path
      /* 224 */ '7a6572696f6e' // fingerprint! (or memory leak, or whatever). 6 bytes
  );
  // Encoded version doesn't include last 6 bytes, but is identical otherwise
  deepStrictEqual(hex.encode(inputs.encode(params)), tx.slice(8, -12));
  // '0000000000000000000000000000000000000000000000164054d8356b4f5c28' +
  // '0000000000000000000000000000000000000000000000000000000000000080' +
  // '0000000000000000000000006994ece772cc4abb5c9993c065a34c94544a4087' +
  // '0000000000000000000000000000000000000000000000000000000062b34862' +
  // '0000000000000000000000000000000000000000000000000000000000000002' +
  // '000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' +
  // '000000000000000000000000106d3c66d22d2dd0446df23d7f5960752994d600'
});

describe('simple decoder API', () => {
  // Splits a decoded result into its clearSig promise and the rest, failing when absent.
  const split = (decoded: unknown, what: string) => {
    if (!decoded || Array.isArray(decoded) || !(decoded as any).clearSig)
      throw new Error(`missing ${what} clearSig result`);
    const { clearSig, ...rest } = decoded as any;
    return { clearSig, rest };
  };
  it('decodeData', async () => {
    const { to, data, info, clearSig: expected } = USDT_TRANSFER;
    const { clearSig, rest } = split(decodeData(to, data), 'decodeData');
    deepStrictEqual(rest, info);
    deepStrictEqual(await clearSig, expected);
  });
  it('decodeData with custom tokens', async () => {
    const V = UNISWAP_SWAP;
    const decoded = split(
      decodeData(V.to, V.data, V.amount, { customContracts: V.customContracts }),
      'decodeData'
    );
    deepStrictEqual(decoded.rest, V.info);
    deepStrictEqual(await decoded.clearSig, V.clearSig);
    // Without custom token metadata, display falls back; ABI decoding still works.
    const fallback = split(decodeData(V.to, V.data, V.amount), 'fallback');
    deepStrictEqual(fallback.rest, V.fallbackInfo);
    deepStrictEqual(await fallback.clearSig, V.fallbackClearSig);
  });
  it('decodeData ignores inherited custom contract entries', () => {
    const to = '0x1111111111111111111111111111111111111111';
    const data =
      '0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222' +
      '0000000000000000000000000000000000000000000000000000000000000007';
    const customContracts = Object.create({
      [to]: { abi: 'ERC20', symbol: 'FAKE', decimals: 18 },
    });
    deepStrictEqual(
      decodeData(to, data, undefined, { noDefault: true, customContracts }),
      undefined
    );
  });
  it('decodeTx', async () => {
    // Guess arrays never carry clearSig, so this is the whole consumer check.
    const { clearSig, rest } = split(decodeTx(USDT_TRANSFER.tx), 'decodeTx');
    deepStrictEqual(rest, USDT_TRANSFER.info);
    deepStrictEqual(await clearSig, USDT_TRANSFER.clearSig);
  });
  it('decodeData and decodeTx attach clearSig from descriptor files', async () => {
    const { to, data, tx, descriptorInfo, clearSig: expected } = USDT_TRANSFER;
    const decoder = new Decoder().addClearSig(CLEARSIG_REPO);
    const byData = split(decodeData(to, `0x${data}`, 0n, { decoder }), 'decodeData');
    deepStrictEqual(byData.rest, descriptorInfo);
    deepStrictEqual(await byData.clearSig, expected);
    const byTx = split(decodeTx(Transaction.fromHex(tx), { decoder }), 'decodeTx');
    deepStrictEqual(byTx.rest, descriptorInfo);
    deepStrictEqual(await byTx.clearSig, expected);
  });
  it('decodeData and decodeTx pass from into clearSig context', async () => {
    const { target, from, files, withFrom, noFrom, signed } = CLEARSIG_FROM;
    const mark = [
      { type: 'function', name: 'mark', inputs: [{ name: 'value', type: 'uint256' }] },
    ] as const;
    const data = hex.encode(abi.createContract(mark).mark.encodeInput(7n));
    const decodedData = decodeData(target, data, 0n, {
      noDefault: true,
      clearSig: files,
      from,
      chainId: 1n,
    });
    deepStrictEqual(await split(decodedData, 'decodeData from').clearSig, withFrom);
    const unsigned = Transaction.prepare({
      to: target,
      chainId: 1n,
      nonce: 0n,
      maxFeePerGas: 10_000_000_000n,
      value: 0n,
      data,
    });
    const unsignedWithFrom = decodeTx(unsigned, { noDefault: true, clearSig: files, from });
    deepStrictEqual(await split(unsignedWithFrom, 'unsigned from').clearSig, withFrom);
    const unsignedNoFrom = decodeTx(unsigned, { noDefault: true, clearSig: files });
    deepStrictEqual(await split(unsignedNoFrom, 'unsigned no-from').clearSig, noFrom);
    const signedTx = unsigned.signBy(`0x${'11'.repeat(32)}`, false).toHex();
    const signedDecoded = decodeTx(signedTx, { noDefault: true, clearSig: files });
    deepStrictEqual(await split(signedDecoded, 'signed from').clearSig, signed);
    throws(
      () => decodeTx(signedTx, { noDefault: true, clearSig: files, from }),
      /decodeTx: wrong from=0x2222222222222222222222222222222222222222/
    );
    const goodTx = Transaction.fromHex(signedTx);
    const bad = new Transaction(
      goodTx.type,
      { ...goodTx.raw, s: 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140n },
      { strict: false }
    );
    throws(
      () =>
        decodeTx(bad, {
          noDefault: true,
          clearSig: files,
          from: '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A',
        }),
      /invalid s/
    );
  });
  it('decodeData handles public clearSig no-match boundaries', async () => {
    const { target, known, files, clearSig: expected } = CLEARSIG_CHAIN;
    const mark = [
      { type: 'function', name: 'mark', inputs: [{ name: 'value', type: 'uint256' }] },
    ] as const;
    const data = hex.encode(abi.createContract(mark).mark.encodeInput(7n));
    const info = { name: 'mark', signature: 'mark(uint256)', value: 7n };
    deepStrictEqual(decodeData(target, '0x', 0n, { noDefault: true, clearSig: files }), undefined);
    // ClearSig lookup is chain-scoped, but descriptor ABI stays usable for decode.
    deepStrictEqual(decodeData(target, data, 0n, { noDefault: true, clearSig: files }), info);
    const mainnetFiles = structuredClone(files);
    mainnetFiles['chain.json'].context.contract.deployments[0].chainId = 1;
    const implicitMainnet = split(
      decodeData(target, data, 0n, { noDefault: true, clearSig: mainnetFiles }),
      'implicit mainnet'
    );
    deepStrictEqual(implicitMainnet.rest, info);
    deepStrictEqual(await implicitMainnet.clearSig, expected);
    const opt = { noDefault: true, clearSig: files, chainId: 5n };
    const matched = split(decodeData(target, data, 0n, opt), 'chain');
    deepStrictEqual(matched.rest, info);
    deepStrictEqual(await matched.clearSig, expected);
    const decoder = new Decoder();
    decoder.add(known, mark);
    deepStrictEqual(decodeData(target, data, 0n, { decoder }), [info]);
    throws(() => decodeData(target, `${data}11`, 0n, opt), /left after unpack|unread byte ranges/);
    const loose = decodeData(target, `${data}11`, 0n, { ...opt, allowUnreadBytes: true });
    deepStrictEqual(await split(loose, 'unread-byte').clearSig, expected);
  });
  it('Decoder.addClearSig keeps generic descriptors for later bind', async () => {
    const { target, to, files, info, clearSig: expected } = CLEARSIG_GENERIC;
    const data = hex.encode(
      abi
        .createContract([
          {
            type: 'function',
            name: 'transfer',
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
            ],
          },
        ] as const)
        .transfer.encodeInput({ to, value: 9n })
    );
    const decoder = new Decoder().addClearSig(files);
    deepStrictEqual(decodeData(target, data, 0n, { decoder }), undefined);
    decoder.addClearSig({}, { bind: { address: target, chainId: 1n } });
    const decoded = split(decodeData(target, data, 0n, { decoder }), 'bound generic');
    deepStrictEqual(decoded.rest, info);
    deepStrictEqual(await decoded.clearSig, expected);
  });
  it('Decoder.resolve binds factory-backed clearSig descriptors', async () => {
    const { target, factory, files, info, clearSig: expected } = CLEARSIG_FACTORY;
    const data = hex.encode(
      abi
        .createContract([
          { type: 'function', name: 'resolve', inputs: [{ name: 'value', type: 'uint256' }] },
        ] as const)
        .resolve.encodeInput(7n)
    );
    const staged = new Decoder();
    deepStrictEqual(
      await staged.resolve({
        address: target,
        chainId: 1n,
        async resolveFactory() {
          throw new Error('no factory candidates should not call back');
        },
      }),
      false
    );
    staged.addClearSig(files);
    deepStrictEqual(
      await staged.resolve({
        address: target,
        chainId: 1n,
        async resolveFactory() {
          return 0;
        },
      }),
      true
    );
    const decoder = new Decoder().addClearSig(files);
    deepStrictEqual(decodeData(target, data, 0n, { decoder }), undefined);
    deepStrictEqual(
      await decoder.resolve({
        address: target,
        chainId: 1n,
        async resolveFactory(req) {
          deepStrictEqual(req, {
            address: target,
            chainId: 1n,
            factories: [
              {
                factory: files['factory.json'].context.contract.factory,
                deployments: [{ address: factory, chainId: 1n }],
                deployEvent: 'Made(address indexed instance)',
              },
            ],
            descriptor: undefined,
            context: { to: target, chainId: 1n },
          });
          return 0;
        },
      }),
      true
    );
    const decoded = split(decodeData(target, data, 0n, { decoder }), 'resolved');
    deepStrictEqual(decoded.rest, info);
    deepStrictEqual(await decoded.clearSig, expected);
    deepStrictEqual(
      await decoder.resolve({
        address: target,
        chainId: 1n,
        async resolveFactory() {
          throw new Error('cached factory resolution should not call back');
        },
      }),
      true
    );
  });
  it('decodeTx ignores contract creation transactions', () => {
    deepStrictEqual(decodeTx(CREATE_TX), undefined);
  });
  it('decodeEvent', () => {
    const { to, topics, data, expected } = DECODE_EVENT_BAT;
    deepStrictEqual(decodeEvent(to, topics, data), expected);
  });
  it('decodeEvent with WETH event hint', () => {
    for (const { topics, data, expected } of DECODE_EVENT_WETH)
      deepStrictEqual(decodeEvent(WETH_CONTRACT, topics, data), expected, expected.name);
  });
  it('decodeEvent with custom ERC20 event hint', () => {
    const { to, topics, data, opt, expected } = DECODE_EVENT_ERC20;
    deepStrictEqual(decodeEvent(to, topics, data, opt), expected);
  });
  it('decodeEvent with custom ERC1155 tag', () => {
    const { to, topics, data, opt, expected } = DECODE_EVENT_ERC1155;
    deepStrictEqual(decodeEvent(to, topics, data, opt), expected);
  });
  it('decoding receipts', () => {
    const res = RECEIPT.result.logs.map((log) => ({
      data: decodeData(log.address, log.data),
      event: decodeEvent(log.address, log.topics, log.data),
    }));
    deepStrictEqual(res, RECEIPT.expected);
  });
  describe('contract create', () => {
    it('accepts omitted or undefined args for constructors without inputs', () => {
      const bytecode = '0x00';
      const empty = [{ type: 'constructor', stateMutability: 'nonpayable' }] as const;
      deepStrictEqual(
        deployContract(
          [{ type: 'constructor', inputs: [], stateMutability: 'nonpayable' }] as const,
          bytecode
        ),
        bytecode
      );
      deepStrictEqual(deployContract(empty, bytecode), bytecode);
      deepStrictEqual(deployContract(empty, bytecode, undefined), bytecode);
    });
    it('rejects concrete args for constructors without inputs', () => {
      const bytecode = '0x00';
      const empty = [{ type: 'constructor', stateMutability: 'nonpayable' }] as const;
      throws(() => deployContract(empty, bytecode, 0n));
      throws(() => deployContract(empty, bytecode, {}));
      throws(() => deployContract(empty, bytecode, []));
    });
    it('basic', () => {
      // Empty constructor
      deepStrictEqual(
        deployContract(
          [{ type: 'constructor', inputs: [], stateMutability: 'nonpayable' }],
          DEPLOY_BYTECODE
        ),
        DEPLOY_BYTECODE
      );
      deepStrictEqual(
        deployContract([{ type: 'constructor', stateMutability: 'nonpayable' }], DEPLOY_BYTECODE),
        DEPLOY_BYTECODE
      );
      deepStrictEqual(
        deployContract(
          [
            {
              type: 'constructor',
              inputs: [{ name: 'a', type: 'uint256' }],
              stateMutability: 'nonpayable',
            },
          ],
          DEPLOY_BYTECODE,
          69420n
        ),
        DEPLOY_WITH_ARG
      );
      // No constructor
      throws(() => deployContract([{}], DEPLOY_BYTECODE, 69420n));
      // Arguments to constructor without any
      throws(() =>
        deployContract(
          [{ type: 'constructor', stateMutability: 'nonpayable' }],
          DEPLOY_BYTECODE,
          69420n
        )
      );
      throws(() =>
        deployContract(
          [{ type: 'constructor', inputs: undefined, stateMutability: 'nonpayable' }],
          DEPLOY_BYTECODE,
          69420n
        )
      );
    });
  });
});

describe('parseAbi', () => {
  it('encode external-function values', () => {
    const method = abi.createContract(parseAbi(['function setCallback(function cb)'])).setCallback;
    const callback = ethHex.decode(`0x${'11'.repeat(24)}`);
    deepStrictEqual(
      ethHex.encode(method.encodeInput(callback)),
      `0xe81af408${'11'.repeat(24)}${'00'.repeat(8)}`
    );
  });
  it('parse function/event/error shapes', () => {
    deepStrictEqual(parseAbiItem('function transfer(address to, uint256 amount) returns (bool)'), {
      type: 'function',
      name: 'transfer',
      inputs: [
        { type: 'address', name: 'to' },
        { type: 'uint256', name: 'amount' },
      ],
      outputs: [{ type: 'bool' }],
    });
    deepStrictEqual(
      parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
      {
        type: 'event',
        name: 'Transfer',
        inputs: [
          { type: 'address', name: 'from', indexed: true },
          { type: 'address', name: 'to', indexed: true },
          { type: 'uint256', name: 'value' },
        ],
      }
    );
    deepStrictEqual(
      parseAbiItem('error InsufficientBalance(uint256 available, uint256 required)'),
      {
        type: 'error',
        name: 'InsufficientBalance',
        inputs: [
          { type: 'uint256', name: 'available' },
          { type: 'uint256', name: 'required' },
        ],
      }
    );
    deepStrictEqual(parseAbiItem('constructor(address owner) payable'), {
      type: 'constructor',
      stateMutability: 'payable',
      inputs: [{ type: 'address', name: 'owner' }],
    });
    deepStrictEqual(parseAbiItem('fallback() external payable'), {
      type: 'fallback',
      stateMutability: 'payable',
    });
    deepStrictEqual(parseAbiItem('receive() external payable'), {
      type: 'receive',
      stateMutability: 'payable',
    });
    deepStrictEqual(parseAbiItem('function deposit() payable'), {
      type: 'function',
      name: 'deposit',
      stateMutability: 'payable',
    });
  });
  it('parse arrays of payable addresses', () => {
    deepStrictEqual(
      [
        parseAbiItem('function pay(address payable[] recipients)'),
        parseAbiItem('function pay(address payable[2] recipients)'),
      ],
      [
        {
          type: 'function',
          name: 'pay',
          inputs: [{ type: 'address[]', name: 'recipients' }],
        },
        {
          type: 'function',
          name: 'pay',
          inputs: [{ type: 'address[2]', name: 'recipients' }],
        },
      ]
    );
  });
  it('produce canonical selectors (cross-checked with ethers)', () => {
    for (const [sig, selector] of PARSE_ABI_SELECTORS)
      deepStrictEqual(abi.fnSigHash(parseAbiItem(sig)), selector, sig);
    deepStrictEqual(
      abi.evSigHash(
        parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
      ),
      'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    );
  });
  it('encode identically to JSON ABI', () => {
    const parsed = abi.createContract(
      parseAbi(['function transfer(address to, uint256 value) returns (bool success)'])
    );
    const json = abi.createContract(ERC20);
    const args = { to: '0x6B175474E89094C44Da98b954EedeAC495271d0F', value: 123n };
    deepStrictEqual(parsed.transfer.encodeInput(args), json.transfer.encodeInput(args));
    deepStrictEqual(parsed.transfer.decodeOutput(ethHex.decode(`0x${'00'.repeat(31)}01`)), true);
  });
  it('bounds human-readable ABI signature length and nesting depth', () => {
    const base = 'function bounded()';
    deepStrictEqual(parseAbiItem(base + ' '.repeat(16_384 - base.length)), {
      type: 'function',
      name: 'bounded',
    });
    throws(
      () => parseAbiItem(base + ' '.repeat(16_385 - base.length)),
      /parseAbi: signature too long, limit is 16384 characters/
    );

    const nested = (depth: number) => {
      let param = 'uint256 leaf';
      for (let i = 0; i < depth; i++) param = `(${param}) level${i}`;
      return `function nested(${param})`;
    };
    deepStrictEqual(parseAbiItem(nested(128)).type, 'function');
    throws(() => parseAbiItem(nested(129)), /parseAbi: schema too deep, limit is 128/);
  });
  it('reject malformed signatures', () => {
    throws(() => parseAbiItem('transfer(address,uint256)')); // no keyword
    throws(() => parseAbiItem('function x(Foo y)'), /struct references/);
    throws(() => parseAbiItem('function x(uint7 y)'), /unknown type/);
    throws(() => parseAbiItem('function x(address indexed y)'), /indexed/);
    throws(() => parseAbiItem('function x((address a,) y)')); // empty tuple member
    throws(() => parseAbiItem('function x(address y')); // unbalanced parens
    throws(() => parseAbiItem('function x() wrong')); // unknown modifier
    throws(() => parseAbiItem('function x() view pure')); // two mutability modifiers
    throws(() => parseAbiItem('error E(uint256 a) anonymous')); // trailer on error
    throws(() => parseAbi('function x()')); // not an array
  });
});

describe('decodeError', () => {
  const { string: ERROR_STRING, panic: PANIC, custom: CUSTOM } = DECODE_ERROR;
  it('decode Error(string)', () => {
    deepStrictEqual(decodeError(ERROR_STRING), {
      name: 'Error',
      signature: 'Error(string)',
      args: 'Not enough Ether provided.',
      message: 'Not enough Ether provided.',
    });
    deepStrictEqual(decodeError(ethHex.decode(ERROR_STRING)).name, 'Error');
  });
  it('decode Panic(uint256)', () => {
    deepStrictEqual(decodeError(PANIC), {
      name: 'Panic',
      signature: 'Panic(uint256)',
      args: 0x11n,
      message: 'panic: arithmetic overflow or underflow (0x11)',
    });
  });
  it('decode custom errors from ABI', () => {
    const errAbi = parseAbi(['error InsufficientBalance(uint256 available, uint256 required)']);
    deepStrictEqual(decodeError(CUSTOM, errAbi), {
      name: 'InsufficientBalance',
      signature: 'InsufficientBalance(uint256,uint256)',
      args: { available: 7n, required: 9n },
      message: 'InsufficientBalance(uint256,uint256)',
    });
    // Unknown selector without matching ABI
    deepStrictEqual(decodeError(CUSTOM), undefined);
    deepStrictEqual(decodeError(CUSTOM, parseAbi(['error Other(uint256 a)'])), undefined);
  });
  it('handle empty and malformed data', () => {
    deepStrictEqual(decodeError('0x'), undefined); // revert without reason
    throws(() => decodeError('0x1234')); // shorter than a selector
  });
});

describe('multicall3 abi', () => {
  const { dai: DAI, calldata: CALLDATA, result: RESULT } = MULTICALL3;
  it('encode/decode aggregate3 (cross-checked with ethers)', () => {
    const m = abi.createContract(MULTICALL3_ABI).aggregate3;
    const calldata = ethHex.encode(
      m.encodeInput([
        { target: DAI, allowFailure: true, callData: ethHex.decode('0x06fdde03') },
        { target: DAI, allowFailure: false, callData: ethHex.decode('0x95d89b41') },
      ])
    );
    deepStrictEqual(calldata, CALLDATA);
    deepStrictEqual(m.decodeOutput(ethHex.decode(RESULT)), [
      { success: true, returnData: ethHex.decode(`0x${'00'.repeat(31)}07`) },
      { success: false, returnData: Uint8Array.of() },
    ]);
  });
});

it.runWhen(import.meta.url);
