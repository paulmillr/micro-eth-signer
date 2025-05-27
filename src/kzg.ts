// prettier-ignore
import {
  type PolyFn, type Polynomial,
  bitReversalPermutation, FFT, log2, poly, reverseBits, rootsOfUnity,
} from '@noble/curves/abstract/fft';
import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/abstract/utils';
import { bls12_381 as bls } from '@noble/curves/bls12-381';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { add0x, hexToNumber, strip0x } from './utils.ts';
/*
KZG for [EIP-4844](https://eips.ethereum.org/EIPS/eip-4844).

Docs:
- https://github.com/ethereum/c-kzg-4844
- https://github.com/ethereum/consensus-specs/blob/dev/specs/deneb/polynomial-commitments.md

TODO(high-level):
- data converted into blob by prepending 0x00 prefix on each chunk and ends with 0x80 terminator
  - Unsure how generic is this
  - There are up to 6 blob per tx
  - Terminator only added to the last blob
- sidecar: {blob, commitment, proof}
- Calculate versionedHash from commitment, which is included inside of tx
- if 'sidecars' inside of tx enabled:
  - envelope turns into 'wrapper'
  - rlp([tx, blobs, commitments, proofs])
  - this means there are two eip4844 txs: with sidecars and without
*/
const { Fr, Fp12 } = bls.fields;
const G1 = bls.G1.ProjectivePoint;
const G2 = bls.G2.ProjectivePoint;
type G1Point = typeof bls.G1.ProjectivePoint.BASE;
type G2Point = typeof bls.G2.ProjectivePoint.BASE;
type Scalar = string | bigint;
type Blob = string | string[] | bigint[];
const BLOB_REGEX = /.{1,64}/g; // TODO: is this valid?

function parseScalar(s: Scalar): bigint {
  if (typeof s === 'string') {
    s = strip0x(s);
    if (s.length !== 2 * Fr.BYTES) throw new Error('parseScalar: wrong format');
    s = BigInt(`0x${s}`);
  }
  if (!Fr.isValid(s)) throw new Error('parseScalar: invalid field element');
  return s;
}

function formatScalar(n: bigint) {
  return add0x(bytesToHex(numberToBytesBE(n, Fr.BYTES)));
}

function pairingVerify(a1: G1Point, a2: G2Point, b1: G1Point, b2: G2Point) {
  // Filter-out points at infinity, because pairingBatch will throw an error
  const pairs = [
    { g1: a1.negate(), g2: a2 },
    { g1: b1, g2: b2 },
  ].filter(({ g1, g2 }) => !G1.ZERO.equals(g1) && !G2.ZERO.equals(g2));
  const f = bls.pairingBatch(pairs, true);
  return Fp12.eql(f, Fp12.ONE);
}

function chunks<T>(arr: T[], len: number): T[][] {
  if (len <= 0) throw new Error('chunks: chunkSize must be > 0');
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += len) res.push(arr.slice(i, i + len));
  return res;
}

function chunkBytes(u8a: Uint8Array, len: number): Uint8Array[] {
  if (len <= 0) throw new Error('chunkBytes: chunk size must be > 0');
  const res: Uint8Array[] = [];
  for (let i = 0; i < u8a.length; i += len) res.push(u8a.subarray(i, i + len));
  return res;
}

function strideExtend(src: bigint[], stride: number, outLen: number): bigint[] {
  const dst = new Array<bigint>(outLen).fill(Fr.ZERO);
  for (let i = 0, pos = 0; i < src.length && pos < outLen; i++, pos += stride) dst[pos] = src[i];
  return dst;
}

// Official JSON format
export type SetupData = {
  g1_lagrange: string[];
  g2_monomial: string[];
  g1_monomial?: string[]; // Optional, for PeerDAS only!
  fk20?: string[];
};

