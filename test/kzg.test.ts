import { afterEach, describe, should } from '@paulmillr/jsbt/test.js';
import { pippenger } from '@noble/curves/abstract/curve.js';
import { Field } from '@noble/curves/abstract/modular.js';
import { bls12_381 as bls } from '@noble/curves/bls12-381.js';
import { deepStrictEqual, notStrictEqual, ok, strictEqual, throws } from 'node:assert';
import { readFileSync } from 'node:fs';
import { KZG } from '../src/kzg.ts';
import { __dirname, forceGC, jsonGZItems } from './util.ts';
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
const getTrustedSetup = async (setup) => {
  const { trustedSetup } =
    setup === 'fast'
      ? await import('@paulmillr/trusted-setups/fast-kzg.js')
      : await import('@paulmillr/trusted-setups/small-kzg.js');
  return trustedSetup;
};
const getKzg = async (setup) => {
  if (KZG_CACHE_SETUP !== setup || !KZG_CACHE) {
    if (KZG_CACHE) {
      KZG_CACHE = undefined;
      forceGC();
    }
    const trustedSetup = await getTrustedSetup(setup);
    KZG_CACHE_SETUP = setup;
    KZG_CACHE = new KZG(trustedSetup);
  }
  return KZG_CACHE;
};

const mod = (a, b) => {
  const res = a % b;
  return res >= 0n ? res : res + b;
};

const signed = (neg, n) => (neg ? -n : n);
const bits = (n) => (n === 0n ? 0 : n.toString(2).length);
const kzgSrc = readFileSync(`${__dirname}/../src/kzg.ts`, 'utf8');
const { Fr: blsFr } = bls.fields;
const TestFr = Field(blsFr.ORDER, { isLE: blsFr.isLE });

const kzgBigint = (name) => {
  const m = kzgSrc.match(
    new RegExp(
      `const ${name} =\\s*(?:/\\* @__PURE__ \\*/\\s*)?(?:BigInt\\(\\s*['"])?(0x[0-9a-f]+)(?:['"]\\s*\\)|n);`
    )
  );
  if (!m) throw new Error(`failed to locate ${name}`);
  return BigInt(m[1]);
};

const G1_ENDO_BETA = kzgBigint('G1_ENDO_BETA');
const G1_ENDO_LAMBDA = kzgBigint('G1_ENDO_LAMBDA');
const G1_ENDO_BASIS = [
  [G1_ENDO_LAMBDA, -1n],
  [1n, G1_ENDO_LAMBDA + 1n],
];
const G1_ENDO_SPLIT_MAX = 1n << 128n;
const divNearest = (num, den) => (num + (num >= 0n ? den : -den) / 2n) / den;
const splitScalarG1Body = kzgSrc.match(
  /function splitScalarG1\(k: bigint\): ScalarEndoParts \{([\s\S]*?)\n\}\n\nfunction endoG1Affine/
);
if (!splitScalarG1Body) throw new Error('failed to locate splitScalarG1 body');
// Keep splitScalarG1 private in the module API while still regression-testing scalar splitting.
const splitScalarG1 = new Function(
  'Fr',
  'G1_ENDO_BASIS',
  'G1_ENDO_SPLIT_MAX',
  'divNearest',
  '_0n',
  `return function splitScalarG1(k) {${splitScalarG1Body[1]}\n};`
)(TestFr, G1_ENDO_BASIS, G1_ENDO_SPLIT_MAX, divNearest, 0n);

