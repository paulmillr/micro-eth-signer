/*! micro-eth-signer - MIT License (c) 2021 Paul Miller (paulmillr.com) */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { addr } from './address.ts';
import {
  RawTx,
  TxVersions,
  calcIntrinsicGas,
  decodeLegacyV,
  encodeRawTx,
  isTxType,
  removeSig,
  sortRawData,
  validateFields,
  type AccessList,
  type TxCoder,
  type TxType,
} from './tx-internal.ts';
// prettier-ignore
import {
  amounts,
  cloneDeep,
  deepFreeze,
  ethHex,
  ethHexNoLeadingZero,
  initSig,
  recoverPublicKey,
  isBytes,
  isObject,
  sign,
  strip0x,
  verify,
} from '../utils.ts';

// The file exports Transaction, but actual (RLP) parsing logic is done in `./tx`

// Transaction-related utils.

type DefaultType = 'eip1559';
// Defaultable fields are pre-filled when the selected tx type exposes them.
const TX_DEFAULTS: {
  accessList: AccessList;
  chainId: bigint;
  data: string;
  gasLimit: bigint;
  maxPriorityFeePerGas: bigint;
  type: DefaultType;
} = {
  accessList: [], // needs to be .slice()-d to create new reference
  // EIP-7702 authorizationList must be caller-provided and non-empty, so it has no default.
  chainId: BigInt(1), // mainnet
  data: '',
  // TODO: investigate if limit is smaller in eip4844 txs.
  gasLimit: BigInt(21000),
  // Reduce fingerprinting by using standard, popular value.
  maxPriorityFeePerGas: BigInt(1) * amounts.GWEI,
  type: 'eip1559',
};
const GAS_PER_BLOB = /* @__PURE__ */ BigInt(131072);
type DefaultField = keyof typeof TX_DEFAULTS;
type DefaultsOptional<T> = {
  [P in keyof T as P extends DefaultField ? P : never]?: T[P];
} & {
  [P in keyof T as P extends DefaultField ? never : P]: T[P];
};
type HumanInputInner<T extends TxType> = DefaultsOptional<{ type: T } & TxCoder<T>>;
type HumanInputInnerDefault = DefaultsOptional<TxCoder<DefaultType>> & { type?: undefined };
// Discriminated (type, raw) view of a Transaction: checking `tx.type` narrows `tx.raw`.
type TxUnion = { [K in TxType]: { type: K; raw: TxCoder<K> } }[TxType];

export type TransactionOpts = {
  /** Validate fields as human/UI input (sane fee & nonce limits). Default: true. */
  strict?: boolean;
  /** Allow signature fields (`r`, `s`, `yParity`, `v`) to be present on input. Default: true. */
  allowSignatureFields?: boolean;
};

// Changes:
// - legacy: instead of hardfork now accepts additional param chainId
//           if chainId is present, we enable relay protection
//           This removes hardfork param and simplifies replay protection logic
// - tx parametrized over type: you cannot access fields from different tx version
// - legacy: 'v' param is hidden in coders. Transaction operates in terms chainId and yParity.
// TODO: tx is kinda immutable, but user can change .raw values before signing
// need to think about re-validation?
export class Transaction<T extends TxType> {
  readonly type: T;
  readonly raw: TxCoder<T>;
  readonly isSigned: boolean;
  private readonly strict: boolean;

