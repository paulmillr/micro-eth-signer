import * as chainsafe from '@chainsafe/ssz';
import { hexToBytes } from '@noble/hashes/utils';
import { utils as butils, compare } from 'micro-bmark';
import { deepStrictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as snappy from 'snappyjs';
import * as micro from '../../src/ssz.ts';
const __dirname = dirname(fileURLToPath(import.meta.url));


const VECTORS_PATH = __dirname + `/../test/vectors/consensus-spec-tests/tests/mainnet/deneb/ssz_static`;

// eth-signer is x2-x4+ slower than chainsafe.
// - packed executes a lot of checks, which contributes to slow-down
// - 'merkleRoot' in 'BeaconBlock' looks like bug, or a very clever optimization
// - there are many specific, optimized cases, like list of containers, etc
// - u64 is parsed using 'dataview' and 'getBigUint64'. Packed can use it, but, it was not in Safari <=14.1
// - u128/u256 use u64 parsing too: likely faster than packed's generic way
// - There are optimizations like 'packedUintNum64sToLeafNodes' which make chainsafe faster,
//   but also significantly bigger and can cause issues.

// In theory all this stuff should be just:
// import * as lodestar from '@lodestar/types';
// But:
// - 'ValidatorIndex (used in SignedBLSToExecutionChange) was UintNum64
// - which is 'UintNumberType' instead of 'UintBigintType' (parsing u64 as plain number in js is very bad idea!)
// - which crashed on encode/decode of 'consensus-spec-tests' (test case overflows f64 in js, which causes 'encode(decode(x))!==x')
// - How was it even possible to have this-broken types which crash on consensus-spec-tests?
// - So, this is fixed version. Why it is important? Parsing u64 as 'number' is faster than 'bigint', but it is incorrect
// - we always use bigints for u64 (so this stuff will never happen with eth-signer).
const Bytes20 = new chainsafe.ByteVectorType(20);
const Bytes32 = new chainsafe.ByteVectorType(32);
const Bytes48 = new chainsafe.ByteVectorType(48);
const Bytes96 = new chainsafe.ByteVectorType(96);
const UintNum64 = new chainsafe.UintBigintType(8);
const UintBn64 = new chainsafe.UintBigintType(8);
const UintBn256 = new chainsafe.UintBigintType(32);
const Slot = UintNum64;
const Epoch = UintNum64;
const CommitteeIndex = UintNum64;
const ValidatorIndex = UintNum64;
const WithdrawalIndex = UintNum64;
const Gwei = UintBn64;
const Root = new chainsafe.ByteVectorType(32);
const BLSPubkey = Bytes48;
const BLSSignature = Bytes96;
const ExecutionAddress = Bytes20;
const BLSToExecutionChange = new chainsafe.ContainerType(
  {
    validatorIndex: ValidatorIndex,
    fromBlsPubkey: BLSPubkey,
    toExecutionAddress: ExecutionAddress,
  },
  { typeName: 'BLSToExecutionChange', jsonCase: 'eth2' }
);
const SignedBLSToExecutionChange = new chainsafe.ContainerType(
  {
    message: BLSToExecutionChange,
    signature: BLSSignature,
  },
  { typeName: 'SignedBLSToExecutionChange', jsonCase: 'eth2' }
);
const MAX_VALIDATORS_PER_COMMITTEE = 2048;
const CommitteeIndices = new chainsafe.ListBasicType(ValidatorIndex, MAX_VALIDATORS_PER_COMMITTEE);
const CheckpointBigint = new chainsafe.ContainerType(
  {
    epoch: UintBn64,
    root: Root,
  },
  { typeName: 'Checkpoint', jsonCase: 'eth2' }
);
const AttestationDataBigint = new chainsafe.ContainerType(
  {
    slot: UintBn64,
    index: UintBn64,
    beaconBlockRoot: Root,
    source: CheckpointBigint,
    target: CheckpointBigint,
  },
  { typeName: 'AttestationData', jsonCase: 'eth2', cachePermanentRootStruct: true }
);
const IndexedAttestationBigint = new chainsafe.ContainerType(
  {
    attestingIndices: CommitteeIndices,
    data: AttestationDataBigint,
    signature: BLSSignature,
  },
  { typeName: 'IndexedAttestation', jsonCase: 'eth2' }
);
const AttesterSlashing = new chainsafe.ContainerType(
  {
    attestation1: IndexedAttestationBigint,
    attestation2: IndexedAttestationBigint,
  },
  { typeName: 'AttesterSlashing', jsonCase: 'eth2' }
);
const KZGCommitment = Bytes48;
const MAX_BLOB_COMMITMENTS_PER_BLOCK = 4096;
const MAX_PROPOSER_SLASHINGS = 16;
const MAX_ATTESTER_SLASHINGS = 2;
const MAX_ATTESTATIONS = 128;
const MAX_DEPOSITS = 16;
const MAX_VOLUNTARY_EXITS = 16;
const MAX_TRANSACTIONS_PER_PAYLOAD = 1048576;
const BYTES_PER_LOGS_BLOOM = 256;
const MAX_EXTRA_DATA_BYTES = 32;
const DEPOSIT_CONTRACT_TREE_DEPTH = 2 ** 5;
const MAX_BYTES_PER_TRANSACTION = 1073741824;
const MAX_BLS_TO_EXECUTION_CHANGES = 16;
const MAX_WITHDRAWALS_PER_PAYLOAD = 16;
const BlobKzgCommitments = new chainsafe.ListCompositeType(
  KZGCommitment,
  MAX_BLOB_COMMITMENTS_PER_BLOCK
);

const SYNC_COMMITTEE_SIZE = 512;
const SyncCommitteeBits = new chainsafe.BitVectorType(SYNC_COMMITTEE_SIZE);
const SyncAggregate = new chainsafe.ContainerType(
  {
    syncCommitteeBits: SyncCommitteeBits,
    syncCommitteeSignature: BLSSignature,
  },
  { typeName: 'SyncCommitteeBits', jsonCase: 'eth2' }
);
const Eth1Data = new chainsafe.ContainerType(
  {
    depositRoot: Root,
    depositCount: UintNum64,
    blockHash: Bytes32,
  },
  { typeName: 'Eth1Data', jsonCase: 'eth2' }
);
const VoluntaryExit = new chainsafe.ContainerType(
  {
    epoch: Epoch,
    validatorIndex: ValidatorIndex,
  },
  { typeName: 'VoluntaryExit', jsonCase: 'eth2', cachePermanentRootStruct: true }
);
const Checkpoint = new chainsafe.ContainerType(
  {
    epoch: Epoch,
    root: Root,
  },
  { typeName: 'Checkpoint', jsonCase: 'eth2' }
);
const SignedVoluntaryExit = new chainsafe.ContainerType(
  {
    message: VoluntaryExit,
    signature: BLSSignature,
  },
  { typeName: 'SignedVoluntaryExit', jsonCase: 'eth2' }
);
const DepositData = new chainsafe.ContainerType(
  {
    pubkey: BLSPubkey,
    withdrawalCredentials: Bytes32,
    amount: UintNum64,
    signature: BLSSignature,
  },
  { typeName: 'DepositData', jsonCase: 'eth2' }
);
const Deposit = new chainsafe.ContainerType(
  {
    proof: new chainsafe.VectorCompositeType(Bytes32, DEPOSIT_CONTRACT_TREE_DEPTH + 1),
    data: DepositData,
  },
  { typeName: 'Deposit', jsonCase: 'eth2' }
);
const CommitteeBits = new chainsafe.BitListType(MAX_VALIDATORS_PER_COMMITTEE);
const AttestationData = new chainsafe.ContainerType(
  {
    slot: Slot,
    index: CommitteeIndex,
    beaconBlockRoot: Root,
    source: Checkpoint,
    target: Checkpoint,
  },
  { typeName: 'AttestationData', jsonCase: 'eth2', cachePermanentRootStruct: true }
);
const Attestation = new chainsafe.ContainerType(
  {
    aggregationBits: CommitteeBits,
    data: AttestationData,
    signature: BLSSignature,
  },
  { typeName: 'Attestation', jsonCase: 'eth2' }
);
const BeaconBlockHeaderBigint = new chainsafe.ContainerType(
  {
    slot: UintBn64,
    proposerIndex: ValidatorIndex,
    parentRoot: Root,
    stateRoot: Root,
    bodyRoot: Root,
  },
  { typeName: 'BeaconBlockHeader', jsonCase: 'eth2', cachePermanentRootStruct: true }
);
const SignedBeaconBlockHeaderBigint = new chainsafe.ContainerType(
  {
    message: BeaconBlockHeaderBigint,
    signature: BLSSignature,
  },
  { typeName: 'SignedBeaconBlockHeader', jsonCase: 'eth2' }
);
const ProposerSlashing = new chainsafe.ContainerType(
  {
    signedHeader1: SignedBeaconBlockHeaderBigint,
    signedHeader2: SignedBeaconBlockHeaderBigint,
  },
  { typeName: 'ProposerSlashing', jsonCase: 'eth2' }
);
const BeaconBlockBodyPhase0 = new chainsafe.ContainerType(
  {
    randaoReveal: BLSSignature,
    eth1Data: Eth1Data,
    graffiti: Bytes32,
    proposerSlashings: new chainsafe.ListCompositeType(ProposerSlashing, MAX_PROPOSER_SLASHINGS),
    attesterSlashings: new chainsafe.ListCompositeType(AttesterSlashing, MAX_ATTESTER_SLASHINGS),
    attestations: new chainsafe.ListCompositeType(Attestation, MAX_ATTESTATIONS),
    deposits: new chainsafe.ListCompositeType(Deposit, MAX_DEPOSITS),
    voluntaryExits: new chainsafe.ListCompositeType(SignedVoluntaryExit, MAX_VOLUNTARY_EXITS),
  },
  { typeName: 'BeaconBlockBody', jsonCase: 'eth2', cachePermanentRootStruct: true }
);
const Transaction = new chainsafe.ByteListType(MAX_BYTES_PER_TRANSACTION);
const Transactions = new chainsafe.ListCompositeType(Transaction, MAX_TRANSACTIONS_PER_PAYLOAD);
const Uint256 = UintBn256;
const CommonExecutionPayloadType = new chainsafe.ContainerType({
  parentHash: Root,
  feeRecipient: ExecutionAddress,
  stateRoot: Bytes32,
  receiptsRoot: Bytes32,
  logsBloom: new chainsafe.ByteVectorType(BYTES_PER_LOGS_BLOOM),
  prevRandao: Bytes32,
  blockNumber: UintNum64,
  gasLimit: UintNum64,
  gasUsed: UintNum64,
  timestamp: UintNum64,
  extraData: new chainsafe.ByteListType(MAX_EXTRA_DATA_BYTES),
  baseFeePerGas: Uint256,
  blockHash: Root,
});
const ExecutionPayloadBellatrix = new chainsafe.ContainerType(
  {
    ...CommonExecutionPayloadType.fields,
    transactions: Transactions,
  },
  { typeName: 'ExecutionPayload', jsonCase: 'eth2' }
);
const Withdrawal = new chainsafe.ContainerType(
  {
    index: WithdrawalIndex,
    validatorIndex: ValidatorIndex,
    address: ExecutionAddress,
    amount: Gwei,
  },
  { typeName: 'Withdrawal', jsonCase: 'eth2' }
);
const Withdrawals = new chainsafe.ListCompositeType(Withdrawal, MAX_WITHDRAWALS_PER_PAYLOAD);
const ExecutionPayloadCapella = new chainsafe.ContainerType(
  {
    ...ExecutionPayloadBellatrix.fields,
    withdrawals: Withdrawals,
  },
  { typeName: 'ExecutionPayload', jsonCase: 'eth2' }
);
const ExecutionPayload = new chainsafe.ContainerType(
  {
    ...ExecutionPayloadCapella.fields,
    blobGasUsed: UintBn64,
    excessBlobGas: UintBn64,
  },
  { typeName: 'ExecutionPayload', jsonCase: 'eth2' }
);
const BeaconBlockBodyAltair = new chainsafe.ContainerType(
  {
    ...BeaconBlockBodyPhase0.fields,
    syncAggregate: SyncAggregate,
  },
  { typeName: 'BeaconBlockBody', jsonCase: 'eth2', cachePermanentRootStruct: true }
);
const BLSToExecutionChanges = new chainsafe.ListCompositeType(
  SignedBLSToExecutionChange,
  MAX_BLS_TO_EXECUTION_CHANGES
);
const BeaconBlockBodyCapella = new chainsafe.ContainerType(
  {
    ...BeaconBlockBodyAltair.fields,
    executionPayload: ExecutionPayload,
    blsToExecutionChanges: BLSToExecutionChanges,
  },
  { typeName: 'BeaconBlockBody', jsonCase: 'eth2', cachePermanentRootStruct: true }
);
const BeaconBlockBody = new chainsafe.ContainerType(
  {
    ...BeaconBlockBodyAltair.fields,
    executionPayload: ExecutionPayload,
    blsToExecutionChanges: BeaconBlockBodyCapella.fields.blsToExecutionChanges,
    blobKzgCommitments: BlobKzgCommitments,
  },
  { typeName: 'BeaconBlockBody', jsonCase: 'eth2', cachePermanentRootStruct: true }
);
const BeaconBlockCapella = new chainsafe.ContainerType(
  {
    slot: Slot,
    proposerIndex: ValidatorIndex,
    parentRoot: Root,
    stateRoot: Root,
    body: BeaconBlockBody,
  },
  { typeName: 'BeaconBlock', jsonCase: 'eth2', cachePermanentRootStruct: true }
);
const BeaconBlock = new chainsafe.ContainerType(
  {
    ...BeaconBlockCapella.fields,
    body: BeaconBlockBody,
  },
  { typeName: 'BeaconBlock', jsonCase: 'eth2', cachePermanentRootStruct: true }
);

const TYPES = {
  basic: {
    // { a: 5, b: 2335, c: new Uint8Array(10).fill(0xa6) }
    data: hexToBytes('051f09a6a6a6a6a6a6a6a6a6a6'),
    micro: micro.container({ a: micro.uint8, b: micro.uint16, c: micro.bytevector(10) }),
    chainsafe: new chainsafe.ContainerType({
      a: new chainsafe.UintNumberType(1),
      b: new chainsafe.UintNumberType(2),
      c: new chainsafe.ByteVectorType(10),
    }),
  },
  SignedBLSToExecutionChange: {
    dataPath: `${VECTORS_PATH}/SignedBLSToExecutionChange/ssz_random/case_4/serialized.ssz_snappy`,
    micro: micro.ETH2_TYPES.SignedBLSToExecutionChange,
    chainsafe: SignedBLSToExecutionChange,
  },
  AttesterSlashing: {
    dataPath: `${VECTORS_PATH}/AttesterSlashing/ssz_random/case_0/serialized.ssz_snappy`,
    micro: micro.ETH2_TYPES.AttesterSlashing,
    chainsafe: AttesterSlashing,
  },

  BeaconBlock: {
    dataPath: `${VECTORS_PATH}/BeaconBlock/ssz_random/case_0/serialized.ssz_snappy`,
    // We have slightly different field names (we are closer to spec/eth field names in consensus-spec)
    micro: micro.ETH2_TYPES.BeaconBlock,
    //chainsafe: lodestar.ssz.deneb.BeaconBlock,
    chainsafe: BeaconBlock,
  },
};

export async function main() {
  const SAMPLES = 1_000_000;
  const HASH_SAMPLES = 10_000;
  for (const k in TYPES) {
    const t = TYPES[k];
    const data = t.data ? t.data : Uint8Array.from(snappy.uncompress(readFileSync(t.dataPath)));
    console.log(`====== ${k} ======`);
    await compare(`decode`, SAMPLES, {
      chainsafe: () => t.chainsafe.deserialize(data),
      micro: () => t.micro.decode(data),
    });
    const chainsafeDecoded = t.chainsafe.deserialize(data);
    const microDecoded = t.micro.decode(data);
    await compare(`encode`, SAMPLES, {
      chainsafe: () => t.chainsafe.serialize(chainsafeDecoded),
      micro: () => t.micro.encode(microDecoded),
    });
    deepStrictEqual(t.micro.encode(microDecoded), data, 'micro(round-trip)');
    deepStrictEqual(
      t.chainsafe.deserialize(t.chainsafe.serialize(chainsafeDecoded)),
      chainsafeDecoded,
      'chainsafe(round-trip1)'
    );
    deepStrictEqual(t.chainsafe.serialize(chainsafeDecoded), data, 'chainSafe(round-trip2)');
    await compare(`merkleRoot`, HASH_SAMPLES, {
      chainsafe: () => t.chainsafe.hashTreeRoot(chainsafeDecoded),
      micro: () => t.micro.merkleRoot(microDecoded),
    });
    deepStrictEqual(
      t.micro.merkleRoot(microDecoded),
      t.chainsafe.hashTreeRoot(chainsafeDecoded),
      'merke-root'
    );
  }

  butils.logMem();
}

// ESM is broken.
import url from 'node:url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main();
}
