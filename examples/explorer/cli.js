#!/usr/bin/env node
// Terminal version of explorer/index.html. Environment:
//   ETH_RPC_URL=http://…  node to use (default http://127.0.0.1)
//   ALL_TOKENS=1          check every token of the built-in registry, not just the curated five
//   DEMO=1                skip the prompt, open a well-known address
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import {
  accountText,
  balanceText,
  checksumAddress,
  createExplorer,
  createFavorites,
  DEMO_ADDRESS,
  isAddress,
  isName,
  isTxHash,
  multiRowSummary,
  rowSummary,
  RPC_URL,
  short,
  tokenLine,
  usdApprox,
  withScheme,
} from './core.js';

const rpcUrl = withScheme(process.env.ETH_RPC_URL || RPC_URL);
const explorer = createExplorer(rpcUrl);
const tokenOpts = { allTokens: process.env.ALL_TOKENS === '1' };
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

// menu items: 0 = scan, 1..n = rows, then 'Load older' (while there is
// more) and Quit
const menuItems = (rows, older) => ({
  older: older ? rows.length + 1 : -1,
  quit: rows.length + (older ? 2 : 1),
});

function showTransactions(out, rows, address, scan, older, cursor = -1) {
  const items = menuItems(rows, older);
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
  if (older) out.push(selected('Load older transactions', cursor === items.older));
  out.push('', selected('Quit', cursor === items.quit));
}

