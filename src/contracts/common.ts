import * as abi from '../web3.js';

export function addHint(abi: abi.ContractABI, name: string, fn: abi.HintFn) {
  for (let elm of abi) {
    if (elm.type !== 'function' && elm.type !== 'event') continue;
    if (elm.name === name) (elm as any).hint = fn;
  }
}

export function addHints(abi: abi.ContractABI, map: Record<string, abi.HintFn>) {
  Object.keys(map).forEach((name) => {
    addHint(abi, name, map[name]);
  });
}

export function addHook(abi: abi.ContractABI, name: string, fn: abi.HookFn) {
  for (let elm of abi) {
    if (elm.type !== 'function') continue;
    if (elm.name === name) (elm as any).hook = fn;
  }
}
