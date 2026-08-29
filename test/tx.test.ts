import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, it } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, throws } from 'node:assert';
import { deployContract } from '../src/abi/decoder.ts';
import { RlpTx, RawTx, TxVersions, legacySig, validateFields } from '../src/core/tx-internal.ts';
import { Transaction, addr, authorization } from '../src/index.ts';
import {
  add0x,
  amounts,
  cloneDeep,
  createDecimal,
  deepFreeze,
  ethHex,
  formatUnits,
  formatters,
  parseUnits,
  initSig,
  omit,
  recoverPublicKey,
  sign,
  weieth,
  weigwei,
  zip,
} from '../src/utils.ts';
import { forceGC, getEthersVectors, getViemVectorItems } from './util.ts';
import { default as EIP155_VECTORS } from './vectors/eips/eip155.json' with { type: 'json' };
import * as ethTests from './vectors/eth-tests-tx-vectors.js';
import { default as TX_VECTORS } from './vectors/transactions.json' with { type: 'json' };

const SKIPPED_ERRORS = {
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
    'DataTestInitCodeTooBig',
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
  ],
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
  if (raw.v) Object.assign(res, legacySig.encode({ v: toBig(raw.v), r: res.r, s: res.s }));
  if (raw.accessList) res.accessList = raw.accessList;
  // EIP-4844
  if (raw.blobVersionedHashes) res.blobVersionedHashes = raw.blobVersionedHashes;
  if (raw.maxFeePerBlobGas) res.maxFeePerBlobGas = toBig(raw.maxFeePerBlobGas);
  return res;
};
const randPrivs = () => new Array(1024).fill(0).map((a) => addr.random().privateKey);

