import { secp256k1 } from '@noble/curves/secp256k1.js';
import { validateObject } from '@noble/curves/utils.js';
import {
  hexToBytes as _hexToBytes,
  isBytes as _isBytes,
  bytesToHex,
  type TArg,
  type TRet,
} from '@noble/hashes/utils.js';
import { type Coder, coders } from 'micro-packed';

export type { TArg, TRet } from '@noble/hashes/utils.js';
export { validateObject };

export function aarray<T>(
  item: unknown,
  title: string,
  inner: (elm: T, title: string) => void = () => {}
): T[] {
  if (!Array.isArray(item))
    throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
  for (let i = 0; i < item.length; i++) inner(item[i], `${title}[${i}]`);
  return item;
}

/**
 * Asserts something is a string.
 * @param value - Value to validate.
 * @param title - Label included in thrown errors.
 * @returns The validated string.
 * @throws On wrong argument types. {@link TypeError}
 * @example
 * Validate a label string.
 *
 * ```ts
 * astring('example', 'label');
 * ```
 */
export function astring(value: unknown, title: string = ''): string {
  if (typeof value !== 'string') {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + 'expected string, got type=' + typeof value);
  }
  return value;
}


/**
 * Checks whether a value is a byte array.
 * @param a - Value to inspect.
 * @returns True when the value is a `Uint8Array`.
 * @example
 * Accept raw `Uint8Array` values and reject non-byte inputs.
 * ```ts
 * isBytes(new Uint8Array([1]));
 * ```
 */
export const isBytes: typeof _isBytes = _isBytes;
/**
 * Byte-array input accepted by the package helpers.
 * Used anywhere the package accepts raw bytes instead of hex strings.
 */
export type Bytes = Uint8Array;

// There is no network code in the library.
// The types are used to check external network provider interfaces.
/**
 * Subset of RPC call arguments used by the network helpers.
 * Mirrors the fields commonly passed to `eth_call` and `eth_estimateGas`.
 */
export type Web3CallArgs = {
  /** Destination contract or account address. */
  to?: string;
  /** Sender address used for simulation or gas estimation. */
  from?: string;
  /** Hex calldata payload. */
  data?: string;
  /** Explicit nonce override encoded as hex. */
  nonce?: string;
  /** ETH value to send with the call, encoded as hex. */
  value?: string;
  /** Gas limit override encoded as hex. */
  gas?: string;
  /** Gas price override encoded as hex. */
  gasPrice?: string;
  /** Block tag or explicit block number used for the RPC query. */
  tag?: number | 'latest' | 'earliest' | 'pending';
};

/**
 * Minimal provider interface required by the network helpers.
 * Implemented by `Web3Provider` and accepted by the higher-level network clients.
 */
export type IWeb3Provider = {
  /**
   * Executes an `eth_call` style simulation.
   * @param args - RPC call arguments such as `to`, `data`, and `tag`.
   * @returns Raw hex-encoded return data.
   */
  ethCall: (args: Web3CallArgs) => Promise<string>;
  /**
   * Estimates gas for a transaction-like call.
   * @param args - RPC call arguments such as `to`, `data`, and `value`.
   * @returns Estimated gas as a bigint.
   */
  estimateGas: (args: Web3CallArgs) => Promise<bigint>;
  /**
   * Sends a raw JSON-RPC request.
   * @param method - JSON-RPC method name.
   * @param args - JSON-RPC params passed through to the transport.
   * @returns Decoded JSON-RPC result.
   */
  call: (method: string, ...args: any[]) => Promise<any>;
};

const ETH_PRECISION = 18;
const GWEI_PRECISION = 9;
// Tree-shaking: numeric unit helpers should disappear from entry bundles that don't format amounts.
const GWEI = /* @__PURE__ */ (() => BigInt(10) ** BigInt(GWEI_PRECISION))();
const ETHER = /* @__PURE__ */ (() => BigInt(10) ** BigInt(ETH_PRECISION))();
/**
 * Common Ethereum units and transaction safety limits.
 * @example
 * Format the built-in 1 gwei constant with the decimal coder.
 * ```ts
 * import { amounts, weigwei } from 'micro-eth-signer';
 * weigwei.encode(amounts.GWEI);
 * ```
 */
