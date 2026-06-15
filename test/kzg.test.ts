import { afterEach, describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, throws } from 'node:assert';
import { KZG } from '../src/advanced/kzg.ts';
import { forceGC, jsonGZItems } from './util.ts';
import { default as KZG_VERIFY_PROOF } from './vectors/kzg/go_kzg_4844_verify_kzg_proof.json' with { type: 'json' };
import ROOTS_UN from './vectors/kzg/roots_of_unity.json' with { type: 'json' };

// These are same as millions of yaml files in official repo, but easier to use
const viemItems = (name) => jsonGZItems(`./vectors/viem/test/kzg/${name}.json.gz`);
const viemItemAt = async (name, idx) => {
  let i = 0;
  for await (const item of viemItems(name)) {
    if (i++ === idx) return item;
  }
  throw new Error(`missing ${name} vector at index ${idx}`);
};

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
        ? await import('@paulmillr/trusted-setups/fast-kzg.js')
        : await import('@paulmillr/trusted-setups/small-kzg.js');
    KZG_CACHE_SETUP = setup;
    KZG_CACHE = new KZG(trustedSetup);
  }
  return KZG_CACHE;
};

function run(setup) {
  afterEach(forceGC);

  should('ROOTS_OF_UNITY', async () => {
    const kzg = await getKzg(setup);
    deepStrictEqual(kzg.ROOTS_OF_UNITY_BRP, ROOTS_UN.map(BigInt));
  });

  describe('VIEM', () => {
    should('parseBlob', async () => {
      const kzg = await getKzg(setup);
      for await (const b of viemItems('blobs')) kzg.parseBlob(b);
      for await (const b of viemItems('invalid-blobs')) throws(() => kzg.parseBlob(b));
    });
    should('verifyProof', async () => {
      const kzg = await getKzg(setup);
      for (const { input, output } of KZG_VERIFY_PROOF) {
        deepStrictEqual(kzg.verifyProof(input.commitment, input.z, input.y, input.proof), !!output);
      }
    });
    should('verifyProof2', async () => {
      const kzg = await getKzg(setup);
      for await (const { input, output } of viemItems('verify-kzg-proof')) {
        deepStrictEqual(kzg.verifyProof(input.commitment, input.z, input.y, input.proof), !!output);
      }
    });
    should('computeChallenge', async () => {
      const kzg = await getKzg(setup);
      const challengeStuff = (await viemItemAt('verify-blob-kzg-proof', 25)).input;
      deepStrictEqual(
        kzg.computeChallenge(
          kzg.parseBlob(challengeStuff.blob),
          kzg.parseG1(challengeStuff.commitment)
        ),
        0x4f00eef944a21cb9f3ac3390702621e4bbf1198767c43c0fb9c8e9923bfbb31an
      );
    });
    should('evalPoly', async () => {
      const kzg = await getKzg(setup);
      const polyStuff = (await viemItemAt('verify-blob-kzg-proof', 18)).input;
      deepStrictEqual(
        kzg.evalPoly(
          kzg.parseBlob(polyStuff.blob),
          0x637c904d316955b7282f980433d5cd9f40d0533c45d0a233c009bc7fe28b92e3n
        ),
        0x1bdfc5da40334b9c51220e8cbea1679c20a7f32dd3d7f3c463149bb4b41a7d18n
      );
    });
    should('verifyBlobProof', async () => {
      const kzg = await getKzg(setup);
      for await (const { input, output } of viemItems('verify-blob-kzg-proof')) {
        deepStrictEqual(kzg.verifyBlobProof(input.blob, input.commitment, input.proof), !!output);
      }
    });
    should('verifyBlobProofBatch', async () => {
      const kzg = await getKzg(setup);
      for await (const { input, output } of viemItems('verify-blob-kzg-proof-batch')) {
        deepStrictEqual(
          kzg.verifyBlobProofBatch(input.blobs, input.commitments, input.proofs),
          !!output
        );
      }
    });
    should('blobToKzgCommitment', async () => {
      const kzg = await getKzg(setup);
      for await (const { input, output } of viemItems('blob-to-kzg-commitment')) {
        if (!output) throws(() => kzg.blobToKzgCommitment(input.blob));
        else deepStrictEqual(kzg.blobToKzgCommitment(input.blob), output);
      }
      const shortBigint = [0n];
      const shortBigintBefore = shortBigint.slice();
      throws(() => kzg.blobToKzgCommitment(shortBigint), /Wrong blob length/);
      deepStrictEqual(shortBigint, shortBigintBefore);
      const shortString = ['0000000000000000000000000000000000000000000000000000000000000000'];
      const shortStringBefore = shortString.slice();
      throws(() => kzg.blobToKzgCommitment(shortString), /Wrong blob length/);
      deepStrictEqual(shortString, shortStringBefore);
    });
    should('computeBlobProof', async () => {
      const kzg = await getKzg(setup);
      for await (const { input, output } of viemItems('compute-blob-kzg-proof')) {
        if (!output) throws(() => kzg.computeBlobProof(input.blob, input.commitment));
        else deepStrictEqual(kzg.computeBlobProof(input.blob, input.commitment), output);
      }
    });
    should('computeKzgProof', async () => {
      const kzg = await getKzg(setup);
      for await (const { input, output } of viemItems('compute-kzg-proof')) {
        if (!output) throws(() => kzg.computeProof(input.blob, input.z));
        else deepStrictEqual(kzg.computeProof(input.blob, input.z), output);
      }
    });
  });
}

// Comment-out until package is published
describe('KZG', () => {
  describe('trusted_setups/index.js', () => {
    run('small');
  });
  describe('trusted_setups/fast.js', () => {
    run('fast');
  });
});

should.runWhen(import.meta.url);
