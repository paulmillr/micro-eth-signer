// Cold side of the air-gap demo (airgap/cold.html): holds the private key,
// shows its public key as a pairing QR, and reviews + signs ERC-4527 requests
// scanned from the hot device. Everything here works offline: no RPC, no
// fetch — nothing from net/ or the tx demo's (networked) core is imported, and
// cold.html additionally forbids network access with a Content-Security-Policy.
// What the user sees is decoded from the request itself plus the library's
// built-in registries; nothing the hot device claims is taken on trust.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { addr, eip191Signer, Transaction, weieth, weigwei } from '../../index.js';
import { formatUnits } from '../../utils.js';
import { CONTRACTS, decodeTx, TOKENS } from '../../abi/index.js';
import {
  DATA_TYPE,
  decodeSignRequest,
  encodeHDKey,
  encodeSignature,
  fingerprint,
  fingerprintHex,
  formatKeypath,
  uuidString,
} from './erc4527.js';
import { UREncoder } from './ur.js';

export const ORIGIN = 'micro-eth-signer cold';
// payloads above this split into an animated QR (see hot.js MAX_FRAGMENT)
const MAX_FRAGMENT = 250;
// chain ids the signer can name; anything else is signed only with a warning
const CHAINS = new Map([
  [1n, 'Ethereum mainnet'],
  [11155111n, 'Sepolia testnet'],
]);
const SUPPORTED_TX = ['legacy', 'eip2930', 'eip1559'];

export const INVALID_KEY = 'Invalid private key: expected 64 hex characters.';
export const isPrivateKey = (value) =>
  typeof value === 'string' && addr.isValidPrivateKey(value.trim());
export const randomKey = () => addr.random().privateKey;

const equalBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const bigintBytes = (n, length) => hexToBytes(n.toString(16).padStart(length * 2, '0'));
const minimalBytes = (n) => {
  const hex = n.toString(16);
  return hexToBytes(hex.length % 2 ? `0${hex}` : hex);
};
const gwei = (wei) => `${weigwei.encode(wei)} gwei`;

// Exactly transfer(address,uint256): selector, a clean address word, an amount.
function parseErc20Transfer(data) {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  if (hex.length !== 8 + 64 * 2 || !hex.startsWith('a9059cbb')) return;
  const word = hex.slice(8, 72);
  if (!/^0{24}/.test(word)) return;
  return { to: addr.addChecksum(word.slice(24)), amount: BigInt(`0x${hex.slice(72)}`) };
}

// Text that renders as itself: valid UTF-8 without control characters (other
// than newlines and tabs) that could hide or reorder what is displayed.
function readableText(bytes) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // C0/C1 controls and bidi overrides/isolates (U+200E-200F, 202A-202E, 2066-2069)
    const hidden =
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
    return hidden.test(text) ? undefined : text;
  } catch {
    return undefined;
  }
}

// Descriptors render addresses lowercase; checksummed ones can be compared
// against other sources. Longer hex (hashes) is left alone.
const checksumAll = (text) => text.replace(/\b0x[0-9a-fA-F]{40}\b/g, (a) => addr.addChecksum(a));

// Calldata decoded with the built-in ABIs and ERC-7730 descriptors only: no
// resolvers, no RPC. `call` is the function signature of an exact registry
// match (selector guesses don't count); `clear` is the clear-signing display —
// intent plus the descriptor's labeled fields — when a descriptor covers it.
async function offlineDecode(tx, from) {
  let decoded;
  try {
    decoded = decodeTx(tx, { from, chainId: tx.raw.chainId });
  } catch {
    return {};
  }
  if (!decoded || Array.isArray(decoded)) return {};
  let clear;
  try {
    clear = decoded.clearSig && (await decoded.clearSig);
  } catch {
    // rendering failed: fall back to the raw call
  }
  if (!clear) return { call: decoded.signature };
  return {
    call: decoded.signature,
    clear: {
      intent: checksumAll(clear.interpolatedIntent || clear.intent),
      fields: Object.entries(clear.fields).map(([label, field]) => [
        label,
        checksumAll(field.value),
      ]),
    },
  };
}

