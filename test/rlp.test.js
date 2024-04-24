import { deepStrictEqual, throws } from 'node:assert';
import { describe, should } from 'micro-should';
import { hexToBytes } from '@noble/hashes/utils';
import { RLP } from '../lib/esm/rlp.js';
import { ethHex, ethHexNoLeadingZero } from '../lib/esm/utils.js';
import { ENCODE_TESTS, DECODE_TESTS, INVALID } from './vectors/monorepo/rlp.js';
import { getEthersVectors, getViemVectors } from './util.js';
import { default as RLP_TEST } from './vectors/ethereum-tests/RLPTests/rlptest.json' assert { type: 'json' };
import { default as INVALID_RLP } from './vectors/ethereum-tests/RLPTests/invalidRLPTest.json' assert { type: 'json' };
import { default as RANDOM_RLP } from './vectors/ethereum-tests/RLPTests/RandomRLPTests/example.json' assert { type: 'json' };
import { default as EIP2930 } from './vectors/monorepo/eip2930blockRLP.json' assert { type: 'json' };

const VIEM_RLP = getViemVectors('rlp.json.gz');
const ETHERS_RLP = getEthersVectors('rlp.json.gz');

describe('RLP', () => {
  describe('@ethereumjs/rlp', () => {
    should('encode basic', () => {
      for (const [k, v] of Object.entries(ENCODE_TESTS))
        for (const inp of v) deepStrictEqual(ethHexNoLeadingZero.encode(RLP.encode(inp)), `0x${k}`, 'encode');
    });
    should('decode basic', () => {
      const toArr = (elm) => (Array.isArray(elm) ? elm.map(toArr) : ethHexNoLeadingZero.encode(elm));
      for (const k in DECODE_TESTS)
        deepStrictEqual(toArr(RLP.decode(ethHexNoLeadingZero.decode(k))), DECODE_TESTS[k]);
    });
    should('decode invalid', () => {
      for (const t of INVALID) throws(() => RLP.decode(ethHexNoLeadingZero.decode(t)));
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

      for (const i of ETHERS_RLP) {
        should(i.name, () => {
          const [encoded, decoded] = mapEthers([i.encoded, i.decoded]);
          deepStrictEqual(RLP.encode(decoded), encoded, 'encode');
          deepStrictEqual(RLP.decode(encoded), decoded, 'encode');
        });
      }
    });
    // 60 MB of gzipped json
    should('viem rlp tests', () => {
      const mapViem = (t) => (Array.isArray(t) ? t.map(mapViem) : hexToBytes(t.replace('0x', '')));
      for (const t of VIEM_RLP) {
        let { encoded, decoded } = t;
        decoded = mapViem(decoded);
        encoded = hexToBytes(encoded.replace('0x', ''));
        deepStrictEqual(RLP.decode(encoded), decoded);
        deepStrictEqual(RLP.encode(decoded), encoded);
      }
    });
  });
});

// ESM is broken.
import url from 'node:url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  should.run();
}
