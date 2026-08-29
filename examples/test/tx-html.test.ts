import { describe, should, beforeAll, afterAll } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, match, ok } from 'node:assert';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Transaction } from '../../src/index.ts';
import { ethHex } from '../../src/utils.ts';
import { ERC20, createContract } from '../../src/abi/index.ts';
import {
  CAT,
  createFixtureRpc,
  DEMO,
  DEMO_KEY,
  fixturesPath,
  RECIPIENT,
  RECORD,
  root,
  startServer,
} from './tx-demo-rpc.ts';

/*
UI tests for examples/tx/index.html, driven in headless Chromium (playwright-core).
Network I/O replays from examples/test/fixtures/tx-demo.json through the shared
harness in examples/test/tx-demo-rpc.ts (see its header for recording and for the
pinned answers: fake ETH balance, fixed gas estimates, and the hard rule that
eth_sendRawTransaction always errors and must never be called at all).
Not part of `npm test` (needs a browser + built artifacts):
  npm run build && npm run test:ui
Counts asserted below match the recorded data.
*/

const T = RECORD ? 180_000 : 20_000; // waits are generous when talking to a real node

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
    'tx-html: skipped (needs playwright-core, a chromium binary, built artifacts ' +
      'and recorded fixtures — see comment at the top of the file)'
  );

const rpc = createFixtureRpc();
const pageErrors: string[] = [];

// parses the displayed raw hex back and checks it against expectations
function parseSigned(hex: string) {
  const tx = Transaction.fromHex(hex);
  deepStrictEqual(tx.isSigned, true, 'signed');
  deepStrictEqual(tx.sender, DEMO, 'signed by the demo key');
  return tx;
}

