import { keccak_256 } from '@noble/hashes/sha3';
import * as abi from '../web3.js';
import * as P from 'micro-packed';

// No support for IDN names because they are stupid.
export function namehash(address: string): abi.Bytes {
  let res = new Uint8Array(32);
  if (!address) return res;
  for (let label of address.split('.').reverse())
    res = keccak_256(P.concatBytes(res, keccak_256(label)));
  return res;
}

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';
export const REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
export const REGISTRY_CONTRACT = [
  {
    name: 'resolver',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
] as const;
export const RESOLVER_CONTRACT = [
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
] as const;

export async function getResolver(net: abi.Web3API, name: string): Promise<abi.Option<string>> {
  const contract = abi.contract(REGISTRY_CONTRACT, net, REGISTRY);
  const res = await contract.resolver.call(namehash(name));
  return res !== ADDRESS_ZERO ? res : undefined;
}

export async function nameToAddress(net: abi.Web3API, name: string): Promise<abi.Option<string>> {
  const resolver = await getResolver(net, name);
  if (!resolver) return;
  const contract = abi.contract(RESOLVER_CONTRACT, net, resolver);
  const addr = await contract.addr.call(namehash(name));
  if (addr === ADDRESS_ZERO) return;
  return addr;
}

export async function addressToName(net: abi.Web3API, addr: string): Promise<abi.Option<string>> {
  const addrDomain = `${abi.strip0x(addr).toLowerCase()}.addr.reverse`;
  const resolver = await getResolver(net, addrDomain);
  if (!resolver) return;
  const contract = abi.contract(RESOLVER_CONTRACT, net, resolver);
  const name = await contract.name.call(namehash(addrDomain));
  if (!name) return;
  // From spec: ENS does not enforce accuracy of reverse records -
  // anyone may claim that the name for their address is 'alice.eth'.
  // To be certain the claim is accurate, you must always perform a forward
  // resolution for the returned name and check whether it matches the original address.
  const realAddr = await nameToAddress(net, name);
  if (realAddr !== addr) return;
  return name;
}
