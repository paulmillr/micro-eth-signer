import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, match, ok, rejects, throws } from 'node:assert';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { addr, eip191Signer, Transaction } from '../../src/index.ts';
import { ethHex } from '../../src/utils.ts';
import { createContract, ERC20, UNISWAP_V2_ROUTER_CONTRACT, WETH } from '../../src/abi/index.ts';
import UNISWAP_V2_ROUTER from '../../src/abi/uniswap-v2.ts';
import { WETH_CONTRACT } from '../../src/abi/weth.ts';
import { createColdSigner } from '../airgap/cold.js';
import {
  DATA_TYPE,
  decodeHDKey,
  decodeSignature,
  decodeSignRequest,
  encodeHDKey,
  encodeSignature,
  encodeSignRequest,
  formatKeypath,
  uuidBytes,
  uuidString,
} from '../airgap/erc4527.js';
import { applySignature, messageRequest, parsePairing, transactionRequest } from '../airgap/hot.js';
import { cbor, decodeUR, encodeUR, Tagged, URDecoder } from '../airgap/ur.js';

/*
Protocol tests for the air-gap demo (examples/airgap): ERC-4527 encoding
against Keystone's reference URs, then full cold <-> hot round trips through
the QR transport (UR strings), all offline — the RPC-backed parts of the hot
page are covered by airgap-html.test.ts.
  node examples/test/airgap.test.ts
*/

// The classic demo key (privkey 1) and the tx demo's fixture addresses.
const KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';
const DEMO = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const RECIPIENT = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const CAT = '0x53FdCa91fd33B9131B5CEADe42A3EdBd9B38edFf';

// Keystone ur-registry-eth __tests__ (EthSignRequest, EthSignature, CryptoHDKey)
const KEYSTONE = {
  requestWithOrigin:
    'ur:eth-sign-request/oladtpdagdndcawmgtfrkigrpmndutdnbtkgfssbjnaohdgryagalalnascsgljpnbaelfdibemwaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaelaoxlbjyihjkjyeyaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaehnaehglalalaaxadaaadahtaaddyoeadlecsdwykadykadykaewkadwkaocybgeehfksatisjnihjyhsjnhsjkjetlnndant',
  request:
    'ur:eth-sign-request/onadtpdagdndcawmgtfrkigrpmndutdnbtkgfssbjnaohdgryagalalnascsgljpnbaelfdibemwaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaelaoxlbjyihjkjyeyaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaehnaehglalalaaxadaaadahtaaddyoeadlecsdwykadykadykaewkadwkaocybgeehfkswdtklffd',
  signData:
    'f849808609184e72a00082271094000000000000000000000000000000000000000080a47f7465737432000000000000000000000000000000000000000000000000000000600057808080',
  signature:
    'ur:eth-signature/otadtpdagdndcawmgtfrkigrpmndutdnbtkgfssbjnaohdfptywtosrftahprdctrkbegylogdghjkbafhflamfwlohghtpsseaozorsimnybbtnnbiynlckenbtfmeeamsabnaeoxasjkwswfkekiieckhpecckssptndzelnwfecylbwaxisjeihkkjkjyjljtihdwlkamiy',
  signatureBytes:
    'd4f0a7bcd95bba1fbb1051885054730e3f47064288575aacc102fbbf6a9a14daa066991e360d3e3406c20c00a40973eff37c7d641e5b351ec4a99bfe86f335f713',
  hdkey:
    'ur:crypto-hdkey/oxaxhdclaowdverokopdinhseeroisyalksaykctjshedprnuyjyfgrovawewftyghceglrpkgaahdcxtplfjsluknfwlaisaxwypalbjylswzamcxhscyuyloztmwfnldlgskpyptgsdecfamtaaddyoeadlncsdwykcsfnykaeykaocywlcscewfaycytedmfeayghlptnin',
  hdkeyCbor:
    'a403582102eae4b876a8696134b868f88cc2f51f715f2dbedb7446b8e6edf3d4541c4eb67b045820d882718b7a42806803eeb17f7483f20620611adb88fc943c898dc5aba94c281906d90130a20186182cf5183cf500f5021ae9181cf3081ad32e4508',
  requestId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
};

