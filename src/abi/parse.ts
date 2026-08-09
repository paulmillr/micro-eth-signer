import type { FnArg, ParsedABI } from './decoder.ts';

/*
Human-readable ABI parsing: 'function transfer(address to, uint256 amount) returns (bool)'
-> JSON ABI item. Runtime-only: unlike `as const` JSON ABIs, parsed ABIs don't carry
per-method types, so createContract/events return string-indexed method records for them.
Struct declarations are not supported; use inline tuples: '(address a, uint256 b) param'.
*/

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const ARRAY_SUFFIX_RE = /^(?:\[\d*\])*/;
// Data location & visibility words are solidity-only noise in signatures.
const SKIPPED_MODIFIERS = new Set(['memory', 'calldata', 'storage', 'payable']);
const FN_MODIFIERS = new Set(['public', 'external', 'virtual', 'override']);
const MUTABILITY = new Set(['pure', 'view', 'payable', 'nonpayable']);

function assertValidType(type: string): void {
  const base = type.replace(/(?:\[\d*\])+$/, '');
  if (['address', 'bool', 'string', 'bytes', 'function'].includes(base)) return;
  let m = base.match(/^bytes(\d+)$/);
  if (m && +m[1] >= 1 && +m[1] <= 32) return;
  m = base.match(/^u?int(\d+)$/);
  if (m && +m[1] >= 8 && +m[1] <= 256 && +m[1] % 8 === 0) return;
  throw new Error(
    `parseAbi: unknown type "${type}" (struct references are not supported, use an inline tuple)`
  );
}

// 'uint' -> 'uint256', 'int[2]' -> 'int256[2]': selectors require canonical types.
function normalizeType(type: string): string {
  const m = type.match(/^(u?int)((?:\[\d*\])*)$/);
  return m ? `${m[1]}256${m[2]}` : type;
}

// Index of the ')' matching the '(' at `start`.
function findMatching(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  throw new Error(`parseAbi: unbalanced parentheses in "${s}"`);
}

// Split on top-level commas only; tuples keep their inner commas.
function splitParams(s: string): string[] {
  const res: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') {
      if (--depth < 0) throw new Error(`parseAbi: unbalanced parentheses in "${s}"`);
    } else if (c === ',' && depth === 0) {
      res.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) throw new Error(`parseAbi: unbalanced parentheses in "${s}"`);
  res.push(s.slice(start));
  const trimmed = res.map((i) => i.trim());
  if (trimmed.length === 1 && trimmed[0] === '') return [];
  if (trimmed.some((i) => i === '')) throw new Error(`parseAbi: empty parameter in "${s}"`);
  return trimmed;
}

// '[indexed] [memory|calldata|...] [name]' after a type
function parseTrailer(
  tokens: string[],
  allowIndexed: boolean,
  src: string
): { indexed: boolean; name?: string } {
  let indexed = false;
  let name: string | undefined;
  for (const token of tokens) {
    if (token === 'indexed') {
      if (!allowIndexed) throw new Error(`parseAbi: "indexed" outside of event in "${src}"`);
      if (indexed || name !== undefined) throw new Error(`parseAbi: wrong parameter "${src}"`);
      indexed = true;
    } else if (SKIPPED_MODIFIERS.has(token)) {
      if (name !== undefined) throw new Error(`parseAbi: wrong parameter "${src}"`);
    } else if (IDENT_RE.test(token)) {
      if (name !== undefined) throw new Error(`parseAbi: two names in parameter "${src}"`);
      name = token;
    } else throw new Error(`parseAbi: wrong token "${token}" in "${src}"`);
  }
  return { indexed, name };
}

