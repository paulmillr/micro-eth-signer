import { deepStrictEqual, throws } from 'node:assert';
import { describe, should } from 'micro-should';
import { KZG } from '../esm/kzg.js';
import { jsonGZ } from './util.js';
import { default as KZG_VERIFY_PROOF } from './vectors/kzg/go_kzg_4844_verify_kzg_proof.json' with { type: 'json' };
import { trustedSetup as s_small } from '@paulmillr/trusted-setups';
import { trustedSetup as s_fast } from '@paulmillr/trusted-setups/fast.js';
import ROOTS_UN from './vectors/kzg/roots_of_unity.json' with { type: "json" };

// These are same as millions of yaml files in official repo, but easier to use
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
  ].map((i) => [i, () => jsonGZ(`./vectors/viem/test/kzg/${i}.json.gz`)])
);

const viem_verify_blog_kzg_proof = VIEM['verify-blob-kzg-proof']();

function run(kzg) {
  should('ROOTS_OF_UNITY', () => {
    deepStrictEqual(
      kzg.ROOTS_OF_UNITY, ROOTS_UN.map(BigInt)
    );
  });

  describe('VIEM', () => {
    should('parseBlob', () => {
      for (const b of VIEM['blobs']()) kzg.parseBlob(b);
      for (const b of VIEM['invalid-blobs']()) throws(() => kzg.parseBlob(b));
    });
    should('verifyProof', () => {
      for (const { input, output } of KZG_VERIFY_PROOF) {
        deepStrictEqual(kzg.verifyProof(input.commitment, input.z, input.y, input.proof), !!output);
      }
    });
    should('verifyProof2', () => {
      for (const { input, output } of VIEM['verify-kzg-proof']()) {
        deepStrictEqual(kzg.verifyProof(input.commitment, input.z, input.y, input.proof), !!output);
      }
    });
    should('computeChallenge', () => {
      const challengeStuff = viem_verify_blog_kzg_proof[25].input;
      deepStrictEqual(
        kzg.computeChallenge(kzg.parseBlob(challengeStuff.blob), kzg.parseG1(challengeStuff.commitment)),
        0x4f00eef944a21cb9f3ac3390702621e4bbf1198767c43c0fb9c8e9923bfbb31an
      );
    });
    should('evalPoly', () => {
      const polyStuff = viem_verify_blog_kzg_proof[18].input;
      deepStrictEqual(
        kzg.evalPoly(
          kzg.parseBlob(polyStuff.blob),
          0x637c904d316955b7282f980433d5cd9f40d0533c45d0a233c009bc7fe28b92e3n
        ),
        0x1bdfc5da40334b9c51220e8cbea1679c20a7f32dd3d7f3c463149bb4b41a7d18n
      );
    });
    should('verifyBlobProof', () => {
      for (const { input, output } of viem_verify_blog_kzg_proof) {
        deepStrictEqual(kzg.verifyBlobProof(input.blob, input.commitment, input.proof), !!output);
      }
    });
    should('verifyBlobProofBatch', () => {
      for (const { input, output } of VIEM['verify-blob-kzg-proof-batch']()) {
        deepStrictEqual(
          kzg.verifyBlobProofBatch(input.blobs, input.commitments, input.proofs),
          !!output
        );
      }
    });
    should('blobToKzgCommitment', () => {
      for (const { input, output } of VIEM['blob-to-kzg-commitment']()) {
        if (!output) throws(() => kzg.blobToKzgCommitment(input.blob));
        else deepStrictEqual(kzg.blobToKzgCommitment(input.blob), output);
      }
    });
    should('computeBlobProof', () => {
      for (const { input, output } of VIEM['compute-blob-kzg-proof']()) {
        if (!output) throws(() => kzg.computeBlobProof(input.blob, input.commitment));
        else deepStrictEqual(kzg.computeBlobProof(input.blob, input.commitment), output);
      }
    });
    should('computeKzgProof', () => {
      for (const { input, output } of VIEM['compute-kzg-proof']()) {
        if (!output) throws(() => kzg.computeProof(input.blob, input.z));
        else deepStrictEqual(kzg.computeProof(input.blob, input.z), output);
      }
    });
  });
}

// Comment-out until package is published
describe('KZG', () => {
  describe('trusted_setups/index.js', () => {
    run(new KZG(s_small));
  });
  describe('trusted_setups/fast.js', () => {
    run(new KZG(s_fast));
  });
});

should.runWhen(import.meta.url);