// Moves a payload across the "air gap" the way the pages do: every QR frame
// of the encoder, as text, into a fresh URDecoder that accepts one type.
function transmit(encoder: any, type: string) {
  const decoder = new URDecoder([type]);
  const frames = encoder.pureParts();
  for (const frame of frames) decoder.receive(frame.toUpperCase()); // QR alphanumeric mode
  ok(decoder.isComplete, `${type} reassembled from ${frames.length} frame(s)`);
  return { payload: decoder.payload, frames: frames.length };
}
const fieldMap = (pairs: [string, string][]) => Object.fromEntries(pairs);

const cold = createColdSigner(KEY);
const pairing = parsePairing(transmit(cold.pairing(), 'crypto-hdkey').payload);

const eip1559 = (fields: Record<string, unknown>) =>
  Transaction.prepare({
    nonce: 7n,
    value: 0n,
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    chainId: 1n,
    ...fields,
  } as any);
const transferData = (to: string, value: bigint) =>
  ethHex.encode(createContract(ERC20).transfer.encodeInput({ to, value }));

// One full round: hot request -> QR -> cold review -> approve -> QR -> hot apply.
async function roundTrip(pending: any) {
  const review = await cold.review(transmit(pending.encoder, 'eth-sign-request').payload);
  const { encoder } = review.approve();
  const signature = transmit(encoder, 'eth-signature').payload;
  return { review, result: applySignature(pairing, pending, signature), signature };
}

describe('erc4527: Keystone reference vectors', () => {
  should('eth-sign-request decodes and re-encodes byte for byte', () => {
    for (const ur of [KEYSTONE.requestWithOrigin, KEYSTONE.request]) {
      const req = decodeSignRequest(decodeUR(ur).payload);
      deepStrictEqual(uuidString(req.requestId), KEYSTONE.requestId);
      deepStrictEqual(bytesToHex(req.signData), KEYSTONE.signData);
      deepStrictEqual(req.dataType, DATA_TYPE.transaction);
      deepStrictEqual(req.chainId, 1n);
      deepStrictEqual(formatKeypath(req.derivationPath), "[12345678] m/44'/1'/1'/0/1");
      deepStrictEqual(encodeUR('eth-sign-request', encodeSignRequest(req)), ur);
    }
    deepStrictEqual(
      decodeSignRequest(decodeUR(KEYSTONE.requestWithOrigin).payload).origin,
      'metamask'
    );
  });
  should('eth-signature decodes and re-encodes byte for byte', () => {
    const sig = decodeSignature(decodeUR(KEYSTONE.signature).payload);
    deepStrictEqual(uuidString(sig.requestId), KEYSTONE.requestId);
    deepStrictEqual(bytesToHex(sig.signature), KEYSTONE.signatureBytes);
    deepStrictEqual(sig.origin, 'keystone');
    deepStrictEqual(encodeUR('eth-signature', encodeSignature(sig)), KEYSTONE.signature);
  });
  should('crypto-hdkey decodes and re-encodes byte for byte', () => {
    const { payload } = decodeUR(KEYSTONE.hdkey);
    deepStrictEqual(bytesToHex(payload), KEYSTONE.hdkeyCbor);
    const key = decodeHDKey(payload);
    deepStrictEqual(formatKeypath(key.origin), "[e9181cf3] m/44'/60'/0'");
    deepStrictEqual(bytesToHex(encodeHDKey(key)), KEYSTONE.hdkeyCbor);
  });
  should('uuid helpers', () => {
    deepStrictEqual(uuidString(uuidBytes(KEYSTONE.requestId)), KEYSTONE.requestId);
  });
});

