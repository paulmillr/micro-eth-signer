import { describe, should, beforeAll, afterAll } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, match, ok } from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import encodeQR from 'qr';
import { eip191Signer, Transaction } from '../../src/index.ts';
import { ethHex } from '../../src/utils.ts';
import { ERC20, createContract } from '../../src/abi/index.ts';
import { createColdSigner } from '../airgap/cold.js';
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
UI tests for examples/airgap/hot.html + cold.html, driven in headless Chromium
(playwright-core) as two separate browser contexts — two devices whose only
link is QR codes. Every QR input path is exercised:
  - camera: Chromium's fake capture device plays a generated .y4m video of the
    cold signer's pairing QR, which the hot page scans live;
  - image: screenshots of one page's QR canvas, uploaded to the other page
    (frame by frame for the animated multi-part request);
  - text: the UR text of one page, pasted into the other.
The hot page's RPC replays examples/test/fixtures/tx-demo.json through the
shared harness (examples/test/tx-demo-rpc.ts: pinned balance, gas estimates,
and eth_sendRawTransaction always erroring — the suite asserts it was never
called). The cold page must make no network request at all.
Not part of `npm test` (needs a browser + built artifacts):
  npm run build && cd examples && npm test
*/

const T = RECORD ? 180_000 : 20_000;

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
    'airgap-html: skipped (needs playwright-core, a chromium binary, built artifacts ' +
      'and recorded fixtures — see comment at the top of the file)'
  );

const rpc = createFixtureRpc();
const pageErrors: string[] = [];

