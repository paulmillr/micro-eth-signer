#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import {
  balanceText,
  checksumAddress,
  createExplorer,
  createFavorites,
  DEMO_ADDRESS,
  isAddress,
  isName,
  multiRowSummary,
  rowSummary,
  RPC_URL,
  short,
  usdApprox,
} from './explore-core.js';

const explorer = createExplorer(process.env.ETH_RPC_URL || RPC_URL);
// favorites persist to a dotfile; the shim adapts it to the localStorage-like
// store createFavorites expects
const favoritesFile = join(homedir(), '.eth-explorer-favorites.json');
const favorites = createFavorites({
  getItem: () => {
    try {
      return readFileSync(favoritesFile, 'utf8');
    } catch {
      return null;
    }
  },
  setItem: (_key, value) => writeFileSync(favoritesFile, value),
});
let rl;
let rendered = [];
const grey = (s) => (stdout.isTTY && !process.env.NO_COLOR ? `\x1b[90m${s}\x1b[0m` : s);
const selected = (s, active) =>
  stdout.isTTY ? (active ? `\x1b[7m${s}\x1b[0m` : s) : `${active ? '>' : ' '} ${s}`;

// secondary info after '·' (usd value, rate) renders dimmed
const dimTail = (line) => {
  const at = line.indexOf('·');
  return at < 0 ? line : line.slice(0, at + 1) + grey(line.slice(at + 1));
};

function rowText(row, address) {
  const summary = rowSummary(row, address);
  // terminal rows are single-line: fold the year separator back to '/'
  return `${summary.time.replace('\n', '/').padEnd(16)}  ${summary.direction.padStart(3)}  ${summary.amount.padEnd(24).slice(0, 24)}  ${summary.hash.slice(0, 10)}`;
}

function showTransactions(out, rows, address, scan, cursor = -1) {
  out.push('', 'Transactions');
  out.push(selected(scan.label, cursor === 0));
  if (!rows.length) out.push('  No transactions found.');
  const limit = Math.max(5, (stdout.rows || 24) - 14);
  const at = Math.max(0, cursor - 1);
  const start = Math.min(Math.max(0, at - Math.floor(limit / 2)), Math.max(0, rows.length - limit));
  if (start) out.push(`  … ${start} newer transactions`);
  rows.slice(start, start + limit).forEach((row, i) => {
    const index = start + i;
    out.push(
      selected(`${String(index + 1).padStart(3)}  ${rowText(row, address)}`, cursor === index + 1)
    );
  });
  if (start + limit < rows.length)
    out.push(`  … ${rows.length - start - limit} older transactions`);
  out.push('', selected('Quit', cursor === rows.length + 1));
}

function render(address, ens, fav, balances, rows, scan, cursor, reset = false) {
  const out = [
    `Ethereum${process.env.DEMO === '1' ? ' · DEMO' : ''}`,
    fav ? `${address} ★` : address,
    ...(ens ? [ens] : []),
    '',
    'Balances',
    ...balances,
  ];
  showTransactions(out, rows, address, scan, cursor);
  out.push('', '↑/↓ or Tab select · Return choose · t scan tokens · f favorite · q/Esc quit');
  if (!stdout.isTTY) return console.log(out.join('\n'));
  if (reset) {
    rendered = out;
    const screen = out.map((line) => `\x1b[2K${line}`).join('\n');
    return stdout.write(`\x1b[2J\x1b[H${screen}\x1b[J`);
  }
  let patch = '';
  for (let i = 0; i < Math.max(rendered.length, out.length); i++)
    if (rendered[i] !== out[i]) patch += `\x1b[${i + 1};1H\x1b[2K${out[i] || ''}`;
  rendered = out;
  stdout.write(patch);
}

async function menu(address, ens, fav, balances, rows, scan, cursor) {
  render(address, ens, fav, balances, rows, scan, cursor, true);
  if (!stdin.isTTY) {
    rl ||= createInterface({ input: stdin, output: stdout });
    const answer = (await rl.question('Select transaction, [t] tokens, [f] favorite, or [q] quit: '))
      .trim()
      .toLowerCase();
    if (answer === 'q') return { action: 'quit', cursor };
    if (answer === 't') return { action: 'tokens', cursor: 0 };
    if (answer === 'f') return { action: 'favorite', cursor };
    const index = Number(answer);
    return { action: rows[index - 1] ? 'open' : 'none', cursor: index };
  }
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write('\x1b[?25l');
  return new Promise((resolve) => {
    const finish = (action) => {
      stdin.off('keypress', keypress);
      stdin.setRawMode(false);
      stdout.write('\x1b[?25h');
      if (action === 'quit') stdin.pause();
      resolve({ action, cursor });
    };
    const keypress = (text, key) => {
      const total = rows.length + 2;
      if (
        text?.toLowerCase() === 'q' ||
        key.name === 'q' ||
        key.name === 'escape' ||
        (key.ctrl && key.name === 'c')
      )
        return finish('quit');
      if ((text?.toLowerCase() === 't' || key.name === 't') && !scan.done) return finish('tokens');
      if (text?.toLowerCase() === 'f' || key.name === 'f') return finish('favorite');
      if (key.name === 'return') {
        if (cursor === rows.length + 1) return finish('quit');
        return finish(cursor === 0 ? (scan.done ? 'none' : 'tokens') : 'open');
      }
      if (key.name === 'up' || (key.name === 'tab' && key.shift))
        cursor = (cursor - 1 + total) % total;
      else if (key.name === 'down' || key.name === 'tab') cursor = (cursor + 1) % total;
      else return;
      render(address, ens, fav, balances, rows, scan, cursor);
    };
    stdin.on('keypress', keypress);
  });
}

