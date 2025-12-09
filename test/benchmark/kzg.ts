import { bench } from '@paulmillr/jsbt/bench.js';
import { trustedSetup as s_fast } from '@paulmillr/trusted-setups/fast-kzg.js';
import { trustedSetup } from '@paulmillr/trusted-setups/small-kzg.js';
import { loadKZG } from 'kzg-wasm';
import { deepStrictEqual as eql } from 'node:assert';
import * as kzg from '../../src/advanced/kzg.ts';
import { jsonGZ } from '../util.ts';

// Test cases
const VIEM = Object.fromEntries(
  [
    'blob-to-kzg-commitment',
    'blobs',
    'compute-blob-kzg-proof',
    'compute-kzg-proof',
    'invalid-blobs',
    'verify-blob-kzg-proof-batch',
    'verify-blob-kzg-proof',
    'verify-kzg-proof',
  ].map((i) => [i, jsonGZ(`../test/vectors/viem/test/kzg/${i}.json.gz`)])
);

const strip0x = (items) => items.map((i) => i.substring(2)).join('');

export async function main() {
  const opts = {
    n1: 4096,
    n2: 65,
    g1: strip0x(trustedSetup.g1_lagrange),
    g2: strip0x(trustedSetup.g2_monomial),
  };
  let mkzg, wkzg;

  await bench('init micro-eth-signer', () => {
    mkzg = new kzg.KZG(s_fast);
  }, 1);
  await bench('init kzg-wasm', async () => {
    wkzg = await loadKZG(opts)
  }, 1);

  const i0 = VIEM['blob-to-kzg-commitment'][1].input;
  const i1 = VIEM['compute-kzg-proof'][0].input;
  const i2 = VIEM['compute-blob-kzg-proof'][3].input;
  const i3 = VIEM['verify-kzg-proof'][0].input;
  const i4 = VIEM['verify-blob-kzg-proof'][0].input;
  const i5 = VIEM['verify-blob-kzg-proof-batch'][1].input;

  eql(mkzg.blobToKzgCommitment(i0.blob), wkzg.blobToKZGCommitment(i0.blob).toLowerCase());
  eql(
    mkzg.computeBlobProof(i2.blob, i2.commitment),
    wkzg.computeBlobKZGProof(i2.blob, i2.commitment).toLowerCase()
  );
  eql(
    mkzg.verifyProof(i3.commitment, i3.z, i3.y, i3.proof),
    wkzg.verifyKZGProof(i3.commitment, i3.z, i3.y, i3.proof)
  );
  eql(
    mkzg.verifyBlobProof(i4.blob, i4.commitment, i4.proof),
    wkzg.verifyBlobKZGProof(i4.blob, i4.commitment, i4.proof)
  );
  eql(
    mkzg.verifyBlobProofBatch(i5.blobs, i5.commitments, i5.proofs),
    wkzg.verifyBlobKZGProofBatch(i5.blobs, i5.commitments, i5.proofs)
  );
  async function benchSigner() {
    console.log();
    console.log('# micro-eth-signer');
    await bench('blobToKzgCommitment', () => mkzg.blobToKzgCommitment(i0.blob));
    await bench('computeProof', () => mkzg.computeProof(i1.blob, i1.z));
    await bench('computeBlobProof', () => mkzg.computeBlobProof(i2.blob, i2.commitment));
    await bench('verifyProof', () => mkzg.verifyProof(i3.commitment, i3.z, i3.y, i3.proof));
    await bench('verifyBlobProof', () =>
      mkzg.verifyBlobProof(i4.blob, i4.commitment, i4.proof)
    );
    await bench('verifyBlobProofBatch', () =>
      mkzg.verifyBlobProofBatch(i5.blobs, i5.commitments, i5.proofs)
    );
  }

  async function benchWasm() {
    console.log();
    console.log('# kzg-wasm');
    await bench('blobToKZGCommitment', () => wkzg.blobToKZGCommitment(i0.blob));
    // () => nobleKZG.computeProof(i1.blob, i1.z)
    await bench('computeBlobProof', () => wkzg.computeBlobKZGProof(i2.blob, i2.commitment));
    await bench('verifyProof', () => wkzg.verifyKZGProof(i3.commitment, i3.z, i3.y, i3.proof));
    await bench('verifyBlobProof', () =>
      wkzg.verifyBlobKZGProof(i4.blob, i4.commitment, i4.proof)
    );
    await bench('verifyBlobProofBatch', () =>
      wkzg.verifyBlobKZGProofBatch(i5.blobs, i5.commitments, i5.proofs)
    );
  }
  await benchSigner();
  await benchWasm();
}

// ESM is broken.
import url from 'node:url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main();
}