export const amounts: {
  GWEI_PRECISION: number;
  ETH_PRECISION: number;
  GWEI: bigint;
  ETHER: bigint;
  maxAmount: bigint;
  minGasLimit: bigint;
  maxGasLimit: bigint;
  maxGasPrice: bigint;
  maxNonce: bigint;
  maxDataSize: number;
  maxInitDataSize: number;
  maxChainId: bigint;
  maxUint64: bigint;
  maxUint256: bigint;
} = /* @__PURE__ */ (() =>
  deepFreeze({
    GWEI_PRECISION,
    ETH_PRECISION,
    GWEI,
    ETHER,
    // Disabled with "strict=false"
    maxAmount: BigInt(1_000_000) * ETHER,
    // 21K wei is used at minimum. Possibly smaller gas limit in 4844 txs?
    minGasLimit: BigInt(21_000),
    maxGasLimit: BigInt(30_000_000), // 30M wei. A block limit in 2024 is 30M
    maxGasPrice: BigInt(10_000) * GWEI, // 10K gwei. Arbitrage HFT bots can use more
    maxNonce: BigInt(131_072), // 2**17 strict internal library limit
    maxDataSize: 1_000_000, // Size of .data field. TODO: research
    maxInitDataSize: 524_288, // EIP-7907
    maxChainId: BigInt(2 ** 32 - 1),
    maxUint64: BigInt(2) ** BigInt(64) - BigInt(1),
    maxUint256: BigInt(2) ** BigInt(256) - BigInt(1),
  }))();

// For usage with other packed utils via apply
// This format is pretty much arbitrary:
// - '0x' vs '0x0' for empty
// - strip leading zero/don't
// - geth (https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-eth):
//   0x0,
// - etherscan (https://docs.etherscan.io/api-endpoints/logs):
//   even 'data' can be '0x'
//
// 0x data = Uint8Array([])
// 0x num = BigInt(0)
const leadingZerosRe = /^0+/;
const ethQuantityRe = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const genEthHex = (keepLeadingZero = true): TRet<Coder<Bytes, string>> =>
  deepFreeze({
    decode: (data: string): TRet<Uint8Array> => {
      if (typeof data !== 'string') throw new Error('hex data must be a string');
      let hex = strip0x(data);
      hex = hex.length & 1 ? `0${hex}` : hex;
      return _hexToBytes(hex);
    },
    encode: (data: TArg<Uint8Array>): string => {
      let hex = bytesToHex(data);
      if (!keepLeadingZero) hex = hex.replace(leadingZerosRe, '');
      return add0x(hex);
    },
  }) as TRet<Coder<Bytes, string>>;
/**
 * Hex coder that preserves encoded leading zero nibbles.
 * @example
 * Preserve the leading zero nibble when encoding Ethereum hex.
 * ```ts
 * ethHex.encode(new Uint8Array([1]));
 * ```
 */
export const ethHex: TRet<Coder<Bytes, string>> = /* @__PURE__ */ genEthHex(true);
/**
 * Hex coder that strips redundant leading zero nibbles on encode.
 * @example
 * Trim redundant leading zero nibbles on encode.
 * ```ts
 * ethHexNoLeadingZero.encode(new Uint8Array([1]));
 * ```
 */
export const ethHexNoLeadingZero: TRet<Coder<Bytes, string>> = /* @__PURE__ */ genEthHex(false);

const ethHexStartRe = /^0[xX]/;
/**
 * Adds a `0x` prefix when missing.
 * @param hex - Hex string with or without the `0x` prefix.
 * @returns Hex string guaranteed to start with `0x`.
 * @example
 * Normalize a user-supplied hex string before sending it to RPC helpers.
 * ```ts
 * add0x('abcd');
 * ```
 */
