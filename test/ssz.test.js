import { deepStrictEqual, throws } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, should } from 'micro-should';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import * as SSZ from '../esm/ssz.js';
import * as snappy from 'snappyjs';
import * as yaml from 'yaml';
import { __dirname } from './util.js';

// https://github.com/ethereum/consensus-spec-tests
const PATH = './test/vectors/consensus-spec-tests/tests/general/phase0/ssz_generic/';
const STATIC_PATH = './test/vectors/consensus-spec-tests/tests/mainnet/deneb/ssz_static/';
const SSZ_STABLE_PATH = './vectors/ssz/';
const SSZ_STABLE_PATH_2 = `${__dirname}/vectors/ssz`;

function parseVectors(path) {
  const res = {};
  for (const name of readdirSync(`${__dirname}/${path}`)) {
    const curPath = `${__dirname}/${path}/${name}`;
    const data = readFileSync(`${curPath}/serialized.ssz_snappy`);
    const hex = bytesToHex(snappy.uncompress(data));
    const meta = yaml.parse(readFileSync(`${curPath}/meta.yaml`, 'utf8'), yamlOpt);
    const value = yaml.parse(readFileSync(`${curPath}/value.yaml`, 'utf8'), yamlOpt);
    res[name] = { meta, value, hex };
  }
  return res;
}

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

function * readStructVectors(path) {
  const res = [];
  for (const type of readdirSync(path)) {
    for (const name of readdirSync(`${path}/${type}`)) {
      for (const name2 of readdirSync(`${path}/${type}/${name}`)) {
        const fullName = `${name}/${name2}`;
        const curPath = `${path}/${type}/${name}/${name2}`;
        const data = readFileSync(`${curPath}/serialized.ssz_snappy`);
        const hex = bytesToHex(snappy.uncompress(data));
        const meta = yaml.parse(readFileSync(`${curPath}/roots.yaml`, 'utf8'), yamlOpt);
        const value = yaml.parse(readFileSync(`${curPath}/value.yaml`, 'utf8'), yamlOpt);
        yield { type, name: fullName, hex, meta, value };
      }
    }
  }
  // return res;
}

// patch u8a && bigints
const mapTypes = (type, electra, elm) => {
  const mt = mapTypes.bind(null, type, electra);
  if (elm === null) return elm;
  if (Array.isArray(elm)) return elm.map(mt);
  if (typeof elm === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(elm)) {
      if (v === null) continue;
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
        } else if (
          ['StableAttestation', 'Attestation', 'StableBeaconBlockBody', 'BeaconBlockBody'].includes(
            type
          )
        ) {
          res[k] = SSZ.bitlist(2048 * 64).decode(hexToBytes(v.slice(2)));
        } else res[k] = SSZ.bitlist(2048).decode(hexToBytes(v.slice(2)));
      } else if (k === 'sync_committee_bits') {
        res[k] = SSZ.bitvector(512).decode(hexToBytes(v.slice(2)));
      } else if (k === 'justification_bits') {
        res[k] = SSZ.bitvector(4).decode(hexToBytes(v.slice(2)));
      } else if (k === 'committee_bits') {
        res[k] = SSZ.bitvector(64).decode(hexToBytes(v.slice(2)));
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
          'source_address',
          'source_pubkey',
          'target_pubkey',
          'receipts_root',
          'prev_randao',
          'validator_pubkey',
        ].includes(k)
      ) {
        res[k] = hexToBytes(v.slice(2));
      } else if (['base_fee_per_gas', 'total_difficulty'].includes(k)) {
        res[k] = BigInt(v);
      } else {
        res[k] = mt(v);
      }
    }
    return res;
  }
  return elm;
};

