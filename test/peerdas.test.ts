import { afterEach, describe, should } from '@paulmillr/jsbt/test.js';
import { Field } from '@noble/curves/abstract/modular.js';
import { bls12_381 as bls } from '@noble/curves/bls12-381.js';
import { bytesToHex, concatBytes } from '@noble/hashes/utils.js';
import { deepStrictEqual, throws } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import * as yaml from 'yaml';
import { KZG } from '../src/advanced/kzg.ts';
import { add0x } from '../src/utils.ts';
import { __dirname, forceGC } from './util.ts';

const yamlOpt = {};
const FE_PER_CELL = 64;
const { Fr: blsFr } = bls.fields;
const Fr = Field(blsFr.ORDER, { isLE: blsFr.isLE });

function* readFunctionVectorCases(name, invalid) {
  const path = `vectors/peerdas/kzg/${name}/kzg-mainnet`;
  for (const test of readdirSync(`${__dirname}/${path}`)) {
    const curPath = `${__dirname}/${path}/${test}`;
    const isInvalid = !test.includes('case_valid');
    if (isInvalid !== invalid) continue;
    const data = yaml.parse(readFileSync(`${curPath}/data.yaml`, 'utf8'), yamlOpt);
    yield { ...data, name: test };
  }
}

function readFunctionVectors(name) {
  const res = { valid: [], invalid: [] };
  for (const t of readFunctionVectorCases(name, false)) res.valid.push(t);
  for (const t of readFunctionVectorCases(name, true)) res.invalid.push(t);
  return res;
}

export const VECTORS = new Proxy(
  {},
  {
    get(_target, name) {
      if (typeof name !== 'string') return;
      return readFunctionVectors(name);
    },
  }
);

let KZG_CACHE_SETUP;
let KZG_CACHE;
const getKzg = async (setup) => {
  if (KZG_CACHE_SETUP !== setup || !KZG_CACHE) {
    if (KZG_CACHE) {
      KZG_CACHE = undefined;
      forceGC();
    }
    const { trustedSetup } =
      setup === 'fast'
        ? await import('@paulmillr/trusted-setups/fast-peerdas.js')
        : await import('@paulmillr/trusted-setups/small-peerdas.js');
    KZG_CACHE_SETUP = setup;
    KZG_CACHE = new KZG(trustedSetup);
  }
  return KZG_CACHE;
};
should('Cell.encode rejects non-canonical field elements', () => {
  const src = readFileSync(`${__dirname}/../src/advanced/kzg.ts`, 'utf8');
  const m = src.match(/encode\(fields: bigint\[\]\): string \{([\s\S]*?)\n  \},/);
  if (!m) throw new Error('failed to locate Cell.encode body');
  // Keep Cell private in the module API while still regression-testing its field invariant.
  const encode = new Function(
    'FE_PER_CELL',
    'Fr',
    'add0x',
    'bytesToHex',
    'concatBytes',
    `return function encode(fields) {${m[1]}\n};`
  )(FE_PER_CELL, Fr, add0x, bytesToHex, concatBytes) as (fields: bigint[]) => string;
  const canonical = Array.from({ length: FE_PER_CELL }, (_, i) => BigInt(i));
  const before = canonical.slice();
  deepStrictEqual(
    encode(canonical),
    add0x(bytesToHex(concatBytes(...canonical.map((i) => Fr.toBytes(i)))))
  );
  deepStrictEqual(canonical, before);
  const invalid = Array.from({ length: FE_PER_CELL }, () => Fr.ORDER);
  throws(() => encode(invalid), /invalid field element/);
});

function run(setup) {
  afterEach(forceGC);

  should('computeCells', async () => {
    const kzg = await getKzg(setup);
    for (const t of readFunctionVectorCases('compute_cells', false)) {
      deepStrictEqual(kzg.computeCells(t.input.blob), t.output);
    }
    for (const t of readFunctionVectorCases('compute_cells', true)) {
      throws(() => kzg.computeCells(t.input.blob));
    }
  });
  should('computeCellsAndKzgProofs', async () => {
    const kzg = await getKzg(setup);
    for (const t of readFunctionVectorCases('compute_cells_and_kzg_proofs', false)) {
      const res = kzg.computeCellsAndProofs(t.input.blob);
      deepStrictEqual(res[0], t.output[0]);
      deepStrictEqual(res[1], t.output[1]);
    }
    for (const t of readFunctionVectorCases('compute_cells_and_kzg_proofs', true)) {
      throws(() => kzg.computeCellsAndProofs(t.input.blob));
    }
  });

  should('recoverCellsAndProofs', async () => {
    const kzg = await getKzg(setup);
    for (const t of readFunctionVectorCases('recover_cells_and_kzg_proofs', false)) {
      const res = kzg.recoverCellsAndProofs(t.input.cell_indices, t.input.cells);
      // cells, proofs
      deepStrictEqual(res[0], t.output[0]);
      deepStrictEqual(res[1], t.output[1]);
    }
    for (const t of readFunctionVectorCases('recover_cells_and_kzg_proofs', true)) {
      throws(() => kzg.recoverCellsAndProofs(t.input.cell_indices, t.input.cells));
    }
  });
  should('verifyCellKzgProofBatch', async () => {
    const kzg = await getKzg(setup);
    for (const t of readFunctionVectorCases('verify_cell_kzg_proof_batch', false)) {
      deepStrictEqual(
        kzg.verifyCellKzgProofBatch(
          t.input.commitments,
          t.input.cell_indices,
          t.input.cells,
          t.input.proofs
        ),
        t.output
      );
    }

    for (const t of readFunctionVectorCases('verify_cell_kzg_proof_batch', true)) {
      let valid = true;
      try {
        valid = kzg.verifyCellKzgProofBatch(
          t.input.commitments,
          t.input.cell_indices,
          t.input.cells,
          t.input.proofs
        );
      } catch (e) {
        valid = false;
      }
      deepStrictEqual(valid, false);
    }
  });
}

describe('PeerDAS', () => {
  describe('trusted_setups/fast-peerdas.js', () => {
    run('fast');
  });
  describe('trusted_setups/small-peerdas.js', () => {
    run('small');
  });
});

should.runWhen(import.meta.url);
