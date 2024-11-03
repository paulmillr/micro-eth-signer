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
    createProof: 50,
    getTreeKey: 10_000,
    hashCommitment: 1_000_000,
    serializeCommitment: 2_000_000,
    updateCommitment: 10_000,
    verifyExecutionWitnessPreState: 10_000,
    verifyProof: 100,
  };
  for (const k in VERKLE_MONOREPO) {
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
commitToScalars
├─wasm x 16,225 ops/sec @ 61μs/op
└─noble x 9,761 ops/sec @ 102μs/op
createProof
├─wasm x 6 ops/sec @ 158ms/op
└─noble x 3 ops/sec @ 266ms/op
getTreeKey
├─wasm x 41,921 ops/sec @ 23μs/op
└─noble x 4,545 ops/sec @ 220μs/op
hashCommitment
├─wasm x 215,100 ops/sec @ 4μs/op
└─noble x 332,778 ops/sec @ 3μs/op
serializeCommitment
├─wasm x 1,154,734 ops/sec @ 866ns/op
└─noble x 377,786 ops/sec @ 2μs/op
updateCommitment
├─wasm x 9,471 ops/sec @ 105μs/op
└─noble x 3,222 ops/sec @ 310μs/op
verifyExecutionWitnessPreState
├─wasm x 336 ops/sec @ 2ms/op
└─noble x 7,418 ops/sec @ 134μs/op
verifyProof
├─wasm x 49 ops/sec @ 20ms/op
└─noble x 196 ops/sec @ 5ms/op
*/
