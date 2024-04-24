import { deepStrictEqual, throws } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, should } from 'micro-should';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import * as SSZ from '../lib/esm/ssz.js';
import * as snappy from 'snappyjs';
import * as yaml from 'yaml';

// https://github.com/ethereum/consensus-spec-tests
const PATH = './test/vectors/consensus-spec-tests/tests/general/phase0/ssz_generic/';
const STATIC_PATH = './test/vectors/consensus-spec-tests/tests/mainnet/deneb/ssz_static/';

// TODO: think about additional package to export vectors?
// Pros: less deps?
// Cons: need to sync after changes, bigints issues with json (need to add parser/decoder with bigint support)
const VALID = {};
const INVALID = {};
const yamlOpt = { intAsBigInt: true };
for (const category of readdirSync(PATH)) {
  for (const valid of ['valid', 'invalid']) {
    for (const name of readdirSync(`${PATH}/${category}/${valid}`)) {
      const curPath = `${PATH}/${category}/${valid}/${name}`;
      const data = readFileSync(`${curPath}/serialized.ssz_snappy`);
      const hex = bytesToHex(snappy.uncompress(data));
      const fullName = `${category}/${name}`;

      if (valid === 'valid') {
        const meta = yaml.parse(readFileSync(`${curPath}/meta.yaml`, 'utf8'), yamlOpt);
        const value = yaml.parse(readFileSync(`${curPath}/value.yaml`, 'utf8'), yamlOpt);
        VALID[fullName] = { meta, value, hex };
      } else {
        INVALID[fullName] = hex;
      }
    }
  }
}
const STATIC_VECTORS = [];
for (const type of readdirSync(STATIC_PATH)) {
  for (const name of readdirSync(`${STATIC_PATH}/${type}`)) {
    for (const name2 of readdirSync(`${STATIC_PATH}/${type}/${name}`)) {
      const fullName = `${name}/${name2}`;
      const curPath = `${STATIC_PATH}/${type}/${name}/${name2}`;
      const data = readFileSync(`${curPath}/serialized.ssz_snappy`);
      const hex = bytesToHex(snappy.uncompress(data));
      const meta = yaml.parse(readFileSync(`${curPath}/roots.yaml`, 'utf8'), yamlOpt);
      const value = yaml.parse(readFileSync(`${curPath}/value.yaml`, 'utf8'), yamlOpt);
      STATIC_VECTORS.push({ type, name: fullName, hex, meta, value });
    }
  }
}