async function pause() {
  console.log('\nReturn/Esc back · q quit');
  if (!stdin.isTTY) {
    rl ||= createInterface({ input: stdin, output: stdout });
    return (await rl.question('')).trim().toLowerCase() === 'q';
  }
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve) => {
    const keypress = (text, key) => {
      const quit = text?.toLowerCase() === 'q' || key.name === 'q';
      if (!quit && !['return', 'escape'].includes(key.name)) return;
      stdin.off('keypress', keypress);
      stdin.setRawMode(false);
      if (quit) stdin.pause();
      resolve(quit);
    };
    stdin.on('keypress', keypress);
  });
}

async function scanStep(scanner) {
  let state = { phase: 'prepare', completed: 0, total: 0, scannedTxs: 0, found: 0 };
  const started = Date.now();
  const draw = () => {
    const percent = state.total ? (state.completed / state.total) * 100 : 0;
    const done = Math.round(percent / 5);
    const elapsed = Math.round((Date.now() - started) / 1000);
    const spinner = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[Math.floor((Date.now() - started) / 100) % 10];
    const bar = `[${'#'.repeat(done)}${'.'.repeat(20 - done)}]`;
    let line = `Preparing token scan ${spinner} · ${elapsed}s`;
    if (state.phase === 'logs')
      line = `Token logs ${spinner} ${bar} ${state.completed}/${state.total} chunks\n${state.scannedTxs} txs · ${state.found} known transfers · ${elapsed}s`;
    if (state.phase === 'metadata' || state.phase === 'complete')
      line = `Token metadata ${spinner} ${bar} ${state.completed}/${state.total} contracts\n${state.found} transfers · ${elapsed}s`;
    // details go on a second line; the cursor parks back on the first
    const [first, second = ''] = line.split('\n');
    stdout.write(`\r\x1b[2K${first}\n\x1b[2K${second}\x1b[1A\r`);
  };
  const timer = stdout.isTTY ? setInterval(draw, 250) : undefined;
  // the scanner notifies per consumed row: the interval repaints for TTYs,
  // pipes get at most one progress line per second
  let lastDraw = 0;
  try {
    const result = await scanner.step((progress) => {
      state = progress;
      if (timer || Date.now() - lastDraw < 1000) return;
      lastDraw = Date.now();
      draw();
    });
    if (stdout.isTTY) stdout.write('\x1b[1B\n');
    return result;
  } finally {
    clearInterval(timer);
  }
}

async function details(row) {
  const info = await explorer.details(row);
  console.log();
  const line = (value) => String(value).replace('\n', '/');
  for (const [label, value] of info.normal) console.log(`${label.padEnd(12)} ${line(value)}`);
  for (const [label, value] of info.muted)
    console.log(grey(`${label.padEnd(12)} ${line(value)}`));
}

// Returns an address to open, or 'favorites' to show the favorites page.
async function promptTarget() {
  rl ||= createInterface({ input: stdin, output: stdout });
  for (;;) {
    const hint = favorites.list().length ? ", or 'f' for favorites" : '';
    const answer = (await rl.question(`Ethereum address or name (.eth/.gwei)${hint}: `)).trim();
    if (answer.toLowerCase() === 'f') return 'favorites';
    if (isAddress(answer)) return checksumAddress(answer);
    if (isName(answer)) {
      const resolved = await explorer.resolveName(answer).catch(() => undefined);
      if (resolved) return checksumAddress(resolved);
      console.log(`Name ${answer} did not resolve.`);
    } else console.log('Invalid Ethereum address.');
  }
}

// Favorites page: the persisted list (with the ENS names captured when they
// were favorited), combined balances of the whole set, and a merged history.
// Returns 'quit', 'back', or a favorite address to open.
async function favoritesPage() {
  rl ||= createInterface({ input: stdin, output: stdout });
  let balances; // combined across the set, fetched once per page visit
  for (;;) {
    const list = favorites.list();
    console.log('\nFavorites');
    if (!list.length) console.log("  None yet: open an address and press 'f'.");
    list.forEach((favorite, i) => {
      const name = favorite.ens ? `${favorite.ens} · ` : '';
      console.log(`${String(i + 1).padStart(3)}  ${name}${favorite.address}`);
    });
    if (list.length && !balances) {
      console.log('\nLoading combined balances…');
      balances = await explorer
        .combinedBalances(list.map((favorite) => favorite.address))
        .catch((error) => ({ balances: [{ symbol: 'ETH', error }] }));
    }
    if (balances) {
      console.log('\nBalances');
      if (balances.totalUsd !== undefined)
        console.log(grey(`Total ${usdApprox(balances.totalUsd)}`));
      for (const balance of balances.balances) console.log(dimTail(balanceText(balance)));
    }
    const options = list.length
      ? 'Select favorite, [h] load histories, [b] back, or [q] quit: '
      : '[b] back or [q] quit: ';
    const answer = (await rl.question(`\n${options}`)).trim().toLowerCase();
    if (answer === 'q') return 'quit';
    if (answer === 'b' || answer === '') return 'back';
    if (answer === 'h' && list.length) {
      if ((await favoritesTransactions(list)) === 'quit') return 'quit';
      continue;
    }
    const favorite = list[Number(answer) - 1];
    if (favorite) return favorite.address;
  }
}

