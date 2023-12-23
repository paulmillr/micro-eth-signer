import { strict as assert } from 'node:assert';
import { should } from 'micro-should';
const { deepStrictEqual } = assert;
import { Address, Transaction } from '../lib/esm/index.js';
import * as validate from '../lib/esm/tx-validator.js';
import * as formatters from '../lib/esm/formatters.js';
import { readFile } from 'node:fs/promises';

(async () => {
  async function readJSON(file) {
    const d = await readFile(new URL(file, import.meta.url));
    return JSON.parse(d);
  }
  const txs = await readJSON('./transactions.json');
  const eip155 = (await readJSON('./eip155.json')).slice(1);

  // for (let txr of txs) {
  const expected = txs[0];
  const priv = '0687640ee33ef844baba3329db9e16130bd1735cbae3657bd64aed25e9a5c377';
  const pub = '030fba7ba5cfbf8b00dd6f3024153fc44ddda93727da58c99326eb0edd08195cdb';
  const addr = '0xD4fE407789e11a27b7888A324eC597435353dC35';

  const priv2 = '71a75261bc0f7f89cd4f2a5f05188d2411bb4b91a6594c6cffa32fe38493c5e2';
  const addr2 = '0xdf90deA0E0bf5cA6D2A7F0cB86874BA6714F463E';

  should('generate correct address with Address.fromPrivateKey()', () => {
    assert.equal(Address.fromPrivateKey(priv), addr);
  });
  should('generate correct address with Address.fromPublicKey()', () => {
    assert.equal(Address.fromPublicKey(pub), addr);
  });
  should('generate correct Transaction.hash', async () => {
    const etx = new Transaction(expected.hex, 'ropsten');
    assert.equal(etx.hash, expected.hash.slice(2));
  });
  should('parse tx details correctly', () => {
    const etx = new Transaction(expected.hex, 'ropsten');
    assert.equal(etx.nonce, 1);
    assert.equal(etx.fee, 210000000000000n); // 21000 limit, 10 gwei price
    assert.equal(etx.amount, 10000000000000000n);
  });
  should('parse tx sender correctly', () => {
    const etx = new Transaction(expected.hex, 'ropsten');
    assert.equal(etx.sender, addr, 'sender is incorrect');
  });
  should('compare with Transaction.equals()', () => {
    const etx1 = new Transaction(expected.hex, 'ropsten');
    const etx2 = new Transaction(expected.hex, 'ropsten');
    assert.ok(etx1.equals(etx2));
  });
  should('construct Transaction properly', async () => {
    const etx = new Transaction(expected.hex, 'ropsten');
    const tx = new Transaction(expected.raw, 'ropsten');
    const signed = await tx.sign(priv);
    assert.deepEqual(signed, etx);
  });

  should('handle EIP155 test vectors (raw)', () => {
    for (let vector of eip155) {
      const a = new Transaction(vector.transaction);
      const b = new Transaction(vector.rlp);
      assert.deepEqual(a.raw, b.raw, 'raw');
      assert.deepEqual(a.raw, { ...vector.transaction, chainId: '0x01' }, 'transaction');
    }
  });

  should('handle EIP155 test vectors (recursive)', () => {
    for (let vector of eip155) {
      const ours = new Transaction(vector.rlp);
      assert.deepEqual(ours.raw, new Transaction(ours.hex).raw);
    }
  });

  should('handle EIP155 test vectors (hash)', () => {
    for (let vector of eip155) {
      const ours = new Transaction(vector.transaction);
      assert.deepEqual(ours.getMessageToSign(), vector.hash);
    }
  });

  should('handle EIP155 test vectors (sender)', () => {
    for (let vector of eip155) {
      const ours = new Transaction(vector.rlp);
      assert.deepEqual(ours.sender.toLowerCase().slice(2), vector.sender);
    }
  });

  should('getMessageToSign data should equal in signed/unsigned', async () => {
    const tx = new Transaction({
      to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
      gasPrice: 100n * 10n ** 9n, // 100 gwei in wei
      value: 10n ** 18n, // 1 eth in wei
      nonce: 1,
    });
    const privateKey = '6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e';
    const signedTx = await tx.sign(privateKey); // Uint8Array is also accepted
    const addr = Address.fromPrivateKey(privateKey);
    assert.equal(signedTx.sender, addr);
  });

  // should('handle web3.js test vectors', async () => {
  //   const txs = require('./web3js-transactions.json');
  //   const { strip0x } = require('../index');

  //   for (let tx of txs) {
  //     if (tx.error) continue;
  //     if (tx.rawTransaction) {
  //       const parsed = new Transaction(tx.rawTransaction);
  //       assert.deepStrictEqual(parsed.hash, strip0x(tx.transactionHash));
  //       assert.deepStrictEqual(parsed.sender, tx.address);
  //       const constructed = new Transaction({
  //         ...tx.transaction,
  //         gasLimit: tx.transaction.gas,
  //         data: tx.transaction.input || tx.transaction.data,
  //       });
  //       const addr = Address.fromPrivateKey(tx.privateKey);
  //       assert.deepStrictEqual(addr, tx.address);
  //       // web3 constructs with different set of rules
  //       const signed = await constructed.sign(tx.privateKey);
  //       assert.deepStrictEqual(signed.hash, strip0x(tx.transactionHash));
  //       assert.deepStrictEqual(signed.sender, tx.address);
  //       assert.deepStrictEqual(signed.hex, tx.rawTransaction);
  //     }
  //   }
  // });

  should('handle ethers.js test vectors', async () => {
    const txs = await readJSON('./ethers-transactions.json');

    const REQUIRED = ['nonce', 'gasPrice', 'to', 'value', 'data'];
    txs_loop: for (let tx of txs) {
      // Ignore blank tests, micro-eth-signer doesn't support empty fields
      if (tx.name.startsWith('blank_')) continue;
      if (tx.gasPrice == '0x' || tx.gasLimit == '0x') continue;
      for (let f of REQUIRED) if (!tx[f]) continue txs_loop;
      const addr = Address.fromPrivateKey(tx.privateKey);
      assert.deepStrictEqual(addr.toLowerCase(), tx.accountAddress, 'Address.fromPrivateKey');
      const constructed5 = new Transaction(
        {
          to: tx.to,
          data: tx.data,
          gasLimit: tx.gasLimit,
          gasPrice: tx.gasPrice,
          value: tx.value,
          nonce: tx.nonce,
        },
        'goerli'
      );
      // Important: unsigned TX with EIP155 has [chainId, '', ''] instead of [v, r, s]
      assert.deepStrictEqual(constructed5.hex, tx.unsignedTransactionChainId5, 'constructed5.hex');
      const parsedUnsigned = new Transaction(tx.unsignedTransaction);
      const parsedUnsigned5 = new Transaction(tx.unsignedTransactionChainId5, 'goerli');
      assert.deepStrictEqual(parsedUnsigned.hex, tx.unsignedTransaction, 'parsedUnsigned.hex');

      assert.deepStrictEqual(
        parsedUnsigned5.hex,
        tx.unsignedTransactionChainId5,
        'parsedUnsigned5.hex'
      );
      const parsedSigned = new Transaction(tx.signedTransaction);
      assert.deepStrictEqual(parsedSigned.hex, tx.signedTransaction, 'parsedSigned.hex');
      const parsedSigned5 = new Transaction(tx.signedTransactionChainId5, 'goerli');
      assert.deepStrictEqual(parsedSigned5.hex, tx.signedTransactionChainId5, 'parsedSigned5.hex');
      for (let f of REQUIRED.concat(['gasLimit'])) {
        var field = tx[f] === '0x00' ? '0x' : tx[f];
        assert.deepStrictEqual(parsedUnsigned.raw[f] || '0x', field);
        assert.deepStrictEqual(parsedSigned.raw[f] || '0x', field);
        assert.deepStrictEqual(parsedUnsigned5.raw[f] || '0x', field);
        assert.deepStrictEqual(parsedSigned5.raw[f] || '0x', field);
      }
      assert.deepStrictEqual(parsedUnsigned.hex, tx.unsignedTransaction);
      const signedTx = await parsedUnsigned.sign(tx.privateKey);
      const signedTx5 = await parsedUnsigned5.sign(tx.privateKey);
      const signedConstructedTx5 = await constructed5.sign(tx.privateKey);
      assert.deepStrictEqual(signedTx5.hex, tx.signedTransactionChainId5, 'signedTx5.hex');
      assert.deepStrictEqual(
        signedConstructedTx5.hex,
        tx.signedTransactionChainId5,
        'signedConstructedTx5.hex'
      );
      assert.deepStrictEqual(signedTx.sender.toLowerCase(), tx.accountAddress);
      assert.deepStrictEqual(signedTx5.sender.toLowerCase(), tx.accountAddress);
      assert.deepStrictEqual(parsedSigned5.sender.toLowerCase(), tx.accountAddress);
    }
  });

  should('handle EIP1559 & EIP-2930 test vectors', async () => {
    const eip1559 = await readJSON('./ethers-eip1559.json');
    for (let tx of eip1559) {
      // empty gasLimit unsupported (21000 forced)
      if (!tx.tx.gasLimit) continue;
      if (Number(tx.tx.gasLimit) < 21000) continue;
      // empty chainId unsupported (mainnet by default)
      if (!tx.tx.chainId) continue;
      // EIP-2930 without gasPrice
      if (tx.tx.type === 1 && tx.tx.gasPrice === undefined) continue;
      const addr = Address.fromPrivateKey(tx.key);
      assert.deepStrictEqual(addr.toLowerCase(), tx.address, 'Address.fromPrivateKey');
      const parsedSigned = new Transaction(tx.signed);
      assert.deepStrictEqual(parsedSigned.hex, tx.signed, 'parsedSigned.hex');
      const parsedUnsigned = new Transaction(tx.unsigned);
      assert.deepStrictEqual(parsedUnsigned.hex, tx.unsigned, 'parsedUnsigned.hex');
      const signedTx = await parsedUnsigned.sign(tx.key);
      assert.deepStrictEqual(signedTx.hex, tx.signed, 'signedTx.hex');
      assert.deepStrictEqual(
        parsedSigned.sender.toLowerCase(),
        tx.address,
        'Address recovery (parsedSigned)'
      );
      assert.deepStrictEqual(
        signedTx.sender.toLowerCase(),
        tx.address,
        'Address recovery (signedTx)'
      );
      if (tx.tx.nonce === undefined || tx.tx.value === undefined) continue;
      if (
        tx.tx.type === 2 &&
        (tx.tx.maxFeePerGas === undefined || tx.tx.maxPriorityFeePerGas === undefined)
      ) {
        continue;
      }
      const constructedTx = new Transaction(
        tx.tx,
        undefined,
        undefined,
        tx.tx.type === 1 ? 'eip2930' : 'eip1559'
      );
      assert.deepStrictEqual(constructedTx.hex, tx.unsigned, 'constructedTx.hex');
    }
  });

  should('tx-validator/parseUnit', () => {
    // https://eth-converter.com
    // as string
    assert.deepStrictEqual(validate.parseUnit('1.23', 'eth'), 1230000000000000000n);
    assert.deepStrictEqual(validate.parseUnit('1.23', 'gwei'), 1230000000n);
    assert.throws(() => validate.parseUnit('1.23', 'wei'));
    assert.deepStrictEqual(validate.parseUnit('1', 'wei'), 1n);
    assert.deepStrictEqual(validate.parseUnit('2', 'wei'), 2n);
    assert.deepStrictEqual(validate.parseUnit('5', 'wei'), 5n);
    // as number
    assert.deepStrictEqual(validate.parseUnit(1.23, 'eth'), 1230000000000000000n);
    assert.deepStrictEqual(validate.parseUnit(1.23, 'gwei'), 1230000000n);
    assert.throws(() => validate.parseUnit(1.23, 'wei'));
    assert.deepStrictEqual(validate.parseUnit(1, 'wei'), 1n);
    assert.deepStrictEqual(validate.parseUnit(2, 'wei'), 2n);
    assert.deepStrictEqual(validate.parseUnit(5, 'wei'), 5n);
    // as hex string
    assert.deepStrictEqual(validate.parseUnit('0x123', 'eth'), 291000000000000000000n);
    assert.deepStrictEqual(validate.parseUnit('0x123', 'gwei'), 291000000000n);
    assert.deepStrictEqual(validate.parseUnit('0x123', 'wei'), 291n);
    // as big int
    assert.deepStrictEqual(validate.parseUnit(123n, 'eth'), 123000000000000000000n);
    assert.deepStrictEqual(validate.parseUnit(123n, 'gwei'), 123000000000n);
    assert.deepStrictEqual(validate.parseUnit(123n, 'wei'), 123n);
  });

  should('tx-validator/createTxMapFromFields', () => {
    const tx = {
      to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
      value: 1,
      amountUnit: 'eth',
      nonce: 1,
      maxFeePerGas: 100n,
      maxFeePerGasUnit: 'gwei',
      maxPriorityFeePerGas: 2n,
      maxPriorityFeePerGasUnit: 'gwei',
    };
    assert.throws(
      () =>
        validate.createTxMapFromFields({
          ...tx,
          from: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        }),
      'to===from'
    );
    assert.deepStrictEqual(new Transaction(validate.createTxMapFromFields(tx)).raw, {
      chainId: '0x01',
      nonce: '0x01',
      maxPriorityFeePerGas: '0x77359400', // 2 gwei
      maxFeePerGas: '0x174876e800', // 100 gwei
      gasLimit: '0x5208',
      to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
      value: '0x0de0b6b3a7640000', // 1 eth
      data: '',
      accessList: [],
    });
  });

  should('utils: parseDecimal', () => {
    deepStrictEqual(formatters.parseDecimal('6.30880845', 8), 630880845n);
    deepStrictEqual(formatters.parseDecimal('6.308', 8), 630800000n);
    deepStrictEqual(formatters.parseDecimal('6.00008', 8), 600008000n);
    deepStrictEqual(formatters.parseDecimal('10', 8), 1000000000n);
    deepStrictEqual(formatters.parseDecimal('200', 8), 20000000000n);
  });

  should('utils: formatDecimal', () => {
    const { formatDecimal, parseDecimal } = formatters;
    const cases = [
      '6.30880845',
      '6.308',
      '6.00008',
      '10',
      '200',
      '0.1',
      '0.01',
      '0.001',
      '0.0001',
      '19.0001',
      '99999999',
      '-6.30880845',
      '-6.308',
      '-6.00008',
      '-10',
      '-200',
      '-0.1',
      '-0.01',
      '-0.001',
      '-0.0001',
      '-19.0001',
      '-99999999',
    ];
    for (let c of cases) deepStrictEqual(formatDecimal(parseDecimal(c, 8), 8), c);
    // Round number if precision is smaller than fraction part length
    deepStrictEqual(parseDecimal('22.11111111111111111', 2), 2211n);
    deepStrictEqual(parseDecimal('222222.11111111111111111', 2), 22222211n);
    deepStrictEqual(formatDecimal(parseDecimal('22.1111', 2), 2), '22.11');
    deepStrictEqual(formatDecimal(parseDecimal('22.9999', 2), 2), '22.99');
    // Doesn't affect integer part
    deepStrictEqual(
      formatDecimal(parseDecimal('222222222222222222222222222.9999', 2), 2),
      '222222222222222222222222222.99'
    );
  });

  should('utils: perCentDecimal', () => {
    const { perCentDecimal, formatDecimal } = formatters;
    const t = (prec, price, exp) =>
      assert.deepStrictEqual(+formatDecimal(perCentDecimal(prec, price), prec) * price, exp);
    t(4, 0.5, 0.01);
    t(8, 0.5, 0.01);
    t(8, 70, 0.0099995);
    t(18, 70, 0.00999999999999994);
    t(8, 1000, 0.01);
    t(8, 53124, 0.00956232);
    t(18, 53124, 0.009999999999950064);
    t(18, 0.03456799, 0.01);
    t(18, 0.0123456, 0.01);
    t(256, 0.0123456, 0.01);
  });

  should('utils: roundDecimal', () => {
    const { roundDecimal, formatDecimal, parseDecimal } = formatters;
    const cases = [
      [[1n, 1], 1n],
      [[1n, 100], 1n],
      [[5n, 1], 5n],
      [[6123n, 1], 6000n],
      [[699999n, 1], 600000n],
      [[6123n, 2], 6100n],
      [[699999n, 2], 690000n],
      [[6123n, 3], 6120n],
      [[699999n, 3], 699000n],
      [[6123n, 4], 6123n],
      [[699999n, 4], 699900n],
      [[6123n, 5], 6123n],
      [[699999n, 5], 699990n],
      [[6123n, 6], 6123n],
      [[699999n, 6], 699999n],
      [[699999n, 123456789], 699999n],
    ];
    for (let c of cases) {
      const [[num, prec], res] = c;
      assert.deepStrictEqual(roundDecimal(num, prec), res);
    }
    // with prices
    const t = (value, prec, roundPrec, price, exp) =>
      assert.deepStrictEqual(
        formatDecimal(roundDecimal(parseDecimal(value, prec), roundPrec, prec, price), prec),
        exp
      );
    t('123456.000001', 18, 3, 1000, '123000');
    // strips to 5 significant characters
    t('1.23456', 18, 5, 1000, '1.2345');
    // but 0.0005 < $0.01
    t('1.23456', 18, 5, 10, '1.234');
    // 0.0004 < $0.01 (0.01==$0.01 here)
    t('1.23456', 18, 5, 1, '1.23');
    t('1.23456', 18, 5, 0.1, '1.2'); // 0.03 < $0.01
    // $0.01 == 0.0000001886
    t('1.23456', 10, 8, 53000, '1.23456');
    t('0.123456', 10, 8, 53000, '0.123456');
    t('0.0123456', 10, 8, 53000, '0.0123456');
    // $0.01 == 0.0000001886
    // value    0.0012345600
    //          0.0000005000 > $0.01
    //          0.0000000600 < $0.01
    t('0.00123456', 10, 8, 53000, '0.0012345');
    // same as before
    t('0.000123456', 10, 8, 53000, '0.0001234');
    // Real test case (0.01 slightly more than $0.01):
    t('1.234567', 6, 5, 1.0000037334781642, '1.234');
    t('1.234567', 6, 5, 1.0012057324289945, '1.234');
    // But:
    t('1.234567', 6, 5, 1, '1.23');
    t('1.234567', 6, 5, 1, '1.23');
  });

  should('utils: formatUSD', () => {
    const { formatUSD } = formatters;
    assert.deepStrictEqual(formatUSD(100), '$100');
    assert.deepStrictEqual(formatUSD(123456789.987654321), '$123,456,789.99');
    assert.deepStrictEqual(formatUSD(0.012345), '$0.01');
  });

  // console.log(12345, new Transaction(eip155[0].rlp));

  // 0.01 eth
  // 20 gwei
  // nonce 0

  // should('unsigned tx and signed tx data should be equal', async () => {
  //   const tx = new Transaction(etx.raw);
  //   const stx = await tx.sign(priv);
  //   assert.strict.equal(tx.nonce, stx.nonce);
  //   assert.strict.equal(tx.gasPrice, stx.gasPrice);
  //   assert.strict.equal(tx.gasLimit, stx.gasLimit);
  //   assert.strict.equal(tx.to, stx.to);
  //   assert.strict.equal(tx.value, stx.value);
  //   assert.strict.equal(tx.data, stx.data);
  // });
  // should('other', async () => {
  // });
  should.run();
})();
