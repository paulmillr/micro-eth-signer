import { addr as _addr } from './core/address.ts';
import { authorization as _authorization } from './core/tx-internal.ts';
import { Transaction as _Transaction } from './core/tx.ts';
import {
  eip191Signer as _eip191Signer,
  recoverPublicKeyTyped as _recoverPublicKeyTyped,
  signTyped as _signTyped,
  verifyTyped as _verifyTyped,
  type EIP712Domain as _EIP712Domain,
  type TypedData as _TypedData,
} from './core/typed-data.ts';
import {
  amounts as _amounts,
  ethHex as _ethHex,
  ethHexNoLeadingZero as _ethHexNoLeadingZero,
  weieth as _weieth,
  weigwei as _weigwei,
} from './utils.ts';

/**
 * Ethereum address helpers.
 * @example
 * Generate a fresh account and validate the returned checksum address.
 * ```ts
 * const account = addr.random();
 * addr.isValid(account.address);
 * ```
 */
export const addr = _addr;
/**
 * Authorization list helpers for EIP-7702 transactions.
 * @example
 * Sign an EIP-7702 authorization item and recover its authority address.
 * ```ts
 * import { addr, authorization } from 'micro-eth-signer';
 * const { privateKey, address } = addr.random();
 * const item = authorization.sign(
 *   { chainId: 1n, address, nonce: 0n },
 *   privateKey
 * );
 * authorization.getAuthority(item);
 * ```
 */
export const authorization = _authorization;
/**
 * Typed transaction builder, signer, and serializer.
 * @param type - Transaction version to validate against.
 * @param raw - Parsed transaction fields for the selected version.
 * @param strict - Whether to enforce the library safety limits.
 * @param allowSignatureFields - Whether signature fields may be present on input.
 * @example
 * Prepare a transaction and serialize the signed result as hex.
 * ```ts
 * import { addr, Transaction, weigwei, weieth } from 'micro-eth-signer';
 * const random = addr.random();
 * const tx = Transaction.prepare({
 *   to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
 *   value: weieth.decode('1.1'),
 *   maxFeePerGas: weigwei.decode('100'),
 *   nonce: 0n,
 * });
 * tx.signBy(random.privateKey).toHex();
 * ```
 */
export const Transaction = _Transaction;
/**
 * EIP-191 signer helper.
 * @example
 * Sign a personal message and verify it against the signer address.
 * ```ts
 * import { addr, eip191Signer } from 'micro-eth-signer';
 * const message = 'Hello, Ethereum!';
 * const privateKey = '0x4c0883a69102937d6231471b5dbb6204fe512961708279f1d7b1b8e7e8b1b1e1';
 * const sig = eip191Signer.sign(message, privateKey);
 * eip191Signer.verify(sig, message, addr.fromPrivateKey(privateKey));
 * ```
 */
export const eip191Signer = _eip191Signer;
/**
 * EIP-712 domain shape.
 * Used by `signTyped`, `verifyTyped`, and `encoder` to describe the signing domain.
 */
export type EIP712Domain = _EIP712Domain;
/**
 * EIP-712 typed message wrapper.
 * Combines the domain, type table, and message payload passed into EIP-712 helpers.
 */
export type TypedData<
  T extends Record<string, readonly { name: string; type: string }[]>,
  K extends keyof T & string,
> = _TypedData<T, K>;
/**
 * Signs EIP-712 typed data with a private key.
 * @param typed - Typed message with domain, type definitions, and message body.
 * @param privateKey - Secp256k1 private key used for signing.
 * @param extraEntropy - Extra entropy passed to the underlying nonce generation.
 * @returns Recoverable secp256k1 signature encoded for Ethereum.
 * @example
 * Sign a minimal EIP-712 payload with a fixed private key.
 * ```ts
 * import { ethHex, signTyped } from 'micro-eth-signer';
 * const types = {
 *   Person: [
 *     { name: 'name', type: 'string' },
 *     { name: 'wallet', type: 'address' },
 *   ],
 *   Mail: [{ name: 'contents', type: 'string' }],
 * } as const;
 * const typed = {
 *   types,
 *   primaryType: 'Mail',
 *   domain: {
 *     name: 'Ether Mail',
 *     version: '1',
 *     chainId: 1n,
 *     verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
 *     salt: ethHex.decode('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'),
 *   },
 *   message: { contents: 'Hello, Bob!' },
 * } as const;
 * signTyped(typed, '0x4c0883a69102937d6231471b5dbb6204fe512961708279f1d7b1b8e7e8b1b1e1');
 * ```
 */