// Merged rows carry the participating favorites; shown as a trailing column.
// 't' deepens the quick view with a token scan over the whole set, same as
// the per-address one.
async function favoritesTransactions(list) {
  const addresses = list.map((favorite) => favorite.address);
  console.log('\nLoading merged history for all favorites…');
  let rows;
  try {
    rows = await explorer.favoritesHistory(addresses);
  } catch (error) {
    console.log(`History unavailable: ${error.message}`);
    return;
  }
  let scanner;
  for (;;) {
    console.log(`\nTransactions (${rows.length})`);
    if (!rows.length) console.log('  No transactions found.');
    for (const [i, row] of rows.entries()) {
      const summary = multiRowSummary(row);
      const who = summary.addresses.map((a) => short(a, 4)).join(' ');
      console.log(
        `${String(i + 1).padStart(3)}  ${summary.time.replace('\n', '/').padEnd(16)}  ${summary.direction.padStart(3)}  ${summary.amount.padEnd(24).slice(0, 24)}  ${who}`
      );
    }
    const scan = !scanner
      ? '[t] tokens, '
      : scanner.done
        ? ''
        : `[t] continue scan (${scanner.percent}%), `;
    const answer = (await rl.question(`\nSelect transaction, ${scan}[b] back, or [q] quit: `))
      .trim()
      .toLowerCase();
    if (answer === 'q') return 'quit';
    if (answer === 'b' || answer === '') return;
    if (answer === 't' && !scanner?.done) {
      try {
        scanner ||= explorer.tokenScanner(addresses, rows);
        const result = await scanStep(scanner);
        rows = result.rows;
      } catch (error) {
        console.log(`Token scan failed: ${error.message}`);
      }
      continue;
    }
    const row = rows[Number(answer) - 1];
    if (row) await details(row);
  }
}

async function main() {
  if (process.env.DEMO === '1') return addressPage(checksumAddress(DEMO_ADDRESS));
  for (;;) {
    const target = await promptTarget();
    if (target !== 'favorites') return addressPage(target);
    const result = await favoritesPage();
    if (result === 'quit') return;
    if (result !== 'back') return addressPage(result);
  }
}

async function addressPage(address) {
  // the raw-mode menu takes over the keyboard: the prompt's readline must go
  if (rl && stdin.isTTY) {
    rl.close();
    rl = undefined;
  }
  console.log(`\n${address}\nLoading balances, Chainlink prices and transactions…`);
  const overview = await explorer.load(address);
  const balances = overview.balances.map((balance) => dimTail(balanceText(balance)));
  if (overview.totalUsd !== undefined)
    balances.unshift(grey(`Total ${usdApprox(overview.totalUsd)}`));
  if (overview.historyError) balances.push(`History unavailable: ${overview.historyError.message}`);
  let rows = overview.rows;
  let scanner;
  let cursor = 0;
  // huge addresses scan in ~2-minute steps: the menu offers to continue with
  // the overall percent until the scan reaches block 0
  const scanState = () => {
    if (!scanner) return { done: false, label: 'Load token transactions' };
    if (scanner.done) return { done: true, label: '✓ Token transactions loaded' };
    return {
      done: false,
      label: `Continue token scan · ${scanner.percent}% scanned · ${rows.length} txs so far`,
    };
  };
  for (;;) {
    const scan = scanState();
    const fav = favorites.has(address);
    const choice = await menu(address, overview.ens, fav, balances, rows, scan, cursor);
    cursor = choice.cursor;
    if (choice.action === 'quit') break;
    if (choice.action === 'favorite') {
      favorites.toggle(address, overview.ens);
      continue;
    }
    if (choice.action === 'tokens' && !scan.done) {
      try {
        scanner ||= explorer.tokenScanner(address, rows);
        const result = await scanStep(scanner);
        rows = result.rows;
        cursor = rows.length ? 1 : 0;
      } catch (error) {
        stdout.write('\n');
        console.log(`Token scan failed: ${error.message}`);
        if (await pause()) break;
      }
      continue;
    }
    const row = rows[cursor - 1];
    if (choice.action === 'open' && row) {
      if (stdout.isTTY) stdout.write('\x1b[2J\x1b[H');
      await details(row);
      if (await pause()) break;
    }
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    rl?.close();
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
    if (stdout.isTTY) stdout.write('\x1b[?25h');
  });
