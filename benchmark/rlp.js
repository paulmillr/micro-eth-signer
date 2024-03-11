import { compare, utils as butils } from 'micro-bmark';
import { RLP } from '@ethereumjs/rlp';
import { RLP as microrlp } from '../lib/esm/tx.js';
import { Rlp as cubane } from '@hazae41/cubane';
import { Writable } from '@hazae41/binary';

const { RlpList, RlpString } = cubane;

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

  {
    const { samples, input } = data['list of buffers (big)'];

    const bytes = Writable.writeToBytesOrThrow(RlpList.from(input.map((i) => RlpString.from(i))));
    await compare('@hazae41/cubane', samples, {
      encode_cubane: () => {
        const t = RlpList.from(input.map((i) => RlpString.from(i)));
        return Writable.writeToBytesOrThrow(t);
      },
      // ReadUnderflowError: Cursor has 134218240 remaining bytes after read
      // decode_cubane: () => {
      //   const value = cubane.toPrimitive(Readable.readFromBytesOrThrow(cubane, bytes));
      // },
    });
  }

  butils.logMem();
}

// ESM is broken.
import url from 'node:url';
import { deepStrictEqual } from 'node:assert';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main();
}
