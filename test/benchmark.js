const { run, mark, logMem } = require('micro-bmark');
const signer = require('..');

run(async () => {
  const getTx = () => new signer.Transaction({
    to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
    maxFeePerGas: 100n * 10n ** 9n, // 100 gwei in wei
    value: 10n ** 18n, // 1 eth in wei
    nonce: 1,
    maxPriorityFeePerGas: 1,
    chainId: 1
  });
  const tx = getTx();
  const privateKey = '6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e';
  await mark('tx.sign()', 4000, () => tx.sign(privateKey));
  await mark('tx.sign() create', 4000, () => getTx().sign(privateKey));
  console.log();
  logMem();
});
