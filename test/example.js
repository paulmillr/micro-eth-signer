const { Address, Transaction } = require('..');

(async () => {
  const tx = new Transaction({
    to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
    gasPrice: 100n * 10n ** 9n, // 100 gwei in wei
    value: 10n ** 18n, // 1 eth in wei
    nonce: 1
  });
  const privateKey = '6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e';
  const signedTx = await tx.sign(privateKey); // Uint8Array is also accepted
  const {hash, hex} = signedTx;

  // Strings can be used also
  // tx = new Transaction({"nonce": "0x01"})
  // Same goes to serialized representation
  // tx = new Transaction('0xeb018502540be40082520894df90dea0e0bf5ca6d2a7f0cb86874ba6714f463e872386f26fc1000080808080');

  // Various tx properties
  console.log('Need wei', tx.upfrontCost); // also, tx.fee, tx.amount, tx.sender, etc

  // Address manipulation
  const addr = Address.fromPrivateKey(privateKey);
  const pubKey = signedTx.recoverSenderPublicKey();
  console.log('Verified', Address.verifyChecksum(addr));
  console.log('addr is correct', signedTx.sender, signedTx.sender == addr);
  console.log(signedTx);
})();