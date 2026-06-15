import type { ContractABI, HintFn, HookFn } from './abi-decoder.ts';
import type { TArg } from '../utils.ts';

export function addHint<T extends ContractABI>(abi: T, name: string, fn: TArg<HintFn>): T {
  const res = [];
  for (const elm of abi) {
    if (elm.type === 'event' && elm.name === name) res.push({ ...elm, hint: fn });
    else res.push(elm);
  }
  return res as unknown as T;
}

export function addHints<T extends ContractABI>(abi: T, map: TArg<Record<string, HintFn>>): T {
  const res = [];
  for (const elm of abi) {
    // ABI event names can be `toString`; only explicit hint-map entries affect output.
    if (elm.type === 'event' && elm.name && Object.hasOwn(map, elm.name)) {
      res.push({ ...elm, hint: map[elm.name!] });
    } else res.push(elm);
  }
  return res as unknown as T;
}

export function addHook<T extends ContractABI>(abi: T, name: string, fn: TArg<HookFn>): T {
  const res = [];
  for (const elm of abi) {
    if (elm.type === 'function' && elm.name === name) res.push({ ...elm, hook: fn });
    else res.push(elm);
  }
  return res as unknown as T;
}
