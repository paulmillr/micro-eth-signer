import { hexToBytes } from '@noble/hashes/utils.js';
import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, throws } from 'node:assert';
import { RLP } from '../src/core/rlp.ts';
import { ethHex, ethHexNoLeadingZero } from '../src/utils.ts';
import { getEthersVectors, getViemVectorItems } from './util.ts';
import { default as INVALID_RLP } from './vectors/ethereum-tests/RLPTests/invalidRLPTest.json' with { type: 'json' };
import { default as RANDOM_RLP } from './vectors/ethereum-tests/RLPTests/RandomRLPTests/example.json' with { type: 'json' };
import { default as RLP_TEST } from './vectors/ethereum-tests/RLPTests/rlptest.json' with { type: 'json' };
import { default as EIP2930 } from './vectors/monorepo/eip2930blockRLP.json' with { type: 'json' };
import { DECODE_TESTS, ENCODE_TESTS, INVALID } from './vectors/monorepo/rlp.js';

describe('RLP', () => {
  describe('@ethereumjs/rlp', () => {
    should('encode basic', () => {
      for (const [k, v] of Object.entries(ENCODE_TESTS))
        for (const inp of v)
          deepStrictEqual(ethHexNoLeadingZero.encode(RLP.encode(inp)), `0x${k}`, 'encode');
    });
    should('decode basic', () => {
      const toArr = (elm) =>
        Array.isArray(elm) ? elm.map(toArr) : ethHexNoLeadingZero.encode(elm);
      for (const k in DECODE_TESTS)
        deepStrictEqual(toArr(RLP.decode(ethHexNoLeadingZero.decode(k))), DECODE_TESTS[k]);
    });
    should('decode invalid', () => {
      for (const t of INVALID) throws(() => RLP.decode(ethHexNoLeadingZero.decode(t)));
    });
    should('honors allowUnreadBytes on the public RLP decoder', () => {
      deepStrictEqual(
        RLP.decode(Uint8Array.of(1, 2), { allowUnreadBytes: true }),
        Uint8Array.of(1)
      );
    });
    should('encode 0x-prefixed byte strings', () => {
      deepStrictEqual(
        [
          ethHex.encode(RLP.encode('0x')),
          ethHex.encode(RLP.encode('0x00')),
          ethHex.encode(RLP.encode('0x7f')),
          ethHex.encode(RLP.encode('0x80')),
          ethHex.encode(RLP.encode('0x1234')),
        ],
        ['0x80', '0x00', '0x7f', '0x8180', '0x821234']
      );
      throws(() => RLP.encode('0x0'));
      throws(() => RLP.encode('0xzz'));
    });
    should('encode integer zero consistently', () => {
      deepStrictEqual(
        [ethHex.encode(RLP.encode(0)), ethHex.encode(RLP.encode(0n))],
        ['0x80', '0x80']
      );
    });
    describe('ethereum-tests', () => {
      describe('RLP test', () => {
        for (const [k, v] of Object.entries(RLP_TEST)) {
          should(`${k}`, () => {
            let { in: inp, out } = v;
            if (typeof inp === 'string' && inp.startsWith('#')) inp = BigInt(inp.slice(1));
            deepStrictEqual(ethHex.encode(RLP.encode(inp)), out, 'encode');
          });
        }
      });
      describe('invalid RLP', () => {
        for (const [k, v] of Object.entries(INVALID_RLP)) {
          should(k, () => {
            throws(() => RLP.decode(hexToBytes(v.out)));
          });
        }
      });
      describe('random RLP', () => {
        for (const [k, v] of Object.entries(RANDOM_RLP)) {
          should(k, () => {
            RLP.decode(hexToBytes(v.out.replace('0x', '')));
          });
        }
      });
    });
    should('eip2930blockRLP', () => {
      deepStrictEqual(RLP.decode(hexToBytes(EIP2930.rlp)), [
        [
          '0000000000000000000000000000000000000000000000000000000000000000',
          '1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
          '8888f1f195afa192cfee860698584c030f4c9db1',
          'ef1552a40b7165c3cd773806b9e0c165b75356e0314bf0706f279c729f51e017',
          'e6e49996c7ec59f7a23d22b83239a60151512c65613bf84a0d7da336399ebc4a',
          'cafe75574d59780665a97fbfd11365c7545aa8f1abf4e5e12e8243334ef7286b',
          '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
          '020000',
          '0200',
          '2fefd8',
          'a410',
          '5506eb07',
          '636f6f6c65737420626c6f636b206f6e20636861696e',
          'bd4472abb6659ebe3ee06ee4d7b72a00a9f4d001caca51342001075469aff498',
          'a13a5a8c8f2bb1c4',
        ].map(hexToBytes),
        [
          [
            '',
            '0a',
            'c350',
            '095e7baea6a6c7c4c2dfeb977efac326af552d87',
            '0a',
            '',
            '1b',
            '9bea4c4daac7c7c52e093e6a4c35dbbcf8856f1af7b059ba20253e70848d094f',
            '8a8fae537ce25ed8cb5af9adac3f141af69bd515bd2ba031522df09b97dd72b1',
          ].map(hexToBytes),
          hexToBytes(
            '01f89b01800a8301e24194095e7baea6a6c7c4c2dfeb977efac326af552d878080f838f7940000000000000000000000000000000000000001e1a0000000000000000000000000000000000000000000000000000000000000000001a03dbacc8d0259f2508625e97fdfc57cd85fdd16e5821bc2c10bdd1a52649e8335a0476e10695b183a87b0aa292a7f4b78ef0c3fbe62aa2c42c84e1d9c3da159ef14'
          ),
        ],
        [],
      ]);
    });
    describe('ethers', () => {
      const mapEthers = (t) => (Array.isArray(t) ? t.map(mapEthers) : ethHex.decode(t));

      should('all vectors', () => {
        for (const i of getEthersVectors('rlp.json.gz')) {
          // should(i.name, () => {
          const encoded = ethHex.decode(i.encoded);
          const decoded = mapEthers(i.decoded);
          deepStrictEqual(RLP.encode(i.decoded), encoded, 'encode');
          deepStrictEqual(RLP.decode(encoded), decoded, 'decode');
          // });
        }
      });
    });
    // 60 MB of gzipped json
    should('viem rlp tests', async () => {
      const mapViem = (t) => (Array.isArray(t) ? t.map(mapViem) : hexToBytes(t.replace('0x', '')));
      for await (const t of getViemVectorItems('rlp.json.gz')) {
        let { encoded, decoded } = t;
        const value = mapViem(decoded);
        encoded = hexToBytes(encoded.replace('0x', ''));
        deepStrictEqual(RLP.decode(encoded), value);
        deepStrictEqual(RLP.encode(decoded), encoded);
      }
    });
  });
  describe('properties (deterministic fuzz)', () => {
    // mulberry32: deterministic PRNG so failures are reproducible
    let seed = 0xdeadbeef;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const randInt = (n) => Math.floor(rnd() * n);
    const randBytes = (n) => Uint8Array.from({ length: n }, () => randInt(256));
    const randTree = (depth) => {
      if (depth > 3 || rnd() < 0.45) return randBytes(randInt(70)); // covers short & long forms
      return Array.from({ length: randInt(6) }, () => randTree(depth + 1));
    };
    should('roundtrip & canonical bijection', () => {
      for (let i = 0; i < 2500; i++) {
        const tree = randTree(0);
        const encoded = RLP.encode(tree);
        deepStrictEqual(RLP.decode(encoded), tree, 'roundtrip');
        // Any accepted input must re-encode to itself byte-for-byte (decode is a bijection on
        // canonical encodings). This is the anti-junk-data property from audit/zst.md: nothing
        // can hide inside a decodable payload.
        deepStrictEqual(RLP.encode(RLP.decode(encoded)), encoded, 'bijection');
        // strict prefixes and trailing junk are never valid
        throws(() => RLP.decode(encoded.subarray(0, randInt(encoded.length))));
        throws(() => RLP.decode(Uint8Array.from([...encoded, ...randBytes(1 + randInt(3))])));
        // mutated input is either rejected or still canonical, never silently ambiguous
        const mutated = Uint8Array.from(encoded);
        mutated[randInt(mutated.length)] ^= 1 << randInt(8);
        let decoded;
        try {
          decoded = RLP.decode(mutated);
        } catch (e) {
          continue;
        }
        deepStrictEqual(RLP.encode(decoded), mutated, 'bijection after mutation');
      }
    });
    should('number, bigint and hex-string paths agree', () => {
      const cases = [0n, 1n, 127n, 128n, 255n, 256n, 65535n, 65536n];
      // 2^53 boundary: numbers and small bigints share a conversion path, big ones don't
      const max = BigInt(Number.MAX_SAFE_INTEGER);
      cases.push(max - 1n, max, max + 1n, max * max, (1n << 256n) - 1n);
      for (let i = 0; i < 500; i++) cases.push(BigInt(randInt(2 ** 31)) * BigInt(randInt(2 ** 31)));
      for (const n of cases) {
        const fromBigint = RLP.encode(n);
        let hex = n.toString(16);
        if (hex.length % 2) hex = '0' + hex;
        deepStrictEqual(RLP.encode(n === 0n ? '0x' : '0x' + hex), fromBigint, `hex ${n}`);
        if (n <= max) deepStrictEqual(RLP.encode(Number(n)), fromBigint, `number ${n}`);
      }
    });
    should('deep nesting fails as catchable error, not a crash', () => {
      const deep = (n) => {
        let x = [];
        for (let i = 0; i < n; i++) x = [x];
        return x;
      };
      const tree = deep(1000);
      deepStrictEqual(RLP.decode(RLP.encode(tree)), tree);
      throws(() => RLP.encode(deep(100000)), RangeError);
    });
  });
});

should.runWhen(import.meta.url);
