import { ContractABI, HintFn, HookFn } from './decoder.js';

export function addHint(abi: ContractABI, name: string, fn: HintFn) {
  for (let elm of abi) {
    if (elm.type !== 'function' && elm.type !== 'event') continue;
    if (elm.name === name) (elm as any).hint = fn;
  }
}

export function addHints(abi: ContractABI, map: Record<string, HintFn>) {
  Object.keys(map).forEach((name) => {
    addHint(abi, name, map[name]);
  });
}

export function addHook(abi: ContractABI, name: string, fn: HookFn) {
  for (let elm of abi) {
    if (elm.type !== 'function') continue;
    if (elm.name === name) (elm as any).hook = fn;
  }
}
