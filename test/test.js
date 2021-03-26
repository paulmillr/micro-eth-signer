const assert = require('assert').strict;
const { should } = require('micro-should');
const secp = require('noble-secp256k1');

(async () => {
  const txs = require('./transactions.json');
  const eip155 = require('./eip155.json').slice(1);
  const {Address, Transaction} = require('../index');

  // for (let txr of txs) {
  const expected = txs[0];
  const priv = "0687640ee33ef844baba3329db9e16130bd1735cbae3657bd64aed25e9a5c377";
  const pub = "030fba7ba5cfbf8b00dd6f3024153fc44ddda93727da58c99326eb0edd08195cdb";
  const addr = "0xD4fE407789e11a27b7888A324eC597435353dC35";

  const priv2 = "71a75261bc0f7f89cd4f2a5f05188d2411bb4b91a6594c6cffa32fe38493c5e2";
  const addr2 = "0xdf90deA0E0bf5cA6D2A7F0cB86874BA6714F463E";

  should('generate correct address with Address.fromPrivateKey()', () => {
    assert.equal(Address.fromPrivateKey(priv), addr);
  });
  should('generate correct address with Address.fromPublicKey()', () => {
    assert.equal(Address.fromPublicKey(pub), addr);
  });
  should('generate correct Transaction.hash', async () => {
    const etx = new Transaction(expected.hex, "ropsten");
    assert.equal(etx.hash, expected.hash.slice(2));
  });
  should('parse tx details correctly', () => {
    const etx = new Transaction(expected.hex, "ropsten");
    assert.equal(etx.nonce, 1);
    assert.equal(etx.fee, 210000000000000n); // 21000 limit, 10 gwei price
    assert.equal(etx.amount, 10000000000000000n);
  });
  should('parse tx sender correctly', () => {
    const etx = new Transaction(expected.hex, "ropsten");
    assert.equal(etx.sender, addr, 'sender is incorrect');
  });
  should('compare with Transaction.equals()', () => {
    const etx1 = new Transaction(expected.hex, "ropsten");
    const etx2 = new Transaction(expected.hex, "ropsten");
    assert.ok(etx1.equals(etx2));
  });
  should('construct Transaction properly', async () => {
    const etx = new Transaction(expected.hex, "ropsten");
    const tx = new Transaction(expected.raw, "ropsten");
    const signed = await tx.sign(priv);
    assert.deepEqual(signed, etx);
  });

  should('handle EIP155 test vectors (raw)', () => {
    for (let vector of eip155) {
      const a = new Transaction(vector.transaction);
      const b = new Transaction(vector.rlp);
      assert.deepEqual(a.raw, b.raw);
      assert.deepEqual(a.raw, vector.transaction);
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
