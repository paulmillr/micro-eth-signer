import assert from 'node:assert/strict';
import { describe, it } from '@paulmillr/jsbt/test.js';
import { tokenScanner } from '../src/net/history.ts';
const A = '0x0000000000000000000000000000000000000001';
const B = '0x0000000000000000000000000000000000000002';
const TOKEN = '0x0000000000000000000000000000000000000010';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const word = (n) => n.toString(16).padStart(64, '0');
const hash = (n) => '0x' + word(n + 1);
const tx = (block) => ({
  info: {
    hash: hash(block),
    blockNumber: block,
    transactionIndex: 0,
    from: B,
    to: A,
    value: 0n,
    input: '0x',
  },
  receipt: {
    blockNumber: block,
    status: 1,
    gasUsed: 1n,
    effectiveGasPrice: 1n,
    logs: [
      {
        address: TOKEN,
        topics: [TRANSFER, '0x' + word(2), '0x' + word(1)],
        data: '0x' + word(block + 1),
      },
    ],
  },
});
let clock = 0;
const realNow = Date.now;
function provider(blocks, hook = () => {}) {
  const requests = [],
    fetched = [];
  return {
    requests,
    fetched,
    async height() {
      return Math.max(...blocks, 0);
    },
    async ethLogs(topics, range) {
      requests.push({ ...range });
      clock += 2;
      await hook(range);
      return blocks
        .filter((b) => b >= range.fromBlock && b <= range.toBlock)
        .map((b) => ({ transactionHash: hash(b) }));
    },
    async txInfo(h, options) {
      assert.equal(options.verify, false);
      const block = Number(BigInt(h)) - 1;
      fetched.push(block);
      return tx(block);
    },
  };
}
function scanner(prov, extra = {}, addresses = A) {
  return tokenScanner(prov as any, addresses, {
    fromBlock: 0,
    toBlock: 5,
    logsWindow: 2,
    concurrency: 1,
    discover: false,
    clearSig: false,
    tokens: { [TOKEN]: { abi: 'ERC20' } },
    ...extra,
  });
}
function test(name, body) {
  it(name, async () => {
    clock = 0;
    Date.now = () => clock;
    try {
      await body();
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      Date.now = realNow;
    }
  });
}
const blocksOf = (rows) => rows.map((r) => r.block);
const rangesOf = (prov) =>
  prov.requests.filter((_, i) => i % 7 === 0).map((r) => [r.fromBlock, r.toBlock]);
