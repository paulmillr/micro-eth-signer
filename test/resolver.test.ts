import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, it } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, rejects, throws } from 'node:assert';
import { addr } from '../src/index.ts';
import NameResolver, {
  gnsRegistrationFee,
  gnsTokenId,
  isResolvableName,
  namehash,
} from '../src/net/resolver.ts';
import type { IWeb3Provider } from '../src/utils.ts';

const word = (n: bigint | number) => BigInt(n).toString(16).padStart(64, '0');
const abiAddress = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
const abiString = (s: string) => {
  const data = bytesToHex(utf8ToBytes(s));
  const padded = data.padEnd(Math.ceil(data.length / 64) * 64, '0');
  return `0x${word(32)}${word(data.length / 2)}${s ? padded : ''}`;
};
// same dynamic layout as string, but takes hex payload
const abiBytes = (hex: string) =>
  `0x${word(32)}${word(hex.length / 2)}${hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')}`;

// Read selectors published by the reference gns-utils SDK; createContract must
// derive the same ones from the ABI definitions.
const GNS_SELECTORS = {
  resolve: '0x4f896d4f',
  reverseResolve: '0x9af8b7aa',
  isAvailable: '0x8f8dc386',
  expiresAt: '0x17c95709',
  text: '0x308e3386',
  contenthash: '0xcb323d76',
  addr: '0x724474cd',
  getPremium: '0x1bf1fffb',
};

// GNS-side mock: every read must hit the single NameNFT contract.
const mockGns = (handler: (selector: string, data: string) => string): IWeb3Provider => ({
  ethCall: async ({ to, data }) => {
    if (to !== NameResolver.GNS_NAME_NFT) throw new Error(`unexpected contract ${to}`);
    if (!data) throw new Error('missing calldata');
    return handler(data.slice(0, 10), data);
  },
  estimateGas: async () => {
    throw new Error('unexpected estimateGas');
  },
  call: async () => {
    throw new Error('unexpected rpc call');
  },
});

