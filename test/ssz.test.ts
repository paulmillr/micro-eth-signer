import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, notStrictEqual, throws } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import * as snappy from 'snappyjs';
import * as yaml from 'yaml';
import * as SSZ from '../src/advanced/ssz.ts';
import { __dirname } from './util.ts';

// https://github.com/ethereum/consensus-spec-tests
const PATH = './test/vectors/consensus-spec-tests/tests/general/phase0/ssz_generic/';
const STATIC_PATH = './test/vectors/consensus-spec-tests/tests/mainnet/deneb/ssz_static/';
const SSZ_PATH = `${__dirname}/vectors/ssz`;
const NEW_SSZ_PATH = `${__dirname}/vectors/ssz`;
const yamlOpt = { intAsBigInt: true };

// TODO: think about additional package to export vectors?
// Pros: less deps?
// Cons: need to sync after changes, bigints issues with json (need to add parser/decoder with bigint support)
const readGenericVectors = (path) => {
  const validVectors = {};
  const invalidVectors = {};
  for (const category of readdirSync(path)) {
    for (const valid of ['valid', 'invalid']) {
      for (const name of readdirSync(`${path}/${category}/${valid}`)) {
        const curPath = `${path}/${category}/${valid}/${name}`;
        const data = readFileSync(`${curPath}/serialized.ssz_snappy`);
        const hex = bytesToHex(snappy.uncompress(data));
        const fullName = `${category}/${name}`;

        if (valid === 'valid') {
          const meta = yaml.parse(readFileSync(`${curPath}/meta.yaml`, 'utf8'), yamlOpt);
          const value = yaml.parse(readFileSync(`${curPath}/value.yaml`, 'utf8'), yamlOpt);
          validVectors[fullName] = { meta, value, hex };
        } else {
          invalidVectors[fullName] = hex;
        }
      }
    }
  }
  return { valid: validVectors, invalid: invalidVectors };
};
const { valid: VALID, invalid: INVALID } = readGenericVectors(PATH);

