// Shared record/replay JSON-RPC harness for the tx-demo suites
// (examples/test/tx-html.test.ts and examples/test/tx-cli.test.ts). All
// network I/O replays from examples/test/fixtures/tx-demo.json; recording
// talks to a real node:
//   TX_DEMO_RECORD=1 ETH_RPC_URL=http://… node examples/test/tx-html.test.ts
//   TX_DEMO_RECORD=1 ETH_RPC_URL=http://… node examples/test/tx-cli.test.ts
// Recording merges into an existing file (both suites share it); delete the
// file first for a clean re-record. Some answers are pinned rather than
// recorded, so the demo account is worth spending from regardless of its real
// on-chain state:
//  - eth_getBalance of the demo account: 2.5 ETH
//  - eth_estimateGas: 21000 (ETH transfer) / 60000 (ERC-20 transfer) — the
//    real node would reject the estimate as insufficient funds
//  - eth_sendRawTransaction: ALWAYS an error, and every attempt is counted —
//    suites assert the count stays zero (the demo must never broadcast)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECORD = !!process.env.TX_DEMO_RECORD;
export const NODE_URL = process.env.ETH_RPC_URL || 'http://127.0.0.1';

// The classic demo key: privkey 1. Its address has real mainnet history,
// including token transfers (an incoming CAT that only the logs source finds).
export const DEMO_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';
export const DEMO = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
export const CAT = '0x53FdCa91fd33B9131B5CEADe42A3EdBd9B38edFf';
export const RECIPIENT = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const FAKE_BALANCE = '0x22b1c8c1227a0000'; // 2.5 ETH

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const fixturesPath = join(root, 'examples', 'test', 'fixtures', 'tx-demo.json');

type RpcEntry = { result?: unknown; error?: { code?: number; message: string } };

export type FixtureRpc = ReturnType<typeof createFixtureRpc>;
export function createFixtureRpc() {
  const fixtures: Record<string, RpcEntry> = existsSync(fixturesPath)
    ? JSON.parse(readFileSync(fixturesPath, 'utf8')).rpc
    : {};
  const misses: string[] = [];
  const calls = { total: 0, sendRaw: 0, byMethod: new Map<string, number>() };
  const key = (method: string, params: unknown) => `${method} ${JSON.stringify(params ?? [])}`;
  async function rpcCall(method: string, params: unknown): Promise<RpcEntry> {
    calls.total++;
    calls.byMethod.set(method, (calls.byMethod.get(method) || 0) + 1);
    // never recorded, never forwarded: the demo must not broadcast, and the
    // suites assert this counter stays at zero
    if (method === 'eth_sendRawTransaction') {
      calls.sendRaw++;
      return { error: { code: -32000, message: 'tx-demo: broadcasting is forbidden' } };
    }
    const args = Array.isArray(params) ? params : [];
    if (method === 'eth_getBalance' && String(args[0]).toLowerCase() === DEMO.toLowerCase())
      return { result: FAKE_BALANCE };
    if (method === 'eth_estimateGas') {
      const data = (args[0] as { data?: string })?.data || '0x';
      return { result: data.startsWith('0xa9059cbb') ? '0xea60' : '0x5208' };
    }
    // dryRun of a value-bearing ETH transfer from the demo account: the real
    // node rejects it (its real balance is dust; the 2.5 ETH is pinned), so
    // the simulation is pinned to success. Value-less calls (token transfers,
    // balanceOf, metadata probes) go to the node and record real answers.
    if (method === 'eth_call') {
      const call = args[0] as { from?: string; value?: string };
      if (call?.value && String(call.from ?? '').toLowerCase() === DEMO.toLowerCase())
        return { result: '0x' };
    }
    const k = key(method, params);
    if (fixtures[k]) return fixtures[k]; // keep first: replay serves one value
    if (!RECORD) {
      misses.push(k);
      return { error: { code: -32000, message: `no fixture for ${k}` } };
    }
    const res = await fetch(NODE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method, params }),
    });
    const json = await res.json();
    return (fixtures[k] = json.error
      ? { error: { code: json.error.code, message: json.error.message } }
      : { result: json.result });
  }
  function save() {
    if (!RECORD) return;
    const sorted = Object.fromEntries(
      Object.entries(fixtures).sort(([a], [b]) => (a < b ? -1 : 1))
    );
    writeFileSync(fixturesPath, JSON.stringify({ rpc: sorted }));
    console.log(`tx-demo: fixtures file now holds ${Object.keys(sorted).length} rpc entries`);
  }
  return { rpcCall, save, misses, calls, fixtureCount: () => Object.keys(fixtures).length };
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
};

// Static files from the repo root (page, built artifacts, node_modules for
// the import map) plus POST /rpc answered per-call through the fixture store.
export function startServer(
  rpc: FixtureRpc
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/rpc') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const batch = Array.isArray(body) ? body : [body];
      const answers = await Promise.all(
        batch.map(async (call) => ({
          jsonrpc: '2.0',
          id: call.id,
          ...(await rpc.rpcCall(call.method, call.params)),
        }))
      );
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(Array.isArray(body) ? answers : answers[0]));
    }
    const path = normalize(decodeURIComponent((req.url || '/').split('?')[0])).replace(/^\/+/, '');
    const file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || extname(file) === '') {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done(undefined))),
      });
    });
  });
}
