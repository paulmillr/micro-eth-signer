import { utils as butils, mark } from 'micro-bmark';

import { hexToBytes } from '@noble/curves/abstract/utils';
import { trustedSetup as s_fast } from '@paulmillr/trusted-setups/fast-peerdas.js';
import ckzg from 'c-kzg';
import * as kzg from '../../src/kzg.ts';
import { VECTORS } from '../peerdas.test.js';

function strip0x(hex) {
  return hex.replace(/^0[xX]/, '');
}

export async function main() {
  const PRECOMPUTE = 8;
  // NOTE: can do only once!
  let noble;
  // NOTE: FK20 setup is always done here, super fast (2s)
  await mark('init(ckzg)', 1, () => ckzg.loadTrustedSetup(PRECOMPUTE));
  await mark('init(noble)', 1, () => (noble = new kzg.KZG(s_fast)));
  // Compute cells
  {
    console.log('computeCells:');
    const t = VECTORS.compute_cells.valid[0];
    const blobBytes = hexToBytes(strip0x(t.input.blob));
    await mark('- ckzg', 500, () => ckzg.computeCells(blobBytes));
    await mark('- noble', 500, () => noble.computeCells(t.input.blob));
  }
  // compute_cells_and_kzg_proofs
  {
    console.log('computeCellsAndKzgProofs:');
    const t = VECTORS.compute_cells_and_kzg_proofs.valid[0];
    const blobBytes = hexToBytes(strip0x(t.input.blob));
    // NOTE: first one triggers FK20 setup (38s!)
    await mark('- noble (first)', 1, () => noble.computeCellsAndProofs(t.input.blob));
    await mark('- ckzg', 10, () => ckzg.computeCellsAndKzgProofs(blobBytes));
    await mark('- noble', 10, () => noble.computeCellsAndProofs(t.input.blob));
  }
  // recover_cells_and_kzg_proofs
  {
    console.log('recoverCellsAndKzgProofs:');
    const t = VECTORS.recover_cells_and_kzg_proofs.valid[0];
    const cells = t.input.cells.map((i) => hexToBytes(strip0x(i)));
    await mark('- ckzg', 10, () => ckzg.recoverCellsAndKzgProofs(t.input.cell_indices, cells));
    await mark('- noble', 10, () =>
      noble.recoverCellsAndProofs(t.input.cell_indices, t.input.cells)
    );
  }
  // verifyCellKzgProofBatch
  {
    console.log('verifyCellKzgProofBatch:');
    const t = VECTORS.verify_cell_kzg_proof_batch.valid[0];
    const commitments = t.input.commitments.map((i) => hexToBytes(strip0x(i)));
    const cells = t.input.cells.map((i) => hexToBytes(strip0x(i)));
    const proofs = t.input.proofs.map((i) => hexToBytes(strip0x(i)));
    await mark('- ckzg', 10, () =>
      ckzg.verifyCellKzgProofBatch(commitments, t.input.cell_indices, cells, proofs)
    );
    await mark('- noble', 10, () =>
      noble.verifyCellKzgProofBatch(
        t.input.commitments,
        t.input.cell_indices,
        t.input.cells,
        t.input.proofs
      )
    );
  }
  butils.logMem();
}

// ESM is broken.
import url from 'node:url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main();
}
