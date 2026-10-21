// Hot side of the air-gap demo (airgap/hot.html): a watch-only wallet. It
// pairs with the cold signer from a crypto-hdkey QR (public key only), loads
// the account over RPC, prepares transfers and messages as ERC-4527
// eth-sign-request QRs, and turns the eth-signature QR that comes back into a
// signed transaction — after checking it recovers to the paired address.
//
// HARD CONSTRAINT: like the tx demo it builds on, nothing here ever
// broadcasts. There is no eth_sendRawTransaction / prov.broadcast call: the
// signed transaction's raw hex is the final product.
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { eip191Signer, Transaction } from '../../index.js';
import { createTxWallet, signedResult } from '../tx/core.js';
import {
  DATA_TYPE,
  decodeHDKey,
  decodeSignature,
  encodeSignRequest,
  fingerprint,
  formatKeypath,
  randomRequestId,
  splitSignature,
  uuidString,
} from './erc4527.js';
import { UREncoder } from './ur.js';

export { balanceLine, formatUnits, NETWORKS, rowSummary, short, withScheme } from '../tx/core.js';

export const ORIGIN = 'micro-eth-signer hot';
// Payloads above this many bytes split into an animated QR. 250 keeps an
// ERC-20 transfer request in one QR code (version 11-13 at low ECC), which a
// phone reads off a screen comfortably; long messages animate.
export const MAX_FRAGMENT = 250;

const equalBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Parses a scanned crypto-hdkey (CBOR payload) into the watch-only pairing:
 * `{ address, derivationPath, name }`. Requests name their key by
 * derivationPath: the key's origin when given, else — a solo key being its own
 * master — an empty path with the key's fingerprint.
 */
export function parsePairing(payload) {
  const key = decodeHDKey(payload);
  // an xpub's own address is not an account an HD wallet uses: deriving
  // children is out of scope for this single-key demo
  if (key.chainCode)
    throw new Error(
      'This is an extended (HD) public key; the demo pairs single keys ' +
        '(crypto-hdkey without chain code).'
    );
  const derivationPath = key.origin ?? {
    components: [],
    sourceFingerprint: fingerprint(key.publicKey),
  };
  return {
    address: key.address,
    derivationPath,
    name: key.name,
    path: formatKeypath(derivationPath),
  };
}

// y-parity from the signature's v: 0/1 or 27/28, or for legacy transactions
// the EIP-155 value chainId * 2 + 35 + parity
function yParity(v, chainId) {
  if (v === 0n || v === 1n) return Number(v);
  if (v === 27n || v === 28n) return Number(v - 27n);
  if (chainId !== undefined && (v === chainId * 2n + 35n || v === chainId * 2n + 36n))
    return Number(v - chainId * 2n - 35n);
  throw new Error(`Invalid signature: unexpected v=${v}.`);
}

function request(pairing, signData, dataType, chainId) {
  const requestId = randomRequestId();
  const payload = encodeSignRequest({
    requestId,
    signData,
    dataType,
    chainId,
    derivationPath: pairing.derivationPath,
    address: pairing.address,
    origin: ORIGIN,
  });
  return { requestId, encoder: new UREncoder('eth-sign-request', payload, MAX_FRAGMENT) };
}

/**
 * Wraps an unsigned Transaction in a sign request: `{ kind, unsigned,
 * normal, muted, requestId, encoder }`, normal/muted being display pairs.
 */
export function transactionRequest(pairing, unsigned, normal = [], muted = []) {
  const dataType = unsigned.type === 'legacy' ? DATA_TYPE.transaction : DATA_TYPE.typedTransaction;
  const signData = unsigned.toBytes({ includeSignature: false });
  return {
    kind: 'transaction',
    unsigned,
    normal,
    muted,
    ...request(pairing, signData, dataType, unsigned.raw.chainId),
  };
}

/** An EIP-191 personal_sign request for a UTF-8 message. */
export function messageRequest(pairing, message, chainId) {
  if (typeof message !== 'string' || !message) throw new Error('The message is empty.');
  return {
    kind: 'message',
    message,
    normal: [
      ['signer', pairing.address],
      ['message', message],
    ],
    muted: [['format', 'EIP-191 personal_sign']],
    ...request(pairing, utf8ToBytes(message), DATA_TYPE.personalMessage, chainId),
  };
}

/**
 * Checks a scanned eth-signature (CBOR payload) against the pending request
 * and the paired address. Transactions come back as tx demo results
 * (`{ hex, hash, normal, muted }`), messages as `{ signature, normal, muted }`.
 */
export function applySignature(pairing, pending, payload) {
  const { requestId, signature } = decodeSignature(payload);
  if (!equalBytes(requestId, pending.requestId))
    throw new Error(
      `This signature answers request ${uuidString(requestId)}, not the current one ` +
        `(${uuidString(pending.requestId)}).`
    );
  const { r, s, v } = splitSignature(signature);
  const wrongSigner = (signer) =>
    new Error(`The signature is from ${signer}, not the paired ${pairing.address}.`);
  if (pending.kind === 'message') {
    const sig = `0x${bytesToHex(signature.subarray(0, 64))}${yParity(v) ? '1c' : '1b'}`;
    let signer;
    try {
      signer = eip191Signer.recoverAddress(sig, pending.message);
    } catch (error) {
      throw new Error(`Invalid signature: ${error.message}`);
    }
    if (signer !== pairing.address) throw wrongSigner(signer);
    return {
      kind: 'message',
      signature: sig,
      normal: pending.normal,
      muted: [...pending.muted, ['request id', uuidString(requestId)]],
    };
  }
  const { unsigned } = pending;
  const parity = yParity(v, unsigned.type === 'legacy' ? unsigned.raw.chainId : undefined);
  let signed;
  try {
    signed = new Transaction(
      unsigned.type,
      { ...unsigned.raw, r, s, yParity: parity },
      { strict: false }
    );
    if (!signed.verifySignature()) throw new Error('verification failed');
  } catch (error) {
    throw new Error(`Invalid signature: ${error.message}`);
  }
  if (signed.sender !== pairing.address) throw wrongSigner(signed.sender);
  return { kind: 'transaction', ...signedResult(signed, pending.normal, pending.muted) };
}

/** The networked half: account view and transfer preparation over RPC. */
export function createHotWallet(rpcUrl, networkKey = 'mainnet') {
  const wallet = createTxWallet(rpcUrl, networkKey);
  return {
    network: wallet.network,
    load: (pairing) => wallet.loadAddress(pairing.address),
    maxAmount: wallet.maxAmount,
    /**
     * Prepares a transfer exactly like the tx demo (fees, gas, simulation,
     * clear-sign preview) and wraps the unsigned transaction in a sign request.
     */
    async requestTransfer(pairing, { asset, to, amount }) {
      const { unsigned, normal, muted } = await wallet.prepare({
        from: pairing.address,
        asset,
        to,
        amount,
      });
      return transactionRequest(pairing, unsigned, normal, muted);
    },
    requestMessage: (pairing, message) => messageRequest(pairing, message, wallet.network.chainId),
  };
}
