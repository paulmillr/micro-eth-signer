import { describe, should, beforeAll, afterAll } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, match, ok } from 'node:assert';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
UI tests for examples/explore.html, driven in headless Chromium (playwright-core).
All network I/O is replayed from test/fixtures/explore-html.json: JSON-RPC calls
are answered per-call by a local server, other hosts (NFT metadata) via request
interception. Not part of `npm test` (needs a browser + built artifacts):
  npm run build && npm run test:ui
Re-record fixtures against a real node (tests define what gets recorded, so
re-record after changing them; counts asserted below match the recorded data):
  EXPLORE_HTML_RECORD=1 ETH_RPC_URL=http://… node test/explore-html.test.ts
The chain head is pinned to a fake low block during recording, so the token
scan covers two log windows instead of the whole chain.
*/

const RECORD = !!process.env.EXPLORE_HTML_RECORD;
const NODE_URL = process.env.ETH_RPC_URL || 'http://127.0.0.1';
const FAKE_HEAD = '0x493e0'; // 300_000: two 200k log windows
const T = RECORD ? 180_000 : 20_000; // waits are generous when talking to a real node

const DEMO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const FAV2 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesPath = join(root, 'test', 'fixtures', 'explore-html.json');

// Optional pieces: without playwright-core, a chromium binary or built
// artifacts the suite skips (with a note) instead of failing.
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
    'explore-html: skipped (needs playwright-core, a chromium binary, built artifacts ' +
      'and recorded fixtures — see comment at the top of the file)'
  );

type RpcEntry = { result?: unknown; error?: { code?: number; message: string } };
type Fixtures = {
  rpc: Record<string, RpcEntry>;
  http: Record<string, { status: number; body: string } | { failed: true }>;
};
const fixtures: Fixtures = RECORD
  ? { rpc: {}, http: {} }
  : runnable
    ? JSON.parse(readFileSync(fixturesPath, 'utf8'))
    : { rpc: {}, http: {} };
const misses: string[] = [];
const pageErrors: string[] = [];

const rpcKey = (method: string, params: unknown) => `${method} ${JSON.stringify(params ?? [])}`;
const rpcCalls = { total: 0, byMethod: new Map<string, number>() }; // per JSON-RPC sub-call
async function rpcCall(method: string, params: unknown): Promise<RpcEntry> {
  rpcCalls.total++;
  rpcCalls.byMethod.set(method, (rpcCalls.byMethod.get(method) || 0) + 1);
  if (method === 'eth_blockNumber') return { result: FAKE_HEAD }; // pinned head
  const key = rpcKey(method, params);
  if (!RECORD) {
    const entry = fixtures.rpc[key];
    if (entry) return entry;
    misses.push(key);
    return { error: { code: -32000, message: `no fixture for ${key}` } };
  }
  if (fixtures.rpc[key]) return fixtures.rpc[key]; // keep first: replay serves one value
  const res = await fetch(NODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 0, method, params }),
  });
  const json = await res.json();
  return (fixtures.rpc[key] = json.error
    ? { error: { code: json.error.code, message: json.error.message } }
    : { result: json.result });
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
};
// Static files from the repo root (page, built artifacts, node_modules for the
// import map) plus POST /rpc answered per-call from fixtures.
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

