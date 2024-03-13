import { deepStrictEqual, throws } from 'node:assert';
import { inspect } from 'node:util';
import { describe, should } from 'micro-should';
import { addr, Transaction, messenger } from '../lib/esm/index.js';
import { RawTx, RlpTx, __tests } from '../lib/esm/tx.js';
import { add0x, createDecimal, ethHex, formatters } from '../lib/esm/utils.js';
import { default as TX_VECTORS } from './vectors/transactions.json' assert { type: 'json' };
import { default as EIP155_VECTORS } from './vectors/eip155.json' assert { type: 'json' };
import * as ethTests from './vectors/eth-tests-tx-vectors.js';
import { getEthersVectors, getViemVectors } from './util.js';

const ETHERS_TX = getEthersVectors('transactions.json.gz');
const VIEM_TX = getViemVectors('transaction.json.gz');

const SKIPPED_ERRORS = {
  viem: 'address must be',
  ethereum_tests_raw_tx: [
    // no address
    'dataTx_bcValidBlockTest',
    'DataTestEnoughGasInitCode',
    'DataTestNotEnoughGasInitCode',
    'DataTestInitCodeLimit',
    'libsecp256k1test',
    // More strict check than we have in RawTx
    'maxFeePerGas32BytesValue',
    'GasLimitPriceProductOverflow',
    '1559PriorityFeeGreaterThanBaseFee',
    'maxPriorityFeePerGass32BytesValue',
    'GasLimitPriceProductPlusOneOverflow',
    'TransactionWithGasLimitxPriceOverflow',
    'TransactionWithHighNonce64Minus1',
    // chainId inside v
    'RightVRSTestF0000000a',
    'RightVRSTestF0000000b',
    'RightVRSTestF0000000c',
    'RightVRSTestF0000000d',
    'RightVRSTestF0000000e',
    'RightVRSTestF0000000f',
    'TransactionWithRvalueTooHigh',
    'TransactionWithSvalueLargerThan_c_secp256k1n_x05',
    'TransactionWithRSvalue0',
    'TransactionWithSvalueTooHigh',
    'TransactionWithRvalueHigh',
    'TransactionWithSvalueHigh',
    'RSsecp256k1',
    'Vitalik_16',
    'Vitalik_17',
    'InvalidVRS',
    'invalidSignature',
    'Vitalik_12', // 21 byte address
    'Vitalik_14', // 21 byte address
    'Vitalik_15',
    'PointAtInfinity',
    'ValidChainID1InvalidV0',
    'WrongVRSTestVEqual39',
    'ValidChainID1InvalidV1',
    'WrongVRSTestVEqual41',
    'WrongVRSTestVEqual36',
    'InvalidChainID0ValidV1',
    'V_wrongvalue_ff',
    'InvalidChainID0ValidV0',
    'WrongVRSTestVOverflow', // 310 overflow, but max chain id 43 bit (6022140761023)
    'WrongVRSTestVOverflow',
    'V_wrongvalue_ffff',
    //'V_overflow64bitPlus28', //
    'V_overflow32bit', // wut?
    'V_wrongvalue_101',
    'V_overflow32bitSigned', // WUT?!
    'V_wrongvalue_121',
    'V_wrongvalue_123',
    'V_wrongvalue_122',
    'V_wrongvalue_124',
    'V_overflow64bitSigned', // wtf is going on here?
    'TRANSCT_rvalue_TooShort',
    'tr201506052141PYTHON', // chainid

    /// TTT
    'V_overflow64bitPlus28', // do we want to handle this in raw tx?
    'V_overflow64bitPlus27',
    // this is unsigned tx with chainId (not fully standard)
    'ZeroSigTransaction6',
    'ZeroSigTransaction5',
    'ZeroSigTransaction4',
    'ZeroSigTransaction3',
    'ZeroSigTransaction2',
  ],
  ethereum_tests: [
    'String10MbData',
    'dataTx_bcValidBlockTest',
    'GasLimitPriceProductOverflowtMinusOne',
    'DataTestEnoughGasInitCode',
    'DataTestInitCodeLimit',
    // We are stricter
    'TransactionWithHighGasLimit63',
    'TransactionWithHighGasLimit64Minus1',
    'TransactionWithHighGasLimit63Plus1',
    'TransactionWithHighGasLimit63Minus1',
    'TransactionWithHighNonce64Minus2',
    'TransactionWithLeadingZerosGasPrice',
    'TransactionWithHighNonce32',
    'TransactionWithZerosBigInt',
    'RightVRSTestF0000000c',
    'RightVRSTestVPrefixedBy0',
    'RightVRSTestF0000000b',
    'TransactionWithSvaluePrefixed00BigInt',
    'TransactionWithRvalueTooHigh',
    'TransactionWithSvalue0',
    'TransactionWithSvalueLargerThan_c_secp256k1n_x05',
    'TransactionWithRSvalue0',
    'TransactionWithSvalueTooHigh',
    'TransactionWithRvalueHigh',
    'RightVRSTestVPrefixedBy0_2',
    'TransactionWithSvalueHigh',
    'TransactionWithRvalue0',
    'RightVRSTestVPrefixedBy0_3',
    'RightVRSTestF0000000a',
    'RSsecp256k1',
    'Vitalik_16',
    'Vitalik_17',
    'ZeroSigTransaction6',
    'invalidSignature', // todo: do we want to validate signatures?
    'WrongVRSTestVOverflow',
    'Vitalik_12',
    'ZeroSigTransaction5',
    'PointAtInfinity',
    'libsecp256k1test',
    'ZeroSigTransaction4',
    'ZeroSigTransaction3',
    'Vitalik_14',
    'Vitalik_15',
    'ZeroSigTransaction2',
    'V_wrongvalue_ffff',
    'V_overflow32bit',
    'V_wrongvalue_101',
    'V_overflow32bitSigned',
    'V_wrongvalue_121',
    'WrongVRSTestVEqual39',
    'ValidChainID1InvalidV1',
    'ValidChainID1InvalidV00',
    'WrongVRSTestVEqual41',
    'V_wrongvalue_123',
    'V_wrongvalue_122',
    'ValidChainID1InvalidV01',
    'V_wrongvalue_ff',
    'V_wrongvalue_124',
    'TransactionWithHighValue',
    'TransactionWithLeadingZerosValue',
    'TransactionWithLeadingZerosNonce',
    'TransactionWithRvaluePrefixed00BigInt',
  ]
}