// A looping fake-camera video (YUV4MPEG2, 4:2:0) showing one QR code, black
// on white with a quiet zone, the way a phone would see the cold screen.
function qrVideo(text: string, dir: string): string {
  const modules = encodeQR(text.toUpperCase(), 'raw', { ecc: 'low', border: 4 });
  const scale = 8;
  const size = Math.ceil((modules.length * scale + 64) / 16) * 16;
  const offset = Math.floor((size - modules.length * scale) / 2);
  const luma = new Uint8Array(size * size).fill(255);
  modules.forEach((row, y) =>
    row.forEach((on, x) => {
      if (!on) return;
      for (let dy = 0; dy < scale; dy++)
        luma.fill(
          0,
          (offset + y * scale + dy) * size + offset + x * scale,
          (offset + y * scale + dy) * size + offset + (x + 1) * scale
        );
    })
  );
  const chroma = new Uint8Array((size / 2) * (size / 2) * 2).fill(128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma]);
  const file = join(dir, 'pairing.y4m');
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${size} H${size} F10:1 Ip A1:1 C420jpeg\n`),
      frame,
      frame,
    ])
  );
  return file;
}

(runnable ? describe : describe.skip)('airgap/hot.html + cold.html', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let browser: any;
  let hot: any;
  let cold: any;
  let videoDir: string;
  const coldRequests: string[] = []; // after the page finished loading
  let coldLoaded = false;

  const on = (page: any) => (id: string) => page.locator(`#${id}`);
  const H = (id: string) => on(hot)(id);
  const C = (id: string) => on(cold)(id);
  const scan = (page: any, block: string, part: string) =>
    page.locator(`#${block} [data-scan="${part}"]`);
  const textIs = (page: any, selector: string, pattern: RegExp) =>
    page.waitForFunction(
      ([sel, source, flags]: string[]) =>
        new RegExp(source, flags).test(document.querySelector(sel)?.textContent || ''),
      [selector, pattern.source, pattern.flags],
      { timeout: T }
    );
  const fields = (page: any, list: string) =>
    page.$$eval(`#${list} dt`, (dts: any[]) =>
      Object.fromEntries(dts.map((dt) => [dt.textContent, dt.nextElementSibling.textContent]))
    );
  // QR canvas of one page -> image upload on the other
  async function carryImage(from: any, canvas: string, to: any, block: string) {
    const png = await from.locator(`#${canvas}`).screenshot();
    await scan(to, block, 'file').setInputFiles({
      name: 'qr.png',
      mimeType: 'image/png',
      buffer: png,
    });
  }
  // UR text of one page -> paste on the other
  async function carryText(from: any, textarea: string, to: any, block: string) {
    const text = await from.locator(`#${textarea}`).inputValue();
    await scan(to, block, 'text').fill(text);
    await scan(to, block, 'read').click();
  }
  const signedTx = async () => {
    const tx = Transaction.fromHex(((await H('result-hex').textContent()) || '').trim());
    deepStrictEqual(tx.sender, DEMO, 'signed by the paired key');
    return tx;
  };

  beforeAll(async () => {
    server = await startServer(rpc);
    videoDir = mkdtempSync(join(tmpdir(), 'airgap-'));
    // the pairing QR is deterministic for a given key: the camera can show it upfront
    const pairingFrame = createColdSigner(DEMO_KEY).pairing().nextPart();
    browser = await chromium.launch({
      executablePath: executable,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${qrVideo(pairingFrame, videoDir)}`,
      ],
    });
    // two contexts: two devices sharing nothing but what the test carries
    hot = await (await browser.newContext()).newPage();
    cold = await (await browser.newContext()).newPage();
    for (const page of [hot, cold])
      page.on('pageerror', (err: unknown) => pageErrors.push(String(err)));
    cold.on('request', (req: any) => coldLoaded && coldRequests.push(req.url()));
    await hot.goto(`${server.origin}/examples/airgap/hot.html?rpc=${server.origin}/rpc`);
    await cold.goto(`${server.origin}/examples/airgap/cold.html`);
    await cold.waitForLoadState('networkidle');
    coldLoaded = true;
  });
  afterAll(async () => {
    await browser?.close();
    await server?.close();
    if (videoDir) rmSync(videoDir, { recursive: true, force: true });
    rpc.save();
  });

  should('cold: the page itself cannot reach the network', async () => {
    const result = await cold.evaluate(() =>
      fetch('/rpc', { method: 'POST', body: '{}' }).then(
        () => 'reached',
        () => 'blocked'
      )
    );
    deepStrictEqual(result, 'blocked', 'connect-src none');
    const csp = await cold.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
    match(csp, /connect-src 'none'/);
  });

  should('cold: reject an invalid key, unlock a valid one, show the pairing QR', async () => {
    await C('key-input').fill('not-a-key');
    await C('unlock-button').click();
    deepStrictEqual(
      await C('status').textContent(),
      'Invalid private key: expected 64 hex characters.'
    );
    ok(await C('signer').isHidden());
    await C('key-input').fill(DEMO_KEY);
    await C('unlock-button').click();
    await cold.waitForSelector('#signer:not([hidden])', { timeout: T });
    deepStrictEqual(await C('address-line').textContent(), DEMO);
    deepStrictEqual(await C('key-input').inputValue(), '', 'the field forgets the key');
    match(await C('pair-text').inputValue(), /^ur:crypto-hdkey\/[a-z]+$/);
    ok(await C('lock-button').isVisible());
  });

  should('hot: pair by camera, then load the watch-only account', async () => {
    await scan(hot, 'pair-scan', 'camera').click();
    await hot.waitForSelector('#account:not([hidden])', { timeout: T });
    deepStrictEqual(await H('address-line').textContent(), DEMO);
    match(
      (await H('account-path').textContent()) || '',
      /watch-only · Mainnet · key \[[0-9a-f]{8}\] m/
    );
    const balances = (await H('balances').textContent()) || '';
    match(balances, /ETH\s+2\.5/, 'pinned ETH balance');
    match(balances, /CAT\s+1/, 'discovered token balance');
    deepStrictEqual((await hot.$$('#rows tr')).length, 26, 'same history as the tx demo');
    ok(await scan(hot, 'pair-scan', 'video').isHidden(), 'camera released after the scan');
  });

  should('ETH transfer: request QR -> cold review -> signature QR -> signed tx', async () => {
    await H('asset-select').selectOption('0');
    await H('to-input').fill(RECIPIENT);
    await H('amount-input').fill('0.1');
    await H('tx-button').click();
    await hot.waitForSelector('#request:not([hidden])', { timeout: T });
    deepStrictEqual(await H('request-caption').textContent(), 'Scan this with the cold signer.');
    match(await H('request-text').inputValue(), /^ur:eth-sign-request\/[a-z]+$/, 'one part');
    const shown = await fields(hot, 'request-fields');
    deepStrictEqual(shown.simulation, 'would succeed', 'prepared like the tx demo');

    await carryImage(hot, 'request-qr', cold, 'request-scan');
    await cold.waitForSelector('#review:not([hidden])', { timeout: T });
    const review = await fields(cold, 'review-fields');
    deepStrictEqual(review.network, 'Ethereum mainnet (chain 1)');
    deepStrictEqual(review.from, DEMO);
    deepStrictEqual(review.to, RECIPIENT);
    deepStrictEqual(review.amount, '0.1 ETH');
    deepStrictEqual(review['requested by'], 'micro-eth-signer hot');
    ok(await C('warnings').isHidden(), 'nothing to warn about');

    await C('approve-button').click();
    await cold.waitForSelector('#signature:not([hidden])', { timeout: T });
    ok(await C('review').isHidden());
    await carryImage(cold, 'sig-qr', hot, 'sig-scan');
    await hot.waitForSelector('#result:not([hidden])', { timeout: T });
    match((await H('no-broadcast').textContent()) || '', /NOT broadcast/);
    ok(await H('request').isHidden(), 'the answered request is gone');
    const tx = await signedTx();
    deepStrictEqual(tx.raw.to, RECIPIENT);
    deepStrictEqual(tx.raw.value, 100000000000000000n);
    deepStrictEqual(tx.raw.chainId, 1n);
    deepStrictEqual((await fields(hot, 'result-fields')).txid, tx.hash);
    match(
      (await C('sig-caption').textContent()) || '',
      new RegExp(tx.hash),
      'same txid on both sides'
    );
    await C('done-button').click();
  });

  should('ERC-20 transfer of an unknown token, carried as pasted text', async () => {
    await H('asset-select').selectOption('1');
    await H('to-input').fill(RECIPIENT);
    await H('amount-input').fill('0.5');
    await H('tx-button').click();
    await textIs(hot, '#request-fields', /CAT/);
    await carryText(hot, 'request-text', cold, 'request-scan');
    await cold.waitForSelector('#review:not([hidden])', { timeout: T });
    const review = await fields(cold, 'review-fields');
    // the cold side has no RPC: an uncurated token shows base units, flagged
    deepStrictEqual(review.amount, '500000000000000000 base units');
    deepStrictEqual(review.token, `${CAT} · unknown token`);
    match((await C('warnings').textContent()) || '', /Unknown token contract/);
    await C('approve-button').click();
    await cold.waitForSelector('#signature:not([hidden])', { timeout: T });
    await carryText(cold, 'sig-text', hot, 'sig-scan');
    await hot.waitForSelector('#result:not([hidden])', { timeout: T });
    const tx = await signedTx();
    deepStrictEqual(tx.raw.to, CAT);
    deepStrictEqual(
      tx.raw.data,
      ethHex.encode(
        createContract(ERC20).transfer.encodeInput({ to: RECIPIENT, value: 500000000000000000n })
      )
    );
    await C('done-button').click();
  });

  should('long message: animated request read frame by frame from screenshots', async () => {
    const message = `Sign in to example.org\n\n${'I accept the terms. '.repeat(25)}`;
    await H('mode-message').click();
    await H('msg-input').fill(message);
    await H('msg-button').click();
    await hot.waitForSelector('#request:not([hidden])', { timeout: T });
    const caption = (await H('request-caption').textContent()) || '';
    match(caption, /^Animated: \d+ parts/);
    // like a camera: grab whatever frame is on screen until the cold side completes
    for (let i = 0; i < 80 && (await C('review').isHidden()); i++)
      await carryImage(hot, 'request-qr', cold, 'request-scan');
    ok(await C('review').isVisible(), 'reassembled from animation frames');
    deepStrictEqual((await fields(cold, 'review-fields')).message, message);
    await C('approve-button').click();
    await cold.waitForSelector('#signature:not([hidden])', { timeout: T });
    await carryImage(cold, 'sig-qr', hot, 'sig-scan');
    await hot.waitForSelector('#result:not([hidden])', { timeout: T });
    const signature = ((await H('result-hex').textContent()) || '').trim();
    ok(eip191Signer.verify(signature, message, DEMO), 'signature verifies for the paired address');
    ok(
      !/NOT broadcast/.test((await H('no-broadcast').textContent()) || ''),
      'messages are not transactions'
    );
    await C('done-button').click();
    await H('mode-transfer').click();
  });

  should('hot: refuse a stale signature and a QR of the wrong kind', async () => {
    // sign one request, then create another: the first signature no longer fits
    await H('to-input').fill(RECIPIENT);
    await H('amount-input').fill('0.1');
    await H('asset-select').selectOption('0');
    await H('tx-button').click();
    await hot.waitForSelector('#request:not([hidden])', { timeout: T });
    await carryText(hot, 'request-text', cold, 'request-scan');
    await cold.waitForSelector('#review:not([hidden])', { timeout: T });
    await C('approve-button').click();
    await cold.waitForSelector('#signature:not([hidden])', { timeout: T });
    const stale = await C('sig-text').inputValue();
    const first = await H('request-text').inputValue();
    await H('tx-button').click();
    // a fresh request id: wait for it to replace the first request
    await hot.waitForFunction(
      (old: string) => (document.getElementById('request-text') as any).value !== old,
      first,
      { timeout: T }
    );
    await scan(hot, 'sig-scan', 'text').fill(stale);
    await scan(hot, 'sig-scan', 'read').click();
    await textIs(hot, '#sig-scan [data-scan="status"]', /answers request .* not the current one/);
    ok(await H('result').isHidden(), 'nothing accepted');
    await scan(hot, 'sig-scan', 'text').fill(await C('pair-text').inputValue());
    await scan(hot, 'sig-scan', 'read').click();
    await textIs(
      hot,
      '#sig-scan [data-scan="status"]',
      /Expected ur:eth-signature, got ur:crypto-hdkey/
    );
    await H('cancel-request').click();
    ok(await H('request').isHidden());
    await C('done-button').click();
  });

  should('cold: reject a request on demand, refuse a wrong-kind QR', async () => {
    await H('tx-button').click();
    await hot.waitForSelector('#request:not([hidden])', { timeout: T });
    await carryText(hot, 'request-text', cold, 'request-scan');
    await cold.waitForSelector('#review:not([hidden])', { timeout: T });
    await C('reject-button').click();
    ok(await C('review').isHidden(), 'review dismissed');
    ok(await C('signature').isHidden(), 'nothing signed');
    await scan(cold, 'request-scan', 'text').fill(await C('pair-text').inputValue());
    await scan(cold, 'request-scan', 'read').click();
    await textIs(
      cold,
      '#request-scan [data-scan="status"]',
      /Expected ur:eth-sign-request, got ur:crypto-hdkey/
    );
    await H('cancel-request').click();
  });

  should('hot: the pairing survives a reload; unpairing forgets it', async () => {
    await hot.reload();
    await hot.waitForSelector('#paired:not([hidden])', { timeout: T });
    deepStrictEqual(await H('paired-address').textContent(), DEMO);
    ok(await H('account').isHidden(), 'no RPC until the user opens the wallet');
    await H('unpair-button').click();
    ok(await H('unpaired').isVisible(), 'pairing scanner back');
    await hot.reload();
    ok(await H('unpaired').isVisible(), 'stays unpaired');
  });

  should('cold: lock forgets the key', async () => {
    await C('lock-button').click();
    ok(await C('signer').isHidden());
    ok(await C('key-form').isVisible());
    deepStrictEqual(await C('pair-text').inputValue(), '');
  });

  should('no broadcast, no cold network traffic, everything from fixtures', () => {
    deepStrictEqual(rpc.calls.sendRaw, 0, 'the demo must never broadcast');
    deepStrictEqual(rpc.calls.byMethod.get('eth_sendRawTransaction'), undefined);
    deepStrictEqual(coldRequests, [], 'the cold page made no request after loading');
    if (RECORD) ok(rpc.fixtureCount() > 0, 'recorded rpc fixtures');
    else deepStrictEqual(rpc.misses, [], 'requests missing from fixtures');
    deepStrictEqual(pageErrors, [], 'uncaught page errors');
  });
});

should.runWhen(import.meta.url);
