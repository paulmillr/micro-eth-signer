import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, throws } from 'node:assert';
import { Transaction, addr, authorization } from '../src/index.ts';
import { weieth, weigwei } from '../src/utils.ts';

// NOTE: other libraries doesn't support fee estimation, so there is no crosstests for now :(
// But we need some tests to avoid accidental breakage.
describe('Fees', () => {
  should('Legacy', () => {
    const tx = Transaction.prepare({
      type: 'legacy',
      to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
      nonce: 1n,
      value: weieth.decode('1'),
      gasPrice: weigwei.decode('2'),
    });
    // 21k * 2 = 42
    deepStrictEqual(tx.fee, 42000000000000n);
    const tx2 = Transaction.prepare({
      type: 'legacy',
      to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
      nonce: 1n,
      value: weieth.decode('1.23'),
      gasPrice: weigwei.decode('55.3'),
    });
    deepStrictEqual(tx2.fee, 1161300000000000n);
  });
  should('EIP1559', () => {
    const tx = Transaction.prepare({
      to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
      nonce: 1n,
      value: weieth.decode('1'),
      maxFeePerGas: weigwei.decode('2'),
      maxPriorityFeePerGas: weigwei.decode('1'),
    });
    // 21k * 2 = 42
    deepStrictEqual(tx.fee, 42000000000000n);
    const tx2 = Transaction.prepare({
      to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
      nonce: 1n,
      value: weieth.decode('1.23'),
      maxFeePerGas: weigwei.decode('55.3'),
      maxPriorityFeePerGas: weigwei.decode('2'),
    });
    // 21k * 2 = 42
    deepStrictEqual(tx2.fee, 1161300000000000n);
  });
  should('EIP4844', () => {
    const tx = Transaction.prepare(
      {
        type: 'eip4844',
        to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
        nonce: 1n,
        value: weieth.decode('1'),
        maxFeePerGas: weigwei.decode('2'),
        maxPriorityFeePerGas: weigwei.decode('1'),
        maxFeePerBlobGas: 3n,
        blobVersionedHashes: ['0x01' + '00'.repeat(31), '0x01' + '11'.repeat(31)],
      },
      false
    );
    deepStrictEqual(tx.fee, 42000000000000n + 2n * 131072n * 3n);
  });
  should('Whole amount', () => {
    const tx = Transaction.prepare({
      to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
      nonce: 1n,
      value: weieth.decode('1'),
      maxFeePerGas: weigwei.decode('2'),
      maxPriorityFeePerGas: weigwei.decode('1'),
    });
    const tx2 = tx.setWholeAmount(weieth.decode('1'));
    deepStrictEqual(tx.fee, 42000000000000n);
    deepStrictEqual(tx2.raw, {
      to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
      value: 999958000000000000n,
      nonce: 1n,
      maxFeePerGas: 2000000000n,
      maxPriorityFeePerGas: 2000000000n,
      gasLimit: 21000n,
      accessList: [],
      chainId: 1n,
      data: '',
      type: 'eip1559',
    });
  });
  should('Whole amount: legacy & burnRemaining=false', () => {
    const legacy = Transaction.prepare({
      type: 'legacy',
      to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
      nonce: 1n,
      value: weieth.decode('1'),
      gasPrice: weigwei.decode('2'),
    });
    const wholeLegacy = legacy.setWholeAmount(weieth.decode('1'));
    deepStrictEqual(wholeLegacy.raw.value, 999958000000000000n);
    // legacy has no priority fee to adjust, gasPrice stays as-is
    deepStrictEqual(wholeLegacy.raw.gasPrice, weigwei.decode('2'));
    const tx = Transaction.prepare({
      to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
      nonce: 1n,
      value: weieth.decode('1'),
      maxFeePerGas: weigwei.decode('2'),
    });
    // default burnRemaining=true bumps priority fee to maxFeePerGas, false keeps it
    deepStrictEqual(
      tx.setWholeAmount(weieth.decode('1')).raw.maxPriorityFeePerGas,
      weigwei.decode('2')
    );
    deepStrictEqual(
      tx.setWholeAmount(weieth.decode('1'), false).raw.maxPriorityFeePerGas,
      weigwei.decode('1')
    );
    throws(() => tx.setWholeAmount(0n), /must be bigger than 0/);
    throws(() => tx.setWholeAmount(tx.fee), /must be bigger than fee/);
    // changing value/fees would invalidate the signature
    const priv = '0x6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e';
    throws(() => tx.signBy(priv).setWholeAmount(weieth.decode('1')), /expected unsigned/);
    // non-strict txs stay non-strict: fee fields above the strict UI caps must not throw
    const loose = Transaction.prepare(
      {
        to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
        nonce: 1n,
        value: 1n,
        maxFeePerGas: weigwei.decode('20000'),
        maxPriorityFeePerGas: weigwei.decode('20000'),
      },
      false
    );
    const looseRt = Transaction.fromHex(loose.toHex(false));
    deepStrictEqual(
      looseRt.setWholeAmount(weieth.decode('10')).raw.value,
      weieth.decode('10') - looseRt.fee
    );
  });
  should('Whole amount: EIP4844 includes blob fee', () => {
    const tx = Transaction.prepare({
      type: 'eip4844',
      to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
      nonce: 1n,
      value: 0n,
      maxFeePerGas: weigwei.decode('2'),
      maxPriorityFeePerGas: weigwei.decode('1'),
      maxFeePerBlobGas: 3n,
      blobVersionedHashes: ['0x01' + '00'.repeat(31)],
    });
    // 21000 * 2 gwei + 131072 blob gas * 1 blob * 3 wei
    deepStrictEqual(tx.fee, 42000000000000n + 131072n * 3n);
    deepStrictEqual(tx.setWholeAmount(weieth.decode('1')).raw.value, weieth.decode('1') - tx.fee);
  });
  should('intrinsic gas defaults', () => {
    const base = {
      to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
      nonce: 1n,
      value: 1n,
      maxFeePerGas: weigwei.decode('2'),
    };
    // EIP-2930 calldata pricing: 4 gas per zero byte, 16 per non-zero byte
    deepStrictEqual(Transaction.prepare({ ...base, data: '0x00ff' }).raw.gasLimit, 21020n);
    // access list: 2400 per address, 1900 per storage key
    deepStrictEqual(
      Transaction.prepare({
        ...base,
        accessList: [
          {
            address: '0x27b1fdb04752bbc536007a920d24acb045561c26',
            storageKeys: ['0x' + '00'.repeat(32), '0x' + '11'.repeat(32)],
          },
        ],
      }).raw.gasLimit,
      21000n + 2400n + 2n * 1900n
    );
    // EIP-7702: 25000 per authorization
    const acc = addr.random();
    const auth = authorization.sign({ chainId: 1n, address: acc.address, nonce: 0n }, acc.privateKey);
    deepStrictEqual(
      Transaction.prepare({ ...base, type: 'eip7702', authorizationList: [auth] }).raw.gasLimit,
      46000n
    );
    // contract creation adds G_txcreate: 21000 + 32000 + 4*16 (data) + 2 (EIP-3860 word)
    deepStrictEqual(
      Transaction.prepare({ ...base, to: '0x', data: '0x60016001' }).raw.gasLimit,
      53066n
    );
    // strict mode rejects explicit gasLimit below intrinsic
    throws(() => Transaction.prepare({ ...base, data: '0x00ff', gasLimit: 21000n }));
  });
});

should.runWhen(import.meta.url);