describe('airgap: pairing', () => {
  should('the cold signer shares a public key only, as one QR', () => {
    const encoder = cold.pairing();
    deepStrictEqual(encoder.isSinglePart, true);
    const [frame] = encoder.pureParts();
    ok(frame.startsWith('ur:crypto-hdkey/'), frame);
    // public fields only: key-data, origin, name — no is-private, no chain code
    const fields = cbor.decode(decodeUR(frame).payload) as Map<number, unknown>;
    deepStrictEqual([...fields.keys()], [3, 6, 9]);
    deepStrictEqual(pairing.address, DEMO);
    deepStrictEqual(pairing.path, `[${cold.fingerprint}] m`);
  });
  should('refuse HD (xpub) keys, private keys and invalid points', () => {
    throws(() => parsePairing(decodeUR(KEYSTONE.hdkey).payload), /extended \(HD\) public key/);
    const priv = cbor.encode(
      new Map<number, unknown>([
        [2, true],
        [3, new Uint8Array(33).fill(2)],
      ])
    );
    throws(() => parsePairing(priv), /private key/);
    const offCurve = new Uint8Array(33).fill(0xff);
    offCurve[0] = 2;
    throws(() => parsePairing(cbor.encode(new Map([[3, offCurve]]))));
    throws(() => parsePairing(cbor.encode(new Map([[3, new Uint8Array(32)]]))), /field 3/);
  });
  should('a solo key without origin is named by its own fingerprint', () => {
    const { payload } = decodeUR(cold.pairing().pureParts()[0]);
    const map = cbor.decode(payload) as Map<number, unknown>;
    map.delete(6);
    deepStrictEqual(parsePairing(cbor.encode(map)).path, pairing.path);
  });
});

