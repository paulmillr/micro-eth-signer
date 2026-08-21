import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { createContract } from '../abi/decoder.ts';
import { ADDRESS_ZERO, astring, type IWeb3Provider, strip0x, type TRet } from '../utils.ts';

/*
Unified name resolution for ENS (`.eth` and DNS-imported names) and
GNS — Gwei Name Service, an ownerless `.gwei` namespace on Ethereum mainnet +
Sepolia (same NameNFT address on both chains). GNS names are ERC-721 tokens
whose ids are EIP-137 namehashes, and NameNFT itself is the (ENS-compatible)
resolver, so all GNS reads go through one contract. GNS registration is
on-chain commit-reveal with a fixed, burned, length-based fee; that write path
is out of scope here — this is a read-side client.

`NameResolver` routes by TLD: `.gwei` names go to NameNFT, everything else to
the ENS registry. Reverse resolution (address → name) picks the service via an
explicit mode, defaulting to ENS.
*/

// ENS requires UTS-46 normalization before hashing; this only supports ASCII
// case-folding, not IDN names. Non-ASCII input fails loudly instead of silently
// producing a hash that no UTS-46-conforming resolver would compute.
export function namehash(address: string): TRet<Uint8Array> {
  astring(address, 'address');
  if (!/^[\x00-\x7f]*$/.test(address))
    throw new Error('namehash: non-ASCII name requires UTS-46 normalization, which is unsupported');
  let res = new Uint8Array(32) as TRet<Uint8Array>;
  if (!address) return res;
  for (let label of address.split('.').reverse())
    res = keccak_256(
      concatBytes(res, keccak_256(utf8ToBytes(label.toLowerCase())))
    ) as TRet<Uint8Array>;
  return res;
}

const GWEI_TLD = 'gwei';
const _0n = /* @__PURE__ */ BigInt(0);

// Names are hashed with the ENS namehash algorithm under the `gwei` TLD.
// Accepts 'alice', 'alice.gwei' or 'sub.alice.gwei'; ASCII-only (same UTS-46
// limitation as namehash — non-ASCII fails loudly).
export function gnsTokenId(name: string): bigint {
  astring(name, 'name');
  if (!name) throw new Error('gnsTokenId: empty name');
  const labels = name.split('.');
  if (labels[labels.length - 1].toLowerCase() !== GWEI_TLD) labels.push(GWEI_TLD);
  if (labels.some((l) => !l)) throw new Error('gnsTokenId: empty label');
  return BigInt(`0x${bytesToHex(namehash(labels.join('.')))}`);
}

/**
 * GNS registration/renewal fee in wei: fixed length-based schedule, keyed on
 * the label's UTF-8 **byte** length (a 4-byte emoji pays the 4-byte tier). The
 * fee is burned (locked in the contract forever), it is not revenue. Constants
 * in the contract, so this needs no network call. Re-registration of a freshly
 * expired name pays an extra decaying premium on top; see `premium()`.
 */
export function gnsRegistrationFee(label: string): bigint {
  astring(label, 'label');
  if (!label || label.includes('.')) throw new Error('gnsRegistrationFee: wrong label');
  const len = utf8ToBytes(label).length;
  if (len === 1) return BigInt('500000000000000000'); // 0.5 ETH
  if (len === 2) return BigInt('100000000000000000'); // 0.1 ETH
  if (len === 3) return BigInt('50000000000000000'); // 0.05 ETH
  if (len === 4) return BigInt('10000000000000000'); // 0.01 ETH
  return BigInt('500000000000000'); // 0.0005 ETH
}

/**
 * Looks like a name `nameToAddress` could resolve ('vitalik.eth',
 * 'alice.gwei'): dot-separated printable-ASCII labels, not a 0x address.
 * The search-input router for UIs that accept both addresses and names.
 */
export const isResolvableName = (value: string): boolean =>
  typeof value === 'string' &&
  /^[\x21-\x7f]+(\.[\x21-\x7f]+)+$/.test(value) &&
  !value.startsWith('0x');

/** Which name service a reverse (address → name) lookup should use. */
export type ResolverMode = 'ens' | 'gns';