(runnable ? describe : describe.skip)('explore.html', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let browser: any;
  let page: any;
  const $ = (id: string) => page.locator(`#${id}`);
  const visible = (id: string) => page.waitForSelector(`#${id}:not(.hidden)`, { timeout: T });
  const modalOpen = () => page.waitForSelector('#details-view[open]', { timeout: T });
  const storage = async () =>
    JSON.parse(await page.evaluate(() => localStorage.getItem('eth-explorer-favorites') || '[]'));

  beforeAll(async () => {
    server = await startServer();
    browser = await chromium.launch({ executablePath: executable });
    page = await browser.newPage();
    page.on('pageerror', (err: unknown) => pageErrors.push(String(err)));
    // Anything not served by our origin: NFT metadata JSON etc. Images are
    // dropped (tiles fall back to the placeholder), the rest is fixtures.
    await page.route('**/*', async (route: any) => {
      const url = route.request().url();
      if (url.startsWith(server.origin)) return route.continue();
      if (route.request().resourceType() === 'image') return route.abort();
      let entry = fixtures.http[url];
      if (RECORD && !entry) {
        try {
          const res = await route.fetch();
          entry = fixtures.http[url] = { status: res.status(), body: await res.text() };
        } catch {
          entry = fixtures.http[url] = { failed: true };
        }
      }
      if (!entry) misses.push(url);
      if (!entry || 'failed' in entry) return route.abort();
      await route.fulfill({
        status: entry.status,
        body: entry.body,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    });
    await page.goto(`${server.origin}/examples/explore.html?rpc=${server.origin}/rpc`);
  });
  afterAll(async () => {
    await browser?.close();
    await server?.close();
    if (RECORD) {
      const sorted = (obj: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1)));
      writeFileSync(
        fixturesPath,
        JSON.stringify({ rpc: sorted(fixtures.rpc), http: sorted(fixtures.http) })
      );
      console.log(
        `explore-html: recorded ${Object.keys(fixtures.rpc).length} rpc + ` +
          `${Object.keys(fixtures.http).length} http fixtures`
      );
    }
  });

  should('reject invalid input', async () => {
    await $('address-input').fill('not-an-address');
    await page.click('#address-form button[type=submit]');
    deepStrictEqual(await $('status').textContent(), 'Invalid Ethereum address.');
    ok(await page.evaluate(() => document.body.classList.contains('empty')));
  });

  should('hide the favorites entry point while there are no favorites', async () => {
    ok(!(await $('favorites-button').isVisible()), 'nav button hidden');
  });

  should('report a name that does not resolve', async () => {
    await $('address-input').fill('nosuch-name-for-tests.eth');
    await page.click('#address-form button[type=submit]');
    await page.waitForFunction(
      () => document.getElementById('status')!.textContent!.includes('did not resolve'),
      undefined,
      { timeout: T }
    );
    deepStrictEqual(
      await $('status').textContent(),
      'Name nosuch-name-for-tests.eth did not resolve.'
    );
  });

  should('load an address: balances and transaction rows', async () => {
    await $('address-input').fill(DEMO);
    await page.click('#address-form button[type=submit]');
    await visible('overview');
    deepStrictEqual(await $('address-line').textContent(), DEMO);
    match((await $('balances').textContent()) || '', /^ETH\s+\d/, 'ETH balance first');
    const rows = await page.$$('#rows tr');
    deepStrictEqual(rows.length, 25, 'quick view page');
    deepStrictEqual(await page.$$eval('#rows tr:first-child td', (tds: any[]) => tds.length), 4);
    match(await page.textContent('#rows tr:first-child td.time'), /^\d+\/\d+ \d+:\d+|^pending/);
    ok(await page.textContent('#rows tr:first-child'), 'row has content');
    ok(!(await $('empty').isVisible()), 'no-transactions note hidden');
  });

  should('navigate rows with the keyboard and open details', async () => {
    await page.keyboard.press('ArrowDown');
    deepStrictEqual(
      await page.$$eval('#rows tr.selected', (trs: any[]) => trs.length),
      1,
      'one row selected'
    );
    await page.keyboard.press('Enter');
    await modalOpen();
    ok(await $('overview').isVisible(), 'details are a modal: the table stays behind them');
    const labels = await page.$$eval('#details dt', (dts: any[]) =>
      dts.map((dt) => dt.textContent)
    );
    for (const label of ['time', 'from', 'to', 'amount eth', 'intent', 'method', 'status', 'fee'])
      ok(labels.includes(label), `details show ${label}`);
    ok(!labels.includes('txid'), 'web details hide txid');
    match(await page.textContent('#details dd:nth-of-type(2)'), /^0x[0-9a-fA-F]{40}$/, 'from');
    await page.keyboard.press('Escape');
    ok(
      await page.evaluate(() => !(document.getElementById('details-view') as any).open),
      'Escape closes the modal'
    );
    await visible('overview');
  });

  should('open details by clicking a row', async () => {
    await page.click('#rows tr:nth-child(3)');
    await modalOpen();
    await page.click('#back-button');
    await visible('overview');
  });

  should('serve reopened details from the cache', async () => {
    const before = rpcCalls.total;
    await page.click('#rows tr:nth-child(3)'); // same tx as the previous test
    await modalOpen();
    await page.click('#back-button');
    deepStrictEqual(rpcCalls.total, before, 'no repeat fetch for a confirmed tx');
  });

  should('reuse the history download for a first-time open', async () => {
    await page.click('#rows tr:nth-child(5)'); // a row no test opened before
    await modalOpen();
    await page.click('#back-button');
    // every opened tx so far arrived in full through a history stream and was
    // remembered: details never had to re-download one
    deepStrictEqual(rpcCalls.byMethod.get('eth_getTransactionByHash'), undefined);
  });

  should('toggle favorite on the address page', async () => {
    deepStrictEqual(await $('favorite-button').textContent(), '☆ Favorite');
    await page.click('#favorite-button');
    deepStrictEqual(await $('favorite-button').textContent(), '★ Favorited');
    deepStrictEqual(await storage(), [{ address: DEMO }], 'persisted checksummed');
    deepStrictEqual(await $('favorites-button').textContent(), '★ Favorites');
    ok(await $('favorites-button').isVisible(), 'nav button appears with first favorite');
    await page.click('#favorite-button');
    deepStrictEqual(await storage(), [], 'toggle removes');
    ok(!(await $('favorites-button').isVisible()), 'nav button hides with last favorite');
    await page.click('#favorite-button');
    deepStrictEqual(await storage(), [{ address: DEMO }], 'favorited again for later tests');
  });

  should('list favorites with their captured ENS names', async () => {
    // seeded with an ENS name as if it was present when favorited
    await page.evaluate(
      (fav2: string) =>
        localStorage.setItem(
          'eth-explorer-favorites',
          JSON.stringify([
            ...JSON.parse(localStorage.getItem('eth-explorer-favorites')!),
            { address: fav2, ens: 'favtwo.eth' },
          ])
        ),
      FAV2
    );
    await page.click('#favorites-button');
    await visible('favorites-view');
    deepStrictEqual(
      await page.$$eval('#favorites-list .favorite-addr', (els: any[]) =>
        els.map((el) => el.textContent)
      ),
      [DEMO, FAV2]
    );
    deepStrictEqual(
      await page.$$eval('#favorites-list .favorite-ens', (els: any[]) =>
        els.map((el) => el.textContent)
      ),
      ['', 'favtwo.eth'],
      'ENS shown only where captured, without extra requests'
    );
    ok(!(await $('favorites-scan').isDisabled()), 'history load enabled');
  });

  should('show combined balances below the list', async () => {
    await page.waitForFunction(
      () => {
        const text = document.getElementById('favorites-balances')!.textContent!;
        return text.length > 0 && text !== 'Loading…';
      },
      undefined,
      { timeout: T }
    );
    match(
      (await $('favorites-balances').textContent()) || '',
      /ETH\s+\d/,
      'summed ETH balance shown'
    );
  });

  should('load merged histories of all favorites (historyMulti)', async () => {
    deepStrictEqual(await $('favorites-scan').textContent(), 'Load histories');
    await page.click('#favorites-scan');
    await visible('favorites-tx-table');
    const count = await page.$$eval('#favorites-rows tr', (trs: any[]) => trs.length);
    ok(count > 25, `merged stream has both favorites' rows (got ${count})`);
    deepStrictEqual(
      await page.$$eval('#favorites-rows tr:first-child td', (tds: any[]) => tds.length),
      5,
      'participants column present'
    );
    const participants = await page.$$eval('#favorites-rows td.addresses', (tds: any[]) =>
      tds.map((td) => ({ text: td.textContent, muted: td.classList.contains('muted') }))
    );
    // the column shows short(address, 6): '0x7099…dc79C8'
    ok(
      participants.some(({ text }: any) => text.startsWith(DEMO.slice(0, 6))) &&
        participants.some(({ text }: any) => text.startsWith(FAV2.slice(0, 6))),
      'both favorites appear as participants'
    );
    ok(
      participants.every(({ text }: any) => text.length > 0),
      'every row is attributed to a favorite'
    );
    ok(
      participants.every(({ muted }: any) => !muted),
      'participants render in normal color'
    );
    deepStrictEqual(
      await $('favorites-scan').textContent(),
      'Load token transactions',
      'button becomes the token-scan stage'
    );
  });

  should('deepen favorites history with a token scan', async () => {
    await page.click('#favorites-scan');
    await page.waitForFunction(
      () => document.getElementById('favorites-scan')!.textContent!.startsWith('✓'),
      undefined,
      { timeout: T }
    );
    deepStrictEqual(await $('favorites-scan').textContent(), '✓ Token transactions loaded');
    ok(await $('favorites-scan').isDisabled(), 'scan button done');
    deepStrictEqual(await $('favorites-progress').textContent(), '', 'progress cleared');
    const count = await page.$$eval('#favorites-rows tr', (trs: any[]) => trs.length);
    ok(count > 25, `rows still rendered after the scan (got ${count})`);
  });

  should('return to favorites from a merged row details', async () => {
    await page.click('#favorites-rows tr:first-child');
    await modalOpen();
    await page.click('#back-button');
    await visible('favorites-view');
  });

  should('run the token scan to completion', async () => {
    await page.click('#favorites-back');
    await visible('overview');
    await page.click('#scan-button');
    await page.waitForFunction(
      () => document.getElementById('scan-button')!.textContent!.startsWith('✓'),
      undefined,
      { timeout: T }
    );
    deepStrictEqual(await $('progress').textContent(), '', 'progress cleared');
    ok(await $('scan-button').isDisabled(), 'scan button done');
  });

  // the pinned head keeps NFT mints out of the scanned range, so the recorded
  // outcome is the empty-inventory path: candidates checked, nothing held
  should('verify NFT holdings (empty inventory)', async () => {
    await page.click('#nft-button');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('#nfts .nft-item').length > 0 ||
        document.getElementById('nft-status')!.textContent!.includes('No NFTs'),
      undefined,
      { timeout: T }
    );
    deepStrictEqual(await $('nft-status').textContent(), 'No NFTs currently held.');
    ok(!(await $('nft-button').isVisible()), 'view button gone after check');
  });

  should('open a favorite address from the favorites page', async () => {
    await page.click('#favorites-button');
    await visible('favorites-view');
    await page.click('#favorites-list tr:nth-child(2) .favorite-address');
    await visible('overview');
    deepStrictEqual(await $('address-line').textContent(), FAV2);
    deepStrictEqual(await $('favorite-button').textContent(), '★ Favorited');
  });

  should('remove favorites, resetting merged data and hiding the entry point', async () => {
    await page.click('#favorites-button');
    await visible('favorites-view');
    await page.click('#favorites-list tr:nth-child(2) button');
    deepStrictEqual(
      await page.$$eval('#favorites-list .favorite-addr', (els: any[]) =>
        els.map((el) => el.textContent)
      ),
      [DEMO]
    );
    deepStrictEqual(await storage(), [{ address: DEMO }]);
    deepStrictEqual(
      await $('favorites-scan').textContent(),
      'Load histories',
      'set change resets the staged button'
    );
    ok(await $('favorites-tx-table').isHidden(), 'stale merged table cleared');
    await page.click('#favorites-list tr:nth-child(1) button');
    deepStrictEqual(await storage(), []);
    ok(await $('favorites-empty').isVisible(), 'empty message shown');
    ok(await $('favorites-balances-block').isHidden(), 'balances section hidden');
    ok(await $('favorites-button').isHidden(), 'nav entry point hidden again');
    await page.click('#favorites-back');
    await visible('overview');
  });

  should('answer every request from fixtures, with no page errors', () => {
    if (RECORD) ok(Object.keys(fixtures.rpc).length > 0, 'recorded rpc fixtures');
    else deepStrictEqual(misses, [], 'requests missing from fixtures');
    deepStrictEqual(pageErrors, [], 'uncaught page errors');
  });
});

should.runWhen(import.meta.url);
