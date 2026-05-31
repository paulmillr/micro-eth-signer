import { bytesToHex } from '@noble/hashes/utils.js';
import { add0x, createDecimal, deepFreeze, type TArg } from '../utils.ts';
import { addHints, addHook } from './abi-common.ts';
import { type Decoder, type HintOpt, type SignatureInfo } from './abi-decoder.ts';

// Raw SwapRouter ABI: net/uniswap-v3.ts, multicall decoding, and the hint layer
// depend on these exact method and tuple field names.
// prettier-ignore
const _ABI = /* @__PURE__ */ deepFreeze([
  {inputs:[{internalType:"address",name:"_factory",type:"address"},{internalType:"address",name:"_WETH9",type:"address"}],stateMutability:"nonpayable",type:"constructor"},{inputs:[],name:"WETH9",outputs:[{internalType:"address",name:"",type:"address"}],stateMutability:"view",type:"function"},{inputs:[{components:[{internalType:"bytes",name:"path",type:"bytes"},{internalType:"address",name:"recipient",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"},{internalType:"uint256",name:"amountIn",type:"uint256"},{internalType:"uint256",name:"amountOutMinimum",type:"uint256"}],internalType:"struct ISwapRouter.ExactInputParams",name:"params",type:"tuple"}],name:"exactInput",outputs:[{internalType:"uint256",name:"amountOut",type:"uint256"}],stateMutability:"payable",type:"function"},{inputs:[{components:[{internalType:"address",name:"tokenIn",type:"address"},{internalType:"address",name:"tokenOut",type:"address"},{internalType:"uint24",name:"fee",type:"uint24"},{internalType:"address",name:"recipient",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"},{internalType:"uint256",name:"amountIn",type:"uint256"},{internalType:"uint256",name:"amountOutMinimum",type:"uint256"},{internalType:"uint160",name:"sqrtPriceLimitX96",type:"uint160"}],internalType:"struct ISwapRouter.ExactInputSingleParams",name:"params",type:"tuple"}],name:"exactInputSingle",outputs:[{internalType:"uint256",name:"amountOut",type:"uint256"}],stateMutability:"payable",type:"function"},{inputs:[{components:[{internalType:"bytes",name:"path",type:"bytes"},{internalType:"address",name:"recipient",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"},{internalType:"uint256",name:"amountOut",type:"uint256"},{internalType:"uint256",name:"amountInMaximum",type:"uint256"}],internalType:"struct ISwapRouter.ExactOutputParams",name:"params",type:"tuple"}],name:"exactOutput",outputs:[{internalType:"uint256",name:"amountIn",type:"uint256"}],stateMutability:"payable",type:"function"},{inputs:[{components:[{internalType:"address",name:"tokenIn",type:"address"},{internalType:"address",name:"tokenOut",type:"address"},{internalType:"uint24",name:"fee",type:"uint24"},{internalType:"address",name:"recipient",type:"address"},{internalType:"uint256",name:"deadline",type:"uint256"},{internalType:"uint256",name:"amountOut",type:"uint256"},{internalType:"uint256",name:"amountInMaximum",type:"uint256"},{internalType:"uint160",name:"sqrtPriceLimitX96",type:"uint160"}],internalType:"struct ISwapRouter.ExactOutputSingleParams",name:"params",type:"tuple"}],name:"exactOutputSingle",outputs:[{internalType:"uint256",name:"amountIn",type:"uint256"}],stateMutability:"payable",type:"function"},{inputs:[],name:"factory",outputs:[{internalType:"address",name:"",type:"address"}],stateMutability:"view",type:"function"},{inputs:[{internalType:"bytes[]",name:"data",type:"bytes[]"}],name:"multicall",outputs:[{internalType:"bytes[]",name:"results",type:"bytes[]"}],stateMutability:"payable",type:"function"},{inputs:[],name:"refundETH",outputs:[],stateMutability:"payable",type:"function"},{inputs:[{internalType:"address",name:"token",type:"address"},{internalType:"uint256",name:"value",type:"uint256"},{internalType:"uint256",name:"deadline",type:"uint256"},{internalType:"uint8",name:"v",type:"uint8"},{internalType:"bytes32",name:"r",type:"bytes32"},{internalType:"bytes32",name:"s",type:"bytes32"}],name:"selfPermit",outputs:[],stateMutability:"payable",type:"function"},{inputs:[{internalType:"address",name:"token",type:"address"},{internalType:"uint256",name:"nonce",type:"uint256"},{internalType:"uint256",name:"expiry",type:"uint256"},{internalType:"uint8",name:"v",type:"uint8"},{internalType:"bytes32",name:"r",type:"bytes32"},{internalType:"bytes32",name:"s",type:"bytes32"}],name:"selfPermitAllowed",outputs:[],stateMutability:"payable",type:"function"},{inputs:[{internalType:"address",name:"token",type:"address"},{internalType:"uint256",name:"nonce",type:"uint256"},{internalType:"uint256",name:"expiry",type:"uint256"},{internalType:"uint8",name:"v",type:"uint8"},{internalType:"bytes32",name:"r",type:"bytes32"},{internalType:"bytes32",name:"s",type:"bytes32"}],name:"selfPermitAllowedIfNecessary",outputs:[],stateMutability:"payable",type:"function"},{inputs:[{internalType:"address",name:"token",type:"address"},{internalType:"uint256",name:"value",type:"uint256"},{internalType:"uint256",name:"deadline",type:"uint256"},{internalType:"uint8",name:"v",type:"uint8"},{internalType:"bytes32",name:"r",type:"bytes32"},{internalType:"bytes32",name:"s",type:"bytes32"}],name:"selfPermitIfNecessary",outputs:[],stateMutability:"payable",type:"function"},{inputs:[{internalType:"address",name:"token",type:"address"},{internalType:"uint256",name:"amountMinimum",type:"uint256"},{internalType:"address",name:"recipient",type:"address"}],name:"sweepToken",outputs:[],stateMutability:"payable",type:"function"},{inputs:[{internalType:"address",name:"token",type:"address"},{internalType:"uint256",name:"amountMinimum",type:"uint256"},{internalType:"address",name:"recipient",type:"address"},{internalType:"uint256",name:"feeBips",type:"uint256"},{internalType:"address",name:"feeRecipient",type:"address"}],name:"sweepTokenWithFee",outputs:[],stateMutability:"payable",type:"function"},{inputs:[{internalType:"int256",name:"amount0Delta",type:"int256"},{internalType:"int256",name:"amount1Delta",type:"int256"},{internalType:"bytes",name:"_data",type:"bytes"}],name:"uniswapV3SwapCallback",outputs:[],stateMutability:"nonpayable",type:"function"},{inputs:[{internalType:"uint256",name:"amountMinimum",type:"uint256"},{internalType:"address",name:"recipient",type:"address"}],name:"unwrapWETH9",outputs:[],stateMutability:"payable",type:"function"},{inputs:[{internalType:"uint256",name:"amountMinimum",type:"uint256"},{internalType:"address",name:"recipient",type:"address"},{internalType:"uint256",name:"feeBips",type:"uint256"},{internalType:"address",name:"feeRecipient",type:"address"}],name:"unwrapWETH9WithFee",outputs:[],stateMutability:"payable",type:"function"},{stateMutability:"payable",type:"receive"}
] as const);

// Generic multicall hook, maybe move to common?
// Nested calldata should expand only on exact router matches; unknown or
// ambiguous blobs stay unknownAbi.
const ABI_MULTICALL = /* @__PURE__ */ deepFreeze(
  /* @__PURE__ */ addHook(
    _ABI,
    'multicall',
    (d: TArg<Decoder>, contract: string, info: SignatureInfo, opt: TArg<HintOpt>) => {
      const decoded = (info.value as Uint8Array[]).map((data) => {
        const call = (d as Decoder).decode(contract, data, opt as HintOpt);
        if (call && !Array.isArray(call)) return call;
        // When the path includes unknown contract (e.g. custom method on top of ERC-20)
        // We return unknownAbi
        const label = `unknownAbi(${add0x(bytesToHex(data.slice(0, 4)))})`;
        return { name: label, signature: label, value: data };
      });
      info.name = `multicall(${decoded.map((i: any) => i.name).join(', ')})`;
      info.signature = `multicall(${decoded.map((i: any) => i.signature).join(', ')})`;
      info.value = decoded.map((i: any) => i.value);
      let hasHint = false;
      for (let i of decoded) if (i.hint) hasHint = true;
      if (hasHint) {
        info.hint = decoded
          .filter((i: any) => i.hint)
          .map((i: any) => i.hint)
          .join(' ');
      }
      return info;
    }
  )
);

// Hint-only endpoint extractor for packed V3 paths: valid paths are token || fee(3 bytes) || token ...,
// and only the first/last token addresses are rendered.
const decodePath = (b: TArg<Uint8Array>) => {
  if (b.length < 43 || (b.length - 20) % 23 !== 0)
    throw new Error(`Invalid Uniswap V3 path: expected 20+n*23 bytes, got ${b.length}`);
  return [b.slice(0, 20), b.slice(-20)].map((i) => add0x(bytesToHex(i)));
};

function uniToken(contract: string, amount: bigint, opt: TArg<HintOpt>): string | undefined {
  // Hint rendering expects caller-supplied token metadata keyed by normalized lowercase addresses,
  // and zero-decimal tokens are still valid metadata.
  if (!contract || !opt.contracts || !opt.contracts[contract]) return;
  const info = opt.contracts[contract];
  if (info.decimals === undefined || !info.symbol) return;
  return `${createDecimal(info.decimals).encode(amount)} ${info.symbol}`;
}
// Deadlines are uint256 on-chain, but hint rendering goes through JS Number/Date and therefore
// assumes the value fits the host date range.
const uniTs = (ts: number) => `Expires at ${new Date(Number(ts) * 1000).toUTCString()}`;

const hints = {
  // Single-hop exact-input hints show the exact tokenIn amount and the minimum tokenOut floor;
  // fee tier and sqrtPriceLimitX96 stay implicit.
  exactInputSingle(v: any, opt: TArg<HintOpt>) {
    const [from, to] = [
      uniToken(v.tokenIn, v.amountIn, opt),
      uniToken(v.tokenOut, v.amountOutMinimum, opt),
    ];
    if (!from || !to) throw new Error('Not enough info');
    return `Swap exact ${from} for at least ${to}. ${uniTs(v.deadline)}`;
  },
  // Single-hop exact-output hints show the maximum tokenIn spend and the exact tokenOut amount;
  // fee tier and sqrtPriceLimitX96 stay implicit.
  exactOutputSingle(v: any, opt: TArg<HintOpt>) {
    const [from, to] = [
      uniToken(v.tokenIn, v.amountInMaximum, opt),
      uniToken(v.tokenOut, v.amountOut, opt),
    ];
    if (!from || !to) throw new Error('Not enough info');
    return `Swap up to ${from} for exact ${to}. ${uniTs(v.deadline)}`;
  },
  // Path-based exact-input hints only show the first/last token endpoints and the minimum output floor;
  // intermediate hops and fee tiers stay implicit.
  exactInput(v: any, opt: TArg<HintOpt>) {
    const [tokenIn, tokenOut] = decodePath(v.path);
    const [from, to] = [
      uniToken(tokenIn, v.amountIn, opt),
      uniToken(tokenOut, v.amountOutMinimum, opt),
    ];
    if (!from || !to) throw new Error('Not enough info');
    return `Swap exact ${from} for at least ${to}. ${uniTs(v.deadline)}`;
  },
  // Path-based exact-output hints reverse the packed path to recover input/output endpoints and
  // only show the max input bound plus exact output target; intermediate hops and fee tiers stay implicit.
  exactOutput(v: any, opt: TArg<HintOpt>) {
    const [tokenIn, tokenOut] = decodePath(v.path).reverse();
    const [from, to] = [
      uniToken(tokenIn, v.amountInMaximum, opt),
      uniToken(tokenOut, v.amountOut, opt),
    ];
    if (!from || !to) throw new Error('Not enough info');
    return `Swap up to ${from} for exact ${to}. ${uniTs(v.deadline)}`;
  },
};

// Compose the default router export by keeping the multicall expansion hook and layering the four
// swap hint renderers onto the same ABI surface.
const ABI = /* @__PURE__ */ deepFreeze(/* @__PURE__ */ addHints(ABI_MULTICALL, hints));

export default ABI;
// Mainnet Uniswap V3 SwapRouter address used by the built-in contract registry and V3 net helpers.
export const UNISWAP_V3_ROUTER_CONTRACT = '0xe592427a0aece92de3edee1f18e0157c05861564';
