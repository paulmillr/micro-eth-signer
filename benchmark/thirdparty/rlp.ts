import { RLP } from '@ethereumjs/rlp';
import { bench } from '@paulmillr/jsbt/bench.js';
import { RLP as microrlp } from '../../src/core/rlp.ts';

const buf = (n) => new Uint8Array(n).fill(n);
const arr = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

const data = {
  'list of numbers (small)': arr(128, (i) => 1024 + i),
  'list of numbers (large)': arr(128, (i) => 1099511627776 + i),
  'list of bigints (small)': arr(128, (i) => 1024n + BigInt(i)),
  'list of bigints (large)': arr(128, (i) => 1099511627776n + BigInt(i)),
  'list of buffers (32B)': arr(128, (i) => buf(32)),
  // very slow with ethereumjs/rlp
  'list of buffers (1MB)': arr(128, (i) => buf(1024 * 1024)),
};

export const rlp = {
  'micro-rlp': microrlp,
  '@ethereumjs/rlp': RLP,
};

export async function main() {
  for (const name in data) {
    const input = data[name];
    let encoded;
    await bench(`encode ${name}`, () => {
      encoded = microrlp.encode(input);
    });
    // RLP.decode(RLP.encode(X)) != x
    let decoded;
    const res = microrlp.decode(encoded);
    if (decoded === undefined) decoded = res;
    await bench(`decode ${name}`, () => microrlp.decode(encoded));
  }
}

// ESM is broken.
import url from 'node:url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main();
}
