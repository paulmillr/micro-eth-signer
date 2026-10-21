import { describe, should, beforeAll, afterAll } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, match, ok } from 'node:assert';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cidV1, DEMO_ADDRESS, ipfsPath } from '../nft/core.js';

/*
UI tests for examples/nft/index.html, driven in headless Chromium (playwright-core).
All network I/O is replayed from examples/test/fixtures/nft-html.json: JSON-RPC calls
are answered per-call by a local server, everything else (IPFS gateway, NFT
metadata hosts) via request interception. Needs a browser + built artifacts:
  npm run build && cd examples && node test/nft-html.test.ts
Re-record against a real node (tests define what gets recorded):
  NFT_HTML_RECORD=1 ETH_RPC_URL=http://… node examples/test/nft-html.test.ts
Recording merges into an existing file and saves even when a test fails:
delete it for a clean re-record, and run again until a pass is green — the
page gives up on a slow gateway after 20s, so a fetch that finished late
only reaches it on the next pass (art behind that metadata included).
The chain head is pinned, so the scan's log windows (and so every eth_getLogs
key) are fixed. Public gateways rate-limit bursts (ipfs.io: 429 with a 15
minute Retry-After), so recording fetches gateway URLs from RECORD_GATEWAYS in
turn. To keep the fixture small, recording also stores image bodies as a
1×1 PNG, eth_getCode answers as a 4-byte stub (only emptiness matters to
tokenInfo), and at most LOGS_CAP logs per eth_getLogs window: the demo
address got thousands of spam airdrops in 2022, each one an ownerOf call.
*/

const RECORD = !!process.env.NFT_HTML_RECORD;
const NODE_URL = process.env.ETH_RPC_URL || 'http://127.0.0.1';
const FAKE_HEAD = '0x18cba80'; // 26_000_000
const LOGS_CAP = 40;
const T = RECORD ? 240_000 : 20_000;
const GATEWAY = 'https://ipfs.io/ipfs/'; // the page default, served from fixtures
const RECORD_GATEWAYS = ['https://4everland.io/ipfs/', 'https://ipfs.filebase.io/ipfs/'];
// held by DEMO_ADDRESS: IPFS metadata (ipfs://Qm…) with two transfers, mint first
const MIMI = '0x2d1e23D97F520bBB17F0E736c7AB74741eF3eC62';
const PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixturesPath = join(root, 'examples', 'test', 'fixtures', 'nft-html.json');

let chromium: any;
try {
  ({ chromium } = await import('playwright-core'));
} catch {}
function findChromium(): string | undefined {
  const candidates = [process.env.CHROMIUM];
  try {
    candidates.push(chromium?.executablePath());
  } catch {}
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).sort().reverse()) {
      candidates.push(join(cache, dir, 'chrome-linux', 'chrome'));
      candidates.push(join(cache, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
    }
  }
  return candidates.find((p) => p && existsSync(p));
}
const executable = chromium && findChromium();
const built = existsSync(join(root, 'index.js'));
const runnable = executable && built && (RECORD || existsSync(fixturesPath));
if (!runnable)
  console.log(
    'nft-html: skipped (needs playwright-core, a chromium binary, built artifacts ' +
      'and recorded fixtures — see comment at the top of the file)'
  );

type RpcEntry = { result?: unknown; error?: { code?: number; message: string } };
type HttpEntry = { status: number; type?: string; body64: string } | { failed: true };
type Fixtures = { rpc: Record<string, RpcEntry>; http: Record<string, HttpEntry> };
const fixtures: Fixtures =
  runnable && existsSync(fixturesPath)
    ? JSON.parse(readFileSync(fixturesPath, 'utf8'))
    : { rpc: {}, http: {} };
