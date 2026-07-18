import { describe, should } from '@paulmillr/jsbt/test.js';
import * as mftch from 'micro-ftch';
import { deepStrictEqual, rejects, throws } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { DEFAULT_TOKENS, ERC1155, ERC20, events, tokenFromSymbol } from '../src/abi/index.ts';
import { Transaction } from '../src/index.ts';
import { RpcClient, Web3Error } from '../src/net.ts';
import { enrichTx, rowCodec } from '../src/net/enrich.ts';
import { calcTransfersDiff, history, historyMulti, newestFirst } from '../src/net/history.ts';
import { Quoter } from '../src/net/quoter.ts';
import { NameResolver } from '../src/net/resolver.ts';
import {
    approvalTopics,
    calcAllowances,
    contractCapabilities,
    decodeReceiptTokenTransfers,
    detectTokenContracts,
    ipfsToHttp,
    nftCandidates,
    nftHoldings,
    nftMetadata,
    tokenBalances,
    tokenInfo,
    tokenInfos,
    tokenTransferFromCalldata,
    tokenURI,
} from '../src/net/tokens.ts';

import { internalTransactions, traceFilterSingle } from '../src/net/trace.ts';
import { awaitDeep, UniswapAbstract, UniswapV3 } from '../src/net/uniswap.ts';
import { ethHexNum, numberTo0xHex, weieth } from '../src/utils.ts';

