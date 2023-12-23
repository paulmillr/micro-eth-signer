import { Address, RawTxMap, add0x } from './index.js';
import { parseDecimal } from './formatters.js';

export type Unit = 'eth' | 'wei' | 'gwei';
type SNB = string | number | bigint;
export type HumanizedTx = {
  from?: string;
  to: string;
  value: SNB;
  maxFeePerGas: SNB;
  maxPriorityFeePerGas: SNB;
  nonce: SNB;
  data?: string;
  gasLimit?: SNB;
  amountUnit?: Unit;
  maxFeePerGasUnit?: Unit;
  maxPriorityFeePerGasUnit?: Unit;
  chainId?: number;
};

const GWEI_PRECISION = 9;
const ETHER_PRECISION = 18;
const GWEI = 10n ** BigInt(GWEI_PRECISION);
const ETHER = 10n ** BigInt(ETHER_PRECISION);
// const MICROETH = 10n ** 12n;

const MAX_AMOUNT = ETHER * 100000000n; // 100m ether
const MAX_GAS_PRICE = Number(GWEI * 10000n); // 10,000 gwei. Arbitrage HFT bots can use more.
// etherscan.io/chart/gasprice
const MIN_GAS_LIMIT = 21000;
const MAX_GAS_LIMIT = 20000000; // 20m wei. It's dynamic; a block limit in 2021 is 12m.
const MAX_NONCE = 10000000; // 10M
const MAX_DATA_SIZE = 10000000;

function minmax(val: bigint, min: bigint, max: bigint, err?: string): true | string;
function minmax(val: number, min: number, max: number, err?: string): true | string;
function minmax(
  val: number | bigint,
  min: number | bigint,
  max: number | bigint,
  err?: string
): true | string {
  if (!err) err = `>= ${min} and <= ${max}`;
  if (Number.isNaN(val) || val < min || val > max) throw new Error(`Must be ${err}`);
  return true;
}

function ensureNot16x(val: SNB, isBig = false) {
  if (typeof val === 'string' && val.startsWith('0x')) {
    return isBig ? BigInt(val) : Number.parseInt(val, 16);
  }
  return val;
}

const checks = {
  nonce(num: number) {
    return minmax(num, 0, MAX_NONCE);
  },
  maxFeePerGas(num: number) {
    return minmax(num, 1, MAX_GAS_PRICE, '>= 1 wei and < 10000 gwei');
  },
  maxPriorityFeePerGas(num: number) {
    return minmax(num, 0, MAX_GAS_PRICE, '>= 1 wei and < 10000 gwei');
  },
  gasLimit(num: number) {
    return minmax(num, MIN_GAS_LIMIT, MAX_GAS_LIMIT);
  },
  to(addr: string) {
    if (addr.length !== 40 && addr.length !== 42)
      throw new Error('Address length must be 40 or 42 symbols');
    addr = add0x(addr);
    if (!/^0x[0-9a-f]+$/i.test(addr)) throw new Error('Address must be hex');
    if (!Address.verifyChecksum(addr)) throw new Error('Address checksum does not match');
    return true;
  },
  value(num: bigint) {
    return minmax(num, 0n, MAX_AMOUNT, '>= 0 and < 100M eth');
  },
  data(val?: string) {
    if (typeof val === 'string' && val.length > MAX_DATA_SIZE) throw new Error('Data is too big');
    return true;
  },
  chainId(num?: number) {
    if (!num) return true;
    return minmax(num, 1, 2 ** 32 - 1, '>= 1 and <= 2**32-1');
  },
};

function parseHex(val: string) {
  if (val === '0x') val = '0x00';
  return Number.parseInt(val, 16);
}

export function parseUnit(val: SNB, unit: Unit) {
  const str = ensureNot16x(val, true).toString();
  if (unit === 'wei') return BigInt(str);
  let precision: number;
  if (unit === 'gwei') precision = GWEI_PRECISION;
  else if (unit === 'eth') precision = ETHER_PRECISION;
  else throw new Error(`Wrong unit name: ${unit}`);
  return parseDecimal(str, precision);
}

// Raw transaction to humanized
const r2h = {
  nonce: parseHex,
  maxFeePerGas: parseHex,
  gasLimit: parseHex,
  to: (val: string): string => Address.checksum(val),
  value: (val: string): bigint => BigInt(val),
  data: (val: string): string => val,
  chainId: (val: string): number => (val ? parseHex(val) : 1),
};

