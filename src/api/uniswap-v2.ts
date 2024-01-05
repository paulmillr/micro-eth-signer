import * as abi from '../web3.js';
import * as contracts from '../contracts/index.js';
import { keccak_256 } from '@noble/hashes/sha3';
import { hex } from '@scure/base';
import * as uni from './uniswap-common.js';
import * as P from 'micro-packed';

export const FACTORY_ADDRESS = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
export const INIT_CODE_HASH = hex.decode(
  '96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f'
);
const PAIR_CONTRACT = [
  {
    type: 'function',
    name: 'getReserves',
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
  },
] as const;

export function create2(from: Uint8Array, salt: Uint8Array, initCodeHash: Uint8Array) {
  return abi.add0x(
    hex.encode(keccak_256(P.concatBytes(new Uint8Array([255]), from, salt, initCodeHash)).slice(12))
  );
}

export function pairAddress(a: string, b: string, factory: string = FACTORY_ADDRESS) {
  // This is completely broken: '0x11' '0x11' will return '0x1111'. But this is how it works in sdk.
  const data = P.concatBytes(...uni.sortTokens(a, b).map((i) => hex.decode(abi.strip0x(i))));
  return create2(hex.decode(abi.strip0x(factory)), keccak_256(data), INIT_CODE_HASH);
}

export async function reserves(net: abi.Web3API, a: string, b: string): Promise<[bigint, bigint]> {
  a = uni.wrapContract(a);
  b = uni.wrapContract(b);
  const contract = abi.contract(PAIR_CONTRACT, net, pairAddress(a, b));
  const res = await contract.getReserves.call();
  return a < b ? [res.reserve0, res.reserve1] : [res.reserve1, res.reserve0];
}

// amountIn set: returns amountOut, how many tokenB user gets for amountIn of tokenA
// amountOut set: returns amountIn, how many tokenA user should send to get exact
// amountOut of tokenB
export function amount(
  reserveIn: bigint,
  reserveOut: bigint,
  amountIn?: bigint,
  amountOut?: bigint
): bigint {
  if (amountIn && amountOut) throw new Error('uniswap.amount: provide only one amount');
  if (!reserveIn || !reserveOut || (amountOut && amountOut >= reserveOut))
    throw new Error('Uniswap: Insufficient reserves');
  if (amountIn) {
    const amountInWithFee = amountIn * 997n;
    const amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
    if (amountOut === 0n || amountOut >= reserveOut)
      throw new Error('Uniswap: Insufficient reserves');
    return amountOut;
  } else if (amountOut)
    return (reserveIn * amountOut * 1000n) / ((reserveOut - amountOut) * 997n) + 1n;
  else throw new Error('uniswap.amount: provide only one amount');
}

export type Path = { path: string[]; amountIn: bigint; amountOut: bigint };

export async function bestPath(
  net: abi.Web3API,
  tokenA: string,
  tokenB: string,
  amountIn?: bigint,
  amountOut?: bigint
): Promise<Path> {
  if ((amountIn && amountOut) || (!amountIn && !amountOut))
    throw new Error('uniswap.bestPath: provide only one amount');
  const wA = uni.wrapContract(tokenA);
  const wB = uni.wrapContract(tokenB);
  let resP: Promise<Path>[] = [];
  // Direct pair
  resP.push(
    (async () => {
      const pairAmount = amount(...(await reserves(net, tokenA, tokenB)), amountIn, amountOut);
      return {
        path: [wA, wB],
        amountIn: amountIn ? amountIn : pairAmount,
        amountOut: amountOut ? amountOut : pairAmount,
      };
    })()
  );
  const BASES: (abi.ContractInfo & { contract: string })[] = uni.COMMON_BASES.filter(
    (c) => c && c.contract && c.contract !== wA && c.contract !== wB
  ) as (abi.ContractInfo & { contract: string })[];
  for (let c of BASES) {
    resP.push(
      (async () => {
        const [rAC, rCB] = await Promise.all([
          reserves(net, wA, c.contract),
          reserves(net, c.contract, wB),
        ]);
        const path = [wA, c.contract, wB];
        if (amountIn)
          return { path, amountIn, amountOut: amount(...rCB, amount(...rAC, amountIn)) };
        else if (amountOut) {
          return {
            path,
            amountOut,
            amountIn: amount(...rAC, undefined, amount(...rCB, undefined, amountOut)),
          };
        } else throw new Error('Impossible invariant');
      })()
    );
  }
  let res: Path[] = ((await uni.awaitDeep(resP, true)) as any).filter((i: Path) => !!i);
  // biggest output or smallest input
  res.sort((a, b) => Number(amountIn ? b.amountOut - a.amountOut : a.amountIn - b.amountIn));
  if (!res.length) throw new Error('uniswap: cannot find path');
  return res[0];
}