describe('airgap: signing round trips', () => {
  should('ETH transfer (EIP-1559): reviewed, signed, verified', async () => {
    const tx = eip1559({ to: RECIPIENT, value: 100_000_000_000_000_000n, gasLimit: 21000n });
    const { review, result } = await roundTrip(transactionRequest(pairing, tx));
    const shown = fieldMap(review.normal);
    deepStrictEqual(shown.network, 'Ethereum mainnet (chain 1)');
    deepStrictEqual(shown.from, DEMO);
    deepStrictEqual(shown.to, RECIPIENT);
    deepStrictEqual(shown.amount, '0.1 ETH');
    deepStrictEqual(shown['max total fee'], '0.00063 ETH');
    deepStrictEqual(review.warnings, []);
    deepStrictEqual(fieldMap(review.muted)['requested by'], 'micro-eth-signer hot');
    const signed = Transaction.fromHex(result.hex);
    deepStrictEqual(signed.sender, DEMO);
    deepStrictEqual(signed.raw.to, RECIPIENT);
    deepStrictEqual(signed.raw.value, 100_000_000_000_000_000n);
    deepStrictEqual(result.hash, signed.hash);
    deepStrictEqual(fieldMap(result.muted).txid, signed.hash);
  });
  should('curated ERC-20 (USDC): clear-signing intent and labeled fields', async () => {
    const tx = eip1559({
      to: USDC,
      value: 0n,
      gasLimit: 60000n,
      data: transferData(RECIPIENT, 2_500_000n),
    });
    const { review, result } = await roundTrip(transactionRequest(pairing, tx));
    const shown = fieldMap(review.normal);
    deepStrictEqual(shown.contract, `${USDC} · USDC`);
    deepStrictEqual(shown.intent, `Transfer 2.5 USDC to ${RECIPIENT}`, 'checksummed');
    // the ERC-7730 descriptor's own labels and formatting
    deepStrictEqual(shown.Amount, '2.5 USDC');
    deepStrictEqual(shown.To, RECIPIENT, 'the token recipient, not the contract');
    deepStrictEqual(shown.value, undefined, 'no ETH sent: no value row');
    deepStrictEqual(review.warnings, []);
    deepStrictEqual(Transaction.fromHex(result.hex).sender, DEMO);
  });
  should('unlimited approval: the descriptor names spender and amount', async () => {
    const data = ethHex.encode(
      createContract(ERC20).approve.encodeInput({
        spender: UNISWAP_V2_ROUTER_CONTRACT,
        value: 2n ** 256n - 1n,
      })
    );
    const review = await cold.review(
      transmit(
        transactionRequest(pairing, eip1559({ to: USDC, gasLimit: 60000n, data })).encoder,
        'eth-sign-request'
      ).payload
    );
    const shown = fieldMap(review.normal);
    deepStrictEqual(shown.intent, 'Allow spending Unlimited USDC by UNISWAP V2 ROUTER');
    deepStrictEqual(shown.Spender, 'UNISWAP V2 ROUTER');
    deepStrictEqual(shown.Amount, 'Unlimited USDC');
  });
  should('Uniswap V2 swap with ETH: every descriptor field, plus the value sent', async () => {
    const data = ethHex.encode(
      createContract(UNISWAP_V2_ROUTER).swapExactETHForTokens.encodeInput({
        amountOutMin: 2_000_000_000n,
        path: [WETH_CONTRACT, USDC],
        to: DEMO,
        deadline: 2_000_000_000n,
      })
    );
    const tx = eip1559({
      to: UNISWAP_V2_ROUTER_CONTRACT,
      value: 10n ** 18n,
      gasLimit: 200000n,
      data,
    });
    const { review, result } = await roundTrip(transactionRequest(pairing, tx));
    const shown = fieldMap(review.normal);
    deepStrictEqual(
      shown.contract,
      `${addr.addChecksum(UNISWAP_V2_ROUTER_CONTRACT)} · UNISWAP V2 ROUTER`
    );
    deepStrictEqual(shown.value, '1 ETH');
    match(shown.intent, /^Swap 1 ETH for at least 2000 USDC\. Expires at /);
    deepStrictEqual(shown['Amount to Send'], '1 ETH');
    deepStrictEqual(shown['Minimum to Receive'], '2000 USDC');
    deepStrictEqual(shown.Beneficiary, DEMO, 'checksummed');
    deepStrictEqual(shown.Deadline, new Date(2_000_000_000 * 1000).toUTCString());
    deepStrictEqual(review.warnings, []);
    deepStrictEqual(Transaction.fromHex(result.hex).sender, DEMO);
  });
  should(
    'known function without a descriptor, unknown selector: call row and a warning',
    async () => {
      const withdraw = ethHex.encode(createContract(WETH).withdraw.encodeInput(10n ** 17n));
      const known = await cold.review(
        transmit(
          transactionRequest(
            pairing,
            eip1559({ to: WETH_CONTRACT, gasLimit: 60000n, data: withdraw })
          ).encoder,
          'eth-sign-request'
        ).payload
      );
      deepStrictEqual(fieldMap(known.normal).call, 'withdraw(uint256)');
      match(known.warnings.join(' '), /its arguments are not shown/);
      const unknown = await cold.review(
        transmit(
          transactionRequest(
            pairing,
            eip1559({ to: RECIPIENT, gasLimit: 60000n, data: '0xdeadbeef' })
          ).encoder,
          'eth-sign-request'
        ).payload
      );
      deepStrictEqual(fieldMap(unknown.normal).call, 'unknown function, selector 0xdeadbeef');
      match(unknown.warnings.join(' '), /cannot decode it/);
    }
  );
  should('a mainnet token address on another chain is not trusted', async () => {
    const tx = eip1559({
      to: USDC,
      chainId: 11155111n,
      gasLimit: 60000n,
      data: transferData(RECIPIENT, 2_500_000n),
    });
    const review = await cold.review(
      transmit(transactionRequest(pairing, tx).encoder, 'eth-sign-request').payload
    );
    const shown = fieldMap(review.normal);
    deepStrictEqual(shown.intent, undefined, 'descriptors are chain-bound');
    deepStrictEqual(shown.amount, '2500000 base units');
    match(review.warnings.join(' '), /Unknown token contract/);
  });
  should('unknown token: base units and a warning, still signable', async () => {
    const tx = eip1559({
      to: CAT,
      value: 0n,
      gasLimit: 60000n,
      data: transferData(RECIPIENT, 5n * 10n ** 17n),
    });
    const { review } = await roundTrip(transactionRequest(pairing, tx));
    const shown = fieldMap(review.normal);
    deepStrictEqual(shown.amount, '500000000000000000 base units');
    deepStrictEqual(shown.token, `${CAT} · unknown token`);
    match(review.warnings.join(' '), /Unknown token contract/);
  });
  should('legacy (EIP-155) on Sepolia: multi-byte v round-trips', async () => {
    const tx = Transaction.prepare({
      type: 'legacy',
      to: RECIPIENT,
      value: 1n,
      nonce: 0n,
      gasPrice: 2_000_000_000n,
      chainId: 11155111n,
    });
    const { review, result, signature } = await roundTrip(transactionRequest(pairing, tx));
    deepStrictEqual(fieldMap(review.normal).network, 'Sepolia testnet (chain 11155111)');
    deepStrictEqual(
      decodeSignature(signature).signature.length,
      68,
      'v = chainId * 2 + 35 + parity'
    );
    const signed = Transaction.fromHex(result.hex);
    deepStrictEqual(signed.sender, DEMO);
    deepStrictEqual(signed.raw.chainId, 11155111n);
  });
  should('personal message: long text animates, signature recovers', async () => {
    const message = `Sign in to example.org\n${'nonce '.repeat(60)}`;
    const pending = messageRequest(pairing, message, 1n);
    ok(transmit(pending.encoder, 'eth-sign-request').frames > 1, 'multi-part (animated) request');
    const { review, result } = await roundTrip(pending);
    deepStrictEqual(fieldMap(review.normal).message, message);
    deepStrictEqual(review.warnings, []);
    deepStrictEqual(eip191Signer.recoverAddress(result.signature, message), DEMO);
    ok(eip191Signer.verify(result.signature, message, DEMO));
  });
  should('unreadable messages are shown as hex with a warning', async () => {
    for (const message of ['bidi \u202e override', 'nul \u0000 byte']) {
      const review = await cold.review(
        transmit(messageRequest(pairing, message, 1n).encoder, 'eth-sign-request').payload
      );
      match(fieldMap(review.normal).message, /^0x[0-9a-f]+$/);
      match(review.warnings.join(' '), /not readable text/);
    }
  });
});

