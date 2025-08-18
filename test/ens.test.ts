import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual } from 'node:assert';
import { namehash } from '../src/net/ens.ts';

describe('ENS', () => {
  should('namehash', () => {
    deepStrictEqual(
      bytesToHex(namehash('vitalik.eth')),
      'ee6c4522aab0003e8d14cd40a6af439055fd2577951148c14b6cea9a53475835'
    );
    deepStrictEqual(
      bytesToHex(namehash('benjaminion.eth')),
      'ce1ee36a55b52d39db63e16d1a097df75b04ede734494425de534e1b3f97d221'
    );
  });
});

should.runWhen(import.meta.url);
