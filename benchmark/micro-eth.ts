import { bench } from '@paulmillr/jsbt/bench.js';
import { deepStrictEqual, strictEqual } from 'node:assert';
import url from 'node:url';
import * as SSZ from '../src/advanced/ssz.ts';
import { RLP } from '../src/core/rlp.ts';
import { Transaction, addr, amounts } from '../src/index.ts';

const PRIV = '0x0d3f15106182dd987498bec735ff2c229a0fe62529d30e2959227d4158112280';
const TO_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const CHECKSUM_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const FROM_ADDR = '0xAeDA658A7f00805ae47c051EF000cf7d1aE097cD';
const TX_HEX =
  '0x02f86b014584b2d05e008504a817c80082520894f39fd6e51aad88f6f4ce6ab8827279cfffb922668080c080a0a9ff766b8c2faa724e9658625e7c18c6694b1e8d1d740aa4075a5191abccd73ca008a1238402eb55cf19edcd197daf1b73c94d74bd16a1d590897956e6f881b326';

const tx = Transaction.fromHex(TX_HEX);
const unsignedTx = tx.removeSignature();
const txInput = {
  chainId: 1n,
  maxFeePerGas: 20n * amounts.GWEI,
  maxPriorityFeePerGas: 3n * amounts.GWEI,
  nonce: 69n,
  to: TO_ADDR,
  value: 0n,
};

const bytes = (len: number, seed: number): Uint8Array =>
  Uint8Array.from({ length: len }, (_, i) => (i + seed) & 255);
const array = <T>(len: number, fn: (i: number) => T): T[] =>
  Array.from({ length: len }, (_, i) => fn(i));

const rlpInput = [
  1n,
  69n,
  20n * amounts.GWEI,
  TO_ADDR,
  '0x',
  bytes(32, 1),
  [bytes(32, 2), bytes(48, 3), array(32, (i) => BigInt(i + 1))],
];
const rlpEncoded = RLP.encode(rlpInput);
const rlpDecoded = RLP.decode(rlpEncoded);

const SszTransactionBatch = SSZ.container({
  slot: SSZ.uint64,
  proposerIndex: SSZ.uint64,
  parentRoot: SSZ.bytevector(32),
  feeRecipient: SSZ.bytevector(20),
  transactions: SSZ.list(16, SSZ.bytelist(256)),
  flags: SSZ.bitlist(128),
});
const sszValue = {
  slot: 8_626_176n,
  proposerIndex: 1337n,
  parentRoot: bytes(32, 4),
  feeRecipient: bytes(20, 5),
  transactions: [bytes(96, 6), bytes(128, 7), bytes(64, 8)],
  flags: array(96, (i) => i % 3 === 0),
};
const sszEncoded = SszTransactionBatch.encode(sszValue);
const sszDecoded = SszTransactionBatch.decode(sszEncoded);

let sink: unknown;
const consume = <T>(value: T): T => {
  sink = value;
  return value;
};

function sanityCheck() {
  strictEqual(addr.addChecksum(TO_ADDR), CHECKSUM_ADDR);
  strictEqual(addr.addChecksum(addr.parse(CHECKSUM_ADDR).data), CHECKSUM_ADDR);
  strictEqual(addr.isValid(CHECKSUM_ADDR), true);
  strictEqual(addr.fromPrivateKey(PRIV), FROM_ADDR);

  strictEqual(tx.toHex(true), TX_HEX);
  strictEqual(tx.sender, FROM_ADDR);
  strictEqual(unsignedTx.signBy(PRIV, false).toHex(true), TX_HEX);
  strictEqual(Transaction.prepare(txInput).toHex(false), unsignedTx.toHex(false));

  deepStrictEqual(RLP.encode(rlpDecoded), rlpEncoded);

  deepStrictEqual(sszDecoded, sszValue);
  deepStrictEqual(SszTransactionBatch.encode(sszDecoded), sszEncoded);
  strictEqual(SszTransactionBatch.merkleRoot(sszValue).length, 32);
}

export async function main() {
  sanityCheck();

  await bench('tx decode', () => consume(Transaction.fromHex(TX_HEX)));
  await bench('tx encode', () => consume(tx.toHex(true)));
  await bench('tx decode+encode', () => consume(Transaction.fromHex(TX_HEX).toHex(true)));

  await bench('address decode', () => consume(addr.parse(CHECKSUM_ADDR)));
  await bench('address encode', () => consume(addr.addChecksum(TO_ADDR)));
  await bench('address decode+encode', () =>
    consume(addr.addChecksum(addr.parse(CHECKSUM_ADDR).data))
  );

  await bench('rlp encode', () => consume(RLP.encode(rlpInput)));
  await bench('rlp decode', () => consume(RLP.decode(rlpEncoded)));
  await bench('rlp decode+encode', () => consume(RLP.encode(RLP.decode(rlpEncoded))));

  await bench('ssz encode', () => consume(SszTransactionBatch.encode(sszValue)));
  await bench('ssz decode', () => consume(SszTransactionBatch.decode(sszEncoded)));
  await bench('ssz merkleRoot', () => consume(SszTransactionBatch.merkleRoot(sszValue)));
  await bench('ssz decode+encode', () =>
    consume(SszTransactionBatch.encode(SszTransactionBatch.decode(sszEncoded)))
  );

  if (sink === undefined) throw new Error('benchmark sink was not touched');
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main();
}