export class NameResolver {
  static ADDRESS_ZERO: string = ADDRESS_ZERO;
  static ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
  static ENS_REGISTRY_CONTRACT = [
    {
      name: 'resolver',
      type: 'function',
      inputs: [{ name: 'node', type: 'bytes32' }],
      outputs: [{ type: 'address' }],
    },
  ] as const;
  static ENS_RESOLVER_CONTRACT = [
    {
      name: 'addr',
      type: 'function',
      inputs: [{ name: 'node', type: 'bytes32' }],
      outputs: [{ type: 'address' }],
    },
    {
      name: 'name',
      type: 'function',
      inputs: [{ name: 'node', type: 'bytes32' }],
      outputs: [{ type: 'string' }],
    },
    {
      name: 'text',
      type: 'function',
      inputs: [
        { name: 'node', type: 'bytes32' },
        { name: 'key', type: 'string' },
      ],
      outputs: [{ type: 'string' }],
    },
    {
      name: 'contenthash',
      type: 'function',
      inputs: [{ name: 'node', type: 'bytes32' }],
      outputs: [{ type: 'bytes' }],
    },
  ] as const;
  /** GNS NameNFT: registry + resolver in one contract. Ethereum mainnet and Sepolia. */
  static GNS_NAME_NFT = '0x9D51D507BC7264d4fE8Ad1cf7Fe191933A0a81d6';
  /** namehash('gwei'); GNS token ids are namehashes under this node. */
  static GWEI_NODE = '0xcca9c7f2dbe2808af0de2982fc84314bfa68a82a6a60ad5cd757f91a233d7d7f';
  // uint256-tokenId read profile of NameNFT (it also exposes bytes32-node
  // overloads for ENS tooling; one variant is enough here).
  static GNS_CONTRACT = [
    {
      name: 'resolve',
      type: 'function',
      inputs: [{ name: 'tokenId', type: 'uint256' }],
      outputs: [{ type: 'address' }],
    },
    {
      name: 'reverseResolve',
      type: 'function',
      inputs: [{ name: 'addr', type: 'address' }],
      outputs: [{ type: 'string' }],
    },
    {
      name: 'text',
      type: 'function',
      inputs: [
        { name: 'tokenId', type: 'uint256' },
        { name: 'key', type: 'string' },
      ],
      outputs: [{ type: 'string' }],
    },
    {
      name: 'contenthash',
      type: 'function',
      inputs: [{ name: 'tokenId', type: 'uint256' }],
      outputs: [{ type: 'bytes' }],
    },
    {
      name: 'addr',
      type: 'function',
      inputs: [
        { name: 'tokenId', type: 'uint256' },
        { name: 'coinType', type: 'uint256' },
      ],
      outputs: [{ type: 'bytes' }],
    },
    {
      name: 'isAvailable',
      type: 'function',
      inputs: [
        { name: 'label', type: 'string' },
        { name: 'parentId', type: 'uint256' },
      ],
      outputs: [{ type: 'bool' }],
    },
    {
      name: 'expiresAt',
      type: 'function',
      inputs: [{ name: 'tokenId', type: 'uint256' }],
      outputs: [{ type: 'uint256' }],
    },
    {
      name: 'getPremium',
      type: 'function',
      inputs: [{ name: 'tokenId', type: 'uint256' }],
      outputs: [{ type: 'uint256' }],
    },
  ] as const;

  readonly net: IWeb3Provider;
  readonly gnsAddress: string;
  constructor(net: IWeb3Provider, gnsAddress: string = NameResolver.GNS_NAME_NFT) {
    this.net = net;
    this.gnsAddress = gnsAddress;
  }
  private gns() {
    return createContract(NameResolver.GNS_CONTRACT, this.net, this.gnsAddress);
  }
  private isGwei(name: string): boolean {
    astring(name, 'name');
    const labels = name.split('.');
    return labels[labels.length - 1].toLowerCase() === GWEI_TLD;
  }
  /** ENS registry lookup: resolver contract responsible for a (non-.gwei) name. */
  async getResolver(name: string): Promise<string | undefined> {
    astring(name, 'name');
    const contract = createContract(
      NameResolver.ENS_REGISTRY_CONTRACT,
      this.net,
      NameResolver.ENS_REGISTRY
    );
    const res = await contract.resolver.call(namehash(name));
    if (res === NameResolver.ADDRESS_ZERO) return;
    return res;
  }
  private async ensResolverContract(name: string) {
    const resolver = await this.getResolver(name);
    if (!resolver) return;
    return createContract(NameResolver.ENS_RESOLVER_CONTRACT, this.net, resolver);
  }

  /**
   * Resolves a name to its Ethereum address. `.gwei` names go through GNS
   * NameNFT (explicit resolver address if set, otherwise the token owner;
   * expired/unregistered names return undefined), everything else through the
   * ENS registry.
   */
  async nameToAddress(name: string): Promise<string | undefined> {
    if (this.isGwei(name)) {
      const address = await this.gns().resolve.call(gnsTokenId(name));
      if (address === NameResolver.ADDRESS_ZERO) return;
      return address;
    }
    const contract = await this.ensResolverContract(name);
    if (!contract) return;
    const addr = await contract.addr.call(namehash(name));
    if (addr === NameResolver.ADDRESS_ZERO) return;
    return addr;
  }