function parseParam(s: string, allowIndexed: boolean): FnArg {
  s = s.trim();
  // `payable` qualifies the address, while its array suffix is part of the canonical ABI type.
  s = s.replace(/^address\s+payable(?=\[)/, 'address');
  if (s.startsWith('(')) {
    const end = findMatching(s, 0);
    const components = splitParams(s.slice(1, end)).map((i) => parseParam(i, false));
    if (!components.length) throw new Error(`parseAbi: empty tuple in "${s}"`);
    const afterTuple = s.slice(end + 1);
    const suffix = afterTuple.match(ARRAY_SUFFIX_RE)![0];
    const rest = afterTuple.slice(suffix.length).trim();
    const { indexed, name } = parseTrailer(rest ? rest.split(/\s+/) : [], allowIndexed, s);
    const res: Record<string, unknown> = { type: `tuple${suffix}`, components };
    if (name !== undefined) res.name = name;
    if (indexed) res.indexed = true;
    return res as FnArg;
  }
  const tokens = s.split(/\s+/).filter((i) => i !== '');
  if (!tokens.length) throw new Error(`parseAbi: empty parameter in "${s}"`);
  const type = normalizeType(tokens[0]);
  assertValidType(type);
  const { indexed, name } = parseTrailer(tokens.slice(1), allowIndexed, s);
  const res: Record<string, unknown> = { type };
  if (name !== undefined) res.name = name;
  if (indexed) res.indexed = true;
  return res as FnArg;
}

function parseModifierTokens(s: string, src: string): { stateMutability?: string } {
  let stateMutability: string | undefined;
  for (const token of s.split(/\s+/).filter((i) => i !== '')) {
    if (MUTABILITY.has(token)) {
      if (stateMutability !== undefined)
        throw new Error(`parseAbi: two mutability modifiers in "${src}"`);
      stateMutability = token;
    } else if (!FN_MODIFIERS.has(token))
      throw new Error(`parseAbi: wrong modifier "${token}" in "${src}"`);
  }
  return stateMutability !== undefined ? { stateMutability } : {};
}

/**
 * Parses a single human-readable ABI signature into a JSON ABI item.
 * Supports `function`, `event`, `error`, `constructor`, `fallback`, and `receive`.
 * @example
 * ```ts
 * parseAbiItem('function transfer(address to, uint256 amount) returns (bool)');
 * parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
 * parseAbiItem('error InsufficientBalance(uint256 available, uint256 required)');
 * ```
 */
export function parseAbiItem(signature: string): ParsedABI[number] {
  if (typeof signature !== 'string')
    throw new TypeError('"signature" expected string, got type=' + typeof signature);
  const src = signature.trim();
  let m: RegExpMatchArray | null;
  if ((m = src.match(/^(fallback|receive)\s*\(\s*\)\s*(.*)$/))) {
    const mods = parseModifierTokens(m[2].replace(/\bexternal\b/g, ' '), src);
    // JSON ABI keeps fallback/receive mutability just like function mutability.
    return { type: m[1], ...mods } as ParsedABI[number];
  }
  if ((m = src.match(/^constructor\s*\(/))) {
    const open = src.indexOf('(');
    const close = findMatching(src, open);
    const inputs = splitParams(src.slice(open + 1, close)).map((i) => parseParam(i, false));
    const mods = parseModifierTokens(src.slice(close + 1), src);
    const res: Record<string, unknown> = { type: 'constructor', ...mods };
    if (inputs.length) res.inputs = inputs;
    return res as ParsedABI[number];
  }
  if (!(m = src.match(/^(function|event|error)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/)))
    throw new Error(`parseAbi: wrong signature "${src}"`);
  const kind = m[1];
  const name = m[2];
  const open = src.indexOf('(', m[1].length);
  const close = findMatching(src, open);
  const inputs = splitParams(src.slice(open + 1, close)).map((i) =>
    parseParam(i, kind === 'event')
  );
  let tail = src.slice(close + 1).trim();
  const res: Record<string, unknown> = { type: kind, name };
  if (kind === 'event') {
    if (tail === 'anonymous') {
      res.anonymous = true;
      tail = '';
    }
    if (tail !== '') throw new Error(`parseAbi: wrong event trailer "${tail}"`);
    res.inputs = inputs;
    return res as ParsedABI[number];
  }
  if (kind === 'error') {
    if (tail !== '') throw new Error(`parseAbi: wrong error trailer "${tail}"`);
    if (inputs.length) res.inputs = inputs;
    return res as ParsedABI[number];
  }
  // function: '[modifiers] [returns (outputs)]'
  const retIdx = tail.search(/\breturns\b/);
  if (retIdx >= 0) {
    let ret = tail.slice(retIdx + 'returns'.length).trim();
    tail = tail.slice(0, retIdx);
    if (!ret.startsWith('(') || findMatching(ret, 0) !== ret.length - 1)
      throw new Error(`parseAbi: wrong returns clause in "${src}"`);
    const outputs = splitParams(ret.slice(1, -1)).map((i) => parseParam(i, false));
    if (outputs.length) res.outputs = outputs;
  }
  Object.assign(res, parseModifierTokens(tail, src));
  if (inputs.length) res.inputs = inputs;
  return res as ParsedABI[number];
}

/**
 * Parses human-readable ABI signatures into a JSON ABI.
 * NOTE: unlike `as const` JSON ABIs, the result carries no per-method types:
 * `createContract(parseAbi([...]))` returns a string-indexed record of untyped methods.
 * @example
 * ```ts
 * const abi = parseAbi([
 *   'function balanceOf(address owner) view returns (uint256)',
 *   'event Transfer(address indexed from, address indexed to, uint256 value)',
 * ]);
 * ```
 */
export function parseAbi(signatures: readonly string[]): ParsedABI {
  if (!Array.isArray(signatures))
    throw new TypeError('"signatures" expected array, got type=' + typeof signatures);
  return signatures.map(parseAbiItem) as ParsedABI;
}
