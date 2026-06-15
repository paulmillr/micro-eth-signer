import { deepFreeze } from '../utils.ts';

// prettier-ignore
const _ABI = /* @__PURE__ */ deepFreeze([
  {type:"function",name:"getExpectedRate",inputs:[{name:"src",type:"address"},{name:"dest",type:"address"},{name:"srcQty",type:"uint256"}],outputs:[{name:"expectedRate",type:"uint256"},{name:"worstRate",type:"uint256"}]},{type:"function",name:"getExpectedRateAfterFee",inputs:[{name:"src",type:"address"},{name:"dest",type:"address"},{name:"srcQty",type:"uint256"},{name:"platformFeeBps",type:"uint256"},{name:"hint",type:"bytes"}],outputs:[{name:"expectedRate",type:"uint256"}]},{type:"function",name:"trade",inputs:[{name:"src",type:"address"},{name:"srcAmount",type:"uint256"},{name:"dest",type:"address"},{name:"destAddress",type:"address"},{name:"maxDestAmount",type:"uint256"},{name:"minConversionRate",type:"uint256"},{name:"platformWallet",type:"address"}],outputs:[{type:"uint256"}]},{type:"function",name:"tradeWithHint",inputs:[{name:"src",type:"address"},{name:"srcAmount",type:"uint256"},{name:"dest",type:"address"},{name:"destAddress",type:"address"},{name:"maxDestAmount",type:"uint256"},{name:"minConversionRate",type:"uint256"},{name:"walletId",type:"address"},{name:"hint",type:"bytes"}],outputs:[{type:"uint256"}]},{type:"function",name:"tradeWithHintAndFee",inputs:[{name:"src",type:"address"},{name:"srcAmount",type:"uint256"},{name:"dest",type:"address"},{name:"destAddress",type:"address"},{name:"maxDestAmount",type:"uint256"},{name:"minConversionRate",type:"uint256"},{name:"platformWallet",type:"address"},{name:"platformFeeBps",type:"uint256"},{name:"hint",type:"bytes"}],outputs:[{name:"destAmount",type:"uint256"}]}
] as const);

export default _ABI;
export const KYBER_NETWORK_PROXY_CONTRACT = '0x9aab3f75489902f3a48495025729a0af77d4b11e';
