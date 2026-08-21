import { describe, should, beforeAll, afterAll } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, match, ok } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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
End-to-end test for examples/tx-cli.js: the CLI is spawned as a real process
with its prompts answered through stdin, talking to a local server that
replays examples/test/fixtures/tx-demo.json (shared with tx-html.test.ts —
see examples/test/tx-demo-rpc.ts for recording and the pinned answers). The server
errors on eth_sendRawTransaction and the suite asserts it was never called.
Not part of `npm test` (needs built artifacts and recorded fixtures):
  npm run build && npm run test:ui
*/

const built = existsSync(join(root, 'index.js'));
const runnable = built && (RECORD || existsSync(fixturesPath));
if (!runnable)
  console.log(
    'tx-cli: skipped (needs built artifacts and recorded fixtures — ' +
      'see comment at the top of the file)'
  );

const rpc = createFixtureRpc();

// The whole session is scripted upfront: readline consumes the piped lines
// one prompt at a time. An invalid key first, then the demo key, one ERC-20
// transfer, one ETH transfer, quit.
const SCRIPT = [
  'not-a-key',
  DEMO_KEY,
  'c', // create
  '2', // asset: CAT
  RECIPIENT,
  '0.5',
  'c',
  '1', // asset: ETH
  RECIPIENT,
  '0.1',
  'q',
];

// Answers are fed one prompt at a time, like a user would: writing the whole
// script upfront loses lines that arrive between two readline questions.
function runCli(origin: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'examples', 'tx-cli.js')], {
      env: { ...process.env, ETH_RPC_URL: `${origin}/rpc`, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    const answers = [...SCRIPT];
    let answeredAt = 0; // output length when the last answer was sent
    child.stdout.on('data', (chunk) => {
      out += chunk;
      // every CLI prompt ends with ': '; answer each one exactly once
      if (answers.length && out.length > answeredAt && /: $/.test(out)) {
        answeredAt = out.length;
        child.stdin.write(answers.shift() + '\n');
        if (!answers.length) child.stdin.end();
      }
    });
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
    setTimeout(() => child.kill(), RECORD ? 300_000 : 60_000).unref();
  });
}

(runnable ? describe : describe.skip)('tx-cli.js', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let result: Awaited<ReturnType<typeof runCli>>;

  beforeAll(async () => {
    server = await startServer(rpc);
    result = await runCli(server.origin);
  });
  afterAll(async () => {
    await server?.close();
    rpc.save();
  });

  should('run the scripted session to a clean exit', () => {
    deepStrictEqual(result.code, 0, `exit code (output: ${result.out.slice(0, 2000)})`);
    match(result.out, /never broadcasts/, 'header states the constraint');
    match(result.out, /Invalid private key/, 'bad key rejected, then re-prompted');
  });

  should('show the account: address, balances, every token transfer listed', () => {
    ok(result.out.includes(DEMO), 'derived address shown');
    match(result.out, /ETH\s+2\.5/, 'pinned ETH balance');
    match(result.out, /CAT\s+1/, 'discovered token balance');
    match(result.out, /Transactions \(26\)/, 'ots rows plus the logs-only transfer');
    // the incoming CAT transfer never call-touches the address: only the
    // logs source finds it, and discovery decodes its amount
    match(result.out, /\+1 CAT/, 'incoming token transfer listed');
    match(result.out, /HUB/, 'outgoing token transfer listed');
    match(result.out, /ERC1155/, 'NFT transfer listed');
  });

  should('create both transfers, printing valid signed hex', () => {
    const hexes = result.out.match(/^0x02[0-9a-f]+$/gm) || [];
    deepStrictEqual(hexes.length, 2, 'two raw transactions printed');
    const [erc20Tx, ethTx] = hexes.map((hex) => Transaction.fromHex(hex));
    for (const tx of [erc20Tx, ethTx]) {
      deepStrictEqual(tx.isSigned, true, 'signed');
      deepStrictEqual(tx.sender, DEMO, 'signed by the demo key');
      deepStrictEqual(tx.raw.chainId, 1n);
    }
    deepStrictEqual(erc20Tx.raw.to, CAT, 'ERC-20 transfer goes to the token contract');
    deepStrictEqual(erc20Tx.raw.value, 0n);
    deepStrictEqual(
      erc20Tx.raw.data,
      ethHex.encode(
        createContract(ERC20).transfer.encodeInput({ to: RECIPIENT, value: 500000000000000000n })
      ),
      'calldata is transfer(to, amount)'
    );
    deepStrictEqual(ethTx.raw.to, RECIPIENT);
    deepStrictEqual(ethTx.raw.value, 100000000000000000n);
    deepStrictEqual(ethTx.raw.data, '0x');
    deepStrictEqual(
      (result.out.match(/This transaction was NOT broadcast/g) || []).length,
      2,
      'both results carry the notice'
    );
    deepStrictEqual(
      (result.out.match(/simulation\s+would succeed/g) || []).length,
      2,
      'both transfers dry-run simulated'
    );
    match(result.out, /intent\s+.*0\.5 CAT/, 'clear-signing intent previewed for the token');
  });

  should('never call eth_sendRawTransaction, answer everything from fixtures', () => {
    deepStrictEqual(rpc.calls.sendRaw, 0, 'the demo must never broadcast');
    deepStrictEqual(rpc.calls.byMethod.get('eth_sendRawTransaction'), undefined);
    if (RECORD) ok(rpc.fixtureCount() > 0, 'recorded rpc fixtures');
    else deepStrictEqual(rpc.misses, [], 'requests missing from fixtures');
  });
});

should.runWhen(import.meta.url);