const ROUTER_CONTRACT = abi.contract(
  contracts.UNISWAP_V2_ROUTER,
  undefined,
  contracts.UNISWAP_V2_ROUTER_CONTRACT
);

export const TX_DEFAULT_OPT = {
  ...uni.DEFAULT_SWAP_OPT,
  feeOnTransfer: false, // have no idea what it is
};

export function txData(
  to: string,
  input: string,
  output: string,
  path: Path,
  amountIn?: bigint,
  amountOut?: bigint,
  opt: {
    ttl: number;
    deadline?: number;
    slippagePercent: number;
    feeOnTransfer: boolean;
  } = TX_DEFAULT_OPT
) {
  opt = { ...TX_DEFAULT_OPT, ...opt };
  if (!uni.validateAddr(input) || !uni.validateAddr(output) || !/^0x[0-9a-f]+$/i.test(to))
    throw new Error('Invalid address');
  if (input === 'eth' && output === 'eth') throw new Error('Both input and output is ETH!');
  if (input === 'eth' && path.path[0] !== uni.WETH)
    throw new Error('Input is ETH but path starts with different contract');
  if (output === 'eth' && path.path[path.path.length - 1] !== uni.WETH)
    throw new Error('Output is ETH but path ends with different contract');
  if ((amountIn && amountOut) || (!amountIn && !amountOut))
    throw new Error('uniswap.txData: provide only one amount');
  if (amountOut && opt.feeOnTransfer) throw new Error('Exact output + feeOnTransfer is impossible');
  const method =
    'swap' +
    (amountIn ? 'Exact' : '') +
    (input === 'eth' ? 'ETH' : 'Tokens') +
    'For' +
    (amountOut ? 'Exact' : '') +
    (output === 'eth' ? 'ETH' : 'Tokens') +
    (opt.feeOnTransfer ? 'SupportingFeeOnTransferTokens' : '');
  if (!(ROUTER_CONTRACT as any)[method]) throw new Error('Invalid method');
  const deadline = opt.deadline ? opt.deadline : Math.floor(Date.now() / 1000) + opt.ttl;
  const amountInMax = uni.addPercent(path.amountIn, opt.slippagePercent);
  const amountOutMin = uni.addPercent(path.amountOut, -opt.slippagePercent);
  const data = (ROUTER_CONTRACT as any)[method].encodeInput({
    amountInMax,
    amountOutMin,
    amountIn,
    amountOut,
    to,
    deadline,
    path: path.path,
  });
  const value = input === 'eth' ? (amountIn ? amountIn : amountInMax) : 0n;
  let allowance;
  if (input !== 'eth') allowance = { token: input, amount: amountIn ? amountIn : amountInMax };
  return { to: contracts.UNISWAP_V2_ROUTER_CONTRACT, value, data, allowance };
}

// Here goes Exchange API. Everything above is SDK. Supports almost everything from official sdk except liquidity stuff.
export class UniswapV2 extends uni.UniswapAbstract {
  name = 'Uniswap V2';
  contract = contracts.UNISWAP_V2_ROUTER_CONTRACT;
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
      ...TX_DEFAULT_OPT,
      ...opt,
    });
  }
}