// PEERDAS Constants
const FE_PER_EXT_BLOB = 8192;
const FE_PER_BLOB = 4096;
const FE_PER_CELL = 64;
const CELLS_PER_BLOB = FE_PER_BLOB / FE_PER_CELL; // 64
const CELLS_PER_EXT_BLOB = FE_PER_EXT_BLOB / FE_PER_CELL; // 128
const BYTES_PER_CELL = 2048;
const CIRCULANT_DOMAIN_SIZE = CELLS_PER_BLOB * 2; // 128
const FK20_STRIDE = FE_PER_EXT_BLOB / CIRCULANT_DOMAIN_SIZE;
// RBL = Reverse Bits Limited table
const CELL_INDICES_RBL: Readonly<number[]> = bitReversalPermutation(
  Array.from({ length: 128 }, (_, j) => j)
);

const Cell = {
  encode(fields: bigint[]): string {
    if (fields.length !== FE_PER_CELL)
      throw new Error(`Cell.encode: Expected ${FE_PER_CELL} field elements`);
    return add0x(bytesToHex(concatBytes(...fields.map(Fr.toBytes))));
  },
  decode(hex: string): bigint[] {
    const bytes = hexToBytes(strip0x(hex));
    if (bytes.length !== BYTES_PER_CELL)
      throw new Error(`Cell.decode: Expected ${BYTES_PER_CELL} bytes after decoding hex`);
    const fields = chunkBytes(bytes, Fr.BYTES).map(Fr.fromBytes);
    for (const f of fields) if (!Fr.isValid(f)) throw new Error('invalid fr');
    return fields;
  },
};

/**
 * KZG from [EIP-4844](https://eips.ethereum.org/EIPS/eip-4844).
 * @example
 * const kzg = new KZG(trustedSetupData);
 */
export class KZG {
  private readonly POLY_NUM: number;
  private readonly G1LB: G1Point[]; // lagrange brp
  private readonly G2M: G2Point[];
  private readonly G1M?: G1Point[];
  private readonly ROOTS_OF_UNITY_BRP: bigint[];
  private readonly ROOTS_CACHE: ReturnType<typeof rootsOfUnity>;
  private readonly fftFr: ReturnType<typeof FFT<bigint>>;
  private readonly fftG1: ReturnType<typeof FFT<G1Point>>;
  private readonly polyFr: PolyFn<bigint[], bigint>;
  // Should they be configurable?
  private readonly FIAT_SHAMIR_PROTOCOL_DOMAIN = utf8ToBytes('FSBLOBVERIFY_V1_');
  private readonly RANDOM_CHALLENGE_KZG_BATCH_DOMAIN = utf8ToBytes('RCKZGBATCH___V1_');
  private readonly POLY_NUM_BYTES: Uint8Array;
  // PeerDAS
  private fk20Columns?: G1Point[][];

