const { Address, Transaction } = require('..');

(async () => {
  const tx = new Transaction({
    to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
    gasPrice: 100n * 10n ** 9n, // 100 gwei in wei
    value: 1n ** 18n, // 1 eth in wei
    nonce: 1,
  });

  // hex string or Uint8Array
  const privateKey = '6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e';
  const signedTx = await tx.sign(privateKey);
  const addr = Address.fromPrivateKey(privateKey);
  const pubKey = signedTx.recoverSenderPublicKey();

  console.log('Verified', Address.verifyChecksum(addr));
  console.log(tx);
  console.log('Need wei', tx.upfrontCost);
  console.log('addr is correct', signedTx.sender, signedTx.sender == addr);
  console.log(signedTx);
})();
