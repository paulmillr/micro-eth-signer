import { bench } from '@paulmillr/jsbt/bench.js';
import { trustedSetup as kzgSetup } from '@paulmillr/trusted-setups/fast-kzg.js';
import url from 'node:url';
import { ERC20, TOKENS_BY_SYMBOL, createContract, decodeData } from '../src/abi/index.ts';
import { RLP } from '../src/core/rlp.ts';
import {
  Transaction,
  addr,
  authorization,
  eip191Signer,
  signTyped,
  ethHex,
  weieth,
  weigwei,
} from '../src/index.ts';
import { KZG } from '../src/kzg.ts';
import * as SSZ from '../src/ssz.ts';

const PRIV = '0x0d3f15106182dd987498bec735ff2c229a0fe62529d30e2959227d4158112280';
const FROM = addr.fromPrivateKey(PRIV);
const TO = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const MESSAGE = 'Hello from micro-eth-signer benchmarks';

const typedData = {
  types: {
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
    ],
  },
  primaryType: 'Mail',
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: 1n,
    verifyingContract: TO,
  },
  message: {
    from: { name: 'Cow', wallet: FROM },
    to: { name: 'Bob', wallet: TO },
    contents: 'Hello, Bob!',
  },
} as const;

const authRequest = {
  chainId: 1n,
  address: TO,
  nonce: 69n,
};
const authItem = authorization.sign(authRequest, PRIV);

const txParams = {
  chainId: 1n,
  maxFeePerGas: weigwei.decode('20'),
  maxPriorityFeePerGas: weigwei.decode('3'),
  nonce: 69n,
  to: TO,
  value: weieth.decode('0.125'),
};
const unsignedTx = Transaction.prepare(txParams);
const signedTx = unsignedTx.signBy(PRIV, false);
const signedTxHex = signedTx.toHex(true);

const kzg = new KZG(kzgSetup);
const kzgBlob = Array.from({ length: 4096 }, (_, i) => BigInt(i + 1));
const kzgZ = 0x123456789n;
const kzgCommitment = kzg.blobToKzgCommitment(kzgBlob);

const erc20 = createContract(ERC20);
const erc20Contract = TOKENS_BY_SYMBOL.USDT.contract;
const erc20Transfer = {
  to: TO,
  value: 123_456_789n,
};

const rlpValue = [
  1n,
  TO,
  weieth.decode('0.125'),
  [
    'micro-eth-signer',
    new Uint8Array([0, 1, 2, 3, 5, 8, 13, 21]),
    [weigwei.decode('20'), weigwei.decode('3')],
  ],
];

const SszPayload = SSZ.container({
  slot: SSZ.uint64,
  proposerIndex: SSZ.uint64,
  parentRoot: SSZ.bytevector(32),
  bodyRoot: SSZ.bytevector(32),
  tags: SSZ.list(16, SSZ.uint16),
});
const sszValue = {
  slot: 12_345n,
  proposerIndex: 678n,
  parentRoot: new Uint8Array(32).fill(1),
  bodyRoot: new Uint8Array(32).fill(2),
  tags: [1, 2, 3, 5, 8, 13],
};

function sanityCheck() {
  const msgSig = eip191Signer.sign(MESSAGE, PRIV, false);
  if (!eip191Signer.verify(msgSig, MESSAGE, FROM)) throw new Error('eip191 sanity check failed');
  if (Transaction.fromHex(signedTxHex).toHex(true) !== signedTxHex)
    throw new Error('transaction sanity check failed');
  if (authorization.getAuthority(authItem) !== FROM)
    throw new Error('authorization sanity check failed');

  const data = ethHex.encode(erc20.transfer.encodeInput(erc20Transfer));
  const decoded = decodeData(erc20Contract, data, 0n);
  if (!decoded || Array.isArray(decoded) || decoded.name !== 'transfer')
    throw new Error('abi sanity check failed');

  const rlpEncoded = RLP.encode(rlpValue);
  RLP.decode(rlpEncoded);
  const sszEncoded = SszPayload.encode(sszValue);
  SszPayload.decode(sszEncoded);

  const [proof, y] = kzg.computeProof(kzgBlob, kzgZ);
  if (!kzg.verifyProof(kzgCommitment, kzgZ, y, proof)) throw new Error('kzg sanity check failed');
}

export async function main() {
  sanityCheck();

  await bench('addr.fromPrivateKey', () => addr.fromPrivateKey(PRIV));
  await bench('eip191.sign', () => eip191Signer.sign(MESSAGE, PRIV, false));
  await bench('eip712.signTyped', () => signTyped(typedData, PRIV, false));
  await bench('authorization.getAuthority', () => authorization.getAuthority(authItem));
  await bench('tx.fromHex', () => Transaction.fromHex(signedTxHex));
  await bench('tx.prepare+sign+toHex', () => unsignedTx.signBy(PRIV, false).toHex(true));
  await bench('tx.recoverSender', () => signedTx.recoverSender());
  await bench('abi.erc20.encode+decodeData', () => {
    const data = ethHex.encode(erc20.transfer.encodeInput(erc20Transfer));
    return decodeData(erc20Contract, data, 0n);
  });
  await bench('rlp.encode+decode', () => RLP.decode(RLP.encode(rlpValue)));
  await bench('ssz.encode+merkleRoot', () => {
    SszPayload.encode(sszValue);
    return SszPayload.merkleRoot(sszValue);
  });
  await bench('kzg.computeProof', () => kzg.computeProof(kzgBlob, kzgZ));
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main();
}
