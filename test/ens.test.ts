import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual } from 'node:assert';
import { addr } from '../src/index.ts';
import ENS, { namehash } from '../src/net/ens.ts';
import type { IWeb3Provider } from '../src/utils.ts';

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
    // ERC-137 "namehash algorithm" requires implementations to conform to these vectors.
    deepStrictEqual(
      ['', 'eth', 'foo.eth'].map((name) => bytesToHex(namehash(name))),
      [
        '0000000000000000000000000000000000000000000000000000000000000000',
        '93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae',
        'de9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f',
      ]
    );
    // ERC-137 "Name Syntax" says UTS-46 normalization case-folds before hashing.
    deepStrictEqual(
      [bytesToHex(namehash('ETH')), bytesToHex(namehash('Foo.ETH'))],
      [
        '93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae',
        'de9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f',
      ]
    );
  });
  should('addressToName accepts checksum-equivalent addresses', async () => {
    const word = (n: number) => n.toString(16).padStart(64, '0');
    const abiAddress = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
    const nameData = bytesToHex(utf8ToBytes('vitalik.eth'));
    const vitalikName = `0x${word(32)}${word(nameData.length / 2)}${nameData.padEnd(Math.ceil(nameData.length / 64) * 64, '0')}`;
    const address = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
    const resolver = '0x0000000000000000000000000000000000000001';
    const selectors: string[] = [];
    const net: IWeb3Provider = {
      ethCall: async ({ to, data }) => {
        if (!data) throw new Error('missing calldata');
        selectors.push(data.slice(0, 10));
        if (to === ENS.REGISTRY && data.startsWith('0x0178b8bf')) return abiAddress(resolver);
        if (to === resolver && data.startsWith('0x691f3431')) return vitalikName;
        if (to === resolver && data.startsWith('0x3b3b57de')) return abiAddress(address);
        throw new Error(`unexpected ethCall ${to} ${data}`);
      },
      estimateGas: async () => {
        throw new Error('unexpected estimateGas');
      },
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    };
    const ens = new ENS(net);
    deepStrictEqual(await ens.addressToName(addr.addChecksum(address)), 'vitalik.eth');
    deepStrictEqual(selectors, ['0x0178b8bf', '0x691f3431', '0x0178b8bf', '0x3b3b57de']);
  });
});

should.runWhen(import.meta.url);
