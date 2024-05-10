import { deepStrictEqual, throws } from 'node:assert';
import { describe, should } from 'micro-should';
import { addr } from '../esm/address.js';
import { Transaction } from '../esm/index.js';

const VECTORS = [
  {
    name: 'eth_mainnet',
    chainId: 1n,
    addresses: [
      '0x27b1fdb04752bbc536007a920d24acb045561c26',
      '0x3599689E6292b81B2d85451025146515070129Bb',
      '0x42712D45473476b98452f434e72461577D686318',
      '0x52908400098527886E0F7030069857D2E4169EE7',
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      '0x6549f4939460DE12611948b3f82b88C3C8975323',
      '0x66f9664f97F2b50F62D13eA064982f936dE76657',
      '0x8617E340B3D01FA5F11F306F4090FD50E238070D',
      '0x88021160C5C792225E4E5452585947470010289D',
      '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
      '0xde709f2102306220921060314715629080e2fb77',
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    ],
  },
  {
    name: 'rsk_mainnet',
    chainId: 30n,
    addresses: [
      '0x27b1FdB04752BBc536007A920D24ACB045561c26',
      '0x3599689E6292B81B2D85451025146515070129Bb',
      '0x42712D45473476B98452f434E72461577d686318',
      '0x52908400098527886E0F7030069857D2E4169ee7',
      '0x5aaEB6053f3e94c9b9a09f33669435E7ef1bEAeD',
      '0x6549F4939460DE12611948B3F82B88C3C8975323',
      '0x66F9664f97f2B50F62d13EA064982F936de76657',
      '0x8617E340b3D01Fa5f11f306f4090fd50E238070D',
      '0x88021160c5C792225E4E5452585947470010289d',
      '0xD1220A0Cf47c7B9BE7a2e6ba89F429762E7B9adB',
      '0xDBF03B407c01E7CD3cBea99509D93F8Dddc8C6FB',
      '0xDe709F2102306220921060314715629080e2FB77',
      '0xFb6916095cA1Df60bb79ce92cE3EA74c37c5d359',
    ],
  },
  {
    name: 'rsk_testnet',
    chainId: 31n,
    addresses: [
      '0x27B1FdB04752BbC536007a920D24acB045561C26',
      '0x3599689e6292b81b2D85451025146515070129Bb',
      '0x42712D45473476B98452F434E72461577D686318',
      '0x52908400098527886E0F7030069857D2e4169EE7',
      '0x5aAeb6053F3e94c9b9A09F33669435E7EF1BEaEd',
      '0x6549f4939460dE12611948b3f82b88C3c8975323',
      '0x66f9664F97F2b50f62d13eA064982F936DE76657',
      '0x8617e340b3D01fa5F11f306F4090Fd50e238070d',
      '0x88021160c5C792225E4E5452585947470010289d',
      '0xd1220a0CF47c7B9Be7A2E6Ba89f429762E7b9adB',
      '0xdbF03B407C01E7cd3cbEa99509D93f8dDDc8C6fB',
      '0xDE709F2102306220921060314715629080e2Fb77',
      '0xFb6916095CA1dF60bb79CE92ce3Ea74C37c5D359',
    ],
  },
];

describe('ERC-1191', () => {
  for (const { name, chainId, addresses } of VECTORS) {
    should(`${name}`, () => {
      for (const exp of addresses) {
        deepStrictEqual(addr.addChecksum(exp.toLowerCase(), chainId), exp);
        // lower case is always ok
        const parsed = addr.parse(exp).data;
        if (parsed.toLowerCase() === parsed || parsed.toUpperCase() === parsed) continue;
        for (const cid of [1n, 30n, 31n]) {
          const enc = addr.addChecksum(exp, cid);
          // Encodes into same addr
          if (enc === exp) continue;
          const verify = addr.verifyChecksum(exp, cid);
          deepStrictEqual(verify, cid === chainId);
        }
      }
    });
  }
  should('create tx verification', () => {
    const ethAddr = '0x3599689E6292b81B2d85451025146515070129Bb';
    const rskAddr = '0x3599689E6292B81B2D85451025146515070129Bb';
    const ethTxData = { nonce: 10n, maxFeePerGas: 10n, value: 100n };
    const rskTxData = { ...ethTxData, chainId: 30n };

    const rskTx = Transaction.prepare({ ...rskTxData, to: rskAddr }); // no error
    throws(() => Transaction.prepare({ ...rskTxData, to: ethAddr })); // wrong address
    const decodedRsk = Transaction.fromHex(rskTx.toHex());
    deepStrictEqual(decodedRsk.raw.to, rskAddr);

    const ethTx = Transaction.prepare({ ...ethTxData, to: ethAddr });
    throws(() => Transaction.prepare({ ...ethTxData, to: rskAddr })); // wrong address
    const decodedEth = Transaction.fromHex(ethTx.toHex());
    deepStrictEqual(decodedEth.raw.to, ethAddr);

    // Access list rsk
    const rskTxAL = Transaction.prepare({
      ...rskTxData,
      to: rskAddr,
      accessList: [[rskAddr, []]],
    });
    throws(() =>
      Transaction.prepare({
        ...rskTxData,
        to: rskAddr,
        accessList: [[ethAddr, []]],
      })
    );
    const decodedRskAL = Transaction.fromHex(rskTxAL.toHex());
    deepStrictEqual(decodedRskAL.raw.accessList, [[rskAddr, []]]);
    // Access list eth
    const ethTxAL = Transaction.prepare({
      ...ethTxData,
      to: ethAddr,
      accessList: [[ethAddr, []]],
    });
    throws(() =>
      Transaction.prepare({
        ...ethTxData,
        to: ethAddr,
        accessList: [[rskAddr, []]],
      })
    );
    const decodedEthAL = Transaction.fromHex(ethTxAL.toHex());
    deepStrictEqual(decodedEthAL.raw.accessList, [[ethAddr, []]]);
  });
});

// ESM is broken.
import url from 'node:url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  should.run();
}