function saveFixtures() {
  const sorted = (obj: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(
    fixturesPath,
    JSON.stringify({ rpc: sorted(fixtures.rpc), http: sorted(fixtures.http) })
  );
  console.log(
    `nft-html: ${Object.keys(fixtures.rpc).length} rpc + ${Object.keys(fixtures.http).length} http fixtures saved`
  );
}
// a failing test ends the run without afterAll: keep what this pass fetched
if (RECORD) process.on('exit', saveFixtures);
const misses: string[] = [];
const pageErrors: string[] = [];

const rpcKey = (method: string, params: unknown) => `${method} ${JSON.stringify(params ?? [])}`;
const rpcCalls = new Map<string, number>(); // per JSON-RPC sub-call, by method
async function rpcCall(method: string, params: unknown): Promise<RpcEntry> {
  rpcCalls.set(method, (rpcCalls.get(method) || 0) + 1);
  if (method === 'eth_blockNumber') return { result: FAKE_HEAD };
  const key = rpcKey(method, params);
  if (fixtures.rpc[key]) return fixtures.rpc[key];
  if (!RECORD) {
    misses.push(key);
    return { error: { code: -32000, message: `no fixture for ${key}` } };
  }
  const res = await fetch(NODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method, params }),
  });
  const json = await res.json();
  let result = json.result;
  if (method === 'eth_getLogs' && Array.isArray(result)) result = result.slice(0, LOGS_CAP);
  if (method === 'eth_getCode' && typeof result === 'string') result = result.slice(0, 10);
  return (fixtures.rpc[key] = json.error
    ? { error: { code: json.error.code, message: json.error.message } }
    : { result });
}

// Off-chain fetches while recording: gateway URLs go through the fallback
// gateways (first 2xx wins), anything else to its real host.
async function recordHttp(url: string): Promise<HttpEntry> {
  const path = url.startsWith(GATEWAY) ? url.slice(GATEWAY.length) : undefined;
  const sources = path ? RECORD_GATEWAYS.map((gw) => gw + path) : [url];
  let last: HttpEntry = { failed: true };
  for (const source of sources) {
    try {
      const res = await fetch(source, { signal: AbortSignal.timeout(10_000) });
      const type = res.headers.get('content-type') || undefined;
      const body = Buffer.from(await res.arrayBuffer());
      last = type?.startsWith('image/')
        ? { status: res.status, type: 'image/png', body64: PIXEL_PNG }
        : { status: res.status, type, body64: body.toString('base64') };
      if (res.ok) return last;
    } catch {}
  }
  return last;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
};
function startServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/rpc') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const calls = Array.isArray(body) ? body : [body];
      const answers = await Promise.all(
        calls.map(async (call) => ({
          jsonrpc: '2.0',
          id: call.id,
          ...(await rpcCall(call.method, call.params)),
        }))
      );
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
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

// A fake gateway that, like dweb.link/4everland, 302s /ipfs/<cid>/… to
// https://<cidv1>.ipfs.<host>/…; the subdomain form serves the same fixtures.
const REDIRECTING = 'redirect.gateway.test';
const subdomainKey = (url: string) => {
  const u = new URL(url);
  const m = u.hostname.match(/^([a-z2-7]+)\.ipfs\./);
  if (!m) return;
  for (const key of Object.keys(fixtures.http)) {
    const path = key.startsWith(GATEWAY) && ipfsPath(key);
    if (!path) continue;
    const [cid, ...rest] = path.split('/');
    if (cidV1(cid) === m[1] && `/${rest.join('/')}` === u.pathname) return key;
  }
};

