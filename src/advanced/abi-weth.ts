import { deepFreeze, type TArg } from '../utils.ts';
import { addHints } from './abi-common.ts';
import { type HintOpt } from './abi-decoder.ts';
import { hints as erc20hints } from './abi-erc20.ts';

// Canonical WETH9 ABI: archive.ts and named-object wrappers depend on the legacy
// `src` / `dst` / `guy` / `wad` field names plus explicit Deposit/Withdrawal events.
// prettier-ignore
const _abi = () => [
  {constant:true,inputs:[],name:"name",outputs:[{name:"",type:"string"}],payable:false,stateMutability:"view",type:"function"},{constant:false,inputs:[{name:"guy",type:"address"},{name:"wad",type:"uint256"}],name:"approve",outputs:[{name:"",type:"bool"}],payable:false,stateMutability:"nonpayable",type:"function"},{constant:true,inputs:[],name:"totalSupply",outputs:[{name:"",type:"uint256"}],payable:false,stateMutability:"view",type:"function"},{constant:false,inputs:[{name:"src",type:"address"},{name:"dst",type:"address"},{name:"wad",type:"uint256"}],name:"transferFrom",outputs:[{name:"",type:"bool"}],payable:false,stateMutability:"nonpayable",type:"function"},{constant:false,inputs:[{name:"wad",type:"uint256"}],name:"withdraw",outputs:[],payable:false,stateMutability:"nonpayable",type:"function"},{constant:true,inputs:[],name:"decimals",outputs:[{name:"",type:"uint8"}],payable:false,stateMutability:"view",type:"function"},{constant:true,inputs:[{name:"",type:"address"}],name:"balanceOf",outputs:[{name:"",type:"uint256"}],payable:false,stateMutability:"view",type:"function"},{constant:true,inputs:[],name:"symbol",outputs:[{name:"",type:"string"}],payable:false,stateMutability:"view",type:"function"},{constant:false,inputs:[{name:"dst",type:"address"},{name:"wad",type:"uint256"}],name:"transfer",outputs:[{name:"",type:"bool"}],payable:false,stateMutability:"nonpayable",type:"function"},{constant:false,inputs:[],name:"deposit",outputs:[],payable:true,stateMutability:"payable",type:"function"},{constant:true,inputs:[{name:"",type:"address"},{name:"",type:"address"}],name:"allowance",outputs:[{name:"",type:"uint256"}],payable:false,stateMutability:"view",type:"function"},{payable:true,stateMutability:"payable",type:"fallback"},{anonymous:false,inputs:[{indexed:true,name:"src",type:"address"},{indexed:true,name:"guy",type:"address"},{indexed:false,name:"wad",type:"uint256"}],name:"Approval",type:"event"},{anonymous:false,inputs:[{indexed:true,name:"src",type:"address"},{indexed:true,name:"dst",type:"address"},{indexed:false,name:"wad",type:"uint256"}],name:"Transfer",type:"event"},{anonymous:false,inputs:[{indexed:true,name:"dst",type:"address"},{indexed:false,name:"wad",type:"uint256"}],name:"Deposit",type:"event"},{anonymous:false,inputs:[{indexed:true,name:"src",type:"address"},{indexed:false,name:"wad",type:"uint256"}],name:"Withdrawal",type:"event"}
] as const;
type ABI = ReturnType<typeof _abi>;
const _ABI: ABI = /* @__PURE__ */ deepFreeze(/* @__PURE__ */ _abi());

// WETH9 keeps legacy names as public ABI keys; map locally so generic ERC-20
// hints stay strict.
const _hints = () => ({
  approve: (v: any, opt: TArg<HintOpt>): string =>
    erc20hints.approve({ spender: v.guy, value: v.wad }, opt),
  transferFrom: (v: any, opt: TArg<HintOpt>): string =>
    erc20hints.transferFrom({ from: v.src, to: v.dst, value: v.wad }, opt),
  transfer: (v: any, opt: TArg<HintOpt>): string =>
    erc20hints.transfer({ to: v.dst, value: v.wad }, opt),
  Approval: (v: any, opt: TArg<HintOpt>): string =>
    erc20hints.Approval({ owner: v.src, spender: v.guy, value: v.wad }, opt),
  Transfer: (v: any, opt: TArg<HintOpt>): string =>
    erc20hints.Transfer({ from: v.src, to: v.dst, value: v.wad }, opt),
});
type Hints = ReturnType<typeof _hints>;
const hints: Hints = /* @__PURE__ */ _hints();

const ABI: ABI = /* @__PURE__ */ deepFreeze(/* @__PURE__ */ addHints(_ABI, hints));
export default ABI;
// Mainnet WETH9 address used by the built-in token registry and WETH-specific decode helpers.
export const WETH_CONTRACT = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
