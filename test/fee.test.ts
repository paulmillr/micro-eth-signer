import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual } from 'node:assert';
import { Transaction } from '../src/index.ts';
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
});

should.runWhen(import.meta.url);