  constructor(setup: SetupData & { encoding?: 'fast_v1' }) {
    if (setup == null || typeof setup !== 'object') throw new Error('expected valid setup data');
    if (!Array.isArray(setup.g1_lagrange) || !Array.isArray(setup.g2_monomial))
      throw new Error('expected valid setup data');
    // The slowest part
    let fastSetup = false;
    if ('encoding' in setup) {
      fastSetup = setup.encoding === 'fast_v1';
      if (!fastSetup) throw new Error('unknown encoding ' + setup.encoding);
    }
    const G1L = setup.g1_lagrange.map(fastSetup ? this.parseG1Unchecked : this.parseG1);
    this.POLY_NUM = G1L.length;
    this.G2M = setup.g2_monomial.map(fastSetup ? this.parseG2Unchecked : this.parseG2);
    this.G1LB = bitReversalPermutation(G1L);
    this.ROOTS_CACHE = rootsOfUnity(Fr, 7n);
    this.ROOTS_OF_UNITY_BRP = this.ROOTS_CACHE.brp(log2(this.POLY_NUM));
    this.fftFr = FFT(this.ROOTS_CACHE, Fr);
    this.fftG1 = FFT<G1Point>(rootsOfUnity(Fr, 7n), {
      add: (a, b) => a.add(b),
      sub: (a, b) => a.subtract(b),
      mul: (a, scalar) => a.multiplyUnsafe(scalar),
      inv: Fr.inv,
    });
    this.polyFr = poly(Fr, this.ROOTS_CACHE);
    this.POLY_NUM_BYTES = numberToBytesBE(this.POLY_NUM, 8);
    if (setup.g1_monomial) {
      this.G1M = setup.g1_monomial.map(fastSetup ? this.parseG1Unchecked : this.parseG1);
    }
    if (setup.fk20) {
      this.fk20Columns = chunks(
        setup.fk20.map(fastSetup ? this.parseG1Unchecked : this.parseG1),
        FE_PER_CELL
      );
    }
  }
  // Internal
  private parseG1(p: string | G1Point) {
    if (typeof p === 'string') p = G1.fromHex(strip0x(p));
    return p;
  }
  private parseG1Unchecked(p: string) {
    if (typeof p !== 'string') throw new Error('string expected');
    const [x, y] = p.split(' ').map(hexToNumber);
    return G1.fromAffine({ x, y });
  }
  private parseG2(p: string) {
    return G2.fromHex(strip0x(p));
  }
  private parseG2Unchecked(p: string) {
    const xy = strip0x(p)
      .split(' ')
      .map((c) => c.split(',').map((c) => BigInt('0x' + c))) as unknown as [bigint, bigint][];
    const x = bls.fields.Fp2.fromBigTuple(xy[0]);
    const y = bls.fields.Fp2.fromBigTuple(xy[1]);
    return G2.fromAffine({ x, y });
  }
  private parseBlob(blob: Blob) {
    if (typeof blob === 'string') {
      blob = strip0x(blob);
      if (blob.length !== this.POLY_NUM * Fr.BYTES * 2) throw new Error('Wrong blob length');
      const m = blob.match(BLOB_REGEX);
      if (!m) throw new Error('Wrong blob');
      blob = m;
    }
    return blob.map(parseScalar);
  }
  private invSafe(inverses: bigint[]) {
    inverses = Fr.invertBatch(inverses);
    for (const i of inverses) if (i === undefined) throw new Error('invSafe: division by zero');
    return inverses;
  }
  private G1msm(points: G1Point[], scalars: bigint[]) {
    // Filters zero scalars, non-const time, but improves computeProof up to x93 for empty blobs
    const _points = [];
    const _scalars = [];
    for (let i = 0; i < scalars.length; i++) {
      const s = scalars[i];
      if (Fr.is0(s)) continue;
      _points.push(points[i]);
      _scalars.push(s);
    }
    return G1.msm(_points, _scalars);
  }
  private computeChallenge(blob: bigint[], commitment: G1Point): bigint {
    const h = sha256
      .create()
      .update(this.FIAT_SHAMIR_PROTOCOL_DOMAIN)
      .update(numberToBytesBE(0, 8))
      .update(this.POLY_NUM_BYTES);
    for (const b of blob) h.update(numberToBytesBE(b, Fr.BYTES));
    h.update(commitment.toRawBytes(true));
    const res = Fr.create(bytesToNumberBE(h.digest()));
    h.destroy();
    return res;
  }
  private evalPoly(poly: bigint[], x: bigint) {
    return this.polyFr.lagrange.eval(poly, x, true);
  }