function log(...args) {
  console.log(
    ...args.map((arg) =>
      typeof arg === 'object'
        ? inspect(arg, { depth: Infinity, colors: true, compact: false })
        : arg
    )
  );
}

const debugTx = (hex) => {
  const bytes = ethHex.decode(hex);
  console.log('RLP ORIG', RlpTx.decode(bytes));
  const decoded = RawTx.decode(bytes);
  console.log('DECODED', decoded);
  const encoded = RawTx.encode(decoded);
  console.log('RLP NEW', RlpTx.decode(encoded));
};

const convertTx = (raw) => {
  const toBig = (x) => (x === '0x' ? 0n : BigInt(x));
  const res = {
    // Some libraries do optional nonce, which is kinda broken
    nonce: toBig(raw.nonce === undefined ? 0 : raw.nonce),
    data: add0x(raw.data || ''),
    to: raw.to,
    value: toBig(raw.value === undefined ? 0 : raw.value),
    gasLimit: toBig(raw.gasLimit === undefined ? 0 : raw.gasLimit),
  };
  if (raw.gasPrice) res.gasPrice = toBig(raw.gasPrice);
  if (raw.maxFeePerGas) res.maxFeePerGas = toBig(raw.maxFeePerGas);
  if (raw.maxPriorityFeePerGas) res.maxPriorityFeePerGas = toBig(raw.maxPriorityFeePerGas);
  if (raw.s) res.s = toBig(raw.s);
  if (raw.r) res.r = toBig(raw.r);
  if (raw.v) Object.assign(res, __tests.legacySig.encode({ v: toBig(raw.v), r: res.r, s: res.s }));
  if (raw.accessList) res.accessList = raw.accessList;
  // EIP-4844
  if (raw.blobVersionedHashes) res.blobVersionedHashes = raw.blobVersionedHashes;
  if (raw.maxFeePerBlobGas) res.maxFeePerBlobGas = toBig(raw.maxFeePerBlobGas);
  return res;
};