function run(setup) {
  afterEach(forceGC);

  should('G1 endomorphism identities', () => {
    const G1 = bls.G1.Point;
    const Fp = bls.fields.Fp;
    const Fr = bls.fields.Fr;
    const beta = G1_ENDO_BETA;
    const lambda = G1_ENDO_LAMBDA;
    notStrictEqual(beta, 1n);
    strictEqual(Fp.mul(Fp.mul(beta, beta), beta), Fp.ONE);
    strictEqual(mod(lambda * lambda + lambda + 1n, Fr.ORDER), 0n);
    const points = [G1.BASE, 2n, 3n, 123456789n].map((k) =>
      typeof k === 'bigint' ? G1.BASE.multiply(k) : k
    );
    for (const p of points) {
      const { x, y } = p.toAffine();
      deepStrictEqual(
        G1.fromAffine({ x: Fp.mul(x, beta), y }).toBytes(true),
        p.multiply(lambda).toBytes(true)
      );
    }
  });

  should('splitScalarG1 reconstructs fixed scalars', () => {
    const Fr = bls.fields.Fr;
    const lambda = G1_ENDO_LAMBDA;
    const cases = [0n, 1n, 2n, Fr.ORDER - 1n, lambda, 0x123456789abcdef0123456789abcdefn];
    for (const scalar of cases) {
      const { k1neg, k1, k2neg, k2 } = splitScalarG1(scalar);
      strictEqual(mod(signed(k1neg, k1) + lambda * signed(k2neg, k2) - scalar, Fr.ORDER), 0n);
      ok(bits(k1) <= 128);
      ok(bits(k2) <= 128);
    }
  });

  should('constructor validates setup lengths', async () => {
    const trustedSetup = await getTrustedSetup(setup);
    // A truncated G2 setup previously made verifyProof catch an undefined access and return false.
    throws(
      () =>
        new KZG({
          ...trustedSetup,
          g1_lagrange: trustedSetup.g1_lagrange.slice(0, 4),
          g2_monomial: trustedSetup.g2_monomial.slice(0, 1),
        }),
      /g2_monomial/
    );
    throws(
      () =>
        new KZG({
          ...trustedSetup,
          g1_lagrange: trustedSetup.g1_lagrange.slice(0, 3),
          g2_monomial: trustedSetup.g2_monomial.slice(0, 2),
        }),
      /power of two/
    );
    throws(
      () =>
        new KZG({
          ...trustedSetup,
          g1_lagrange: [],
          g2_monomial: trustedSetup.g2_monomial.slice(0, 2),
        }),
      /power of two/
    );
  });

  should('ROOTS_OF_UNITY', async () => {
    const kzg = await getKzg(setup);
    deepStrictEqual(kzg.ROOTS_OF_UNITY_BRP, ROOTS_UN.map(BigInt));
  });

  should('G1msm matches noble pippenger on adversarial public inputs', async () => {
    const kzg = await getKzg(setup);
    const G1 = bls.G1.Point;
    const Fr = bls.fields.Fr;
    const encodePoint = (p) => (p.is0() ? G1.ZERO : p).toBytes(true);
    const basePoints = Array.from({ length: 32 }, (_, i) => G1.BASE.multiplyUnsafe(BigInt(i + 1)));
    const cases = [
      { points: [], scalars: [] },
      { points: [G1.ZERO], scalars: [11n] },
      {
        points: [basePoints[0], basePoints[0], basePoints[1], basePoints[2], G1.ZERO],
        scalars: [5n, 7n, 0n, Fr.ORDER - 1n, 9n],
      },
      {
        points: [basePoints[4], basePoints[4].negate(), basePoints[5], basePoints[5], G1.ZERO],
        scalars: [13n, 13n, 4n, 4n, 17n],
      },
      {
        points: Array.from({ length: 16 }, (_, i) =>
          i % 4 === 0 ? basePoints[7] : i % 4 === 1 ? basePoints[7].negate() : basePoints[i]
        ),
        scalars: new Array(16).fill(123n),
      },
      {
        points: Array.from({ length: 32 }, (_, i) =>
          i % 7 === 0
            ? G1.ZERO
            : i % 5 === 0
              ? basePoints[3]
              : i % 5 === 1
                ? basePoints[3].negate()
                : basePoints[i]
        ),
        scalars: Array.from({ length: 32 }, (_, i) =>
          i % 6 === 0 ? 0n : i % 6 === 1 ? 1n : i % 6 === 2 ? Fr.ORDER - 1n : BigInt(i * 17 + 3)
        ),
      },
      {
        points: Array.from({ length: 32 }, (_, i) => basePoints[i]),
        scalars: Array.from({ length: 32 }, (_, i) =>
          i % 5 === 0
            ? Fr.ORDER - BigInt(i + 1)
            : i % 5 === 1
              ? BigInt(i)
              : i % 5 === 2
                ? Fr.ORDER - 1n
                : BigInt(i + 1)
        ),
      },
    ];
    for (const { points, scalars } of cases) {
      deepStrictEqual(
        encodePoint(kzg.G1msm(points, scalars)),
        encodePoint(pippenger(G1, points, scalars))
      );
    }
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
      const zeroBlob = new Array(kzg.G1LB.length).fill(0n);
      const zeroExpected = `0x${'c0'.padEnd(96, '0')}`;
      deepStrictEqual(kzg.blobToKzgCommitment(zeroBlob), zeroExpected);
      const sparseBlob = zeroBlob.slice();
      const sparseIndex = Math.min(3, sparseBlob.length - 1);
      const sparseScalar = 123n;
      sparseBlob[sparseIndex] = sparseScalar;
      deepStrictEqual(
        kzg.blobToKzgCommitment(sparseBlob),
        `0x${kzg.G1LB[sparseIndex].multiply(sparseScalar).toHex(true)}`
      );
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