describe('SSZ', () => {
  describe('staticContainer', () => {
    describe('basic (from EIP)', () => {
      const Shape1 = SSZ.stableContainer(4, {
        side: SSZ.uint16,
        color: SSZ.uint8,
        radius: SSZ.uint16,
      });
      const Shape2 = SSZ.stableContainer(8, {
        side: SSZ.uint16,
        color: SSZ.uint8,
        radius: SSZ.uint16,
      });
      const Shape3 = SSZ.stableContainer(8, {
        side: SSZ.uint16,
        colors: SSZ.list(4, SSZ.uint8),
        radius: SSZ.uint16,
      });
      const VarTestStruct = SSZ.container({
        A: SSZ.uint16,
        B: Shape3,
        C: SSZ.uint8,
      });
      const VarTestStruct2 = SSZ.container({
        A: SSZ.uint16,
        B: SSZ.list(2, Shape3),
        C: SSZ.uint8,
      });
      const ShapePair3 = SSZ.container({
        shape_1: Shape3,
        shape_2: Shape3,
      });
      const Shape4 = SSZ.stableContainer(33, {
        side: SSZ.uint16,
        colors: SSZ.list(4, SSZ.uint8),
        radius: SSZ.uint16,
      });
      const ShapePair4 = SSZ.container({
        shape_1: Shape4,
        shape_2: Shape4,
      });
      should('stableContainer', () => {
        const VECTORS = [
          {
            c: Shape1,
            value: { side: 0x42, color: 1, radius: 0x42 },
            serialized: '074200014200',
            hash_tree_root: '37b28eab19bc3e246e55d2e2b2027479454c27ee006d92d4847c84893a162e6d',
          },
          {
            c: Shape1,
            value: { side: 0x42, color: 1 },
            serialized: '03420001',
            hash_tree_root: 'bfdb6fda9d02805e640c0f5767b8d1bb9ff4211498a5e2d7c0f36e1b88ce57ff',
          },
          {
            c: Shape1,
            value: { color: 1 },
            serialized: '0201',
            hash_tree_root: '522edd7309c0041b8eb6a218d756af558e9cf4c816441ec7e6eef42dfa47bb98',
          },
          {
            c: Shape1,
            value: { color: 1, radius: 0x42 },
            serialized: '06014200',
            hash_tree_root: 'f66d2c38c8d2afbd409e86c529dff728e9a4208215ca20ee44e49c3d11e145d8',
          },
          {
            c: Shape2,
            value: { side: 0x42, color: 1, radius: 0x42 },
            serialized: '074200014200',
            hash_tree_root: '0792fb509377ee2ff3b953dd9a88eee11ac7566a8df41c6c67a85bc0b53efa4e',
          },
          {
            c: Shape2,
            value: { side: 0x42, color: 1 },
            serialized: '03420001',
            hash_tree_root: 'ddc7acd38ae9d6d6788c14bd7635aeb1d7694768d7e00e1795bb6d328ec14f28',
          },
          {
            c: Shape2,
            value: { color: 1 },
            serialized: '0201',
            hash_tree_root: '9893ecf9b68030ff23c667a5f2e4a76538a8e2ab48fd060a524888a66fb938c9',
          },
          {
            c: Shape2,
            value: { color: 1, radius: 0x42 },
            serialized: '06014200',
            hash_tree_root: 'e823471310312d52aa1135d971a3ed72ba041ade3ec5b5077c17a39d73ab17c5',
          },
          {
            c: Shape3,
            value: { side: 0x42, colors: [1, 2], radius: 0x42 },
            serialized: '0742000800000042000102',
            hash_tree_root: '1093b0f1d88b1b2b458196fa860e0df7a7dc1837fe804b95d664279635cb302f',
          },
          {
            c: Shape3,
            value: { side: 0x42 },
            serialized: '014200',
            hash_tree_root: '28df3f1c3eebd92504401b155c5cfe2f01c0604889e46ed3d22a3091dde1371f',
          },
          {
            c: Shape3,
            value: { colors: [1, 2] },
            serialized: '02040000000102',
            hash_tree_root: '659638368467b2c052ca698fcb65902e9b42ce8e94e1f794dd5296ceac2dec3e',
          },
          {
            c: Shape3,
            value: { radius: 0x42 },
            serialized: '044200',
            hash_tree_root: 'd585dd0561c718bf4c29e4c1bd7d4efd4a5fe3c45942a7f778acb78fd0b2a4d2',
          },
          {
            c: Shape3,
            value: { colors: [1, 2], radius: 0x42 },
            serialized: '060600000042000102',
            hash_tree_root: '00fc0cecc200a415a07372d5d5b8bc7ce49f52504ed3da0336f80a26d811c7bf',
          },
          {
            c: VarTestStruct,
            value: { A: 11, B: { colors: [1, 2], radius: 0x42 }, C: 3 },
            serialized: '0b000700000003060600000042000102',
            hash_tree_root: 'c29e3166aa3fb90442673b56736eb7f4e6e060ed1f4088556e7be81cb1458380',
          },
          {
            c: VarTestStruct2,
            value: { A: 11, B: [{ colors: [1, 2], radius: 0x42 }], C: 3 },
            serialized: '0b00070000000304000000060600000042000102',
            hash_tree_root: 'd5197534723f8b2643d54adde5ef9c456a28e0df61c4568f92c7f00244af3b4f',
          },

          {
            c: ShapePair3,
            value: {
              shape_1: { colors: [1, 2], radius: 0x42 },
              shape_2: { side: 5, colors: [3, 4], radius: 0x23 },
            },
            serialized: '08000000110000000606000000420001020705000800000023000304',
            hash_tree_root: 'c932d6052fb9643366c3271552ba5397791df399271edaa8e46e694d8fb22c57',
          },
          {
            c: ShapePair3,
            value: {
              shape_1: { side: 5, colors: [3, 4], radius: 0x23 },
              shape_2: { colors: [1, 2], radius: 0x42 },
            },
            serialized: '08000000130000000705000800000023000304060600000042000102',
            hash_tree_root: 'b60d88a6e2c50b573ac61c069ea2c4cd01b345b33c1a1631ae18c27bf33e4cee',
          },
          {
            c: ShapePair4,
            value: {
              shape_1: { colors: [1, 2], radius: 0x42 },
              shape_2: { side: 5, colors: [3, 4], radius: 0x23 },
            },
            serialized: '080000001500000006000000000600000042000102070000000005000800000023000304',
            hash_tree_root: 'e0694811df863204b7a4dbf0239dbe5a555ff451954142eb2af7bf9b4f6763bf',
          },
          {
            c: ShapePair4,
            value: {
              shape_1: { side: 5, colors: [3, 4], radius: 0x23 },
              shape_2: { colors: [1, 2], radius: 0x42 },
            },
            serialized: '080000001700000007000000000500080000002300030406000000000600000042000102',
            hash_tree_root: 'b88771fd9e8f80f8621c63084cbf9c1b12301dcc117f6604ad992777eb7b1dd7',
          },
        ];
        for (const v of VECTORS) {
          deepStrictEqual(v.c.decode(hexToBytes(v.serialized)), v.value, 'decode');
          deepStrictEqual(bytesToHex(v.c.encode(v.value)), v.serialized, 'encode');
          deepStrictEqual(bytesToHex(v.c.merkleRoot(v.value)), v.hash_tree_root);
        }
      });
      should('profile', () => {
        const Square = SSZ.profile(Shape1, [], ['side', 'color']);
        const Circle = SSZ.profile(Shape1, [], ['color', 'radius']);
        const SquareOpt = SSZ.profile(Shape1, ['color'], ['side']);
        const CircleOpt = SSZ.profile(Shape1, ['radius'], ['color']);
        const SquareOpt2 = SSZ.profile(Shape1, ['color', 'side']);
        const CircleOpt2 = SSZ.profile(Shape1, ['radius', 'color']);
        deepStrictEqual(Square.size, 3);
        deepStrictEqual(Circle.size, 3);
        deepStrictEqual(Shape1.size, undefined);
        deepStrictEqual(SquareOpt.size, undefined);
        deepStrictEqual(SquareOpt2.size, undefined);
        deepStrictEqual(CircleOpt2.size, undefined);
        const VECTORS = [
          // Square
          {
            c: Shape1,
            value: { side: 0x42, color: 1 },
            serialized: '03420001',
            hash_tree_root: 'bfdb6fda9d02805e640c0f5767b8d1bb9ff4211498a5e2d7c0f36e1b88ce57ff',
          },
          {
            c: Square,
            value: { side: 0x42, color: 1 },
            serialized: '420001',
            hash_tree_root: 'bfdb6fda9d02805e640c0f5767b8d1bb9ff4211498a5e2d7c0f36e1b88ce57ff',
          },
          {
            c: SquareOpt,
            value: { side: 0x42, color: 1 },
            serialized: '01420001',
            hash_tree_root: 'bfdb6fda9d02805e640c0f5767b8d1bb9ff4211498a5e2d7c0f36e1b88ce57ff',
          },
          {
            c: SquareOpt2,
            value: { side: 0x42, color: 1 },
            serialized: '03420001', // Same as Shape1 (because no fields omitted before)
            hash_tree_root: 'bfdb6fda9d02805e640c0f5767b8d1bb9ff4211498a5e2d7c0f36e1b88ce57ff',
          },
          // Circle
          {
            c: Shape1,
            value: { color: 1, radius: 0x42 },
            serialized: '06014200',
            hash_tree_root: 'f66d2c38c8d2afbd409e86c529dff728e9a4208215ca20ee44e49c3d11e145d8',
          },
          {
            c: Circle,
            value: { color: 1, radius: 0x42 },
            serialized: '014200',
            hash_tree_root: 'f66d2c38c8d2afbd409e86c529dff728e9a4208215ca20ee44e49c3d11e145d8',
          },
          {
            c: CircleOpt,
            value: { color: 1, radius: 0x42 },
            serialized: '01014200',
            hash_tree_root: 'f66d2c38c8d2afbd409e86c529dff728e9a4208215ca20ee44e49c3d11e145d8',
          },
          {
            c: CircleOpt2,
            value: { color: 1, radius: 0x42 },
            serialized: '03014200', // different from Shape!
            hash_tree_root: 'f66d2c38c8d2afbd409e86c529dff728e9a4208215ca20ee44e49c3d11e145d8',
          },
        ];
        for (const v of VECTORS) {
          deepStrictEqual(bytesToHex(v.c.encode(v.value)), v.serialized, 'encode');
          deepStrictEqual(bytesToHex(v.c.merkleRoot(v.value)), v.hash_tree_root);
          deepStrictEqual(v.c.decode(hexToBytes(v.serialized)), v.value, 'decode');
        }
      });
      should('_isStableCompat', () => {
        // Field types are compatible with themselves.
        deepStrictEqual(SSZ.uint8._isStableCompat(SSZ.uint8), true);
        deepStrictEqual(SSZ.uint16._isStableCompat(SSZ.uint16), true);
        deepStrictEqual(SSZ.bitlist(5)._isStableCompat(SSZ.bitlist(5)), true);
        deepStrictEqual(SSZ.bitvector(5)._isStableCompat(SSZ.bitvector(5)), true);
        deepStrictEqual(SSZ.bitvector(5)._isStableCompat(SSZ.bitvector(6)), false);

        // byte is compatible with uint8 and vice versa.
        deepStrictEqual(SSZ.uint8._isStableCompat(SSZ.byte), true);
        deepStrictEqual(SSZ.byte._isStableCompat(SSZ.uint8), true);
        deepStrictEqual(SSZ.uint8._isStableCompat(SSZ.uint16), false);
        // Bitlist[N] / Bitvector[N] field types are compatible if they share the same capacity N.
        deepStrictEqual(SSZ.bitlist(5)._isStableCompat(SSZ.bitvector(5)), true);
        deepStrictEqual(SSZ.bitlist(5)._isStableCompat(SSZ.bitvector(6)), false);
        // List[T, N] / Vector[T, N] field types are compatible if T is compatible and if they also share the same capacity N.
        deepStrictEqual(SSZ.list(5, SSZ.byte)._isStableCompat(SSZ.vector(5, SSZ.uint8)), true);
        deepStrictEqual(SSZ.bytelist(5)._isStableCompat(SSZ.vector(5, SSZ.uint8)), true);
        deepStrictEqual(SSZ.bytevector(5)._isStableCompat(SSZ.vector(5, SSZ.uint8)), true);
        deepStrictEqual(SSZ.list(5, SSZ.byte)._isStableCompat(SSZ.vector(6, SSZ.uint8)), false);
        deepStrictEqual(SSZ.bytelist(5)._isStableCompat(SSZ.vector(6, SSZ.uint8)), false);
        deepStrictEqual(SSZ.bytevector(5)._isStableCompat(SSZ.vector(6, SSZ.uint8)), false);
        // Container / StableContainer[N] field types are compatible if all inner field types are compatible, if they also share the same field names in the same order, and for StableContainer[N] if they also share the same capacity N.
        const AF = { A: SSZ.uint8, B: SSZ.uint16, C: SSZ.uint32 };
        const BF = { A: SSZ.uint32, B: SSZ.uint16, C: SSZ.uint8 };
        const CF = { A: SSZ.uint32, B: SSZ.uint16 };
        // container-container
        deepStrictEqual(SSZ.container(AF)._isStableCompat(SSZ.container(AF)), true);
        deepStrictEqual(SSZ.container(AF)._isStableCompat(SSZ.container(BF)), false);
        deepStrictEqual(SSZ.container(AF)._isStableCompat(SSZ.container(CF)), false);
        // container-stable container
        deepStrictEqual(SSZ.container(AF)._isStableCompat(SSZ.stableContainer(5, AF)), true);
        deepStrictEqual(SSZ.container(BF)._isStableCompat(SSZ.stableContainer(5, AF)), false);
        // stable container-stable container
        deepStrictEqual(
          SSZ.stableContainer(5, AF)._isStableCompat(SSZ.stableContainer(5, AF)),
          true
        );
        deepStrictEqual(
          SSZ.stableContainer(6, AF)._isStableCompat(SSZ.stableContainer(5, AF)),
          false
        );
        // Profile[X] field types are compatible with StableContainer types compatible with X, and are compatible with Profile[Y] where Y is compatible with X if also all inner field types are compatible. Differences solely in optionality do not affect merkleization compatibility.
        const ASC = SSZ.stableContainer(5, AF);
        const BSC = SSZ.stableContainer(5, BF);
        // profile-stable container
        deepStrictEqual(SSZ.profile(ASC, ['A', 'B', 'C'])._isStableCompat(ASC), true);
        deepStrictEqual(SSZ.profile(ASC, ['A', 'B', 'C'])._isStableCompat(BSC), false);
        // profile -container
        deepStrictEqual(
          SSZ.profile(ASC, ['A', 'B', 'C'])._isStableCompat(SSZ.container(AF)),
          false
        );
        deepStrictEqual(
          SSZ.profile(ASC, ['A', 'B', 'C'])._isStableCompat(SSZ.container(BF)),
          false
        );
        // profile-profile
        deepStrictEqual(
          SSZ.profile(ASC, ['A', 'B', 'C'])._isStableCompat(SSZ.profile(ASC, ['A'])),
          true
        );
        deepStrictEqual(
          SSZ.profile(ASC, ['A', 'B', 'C'])._isStableCompat(SSZ.profile(BSC, ['A'])),
          false
        );
      });
    });
    describe('consensus-specs', () => {
      const SingleFieldTestStableStruct = SSZ.stableContainer(4, { A: SSZ.byte });
      const SmallTestStableStruct = SSZ.stableContainer(4, {
        A: SSZ.uint16,
        B: SSZ.uint16,
      });
      const FixedTestStableStruct = SSZ.stableContainer(4, {
        A: SSZ.uint8,
        B: SSZ.uint64,
        C: SSZ.uint32,
      });
      const VarTestStableStruct = SSZ.stableContainer(4, {
        A: SSZ.uint16,
        B: SSZ.list(1024, SSZ.uint16),
        C: SSZ.uint8,
      });
      const ComplexTestStableStruct = SSZ.stableContainer(8, {
        A: SSZ.uint16,
        B: SSZ.list(128, SSZ.uint16),
        C: SSZ.uint8,
        D: SSZ.bytelist(256),
        E: VarTestStableStruct,
        F: SSZ.vector(4, FixedTestStableStruct),
        G: SSZ.vector(2, VarTestStableStruct),
      });
      const BitsStableStruct = SSZ.stableContainer(8, {
        A: SSZ.bitlist(5),
        B: SSZ.bitvector(2),
        C: SSZ.bitvector(1),
        D: SSZ.bitlist(6),
        E: SSZ.bitvector(8),
      });
      should('stableContainer', () => {
        // https://github.com/ethereum/consensus-specs/files/15417175/ssz_generic_7495.tar.gz
        const VECTORS = parseVectors(SSZ_STABLE_PATH + 'stablecontainers/valid');
        const coders = {
          SingleFieldTestStableStruct,
          SmallTestStableStruct,
          FixedTestStableStruct,
          VarTestStableStruct,
          ComplexTestStableStruct,
          BitsStableStruct,
        };
        const nonNull = (x, r) => (x == null ? undefined : r(x));
        const cleanEmpty = (x) => {
          for (const k in x) if (x[k] === null || x[k] === undefined) delete x[k];
          return x;
        };
        for (const [k, v] of Object.entries(VECTORS)) {
          const sName = k.split('_')[0];
          //console.log('K', k, v);
          const c = coders[sName];
          let val = v.value;
          cleanEmpty(val);
          if (sName === 'BitsStableStruct') {
            val = {
              A: nonNull(v.value.A, (r) => SSZ.bitlist(5).decode(hexToBytes(r.slice(2)))),
              B: nonNull(v.value.B, (r) => SSZ.bitvector(2).decode(hexToBytes(r.slice(2)))),
              C: nonNull(v.value.C, (r) => SSZ.bitvector(1).decode(hexToBytes(r.slice(2)))),
              D: nonNull(v.value.D, (r) => SSZ.bitlist(6).decode(hexToBytes(r.slice(2)))),
              E: nonNull(v.value.E, (r) => SSZ.bitvector(8).decode(hexToBytes(r.slice(2)))),
            };
            cleanEmpty(val);
          } else if (sName === 'ComplexTestStableStruct') {
            if (val.A !== undefined) val.A = Number(val.A);
            if (val.B) val.B = val.B.map(Number);
            if (val.C !== undefined) val.C = Number(val.C);
            if (val.D !== undefined) val.D = hexToBytes(val.D.slice(2));
            if (val.E) {
              cleanEmpty(val.E);
              if (val.E.A !== undefined) val.E.A = Number(val.E.A);
              if (val.E.B !== undefined) val.E.B = val.E.B.map(Number);
              if (val.E.C !== undefined) val.E.C = Number(val.E.C);
            }
            if (val.F) {
              val.F = val.F.map(cleanEmpty);
              for (const i of val.F) {
                if (i.A !== undefined) i.A = Number(i.A);
                if (i.C !== undefined) i.C = Number(i.C);
              }
            }
            if (val.G) {
              val.G = val.G.map(cleanEmpty);
              for (const i of val.G) {
                if (i.A !== undefined) i.A = Number(i.A);
                if (i.B !== undefined) i.B = i.B.map(Number);
                if (i.C !== undefined) i.C = Number(i.C);
              }
            }
          } else if (sName === 'FixedTestStableStruct') {
            if (val.A !== undefined) val.A = Number(val.A);
            if (val.C !== undefined) val.C = Number(val.C);
          } else if (sName === 'SingleFieldTestStableStruct') {
            if (val.A !== undefined) val.A = Number(val.A);
          } else if (sName === 'SmallTestStableStruct') {
            if (val.A !== undefined) val.A = Number(val.A);
            if (val.B !== undefined) val.B = Number(val.B);
          } else if (sName === 'VarTestStableStruct') {
            if (val.A !== undefined) val.A = Number(val.A);
            if (val.B !== undefined) val.B = val.B.map(Number);
            if (val.C !== undefined) val.C = Number(val.C);
          }
          deepStrictEqual(c.decode(hexToBytes(v.hex)), val, 'decode');
          deepStrictEqual(bytesToHex(c.encode(val)), v.hex, 'encode');
          deepStrictEqual(`0x${bytesToHex(c.merkleRoot(val))}`, v.meta.root, 'hash');
        }
      });
      should('profile', () => {
        const SingleFieldTestProfile = SSZ.profile(SingleFieldTestStableStruct, [], ['A']);
        const SmallTestProfile1 = SSZ.profile(SmallTestStableStruct, [], ['A', 'B']);
        const SmallTestProfile2 = SSZ.profile(SmallTestStableStruct, [], ['A']);
        const SmallTestProfile3 = SSZ.profile(SmallTestStableStruct, [], ['B']);
        const FixedTestProfile1 = SSZ.profile(FixedTestStableStruct, [], ['A', 'B', 'C']);
        const FixedTestProfile2 = SSZ.profile(FixedTestStableStruct, [], ['A', 'B']);
        const FixedTestProfile3 = SSZ.profile(FixedTestStableStruct, [], ['A', 'C']);
        const FixedTestProfile4 = SSZ.profile(FixedTestStableStruct, [], ['C']);
        const VarTestProfile1 = SSZ.profile(VarTestStableStruct, [], ['A', 'B', 'C']);
        const VarTestProfile2 = SSZ.profile(VarTestStableStruct, [], ['B', 'C']);
        const VarTestProfile3 = SSZ.profile(VarTestStableStruct, [], ['B']);
        const ComplexTestProfile1 = SSZ.profile(
          ComplexTestStableStruct,
          [],
          ['A', 'B', 'C', 'D', 'E', 'F', 'G']
        );
        const ComplexTestProfile2 = SSZ.profile(
          ComplexTestStableStruct,
          [],
          ['A', 'B', 'C', 'D', 'E']
        );
        const ComplexTestProfile3 = SSZ.profile(ComplexTestStableStruct, [], ['A', 'C', 'E', 'G']);
        const ComplexTestProfile4 = SSZ.profile(ComplexTestStableStruct, [], ['B', 'D', 'F']);
        const ComplexTestProfile5 = SSZ.profile(ComplexTestStableStruct, [], ['E', 'F', 'G']);
        const BitsProfile1 = SSZ.profile(BitsStableStruct, [], ['A', 'B', 'C', 'D', 'E']);
        const BitsProfile2 = SSZ.profile(BitsStableStruct, [], ['A', 'B', 'C', 'D']);
        const BitsProfile3 = SSZ.profile(BitsStableStruct, [], ['A', 'D', 'E']);
        const coders = {
          SingleFieldTestProfile,
          SmallTestProfile1,
          SmallTestProfile2,
          SmallTestProfile3,
          FixedTestProfile1,
          FixedTestProfile2,
          FixedTestProfile3,
          FixedTestProfile4,
          VarTestProfile1,
          VarTestProfile2,
          VarTestProfile3,
          ComplexTestProfile1,
          ComplexTestProfile2,
          ComplexTestProfile3,
          ComplexTestProfile4,
          ComplexTestProfile5,
          BitsProfile1,
          BitsProfile2,
          BitsProfile3,
        };
        const VECTORS = parseVectors(SSZ_STABLE_PATH + 'profiles/valid');
        const nonNull = (x, r) => (x == null ? undefined : r(x));
        const cleanEmpty = (x) => {
          for (const k in x) if (x[k] === null || x[k] === undefined) delete x[k];
          return x;
        };
        for (const [k, v] of Object.entries(VECTORS)) {
          const sName = k.split('_')[0];
          //console.log('K', k, v);
          const c = coders[sName];
          let val = v.value;
          cleanEmpty(val);
          if (sName.startsWith('BitsProfile')) {
            val = {
              A: nonNull(v.value.A, (r) => SSZ.bitlist(5).decode(hexToBytes(r.slice(2)))),
              B: nonNull(v.value.B, (r) => SSZ.bitvector(2).decode(hexToBytes(r.slice(2)))),
              C: nonNull(v.value.C, (r) => SSZ.bitvector(1).decode(hexToBytes(r.slice(2)))),
              D: nonNull(v.value.D, (r) => SSZ.bitlist(6).decode(hexToBytes(r.slice(2)))),
              E: nonNull(v.value.E, (r) => SSZ.bitvector(8).decode(hexToBytes(r.slice(2)))),
            };
            cleanEmpty(val);
          } else if (sName.startsWith('ComplexTestProfile')) {
            if (val.A !== undefined) val.A = Number(val.A);
            if (val.B) val.B = val.B.map(Number);
            if (val.C !== undefined) val.C = Number(val.C);
            if (val.D !== undefined) val.D = hexToBytes(val.D.slice(2));
            if (val.E) {
              cleanEmpty(val.E);
              if (val.E.A !== undefined) val.E.A = Number(val.E.A);
              if (val.E.B !== undefined) val.E.B = val.E.B.map(Number);
              if (val.E.C !== undefined) val.E.C = Number(val.E.C);
            }
            if (val.F) {
              val.F = val.F.map(cleanEmpty);
              for (const i of val.F) {
                if (i.A !== undefined) i.A = Number(i.A);
                if (i.C !== undefined) i.C = Number(i.C);
              }
            }
            if (val.G) {
              val.G = val.G.map(cleanEmpty);
              for (const i of val.G) {
                if (i.A !== undefined) i.A = Number(i.A);
                if (i.B !== undefined) i.B = i.B.map(Number);
                if (i.C !== undefined) i.C = Number(i.C);
              }
            }
          } else if (sName.startsWith('FixedTestProfile')) {
            if (val.A !== undefined) val.A = Number(val.A);
            if (val.C !== undefined) val.C = Number(val.C);
          } else if (sName.startsWith('SingleFieldTestProfile')) {
            if (val.A !== undefined) val.A = Number(val.A);
          } else if (sName.startsWith('SmallTestProfile')) {
            if (val.A !== undefined) val.A = Number(val.A);
            if (val.B !== undefined) val.B = Number(val.B);
          } else if (sName.startsWith('VarTestProfile')) {
            if (val.A !== undefined) val.A = Number(val.A);
            if (val.B !== undefined) val.B = val.B.map(Number);
            if (val.C !== undefined) val.C = Number(val.C);
          }
          deepStrictEqual(c.decode(hexToBytes(v.hex)), val, 'decode');
          deepStrictEqual(bytesToHex(c.encode(val)), v.hex, 'encode');
          deepStrictEqual(`0x${bytesToHex(c.merkleRoot(val))}`, v.meta.root, 'hash');
        }
      });
      should('electra', () => {
        const TYPES = {
          ...SSZ.ETH2_TYPES,
          ...SSZ.ETH2_CONSENSUS,
          ...SSZ.ETH2_PROFILES.electra,
          //BeaconBlockBody: undefined,
        };
        for (const t of readStructVectors(`${SSZ_STABLE_PATH_2}/electra`)) {
          // should(`${t.type}/${t.name}`, () => {
            const { hex, meta, value, type } = t;
            const c = TYPES[type];
            if (!c) return;
            const val = mapTypes(type, true, value);
            deepStrictEqual(c.decode(c.encode(val)), val);
            deepStrictEqual(bytesToHex(c.encode(val)), hex);
            deepStrictEqual(c.decode(hexToBytes(hex)), val);
            deepStrictEqual(`0x${bytesToHex(c.merkleRoot(val))}`, meta.root);
          // });
        }
      });
    });
  });

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
    for (const t of readStructVectors(STATIC_PATH)) {
      should(`${t.type}/${t.name}`, () => {
        const { hex, meta, value, type } = t;
        const c = SSZ.ETH2_TYPES[type];
        const val = mapTypes(type, false, value);
        deepStrictEqual(c.decode(c.encode(val)), val);
        deepStrictEqual(bytesToHex(c.encode(val)), hex);
        deepStrictEqual(c.decode(hexToBytes(hex)), val);
        deepStrictEqual(`0x${bytesToHex(c.merkleRoot(val))}`, meta.root);
      });
    }
  });
});

should.runWhen(import.meta.url);