  // Basic
  computeProof(blob: Blob, z: bigint | string): [string, string] {
    z = parseScalar(z);
    blob = this.parseBlob(blob);
    const y = this.evalPoly(blob, z);
    const batch = [];
    let rootOfUnityPos: undefined | number;
    const poly = new Array(this.POLY_NUM).fill(Fr.ZERO);
    for (let i = 0; i < this.POLY_NUM; i++) {
      if (Fr.eql(z, this.ROOTS_OF_UNITY_BRP[i])) {
        rootOfUnityPos = i;
        batch.push(Fr.ONE);
        continue;
      }
      poly[i] = Fr.sub(blob[i], y);
      batch.push(Fr.sub(this.ROOTS_OF_UNITY_BRP[i], z));
    }
    const inverses = this.invSafe(batch);
    for (let i = 0; i < this.POLY_NUM; i++) poly[i] = Fr.mul(poly[i], inverses[i]);
    if (rootOfUnityPos !== undefined) {
      poly[rootOfUnityPos] = Fr.ZERO;
      for (let i = 0; i < this.POLY_NUM; i++) {
        if (i === rootOfUnityPos) continue;
        batch[i] = Fr.mul(Fr.sub(z, this.ROOTS_OF_UNITY_BRP[i]), z);
      }
      const inverses = this.invSafe(batch);
      for (let i = 0; i < this.POLY_NUM; i++) {
        if (i === rootOfUnityPos) continue;
        poly[rootOfUnityPos] = Fr.add(
          poly[rootOfUnityPos],
          Fr.mul(Fr.mul(Fr.sub(blob[i], y), this.ROOTS_OF_UNITY_BRP[i]), inverses[i])
        );
      }
    }
    const proof = add0x(this.G1msm(this.G1LB, poly).toHex(true));
    return [proof, formatScalar(y)];
  }
  verifyProof(commitment: string, z: Scalar, y: Scalar, proof: string): boolean {
    try {
      z = parseScalar(z);
      y = parseScalar(y);
      const g2x = Fr.is0(z) ? G2.ZERO : G2.BASE.multiply(z);
      const g1y = Fr.is0(y) ? G1.ZERO : G1.BASE.multiply(y);
      const XminusZ = this.G2M[1].subtract(g2x);
      const PminusY = this.parseG1(commitment).subtract(g1y);
      return pairingVerify(PminusY, G2.BASE, this.parseG1(proof), XminusZ);
    } catch (e) {
      return false;
    }
  }
  private getRPowers(r: bigint, n: number) {
    const rPowers = [];
    if (n !== 0) {
      rPowers.push(Fr.ONE);
      for (let i = 1; i < n; i++) rPowers[i] = Fr.mul(rPowers[i - 1], r);
    }
    return rPowers;
  }
  // There are no test vectors for this
  private verifyProofBatch(commitments: G1Point[], zs: bigint[], ys: bigint[], proofs: string[]) {
    const n = commitments.length;
    const p: G1Point[] = proofs.map((i) => this.parseG1(i));
    const h = sha256
      .create()
      .update(this.RANDOM_CHALLENGE_KZG_BATCH_DOMAIN)
      .update(this.POLY_NUM_BYTES)
      .update(numberToBytesBE(n, 8));
    for (let i = 0; i < n; i++) {
      h.update(commitments[i].toRawBytes(true));
      h.update(Fr.toBytes(zs[i]));
      h.update(Fr.toBytes(ys[i]));
      h.update(p[i].toRawBytes(true));
    }
    const r = Fr.create(bytesToNumberBE(h.digest()));
    h.destroy();
    const rPowers = this.getRPowers(r, n);
    const proofPowers = this.G1msm(p, rPowers);
    const CminusY = commitments.map((c, i) =>
      c.subtract(Fr.is0(ys[i]) ? G1.ZERO : G1.BASE.multiply(ys[i]))
    );
    const RtimesZ = rPowers.map((p, i) => Fr.mul(p, zs[i]));
    const rhs = this.G1msm(p.concat(CminusY), RtimesZ.concat(rPowers));
    return pairingVerify(proofPowers, this.G2M[1], rhs, G2.BASE);
  }
  // Blobs
  blobToKzgCommitment(blob: Blob): string {
    return add0x(this.G1msm(this.G1LB, this.parseBlob(blob)).toHex(true));
  }
  computeBlobProof(blob: Blob, commitment: string): string {
    blob = this.parseBlob(blob);
    const challenge = this.computeChallenge(blob, this.parseG1(commitment));
    const [proof, _] = this.computeProof(blob, challenge);
    return proof;
  }
  verifyBlobProof(blob: Blob, commitment: string, proof: string): boolean {
    try {
      blob = this.parseBlob(blob);
      const c = this.parseG1(commitment);
      const challenge = this.computeChallenge(blob, c);
      const y = this.evalPoly(blob, challenge);
      return this.verifyProof(commitment, challenge, y, proof);
    } catch (e) {
      return false;
    }
  }
  verifyBlobProofBatch(blobs: string[], commitments: string[], proofs: string[]): boolean {
    if (!Array.isArray(blobs) || !Array.isArray(commitments) || !Array.isArray(proofs))
      throw new Error('invalid arguments');
    if (blobs.length !== commitments.length || blobs.length !== proofs.length) return false;
    if (blobs.length === 1) return this.verifyBlobProof(blobs[0], commitments[0], proofs[0]);
    try {
      const b = blobs.map((i) => this.parseBlob(i));
      const c = commitments.map(this.parseG1);
      const challenges = b.map((b, i) => this.computeChallenge(b, c[i]));
      const ys = b.map((_, i) => this.evalPoly(b[i], challenges[i]));
      return this.verifyProofBatch(c, challenges, ys, proofs);
    } catch (e) {
      return false;
    }
  }
  // PeerDAS (https://eips.ethereum.org/EIPS/eip-7594)
  private Fk20Precomputes = (): G1Point[][] => {
    if (!this.G1M) throw new Error('PeerDAS requires full kzg setup (with G1 monomial)');
    if (this.fk20Columns) return this.fk20Columns;
    // This is very slow and takes 38s on first run!
    const columns: G1Point[][] = Array.from(
      { length: CIRCULANT_DOMAIN_SIZE },
      () => new Array(FE_PER_CELL)
    );
    const G1Mrev_chunks = chunks(Array.from(this.G1M).reverse(), FE_PER_CELL);
    const xExt = new Array<G1Point>(CIRCULANT_DOMAIN_SIZE).fill(G1.ZERO);
    for (let offset = 0; offset < FE_PER_CELL; offset++) {
      for (let i = 0; i < CELLS_PER_BLOB - 1; i++) xExt[i] = G1Mrev_chunks[i + 1][offset];
      // FFT call is 600ms here, while in Rust it's 45ms. Issue is mostly with Point#multiply:
      // Rust
      // RUST mul=47951 add=2    sub=3 (microseconds)
      // JS: mul=597947 add=2613 sub=2653
      // It could be optimized ~5x by copying optimizations from C:
      // - GLV endomorphism
      // - Windowed booth encode multiplication (wnaf-like stuff)
      const res = this.fftG1.direct(xExt);
      for (let row = 0; row < CIRCULANT_DOMAIN_SIZE; row++) columns[row][offset] = res[row];
    }
    this.fk20Columns = columns;
    return columns;
  };
  private Fk20Proof = (poly: Polynomial<bigint>): string[] => {
    const precomputes = this.Fk20Precomputes(); // 128x64
    if (poly.length !== FE_PER_BLOB) throw new Error('Fk20Proof: wrong poly');
    const coeffs: bigint[][] = Array.from({ length: CIRCULANT_DOMAIN_SIZE }, () =>
      new Array(FE_PER_CELL).fill(Fr.ZERO)
    );
    for (let i = 0; i < FE_PER_CELL; i++) {
      const toeplitz = new Array<bigint>(CIRCULANT_DOMAIN_SIZE).fill(Fr.ZERO);
      toeplitz[0] = poly[FE_PER_BLOB - 1 - i];
      for (let j = 0; j < CELLS_PER_EXT_BLOB - CELLS_PER_BLOB - 2; j++) {
        toeplitz[CELLS_PER_BLOB + 2 + j] = poly[CELLS_PER_EXT_BLOB - i - 1 + j * FE_PER_CELL];
      }
      const res = this.fftFr.direct(toeplitz);
      for (let j = 0; j < CIRCULANT_DOMAIN_SIZE; j++) coeffs[j][i] = res[j];
    }
    const hExtFFT = [];
    for (let i = 0; i < CIRCULANT_DOMAIN_SIZE; i++)
      hExtFFT.push(this.G1msm(precomputes[i], coeffs[i]));
    const h = this.fftG1.inverse(hExtFFT);
    for (let i = CELLS_PER_BLOB; i < CIRCULANT_DOMAIN_SIZE; i++) h[i] = G1.ZERO;
    return this.fftG1.direct(h, false, true).map((p) => add0x(p.toHex(true)));
  };
  private getCells(blob: string) {
    if (!this.G1M) throw new Error('PeerDAS requires full kzg setup (with G1 monomial)');
    // Convert compact poly into extended
    const blobParsed = this.parseBlob(blob);
    const polyMShort = this.fftFr.inverse(blobParsed, true);
    const extendedEvalBRP = this.fftFr.direct(
      strideExtend(polyMShort, 1, FE_PER_EXT_BLOB),
      false,
      true
    );
    const cells = chunks(extendedEvalBRP, FE_PER_CELL).map(Cell.encode);
    return { cells, polyMShort };
  }
  computeCells(blob: string): string[] {
    return this.getCells(blob).cells;
  }
  computeCellsAndProofs(blob: string): [string[], string[]] {
    const { cells, polyMShort } = this.getCells(blob);
    const proofs = this.Fk20Proof(polyMShort);
    return [cells, proofs];
  }
  private recoverCell(indices: number[], recoveredCellsNulls: (bigint | null)[]) {
    const PEERDAS_RECOVERY_SHIFT = 7n;
    const PEERDAS_RECOVERY_SHIFT_INV = Fr.inv(7n);
    const cellsBRP: (bigint | null)[] = new Array(FE_PER_EXT_BLOB);
    for (let i = 0; i < FE_PER_EXT_BLOB; i++)
      cellsBRP[reverseBits(i, log2(FE_PER_EXT_BLOB))] = recoveredCellsNulls[i];
    const cellsBRPFull = bitReversalPermutation(recoveredCellsNulls);
    const missingIndicesBRP: number[] = [];
    const indicesSet = new Set(indices);
    for (let i = 0; i < CELLS_PER_EXT_BLOB; i++)
      if (!indicesSet.has(i)) missingIndicesBRP.push(reverseBits(i, log2(CELLS_PER_EXT_BLOB)));
    if (missingIndicesBRP.length === 0 || missingIndicesBRP.length >= CELLS_PER_EXT_BLOB)
      throw new Error('Invalid number of missing cells for vanishing polynomial');
    const roots = [];
    const extRoots = this.ROOTS_CACHE.roots(log2(FE_PER_EXT_BLOB));
    for (let i = 0; i < missingIndicesBRP.length; i++)
      roots.push(extRoots[missingIndicesBRP[i] * FK20_STRIDE]);
    const shortVanishing = this.polyFr.vanishing(roots);
    const vanishing = strideExtend(shortVanishing, FE_PER_CELL, FE_PER_EXT_BLOB);
    const vanishingEval = this.fftFr.direct(vanishing);
    const extendedEvalZero = [];
    for (let i = 0; i < FE_PER_EXT_BLOB; i++) {
      const v = cellsBRPFull[i];
      extendedEvalZero.push(v === null ? Fr.ZERO : Fr.mul(v, vanishingEval[i]));
    }
    const extendedCoset = this.fftFr.direct(
      this.polyFr.shift(this.fftFr.inverse(extendedEvalZero), PEERDAS_RECOVERY_SHIFT)
    );
    const vanishingShifted = this.polyFr.shift(vanishing, PEERDAS_RECOVERY_SHIFT);
    const vanishingCoset = this.fftFr.direct(vanishingShifted);
    const reconstructedCoset = [];
    for (let i = 0; i < FE_PER_EXT_BLOB; i++)
      reconstructedCoset.push(Fr.div(extendedCoset[i], vanishingCoset[i]));
    return this.fftFr.direct(
      this.polyFr.shift(this.fftFr.inverse(reconstructedCoset), PEERDAS_RECOVERY_SHIFT_INV),
      false,
      true
    );
  }
  recoverCellsAndProofs(indices: number[], cells: string[]): [string[], string[]] {
    if (cells.length !== indices.length)
      throw new Error('Indices and cells array lengths mismatch');
    if (indices.length > CELLS_PER_EXT_BLOB)
      throw new Error(`Too many cells provided (${indices.length} > ${CELLS_PER_EXT_BLOB})`);
    if (indices.length < CELLS_PER_BLOB)
      throw new Error(
        `Not enough cells provided (${indices.length} < ${CELLS_PER_BLOB}) for recovery`
      );
    const uniqueIndices = new Set<number>();
    for (const idx of indices) {
      if (idx >= CELLS_PER_EXT_BLOB || idx < 0) throw new Error(`Invalid cell index found: ${idx}`);
      if (uniqueIndices.has(idx)) throw new Error(`Duplicate cell index found: ${idx}`);
      uniqueIndices.add(idx);
    }
    const recoveredCellsNulls: (bigint | null)[] = new Array(FE_PER_EXT_BLOB).fill(null);
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const fields = Cell.decode(cells[i]);
      for (let j = 0; j < FE_PER_CELL; j++) recoveredCellsNulls[idx * FE_PER_CELL + j] = fields[j];
    }
    let recoveredCells: bigint[];
    if (indices.length === CELLS_PER_EXT_BLOB) {
      // TODO: this should not happen. Need to think about better construction that will enforce this
      // perhaps uniqueIndices.size() == indices.length?
      if (recoveredCellsNulls.some((f) => f === null))
        throw new Error('Internal error: Null found even when all cells provided');
      recoveredCells = recoveredCellsNulls as bigint[];
    } else {
      recoveredCells = this.recoverCell(indices, recoveredCellsNulls);
    }
    const allCells = chunks(recoveredCells, FE_PER_CELL).map(Cell.encode);
    const proofs = this.Fk20Proof(this.fftFr.inverse(recoveredCells, true).slice(0, FE_PER_BLOB));
    return [allCells, proofs];
  }
  /**
   * Why it's slow: fromHex & assertValidity, too many points in commitments
   */
  verifyCellKzgProofBatch(
    commitments: string[],
    indices: number[],
    cells: string[],
    proofs: string[]
  ): boolean {
    if (!this.G1M) throw new Error('PeerDAS requires full kzg setup (with G1 monomial)');
    if (
      commitments.length !== cells.length ||
      indices.length !== cells.length ||
      proofs.length !== cells.length
    ) {
      throw new Error('verifyCellKzgProofBatch: input array lengths mismatch');
    }
    if (cells.length === 0) return true;
    for (const idx of indices) {
      if (idx >= CELLS_PER_EXT_BLOB)
        throw new Error('verifyCellKzgProofBatch: invalid cell index: ' + idx);
    }
    // Deduplicate commitments (0ms)
    const uniqueMap = new Map<string, number>();
    const uniqueCommitments: string[] = [];
    const commitmentIndicesMap = [];
    for (let i = 0; i < commitments.length; i++) {
      const commitHex = commitments[i];
      if (uniqueMap.has(commitHex)) commitmentIndicesMap.push(uniqueMap.get(commitHex)!);
      else {
        const newIndex = uniqueCommitments.length;
        uniqueMap.set(commitHex, newIndex);
        uniqueCommitments.push(commitHex);
        commitmentIndicesMap.push(newIndex);
      }
    }
    // Compute challenge r (5ms)
    const h = sha256.create();
    h.update(utf8ToBytes('RCKZGCBATCH__V1_'));
    h.update(numberToBytesBE(FE_PER_CELL, 8)); // uint64
    h.update(numberToBytesBE(uniqueCommitments.length, 8)); // uint64
    h.update(numberToBytesBE(cells.length, 8)); // uint64
    for (const c of uniqueCommitments) h.update(hexToBytes(strip0x(c)));
    for (const idx of commitmentIndicesMap) h.update(numberToBytesBE(idx, 8)); // uint64
    for (const idx of indices) h.update(numberToBytesBE(idx, 8)); // uint64
    for (const c of cells) h.update(hexToBytes(strip0x(c)));
    for (const p of proofs) h.update(hexToBytes(strip0x(p)));
    const r = Fr.create(bytesToNumberBE(h.digest()));
    // Proofs lincomb (175ms)
    const rPowers = this.getRPowers(r, cells.length); //
    const proofsG1 = proofs.map((hex) => this.parseG1(hex)); // 120ms
    const proofLincomb = this.G1msm(proofsG1, rPowers); // 51ms
    // Weighted sum of commitments (4ms)
    const uniqueCommitmentsG1 = uniqueCommitments.map(this.parseG1);
    const weights: bigint[] = new Array(uniqueCommitments.length).fill(Fr.ZERO);
    for (let i = 0; i < commitmentIndicesMap.length; i++) {
      const idx = commitmentIndicesMap[i];
      weights[idx] = Fr.add(weights[idx], rPowers[i]);
    }
    const CAgg = this.G1msm(uniqueCommitmentsG1, weights);
    // Compute commitment to aggregated interpolation polynomial (47 ms)
    const columns = Array.from({ length: CELLS_PER_EXT_BLOB }, () =>
      new Array(FE_PER_CELL).fill(Fr.ZERO)
    );
    const usedRows = new Set<number>();
    for (let k = 0; k < cells.length; k++) {
      const row = indices[k];
      usedRows.add(row);
      const weight = rPowers[k];
      const cell = Cell.decode(cells[k]);
      for (let j = 0; j < FE_PER_CELL; j++)
        columns[row][j] = Fr.add(columns[row][j], Fr.mul(cell[j], weight));
    }
    const ROOTS_EXT = this.ROOTS_CACHE.roots(log2(FE_PER_EXT_BLOB));
    const aggInterp = new Array(FE_PER_CELL).fill(Fr.ZERO);
    for (const i of usedRows) {
      const idx = (FE_PER_EXT_BLOB - CELL_INDICES_RBL[i]) % FE_PER_EXT_BLOB;
      const cosetR = ROOTS_EXT[idx];
      const shifted = this.polyFr.shift(this.fftFr.inverse(columns[i], true), cosetR);
      for (let k = 0; k < FE_PER_CELL; k++) aggInterp[k] = Fr.add(aggInterp[k], shifted[k]);
    }
    const IAgg = this.G1msm(this.G1M.slice(0, FE_PER_CELL), aggInterp);
    // Weighted sum of proofs (0ms)
    const weightedR = [];
    for (let k = 0; k < proofsG1.length; k++) {
      const idx = indices[k];
      if (idx >= CELLS_PER_EXT_BLOB) throw new Error(`Invalid cell index ${idx}`);
      const hkPow = (CELL_INDICES_RBL[idx] * FE_PER_CELL) % FE_PER_EXT_BLOB;
      if (hkPow >= ROOTS_EXT.length) throw new Error(`hkPow out of bounds`);
      weightedR.push(Fr.mul(rPowers[k], ROOTS_EXT[hkPow]));
    }
    const PiAgg = this.G1msm(proofsG1, weightedR);
    return pairingVerify(
      CAgg.add(IAgg.negate()).add(PiAgg), // CAgg - IAgg + PiAgg
      G2.BASE,
      proofLincomb,
      this.G2M[FE_PER_CELL]
    );
  }

  // High-level method
  // commitmentToVersionedHash(commitment: Uint8Array) {
  //   const VERSION = 1; // Currently only 1 version is supported
  //   // commitment is G1 point in hex?
  //   return concatBytes(new Uint8Array([VERSION]), sha256(commitment));
  // }
}
