import * as abi from '../web3.js';
import * as contracts from '../contracts/index.js';
import * as uni from './uniswap-common.js';
import { hex } from '@scure/base';
import * as P from 'micro-packed';

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000';
export const QUOTER_ADDRESS = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';
export const QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInput',
    inputs: [
      { name: 'path', type: 'bytes' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'quoteExactOutput',
    inputs: [
      { name: 'path', type: 'bytes' },
      { name: 'amountOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amountIn', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'quoteExactOutputSingle',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
    outputs: [{ name: 'amountIn', type: 'uint256' }],
  },
] as const;

export const Fee: Record<string, number> = {
  LOW: 500,
  MEDIUM: 3000,
  HIGH: 10000,
};

type Route = { path?: abi.Bytes; fee?: number; amountIn?: bigint; amountOut?: bigint; p?: any };

function basePaths(a: string, b: string, exactOutput: boolean = false) {
  let res: Route[] = [];
  for (let fee in Fee) res.push({ fee: Fee[fee], p: [a, b] });
  const wA = uni.wrapContract(a);
  const wB = uni.wrapContract(b);
  const BASES: (abi.ContractInfo & { contract: string })[] = uni.COMMON_BASES.filter(
    (c) => c && c.contract && c.contract !== wA && c.contract !== wB
  ) as (abi.ContractInfo & { contract: string })[];
  const packFee = (n: string) => Fee[n].toString(16).padStart(6, '0');
  for (let c of BASES) {
    for (let fee1 in Fee) {
      for (let fee2 in Fee) {
        let path = [wA, packFee(fee1), c.contract, packFee(fee2), wB].map((i) =>
          hex.decode(abi.strip0x(i))
        );
        if (exactOutput) path = path.reverse();
        res.push({ path: P.concatBytes(...path) });
      }
    }
  }
  return res;
}

export async function bestPath(
  net: abi.Web3API,
  a: string,
  b: string,
  amountIn?: bigint,
  amountOut?: bigint
) {
  if ((amountIn && amountOut) || (!amountIn && !amountOut))
    throw new Error('uniswapV3.bestPath: provide only one amount');
  const quoter = abi.contract(QUOTER_ABI, net, QUOTER_ADDRESS);
  let paths = basePaths(a, b, !!amountOut);
  for (let i of paths) {
    if (!i.path && !i.fee) continue;
    const opt = { ...i, tokenIn: a, tokenOut: b, amountIn, amountOut, sqrtPriceLimitX96: 0 };
    i[amountIn ? 'amountOut' : 'amountIn'] = (quoter as any)[
      'quoteExact' + (amountIn ? 'Input' : 'Output') + (i.path ? '' : 'Single')
    ].call(opt);
  }
  paths = (await uni.awaitDeep(paths, true)) as any;
  paths = paths.filter((i) => i.amountIn || i.amountOut);
  paths.sort((a: any, b: any) =>
    Number(amountIn ? b.amountOut - a.amountOut : a.amountIn - b.amountIn)
  );
  if (!paths.length) throw new Error('uniswap: cannot find path');
  return paths[0];
}

const ROUTER_CONTRACT = abi.contract(
  contracts.UNISWAP_V3_ROUTER,
  undefined,
  contracts.UNISWAP_V3_ROUTER_CONTRACT
);

export type TxOpt = {
  sqrtPriceLimitX96?: bigint;
  slippagePercent: number;
  ttl: number;
  deadline?: number;
  fee?: { fee: number; to: string };
};

export function txData(
  to: string,
  input: string,
  output: string,
  route: Route,
  amountIn?: bigint,
  amountOut?: bigint,
  opt: TxOpt = uni.DEFAULT_SWAP_OPT
) {
  opt = { ...uni.DEFAULT_SWAP_OPT, ...opt };
  if (!uni.validateAddr(input) || !uni.validateAddr(output) || !/^0x[0-9a-f]+$/i.test(to))
    throw new Error('UniswapV3: Invalid address');
  if (opt.fee && !uni.validateAddr(opt.fee.to))
    throw new Error('UniswapV3: invalid fee recepient addresss');
  if (input === 'eth' && output === 'eth') throw new Error('Both input and output is ETH!');
  if ((amountIn && amountOut) || (!amountIn && !amountOut))
    throw new Error('UniswapV3: provide only one amount');
  if (
    (amountIn && !route.amountOut) ||
    (amountOut && !route.amountIn) ||
    (!route.fee && !route.path)
  )
    throw new Error('UniswapV3: invalid route');
  if (route.path && opt.sqrtPriceLimitX96)
    throw new Error('UniswapV3: sqrtPriceLimitX96 on multi-hop trade');
  const deadline = opt.deadline ? opt.deadline : Math.floor(Date.now() / 1000) + opt.ttl;
  // flags for whether funds should be send first to the router
  const routerMustCustody = output == 'eth' || !!opt.fee;
  let args = {
    ...route,
    tokenIn: uni.wrapContract(input),
    tokenOut: uni.wrapContract(output),
    recipient: routerMustCustody ? ADDRESS_ZERO : to,
    deadline,
    amountIn: (amountIn || route.amountIn) as bigint,
    amountOut: (amountOut || route.amountOut) as bigint,
    sqrtPriceLimitX96: opt.sqrtPriceLimitX96 || 0n,
    amountInMaximum: undefined as bigint | undefined,
    amountOutMinimum: undefined as bigint | undefined,
  };
  args.amountInMaximum = uni.addPercent(args.amountIn, opt.slippagePercent);
  args.amountOutMinimum = uni.addPercent(args.amountOut, -opt.slippagePercent);
  const calldatas = [
    (
      ROUTER_CONTRACT[
        ('exact' + (amountIn ? 'Input' : 'Output') + (!args.path ? 'Single' : '')) as
          | 'exactInput'
          | 'exactOutput'
          | 'exactInputSingle'
          | 'exactOutputSingle'
      ].encodeInput as (v: unknown) => Uint8Array
    )(args),
  ];
  if (input == 'eth' && amountOut) calldatas.push(ROUTER_CONTRACT['refundETH'].encodeInput({}));
  // unwrap
  if (routerMustCustody) {
    calldatas.push(
      (ROUTER_CONTRACT as any)[
        (output == 'eth' ? 'unwrapWETH9' : 'sweepToken') + (opt.fee ? 'WithFee' : '')
      ].encodeInput({
        token: uni.wrapContract(output),
        amountMinimum: args.amountOutMinimum,
        recipient: to,
        feeBips: opt.fee && opt.fee.fee * 10000,
        feeRecipient: opt.fee && opt.fee.to,
      })
    );
  }
  const data =
    calldatas.length === 1 ? calldatas[0] : ROUTER_CONTRACT['multicall'].encodeInput(calldatas);
  const value = input === 'eth' ? (amountIn ? amountIn : args.amountInMaximum) : 0n;
  const allowance =
    input !== 'eth'
      ? { token: input, amount: amountIn ? amountIn : args.amountInMaximum }
      : undefined;
  return { to: contracts.UNISWAP_V3_ROUTER_CONTRACT, value, data, allowance };
}

// Here goes Exchange API. Everything above is SDK.
export class UniswapV3 extends uni.UniswapAbstract {
  name = 'Uniswap V3';
  contract = contracts.UNISWAP_V3_ROUTER_CONTRACT;
  bestPath(fromCoin: string, toCoin: string, inputAmount: bigint) {
    return bestPath(this.net, fromCoin, toCoin, inputAmount);
  }
  txData(
    toAddress: string,
    fromCoin: string,
    toCoin: string,
    path: any,
    inputAmount?: bigint,
    outputAmount?: bigint,
    opt: uni.SwapOpt = uni.DEFAULT_SWAP_OPT
  ): any {
    return txData(toAddress, fromCoin, toCoin, path, inputAmount, outputAmount, {
      ...uni.DEFAULT_SWAP_OPT,
      ...opt,
    });
  }
}