describe('tokenScanner slow-window progress', () => {
  test('first slow window exhausts normally, delivers typed token rows once, done step is inert', async () => {
    const p = provider([0, 1]);
    const s = scanner(p, { toBlock: 1 });
    const rows = [];
    assert.deepEqual(await s.step((r) => rows.push(r), { budgetMs: 1 }), {
      done: true,
      percent: 100,
    });
    assert.deepEqual(blocksOf(rows), [1, 0]);
    assert.deepEqual(
      rows.map((r) => [...r.tokenTransfers[0].tokens]),
      [[[1n, 2n]], [[1n, 1n]]]
    );
    assert(
      rows.every(
        (r) =>
          r.tokenTransfers[0].from.toLowerCase() === B && r.tokenTransfers[0].to.toLowerCase() === A
      )
    );
    const count = p.requests.length;
    assert.deepEqual(await s.step(() => assert.fail('done callback')), {
      done: true,
      percent: 100,
    });
    assert.equal(p.requests.length, count);
  });
  test('slow multi-window steps advance exclusive cursor; JSON resume preserves order and exact once', async () => {
    const p = provider([0, 1, 2, 3, 4, 5]);
    let s = scanner(p);
    const rows = [];
    for (const expectedCursor of [3, 1]) {
      assert.equal((await s.step((r) => rows.push(r), { budgetMs: 1 })).done, false);
      assert.equal(s.state.toBlock, expectedCursor);
      s = scanner(p, { state: JSON.parse(JSON.stringify(s.state)) });
    }
    assert.equal((await s.step((r) => rows.push(r), { budgetMs: 1 })).done, true);
    assert.deepEqual(blocksOf(rows), [5, 4, 3, 2, 1, 0]);
    assert.equal(new Set(rows.map((r) => r.hash)).size, 6);
    assert.deepEqual(rangesOf(p), [
      [4, 5],
      [2, 3],
      [2, 3],
      [0, 1],
      [0, 1],
    ]);
  });
  test('empty slow windows advance safely and empty history completes', async () => {
    for (const blocks of [[], [0, 1], [4, 5]]) {
      const p = provider(blocks),
        s = scanner(p),
        rows = [];
      for (let i = 0; !s.done && i < 4; i++) await s.step((r) => rows.push(r), { budgetMs: 1 });
      assert.equal(s.done, true);
      assert.deepEqual(blocksOf(rows), [...blocks].reverse());
    }
  });
  test('budgeted concurrent windows and slow awaited callbacks finish at whole-window boundaries', async () => {
    for (const concurrency of [1, 4]) {
      const p = provider([0, 1, 2, 3, 4, 5]),
        s = scanner(p, { concurrency }),
        rows = [];
      for (let i = 0; !s.done && i < 4; i++) {
        const before = rows.length;
        const result = await s.step(
          async (r) => {
            await Promise.resolve();
            clock += 100;
            rows.push(r);
          },
          { budgetMs: 1 }
        );
        assert(result.done || rows.length > before);
        assert.equal(rows.length % 2, 0, 'a single-address step split a window');
      }
      assert.equal(s.done, true);
      assert.deepEqual(blocksOf(rows), [5, 4, 3, 2, 1, 0]);
    }
  });
  test('large budget and concurrent prefetch retain full ordering and dedupe', async () => {
    for (const concurrency of [1, 4]) {
      const p = provider([0, 1, 2, 3, 4, 5]),
        s = scanner(p, { concurrency }),
        rows = [];
      assert.equal((await s.step((r) => rows.push(r), { budgetMs: Infinity })).done, true);
      assert.deepEqual(blocksOf(rows), [5, 4, 3, 2, 1, 0]);
      assert.deepEqual(p.fetched.sort(), [0, 1, 2, 3, 4, 5]);
    }
  });
  test('persisted done state is inert and percent remains complete', async () => {
    const p = provider([0, 1]),
      s = scanner(p, { state: { top: 5, toBlock: 1, done: true } });
    assert.equal(s.done, true);
    assert.equal(s.percent, 100);
    assert.deepEqual(await s.step(() => assert.fail('done callback'), { budgetMs: 1 }), {
      done: true,
      percent: 100,
    });
    assert.equal(p.requests.length, 0);
  });
  test('failed first or later window does not publish a resume boundary or done', async () => {
    for (const failedFrom of [4, 2]) {
      let fail = true;
      const error = new Error('fixture permanent failure');
      const p = provider([0, 1, 2, 3, 4, 5], (r) => {
        if (fail && r.fromBlock === failedFrom) throw error;
      });
      const s = scanner(p),
        rows = [];
      await assert.rejects(
        s.step((r) => rows.push(r), { budgetMs: 1 }),
        (e) => e === error
      );
      assert.equal(s.done, false);
      assert.equal(s.state.toBlock, 5);
      fail = false;
      for (let i = 0; !s.done && i < 4; i++) await s.step((r) => rows.push(r), { budgetMs: 1 });
      assert.equal(s.done, true);
      assert.deepEqual(blocksOf(rows), [5, 4, 3, 2, 1, 0]);
    }
  });
  test('cancellation during slow first window rejects without rows/cursor advance; retry completes', async () => {
    const abort = new AbortController();
    let cancel = true;
    const p = provider([0, 1], () => {
      if (cancel) abort.abort(new Error('fixture cancelled'));
    });
    const s = scanner(p, { toBlock: 1 }),
      rows = [];
    await assert.rejects(
      s.step((r) => rows.push(r), { budgetMs: 1, signal: abort.signal }),
      /aborted/
    );
    assert.equal(s.done, false);
    assert.equal(s.state.toBlock, 1);
    assert.equal(rows.length, 0);
    cancel = false;
    assert.equal((await s.step((r) => rows.push(r), { budgetMs: 1 })).done, true);
    assert.deepEqual(blocksOf(rows), [1, 0]);
  });
  test('awaited callback failure is not marked seen; successful earlier callbacks are not repeated', async () => {
    const p = provider([0, 1]),
      s = scanner(p, { toBlock: 1 }),
      rows = [];
    await assert.rejects(
      s.step(
        async (r) => {
          await Promise.resolve();
          if (r.block === 0) throw new Error('callback rejected');
          rows.push(r);
        },
        { budgetMs: 1 }
      ),
      /callback rejected/
    );
    assert.equal(s.done, false);
    assert.equal(s.state.toBlock, 1);
    assert.equal((await s.step((r) => rows.push(r), { budgetMs: 1 })).done, true);
    assert.deepEqual(blocksOf(rows), [1, 0]);
  });
  test('multi-address budget pause makes new-row progress each step; overlap dedupes within instance', async () => {
    for (const concurrency of [1, 4]) {
      const p = provider([0, 1, 2, 3, 4, 5]),
        s = scanner(p, { concurrency }, [A, B]),
        rows = [];
      for (let i = 0; !s.done && i < 8; i++) {
        const count = rows.length;
        const result = await s.step((r) => rows.push(r), { budgetMs: 1 });
        assert(result.done || rows.length > count, 'paused multi step made no new-row progress');
        assert.equal(s.state.toBlock, 5, 'multi cursor must not use a single stream boundary');
      }
      assert.equal(s.done, true);
      assert.equal(rows.length, 6);
      assert.equal(new Set(rows.map((r) => r.hash)).size, 6);
      assert.deepEqual(blocksOf(rows), [5, 4, 3, 2, 1, 0]);
      assert(rows.every((r) => r.addresses.length === 2));
    }
  });
});

it.runWhen(import.meta.url);