describe('SSZ', () => {
  const SingleFieldTestStruct = SSZ.container({
    A: SSZ.byte,
  });
  const SmallTestStruct = SSZ.container({
    A: SSZ.uint16,
    B: SSZ.uint16,
  });
  const FixedTestStruct = SSZ.container({
    A: SSZ.uint8,
    B: SSZ.uint64,
    C: SSZ.uint32,
  });
  const VarTestStruct = SSZ.container({
    A: SSZ.uint16,
    B: SSZ.list(1024, SSZ.uint16),
    C: SSZ.uint8,
  });
  const ComplexTestStruct = SSZ.container({
    A: SSZ.uint16,
    B: SSZ.list(128, SSZ.uint16),
    C: SSZ.uint8,
    D: SSZ.bytelist(256),
    E: VarTestStruct,
    F: SSZ.vector(4, FixedTestStruct),
    G: SSZ.vector(2, VarTestStruct),
  });
  const BitsStruct = SSZ.container({
    A: SSZ.bitlist(5),
    B: SSZ.bitvector(2),
    C: SSZ.bitvector(1),
    D: SSZ.bitlist(6),
    E: SSZ.bitvector(8),
  });
  const structs = {
    SingleFieldTestStruct,
    SmallTestStruct,
    FixedTestStruct,
    VarTestStruct,
    ComplexTestStruct,
    BitsStruct,
  };

  should('basic', () => {
    const isSmall = (type) => ['uint8', 'uint16', 'uint32'].includes(type);

    for (const t in VALID) {
      const { meta, value, hex } = VALID[t];
      if (t.startsWith('uints/')) {
        let size = /^uints\/uint_(\d+)_/.exec(t)[1];
        const coder = {
          8: SSZ.uint8,
          16: SSZ.uint16,
          32: SSZ.uint32,
          64: SSZ.uint64,
          128: SSZ.uint128,
          256: SSZ.uint256,
        }[size];
        let val = value;
        if (typeof val === 'string') val = BigInt(value);
        if (size < 64) val = Number(val);
        deepStrictEqual(bytesToHex(coder.encode(val)), hex);
        deepStrictEqual(coder.decode(hexToBytes(hex)), val);
        deepStrictEqual(`0x${bytesToHex(coder.merkleRoot(val))}`, meta.root);
      } else if (t.startsWith('boolean/')) {
        const coder = SSZ.boolean;
        deepStrictEqual(bytesToHex(coder.encode(value)), hex);
        deepStrictEqual(coder.decode(hexToBytes(hex)), value);
        deepStrictEqual(`0x${bytesToHex(coder.merkleRoot(value))}`, meta.root);
      } else if (t.startsWith('basic_vector/')) {
        const m = /^basic_vector\/vec_(\w+)_(\d+)/.exec(t);
        const type = m[1];
        const size = +m[2];
        const coder = SSZ.vector(size, SSZ[type]);
        let val = value.map((i) => (typeof i === 'string' ? BigInt(i) : i));
        if (isSmall(type)) val = val.map((i) => Number(i));
        deepStrictEqual(bytesToHex(coder.encode(val)), hex);
        deepStrictEqual(coder.decode(hexToBytes(hex)), val);
        deepStrictEqual(`0x${bytesToHex(coder.merkleRoot(val))}`, meta.root);
      } else if (t.startsWith('bitvector/bitvec')) {
        let val = value;
        const size = +/^bitvector\/bitvec_(\d+)/.exec(t)[1];
        const coder = SSZ.bitvector(size);
        val = coder.decode(hexToBytes(val.slice(2)));
        deepStrictEqual(bytesToHex(coder.encode(val)), hex);
        deepStrictEqual(coder.decode(hexToBytes(hex)), val);
        deepStrictEqual(`0x${bytesToHex(coder.merkleRoot(val))}`, meta.root);
      } else if (t.startsWith('bitlist/bitlist')) {
        let val = value;
        const size = +/^bitlist\/bitlist_(\d+)/.exec(t)[1];
        const coder = SSZ.bitlist(size);
        val = coder.decode(hexToBytes(val.slice(2)));
        deepStrictEqual(bytesToHex(coder.encode(val)), hex);
        deepStrictEqual(coder.decode(hexToBytes(hex)), val);
        deepStrictEqual(`0x${bytesToHex(coder.merkleRoot(val))}`, meta.root);
      } else if (t.startsWith('containers/')) {
        const name = /^containers\/([^_]+)_/.exec(t)[1];
        const coder = structs[name];
        let val = value;
        if (name === 'BitsStruct') {
          val = {
            A: SSZ.bitlist(5).decode(hexToBytes(value.A.slice(2))),
            B: SSZ.bitvector(2).decode(hexToBytes(value.B.slice(2))),
            C: SSZ.bitvector(1).decode(hexToBytes(value.C.slice(2))),
            D: SSZ.bitlist(6).decode(hexToBytes(value.D.slice(2))),
            E: SSZ.bitvector(8).decode(hexToBytes(value.E.slice(2))),
          };
        } else if (name === 'ComplexTestStruct') {
          val = { ...val, D: hexToBytes(value.D.slice(2)) };
        }
        // small numbers
        if (name === 'SingleFieldTestStruct') val.A = Number(val.A);
        if (name === 'SmallTestStruct') {
          val.A = Number(val.A);
          val.B = Number(val.B);
        }
        if (name === 'FixedTestStruct') {
          val.A = Number(val.A);
          val.C = Number(val.C);
        }
        if (name === 'VarTestStruct') {
          val.A = Number(val.A);
          val.B = val.B.map(Number);
          val.C = Number(val.C);
        }
        if (name === 'ComplexTestStruct') {
          val.A = Number(val.A);
          val.B = val.B.map(Number);
          val.C = Number(val.C);
          val.E.A = Number(val.E.A);
          val.E.B = val.E.B.map(Number);
          val.E.C = Number(val.E.C);
          for (const i of val.F) {
            i.A = Number(i.A);
            i.C = Number(i.C);
          }
          for (const i of val.G) {
            i.A = Number(i.A);
            i.B = i.B.map(Number);
            i.C = Number(i.C);
          }
        }
        deepStrictEqual(bytesToHex(coder.encode(val)), hex);
        deepStrictEqual(coder.decode(hexToBytes(hex)), val);
        deepStrictEqual(`0x${bytesToHex(coder.merkleRoot(val))}`, meta.root);
      } else throw new Error('missing test');
    }
    for (const t in INVALID) {
      const hex = INVALID[t];
      if (t.startsWith('uints/')) {
        let size = /^uints\/uint_(\d+)_/.exec(t)[1];
        const coder = {
          8: SSZ.uint8,
          16: SSZ.uint16,
          32: SSZ.uint32,
          64: SSZ.uint64,
          128: SSZ.uint128,
          256: SSZ.uint256,
        }[size];
        throws(() => coder.decode(hexToBytes(hex)));
      } else if (t.startsWith('boolean/')) {
        throws(() => SSZ.boolean.decode(hexToBytes(hex)));
      } else if (t.startsWith('basic_vector/')) {
        const m = /^basic_vector\/vec_(\w+)_(\d+)/.exec(t);
        const type = m[1];
        const size = +m[2];
        throws(() => SSZ.vector(size, SSZ[type]).decode(hexToBytes(hex)));
      } else if (t.startsWith('bitvector/bitvec')) {
        const size = +/^bitvector\/bitvec_(\d+)/.exec(t)[1];
        throws(() => SSZ.bitvector(size).decode(hexToBytes(hex)), `${t}`);
      } else if (t.startsWith('bitlist/')) {
        const m = /^bitlist\/bitlist_(\d+)/.exec(t);
        const size = m ? +m[1] : 1;
        throws(() => SSZ.bitlist(size).decode(hexToBytes(hex)));
      } else if (t.startsWith('containers/')) {
        const name = /^containers\/([^_]+)_/.exec(t)[1];
        const coder = structs[name];
        throws(() => coder.decode(hexToBytes(hex)));
      } else throw new Error('missing test');
    }
  });

  should('Bitvector', () => {
    const coder4 = SSZ.bitvector(4);
    deepStrictEqual(coder4.decode(new Uint8Array([12])), [false, false, true, true]);
    deepStrictEqual(coder4.encode([false, false, true, true]), new Uint8Array([12]));

    const coder12 = SSZ.bitvector(12);
    deepStrictEqual(coder12.decode(new Uint8Array([24, 1])), [
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ]);

    const coder16 = SSZ.bitvector(16);
    const v16 = [
      [[true].concat(new Array(15).fill(false)), new Uint8Array([0x01, 0x00])],
      [[false, true].concat(new Array(14).fill(false)), new Uint8Array([0x02, 0x00])],
      [new Array(15).fill(false).concat([true]), new Uint8Array([0x00, 0x80])],
      [new Array(16).fill(true), new Uint8Array([0xff, 0xff])],
    ];
    for (const [value, res] of v16) {
      deepStrictEqual(coder16.encode(value), res, 'enc');
      deepStrictEqual(coder16.decode(res), value, 'dec');
    }
  });

  should('Bitlist', () => {
    const bl256 = SSZ.bitlist(256);
    // encode
    deepStrictEqual(bl256.encode([]), new Uint8Array([1]));
    deepStrictEqual(bl256.encode([false, true]), new Uint8Array([6]));
    deepStrictEqual(
      bl256.encode([false, false, false, true, true, false, false, false]),
      new Uint8Array([24, 1])
    );
    // decode
    deepStrictEqual(bl256.decode(new Uint8Array([1])), []);
    deepStrictEqual(bl256.decode(new Uint8Array([24, 1])), [
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
    deepStrictEqual(bl256.decode(new Uint8Array([24, 2])), [
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    deepStrictEqual(bl256.decode(new Uint8Array([24, 3])), [
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
      true,
    ]);
    throws(() => bl256.decode(new Uint8Array([24, 0])));
  });

  should('List', () => {
    const lst = SSZ.list(32, SSZ.uint16);
    deepStrictEqual(
      lst.encode(new Array(32).fill(33)),
      new Uint8Array([
        33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0,
        33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0,
        33, 0, 33, 0, 33, 0, 33, 0, 33, 0, 33, 0,
      ])
    );
    const lst8 = SSZ.list(32, SSZ.uint8);

    deepStrictEqual(
      lst8.decode(
        new Uint8Array([
          0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5,
          6, 7,
        ])
      ),
      [
        0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6,
        7,
      ]
    );

    const vlistVectors = [
      [[[]], '04000000'],
      [[[0xaa]], '04000000aa'],
      [[[0xaa, 0xbb, 0xcc]], '04000000aabbcc'],
      [[[], [], []], '0c0000000c0000000c000000'],
      [[[0xaa], [0xbb, 0xcc], [0xdd, 0xee, 0xff]], '0c0000000d0000000f000000aabbccddeeff'],
    ];
    for (const [value, hex] of vlistVectors) {
      const vlist = SSZ.vector(value.length, SSZ.list(2 ** 32, SSZ.uint8));
      deepStrictEqual(bytesToHex(vlist.encode(value)), hex);
      deepStrictEqual(vlist.decode(hexToBytes(hex)), value);
    }
    const nested = SSZ.list(3, SSZ.list(3, SSZ.uint8));
    deepStrictEqual(
      bytesToHex(nested.encode([[1, 2], [3], [4, 5, 6]])),
      '0c0000000e0000000f000000010203040506'
    );
    deepStrictEqual(nested.decode(hexToBytes('0c0000000e0000000f000000010203040506')), [
      [1, 2],
      [3],
      [4, 5, 6],
    ]);
    const nested2 = SSZ.list(3, SSZ.list(3, SSZ.list(3, SSZ.uint8)));
    deepStrictEqual(
      bytesToHex(nested2.encode([[[1, 2]], [[3]], [[4, 5, 6]]])),
      '0c0000001200000017000000040000000102040000000304000000040506'
    );
    deepStrictEqual(
      nested2.decode(hexToBytes('0c0000001200000017000000040000000102040000000304000000040506')),
      [[[1, 2]], [[3]], [[4, 5, 6]]]
    );
    const nested3 = SSZ.list(3, SSZ.list(3, SSZ.list(3, SSZ.list(3, SSZ.uint8))));
    deepStrictEqual(
      bytesToHex(
        nested3.encode([
          [[[1, 2]], [[3]], [[4, 5, 6]]],
          [[[7]], [[8, 9]]],
        ])
      ),
      '08000000260000000c0000001200000017000000040000000102040000000304000000040506080000000d0000000400000007040000000809'
    );
    deepStrictEqual(
      nested3.decode(
        hexToBytes(
          '08000000260000000c0000001200000017000000040000000102040000000304000000040506080000000d0000000400000007040000000809'
        )
      ),
      [
        [[[1, 2]], [[3]], [[4, 5, 6]]],
        [[[7]], [[8, 9]]],
      ]
    );

    const llist = SSZ.list(2 ** 32, SSZ.list(2 ** 32, SSZ.uint8));
    throws(() => llist.decode(hexToBytes('0001')));
  });
  should('Container', () => {
    const basicVectors = [
      [SSZ.container({ a: SSZ.uint8 }), { a: 0xaa }, 'aa'],
      [
        SSZ.container({ a: SSZ.uint8, b: SSZ.uint8, c: SSZ.uint8 }),
        { a: 0xaa, b: 0xbb, c: 0xcc },
        'aabbcc',
      ],
      [SSZ.container({ a: SSZ.list(2 ** 32, SSZ.uint8) }), { a: [] }, '04000000'],
      [SSZ.container({ a: SSZ.list(2 ** 32, SSZ.uint8) }), { a: [0xaa, 0xbb] }, '04000000aabb'],
      [
        SSZ.container({ a: SSZ.uint8, b: SSZ.list(2 ** 32, SSZ.uint8) }),
        { a: 0xaa, b: [0xbb, 0xcc] },
        'aa05000000bbcc',
      ],
      [
        SSZ.container({ b: SSZ.list(2 ** 32, SSZ.uint8), a: SSZ.uint8 }),
        { a: 0xcc, b: [0xaa, 0xbb] },
        '05000000ccaabb',
      ],
      [
        SSZ.container({ a: SSZ.list(2 ** 32, SSZ.uint8), b: SSZ.list(2 ** 32, SSZ.uint8) }),
        { a: [0xaa, 0xbb], b: [0xcc, 0xdd] },
        '080000000a000000aabbccdd',
      ],
      [
        ComplexTestStruct,
        {
          A: 0xaabb,
          B: [0x1122, 0x3344],
          C: 0xff,
          D: new Uint8Array([0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72]),
          E: { A: 0xabcd, B: [1, 2, 3], C: 0xff },
          F: [
            { A: 0xcc, B: 0x4242424242424242n, C: 0x13371337 },
            { A: 0xdd, B: 0x3333333333333333n, C: 0xabcdabcd },
            { A: 0xee, B: 0x4444444444444444n, C: 0x00112233 },
            { A: 0xff, B: 0x5555555555555555n, C: 0x44556677 },
          ],
          G: [
            { A: 0xdead, B: [1, 2, 3], C: 0x11 },
            { A: 0xbeef, B: [4, 5, 6], C: 0x22 },
          ],
        },
        'bbaa47000000ff4b00000051000000cc424242424242424237133713dd3333333333333333cdabcdabee444444444444444433221100ff5555555555555555776655445e00000022114433666f6f626172cdab07000000ff0100020003000800000015000000adde0700000011010002000300efbe0700000022040005000600',
      ],
    ];
    for (const [c, value, hex] of basicVectors) {
      deepStrictEqual(bytesToHex(c.encode(value)), hex);
      deepStrictEqual(c.decode(hexToBytes(hex)), value);
    }

    deepStrictEqual(
      bytesToHex(
        ComplexTestStruct.merkleRoot({
          A: 0xaabb,
          B: [0x1122, 0x3344],
          C: 0xff,
          D: new Uint8Array([0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72]),
          E: { A: 0xabcd, B: [1, 2, 3], C: 0xff },
          F: [
            { A: 0xcc, B: 0x4242424242424242n, C: 0x13371337 },
            { A: 0xdd, B: 0x3333333333333333n, C: 0xabcdabcd },
            { A: 0xee, B: 0x4444444444444444n, C: 0x00112233 },
            { A: 0xff, B: 0x5555555555555555n, C: 0x44556677 },
          ],
          G: [
            { A: 0xdead, B: [1, 2, 3], C: 0x11 },
            { A: 0xbeef, B: [4, 5, 6], C: 0x22 },
          ],
        })
      ),
      `d8c8acf330f9ce3fe6303a49481f2950c9bc897ac8da7be983bd9bf3c681f6fb`
    );
  });
  should('Union', () => {
    const vectors = [
      [
        SSZ.union(SSZ.uint16),
        { selector: 0, value: 0xaabb },
        '00bbaa',
        '1a3ae6022c070dce5686a48eae443224e871ee366f9688e390f8be648fd66cd1',
      ],
      [
        SSZ.union(SSZ.uint16, SSZ.uint32),
        { selector: 0, value: 0xaabb },
        '00bbaa',
        '1a3ae6022c070dce5686a48eae443224e871ee366f9688e390f8be648fd66cd1',
      ],
      [
        SSZ.union(null, SSZ.uint16, SSZ.uint32),
        { selector: 0, value: undefined },
        '00',
        'f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b',
      ],
      [
        SSZ.union(null, SSZ.uint16, SSZ.uint32),
        { selector: 1, value: 0xaabb },
        '01bbaa',
        '016550f636d58cac2344703d636a9205c8370c1220510a4c0053da00771e4c6c',
      ],
      [
        SSZ.union(SSZ.uint16, SSZ.uint32),
        { selector: 1, value: 0xdeadbeef },
        '01efbeadde',
        'f33d9aeb301d37d5de65f257a6ee0944f7c133793d108e0c7a9ec3f110169818',
      ],
      [
        SSZ.union(SSZ.uint16, SSZ.uint32, SSZ.uint8, SSZ.list(8, SSZ.uint16)),
        { selector: 2, value: 0xaa },
        '02aa',
        '890670fb0d77b8176fefa567c99dd3487fcc7fa3c09aa58f65bed1202d49335e',
      ],
      [
        SSZ.union(SingleFieldTestStruct, SingleFieldTestStruct),
        { selector: 1, value: { A: 0xab } },
        '01ab',
        '906bd57af22f9bfed8e2e43d34215fa48952fbe9d8c42c5191e3fcaed04ad1f8',
      ],
      [
        SSZ.union(
          SSZ.vector(3, SSZ.uint8),
          SingleFieldTestStruct,
          VarTestStruct,
          ComplexTestStruct,
          SSZ.uint16
        ),
        { selector: 2, value: { A: 0xabcd, B: [1, 2, 3], C: 0xff } },
        '02cdab07000000ff010002000300',
        '10676f0c40ee7d4d87c4fb5e600918dd01868c9b16fa45f2becea1592a63d6b9',
      ],
    ];
    for (const [c, value, hex, root] of vectors) {
      deepStrictEqual(bytesToHex(c.encode(value)), hex);
      deepStrictEqual(c.decode(hexToBytes(hex)), value);
      deepStrictEqual(bytesToHex(c.merkleRoot(value)), root);
    }
  });
  describe('ssz_static', () => {
    for (const t of STATIC_VECTORS) {
      should(`${t.type}/${t.name}`, () => {
        const { hex, meta, value, type } = t;
        const c = SSZ.ETH2_TYPES[type];
        let val = value;
        // patch u8a && bigints
        const mapTypes = (elm) => {
          if (elm === null) return elm;
          if (Array.isArray(elm)) return elm.map(mapTypes);
          if (typeof elm === 'object') {
            const res = {};
            for (const [k, v] of Object.entries(elm)) {
              if (
                [
                  'transactions',
                  'blob_kzg_commitments',
                  'proof',
                  'block_roots',
                  'state_roots',
                  'historical_roots',
                  'pubkeys',
                  'randao_mixes',
                  'kzg_commitment_inclusion_proof',
                  'current_sync_committee_branch',
                  'execution_branch',
                  'finality_branch',
                  'next_sync_committee_branch',
                ].includes(k) &&
                Array.isArray(v)
              ) {
                res[k] = v.map((i) => hexToBytes(i.slice(2)));
              } else if (
                ['previous_epoch_participation', 'current_epoch_participation'].includes(k) &&
                Array.isArray(v)
              ) {
                res[k] = v.map(Number);
              } else if (k === 'aggregation_bits') {
                if (
                  [
                    'SyncCommitteeContribution',
                    'ContributionAndProof',
                    'SignedContributionAndProof',
                  ].includes(type)
                ) {
                  res[k] = SSZ.bitvector(128).decode(hexToBytes(v.slice(2)));
                } else res[k] = SSZ.bitlist(2048).decode(hexToBytes(v.slice(2)));
              } else if (k === 'sync_committee_bits') {
                res[k] = SSZ.bitvector(512).decode(hexToBytes(v.slice(2)));
              } else if (k === 'justification_bits') {
                res[k] = SSZ.bitvector(4).decode(hexToBytes(v.slice(2)));
              } else if (
                [
                  'root',
                  'beacon_block_root',
                  'signature',
                  'selection_proof',
                  'from_bls_pubkey',
                  'to_execution_address',
                  'parent_root',
                  'state_root',
                  'randao_reveal',
                  'deposit_root',
                  'block_hash',
                  'graffiti',
                  'body_root',
                  'sync_committee_signature',
                  'parent_hash',
                  'fee_recipient',
                  'receipts_root',
                  'logs_bloom',
                  'prev_randao',
                  'extra_data',
                  'address',
                  'pubkey',
                  'withdrawal_credentials',
                  'genesis_validators_root',
                  'aggregate_pubkey',
                  'previous_version',
                  'current_version',
                  'transactions_root',
                  'block_summary_root',
                  'state_summary_root',
                  'withdrawals_root',
                  'block_root',
                  'blob',
                  'kzg_commitment',
                  'kzg_proof',
                  'object_root',
                  'domain',
                ].includes(k)
              ) {
                res[k] = hexToBytes(v.slice(2));
              } else if (['base_fee_per_gas', 'total_difficulty'].includes(k)) {
                res[k] = BigInt(v);
              } else res[k] = mapTypes(v);
            }
            return res;
          }
          return elm;
        };
        val = mapTypes(val);
        deepStrictEqual(c.decode(c.encode(val)), val);
        deepStrictEqual(bytesToHex(c.encode(val)), hex);
        deepStrictEqual(c.decode(hexToBytes(hex)), val);
        deepStrictEqual(`0x${bytesToHex(c.merkleRoot(val))}`, meta.root);
      });
    }
  });
});

// ESM is broken.
import url from 'node:url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  should.run();
}