export const signTyped = _signTyped;
/**
 * Verifies an EIP-712 typed-data signature.
 * @param signature - Signature to verify.
 * @param typed - Typed message with domain, type definitions, and message body.
 * @param address - Ethereum address expected to have produced the signature.
 * @returns `true` when the signature matches the supplied address and typed data.
 * @example
 * Verify the signature against the address derived from the private key.
 * ```ts
 * import { addr, signTyped, verifyTyped } from 'micro-eth-signer';
 * const typed = {
 *   types: {
 *     Person: [
 *       { name: 'name', type: 'string' },
 *       { name: 'wallet', type: 'address' },
 *     ],
 *     Mail: [{ name: 'contents', type: 'string' }],
 *   },
 *   primaryType: 'Mail',
 *   domain: { name: 'Ether Mail' },
 *   message: { contents: 'Hello, Bob!' },
 * } as const;
 * const privateKey = '0x4c0883a69102937d6231471b5dbb6204fe512961708279f1d7b1b8e7e8b1b1e1';
 * const sig = signTyped(typed, privateKey);
 * verifyTyped(sig, typed, addr.fromPrivateKey(privateKey));
 * ```
 */
export const verifyTyped = _verifyTyped;
/**
 * Recovers a public key from an EIP-712 typed-data signature.
 * @param signature - Signature to recover from.
 * @param typed - Typed message with domain, type definitions, and message body.
 * @returns Recovered secp256k1 public key bytes.
 * @example
 * Recover the public key from the typed-data signature bytes.
 * ```ts
 * import { recoverPublicKeyTyped, signTyped } from 'micro-eth-signer';
 * const typed = {
 *   types: {
 *     Person: [
 *       { name: 'name', type: 'string' },
 *       { name: 'wallet', type: 'address' },
 *     ],
 *     Mail: [{ name: 'contents', type: 'string' }],
 *   },
 *   primaryType: 'Mail',
 *   domain: { name: 'Ether Mail' },
 *   message: { contents: 'Hello, Bob!' },
 * } as const;
 * const sig = signTyped(typed, '0x4c0883a69102937d6231471b5dbb6204fe512961708279f1d7b1b8e7e8b1b1e1');
 * recoverPublicKeyTyped(sig, typed);
 * ```
 */
export const recoverPublicKeyTyped = _recoverPublicKeyTyped;
/**
 * Ethereum unit constants and limits.
 * @example
 * Format the built-in 1 gwei constant with the decimal coder.
 * ```ts
 * import { amounts, weigwei } from 'micro-eth-signer';
 * weigwei.encode(amounts.GWEI);
 * ```
 */
export const amounts = _amounts;
/**
 * Hex coder that keeps a leading zero nibble when needed.
 * @example
 * Preserve the leading zero byte when encoding Ethereum hex.
 * ```ts
 * ethHex.encode(new Uint8Array([0, 1]));
 * ```
 */
export const ethHex = _ethHex;
/**
 * Hex coder that strips leading zero nibbles on encode.
 * @example
 * Trim redundant leading zero bytes on encode.
 * ```ts
 * ethHexNoLeadingZero.encode(new Uint8Array([0, 1]));
 * ```
 */
export const ethHexNoLeadingZero = _ethHexNoLeadingZero;
/**
 * Decimal coder that converts between wei and ether strings.
 * @example
 * Convert an ether-denominated decimal string into wei.
 * ```ts
 * weieth.decode('1.5');
 * ```
 */
export const weieth = _weieth;
/**
 * Decimal coder that converts between wei and gwei strings.
 * @example
 * Convert a gwei-denominated decimal string into wei.
 * ```ts
 * weigwei.decode('1.5');
 * ```
 */
export const weigwei = _weigwei;
