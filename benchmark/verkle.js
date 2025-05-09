import { compare, utils as butils } from 'micro-bmark';
import { hexToBytes } from '@noble/hashes/utils';
import * as noble from '../esm/verkle.js';
import { loadVerkleCrypto } from 'verkle-cryptography-wasm';

import VERKLE_MONOREPO_RAW from '../test/vectors/verkle/monorepo-dump.json' with { type: 'json' };
const VERKLE_MONOREPO = JSON.parse(JSON.stringify(VERKLE_MONOREPO_RAW), (key, value) => {
  if (
    value &&
    typeof value === 'object' &&
    value.__BYTES__ &&
    typeof value.__BYTES__ === 'string'
  ) {
    return hexToBytes(value.__BYTES__);
  }
  return value;
});

export async function main() {
  const wasm = await loadVerkleCrypto();
  const SAMPLES = {
    commitToScalars: 10_000,
    createProof: 20,
    getTreeKey: 100_000,
    hashCommitment: 1_000_000,
    serializeCommitment: 3_000_000,
    updateCommitment: 200_000,
    verifyExecutionWitnessPreState: 10_000,
    verifyProof: 100,
  };

  const scalar = new Uint8Array([
    247, 192, 72, 188, 86, 202, 23, 88, 116, 220, 55, 95, 252, 199, 131, 3, 248, 79, 188, 236, 239,
    79, 140, 153, 111, 5, 197, 172, 89, 177, 36, 24,
  ]);
  const scalars = new Array(256).fill(scalar);
  // NOTE: there is a lot of zeros in test cases, which may be slower!
  await compare(`commitToScalars(big)`, 100, {
    wasm: () => wasm.commitToScalars(scalars),
    noble: () => noble.commitToScalars(scalars),
  });
  await compare(`getTreeKey(big)`, 5000, {
    wasm: () => wasm.getTreeKey(scalar, scalar, scalar),
    noble: () => noble.getTreeKey(scalar, scalar, scalar),
  });

  for (const k in VERKLE_MONOREPO) {
    //if (k !== 'getTreeKey') continue;
    const v = VERKLE_MONOREPO[k][0];
    const args = v.arguments;
    await compare(`${k}`, SAMPLES[k], {
      wasm: () => wasm[k](...args),
      noble: () => noble[k](...args),
    });
  }
  butils.logMem();
}

// ESM is broken.
import url from 'node:url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main();
}

/*
M2, node v22, Nov 2024
commitToScalars(big)
├─wasm x 17 ops/sec @ 56ms/op
└─noble x 38 ops/sec @ 26ms/op ± 44.06% (min: 19ms, max: 609ms)
getTreeKey(big)
├─wasm x 2,238 ops/sec @ 446μs/op
└─noble x 5,122 ops/sec @ 195μs/op
commitToScalars
├─wasm x 16,348 ops/sec @ 61μs/op
└─noble x 5,944 ops/sec @ 168μs/op
createProof
├─wasm x 6 ops/sec @ 160ms/op
└─noble x 2 ops/sec @ 383ms/op
getTreeKey
├─wasm x 41,953 ops/sec @ 23μs/op
└─noble x 16,962 ops/sec @ 58μs/op
hashCommitment
├─wasm x 211,505 ops/sec @ 4μs/op
└─noble x 445,037 ops/sec @ 2μs/op
serializeCommitment
├─wasm x 1,135,073 ops/sec @ 881ns/op
└─noble x 343,760 ops/sec @ 2μs/op ± 1.70% (min: 2μs, max: 31ms)
updateCommitment
├─wasm x 9,409 ops/sec @ 106μs/op
└─noble x 150,015 ops/sec @ 6μs/op
verifyExecutionWitnessPreState
├─wasm x 336 ops/sec @ 2ms/op
└─noble x 7,775 ops/sec @ 128μs/op
verifyProof
├─wasm x 50 ops/sec @ 19ms/op
└─noble x 178 ops/sec @ 5ms/op ± 11.37% (min: 4ms, max: 36ms)
*/
