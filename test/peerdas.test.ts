import { describe, should } from '@paulmillr/jsbt/test.js';
import { trustedSetup as s_fast } from '@paulmillr/trusted-setups/fast-peerdas.js';
import { trustedSetup as s_small } from '@paulmillr/trusted-setups/small-peerdas.js';
import { deepStrictEqual, throws } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import * as yaml from 'yaml';
import { KZG } from '../src/advanced/kzg.ts';
import { __dirname } from './util.ts';

const yamlOpt = {};

function parseFunctionVectors(path) {
  const res = {};
  for (const name of readdirSync(`${__dirname}/${path}`)) {
    res[name] = { valid: [], invalid: [] };
    for (const test of readdirSync(`${__dirname}/${path}/${name}/kzg-mainnet`)) {
      const curPath = `${__dirname}/${path}/${name}/kzg-mainnet/${test}`;
      const data = yaml.parse(readFileSync(`${curPath}/data.yaml`, 'utf8'), yamlOpt);
      const isInvalid = !test.includes('case_valid');
      res[name][isInvalid ? 'invalid' : 'valid'].push({ ...data, name: test });
    }
  }
  return res;
}
export const VECTORS = parseFunctionVectors('vectors/peerdas/kzg');

function run(kzg) {
  should('computeCells', () => {
    const tests = VECTORS.compute_cells;
    for (const t of tests.valid) {
      deepStrictEqual(kzg.computeCells(t.input.blob), t.output);
    }
    for (const t of tests.invalid) {
      throws(() => kzg.computeCells(t.input.blob));
    }
  });
  should('computeCellsAndKzgProofs', () => {
    const tests = VECTORS.compute_cells_and_kzg_proofs;
    for (const t of tests.valid) {
      const res = kzg.computeCellsAndProofs(t.input.blob);
      deepStrictEqual(res[0], t.output[0]);
      deepStrictEqual(res[1], t.output[1]);
    }
    for (const t of tests.invalid) {
      throws(() => kzg.computeCellsAndProofs(t.input.blob));
    }
  });

  should('recoverCellsAndProofs', () => {
    const tests = VECTORS.recover_cells_and_kzg_proofs;
    for (const t of tests.valid) {
      const res = kzg.recoverCellsAndProofs(t.input.cell_indices, t.input.cells);
      // cells, proofs
      deepStrictEqual(res[0], t.output[0]);
      deepStrictEqual(res[1], t.output[1]);
    }
    for (const t of tests.invalid) {
      throws(() => kzg.recoverCellsAndProofs(t.input.cell_indices, t.input.cells));
    }
  });
  should('verifyCellKzgProofBatch', () => {
    const tests = VECTORS.verify_cell_kzg_proof_batch;
    for (const t of tests.valid) {
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

    for (const t of tests.invalid) {
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
    run(new KZG(s_fast));
  });
  describe('trusted_setups/small-peerdas.js', () => {
    run(new KZG(s_small));
  });
});

should.runWhen(import.meta.url);
