import { createDecimal, weieth } from '../utils.js';
import { HintOpt } from './decoder.js';
import { addHints } from './common.js';

// prettier-ignore
const _ABI = [
  {inputs:[{internalType:"address",name:"_factory",type:"address"},{internalType:"address",name:"_WETH",type:"address"}],stateMutability:"nonpayable",type:"constructor"},{inputs:[],name:"WETH",outputs:[{internalType:"address",name:"",type:"address"}],stateMutability:"view",type:"function"},{inputs:[{internalType:"address",name:"tokenA",type:"address"},{internalType:"address",name:"tokenB",type:"address"},{internalType:"uint256",name:"amountADesired",type:"uint256"},{internalType:"uint256",name:"amountBDesired",type:"uint256"},{internalType:"uint256",name:"amountAMin",type:"uint256"},{internalType:"uint256",name:"amountBMin",type:"uint256"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"}],name:"addLiquidity",outputs:[{internalType:"uint256",name:"amountA",type:"uint256"},{internalType:"uint256",name:"amountB",type:"uint256"},{internalType:"uint256",name:"liquidity",type:"uint256"}],stateMutability:"nonpayable",type:"function"},{inputs:[{internalType:"address",name:"token",type:"address"},{internalType:"uint256",name:"amountTokenDesired",type:"uint256"},{internalType:"uint256",name:"amountTokenMin",type:"uint256"},{internalType:"uint256",name:"amountETHMin",type:"uint256"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"}],name:"addLiquidityETH",outputs:[{internalType:"uint256",name:"amountToken",type:"uint256"},{internalType:"uint256",name:"amountETH",type:"uint256"},{internalType:"uint256",name:"liquidity",type:"uint256"}],stateMutability:"payable",type:"function"},{inputs:[],name:"factory",outputs:[{internalType:"address",name:"",type:"address"}],stateMutability:"view",type:"function"},{inputs:[{internalType:"uint256",name:"amountOut",type:"uint256"},{internalType:"uint256",name:"reserveIn",type:"uint256"},{internalType:"uint256",name:"reserveOut",type:"uint256"}],name:"getAmountIn",outputs:[{internalType:"uint256",name:"amountIn",type:"uint256"}],stateMutability:"pure",type:"function"},{inputs:[{internalType:"uint256",name:"amountIn",type:"uint256"},{internalType:"uint256",name:"reserveIn",type:"uint256"},{internalType:"uint256",name:"reserveOut",type:"uint256"}],name:"getAmountOut",outputs:[{internalType:"uint256",name:"amountOut",type:"uint256"}],stateMutability:"pure",type:"function"},{inputs:[{internalType:"uint256",name:"amountOut",type:"uint256"},{internalType:"address[]",name:"path",type:"address[]"}],name:"getAmountsIn",outputs:[{internalType:"uint256[]",name:"amounts",type:"uint256[]"}],stateMutability:"view",type:"function"},{inputs:[{internalType:"uint256",name:"amountIn",type:"uint256"},{internalType:"address[]",name:"path",type:"address[]"}],name:"getAmountsOut",outputs:[{internalType:"uint256[]",name:"amounts",type:"uint256[]"}],stateMutability:"view",type:"function"},{inputs:[{internalType:"uint256",name:"amountA",type:"uint256"},{internalType:"uint256",name:"reserveA",type:"uint256"},{internalType:"uint256",name:"reserveB",type:"uint256"}],name:"quote",outputs:[{internalType:"uint256",name:"amountB",type:"uint256"}],stateMutability:"pure",type:"function"},{inputs:[{internalType:"address",name:"tokenA",type:"address"},{internalType:"address",name:"tokenB",type:"address"},{internalType:"uint256",name:"liquidity",type:"uint256"},{internalType:"uint256",name:"amountAMin",type:"uint256"},{internalType:"uint256",name:"amountBMin",type:"uint256"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"}],name:"removeLiquidity",outputs:[{internalType:"uint256",name:"amountA",type:"uint256"},{internalType:"uint256",name:"amountB",type:"uint256"}],stateMutability:"nonpayable",type:"function"},{inputs:[{internalType:"address",name:"token",type:"address"},{internalType:"uint256",name:"liquidity",type:"uint256"},{internalType:"uint256",name:"amountTokenMin",type:"uint256"},{internalType:"uint256",name:"amountETHMin",type:"uint256"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"}],name:"removeLiquidityETH",outputs:[{internalType:"uint256",name:"amountToken",type:"uint256"},{internalType:"uint256",name:"amountETH",type:"uint256"}],stateMutability:"nonpayable",type:"function"},{inputs:[{internalType:"address",name:"token",type:"address"},{internalType:"uint256",name:"liquidity",type:"uint256"},{internalType:"uint256",name:"amountTokenMin",type:"uint256"},{internalType:"uint256",name:"amountETHMin",type:"uint256"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"}],name:"removeLiquidityETHSupportingFeeOnTransferTokens",outputs:[{internalType:"uint256",name:"amountETH",type:"uint256"}],stateMutability:"nonpayable",type:"function"},{inputs:[{internalType:"address",name:"token",type:"address"},{internalType:"uint256",name:"liquidity",type:"uint256"},{internalType:"uint256",name:"amountTokenMin",type:"uint256"},{internalType:"uint256",name:"amountETHMin",type:"uint256"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"},{internalType:"bool",name:"approveMax",type:"bool"},{internalType:"uint8",name:"v",type:"uint8"},{internalType:"bytes32",name:"r",type:"bytes32"},{internalType:"bytes32",name:"s",type:"bytes32"}],name:"removeLiquidityETHWithPermit",outputs:[{internalType:"uint256",name:"amountToken",type:"uint256"},{internalType:"uint256",name:"amountETH",type:"uint256"}],stateMutability:"nonpayable",type:"function"},{inputs:[{internalType:"address",name:"token",type:"address"},{internalType:"uint256",name:"liquidity",type:"uint256"},{internalType:"uint256",name:"amountTokenMin",type:"uint256"},{internalType:"uint256",name:"amountETHMin",type:"uint256"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"},{internalType:"bool",name:"approveMax",type:"bool"},{internalType:"uint8",name:"v",type:"uint8"},{internalType:"bytes32",name:"r",type:"bytes32"},{internalType:"bytes32",name:"s",type:"bytes32"}],name:"removeLiquidityETHWithPermitSupportingFeeOnTransferTokens",outputs:[{internalType:"uint256",name:"amountETH",type:"uint256"}],stateMutability:"nonpayable",type:"function"},{inputs:[{internalType:"address",name:"tokenA",type:"address"},{internalType:"address",name:"tokenB",type:"address"},{internalType:"uint256",name:"liquidity",type:"uint256"},{internalType:"uint256",name:"amountAMin",type:"uint256"},{internalType:"uint256",name:"amountBMin",type:"uint256"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"},{internalType:"bool",name:"approveMax",type:"bool"},{internalType:"uint8",name:"v",type:"uint8"},{internalType:"bytes32",name:"r",type:"bytes32"},{internalType:"bytes32",name:"s",type:"bytes32"}],name:"removeLiquidityWithPermit",outputs:[{internalType:"uint256",name:"amountA",type:"uint256"},{internalType:"uint256",name:"amountB",type:"uint256"}],stateMutability:"nonpayable",type:"function"},{inputs:[{internalType:"uint256",name:"amountOut",type:"uint256"},{internalType:"address[]",name:"path",type:"address[]"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"}],name:"swapETHForExactTokens",outputs:[{internalType:"uint256[]",name:"amounts",type:"uint256[]"}],stateMutability:"payable",type:"function"},{inputs:[{internalType:"uint256",name:"amountOutMin",type:"uint256"},{internalType:"address[]",name:"path",type:"address[]"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"}],name:"swapExactETHForTokens",outputs:[{internalType:"uint256[]",name:"amounts",type:"uint256[]"}],stateMutability:"payable",type:"function"},{inputs:[{internalType:"uint256",name:"amountOutMin",type:"uint256"},{internalType:"address[]",name:"path",type:"address[]"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"}],name:"swapExactETHForTokensSupportingFeeOnTransferTokens",outputs:[],stateMutability:"payable",type:"function"},{inputs:[{internalType:"uint256",name:"amountIn",type:"uint256"},{internalType:"uint256",name:"amountOutMin",type:"uint256"},{internalType:"address[]",name:"path",type:"address[]"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"}],name:"swapExactTokensForETH",outputs:[{internalType:"uint256[]",name:"amounts",type:"uint256[]"}],stateMutability:"nonpayable",type:"function"},{inputs:[{internalType:"uint256",name:"amountIn",type:"uint256"},{internalType:"uint256",name:"amountOutMin",type:"uint256"},{internalType:"address[]",name:"path",type:"address[]"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"}],name:"swapExactTokensForETHSupportingFeeOnTransferTokens",outputs:[],stateMutability:"nonpayable",type:"function"},{inputs:[{internalType:"uint256",name:"amountIn",type:"uint256"},{internalType:"uint256",name:"amountOutMin",type:"uint256"},{internalType:"address[]",name:"path",type:"address[]"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"}],name:"swapExactTokensForTokens",outputs:[{internalType:"uint256[]",name:"amounts",type:"uint256[]"}],stateMutability:"nonpayable",type:"function"},{inputs:[{internalType:"uint256",name:"amountIn",type:"uint256"},{internalType:"uint256",name:"amountOutMin",type:"uint256"},{internalType:"address[]",name:"path",type:"address[]"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"}],name:"swapExactTokensForTokensSupportingFeeOnTransferTokens",outputs:[],stateMutability:"nonpayable",type:"function"},{inputs:[{internalType:"uint256",name:"amountOut",type:"uint256"},{internalType:"uint256",name:"amountInMax",type:"uint256"},{internalType:"address[]",name:"path",type:"address[]"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"}],name:"swapTokensForExactETH",outputs:[{internalType:"uint256[]",name:"amounts",type:"uint256[]"}],stateMutability:"nonpayable",type:"function"},{inputs:[{internalType:"uint256",name:"amountOut",type:"uint256"},{internalType:"uint256",name:"amountInMax",type:"uint256"},{internalType:"address[]",name:"path",type:"address[]"},{internalType:"address",name:"to",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"}],name:"swapTokensForExactTokens",outputs:[{internalType:"uint256[]",name:"amounts",type:"uint256[]"}],stateMutability:"nonpayable",type:"function"},{stateMutability:"payable",type:"receive"}
] as const;

function uniToken(
  path: string[],
  opt: HintOpt,
  amount: bigint,
  first: boolean
): string | undefined {
  const contract = path[first ? 0 : path.length - 1];
  if (!contract || !opt.contracts || !opt.contracts[contract]) return;
  const info = opt.contracts[contract];
  if (!info.decimals || !info.symbol) return;
  return `${createDecimal(info.decimals).encode(amount)} ${info.symbol}`;
}
const uniTs = (ts: number) => `Expires at ${new Date(Number(ts) * 1000).toUTCString()}`;

const hints = {
  swapETHForExactTokens(v: any, opt: HintOpt) {
    const last = uniToken(v.path, opt, v.amountOut, false);
    if (!opt.amount || !last) throw new Error('Not enough info');
    return `Swap up to ${weieth.encode(opt.amount)} ETH for exact ${last}. ${uniTs(v.deadline)}`;
  },

  swapExactETHForTokens(v: any, opt: HintOpt) {
    const last = uniToken(v.path, opt, v.amountOutMin, false);
    if (!opt.amount || !last) throw new Error('Not enough info');
    return `Swap ${weieth.encode(opt.amount)} ETH for at least ${last}. ${uniTs(v.deadline)}`;
  },

  swapExactETHForTokensSupportingFeeOnTransferTokens(v: any, opt: HintOpt) {
    const last = uniToken(v.path, opt, v.amountOutMin, false);
    if (!opt.amount || !last) throw new Error('Not enough info');
    return `Swap ${weieth.encode(opt.amount)} ETH for at least ${last}. ${uniTs(v.deadline)}`;
  },

  swapExactTokensForETH(v: any, opt: HintOpt) {
    const first = uniToken(v.path, opt, v.amountIn, true);
    if (!first) throw new Error('Not enough info');
    return `Swap exact ${first} for at least ${weieth.encode(v.amountOutMin)} ETH. ${uniTs(
      v.deadline
    )}`;
  },

  swapExactTokensForETHSupportingFeeOnTransferTokens(v: any, opt: HintOpt) {
    const first = uniToken(v.path, opt, v.amountIn, true);
    if (!first) throw new Error('Not enough info');
    return `Swap exact ${first} for at least ${weieth.encode(v.amountOutMin)} ETH. ${uniTs(
      v.deadline
    )}`;
  },

  swapTokensForExactETH(v: any, opt: HintOpt) {
    const first = uniToken(v.path, opt, v.amountInMax, true);
    if (!first) throw new Error('Not enough info');
    return `Swap up to ${first} for exact ${weieth.encode(v.amountOut)} ETH. ${uniTs(v.deadline)}`;
  },

  swapExactTokensForTokens(v: any, opt: HintOpt) {
    const first = uniToken(v.path, opt, v.amountIn, true);
    const last = uniToken(v.path, opt, v.amountOutMin, false);
    if (!first || !last) throw new Error('Not enough info');
    return `Swap exact ${first} for at least ${last}. ${uniTs(v.deadline)}`;
  },

  swapExactTokensForTokensSupportingFeeOnTransferTokens(v: any, opt: HintOpt) {
    const first = uniToken(v.path, opt, v.amountIn, true);
    const last = uniToken(v.path, opt, v.amountOutMin, false);
    if (!first || !last) throw new Error('Not enough info');
    return `Swap exact ${first} for at least ${last}. ${uniTs(v.deadline)}`;
  },

  swapTokensForExactTokens(v: any, opt: HintOpt) {
    const first = uniToken(v.path, opt, v.amountInMax, true);
    const last = uniToken(v.path, opt, v.amountOut, false);
    if (!first || !last) throw new Error('Not enough info');
    return `Swap up to ${first} for exact ${last}. ${uniTs(v.deadline)}`;
  },
};

const ABI = /* @__PURE__ */ addHints(_ABI, hints);
export default ABI;
export const UNISWAP_V2_ROUTER_CONTRACT = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