  // Doesn't force any defaults, catches if fields incompatible with type
  constructor(type: T, raw: TxCoder<T>, opts: TransactionOpts = {}) {
    const { strict = true, allowSignatureFields = true } = opts;
    this.type = type;
    // Preserve whether this was validated as user input or machine/historical data.
    this.strict = strict;
    validateFields(type, raw, strict, allowSignatureFields);
    // Sign only the validated snapshot. Nested access lists, authorizations, and blob
    // hashes must not remain mutable between approval and signing.
    this.raw = deepFreeze(cloneDeep(raw)) as TxCoder<T>;
    this.isSigned = typeof this.raw.r === 'bigint' && typeof this.raw.s === 'bigint';
  }
  // Defaults
  static prepare(data: HumanInputInnerDefault, strict?: boolean): Transaction<DefaultType>;
  static prepare<T extends TxType>(
    data: { type: T } & HumanInputInner<T>,
    strict?: boolean
  ): Transaction<T>;
  static prepare<T extends TxType>(
    data: HumanInputInner<T> | HumanInputInnerDefault,
    strict = true
  ): Transaction<T> {
    if (!isObject(data)) throw new TypeError('"data" expected object, got type=' + typeof data);
    const type = (data.type !== undefined ? data.type : TX_DEFAULTS.type) as T;
    if (!isTxType(type)) throw new Error(`wrong transaction type=${type}`);
    const coder = TxVersions[type];
    const fields = new Set<string>(coder.fields);
    const hasGasLimit = Object.hasOwn(data, 'gasLimit');
    // Copy default fields, but only if the field is present on the tx type.
    const raw: Record<string, any> = { type };
    for (const f in TX_DEFAULTS) {
      if (f !== 'type' && fields.has(f)) {
        raw[f] = TX_DEFAULTS[f as DefaultField];
        if (f === 'accessList') raw[f] = cloneDeep(raw[f]);
      }
    }
    // Copy all fields, so we can validate unexpected ones.
    Object.assign(raw, data);
    // Preserve normalized default type when callers pass the supported `{ type: undefined }` shape.
    raw.type = type;
    if (!hasGasLimit && fields.has('gasLimit')) raw.gasLimit = calcIntrinsicGas(type, raw);
    return new Transaction(type, sortRawData(raw as TxCoder<T>), {
      strict,
      allowSignatureFields: false,
    });
  }
  /**
   * Sets the largest value that remains valid at the transaction's worst-case fee.
   * Fee fields are preserved, so the actual fee can be lower and leave a small remainder.
   * Maximum-value transfers remain recognizable on-chain from their amount.
   * @param accountBalance - account balance in wei
   * @returns new transaction with its value adjusted to `accountBalance - fee`
   */
  setMaxAmount(accountBalance: bigint): Transaction<T> {
    const _0n = BigInt(0);
    if (typeof accountBalance !== 'bigint' || accountBalance <= _0n)
      throw new Error('account balance must be bigger than 0');
    // Changing value/fees would invalidate an existing signature.
    if (this.isSigned) throw new Error('expected unsigned transaction');
    const fee = this.fee;
    const amountToSend = accountBalance - fee;
    if (amountToSend <= _0n) throw new Error('account balance must be bigger than fee of ' + fee);
    const raw = { ...this.raw, value: amountToSend };
    return new Transaction(this.type, raw, { strict: this.strict });
  }
  /**
   * Decodes an EIP-2718 serialized transaction.
   * Unlike `prepare`, `strict` defaults to false: wire data is machine-produced or historical,
   * so the UI-oriented sanity limits (nonce, fee caps) applied to human input don't belong here.
   * @param bytes - serialized transaction
   * @param strict - validate fields as human/UI input. Default: false
   */
  static fromBytes(bytes: Uint8Array, strict = false): Transaction<TxType> {
    const raw = RawTx.decode(bytes);
    return new Transaction(raw.type, raw.data, { strict });
  }
  /**
   * Decodes an EIP-2718 serialized transaction from hex.
   * Unlike `prepare`, `strict` defaults to false: see {@link Transaction.fromBytes}.
   * @param hex - serialized transaction, with or without `0x` prefix
   * @param strict - validate fields as human/UI input. Default: false
   */
  static fromHex(hex: string, strict = false): Transaction<TxType> {
    return Transaction.fromBytes(ethHexNoLeadingZero.decode(hex), strict);
  }
  // Discriminated view of `this`, so methods can narrow `raw` by checking `type`.
  private asUnion(): TxUnion {
    return this as unknown as TxUnion;
  }
  private assertIsSigned(): asserts this is Transaction<T> & {
    raw: TxCoder<T> & { r: bigint; s: bigint; yParity: number };
  } {
    if (!this.isSigned) throw new Error('expected signed transaction');
  }
  /**
   * Converts transaction to RLP.
   * @param opts.includeSignature - whether to include signature. Default: true when signed
   */
  toBytes(opts: { includeSignature?: boolean } = {}): Uint8Array {
    const includeSignature = opts.includeSignature ?? this.isSigned;
    // cloneDeep is not necessary here
    const data = Object.assign({}, this.raw);
    if (includeSignature) {
      this.assertIsSigned();
    } else {
      removeSig(data);
    }
    return encodeRawTx(this.type, data);
  }
  /**
   * Converts transaction to hex.
   * @param opts.includeSignature - whether to include signature. Default: true when signed
   */
  toHex(opts: { includeSignature?: boolean } = {}): string {
    return ethHex.encode(this.toBytes(opts));
  }
  /** Calculates keccak-256 hash of signed transaction. Used in block explorers. */
  get hash(): string {
    this.assertIsSigned();
    return ethHex.encode(this.calcHash(true));
  }
  /** Returns sender's address. */
  get sender(): string {
    return this.recoverSender().address;
  }
  /**
   * For legacy transactions, but can be used with libraries when yParity presented as v.
   */
  get v(): bigint | undefined {
    return decodeLegacyV(this.raw);
  }
  private calcHash(includeSignature: boolean): Uint8Array {
    return keccak_256(this.toBytes({ includeSignature }));
  }
  /** Calculates MAXIMUM fee in wei that could be spent. */
  get fee(): bigint {
    const tx = this.asUnion();
    // Fee calculation is not exact, real fee can be smaller
    let gasFee;
    if (tx.type === 'legacy' || tx.type === 'eip2930') {
      gasFee = tx.raw.gasPrice;
    } else {
      // maxFeePerGas is absolute limit, you never pay more than that
      // maxFeePerGas = baseFeePerGas[*2] + maxPriorityFeePerGas
      gasFee = tx.raw.maxFeePerGas;
    }
    let res = tx.raw.gasLimit * gasFee;
    if (tx.type === 'eip4844') {
      // EIP-4844 §Execution layer validation: max_total_fee includes
      // GAS_PER_BLOB * blob_count * max_fee_per_blob_gas, with GAS_PER_BLOB = 2**17.
      res += GAS_PER_BLOB * BigInt(tx.raw.blobVersionedHashes.length) * tx.raw.maxFeePerBlobGas;
    }
    return res;
  }
  clone(): Transaction<T> {
    return new Transaction(this.type, cloneDeep(this.raw), { strict: this.strict });
  }
  verifySignature(): boolean {
    this.assertIsSigned();
    const { r, s, yParity } = this.raw;
    const sig = initSig({ r, s }, yParity);
    // EIP-2 high-s tx signatures are structurally decodable but invalid, so
    // this boolean verifier returns false while malformed signature fields still throw above.
    if (sig.hasHighS()) return false;
    const hash = this.calcHash(false);
    const publicKey = recoverPublicKey(sig, hash);
    return verify(sig.toBytes(), hash, publicKey);
  }
  removeSignature(): Transaction<T> {
    return new Transaction(this.type, removeSig(cloneDeep(this.raw)), { strict: this.strict });
  }
  /**
   * Signs transaction with a private key.
   * @param privateKey key in hex or Uint8Array format
   * @param opts extraEntropy will increase security of sig by mixing rfc6979 randomness
   * @returns new "same" transaction, but signed
   */
  signBy(
    privateKey: string | Uint8Array,
    extraEntropy: boolean | Uint8Array = true
  ): Transaction<T> {
    if (this.isSigned) throw new Error('expected unsigned transaction');
    const priv = isBytes(privateKey) ? privateKey : hexToBytes(strip0x(privateKey, 'privateKey'));
    const hash = this.calcHash(false);
    const sig = sign(hash, priv, extraEntropy);
    const { r, s, recovery } = sig;
    const sraw = Object.assign(cloneDeep(this.raw), { r, s, yParity: recovery });
    // The copied result is validated in non-strict way, strict is only for user input.
    return new Transaction(this.type, sraw, { strict: false });
  }
  /** Calculates public key and address from signed transaction's signature. */
  recoverSender(): { publicKey: string; address: string } {
    this.assertIsSigned();
    const { r, s, yParity } = this.raw;
    const sig = initSig({ r, s }, yParity);
    // Will crash on 'chainstart' hardfork
    if (sig.hasHighS()) throw new Error('invalid s');
    const publicKey = recoverPublicKey(sig, this.calcHash(false));
    return { publicKey: ethHex.encode(publicKey), address: addr.fromPublicKey(publicKey) };
  }
}
