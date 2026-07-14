// Regenerates test/fixtures/rpc/nft-address.json from a live node:
//   ETH_RPC_URL=http://host node test/misc/capture-nft-fixture.mjs
// The call sequence MUST mirror the 'nft-heavy address' test in test/net.test.ts
// exactly — replay keys include request bodies with sequential jsonrpc ids, so
// the scenario avoids every source of issuance-order nondeterminism: a single
// un-windowed logs pass (logsWindow: 0), a pinned toBlock (no height() call),
// and sequential nftHoldings (concurrency: 1).
import { writeFile } from 'node:fs/promises';
import * as mftch from 'micro-ftch';
import { RpcClient } from '../../src/net.ts';
import { enrichTx } from '../../src/net/enrich.ts';
import { history } from '../../src/net/history.ts';
import { nftHoldings } from '../../src/net/tokens.ts';

const LIVE_URL = process.env.ETH_RPC_URL || 'http://127.0.0.1';
const NODE_URL = 'https://NODE_URL/';
const OUT = new URL('../fixtures/rpc/nft-address.json', import.meta.url);

const logs = {};
const getKey = (_url, opt) => JSON.stringify({ url: NODE_URL, opt });
const record = mftch.replayable(fetch, logs, { getKey });
const prov = new RpcClient(mftch.jsonrpc(record, LIVE_URL));

// --- scenario (keep in sync with the test) ---
const NFT_ADDR = '0xed216b45b6e66847aaa891e5be124e0ab2c60a41';
const TO_BLOCK = 25500000; // pinned so re-captures stay comparable

// deterministic random pick: xorshift32-seeded shuffle of all (contract, id) pairs
const pickRandomNfts = (rows, count) => {
  const pairs = new Map();
  for (const row of rows)
    for (const t of row.tokenTransfers) {
      if (t.abi !== 'ERC721') continue;
      for (const id of t.tokens.keys())
        pairs.set(`${t.contract}:${id}`, { contract: t.contract, abi: t.abi, id });
    }
  const all = [...pairs.values()];
  let seed = 0xdecafbad;
  const rand = () =>
    ((seed ^= seed << 13), (seed ^= seed >>> 17), (seed ^= seed << 5), (seed >>> 0) / 2 ** 32);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const byContract = new Map();
  for (const { contract, abi, id } of all.slice(0, count)) {
    let entry = byContract.get(contract);
    if (!entry) byContract.set(contract, (entry = { contract, abi, tokens: new Map() }));
    entry.tokens.set(id, 1n);
  }
  return byContract;
};

const discovered = [];
const rows = [];
for await (const row of history(prov, NFT_ADDR, {
  source: 'logs',
  depth: 'full',
  discover: true,
  logsWindow: 0,
  fromBlock: 0,
  toBlock: TO_BLOCK,
  onToken: (token) => discovered.push(token),
}))
  rows.push(row);

const candidates = pickRandomNfts(rows, 12);
const holdings = await nftHoldings(prov, NFT_ADDR, candidates.values(), { concurrency: 1 });
const detail = await enrichTx(prov, rows[0].info, { address: NFT_ADDR, clearSig: 'resolve' });
// --- end scenario ---

console.log('rows:', rows.length);
console.log(
  'transfers:',
  rows.reduce((sum, row) => sum + row.tokenTransfers.length, 0)
);
console.log(
  'discovered:',
  discovered.map((t) => `${t.symbol || t.contract}:${t.abi || 'err'}`).join(', ')
);
console.log(
  'candidates:',
  [...candidates.values()]
    .map((c) => `${c.contract.slice(0, 10)}=[${[...c.tokens.keys()]}]`)
    .join(' ')
);
console.log(
  'holdings:',
  Object.entries(holdings)
    .map(([c, v]) => `${c}=${v instanceof Map ? [...v.keys()] : 'err:' + v.error}`)
    .join('\n  ')
);
console.log('detail:', detail.method, '|', detail.tokenTransfers.length, 'transfers');
console.log('fixture keys:', Object.keys(logs).length);
await writeFile(OUT, JSON.stringify(logs, null, 1) + '\n');
console.log('written:', OUT.pathname);
