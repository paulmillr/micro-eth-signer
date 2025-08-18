import { trustedSetup as s_fast } from '@paulmillr/trusted-setups/fast-kzg.js';
import { trustedSetup } from '@paulmillr/trusted-setups/small-kzg.js';
import { loadKZG } from 'kzg-wasm';
import { utils as butils, compare } from '@paulmillr/jsbt/bench.js';
import * as kzg from '../../src/kzg.ts';
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
  const wasmKZG = await loadKZG(opts);
  const nobleKZG = new kzg.KZG(s_fast);

  await compare('init', 1, {
    wasm: () => loadKZG(opts),
    noble: () => new kzg.KZG(s_fast),
  });

  const i0 = VIEM['blob-to-kzg-commitment'][1].input;
  deepStrictEqual(
    nobleKZG.blobToKzgCommitment(i0.blob),
    wasmKZG.blobToKZGCommitment(i0.blob).toLowerCase()
  );
  await compare('blobToKzgCommitment', 5, {
    wasm: () => wasmKZG.blobToKZGCommitment(i0.blob),
    noble: () => nobleKZG.blobToKzgCommitment(i0.blob),
  });

  const i1 = VIEM['compute-kzg-proof'][0].input;
  await compare('computeKzgProof', 100, {
    // wasm: () => wasmKZG.computeKzgProof(unhex(i1.blob), unhex(i1.z)),
    noble: () => nobleKZG.computeProof(i1.blob, i1.z),
  });

  const i2 = VIEM['compute-blob-kzg-proof'][3].input;
  deepStrictEqual(
    nobleKZG.computeBlobProof(i2.blob, i2.commitment),
    wasmKZG.computeBlobKZGProof(i2.blob, i2.commitment).toLowerCase()
  );
  await compare('computeBlobKzgProof', 5, {
    wasm: () => wasmKZG.computeBlobKZGProof(i2.blob, i2.commitment),
    noble: () => nobleKZG.computeBlobProof(i2.blob, i2.commitment),
  });

  const i3 = VIEM['verify-kzg-proof'][0].input;
  deepStrictEqual(
    nobleKZG.verifyProof(i3.commitment, i3.z, i3.y, i3.proof),
    wasmKZG.verifyKZGProof(i3.commitment, i3.z, i3.y, i3.proof)
  );
  await compare('verifyKzgProof', 200, {
    wasm: () => wasmKZG.verifyKZGProof(i3.commitment, i3.z, i3.y, i3.proof),
    noble: () => nobleKZG.verifyProof(i3.commitment, i3.z, i3.y, i3.proof),
  });

  const i4 = VIEM['verify-blob-kzg-proof'][0].input;
  deepStrictEqual(
    nobleKZG.verifyBlobProof(i4.blob, i4.commitment, i4.proof),
    wasmKZG.verifyBlobKZGProof(i4.blob, i4.commitment, i4.proof)
  );
  await compare('verifyBlobKzgProof', 100, {
    wasm: () => wasmKZG.verifyBlobKZGProof(i4.blob, i4.commitment, i4.proof),
    noble: () => nobleKZG.verifyBlobProof(i4.blob, i4.commitment, i4.proof),
  });

  const i5 = VIEM['verify-blob-kzg-proof-batch'][1].input;
  deepStrictEqual(
    nobleKZG.verifyBlobProofBatch(i5.blobs, i5.commitments, i5.proofs),
    wasmKZG.verifyBlobKZGProofBatch(i5.blobs, i5.commitments, i5.proofs)
  );
  await compare('verifyBlobKzgProofBatch', 10, {
    wasm: () => wasmKZG.verifyBlobKZGProofBatch(i5.blobs, i5.commitments, i5.proofs),
    noble: () => nobleKZG.verifyBlobProofBatch(i5.blobs, i5.commitments, i5.proofs),
  });

  butils.logMem();
}

// ESM is broken.
import { deepStrictEqual } from 'node:assert';
import url from 'node:url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main();
}

/*
M2, Nov 2024
init
├─wasm x 3 ops/sec @ 294ms/op
└─noble x 161 ops/sec @ 6ms/op
blobToKzgCommitment
├─wasm x 3 ops/sec @ 304ms/op
└─noble x 1 ops/sec @ 705ms/op
computeKzgProof
└─noble x 112 ops/sec @ 8ms/op
computeBlobKzgProof
├─wasm x 3 ops/sec @ 311ms/op
└─noble x 1 ops/sec @ 725ms/op
verifyKzgProof
├─wasm x 241 ops/sec @ 4ms/op
└─noble x 91 ops/sec @ 10ms/op
verifyBlobKzgProof
├─wasm x 109 ops/sec @ 9ms/op
└─noble x 59 ops/sec @ 16ms/op
verifyBlobKzgProofBatch
├─wasm x 15 ops/sec @ 64ms/op
└─noble x 14 ops/sec @ 71ms/op
*/