describe('airgap: the cold signer refuses', () => {
  const tx = eip1559({ to: RECIPIENT, value: 1n, gasLimit: 21000n });
  const base = {
    requestId: uuidBytes(KEYSTONE.requestId),
    signData: tx.toBytes({ includeSignature: false }),
    dataType: DATA_TYPE.typedTransaction,
    chainId: 1n,
    derivationPath: pairing.derivationPath,
    address: DEMO,
  };
  const review = (fields: Record<string, unknown>) =>
    cold.review(encodeSignRequest({ ...base, ...fields } as any));

  should('accept the baseline request (sanity)', async () => {
    deepStrictEqual((await review({})).kind, 'transaction');
  });
  should('requests for another key or address', async () => {
    await rejects(
      review({ derivationPath: { components: [], sourceFingerprint: 0x12345678 } }),
      /\[12345678\] m/
    );
    await rejects(
      review({
        derivationPath: {
          components: [{ index: 44, hardened: true }],
          sourceFingerprint: parseInt(cold.fingerprint, 16),
        },
      }),
      /m\/44'/
    );
    await rejects(review({ address: RECIPIENT }), /request is for 0xd8dA/);
  });
  should('chain id mismatches and replayable legacy transactions', async () => {
    await rejects(review({ chainId: 5n }), /says chain 5, the transaction is for chain 1/);
    const preEip155 = Transaction.prepare({
      type: 'legacy',
      to: RECIPIENT,
      value: 1n,
      nonce: 0n,
      gasPrice: 10n ** 9n,
      chainId: undefined,
    } as any);
    await rejects(
      review({
        signData: preEip155.toBytes({ includeSignature: false }),
        dataType: DATA_TYPE.transaction,
      }),
      /pre-EIP-155/
    );
  });
  should('data type mismatches, typed data, unknown types', async () => {
    await rejects(review({ dataType: DATA_TYPE.transaction }), /does not match a eip1559/);
    await rejects(review({ dataType: DATA_TYPE.typedData }), /EIP-712 typed data is not supported/);
    await rejects(review({ dataType: 9 }), /Unknown request data type 9/);
  });
  should('signed or malformed payloads, missing request id', async () => {
    const signed = tx.signBy(KEY);
    await rejects(review({ signData: signed.toBytes() }), /already-signed/);
    await rejects(review({ signData: Uint8Array.of(2, 0xc0) }), /Malformed transaction/);
    await rejects(review({ requestId: undefined }), /no request id/);
    // wrong CBOR tag on the derivation path
    const map = cbor.decode(encodeSignRequest(base as any)) as Map<number, any>;
    map.set(5, new Tagged(303, map.get(5).value));
    await rejects(cold.review(cbor.encode(map)), /tag 304/);
  });
});