// These real network responses from real nodes, captured by replayable
const NODE_URL = 'https://NODE_URL/';
const getKey = (url, opt) => JSON.stringify({ url: NODE_URL, opt });
const rpcVector = async (name) => (await import(`./vectors/rpc/${name}.js`)).default;
const rpcJsonVector = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/rpc/${name}.json`, import.meta.url), 'utf8'));
const historyJsonVector = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const collectHistory = (prov, address, opts) => Array.fromAsync(history(prov, address, opts));
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const encodeWords = (...words) => `0x${words.map(word).join('')}`;
const encodeAddress = (address) => `0x${'0'.repeat(24)}${address.toLowerCase().slice(2)}`;

function initProv(replayJson) {
  const replay = mftch.replayable(fetch, replayJson, { getKey, offline: true });
  const provider = mftch.jsonrpc(replay, NODE_URL);
  const archive = new RpcClient(provider);
  return archive;
}

function mockEthCallProvider(responses) {
  const calls = [];
  return {
    calls,
    provider: {
      ethCall: async (args) => {
        calls.push(args);
        const response = responses.shift();
        if (!response) throw new Error(`unexpected ethCall ${args.data}`);
        return response;
      },
      estimateGas: async () => {
        throw new Error('unexpected estimateGas');
      },
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    },
  };
}

// For tests only, in real code map is better because it doesn't convert bigints into string!
function deepMapToObject(input) {
  if (input instanceof Map)
    return Object.fromEntries([...input.entries()].map(([k, v]) => [k, deepMapToObject(v)]));
  else if (Array.isArray(input)) return input.map((i) => deepMapToObject(i));
  else if (typeof input === 'object' && input !== null)
    return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, deepMapToObject(v)]));
  return input;
}

// API change workaround
const fixTx = (tx) => {
  if (tx.info.accessList) {
    tx.info.accessList = tx.info.accessList.map(([address, storageKeys]) => ({
      address,
      storageKeys,
    }));
  }
  return tx;
};

describe('Network', () => {
  should('ENS', async () => {
    const resolver = new NameResolver(initProv(await rpcVector('ens')));
    const vitalikAddr = await resolver.nameToAddress('vitalik.eth');
    const vitalikName = await resolver.addressToName(vitalikAddr);
    deepStrictEqual(vitalikAddr, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
    deepStrictEqual(vitalikName, 'vitalik.eth');
  });
  should('Quoter uses Chainlink by default', async () => {
    const quoter = new Quoter(initProv(await rpcVector('chainlink')));
    const btcPrice = await quoter.coinPrice('BTC');
    deepStrictEqual(btcPrice, 69369.10271);
  });
  should('Quoter reads Chainlink prices without caching', async () => {
    const latestRoundData = encodeWords(1n, 123456000000n, 0n, 1n, 1n);
    const { calls, provider } = mockEthCallProvider([latestRoundData, latestRoundData]);
    const quoter = new Quoter(provider);
    deepStrictEqual(await quoter.coinPrice('BTC'), 1234.56);
    deepStrictEqual(await quoter.coinPrice('BTC'), 1234.56);
    deepStrictEqual(calls.length, 2);
  });
  should('Quoter passes block tags to Chainlink reads', async () => {
    const latestRoundData = encodeWords(1n, 123456000000n, 0n, 1n, 1n);
    const { calls, provider } = mockEthCallProvider([latestRoundData]);
    const quoter = new Quoter(provider);
    deepStrictEqual(await quoter.coinPrice('BTC', 'chainlink', { tag: 123 }), 1234.56);
    deepStrictEqual(
      calls.map((c) => c.tag),
      [123]
    );
  });
  should('Quoter rejects invalid Chainlink round data', async () => {
    const { calls, provider } = mockEthCallProvider([
      encodeWords(1n, 0n, 0n, 1n, 1n),
      encodeWords(1n, 123456000000n, 0n, 0n, 1n),
      encodeWords(2n, 123456000000n, 0n, 1n, 1n),
    ]);
    const quoter = new Quoter(provider);
    await rejects(() => quoter.coinPrice('BTC'), /invalid price data/);
    await rejects(() => quoter.coinPrice('BTC'), /invalid price data/);
    await rejects(() => quoter.coinPrice('BTC'), /invalid price data/);
    deepStrictEqual(calls.length, 3);
  });
  should('Quoter rejects old provider object arguments', async () => {
    const { calls, provider } = mockEthCallProvider([]);
    const quoter = new Quoter(provider);
    await rejects(
      () => (quoter as any).coinPrice('BTC', { provider: 'chainlink', params: {} }),
      /unsupported provider/
    );
    await rejects(
      () => (quoter as any).rate(1n, { provider: 'uniswap-v2', params: {} }),
      /unsupported provider/
    );
    deepStrictEqual(calls.length, 0);
  });
  should('asset price quoting uses captured RPC output', async () => {
    const replay = await rpcJsonVector('quoter-readme');
    deepStrictEqual(Object.keys(replay).length, 10);
    const prov = initProv(replay);
    const quoter = new Quoter(prov);
    const btc = await quoter.coinPrice('BTC');
    const bat = await quoter.tokenPrice('BAT');
    const ethV2 = await quoter.coinPrice('ETH', 'uniswap-v2', {
      pairAddress: '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc',
    });
    const ethV3 = await quoter.coinPrice('ETH', 'uniswap-v3', {
      poolAddress: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8',
    });

    deepStrictEqual(
      { btc, bat, ethV2, ethV3 },
      {
        btc: 61479.17292489,
        bat: 0.0800199,
        ethV2: 1698.939664,
        ethV3: 1700.328303,
      }
    );
  });
  should('Quoter Uniswap V3 priceIn API uses captured RPC output', async () => {
    const replay = await rpcJsonVector('quoter-auto');
    deepStrictEqual(Object.keys(replay).length, 9);
    const prov = initProv(replay);
    const USDC = tokenFromSymbol('USDC')!.contract;
    const quoter = new Quoter(prov);
    const eth = await quoter.coinPrice('ETH', 'uniswap-v3', { priceIn: USDC, fees: [500, 3000] });

    deepStrictEqual(eth, 1698.97594);
  });
  should('Quoter caches Uniswap routes without caching prices', async () => {
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const pair = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc';
    const reserves = encodeWords(2_000_000_000n, 1_000_000_000_000_000_000n, 0n);
    const { calls, provider } = mockEthCallProvider([
      encodeAddress(pair),
      encodeAddress(USDC),
      encodeAddress(WETH),
      reserves,
      reserves,
      reserves,
    ]);
    const quoter = new Quoter(provider);
    deepStrictEqual(await quoter.coinPrice('ETH', 'uniswap-v2', { priceIn: USDC, tag: 7 }), 2000);
    deepStrictEqual(await quoter.coinPrice('ETH', 'uniswap-v2', { priceIn: USDC, tag: 7 }), 2000);
    deepStrictEqual(calls.length, 6);
    deepStrictEqual(
      calls.map((c) => c.tag),
      [7, 7, 7, 7, 7, 7]
    );
  });
  should('Quoter clears cached Uniswap routes', async () => {
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const pair1 = '0x1111111111111111111111111111111111111111';
    const pair2 = '0x2222222222222222222222222222222222222222';
    const reserves = encodeWords(2_000_000_000n, 1_000_000_000_000_000_000n, 0n);
    const { calls, provider } = mockEthCallProvider([
      encodeAddress(pair1),
      encodeAddress(USDC),
      encodeAddress(WETH),
      reserves,
      reserves,
      encodeAddress(pair2),
      encodeAddress(USDC),
      encodeAddress(WETH),
      reserves,
      reserves,
    ]);
    const quoter = new Quoter(provider);
    deepStrictEqual(await quoter.coinPrice('ETH', 'uniswap-v2', { priceIn: USDC }), 2000);
    quoter.clearRoutes();
    deepStrictEqual(await quoter.coinPrice('ETH', 'uniswap-v2', { priceIn: USDC }), 2000);
    deepStrictEqual(calls.length, 10);
  });
  should('default token metadata stores Chainlink feeds on canonical token addresses', () => {
    const feedTokens = Object.fromEntries(
      Object.entries(DEFAULT_TOKENS)
        .filter(([, token]) => token.feed)
        .map(([contract, token]) => [token.symbol, contract])
    );
    deepStrictEqual(feedTokens.BAT, tokenFromSymbol('BAT')!.contract);
    deepStrictEqual(feedTokens.USDT, tokenFromSymbol('USDT')!.contract);
    deepStrictEqual(feedTokens.WETH, tokenFromSymbol('WETH')!.contract);
  });
  should('Quoter uses injected replacement token table', async () => {
    const token = '0x00000000000000000000000000000000000000a1';
    const feed = '0x00000000000000000000000000000000000000f1';
    const latestRoundData = encodeWords(1n, 123456n, 0n, 1n, 1n);
    const { calls, provider } = mockEthCallProvider([latestRoundData]);
    const quoter = new Quoter(provider, {
      tokens: {
        [token]: {
          symbol: 'TST',
          decimals: 4,
          feed: { contract: feed, decimals: 3 },
        },
      },
    });
    deepStrictEqual(await quoter.tokenPrice('TST'), 123.456);
    deepStrictEqual(
      calls.map((c) => c.to),
      [feed]
    );
    await rejects(() => quoter.tokenPrice('BAT'), /unknown token: BAT/);
  });
  should('formats RPC quantities', () => {
    deepStrictEqual(
      {
        encoded: [
          ethHexNum.encode(0n),
          ethHexNum.encode(1),
          numberTo0xHex(15),
          ethHexNum.encode(1024n),
        ],
        decoded: [
          ethHexNum.decode('0x0'),
          ethHexNum.decode('0x1'),
          ethHexNum.decode('0xf'),
          ethHexNum.decode('0x400'),
        ],
      },
      { encoded: ['0x0', '0x1', '0xf', '0x400'], decoded: [0n, 1n, 15n, 1024n] }
    );
    for (const hex of ['', '0x', '1', '0x00', '0x01', '0x0400'])
      throws(() => ethHexNum.decode(hex), /invalid RPC quantity/);
  });
  should('passes eth_call tags as block parameters', async () => {
    let seen;
    const archive = new RpcClient({
      call: async (method, ...args) => {
        seen = { method, args };
        return '0x';
      },
    });
    const to = '0x0000000000000000000000000000000000000001';
    await archive.ethCall({ to, data: '0x1234', tag: 123 });
    deepStrictEqual(seen, {
      method: 'eth_call',
      args: [{ to, data: '0x1234' }, '0x7b'],
    });
  });
  should('batches calls through multicall', async () => {
    // Response vector generated with ethers Interface (aggregate3):
    // [{ success: true, returnData: uint256(7) }, { success: false, returnData: 0x }]
    const RESULT =
      '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000007000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000';
    let seen;
    const archive = new RpcClient({
      call: async (method, ...args) => {
        seen = { method, args };
        return RESULT;
      },
    });
    const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
    const res = await archive.multicall(
      [
        { to: DAI, data: '0x06fdde03' },
        { to: DAI, data: '0x95d89b41', allowFailure: false },
      ],
      { tag: 123 }
    );
    deepStrictEqual(res, [
      { success: true, data: `0x${'00'.repeat(31)}07` },
      { success: false, data: '0x' },
    ]);
    deepStrictEqual(seen.method, 'eth_call');
    deepStrictEqual(seen.args[1], '0x7b'); // tag passed through
    // Sent to the canonical Multicall3 deployment with the aggregate3 selector
    deepStrictEqual(seen.args[0].to, '0xcA11bde05977b3631167028862bE2a173976CA11');
    deepStrictEqual(seen.args[0].data.slice(0, 10), '0x82ad56cb');
    await rejects(() => archive.multicall([{ to: DAI }]), /wrong call at index 0/);
  });
  should('quotes Uniswap V2 spot rates', async () => {
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const pair = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc';
    const reserves = encodeWords(2_000_000_000n, 1_000_000_000_000_000_000n, 0n);
    const { calls, provider } = mockEthCallProvider([reserves, reserves, reserves]);
    const quoter = new Quoter(provider);
    const pairParams = { pairAddress: pair, token0: USDC, token1: WETH, tag: 24692474 };
    deepStrictEqual(
      await quoter.rate(1_000_000n, 'uniswap-v2', {
        ...pairParams,
        direction: 'forward',
      }),
      500000000000000n
    );
    deepStrictEqual(
      await quoter.rate(1_000_000_000_000_000_000n, 'uniswap-v2', {
        ...pairParams,
        direction: 'Reverse',
      }),
      2_000_000_000n
    );
    deepStrictEqual(await quoter.coinPrice('ETH', 'uniswap-v2', pairParams), 2000);
    deepStrictEqual(
      calls.map((c) => c.tag),
      [24692474, 24692474, 24692474]
    );
  });
  should('auto-selects Uniswap V2 pairs lazily', async () => {
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const pair = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc';
    const reserves = encodeWords(1_000_000_000_000_000_000n, 2_000_000_000n, 0n);
    const { calls, provider } = mockEthCallProvider([
      encodeAddress(pair),
      encodeAddress(WETH),
      encodeAddress(USDC),
      reserves,
      reserves,
    ]);
    const quoter = new Quoter(provider);
    deepStrictEqual(
      await quoter.rate(1_000_000n, 'uniswap-v2', {
        tokenIn: USDC,
        tokenOut: WETH,
        tag: 2,
      }),
      500000000000000n
    );
    deepStrictEqual(
      calls.map((c) => c.tag),
      [2, 2, 2, 2, 2]
    );
  });
  should('quotes Uniswap V2 prices with priceIn option', async () => {
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const pair = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc';
    const reserves = encodeWords(2_000_000_000n, 1_000_000_000_000_000_000n, 0n);
    const { calls, provider } = mockEthCallProvider([
      encodeAddress(pair),
      encodeAddress(USDC),
      encodeAddress(WETH),
      reserves,
      reserves,
    ]);
    const quoter = new Quoter(provider);
    deepStrictEqual(await quoter.coinPrice('ETH', 'uniswap-v2', { priceIn: USDC, tag: 2 }), 2000);
    deepStrictEqual(
      calls.map((c) => c.tag),
      [2, 2, 2, 2, 2]
    );
  });
  should('quotes Uniswap V2 explicit pairs with priceIn option', async () => {
    const EURC = '0x1abaea1f7c830bd89acc67ec4af516284b1bc33c';
    const WETH = tokenFromSymbol('WETH')!.contract;
    const pair = '0x1111111111111111111111111111111111111111';
    const reserves = encodeWords(1_000_000_000_000_000_000n, 2_000_000_000n, 0n);
    const { calls, provider } = mockEthCallProvider([reserves]);
    const quoter = new Quoter(provider);
    deepStrictEqual(
      await quoter.coinPrice('ETH', 'uniswap-v2', {
        pairAddress: pair,
        token0: WETH,
        token1: EURC,
        priceIn: 'EUR',
      }),
      2000
    );
    deepStrictEqual(calls.length, 1);
  });
  should('rejects invalid priceIn option', async () => {
    const { calls, provider } = mockEthCallProvider([]);
    const quoter = new Quoter(provider);
    await rejects(
      () => quoter.coinPrice('ETH', 'uniswap-v2', { priceIn: 123 } as any),
      /invalid priceIn/
    );
    deepStrictEqual(calls.length, 0);
  });
  should('quotes Uniswap V2 prices with symbol priceIn option', async () => {
    const USDC = tokenFromSymbol('USDC')!.contract;
    const WETH = tokenFromSymbol('WETH')!.contract;
    const pair = '0x1111111111111111111111111111111111111111';
    const reserves = encodeWords(2_000_000_000n, 1_000_000_000_000_000_000n, 0n);
    const { calls, provider } = mockEthCallProvider([
      encodeAddress(pair),
      encodeAddress(USDC),
      encodeAddress(WETH),
      reserves,
      reserves,
    ]);
    const quoter = new Quoter(provider);
    deepStrictEqual(await quoter.coinPrice('ETH', 'uniswap-v2', { priceIn: 'USDC' }), 2000);
    deepStrictEqual(calls.length, 5);
  });
  should('quotes Uniswap V2 prices with EUR priceIn aliases', async () => {
    const EURC = '0x1abaea1f7c830bd89acc67ec4af516284b1bc33c';
    const WETH = tokenFromSymbol('WETH')!.contract;
    const pair = '0x1111111111111111111111111111111111111111';
    const reserves = encodeWords(2_000_000_000n, 1_000_000_000_000_000_000n, 0n);
    const { calls, provider } = mockEthCallProvider([
      encodeAddress(pair),
      encodeAddress(EURC),
      encodeAddress(WETH),
      reserves,
      reserves,
      reserves,
      reserves,
    ]);
    const quoter = new Quoter(provider);
    deepStrictEqual(await quoter.coinPrice('ETH', 'uniswap-v2', { priceIn: 'EUR' }), 2000);
    deepStrictEqual(await quoter.coinPrice('ETH', 'uniswap-v2', { priceIn: 'EURC' }), 2000);
    deepStrictEqual(await quoter.coinPrice('ETH', 'uniswap-v2', { priceIn: EURC }), 2000);
    deepStrictEqual(calls.length, 7);
  });
  should('quotes Uniswap V2 prices with default USDT priceIn', async () => {
    const USDT = tokenFromSymbol('USDT')!.contract;
    const WETH = tokenFromSymbol('WETH')!.contract;
    const pair = '0x1111111111111111111111111111111111111111';
    const reserves = encodeWords(1_000_000_000_000_000_000n, 2_000_000_000n, 0n);
    const { calls, provider } = mockEthCallProvider([
      encodeAddress(pair),
      encodeAddress(WETH),
      encodeAddress(USDT),
      reserves,
      reserves,
    ]);
    const quoter = new Quoter(provider);
    deepStrictEqual(await quoter.coinPrice('ETH', 'uniswap-v2'), 2000);
    deepStrictEqual(calls.length, 5);
  });
  should('quotes Uniswap V3 spot rates', async () => {
    const XAUT = '0x68749665ff8d2d112fa859aa293f07a622782f38';
    const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
    const pool = '0x6546055f46e866a4b9a4a13e81273e3152bae5da';
    const sqrtPriceX96 = 2n ** 97n; // price token0 in token1 is 4.
    const slot0 = encodeWords(sqrtPriceX96, 0n, 0n, 0n, 0n, 0n, 1n);
    const { provider } = mockEthCallProvider([slot0, slot0]);
    const quoter = new Quoter(provider);
    const poolParams = { poolAddress: pool, token0: XAUT, token1: USDT };
    deepStrictEqual(
      await quoter.rate(1n, 'uniswap-v3', { ...poolParams, direction: 'forward' }),
      4n
    );
    deepStrictEqual(
      await quoter.rate(4n, 'uniswap-v3', { ...poolParams, direction: 'reverse' }),
      1n
    );
  });
  should('auto-selects Uniswap V3 pools lazily', async () => {
    const USDC = tokenFromSymbol('USDC')!.contract;
    const WETH = tokenFromSymbol('WETH')!.contract;
    const lowPool = '0x1111111111111111111111111111111111111111';
    const highPool = '0x2222222222222222222222222222222222222222';
    const slot0 = encodeWords(2n ** 96n * 1_000_000n, 0n, 0n, 0n, 0n, 0n, 1n);
    const { calls, provider } = mockEthCallProvider([
      encodeAddress(lowPool),
      encodeAddress(USDC),
      encodeAddress(WETH),
      encodeWords(10n),
      encodeAddress(highPool),
      encodeAddress(USDC),
      encodeAddress(WETH),
      encodeWords(20n),
      slot0,
    ]);
    const quoter = new Quoter(provider);
    deepStrictEqual(
      await quoter.rate(1_000_000n, 'uniswap-v3', {
        tokenIn: USDC,
        tokenOut: WETH,
        fees: [500, 3000],
        tag: 2,
      }),
      1_000_000_000_000_000_000n
    );
    deepStrictEqual(
      calls.map((c) => c.tag),
      [2, 2, 2, 2, 2, 2, 2, 2, 2]
    );
  });
  should('quotes Uniswap V3 prices with default USDT priceIn', async () => {
    const USDT = tokenFromSymbol('USDT')!.contract;
    const WETH = tokenFromSymbol('WETH')!.contract;
    const lowPool = '0x1111111111111111111111111111111111111111';
    const highPool = '0x2222222222222222222222222222222222222222';
    const slot0 = encodeWords((2n ** 96n + 999_999n) / 1_000_000n, 0n, 0n, 0n, 0n, 0n, 1n);
    const { calls, provider } = mockEthCallProvider([
      encodeAddress(lowPool),
      encodeAddress(WETH),
      encodeAddress(USDT),
      encodeWords(10n),
      encodeAddress(highPool),
      encodeAddress(WETH),
      encodeAddress(USDT),
      encodeWords(20n),
      slot0,
    ]);
    const quoter = new Quoter(provider);
    deepStrictEqual(await quoter.coinPrice('ETH', 'uniswap-v3', { fees: [500, 3000] }), 1);
    deepStrictEqual(calls.length, 9);
  });
  should('quotes Uniswap V3 prices with priceIn option', async () => {
    const USDC = tokenFromSymbol('USDC')!.contract;
    const WETH = tokenFromSymbol('WETH')!.contract;
    const lowPool = '0x1111111111111111111111111111111111111111';
    const highPool = '0x2222222222222222222222222222222222222222';
    const slot0 = encodeWords(2n ** 96n * 1_000_000n, 0n, 0n, 0n, 0n, 0n, 1n);
    const { calls, provider } = mockEthCallProvider([
      encodeAddress(lowPool),
      encodeAddress(USDC),
      encodeAddress(WETH),
      encodeWords(10n),
      encodeAddress(highPool),
      encodeAddress(USDC),
      encodeAddress(WETH),
      encodeWords(20n),
      slot0,
    ]);
    const quoter = new Quoter(provider);
    deepStrictEqual(
      await quoter.coinPrice('ETH', 'uniswap-v3', {
        priceIn: USDC,
        fees: [500, 3000],
        tag: 2,
      }),
      1
    );
    deepStrictEqual(
      calls.map((c) => c.tag),
      [2, 2, 2, 2, 2, 2, 2, 2, 2]
    );
  });
  should('routes Uniswap V3 EUR prices through USDC', async () => {
    const WBTC = tokenFromSymbol('WBTC')!.contract;
    const USDC = tokenFromSymbol('USDC')!.contract;
    const EURC = '0x1abaea1f7c830bd89acc67ec4af516284b1bc33c';
    const wbtcUsdcPool = '0x1111111111111111111111111111111111111111';
    const usdcEurcPool = '0x2222222222222222222222222222222222222222';
    const slot0 = encodeWords(2n ** 96n, 0n, 0n, 0n, 0n, 0n, 1n);
    const { calls, provider } = mockEthCallProvider([
      encodeAddress(wbtcUsdcPool),
      encodeAddress(WBTC),
      encodeAddress(USDC),
      encodeWords(10n),
      slot0,
      encodeAddress(usdcEurcPool),
      encodeAddress(USDC),
      encodeAddress(EURC),
      encodeWords(20n),
      slot0,
    ]);
    const quoter = new Quoter(provider);
    deepStrictEqual(
      await quoter.coinPrice('BTC', 'uniswap-v3', { priceIn: 'EUR', fees: [3000] }),
      100
    );
    deepStrictEqual(calls[0].data.endsWith(word(3000n)), true);
    deepStrictEqual(calls[5].data.endsWith(word(500n)), true);
    deepStrictEqual(calls.length, 10);
  });
  should('quotes Uniswap V3 explicit pools with priceIn option', async () => {
    const USDC = tokenFromSymbol('USDC')!.contract;
    const WETH = tokenFromSymbol('WETH')!.contract;
    const pool = '0x1111111111111111111111111111111111111111';
    const slot0 = encodeWords(2n ** 96n * 1_000_000n, 0n, 0n, 0n, 0n, 0n, 1n);
    const { calls, provider } = mockEthCallProvider([slot0]);
    const quoter = new Quoter(provider);
    deepStrictEqual(
      await quoter.coinPrice('ETH', 'uniswap-v3', {
        poolAddress: pool,
        token0: USDC,
        token1: WETH,
        priceIn: 'USDC',
      }),
      1
    );
    deepStrictEqual(calls.length, 1);
  });
  should('quotes Uniswap V3 prices with singular fee option', async () => {
    const WBTC = tokenFromSymbol('WBTC')!.contract;
    const WETH = tokenFromSymbol('WETH')!.contract;
    const pool = '0x1111111111111111111111111111111111111111';
    const slot0 = encodeWords(2n ** 96n * 100_000_000n, 0n, 0n, 0n, 0n, 0n, 1n);
    const { calls, provider } = mockEthCallProvider([
      encodeAddress(pool),
      encodeAddress(WBTC),
      encodeAddress(WETH),
      encodeWords(10n),
      slot0,
    ]);
    const quoter = new Quoter(provider);
    deepStrictEqual(
      await quoter.coinPrice('ETH', 'uniswap-v3', { priceIn: 'WBTC', fee: 3000 } as any),
      0.000001
    );
    deepStrictEqual(calls.length, 5);
  });
  should('quotes Uniswap V3 prices with WBTC priceIn symbol', async () => {
    const WBTC = tokenFromSymbol('WBTC')!.contract;
    const WETH = tokenFromSymbol('WETH')!.contract;
    const pool = '0x1111111111111111111111111111111111111111';
    const slot0 = encodeWords(2n ** 96n * 100_000_000n, 0n, 0n, 0n, 0n, 0n, 1n);
    const { calls, provider } = mockEthCallProvider([
      encodeAddress(pool),
      encodeAddress(WBTC),
      encodeAddress(WETH),
      encodeWords(10n),
      slot0,
    ]);
    const quoter = new Quoter(provider);
    deepStrictEqual(
      await quoter.coinPrice('ETH', 'uniswap-v3', { priceIn: 'WBTC', fees: [3000] }),
      0.000001
    );
    deepStrictEqual(calls.length, 5);
  });
  should('quotes Uniswap V3 stablecoin symbol prices', async () => {
    const USDC = tokenFromSymbol('USDC')!.contract;
    const DAI = tokenFromSymbol('DAI')!.contract;
    const pool = '0x95dbb3c7546f22bce375900abfdd64a4e5bd73d6';
    const sqrtPriceX96 = 2n ** 96n * 1_000_000n; // 1 USDC raw unit scale -> 1 DAI.
    const slot0 = encodeWords(sqrtPriceX96, 0n, 0n, 0n, 0n, 0n, 1n);
    const { provider } = mockEthCallProvider([slot0]);
    const quoter = new Quoter(provider);
    deepStrictEqual(
      await quoter.tokenPrice('USDC', 'uniswap-v3', {
        poolAddress: pool,
        token0: USDC,
        token1: DAI,
      }),
      1
    );
  });
  should('quotes ERC-4626 vault conversions', async () => {
    const vault = '0x0c6aec603d48ebf1cecc7b247a2c3da08b398dc1';
    const asset = '0x1abaea1f7c830bd89acc67ec4af516284b1bc33c';
    const { provider } = mockEthCallProvider([encodeWords(102n), encodeWords(98n)]);
    const quoter = new Quoter(provider);
    const params = { vaultAddress: vault, assetAddress: asset };
    deepStrictEqual(await quoter.rate(100n, 'erc4626', { ...params, direction: 'forward' }), 102n);
    deepStrictEqual(await quoter.rate(100n, 'erc4626', { ...params, direction: 'reverse' }), 98n);
  });
  should('Quoter dispatches provider rate calls', async () => {
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const pair = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc';
    const reserves = encodeWords(2_000_000_000n, 1_000_000_000_000_000_000n, 0n);
    const { provider } = mockEthCallProvider([reserves, reserves, encodeWords(102n)]);
    const quoter = new Quoter(provider);
    deepStrictEqual(
      await quoter.rate(1_000_000n, 'uniswap-v2', {
        pairAddress: pair,
        token0: USDC,
        token1: WETH,
        tokenIn: USDC,
      }),
      500000000000000n
    );
    deepStrictEqual(
      await quoter.rate(1_000_000_000_000_000_000n, 'uniswap-v2', {
        pairAddress: pair,
        token0: USDC,
        token1: WETH,
        tokenIn: WETH,
      }),
      2_000_000_000n
    );
    deepStrictEqual(
      await quoter.rate(100n, 'erc4626', {
        vaultAddress: '0x0c6aec603d48ebf1cecc7b247a2c3da08b398dc1',
        assetAddress: '0x1abaea1f7c830bd89acc67ec4af516284b1bc33c',
      }),
      102n
    );
  });
  should('awaitDeep preserves null leaves', async () => {
    deepStrictEqual(await awaitDeep({ a: null, b: [Promise.resolve(1), null] }, false), {
      a: null,
      b: [1, null],
    });
  });
  should('awaitDeep preserves user awaitDeep keys', async () => {
    deepStrictEqual(await awaitDeep({ awaitDeep: true, value: Promise.resolve('ok') }, false), {
      awaitDeep: true,
      value: 'ok',
    });
  });
  should('validates swap token input', async () => {
    const univ3 = new UniswapV3({
      ethCall: async () => {
        throw new Error('unexpected ethCall');
      },
      estimateGas: async () => {
        throw new Error('unexpected estimateGas');
      },
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    const DAI = tokenFromSymbol('DAI')!;
    await rejects(() => univ3.swap('DAI' as any, DAI, '1'), /uniswap\.swap: wrong fromCoin/);
    await rejects(() => univ3.swap('eth', { contract: DAI.contract } as any, '1'), /wrong toCoin/);
  });
  should('swap only hides missing-route bestPath errors', async () => {
    class TestUni extends UniswapAbstract {
      name = 'Test';
      contract = '0x0000000000000000000000000000000000000001';
      err: Error;
      constructor(err: Error) {
        super({
          ethCall: async () => {
            throw new Error('unexpected ethCall');
          },
          estimateGas: async () => {
            throw new Error('unexpected estimateGas');
          },
          call: async () => {
            throw new Error('unexpected rpc call');
          },
        });
        this.err = err;
      }
      bestPath() {
        throw this.err;
      }
      txData() {
        throw new Error('unexpected txData');
      }
    }
    const DAI = tokenFromSymbol('DAI')!;
    await rejects(() => new TestUni(new Error('boom')).swap('eth', DAI, '1'), /boom/);
    deepStrictEqual(
      await new TestUni(new Error('uniswap: cannot find path')).swap('eth', DAI, '1'),
      undefined
    );
  });
  should('UniswapV3 wraps eth before direct quote', async () => {
    const DAI = tokenFromSymbol('DAI')!;
    const WETH = tokenFromSymbol('WETH')!;
    const word = (n) => n.toString(16).padStart(64, '0');
    let directCalls = 0;
    const univ3 = new UniswapV3({
      ethCall: async ({ data }) => {
        if (!data) throw new Error('missing calldata');
        if (data.startsWith('0xcdca1753')) throw new Error('multihop unavailable');
        if (data.startsWith('0xf7729d43')) {
          const call = data.toLowerCase();
          if (!call.includes(WETH.contract.slice(2))) throw new Error('missing WETH tokenIn');
          if (!call.includes(DAI.contract.slice(2))) throw new Error('missing DAI tokenOut');
          directCalls++;
          return `0x${word(2000000000000000000n)}`;
        }
        throw new Error(`unexpected ethCall ${data.slice(0, 10)}`);
      },
      estimateGas: async () => {
        throw new Error('unexpected estimateGas');
      },
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    const swap = await univ3.swap('eth', DAI, '1', { slippagePercent: 0.5, ttl: 1800 });
    deepStrictEqual(
      { name: swap?.name, expectedAmount: swap?.expectedAmount, directCalls },
      { name: 'Uniswap V3', expectedAmount: '2', directCalls: 3 }
    );
  });

  should('UniswapV3', async () => {
    const univ3 = new UniswapV3(initProv(await rpcVector('uniswap')));
    // Actual code
    const vitalikAddr = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
    const DAI = tokenFromSymbol('DAI')!;
    // Swap 1.23 eth into DAI
    const swap = await univ3.swap('eth', DAI, '1.23', {
      // NOTE: we need to force deadline here, otherwise test will change deadline with every second passed
      deadline: 1720000000000,
    });
    deepStrictEqual(swap.expectedAmount, '4798.71452058898027444');
    const tx = await swap.tx(vitalikAddr, vitalikAddr); // same addr
    deepStrictEqual(tx, {
      amount: '1.23',
      address: '0xe592427a0aece92de3edee1f18e0157c05861564',
      expectedAmount: '4798.71452058898027444',
      data: '0xc04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000019077fd30000000000000000000000000000000000000000000000000001111d67bb1bb0000000000000000000000000000000000000000000000000102d6906ca33403f40b0000000000000000000000000000000000000000000000000000000000000042c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480001f46b175474e89094c44da98b954eedeac495271d0f000000000000000000000000000000000000000000000000000000000000',
      allowance: undefined,
    });
  });

  should('estimateGas', async () => {
    const archive = initProv(await rpcVector('estimateGas'));
    const gasLimit = await archive.estimateGas({
      from: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      to: '0xe592427a0aece92de3edee1f18e0157c05861564',
      value: numberTo0xHex(weieth.decode('1.23')),
      data: '0xc04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000019077fd30000000000000000000000000000000000000000000000000001111d67bb1bb0000000000000000000000000000000000000000000000000102d6906ca33403f40b0000000000000000000000000000000000000000000000000000000000000042c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480001f46b175474e89094c44da98b954eedeac495271d0f000000000000000000000000000000000000000000000000000000000000',
    });
    deepStrictEqual(gasLimit, 236082n);
  });
  should('rejects empty RPC quantities', async () => {
    const archive = new RpcClient({
      call: async () => '',
    });
    await rejects(() => archive.estimateGas({}), /RPC quantity/);
  });
  should('validates pagination blocks', async () => {
    const archive = new RpcClient({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(
      () =>
        internalTransactions(archive, '0x0000000000000000000000000000000000000000', {
          fromBlock: -1,
          toBlock: 0,
        }),
      /validatePagination: wrong field fromBlock=-1/
    );
    await rejects(
      () =>
        internalTransactions(archive, '0x0000000000000000000000000000000000000000', {
          fromBlock: 0,
          toBlock: -1,
        }),
      /validatePagination: wrong field toBlock=-1/
    );
  });
  should('validates trace batch size', async () => {
    const archive = new RpcClient({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(
      () =>
        internalTransactions(archive, '0x0000000000000000000000000000000000000000', {
          fromBlock: 2,
          toBlock: 1,
          limitTrace: 0,
        }),
      /validateTraceOpts: wrong field limitTrace=0/
    );
    await rejects(
      () =>
        internalTransactions(archive, '0x0000000000000000000000000000000000000000', {
          fromBlock: 2,
          toBlock: 1,
          limitTrace: -1,
        }),
      /validateTraceOpts: wrong field limitTrace=-1/
    );
  });
  should('validates log batch size', async () => {
    const archive = new RpcClient({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(
      () => archive.ethLogs([], { fromBlock: 2, toBlock: 1, limitLogs: 0 }),
      /validateLogOpts: wrong field limitLogs=0/
    );
    await rejects(
      () => archive.ethLogs([], { fromBlock: 2, toBlock: 1, limitLogs: -1 }),
      /validateLogOpts: wrong field limitLogs=-1/
    );
  });
  should('validates direct log options', async () => {
    const archive = new RpcClient({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(
      () => archive.ethLogs([], { fromBlock: -1 }),
      /validatePagination: wrong field fromBlock=-1/
    );
  });
  should('validates approval topics address', () => {
    throws(() => approvalTopics(1 as any), /approvalTopics: wrong address/);
  });
  should('keeps token balance snapshots independent', () => {
    const contract = '0x0000000000000000000000000000000000000001';
    const from = '0x0000000000000000000000000000000000000002';
    const mid = '0x0000000000000000000000000000000000000003';
    const to = '0x0000000000000000000000000000000000000004';
    const diff = calcTransfersDiff([
      {
        hash: '0x01',
        reverted: false,
        transfers: [],
        tokenTransfers: [
          {
            contract,
            abi: 'ERC20',
            totalSupply: 10n,
            from,
            to: mid,
            tokens: new Map([[1n, 3n]]),
          },
        ],
        info: {},
      },
      {
        hash: '0x02',
        reverted: false,
        transfers: [],
        tokenTransfers: [
          {
            contract,
            abi: 'ERC20',
            totalSupply: 10n,
            from: mid,
            to,
            tokens: new Map([[1n, 2n]]),
          },
        ],
        info: {},
      },
    ] as any);
    deepStrictEqual(
      diff.map((i) => deepMapToObject(i.tokenBalances)),
      [
        {
          [contract]: {
            [from]: { '1': -3n },
            [mid]: { '1': 3n },
          },
        },
        {
          [contract]: {
            [from]: { '1': -3n },
            [mid]: { '1': 1n },
            [to]: { '1': 2n },
          },
        },
      ]
    );
  });
  should('clamps eth_getLogs batches to toBlock', async () => {
    const calls = [];
    const archive = new RpcClient({
      call: async (method, ...args) => {
        calls.push([method, args]);
        return [];
      },
    });
    await archive.ethLogs(['0x1234'], {
      fromBlock: 15065022,
      toBlock: 15065022,
      limitLogs: 6,
    });
    deepStrictEqual(calls, [
      [
        'eth_getLogs',
        [
          {
            topics: ['0x1234'],
            fromBlock: '0xe5dfbe',
            toBlock: '0xe5dfbe',
          },
        ],
      ],
    ]);
  });
  should('deduplicates overlapping eth_getLogs batches', async () => {
    const log = {
      address: '0x0000000000000000000000000000000000000001',
      topics: [],
      data: '0x',
      blockNumber: '0x3',
      transactionHash: `0x${'11'.repeat(32)}`,
      transactionIndex: '0x0',
      blockHash: `0x${'22'.repeat(32)}`,
      logIndex: '0x0',
      removed: false,
    };
    const archive = new RpcClient({
      call: async () => {
        return [{ ...log }];
      },
    });
    deepStrictEqual(await archive.ethLogs([], { fromBlock: 1, toBlock: 3, limitLogs: 2 }), [
      {
        ...log,
        blockNumber: 3,
        transactionIndex: 0,
        logIndex: 0,
      },
    ]);
  });
  should('caps eth_getLogs batch fan-out at eight requests', async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const archive = new RpcClient({
      call: async () => {
        calls++;
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 0));
        active--;
        return [];
      },
    });
    await archive.ethLogs([], { fromBlock: 0, toBlock: 20, limitLogs: 1 });
    deepStrictEqual(calls, 21);
    deepStrictEqual(maxActive, 8);
  });
  should('rebuilds zero-fee EIP-1559 transaction info', async () => {
    const tx = Transaction.prepare(
      {
        type: 'eip1559',
        chainId: 1n,
        nonce: 0n,
        maxPriorityFeePerGas: 0n,
        maxFeePerGas: 0n,
        gasLimit: 21000n,
        to: '0x0000000000000000000000000000000000000001',
        value: 0n,
        data: '0x',
        accessList: [],
      },
      false
    ).signBy('6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e', false);
    const raw = tx.raw as any;
    const hash = tx.hash;
    const info = {
      blockHash: `0x${'11'.repeat(32)}`,
      blockNumber: '0x1',
      hash,
      accessList: [],
      transactionIndex: '0x0',
      type: '0x2',
      nonce: '0x0',
      input: '0x',
      r: numberTo0xHex(raw.r),
      s: numberTo0xHex(raw.s),
      chainId: '0x1',
      v: numberTo0xHex(raw.yParity),
      gas: '0x5208',
      maxPriorityFeePerGas: '0x0',
      maxFeePerGas: '0x0',
      from: tx.sender,
      to: raw.to,
      value: '0x0',
      gasPrice: '0x0',
    };
    const receipt = {
      transactionHash: hash,
      blockHash: info.blockHash,
      blockNumber: '0x1',
      logsBloom: `0x${'00'.repeat(256)}`,
      gasUsed: '0x5208',
      contractAddress: null,
      cumulativeGasUsed: '0x5208',
      transactionIndex: '0x0',
      from: info.from,
      to: info.to,
      type: '0x2',
      effectiveGasPrice: '0x0',
      logs: [],
      status: '0x1',
    };
    const archive = new RpcClient({
      call: async (method, txHash) => {
        deepStrictEqual(txHash, hash);
        if (method === 'eth_getTransactionByHash') return info;
        if (method === 'eth_getTransactionReceipt') return receipt;
        throw new Error('unexpected rpc call');
      },
    });
    deepStrictEqual(await archive.txInfo(hash), {
      type: 'eip1559',
      info: {
        ...info,
        blockNumber: 1,
        transactionIndex: 0,
        type: 2,
        nonce: 0n,
        r: raw.r,
        s: raw.s,
        chainId: 1n,
        v: BigInt(raw.yParity),
        gas: 21000n,
        maxPriorityFeePerGas: 0n,
        maxFeePerGas: 0n,
        value: 0n,
        gasPrice: 0n,
      },
      receipt: {
        ...receipt,
        blockNumber: 1,
        gasUsed: 21000n,
        cumulativeGasUsed: 21000n,
        transactionIndex: 0,
        type: 2,
        effectiveGasPrice: 0n,
        status: 1,
      },
      raw: tx.toHex(),
    });
  });
  should('rebuilds zero-gas-price legacy transaction info', async () => {
    const tx = Transaction.prepare(
      {
        type: 'legacy',
        chainId: 1n,
        nonce: 0n,
        gasPrice: 0n,
        gasLimit: 21000n,
        to: '0x0000000000000000000000000000000000000001',
        value: 0n,
        data: '0x',
      },
      false
    ).signBy('6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e', false);
    const raw = tx.raw as any;
    const hash = tx.hash;
    const info = {
      blockHash: `0x${'11'.repeat(32)}`,
      blockNumber: '0x1',
      hash,
      transactionIndex: '0x0',
      type: '0x0',
      nonce: '0x0',
      input: '0x',
      r: numberTo0xHex(raw.r),
      s: numberTo0xHex(raw.s),
      chainId: '0x1',
      v: numberTo0xHex(BigInt(raw.yParity) + 37n),
      gas: '0x5208',
      from: tx.sender,
      to: raw.to,
      value: '0x0',
      gasPrice: '0x0',
    };
    const receipt = {
      transactionHash: hash,
      blockHash: info.blockHash,
      blockNumber: '0x1',
      logsBloom: `0x${'00'.repeat(256)}`,
      gasUsed: '0x5208',
      contractAddress: null,
      cumulativeGasUsed: '0x5208',
      transactionIndex: '0x0',
      from: info.from,
      to: info.to,
      type: '0x0',
      effectiveGasPrice: '0x0',
      logs: [],
      status: '0x1',
    };
    const archive = new RpcClient({
      call: async (method, txHash) => {
        deepStrictEqual(txHash, hash);
        if (method === 'eth_getTransactionByHash') return info;
        if (method === 'eth_getTransactionReceipt') return receipt;
        throw new Error('unexpected rpc call');
      },
    });
    deepStrictEqual(await archive.txInfo(hash), {
      type: 'legacy',
      info: {
        ...info,
        blockNumber: 1,
        transactionIndex: 0,
        type: 0,
        nonce: 0n,
        r: raw.r,
        s: raw.s,
        chainId: 1n,
        v: 37n,
        gas: 21000n,
        value: 0n,
        gasPrice: 0n,
      },
      receipt: {
        ...receipt,
        blockNumber: 1,
        gasUsed: 21000n,
        cumulativeGasUsed: 21000n,
        transactionIndex: 0,
        type: 0,
        effectiveGasPrice: 0n,
        status: 1,
      },
      raw: tx.toHex(),
    });
  });
  should('validates transaction info hash', async () => {
    const calls = [];
    const archive = new RpcClient({
      call: async (method, ...args) => {
        calls.push([method, args]);
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(() => archive.txInfo(1 as any), /txInfo: wrong txHash/);
    await rejects(() => archive.txInfo('0x1234'), /txInfo: wrong txHash/);
    await rejects(() => archive.txInfo(`0x${'zz'.repeat(32)}`), /txInfo: wrong txHash/);
    await rejects(
      () => archive.txInfo(`0x${'11'.repeat(32)}`, { verify: 1 as any }),
      /txInfo: wrong verify/
    );
    deepStrictEqual(calls, []);
  });
  should('txInfo verify:false tolerates txs that cannot be rebuilt', async () => {
    const txHash = `0x${'11'.repeat(32)}`;
    // a plausible node response whose signature is garbage: the raw tx cannot
    // be rebuilt to match the claimed sender/hash
    const info = {
      hash: txHash,
      blockHash: `0x${'bb'.repeat(32)}`,
      blockNumber: '0x64',
      transactionIndex: '0x0',
      type: '0x2',
      nonce: '0x7',
      input: '0x',
      r: '0x1',
      s: '0x1',
      chainId: '0x1',
      v: '0x0',
      gas: '0x5208',
      maxPriorityFeePerGas: '0x1',
      maxFeePerGas: '0x3b9aca00',
      from: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
      value: '0xde0b6b3a7640000',
      gasPrice: '0x3b9aca00',
    };
    const receipt = {
      transactionHash: txHash,
      blockHash: info.blockHash,
      blockNumber: '0x64',
      logsBloom: `0x${'00'.repeat(256)}`,
      gasUsed: '0x5208',
      contractAddress: null,
      cumulativeGasUsed: '0x5208',
      transactionIndex: '0x0',
      from: info.from,
      to: info.to,
      type: '0x2',
      effectiveGasPrice: '0x3b9aca00',
      logs: [],
      status: '0x1',
    };
    const makeProvider = (withReceipt) =>
      new RpcClient({
        call: async (method) => {
          if (method === 'eth_getTransactionByHash') return { ...info };
          if (method === 'eth_getTransactionReceipt') return withReceipt ? { ...receipt } : null;
          throw new Error('unexpected rpc call');
        },
      });
    // default: verification failure is an error
    await rejects(() => makeProvider(true).txInfo(txHash));
    // verify: false returns normalized data with `raw` left undefined
    const res = await makeProvider(true).txInfo(txHash, { verify: false });
    deepStrictEqual(res.raw, undefined);
    deepStrictEqual(res.info.value, 10n ** 18n);
    deepStrictEqual(res.receipt!.status, 1);
    // pending: no receipt yet
    const pending = await makeProvider(false).txInfo(txHash, { verify: false });
    deepStrictEqual(pending.receipt, undefined);
    // unknown tx: explicit error instead of a crash inside normalization
    const empty = new RpcClient({ call: async () => null });
    await rejects(() => empty.txInfo(txHash, { verify: false }), /txInfo: not found/);
  });
  should('formats trace_filter bounds', async () => {
    const calls = [];
    const archive = new RpcClient({
      call: async (method, ...args) => {
        calls.push([method, args]);
        return [];
      },
    });
    await traceFilterSingle(archive, '0x0000000000000000000000000000000000000000', {
      fromBlock: 1,
    });
    await traceFilterSingle(archive, '0x0000000000000000000000000000000000000000', {
      fromBlock: 1,
      toBlock: 2,
    });
    deepStrictEqual(calls, [
      [
        'trace_filter',
        [
          {
            fromBlock: '0x1',
            toAddress: ['0x0000000000000000000000000000000000000000'],
            fromAddress: ['0x0000000000000000000000000000000000000000'],
          },
        ],
      ],
      [
        'trace_filter',
        [
          {
            fromBlock: '0x1',
            toAddress: ['0x0000000000000000000000000000000000000000'],
            fromAddress: ['0x0000000000000000000000000000000000000000'],
            toBlock: '0x2',
          },
        ],
      ],
    ]);
  });
  should('validates OTS search blocks', async () => {
    const archive = new RpcClient({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(
      () => archive.ots_searchBefore('0x0000000000000000000000000000000000000000', -1),
      /ots_searchBefore: wrong block/
    );
    await rejects(
      () => archive.ots_searchAfter('0x0000000000000000000000000000000000000000', -1),
      /ots_searchAfter: wrong block/
    );
    await rejects(
      () => archive.ots_searchBefore('0x0000000000000000000000000000000000000000', 0, 0),
      /ots_searchBefore: wrong pageSize/
    );
    await rejects(
      () => archive.ots_searchAfter('0x0000000000000000000000000000000000000000', 0, -1),
      /ots_searchAfter: wrong pageSize/
    );
  });
  should('clamps trace_filter batches to toBlock', async () => {
    const calls = [];
    const archive = new RpcClient({
      call: async (method, ...args) => {
        calls.push([method, args]);
        return [];
      },
    });
    await internalTransactions(archive, '0x0000000000000000000000000000000000000000', {
      fromBlock: 15065022,
      toBlock: 15065022,
      limitTrace: 6,
    });
    deepStrictEqual(calls, [
      [
        'trace_filter',
        [
          {
            fromBlock: '0xe5dfbe',
            toAddress: ['0x0000000000000000000000000000000000000000'],
            fromAddress: ['0x0000000000000000000000000000000000000000'],
            toBlock: '0xe5dfbe',
          },
        ],
      ],
    ]);
  });
  should('does not overlap trace_filter batches', async () => {
    const calls = [];
    const archive = new RpcClient({
      call: async (method, ...args) => {
        calls.push([method, args]);
        return [];
      },
    });
    await internalTransactions(archive, '0x0000000000000000000000000000000000000000', {
      fromBlock: 1,
      toBlock: 5,
      limitTrace: 2,
    });
    deepStrictEqual(calls, [
      [
        'trace_filter',
        [
          {
            fromBlock: '0x1',
            toAddress: ['0x0000000000000000000000000000000000000000'],
            fromAddress: ['0x0000000000000000000000000000000000000000'],
            toBlock: '0x3',
          },
        ],
      ],
      [
        'trace_filter',
        [
          {
            fromBlock: '0x4',
            toAddress: ['0x0000000000000000000000000000000000000000'],
            fromAddress: ['0x0000000000000000000000000000000000000000'],
            toBlock: '0x5',
          },
        ],
      ],
    ]);
  });
  should('Transcations basic', async () => {
    // Random address from abi tests which test for fingerprinted data in encoding.
    // Perfect for tests: only has a few transactions and provides different types of txs.
    const addr = '0x6994eCe772cC4aBb5C9993c065a34C94544A4087';
    const expected = await rpcVector('parsed-transactions');
    const tx = initProv(await rpcVector('net_tx_basic'));
    // Blocks. Vector predates the seconds convention: timestamps were captured in ms.
    deepStrictEqual(await tx.blockInfo(15_010_733), {
      ...expected.block,
      timestamp: expected.block.timestamp / 1000,
    });
    // Internal transactions sanity
    const internal = await Promise.all([
      internalTransactions(tx, addr, {
        fromBlock: 14_272_357,
        toBlock: 15_065_121,
      }),
      internalTransactions(tx, addr, {
        fromBlock: 14_272_357,
        toBlock: 15_065_121,
        perRequest: 25,
      }),
    ]);
    for (const i of internal) deepStrictEqual(i, expected.internal);
    // Make sure that all equal and pagination works
    for (let i = 1; i < internal.length; i++) deepStrictEqual(internal[i - 1], internal[i]);

    deepStrictEqual(
      await tx.txInfo('0x01bcf8e4be50fcf0537865f658dc912f43710f2fe579aa46f133105d58945eb5'),
      expected.txInfo
    );
    deepStrictEqual(
      await tx.txInfo('0xba296ea35b5ff390b8c180ae8f536159dc8723871b43ed7f80e0c218cf171a05'),
      fixTx(expected.blobTx)
    );
    deepStrictEqual(
      await tx.txInfo('0x86c5a4350c973cd990105ae461522d01aa313fecbe0a67727e941cd9cee28997'),
      expected.legacyTx
    );
    // Dynamically get tokenInfo for unknown token
    const BAT = tokenFromSymbol('BAT')!;
    deepStrictEqual(await tokenInfo(tx, BAT.contract), {
      contract: BAT.contract,
      abi: 'ERC20',
      symbol: BAT.symbol,
      decimals: BAT.decimals,
      name: 'Basic Attention Token',
      totalSupply: 1500000000000000000000000000n,
    });
  });

  should('allowances', async () => {
    const addr = '0x6994eCe772cC4aBb5C9993c065a34C94544A4087';
    const tx = initProv(await rpcVector('net_allowances'));
    deepStrictEqual(calcAllowances(await tx.ethLogs(approvalTopics(addr)), addr), {
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': {
        '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': 1269932532n,
        '0x7a250d5630b4cf539739df2c5dacb4c659f2488d':
          115792089237316195423570985008687907853269984665640564039457584007913129639935n,
        '0xe592427a0aece92de3edee1f18e0157c05861564':
          115792089237316195423570985008687907853269984665640564039457584007913129639935n,
        '0xdef1c0ded9bec7f1a1670819833240f027b25eff':
          115792089237316195423570985008687907853269984665640564039457584007913129639935n,
      },
      '0xf4d2888d29d722226fafa5d9b24f9164c092421e': {
        '0xbcd7254a1d759efa08ec7c3291b2e85c5dcc12ce':
          115792089237316195423570985008687907853269984665640564030358861248482727152367n,
        '0x3ab16af1315dc6c95f83cbf522fecf98d00fd9ba':
          115792089237316195423570985008687907853269984665640564026175568221260815893747n,
      },
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': {
        '0xe592427a0aece92de3edee1f18e0157c05861564':
          115792089237316195423570985008687907853269984665640564039457584007913129639935n,
      },
      '0xb4bda5036c709e7e3d6cc7fe577fb616363cbb0c': {
        '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45':
          115792089237316195423570985008687907853269984665640564039457584007913129639935n,
      },
      '0x1db9f66a900c0cb6d50e34d02985fc7bdafcde7e': {
        '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45':
          115792089237316195423570985008687907853269984665640564039457584007913129639935n,
      },
    });
  });

  should('contractCapabilities', async () => {
    const replay = mftch.replayable(fetch, await rpcVector('net_contract_capabilities'), {
      getKey,
      offline: true,
    });
    const ftch = mftch.ftch(replay, { concurrencyLimit: 5 });
    const archive = new RpcClient(mftch.jsonrpc(ftch, 'http://NODE_URL/', { batchSize: 10 }));

    const coolCats = '0x1a92f7381b9f03921564a437210bb9396471050c';
    deepStrictEqual(await contractCapabilities(archive, coolCats), {
      erc165: true,
      erc165_check: false,
      erc20: false,
      erc721: true,
      erc721_metadata: true,
      erc721_enumerable: true,
      erc1155: false,
      erc1155_metadata: false,
      erc1155_tokenreceiver: false,
    });
    const metaverse = '0xce320d1484b9e6c6061f5de748484546cdae2206';
    deepStrictEqual(await contractCapabilities(archive, metaverse), {
      erc165: true,
      erc165_check: false,
      erc20: false,
      erc721: false,
      erc721_metadata: false,
      erc721_enumerable: false,
      erc1155: true,
      erc1155_metadata: true,
      erc1155_tokenreceiver: false,
    });
    const beanz = '0x306b1ea3ecdf94ab739f1910bbda052ed4a9f949';
    deepStrictEqual(await contractCapabilities(archive, beanz), {
      erc165: true,
      erc165_check: false,
      erc20: false,
      erc721: true,
      erc721_metadata: true,
      erc721_enumerable: false,
      erc1155: false,
      erc1155_tokenreceiver: false,
      erc1155_metadata: false,
    });
    const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';
    deepStrictEqual(await contractCapabilities(archive, usdt), {
      erc165: false,
      erc165_check: false,
      erc20: false,
      erc721: false,
      erc721_metadata: false,
      erc721_enumerable: false,
      erc1155: false,
      erc1155_tokenreceiver: false,
      erc1155_metadata: false,
    });
    // We cannot test this here, so it crashes for now. More high-level methods like tokenInfo doesn't crash!
    // Which is kinda reasonable, because not-contract|self-destroyed contract is wrong input here?
    const dead = '0x52903256dd18d85c2dc4a6c999907c9793ea61e3'; // self-destructed contract
    await rejects(() => contractCapabilities(archive, dead));
  });
  should('tokenInfo', async () => {
    const replay = mftch.replayable(fetch, await rpcVector('net_token_info'), {
      getKey,
      offline: true,
    });
    const ftch = mftch.ftch(replay, { concurrencyLimit: 5 });
    const archive = new RpcClient(mftch.jsonrpc(ftch, 'http://NODE_URL/', { batchSize: 10 }));

    const coolCats = '0x1a92f7381b9f03921564a437210bb9396471050c';
    deepStrictEqual(await tokenInfo(archive, coolCats), {
      abi: 'ERC721',
      contract: '0x1a92f7381b9f03921564a437210bb9396471050c',
      name: 'Cool Cats',
      symbol: 'COOL',
      totalSupply: 9968n,
      enumerable: true,
      metadata: true,
    });
    const metaverse = '0xce320d1484b9e6c6061f5de748484546cdae2206';
    deepStrictEqual(await tokenInfo(archive, metaverse), {
      contract: '0xce320d1484b9e6c6061f5de748484546cdae2206',
      abi: 'ERC1155',
    });
    const beanz = '0x306b1ea3ecdf94ab739f1910bbda052ed4a9f949';
    deepStrictEqual(await tokenInfo(archive, beanz), {
      contract: '0x306b1ea3ecdf94ab739f1910bbda052ed4a9f949',
      abi: 'ERC721',
      name: 'Beanz',
      symbol: 'BEANZ',
      metadata: true,
    });
    const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';
    deepStrictEqual(await tokenInfo(archive, usdt), {
      contract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      abi: 'ERC20',
      name: 'Tether USD',
      symbol: 'USDT',
      totalSupply: 76926220145483487n,
      decimals: 6,
    });
    const dead = '0x52903256dd18d85c2dc4a6c999907c9793ea61e3'; // self-destructed contract
    deepStrictEqual(await tokenInfo(archive, dead), {
      contract: '0x52903256dd18d85c2dc4a6c999907c9793ea61e3',
      error: 'not contract or destructed',
    });
  });
  should('preserves zero ERC20 decimals', async () => {
    const contract = '0x0000000000000000000000000000000000000001';
    const archive = new RpcClient({
      call: async (method, ...args) => {
        if (method === 'eth_getCode') return '0x01';
        if (method === 'eth_call') {
          const [{ data }] = args;
          if (data.startsWith('0x01ffc9a7')) return `0x${'00'.repeat(32)}`;
          if (data === '0x313ce567') return `0x${'00'.repeat(32)}`;
          if (data === '0x18160ddd') return `0x${'00'.repeat(31)}01`;
        }
        throw new Error('optional metadata unavailable');
      },
    });
    deepStrictEqual(await tokenInfo(archive, contract), {
      contract,
      abi: 'ERC20',
      name: undefined,
      symbol: undefined,
      totalSupply: 1n,
      decimals: 0,
    });
  });
  should('handles empty ERC20 tokenIds filter', async () => {
    const address = '0x0000000000000000000000000000000000000002';
    const contract = '0x0000000000000000000000000000000000000001';
    const archive = new RpcClient({
      call: async (method, ...args) => {
        if (method === 'eth_getCode') return '0x01';
        if (method === 'eth_call') {
          const [{ data }] = args;
          if (data.startsWith('0x01ffc9a7')) return `0x${'00'.repeat(32)}`;
          if (data === '0x18160ddd') return `0x${'00'.repeat(31)}01`;
          if (data.startsWith('0x70a08231')) return `0x${'00'.repeat(31)}05`;
        }
        throw new Error('optional metadata unavailable');
      },
    });
    deepStrictEqual(await tokenBalances(archive, address, [contract], { [contract]: new Set() }), {
      [contract]: new Map(),
    });
  });
  should('validates tokenURI token input', async () => {
    const archive = new RpcClient({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(() => tokenURI(archive, 123 as any, 1n), /tokenURI: wrong token/);
  });
  should('validates tokenBalances token input', async () => {
    const archive = new RpcClient({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    const address = '0x0000000000000000000000000000000000000002';
    await rejects(
      () => tokenBalances(archive, address, [123 as any]),
      /tokenBalances: wrong token/
    );
    await rejects(
      () => tokenBalances(archive, address, [{ abi: 'ERC20' } as any]),
      /tokenBalances: wrong token/
    );
  });
  should('tokenBalances', async () => {
    const replay = mftch.replayable(fetch, await rpcVector('net_token_balances'), {
      getKey,
      offline: true,
    });
    const ftch = mftch.ftch(replay, { concurrencyLimit: 5 });
    const archive = new RpcClient(mftch.jsonrpc(ftch, 'http://NODE_URL/', { batchSize: 10 }));

    const coolCats = '0x1a92f7381b9f03921564a437210bb9396471050c';
    const metaverse = '0xce320d1484b9e6c6061f5de748484546cdae2206';
    const beanz = '0x306b1ea3ecdf94ab739f1910bbda052ed4a9f949';
    const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';
    const dead = '0x52903256dd18d85c2dc4a6c999907c9793ea61e3'; // self-destructed contract
    const tokens = [coolCats, metaverse, beanz, usdt, dead];

    // Some address with small amount of holdings that had last tx long time ago
    const addr = '0x6994eCe772cC4aBb5C9993c065a34C94544A4087';
    const addr2 = '0x91D82d923C77D6a01fB20098d58640FD578e7a66';
    const addr3 = '0x1DC58E16B870CF39eB49e65b73796D1E8AB8A145'; // has cats
    const addr4 = '0xbB0D4ccf4e095a2D6A9A2BEE2985a703c1Ca9B69'; // has cats
    const addr5 = '0x682032e3915745227c347e91f4b0d1dbba97ca87'; // has 46 of metaverse

    deepStrictEqual(await tokenBalances(archive, addr, tokens), {
      [coolCats]: new Map(),
      [metaverse]: {
        contract: '0xce320d1484b9e6c6061f5de748484546cdae2206',
        error: 'cannot fetch erc1155 without tokenIds',
      },
      [beanz]: new Map(),
      [usdt]: new Map([[1n, 0n]]),
      [dead]: {
        contract: '0x52903256dd18d85c2dc4a6c999907c9793ea61e3',
        error: 'not contract or destructed',
      },
    });
    // Various ERC-20 stuff
    deepStrictEqual(
      await tokenBalances(archive, addr, [
        '0xa1c7d450130bb77c6a23ddfaecbc4a060215384b',
        '0xb4bda5036c709e7e3d6cc7fe577fb616363cbb0c',
        '0x81db680b1a811b5e9be8b3a01a211f94f7c7fbf3',
        '0x528686c89db00e22f58703b2d4b02e200f3255eb',
        '0x1db9f66a900c0cb6d50e34d02985fc7bdafcde7e',
        '0x35333e20391c171fc856d2f6e46304410949c452',
      ]),
      {
        '0xa1c7d450130bb77c6a23ddfaecbc4a060215384b': new Map([[1n, 195983216736205891626852908n]]),
        '0xb4bda5036c709e7e3d6cc7fe577fb616363cbb0c': new Map([[1n, 130626626738232824137856499n]]),
        '0x81db680b1a811b5e9be8b3a01a211f94f7c7fbf3': new Map([[1n, 1965780268797386852567451n]]),
        '0x528686c89db00e22f58703b2d4b02e200f3255eb': new Map([[1n, 26027502560778307541998806n]]),
        '0x1db9f66a900c0cb6d50e34d02985fc7bdafcde7e': new Map([
          [1n, 2892700371812082121621646155n],
        ]),
        '0x35333e20391c171fc856d2f6e46304410949c452': new Map([[1n, 60882249518969761112698747n]]),
      }
    );
    // just ERC-721 (enumerable), cats
    deepStrictEqual(await tokenBalances(archive, addr3, tokens), {
      [coolCats]: new Map([
        [4365n, 1n],
        [4364n, 1n],
        [4351n, 1n],
        [4363n, 1n],
        [4350n, 1n],
        [4349n, 1n],
        [4348n, 1n],
        [4347n, 1n],
        [4346n, 1n],
        [4345n, 1n],
        [147n, 1n],
        [144n, 1n],
        [146n, 1n],
        [143n, 1n],
        [1n, 1n],
      ]),
      [metaverse]: {
        contract: '0xce320d1484b9e6c6061f5de748484546cdae2206',
        error: 'cannot fetch erc1155 without tokenIds',
      },
      [beanz]: new Map(),
      [usdt]: new Map([[1n, 0n]]),
      [dead]: {
        contract: '0x52903256dd18d85c2dc4a6c999907c9793ea61e3',
        error: 'not contract or destructed',
      },
    });
    deepStrictEqual(await tokenBalances(archive, addr4, tokens), {
      [coolCats]: new Map([
        [4331n, 1n],
        [5075n, 1n],
        [1283n, 1n],
        [8518n, 1n],
        [7988n, 1n],
        [5464n, 1n],
        [8164n, 1n],
        [3482n, 1n],
        [2685n, 1n],
        [6343n, 1n],
        [8822n, 1n],
        [2060n, 1n],
        [7144n, 1n],
        [5595n, 1n],
        [3951n, 1n],
      ]),
      [metaverse]: {
        contract: '0xce320d1484b9e6c6061f5de748484546cdae2206',
        error: 'cannot fetch erc1155 without tokenIds',
      },
      [beanz]: new Map(),
      [usdt]: new Map([[1n, 0n]]),
      [dead]: {
        contract: '0x52903256dd18d85c2dc4a6c999907c9793ea61e3',
        error: 'not contract or destructed',
      },
    });
    // ERC-721 with tokenIds (non-enumarable)
    deepStrictEqual(
      await tokenBalances(
        archive,
        addr4,
        [{ ...(await tokenInfo(archive, coolCats)), enumerable: false }],
        {
          '0x1a92f7381b9f03921564a437210bb9396471050c': new Set([4331n, 7988n, 1155n]),
        }
      ),
      {
        [coolCats]: new Map([
          [4331n, 1n],
          [7988n, 1n],
          [1155n, 0n],
        ]),
      }
    );
    // ERC-1155 with tokenIds
    deepStrictEqual(
      await tokenBalances(archive, addr5, [metaverse], {
        [metaverse]: new Set([46n]),
      }),
      { [metaverse]: new Map([[46n, 1n]]) }
    );
    // NFT URI: should be cached, it is per tokenId, not per account
    deepStrictEqual(await tokenURI(archive, coolCats, 1n), 'https://api.coolcatsnft.com/cat/1');
    deepStrictEqual(await tokenURI(archive, metaverse, 46n), 'https://themta.site/ipfs/46');
    deepStrictEqual(await tokenURI(archive, usdt, 1n), {
      contract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      error: 'not supported token type',
    });
  });
  should('accountState', async () => {
    const archive = new RpcClient({
      call: async (method, ...args) => {
        deepStrictEqual(args, ['0x0000000000000000000000000000000000000001', 'latest']);
        if (method === 'eth_getBalance') return '0x5';
        if (method === 'eth_getTransactionCount') return '0x2';
        throw new Error(`unexpected rpc call ${method}`);
      },
    });
    const expected = { symbol: 'ETH', decimals: 18, balance: 5n, nonce: 2n, active: true };
    deepStrictEqual(
      await archive.accountState('0x0000000000000000000000000000000000000001'),
      expected
    );
  });
  should('nonce', async () => {
    const archive = new RpcClient({
      call: async (method, ...args) => {
        deepStrictEqual(method, 'eth_getTransactionCount');
        deepStrictEqual(args, ['0x0000000000000000000000000000000000000001', 'latest']);
        return '0x1f';
      },
    });
    deepStrictEqual(await archive.nonce('0x0000000000000000000000000000000000000001'), 31n);
    await rejects(() => archive.nonce(1 as any), /nonce: wrong address/);
  });
  should('fees from eth_feeHistory', async () => {
    const archive = new RpcClient({
      call: async (method) => {
        if (method === 'eth_feeHistory')
          return {
            baseFeePerGas: ['0x32', '0x64'], // last entry is next block's base fee
            gasUsedRatio: [0.5],
            reward: [['0x2'], ['0x4'], ['0x0']], // zero-reward blocks are ignored
          };
        throw new Error(`unexpected rpc call ${method}`);
      },
    });
    deepStrictEqual(await archive.fees(), {
      type: 'eip1559',
      baseFee: 100n,
      maxPriorityFeePerGas: 3n,
      maxFeePerGas: 203n,
    });
  });
  should('fees falls back to eth_gasPrice', async () => {
    const archive = new RpcClient({
      call: async (method) => {
        if (method === 'eth_feeHistory')
          throw Object.assign(new Error('FetchProvider(-32601): method not found'), {
            code: -32601,
          });
        if (method === 'eth_gasPrice') return '0x77359400';
        throw new Error(`unexpected rpc call ${method}`);
      },
    });
    deepStrictEqual(await archive.fees(), { type: 'legacy', gasPrice: 2000000000n });
  });
  should('broadcast accepts hex and Transaction', async () => {
    const tx = Transaction.prepare({
      to: '0x0000000000000000000000000000000000000001',
      value: 1n,
      nonce: 0n,
      maxFeePerGas: 2n * 10n ** 9n,
      gasLimit: 21000n,
      chainId: 1n,
    }).signBy('6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e', false);
    const sent = [];
    const archive = new RpcClient({
      call: async (method, ...args) => {
        deepStrictEqual(method, 'eth_sendRawTransaction');
        sent.push(args[0]);
        return `0x${'11'.repeat(32)}`;
      },
    });
    deepStrictEqual(await archive.broadcast(tx), `0x${'11'.repeat(32)}`);
    deepStrictEqual(await archive.broadcast(tx.toHex()), `0x${'11'.repeat(32)}`);
    deepStrictEqual(sent, [tx.toHex(), tx.toHex()]);
    await rejects(() => archive.broadcast('nothex'), /broadcast: wrong transaction/);
  });
  should('waitForReceipt polls until inclusion', async () => {
    const hash = `0x${'11'.repeat(32)}`;
    let polls = 0;
    const receipt = {
      transactionHash: hash,
      blockHash: `0x${'22'.repeat(32)}`,
      blockNumber: '0x5',
      logsBloom: '0x',
      gasUsed: '0x5208',
      contractAddress: null,
      cumulativeGasUsed: '0x5208',
      transactionIndex: '0x0',
      from: '0x0000000000000000000000000000000000000001',
      to: '0x0000000000000000000000000000000000000002',
      type: '0x2',
      effectiveGasPrice: '0x1',
      logs: [],
      status: '0x1',
    };
    const archive = new RpcClient({
      call: async (method) => {
        if (method === 'eth_getTransactionReceipt') return ++polls < 3 ? null : { ...receipt };
        if (method === 'eth_blockNumber') return '0x6'; // 2 confirmations for block 5
        throw new Error(`unexpected rpc call ${method}`);
      },
    });
    const res = await archive.waitForReceipt(hash, { confirmations: 2, pollIntervalMs: 1 });
    deepStrictEqual(
      { blockNumber: res.blockNumber, status: res.status, polls },
      {
        blockNumber: 5,
        status: 1,
        polls: 3,
      }
    );
    await rejects(() => archive.waitForReceipt('0x1234'), /waitForReceipt: wrong txHash/);
  });
  should('waitForReceipt timeout and abort', async () => {
    const hash = `0x${'11'.repeat(32)}`;
    const archive = new RpcClient({
      call: async (method) => {
        if (method === 'eth_getTransactionReceipt') return null;
        throw new Error(`unexpected rpc call ${method}`);
      },
    });
    await rejects(
      () => archive.waitForReceipt(hash, { timeoutMs: 5, pollIntervalMs: 1 }),
      /waitForReceipt: timeout/
    );
    const ctrl = new AbortController();
    ctrl.abort();
    await rejects(
      () => archive.waitForReceipt(hash, { pollIntervalMs: 1, signal: ctrl.signal }),
      /abort/i
    );
  });
  should('prepare fetches wallet-loop fields in parallel', async () => {
    const to = '0x0000000000000000000000000000000000000001';
    const from = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
    const archive = new RpcClient({
      call: async (method, ...args) => {
        if (method === 'eth_getTransactionCount') return '0x5';
        if (method === 'eth_feeHistory')
          return { baseFeePerGas: ['0x64'], gasUsedRatio: [], reward: [['0x2']] };
        if (method === 'eth_estimateGas') {
          deepStrictEqual(args[0], { from, to, value: '0x1' });
          return '0x5208';
        }
        if (method === 'eth_chainId') return '0x1';
        throw new Error(`unexpected rpc call ${method}`);
      },
    });
    const fields = await archive.prepare({ from, to, value: 1n });
    deepStrictEqual(fields, {
      type: 'eip1559',
      nonce: 5n,
      gasLimit: 21000n,
      chainId: 1n,
      to,
      value: 1n,
      data: '0x',
      maxFeePerGas: 202n,
      maxPriorityFeePerGas: 2n,
    });
    // Round-trips into a signable transaction.
    const tx = Transaction.prepare(fields);
    deepStrictEqual(tx.raw.nonce, 5n);
  });
  should('wraps method-not-found errors with node requirement', async () => {
    const notFound = () =>
      Object.assign(new Error('FetchProvider(-32601): the method does not exist'), {
        code: -32601,
      });
    const archive = new RpcClient({
      call: async (method) => {
        if (method === 'trace_filter' || method.startsWith('ots_')) throw notFound();
        return [];
      },
    });
    const addr = '0x0000000000000000000000000000000000000001';
    await rejects(
      () => internalTransactions(archive, addr, { fromBlock: 0, toBlock: 1 }),
      (e) =>
        e instanceof Web3Error &&
        e.method === 'trace_filter' &&
        e.rpcCode === -32601 &&
        /trace_filter not available on this node.*uncapped trace_filter.*see README/.test(e.message)
    );
    await rejects(
      () => archive.ots_traceTransaction(`0x${'11'.repeat(32)}`),
      (e) => e instanceof Web3Error && /OtterScan/.test(e.message)
    );
  });
  should('capabilities probes node namespaces', async () => {
    const archive = new RpcClient({
      call: async (method) => {
        if (method === 'eth_blockNumber') return '0x1';
        if (method === 'trace_filter')
          throw Object.assign(new Error('method not found'), { code: -32601 });
        if (method === 'ots_getApiLevel') return 8;
        throw new Error(`unexpected rpc call ${method}`);
      },
    });
    deepStrictEqual(await archive.capabilities(), { eth: true, trace: false, ots: true });
  });
  should('capabilities surfaces non-RPC failures', async () => {
    const archive = new RpcClient({
      call: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await rejects(() => archive.capabilities(), /ECONNREFUSED/);
  });
  should('contract() binds provider', async () => {
    const contract = '0x0000000000000000000000000000000000000001';
    const archive = new RpcClient({
      call: async (method, callArgs) => {
        deepStrictEqual(method, 'eth_call');
        deepStrictEqual(callArgs.to, contract);
        return `0x${'00'.repeat(31)}05`;
      },
    });
    const c = archive.contract(ERC20, contract);
    deepStrictEqual(await c.balanceOf.call('0x0000000000000000000000000000000000000002'), 5n);
  });
  describe('OTS history', () => {
    const ADDR = '0x0000000000000000000000000000000000000002';
    const OTHER = '0x0000000000000000000000000000000000000003';
    const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const hash = (byte) => `0x${byte.repeat(32)}`;
    // Raw (pre-normalization) OTS search shapes, as an erigon node returns them:
    // hex quantities, receipts carrying `timestamp`, txs carrying `blockTimestamp`
    const rawTx = (h, block, from, to, value) => ({
      hash: h,
      blockHash: hash('bb'),
      blockNumber: numberTo0xHex(block),
      transactionIndex: '0x0',
      type: '0x2',
      nonce: '0x1',
      input: '0x',
      gas: '0x5208',
      gasPrice: '0x3b9aca00',
      value: numberTo0xHex(value),
      from,
      to,
      blockTimestamp: numberTo0xHex(1700000000 + block),
    });
    const rawReceipt = (h, block, logs = []) => ({
      transactionHash: h,
      blockHash: hash('bb'),
      blockNumber: numberTo0xHex(block),
      transactionIndex: '0x0',
      type: '0x2',
      status: '0x1',
      gasUsed: '0x5208',
      cumulativeGasUsed: '0x5208',
      effectiveGasPrice: '0x3b9aca00',
      contractAddress: null,
      timestamp: 1700000000 + block, // erigon OTS receipts carry unix seconds
      logs,
    });
    const transferLog = (contract, from, to, value, logIndex = 0) => ({
      address: contract,
      topics: [TRANSFER_TOPIC, encodeAddress(from), encodeAddress(to)],
      data: encodeWords(value),
      blockNumber: '0x64',
      transactionIndex: '0x0',
      logIndex: numberTo0xHex(logIndex),
      transactionHash: hash('11'),
      removed: false,
    });
    const normalizedTransferLog = (h, block, from, to, value, logIndex = 0) => ({
      ...transferLog(USDT, from, to, value, logIndex),
      blockHash: hash('bb'),
      blockNumber: block,
      transactionHash: h,
      transactionIndex: 0,
      logIndex,
    });
    const normalizedTx = (h, block, from, to, logs = []) => ({
      type: 'eip1559',
      raw: undefined,
      info: {
        hash: h,
        blockHash: hash('bb'),
        blockNumber: block,
        transactionIndex: 0,
        from,
        to,
        value: 0n,
        blockTimestamp: 1700000000 + block,
      },
      receipt: {
        transactionHash: h,
        blockHash: hash('bb'),
        blockNumber: block,
        transactionIndex: 0,
        status: 1,
        gasUsed: 0n,
        effectiveGasPrice: 0n,
        timestamp: 1700000000 + block,
        logs,
      },
    });
    const historyVectorProvider = (vector) => {
      const calls = [];
      const call = async (method, ...args) => {
        calls.push([method, ...args]);
        if (method === 'eth_blockNumber') return vector.rpc.eth_blockNumber.result;
        if (method === 'eth_getLogs') {
          const req = args[0];
          const family = vector.rpc.eth_getLogs.families.find(
            (item) => JSON.stringify(item.topics) === JSON.stringify(req.topics)
          );
          if (!family) throw new Error(`unexpected log topics ${JSON.stringify(req.topics)}`);
          const response = vector.rpc.eth_getLogs.responses.find(
            (item) =>
              item.family === family.name &&
              item.fromBlock === Number(req.fromBlock) &&
              item.toBlock === Number(req.toBlock)
          );
          return structuredClone(response?.result ?? vector.rpc.eth_getLogs.default);
        }
        if (method === 'eth_getTransactionByHash')
          return structuredClone(vector.rpc.eth_getTransactionByHash[args[0]]);
        if (method === 'eth_getTransactionReceipt')
          return structuredClone(vector.rpc.eth_getTransactionReceipt[args[0]]);
        throw new Error(`unexpected rpc call ${method}`);
      };
      return { calls, provider: new RpcClient({ call }) };
    };
    const comparableHistoryRow = (row) => ({
      hash: row.hash,
      block: row.block,
      timestamp: row.timestamp,
      reverted: row.reverted,
      diff: row.diff.toString(),
      partial: row.partial,
      tokenTransfers: row.tokenTransfers.map((transfer) => ({
        ...transfer,
        tokens: Object.fromEntries(
          [...transfer.tokens].map(([tokenId, value]) => [tokenId.toString(), value.toString()])
        ),
      })),
    });
    should('history builds wallet rows from one OTS search page', async () => {
      const calls = [];
      const archive = new RpcClient({
        call: async (method, ...args) => {
          calls.push([method, ...args]);
          if (method !== 'ots_searchTransactionsBefore')
            throw new Error(`unexpected rpc call ${method}`);
          return {
            txs: [
              rawTx(hash('11'), 100, OTHER, ADDR, 10n ** 18n), // incoming 1 ETH
              rawTx(hash('22'), 90, ADDR, OTHER, 5n * 10n ** 17n), // outgoing 0.5 ETH + fee
            ],
            receipts: [
              rawReceipt(hash('11'), 100, [
                transferLog(USDT, OTHER, ADDR, 5000000n), // involves ADDR: kept
                transferLog(USDT, OTHER, OTHER, 7000000n, 1), // unrelated: filtered
                transferLog(`0x${'77'.repeat(20)}`, OTHER, ADDR, 9n, 2), // unknown token: skipped
              ]),
              rawReceipt(hash('22'), 90),
            ],
            firstPage: true,
            lastPage: false,
          };
        },
      });
      const res = await collectHistory(archive, ADDR, { source: 'ots' });
      deepStrictEqual(calls, [['ots_searchTransactionsBefore', ADDR, 0, 25]]);
      deepStrictEqual(
        res.map((t) => ({
          hash: t.hash,
          timestamp: t.timestamp,
          block: t.block,
          reverted: t.reverted,
          diff: t.diff,
        })),
        [
          {
            hash: hash('11'),
            timestamp: 1700000100,
            block: 100,
            reverted: false,
            diff: 10n ** 18n,
          },
          {
            hash: hash('22'),
            timestamp: 1700000090,
            block: 90,
            reverted: false,
            // value + gasUsed * effectiveGasPrice
            diff: -(5n * 10n ** 17n + 21000n * 10n ** 9n),
          },
        ]
      );
      deepStrictEqual(res[0].tokenTransfers, [
        {
          contract: USDT,
          abi: 'ERC20',
          symbol: 'USDT',
          decimals: 6,
          from: OTHER,
          to: ADDR,
          tokens: new Map([[1n, 5000000n]]),
        },
      ]);
      deepStrictEqual(res[1].tokenTransfers, []);
      // normalized raw data is kept for detail views
      deepStrictEqual(res[0].info.info.value, 10n ** 18n);
      deepStrictEqual(res[0].info.receipt.status, 1);
      deepStrictEqual(Object.hasOwn(res[0], 'partial'), false);
    });
    should('history passes OTS cursor and page size through', async () => {
      const calls = [];
      const archive = new RpcClient({
        call: async (method, ...args) => {
          calls.push([method, ...args]);
          return { txs: [], receipts: [], firstPage: true, lastPage: true };
        },
      });
      deepStrictEqual(
        await collectHistory(archive, ADDR, { source: 'ots', before: 100, pageSize: 10 }),
        []
      );
      deepStrictEqual(calls, [['ots_searchTransactionsBefore', ADDR, 100, 10]]);
      throws(() => history(archive, ADDR, { pageSize: 0 }), /history: wrong pageSize/);
    });
    should('order oldest pages forward via ots_searchAfter', async () => {
      // OTS pages are natively newest-first even when searching forward;
      // firstPage marks the newest end of history, lastPage the oldest.
      const pages = {
        0: {
          txs: [rawTx(hash('22'), 20, ADDR, OTHER, 2n), rawTx(hash('11'), 10, OTHER, ADDR, 1n)],
          receipts: [rawReceipt(hash('22'), 20), rawReceipt(hash('11'), 10)],
          firstPage: false,
          lastPage: true,
        },
        20: {
          txs: [rawTx(hash('44'), 40, OTHER, ADDR, 4n), rawTx(hash('33'), 30, OTHER, ADDR, 3n)],
          receipts: [rawReceipt(hash('44'), 40), rawReceipt(hash('33'), 30)],
          firstPage: true,
          lastPage: false,
        },
      };
      const calls = [];
      const archive = new RpcClient({
        call: async (method, ...args) => {
          calls.push([method, ...args]);
          if (method !== 'ots_searchTransactionsAfter')
            throw new Error(`unexpected rpc call ${method}`);
          return pages[args[1]];
        },
      });
      const rows = await collectHistory(archive, ADDR, {
        source: 'ots',
        order: 'oldest',
        depth: 'full',
        pageSize: 2,
      });
      deepStrictEqual(
        rows.map((row) => row.block),
        [10, 20, 30, 40]
      );
      deepStrictEqual(calls, [
        ['ots_searchTransactionsAfter', ADDR, 0, 2],
        ['ots_searchTransactionsAfter', ADDR, 20, 2],
      ]);
      // page depth: one oldest page, resuming from an `after` cursor
      const single = await collectHistory(archive, ADDR, {
        source: 'ots',
        order: 'oldest',
        after: 0,
        pageSize: 2,
      });
      deepStrictEqual(
        single.map((row) => row.block),
        [10, 20]
      );
      throws(() => history(archive, ADDR, { order: 'bogus' }), /history: wrong order/);
      throws(() => history(archive, ADDR, { source: 'bogus' }), /history: wrong source/);
      throws(
        () => history(archive, ADDR, { order: 'oldest', before: 5 }),
        /history: before requires order newest/
      );
      throws(() => history(archive, ADDR, { after: 5 }), /history: after requires order oldest/);
    });
    should('history retries transient rpc errors during logs scan', async () => {
      // Nodes shed load with retryable errors; a long scan must back off and
      // retry instead of aborting. One window issues 7 log queries per pass.
      const transient = [
        Object.assign(new Error('boom'), { code: -32005 }), // Erigon limit code
        new Error('fetch failed'), // undici dropped connection
      ];
      let getLogs = 0;
      const archive = new RpcClient({
        call: async (method) => {
          if (method !== 'eth_getLogs') throw new Error(`unexpected rpc call ${method}`);
          getLogs++;
          const fail = transient.shift();
          if (fail) throw fail;
          return [];
        },
      });
      const opts = { source: 'logs', depth: 'full', fromBlock: 0, toBlock: 9, logsWindow: 0 };
      deepStrictEqual(await collectHistory(archive, ADDR, opts), []);
      // both errors hit the first pass's concurrent queries; one retry re-issues all 7
      deepStrictEqual(getLogs, 14);
      // non-transient errors propagate immediately
      const broken = new RpcClient({
        call: async () => {
          throw new Error('method handler crashed');
        },
      });
      await rejects(() => collectHistory(broken, ADDR, opts), /method handler crashed/);
    });
    should('historyMulti merges accounts as one wallet', async () => {
      const B = '0x0000000000000000000000000000000000000004';
      const FEE = 21000n * 10n ** 9n; // helpers: gasUsed * effectiveGasPrice
      // T1: owned -> owned 1 ETH, plus a token movement to B from a third party
      const r1 = rawReceipt(hash('11'), 30, [transferLog(USDT, OTHER, B, 5000000n)]);
      const pages = {
        [ADDR]: {
          txs: [rawTx(hash('11'), 30, ADDR, B, 10n ** 18n), rawTx(hash('22'), 20, OTHER, ADDR, 2n * 10n ** 18n)],
          receipts: [r1, rawReceipt(hash('22'), 20)],
          firstPage: true,
          lastPage: true,
        },
        [B]: {
          txs: [rawTx(hash('11'), 30, ADDR, B, 10n ** 18n), rawTx(hash('33'), 10, B, OTHER, 3n * 10n ** 18n)],
          receipts: [r1, rawReceipt(hash('33'), 10)],
          firstPage: true,
          lastPage: true,
        },
      };
      const calls = [];
      const archive = new RpcClient({
        call: async (method, ...args) => {
          calls.push([method, ...args]);
          if (method !== 'ots_searchTransactionsBefore' && method !== 'ots_searchTransactionsAfter')
            throw new Error(`unexpected rpc call ${method}`);
          return pages[args[0]];
        },
      });
      const rows = [];
      for await (const row of historyMulti(archive, [ADDR, B], { source: 'ots' })) rows.push(row);
      deepStrictEqual(
        rows.map((row) => [row.hash, row.block, row.diff, row.addresses]),
        [
          // owned -> owned nets to just the fee; both participants listed
          [hash('11'), 30, -FEE, [ADDR, B]],
          [hash('22'), 20, 2n * 10n ** 18n, [ADDR]],
          [hash('33'), 10, -(3n * 10n ** 18n + FEE), [B]],
        ]
      );
      // perspective is content-derived: the USDT movement touches B even
      // though ADDR's stream (which wins the dedupe) filtered it out
      deepStrictEqual(rows[0].tokenTransfers.length, 1);
      deepStrictEqual(rows[0].tokenTransfers[0].to, B);
      deepStrictEqual(rows[0].tokenTransfers[0].tokens, new Map([[1n, 5000000n]]));

      // oldest order merges ascending over the same pages
      const oldest = [];
      for await (const row of historyMulti(archive, [ADDR, B], { source: 'ots', order: 'oldest' }))
        oldest.push(row);
      deepStrictEqual(
        oldest.map((row) => row.hash),
        [hash('33'), hash('22'), hash('11')]
      );

      // watched set is deduplicated; casing of the first occurrence is kept
      calls.length = 0;
      const deduped = [];
      for await (const row of historyMulti(archive, [ADDR, ADDR], { source: 'ots' }))
        deduped.push(row);
      deepStrictEqual(calls.length, 1);
      deepStrictEqual(deduped.length, 2);
      deepStrictEqual(deduped[0].addresses, [ADDR]);

      throws(() => historyMulti(archive, [], {}), /historyMulti: wrong addresses/);
      throws(() => historyMulti(archive, [ADDR, 5], {}), /historyMulti: wrong addresses/);
      throws(() => historyMulti(archive, ADDR, {}), /historyMulti: wrong addresses/);
    });
    should('ots+logs recovers an incoming-only token transaction', async () => {
      const incoming = transferLog(USDT, OTHER, ADDR, 5000000n);
      const calls = [];
      const progress = [];
      let logCalls = 0;
      const archive = new RpcClient({
        call: async (method, ...args) => {
          calls.push([method, ...args]);
          if (method === 'ots_searchTransactionsBefore')
            return {
              txs: [rawTx(hash('22'), 90, OTHER, ADDR, 1n)],
              receipts: [rawReceipt(hash('22'), 90)],
              firstPage: true,
              lastPage: true,
            };
          if (method === 'eth_getLogs') return ++logCalls === 1 ? [incoming] : [];
          if (method === 'eth_getTransactionByHash') return rawTx(hash('11'), 100, OTHER, USDT, 0n);
          if (method === 'eth_getTransactionReceipt')
            return rawReceipt(hash('11'), 100, [incoming]);
          throw new Error(`unexpected rpc call ${method}`);
        },
      });
      const rows = await collectHistory(archive, ADDR, {
        source: 'ots+logs',
        onProgress: (p) => progress.push(p),
      });
      deepStrictEqual(
        rows.map((row) => row.hash),
        [hash('22'), hash('11')]
      );
      deepStrictEqual(
        rows
          .slice()
          .sort(newestFirst)
          .map((row) => row.hash),
        [hash('11'), hash('22')]
      );
      deepStrictEqual(rows[1].tokenTransfers, [
        {
          contract: USDT,
          abi: 'ERC20',
          symbol: 'USDT',
          decimals: 6,
          from: OTHER,
          to: ADDR,
          tokens: new Map([[1n, 5000000n]]),
        },
      ]);
      deepStrictEqual(Object.hasOwn(rows[1], 'partial'), false);
      deepStrictEqual(calls.filter(([method]) => method === 'eth_getTransactionByHash').length, 1);
      deepStrictEqual(calls.filter(([method]) => method === 'eth_getTransactionReceipt').length, 1);
      deepStrictEqual(progress, [
        {
          source: 'ots+logs',
          phase: 'logs',
          percent: 100,
          scannedTxs: 2,
          currentBlock: 100,
        },
      ]);
    });
    should('ots+logs deduplicates log discoveries in favor of the OTS row', async () => {
      const transfer = transferLog(USDT, OTHER, ADDR, 5000000n);
      const calls = [];
      let logCalls = 0;
      const archive = new RpcClient({
        call: async (method, ...args) => {
          calls.push([method, ...args]);
          if (method === 'ots_searchTransactionsBefore')
            return {
              txs: [rawTx(hash('11'), 100, OTHER, ADDR, 0n)],
              receipts: [rawReceipt(hash('11'), 100, [transfer])],
              firstPage: true,
              lastPage: true,
            };
          if (method === 'eth_getLogs') return ++logCalls === 1 ? [transfer] : [];
          throw new Error(`unexpected rpc call ${method}`);
        },
      });
      const rows = await collectHistory(archive, ADDR, { source: 'ots+logs' });
      deepStrictEqual(rows.length, 1);
      deepStrictEqual(rows[0].timestamp, 1700000100);
      deepStrictEqual(rows[0].tokenTransfers[0].tokens, new Map([[1n, 5000000n]]));
      deepStrictEqual(Object.hasOwn(rows[0], 'partial'), false);
      deepStrictEqual(
        calls.filter(
          ([method]) =>
            method === 'eth_getTransactionByHash' || method === 'eth_getTransactionReceipt'
        ),
        []
      );
    });
    should('ots+logs page scopes logs to the OTS page block span', async () => {
      const logRequests = [];
      const archive = new RpcClient({
        call: async (method, ...args) => {
          if (method === 'ots_searchTransactionsBefore')
            return {
              txs: [
                rawTx(hash('11'), 110, OTHER, ADDR, 0n),
                rawTx(hash('22'), 100, OTHER, ADDR, 0n),
              ],
              receipts: [rawReceipt(hash('11'), 110), rawReceipt(hash('22'), 100)],
              firstPage: false,
              lastPage: false,
            };
          if (method === 'eth_getLogs') {
            logRequests.push(args[0]);
            return [];
          }
          throw new Error(`unexpected rpc call ${method}`);
        },
      });
      await collectHistory(archive, ADDR, {
        source: 'ots+logs',
        before: 121,
        pageSize: 2,
      });
      deepStrictEqual(logRequests.length, 7);
      deepStrictEqual(
        logRequests.every((req) => req.fromBlock === '0x64' && req.toBlock === '0x78'),
        true
      );
    });
    should('history is the streaming API and supports abort', async () => {
      const makeProvider = () =>
        new RpcClient({
          call: async (method, ...args) => {
            if (method !== 'ots_searchTransactionsBefore')
              throw new Error(`unexpected rpc call ${method}`);
            deepStrictEqual(args, [ADDR, 0, 25]);
            return {
              txs: [rawTx(hash('11'), 100, OTHER, ADDR, 10n ** 18n)],
              receipts: [rawReceipt(hash('11'), 100)],
              firstPage: true,
              lastPage: true,
            };
          },
        });
      const opts = { source: 'ots' as const };
      const streamed = [];
      for await (const row of history(makeProvider(), ADDR, opts)) streamed.push(row);
      deepStrictEqual(streamed, await collectHistory(makeProvider(), ADDR, opts));
      deepStrictEqual(
        streamed.map((t) => ({ hash: t.hash, timestamp: t.timestamp, block: t.block })),
        [{ hash: hash('11'), timestamp: 1700000100, block: 100 }]
      );
      const ctrl = new AbortController();
      ctrl.abort();
      await rejects(async () => {
        for await (const _ of history(makeProvider(), ADDR, {
          ...opts,
          signal: ctrl.signal,
        }));
      }, /abort/i);
    });
    should('history pages the full OTS history with progress', async () => {
      const calls = [];
      const progress = [];
      const archive = new RpcClient({
        call: async (method, ...args) => {
          calls.push([method, ...args]);
          // progress baseline probe: the oldest activity (block 50)
          if (method === 'ots_searchTransactionsAfter')
            return {
              txs: [rawTx(hash('33'), 50, ADDR, OTHER, 0n)],
              receipts: [rawReceipt(hash('33'), 50)],
              firstPage: true,
              lastPage: true,
            };
          if (method !== 'ots_searchTransactionsBefore')
            throw new Error(`unexpected rpc call ${method}`);
          const [, before] = args;
          if (before === 0)
            return {
              txs: [
                rawTx(hash('11'), 100, OTHER, ADDR, 0n),
                rawTx(hash('22'), 90, OTHER, ADDR, 0n),
              ],
              receipts: [
                rawReceipt(hash('11'), 100, [transferLog(USDT, OTHER, ADDR, 5000000n)]),
                rawReceipt(hash('22'), 90),
              ],
              firstPage: true,
              lastPage: false,
            };
          if (before === 90)
            return {
              txs: [rawTx(hash('33'), 50, ADDR, OTHER, 0n)],
              receipts: [rawReceipt(hash('33'), 50, [transferLog(USDT, ADDR, OTHER, 1000000n)])],
              firstPage: false,
              lastPage: true,
            };
          throw new Error(`unexpected cursor ${before}`);
        },
      });
      const res = await collectHistory(archive, ADDR, {
        source: 'ots',
        depth: 'full',
        onProgress: (p) => progress.push(p),
      });
      deepStrictEqual(
        calls.map((c) => c.slice(0, 3)),
        [
          ['ots_searchTransactionsAfter', ADDR, 0],
          ['ots_searchTransactionsBefore', ADDR, 0],
          ['ots_searchTransactionsBefore', ADDR, 90],
        ]
      );
      deepStrictEqual(
        res.map((t) => ({
          hash: t.hash,
          block: t.block,
          symbol: t.tokenTransfers[0]?.symbol,
          to: t.tokenTransfers[0]?.to,
        })),
        [
          { hash: hash('11'), block: 100, symbol: 'USDT', to: ADDR },
          { hash: hash('22'), block: 90, symbol: undefined, to: undefined },
          { hash: hash('33'), block: 50, symbol: 'USDT', to: OTHER },
        ]
      );
      deepStrictEqual(res[0].timestamp, 1700000100);
      deepStrictEqual(res[0].tokenTransfers[0].tokens, new Map([[1n, 5000000n]]));
      // percent covers the ACTIVE span (blocks 50..100), not blocks 0..100
      deepStrictEqual(progress, [
        { source: 'ots', phase: 'ots', percent: 20, scannedTxs: 2, currentBlock: 90 },
      ]);
    });
    should('ots+logs full-depth progress distinguishes OTS and logs phases', async () => {
      const progress = [];
      const provider = {
        ots_searchAfter: async () => ({
          txs: [normalizedTx(hash('33'), 50, ADDR, OTHER)],
          firstPage: true,
          lastPage: true,
        }),
        ots_searchBefore: async (_address, before) =>
          before === 0
            ? {
                txs: [
                  normalizedTx(hash('11'), 100, OTHER, ADDR),
                  normalizedTx(hash('22'), 90, OTHER, ADDR),
                ],
                firstPage: true,
                lastPage: false,
              }
            : {
                txs: [normalizedTx(hash('33'), 50, ADDR, OTHER)],
                firstPage: false,
                lastPage: true,
              },
        height: async () => 100,
        ethLogs: async () => [],
      };
      await collectHistory(provider, ADDR, {
        source: 'ots+logs',
        depth: 'full',
        fromBlock: 1,
        logsWindow: 50,
        concurrency: 1,
        onProgress: (item) => progress.push(item),
      });
      deepStrictEqual(progress, [
        { source: 'ots+logs', phase: 'ots', percent: 20, scannedTxs: 2, currentBlock: 90 },
        { source: 'ots+logs', phase: 'logs', percent: 50, scannedTxs: 3, currentBlock: 51 },
        { source: 'ots+logs', phase: 'logs', percent: 100, scannedTxs: 3, currentBlock: 1 },
      ]);
    });
    should('history tolerates receipt-less (pending) OTS rows', async () => {
      const archive = new RpcClient({
        call: async (method) => {
          if (method !== 'ots_searchTransactionsBefore')
            throw new Error(`unexpected rpc call ${method}`);
          return {
            // one mined tx with its receipt, one row without any receipt
            txs: [
              rawTx(hash('11'), 100, OTHER, ADDR, 10n ** 18n),
              {
                ...rawTx(hash('22'), 100, OTHER, ADDR, 10n ** 18n),
                blockHash: null,
                blockNumber: null,
              },
            ],
            receipts: [rawReceipt(hash('11'), 100)],
            firstPage: true,
            lastPage: true,
          };
        },
      });
      const res = await collectHistory(archive, ADDR, { source: 'ots' });
      deepStrictEqual(
        res.map((t) => ({ hash: t.hash, block: t.block, reverted: t.reverted, diff: t.diff })),
        [
          { hash: hash('11'), block: 100, reverted: false, diff: 10n ** 18n },
          // no receipt: no block/fee data, but the row survives the scan
          { hash: hash('22'), block: undefined, reverted: false, diff: 10n ** 18n },
        ]
      );
      deepStrictEqual(res[1].info.receipt, undefined);
      deepStrictEqual(res[1].tokenTransfers, []);
    });
    should('history validates options and supports abort', async () => {
      let rpcCalls = 0;
      const archive = new RpcClient({
        call: async (method) => {
          rpcCalls++;
          if (method === 'ots_searchTransactionsBefore')
            return { txs: [], receipts: [], firstPage: true, lastPage: true };
          if (method === 'eth_getLogs') return [];
          throw new Error(`unexpected rpc call ${method}`);
        },
      });
      throws(() => history(archive, ADDR, { pageSize: 0 }), /wrong pageSize/);
      throws(() => history(archive, ADDR, { logsWindow: -1 }), /wrong logsWindow/);
      throws(() => history(archive, ADDR, { concurrency: 0 }), /wrong concurrency/);
      throws(() => history(archive, ADDR, { onProgress: 1 }), /wrong onProgress/);
      throws(() => history(archive, ADDR, { internal: 1 }), /wrong internal/);
      throws(() => history(archive, ADDR, { source: 'bogus' }), /history: wrong source/);
      throws(() => history(archive, 1, {}), /history: wrong address/);
      deepStrictEqual(rpcCalls, 0);
      deepStrictEqual(await collectHistory(archive, ADDR, { source: 'ots+logs' }), []);
      const ctrl = new AbortController();
      ctrl.abort();
      await rejects(() => collectHistory(archive, ADDR, { signal: ctrl.signal }), /abort/i);
    });
    should('auto source combines OTS with logs and memoizes capability probes', async () => {
      const calls = [];
      const archive = new RpcClient({
        call: async (method) => {
          calls.push(method);
          if (method === 'eth_blockNumber') return '0x1';
          if (method === 'trace_filter')
            throw Object.assign(new Error('method not found'), { code: -32601 });
          if (method === 'ots_getApiLevel') return 8;
          if (method === 'ots_searchTransactionsBefore')
            return { txs: [], receipts: [], firstPage: true, lastPage: true };
          if (method === 'eth_getLogs') return [];
          throw new Error(`unexpected rpc call ${method}`);
        },
      });
      await collectHistory(archive, ADDR);
      await collectHistory(archive, ADDR);
      deepStrictEqual(calls.filter((m) => m === 'eth_blockNumber').length, 1);
      deepStrictEqual(calls.filter((m) => m === 'trace_filter').length, 1);
      deepStrictEqual(calls.filter((m) => m === 'ots_getApiLevel').length, 1);
      deepStrictEqual(calls.filter((m) => m === 'ots_searchTransactionsBefore').length, 2);
      deepStrictEqual(calls.filter((m) => m === 'eth_getLogs').length, 14);
    });
    should(
      'logs fallback marks partial rows, limits pages, and deduplicates tx lookups',
      async () => {
        const a = normalizedTransferLog(hash('11'), 100, OTHER, ADDR, 5n);
        const b = normalizedTransferLog(hash('22'), 90, ADDR, OTHER, 2n);
        let logCalls = 0;
        const txCalls = [];
        const provider = {
          capabilities: async () => ({ eth: true, trace: false, ots: false }),
          ethLogs: async () => (++logCalls === 1 ? [a, b] : logCalls === 2 ? [a] : []),
          txInfo: async (h) => {
            txCalls.push(h);
            return h === a.transactionHash
              ? normalizedTx(h, 100, OTHER, ADDR, [a])
              : normalizedTx(h, 90, ADDR, OTHER, [b]);
          },
        };
        const rows = await collectHistory(provider, ADDR, { pageSize: 1 });
        deepStrictEqual(
          rows.map((row) => row.hash),
          [a.transactionHash]
        );
        deepStrictEqual(rows[0].partial, 'tokens-only');
        deepStrictEqual(rows[0].tokenTransfers[0].tokens, new Map([[1n, 5n]]));
        deepStrictEqual(txCalls.sort(), [a.transactionHash, b.transactionHash].sort());
      }
    );
    should('logs source returns all rows at full depth', async () => {
      const a = normalizedTransferLog(hash('11'), 100, OTHER, ADDR, 5n);
      const b = normalizedTransferLog(hash('22'), 90, ADDR, OTHER, 2n);
      let logCalls = 0;
      const provider = {
        height: async () => 100,
        ethLogs: async () => (++logCalls === 1 ? [a, b] : []),
        txInfo: async (h) =>
          h === a.transactionHash
            ? normalizedTx(h, 100, OTHER, ADDR, [a])
            : normalizedTx(h, 90, ADDR, OTHER, [b]),
      };
      const rows = await collectHistory(provider, ADDR, { source: 'logs', depth: 'full' });
      deepStrictEqual(
        rows.map((row) => row.hash),
        [a.transactionHash, b.transactionHash]
      );
      deepStrictEqual(
        rows.every((row) => row.partial === 'tokens-only'),
        true
      );
    });
    should('logs source applies before and block-range bounds', async () => {
      const opts = [];
      const provider = {
        ethLogs: async (_topics, range) => {
          opts.push(range);
          return [];
        },
        txInfo: async () => {
          throw new Error('unexpected tx lookup');
        },
      };
      deepStrictEqual(
        await collectHistory(provider, ADDR, {
          source: 'logs',
          before: 100,
          fromBlock: 10,
          toBlock: 200,
        }),
        []
      );
      deepStrictEqual(opts.length, 7);
      deepStrictEqual(
        opts.every((range) => range.fromBlock === 10 && range.toBlock === 99),
        true
      );
    });
    should('full logs source reports window progress', async () => {
      const a = normalizedTransferLog(hash('11'), 100, OTHER, ADDR, 5n);
      const b = normalizedTransferLog(hash('22'), 90, ADDR, OTHER, 2n);
      let logCalls = 0;
      const progress = [];
      const provider = {
        height: async () => 100,
        ethLogs: async () => (++logCalls === 1 ? [a, b] : []),
        txInfo: async (h) =>
          h === a.transactionHash
            ? normalizedTx(h, 100, OTHER, ADDR, [a])
            : normalizedTx(h, 90, ADDR, OTHER, [b]),
      };
      await collectHistory(provider, ADDR, {
        source: 'logs',
        depth: 'full',
        onProgress: (p) => progress.push(p),
      });
      deepStrictEqual(progress, [
        { source: 'logs', phase: 'logs', percent: 100, scannedTxs: 2, currentBlock: 0 },
      ]);
    });
    should('conforms to the windowed history vector and stops prefetch on early exit', async () => {
      const vector = await historyJsonVector('history-windowed');
      const progress = [];
      const full = historyVectorProvider(vector);
      const rows = await collectHistory(full.provider, vector.input.address, {
        ...vector.input.opts,
        onProgress: (item) => progress.push(item),
      });
      deepStrictEqual(rows.map(comparableHistoryRow), vector.expected.rows);
      deepStrictEqual(progress, vector.expected.progress);

      const logCalls = full.calls.filter(([method]) => method === 'eth_getLogs');
      const expectedRanges = vector.expected.windows.flatMap((window) =>
        Array.from({ length: vector.expected.calls.eth_getLogs.perWindow }, () => ({
          fromBlock: window.fromBlock,
          toBlock: window.toBlock,
        }))
      );
      deepStrictEqual(
        logCalls.map(([, req]) => ({
          fromBlock: Number(req.fromBlock),
          toBlock: Number(req.toBlock),
        })),
        expectedRanges
      );
      for (const [method, expected] of [
        ['eth_blockNumber', vector.expected.calls.eth_blockNumber],
        ['eth_getLogs', vector.expected.calls.eth_getLogs.total],
        ['eth_getTransactionByHash', vector.expected.calls.eth_getTransactionByHash.total],
        ['eth_getTransactionReceipt', vector.expected.calls.eth_getTransactionReceipt.total],
      ])
        deepStrictEqual(full.calls.filter(([called]) => called === method).length, expected);

      const early = historyVectorProvider(vector);
      for await (const _ of history(early.provider, vector.input.address, {
        ...vector.input.opts,
        onProgress: undefined,
      }))
        break;
      await new Promise((resolve) => setTimeout(resolve, 5));
      const earlyLogs = early.calls.filter(([method]) => method === 'eth_getLogs');
      deepStrictEqual(earlyLogs.length <= vector.expected.earlyExit.maxGetLogsCalls, true);
      deepStrictEqual(
        earlyLogs.some(([, req]) => Number(req.fromBlock) === vector.expected.windows[2].fromBlock),
        false
      );
    });
    should(
      'yields prefetched windows in order even when an older window resolves first',
      async () => {
        const newer = normalizedTransferLog(hash('11'), 3, OTHER, ADDR, 5n);
        const older = normalizedTransferLog(hash('22'), 1, OTHER, ADDR, 2n);
        const txLookups = [];
        const ranges = [];
        const provider = {
          height: async () => 3,
          ethLogs: async (topics, range) => {
            ranges.push(range);
            if (range.fromBlock === 2) await new Promise((resolve) => setTimeout(resolve, 5));
            const incoming = topics[0] === TRANSFER_TOPIC && topics[2] === encodeAddress(ADDR);
            if (!incoming) return [];
            return range.fromBlock === 2 ? [newer] : [older];
          },
          txInfo: async (txHash) => {
            txLookups.push(txHash);
            return txHash === newer.transactionHash
              ? normalizedTx(txHash, 3, OTHER, ADDR, [newer])
              : normalizedTx(txHash, 1, OTHER, ADDR, [older]);
          },
        };
        const rows = await collectHistory(provider, ADDR, {
          source: 'logs',
          depth: 'full',
          logsWindow: 2,
          concurrency: 2,
        });
        deepStrictEqual(txLookups[0], older.transactionHash);
        deepStrictEqual(
          rows.map((row) => row.hash),
          [newer.transactionHash, older.transactionHash]
        );
        deepStrictEqual(
          ranges.slice(0, 14).map((range) => [range.fromBlock, range.toBlock]),
          [...Array(7).fill([2, 3]), ...Array(7).fill([0, 1])]
        );
      }
    );
    should('logsWindow zero keeps one unbounded full-depth logs query', async () => {
      const ranges = [];
      const progress = [];
      const provider = {
        ethLogs: async (_topics, range) => {
          ranges.push(range);
          return [];
        },
        txInfo: async () => {
          throw new Error('unexpected tx lookup');
        },
      };
      deepStrictEqual(
        await collectHistory(provider, ADDR, {
          source: 'logs',
          depth: 'full',
          logsWindow: 0,
          onProgress: (item) => progress.push(item),
        }),
        []
      );
      deepStrictEqual(ranges, Array(7).fill({ fromBlock: undefined, toBlock: undefined }));
      deepStrictEqual(progress, [
        { source: 'logs', phase: 'logs', percent: 100, scannedTxs: 0, currentBlock: 0 },
      ]);
    });
    should('OTS internal enrichment normalizes values and excludes top-level calls', async () => {
      const archive = new RpcClient({
        call: async (method) => {
          if (method === 'eth_blockNumber') return '0x1';
          if (method === 'trace_filter') return [];
          if (method === 'ots_getApiLevel') return 8;
          if (method === 'ots_searchTransactionsBefore')
            return {
              txs: [rawTx(hash('11'), 100, OTHER, ADDR, 0n)],
              receipts: [rawReceipt(hash('11'), 100)],
              firstPage: true,
              lastPage: true,
            };
          if (method === 'ots_traceTransaction')
            return [
              { type: 'CALL', depth: '0x0', from: OTHER, to: ADDR, value: '0x5' },
              { type: 'CALL', depth: '0x1', from: OTHER, to: ADDR, value: '0x2' },
              { type: 'CALL', depth: '0x2', from: OTHER, to: ADDR, value: '0x0' },
            ];
          throw new Error(`unexpected rpc call ${method}`);
        },
      });
      const rows = await collectHistory(archive, ADDR, { source: 'ots', internal: true });
      deepStrictEqual(rows[0].internal, [{ from: OTHER, to: ADDR, value: 2n }]);
    });
    should('trace_transaction enriches logs-discovered rows per transaction', async () => {
      const log = normalizedTransferLog(hash('11'), 100, OTHER, ADDR, 5n);
      let logCalls = 0;
      const provider = {
        capabilities: async () => ({ eth: true, trace: true, ots: false }),
        ethLogs: async () => (++logCalls === 1 ? [log] : []),
        txInfo: async () => normalizedTx(log.transactionHash, 100, OTHER, ADDR, [log]),
        call: async (method) => {
          deepStrictEqual(method, 'trace_transaction');
          return [
            { traceAddress: [], action: { from: OTHER, to: ADDR, value: '0x5' } },
            { traceAddress: [0], action: { from: OTHER, to: ADDR, value: '0x3' } },
            { traceAddress: [1], action: { from: OTHER, to: ADDR, value: '0x0' } },
          ];
        },
      };
      const rows = await collectHistory(provider, ADDR, {
        source: 'logs',
        internal: true,
      });
      deepStrictEqual(rows[0].internal, [{ from: OTHER, to: ADDR, value: 3n }]);
    });
    should('unsupported internal enrichment surfaces the capability gap', async () => {
      const log = normalizedTransferLog(hash('11'), 100, OTHER, ADDR, 5n);
      let logCalls = 0;
      const provider = {
        capabilities: async () => ({ eth: true, trace: false, ots: false }),
        ethLogs: async () => (++logCalls === 1 ? [log] : []),
        txInfo: async () => normalizedTx(log.transactionHash, 100, OTHER, ADDR, [log]),
        call: async () => {
          throw Object.assign(new Error('method not found'), { code: -32601 });
        },
      };
      await rejects(
        () => collectHistory(provider, ADDR, { source: 'logs', internal: true }),
        (error) =>
          error instanceof Web3Error &&
          error.method === 'trace_transaction' &&
          /internal history enrichment/.test(error.message)
      );
    });
    should('abort during internal enrichment rejects before yielding a row', async () => {
      const ctrl = new AbortController();
      const archive = new RpcClient({
        call: async (method) => {
          if (method === 'eth_blockNumber') return '0x1';
          if (method === 'trace_filter') return [];
          if (method === 'ots_getApiLevel') return 8;
          if (method === 'ots_searchTransactionsBefore')
            return {
              txs: [rawTx(hash('11'), 100, OTHER, ADDR, 0n)],
              receipts: [rawReceipt(hash('11'), 100)],
              firstPage: true,
              lastPage: true,
            };
          if (method === 'ots_traceTransaction') {
            ctrl.abort(new Error('stopped during trace'));
            return [];
          }
          throw new Error(`unexpected rpc call ${method}`);
        },
      });
      await rejects(
        () =>
          collectHistory(archive, ADDR, { source: 'ots', internal: true, signal: ctrl.signal }),
        /stopped during trace/
      );
    });
    should('full OTS history stops after crossing fromBlock', async () => {
      let searches = 0;
      const archive = new RpcClient({
        call: async (method) => {
          if (method !== 'ots_searchTransactionsBefore')
            throw new Error(`unexpected rpc call ${method}`);
          searches++;
          return {
            txs: [rawTx(hash('11'), 100, OTHER, ADDR, 0n), rawTx(hash('22'), 80, OTHER, ADDR, 0n)],
            receipts: [rawReceipt(hash('11'), 100), rawReceipt(hash('22'), 80)],
            firstPage: true,
            lastPage: false,
          };
        },
      });
      const rows = await collectHistory(archive, ADDR, {
        source: 'ots',
        depth: 'full',
        fromBlock: 90,
      });
      deepStrictEqual(
        rows.map((row) => row.hash),
        [hash('11')]
      );
      deepStrictEqual(searches, 1);
    });
    should('full OTS history deduplicates overlapping pages and trace requests', async () => {
      let searches = 0;
      let traces = 0;
      const archive = new RpcClient({
        call: async (method) => {
          if (method === 'eth_blockNumber') return '0x1';
          if (method === 'trace_filter') return [];
          if (method === 'ots_getApiLevel') return 8;
          if (method === 'ots_traceTransaction') {
            traces++;
            return [{ type: 'CALL', depth: 1, from: OTHER, to: ADDR, value: '0x1' }];
          }
          if (method === 'ots_searchTransactionsBefore') {
            searches++;
            const block = searches === 1 ? 100 : 90;
            return {
              txs: [rawTx(hash('11'), block, OTHER, ADDR, 0n)],
              receipts: [rawReceipt(hash('11'), block)],
              firstPage: searches === 1,
              lastPage: searches === 2,
            };
          }
          throw new Error(`unexpected rpc call ${method}`);
        },
      });
      const rows = await collectHistory(archive, ADDR, {
        source: 'ots',
        depth: 'full',
        internal: true,
      });
      deepStrictEqual(rows.length, 1);
      deepStrictEqual(searches, 2);
      deepStrictEqual(traces, 1);
    });
    should('offline receipt decoding skips malformed ERC1155 batches', () => {
      const contract = '0x0000000000000000000000000000000000000001';
      const batch = events(ERC1155).TransferBatch;
      const log = {
        address: contract,
        topics: batch.topics({
          operator: ADDR,
          from: ADDR,
          to: OTHER,
          ids: null,
          values: null,
        }),
        data: `0x${word(64n)}${word(160n)}${word(2n)}${word(7n)}${word(8n)}${word(1n)}${word(9n)}`,
        blockNumber: 1,
        transactionHash: hash('11'),
        transactionIndex: 0,
        blockHash: hash('bb'),
        logIndex: 0,
        removed: false,
      };
      deepStrictEqual(
        decodeReceiptTokenTransfers({ logs: [log] }, ADDR, {
          [contract]: { abi: 'ERC1155' },
        }),
        []
      );
    });
    should('tokenTransferFromCalldata decodes pending transfer calldata', () => {
      const value = encodeWords(174361755n).slice(2);
      const transfer = `0xa9059cbb${encodeAddress(OTHER).slice(2)}${value}`;
      deepStrictEqual(tokenTransferFromCalldata({ to: USDT, input: transfer, from: ADDR }), {
        contract: USDT,
        abi: 'ERC20',
        symbol: 'USDT',
        decimals: 6,
        from: ADDR,
        to: OTHER,
        tokens: new Map([[1n, 174361755n]]),
      });
      // transferFrom carries the source in calldata
      const transferFrom = `0x23b872dd${encodeAddress(ADDR).slice(2)}${encodeAddress(OTHER).slice(2)}${value}`;
      deepStrictEqual(tokenTransferFromCalldata({ to: USDT, input: transferFrom, from: OTHER }), {
        contract: USDT,
        abi: 'ERC20',
        symbol: 'USDT',
        decimals: 6,
        from: ADDR,
        to: OTHER,
        tokens: new Map([[1n, 174361755n]]),
      });
      // anything else: unknown contract, non-transfer method, empty or bad calldata
      deepStrictEqual(tokenTransferFromCalldata({ to: OTHER, input: transfer }), undefined);
      const approve = `0x095ea7b3${encodeAddress(OTHER).slice(2)}${value}`;
      deepStrictEqual(tokenTransferFromCalldata({ to: USDT, input: approve }), undefined);
      deepStrictEqual(tokenTransferFromCalldata({ to: USDT, input: '0x' }), undefined);
      deepStrictEqual(tokenTransferFromCalldata({ to: USDT, input: '0x12345678' }), undefined);
      throws(() => tokenTransferFromCalldata(null), /wrong tx/);
    });
  });

  describe('enrich', () => {
    const ME = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
    const OTHER = '0xab7a253380d839656a542659ec2ee638f16d8a7b';
    const USDT = tokenFromSymbol('USDT').contract;
    const UNKNOWN = '0x00000000000000000000000000000000000beef1';
    const TX_HASH = `0x${'11'.repeat(32)}`;
    const erc20Topic = events(ERC20).Transfer.topics({ from: null, to: null, value: null })[0];
    const erc1155Topic = events(ERC1155).TransferSingle.topics({
      operator: null,
      from: null,
      to: null,
      id: null,
      value: null,
    })[0];
    const topicAddress = (address) => `0x${'0'.repeat(24)}${address.toLowerCase().slice(2)}`;
    const erc20Log = (contract, from, to, value) => ({
      address: contract,
      topics: [erc20Topic, topicAddress(from), topicAddress(to)],
      data: encodeWords(value),
    });
    const encodeString = (s) => {
      const hex = Buffer.from(s, 'utf8').toString('hex');
      return `0x${word(32)}${word(s.length)}${hex.padEnd(64, '0')}`;
    };
    // enough TxInfo/TxReceipt for enrichment; tests never hit the network for it
    const transferTx = (logs) => ({
      info: {
        hash: TX_HASH,
        from: OTHER,
        to: USDT,
        value: 0n,
        input: `0xa9059cbb${word(BigInt(ME))}${word(1_500_000n)}`,
        nonce: 1n,
        gas: 60000n,
        chainId: 1n,
        blockNumber: 100,
        transactionIndex: 0,
      },
      receipt: {
        transactionHash: TX_HASH,
        blockNumber: 100,
        status: 1,
        gasUsed: 21000n,
        effectiveGasPrice: 5n,
        timestamp: 1700000000,
        logs,
      },
    });
    const offlineProv = () =>
      new RpcClient({
        call: async (method) => {
          throw new Error(`unexpected network call: ${method}`);
        },
      });
    const tokenMetaProv = (meta, counters = {}) =>
      new RpcClient({
        call: async (method, ...args) => {
          if (method === 'eth_getCode') {
            counters.getCode = (counters.getCode || 0) + 1;
            return '0x6001';
          }
          if (method === 'eth_call') {
            const selector = args[0].data.slice(0, 10);
            if (selector === '0x01ffc9a7') return encodeWords(0n); // supportsInterface
            if (selector === '0x06fdde03') return encodeString(meta.name);
            if (selector === '0x95d89b41') return encodeString(meta.symbol);
            if (selector === '0x313ce567') return encodeWords(BigInt(meta.decimals));
            if (selector === '0x18160ddd') return encodeWords(meta.totalSupply);
          }
          throw new Error(`unexpected call: ${method}`);
        },
      });

    should('detectTokenContracts classifies transfer-shaped logs', () => {
      const nft = '0x00000000000000000000000000000000000beef2';
      const game = '0x00000000000000000000000000000000000beef3';
      const logs = [
        erc20Log(UNKNOWN, OTHER, ME, 5n),
        {
          address: nft,
          topics: [erc20Topic, topicAddress(OTHER), topicAddress(ME), word(7n)],
          data: '0x',
        },
        {
          address: game,
          topics: [erc1155Topic, topicAddress(OTHER), topicAddress(OTHER), topicAddress(ME)],
          data: encodeWords(5n, 3n),
        },
        { address: UNKNOWN, topics: [`0x${'ff'.repeat(32)}`], data: '0x' }, // not a transfer
      ];
      deepStrictEqual(
        detectTokenContracts(logs),
        new Map([
          [UNKNOWN, 'ERC20'],
          [nft, 'ERC721'],
          [game, 'ERC1155'],
        ])
      );
      // participation filter: OTHER-only logs are dropped for ME
      deepStrictEqual(
        detectTokenContracts([erc20Log(UNKNOWN, OTHER, OTHER, 5n)], ME),
        new Map()
      );
      deepStrictEqual(
        detectTokenContracts([erc20Log(UNKNOWN, OTHER, ME, 5n)], ME),
        new Map([[UNKNOWN, 'ERC20']])
      );
      deepStrictEqual(detectTokenContracts(undefined), new Map());
      throws(() => detectTokenContracts([], 123), /wrong address/);
    });

    should('tokenInfos pools, dedupes and never rejects', async () => {
      let getCode = 0;
      const prov = new RpcClient({
        call: async (method) => {
          if (method === 'eth_getCode') {
            getCode++;
            return '0x'; // not a contract -> TokenError for every probe
          }
          throw new Error('nope');
        },
      });
      const res = await tokenInfos(prov, [UNKNOWN, UNKNOWN.toUpperCase().replace('0X', '0x')]);
      deepStrictEqual(getCode, 1); // deduped by lowercased contract
      deepStrictEqual(res, { [UNKNOWN]: { contract: UNKNOWN, error: 'not contract or destructed' } });
      await rejects(() => tokenInfos(prov, [], { concurrency: 0 }), /wrong concurrency/);
    });

    should('nftHoldings verifies ownership on-chain', async () => {
      const nft = '0x00000000000000000000000000000000000beef2';
      const game = '0x00000000000000000000000000000000000beef3';
      const prov = new RpcClient({
        call: async (method, ...args) => {
          if (method !== 'eth_call') throw new Error('nope');
          const data = args[0].data;
          const selector = data.slice(0, 10);
          if (selector === '0x70a08231') return encodeWords(1n); // balanceOf(owner)
          if (selector === '0x6352211e') {
            // ownerOf: id 1 still ours, id 2 sold
            return BigInt(`0x${data.slice(10)}`) === 1n
              ? encodeAddress(ME)
              : encodeAddress(OTHER);
          }
          if (selector === '0x4e1273f4') return encodeWords(32n, 2n, 3n, 0n); // balanceOfBatch
          throw new Error(`unexpected selector ${selector}`);
        },
      });
      const holdings = await nftHoldings(prov, ME, [
        { contract: nft, abi: 'ERC721', tokens: new Map([[1n, 1n], [2n, 1n]]) },
        { contract: game, abi: 'ERC1155', tokens: new Map([[5n, 3n], [6n, 1n]]) },
        { contract: USDT, abi: 'ERC20', tokens: new Map([[1n, 10n]]) }, // ignored
      ]);
      deepStrictEqual(holdings, {
        [nft]: new Map([[1n, 1n]]),
        [game]: new Map([[5n, 3n]]),
      });
      await rejects(() => nftHoldings(prov, 123, []), /wrong address/);
    });

    should('nftCandidates bridges history rows to nftHoldings', () => {
      const nft = '0x00000000000000000000000000000000000BEEF2'; // mixed casing folds
      const game = '0x00000000000000000000000000000000000beef3';
      const rows = [
        {
          tokenTransfers: [
            { contract: USDT, abi: 'ERC20', symbol: 'USDT', from: OTHER, to: ME, tokens: new Map([[1n, 5n]]) },
            { contract: nft, abi: 'ERC721', from: OTHER, to: ME, tokens: new Map([[7n, 1n]]) },
          ],
        },
        {
          tokenTransfers: [
            // first symbol seen wins; its provenance flag travels along
            { contract: nft.toLowerCase(), abi: 'ERC721', symbol: 'PUNK', verified: false, from: ME, to: OTHER, tokens: new Map([[9n, 1n]]) },
            { contract: game, abi: 'ERC1155', symbol: 'GAME', to: ME, tokens: new Map([[5n, 3n]]) },
          ],
        },
      ];
      deepStrictEqual(nftCandidates(rows), [
        {
          contract: nft.toLowerCase(),
          abi: 'ERC721',
          symbol: 'PUNK',
          verified: false,
          tokens: new Map([[7n, 1n], [9n, 1n]]),
        },
        // token values are placeholders (1n): amounts come from nftHoldings
        { contract: game, abi: 'ERC1155', symbol: 'GAME', tokens: new Map([[5n, 1n]]) },
      ]);
      deepStrictEqual(nftCandidates([]), []);
      throws(() => nftCandidates([{}]), /wrong rows/);
    });

    should('tokenURI substitutes the ERC-1155 {id} template', async () => {
      const game = '0x00000000000000000000000000000000000beef3';
      const prov = new RpcClient({
        call: async (method, ...args) => {
          if (method !== 'eth_call') throw new Error('nope');
          deepStrictEqual(args[0].data.slice(0, 10), '0x0e89341c'); // uri(uint256)
          return encodeString('ipfs://meta/{id}.json');
        },
      });
      // 64 hex chars, zero-padded, lowercase, no 0x — per the metadata spec
      deepStrictEqual(
        await tokenURI(prov, { contract: game, abi: 'ERC1155' }, 0xabn),
        `ipfs://meta/${'ab'.padStart(64, '0')}.json`
      );
    });

    should('ipfsToHttp and nftMetadata sanitize external data', () => {
      deepStrictEqual(ipfsToHttp('ipfs://Qm1/1.png'), 'https://ipfs.io/ipfs/Qm1/1.png');
      deepStrictEqual(ipfsToHttp('ipfs://ipfs/Qm1'), 'https://ipfs.io/ipfs/Qm1'); // legacy form
      deepStrictEqual(ipfsToHttp('https://x/y.png'), 'https://x/y.png'); // passthrough
      deepStrictEqual(ipfsToHttp('ipfs://Qm1', 'https://gw.example/base'), 'https://gw.example/base/Qm1');
      throws(() => ipfsToHttp(1), /wrong uri/);
      deepStrictEqual(
        nftMetadata({
          name: 'Cat #1',
          description: 'meow',
          image_url: 'ipfs://Qm2',
          animation_url: 'javascript:alert(1)', // dropped: not http(s)/ipfs
          external_url: 'https://cats.example',
        }),
        { name: 'Cat #1', description: 'meow', image: 'ipfs://Qm2', externalUrl: 'https://cats.example' }
      );
      deepStrictEqual(nftMetadata({ image: 'data:text/html,x', name: 42 }), {});
      deepStrictEqual(nftMetadata('nope'), {});
      deepStrictEqual(
        nftMetadata({ image: 'https://a/1.png', image_url: 'https://b/2.png' }).image,
        'https://a/1.png' // image wins over the image_url alias
      );
    });

    should('rowCodec round-trips bigint/Map and drops functions', () => {
      const row = {
        diff: -123n,
        tokens: new Map([[1n, 1_500_000n]]),
        nested: [{ m: new Map([['k', 2n]]) }],
        clearSig: () => {},
        hash: TX_HASH,
        missing: null,
      };
      const decoded = rowCodec.decode(rowCodec.encode(row));
      deepStrictEqual(decoded, {
        diff: -123n,
        tokens: new Map([[1n, 1_500_000n]]),
        nested: [{ m: new Map([['k', 2n]]) }],
        hash: TX_HASH,
        missing: null,
      });
    });

    should('enrichTx: perspective, offline clear-signing, zero RPC', async () => {
      const tx = transferTx([
        erc20Log(USDT, OTHER, ME, 1_500_000n),
        erc20Log(USDT, OTHER, OTHER, 7n), // third-party movement
      ]);
      const row = await enrichTx(offlineProv(), tx, { address: ME });
      deepStrictEqual(row.hash, TX_HASH);
      deepStrictEqual(row.timestamp, 1700000000);
      deepStrictEqual(row.reverted, false);
      deepStrictEqual(row.diff, 0n); // ME is not an ETH-level participant
      deepStrictEqual(row.tokenTransfers.length, 1);
      deepStrictEqual(row.tokenTransfers[0].tokens, new Map([[1n, 1_500_000n]]));
      deepStrictEqual(row.tokenTransfers[0].symbol, 'USDT');
      // registry-sourced metadata carries no verified flag
      deepStrictEqual('verified' in row.tokenTransfers[0], false);
      deepStrictEqual(row.allTokenTransfers.length, 2);
      deepStrictEqual(row.method, 'transfer(address,uint256)');
      deepStrictEqual(typeof row.intent, 'string');
      deepStrictEqual(row.intent.length > 0, true);
      deepStrictEqual(typeof row.clearSig, 'function');
      // no perspective: all movements, zero diff
      const neutral = await enrichTx(offlineProv(), tx);
      deepStrictEqual(neutral.tokenTransfers.length, 2);
      // rows survive caching round-trips
      const revived = rowCodec.decode(rowCodec.encode(row));
      deepStrictEqual(revived.tokenTransfers, row.tokenTransfers);
      deepStrictEqual(revived.clearSig, undefined);
      await rejects(() => enrichTx(offlineProv(), null), /wrong tx/);
      await rejects(() => enrichTx(offlineProv(), tx, { clearSig: 'nope' }), /wrong clearSig/);
    });

    should('enrichTx: discovers unknown tokens once per cache', async () => {
      const counters = {};
      const prov = tokenMetaProv(
        { name: 'Mock', symbol: 'MCK', decimals: 18, totalSupply: 1000n },
        counters
      );
      const discovered = [];
      const cache = new Map();
      const tx = transferTx([erc20Log(UNKNOWN, OTHER, ME, 5n)]);
      const row = await enrichTx(prov, tx, {
        address: ME,
        cache,
        onToken: (token) => discovered.push(token),
      });
      deepStrictEqual(row.tokenTransfers.length, 1);
      deepStrictEqual(row.tokenTransfers[0].symbol, 'MCK');
      deepStrictEqual(row.tokenTransfers[0].decimals, 18);
      // discovered (on-chain, attacker-controlled) metadata is marked unverified
      deepStrictEqual(row.tokenTransfers[0].verified, false);
      deepStrictEqual(discovered.length, 1);
      deepStrictEqual(discovered[0].abi, 'ERC20');
      deepStrictEqual(counters.getCode, 1);
      // shared cache: the second enrichment probes nothing
      await enrichTx(prov, tx, { address: ME, cache });
      deepStrictEqual(counters.getCode, 1);
      // discovery off: unknown contracts stay undecoded
      const blind = await enrichTx(offlineProv(), tx, { address: ME, discover: false });
      deepStrictEqual(blind.tokenTransfers.length, 0);
    });

    should('nft-heavy address: replayed discovery, holdings, enrichTx', async () => {
      // Real node responses captured for 0xed216b…c60a41: full history from
      // block 0 (single un-windowed logs pass, pinned toBlock so no height()
      // call). The call sequence must stay in sync with the capture script,
      // test/misc/capture-nft-fixture.mjs.
      const replay = await rpcJsonVector('nft-address');
      deepStrictEqual(Object.keys(replay).length, 592);
      const prov = initProv(replay);
      const NFT_ADDR = '0xed216b45b6e66847aaa891e5be124e0ab2c60a41';
      const discovered = [];
      const rows = [];
      for await (const row of history(prov, NFT_ADDR, {
        source: 'logs',
        depth: 'full',
        discover: true,
        logsWindow: 0,
        fromBlock: 0,
        toBlock: 25500000,
        onToken: (token) => discovered.push(token),
      }))
        rows.push(row);
      deepStrictEqual(rows.length, 52);
      // every unknown contract was probed exactly once and decoded; the last
      // one (ENS registrar) is ERC-721 without metadata, so no symbol
      deepStrictEqual(
        discovered.map((t) => `${t.symbol || t.contract}:${t.abi}`),
        [
          'MM:ERC20',
          'BAKC:ERC721',
          'AZUKI:ERC721',
          'BAYC:ERC721',
          'ELEM:ERC721',
          'DOODLE:ERC721',
          'Captainz:ERC721',
          'MAYC:ERC721',
          'MOONBIRD:ERC721',
          'Ͼ721:ERC721',
          'MFER:ERC721',
          'PPG:ERC721',
          'SAPS:ERC721',
          'GHOST:ERC721',
          'COOL:ERC721',
          '⚇:ERC721',
          'NKMGS:ERC721',
          'OTHR:ERC721',
          'WOW:ERC721',
          'KONGZ:ERC721',
          'LP:ERC721',
          'CloneX:ERC721',
          'BEANZ:ERC721',
          'Potatoz:ERC721',
          'DEGODS:ERC721',
          'MIL:ERC721',
          '0N1:ERC721',
          'NOBODY:ERC721',
          'TinFun:ERC721',
          'ES:ERC721',
          'y00t:ERC721',
          'JeerGirl:ERC721',
          '0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85:ERC721',
        ]
      );
      const transfers = rows.flatMap((row) => row.tokenTransfers);
      deepStrictEqual(transfers.length, 1782);
      deepStrictEqual(new Set(transfers.map((t) => t.abi)), new Set(['ERC20', 'ERC721']));
      // everything here was discovered on-chain, so nothing is verified
      deepStrictEqual(
        transfers.every((t) => t.verified === false),
        true
      );
      deepStrictEqual(
        transfers
          .filter((t) => t.abi === 'ERC721')
          .every((t) => [...t.tokens.values()].every((v) => v === 1n)),
        true
      );
      deepStrictEqual(
        rows.every((row) => row.allTokenTransfers.length >= row.tokenTransfers.length),
        true
      );

      // history is discovery, ownerOf is truth: random NFTs via seeded shuffle
      const pickRandomNfts = (count) => {
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
          ((seed ^= seed << 13),
          (seed ^= seed >>> 17),
          (seed ^= seed << 5),
          (seed >>> 0) / 2 ** 32);
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
      const candidates = pickRandomNfts(12);
      const holdings = await nftHoldings(prov, NFT_ADDR, candidates.values(), { concurrency: 1 });
      // the address still holds all 12 randomly chosen tokens
      deepStrictEqual(holdings, {
        '0x5af0d9827e0c53e4799bb226655a1de152a425a5': new Map([[5554n, 1n]]),
        '0x916fe24bb07049922f78a82f8872fe845900ffd8': new Map([
          [2298n, 1n],
          [2380n, 1n],
          [1232n, 1n],
          [1748n, 1n],
          [2255n, 1n],
          [2042n, 1n],
        ]),
        '0xfd1b0b0dfa524e1fd42e7d51155a663c581bbd50': new Map([[1696n, 1n]]),
        '0xc274a97f1691ef390f662067e95a6eff1f99b504': new Map([[9754n, 1n]]),
        '0x39ee2c7b3cb80254225884ca001f57118c8f21b6': new Map([[9492n, 1n]]),
        '0xa28d6a8eb65a41f3958f1de62cbfca20b817e66a': new Map([[9915n, 1n]]),
        '0x3fd36d72f05fb1af76ee7ce9257ca850faba91ed': new Map([[1404n, 1n]]),
      });

      // enrichTx over a row already in hand: no refetch of tx data
      const detail = await enrichTx(prov, rows[0].info, {
        address: NFT_ADDR,
        clearSig: 'resolve',
      });
      deepStrictEqual(detail.method, '0x67243482'); // unknown selector falls back
      deepStrictEqual(detail.tokenTransfers.length, 1);
      deepStrictEqual(detail.hash, rows[0].hash);
      // rows survive a caching round-trip
      const revived = rowCodec.decode(rowCodec.encode(rows));
      deepStrictEqual(revived.length, rows.length);
      deepStrictEqual(revived[0].tokenTransfers, rows[0].tokenTransfers);

      // order 'oldest' over the same fixture: a fresh provider restarts the
      // jsonrpc id sequence, and a single window issues identical requests —
      // only the yield direction differs (exact reverse; unique block/index).
      const prov2 = initProv(replay);
      const oldestRows = [];
      for await (const row of history(prov2, NFT_ADDR, {
        source: 'logs',
        depth: 'full',
        order: 'oldest',
        discover: false,
        logsWindow: 0,
        fromBlock: 0,
        toBlock: 25500000,
      }))
        oldestRows.push(row);
      deepStrictEqual(
        oldestRows.map((row) => row.hash),
        rows.map((row) => row.hash).reverse()
      );
    });
  });
});

should.runWhen(import.meta.url);
