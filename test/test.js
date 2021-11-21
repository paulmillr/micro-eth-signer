const assert = require('assert').strict;
const { should } = require('micro-should');
const secp = require('@noble/secp256k1');

(async () => {
  const txs = require('./transactions.json');
  const eip155 = require('./eip155.json').slice(1);
  const { Address, Transaction } = require('../index');

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
    const txs = require('./ethers-transactions.json');

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
    const eip1559 = require('./ethers-eip1559.json');
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