export function add0x(hex: string, title: string = 'hex'): string {
  astring(hex, title);
  return ethHexStartRe.test(hex) ? hex : `0x${hex}`;
}

/**
 * Removes a leading `0x` prefix when present.
 * @param hex - Hex string with or without the `0x` prefix.
 * @returns Hex string without the `0x` prefix.
 * @example
 * Strip the prefix before handing hex to low-level byte decoders.
 * ```ts
 * strip0x('0xabcd');
 * ```
 */
export function strip0x(hex: string, title: string = 'hex'): string {
  astring(hex, title);
  return hex.replace(ethHexStartRe, '');
}

type EthHexNum = {
  decode: (hex: string) => bigint;
  encode: (num: number | bigint) => string;
};
/**
 * Ethereum JSON-RPC quantity coder for bigint-like values.
 * @example
 * Round-trip a zero RPC quantity.
 * ```ts
 * ethHexNum.decode(ethHexNum.encode(0n));
 * ```
 */
export const ethHexNum: TRet<EthHexNum> = /* @__PURE__ */ deepFreeze({
  decode(hex: string): bigint {
    if (typeof hex !== 'string')
      throw new TypeError('expected RPC quantity string, got ' + typeof hex);
    // EIP-1474 §Quantity: 0x-prefixed, fewest possible hex digits, and zero is 0x0.
    if (!ethQuantityRe.test(hex)) throw new Error('invalid RPC quantity');
    return BigInt(hex);
  },
  encode(num: number | bigint): string {
    if (typeof num !== 'number' && typeof num !== 'bigint')
      throw new TypeError('expected number or bigint, got ' + typeof num);
    if (typeof num === 'number' && !Number.isSafeInteger(num))
      throw new Error('invalid RPC quantity');
    if (num < 0) throw new Error('invalid RPC quantity');
    return add0x(num.toString(16));
  },
});

/**
 * Encodes a number as a minimal Ethereum RPC quantity.
 * @param num - Number or bigint to encode.
 * @returns Prefixed minimal hex quantity string.
 * @example
 * Encode an integer as an Ethereum RPC quantity.
 * ```ts
 * numberTo0xHex(1);
 * ```
 */
export function numberTo0xHex(num: number | bigint): string {
  return ethHexNum.encode(num);
}

/**
 * Parses an Ethereum hex string into a bigint.
 * @param hex - Prefixed or unprefixed hex string.
 * @returns Numeric value represented by the hex string.
 * @throws On wrong hex input types. {@link TypeError}
 * @example
 * Parse a quantity returned by Ethereum RPC.
 * ```ts
 * hexToNumber('0x01');
 * ```
 */
export function hexToNumber(hex: string): bigint {
  if (typeof hex !== 'string') throw new TypeError('expected hex string, got ' + typeof hex);
  return hex ? BigInt(add0x(hex)) : BigInt(0);
}

/**
 * Checks whether a value is a non-null object.
 * @param item - Value to inspect.
 * @returns `true` when the value is an object or array.
 * @example
 * Treat plain objects and arrays as structured values.
 * ```ts
 * isObject({});
 * ```
 */
export function isObject(item: unknown): item is Record<string, any> {
  return item != null && typeof item === 'object';
}

/**
 * Recursively freezes an object graph in place.
 * @param obj - Value to freeze.
 * @returns The same value after freezing every reachable array or object value.
 * @example
 * Freeze registry-style constants before exporting them.
 * ```ts
 * deepFreeze({ a: [{ b: 1 }] });
 * ```
 */
export function deepFreeze<T>(obj: T): T {
  if (!isObject(obj)) return obj;
  if (Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) deepFreeze(item);
  } else {
    for (const value of Object.values(obj)) deepFreeze(value);
  }
  return obj;
}

