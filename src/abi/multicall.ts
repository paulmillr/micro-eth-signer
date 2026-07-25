import { deepFreeze } from '../utils.ts';

/**
 * Canonical Multicall3 deployment address, identical on most chains.
 * https://www.multicall3.com
 */
export const MULTICALL3: string = '0xcA11bde05977b3631167028862bE2a173976CA11';

// prettier-ignore
const _abi = () => [
  {type:"function",name:"aggregate3",inputs:[{name:"calls",type:"tuple[]",components:[{name:"target",type:"address"},{name:"allowFailure",type:"bool"},{name:"callData",type:"bytes"}]}],outputs:[{name:"returnData",type:"tuple[]",components:[{name:"success",type:"bool"},{name:"returnData",type:"bytes"}]}]}
] as const;
type ABI = ReturnType<typeof _abi>;
export const MULTICALL3_ABI: ABI = /* @__PURE__ */ deepFreeze(/* @__PURE__ */ _abi());
export default MULTICALL3_ABI;