/**
 * A signer for one private key. `pairing()` is the crypto-hdkey QR (public key
 * only); `review(payload)` decodes and checks an eth-sign-request and returns
 * what to show plus `approve()`, which signs exactly what was reviewed and
 * returns the eth-signature QR encoder.
 */
export function createColdSigner(privateKey) {
  if (!isPrivateKey(privateKey)) throw new Error(INVALID_KEY);
  const hex = privateKey.trim().replace(/^0x/i, '');
  const key = hexToBytes(hex.toLowerCase());
  const publicKey = secp256k1.getPublicKey(key, true);
  const address = addr.fromPublicKey(publicKey);
  const fp = fingerprint(publicKey);
  // a solo key is its own master: empty path, its own fingerprint
  const keypath = { components: [], sourceFingerprint: fp };

  const respond = (requestId, signature) =>
    new UREncoder(
      'eth-signature',
      encodeSignature({ requestId, signature, origin: ORIGIN }),
      MAX_FRAGMENT
    );

  async function reviewTransaction(req, meta) {
    let tx;
    try {
      tx = Transaction.fromBytes(req.signData);
    } catch (error) {
      throw new Error(`Malformed transaction: ${error.message}`);
    }
    if (!SUPPORTED_TX.includes(tx.type))
      throw new Error(`Unsupported transaction type: ${tx.type}.`);
    if ((req.dataType === DATA_TYPE.transaction) !== (tx.type === 'legacy'))
      throw new Error(`Data type ${req.dataType} does not match a ${tx.type} transaction.`);
    if (tx.isSigned) throw new Error('The request carries an already-signed transaction.');
    const chainId = tx.raw.chainId;
    if (chainId === undefined)
      throw new Error(
        'Legacy transaction without a chain id (pre-EIP-155) is valid on every chain: refusing.'
      );
    if (chainId !== req.chainId)
      throw new Error(
        `The request says chain ${req.chainId}, the transaction is for chain ${chainId}.`
      );
    // the signature covers the re-encoding of the decoded (displayed) fields:
    // insist that it is byte-identical to what was sent
    if (!equalBytes(tx.toBytes({ includeSignature: false }), req.signData))
      throw new Error('Non-canonical transaction encoding: refusing to sign.');

    const warnings = [];
    try {
      Transaction.fromBytes(req.signData, true); // UI-input sanity limits
    } catch (error) {
      warnings.push(`Unusual values: ${error.message}`);
    }
    const chain = CHAINS.get(chainId);
    if (!chain) warnings.push(`Unknown chain id ${chainId}: this signer cannot name the network.`);
    const { to, value, data } = tx.raw;
    const normal = [
      ['network', chain ? `${chain} (chain ${chainId})` : `chain ${chainId}`],
      ['from', address],
    ];
    const deployment = !to || to === '0x';
    const { call, clear } = deployment ? {} : await offlineDecode(tx, address);
    const transfer = value === 0n && !clear ? parseErc20Transfer(data) : undefined;
    if (deployment) {
      normal.push(['to', 'new contract (deployment)'], ['amount', `${weieth.encode(value)} ETH`]);
      warnings.push('Contract deployment: the code being deployed is not shown.');
    } else if (clear) {
      // the descriptor's own labels and formatting, plus what a descriptor may
      // leave out: which contract is called, and any ETH sent along
      const known = chainId === 1n ? CONTRACTS[to.toLowerCase()] : undefined;
      normal.push(['contract', known ? `${to} · ${known.symbol || known.name}` : to]);
      if (value) normal.push(['value', `${weieth.encode(value)} ETH`]);
      normal.push(['intent', clear.intent], ...clear.fields);
    } else if (transfer) {
      // the registry is mainnet's; the same address elsewhere is another contract
      const token = chainId === 1n ? TOKENS[to.toLowerCase()] : undefined;
      normal.push(
        ['to', transfer.to],
        [
          'amount',
          token
            ? `${formatUnits(transfer.amount, token.decimals)} ${token.symbol}`
            : `${transfer.amount} base units`,
        ],
        ['token', `${to} · ${token ? token.symbol : 'unknown token'}`]
      );
      if (!token)
        warnings.push(
          'Unknown token contract: the amount is in base units (decimals are not known ' +
            'offline). Check the contract address independently.'
        );
    } else {
      normal.push(['to', to], ['amount', `${weieth.encode(value)} ETH`]);
      if (data && data !== '0x') {
        normal.push(
          ['call', call || `unknown function, selector ${data.slice(0, 10)}`],
          ['data', `${(data.length - 2) / 2} bytes`]
        );
        warnings.push(
          `Contract call without a clear-signing description: ${
            call ? 'its arguments are not shown' : 'this signer cannot decode it'
          }. Sign only if you trust it.`
        );
      }
    }
    normal.push(['max total fee', `${weieth.encode(tx.fee)} ETH`]);

    const muted = [
      ['type', tx.type],
      ['chain id', String(chainId)],
      ['nonce', String(tx.raw.nonce)],
      ['gas limit', String(tx.raw.gasLimit)],
      ...(tx.type === 'eip1559'
        ? [
            ['max fee per gas', gwei(tx.raw.maxFeePerGas)],
            ['priority fee', gwei(tx.raw.maxPriorityFeePerGas)],
          ]
        : [['gas price', gwei(tx.raw.gasPrice)]]),
      ...meta,
    ];
    return {
      kind: 'transaction',
      normal,
      muted,
      warnings,
      approve() {
        const signed = tx.signBy(key);
        const { r, s, yParity } = signed.raw;
        // typed: y-parity; legacy: the EIP-155 v (chain-bound)
        const v =
          tx.type === 'legacy'
            ? minimalBytes(chainId * 2n + 35n + BigInt(yParity))
            : Uint8Array.of(yParity);
        const signature = new Uint8Array(64 + v.length);
        signature.set(bigintBytes(r, 32), 0);
        signature.set(bigintBytes(s, 32), 32);
        signature.set(v, 64);
        return { encoder: respond(req.requestId, signature), txid: signed.hash };
      },
    };
  }

  function reviewMessage(req, meta) {
    const bytes = req.signData;
    const text = readableText(bytes);
    const warnings = [];
    if (text === undefined)
      warnings.push(
        'The message is not readable text, so it is shown as hex: signing opaque bytes ' +
          'can authorize things you cannot see.'
      );
    return {
      kind: 'message',
      normal: [
        ['signer', address],
        ['message', text ?? `0x${bytesToHex(bytes)}`],
      ],
      muted: [['format', `EIP-191 personal_sign, ${bytes.length} bytes`], ...meta],
      warnings,
      approve() {
        const signature = hexToBytes(eip191Signer.sign(bytes, key).slice(2));
        return { encoder: respond(req.requestId, signature) };
      },
    };
  }

  /** Decodes and checks an eth-sign-request payload (CBOR bytes) for display. */
  async function review(payload) {
    const req = decodeSignRequest(payload);
    if (!req.requestId)
      throw new Error('The request has no request id, so its signature could not be matched.');
    const path = req.derivationPath;
    if (path.components.length || path.sourceFingerprint !== fp)
      throw new Error(
        `The request is for key ${formatKeypath(path)}; this signer holds ` +
          `${formatKeypath(keypath)} (${address}).`
      );
    if (req.address && req.address !== address)
      throw new Error(`The request is for ${req.address}; this signer holds ${address}.`);
    // origin is self-reported by the requester: informational only
    const meta = [
      ['request id', uuidString(req.requestId)],
      ...(req.origin ? [['requested by', req.origin]] : []),
    ];
    switch (req.dataType) {
      case DATA_TYPE.transaction:
      case DATA_TYPE.typedTransaction:
        return reviewTransaction(req, meta);
      case DATA_TYPE.personalMessage:
        return reviewMessage(req, meta);
      case DATA_TYPE.typedData:
        throw new Error('EIP-712 typed data is not supported by this signer.');
      default:
        throw new Error(`Unknown request data type ${req.dataType}.`);
    }
  }

  return {
    address,
    fingerprint: fingerprintHex(fp),
    /** crypto-hdkey encoder: the public key and its fingerprint, nothing secret. */
    pairing: () =>
      new UREncoder(
        'crypto-hdkey',
        encodeHDKey({ publicKey, origin: keypath, name: ORIGIN }),
        MAX_FRAGMENT
      ),
    review,
  };
}
