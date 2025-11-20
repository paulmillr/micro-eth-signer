import { RLP } from '@ethereumjs/rlp';
import { utils as butils, compare } from '@paulmillr/jsbt/bench.js';
import { RLP as microrlp } from '../../src/rlp.ts';

const buf = (n) => new Uint8Array(n).fill(n);
const arr = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

const data = {
  'list of numbers (small)': { input: arr(128, (i) => 1024 + i), samples: 20_000 },
  'list of numbers (big)': { input: arr(128, (i) => 1099511627776 + i), samples: 10_000 },
  'list of bigints (small)': { input: arr(128, (i) => 1024n + BigInt(i)), samples: 20_000 },
  'list of bigints (big)': { input: arr(128, (i) => 1099511627776n + BigInt(i)), samples: 10_000 },
  'list of buffers (small)': { input: arr(128, (i) => buf(32)), samples: 10_000 },
  // very slow with ethereumjs/rlp
  'list of buffers (big)': { input: arr(128, (i) => buf(1024 * 1024)), samples: 10 },
};

export const rlp = {
  'micro-rlp': microrlp,
  '@ethereumjs/rlp': RLP,
};

export async function main() {
  for (const name in data) {
    const { input, samples } = data[name];
    let encoded;
    for (let c in rlp) {
      const res = rlp[c].encode(input);
      if (encoded === undefined) encoded = res;
      else deepStrictEqual(encoded, res, `encode(${c})`);
    }
    await compare(
      `encode (${name})`,
      samples,
      Object.fromEntries(Object.entries(rlp).map(([k, v]) => [k, () => v.encode(input)]))
    );
    // RLP.decode(RLP.encode(X)) != x
    let decoded;
    for (let c in rlp) {
      const res = rlp[c].decode(encoded);
      if (decoded === undefined) decoded = res;
      else deepStrictEqual(decoded, res, `decode(${c})`);
    }
    await compare(
      `decode (${name})`,
      samples,
      Object.fromEntries(Object.entries(rlp).map(([k, v]) => [k, () => v.decode(encoded)]))
    );
  }

  butils.logMem();
}

// ESM is broken.
import { deepStrictEqual } from 'node:assert';
import url from 'node:url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main();
}