function* readStructVectors(path) {
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
          [
            'ProgressiveAttestation',
            'Attestation',
            'ProgressiveBeaconBlockBody',
            'BeaconBlockBody',
          ].includes(type)
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
  should('ForkSlots', () => {
    deepStrictEqual(SSZ.ForkSlots, {
      Phase0: 0,
      Altair: 74240 * 32,
      Bellatrix: 144896 * 32,
      Capella: 194048 * 32,
      Deneb: 269568 * 32,
      Electra: 364032 * 32,
      Osaka: 411392 * 32,
    });
  });
  should('Electra request limits', () => {
    deepStrictEqual(
      {
        progressiveExecutionRequests:
          SSZ.ETH2_CONSENSUS.ProgressiveExecutionRequests.info.fields.consolidations.info.N,
        electraExecutionRequests:
          SSZ.ETH2_PROFILES.electra.ExecutionRequests.info.container.info.fields.consolidations.info
            .N,
      },
      {
        progressiveExecutionRequests: 2,
        electraExecutionRequests: 2,
      }
    );
  });
  should('Execution payload keeps execution requests separate', () => {
    const fields = [
      'parent_hash',
      'fee_recipient',
      'state_root',
      'receipts_root',
      'logs_bloom',
      'prev_randao',
      'block_number',
      'gas_limit',
      'gas_used',
      'timestamp',
      'extra_data',
      'base_fee_per_gas',
      'block_hash',
      'transactions',
      'withdrawals',
      'blob_gas_used',
      'excess_blob_gas',
    ];
    deepStrictEqual(
      {
        progressive: Object.keys(SSZ.ETH2_CONSENSUS.ProgressiveExecutionPayload.info.fields),
        electra: Object.keys(SSZ.ETH2_PROFILES.electra.ExecutionPayload.info.container.info.fields),
        bodyRequestFields: Object.keys(
          SSZ.ETH2_CONSENSUS.ProgressiveBeaconBlockBody.info.fields.execution_requests.info.fields
        ),
      },
      {
        progressive: fields,
        electra: fields,
        bodyRequestFields: ['deposits', 'withdrawals', 'consolidations'],
      }
    );
  });
  should('Execution payload header keeps execution requests separate', () => {
    const fields = [
      'parent_hash',
      'fee_recipient',
      'state_root',
      'receipts_root',
      'logs_bloom',
      'prev_randao',
      'block_number',
      'gas_limit',
      'gas_used',
      'timestamp',
      'extra_data',
      'base_fee_per_gas',
      'block_hash',
      'transactions_root',
      'withdrawals_root',
      'blob_gas_used',
      'excess_blob_gas',
    ];
    deepStrictEqual(
      {
        progressive: Object.keys(SSZ.ETH2_CONSENSUS.ProgressiveExecutionPayloadHeader.info.fields),
        electra: Object.keys(
          SSZ.ETH2_PROFILES.electra.ExecutionPayloadHeader.info.container.info.fields
        ),
        bodyRequestFields: Object.keys(
          SSZ.ETH2_CONSENSUS.ProgressiveBeaconBlockBody.info.fields.execution_requests.info.fields
        ),
      },
      {
        progressive: fields,
        electra: fields,
        bodyRequestFields: ['deposits', 'withdrawals', 'consolidations'],
      }
    );
  });
  should('Capella beacon block body carries full execution payload', () => {
    deepStrictEqual(
      Object.keys(
        SSZ.CapellaBeaconBlock.info.fields.body.info.fields.execution_payload.info.fields
      ),
      [
        'parent_hash',
        'fee_recipient',
        'state_root',
        'receipts_root',
        'logs_bloom',
        'prev_randao',
        'block_number',
        'gas_limit',
        'gas_used',
        'timestamp',
        'extra_data',
        'base_fee_per_gas',
        'block_hash',
        'transactions',
        'withdrawals',
      ]
    );
  });
  should('Bellatrix beacon block body carries full execution payload', () => {
    deepStrictEqual(
      Object.keys(
        SSZ.BellatrixBeaconBlock.info.fields.body.info.fields.execution_payload.info.fields
      ),
      [
        'parent_hash',
        'fee_recipient',
        'state_root',
        'receipts_root',
        'logs_bloom',
        'prev_randao',
        'block_number',
        'gas_limit',
        'gas_used',
        'timestamp',
        'extra_data',
        'base_fee_per_gas',
        'block_hash',
        'transactions',
      ]
    );
  });
  should('Phase0 beacon state carries pending attestation queues', () => {
    const fields = SSZ.Phase0BeaconState.info.fields;
    deepStrictEqual(
      {
        fields: Object.keys(fields),
        previousEpochAttestationsLimit: fields.previous_epoch_attestations?.info.N,
        currentEpochAttestationsLimit: fields.current_epoch_attestations?.info.N,
        previousEpochAttestationsInner:
          fields.previous_epoch_attestations?.info.inner === SSZ.ETH2_TYPES.PendingAttestation,
        currentEpochAttestationsInner:
          fields.current_epoch_attestations?.info.inner === SSZ.ETH2_TYPES.PendingAttestation,
      },
      {
        fields: [
          'genesis_time',
          'genesis_validators_root',
          'slot',
          'fork',
          'latest_block_header',
          'block_roots',
          'state_roots',
          'historical_roots',
          'eth1_data',
          'eth1_data_votes',
          'eth1_deposit_index',
          'validators',
          'balances',
          'randao_mixes',
          'slashings',
          'previous_epoch_attestations',
          'current_epoch_attestations',
          'justification_bits',
          'previous_justified_checkpoint',
          'current_justified_checkpoint',
          'finalized_checkpoint',
        ],
        previousEpochAttestationsLimit: 4096,
        currentEpochAttestationsLimit: 4096,
        previousEpochAttestationsInner: true,
        currentEpochAttestationsInner: true,
      }
    );
  });
  should('Default values are fresh', () => {
    const checkFresh = (coder, mutate, expected) => {
      const a = coder.default;
      const b = coder.default;
      notStrictEqual(a, b);
      mutate(a);
      deepStrictEqual(b, expected);
      deepStrictEqual(coder.default, expected);
    };
    checkFresh(SSZ.list(8, SSZ.uint8), (v) => v.push(1), []);
    checkFresh(SSZ.bitlist(8), (v) => v.push(true), []);
    checkFresh(
      SSZ.bitvector(4),
      (v) => {
        v[0] = true;
      },
      [false, false, false, false]
    );
    checkFresh(
      SSZ.bytelist(8),
      (v) => {
        v[0] = 1;
      },
      new Uint8Array()
    );
    checkFresh(
      SSZ.bytevector(4),
      (v) => {
        v[0] = 1;
      },
      new Uint8Array(4)
    );
    const vecList = SSZ.vector(2, SSZ.list(8, SSZ.uint8));
    const vecA = vecList.default;
    const vecB = vecList.default;
    notStrictEqual(vecA, vecB);
    notStrictEqual(vecA[0], vecA[1]);
    notStrictEqual(vecA[0], vecB[0]);
    vecA[0].push(1);
    deepStrictEqual(vecA, [[1], []]);
    deepStrictEqual(vecB, [[], []]);
    deepStrictEqual(vecList.default, [[], []]);
    checkFresh(
      SSZ.container({ a: SSZ.list(8, SSZ.uint8), b: SSZ.bytevector(2), c: SSZ.uint8 }),
      (v) => {
        v.a.push(1);
        v.b[0] = 2;
        v.c = 3;
      },
      { a: [], b: new Uint8Array(2), c: 0 }
    );
    checkFresh(
      SSZ.union(null, SSZ.uint8),
      (v) => {
        v.selector = 1;
      },
      { selector: 0, value: null }
    );
    checkFresh(SSZ.union(SSZ.list(8, SSZ.uint8), SSZ.uint8), (v) => v.value.push(1), {
      selector: 0,
      value: [],
    });
    checkFresh(
      SSZ.progressiveContainer([1], { a: SSZ.list(8, SSZ.uint8) }),
      (v) => {
        v.a.push(1);
      },
      { a: [] }
    );
    const progressive = SSZ.progressiveContainer([1, 1], {
      a: SSZ.list(8, SSZ.uint8),
      b: SSZ.uint8,
    });
    checkFresh(
      SSZ.profile(progressive, [], ['a', 'b']),
      (v) => {
        v.a.push(1);
        v.b = 2;
      },
      { a: [], b: 0 }
    );
  });
  should('Coder metadata is frozen', () => {
    const fields: any = { a: SSZ.list(4, SSZ.uint8), b: SSZ.bytevector(2) };
    const coder = SSZ.container(fields);
    fields.c = SSZ.uint16;
    deepStrictEqual(Object.keys(coder.info.fields), ['a', 'b']);
    deepStrictEqual(Object.isFrozen(fields), false);
    deepStrictEqual(Object.isFrozen(coder), true);
    deepStrictEqual(Object.isFrozen(coder.info), true);
    deepStrictEqual(Object.isFrozen(coder.info.fields), true);
    deepStrictEqual(Object.isFrozen(coder.info.fields.a), true);
    const progressive = SSZ.progressiveContainer([1], { a: SSZ.uint8 });
    deepStrictEqual(Object.isFrozen(progressive.info), true);
    deepStrictEqual(Object.isFrozen(progressive.info.activeFields), true);
    deepStrictEqual(Object.isFrozen(SSZ.ETH2_TYPES), true);
    deepStrictEqual(Object.isFrozen(SSZ.ETH2_TYPES.BeaconBlock.info.fields), true);
    deepStrictEqual(Object.isFrozen(SSZ.ETH2_CONSENSUS), true);
    deepStrictEqual(Object.isFrozen(SSZ.ETH2_PROFILES), true);
    deepStrictEqual(Object.isFrozen(SSZ.ETH2_PROFILES.electra), true);
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

  should('electra', () => {
    const TYPES = {
      ...SSZ.ETH2_TYPES,
      ...SSZ.ETH2_CONSENSUS,
      ...SSZ.ETH2_PROFILES.electra,
    };
    for (const t of readStructVectors(`${NEW_SSZ_PATH}/electra`)) {
      const { hex, meta, value, type } = t;
      const c = TYPES[type];
      if (!c) throw new Error(`missing Electra SSZ coder: ${type}`);
      const val = mapTypes(type, true, value);
      try {
        deepStrictEqual(c.decode(c.encode(val)), val, `${type}/${t.name}: roundtrip`);
        deepStrictEqual(bytesToHex(c.encode(val)), hex, `${type}/${t.name}: encode`);
        deepStrictEqual(c.decode(hexToBytes(hex)), val, `${type}/${t.name}: decode`);
        deepStrictEqual(`0x${bytesToHex(c.merkleRoot(val))}`, meta.root, `${type}/${t.name}: root`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`${type}/${t.name}: ${msg}`);
      }
    }
  });

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
    throws(() => coder4.encode([true, false, true]));
    throws(() => coder4.encode([true, false, true, false, true]));

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
    deepStrictEqual(bl256.encode([]), Uint8Array.of(1));
    deepStrictEqual(bl256.encode([false, true]), new Uint8Array([6]));
    deepStrictEqual(
      bl256.encode([false, false, false, true, true, false, false, false]),
      new Uint8Array([24, 1])
    );
    // decode
    deepStrictEqual(bl256.decode(Uint8Array.of(1)), []);
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
    const bl8 = SSZ.bitlist(8);
    const emptyRoot = Array.from(bl8.merkleRoot([]));
    const emptyChunks = bl8.chunks([]);
    emptyChunks[0][0] = 1;
    deepStrictEqual(bl8.chunks([]), [new Uint8Array(32)]);
    deepStrictEqual(Array.from(bl8.merkleRoot([])), emptyRoot);
    const emptyByteRoot = Array.from(SSZ.bytelist(31).merkleRoot(new Uint8Array([])));
    emptyChunks[0][0] = 2;
    deepStrictEqual(Array.from(SSZ.bytelist(31).merkleRoot(new Uint8Array([]))), emptyByteRoot);
    deepStrictEqual(Array.from(SSZ.bytelist(0).merkleRoot(new Uint8Array([]))), emptyByteRoot);
    throws(() => SSZ.bytelist(-1));
    throws(() => SSZ.bytelist(1.5));
    throws(() => SSZ.bytelist(Number.NaN));
  });

  should('List', () => {
    const emptyRoot = Array.from(SSZ.list(1, SSZ.uint8).merkleRoot([]));
    deepStrictEqual(Array.from(SSZ.list(0, SSZ.uint8).merkleRoot([])), emptyRoot);
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
      [[[], []], '0800000008000000'],
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
    const vlist2 = SSZ.vector(2, SSZ.list(8, SSZ.uint8));
    throws(() => vlist2.decode(new Uint8Array([])));
    throws(() => vlist2.decode(hexToBytes('04000000')));
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
        { selector: 0, value: null },
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
    const nullUnion = SSZ.union(null, SSZ.uint8);
    deepStrictEqual(nullUnion.default, { selector: 0, value: null });
    deepStrictEqual(bytesToHex(nullUnion.encode(nullUnion.default)), '00');
    deepStrictEqual(nullUnion.decode(hexToBytes('00')), { selector: 0, value: null });
    deepStrictEqual(bytesToHex(nullUnion.encode({ selector: 0, value: undefined })), '00');
    throws(() => nullUnion.encode({ selector: 0, value: 0 }));
    const nullValue = { selector: 0, value: null };
    const nullChunks = nullUnion.chunks(nullValue);
    deepStrictEqual(nullChunks, [new Uint8Array(32)]);
    const nullRoot = Array.from(nullUnion.merkleRoot(nullValue));
    nullChunks[0][0] = 1;
    deepStrictEqual(Array.from(nullUnion.merkleRoot(nullValue)), nullRoot);
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
