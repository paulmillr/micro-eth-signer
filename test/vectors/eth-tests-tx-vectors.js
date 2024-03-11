// const files = `
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalue1.json
// ethereum-tests/TransactionTests/ttRSValue/RightVRSTestF0000000c.json
// ethereum-tests/TransactionTests/ttRSValue/RightVRSTestVPrefixedBy0.json
// ethereum-tests/TransactionTests/ttRSValue/RightVRSTestF0000000b.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvaluePrefixed00BigInt.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithRvalueTooHigh.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalue0.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalueLargerThan_c_secp256k1n_x05.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalueEqual_c_secp256k1n_x05.json
// ethereum-tests/TransactionTests/ttRSValue/unpadedRValue.json
// ethereum-tests/TransactionTests/ttRSValue/RightVRSTestF0000000e.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithRSvalue0.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithRSvalue1.json
// ethereum-tests/TransactionTests/ttRSValue/RightVRSTestF0000000d.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalueTooHigh.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithRvalueHigh.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalueLessThan_c_secp256k1n_x05.json
// ethereum-tests/TransactionTests/ttRSValue/RightVRSTestVPrefixedBy0_2.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalueOverflow.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalueHigh.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithRvalue0.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithRvalue1.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithRvalueOverflow.json
// ethereum-tests/TransactionTests/ttRSValue/RightVRSTestVPrefixedBy0_3.json
// ethereum-tests/TransactionTests/ttRSValue/RightVRSTestF0000000f.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithRvaluePrefixed00BigInt.json
// ethereum-tests/TransactionTests/ttRSValue/RightVRSTestF0000000a.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithRvaluePrefixed00.json
// ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvaluePrefixed00.json
// ethereum-tests/TransactionTests/ttAddress/AddressMoreThan20.json
// ethereum-tests/TransactionTests/ttAddress/AddressLessThan20.json
// ethereum-tests/TransactionTests/ttAddress/AddressLessThan20Prefixed0.json
// ethereum-tests/TransactionTests/ttAddress/AddressMoreThan20PrefixedBy0.json
// ethereum-tests/TransactionTests/ttEIP1559/maxFeePerGas00prefix.json
// ethereum-tests/TransactionTests/ttEIP1559/maxPriorityFeePerGasOverflow.json
// ethereum-tests/TransactionTests/ttEIP1559/GasLimitPriceProductOverflowtMinusOne.json
// ethereum-tests/TransactionTests/ttEIP1559/maxFeePerGas32BytesValue.json
// ethereum-tests/TransactionTests/ttEIP1559/GasLimitPriceProductOverflow.json
// ethereum-tests/TransactionTests/ttEIP1559/maxPriorityFeePerGas00prefix.json
// ethereum-tests/TransactionTests/ttEIP1559/maxPriorityFeePerGass32BytesValue.json
// ethereum-tests/TransactionTests/ttEIP1559/GasLimitPriceProductPlusOneOverflow.json
// ethereum-tests/TransactionTests/ttEIP1559/maxFeePerGasOverflow.json
// ethereum-tests/TransactionTests/ttGasPrice/TransactionWithHighGasPrice.json
// ethereum-tests/TransactionTests/ttGasPrice/TransactionWithGasPriceOverflow.json
// ethereum-tests/TransactionTests/ttGasPrice/TransactionWithLeadingZerosGasPrice.json
// ethereum-tests/TransactionTests/ttGasPrice/TransactionWithHighGasPrice2.json
// ethereum-tests/TransactionTests/ttVValue/V_wrongvalue_ffff.json
// ethereum-tests/TransactionTests/ttVValue/WrongVRSTestVEqual29.json
// ethereum-tests/TransactionTests/ttVValue/V_overflow64bitPlus28.json
// ethereum-tests/TransactionTests/ttVValue/V_overflow32bit.json
// ethereum-tests/TransactionTests/ttVValue/V_equals37.json
// ethereum-tests/TransactionTests/ttVValue/ValidChainID1InvalidV0.json
// ethereum-tests/TransactionTests/ttVValue/V_wrongvalue_101.json
// ethereum-tests/TransactionTests/ttVValue/V_overflow32bitSigned.json
// ethereum-tests/TransactionTests/ttVValue/ValidChainID1ValidV0.json
// ethereum-tests/TransactionTests/ttVValue/V_wrongvalue_121.json
// ethereum-tests/TransactionTests/ttVValue/ValidChainID1ValidV1.json
// ethereum-tests/TransactionTests/ttVValue/WrongVRSTestVEqual39.json
// ethereum-tests/TransactionTests/ttVValue/ValidChainID1InvalidV1.json
// ethereum-tests/TransactionTests/ttVValue/ValidChainID1InvalidV00.json
// ethereum-tests/TransactionTests/ttVValue/WrongVRSTestVEqual41.json
// ethereum-tests/TransactionTests/ttVValue/V_wrongvalue_123.json
// ethereum-tests/TransactionTests/ttVValue/WrongVRSTestVEqual36.json
// ethereum-tests/TransactionTests/ttVValue/V_wrongvalue_122.json
// ethereum-tests/TransactionTests/ttVValue/ValidChainID1InvalidV01.json
// ethereum-tests/TransactionTests/ttVValue/WrongVRSTestVEqual26.json
// ethereum-tests/TransactionTests/ttVValue/InvalidChainID0ValidV1.json
// ethereum-tests/TransactionTests/ttVValue/V_overflow64bitPlus27.json
// ethereum-tests/TransactionTests/ttVValue/V_wrongvalue_ff.json
// ethereum-tests/TransactionTests/ttVValue/V_equals38.json
// ethereum-tests/TransactionTests/ttVValue/InvalidChainID0ValidV0.json
// ethereum-tests/TransactionTests/ttVValue/WrongVRSTestVEqual31.json
// ethereum-tests/TransactionTests/ttVValue/V_wrongvalue_124.json
// ethereum-tests/TransactionTests/ttVValue/V_overflow64bitSigned.json
// ethereum-tests/TransactionTests/ttEIP2028/DataTestInsufficientGas2028.json
// ethereum-tests/TransactionTests/ttEIP2028/DataTestSufficientGas2028.json
// ethereum-tests/TransactionTests/ttSignature/EmptyTransaction.json
// ethereum-tests/TransactionTests/ttSignature/ZeroSigTransaction.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_3.json
// ethereum-tests/TransactionTests/ttSignature/WrongVRSTestIncorrectSize.json
// ethereum-tests/TransactionTests/ttSignature/RSsecp256k1.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_16.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_17.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_2.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_5.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_10.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_9.json
// ethereum-tests/TransactionTests/ttSignature/ZeroSigTransaction6.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_8.json
// ethereum-tests/TransactionTests/ttSignature/RightVRSTest.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_11.json
// ethereum-tests/TransactionTests/ttSignature/invalidSignature.json
// ethereum-tests/TransactionTests/ttSignature/WrongVRSTestVOverflow.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_4.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_12.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_7.json
// ethereum-tests/TransactionTests/ttSignature/TransactionWithTooManyRLPElements.json
// ethereum-tests/TransactionTests/ttSignature/ZeroSigTransaction5.json
// ethereum-tests/TransactionTests/ttSignature/PointAtInfinity.json
// ethereum-tests/TransactionTests/ttSignature/libsecp256k1test.json
// ethereum-tests/TransactionTests/ttSignature/ZeroSigTransaction4.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_6.json
// ethereum-tests/TransactionTests/ttSignature/TransactionWithTooFewRLPElements.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_13.json
// ethereum-tests/TransactionTests/ttSignature/ZeroSigTransaction3.json
// ethereum-tests/TransactionTests/ttSignature/SenderTest.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_14.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_1.json
// ethereum-tests/TransactionTests/ttSignature/Vitalik_15.json
// ethereum-tests/TransactionTests/ttSignature/ZeroSigTransaction2.json
// ethereum-tests/TransactionTests/ttNonce/TransactionWithHighNonce64Plus1.json
// ethereum-tests/TransactionTests/ttNonce/TransactionWithHighNonce64Minus2.json
// ethereum-tests/TransactionTests/ttNonce/TransactionWithHighNonce32.json
// ethereum-tests/TransactionTests/ttNonce/TransactionWithHighNonce64.json
// ethereum-tests/TransactionTests/ttNonce/TransactionWithEmptyBigInt.json
// ethereum-tests/TransactionTests/ttNonce/TransactionWithNonceOverflow.json
// ethereum-tests/TransactionTests/ttNonce/TransactionWithZerosBigInt.json
// ethereum-tests/TransactionTests/ttNonce/TransactionWithHighNonce64Minus1.json
// ethereum-tests/TransactionTests/ttNonce/TransactionWithHighNonce256.json
// ethereum-tests/TransactionTests/ttNonce/TransactionWithLeadingZerosNonce.json
// ethereum-tests/TransactionTests/ttData/DataTestZeroBytes.json
// ethereum-tests/TransactionTests/ttData/String10MbData.json
// ethereum-tests/TransactionTests/ttData/DataTestNotEnoughGAS.json
// ethereum-tests/TransactionTests/ttData/DataTestLastZeroBytes.json
// ethereum-tests/TransactionTests/ttData/dataTx_bcValidBlockTestFrontier.json
// ethereum-tests/TransactionTests/ttData/DataTestEnoughGAS.json
// ethereum-tests/TransactionTests/ttData/DataTestFirstZeroBytes.json
// ethereum-tests/TransactionTests/ttData/String10MbDataNotEnoughGAS.json
// ethereum-tests/TransactionTests/ttData/dataTx_bcValidBlockTest.json
// ethereum-tests/TransactionTests/ttEIP3860/DataTestInitCodeTooBig.json
// ethereum-tests/TransactionTests/ttEIP3860/DataTestEnoughGasInitCode.json
// ethereum-tests/TransactionTests/ttEIP3860/DataTestNotEnoughGasInitCode.json
// ethereum-tests/TransactionTests/ttEIP3860/DataTestInitCodeLimit.json
// ethereum-tests/TransactionTests/ttGasLimit/TransactionWithGasLimitOverflow64.json
// ethereum-tests/TransactionTests/ttGasLimit/NotEnoughGasLimit.json
// ethereum-tests/TransactionTests/ttGasLimit/TransactionWithHighGasLimit63.json
// ethereum-tests/TransactionTests/ttGasLimit/TransactionWithHighGasLimit64Minus1.json
// ethereum-tests/TransactionTests/ttGasLimit/TransactionWithHighGasLimit63Plus1.json
// ethereum-tests/TransactionTests/ttGasLimit/TransactionWithGasLimitxPriceOverflow.json
// ethereum-tests/TransactionTests/ttGasLimit/TransactionWithGasLimitOverflow256.json
// ethereum-tests/TransactionTests/ttGasLimit/TransactionWithLeadingZerosGasLimit.json
// ethereum-tests/TransactionTests/ttGasLimit/TransactionWithGasLimitOverflowZeros64.json
// ethereum-tests/TransactionTests/ttGasLimit/TransactionWithHighGasLimit63Minus1.json
// ethereum-tests/TransactionTests/ttEIP2930/accessListStoragePrefix00.json
// ethereum-tests/TransactionTests/ttEIP2930/accessListAddressLessThan20.json
// ethereum-tests/TransactionTests/ttEIP2930/accessListStorage0x0001.json
// ethereum-tests/TransactionTests/ttEIP2930/accessListStorageOver32Bytes.json
// ethereum-tests/TransactionTests/ttEIP2930/accessListAddressGreaterThan20.json
// ethereum-tests/TransactionTests/ttEIP2930/accessListStorage32Bytes.json
// ethereum-tests/TransactionTests/ttEIP2930/accessListAddressPrefix00.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_6.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPIncorrectByteEncoding01.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPHeaderSizeOverflowInt32.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_svalue_Prefixed0000.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_0.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_to_Prefixed0000.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLP_04_maxFeePerGas32BytesValue.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_1.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPIncorrectByteEncoding127.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_to_TooShort.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_rvalue_TooShort.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_7.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPIncorrectByteEncoding00.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_svalue_GivenAsList.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_0.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_HeaderLargerThanRLP_0.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPgasPriceWithFirstZeros.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_6.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_HeaderGivenAsArray_0.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtTheEnd.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_7.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_gasLimit_TooLarge.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_1.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_svalue_TooLarge.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_rvalue_Prefixed0000.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPValueWithFirstZeros.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_8.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPListLengthWithFirstZeros.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPExtraRandomByteAtTheEnd.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLP_09_maxFeePerGas32BytesValue.json
// ethereum-tests/TransactionTests/ttWrongRLP/tr201506052141PYTHON.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_data_GivenAsList.json
// ethereum-tests/TransactionTests/ttWrongRLP/aMaliciousRLP.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_4.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPAddressWrongSize.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPElementIsListWhenItShouldntBe2.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_gasLimit_Prefixed0000.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_rvalue_TooLarge.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_to_TooLarge.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_to_GivenAsList.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_2.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_3.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPArrayLengthWithFirstZeros.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPNonceWithFirstZeros.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPAddressWithFirstZeros.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_5.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_9.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_2.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_4.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_gasLimit_GivenAsList.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_rvalue_GivenAsList.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_8.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_9.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPElementIsListWhenItShouldntBe.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_5.json
// ethereum-tests/TransactionTests/ttWrongRLP/aCrashingRLP.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPTransactionGivenAsArray.json
// ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_3.json
// ethereum-tests/TransactionTests/ttWrongRLP/RLPgasLimitWithFirstZeros.json
// ethereum-tests/TransactionTests/ttValue/TransactionWithHighValue.json
// ethereum-tests/TransactionTests/ttValue/TransactionWithLeadingZerosValue.json
// ethereum-tests/TransactionTests/ttValue/TransactionWithHighValueOverflow.json`
//   .split('\n')
//   .filter((i) => !!i);

