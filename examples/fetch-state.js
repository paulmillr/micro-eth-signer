#!/usr/bin/env node
/**
 * Fetch a contract's full event state (every matching log) from an archive
 * node as fast as eth_getLogs allows, and stream it as NDJSON — ordered by
 * (blockNumber, logIndex), crash-safe, resumable.
 *
 *   node examples/fetch-state.js <rpcUrl> <contract> <topic0>[,<topic0>...] [fromBlock] [toBlock]
 *
 * Output goes to stdout, or to $OUT when set — which also enables resume:
 * chunks are written strictly in range order, so on any failure the file holds
 * a clean prefix of the stream; rerunning the *same* command truncates a torn
 * trailing line, reads the last complete log, and continues after it.
 *
 * Example — every Uniswap V3 pool ever created (factory PoolCreated +
 * FeeAmountEnabled events, from its deployment block):
 *
 *   OUT=pools.ndjson node examples/fetch-state.js http://localhost:8545 \
 *     0x1f98431c8ad98523631ae4a59f267346ea31f984 \
 *     0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118,0xc66a3fdf07232cdd185febcc6579d408c241b47ae2f9907d84be655141eeaecc \
 *     12369621
 *   # crashed / interrupted? run the same command again — it resumes.
 *
 * Why this shape is the fastest (measured against an Erigon 3 archive node):
 * - One query per range, all event signatures OR-ed in the topic0 position —
 *   half the requests of one-query-per-topic, identical results.
 * - Moderate disjoint chunks + concurrent requests. The node's log index is
 *   O(matches), not O(blocks), so chunk size barely matters; what matters is
 *   keeping a few requests in flight so the node overlaps its (cold) disk I/O.
 *   One giant full-range call is the pathological case: the same data that
 *   streams in seconds as chunks can take many minutes as a single request,
 *   and default HTTP clients time out or cap the response before it lands.
 * - Chunks are emitted head-of-line: the next range is written the moment it
 *   completes while later ranges keep fetching in the background, so ordering
 *   costs no wall time beyond the slowest in-flight chunk.
 */
import { closeSync, createWriteStream, fstatSync, ftruncateSync, openSync, readSync } from 'node:fs';
import { jsonrpc } from 'micro-ftch';
// In your project: import { RpcClient } from 'micro-eth-signer/net.js';
import { RpcClient } from '../net.js';

const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
const TARGET_CHUNKS = 32; // a few per worker; more just pays the RTT floor
const OUT = process.env.OUT;

const [rpcUrl, contract, topicsArg, fromArg, toArg] = process.argv.slice(2);
if (!rpcUrl || !contract || !topicsArg) {
  console.error('usage: [OUT=events.ndjson] fetch-state.js <rpcUrl> <contract> <topic0>[,<topic0>...] [fromBlock] [toBlock]');
  process.exit(1);
}

// Reads the resume boundary out of $OUT: drops a torn trailing line from a
// previous crash, returns the last complete log's position. NDJSON here is
// pure ASCII, so byte offsets and string indexes agree.
function prepareResume(path) {
  let fd;
  try {
    fd = openSync(path, 'r+');
  } catch {
    return undefined; // no file yet — fresh start
  }
  try {
    const size = fstatSync(fd).size;
    if (!size) return undefined;
    const len = Math.min(size, 1 << 20);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const tail = buf.toString('utf8');
    const lastNl = tail.lastIndexOf('\n');
    if (lastNl < 0) {
      if (len === size) {
        ftruncateSync(fd, 0); // single torn line — start over
        return undefined;
      }
      throw new Error(`resume: no newline in the last 1MB of ${path}; not our NDJSON?`);
    }
    ftruncateSync(fd, size - (tail.length - (lastNl + 1)));
    const lines = tail.slice(0, lastNl).split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    if (!Number.isSafeInteger(last.blockNumber) || !Number.isSafeInteger(last.logIndex))
      throw new Error(`resume: last line of ${path} is not a log record`);
    return { block: last.blockNumber, logIndex: last.logIndex };
  } finally {
    closeSync(fd);
  }
}

const base = jsonrpc(fetch, rpcUrl);
const prov = new RpcClient(base);
const topics = [topicsArg.split(',')];
let fromBlock = fromArg ? Number(fromArg) : 0;
const toBlock = toArg ? Number(toArg) : await prov.height();

// The boundary already on disk; the boundary block is re-fetched and its
// already-written logs skipped, so a crash mid-block loses nothing.
const after = OUT ? prepareResume(OUT) : undefined;
if (after) fromBlock = Math.max(fromBlock, after.block);
const span = toBlock - fromBlock + 1;
if (span <= 0) throw new Error('empty block range');
const limitLogs = Math.max(10_000, Math.ceil(span / TARGET_CHUNKS));
const chunks = [];
for (let f = fromBlock; f <= toBlock; f += limitLogs)
  chunks.push({ from: f, to: Math.min(f + limitLogs - 1, toBlock) });