/**
 * Signs a digest with secp256k1 and returns a recovered signature.
 * @param hash - Message digest to sign.
 * @param privKey - 32-byte secp256k1 secret key.
 * @param extraEntropy - Extra nonce input passed to noble-curves signing.
 * @returns Recoverable secp256k1 signature with a valid Ethereum recovery bit.
 * @throws If signature recovery lands on a non-Ethereum recovery id. {@link Error}
 * @example
 * Sign a real keccak digest with a fresh secp256k1 key.
 * ```ts
 * import { keccak_256 } from '@noble/hashes/sha3.js';
 * import { addr, ethHex } from 'micro-eth-signer';
 * import { sign } from 'micro-eth-signer/utils.js';
 * const { privateKey } = addr.random();
 * const digest = keccak_256(new TextEncoder().encode('hello noble'));
 * sign(digest, ethHex.decode(privateKey)).toHex();
 * ```
 */
export function sign(
  hash: TArg<Uint8Array>,
  privKey: TArg<Uint8Array>,
  extraEntropy: TArg<boolean | Uint8Array> = true
): ReturnType<typeof secp256k1.Signature.fromBytes> {
  const sig = secp256k1.sign(hash, privKey, {
    prehash: false,
    extraEntropy: extraEntropy as boolean | Uint8Array,
    format: 'recovered',
  });
  // yellow paper page 26 bans recovery 2 or 3
  // https://ethereum.github.io/yellowpaper/paper.pdf
  if ([2, 3].includes(sig[0])) throw new Error('invalid signature rec=2 or 3');
  return secp256k1.Signature.fromBytes(sig, 'recovered');
}
/**
 * Compact `(r, s)` signature pair.
 * Used when a caller already has the scalar pair instead of compact bytes.
 */
export type RawSig = {
  /** Signature `r` scalar. */
  r: bigint;
  /** Signature `s` scalar. */
  s: bigint;
};
/**
 * Verifies a secp256k1 signature against a digest.
 * @param sig - Compact signature bytes.
 * @param hash - Message digest that was signed.
 * @param publicKey - Compressed or uncompressed secp256k1 public key.
 * @returns `true` when the signature is valid for the digest and key.
 * @example
 * Verify the signature against the same keccak digest.
 * ```ts
 * import { keccak_256 } from '@noble/hashes/sha3.js';
 * import { addr, ethHex } from 'micro-eth-signer';
 * import { sign, verify } from 'micro-eth-signer/utils.js';
 * const hash = keccak_256(new TextEncoder().encode('hello noble'));
 * const { privateKey } = addr.random();
 * const sig = sign(hash, ethHex.decode(privateKey));
 * verify(sig.toBytes('compact'), hash, sig.recoverPublicKey(hash).toBytes());
 * ```
 */
export function verify(
  sig: TArg<Uint8Array>,
  hash: TArg<Uint8Array>,
  publicKey: TArg<Uint8Array>
): boolean {
  return secp256k1.verify(sig, hash, publicKey, { prehash: false });
}
/**
 * Normalizes a signature and attaches the recovery bit.
 * @param sig - Compact signature bytes or a {@link RawSig} pair.
 * @param bit - Recovery bit used to reconstruct the public key.
 * @returns Recoverable secp256k1 signature instance.
 * @throws If the recovery bit is not valid for Ethereum signatures. {@link Error}
 * @example
 * Rebuild a recoverable signature from compact bytes plus the recovery bit.
 * ```ts
 * import { keccak_256 } from '@noble/hashes/sha3.js';
 * import { addr, ethHex } from 'micro-eth-signer';
 * import { initSig, sign } from 'micro-eth-signer/utils.js';
 * const { privateKey } = addr.random();
 * const sig = sign(keccak_256(new TextEncoder().encode('hello noble')), ethHex.decode(privateKey));
 * initSig(sig.toBytes('compact'), sig.recovery!);
 * ```
 */