(runnable ? describe : describe.skip)('tx/index.html', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let browser: any;
  let page: any;
  const $ = (id: string) => page.locator(`#${id}`);
  const statusIs = (id: string, pattern: RegExp) =>
    page.waitForFunction(
      ([id, source, flags]: string[]) =>
        new RegExp(source, flags).test(document.getElementById(id)!.textContent!),
      [id, pattern.source, pattern.flags],
      { timeout: T }
    );
  async function createTx(assetIndex: number, to: string, amount: string) {
    await $('asset-select').selectOption(String(assetIndex));
    await $('to-input').fill(to);
    await $('amount-input').fill(amount);
    await page.click('#create-button');
  }

  beforeAll(async () => {
    server = await startServer(rpc);
    browser = await chromium.launch({ executablePath: executable });
    page = await browser.newPage();
    page.on('pageerror', (err: unknown) => pageErrors.push(String(err)));
    await page.goto(`${server.origin}/examples/tx/index.html?rpc=${server.origin}/rpc`);
  });
  afterAll(async () => {
    await browser?.close();
    await server?.close();
    rpc.save();
  });

  should('reject an invalid private key', async () => {
    await $('key-input').fill('not-a-key');
    await page.click('#signin-button');
    deepStrictEqual(
      await $('status').textContent(),
      'Invalid private key: expected 64 hex characters.'
    );
    ok(await $('account').isHidden(), 'account stays hidden');
  });

  should('fill the field with a generated throwaway key', async () => {
    await page.click('#random-button');
    match(await $('key-input').inputValue(), /^0x[0-9a-f]{64}$/, 'valid random key');
    deepStrictEqual(await $('key-input').getAttribute('type'), 'password', 'masked by default');
    await page.click('#show-key');
    deepStrictEqual(await $('key-input').getAttribute('type'), 'text', 'show toggle reveals');
    await page.click('#show-key');
  });

  should('sign in: address, balances, every token transfer listed', async () => {
    await $('key-input').fill(DEMO_KEY);
    await page.click('#signin-button');
    await page.waitForSelector('#account:not(.hidden)', { timeout: T });
    // signed in: the form gives way to the sign-out button
    ok(await $('signin').isHidden(), 'sign-in form hidden');
    ok(await $('signout-button').isVisible(), 'sign out shown');
    deepStrictEqual(await $('address-line').textContent(), DEMO);
    const balances = (await $('balances').textContent()) || '';
    match(balances, /ETH\s+2\.5/, 'pinned ETH balance');
    match(balances, /CAT\s+1/, 'discovered token balance');
    const rows = await page.$$('#rows tr');
    deepStrictEqual(rows.length, 26, 'ots rows plus the logs-only transfer');
    const amounts = await page.$$eval('#rows td.amount', (tds: any[]) =>
      tds.map((td) => td.textContent)
    );
    // the incoming CAT transfer never call-touches the address: only the logs
    // source finds it, and discovery decodes its amount
    ok(amounts.includes('+1 CAT'), 'incoming token transfer listed');
    ok(
      amounts.some((a: string) => a.includes('HUB')),
      'outgoing token transfer listed'
    );
    ok(
      amounts.some((a: string) => a.includes('ERC1155')),
      'NFT transfer listed'
    );
  });

  should('offer ETH and the held token as spendable assets', async () => {
    deepStrictEqual(
      await page.$$eval('#asset-select option', (opts: any[]) => opts.map((o) => o.textContent)),
      ['ETH · 2.5', 'CAT · 1']
    );
  });

  should('create an ETH transfer: signed hex shown, nothing broadcast', async () => {
    await createTx(0, RECIPIENT, '0.1');
    await page.waitForSelector('#result:not(.hidden)', { timeout: T });
    match(
      (await $('no-broadcast').textContent()) || '',
      /NOT broadcast/,
      'the page says so explicitly'
    );
    const tx = parseSigned((await $('tx-hex').textContent())!.trim());
    deepStrictEqual(tx.raw.to, RECIPIENT);
    deepStrictEqual(tx.raw.value, 100000000000000000n);
    deepStrictEqual(tx.raw.chainId, 1n);
    deepStrictEqual(tx.raw.data, '0x');
    const labels = await page.$$eval('#result-fields dt', (dts: any[]) =>
      dts.map((dt) => dt.textContent)
    );
    for (const label of [
      'network',
      'from',
      'to',
      'amount',
      'simulation',
      'nonce',
      'max total fee',
      'txid',
    ])
      ok(labels.includes(label), `result shows ${label}`);
    const fields = await page.$$eval('#result-fields dd', (dds: any[]) =>
      dds.map((dd) => dd.textContent)
    );
    ok(fields.includes('would succeed'), 'dry run simulated before signing');
  });

  should('create an ERC-20 transfer of the selected token', async () => {
    await createTx(1, RECIPIENT, '0.5');
    await statusIs('result-fields', /CAT/);
    const tx = parseSigned((await $('tx-hex').textContent())!.trim());
    deepStrictEqual(tx.raw.to, CAT, 'sent to the token contract');
    deepStrictEqual(tx.raw.value, 0n);
    deepStrictEqual(
      tx.raw.data,
      ethHex.encode(
        createContract(ERC20).transfer.encodeInput({ to: RECIPIENT, value: 500000000000000000n })
      ),
      'calldata is transfer(to, amount)'
    );
    const fields = await page.$$eval('#result-fields dd', (dds: any[]) =>
      dds.map((dd) => dd.textContent)
    );
    ok(fields.includes('0.5 CAT'), 'amount rendered in token units');
    // discovered in history rather than curated: the demo flags the trust level
    ok(fields.includes(`${CAT} · unverified`), 'token contract shown, marked unverified');
    // ERC-7730 clear-signing preview of the unsigned payload
    ok(
      fields.some((f: string) => /0\.5 CAT/.test(f) && /transfer/i.test(f)),
      `intent previewed (got: ${fields.join(' | ')})`
    );
    ok(fields.includes('would succeed'), 'token transfer simulated');
  });

  should('fill the largest sendable amount with Max', async () => {
    await $('asset-select').selectOption('1');
    await page.click('#max-button');
    // maxSpendable re-reads the balance from the node: wait for the fill
    await page.waitForFunction(
      () => (document.getElementById('amount-input') as any).value === '1',
      undefined,
      { timeout: T }
    );
    deepStrictEqual(await $('amount-input').inputValue(), '1', 'full token balance');
  });

  should('reject an amount above the balance without any signing', async () => {
    await createTx(0, RECIPIENT, '5');
    await statusIs('tx-status', /exceeds balance/);
    ok(await $('result').isHidden(), 'stale result cleared');
  });

  should('reject an invalid recipient', async () => {
    await createTx(0, 'nope', '0.1');
    await statusIs('tx-status', /Invalid recipient address/);
  });

  should('sign out: form returns, key forgotten', async () => {
    await page.click('#signout-button');
    ok(await $('signin').isVisible(), 'sign-in form back');
    ok(await $('signout-button').isHidden(), 'sign out gone');
    ok(await $('account').isHidden(), 'account view cleared');
    deepStrictEqual(await $('key-input').inputValue(), '', 'key does not outlive the session');
  });

  should('refuse to work against a node on the wrong chain (testnet switch)', async () => {
    await page.click('#network-sepolia');
    await $('rpc-input').fill(`${server.origin}/rpc`);
    await $('key-input').fill(DEMO_KEY);
    await page.click('#signin-button');
    await statusIs('status', /chain id 1, expected 11155111/);
    ok(await $('signin').isVisible(), 'failed sign-in keeps the form');
  });

  should('never call eth_sendRawTransaction, answer everything from fixtures', () => {
    deepStrictEqual(rpc.calls.sendRaw, 0, 'the demo must never broadcast');
    deepStrictEqual(rpc.calls.byMethod.get('eth_sendRawTransaction'), undefined);
    if (RECORD) ok(rpc.fixtureCount() > 0, 'recorded rpc fixtures');
    else deepStrictEqual(rpc.misses, [], 'requests missing from fixtures');
    deepStrictEqual(pageErrors, [], 'uncaught page errors');
  });
});

should.runWhen(import.meta.url);
