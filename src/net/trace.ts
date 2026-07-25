/**
 * Expert trace-filter helpers.
 *
 * Range-crawled tracing is unusable on range-limited nodes in practice
 * (reth commonly caps at 100 blocks, erigon around 1000). Prefer OTS
 * address discovery plus per-transaction trace enrichment. This module exists
 * for archive nodes with an uncapped trace namespace, such as nethermind, and
 * for forensic/expert use where the cost is explicit.
 */

import { TRACE_REQUIREMENT, ethNum, requireMethod, type RpcClient } from '../net.ts';

export type Action = {
  action: {
    from: string;
    callType: string;
    gas: bigint;
    input: string;
    to: string;
    value: bigint;
  };
  blockHash: string;
  blockNumber: number;
  result: { gasUsed: bigint; output: string };
  subtraces: number;
  traceAddress: string[];
  transactionHash: string;
  transactionPosition: number;
  type: string;
};

export type TraceOpts = {
  fromBlock?: number;
  toBlock?: number;
  perRequest?: number;
  limitTrace?: number;
};

function validateTraceOpts(opts: Record<string, unknown>) {
  for (const i of ['fromBlock', 'toBlock']) {
    const val = opts[i];
    if (val === undefined || (typeof val === 'number' && Number.isSafeInteger(val) && val >= 0))
      continue;
    throw new Error(
      `validatePagination: wrong field ${i}=${opts[i]}. Should be non-negative integer or undefined`
    );
  }
  for (const i of ['perRequest', 'limitTrace']) {
    const val = opts[i];
    if (val === undefined || (typeof val === 'number' && Number.isSafeInteger(val) && val > 0))
      continue;
    throw new Error(
      `validateTraceOpts: wrong field ${i}=${opts[i]}. Should be positive integer or undefined`
    );
  }
  if (opts.limitTrace !== undefined) {
    if (opts.fromBlock === undefined || opts.toBlock === undefined)
      throw new Error('validateTraceOpts: fromBlock/toBlock required if limitTrace is present');
  }
}

function fixAction(action: Action) {
  action.action.value = BigInt(action.action.value);
  action.action.gas = BigInt(action.action.gas);
  action.result.gasUsed = BigInt(action.result.gasUsed);
}

export async function traceFilterSingle(
  prov: Pick<RpcClient, 'call'>,
  address: string,
  opts: TraceOpts = {}
): Promise<Action[]> {
  const params: Record<string, any> = {
    fromBlock: ethNum(opts.fromBlock),
    toAddress: [address],
    fromAddress: [address],
  };
  if (opts.toBlock !== undefined) params.toBlock = ethNum(opts.toBlock);
  let res;
  try {
    res = await prov.call('trace_filter', params);
  } catch (e) {
    throw requireMethod(e, 'trace_filter', TRACE_REQUIREMENT);
  }
  for (const action of res) fixAction(action);
  return res;
}

export async function internalTransactions(
  prov: Pick<RpcClient, 'call'>,
  address: string,
  opts: TraceOpts = {}
): Promise<Action[]> {
  if (typeof address !== 'string') throw new Error('internalTransactions: wrong address');
  validateTraceOpts(opts);
  if (opts.limitTrace) {
    const promises = [];
    for (let i = opts.fromBlock!; i <= opts.toBlock!; i += opts.limitTrace + 1)
      promises.push(
        traceFilterSingle(prov, address, {
          fromBlock: i,
          toBlock: Math.min(i + opts.limitTrace, opts.toBlock!),
        })
      );
    const out = [];
    for (const i of await Promise.all(promises)) out.push(...i);
    return out;
  }
  let lastBlock = opts.fromBlock || 0;
  const perBlock: Record<number, number> = {};
  const out: Action[] = [];
  for (;;) {
    const params: Record<string, any> = {
      fromBlock: ethNum(lastBlock),
      toAddress: [address],
      fromAddress: [address],
      after: perBlock[lastBlock] || 0,
    };
    if (opts.toBlock !== undefined) params.toBlock = ethNum(opts.toBlock);
    if (opts.perRequest !== undefined) params.count = opts.perRequest;

    let res;
    try {
      res = await prov.call('trace_filter', params);
    } catch (e) {
      throw requireMethod(e, 'trace_filter', TRACE_REQUIREMENT);
    }
    if (!res.length) break;
    for (const action of res) {
      fixAction(action);
      if (perBlock[action.blockNumber] === undefined) perBlock[action.blockNumber] = 0;
      perBlock[action.blockNumber]++;
      out.push(action);
      lastBlock = Math.max(lastBlock, action.blockNumber);
    }
  }
  return out;
}