// Humanized to raw.
const h2r = {
  nonce(val: SNB): number {
    return Number.parseInt(ensureNot16x(val).toString());
  },
  maxFeePerGas(val: SNB, opts?: Partial<HumanizedTx>): bigint {
    return parseUnit(val, (opts && opts.maxFeePerGasUnit) || 'gwei');
  },
  maxPriorityFeePerGas(val: SNB, opts?: Partial<HumanizedTx>): bigint {
    return parseUnit(val, (opts && opts.maxPriorityFeePerGasUnit) || 'gwei');
  },
  gasLimit(val: SNB): number {
    return Number.parseInt(ensureNot16x(val).toString()) || MIN_GAS_LIMIT;
  },
  to(val: string, opts?: Partial<HumanizedTx>): string {
    if (opts && opts.from && opts.from === val) throw new Error('Must differ from sender address');
    return val;
  },
  value(val: SNB, opts?: Partial<HumanizedTx>): bigint {
    return parseUnit(val, (opts && opts.amountUnit) || 'eth');
  },
  data(val?: string): string {
    return val || '';
  },
  chainId(val: string) {
    return Number.parseInt(val) || 1;
  },
};
type h2rf = keyof typeof h2r;

function hasOwnProperty<X extends {}, Y extends PropertyKey>(
  obj: X,
  prop: Y
): obj is X & Record<Y, unknown> {
  return obj.hasOwnProperty(prop);
}

function numberToHexUnpadded(num: number | bigint): string {
  let hex = num.toString(16);
  hex = hex.length & 1 ? `0${hex}` : hex;
  return hex;
}

function dataToString(snb: SNB) {
  if (snb == null) return '';
  if (typeof snb === 'string') return snb;
  if (typeof snb === 'number' || typeof snb === 'bigint') return numberToHexUnpadded(snb);
  throw new Error('Invalid type');
}

class TransactionFieldError extends Error {
  constructor(message: string, readonly errors: Record<string, string>) {
    super(message + '. ' + JSON.stringify(errors));
  }
}

const requiredFields = ['maxFeePerGas', 'maxPriorityFeePerGas', 'to', 'value', 'nonce'];
const optionFields = {
  value: ['amountUnit'],
  to: ['from'],
  maxFeePerGas: ['maxFeePerGasUnit'],
  maxPriorityFeePerGas: ['maxPriorityFeePerGasUnit'],
  chainId: [],
};
const allOptionFields = Object.values(optionFields).flat();

export function createTxMapFromFields(fields: HumanizedTx): RawTxMap {
  // prettier-ignore
  const normalized = {} as RawTxMap;
  const errors: Record<string, string> = {};
  requiredFields.forEach((f) => {
    if (fields[f as h2rf] == null) errors[f] = 'Cannot be empty';
  });
  Object.keys(fields).forEach((f) => {
    if (allOptionFields.includes(f)) return;
    const field = f as h2rf;
    const opts: Record<string, SNB> = {};
    if (hasOwnProperty(optionFields, field)) {
      const list = optionFields[field] as (keyof HumanizedTx)[];
      for (const optionalField of list) {
        const ofVal = fields[optionalField];
        if (ofVal != null) opts[optionalField] = ofVal;
      }
    }
    const val = fields[field];
    try {
      const normVal = h2r[field](val as any, opts);
      // @ts-ignore
      checks[field](normVal);
      normalized[field] = dataToString(normVal);
    } catch (error: any) {
      errors[field] = error.messages || error.message;
    }
  });

  if (Object.keys(errors).length) throw new TransactionFieldError('Invalid transaction', errors);
  Object.keys(normalized).forEach((f) => {
    const field = f as keyof RawTxMap;
    if (field === 'accessList') return;
    normalized[field] = add0x(normalized[field]!);
  });
  const raw: RawTxMap = Object.assign(
    {
      nonce: '0x',
      to: '0x',
      value: '0x',
      gasLimit: '0x5208',
      maxFeePerGas: '0x',
      data: '0x',
      v: '0x',
      r: '0x',
      s: '0x',
      chainId: 1,
    },
    normalized
  );
  return raw;
}

export function validateField(field: h2rf, val: SNB, opts?: Partial<HumanizedTx>) {
  const normVal = h2r[field](val as any, opts);
  // @ts-ignore
  checks[field](normVal);
  return dataToString(normVal);
}
export function validateFields(raw: RawTxMap) {
  Object.keys(raw).forEach((f) => {
    const field = f as keyof RawTxMap;
    if (field === 'accessList') return;
    const fn = r2h[field as keyof typeof r2h];
    if (typeof fn === 'function') {
      const value = raw[field];
      const normVal = fn(value || '');
      checks[field as keyof typeof checks](normVal as never);
    }
  });
}