(runnable ? describe : describe.skip)('nft/index.html', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let browser: any;
  let page: any;
  let pageUrl: string;
  const requested: string[] = []; // every off-origin URL the page asked for
  const $ = (id: string) => page.locator(`#${id}`);
  const visible = (id: string) => page.waitForSelector(`#${id}:not(.hidden)`, { timeout: T });
  const hosts = () => new Set(requested.map((url) => new URL(url).host));
  const scanDone = () =>
    page.waitForFunction(
      () => document.getElementById('scan-stop')!.classList.contains('hidden'),
      undefined,
      {
        timeout: RECORD ? 600_000 : T,
      }
    );
  const tileCount = () => page.locator('#grid .nft-item').count();
  // tiles near the viewport done resolving: none still loading, network quiet
  const settle = async () => {
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll('.placeholder:not(.hidden)')].some(
          (p) => p.textContent === 'loading…'
        ),
      undefined,
      { timeout: T }
    );
    for (let n = -1; n !== requested.length; ) {
      n = requested.length;
      await page.waitForTimeout(RECORD ? 3000 : 300);
    }
  };
  // for conditions on the test side (intercepted requests), not in the page
  const until = async (fn: () => boolean) => {
    for (const end = Date.now() + T; !fn(); await new Promise((r) => setTimeout(r, 50)))
      if (Date.now() > end) throw new Error('until: timed out');
  };

  beforeAll(async () => {
    server = await startServer();
    browser = await chromium.launch({ executablePath: executable });
    page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on('pageerror', (err: unknown) => pageErrors.push(String(err)));
    await page.route('**/*', async (route: any) => {
      const url = route.request().url();
      if (url.startsWith(server.origin)) return route.continue();
      requested.push(url);
      const host = new URL(url).host;
      if (host === REDIRECTING) {
        const path = url.slice(`https://${REDIRECTING}/ipfs/`.length);
        const [cid, ...rest] = path.split('/');
        return route.fulfill({
          status: 302,
          headers: {
            location: `https://${cidV1(cid)}.ipfs.${REDIRECTING}/${rest.join('/')}`,
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      const key = host.endsWith(`.ipfs.${REDIRECTING}`) ? subdomainKey(url) : url;
      let entry = key && fixtures.http[key];
      if (RECORD && !entry && key) entry = fixtures.http[key] = await recordHttp(key);
      if (!entry) misses.push(url);
      if (!entry || 'failed' in entry) return route.abort();
      await route.fulfill({
        status: entry.status,
        body: Buffer.from(entry.body64, 'base64'),
        headers: {
          'Access-Control-Allow-Origin': '*',
          ...(entry.type ? { 'Content-Type': entry.type } : {}),
        },
      });
    });
    pageUrl = `${server.origin}/examples/nft/index.html`;
    await page.goto(`${pageUrl}?rpc=${server.origin}/rpc`);
  });
  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  should('start IPFS-only, with the default gateway', async () => {
    ok(await page.evaluate(() => document.body.classList.contains('empty')));
    ok(!(await $('allow-http').isChecked()));
    deepStrictEqual(await $('gateway').inputValue(), GATEWAY);
    match(await $('policy-note').textContent(), /^IPFS only/);
  });

  should('reject invalid input', async () => {
    await $('address-input').fill('not-an-address');
    await page.click('#address-form button[type=submit]');
    deepStrictEqual(await $('status').textContent(), 'Invalid Ethereum address.');
  });

  should('scan an address: tiles for every held NFT', async () => {
    await $('address-input').fill(DEMO_ADDRESS);
    await page.click('#address-form button[type=submit]');
    await visible('gallery-view');
    await scanDone();
    const text = await $('scan-text').textContent();
    const held = Number(text.match(/^(\d+) NFTs held/)?.[1]);
    ok(held > 10, text);
    deepStrictEqual(await tileCount(), held);
    match(page.url(), new RegExp(`\\?address=${DEMO_ADDRESS}&rpc=`));
    // blocks 0..26M in 500k windows (53: the last is block 0 alone), two filters each
    deepStrictEqual(rpcCalls.get('eth_getLogs'), 106);
  });

  should('IPFS only: no request to any host but the gateway', async () => {
    // tiles near the viewport resolve; give them a moment
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('#grid .placeholder')].filter((p) =>
          /non-IPFS host/.test(p.textContent!)
        ).length > 0,
      undefined,
      { timeout: T }
    );
    await page.waitForFunction(
      () => document.querySelector('#grid img[src^="blob:"]:not(.hidden)'),
      undefined,
      {
        timeout: T,
      }
    );
    await settle();
    deepStrictEqual([...hosts()], ['ipfs.io']);
    // on-chain art (Uniswap V3 positions are SVG data: URIs) needs no host at all
    ok(await page.locator('#grid img[src^="data:image/"]:not(.hidden)').count());
    const placeholders = await page.locator('#grid .placeholder').allTextContents();
    ok(
      placeholders.some((t: string) => t === 'metadata on non-IPFS host api.poap.tech'),
      placeholders.join('|')
    );
  });

  should('open a token page from its tile', async () => {
    await page.click(`#grid a[href*="contract=${MIMI}&id=1&"]`);
    await visible('token-view');
    await page.waitForFunction(
      () => document.getElementById('token-title')!.textContent === 'MIMI SPACE #1',
      undefined,
      {
        timeout: T,
      }
    );
    match(page.url(), new RegExp(`\\?contract=${MIMI}&id=1&owner=${DEMO_ADDRESS}&rpc=`));
    const facts = await page.locator('#token-dl').innerText();
    match(facts, /Standard\s+ERC-721/);
    match(facts, /Metadata\s+ipfs:\/\/Qm\w+ · IPFS, via the gateway/);
    const owner = page.locator('#token-dl a');
    deepStrictEqual(
      await owner.getAttribute('href'),
      `?${new URLSearchParams({ address: DEMO_ADDRESS, rpc: `${server.origin}/rpc` })}`
    );
    // transfer history: newest first, the mint last
    await page.waitForFunction(
      () => document.querySelectorAll('#token-transfers tr').length === 2,
      undefined,
      {
        timeout: T,
      }
    );
    const rows = await page.locator('#token-transfers tr').allInnerTexts();
    match(rows[0], new RegExp(DEMO_ADDRESS));
    match(rows[1], /\bmint\b/);
    await page.waitForSelector('#token-art img[src^="blob:"]:not(.hidden)', { timeout: T });
    ok(await page.locator('#token-raw-block:not(.hidden)').count(), 'raw JSON available');
  });

  should('return to the same gallery without rescanning', async () => {
    const logs = rpcCalls.get('eth_getLogs');
    const tiles = await tileCount();
    await page.click('#token-back');
    await visible('gallery-view');
    match(page.url(), new RegExp(`\\?address=${DEMO_ADDRESS}&`));
    deepStrictEqual(await tileCount(), tiles);
    deepStrictEqual(rpcCalls.get('eth_getLogs'), logs);
  });

  should('load non-IPFS hosts only once opted in, and remember the choice', async () => {
    const before = requested.length;
    await page.check('#allow-http');
    match(await $('policy-note').textContent(), /^Non-IPFS hosts are loaded/);
    await until(() => requested.slice(before).some((url) => new URL(url).host === 'api.poap.tech'));
    await settle();
    const opened = new Set(requested.slice(before).map((url) => new URL(url).host));
    ok(opened.has('api.poap.tech'), [...opened].join(','));
    deepStrictEqual(
      JSON.parse(await page.evaluate(() => localStorage.getItem('nft-viewer-settings')!)).allowHttp,
      true
    );
    await page.reload();
    await visible('gallery-view');
    ok(await $('allow-http').isChecked(), 'remembered');
    await scanDone();
    await settle();
    await page.uncheck('#allow-http');
    match(await $('policy-note').textContent(), /^IPFS only/);
    await settle();
  });

  should('follow a redirecting gateway to its subdomain form', async () => {
    const before = requested.length;
    await $('gateway').fill(REDIRECTING);
    await $('gateway').dispatchEvent('change');
    deepStrictEqual(await $('gateway').inputValue(), `https://${REDIRECTING}/ipfs/`);
    await page.waitForFunction(
      () => document.querySelector('#grid img[src^="blob:"]:not(.hidden)'),
      undefined,
      {
        timeout: T,
      }
    );
    await settle();
    const used = [...new Set(requested.slice(before).map((url) => new URL(url).host))];
    ok(used.includes(REDIRECTING), used.join(','));
    ok(
      used.some((host) => host.endsWith(`.ipfs.${REDIRECTING}`)),
      used.join(',')
    );
    ok(
      used.every((host) => host === REDIRECTING || host.endsWith(`.ipfs.${REDIRECTING}`)),
      used.join(',')
    );
    // back to the default for the remaining tests
    await $('gateway').fill('');
    await $('gateway').dispatchEvent('change');
    deepStrictEqual(await $('gateway').inputValue(), GATEWAY);
    await settle();
  });

  should('report a bad token id', async () => {
    await page.goto(`${pageUrl}?contract=${MIMI}&id=abc&rpc=${server.origin}/rpc`);
    await page.waitForFunction(
      () => document.getElementById('token-status')!.className === 'error',
      undefined,
      {
        timeout: T,
      }
    );
    deepStrictEqual(await $('token-status').textContent(), 'Invalid token id: abc');
  });

  should('replay without misses or page errors', () => {
    deepStrictEqual(pageErrors, []);
    if (!RECORD) deepStrictEqual(misses, []);
  });
});

should.runWhen(import.meta.url);