describe('Transactions', () => {
  describe('Utils', () => {
    should('legacySig', () => {
      const { legacySig } = __tests;

      // DECODE
      deepStrictEqual(legacySig.decode({ yParity: 0, r: 1n, s: 1n }), { v: 27n, r: 1n, s: 1n });
      throws(() => legacySig.decode({ yParity: 0 }));
      deepStrictEqual(legacySig.decode({ yParity: 0, chainId: 1n, r: 1n, s: 1n }), {
        v: 37n,
        r: 1n,
        s: 1n,
      });
      // yParity, but no r/s
      throws(() => legacySig.decode({ yParity: 0, chainId: 1n }));
      throws(() => legacySig.decode({ yParity: 0, chainId: 1n, r: 1n }));
      throws(() => legacySig.decode({ yParity: 0, chainId: 1n, s: 1n }));
      throws(() => legacySig.decode({ yParity: 0, chainId: 1n, r: 0n, s: 0n }));
      deepStrictEqual(legacySig.decode({ chainId: 1n }), { v: 1n, r: 0n, s: 0n });
      deepStrictEqual(legacySig.decode({ yParity: 1, r: 1n, s: 1n }), { v: 28n, r: 1n, s: 1n });
      throws(() => legacySig.decode({ yParity: 1 }));

      // ENCODE
      deepStrictEqual(legacySig.encode({}), { chainId: undefined });
      deepStrictEqual(legacySig.encode({ v: 27n, r: 1n, s: 1n }), {
        yParity: 0,
        chainId: undefined,
        r: 1n,
        s: 1n,
      });
      // Unsigned (eip155)
      deepStrictEqual(legacySig.encode({ v: 27n, r: 0n, s: 0n }), { chainId: 27n });
      deepStrictEqual(legacySig.encode({ v: 27n, r: undefined, s: undefined }), { chainId: 27n });

      deepStrictEqual(legacySig.encode({ v: 45n, r: 1n, s: 1n }), {
        chainId: 5n,
        yParity: 0,
        r: 1n,
        s: 1n,
      });
      deepStrictEqual(legacySig.encode({ v: 46n, r: 1n, s: 1n }), {
        chainId: 5n,
        yParity: 1,
        r: 1n,
        s: 1n,
      });
      deepStrictEqual(legacySig.encode({ v: 27n, r: 1n, s: 1n }), {
        yParity: 0,
        chainId: undefined,
        r: 1n,
        s: 1n,
      });
      deepStrictEqual(legacySig.encode({ v: 37n, r: 1n, s: 1n }), {
        chainId: 1n,
        yParity: 0,
        r: 1n,
        s: 1n,
      });
    });

    should('utils: perCentDecimal', () => {
      const { perCentDecimal } = formatters;

      const formatDecimal = (val, prec) => createDecimal(prec).encode(val);
      const t = (prec, price, exp) =>
        deepStrictEqual(+formatDecimal(perCentDecimal(prec, price), prec) * price, exp);
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
  });

  describe('RawTx', () => {
    const t = (hex) => {
      //debugTx(hex);
      const decoded = RawTx.decode(ethHex.decode(hex));
      const encoded = ethHex.encode(RawTx.encode(decoded));
      deepStrictEqual(encoded, hex, 'RawTx.encoded');
    };
    should('vectors', () => {
      for (const i of TX_VECTORS) t(i.hex);
    });
    should('eip155', () => {
      for (const i of EIP155_VECTORS) t(i.rlp);
    });
    should('ethereum-tests', () => {
      const skip = SKIPPED_ERRORS.ethereum_tests_raw_tx;
      for (const cat in ethTests) {
        for (const k in ethTests[cat]) {
          const v = Object.values(ethTests[cat][k])[0];
          if (skip.includes(k)) continue;
          let hasError = (!v.result.Shanghai ? v.result.London : v.result.Shanghai).exception;
          if (hasError === 'TR_IntrinsicGas') continue;
          // DEBUG
          // if (k === 'TransactionWithRvaluePrefixed00BigInt') {
          //   console.log('TTT', v.txbytes, RlpTx.decode(ethHex().decode(v.txbytes)));
          //   // t(v.txbytes);
          // }
          if (hasError) throws(() => t(v.txbytes), `throws(${cat}/${k})`);
          else {
            t(v.txbytes);
          }
        }
      }
    });
    // const viem_filtered = VIEM_TX.filter(tx => tx.addr)
    should(`viem (${VIEM_TX.length} tests)`, () => {
      let skipped = 0;
      let passed = 0;
      for (let i = 0; i < VIEM_TX.length; i++) {
        const v = VIEM_TX[i];
        for (const tx of [v.serialized, v.serializedSigned]) {
          try {
            t(tx);
            passed += 1;
          } catch (e) {
            if (e.message.includes(SKIPPED_ERRORS.viem)) {
              skipped++;
              continue;
            }
            throw e;
          }
        }
      }
      console.log(`skipped: ${skipped} ${passed}`);
    });
    should('EIP-4844', () => {
      // FROM https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/tx/test/eip4844.spec.ts
      const vectors = [
        {
          hash: '0xe5e02be0667b6d31895d1b5a8b916a6761cbc9865225c6144a3e2c50936d173e',
          serialized:
            '0x03f89b84028757b38085012a05f20085012a05f2008303345094ffb38a7a99e3e2335be83fc74b7faa19d553124383bc614e80c084b2d05e00e1a001b0a4cdd5f55589f5c5b4d46c76704bb6ce95c0a8c09f77f197a57808dded2880a08a83833ec07806485a4ded33f24f5cea4b8d4d24dc8f357e6d446bcdae5e58a7a068a2ba422a50cf84c0b5fcbda32ee142196910c97198ffd99035d920c2b557f8',
          data: {
            type: '0x3',
            nonce: '0x0',
            gasPrice: null,
            maxPriorityFeePerGas: '0x12a05f200',
            maxFeePerGas: '0x12a05f200',
            gasLimit: '0x33450',
            value: '0xbc614e',
            data: '0x',
            v: '0x0',
            r: '0x8a83833ec07806485a4ded33f24f5cea4b8d4d24dc8f357e6d446bcdae5e58a7',
            s: '0x68a2ba422a50cf84c0b5fcbda32ee142196910c97198ffd99035d920c2b557f8',
            to: '0xffb38a7a99e3e2335be83fc74b7faa19d5531243',
            chainId: '0x28757b3',
            accessList: null,
            maxFeePerBlobGas: '0xb2d05e00',
            blobVersionedHashes: [
              '0x01b0a4cdd5f55589f5c5b4d46c76704bb6ce95c0a8c09f77f197a57808dded28',
            ],
          },
        },
      ];
      for (const i of vectors) t(i.serialized);
    });
  });

  const priv = '0687640ee33ef844baba3329db9e16130bd1735cbae3657bd64aed25e9a5c377';
  const pub = '030fba7ba5cfbf8b00dd6f3024153fc44ddda93727da58c99326eb0edd08195cdb';
  const addr_ = '0xD4fE407789e11a27b7888A324eC597435353dC35';

  describe('Address', () => {
    should('generate correct address with Address.fromPrivateKey()', () => {
      deepStrictEqual(addr.fromPrivateKey(priv), addr_);
    });
    should('generate correct address with Address.fromPublicKey()', () => {
      deepStrictEqual(addr.fromPublicKey(pub), addr_);
    });
  });
  const eip155 = EIP155_VECTORS.slice(1);

  should('generate correct Transaction.hash', () => {
    for (const txr of TX_VECTORS) {
      const etx = Transaction.fromHex(txr.hex);
      deepStrictEqual(etx.calcHash(true), txr.hash.slice(2));
    }
  });
  should('parse tx sender correctly', () => {
    for (const txr of TX_VECTORS) {
      const etx = Transaction.fromHex(txr.hex);
      deepStrictEqual(etx.recoverSender().address, addr_, 'sender is incorrect');
    }
  });
  should('compare with Transaction.equals()', () => {
    for (const txr of TX_VECTORS) {
      const etx1 = Transaction.fromHex(txr.hex);
      const etx2 = Transaction.fromHex(txr.hex);
      deepStrictEqual(etx1, etx2);
    }
  });
  should('construct Transaction properly', async () => {
    for (const txr of TX_VECTORS) {
      const etx = Transaction.fromHex(txr.hex);
      const tx = new Transaction('legacy', {
        ...convertTx(txr.raw),
        chainId: 3n,
      });
      const signed = tx.signBy(priv);
      deepStrictEqual(signed.calcHash(true), etx.calcHash(true));
    }
  });

  should('handle EIP155 test vectors (raw)', () => {
    for (const vector of eip155) {
      const a = new Transaction('legacy', convertTx(vector.transaction));
      const b = Transaction.fromHex(vector.rlp);
      deepStrictEqual(a.raw, b.raw, 'raw');
    }
  });

  should('handle EIP155 test vectors (recursive)', () => {
    for (const vector of eip155) {
      const ours = Transaction.fromHex(vector.rlp);
      deepStrictEqual(ours.raw, Transaction.fromHex(ours.toHex(true)).raw);
    }
  });

  should('handle EIP155 test vectors (hash)', () => {
    for (const vector of eip155) {
      const ours = new Transaction('legacy', convertTx(vector.transaction));
      deepStrictEqual(ours.calcHash(false), vector.hash);
    }
  });

  should('handle EIP155 test vectors (sender)', () => {
    for (const vector of eip155) {
      const ours = Transaction.fromHex(vector.rlp);
      deepStrictEqual(ours.recoverSender().address.toLowerCase().slice(2), vector.sender);
    }
  });

  should('getMessageToSign data should equal in signed/unsigned', async () => {
    const tx = Transaction.prepare({
      type: 'legacy',
      to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
      gasPrice: 100n * 10n ** 9n, // 100 gwei in wei
      value: 10n ** 18n, // 1 eth in wei
      nonce: 1n,
      chainId: 1n,
    });
    const privateKey = '6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e';
    const signedTx = tx.signBy(privateKey); // Uint8Array is also accepted
    const address = addr.fromPrivateKey(privateKey);
    deepStrictEqual(signedTx.sender, address);
  });

  should('ethers.js/transactions.json', () => {
    // Awesome tests, there is even eip4844
    for (const tx of ETHERS_TX) {
      const data = tx.transaction;
      if (!data.to) continue;
      for (const net of ['Legacy', 'Eip155', 'London', 'Cancun']) {
        const signed = tx[`signed${net}`];
        const unsigned = tx[`unsigned${net}`];
        const signature = tx[`signature${net}`];
        for (const k in signature) signature[k] = BigInt(signature[k]);
        // Parse unsgined
        if (unsigned) {
          const etx = Transaction.fromHex(unsigned);
          deepStrictEqual(etx.toHex(), unsigned);
          // Try to sign unsigned tx
          if (signed) {
            const sig = etx.signBy(tx.privateKey);
            deepStrictEqual(sig.toHex(true), signed);
            deepStrictEqual(sig.raw.r, signature.r);
            deepStrictEqual(sig.raw.s, signature.s);
          }
        }
        // parse signed
        if (signed) {
          const tx = Transaction.fromHex(signed);
          deepStrictEqual(tx.toHex(true), signed);
          if (unsigned) deepStrictEqual(tx.toHex(false), unsigned);
        }
        // try to build tx
        if (unsigned && signed) {
          // Extract chainId && type (doesn't exists in vectors)
          const etx = Transaction.fromHex(unsigned);
          const d = { ...convertTx(data), type: etx.type };
          d.chainId = etx.raw.chainId;
          if (etx.type === 'legacy' && d.gasPrice === undefined) d.gasPrice = 0n;
          if (['eip1559', 'eip4844'].includes(etx.type)) {
            if (d.maxFeePerGas === undefined) d.maxFeePerGas = 0n;
            if (d.maxPriorityFeePerGas === undefined) d.maxPriorityFeePerGas = 0n;
          }
          if (['eip4844'].includes(etx.type) && d.maxFeePerBlobGas === undefined)
            d.maxFeePerBlobGas = 0n;
          if (['eip4844'].includes(etx.type) && d.blobVersionedHashes === undefined)
            d.blobVersionedHashes = [];
          if (d.accessList) d.accessList = d.accessList.map((i) => [i.address, i.storageKeys]);
          const c = __tests.TxVersions[etx.type];
          // remove fields from wrong version
          for (const k in d) {
            if (k !== 'type' && !c.fields.includes(k) && !c.optionalFields.includes(k)) delete d[k];
          }
          // RSK EIP-1991
          if (d.chainId === 30n) {
            d.to = d.to.toLowerCase();
            if (d.accessList) {
              for (const item of d.accessList) item[0] = item[0].toLowerCase();
            }
          }
          const preparedTx = Transaction.prepare(d, false);
          deepStrictEqual(preparedTx.toHex(false), unsigned);
          const sig = etx.signBy(tx.privateKey);
          deepStrictEqual(sig.toHex(true), signed);
        }
      }
    }
  });
  should(`viem transactions (${VIEM_TX.length})`, () => {
    for (let i = 0; i < VIEM_TX.length; i++) {
      const vtx = VIEM_TX[i];
      const data = vtx.transaction;
      if (!data.to) continue;
      const signed = vtx.serializedSigned;
      const unsigned = vtx.serialized;
      const signature = vtx.signature;
      for (const k of ['r', 's', 'v']) if (signature[k]) signature[k] = BigInt(signature[k]);
      // Parse unsgined
      if (unsigned) {
        const etx = Transaction.fromHex(unsigned);
        deepStrictEqual(etx.toHex(), unsigned);
        // Try to sign unsigned tx
        if (signed) {
          const sig = etx.signBy(vtx.privateKey);
          deepStrictEqual(sig.toHex(true), signed);
          deepStrictEqual(sig.raw.r, signature.r);
          deepStrictEqual(sig.raw.s, signature.s);
          if (signature.yParity !== undefined) deepStrictEqual(sig.raw.yParity, signature.yParity);
        }
      }
      // parse signed
      if (signed) {
        const tx = Transaction.fromHex(signed);
        deepStrictEqual(tx.toHex(true), signed);
        if (unsigned) deepStrictEqual(tx.toHex(false), unsigned);
      }
      // try to build tx
      if (unsigned && signed) {
        // Extract chainId && type (doesn't exists in vectors)
        const etx = Transaction.fromHex(unsigned);
        deepStrictEqual(etx.type, data.type);
        const d = { ...convertTx({ ...data, gasLimit: data.gas }), type: etx.type };
        d.chainId = etx.raw.chainId;
        if (d.gasLimit === undefined) d.gasLimit = 0n;
        if (['legacy', 'eip2930'].includes(etx.type) && d.gasPrice === undefined) d.gasPrice = 0n;
        if (['eip1559', 'eip4844'].includes(etx.type)) {
          if (d.maxFeePerGas === undefined) d.maxFeePerGas = 0n;
          if (d.maxPriorityFeePerGas === undefined) d.maxPriorityFeePerGas = 0n;
        }
        if (['eip4844'].includes(etx.type) && d.maxFeePerBlobGas === undefined)
          d.maxFeePerBlobGas = 0n;
        if (['eip4844'].includes(etx.type) && d.blobVersionedHashes === undefined)
          d.blobVersionedHashes = [];
        if (d.accessList) d.accessList = d.accessList.map((i) => [i.address, i.storageKeys]);
        const preparedTx = Transaction.prepare(d, false);
        deepStrictEqual(preparedTx.toHex(false), unsigned);
        const sig = etx.signBy(vtx.privateKey);
        deepStrictEqual(sig.toHex(true), signed);
      }
    }
  });
  should('ethereum-tests', () => {
    const skip = SKIPPED_ERRORS.ethereum_tests;
    for (const cat in ethTests) {
      for (const k in ethTests[cat]) {
        const v = Object.values(ethTests[cat][k])[0];
        if (skip.includes(k)) continue;
        let hasError = (!v.result.Shanghai ? v.result.London : v.result.Shanghai).exception;
        // console.log('TTTT', cat, k, v.result, hasError);
        // TR_IntrinsicGas
        if (hasError === 'TR_IntrinsicGas') continue;
        // console.log('ddd', cat, k, hasError);
        // if (k === 'TransactionWithRvaluePrefixed00BigInt') {
        //   console.log('TTT', v.txbytes, RlpTx.decode(ethHex().decode(v.txbytes)));
        //   console.log('AAA', Transaction.fromHex(v.txbytes, false));
        //   console.log('DDD', RawTx.decode(ethHex().decode(v.txbytes)));
        // }
        if (hasError) throws(() => Transaction.fromHex(v.txbytes, true), `throws(${cat}/${k})`);
        else {
          Transaction.fromHex(v.txbytes, true);
        }
      }
    }
  });
  describe('validations', () => {
    should('basic', () => {
      // Minimal fields with different types. Other stuff is default.
      const tx = Transaction.prepare({
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        maxFeePerGas: 2n,
      }).signBy('6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e');
      deepStrictEqual(
        tx.toHex(true),
        '0x02f8660180843b9aca000282520894df90dea0e0bf5ca6d2a7f0cb86874ba6714f463e0180c080a010cec9f4f7616a0da8b613e91300b424fd07522dae38c7a7a691ca70dbcef8b9a06f21a20cf1356f369c06eb995f3bfe01a24dc2dd7194c80bd4558df5fca02a26'
      );
      const tx2 = Transaction.prepare({
        type: 'eip2930',
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        gasPrice: 1n,
      }).signBy('6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e');
      deepStrictEqual(
        tx2.toHex(true),
        '0x01f86101800182520894df90dea0e0bf5ca6d2a7f0cb86874ba6714f463e0180c001a0fa53be4a77c94bfc8de4430c2828cb641e010870b1f62912b5cb69630507423fa04a1ab522f1691d55ba558d656d94e063f0cfbf02c70b68ac2a13628c768dd4c2'
      );
      const tx3 = Transaction.prepare({
        type: 'legacy',
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        gasPrice: 1n,
      }).signBy('6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e');
      deepStrictEqual(
        tx3.toHex(true),
        '0xf85f800182520894df90dea0e0bf5ca6d2a7f0cb86874ba6714f463e018026a09082d97700034dff9cfaa0a64136437eb7adf16940d0672491b80cfbc642a78ba04d2fd86634189e1e5e049ce958edb0ccb5dafce25559836346c360772be71a5f'
      );
    });
    should('all fields', () => {
      // Default API:
      // - requires all fields set manually (check if fields not set)
      // - type specified manually
      //
      const tx = new Transaction('eip1559', {
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        maxFeePerGas: 2n,
        maxPriorityFeePerGas: 1n,
        gasLimit: 21000n,
        chainId: 1n,
        accessList: [],
        data: '',
      });
      throws(
        () =>
          new Transaction('eip1559', {
            to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
            nonce: 0n,
            value: 1n,
            maxFeePerGas: 2n,
            maxPriorityFeePerGas: 1n,
            gasLimit: 21000n,
            chainId: 1n,
            accessList: [],
            data: '',
            gasPrice: 1n, // unexpected field
          })
      );
      throws(
        () =>
          new Transaction('eip1559', {
            to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
            nonce: 0n,
            value: 1n,
            maxFeePerGas: 2n,
            maxPriorityFeePerGas: 1n,
            gasLimit: 21000n,
            chainId: 1n,
            // accessList: [], <- missing field!
            data: '',
          })
      );
    });
    should('wrong version fields', () => {
      // Prepare:
      // - disallow signature related methods
      // - apply defaults
      // eip - 1559 + gasPrice;
      throws(
        () =>
          Transaction.prepare({
            to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
            nonce: 0n,
            value: 1n,
            gasPrice: 1n,
            maxFeePerGas: 2n,
          }),
        'gasPrice + eip1559, prepare'
      );
      throws(
        () =>
          Transaction.prepare({
            to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
            nonce: 0n,
            value: 1n,
            gasPrice: 1n,
            maxFeePerGas: 2n,
          }),
        'gasPrice + eip1559'
      );
      throws(() =>
        Transaction.prepare(
          {
            type: 'legacy',
            to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
            nonce: 0n,
            value: 1n,
            gasPrice: 1n,
            maxFeePerGas: 2n,
          },
          'maxFeePerGas+legacy'
        )
      );
      Transaction.prepare({
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        maxFeePerGas: 2n,
      });
      throws(() =>
        Transaction.prepare({
          to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
          nonce: 0n,
          value: 1n,
          maxFeePerGas: 2n,
          r: 1n,
          s: 1n,
        })
      );
    });
    should('wrong field types', () => {
      const tx = {
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        maxFeePerGas: 2n,
      };
      throws(() => Transaction.prepare({ ...tx, to: 1 }), 'to=1');
      throws(() => Transaction.prepare({ ...tx, to: new Uint8Array(0) }), 'to=u8a(0)');
      throws(() => Transaction.prepare({ ...tx, to: new Uint8Array(20) }), 'to=u8a(20)');
      Transaction.prepare({ ...tx, to: '1'.repeat(40) });
      throws(() => Transaction.prepare({ ...tx, to: '1'.repeat(41) }), 'to=1*41');
      throws(() => Transaction.prepare({ ...tx, to: '1'.repeat(42) }), 'to=1*42');
      Transaction.prepare({ ...tx, to: '0x' + '1'.repeat(40) });

      throws(() => Transaction.prepare({ ...tx, nonce: 1 }), 'nonce=1');
      Transaction.prepare({ ...tx, nonce: 1n });
      throws(() => Transaction.prepare({ ...tx, nonce: '1' }), 'nonce="1"');
    });
  });
});

describe('messenger', () => {
  should('verify signed message', () => {
    const privateKey = '0x43ff8d9ae58f6f2ef437bd3543362d1d842ecca3b6cc578b46e862b47fd60020';
    const address = '0xba20188aE2Bc7dd72eD8d0c4936154a49b17f08A';
    const msg = 'noble';
    const sig = '0x425fbe7b4d5078c4f6538f6ae13c385874ce31478324feacf1795e2403bedc3d6e8204d3cc870c95bad45bdfa6e1f631044c8886d0ff8af93923f9bc051b16841b';
    deepStrictEqual(messenger.sign(msg, privateKey), sig);
    deepStrictEqual(messenger.verify(sig, msg, address), true);
  });
  should('sign and verify 100 times', () => {
    for (let i = 0; i < 100; i++) {
      const { privateKey, address } = addr.random();
      const msg = i.toString();
      const sig = messenger.sign(msg, privateKey);
      const isValid = messenger.verify(sig, msg, address);
      deepStrictEqual(isValid, true, i);
    }
  })
})

// ESM is broken.
import url from 'node:url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  should.run();
}