export function initSig(
  sig: TArg<Uint8Array | RawSig>,
  bit: number
): ReturnType<typeof secp256k1.Signature.fromBytes> {
  // Ethereum signatures use y-parity recovery bits 0/1; noble also supports raw secp256k1 ids 2/3.
  if (typeof bit !== 'number')
    throw new TypeError('"recovery bit" expected number, got type=' + typeof bit);
  if (bit !== 0 && bit !== 1)
    throw new RangeError('"recovery bit" expected 0 or 1, got ' + bit);
  let s;
  if (isBytes(sig)) s = secp256k1.Signature.fromBytes(sig, 'compact');
  else {
    validateObject(sig as Record<string, any>, { r: 'bigint', s: 'bigint' }, {}); // , 'sig'
    s = new secp256k1.Signature((sig as RawSig).r, (sig as RawSig).s);
  }
  return s.addRecoveryBit(bit);
}

/**
 * Deep-clones plain objects, arrays, bigints, and byte arrays.
 * @param obj - Value to clone recursively.
 * @returns Detached copy that preserves the input shape.
 * @example
 * Copy nested transaction-like data before mutating it.
 * ```ts
 * cloneDeep({ a: [1, 2] });
 * ```
 */
export function cloneDeep<T>(obj: T): T {
  if (isBytes(obj)) {
    return Uint8Array.from(obj) as T;
  } else if (Array.isArray(obj)) {
    return obj.map(cloneDeep) as unknown as T;
  } else if (typeof obj === 'bigint') {
    return BigInt(obj) as unknown as T;
  } else if (obj !== null && typeof obj === 'object') {
    // should be last, so it won't catch other types
    let res: any = {};
    // Clone only owned fields; inherited enumerable data is not part of the object's shape.
    for (let key in obj) if (Object.hasOwn(obj, key)) res[key] = cloneDeep(obj[key]);
    return res;
  } else return obj;
}

/**
 * Returns a shallow copy without the selected keys.
 * @param obj - Object to copy.
 * @param keys - Keys removed from the returned object.
 * @returns Copy of `obj` without the selected keys.
 * @throws If the input is not a plain object. {@link Error}
 * @example
 * Drop fields before reusing a partially signed payload.
 * ```ts
 * omit({ a: 1, b: 2 }, 'b');
 * ```
 */
export function omit<T extends object, K extends Extract<keyof T, string>>(
  obj: T,
  ...keys: K[]
): Omit<T, K> {
  // Plain-object helper only: arrays and byte arrays carry positional data, not removable fields.
  if (obj === null || Array.isArray(obj) || isBytes(obj))
    throw new Error('omit: expected plain object');
  let res: any = Object.assign({}, obj);
  for (let key of keys) delete res[key];
  return res;
}

/**
 * Zips two arrays into `[left, right]` tuples.
 * @param a - First array.
 * @param b - Second array.
 * @returns Tuple list aligned by index.
 * @throws If the arrays have different lengths. {@link Error}
 * @example
 * Pair related values by index.
 * ```ts
 * zip([1], ['a']);
 * ```
 */
export function zip<A, B>(a: A[], b: B[]): [A, B][] {
  if (a.length !== b.length) throw new Error('zip: length mismatch');
  let res: [A, B][] = [];
  for (let i = 0; i < a.length; i++) res.push([a[i], b[i]]);
  return res;
}

/**
 * Creates a decimal coder for Ethereum-denominated units.
 * @param precision - Number of fractional decimal digits.
 * @param round - Whether decode should round instead of rejecting excess precision.
 * @returns Decimal coder backed by `micro-packed`.
 * @example
 * Build a coder for decimal unit strings such as ether or gwei.
 * ```ts
 * createDecimal(18).decode('1.5');
 * ```
 */
export const createDecimal = (precision: number, round?: boolean): Coder<bigint, string> =>
  coders.decimal(precision, round);
/**
 * Decimal coder for ether strings.
 * @example
 * Convert an ether string into wei.
 * ```ts
 * weieth.decode('1');
 * ```
 */
export const weieth: Coder<bigint, string> = /* @__PURE__ */ deepFreeze(
  /* @__PURE__ */ createDecimal(ETH_PRECISION)
);
/**
 * Decimal coder for gwei strings.
 * @example
 * Convert a gwei string into wei.
 * ```ts
 * weigwei.decode('1');
 * ```
 */