function render(page, rows, scan, older, cursor, reset = false) {
  const out = [
    `Ethereum${process.env.DEMO === '1' ? ' · DEMO' : ''}`,
    page.fav ? `${page.address} ★` : page.address,
    ...page.info,
    '',
    'Balances',
    ...page.balances,
  ];
  showTransactions(out, rows, page.address, scan, older, cursor);
  out.push(
    '',
    '↑/↓ or Tab select · Return choose · o older · t scan tokens · f favorite · q/Esc quit'
  );
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

async function menu(page, rows, scan, older, cursor) {
  const items = menuItems(rows, older);
  render(page, rows, scan, older, cursor, true);
  if (!stdin.isTTY) {
    rl ||= createInterface({ input: stdin, output: stdout });
    const olderHint = older ? '[o] older, ' : '';
    const answer = (
      await rl.question(`Select transaction, [t] tokens, ${olderHint}[f] favorite, or [q] quit: `)
    )
      .trim()
      .toLowerCase();
    if (answer === 'q') return { action: 'quit', cursor };
    if (answer === 't') return { action: 'tokens', cursor: 0 };
    if (answer === 'o' && older) return { action: 'older', cursor };
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
      const total = items.quit + 1;
      if (
        text?.toLowerCase() === 'q' ||
        key.name === 'q' ||
        key.name === 'escape' ||
        (key.ctrl && key.name === 'c')
      )
        return finish('quit');
      if ((text?.toLowerCase() === 't' || key.name === 't') && !scan.done) return finish('tokens');
      if (text?.toLowerCase() === 'f' || key.name === 'f') return finish('favorite');
      if ((text?.toLowerCase() === 'o' || key.name === 'o') && older) return finish('older');
      if (key.name === 'return') {
        if (cursor === items.quit) return finish('quit');
        if (cursor === items.older) return finish('older');
        return finish(cursor === 0 ? (scan.done ? 'none' : 'tokens') : 'open');
      }
      if (key.name === 'up' || (key.name === 'tab' && key.shift))
        cursor = (cursor - 1 + total) % total;
      else if (key.name === 'down' || key.name === 'tab') cursor = (cursor + 1) % total;
      else return;
      render(page, rows, scan, older, cursor);
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

async function scanStep(feed) {
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
    const result = await feed.scanStep((progress) => {
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

// a row of a table, or a tx hash typed at the prompt
async function details(target) {
  const info = await explorer.details(target);
  console.log();
  const line = (value) => String(value).replace('\n', '/');
  for (const [label, value] of info.normal) console.log(`${label.padEnd(17)} ${line(value)}`);
  for (const [label, value] of info.muted)
    console.log(grey(`${label.padEnd(17)} ${line(value)}`));
  // big txs (airdrops) carry thousands of these: the first LIST_LIMIT print
  const LIST_LIMIT = 20;
  const rest = (items) => {
    if (items.length > LIST_LIMIT) console.log(grey(`  … ${items.length - LIST_LIMIT} more`));
  };
  console.log(`\nToken transfers (${info.transfers.length})`);
  for (const t of info.transfers.slice(0, LIST_LIMIT))
    console.log(`  ${t.from ? short(t.from, 6) : '?'} → ${short(t.to, 6)}  ${t.amount}`);
  rest(info.transfers);
  console.log(`\nEvent logs (${info.logs.length})`);
  for (const log of info.logs.slice(0, LIST_LIMIT)) {
    console.log(`  #${log.index} ${short(log.address, 6)} ${log.event || 'unknown event'}`);
    if (log.hint) console.log(grey(`    ${log.hint}`));
    for (const [i, topic] of log.topics.entries()) console.log(grey(`    topic${i} ${topic}`));
    console.log(grey(`    data   ${log.data}`));
  }
  rest(info.logs);
}

async function txPage(hash) {
  try {
    await details(hash);
  } catch (error) {
    const missing = /not found/.test(error.message);
    console.log(
      missing ? 'Transaction not found on this node.' : `Lookup failed: ${error.message}`
    );
    return;
  }
  console.log();
}

// One line about the node: chain, client, and what is missing for full history.
async function showNode() {
  const host = new URL(rpcUrl).host; // the path can carry an API key
  try {
    const info = await explorer.node();
    const notes = [];
    if (info.chainId !== 1n) notes.push('prices and token list are mainnet-only');
    if (info.ots === false) notes.push('no ots_ namespace: history shows token transfers only');
    const client = info.client ? [info.client.split('/').slice(0, 2).join('/')] : [];
    console.log(
      grey(
        [`Node ${host}`, `${info.name} (chain ${info.chainId})`, ...client, ...notes].join(' · ')
      )
    );
  } catch (error) {
    console.log(`Node ${host} unreachable: ${error.message} (set ETH_RPC_URL to change).`);
  }
}

// Returns an address to open, 'favorites' to show the favorites page, or
// { tx } for a transaction hash.
async function promptTarget() {
  rl ||= createInterface({ input: stdin, output: stdout });
  for (;;) {
    const hint = favorites.list().length ? ", or 'f' for favorites" : '';
    const answer = (
      await rl.question(`Ethereum address, name (.eth/.gwei) or tx hash${hint}: `)
    ).trim();
    if (answer.toLowerCase() === 'f') return 'favorites';
    if (isTxHash(answer)) return { tx: answer };
    if (isAddress(answer)) return checksumAddress(answer);
    if (isName(answer)) {
      // resolveName returns undefined for unknown names and throws on
      // transport failures: an unreachable RPC is not the name's fault
      try {
        const resolved = await explorer.resolveName(answer);
        if (resolved) return checksumAddress(resolved);
        console.log(`Name ${answer} did not resolve.`);
      } catch (error) {
        console.log(`Lookup failed: ${error.message} (RPC ${rpcUrl} — set ETH_RPC_URL to change).`);
      }
    } else console.log('Not an address, .eth/.gwei name or transaction hash.');
  }
}

// Favorites page: the persisted list (with the ENS names captured when they
// were favorited) with each member's ETH and account kind, combined balances
// of the whole set, and a merged history.
// Returns 'quit', 'back', or a favorite address to open.
async function favoritesPage() {
  rl ||= createInterface({ input: stdin, output: stdout });
  let balances; // combined across the set, fetched once per page visit
  for (;;) {
    const list = favorites.list();
    if (list.length && !balances) {
      console.log('\nLoading favorites…');
      balances = await explorer
        .favoritesOverview(
          list.map((favorite) => favorite.address),
          tokenOpts
        )
        .catch((error) => ({ balances: [{ symbol: 'ETH', error }], members: [] }));
    }
    console.log(`\nFavorites${list.length ? ` (${list.length})` : ''}`);
    if (!list.length) console.log("  None yet: open an address and press 'f'.");
    list.forEach((favorite, i) => {
      const name = favorite.ens ? `${favorite.ens} · ` : '';
      console.log(`${String(i + 1).padStart(3)}  ${name}${favorite.address}`);
      const member = balances?.members.find((m) => m.address === favorite.address);
      if (!member) return;
      const kind = member.account
        ? member.account.kind === 'contract'
          ? 'Contract'
          : accountText(member.account).replace(/ · EIP-7702 delegated to .*/, ' · EIP-7702')
        : '';
      const usd = Number.isFinite(member.usd) ? ` (${usdApprox(member.usd)})` : '';
      console.log(
        grey(`     ${[member.eth && member.eth + usd, kind].filter(Boolean).join(' · ')}`)
      );
    });
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
// 'o' pages back (each favorite on its own cursor), 't' deepens the list with
// a token scan over the whole set, same as the per-address ones.
async function favoritesTransactions(list) {
  const feed = explorer.feed(list.map((favorite) => favorite.address));
  console.log('\nLoading merged history for all favorites…');
  let rows;
  try {
    rows = await feed.older();
  } catch (error) {
    console.log(`History unavailable: ${error.message}`);
    return;
  }
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
    const scan = !feed.scanStarted
      ? '[t] tokens, '
      : feed.scanDone
        ? ''
        : `[t] continue scan (${feed.scanPercent}%), `;
    const older = feed.hasOlder ? '[o] older, ' : '';
    const answer = (
      await rl.question(`\nSelect transaction, ${scan}${older}[b] back, or [q] quit: `)
    )
      .trim()
      .toLowerCase();
    if (answer === 'q') return 'quit';
    if (answer === 'b' || answer === '') return;
    if (answer === 'o' && feed.hasOlder) {
      try {
        rows = await feed.older();
      } catch (error) {
        console.log(`Older transactions unavailable: ${error.message}`);
      }
      continue;
    }
    if (answer === 't' && !feed.scanDone) {
      try {
        const result = await scanStep(feed);
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
  await showNode();
  if (process.env.DEMO === '1') return addressPage(checksumAddress(DEMO_ADDRESS));
  for (;;) {
    const target = await promptTarget();
    if (target.tx) {
      await txPage(target.tx);
      continue;
    }
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
  const overview = await explorer.load(address, tokenOpts);
  const balances = overview.balances.map((balance) => dimTail(balanceText(balance)));
  if (overview.totalUsd !== undefined)
    balances.unshift(grey(`Total ${usdApprox(overview.totalUsd)}`));
  if (overview.historyError) balances.push(`History unavailable: ${overview.historyError.message}`);
  const { feed } = overview;
  const info = [
    ...(overview.ens ? [overview.ens] : []),
    ...(overview.account ? [grey(accountText(overview.account))] : []),
    ...(overview.account && tokenLine(overview.account) ? [grey(tokenLine(overview.account))] : []),
  ];
  let rows = feed.rows;
  let cursor = 0;
  // huge addresses scan in ~2-minute steps: the menu offers to continue with
  // the overall percent until the scan reaches block 0
  const scanState = () => {
    if (!feed.scanStarted) return { done: false, label: 'Load token transactions' };
    if (feed.scanDone) return { done: true, label: '✓ Token transactions loaded' };
    return {
      done: false,
      label: `Continue token scan · ${feed.scanPercent}% scanned · ${rows.length} txs so far`,
    };
  };
  for (;;) {
    const scan = scanState();
    const page = { address, fav: favorites.has(address), info, balances };
    const choice = await menu(page, rows, scan, feed.hasOlder, cursor);
    cursor = choice.cursor;
    if (choice.action === 'quit') break;
    if (choice.action === 'favorite') {
      favorites.toggle(address, overview.ens);
      continue;
    }
    if (choice.action === 'older') {
      try {
        rows = await feed.older();
      } catch (error) {
        console.log(`Older transactions unavailable: ${error.message}`);
        if (await pause()) break;
      }
      continue;
    }
    if (choice.action === 'tokens' && !scan.done) {
      try {
        const result = await scanStep(feed);
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
