#!/usr/bin/env node
// CLI version of tx.html: create (but NEVER broadcast) an ETH or ERC-20
// transfer. Prompts for a private key, shows the account explorer-style
// (balances including every token seen in history, recent transactions with
// all token movements), lets the user pick an asset from their balances, then
// builds and signs the transaction locally and prints the raw hex.
//   ETH_RPC_URL=http://… ETH_NETWORK=mainnet|sepolia node examples/tx-cli.js
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import {
  balanceLine,
  createTxWallet,
  INVALID_KEY,
  isPrivateKey,
  NETWORKS,
  randomKey,
  rowSummary,
} from './tx-core.js';

const networkKey = process.env.ETH_NETWORK || 'mainnet';
if (!NETWORKS[networkKey]) {
  console.error(`Unknown ETH_NETWORK=${networkKey}; use one of: ${Object.keys(NETWORKS).join(', ')}`);
  process.exit(1);
}
const rpcUrl = process.env.ETH_RPC_URL || NETWORKS[networkKey].rpcUrl;
const wallet = createTxWallet(rpcUrl, networkKey);
const rl = createInterface({ input: stdin, output: stdout });
const grey = (s) => (stdout.isTTY && !process.env.NO_COLOR ? `\x1b[90m${s}\x1b[0m` : s);

function showAccount(account) {
  console.log(`\n${account.address}`);
  console.log('\nBalances');
  account.assets.forEach((asset, i) => console.log(`${String(i + 1).padStart(3)}  ${balanceLine(asset)}`));
  console.log(`\nTransactions (${account.rows.length})`);
  if (!account.rows.length) console.log('  No transactions found.');
  account.rows.forEach((row, i) => {
    const summary = rowSummary(row, account.address);
    // terminal rows are single-line: fold multi-transfer amounts with ', '
    console.log(
      `${String(i + 1).padStart(3)}  ${summary.time.replace('\n', '/').padEnd(16)}  ${summary.direction.padStart(3)}  ${summary.amount.padEnd(24).slice(0, 24)}  ${grey(summary.hash.slice(0, 10))}`
    );
  });
}

async function promptKey() {
  for (;;) {
    const answer = (await rl.question('\nPrivate key (64 hex chars, or "r" for a random throwaway): ')).trim();
    if (answer.toLowerCase() === 'r') {
      const key = randomKey();
      console.log(`Generated throwaway key: ${key}`);
      return key;
    }
    if (isPrivateKey(answer)) return answer;
    console.log(INVALID_KEY);
  }
}

async function promptAsset(assets) {
  for (;;) {
    const answer = (await rl.question(`Asset number (1-${assets.length}): `)).trim();
    const asset = assets[Number(answer) - 1];
    if (asset) return asset;
    console.log('No such asset.');
  }
}

// One transfer: pick asset, recipient and amount, then build + sign + print.
// tx-core has no broadcast path at all — the raw hex is the final product.
async function createTx(privateKey, account) {
  console.log('\nCreate transaction');
  const asset = await promptAsset(account.assets);
  const to = (await rl.question('Recipient address: ')).trim();
  const amount = (await rl.question(`Amount of ${asset.symbol} (or "max"): `)).trim();
  const created = await wallet.build({
    privateKey,
    asset,
    to,
    amount: amount.toLowerCase() === 'max' ? await wallet.maxAmount(asset, account.address) : amount,
  });
  console.log();
  for (const [label, value] of created.normal) console.log(`${label.padEnd(16)} ${value}`);
  for (const [label, value] of created.muted) console.log(grey(`${label.padEnd(16)} ${value}`));
  console.log('\nRaw signed hex:');
  console.log(created.hex);
  console.log('\n✓ Signed locally. This transaction was NOT broadcast.');
}

async function main() {
  console.log(`Ethereum tx creator · ${NETWORKS[networkKey].label} · ${rpcUrl}`);
  console.log('Builds and signs locally — never broadcasts.');
  let privateKey = await promptKey();
  let account;
  const reload = async () => {
    console.log('\nLoading account…');
    account = await wallet.load(privateKey);
    showAccount(account);
  };
  await reload();
  for (;;) {
    const answer = (await rl.question('\n[c] create tx, [r] reload account, [k] new key, [q] quit: '))
      .trim()
      .toLowerCase();
    if (answer === 'q') return;
    if (answer === 'k') privateKey = await promptKey();
    if (answer === 'k' || answer === 'r') {
      await reload();
      continue;
    }
    if (answer !== 'c' && answer !== '') continue;
    try {
      await createTx(privateKey, account);
    } catch (error) {
      console.log(`Could not create transaction: ${error.message}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
    stdin.pause();
  });