  /**
   * Primary name for an address (e.g. 'vitalik.eth', 'alice.gwei').
   * @param mode - which name service to query; defaults to 'ens'.
   */
  async addressToName(address: string, mode: ResolverMode = 'ens'): Promise<string | undefined> {
    astring(address, 'address');
    if (mode === 'gns') {
      // Unlike ENS, no client-side forward check is needed: NameNFT.reverseResolve
      // already returns '' unless resolve(primaryName) still equals the address.
      const name = await this.gns().reverseResolve.call(address);
      if (!name) return;
      return name;
    }
    if (mode !== 'ens') throw new Error(`addressToName: unknown mode ${mode}`);
    const addrDomain = `${strip0x(address).toLowerCase()}.addr.reverse`;
    const contract = await this.ensResolverContract(addrDomain);
    if (!contract) return;
    const name = await contract.name.call(namehash(addrDomain));
    if (!name) return;
    // From spec: ENS does not enforce accuracy of reverse records -
    // anyone may claim that the name for their address is 'alice.eth'.
    // To be certain the claim is accurate, you must always perform a forward
    // resolution for the returned name and check whether it matches the original address.
    const realAddr = await this.nameToAddress(name);
    // ERC-181 reverse nodes use lowercase address hex; ERC-55 checksum casing is the same bytes.
    if (!realAddr || strip0x(realAddr).toLowerCase() !== strip0x(address).toLowerCase()) return;
    return name;
  }

  /** Text record ('avatar', 'url', 'com.twitter', ...); undefined when unset. */
  async getText(name: string, key: string): Promise<string | undefined> {
    astring(key, 'key');
    let value;
    if (this.isGwei(name)) {
      value = await this.gns().text.call({ tokenId: gnsTokenId(name), key });
    } else {
      const contract = await this.ensResolverContract(name);
      if (!contract) return;
      value = await contract.text.call({ node: namehash(name), key });
    }
    if (!value) return;
    return value;
  }

  /** Contenthash (0xe3-prefixed IPFS, etc.) as raw bytes; undefined when unset. */
  async getContenthash(name: string): Promise<Uint8Array | undefined> {
    let hash;
    if (this.isGwei(name)) {
      hash = await this.gns().contenthash.call(gnsTokenId(name));
    } else {
      const contract = await this.ensResolverContract(name);
      if (!contract) return;
      hash = await contract.contenthash.call(namehash(name));
    }
    if (!hash || !hash.length) return;
    return hash;
  }

  // GNS-only methods accept bare labels ('alice'): gnsTokenId appends the
  // `.gwei` TLD. Only reject names explicitly under a different TLD.
  private gweiOnly(name: string, method: string) {
    astring(name, 'name');
    const labels = name.split('.');
    if (labels.length > 1 && labels[labels.length - 1].toLowerCase() !== GWEI_TLD)
      throw new Error(`${method}: only .gwei names are supported`);
  }
  /** GNS-only. SLIP-44 multi-coin address record as raw bytes; coin type 60 falls back to resolve(). */
  async getAddrForCoin(name: string, coinType: bigint): Promise<Uint8Array | undefined> {
    this.gweiOnly(name, 'getAddrForCoin');
    const value = await this.gns().addr.call({ tokenId: gnsTokenId(name), coinType });
    if (!value || !value.length) return;
    return value;
  }

  /** GNS-only. Whether a top-level `.gwei` label can be registered right now. */
  async isAvailable(label: string): Promise<boolean> {
    astring(label, 'label');
    return await this.gns().isAvailable.call({ label, parentId: _0n });
  }

  /** GNS-only. Expiry as Unix seconds; undefined for unregistered names and subdomains (no own expiry). */
  async expiresAt(name: string): Promise<number | undefined> {
    this.gweiOnly(name, 'expiresAt');
    const ts = await this.gns().expiresAt.call(gnsTokenId(name));
    if (ts === _0n) return;
    const res = Number(ts);
    // ABI uint256 may exceed JavaScript's exact integer range.
    if (!Number.isSafeInteger(res)) throw new Error(`expiresAt: expected safe integer, got ${ts}`);
    return res;
  }

  /**
   * GNS-only. Current anti-snipe premium in wei, charged on top of
   * `gnsRegistrationFee` when re-registering a name whose grace period just
   * ended (100 ETH decaying linearly to 0 over 21 days). Burned, like the base fee.
   */
  async premium(name: string): Promise<bigint> {
    this.gweiOnly(name, 'premium');
    return await this.gns().getPremium.call(gnsTokenId(name));
  }
}
export default NameResolver;
