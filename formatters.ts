export function parseDecimal(s: string, precision: number): bigint {
  let neg = false;
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  }
  let sep = s.indexOf('.');
  sep = sep === -1 ? s.length : sep;
  const [intS, fracS] = [s.slice(0, sep), s.slice(sep + 1)];
  const int = BigInt(intS) * 10n ** BigInt(precision);
  const fracLen = Math.min(fracS.length, precision);
  const frac = BigInt(fracS.slice(0, fracLen)) * 10n ** BigInt(precision - fracLen);
  const value = int + frac;
  return neg ? -value : value;
}

export function formatDecimal(n: bigint, precision: number): string {
  let s = (n < 0n ? -n : n).toString(10);
  let sep = s.length - precision;
  if (sep < 0) {
    s = s.padStart(s.length - sep, '0');
    sep = 0;
  }
  let i = s.length - 1;
  for (; i >= sep && s[i] === '0'; i--);
  let [int, frac] = [s.slice(0, sep), s.slice(sep, i + 1)];
  if (!int) int = '0';
  if (n < 0n) int = '-' + int;
  if (!frac) return int;
  return `${int}.${frac}`;
}

// returns decimal that costs exactly $0.01 in given precision (using price)
// formatDecimal(perCentDecimal(prec, price), prec) * price == '0.01'
export function perCentDecimal(precision: number, price: number): bigint {
  const fiatPrec = 18;
  //x * price = 0.01
  //x = 0.01/price = 1/100 / price = 1/(100*price)
  // float has not enough precision
  const totalPrice = parseDecimal('' + price, fiatPrec);
  const centPrice = parseDecimal('0.01', fiatPrec) * 10n ** BigInt(precision);
  return centPrice / totalPrice;
}
/**
 * Reduces decimal precision. We can't just round to some arbitrary value like 0.01.
 * People care mostly about 2-3 most significant digits:
 *   - 123 456 -> 123 000
 *   - 12 345 -> 12 300
 *   - 2.5678 -> 2.56
 *   - 143.43 -> 143.00
 *   - 15.43 -> 15.40
 *
 * Anything with value of less than 0.01 is not important: 0.001 == 0.00, even if these are
 * 2-3 most significant digits. Should we round non-significant digits such as 123.90 -> 124.00,
 * 123.40 -> 123.00? It's OK for displaying total balance of an account: we use 2-3 significant
 * digits. It's NOT OK for creating txs with the amount, you can't do 2.00 tx if you have 1.99.
 * @example
 *   roundDecimal(699999n, 5), 699990n
 */
export function roundDecimal(
  n: bigint,
  roundPrecision: number,
  precision?: number,
  price?: number
): bigint {
  if (price && precision) {
    const perCent = perCentDecimal(precision, price).toString();
    if (perCent.length) {
      const perCentShift = 10n ** BigInt(perCent.length - 1);
      // decimal shift:  (n >> shift) << shift, to clean least significant digits
      n = (n / perCentShift) * perCentShift;
    }
  }
  const len = n.toString().length;
  const digits = BigInt(len - Math.min(roundPrecision, len));
  const divider = 10n ** digits;
  return (n / divider) * divider;
}

function sameFraction(first: string, second: string) {
  first = first.replace(/0+$/, '');
  second = second.replace(/0+$/, '');
  return BigInt(`1${first}`) === BigInt(`1${second}`);
}

function formatBigint(amount: bigint, base: bigint, precision: number, fixed = false) {
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

  const prefix = sameFraction(fractionAfterPrecision, fraction) ? '' : '~';
  return `${prefix}${whole}.${fractionAfterPrecision}`;
}

export function fromWei(wei: string | number | bigint) {
  const GWEI = 10 ** 9;
  const MICROETH = 10n ** 12n;
  const ETHER = 10n ** 18n;
  wei = BigInt(wei);
  if (wei < BigInt(GWEI) / 10n) {
    return wei + 'wei';
  }
  if (wei >= BigInt(GWEI) / 10n && wei < MICROETH) {
    return formatBigint(wei, BigInt(GWEI), 9, false) + 'gwei';
  }
  if (wei >= MICROETH && wei < ETHER / 1000n) {
    return formatBigint(wei, MICROETH, 12, false) + 'μeth';
  }
  return formatBigint(wei, ETHER, 18, false) + 'eth';
}

const nfmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export function formatUSD(amount: number) {
  return nfmt.format(amount).replace(/\.00$/, '');
}