const sink = OUT ? createWriteStream(OUT, { flags: 'a' }) : process.stdout;
const write = (s) => new Promise((resolve) => (sink.write(s) ? resolve() : sink.once('drain', resolve)));

const started = Date.now();
let written = 0;
let bytesOut = 0;
let doneChunks = 0;
let fetchedChunks = 0;
let lastBlock = after?.block ?? fromBlock;
// per-chunk lifecycle for the progress strip: 0 queued, 1 in flight,
// 2 fetched (waiting on head-of-line), 3 written
const state = new Uint8Array(chunks.length);
const STRIP = ['·', '░', '▒', '█'];
const tty = process.stderr.isTTY;
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';
const num = (n) => n.toLocaleString('en-US');
const mb = () => {
  const v = bytesOut / 1048576;
  return (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + 'MB';
};
const fmtDur = (s) => (s < 100 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`);
// % and ETA follow the contiguously-written head (block-span rate averages out
// the wild per-chunk variance of cold ranges; still only an estimate)
const coveredBlocks = () => (doneChunks ? chunks[doneChunks - 1].to - fromBlock + 1 : 0);
const etaText = () => {
  const covered = coveredBlocks();
  if (!covered || covered >= span) return '';
  const left = (span - covered) / (covered / ((Date.now() - started) / 1000));
  return `, ~${fmtDur(left)} left`;
};
const render = () => {
  const elapsed = Math.round((Date.now() - started) / 1000);
  if (!tty) {
    const percent = Math.floor((coveredBlocks() / span) * 100);
    console.error(
      `progress: ${doneChunks}/${chunks.length} written (${fetchedChunks} fetched), ${written} logs, ${mb()}, ` +
        `block ${lastBlock} (${percent}% of span), ${elapsed}s elapsed${etaText()}`
    );
    return;
  }
  let strip = '';
  for (let i = 0; i < chunks.length; i++) strip += STRIP[state[i]];
  process.stderr.write(
    `\r\x1b[2K[${strip}] ${doneChunks}/${chunks.length}` +
      `${GRAY} · ${num(written)} logs · ${mb()} · block ${num(lastBlock)} · ${elapsed}s${etaText()}${RESET}`
  );
};
const progress = setInterval(render, tty ? 1000 : 10_000);
process.on('SIGINT', () => {
  if (tty) process.stderr.write('\r\x1b[2K');
  console.error(
    `interrupted at block ${lastBlock}` +
      (OUT ? ' — rerun the same command to resume' : ' — rerun with OUT=<file> to make runs resumable')
  );
  process.exit(130);
});

try {
  // Head-of-line streaming: keep CONCURRENCY chunk fetches in flight, but
  // always write the lowest pending range next.
  const pending = [];
  let next = 0;
  const enqueue = () => {
    if (next >= chunks.length) return;
    const i = next++;
    const { from, to } = chunks[i];
    state[i] = 1;
    const p = prov.ethLogs(topics, { address: contract, fromBlock: from, toBlock: to });
    // a later chunk may reject while the head is still pending; the rejection
    // is still observed when its turn comes (the handler also marks it fetched)
    p.then(
      () => {
        state[i] = 2;
        fetchedChunks++;
      },
      () => {}
    );
    pending.push(p);
  };
  while (pending.length < Math.min(CONCURRENCY, chunks.length)) enqueue();
  while (pending.length) {
    const logs = await pending.shift();
    enqueue();
    logs.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    let out = '';
    for (const log of logs) {
      if (after && (log.blockNumber < after.block || (log.blockNumber === after.block && log.logIndex <= after.logIndex)))
        continue; // already on disk from the interrupted run
      out += JSON.stringify(log) + '\n';
      written++;
      lastBlock = log.blockNumber;
    }
    if (out) await write(out);
    bytesOut += out.length;
    state[doneChunks] = 3;
    doneChunks++;
  }
} finally {
  clearInterval(progress);
  if (tty) process.stderr.write('\r\x1b[2K');
}
if (OUT) await new Promise((resolve) => sink.end(resolve));
console.error(
  `fetched ${written} logs over ${span} blocks ` +
    (after ? `(resumed after block ${after.block}) ` : '') +
    `(${chunks.length} chunks of ${limitLogs}, concurrency ${CONCURRENCY}) ` +
    `in ${((Date.now() - started) / 1000).toFixed(1)}s`
);
