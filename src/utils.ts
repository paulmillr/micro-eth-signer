import { isBytes as _isBytes, hexToBytes as _hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { Coder, coders } from 'micro-packed';

export const isBytes = _isBytes;

// There is no network code in the library.
// The types are used to check external network provider interfaces.
export type Web3CallArgs = Partial<{
  to: string;
  from: string;
  data: string;
  nonce: string;
  value: string;
  gas: string;
  gasPrice: string;
  tag: number | 'latest' | 'earliest' | 'pending';
}>;

export type IWeb3Provider = {
  ethCall: (args: Web3CallArgs) => Promise<string>;
  estimateGas: (args: Web3CallArgs) => Promise<bigint>;
  call: (method: string, ...args: any[]) => Promise<any>;
};

const ETH_PRECISION = 18;
const GWEI_PRECISION = 9;
const GWEI = BigInt(10) ** BigInt(GWEI_PRECISION);
const ETHER = BigInt(10) ** BigInt(ETH_PRECISION);
export const amounts = /* @__PURE__ */ (() => ({
  GWEI_PRECISION,
  ETH_PRECISION,
  GWEI,
  ETHER,
  // Disabled with "strict=false"
  maxAmount: BigInt(1_000_000) * ETHER, // 1M ether for testnets
  minGasLimit: BigInt(21_000), // 21K wei is used at minimum. Possibly smaller gas limit in 4844 txs?
  maxGasLimit: BigInt(30_000_000), // 30M wei. A block limit in 2024 is 30M
  maxGasPrice: BigInt(10_000) * GWEI, // 10K gwei. Arbitrage HFT bots can use more
  maxNonce: BigInt(131_072), // 2**17, but in spec it's actually 2**64-1
  maxDataSize: 1_000_000, // Size of .data field. TODO: research
  maxInitDataSize: 49_152, // EIP-3860
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
const genEthHex = (keepLeadingZero = true): Coder<Uint8Array, string> => ({
  decode: (data: string): Uint8Array => {
    if (typeof data !== 'string') throw new Error('hex data must be a string');
    let hex = strip0x(data);
    hex = hex.length & 1 ? `0${hex}` : hex;
    return _hexToBytes(hex);
  },
  encode: (data: Uint8Array): string => {
    let hex = bytesToHex(data);
    if (!keepLeadingZero) hex = hex.replace(leadingZerosRe, '');
    return add0x(hex);
  },
});
export const ethHex = /* @__PURE__ */ genEthHex(true);
export const ethHexNoLeadingZero = /* @__PURE__ */ genEthHex(false);

const ethHexStartRe = /^0[xX]/;
export function add0x(hex: string): string {
  return ethHexStartRe.test(hex) ? hex : `0x${hex}`;
}

export function strip0x(hex: string): string {
  return hex.replace(ethHexStartRe, '');
}

export function numberTo0xHex(num: number | bigint): string {
  const hex = num.toString(16);
  const x2 = hex.length & 1 ? `0${hex}` : hex;
  return add0x(x2);
}

export function hexToNumber(hex: string): bigint {
  if (typeof hex !== 'string') throw new TypeError('expected hex string, got ' + typeof hex);
  return hex ? BigInt(add0x(hex)) : BigInt(0);
}

export function isObject(item: unknown): item is Record<string, any> {
  return item != null && typeof item === 'object';
}

export function astr(str: unknown) {
  if (typeof str !== 'string') throw new Error('string expected');
}

export function cloneDeep<T>(obj: T): T {
  if (isBytes(obj)) {
    return Uint8Array.from(obj) as T;
  } else if (Array.isArray(obj)) {
    return obj.map(cloneDeep) as unknown as T;
  } else if (typeof obj === 'bigint') {
    return BigInt(obj) as unknown as T;
  } else if (typeof obj === 'object') {
    // should be last, so it won't catch other types
    let res: any = {};
    // TODO: hasOwnProperty?
    for (let key in obj) res[key] = cloneDeep(obj[key]);
    return res;
  } else return obj;
}

export function omit<T extends object, K extends Extract<keyof T, string>>(
  obj: T,
  ...keys: K[]
): Omit<T, K> {
  let res: any = Object.assign({}, obj);
  for (let key of keys) delete res[key];
  return res;
}

export function zip<A, B>(a: A[], b: B[]): [A, B][] {
  let res: [A, B][] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) res.push([a[i], b[i]]);
  return res;
}

export const createDecimal = coders.decimal;
export const weieth = createDecimal(ETH_PRECISION);
export const weigwei = createDecimal(GWEI_PRECISION);

// legacy. TODO: remove
export const ethDecimal = weieth;
export const gweiDecimal = weigwei;

export const formatters = {
  // returns decimal that costs exactly $0.01 in given precision (using price)
  // formatDecimal(perCentDecimal(prec, price), prec) * price == '0.01'
  perCentDecimal(precision: number, price: number): bigint {
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
    return `${prefix}${whole}.${fractionAfterPrecision}`;
  },

  fromWei(wei: string | number | bigint) {
    const GWEI = 10 ** 9;
    const ETHER = BigInt(10) ** BigInt(ETH_PRECISION);
    wei = BigInt(wei);
    if (wei < BigInt(GWEI) / BigInt(10)) return wei + 'wei';
    if (wei >= BigInt(GWEI) && wei < ETHER / BigInt(1000))
      return formatters.formatBigint(wei, BigInt(GWEI), 9, false) + 'μeth';
    return formatters.formatBigint(wei, ETHER, ETH_PRECISION, false) + 'eth';
  },
};
