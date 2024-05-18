import { deepStrictEqual } from 'node:assert';
import { describe, should } from 'micro-should';
import { Transaction } from '../esm/index.js';
import { weieth, weigwei } from '../esm/utils.js';

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
    deepStrictEqual(tx.calcAmounts(), {
      wei: {
        amount: 1000000000000000000n,
        fee: 42000000000000n,
        amountWithFee: 1000042000000000000n,
      },
      humanized: { amount: '1', fee: '0.000042', amountWithFee: '1.000042' },
    });
    const tx2 = Transaction.prepare({
      type: 'legacy',
      to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
      nonce: 1n,
      value: weieth.decode('1.23'),
      gasPrice: weigwei.decode('55.3'),
    });
    deepStrictEqual(tx2.calcAmounts(), {
      wei: {
        amount: 1230000000000000000n,
        fee: 1161300000000000n,
        amountWithFee: 1231161300000000000n,
      },
      humanized: { amount: '1.23', fee: '0.0011613', amountWithFee: '1.2311613' },
    });
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
    deepStrictEqual(tx.calcAmounts(), {
      wei: {
        amount: 1000000000000000000n,
        fee: 42000000000000n,
        amountWithFee: 1000042000000000000n,
      },
      humanized: { amount: '1', fee: '0.000042', amountWithFee: '1.000042' },
    });
    const tx2 = Transaction.prepare({
      to: '0x27b1fdb04752bbc536007a920d24acb045561c26',
      nonce: 1n,
      value: weieth.decode('1.23'),
      maxFeePerGas: weigwei.decode('55.3'),
      maxPriorityFeePerGas: weigwei.decode('2'),
    });
    // 21k * 2 = 42
    deepStrictEqual(tx2.calcAmounts(), {
      wei: {
        amount: 1230000000000000000n,
        fee: 1161300000000000n,
        amountWithFee: 1231161300000000000n,
      },
      humanized: { amount: '1.23', fee: '0.0011613', amountWithFee: '1.2311613' },
    });
  });
});

// ESM is broken.
import url from 'node:url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  should.run();
}