describe('resolver', () => {
  it('isResolvableName routes search input between names and addresses', () => {
    deepStrictEqual(isResolvableName('vitalik.eth'), true);
    deepStrictEqual(isResolvableName('alice.gwei'), true);
    deepStrictEqual(isResolvableName('sub.domain.eth'), true);
    deepStrictEqual(isResolvableName('nodots'), false);
    deepStrictEqual(isResolvableName('0xd8da6bf26964af9d7eed9e03e53415d37aa96045'), false);
    deepStrictEqual(isResolvableName('0x.eth'), false); // 0x-prefixed is address-like
    deepStrictEqual(isResolvableName('has space.eth'), false);
    deepStrictEqual(isResolvableName('a-b.c_d'), true);
    for (const malformed of ['a..eth', '.eth', 'eth.', 'a...eth', `del\x7f.eth`])
      deepStrictEqual(isResolvableName(malformed), false);
    deepStrictEqual(isResolvableName(''), false);
  });
  it('isResolvableName rejects long near-matches without backtracking', () => {
    const start = performance.now();
    deepStrictEqual(isResolvableName('a.'.repeat(26) + ' '), false);
    deepStrictEqual(performance.now() - start < 100, true);
  });
  describe('ENS', () => {
    it('namehash', () => {
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
    it('namehash rejects non-ASCII names', () => {
      // UTS-46 normalization is unsupported: hashing these would silently produce
      // digests no conforming resolver computes.
      for (const name of ['bücher.eth', 'ξ.eth', 'emoji-💩.eth'])
        throws(() => namehash(name), /UTS-46/);
    });
    it('addressToName accepts checksum-equivalent addresses', async () => {
      const nameData = bytesToHex(utf8ToBytes('vitalik.eth'));
      const vitalikName = `0x${word(32)}${word(nameData.length / 2)}${nameData.padEnd(Math.ceil(nameData.length / 64) * 64, '0')}`;
      const address = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
      const ensResolver = '0x0000000000000000000000000000000000000001';
      const selectors: string[] = [];
      const net: IWeb3Provider = {
        ethCall: async ({ to, data }) => {
          if (!data) throw new Error('missing calldata');
          selectors.push(data.slice(0, 10));
          if (to === NameResolver.ENS_REGISTRY && data.startsWith('0x0178b8bf'))
            return abiAddress(ensResolver);
          if (to === ensResolver && data.startsWith('0x691f3431')) return vitalikName;
          if (to === ensResolver && data.startsWith('0x3b3b57de')) return abiAddress(address);
          throw new Error(`unexpected ethCall ${to} ${data}`);
        },
        estimateGas: async () => {
          throw new Error('unexpected estimateGas');
        },
        call: async () => {
          throw new Error('unexpected rpc call');
        },
      };
      const resolver = new NameResolver(net);
      // mode defaults to ENS
      deepStrictEqual(await resolver.addressToName(addr.addChecksum(address)), 'vitalik.eth');
      deepStrictEqual(selectors, ['0x0178b8bf', '0x691f3431', '0x0178b8bf', '0x3b3b57de']);
    });
  });

  describe('GNS', () => {
    it('gnsTokenId matches on-chain namehash scheme', () => {
      // Published constant: namehash('gwei'), the node all `.gwei` ids live under.
      deepStrictEqual(`0x${bytesToHex(namehash('gwei'))}`, NameResolver.GWEI_NODE);
      // TLD is appended when missing; ASCII case-folds like ENS namehash.
      const alice = gnsTokenId('alice.gwei');
      deepStrictEqual(gnsTokenId('alice'), alice);
      deepStrictEqual(gnsTokenId('ALICE.GWEI'), alice);
      deepStrictEqual(alice, BigInt(`0x${bytesToHex(namehash('alice.gwei'))}`));
      // Subdomains hash under their parent.
      deepStrictEqual(
        gnsTokenId('sub.alice'),
        BigInt(`0x${bytesToHex(namehash('sub.alice.gwei'))}`)
      );
      throws(() => gnsTokenId(''), /empty name/);
      throws(() => gnsTokenId('.alice'), /empty label/);
      throws(() => gnsTokenId('bücher'), /UTS-46/);
    });
    it('gnsRegistrationFee uses fixed byte-length schedule', () => {
      deepStrictEqual(gnsRegistrationFee('a'), 500000000000000000n);
      deepStrictEqual(gnsRegistrationFee('ab'), 100000000000000000n);
      deepStrictEqual(gnsRegistrationFee('abc'), 50000000000000000n);
      deepStrictEqual(gnsRegistrationFee('abcd'), 10000000000000000n);
      deepStrictEqual(gnsRegistrationFee('alice'), 500000000000000n);
      // 4-byte emoji pays the 4-byte tier: fee is keyed on UTF-8 bytes, not chars.
      deepStrictEqual(gnsRegistrationFee('💩'), 10000000000000000n);
      throws(() => gnsRegistrationFee(''), /wrong label/);
      throws(() => gnsRegistrationFee('a.b'), /wrong label/);
    });
    it('nameToAddress routes .gwei to NameNFT', async () => {
      const owner = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
      const resolver = new NameResolver(
        mockGns((selector, data) => {
          deepStrictEqual(selector, GNS_SELECTORS.resolve);
          deepStrictEqual(data.slice(10), word(gnsTokenId('alice')));
          return abiAddress(owner);
        })
      );
      deepStrictEqual(await resolver.nameToAddress('alice.gwei'), owner);
      // address(0) means expired/unregistered
      const empty = new NameResolver(mockGns(() => abiAddress(NameResolver.ADDRESS_ZERO)));
      deepStrictEqual(await empty.nameToAddress('alice.gwei'), undefined);
      // non-.gwei names go to the ENS registry, never to NameNFT
      await rejects(() => empty.nameToAddress('alice.eth'), /unexpected contract/);
    });
    it('addressToName with gns mode', async () => {
      const address = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
      const resolver = new NameResolver(
        mockGns((selector, data) => {
          deepStrictEqual(selector, GNS_SELECTORS.reverseResolve);
          deepStrictEqual(data.slice(10), word(BigInt(address)));
          return abiString('alice.gwei');
        })
      );
      deepStrictEqual(await resolver.addressToName(address, 'gns'), 'alice.gwei');
      // '' means no primary name (or the forward check failed on-chain)
      const empty = new NameResolver(mockGns(() => abiString('')));
      deepStrictEqual(await empty.addressToName(address, 'gns'), undefined);
      // default mode is ENS: hits the registry, not NameNFT
      await rejects(() => empty.addressToName(address), /unexpected contract/);
      await rejects(() => empty.addressToName(address, 'esn' as any), /unknown mode/);
    });
    it('text and contenthash records', async () => {
      const resolver = new NameResolver(
        mockGns((selector, data) => {
          if (selector === GNS_SELECTORS.text) {
            deepStrictEqual(data.slice(10, 74), word(gnsTokenId('alice')));
            return abiString('https://example.com');
          }
          if (selector === GNS_SELECTORS.contenthash) return abiBytes('e30170');
          if (selector === GNS_SELECTORS.addr) {
            deepStrictEqual(data.slice(74, 138), word(0)); // coinType 0 = BTC
            return abiBytes('0014');
          }
          throw new Error(`unexpected selector ${selector}`);
        })
      );
      deepStrictEqual(await resolver.getText('alice.gwei', 'url'), 'https://example.com');
      deepStrictEqual(
        await resolver.getContenthash('alice.gwei'),
        Uint8Array.from([0xe3, 0x01, 0x70])
      );
      deepStrictEqual(await resolver.getAddrForCoin('alice', 0n), Uint8Array.from([0x00, 0x14]));
      const empty = new NameResolver(mockGns(() => abiBytes('')));
      deepStrictEqual(await empty.getText('alice.gwei', 'url'), undefined);
      deepStrictEqual(await empty.getContenthash('alice.gwei'), undefined);
      deepStrictEqual(await empty.getAddrForCoin('alice', 0n), undefined);
    });
    it('isAvailable, expiresAt, premium', async () => {
      const resolver = new NameResolver(
        mockGns((selector, data) => {
          if (selector === GNS_SELECTORS.isAvailable) {
            deepStrictEqual(data.slice(74, 138), word(0)); // top-level: parentId 0
            return `0x${word(1)}`;
          }
          if (selector === GNS_SELECTORS.expiresAt) return `0x${word(1750000000)}`;
          if (selector === GNS_SELECTORS.getPremium) return `0x${word(12345)}`;
          throw new Error(`unexpected selector ${selector}`);
        })
      );
      deepStrictEqual(await resolver.isAvailable('alice'), true);
      deepStrictEqual(await resolver.expiresAt('alice'), 1750000000); // Unix seconds
      deepStrictEqual(await resolver.premium('alice'), 12345n);
      // 0 expiry: unregistered name or subdomain (which has no own expiry)
      const empty = new NameResolver(mockGns(() => `0x${word(0)}`));
      deepStrictEqual(await empty.expiresAt('alice'), undefined);
      // ABI uint256 values outside JavaScript's exact integer range must not be silently rounded.
      const unsafe = new NameResolver(mockGns(() => `0x${word(9_007_199_254_740_993n)}`));
      await rejects(() => unsafe.expiresAt('alice'), /safe integer/);
      await rejects(() => empty.getText('alice.gwei', 1 as any), /expected string/);
      // GNS-only methods reject names under other TLDs
      await rejects(() => empty.expiresAt('alice.eth'), /only \.gwei/);
      await rejects(() => empty.premium('alice.eth'), /only \.gwei/);
      await rejects(() => empty.getAddrForCoin('alice.eth', 0n), /only \.gwei/);
    });
  });
});

it.runWhen(import.meta.url);