describe('Transactions', () => {
  describe('EIP7702', () => {
    it('basic', () => {
      const tx = `0x04f8e3018203118080809470997970c51812dc3a010c7d01b50e0d17dc79c8880de0b6b3a764000080c0f8baf85c0194fba3912ca04dd458c843e2ee08967fc04f3579c28201a480a060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fea060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fef85a0a9400000000000000000000000000000000000000004501a060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fea060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fe`;
      const authList = [
        {
          address: '0xFBA3912Ca04dd458c843e2EE08967fC04f3579c2',
          chainId: 1n,
          nonce: 420n,
          r: 0x60fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fen,
          s: 0x60fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fen,
          yParity: 0,
        },
        {
          address: '0x0000000000000000000000000000000000000000',
          chainId: 10n,
          nonce: 69n,
          r: 0x60fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fen,
          s: 0x60fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fen,
          yParity: 1,
        },
      ];
      // Parse actual tx
      const parsed = Transaction.fromHex(tx);
      deepStrictEqual(parsed.type, 'eip7702');
      deepStrictEqual(parsed.raw.to.toLowerCase(), '0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
      deepStrictEqual(parsed.raw.value, weieth.decode('1'));
      deepStrictEqual(parsed.raw.nonce, 785n);
      deepStrictEqual(parsed.raw.authorizationList, authList);
      // Re-create tx from raw value
      const created = Transaction.prepare(
        {
          type: 'eip7702',
          to: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
          value: weieth.decode('1'),
          nonce: 785n,
          maxFeePerGas: 0n,
          gasLimit: 0n,
          maxPriorityFeePerGas: 0n,
          authorizationList: authList,
        },
        false
      );
      deepStrictEqual(created.toHex({ includeSignature: false }), tx);
      deepStrictEqual(Object.isFrozen(created), false);
      deepStrictEqual(Object.isFrozen(created.raw.authorizationList), true);
      deepStrictEqual(Object.isFrozen(created.raw.authorizationList[0]), true);
      throws(() => {
        created.raw.authorizationList[0].nonce = 421n;
      }, TypeError);
      // Emulate signing
      const sig = {
        r: 0x60fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fen,
        s: 0x60fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fen,
      };
      const signed1 = new Transaction(
        'eip7702',
        { ...created.raw, ...sig, yParity: 1 },
        { strict: false }
      );
      deepStrictEqual(
        signed1.toHex({ includeSignature: true }),
        `0x04f90126018203118080809470997970c51812dc3a010c7d01b50e0d17dc79c8880de0b6b3a764000080c0f8baf85c0194fba3912ca04dd458c843e2ee08967fc04f3579c28201a480a060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fea060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fef85a0a9400000000000000000000000000000000000000004501a060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fea060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fe01a060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fea060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fe`
      );
      const signed0 = new Transaction(
        'eip7702',
        { ...created.raw, ...sig, yParity: 0 },
        { strict: false }
      );
      deepStrictEqual(
        signed0.toHex({ includeSignature: true }),
        `0x04f90126018203118080809470997970c51812dc3a010c7d01b50e0d17dc79c8880de0b6b3a764000080c0f8baf85c0194fba3912ca04dd458c843e2ee08967fc04f3579c28201a480a060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fea060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fef85a0a9400000000000000000000000000000000000000004501a060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fea060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fe80a060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fea060fdd29ff912ce880cd3edaf9f932dc61d3dae823ea77e0323f94adb9f6a72fe`
      );
    });
    it('sign authorization', () => {
      const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      const auth = {
        address: '0xFBA3912Ca04dd458c843e2EE08967fC04f3579c2',
        chainId: 1n,
        nonce: 0n,
      };
      const signed = authorization.sign(auth, privateKey);
      deepStrictEqual(authorization.getAuthority(signed), addr.fromPrivateKey(privateKey));
      // EIP-7702: s > secp256k1n/2 makes the authorization invalid on-chain.
      // The malleated twin (n - s, flipped parity) recovers the same key, so
      // without the check it would silently "work".
      const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
      const malleated = { ...signed, s: N - signed.s, yParity: signed.yParity ^ 1 };
      throws(() => authorization.getAuthority(malleated), /invalid s/);
    });
    it('validate authorization address', () => {
      const invalid = ['0x01', `0x${'1'.repeat(39)}`, '0x8ba1f109551bD432803012645Ac136ddd64DBA73'];
      for (const address of invalid)
        throws(
          () => authorization.getHash({ chainId: 1n, address, nonce: 0n }),
          /address|checksum|20 bytes/i
        );
    });
    it('reject invalid set-code tx shape', () => {
      const tx = {
        type: 'eip7702' as const,
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 0n,
        gasLimit: 46000n,
        maxFeePerGas: weigwei.decode('2'),
        authorizationList: [
          {
            address: '0x0000000000000000000000000000000000000000',
            chainId: 1n,
            nonce: 0n,
            r: 1n,
            s: 1n,
            yParity: 0,
          },
        ],
      };
      Transaction.prepare(tx);
      const txWithoutGasLimit: any = { ...tx };
      delete txWithoutGasLimit.gasLimit;
      deepStrictEqual(Transaction.prepare(txWithoutGasLimit).raw.gasLimit, 46000n);
      throws(
        () => Transaction.prepare({ ...tx, gasLimit: 21000n }),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'gasLimit', error: 'intrinsic gas too low: 21000 < 46000' },
          ]);
          return true;
        }
      );
      Transaction.prepare(
        {
          ...tx,
          authorizationList: [{ ...tx.authorizationList[0], nonce: amounts.maxUint64 - 1n }],
        },
        false
      );
      Transaction.prepare({
        ...tx,
        authorizationList: [{ ...tx.authorizationList[0], chainId: amounts.maxUint256 }],
      });
      const txWithoutAuthorizationList: any = { ...tx };
      delete txWithoutAuthorizationList.authorizationList;
      throws(
        () => Transaction.prepare(txWithoutAuthorizationList, false),
        (err: any) => {
          deepStrictEqual(err.errors, [
            {
              field: 'authorizationList',
              error: 'field "authorizationList" must be present for tx type=eip7702',
            },
          ]);
          return true;
        }
      );
      throws(
        () => Transaction.prepare({ ...tx, authorizationList: [] }, false),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'authorizationList', error: 'must contain at least one authorization' },
          ]);
          return true;
        }
      );
      throws(
        () => Transaction.prepare({ ...tx, to: '0x', data: '00' }, false),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'to', error: 'eip7702 transaction destination must not be empty' },
          ]);
          return true;
        }
      );
      // 21000 + 32000 (G_txcreate) + 4 (one zero byte) + 2 (one EIP-3860 initcode word)
      deepStrictEqual(
        Transaction.prepare({
          type: 'eip1559',
          to: '0x',
          data: '00',
          nonce: 0n,
          value: 0n,
          maxFeePerGas: weigwei.decode('2'),
        }).raw.gasLimit,
        53006n
      );
      throws(
        () =>
          Transaction.prepare({
            type: 'eip1559',
            to: '0x',
            data: '00',
            nonce: 0n,
            value: 0n,
            gasLimit: 21004n,
            maxFeePerGas: weigwei.decode('2'),
          }),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'gasLimit', error: 'intrinsic gas too low: 21004 < 53006' },
          ]);
          return true;
        }
      );
    });
  });
  describe('Utils', () => {
    it('legacySig', () => {
      // DECODE
      throws(() => legacySig.decode([] as any), 'legacySig array');
      throws(() => legacySig.decode(new Uint8Array([]) as any), 'legacySig u8a');
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
      throws(
        () => legacySig.decode({ yParity: '0', chainId: 1n, r: 1n, s: 1n }),
        /wrong yParity type=string/
      );
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

    it('utils: initSig rejects non-Ethereum recovery bits', () => {
      const sig = { r: 1n, s: 1n };
      deepStrictEqual([initSig(sig, 0).recovery, initSig(sig, 1).recovery], [0, 1]);
      throws(() => initSig(sig, 2), /recovery bit/);
      throws(() => initSig(sig, 3), /recovery bit/);
    });
    it('utils: recoverPublicKey round-trips sign/initSig', () => {
      const { privateKey, address } = addr.random();
      const hash = new Uint8Array(32).fill(7);
      const sig = sign(hash, ethHex.decode(privateKey));
      // straight from sign(), and after an initSig round-trip from {r, s} + bit
      deepStrictEqual(addr.fromPublicKey(recoverPublicKey(sig, hash)), address);
      const rebuilt = initSig({ r: sig.r, s: sig.s }, sig.recovery);
      deepStrictEqual(addr.fromPublicKey(recoverPublicKey(rebuilt, hash)), address);
      // recovery against a different digest yields a different (wrong) key
      const other = new Uint8Array(32).fill(8);
      deepStrictEqual(addr.fromPublicKey(recoverPublicKey(sig, other)) === address, false);
    });
    it('utils: cloneDeep preserves null and own keys', () => {
      const value = Object.assign(Object.create({ inherited: { value: 1 } }), {
        own: { value: 2 },
        nil: null,
      });
      const cloned = cloneDeep(value);
      deepStrictEqual(cloned, { own: { value: 2 }, nil: null });
      deepStrictEqual(Object.hasOwn(cloned, 'inherited'), false);
      deepStrictEqual(cloned.own === value.own, false);
    });
    it('utils: cloneDeep and omit preserve __proto__ as an own data property', () => {
      const value = JSON.parse('{"role":"user","__proto__":{"role":"admin"}}');
      const cloned = cloneDeep(value);
      deepStrictEqual(Object.getPrototypeOf(cloned), Object.prototype);
      deepStrictEqual(Object.hasOwn(cloned, '__proto__'), true);
      deepStrictEqual(cloned.__proto__, { role: 'admin' });
      deepStrictEqual(cloned.__proto__ === value.__proto__, false);

      const omitted = omit(value, 'role');
      deepStrictEqual(Object.getPrototypeOf(omitted), Object.prototype);
      deepStrictEqual(Object.hasOwn(omitted, '__proto__'), true);
      deepStrictEqual(omitted.__proto__, { role: 'admin' });
      deepStrictEqual(omitted.role, undefined);
      deepStrictEqual(omit(value, '__proto__'), { role: 'user' });
    });
    it('utils: omit rejects non-plain object carriers', () => {
      deepStrictEqual(omit({ a: 1, b: 2 }, 'b'), { a: 1 });
      throws(() => omit(null as any, 'x'), /plain object/);
      throws(() => omit([1, 2] as any, '1'), /plain object/);
      throws(() => omit(new Uint8Array([1, 2]) as any, '0'), /plain object/);
    });
    it('utils: zip rejects length mismatches', () => {
      deepStrictEqual(zip([1, 2], ['a', 'b']), [
        [1, 'a'],
        [2, 'b'],
      ]);
      throws(() => zip([1, 2], ['a']), /zip: length mismatch/);
      throws(() => zip([1], ['a', 'b']), /zip: length mismatch/);
    });
    it('utils: perCentDecimal', () => {
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
      t(255, 0.0123456, 0.01);
      throws(() => perCentDecimal(0, 1), /perCentDecimal: wrong precision/);
      throws(() => perCentDecimal(-1, 1), /perCentDecimal: wrong precision/);
      throws(() => perCentDecimal(256, 1), /perCentDecimal: wrong precision/);
      throws(() => perCentDecimal(18, 0), /perCentDecimal: wrong price/);
      throws(() => perCentDecimal(18, -1), /perCentDecimal: wrong price/);
    });
    it('utils: formatBigint omits decimal point when precision is zero', () => {
      deepStrictEqual(formatters.formatBigint(1_000_000_000n, 1_000_000_000n, 0, true), '1');
      deepStrictEqual(formatters.formatBigint(123_456_789n, 1_000_000_000n, 0, true), '~0');
    });
    it('utils: fromWei labels gwei-scaled values as gwei', () => {
      deepStrictEqual(formatters.fromWei(1_000_000_000n), '1gwei');
      deepStrictEqual(formatters.fromWei(1_500_000_000n), '1.5gwei');
    });
    it('utils: deepFreeze', () => {
      const value: any = { a: { b: [1, { c: 2 }] } };
      value.self = value;
      deepStrictEqual(deepFreeze(value), value);
      deepStrictEqual(
        {
          root: Object.isFrozen(value),
          a: Object.isFrozen(value.a),
          b: Object.isFrozen(value.a.b),
          c: Object.isFrozen(value.a.b[1]),
        },
        { root: true, a: true, b: true, c: true }
      );
      throws(() => value.a.b.push(3), TypeError);
      throws(() => (value.a.b[1].c = 4), TypeError);
      deepStrictEqual(value.a.b, [1, { c: 2 }]);
      deepStrictEqual(value.self, value);
    });
  });

  describe('RawTx', () => {
    it('rejects non-minimal transaction integers', () => {
      const signed = Transaction.prepare({
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 1n,
        value: 1n,
        maxFeePerGas: 2_000_000_000n,
      }).signBy('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', false);
      const wire = RlpTx.decode(signed.toBytes());
      if (!Array.isArray(wire.data)) throw new Error('expected transaction field list');

      // Type-2 field indexes exercise U64 (nonce), U256 (value), and int (yParity).
      for (const [field, nonMinimal] of [
        [1, Uint8Array.of(0, 1)],
        [6, Uint8Array.of(0, 1)],
        [9, Uint8Array.of(0, Number(signed.raw.yParity))],
      ] as const) {
        const malformed = { ...wire, data: wire.data.slice() };
        malformed.data[field] = nonMinimal;
        throws(
          () => Transaction.fromBytes(RlpTx.encode(malformed)),
          /bigint: non-minimal encoding/
        );
      }
    });
    const t = (hex) => {
      const decoded = RawTx.decode(ethHex.decode(hex));
      const encoded = ethHex.encode(RawTx.encode(decoded));
      deepStrictEqual(encoded, hex, 'RawTx.encoded');
    };
    it('encodes validated null-prototype data', () => {
      const data = Object.assign(Object.create(null), {
        chainId: 1n,
        nonce: 1n,
        maxPriorityFeePerGas: 1n,
        maxFeePerGas: 2n,
        gasLimit: 21000n,
        to: '0x1111111111111111111111111111111111111111',
        value: 0n,
        data: '0x',
        accessList: [],
      });
      validateFields('eip1559', data, false);
      deepStrictEqual(RawTx.decode(RawTx.encode({ type: 'eip1559', data })), {
        type: 'eip1559',
        data: {
          chainId: 1n,
          nonce: 1n,
          maxPriorityFeePerGas: 1n,
          maxFeePerGas: 2n,
          gasLimit: 21000n,
          to: '0x1111111111111111111111111111111111111111',
          value: 0n,
          data: '0x',
          accessList: [],
        },
      });
    });
    it('vectors', () => {
      for (const i of TX_VECTORS) t(i.hex);
    });
    it('eip155', () => {
      for (const i of EIP155_VECTORS) t(i.rlp);
    });
    it('ethereum-tests', () => {
      const skip = SKIPPED_ERRORS.ethereum_tests_raw_tx;
      for (const cat in ethTests) {
        for (const k in ethTests[cat]) {
          const v = Object.values(ethTests[cat][k])[0];
          if (skip.includes(k)) continue;
          let hasError = (!v.result.Shanghai ? v.result.London : v.result.Shanghai).exception;
          if (hasError === 'TR_IntrinsicGas') continue;
          // Raw Tx doesn't validate this, only Transaction does.
          if (hasError === 'TR_InitCodeLimitExceeded') continue;
          if (hasError) throws(() => t(v.txbytes), `throws(${cat}/${k})`);
          else {
            t(v.txbytes);
          }
        }
      }
    });
    it(`viem tests`, async () => {
      try {
        for await (const v of getViemVectorItems('transaction.json.gz')) {
          for (const tx of [v.serialized, v.serializedSigned]) t(tx);
        }
      } finally {
        forceGC();
      }
    });
    it('EIP-4844', () => {
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
    it('generate correct address with Address.fromPrivateKey()', () => {
      deepStrictEqual(addr.fromPrivateKey(priv), addr_);
    });
    it('generate correct address with Address.fromPublicKey()', () => {
      deepStrictEqual(addr.fromPublicKey(pub), addr_);
    });
    it('formatUnits/parseUnits round-trip with cached coders', () => {
      deepStrictEqual(formatUnits(1500000n, 6), '1.5');
      deepStrictEqual(formatUnits(1000000000000000000n, 18), '1');
      deepStrictEqual(parseUnits('1.5', 6), 1500000n);
      deepStrictEqual(parseUnits(' 0.000001 ', 6), 1n); // input is trimmed
      // a lone comma is the decimal separator; never a thousands grouping
      deepStrictEqual(parseUnits('0,02', 18), 20000000000000000n);
      deepStrictEqual(parseUnits('1,234', 6), 1234000n);
      throws(() => parseUnits('1,234.5', 6)); // mixed separators
      throws(() => parseUnits('1,2,3', 6)); // repeated separators
      throws(() => parseUnits('nope', 6));
    });
    it('decimal coders reject precision outside the ERC-20 uint8 range', () => {
      deepStrictEqual(formatUnits(1n, 255), `0.${'0'.repeat(254)}1`);
      deepStrictEqual(parseUnits('1', 255), 10n ** 255n);
      for (const precision of [-1, 256, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
        throws(() => createDecimal(precision), RangeError);
        throws(() => formatUnits(1n, precision), RangeError);
        throws(() => parseUnits('1', precision), RangeError);
      }
    });
    it('isValidPrivateKey', () => {
      deepStrictEqual(addr.isValidPrivateKey(priv), true);
      deepStrictEqual(addr.isValidPrivateKey(`0x${priv}`), true);
      deepStrictEqual(addr.isValidPrivateKey(hexToBytes(priv)), true);
      // format problems
      deepStrictEqual(addr.isValidPrivateKey(''), false);
      deepStrictEqual(addr.isValidPrivateKey('0xzz'), false);
      deepStrictEqual(addr.isValidPrivateKey(priv.slice(2)), false);
      // out-of-range scalars pass a hex-format check but cannot sign
      deepStrictEqual(addr.isValidPrivateKey('00'.repeat(32)), false);
      deepStrictEqual(addr.isValidPrivateKey('ff'.repeat(32)), false);
      deepStrictEqual(addr.isValidPrivateKey(new Uint8Array(32)), false);
    });
    it('getCreateAddress', () => {
      // Cross-checked with ethers getCreateAddress
      const from = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
      const vectors = [
        [0, '0xcF59cf8A176d2a046d434110bEc2E124496356Ff'],
        [1, '0xB2ecEad63c92F3936595572B03303aEaF8666fB1'],
        [127, '0x258238Ba5e34Ee04aFe23b47d961e20a4B18F273'],
        [128, '0x9d64C5AC3dB371e7a073883dA1e7D36B0b907B32'],
        [255, '0x9F81A42C056C402579f6E3E69b906e285cAfD285'],
        [256, '0xb7130b1be359fDF6c71A401371a4cb8a5919b3eD'],
        [4294967295, '0x7cf2959195eAC62938d5B02968e33AB32a5D9e9a'],
      ] as const;
      for (const [nonce, expected] of vectors) {
        deepStrictEqual(addr.getCreateAddress(from, nonce), expected);
        deepStrictEqual(addr.getCreateAddress(from, BigInt(nonce)), expected);
      }
      throws(() => addr.getCreateAddress(from, -1));
      throws(() => addr.getCreateAddress(from, 1.5));
      throws(() => addr.getCreateAddress(from, 2n ** 64n));
      throws(() => addr.getCreateAddress('0x1234', 0));
      throws(
        () => addr.getCreateAddress('0x8ba1f109551bD432803012645Ac136ddd64DBA73', 0),
        /checksum/
      );
    });
    it('getCreate2Address (EIP-1014 examples)', () => {
      const keccakOf00 = '0xbc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a'; // keccak(0x00)
      const keccakOfDeadbeef = '0xd4fd4e189132273036449fc9e11198c739161b4c0116a9a2dccdfa1c492006f1'; // keccak(0xdeadbeef)
      const keccakOfEmpty = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'; // keccak(0x)
      const zeros32 = `0x${'00'.repeat(32)}`;
      const vectors = [
        [
          '0x0000000000000000000000000000000000000000',
          zeros32,
          keccakOf00,
          '0x4D1A2e2bB4F88F0250f26Ffff098B0b30B26BF38',
        ],
        [
          '0xdeadbeef00000000000000000000000000000000',
          zeros32,
          keccakOf00,
          '0xB928f69Bb1D91Cd65274e3c79d8986362984fDA3',
        ],
        [
          '0xdeadbeef00000000000000000000000000000000',
          '0x000000000000000000000000feed000000000000000000000000000000000000',
          keccakOf00,
          '0xD04116cDd17beBE565EB2422F2497E06cC1C9833',
        ],
        [
          '0x0000000000000000000000000000000000000000',
          zeros32,
          keccakOfDeadbeef,
          '0x70f2b2914A2a4b783FaEFb75f459A580616Fcb5e',
        ],
        [
          '0x00000000000000000000000000000000deadbeef',
          `0x${'00'.repeat(28)}cafebabe`,
          keccakOfDeadbeef,
          '0x60f3f640a8508fC6a86d45DF051962668E1e8AC7',
        ],
        [
          '0x0000000000000000000000000000000000000000',
          zeros32,
          keccakOfEmpty,
          '0xE33C0C7F7df4809055C3ebA6c09CFe4BaF1BD9e0',
        ],
      ] as const;
      for (const [from, salt, initCodeHash, expected] of vectors) {
        deepStrictEqual(addr.getCreate2Address(from, salt, initCodeHash), expected);
        deepStrictEqual(
          addr.getCreate2Address(from, ethHex.decode(salt), ethHex.decode(initCodeHash)),
          expected
        );
      }
      throws(() => addr.getCreate2Address('0x1234', zeros32, keccakOf00));
      throws(() => addr.getCreate2Address(addr_, '0x00', keccakOf00));
      throws(() => addr.getCreate2Address(addr_, zeros32, '0x00'));
      throws(
        () =>
          addr.getCreate2Address('0x8ba1f109551bD432803012645Ac136ddd64DBA73', zeros32, keccakOf00),
        /checksum/
      );
    });
  });
  const eip155 = EIP155_VECTORS.slice(1);

  it('generate correct Transaction.hash', () => {
    for (const txr of TX_VECTORS) {
      const etx = Transaction.fromHex(txr.hex);
      deepStrictEqual(bytesToHex(etx.calcHash(true)), txr.hash.slice(2));
    }
  });
  it('parse tx sender correctly', () => {
    for (const txr of TX_VECTORS) {
      const etx = Transaction.fromHex(txr.hex);
      deepStrictEqual(etx.recoverSender().address, addr_, 'sender is incorrect');
    }
  });
  it('legacy v getter and pre-EIP155 prepare', () => {
    const common = {
      to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
      value: 1n,
      gasPrice: 2n,
      nonce: 0n,
    };
    // default legacy chainId=1 -> EIP-155: v = yParity + 2*chainId + 35
    const eip155tx = Transaction.prepare({ type: 'legacy', ...common }).signBy(priv, false);
    deepStrictEqual(eip155tx.raw.chainId, 1n);
    deepStrictEqual(eip155tx.v, BigInt(37 + eip155tx.raw.yParity!));
    // explicit chainId: undefined -> pre-EIP-155: v = yParity + 27
    const pre155 = Transaction.prepare({
      type: 'legacy',
      chainId: undefined,
      ...common,
    }).signBy(priv, false);
    deepStrictEqual(pre155.v, BigInt(27 + pre155.raw.yParity!));
    const rt = Transaction.fromHex(pre155.toHex({ includeSignature: true }));
    deepStrictEqual(rt.raw.chainId, undefined);
    deepStrictEqual(rt.sender, addr_);
    deepStrictEqual(rt.v, pre155.v);
  });
  it('compare with Transaction.equals()', () => {
    for (const txr of TX_VECTORS) {
      const etx1 = Transaction.fromHex(txr.hex);
      const etx2 = Transaction.fromHex(txr.hex);
      deepStrictEqual(etx1, etx2);
    }
  });
  it('construct Transaction properly', async () => {
    for (const txr of TX_VECTORS) {
      const etx = Transaction.fromHex(txr.hex);
      const tx = new Transaction('legacy', {
        ...convertTx(txr.raw),
        chainId: 3n,
      });
      const signed = tx.signBy(priv, false);
      deepStrictEqual(signed.calcHash(true), etx.calcHash(true));
      const signedH = tx.signBy(priv);
      signedH.verifySignature();
    }
  });

  it('handle EIP155 test vectors (raw)', () => {
    for (const vector of eip155) {
      const a = new Transaction('legacy', convertTx(vector.transaction));
      const b = Transaction.fromHex(vector.rlp);
      deepStrictEqual(a.raw, b.raw, 'raw');
    }
  });

  it('handle EIP155 test vectors (recursive)', () => {
    for (const vector of eip155) {
      const ours = Transaction.fromHex(vector.rlp);
      deepStrictEqual(ours.raw, Transaction.fromHex(ours.toHex({ includeSignature: true })).raw);
    }
  });

  it('handle EIP155 test vectors (hash)', () => {
    for (const vector of eip155) {
      const ours = new Transaction('legacy', convertTx(vector.transaction));
      deepStrictEqual(bytesToHex(ours.calcHash(false)), vector.hash);
    }
  });

  it('handle EIP155 test vectors (sender)', () => {
    for (const vector of eip155) {
      const ours = Transaction.fromHex(vector.rlp);
      deepStrictEqual(ours.recoverSender().address.toLowerCase().slice(2), vector.sender);
    }
  });

  it('getMessageToSign data should equal in signed/unsigned', async () => {
    const tx = Transaction.prepare({
      type: 'legacy',
      to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
      gasPrice: 100n * 10n ** 9n, // 100 gwei in wei
      value: 10n ** 18n, // 1 eth in wei
      nonce: 1n,
      chainId: 1n,
    });
    const privateKey = '6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e';
    const signedTx = tx.signBy(privateKey, false); // Uint8Array is also accepted
    const address = addr.fromPrivateKey(privateKey);
    deepStrictEqual(signedTx.sender, address);
    const signedTxH = tx.signBy(privateKey);
    deepStrictEqual(signedTxH.sender, address);
    const signedTxD = tx.signBy(privateKey, false);
    deepStrictEqual(signedTxD.sender, address);
  });

  it('ethers.js/transactions.json', () => {
    // Awesome tests, there is even eip4844
    for (const tx of getEthersVectors('transactions.json.gz')) {
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
            const sig = etx.signBy(tx.privateKey, false);
            deepStrictEqual(sig.toHex({ includeSignature: true }), signed);
            deepStrictEqual(sig.raw.r, signature.r);
            deepStrictEqual(sig.raw.s, signature.s);
          }
        }
        // parse signed
        if (signed) {
          const tx = Transaction.fromHex(signed);
          deepStrictEqual(tx.toHex({ includeSignature: true }), signed);
          if (unsigned) deepStrictEqual(tx.toHex({ includeSignature: false }), unsigned);
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
          const c = TxVersions[etx.type];
          // remove fields from wrong version
          for (const k in d) {
            if (k !== 'type' && !c.fields.includes(k) && !c.optionalFields.includes(k)) delete d[k];
          }
          // RSK EIP-1991
          if (d.chainId === 30n) {
            d.to = d.to.toLowerCase();
            if (d.accessList) {
              for (const item of d.accessList) item.address = item.address.toLowerCase();
            }
          }
          const preparedTx = Transaction.prepare(d, false);
          deepStrictEqual(preparedTx.toHex({ includeSignature: false }), unsigned);
          const sig = etx.signBy(tx.privateKey, false);
          deepStrictEqual(sig.toHex({ includeSignature: true }), signed);
        }
      }
    }
  });
  it(`viem transactions`, async () => {
    try {
      for await (const vtx of getViemVectorItems('transaction.json.gz')) {
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
            const sig = etx.signBy(vtx.privateKey, false);
            deepStrictEqual(sig.toHex({ includeSignature: true }), signed);
            deepStrictEqual(sig.raw.r, signature.r);
            deepStrictEqual(sig.raw.s, signature.s);
            if (signature.yParity !== undefined)
              deepStrictEqual(sig.raw.yParity, signature.yParity);
          }
        }
        // parse signed
        if (signed) {
          const tx = Transaction.fromHex(signed);
          deepStrictEqual(tx.toHex({ includeSignature: true }), signed);
          if (unsigned) deepStrictEqual(tx.toHex({ includeSignature: false }), unsigned);
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
          const preparedTx = Transaction.prepare(d, false);
          deepStrictEqual(preparedTx.toHex({ includeSignature: false }), unsigned);
          const sig = etx.signBy(vtx.privateKey, false);
          deepStrictEqual(sig.toHex({ includeSignature: true }), signed);
        }
      }
    } finally {
      forceGC();
    }
  });
  it('ethereum-tests', () => {
    const skip = SKIPPED_ERRORS.ethereum_tests;
    for (const cat in ethTests) {
      for (const k in ethTests[cat]) {
        const v = Object.values(ethTests[cat][k])[0];
        if (skip.includes(k)) continue;
        let hasError = (!v.result.Shanghai ? v.result.London : v.result.Shanghai).exception;
        // TR_IntrinsicGas
        if (hasError === 'TR_IntrinsicGas') continue;
        if (hasError) throws(() => Transaction.fromHex(v.txbytes, true), `throws(${cat}/${k})`);
        else {
          Transaction.fromHex(v.txbytes, true);
        }
      }
    }
  });
  describe('validations', () => {
    it('basic', () => {
      // Minimal fields with different types. Other stuff is default.
      const raw = Transaction.prepare({
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        maxFeePerGas: weigwei.decode('2'),
      });
      const priv = '6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e';
      const explicitUndefinedType = Transaction.prepare({
        type: undefined,
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        maxFeePerGas: weigwei.decode('2'),
      });
      deepStrictEqual(explicitUndefinedType.type, raw.type);
      deepStrictEqual(explicitUndefinedType.raw, raw.raw);
      deepStrictEqual(explicitUndefinedType.clone().raw, raw.raw);
      const looseTx = Transaction.prepare(
        {
          to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
          nonce: amounts.maxUint64 - 1n,
          value: 1n,
          maxFeePerGas: weigwei.decode('2'),
        },
        false
      );
      const looseClone = looseTx.clone();
      deepStrictEqual(looseClone.raw, looseTx.raw);
      deepStrictEqual(
        looseClone.toHex({ includeSignature: false }),
        looseTx.toHex({ includeSignature: false })
      );
      const looseSigned = looseTx.signBy(priv, false);
      const looseUnsigned = looseSigned.removeSignature();
      deepStrictEqual(looseUnsigned.raw, looseTx.raw);
      deepStrictEqual(
        looseUnsigned.toHex({ includeSignature: false }),
        looseTx.toHex({ includeSignature: false })
      );
      const tx = raw.signBy(priv, false);
      const txH = raw.signBy(priv, true);
      deepStrictEqual(
        tx.toHex({ includeSignature: true }),
        '0x02f86a0180843b9aca00847735940082520894df90dea0e0bf5ca6d2a7f0cb86874ba6714f463e0180c080a09448b25a696cb0f66945be1844711a5f6979c6cbf060e4f7b5a53e0dceeb3bdca004c61d9b91ecea687f78aa7e65108438e9b12a4fe90b1f70b0956134dfaba18f'
      );
      const secp256k1N = BigInt(
        '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'
      );
      const highS = new Transaction(
        tx.type,
        {
          ...tx.raw,
          s: secp256k1N - tx.raw.s!,
          yParity: tx.raw.yParity === 0 ? 1 : 0,
        },
        { strict: false }
      );
      deepStrictEqual(highS.verifySignature(), false);
      throws(() => raw.verifySignature(), /expected signed transaction/);
      deepStrictEqual(txH.verifySignature(), true);
      const tx2 = Transaction.prepare({
        type: 'eip2930',
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        gasPrice: 1n,
      }).signBy(priv, false);
      deepStrictEqual(
        tx2.toHex({ includeSignature: true }),
        '0x01f86101800182520894df90dea0e0bf5ca6d2a7f0cb86874ba6714f463e0180c001a0fa53be4a77c94bfc8de4430c2828cb641e010870b1f62912b5cb69630507423fa04a1ab522f1691d55ba558d656d94e063f0cfbf02c70b68ac2a13628c768dd4c2'
      );
      const tx3 = Transaction.prepare({
        type: 'legacy',
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        gasPrice: 1n,
      }).signBy(priv, false);
      deepStrictEqual(
        tx3.toHex({ includeSignature: true }),
        '0xf85f800182520894df90dea0e0bf5ca6d2a7f0cb86874ba6714f463e018026a09082d97700034dff9cfaa0a64136437eb7adf16940d0672491b80cfbc642a78ba04d2fd86634189e1e5e049ce958edb0ccb5dafce25559836346c360772be71a5f'
      );
    });
    it('signature field edge cases', () => {
      const priv = '6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e';
      const fields = {
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        maxFeePerGas: weigwei.decode('2'),
      };
      const tx = Transaction.prepare(fields).signBy(priv, false);
      // signing an already signed tx
      throws(() => tx.signBy(priv), /expected unsigned transaction/);
      // high-s: verifySignature() returns false (above), sender recovery must throw
      const secp256k1N = BigInt(
        '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'
      );
      const highS = new Transaction(
        tx.type,
        { ...tx.raw, s: secp256k1N - tx.raw.s!, yParity: tx.raw.yParity === 0 ? 1 : 0 },
        { strict: false }
      );
      throws(() => highS.recoverSender(), /invalid s/);
      // prepare() must reject user-provided signature fields
      throws(
        () => Transaction.prepare({ ...fields, r: 1n, s: 1n, yParity: 0 }),
        (e: any) => e.errors && e.errors.some((i: any) => i.error.includes('sig-related'))
      );
    });
    it('1024 private keys', () => {
      for (const priv of randPrivs()) {
        const address = addr.fromPrivateKey(priv);
        const raw = Transaction.prepare({
          to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
          nonce: 0n,
          value: 1n,
          maxFeePerGas: weigwei.decode('2'),
        });
        const txD = raw.signBy(priv, false);
        const txH = raw.signBy(priv, true);
        deepStrictEqual(txD.verifySignature(), true);
        deepStrictEqual(txH.verifySignature(), true);
        deepStrictEqual(txD.sender, address);
        deepStrictEqual(txH.sender, address);
      }
    });
    it('all fields', () => {
      // Default API:
      // - requires all fields set manually (check if fields not set)
      // - type specified manually
      //
      const tx = new Transaction('eip1559', {
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        maxFeePerGas: weigwei.decode('2'),
        maxPriorityFeePerGas: 1n,
        gasLimit: 21000n,
        chainId: 1n,
        accessList: [],
        data: '',
      });
      const mutableRaw = {
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        maxFeePerGas: 2n,
        maxPriorityFeePerGas: 1n,
        gasLimit: 21000n,
        chainId: 1n,
        accessList: [] as any[],
        data: '',
      };
      const stableTx = new Transaction('eip1559', mutableRaw, { strict: false });
      const stableHex = stableTx.toHex({ includeSignature: false });
      mutableRaw.maxFeePerGas = 9n;
      mutableRaw.accessList.push({
        address: '0x0000000000000000000000000000000000000000',
        storageKeys: [],
      });
      Object.assign(mutableRaw, { r: 1n, s: 1n, yParity: 0 });
      deepStrictEqual(stableTx.toHex({ includeSignature: false }), stableHex);
      deepStrictEqual(stableTx.isSigned, false);
      deepStrictEqual(stableTx.raw, {
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
      deepStrictEqual(Object.isFrozen(stableTx), false);
      deepStrictEqual(Object.isFrozen(stableTx.raw.accessList), true);
      throws(() => {
        stableTx.raw.accessList.push({
          address: '0x0000000000000000000000000000000000000000',
          storageKeys: [],
        });
      }, TypeError);
      deepStrictEqual(
        new Transaction(
          'legacy',
          {
            to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
            nonce: 0n,
            value: 1n,
            gasPrice: 1n,
            gasLimit: 21000n,
            data: '',
          },
          { strict: false }
        ).raw,
        {
          to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
          nonce: 0n,
          value: 1n,
          gasPrice: 1n,
          gasLimit: 21000n,
          data: '',
        }
      );
      throws(
        () =>
          new Transaction('eip1559', {
            to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
            nonce: 0n,
            value: 1n,
            maxFeePerGas: weigwei.decode('2'),
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
            maxFeePerGas: weigwei.decode('2'),
            maxPriorityFeePerGas: 1n,
            gasLimit: 21000n,
            chainId: 1n,
            // accessList: [], <- missing field!
            data: '',
          })
      );
    });
    it('wrong version fields', () => {
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
            maxFeePerGas: weigwei.decode('2'),
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
            maxFeePerGas: weigwei.decode('2'),
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
            maxFeePerGas: weigwei.decode('2'),
          },
          'maxFeePerGas+legacy'
        )
      );
      Transaction.prepare({
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        maxFeePerGas: weigwei.decode('2'),
      });
      throws(() =>
        Transaction.prepare({
          to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
          nonce: 0n,
          value: 1n,
          maxFeePerGas: weigwei.decode('2'),
          r: 1n,
          s: 1n,
        })
      );
    });
    it('wrong field types', () => {
      const tx = {
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 1n,
        maxFeePerGas: weigwei.decode('2'),
      };
      throws(() => Transaction.prepare({ ...tx, to: 1 }), 'to=1');
      throws(() => Transaction.prepare({ ...tx, to: new Uint8Array(0) }), 'to=u8a(0)');
      throws(() => Transaction.prepare({ ...tx, to: new Uint8Array(20) }), 'to=u8a(20)');
      throws(() => Transaction.prepare({ ...tx, to: '1'.repeat(40) }), 'to=no_0x');
      throws(() => Transaction.prepare({ ...tx, to: '1'.repeat(41) }), 'to=1*41');
      throws(() => Transaction.prepare({ ...tx, to: '1'.repeat(42) }), 'to=1*42');
      Transaction.prepare({ ...tx, to: '0x' + '1'.repeat(40) });
      throws(
        () => Transaction.prepare({ ...tx, foo: 1n } as any, false),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'foo', error: 'unknown field "foo" for tx type=eip1559' },
          ]);
          return true;
        }
      );

      throws(() => validateFields('legacy', [] as any, false), 'tx fields array');
      throws(() => validateFields('legacy', new Uint8Array([]) as any, false), 'tx fields u8a');
      throws(() => Transaction.prepare({ ...tx, nonce: 1 }), 'nonce=1');
      Transaction.prepare({ ...tx, nonce: 1n });
      throws(() => Transaction.prepare({ ...tx, nonce: '1' }), 'nonce="1"');
      Transaction.prepare({ ...tx, nonce: amounts.maxUint64 - 1n }, false);
      Transaction.prepare({ ...tx, chainId: amounts.maxUint256 });
      for (const chainId of [-1n, amounts.maxUint256 + 1n]) {
        throws(
          () => Transaction.prepare({ ...tx, chainId }, false),
          (err: any) => {
            deepStrictEqual(err.errors, [
              {
                field: 'chainId',
                error: `Writer(): value out of unsigned bounds. Expected 0 <= ${chainId} < ${
                  amounts.maxUint256 + 1n
                }`,
              },
            ]);
            return true;
          }
        );
      }
      Transaction.prepare({
        type: 'legacy',
        to: tx.to,
        nonce: 0n,
        value: 1n,
        gasPrice: 1n,
        chainId: amounts.maxUint256,
      });
      new Transaction(
        'legacy',
        {
          nonce: 0n,
          gasPrice: 1n,
          gasLimit: 21000n,
          to: tx.to,
          value: 1n,
          data: '',
          chainId: undefined,
        },
        { strict: false }
      );
      const signedLegacyChainId = amounts.maxChainId;
      const signedLegacy = {
        nonce: 0n,
        gasPrice: 1n,
        gasLimit: 21000n,
        to: tx.to,
        value: 1n,
        data: '',
        chainId: signedLegacyChainId,
        yParity: 1,
        r: 1n,
        s: 1n,
      };
      validateFields('legacy', signedLegacy);
      throws(
        () => validateFields('legacy', { ...signedLegacy, chainId: signedLegacyChainId + 1n }),
        (err: any) => {
          deepStrictEqual(err.errors, [
            {
              field: 'chainId',
              error: `must be >= 1 and <= ${signedLegacyChainId}, not ${signedLegacyChainId + 1n}`,
            },
          ]);
          return true;
        }
      );
      Transaction.prepare({ ...tx, gasLimit: 1n, maxFeePerGas: amounts.maxUint64 + 1n }, false);
      throws(
        () => Transaction.prepare({ ...tx, gasLimit: 2n, maxFeePerGas: amounts.maxUint256 }, false),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'maxFeePerGas', error: 'gasLimit * maxFeePerGas overflows uint256' },
          ]);
          return true;
        }
      );
      Transaction.prepare(
        {
          ...tx,
          maxFeePerGas: amounts.maxUint64 + 1n,
          maxPriorityFeePerGas: amounts.maxUint64 + 1n,
        },
        false
      );
      throws(
        () => Transaction.prepare({ ...tx, maxFeePerGas: 2n, maxPriorityFeePerGas: 3n }, false),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'maxPriorityFeePerGas', error: 'cannot be bigger than maxFeePerGas=2' },
          ]);
          return true;
        }
      );
      throws(
        () => Transaction.prepare({ ...tx, data: '01', gasLimit: 21000n }),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'gasLimit', error: 'intrinsic gas too low: 21000 < 21016' },
          ]);
          return true;
        }
      );
      deepStrictEqual(Transaction.prepare({ ...tx, data: '01' }).raw.gasLimit, 21016n);
      throws(
        () =>
          Transaction.prepare({
            ...tx,
            gasLimit: 21000n,
            accessList: [
              {
                address: '0x0000000000000000000000000000000000000000',
                storageKeys: ['0x' + '00'.repeat(32)],
              },
            ],
          }),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'gasLimit', error: 'intrinsic gas too low: 21000 < 25300' },
          ]);
          return true;
        }
      );
      deepStrictEqual(
        Transaction.prepare({
          ...tx,
          accessList: [
            {
              address: '0x0000000000000000000000000000000000000000',
              storageKeys: ['0x' + '00'.repeat(32)],
            },
          ],
        }).raw.gasLimit,
        25300n
      );
      const blobTx = {
        type: 'eip4844' as const,
        to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
        nonce: 0n,
        value: 0n,
        maxFeePerGas: weigwei.decode('2'),
        maxFeePerBlobGas: 1n,
        blobVersionedHashes: ['0x01' + '00'.repeat(31)],
      };
      const frozenBlobTx = Transaction.prepare(blobTx);
      deepStrictEqual(Object.isFrozen(frozenBlobTx.raw.blobVersionedHashes), true);
      throws(() => {
        frozenBlobTx.raw.blobVersionedHashes[0] = '0x01' + '11'.repeat(31);
      }, TypeError);
      Transaction.prepare({ ...blobTx, blobVersionedHashes: [] }, false);
      throws(
        () => Transaction.prepare({ ...blobTx, blobVersionedHashes: [] }),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'blobVersionedHashes', error: 'must contain at least one versioned hash' },
          ]);
          return true;
        }
      );
      throws(
        () =>
          Transaction.prepare(
            { ...blobTx, blobVersionedHashes: ['0x00' + '00'.repeat(31)] },
            false
          ),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'blobVersionedHashes', error: 'versioned hash must start with 0x01' },
          ]);
          return true;
        }
      );
      throws(
        () => Transaction.prepare({ ...blobTx, to: '0x', data: '00' }, false),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'to', error: 'eip4844 transaction destination must not be empty' },
          ]);
          return true;
        }
      );
      const sparse: string[] = [];
      sparse.length = 1;
      const inheritedSparse: string[] = [];
      Object.setPrototypeOf(inheritedSparse, { 0: '0x01' + '00'.repeat(31) });
      inheritedSparse.length = 1;
      const inheritedBadSparse: string[] = [];
      Object.setPrototypeOf(inheritedBadSparse, { 0: '0x00' + '00'.repeat(31) });
      inheritedBadSparse.length = 1;
      throws(
        () =>
          validateFields(
            'eip4844',
            {
              chainId: 1n,
              nonce: 0n,
              maxPriorityFeePerGas: 1n,
              maxFeePerGas: 1n,
              gasLimit: 21000n,
              to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
              value: 0n,
              data: '',
              accessList: [],
              maxFeePerBlobGas: 1n,
              blobVersionedHashes: sparse,
            },
            false
          ),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'blobVersionedHashes', error: 'missing array item 0' },
          ]);
          return true;
        }
      );
      throws(
        () =>
          validateFields(
            'eip4844',
            {
              chainId: 1n,
              nonce: 0n,
              maxPriorityFeePerGas: 1n,
              maxFeePerGas: 1n,
              gasLimit: 21000n,
              to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
              value: 0n,
              data: '',
              accessList: [],
              maxFeePerBlobGas: 1n,
              blobVersionedHashes: inheritedSparse,
            },
            false
          ),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'blobVersionedHashes', error: 'missing array item 0' },
          ]);
          return true;
        }
      );
      throws(
        () =>
          validateFields(
            'eip4844',
            {
              chainId: 1n,
              nonce: 0n,
              maxPriorityFeePerGas: 1n,
              maxFeePerGas: 1n,
              gasLimit: 21000n,
              to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
              value: 0n,
              data: '',
              accessList: [],
              maxFeePerBlobGas: 1n,
              blobVersionedHashes: inheritedBadSparse,
            },
            false
          ),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'blobVersionedHashes', error: 'missing array item 0' },
          ]);
          return true;
        }
      );
    });
  });
  it('create contract', () => {
    /*
    Design rationale:
    - 0x addresses allowed only for 'to' field, not for blobs/accessList.
    - we cannot estimateGas without full EVM, since code contains constructor which can do arbitrary calculations
    - solidity exports 'abi' + 'contract creation code' (==initcode).
      - For this example it is 'contract code' with prepended constructor (which actually deploys code):
         60606040526040805190810160405280600d81526020017f57726170706564204574686572000000000000000000000000000000000000008152506000908051906020019061004f9291906100c8565b506040805190810160405280600481526020017f57455448000000000000000000000000000000000000000000000000000000008152506001908051906020019061009b9291906100c8565b506012600260006101000a81548160ff021916908360ff16021790555034156100c357600080fd5b61016d565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061010957805160ff1916838001178555610137565b82800160010185558215610137579182015b8281111561013657825182559160200191906001019061011b565b5b5090506101449190610148565b5090565b61016a91905b8082111561016657600081600090555060010161014e565b5090565b90565b610c348061017c6000396000f300
      - this stuff basically runs constructor code and sets contract code
    - to deploy contract, users need to pass constructor arguments
      - we now have `abi.deployContract(abi, 'bytecode', args);` for this
      - if empty arguments, then 'data' is same as 'initcode'
      - if there arguments for constructor, then data = 'initcode' + abiArgs(constructor)
    - CREATE2/CREATE3 is opcodes and can be used only inside contract
      - not applicable here, but if somebody uses existing 'factory' contract, it would be possible to create contract just by ABI call.
      - example of factory contract (with zksync): https://github.com/matter-labs/era-system-contracts/blob/main/contracts/ContractDeployer.sol
    */
    // https://etherscan.io/tx/0xb95343413e459a0f97461812111254163ae53467855c0d73e0f1e7c5b8442fa3
    const txHex =
      '0xf90e058201be8504e3b292008316e3608080b90db060606040526040805190810160405280600d81526020017f57726170706564204574686572000000000000000000000000000000000000008152506000908051906020019061004f9291906100c8565b506040805190810160405280600481526020017f57455448000000000000000000000000000000000000000000000000000000008152506001908051906020019061009b9291906100c8565b506012600260006101000a81548160ff021916908360ff16021790555034156100c357600080fd5b61016d565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061010957805160ff1916838001178555610137565b82800160010185558215610137579182015b8281111561013657825182559160200191906001019061011b565b5b5090506101449190610148565b5090565b61016a91905b8082111561016657600081600090555060010161014e565b5090565b90565b610c348061017c6000396000f3006060604052600436106100af576000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff16806306fdde03146100b9578063095ea7b31461014757806318160ddd146101a157806323b872dd146101ca5780632e1a7d4d14610243578063313ce5671461026657806370a082311461029557806395d89b41146102e2578063a9059cbb14610370578063d0e30db0146103ca578063dd62ed3e146103d4575b6100b7610440565b005b34156100c457600080fd5b6100cc6104dd565b6040518080602001828103825283818151815260200191508051906020019080838360005b8381101561010c5780820151818401526020810190506100f1565b50505050905090810190601f1680156101395780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b341561015257600080fd5b610187600480803573ffffffffffffffffffffffffffffffffffffffff1690602001909190803590602001909190505061057b565b604051808215151515815260200191505060405180910390f35b34156101ac57600080fd5b6101b461066d565b6040518082815260200191505060405180910390f35b34156101d557600080fd5b610229600480803573ffffffffffffffffffffffffffffffffffffffff1690602001909190803573ffffffffffffffffffffffffffffffffffffffff1690602001909190803590602001909190505061068c565b604051808215151515815260200191505060405180910390f35b341561024e57600080fd5b61026460048080359060200190919050506109d9565b005b341561027157600080fd5b610279610b05565b604051808260ff1660ff16815260200191505060405180910390f35b34156102a057600080fd5b6102cc600480803573ffffffffffffffffffffffffffffffffffffffff16906020019091905050610b18565b6040518082815260200191505060405180910390f35b34156102ed57600080fd5b6102f5610b30565b6040518080602001828103825283818151815260200191508051906020019080838360005b8381101561033557808201518184015260208101905061031a565b50505050905090810190601f1680156103625780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b341561037b57600080fd5b6103b0600480803573ffffffffffffffffffffffffffffffffffffffff16906020019091908035906020019091905050610bce565b604051808215151515815260200191505060405180910390f35b6103d2610440565b005b34156103df57600080fd5b61042a600480803573ffffffffffffffffffffffffffffffffffffffff1690602001909190803573ffffffffffffffffffffffffffffffffffffffff16906020019091905050610be3565b6040518082815260200191505060405180910390f35b34600360003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600082825401925050819055503373ffffffffffffffffffffffffffffffffffffffff167fe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c346040518082815260200191505060405180910390a2565b60008054600181600116156101000203166002900480601f0160208091040260200160405190810160405280929190818152602001828054600181600116156101000203166002900480156105735780601f1061054857610100808354040283529160200191610573565b820191906000526020600020905b81548152906001019060200180831161055657829003601f168201915b505050505081565b600081600460003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060008573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020819055508273ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff167f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925846040518082815260200191505060405180910390a36001905092915050565b60003073ffffffffffffffffffffffffffffffffffffffff1631905090565b600081600360008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002054101515156106dc57600080fd5b3373ffffffffffffffffffffffffffffffffffffffff168473ffffffffffffffffffffffffffffffffffffffff16141580156107b457507fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff600460008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000205414155b156108cf5781600460008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020541015151561084457600080fd5b81600460008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600082825403925050819055505b81600360008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000206000828254039250508190555081600360008573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600082825401925050819055508273ffffffffffffffffffffffffffffffffffffffff168473ffffffffffffffffffffffffffffffffffffffff167fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef846040518082815260200191505060405180910390a3600190509392505050565b80600360003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000205410151515610a2757600080fd5b80600360003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600082825403925050819055503373ffffffffffffffffffffffffffffffffffffffff166108fc829081150290604051600060405180830381858888f193505050501515610ab457600080fd5b3373ffffffffffffffffffffffffffffffffffffffff167f7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65826040518082815260200191505060405180910390a250565b600260009054906101000a900460ff1681565b60036020528060005260406000206000915090505481565b60018054600181600116156101000203166002900480601f016020809104026020016040519081016040528092919081815260200182805460018160011615610100020316600290048015610bc65780601f10610b9b57610100808354040283529160200191610bc6565b820191906000526020600020905b815481529060010190602001808311610ba957829003601f168201915b505050505081565b6000610bdb33848461068c565b905092915050565b60046020528160005260406000206020528060005260406000206000915091505054815600a165627a7a72305820deb4c2ccab3c2fdca32ab3f46728389c2fe2c165d5fafa07661e4e004f6c344a002925a07ce08af79f7a6c1b8b336f50890a80602c4dcd1e3cc5ca131373f0e8ff15e278a0045e183d91f1e8f31e32d333cf6090990c9bf7d35dd00472cfd2d3a63ca8b1a5';

    const fullTx = Transaction.fromHex(txHex);
    deepStrictEqual(fullTx.toHex(), txHex);
    const emptyDeployment = {
      nonce: 0n,
      value: 0n,
      maxFeePerGas: 100n * amounts.GWEI,
      to: '0x',
    };
    for (const data of ['', '0x'])
      throws(
        () => Transaction.prepare({ ...emptyDeployment, data }),
        (err: any) => {
          deepStrictEqual(err.errors, [
            { field: 'to', error: 'Empty address (0x) without contract deployment code' },
          ]);
          return true;
        }
      );
    // Explicit non-strict mode preserves intentional empty-code deployments.
    Transaction.prepare({ ...emptyDeployment, data: '0x' }, false);
    // Normal contract deployment with non-empty initcode remains valid in strict mode.
    Transaction.prepare({ ...emptyDeployment, data: '0x60006000f3' });
    Transaction.prepare(
      {
        type: 'legacy',
        nonce: 0n,
        value: 0n,
        gasLimit: 1500000n,
        gasPrice: 21000000000n,
        to: '0x',
        data: `0x${'00'.repeat(amounts.maxInitDataSize)}`,
      },
      false
    );
    throws(
      () =>
        Transaction.prepare(
          {
            type: 'legacy',
            nonce: 0n,
            value: 0n,
            gasLimit: 1500000n,
            gasPrice: 21000000000n,
            to: '0x',
            data: `0x${'00'.repeat(amounts.maxInitDataSize + 1)}`,
          },
          false
        ),
      (err: any) => {
        deepStrictEqual(err.errors, [{ field: 'data', error: 'initcode is too big: 1048578' }]);
        return true;
      }
    );
    const consPrefix =
      '60606040526040805190810160405280600d81526020017f57726170706564204574686572000000000000000000000000000000000000008152506000908051906020019061004f9291906100c8565b506040805190810160405280600481526020017f57455448000000000000000000000000000000000000000000000000000000008152506001908051906020019061009b9291906100c8565b506012600260006101000a81548160ff021916908360ff16021790555034156100c357600080fd5b61016d565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f1061010957805160ff1916838001178555610137565b82800160010185558215610137579182015b8281111561013657825182559160200191906001019061011b565b5b5090506101449190610148565b5090565b61016a91905b8082111561016657600081600090555060010161014e565b5090565b90565b610c348061017c6000396000f300';
    const actualCode =
      '6060604052600436106100af576000357c0100000000000000000000000000000000000000000000000000000000900463ffffffff16806306fdde03146100b9578063095ea7b31461014757806318160ddd146101a157806323b872dd146101ca5780632e1a7d4d14610243578063313ce5671461026657806370a082311461029557806395d89b41146102e2578063a9059cbb14610370578063d0e30db0146103ca578063dd62ed3e146103d4575b6100b7610440565b005b34156100c457600080fd5b6100cc6104dd565b6040518080602001828103825283818151815260200191508051906020019080838360005b8381101561010c5780820151818401526020810190506100f1565b50505050905090810190601f1680156101395780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b341561015257600080fd5b610187600480803573ffffffffffffffffffffffffffffffffffffffff1690602001909190803590602001909190505061057b565b604051808215151515815260200191505060405180910390f35b34156101ac57600080fd5b6101b461066d565b6040518082815260200191505060405180910390f35b34156101d557600080fd5b610229600480803573ffffffffffffffffffffffffffffffffffffffff1690602001909190803573ffffffffffffffffffffffffffffffffffffffff1690602001909190803590602001909190505061068c565b604051808215151515815260200191505060405180910390f35b341561024e57600080fd5b61026460048080359060200190919050506109d9565b005b341561027157600080fd5b610279610b05565b604051808260ff1660ff16815260200191505060405180910390f35b34156102a057600080fd5b6102cc600480803573ffffffffffffffffffffffffffffffffffffffff16906020019091905050610b18565b6040518082815260200191505060405180910390f35b34156102ed57600080fd5b6102f5610b30565b6040518080602001828103825283818151815260200191508051906020019080838360005b8381101561033557808201518184015260208101905061031a565b50505050905090810190601f1680156103625780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b341561037b57600080fd5b6103b0600480803573ffffffffffffffffffffffffffffffffffffffff16906020019091908035906020019091905050610bce565b604051808215151515815260200191505060405180910390f35b6103d2610440565b005b34156103df57600080fd5b61042a600480803573ffffffffffffffffffffffffffffffffffffffff1690602001909190803573ffffffffffffffffffffffffffffffffffffffff16906020019091905050610be3565b6040518082815260200191505060405180910390f35b34600360003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600082825401925050819055503373ffffffffffffffffffffffffffffffffffffffff167fe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c346040518082815260200191505060405180910390a2565b60008054600181600116156101000203166002900480601f0160208091040260200160405190810160405280929190818152602001828054600181600116156101000203166002900480156105735780601f1061054857610100808354040283529160200191610573565b820191906000526020600020905b81548152906001019060200180831161055657829003601f168201915b505050505081565b600081600460003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060008573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020819055508273ffffffffffffffffffffffffffffffffffffffff163373ffffffffffffffffffffffffffffffffffffffff167f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925846040518082815260200191505060405180910390a36001905092915050565b60003073ffffffffffffffffffffffffffffffffffffffff1631905090565b600081600360008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002054101515156106dc57600080fd5b3373ffffffffffffffffffffffffffffffffffffffff168473ffffffffffffffffffffffffffffffffffffffff16141580156107b457507fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff600460008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000205414155b156108cf5781600460008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020541015151561084457600080fd5b81600460008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600082825403925050819055505b81600360008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000206000828254039250508190555081600360008573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600082825401925050819055508273ffffffffffffffffffffffffffffffffffffffff168473ffffffffffffffffffffffffffffffffffffffff167fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef846040518082815260200191505060405180910390a3600190509392505050565b80600360003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000205410151515610a2757600080fd5b80600360003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600082825403925050819055503373ffffffffffffffffffffffffffffffffffffffff166108fc829081150290604051600060405180830381858888f193505050501515610ab457600080fd5b3373ffffffffffffffffffffffffffffffffffffffff167f7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65826040518082815260200191505060405180910390a250565b600260009054906101000a900460ff1681565b60036020528060005260406000206000915090505481565b60018054600181600116156101000203166002900480601f016020809104026020016040519081016040528092919081815260200182805460018160011615610100020316600290048015610bc65780601f10610b9b57610100808354040283529160200191610bc6565b820191906000526020600020905b815481529060010190602001808311610ba957829003601f168201915b505050505081565b6000610bdb33848461068c565b905092915050565b60046020528160005260406000206020528060005260406000206000915091505054815600a165627a7a72305820deb4c2ccab3c2fdca32ab3f46728389c2fe2c165d5fafa07661e4e004f6c344a0029';
    // Recreate tx same way as user would create from scratch
    const newTx = Transaction.prepare({
      type: 'legacy',
      nonce: 446n,
      to: '0x',
      value: 0n,
      gasLimit: 1500000n,
      gasPrice: 21000000000n,
      data: deployContract(
        [{ type: 'constructor', inputs: [] }],
        `0x${consPrefix}${actualCode}` // NOTE: solidity provides already concatenated initcode
      ),
    });
    // Copy signature since we don't have private key
    const signedNew = new Transaction(
      'legacy',
      {
        ...newTx.raw,
        r: fullTx.raw.r,
        s: fullTx.raw.s,
        yParity: fullTx.raw.yParity,
        chainId: fullTx.raw.chainId,
      },
      { strict: false }
    );
    // Same as real tx
    deepStrictEqual(RawTx.decode(signedNew.toBytes()), RawTx.decode(ethHex.decode(txHex)));
    deepStrictEqual(signedNew.toHex(), txHex);
  });
  it('parse weird TXs without to or data', () => {
    const h =
      '0x02f8540a22830f4240830f453882d221808080c080a0c1bbbdf2a0949ca12d902d41b21cc7ba773ed40b8d1234ee3fbbfb6b8859b3dba064856c2d547c3ef008a0b030d10a5e68afe87f2729dd5677c64b52433be89dd8';
    const tx = Transaction.fromHex(h);
    deepStrictEqual(tx.sender, '0x2871E11949aE3F1b71850D2CB3FF25fBE892EDA6');
    deepStrictEqual(tx.verifySignature(), true);
    deepStrictEqual(tx.toHex(), h);
  });
});

it.runWhen(import.meta.url);
