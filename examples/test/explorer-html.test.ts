import { describe, should, beforeAll, afterAll } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, match, ok } from 'node:assert';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
UI tests for examples/explorer/index.html, driven in headless Chromium (playwright-core).
All network I/O is replayed from examples/test/fixtures/explorer-html.json: JSON-RPC calls
are answered per-call by a local server, other hosts (NFT metadata) via request
interception. Not part of `npm test` (needs a browser + built artifacts):
  npm run build && npm run test:ui
Re-record fixtures against a real node (tests define what gets recorded, so
re-record after changing them; counts asserted below match the recorded data):
  EXPLORER_HTML_RECORD=1 ETH_RPC_URL=http://… node examples/test/explorer-html.test.ts
While a token scan runs, the chain head is pinned to a fake low block, so the
scan covers two log windows instead of the whole chain; everything else sees
the recorded real head (confirmation counts stay realistic).
*/

const RECORD = !!process.env.EXPLORER_HTML_RECORD;
const NODE_URL = process.env.ETH_RPC_URL || 'http://127.0.0.1';
const FAKE_HEAD = '0x493e0'; // 300_000: two 200k log windows
const T = RECORD ? 180_000 : 20_000; // waits are generous when talking to a real node

const DEMO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'; // EIP-7702-delegated EOA
const FAV2 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
// Fixture weight matters: an address whose newest OTS page reaches far back
// drags airdrop receipts (MBs each) in through the logs complement.
const FAV3 = '0x39F313926b21F41acDAA8C1806F9B66CA72ECb06'; // never used: empty history
const UNI_PAIR = '0xd3d2E2692501A5c9Ca623199D38826e513033a17'; // Uniswap V2 UNI/WETH: holds UNI
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
// 4 USDT to DEMO: one transfer, one Transfer log, EIP-1559
const TX = '0x5b11ceaf6faf3ff43cb96a4e58f31be8c9e19e791d5813b6a5685c784070f580';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixturesPath = join(root, 'examples', 'test', 'fixtures', 'explorer-html.json');

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
    'explorer-html: skipped (needs playwright-core, a chromium binary, built artifacts ' +
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
const rpcCalls = { total: 0, byMethod: new Map<string, number>(), keys: new Set<string>() }; // per JSON-RPC sub-call
let pinHead = false; // token scans only
async function rpcCall(method: string, params: unknown): Promise<RpcEntry> {
  rpcCalls.total++;
  rpcCalls.byMethod.set(method, (rpcCalls.byMethod.get(method) || 0) + 1);
  if (method === 'eth_blockNumber' && pinHead) return { result: FAKE_HEAD };
  const key = rpcKey(method, params);
  rpcCalls.keys.add(key);
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
// requests that reached the server under another origin's name (localhost
// instead of 127.0.0.1): the RPC allowlist must keep this at zero
let foreignHits = 0;
// Static files from the repo root (page, built artifacts, node_modules for the
// import map), POST /rpc* answered per-call from fixtures, and /redirect: a
// node that bounces requests to a different origin.
function startServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const { port } = server.address() as { port: number };
    if (req.headers.host === `localhost:${port}`) foreignHits++;
    if (req.url === '/redirect') {
      res.statusCode = 307;
      res.setHeader('Location', `http://localhost:${port}/rpc`);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.end();
    }
    if (req.method === 'POST' && req.url?.startsWith('/rpc')) {
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

(runnable ? describe : describe.skip)('explorer/index.html', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let browser: any;
  let page: any;
  const $ = (id: string) => page.locator(`#${id}`);
  const visible = (id: string) => page.waitForSelector(`#${id}:not(.hidden)`, { timeout: T });
  const modalOpen = () => page.waitForSelector('#details-view[open]', { timeout: T });
  const textOf = (id: string) =>
    page.evaluate((i: string) => document.getElementById(i)!.textContent, id);
  const until = (fn: (arg: any) => boolean, arg?: unknown) =>
    page.waitForFunction(fn, arg, { timeout: T });
  const texts = (selector: string) =>
    page.$$eval(selector, (els: any[]) => els.map((el) => el.textContent));
  const storage = async () =>
    JSON.parse(await page.evaluate(() => localStorage.getItem('eth-explorer-favorites') || '[]'));
  const search = async (value: string) => {
    await $('address-input').fill(value);
    await page.click('#address-form button[type=submit]');
  };
  const openAddress = async (value: string) => {
    await search(value);
    await until((a: string) => {
      const overview = document.getElementById('overview')!;
      return (
        !overview.classList.contains('hidden') &&
        document.getElementById('address-line')!.textContent === a
      );
    }, value);
  };

  beforeAll(async () => {
    server = await startServer();
    browser = await chromium.launch({ executablePath: executable });
    page = await browser.newPage();
    page.on('pageerror', (err: unknown) => pageErrors.push(String(err)));
    // Anything not served by our origin: NFT metadata JSON etc. Images are
    // dropped (tiles fall back to the placeholder), the rest is fixtures.
    await page.route('**/*', async (route: any) => {
      const url = route.request().url();
      if (url.startsWith(server.origin) || url.startsWith('http://localhost:'))
        return route.continue();
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
    await page.goto(`${server.origin}/examples/explorer/index.html?rpc=${server.origin}/rpc`);
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
        `explorer-html: recorded ${Object.keys(fixtures.rpc).length} rpc + ` +
          `${Object.keys(fixtures.http).length} http fixtures`
      );
    }
  });

  should('show the node: chain and client', async () => {
    await until(() => !document.getElementById('node-text')!.textContent!.includes('connecting'));
    match(
      (await textOf('node-text')) || '',
      /^Node 127\.0\.0\.1:\d+ · Mainnet \(chain 1\) · erigon\/[\d.]+$/,
      'host only, chain, client; no warnings for a mainnet ots_ node'
    );
  });

  should('reject invalid input', async () => {
    await search('not-an-address');
    deepStrictEqual(
      await $('status').textContent(),
      'Not an address, .eth/.gwei name or transaction hash.'
    );
    ok(await page.evaluate(() => document.body.classList.contains('empty')));
  });

  should('hide the favorites entry point while there are no favorites', async () => {
    ok(!(await $('favorites-button').isVisible()), 'nav button hidden');
  });

  should('report a name that does not resolve', async () => {
    await search('nosuch-name-for-tests.eth');
    await until(() => document.getElementById('status')!.textContent!.includes('did not resolve'));
    deepStrictEqual(
      await $('status').textContent(),
      'Name nosuch-name-for-tests.eth did not resolve.'
    );
  });

  should('load an address: balances, account kind and transaction rows', async () => {
    await openAddress(DEMO);
    match((await $('balances').textContent()) || '', /^ETH\s+\d/, 'ETH balance first');
    match(
      (await $('account-line').textContent()) || '',
      /^EOA · [\d,]+ transactions sent · EIP-7702 delegated to 0x[0-9a-fA-F]{40}$/,
      'sent count (nonce) and the 7702 delegate'
    );
    ok(await page.isVisible('#account-line a'), 'the delegate is a link');
    deepStrictEqual(await $('token-line').textContent(), '', 'not a token');
    const rows = await page.$$('#rows tr');
    ok(rows.length >= 25, `ots quick-view page plus logs complement (got ${rows.length})`);
    deepStrictEqual(await page.$$eval('#rows tr:first-child td', (tds: any[]) => tds.length), 4);
    match(await page.textContent('#rows tr:first-child td.time'), /^\d+\/\d+ \d+:\d+|^pending/);
    // the ots+logs quick view decodes token movements: signed amounts with a symbol
    const amounts = await texts('#rows td.amount');
    ok(
      amounts.some((a: string) => /^[+-][\d~.]+ [A-Z]+$/.test(a)),
      'token transfer amounts rendered in the quick view'
    );
    ok(!(await $('empty').isVisible()), 'no-transactions note hidden');
    ok(await $('older-button').isVisible(), 'older pages offered');
  });

  should('load older transactions: the next OTS page below the oldest row', async () => {
    const before = await page.$$eval('#rows tr', (trs: any[]) => trs.length);
    const otsCalls = rpcCalls.byMethod.get('ots_searchTransactionsBefore') || 0;
    await page.click('#older-button');
    await until((n: number) => document.querySelectorAll('#rows tr').length > n, before);
    const after = await page.$$eval('#rows tr', (trs: any[]) => trs.length);
    ok(after >= before + 25, `a whole page appended (${before} -> ${after})`);
    deepStrictEqual(
      rpcCalls.byMethod.get('ots_searchTransactionsBefore'),
      otsCalls + 1,
      'one OTS page per click'
    );
    const cursors = [...rpcCalls.keys]
      .filter((key) => key.startsWith('ots_searchTransactionsBefore '))
      .map((key) => JSON.parse(key.slice(key.indexOf('['))) as [string, string | number, number])
      .filter(([address]) => address.toLowerCase() === DEMO.toLowerCase());
    ok(
      cursors.some(([, block]) => Number(block) > 0),
      'paged with a block cursor'
    );
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
    const labels = await texts('#details-view dt');
    for (const label of [
      'time',
      'status',
      'confirmations',
      'from',
      'to',
      'amount eth',
      'intent',
      'method',
      'type',
      'fee',
      'gas price',
      'gas spent',
      'nonce',
      'position',
    ])
      ok(labels.includes(label), `details show ${label}`);
    ok(!labels.includes('txid'), 'web details hide txid');
    const headings = await texts('#details-view h3');
    match(headings[0], /^Token transfers \(\d+\)$/);
    match(headings[1], /^Event logs \(\d+\)$/);
    match(await page.textContent('#details-view dd:nth-of-type(4)'), /^0x[0-9a-fA-F]{40}$/, 'from');
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
    deepStrictEqual(rpcCalls.total, before, 'no repeat fetch for a confirmed tx (head reused)');
  });

  should('reuse the history download for a first-time open', async () => {
    // the ots+logs quick view downloads log-found txs via
    // eth_getTransactionByHash itself; the check is that opening details
    // adds none — every opened tx arrived in full through a history stream
    // and was remembered
    const before = rpcCalls.byMethod.get('eth_getTransactionByHash') || 0;
    await page.click('#rows tr:nth-child(5)'); // a row no test opened before
    await modalOpen();
    await page.click('#back-button');
    deepStrictEqual(rpcCalls.byMethod.get('eth_getTransactionByHash') || 0, before);
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

  should('list favorites with captured ENS names, balances and account kinds', async () => {
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
    deepStrictEqual(await $('favorites-title').textContent(), 'Favorites (2)');
    deepStrictEqual(await texts('#favorites-list .favorite-addr'), [DEMO, FAV2]);
    deepStrictEqual(
      await texts('#favorites-list .favorite-ens'),
      ['', 'favtwo.eth'],
      'ENS shown only where captured, without extra requests'
    );
    await until(() =>
      [...document.querySelectorAll('#favorites-list .favorite-kind')].every((el) => el.textContent)
    );
    for (const kind of await texts('#favorites-list .favorite-kind'))
      match(kind, /^EOA · [\d,]+ transactions sent · EIP-7702$/);
    for (const amount of await texts('#favorites-list .favorite-amount'))
      match(amount, /^[\d~.]+ ETH$/, 'each member shows its own ETH');
  });

  should('show combined balances below the list', async () => {
    await until(() => {
      const text = document.getElementById('favorites-balances')!.textContent!;
      return text.length > 0 && text !== 'Loading…';
    });
    match(
      (await $('favorites-balances').textContent()) || '',
      /ETH\s+\d/,
      'summed ETH balance shown'
    );
  });

  should('load the merged history of all favorites with the page', async () => {
    await visible('favorites-tx-table');
    const count = await page.$$eval('#favorites-rows tr', (trs: any[]) => trs.length);
    ok(count > 25, `merged list has both favorites' rows (got ${count})`);
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
    deepStrictEqual(await $('favorites-scan').textContent(), 'Load token transactions');
    ok(!(await $('favorites-scan').isDisabled()), 'token scan offered');
  });

  should('page the favorites history back, one cursor per favorite', async () => {
    ok(await $('favorites-older').isVisible(), 'older pages offered');
    const before = await page.$$eval('#favorites-rows tr', (trs: any[]) => trs.length);
    const otsCalls = rpcCalls.byMethod.get('ots_searchTransactionsBefore') || 0;
    await page.click('#favorites-older');
    await until((n: number) => document.querySelectorAll('#favorites-rows tr').length > n, before);
    deepStrictEqual(
      rpcCalls.byMethod.get('ots_searchTransactionsBefore'),
      otsCalls + 2,
      'one OTS page per favorite'
    );
  });

  should('deepen favorites history with a token scan', async () => {
    pinHead = true;
    await page.click('#favorites-scan');
    await until(() => document.getElementById('favorites-scan')!.textContent!.startsWith('✓'));
    pinHead = false;
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
    pinHead = true;
    await page.click('#scan-button');
    await until(() => document.getElementById('scan-button')!.textContent!.startsWith('✓'));
    pinHead = false;
    deepStrictEqual(await $('progress').textContent(), '', 'progress cleared');
    ok(await $('scan-button').isDisabled(), 'scan button done');
  });

  // the pinned head keeps NFT mints out of the scanned range, so the recorded
  // outcome is the empty-inventory path: candidates checked, nothing held
  should('verify NFT holdings (empty inventory)', async () => {
    await page.click('#nft-button');
    await until(
      () =>
        document.querySelectorAll('#nfts .nft-item').length > 0 ||
        document.getElementById('nft-status')!.textContent!.includes('No NFTs')
    );
    deepStrictEqual(await $('nft-status').textContent(), 'No NFTs currently held.');
    ok(!(await $('nft-button').isVisible()), 'view button gone after check');
  });

  should('open a favorite address from the favorites page', async () => {
    await page.click('#favorites-button');
    await visible('favorites-view');
    await page.click('#favorites-list tr:nth-child(2) .favorite-address');
    await until((a: string) => document.getElementById('address-line')!.textContent === a, FAV2);
    await visible('overview');
    deepStrictEqual(await $('favorite-button').textContent(), '★ Favorited');
  });

  should('add a favorite from the favorites page', async () => {
    await page.click('#favorites-button');
    await visible('favorites-view');
    await $('favorite-add-input').fill(FAV2);
    await page.click('#favorite-add-form button');
    deepStrictEqual(await $('favorite-add-status').textContent(), 'Already a favorite.');
    await $('favorite-add-input').fill('not-an-address');
    await page.click('#favorite-add-form button');
    deepStrictEqual(await $('favorite-add-status').textContent(), 'Invalid Ethereum address.');
    await $('favorite-add-input').fill(FAV3.toLowerCase());
    await page.click('#favorite-add-form button');
    deepStrictEqual(await texts('#favorites-list .favorite-addr'), [DEMO, FAV2, FAV3]);
    deepStrictEqual((await storage()).at(-1), { address: FAV3 }, 'stored checksummed');
    deepStrictEqual(await $('favorites-scan').textContent(), 'Load token transactions');
    // the changed set reloads: member stats for all three, history (the new
    // one has none, so rows stay the other two's)
    await until(() => document.querySelectorAll('#favorites-list .favorite-kind')[2].textContent);
    deepStrictEqual(
      await page.textContent('#favorites-list tr:nth-child(3) .favorite-kind'),
      'EOA · 0 transactions sent'
    );
    await until(() => document.querySelectorAll('#favorites-rows tr').length > 0);
    ok(
      (await texts('#favorites-rows td.addresses')).every(
        (t: string) => !t.startsWith(FAV3.slice(0, 6))
      ),
      'no rows for an unused address'
    );
  });

  should('remove favorites, resetting merged data and hiding the entry point', async () => {
    await page.click('#favorites-list tr:nth-child(3) .remove');
    await page.click('#favorites-list tr:nth-child(2) .remove');
    deepStrictEqual(await texts('#favorites-list .favorite-addr'), [DEMO]);
    deepStrictEqual(await storage(), [{ address: DEMO }]);
    deepStrictEqual(
      await $('favorites-scan').textContent(),
      'Load token transactions',
      'set change resets the scan'
    );
    // the remaining set reloads: only DEMO participates
    await until(
      (a: string) => {
        const cells = [...document.querySelectorAll('#favorites-rows td.addresses')];
        return cells.length > 0 && cells.every((td) => td.textContent!.startsWith(a));
      },
      DEMO.slice(0, 6)
    );
    await page.click('#favorites-list tr:nth-child(1) .remove');
    deepStrictEqual(await storage(), []);
    ok(await $('favorites-empty').isVisible(), 'empty message shown');
    ok(await $('favorites-data').isHidden(), 'balances and history hidden');
    ok(await $('favorites-button').isHidden(), 'nav entry point hidden again');
    await page.click('#favorites-back');
    await visible('overview');
  });

  should('open a transaction page by hash', async () => {
    await search(TX);
    await visible('tx-view');
    ok(await $('overview').isHidden(), 'a page, not a modal');
    deepStrictEqual(await $('tx-hash').textContent(), TX);
    const pairs = Object.fromEntries(
      await page.$$eval('#tx-body dt', (dts: any[]) =>
        dts.map((dt) => [dt.textContent, dt.nextElementSibling.textContent])
      )
    );
    match(pairs.status, /^success · block 26155898$/);
    match(pairs.confirmations, /^[\d,]+$/);
    deepStrictEqual(pairs.type, 'EIP-1559 · type 2');
    match(pairs.intent, /^Transfer 4 USDT to 0x70997970/);
    for (const label of [
      'fee',
      'burnt',
      'priority tip',
      'saved',
      'base fee',
      'max fee',
      'max priority fee',
    ])
      ok(label in pairs, `fee breakdown shows ${label}`);
    match(pairs['gas spent'], /^\d+ out of \d+ \([\d.]+%\)$/);
    deepStrictEqual(await texts('#tx-body h3'), ['Token transfers (1)', 'Event logs (1)']);
    deepStrictEqual(await texts('#tx-body .transfers td.amount'), ['4 USDT']);
    match(
      await page.textContent('#tx-body .log'),
      /^#\d+ 0xdac1…831ec7 Transfer\(address,address,uint256\)/
    );
    match(await page.textContent('#tx-body .log pre'), /^topic0 0xddf252ad/);
  });

  should('go back from the tx page to where it came from', async () => {
    await page.click('#tx-back');
    await visible('overview');
    deepStrictEqual(await $('address-line').textContent(), FAV2);
    await page.keyboard.press('Escape'); // no-op on the overview
    await search(TX);
    await visible('tx-view');
    await page.keyboard.press('Escape');
    await visible('overview');
  });

  should('follow a tx page link to an address', async () => {
    await search(TX);
    await visible('tx-view');
    deepStrictEqual(
      await page.$$eval('#tx-body dd a', (as: any[]) => as.map((a) => a.textContent)),
      ['0x26d44e94395908aeaac0a270786d4fd50b672684', USDT.toLowerCase()],
      'from/to are links'
    );
    match(
      await page.getAttribute('#tx-body .transfers a >> nth=1', 'href'),
      new RegExp(`^\\?address=${DEMO.toLowerCase()}&rpc=`),
      'a real href: opens in a new tab too'
    );
    await page.click('#tx-body .transfers a >> nth=1'); // the recipient
    await until((a: string) => document.getElementById('address-line')!.textContent === a, DEMO);
    await visible('overview');
  });

  should('detect a contract; check all known tokens when opted in', async () => {
    await openAddress(UNI_PAIR);
    match(
      (await $('account-line').textContent()) || '',
      /^Contract · created by 0x5C69…c5aA6f in /
    );
    deepStrictEqual(
      await page.$$eval('#account-line a', (as: any[]) =>
        as.map((a) => a.getAttribute('href').split('&')[0])
      ),
      [
        '?address=0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
        '?tx=0x5471e065c8adcc6238899285d749fd5dd40f3f2ee8e3af59936573eb150ea750',
      ],
      'creator and creation tx link to their pages'
    );
    deepStrictEqual(
      await $('token-line').textContent(),
      'Token · Uniswap V2 (UNI-V2) · ERC20 · 18 decimals',
      'a token outside the registry, detected on-chain'
    );
    const label = await page.textContent('#overview label.check');
    match(label, /^ Check all \d+ known tokens$/);
    ok(!(await $('balances').textContent())!.includes('UNI'), 'curated five by default');
    await page.check('#overview .all-tokens');
    await until(() => document.getElementById('balances')!.textContent!.includes('UNI'));
    match((await $('balances').textContent()) || '', /\nUNI\s+\d/);
    deepStrictEqual(
      await page.evaluate(() => localStorage.getItem('eth-explorer-all-tokens')),
      '1'
    );
    ok(await page.isChecked('#favorites-view .all-tokens'), 'one setting for every page');
    await page.uncheck('#overview .all-tokens');
    await until(() => !document.getElementById('balances')!.textContent!.includes('UNI'));
    deepStrictEqual(
      await page.evaluate(() => localStorage.getItem('eth-explorer-all-tokens')),
      null
    );
  });

  should('flag being offline', async () => {
    ok(await $('offline').isHidden());
    await page.context().setOffline(true);
    await visible('offline');
    await page.context().setOffline(false);
    await page.waitForSelector('#offline.hidden', { state: 'attached', timeout: T });
    // back online, the node is probed again
    await until(() => !document.getElementById('node-text')!.textContent!.includes('connecting'));
  });

  should('switch nodes from the page; refuse a node that redirects elsewhere', async () => {
    const nodeText = await textOf('node-text');
    await page.click('#node-change');
    ok(await $('node-form').isVisible());
    deepStrictEqual(await $('node-input').inputValue(), `${server.origin}/rpc`);
    await $('node-input').fill('ftp://example.com');
    await page.click('#node-form button[type=submit]');
    match((await $('status').textContent()) || '', /^Invalid RPC URL: ftp:\/\/example\.com/);
    // micro-ftch is pinned to the node's origin: the bounce is never followed
    await $('node-input').fill(`${server.origin}/redirect`);
    await page.click('#node-form button[type=submit]');
    await until(() =>
      document.getElementById('status')!.textContent!.startsWith('Could not connect')
    );
    deepStrictEqual(foreignHits, 0, 'no request reached the other origin');
    deepStrictEqual(await textOf('node-text'), nodeText, 'still on the old node');
    await $('node-input').fill(`${server.origin}/rpc?node=2`);
    await page.check('#node-remember');
    await page.click('#node-form button[type=submit]');
    // the page reloads what it showed from the new node
    await until(
      () =>
        !!localStorage.getItem('eth-explorer-rpc') &&
        !document.getElementById('overview')!.classList.contains('hidden') &&
        document.getElementById('status')!.textContent === ''
    );
    ok(await $('node-form').isHidden(), 'form closes on success');
    deepStrictEqual(await $('address-line').textContent(), UNI_PAIR);
    deepStrictEqual(
      await page.evaluate(() => localStorage.getItem('eth-explorer-rpc')),
      `${server.origin}/rpc?node=2`
    );
  });

  should('open a ?tx= link on the remembered node', async () => {
    await page.goto(`${server.origin}/examples/explorer/index.html?tx=${TX}`);
    await visible('tx-view');
    deepStrictEqual(await $('tx-hash').textContent(), TX);
    match((await textOf('node-text')) || '', /Mainnet/);
  });

  should('answer every request from fixtures, with no page errors', () => {
    if (RECORD) ok(Object.keys(fixtures.rpc).length > 0, 'recorded rpc fixtures');
    else deepStrictEqual(misses, [], 'requests missing from fixtures');
    deepStrictEqual(pageErrors, [], 'uncaught page errors');
  });
});

should.runWhen(import.meta.url);