// const exp = {};
// for (const f of files) {
//   const [cat, name] = f.split('.json')[0].split('/').slice(-2);
//   const fullName = `${cat}_${name}`;
//   if (!exp[cat]) exp[cat] = {};
//   exp[cat][name] = fullName;
//   console.log(`import { default as ${fullName} } from './${f}' assert { type: 'json' };`);
// }

// for (const i in exp) {
//   const t = Object.entries(exp[i])
//     .map(([n, fn]) => `${n}: ${fn}`)
//     .join(', ');
//   console.log(`export const ${i} = {${t}};`);
// }

// GENERATE: node eth-tests-tx-vectors.js >> eth-tests-tx-vectors.js
import { default as ttRSValue_TransactionWithSvalue1 } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalue1.json' assert { type: 'json' };
import { default as ttRSValue_RightVRSTestF0000000c } from './ethereum-tests/TransactionTests/ttRSValue/RightVRSTestF0000000c.json' assert { type: 'json' };
import { default as ttRSValue_RightVRSTestVPrefixedBy0 } from './ethereum-tests/TransactionTests/ttRSValue/RightVRSTestVPrefixedBy0.json' assert { type: 'json' };
import { default as ttRSValue_RightVRSTestF0000000b } from './ethereum-tests/TransactionTests/ttRSValue/RightVRSTestF0000000b.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithSvaluePrefixed00BigInt } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvaluePrefixed00BigInt.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithRvalueTooHigh } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithRvalueTooHigh.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithSvalue0 } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalue0.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithSvalueLargerThan_c_secp256k1n_x05 } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalueLargerThan_c_secp256k1n_x05.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithSvalueEqual_c_secp256k1n_x05 } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalueEqual_c_secp256k1n_x05.json' assert { type: 'json' };
import { default as ttRSValue_unpadedRValue } from './ethereum-tests/TransactionTests/ttRSValue/unpadedRValue.json' assert { type: 'json' };
import { default as ttRSValue_RightVRSTestF0000000e } from './ethereum-tests/TransactionTests/ttRSValue/RightVRSTestF0000000e.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithRSvalue0 } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithRSvalue0.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithRSvalue1 } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithRSvalue1.json' assert { type: 'json' };
import { default as ttRSValue_RightVRSTestF0000000d } from './ethereum-tests/TransactionTests/ttRSValue/RightVRSTestF0000000d.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithSvalueTooHigh } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalueTooHigh.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithRvalueHigh } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithRvalueHigh.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithSvalueLessThan_c_secp256k1n_x05 } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalueLessThan_c_secp256k1n_x05.json' assert { type: 'json' };
import { default as ttRSValue_RightVRSTestVPrefixedBy0_2 } from './ethereum-tests/TransactionTests/ttRSValue/RightVRSTestVPrefixedBy0_2.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithSvalueOverflow } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalueOverflow.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithSvalueHigh } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvalueHigh.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithRvalue0 } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithRvalue0.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithRvalue1 } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithRvalue1.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithRvalueOverflow } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithRvalueOverflow.json' assert { type: 'json' };
import { default as ttRSValue_RightVRSTestVPrefixedBy0_3 } from './ethereum-tests/TransactionTests/ttRSValue/RightVRSTestVPrefixedBy0_3.json' assert { type: 'json' };
import { default as ttRSValue_RightVRSTestF0000000f } from './ethereum-tests/TransactionTests/ttRSValue/RightVRSTestF0000000f.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithRvaluePrefixed00BigInt } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithRvaluePrefixed00BigInt.json' assert { type: 'json' };
import { default as ttRSValue_RightVRSTestF0000000a } from './ethereum-tests/TransactionTests/ttRSValue/RightVRSTestF0000000a.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithRvaluePrefixed00 } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithRvaluePrefixed00.json' assert { type: 'json' };
import { default as ttRSValue_TransactionWithSvaluePrefixed00 } from './ethereum-tests/TransactionTests/ttRSValue/TransactionWithSvaluePrefixed00.json' assert { type: 'json' };
import { default as ttAddress_AddressMoreThan20 } from './ethereum-tests/TransactionTests/ttAddress/AddressMoreThan20.json' assert { type: 'json' };
import { default as ttAddress_AddressLessThan20 } from './ethereum-tests/TransactionTests/ttAddress/AddressLessThan20.json' assert { type: 'json' };
import { default as ttAddress_AddressLessThan20Prefixed0 } from './ethereum-tests/TransactionTests/ttAddress/AddressLessThan20Prefixed0.json' assert { type: 'json' };
import { default as ttAddress_AddressMoreThan20PrefixedBy0 } from './ethereum-tests/TransactionTests/ttAddress/AddressMoreThan20PrefixedBy0.json' assert { type: 'json' };
import { default as ttEIP1559_maxFeePerGas00prefix } from './ethereum-tests/TransactionTests/ttEIP1559/maxFeePerGas00prefix.json' assert { type: 'json' };
import { default as ttEIP1559_maxPriorityFeePerGasOverflow } from './ethereum-tests/TransactionTests/ttEIP1559/maxPriorityFeePerGasOverflow.json' assert { type: 'json' };
import { default as ttEIP1559_GasLimitPriceProductOverflowtMinusOne } from './ethereum-tests/TransactionTests/ttEIP1559/GasLimitPriceProductOverflowtMinusOne.json' assert { type: 'json' };
import { default as ttEIP1559_maxFeePerGas32BytesValue } from './ethereum-tests/TransactionTests/ttEIP1559/maxFeePerGas32BytesValue.json' assert { type: 'json' };
import { default as ttEIP1559_GasLimitPriceProductOverflow } from './ethereum-tests/TransactionTests/ttEIP1559/GasLimitPriceProductOverflow.json' assert { type: 'json' };
import { default as ttEIP1559_maxPriorityFeePerGas00prefix } from './ethereum-tests/TransactionTests/ttEIP1559/maxPriorityFeePerGas00prefix.json' assert { type: 'json' };
import { default as ttEIP1559_maxPriorityFeePerGass32BytesValue } from './ethereum-tests/TransactionTests/ttEIP1559/maxPriorityFeePerGass32BytesValue.json' assert { type: 'json' };
import { default as ttEIP1559_GasLimitPriceProductPlusOneOverflow } from './ethereum-tests/TransactionTests/ttEIP1559/GasLimitPriceProductPlusOneOverflow.json' assert { type: 'json' };
import { default as ttEIP1559_maxFeePerGasOverflow } from './ethereum-tests/TransactionTests/ttEIP1559/maxFeePerGasOverflow.json' assert { type: 'json' };
import { default as ttGasPrice_TransactionWithHighGasPrice } from './ethereum-tests/TransactionTests/ttGasPrice/TransactionWithHighGasPrice.json' assert { type: 'json' };
import { default as ttGasPrice_TransactionWithGasPriceOverflow } from './ethereum-tests/TransactionTests/ttGasPrice/TransactionWithGasPriceOverflow.json' assert { type: 'json' };
import { default as ttGasPrice_TransactionWithLeadingZerosGasPrice } from './ethereum-tests/TransactionTests/ttGasPrice/TransactionWithLeadingZerosGasPrice.json' assert { type: 'json' };
import { default as ttGasPrice_TransactionWithHighGasPrice2 } from './ethereum-tests/TransactionTests/ttGasPrice/TransactionWithHighGasPrice2.json' assert { type: 'json' };
import { default as ttVValue_V_wrongvalue_ffff } from './ethereum-tests/TransactionTests/ttVValue/V_wrongvalue_ffff.json' assert { type: 'json' };
import { default as ttVValue_WrongVRSTestVEqual29 } from './ethereum-tests/TransactionTests/ttVValue/WrongVRSTestVEqual29.json' assert { type: 'json' };
import { default as ttVValue_V_overflow64bitPlus28 } from './ethereum-tests/TransactionTests/ttVValue/V_overflow64bitPlus28.json' assert { type: 'json' };
import { default as ttVValue_V_overflow32bit } from './ethereum-tests/TransactionTests/ttVValue/V_overflow32bit.json' assert { type: 'json' };
import { default as ttVValue_V_equals37 } from './ethereum-tests/TransactionTests/ttVValue/V_equals37.json' assert { type: 'json' };
import { default as ttVValue_ValidChainID1InvalidV0 } from './ethereum-tests/TransactionTests/ttVValue/ValidChainID1InvalidV0.json' assert { type: 'json' };
import { default as ttVValue_V_wrongvalue_101 } from './ethereum-tests/TransactionTests/ttVValue/V_wrongvalue_101.json' assert { type: 'json' };
import { default as ttVValue_V_overflow32bitSigned } from './ethereum-tests/TransactionTests/ttVValue/V_overflow32bitSigned.json' assert { type: 'json' };
import { default as ttVValue_ValidChainID1ValidV0 } from './ethereum-tests/TransactionTests/ttVValue/ValidChainID1ValidV0.json' assert { type: 'json' };
import { default as ttVValue_V_wrongvalue_121 } from './ethereum-tests/TransactionTests/ttVValue/V_wrongvalue_121.json' assert { type: 'json' };
import { default as ttVValue_ValidChainID1ValidV1 } from './ethereum-tests/TransactionTests/ttVValue/ValidChainID1ValidV1.json' assert { type: 'json' };
import { default as ttVValue_WrongVRSTestVEqual39 } from './ethereum-tests/TransactionTests/ttVValue/WrongVRSTestVEqual39.json' assert { type: 'json' };
import { default as ttVValue_ValidChainID1InvalidV1 } from './ethereum-tests/TransactionTests/ttVValue/ValidChainID1InvalidV1.json' assert { type: 'json' };
import { default as ttVValue_ValidChainID1InvalidV00 } from './ethereum-tests/TransactionTests/ttVValue/ValidChainID1InvalidV00.json' assert { type: 'json' };
import { default as ttVValue_WrongVRSTestVEqual41 } from './ethereum-tests/TransactionTests/ttVValue/WrongVRSTestVEqual41.json' assert { type: 'json' };
import { default as ttVValue_V_wrongvalue_123 } from './ethereum-tests/TransactionTests/ttVValue/V_wrongvalue_123.json' assert { type: 'json' };
import { default as ttVValue_WrongVRSTestVEqual36 } from './ethereum-tests/TransactionTests/ttVValue/WrongVRSTestVEqual36.json' assert { type: 'json' };
import { default as ttVValue_V_wrongvalue_122 } from './ethereum-tests/TransactionTests/ttVValue/V_wrongvalue_122.json' assert { type: 'json' };
import { default as ttVValue_ValidChainID1InvalidV01 } from './ethereum-tests/TransactionTests/ttVValue/ValidChainID1InvalidV01.json' assert { type: 'json' };
import { default as ttVValue_WrongVRSTestVEqual26 } from './ethereum-tests/TransactionTests/ttVValue/WrongVRSTestVEqual26.json' assert { type: 'json' };
import { default as ttVValue_InvalidChainID0ValidV1 } from './ethereum-tests/TransactionTests/ttVValue/InvalidChainID0ValidV1.json' assert { type: 'json' };
import { default as ttVValue_V_overflow64bitPlus27 } from './ethereum-tests/TransactionTests/ttVValue/V_overflow64bitPlus27.json' assert { type: 'json' };
import { default as ttVValue_V_wrongvalue_ff } from './ethereum-tests/TransactionTests/ttVValue/V_wrongvalue_ff.json' assert { type: 'json' };
import { default as ttVValue_V_equals38 } from './ethereum-tests/TransactionTests/ttVValue/V_equals38.json' assert { type: 'json' };
import { default as ttVValue_InvalidChainID0ValidV0 } from './ethereum-tests/TransactionTests/ttVValue/InvalidChainID0ValidV0.json' assert { type: 'json' };
import { default as ttVValue_WrongVRSTestVEqual31 } from './ethereum-tests/TransactionTests/ttVValue/WrongVRSTestVEqual31.json' assert { type: 'json' };
import { default as ttVValue_V_wrongvalue_124 } from './ethereum-tests/TransactionTests/ttVValue/V_wrongvalue_124.json' assert { type: 'json' };
import { default as ttVValue_V_overflow64bitSigned } from './ethereum-tests/TransactionTests/ttVValue/V_overflow64bitSigned.json' assert { type: 'json' };
import { default as ttEIP2028_DataTestInsufficientGas2028 } from './ethereum-tests/TransactionTests/ttEIP2028/DataTestInsufficientGas2028.json' assert { type: 'json' };
import { default as ttEIP2028_DataTestSufficientGas2028 } from './ethereum-tests/TransactionTests/ttEIP2028/DataTestSufficientGas2028.json' assert { type: 'json' };
import { default as ttSignature_EmptyTransaction } from './ethereum-tests/TransactionTests/ttSignature/EmptyTransaction.json' assert { type: 'json' };
import { default as ttSignature_ZeroSigTransaction } from './ethereum-tests/TransactionTests/ttSignature/ZeroSigTransaction.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_3 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_3.json' assert { type: 'json' };
import { default as ttSignature_WrongVRSTestIncorrectSize } from './ethereum-tests/TransactionTests/ttSignature/WrongVRSTestIncorrectSize.json' assert { type: 'json' };
import { default as ttSignature_RSsecp256k1 } from './ethereum-tests/TransactionTests/ttSignature/RSsecp256k1.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_16 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_16.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_17 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_17.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_2 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_2.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_5 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_5.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_10 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_10.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_9 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_9.json' assert { type: 'json' };
import { default as ttSignature_ZeroSigTransaction6 } from './ethereum-tests/TransactionTests/ttSignature/ZeroSigTransaction6.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_8 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_8.json' assert { type: 'json' };
import { default as ttSignature_RightVRSTest } from './ethereum-tests/TransactionTests/ttSignature/RightVRSTest.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_11 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_11.json' assert { type: 'json' };
import { default as ttSignature_invalidSignature } from './ethereum-tests/TransactionTests/ttSignature/invalidSignature.json' assert { type: 'json' };
import { default as ttSignature_WrongVRSTestVOverflow } from './ethereum-tests/TransactionTests/ttSignature/WrongVRSTestVOverflow.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_4 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_4.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_12 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_12.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_7 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_7.json' assert { type: 'json' };
import { default as ttSignature_TransactionWithTooManyRLPElements } from './ethereum-tests/TransactionTests/ttSignature/TransactionWithTooManyRLPElements.json' assert { type: 'json' };
import { default as ttSignature_ZeroSigTransaction5 } from './ethereum-tests/TransactionTests/ttSignature/ZeroSigTransaction5.json' assert { type: 'json' };
import { default as ttSignature_PointAtInfinity } from './ethereum-tests/TransactionTests/ttSignature/PointAtInfinity.json' assert { type: 'json' };
import { default as ttSignature_libsecp256k1test } from './ethereum-tests/TransactionTests/ttSignature/libsecp256k1test.json' assert { type: 'json' };
import { default as ttSignature_ZeroSigTransaction4 } from './ethereum-tests/TransactionTests/ttSignature/ZeroSigTransaction4.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_6 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_6.json' assert { type: 'json' };
import { default as ttSignature_TransactionWithTooFewRLPElements } from './ethereum-tests/TransactionTests/ttSignature/TransactionWithTooFewRLPElements.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_13 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_13.json' assert { type: 'json' };
import { default as ttSignature_ZeroSigTransaction3 } from './ethereum-tests/TransactionTests/ttSignature/ZeroSigTransaction3.json' assert { type: 'json' };
import { default as ttSignature_SenderTest } from './ethereum-tests/TransactionTests/ttSignature/SenderTest.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_14 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_14.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_1 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_1.json' assert { type: 'json' };
import { default as ttSignature_Vitalik_15 } from './ethereum-tests/TransactionTests/ttSignature/Vitalik_15.json' assert { type: 'json' };
import { default as ttSignature_ZeroSigTransaction2 } from './ethereum-tests/TransactionTests/ttSignature/ZeroSigTransaction2.json' assert { type: 'json' };
import { default as ttNonce_TransactionWithHighNonce64Plus1 } from './ethereum-tests/TransactionTests/ttNonce/TransactionWithHighNonce64Plus1.json' assert { type: 'json' };
import { default as ttNonce_TransactionWithHighNonce64Minus2 } from './ethereum-tests/TransactionTests/ttNonce/TransactionWithHighNonce64Minus2.json' assert { type: 'json' };
import { default as ttNonce_TransactionWithHighNonce32 } from './ethereum-tests/TransactionTests/ttNonce/TransactionWithHighNonce32.json' assert { type: 'json' };
import { default as ttNonce_TransactionWithHighNonce64 } from './ethereum-tests/TransactionTests/ttNonce/TransactionWithHighNonce64.json' assert { type: 'json' };
import { default as ttNonce_TransactionWithEmptyBigInt } from './ethereum-tests/TransactionTests/ttNonce/TransactionWithEmptyBigInt.json' assert { type: 'json' };
import { default as ttNonce_TransactionWithNonceOverflow } from './ethereum-tests/TransactionTests/ttNonce/TransactionWithNonceOverflow.json' assert { type: 'json' };
import { default as ttNonce_TransactionWithZerosBigInt } from './ethereum-tests/TransactionTests/ttNonce/TransactionWithZerosBigInt.json' assert { type: 'json' };
import { default as ttNonce_TransactionWithHighNonce64Minus1 } from './ethereum-tests/TransactionTests/ttNonce/TransactionWithHighNonce64Minus1.json' assert { type: 'json' };
import { default as ttNonce_TransactionWithHighNonce256 } from './ethereum-tests/TransactionTests/ttNonce/TransactionWithHighNonce256.json' assert { type: 'json' };
import { default as ttNonce_TransactionWithLeadingZerosNonce } from './ethereum-tests/TransactionTests/ttNonce/TransactionWithLeadingZerosNonce.json' assert { type: 'json' };
import { default as ttData_DataTestZeroBytes } from './ethereum-tests/TransactionTests/ttData/DataTestZeroBytes.json' assert { type: 'json' };
import { default as ttData_String10MbData } from './ethereum-tests/TransactionTests/ttData/String10MbData.json' assert { type: 'json' };
import { default as ttData_DataTestNotEnoughGAS } from './ethereum-tests/TransactionTests/ttData/DataTestNotEnoughGAS.json' assert { type: 'json' };
import { default as ttData_DataTestLastZeroBytes } from './ethereum-tests/TransactionTests/ttData/DataTestLastZeroBytes.json' assert { type: 'json' };
import { default as ttData_dataTx_bcValidBlockTestFrontier } from './ethereum-tests/TransactionTests/ttData/dataTx_bcValidBlockTestFrontier.json' assert { type: 'json' };
import { default as ttData_DataTestEnoughGAS } from './ethereum-tests/TransactionTests/ttData/DataTestEnoughGAS.json' assert { type: 'json' };
import { default as ttData_DataTestFirstZeroBytes } from './ethereum-tests/TransactionTests/ttData/DataTestFirstZeroBytes.json' assert { type: 'json' };
import { default as ttData_String10MbDataNotEnoughGAS } from './ethereum-tests/TransactionTests/ttData/String10MbDataNotEnoughGAS.json' assert { type: 'json' };
import { default as ttData_dataTx_bcValidBlockTest } from './ethereum-tests/TransactionTests/ttData/dataTx_bcValidBlockTest.json' assert { type: 'json' };
import { default as ttEIP3860_DataTestInitCodeTooBig } from './ethereum-tests/TransactionTests/ttEIP3860/DataTestInitCodeTooBig.json' assert { type: 'json' };
import { default as ttEIP3860_DataTestEnoughGasInitCode } from './ethereum-tests/TransactionTests/ttEIP3860/DataTestEnoughGasInitCode.json' assert { type: 'json' };
import { default as ttEIP3860_DataTestNotEnoughGasInitCode } from './ethereum-tests/TransactionTests/ttEIP3860/DataTestNotEnoughGasInitCode.json' assert { type: 'json' };
import { default as ttEIP3860_DataTestInitCodeLimit } from './ethereum-tests/TransactionTests/ttEIP3860/DataTestInitCodeLimit.json' assert { type: 'json' };
import { default as ttGasLimit_TransactionWithGasLimitOverflow64 } from './ethereum-tests/TransactionTests/ttGasLimit/TransactionWithGasLimitOverflow64.json' assert { type: 'json' };
import { default as ttGasLimit_NotEnoughGasLimit } from './ethereum-tests/TransactionTests/ttGasLimit/NotEnoughGasLimit.json' assert { type: 'json' };
import { default as ttGasLimit_TransactionWithHighGasLimit63 } from './ethereum-tests/TransactionTests/ttGasLimit/TransactionWithHighGasLimit63.json' assert { type: 'json' };
import { default as ttGasLimit_TransactionWithHighGasLimit64Minus1 } from './ethereum-tests/TransactionTests/ttGasLimit/TransactionWithHighGasLimit64Minus1.json' assert { type: 'json' };
import { default as ttGasLimit_TransactionWithHighGasLimit63Plus1 } from './ethereum-tests/TransactionTests/ttGasLimit/TransactionWithHighGasLimit63Plus1.json' assert { type: 'json' };
import { default as ttGasLimit_TransactionWithGasLimitxPriceOverflow } from './ethereum-tests/TransactionTests/ttGasLimit/TransactionWithGasLimitxPriceOverflow.json' assert { type: 'json' };
import { default as ttGasLimit_TransactionWithGasLimitOverflow256 } from './ethereum-tests/TransactionTests/ttGasLimit/TransactionWithGasLimitOverflow256.json' assert { type: 'json' };
import { default as ttGasLimit_TransactionWithLeadingZerosGasLimit } from './ethereum-tests/TransactionTests/ttGasLimit/TransactionWithLeadingZerosGasLimit.json' assert { type: 'json' };
import { default as ttGasLimit_TransactionWithGasLimitOverflowZeros64 } from './ethereum-tests/TransactionTests/ttGasLimit/TransactionWithGasLimitOverflowZeros64.json' assert { type: 'json' };
import { default as ttGasLimit_TransactionWithHighGasLimit63Minus1 } from './ethereum-tests/TransactionTests/ttGasLimit/TransactionWithHighGasLimit63Minus1.json' assert { type: 'json' };
import { default as ttEIP2930_accessListStoragePrefix00 } from './ethereum-tests/TransactionTests/ttEIP2930/accessListStoragePrefix00.json' assert { type: 'json' };
import { default as ttEIP2930_accessListAddressLessThan20 } from './ethereum-tests/TransactionTests/ttEIP2930/accessListAddressLessThan20.json' assert { type: 'json' };
import { default as ttEIP2930_accessListStorage0x0001 } from './ethereum-tests/TransactionTests/ttEIP2930/accessListStorage0x0001.json' assert { type: 'json' };
import { default as ttEIP2930_accessListStorageOver32Bytes } from './ethereum-tests/TransactionTests/ttEIP2930/accessListStorageOver32Bytes.json' assert { type: 'json' };
import { default as ttEIP2930_accessListAddressGreaterThan20 } from './ethereum-tests/TransactionTests/ttEIP2930/accessListAddressGreaterThan20.json' assert { type: 'json' };
import { default as ttEIP2930_accessListStorage32Bytes } from './ethereum-tests/TransactionTests/ttEIP2930/accessListStorage32Bytes.json' assert { type: 'json' };
import { default as ttEIP2930_accessListAddressPrefix00 } from './ethereum-tests/TransactionTests/ttEIP2930/accessListAddressPrefix00.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__ZeroByteAtRLP_6 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_6.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPIncorrectByteEncoding01 } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPIncorrectByteEncoding01.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPHeaderSizeOverflowInt32 } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPHeaderSizeOverflowInt32.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_svalue_Prefixed0000 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_svalue_Prefixed0000.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__RandomByteAtRLP_0 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_0.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_to_Prefixed0000 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_to_Prefixed0000.json' assert { type: 'json' };
import { default as ttWrongRLP_RLP_04_maxFeePerGas32BytesValue } from './ethereum-tests/TransactionTests/ttWrongRLP/RLP_04_maxFeePerGas32BytesValue.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__RandomByteAtRLP_1 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_1.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPIncorrectByteEncoding127 } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPIncorrectByteEncoding127.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_to_TooShort } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_to_TooShort.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_rvalue_TooShort } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_rvalue_TooShort.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__ZeroByteAtRLP_7 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_7.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPIncorrectByteEncoding00 } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPIncorrectByteEncoding00.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_svalue_GivenAsList } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_svalue_GivenAsList.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__ZeroByteAtRLP_0 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_0.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_HeaderLargerThanRLP_0 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_HeaderLargerThanRLP_0.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPgasPriceWithFirstZeros } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPgasPriceWithFirstZeros.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__RandomByteAtRLP_6 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_6.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_HeaderGivenAsArray_0 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_HeaderGivenAsArray_0.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__RandomByteAtTheEnd } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtTheEnd.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__RandomByteAtRLP_7 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_7.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_gasLimit_TooLarge } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_gasLimit_TooLarge.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__ZeroByteAtRLP_1 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_1.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_svalue_TooLarge } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_svalue_TooLarge.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_rvalue_Prefixed0000 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_rvalue_Prefixed0000.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPValueWithFirstZeros } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPValueWithFirstZeros.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__RandomByteAtRLP_8 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_8.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPListLengthWithFirstZeros } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPListLengthWithFirstZeros.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPExtraRandomByteAtTheEnd } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPExtraRandomByteAtTheEnd.json' assert { type: 'json' };
import { default as ttWrongRLP_RLP_09_maxFeePerGas32BytesValue } from './ethereum-tests/TransactionTests/ttWrongRLP/RLP_09_maxFeePerGas32BytesValue.json' assert { type: 'json' };
import { default as ttWrongRLP_tr201506052141PYTHON } from './ethereum-tests/TransactionTests/ttWrongRLP/tr201506052141PYTHON.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_data_GivenAsList } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_data_GivenAsList.json' assert { type: 'json' };
import { default as ttWrongRLP_aMaliciousRLP } from './ethereum-tests/TransactionTests/ttWrongRLP/aMaliciousRLP.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__RandomByteAtRLP_4 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_4.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPAddressWrongSize } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPAddressWrongSize.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPElementIsListWhenItShouldntBe2 } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPElementIsListWhenItShouldntBe2.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_gasLimit_Prefixed0000 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_gasLimit_Prefixed0000.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_rvalue_TooLarge } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_rvalue_TooLarge.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_to_TooLarge } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_to_TooLarge.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_to_GivenAsList } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_to_GivenAsList.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__ZeroByteAtRLP_2 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_2.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__ZeroByteAtRLP_3 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_3.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPArrayLengthWithFirstZeros } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPArrayLengthWithFirstZeros.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPNonceWithFirstZeros } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPNonceWithFirstZeros.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPAddressWithFirstZeros } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPAddressWithFirstZeros.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__RandomByteAtRLP_5 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_5.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__RandomByteAtRLP_9 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_9.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__RandomByteAtRLP_2 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_2.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__ZeroByteAtRLP_4 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_4.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_gasLimit_GivenAsList } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_gasLimit_GivenAsList.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT_rvalue_GivenAsList } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT_rvalue_GivenAsList.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__ZeroByteAtRLP_8 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_8.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__ZeroByteAtRLP_9 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_9.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPElementIsListWhenItShouldntBe } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPElementIsListWhenItShouldntBe.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__ZeroByteAtRLP_5 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__ZeroByteAtRLP_5.json' assert { type: 'json' };
import { default as ttWrongRLP_aCrashingRLP } from './ethereum-tests/TransactionTests/ttWrongRLP/aCrashingRLP.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPTransactionGivenAsArray } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPTransactionGivenAsArray.json' assert { type: 'json' };
import { default as ttWrongRLP_TRANSCT__RandomByteAtRLP_3 } from './ethereum-tests/TransactionTests/ttWrongRLP/TRANSCT__RandomByteAtRLP_3.json' assert { type: 'json' };
import { default as ttWrongRLP_RLPgasLimitWithFirstZeros } from './ethereum-tests/TransactionTests/ttWrongRLP/RLPgasLimitWithFirstZeros.json' assert { type: 'json' };
import { default as ttValue_TransactionWithHighValue } from './ethereum-tests/TransactionTests/ttValue/TransactionWithHighValue.json' assert { type: 'json' };
import { default as ttValue_TransactionWithLeadingZerosValue } from './ethereum-tests/TransactionTests/ttValue/TransactionWithLeadingZerosValue.json' assert { type: 'json' };
import { default as ttValue_TransactionWithHighValueOverflow } from './ethereum-tests/TransactionTests/ttValue/TransactionWithHighValueOverflow.json' assert { type: 'json' };
export const ttRSValue = {
  TransactionWithSvalue1: ttRSValue_TransactionWithSvalue1,
  RightVRSTestF0000000c: ttRSValue_RightVRSTestF0000000c,
  RightVRSTestVPrefixedBy0: ttRSValue_RightVRSTestVPrefixedBy0,
  RightVRSTestF0000000b: ttRSValue_RightVRSTestF0000000b,
  TransactionWithSvaluePrefixed00BigInt: ttRSValue_TransactionWithSvaluePrefixed00BigInt,
  TransactionWithRvalueTooHigh: ttRSValue_TransactionWithRvalueTooHigh,
  TransactionWithSvalue0: ttRSValue_TransactionWithSvalue0,
  TransactionWithSvalueLargerThan_c_secp256k1n_x05:
    ttRSValue_TransactionWithSvalueLargerThan_c_secp256k1n_x05,
  TransactionWithSvalueEqual_c_secp256k1n_x05:
    ttRSValue_TransactionWithSvalueEqual_c_secp256k1n_x05,
  unpadedRValue: ttRSValue_unpadedRValue,
  RightVRSTestF0000000e: ttRSValue_RightVRSTestF0000000e,
  TransactionWithRSvalue0: ttRSValue_TransactionWithRSvalue0,
  TransactionWithRSvalue1: ttRSValue_TransactionWithRSvalue1,
  RightVRSTestF0000000d: ttRSValue_RightVRSTestF0000000d,
  TransactionWithSvalueTooHigh: ttRSValue_TransactionWithSvalueTooHigh,
  TransactionWithRvalueHigh: ttRSValue_TransactionWithRvalueHigh,
  TransactionWithSvalueLessThan_c_secp256k1n_x05:
    ttRSValue_TransactionWithSvalueLessThan_c_secp256k1n_x05,
  RightVRSTestVPrefixedBy0_2: ttRSValue_RightVRSTestVPrefixedBy0_2,
  TransactionWithSvalueOverflow: ttRSValue_TransactionWithSvalueOverflow,
  TransactionWithSvalueHigh: ttRSValue_TransactionWithSvalueHigh,
  TransactionWithRvalue0: ttRSValue_TransactionWithRvalue0,
  TransactionWithRvalue1: ttRSValue_TransactionWithRvalue1,
  TransactionWithRvalueOverflow: ttRSValue_TransactionWithRvalueOverflow,
  RightVRSTestVPrefixedBy0_3: ttRSValue_RightVRSTestVPrefixedBy0_3,
  RightVRSTestF0000000f: ttRSValue_RightVRSTestF0000000f,
  TransactionWithRvaluePrefixed00BigInt: ttRSValue_TransactionWithRvaluePrefixed00BigInt,
  RightVRSTestF0000000a: ttRSValue_RightVRSTestF0000000a,
  TransactionWithRvaluePrefixed00: ttRSValue_TransactionWithRvaluePrefixed00,
  TransactionWithSvaluePrefixed00: ttRSValue_TransactionWithSvaluePrefixed00,
};
export const ttAddress = {
  AddressMoreThan20: ttAddress_AddressMoreThan20,
  AddressLessThan20: ttAddress_AddressLessThan20,
  AddressLessThan20Prefixed0: ttAddress_AddressLessThan20Prefixed0,
  AddressMoreThan20PrefixedBy0: ttAddress_AddressMoreThan20PrefixedBy0,
};
export const ttEIP1559 = {
  maxFeePerGas00prefix: ttEIP1559_maxFeePerGas00prefix,
  maxPriorityFeePerGasOverflow: ttEIP1559_maxPriorityFeePerGasOverflow,
  GasLimitPriceProductOverflowtMinusOne: ttEIP1559_GasLimitPriceProductOverflowtMinusOne,
  maxFeePerGas32BytesValue: ttEIP1559_maxFeePerGas32BytesValue,
  GasLimitPriceProductOverflow: ttEIP1559_GasLimitPriceProductOverflow,
  maxPriorityFeePerGas00prefix: ttEIP1559_maxPriorityFeePerGas00prefix,
  maxPriorityFeePerGass32BytesValue: ttEIP1559_maxPriorityFeePerGass32BytesValue,
  GasLimitPriceProductPlusOneOverflow: ttEIP1559_GasLimitPriceProductPlusOneOverflow,
  maxFeePerGasOverflow: ttEIP1559_maxFeePerGasOverflow,
};
export const ttGasPrice = {
  TransactionWithHighGasPrice: ttGasPrice_TransactionWithHighGasPrice,
  TransactionWithGasPriceOverflow: ttGasPrice_TransactionWithGasPriceOverflow,
  TransactionWithLeadingZerosGasPrice: ttGasPrice_TransactionWithLeadingZerosGasPrice,
  TransactionWithHighGasPrice2: ttGasPrice_TransactionWithHighGasPrice2,
};
export const ttVValue = {
  V_wrongvalue_ffff: ttVValue_V_wrongvalue_ffff,
  WrongVRSTestVEqual29: ttVValue_WrongVRSTestVEqual29,
  V_overflow64bitPlus28: ttVValue_V_overflow64bitPlus28,
  V_overflow32bit: ttVValue_V_overflow32bit,
  V_equals37: ttVValue_V_equals37,
  ValidChainID1InvalidV0: ttVValue_ValidChainID1InvalidV0,
  V_wrongvalue_101: ttVValue_V_wrongvalue_101,
  V_overflow32bitSigned: ttVValue_V_overflow32bitSigned,
  ValidChainID1ValidV0: ttVValue_ValidChainID1ValidV0,
  V_wrongvalue_121: ttVValue_V_wrongvalue_121,
  ValidChainID1ValidV1: ttVValue_ValidChainID1ValidV1,
  WrongVRSTestVEqual39: ttVValue_WrongVRSTestVEqual39,
  ValidChainID1InvalidV1: ttVValue_ValidChainID1InvalidV1,
  ValidChainID1InvalidV00: ttVValue_ValidChainID1InvalidV00,
  WrongVRSTestVEqual41: ttVValue_WrongVRSTestVEqual41,
  V_wrongvalue_123: ttVValue_V_wrongvalue_123,
  WrongVRSTestVEqual36: ttVValue_WrongVRSTestVEqual36,
  V_wrongvalue_122: ttVValue_V_wrongvalue_122,
  ValidChainID1InvalidV01: ttVValue_ValidChainID1InvalidV01,
  WrongVRSTestVEqual26: ttVValue_WrongVRSTestVEqual26,
  InvalidChainID0ValidV1: ttVValue_InvalidChainID0ValidV1,
  V_overflow64bitPlus27: ttVValue_V_overflow64bitPlus27,
  V_wrongvalue_ff: ttVValue_V_wrongvalue_ff,
  V_equals38: ttVValue_V_equals38,
  InvalidChainID0ValidV0: ttVValue_InvalidChainID0ValidV0,
  WrongVRSTestVEqual31: ttVValue_WrongVRSTestVEqual31,
  V_wrongvalue_124: ttVValue_V_wrongvalue_124,
  V_overflow64bitSigned: ttVValue_V_overflow64bitSigned,
};
export const ttEIP2028 = {
  DataTestInsufficientGas2028: ttEIP2028_DataTestInsufficientGas2028,
  DataTestSufficientGas2028: ttEIP2028_DataTestSufficientGas2028,
};
export const ttSignature = {
  EmptyTransaction: ttSignature_EmptyTransaction,
  ZeroSigTransaction: ttSignature_ZeroSigTransaction,
  Vitalik_3: ttSignature_Vitalik_3,
  WrongVRSTestIncorrectSize: ttSignature_WrongVRSTestIncorrectSize,
  RSsecp256k1: ttSignature_RSsecp256k1,
  Vitalik_16: ttSignature_Vitalik_16,
  Vitalik_17: ttSignature_Vitalik_17,
  Vitalik_2: ttSignature_Vitalik_2,
  Vitalik_5: ttSignature_Vitalik_5,
  Vitalik_10: ttSignature_Vitalik_10,
  Vitalik_9: ttSignature_Vitalik_9,
  ZeroSigTransaction6: ttSignature_ZeroSigTransaction6,
  Vitalik_8: ttSignature_Vitalik_8,
  RightVRSTest: ttSignature_RightVRSTest,
  Vitalik_11: ttSignature_Vitalik_11,
  invalidSignature: ttSignature_invalidSignature,
  WrongVRSTestVOverflow: ttSignature_WrongVRSTestVOverflow,
  Vitalik_4: ttSignature_Vitalik_4,
  Vitalik_12: ttSignature_Vitalik_12,
  Vitalik_7: ttSignature_Vitalik_7,
  TransactionWithTooManyRLPElements: ttSignature_TransactionWithTooManyRLPElements,
  ZeroSigTransaction5: ttSignature_ZeroSigTransaction5,
  PointAtInfinity: ttSignature_PointAtInfinity,
  libsecp256k1test: ttSignature_libsecp256k1test,
  ZeroSigTransaction4: ttSignature_ZeroSigTransaction4,
  Vitalik_6: ttSignature_Vitalik_6,
  TransactionWithTooFewRLPElements: ttSignature_TransactionWithTooFewRLPElements,
  Vitalik_13: ttSignature_Vitalik_13,
  ZeroSigTransaction3: ttSignature_ZeroSigTransaction3,
  SenderTest: ttSignature_SenderTest,
  Vitalik_14: ttSignature_Vitalik_14,
  Vitalik_1: ttSignature_Vitalik_1,
  Vitalik_15: ttSignature_Vitalik_15,
  ZeroSigTransaction2: ttSignature_ZeroSigTransaction2,
};
export const ttNonce = {
  TransactionWithHighNonce64Plus1: ttNonce_TransactionWithHighNonce64Plus1,
  TransactionWithHighNonce64Minus2: ttNonce_TransactionWithHighNonce64Minus2,
  TransactionWithHighNonce32: ttNonce_TransactionWithHighNonce32,
  TransactionWithHighNonce64: ttNonce_TransactionWithHighNonce64,
  TransactionWithEmptyBigInt: ttNonce_TransactionWithEmptyBigInt,
  TransactionWithNonceOverflow: ttNonce_TransactionWithNonceOverflow,
  TransactionWithZerosBigInt: ttNonce_TransactionWithZerosBigInt,
  TransactionWithHighNonce64Minus1: ttNonce_TransactionWithHighNonce64Minus1,
  TransactionWithHighNonce256: ttNonce_TransactionWithHighNonce256,
  TransactionWithLeadingZerosNonce: ttNonce_TransactionWithLeadingZerosNonce,
};
export const ttData = {
  DataTestZeroBytes: ttData_DataTestZeroBytes,
  String10MbData: ttData_String10MbData,
  DataTestNotEnoughGAS: ttData_DataTestNotEnoughGAS,
  DataTestLastZeroBytes: ttData_DataTestLastZeroBytes,
  dataTx_bcValidBlockTestFrontier: ttData_dataTx_bcValidBlockTestFrontier,
  DataTestEnoughGAS: ttData_DataTestEnoughGAS,
  DataTestFirstZeroBytes: ttData_DataTestFirstZeroBytes,
  String10MbDataNotEnoughGAS: ttData_String10MbDataNotEnoughGAS,
  dataTx_bcValidBlockTest: ttData_dataTx_bcValidBlockTest,
};
export const ttEIP3860 = {
  DataTestInitCodeTooBig: ttEIP3860_DataTestInitCodeTooBig,
  DataTestEnoughGasInitCode: ttEIP3860_DataTestEnoughGasInitCode,
  DataTestNotEnoughGasInitCode: ttEIP3860_DataTestNotEnoughGasInitCode,
  DataTestInitCodeLimit: ttEIP3860_DataTestInitCodeLimit,
};
export const ttGasLimit = {
  TransactionWithGasLimitOverflow64: ttGasLimit_TransactionWithGasLimitOverflow64,
  NotEnoughGasLimit: ttGasLimit_NotEnoughGasLimit,
  TransactionWithHighGasLimit63: ttGasLimit_TransactionWithHighGasLimit63,
  TransactionWithHighGasLimit64Minus1: ttGasLimit_TransactionWithHighGasLimit64Minus1,
  TransactionWithHighGasLimit63Plus1: ttGasLimit_TransactionWithHighGasLimit63Plus1,
  TransactionWithGasLimitxPriceOverflow: ttGasLimit_TransactionWithGasLimitxPriceOverflow,
  TransactionWithGasLimitOverflow256: ttGasLimit_TransactionWithGasLimitOverflow256,
  TransactionWithLeadingZerosGasLimit: ttGasLimit_TransactionWithLeadingZerosGasLimit,
  TransactionWithGasLimitOverflowZeros64: ttGasLimit_TransactionWithGasLimitOverflowZeros64,
  TransactionWithHighGasLimit63Minus1: ttGasLimit_TransactionWithHighGasLimit63Minus1,
};
export const ttEIP2930 = {
  accessListStoragePrefix00: ttEIP2930_accessListStoragePrefix00,
  accessListAddressLessThan20: ttEIP2930_accessListAddressLessThan20,
  accessListStorage0x0001: ttEIP2930_accessListStorage0x0001,
  accessListStorageOver32Bytes: ttEIP2930_accessListStorageOver32Bytes,
  accessListAddressGreaterThan20: ttEIP2930_accessListAddressGreaterThan20,
  accessListStorage32Bytes: ttEIP2930_accessListStorage32Bytes,
  accessListAddressPrefix00: ttEIP2930_accessListAddressPrefix00,
};
export const ttWrongRLP = {
  TRANSCT__ZeroByteAtRLP_6: ttWrongRLP_TRANSCT__ZeroByteAtRLP_6,
  RLPIncorrectByteEncoding01: ttWrongRLP_RLPIncorrectByteEncoding01,
  RLPHeaderSizeOverflowInt32: ttWrongRLP_RLPHeaderSizeOverflowInt32,
  TRANSCT_svalue_Prefixed0000: ttWrongRLP_TRANSCT_svalue_Prefixed0000,
  TRANSCT__RandomByteAtRLP_0: ttWrongRLP_TRANSCT__RandomByteAtRLP_0,
  TRANSCT_to_Prefixed0000: ttWrongRLP_TRANSCT_to_Prefixed0000,
  RLP_04_maxFeePerGas32BytesValue: ttWrongRLP_RLP_04_maxFeePerGas32BytesValue,
  TRANSCT__RandomByteAtRLP_1: ttWrongRLP_TRANSCT__RandomByteAtRLP_1,
  RLPIncorrectByteEncoding127: ttWrongRLP_RLPIncorrectByteEncoding127,
  TRANSCT_to_TooShort: ttWrongRLP_TRANSCT_to_TooShort,
  TRANSCT_rvalue_TooShort: ttWrongRLP_TRANSCT_rvalue_TooShort,
  TRANSCT__ZeroByteAtRLP_7: ttWrongRLP_TRANSCT__ZeroByteAtRLP_7,
  RLPIncorrectByteEncoding00: ttWrongRLP_RLPIncorrectByteEncoding00,
  TRANSCT_svalue_GivenAsList: ttWrongRLP_TRANSCT_svalue_GivenAsList,
  TRANSCT__ZeroByteAtRLP_0: ttWrongRLP_TRANSCT__ZeroByteAtRLP_0,
  TRANSCT_HeaderLargerThanRLP_0: ttWrongRLP_TRANSCT_HeaderLargerThanRLP_0,
  RLPgasPriceWithFirstZeros: ttWrongRLP_RLPgasPriceWithFirstZeros,
  TRANSCT__RandomByteAtRLP_6: ttWrongRLP_TRANSCT__RandomByteAtRLP_6,
  TRANSCT_HeaderGivenAsArray_0: ttWrongRLP_TRANSCT_HeaderGivenAsArray_0,
  TRANSCT__RandomByteAtTheEnd: ttWrongRLP_TRANSCT__RandomByteAtTheEnd,
  TRANSCT__RandomByteAtRLP_7: ttWrongRLP_TRANSCT__RandomByteAtRLP_7,
  TRANSCT_gasLimit_TooLarge: ttWrongRLP_TRANSCT_gasLimit_TooLarge,
  TRANSCT__ZeroByteAtRLP_1: ttWrongRLP_TRANSCT__ZeroByteAtRLP_1,
  TRANSCT_svalue_TooLarge: ttWrongRLP_TRANSCT_svalue_TooLarge,
  TRANSCT_rvalue_Prefixed0000: ttWrongRLP_TRANSCT_rvalue_Prefixed0000,
  RLPValueWithFirstZeros: ttWrongRLP_RLPValueWithFirstZeros,
  TRANSCT__RandomByteAtRLP_8: ttWrongRLP_TRANSCT__RandomByteAtRLP_8,
  RLPListLengthWithFirstZeros: ttWrongRLP_RLPListLengthWithFirstZeros,
  RLPExtraRandomByteAtTheEnd: ttWrongRLP_RLPExtraRandomByteAtTheEnd,
  RLP_09_maxFeePerGas32BytesValue: ttWrongRLP_RLP_09_maxFeePerGas32BytesValue,
  tr201506052141PYTHON: ttWrongRLP_tr201506052141PYTHON,
  TRANSCT_data_GivenAsList: ttWrongRLP_TRANSCT_data_GivenAsList,
  aMaliciousRLP: ttWrongRLP_aMaliciousRLP,
  TRANSCT__RandomByteAtRLP_4: ttWrongRLP_TRANSCT__RandomByteAtRLP_4,
  RLPAddressWrongSize: ttWrongRLP_RLPAddressWrongSize,
  RLPElementIsListWhenItShouldntBe2: ttWrongRLP_RLPElementIsListWhenItShouldntBe2,
  TRANSCT_gasLimit_Prefixed0000: ttWrongRLP_TRANSCT_gasLimit_Prefixed0000,
  TRANSCT_rvalue_TooLarge: ttWrongRLP_TRANSCT_rvalue_TooLarge,
  TRANSCT_to_TooLarge: ttWrongRLP_TRANSCT_to_TooLarge,
  TRANSCT_to_GivenAsList: ttWrongRLP_TRANSCT_to_GivenAsList,
  TRANSCT__ZeroByteAtRLP_2: ttWrongRLP_TRANSCT__ZeroByteAtRLP_2,
  TRANSCT__ZeroByteAtRLP_3: ttWrongRLP_TRANSCT__ZeroByteAtRLP_3,
  RLPArrayLengthWithFirstZeros: ttWrongRLP_RLPArrayLengthWithFirstZeros,
  RLPNonceWithFirstZeros: ttWrongRLP_RLPNonceWithFirstZeros,
  RLPAddressWithFirstZeros: ttWrongRLP_RLPAddressWithFirstZeros,
  TRANSCT__RandomByteAtRLP_5: ttWrongRLP_TRANSCT__RandomByteAtRLP_5,
  TRANSCT__RandomByteAtRLP_9: ttWrongRLP_TRANSCT__RandomByteAtRLP_9,
  TRANSCT__RandomByteAtRLP_2: ttWrongRLP_TRANSCT__RandomByteAtRLP_2,
  TRANSCT__ZeroByteAtRLP_4: ttWrongRLP_TRANSCT__ZeroByteAtRLP_4,
  TRANSCT_gasLimit_GivenAsList: ttWrongRLP_TRANSCT_gasLimit_GivenAsList,
  TRANSCT_rvalue_GivenAsList: ttWrongRLP_TRANSCT_rvalue_GivenAsList,
  TRANSCT__ZeroByteAtRLP_8: ttWrongRLP_TRANSCT__ZeroByteAtRLP_8,
  TRANSCT__ZeroByteAtRLP_9: ttWrongRLP_TRANSCT__ZeroByteAtRLP_9,
  RLPElementIsListWhenItShouldntBe: ttWrongRLP_RLPElementIsListWhenItShouldntBe,
  TRANSCT__ZeroByteAtRLP_5: ttWrongRLP_TRANSCT__ZeroByteAtRLP_5,
  aCrashingRLP: ttWrongRLP_aCrashingRLP,
  RLPTransactionGivenAsArray: ttWrongRLP_RLPTransactionGivenAsArray,
  TRANSCT__RandomByteAtRLP_3: ttWrongRLP_TRANSCT__RandomByteAtRLP_3,
  RLPgasLimitWithFirstZeros: ttWrongRLP_RLPgasLimitWithFirstZeros,
};
export const ttValue = {
  TransactionWithHighValue: ttValue_TransactionWithHighValue,
  TransactionWithLeadingZerosValue: ttValue_TransactionWithLeadingZerosValue,
  TransactionWithHighValueOverflow: ttValue_TransactionWithHighValueOverflow,
};