export const weigwei: Coder<bigint, string> = /* @__PURE__ */ deepFreeze(
  /* @__PURE__ */ createDecimal(GWEI_PRECISION)
);

// legacy. TODO: remove
/**
 * Legacy alias for `weieth`.
 * @example
 * Keep older code working while reusing the main ether coder.
 * ```ts
 * ethDecimal.decode('1');
 * ```
 */
export const ethDecimal = weieth satisfies typeof weieth as typeof weieth;
/**
 * Legacy alias for `weigwei`.
 * @example
 * Keep older code working while reusing the main gwei coder.
 * ```ts
 * gweiDecimal.decode('1');
 * ```
 */
export const gweiDecimal = weigwei satisfies typeof weigwei as typeof weigwei;

type Formatters = {
  perCentDecimal: (precision: number, price: number) => bigint;
  formatBigint: (amount: bigint, base: bigint, precision: number, fixed?: boolean) => string;
  fromWei: (wei: string | number | bigint) => string;
};
/**
 * Miscellaneous number-formatting helpers used by wallet UIs.
 * @example
 * Format on-chain values for wallet-style display.
 * ```ts
 * formatters.fromWei(1n);
 * ```
 */
export const formatters: TRet<Formatters> = /* @__PURE__ */ deepFreeze({
  // returns decimal that costs exactly $0.01 in given precision (using price)
  // formatDecimal(perCentDecimal(prec, price), prec) * price == '0.01'
  perCentDecimal(precision: number, price: number): bigint {
    if (!Number.isSafeInteger(precision) || precision <= 0)
      throw new Error('perCentDecimal: wrong precision');
    // Zero price has no finite one-cent amount; reject before the bigint division.
    if (!Number.isFinite(price) || price <= 0) throw new Error('perCentDecimal: wrong price');
    const fiatPrec = weieth;
    //x * price = 0.01
    //x = 0.01/price = 1/100 / price = 1/(100*price)
    // float does not have enough precision
    const totalPrice = fiatPrec.decode('' + price);
    const centPrice = fiatPrec.decode('0.01') * BigInt(10) ** BigInt(precision);
    return centPrice / totalPrice;
  },
  // TODO: what difference between decimal and this?!
  // Used by 'fromWei' only
  formatBigint(amount: bigint, base: bigint, precision: number, fixed = false): string {
    const baseLength = base.toString().length;
    const whole = (amount / base).toString();
    let fraction = (amount % base).toString();
    const zeros = '0'.repeat(Math.max(0, baseLength - fraction.length - 1));

    fraction = `${zeros}${fraction}`;
    const fractionWithoutTrailingZeros = fraction.replace(/0+$/, '');
    const fractionAfterPrecision = (fixed ? fraction : fractionWithoutTrailingZeros).slice(
      0,
      precision
    );

    if (!fixed && (fractionAfterPrecision === '' || parseInt(fractionAfterPrecision, 10) === 0)) {
      return whole;
    }

    // is same fraction?
    const fr = (str: string) => str.replace(/0+$/, '');
    const prefix =
      BigInt(`1${fr(fractionAfterPrecision)}`) === BigInt(`1${fr(fraction)}`) ? '' : '~';
    // With zero precision there are no fractional digits to place after a decimal point.
    if (precision === 0) return `${prefix}${whole}`;
    return `${prefix}${whole}.${fractionAfterPrecision}`;
  },

  fromWei(wei: string | number | bigint): string {
    const GWEI = 10 ** 9;
    const ETHER = BigInt(10) ** BigInt(ETH_PRECISION);
    wei = BigInt(wei);
    if (wei < BigInt(GWEI) / BigInt(10)) return wei + 'wei';
    // This branch scales by gwei (nanoether), not by microether.
    if (wei >= BigInt(GWEI) && wei < ETHER / BigInt(1000))
      return formatters.formatBigint(wei, BigInt(GWEI), 9, false) + 'gwei';
    return formatters.formatBigint(wei, ETHER, ETH_PRECISION, false) + 'eth';
  },
});