describe('airgap: the hot wallet refuses', () => {
  const tx = eip1559({ to: RECIPIENT, value: 1n, gasLimit: 21000n });
  should('a signature for another request', async () => {
    const first = transactionRequest(pairing, tx);
    const second = transactionRequest(pairing, tx);
    const review = await cold.review(transmit(first.encoder, 'eth-sign-request').payload);
    const signature = transmit(review.approve().encoder, 'eth-signature').payload;
    throws(
      () => applySignature(pairing, second, signature),
      /answers request .* not the current one/
    );
    ok(applySignature(pairing, first, signature).hex, 'the matching request accepts it');
  });
  should('a signature by another key', () => {
    const pending = transactionRequest(pairing, tx);
    const other = tx.signBy(addr.random().privateKey).raw as any;
    const sig = hexToBytes(
      other.r.toString(16).padStart(64, '0') +
        other.s.toString(16).padStart(64, '0') +
        '0' +
        other.yParity
    );
    const payload = encodeSignature({ requestId: pending.requestId, signature: sig });
    throws(() => applySignature(pairing, pending, payload), /not the paired 0x7E5F/);
  });
  should('a tampered or malformed signature', async () => {
    const pending = transactionRequest(pairing, tx);
    const review = await cold.review(transmit(pending.encoder, 'eth-sign-request').payload);
    const good = decodeSignature(transmit(review.approve().encoder, 'eth-signature').payload);
    const flipped = good.signature.slice();
    flipped[40] ^= 1; // s
    throws(
      () => applySignature(pairing, pending, encodeSignature({ ...good, signature: flipped })),
      /Invalid signature|not the paired/
    );
    const badV = good.signature.slice();
    badV[64] = 7;
    throws(
      () => applySignature(pairing, pending, encodeSignature({ ...good, signature: badV })),
      /unexpected v=7/
    );
    throws(
      () =>
        applySignature(
          pairing,
          pending,
          encodeSignature({ ...good, signature: good.signature.slice(0, 64) })
        ),
      /field 2/
    );
    const zero = new Uint8Array(65);
    throws(
      () => applySignature(pairing, pending, encodeSignature({ ...good, signature: zero })),
      /Invalid signature/
    );
  });
});

should.runWhen(import.meta.url);
