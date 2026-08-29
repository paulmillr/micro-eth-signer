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

const TRACE_FILTER_CONCURRENCY = 8;
const MAX_BLOCK_RANGE_CHUNKS = 4096;

function traceRangeChunks(fromBlock: number, toBlock: number, limitTrace: number): number {
  if (fromBlock > toBlock) return 0;
  const chunks = Math.floor((toBlock - fromBlock) / (limitTrace + 1)) + 1;
  if (chunks > MAX_BLOCK_RANGE_CHUNKS) {
    throw new RangeError(
      `internalTransactions: block range requires ${chunks} chunks, limit is ${MAX_BLOCK_RANGE_CHUNKS}`
    );
  }
  return chunks;
}

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
  // OpenEthereum trace entries are a runtime union: call/create/reward/suicide,
  // and failed call/create entries have a null result. Keep the historical
  // exported Action type stable, but only normalize quantities present on the
  // actual variant returned by the node.
  const details = action.action as unknown as {
    value?: string | bigint;
    gas?: string | bigint;
    balance?: string | bigint;
  };
  const result = action.result as unknown as { gasUsed?: string | bigint } | null | undefined;
  if (details.value !== undefined) details.value = BigInt(details.value);
  if (details.gas !== undefined) details.gas = BigInt(details.gas);
  if (details.balance !== undefined) details.balance = BigInt(details.balance);
  if (result?.gasUsed !== undefined) result.gasUsed = BigInt(result.gasUsed);
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
    const { fromBlock, toBlock, limitTrace } = opts as Required<
      Pick<TraceOpts, 'fromBlock' | 'toBlock' | 'limitTrace'>
    >;
    const chunks = traceRangeChunks(fromBlock, toBlock, limitTrace);
    const batches: Action[][] = new Array(chunks);
    let next = 0;
    let stopped = false;
    const worker = async () => {
      try {
        for (;;) {
          if (stopped) return;
          const index = next++;
          if (index >= chunks) return;
          const batchFrom = fromBlock + index * (limitTrace + 1);
          batches[index] = await traceFilterSingle(prov, address, {
            fromBlock: batchFrom,
            toBlock: Math.min(batchFrom + limitTrace, toBlock),
          });
        }
      } catch (error) {
        stopped = true;
        throw error;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(TRACE_FILTER_CONCURRENCY, chunks) }, () => worker())
    );
    const out: Action[] = [];
    // A valid large trace batch can exceed the engine's function-argument limit.
    for (const batch of batches) for (const action of batch) out.push(action);
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
