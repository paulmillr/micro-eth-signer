import { createDecimal, deepFreeze, type TArg } from '../utils.ts';
import { addHints } from './abi-common.ts';
import { type HintOpt } from './abi-decoder.ts';

// Includes legacy nonstandard aliases (`balances`, `allowed`) so the shared decoder
// can still recognize older ERC-20-like contracts.
// prettier-ignore
const _abi = () => [
  {type:"function",name:"name",outputs:[{type:"string"}]},{type:"function",name:"totalSupply",outputs:[{type:"uint256"}]},{type:"function",name:"decimals",outputs:[{type:"uint8"}]},{type:"function",name:"symbol",outputs:[{type:"string"}]},{type:"function",name:"approve",inputs:[{name:"spender",type:"address"},{name:"value",type:"uint256"}],outputs:[{name:"success",type:"bool"}]},{type:"function",name:"transferFrom",inputs:[{name:"from",type:"address"},{name:"to",type:"address"},{name:"value",type:"uint256"}],outputs:[{name:"success",type:"bool"}]},{type:"function",name:"balances",inputs:[{type:"address"}],outputs:[{type:"uint256"}]},{type:"function",name:"allowed",inputs:[{type:"address"},{type:"address"}],outputs:[{type:"uint256"}]},{type:"function",name:"balanceOf",inputs:[{name:"owner",type:"address"}],outputs:[{name:"balance",type:"uint256"}]},{type:"function",name:"transfer",inputs:[{name:"to",type:"address"},{name:"value",type:"uint256"}],outputs:[{name:"success",type:"bool"}]},{type:"function",name:"allowance",inputs:[{name:"owner",type:"address"},{name:"spender",type:"address"}],outputs:[{name:"remaining",type:"uint256"}]},{name:"Approval",type:"event",anonymous:false,inputs:[{indexed:true,name:"owner",type:"address"},{indexed:true,name:"spender",type:"address"},{indexed:false,name:"value",type:"uint256"}]},{name:"Transfer",type:"event",anonymous:false,inputs:[{indexed:true,name:"from",type:"address"},{indexed:true,name:"to",type:"address"},{indexed:false,name:"value",type:"uint256"}]}
] as const;
type ABI = ReturnType<typeof _abi>;
export const ABI: ABI = /* @__PURE__ */ deepFreeze(/* @__PURE__ */ _abi());

const meta = (opt: TArg<HintOpt>): { decimals: number; symbol: string } => {
  const info = opt.contractInfo;
  if (!info || info.decimals === undefined || !info.symbol) throw new Error('Not enough info');
  return { decimals: info.decimals, symbol: info.symbol };
};
export const hints = {
  Approval(v: any, opt: TArg<HintOpt>) {
    const m = meta(opt);
    return `Allow ${v.spender} spending up to ${createDecimal(m.decimals).encode(v.value)} ${
      m.symbol
    } from ${v.owner}`;
  },
  Transfer(v: any, opt: TArg<HintOpt>) {
    const m = meta(opt);
    return `Transfer ${createDecimal(m.decimals).encode(v.value)} ${m.symbol} from ${v.from} to ${
      v.to
    }`;
  },
};

// Keep default export on a distinct value; `ABI` is also a type under verbatimModuleSyntax.
const ERC20ABI: ABI = /* @__PURE__ */ deepFreeze(/* @__PURE__ */ addHints(ABI, hints));
export default ERC20ABI;
