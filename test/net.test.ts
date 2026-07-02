import { describe, should } from '@paulmillr/jsbt/test.js';
import * as mftch from 'micro-ftch';
import { readFile } from 'node:fs/promises';
import { deepStrictEqual, rejects, throws } from 'node:assert';
import { ERC1155, ERC20, events, tokenFromSymbol } from '../src/advanced/abi.ts';
import { Transaction } from '../src/index.ts';
import {
  calcTransfersDiff,
  Chainlink,
  ChainlinkQuoter,
  ENS,
  ERC4626Quoter,
  UniswapV2Quoter,
  UniswapV3,
  UniswapV3Quoter,
  Web3Provider,
} from '../src/net.ts';
import { QUOTER_TOKENS } from '../src/net.ts';
import { awaitDeep, UniswapAbstract } from '../src/net/uniswap-common.ts';
import { ethHexNum, numberTo0xHex, weieth } from '../src/utils.ts';

// These real network responses from real nodes, captured by replayable
const NODE_URL = 'https://NODE_URL/';
const getKey = (url, opt) => JSON.stringify({ url: NODE_URL, opt });
const rpcVector = async (name) => (await import(`./vectors/rpc/${name}.js`)).default;
const rpcJsonVector = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/rpc/${name}.json`, import.meta.url), 'utf8'));
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const encodeWords = (...words) => `0x${words.map(word).join('')}`;
const encodeAddress = (address) => `0x${'0'.repeat(24)}${address.toLowerCase().slice(2)}`;

function initProv(replayJson) {
  const replay = mftch.replayable(fetch, replayJson, { getKey, offline: true });
  const provider = mftch.jsonrpc(replay, NODE_URL);
  const archive = new Web3Provider(provider);
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
    const ens = new ENS(initProv(await rpcVector('ens')));
    const vitalikAddr = await ens.nameToAddress('vitalik.eth');
    const vitalikName = await ens.addressToName(vitalikAddr);
    deepStrictEqual(vitalikAddr, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
    deepStrictEqual(vitalikName, 'vitalik.eth');
  });
  should('ChainlinkQuoter', async () => {
    deepStrictEqual(Chainlink, ChainlinkQuoter);
    const chainlink = new ChainlinkQuoter(initProv(await rpcVector('chainlink')));
    const btcPrice = await chainlink.coinPrice('BTC');
    deepStrictEqual(btcPrice, 69369.10271);
  });
  should('README asset price quoting example uses captured RPC output', async () => {
    const replay = await rpcJsonVector('quoter-readme');
    deepStrictEqual(Object.keys(replay).length, 10);
    const prov = initProv(replay);
    const chainlink = new ChainlinkQuoter(prov);
    const btc = await chainlink.coinPrice('BTC');
    const bat = await chainlink.tokenPrice('BAT');

    const WETH = tokenFromSymbol('WETH')!.contract;
    const USDC = tokenFromSymbol('USDC')!.contract;
    const v2 = await UniswapV2Quoter.fromTokens(prov, WETH, USDC);
    const v3 = await UniswapV3Quoter.fromTokens(prov, WETH, USDC, 3000);
    const ethV2 = await v2.coinPrice('ETH');
    const ethV3 = await v3.coinPrice('ETH');

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
  should('quoter token metadata uses canonical token addresses', () => {
    const canonical = {};
    for (const symbol in QUOTER_TOKENS) {
      try {
        canonical[symbol] = tokenFromSymbol(symbol)!.contract;
      } catch {}
    }
    deepStrictEqual(
      Object.fromEntries(
        Object.entries(canonical).map(([symbol]) => [symbol, QUOTER_TOKENS[symbol].tokenContract])
      ),
      canonical
    );
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
    const archive = new Web3Provider({
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
  should('quotes Uniswap V2 spot rates', async () => {
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const pair = '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc';
    const reserves = encodeWords(2_000_000_000n, 1_000_000_000_000_000_000n, 0n);
    const { calls, provider } = mockEthCallProvider([
      encodeAddress(USDC),
      encodeAddress(WETH),
      reserves,
      reserves,
      reserves,
    ]);
    const quoter = await UniswapV2Quoter.fromPair(provider, pair, { tag: 24692474 });
    deepStrictEqual(quoter.identity(), `uniswap_v2:${pair}`);
    deepStrictEqual(quoter.tokens(), [USDC, WETH]);
    deepStrictEqual(await quoter.rate(1_000_000n, 'forward', { tag: 24692474 }), 500000000000000n);
    deepStrictEqual(
      await quoter.rate(1_000_000_000_000_000_000n, 'Reverse', { tag: 24692474 }),
      2_000_000_000n
    );
    deepStrictEqual(
      calls.map((c) => c.tag),
      [24692474, 24692474, 24692474, 24692474]
    );
    deepStrictEqual(await quoter.coinPrice('ETH', { tag: 24692474 }), 2000);
    deepStrictEqual(calls.map((c) => c.tag)[4], 24692474);
  });
  should('quotes Uniswap V3 spot rates', async () => {
    const XAUT = '0x68749665ff8d2d112fa859aa293f07a622782f38';
    const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
    const pool = '0x6546055f46e866a4b9a4a13e81273e3152bae5da';
    const sqrtPriceX96 = 2n ** 97n; // price token0 in token1 is 4.
    const slot0 = encodeWords(sqrtPriceX96, 0n, 0n, 0n, 0n, 0n, 1n);
    const { provider } = mockEthCallProvider([
      encodeAddress(XAUT),
      encodeAddress(USDT),
      slot0,
      slot0,
    ]);
    const quoter = await UniswapV3Quoter.fromPool(provider, pool);
    deepStrictEqual(quoter.identity(), `uniswap_v3:${pool}`);
    deepStrictEqual(quoter.tokens(), [XAUT, USDT]);
    deepStrictEqual(await quoter.rate(1n, 'forward'), 4n);
    deepStrictEqual(await quoter.rate(4n, 'reverse'), 1n);
  });
  should('quotes Uniswap V3 stablecoin symbol prices', async () => {
    const USDC = tokenFromSymbol('USDC').contract;
    const DAI = tokenFromSymbol('DAI').contract;
    const pool = '0x95dbb3c7546f22bce375900abfdd64a4e5bd73d6';
    const sqrtPriceX96 = 2n ** 96n * 1_000_000n; // 1 USDC raw unit scale -> 1 DAI.
    const slot0 = encodeWords(sqrtPriceX96, 0n, 0n, 0n, 0n, 0n, 1n);
    const { provider } = mockEthCallProvider([encodeAddress(USDC), encodeAddress(DAI), slot0]);
    const quoter = await UniswapV3Quoter.fromPool(provider, pool);
    deepStrictEqual(await quoter.tokenPrice('USDC'), 1);
  });
  should('quotes ERC-4626 vault conversions', async () => {
    const vault = '0x0c6aec603d48ebf1cecc7b247a2c3da08b398dc1';
    const asset = '0x1abaea1f7c830bd89acc67ec4af516284b1bc33c';
    const { provider } = mockEthCallProvider([
      encodeAddress(asset),
      encodeWords(102n),
      encodeWords(98n),
    ]);
    const quoter = await ERC4626Quoter.fromVault(provider, vault);
    deepStrictEqual(quoter.identity(), `erc4626:${vault}`);
    deepStrictEqual(quoter.tokens(), [vault, asset]);
    deepStrictEqual(await quoter.rate(100n, 'forward'), 102n);
    deepStrictEqual(await quoter.rate(100n, 'reverse'), 98n);
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
    const DAI = tokenFromSymbol('DAI');
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
    const DAI = tokenFromSymbol('DAI');
    await rejects(() => new TestUni(new Error('boom')).swap('eth', DAI, '1'), /boom/);
    deepStrictEqual(
      await new TestUni(new Error('uniswap: cannot find path')).swap('eth', DAI, '1'),
      undefined
    );
  });
  should('UniswapV3 wraps eth before direct quote', async () => {
    const DAI = tokenFromSymbol('DAI');
    const WETH = tokenFromSymbol('WETH');
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
    const DAI = tokenFromSymbol('DAI');
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
    const archive = new Web3Provider({
      call: async () => '',
    });
    await rejects(() => archive.estimateGas({}), /RPC quantity/);
  });
  should('validates callbacks', async () => {
    const archive = new Web3Provider({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(
      () =>
        archive.internalTransactions('0x0000000000000000000000000000000000000000', {
          txInfoCallback: 1,
        }),
      /validateCallbacks: txInfoCallback should be function/
    );
  });
  should('validates pagination blocks', async () => {
    const archive = new Web3Provider({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(
      () =>
        archive.internalTransactions('0x0000000000000000000000000000000000000000', {
          fromBlock: -1,
          toBlock: 0,
        }),
      /validatePagination: wrong field fromBlock=-1/
    );
    await rejects(
      () =>
        archive.internalTransactions('0x0000000000000000000000000000000000000000', {
          fromBlock: 0,
          toBlock: -1,
        }),
      /validatePagination: wrong field toBlock=-1/
    );
  });
  should('validates OTS trace page size', async () => {
    const archive = new Web3Provider({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(
      () =>
        archive.internalTransactionsOTS('0x0000000000000000000000000000000000000000', {
          perRequestOTS: 1.5,
        }),
      /validateTraceOpts: wrong field perRequestOTS=1.5/
    );
  });
  should('validates trace batch size', async () => {
    const archive = new Web3Provider({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(
      () =>
        archive.internalTransactions('0x0000000000000000000000000000000000000000', {
          fromBlock: 2,
          toBlock: 1,
          limitTrace: 0,
        }),
      /validateTraceOpts: wrong field limitTrace=0/
    );
    await rejects(
      () =>
        archive.internalTransactions('0x0000000000000000000000000000000000000000', {
          fromBlock: 2,
          toBlock: 1,
          limitTrace: -1,
        }),
      /validateTraceOpts: wrong field limitTrace=-1/
    );
  });
  should('validates log batch size', async () => {
    const archive = new Web3Provider({
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
    const archive = new Web3Provider({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(
      () => archive.ethLogsSingle([], { fromBlock: -1 }),
      /validatePagination: wrong field fromBlock=-1/
    );
    await rejects(
      () => archive.ethLogsSingle([], { txCallback: 1 }),
      /validateCallbacks: txCallback should be function/
    );
  });
  should('validates WETH transfer address', async () => {
    const archive = new Web3Provider({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(() => archive.wethTransfers(1 as any), /wethTransfers: wrong address/);
  });
  should('validates ERC1155 transfer address', async () => {
    const archive = new Web3Provider({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(() => archive.erc1155Transfers(1 as any), /erc1155Transfers: wrong address/);
  });
  should('validates allowances address', async () => {
    const archive = new Web3Provider({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(() => archive.allowances(1 as any), /allowances: wrong address/);
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
    const archive = new Web3Provider({
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
    const archive = new Web3Provider({
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
    const hash = `0x${tx.hash}`;
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
    const archive = new Web3Provider({
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
    const hash = `0x${tx.hash}`;
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
    const archive = new Web3Provider({
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
    const archive = new Web3Provider({
      call: async (method, ...args) => {
        calls.push([method, args]);
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(() => archive.txInfo(1 as any), /txInfo: wrong txHash/);
    await rejects(() => archive.txInfo('0x1234'), /txInfo: wrong txHash/);
    await rejects(() => archive.txInfo(`0x${'zz'.repeat(32)}`), /txInfo: wrong txHash/);
    deepStrictEqual(calls, []);
  });
  should('formats trace_filter bounds', async () => {
    const calls = [];
    const archive = new Web3Provider({
      call: async (method, ...args) => {
        calls.push([method, args]);
        return [];
      },
    });
    await archive.traceFilterSingle('0x0000000000000000000000000000000000000000', {
      fromBlock: 1,
    });
    await archive.traceFilterSingle('0x0000000000000000000000000000000000000000', {
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
    const archive = new Web3Provider({
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
  should('stops OTS internal search at toBlock', async () => {
    const addr = '0x0000000000000000000000000000000000000000';
    let calls = 0;
    const archive = new Web3Provider({
      call: async (method, ...args) => {
        deepStrictEqual(method, 'ots_searchTransactionsAfter');
        deepStrictEqual(args, [addr, 15065021, 1]);
        if (++calls > 1) throw new Error('repeated ots request');
        return {
          txs: [
            {
              hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
              blockNumber: 15065024,
              type: '0x0',
              transactionIndex: '0x0',
            },
          ],
          receipts: [
            {
              transactionHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
              blockNumber: 15065024,
              type: '0x0',
              transactionIndex: '0x0',
              status: '0x1',
              logs: [],
            },
          ],
          firstPage: false,
          lastPage: false,
        };
      },
    });
    deepStrictEqual(
      await archive.internalTransactionsOTS(addr, {
        fromBlock: 15065022,
        toBlock: 15065022,
        perRequestOTS: 1,
      }),
      []
    );
    deepStrictEqual(calls, 1);
  });
  should('clamps trace_filter batches to toBlock', async () => {
    const calls = [];
    const archive = new Web3Provider({
      call: async (method, ...args) => {
        calls.push([method, args]);
        return [];
      },
    });
    await archive.internalTransactions('0x0000000000000000000000000000000000000000', {
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
    const archive = new Web3Provider({
      call: async (method, ...args) => {
        calls.push([method, args]);
        return [];
      },
    });
    await archive.internalTransactions('0x0000000000000000000000000000000000000000', {
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
    // Blocks
    deepStrictEqual(await tx.blockInfo(15_010_733), expected.block);
    // Internal transactions sanity
    const internal = await Promise.all([
      //  tx.internalTransactions(addr),
      tx.internalTransactions(addr, {
        fromBlock: 14_272_357,
        toBlock: 15_065_121,
      }),
      tx.internalTransactions(addr, {
        fromBlock: 14_272_357,
        toBlock: 15_065_121,
        perRequest: 25,
      }),
    ]);
    for (const i of internal) deepStrictEqual(i, expected.internal);
    // Make sure that all equal and pagination works
    for (let i = 1; i < internal.length; i++) deepStrictEqual(internal[i - 1], internal[i]);

    // 15_065_121 -- last tx from address
    const logsTokenFrom = await tx.tokenTransfers(addr, {
      fromBlock: 14_200_000,
      toBlock: 15_065_121,
      limit: 10_000,
    });
    deepStrictEqual(logsTokenFrom[0], expected.allFrom);
    // works with alchemy, doesn't work with quicknode
    deepStrictEqual((await tx.tokenTransfers(addr, {}))[0], expected.allFrom);
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
    deepStrictEqual(
      { price: undefined, ...(await tx.tokenInfo(tokenFromSymbol('BAT').contract)) },
      {
        ...tokenFromSymbol('BAT'),
        name: 'Basic Attention Token',
        totalSupply: 1500000000000000000000000000n,
      }
    );
  });

  should('Transactions', async () => {
    // Random address from abi tests which test for fingerprinted data in encoding.
    // Perfect for tests: only has a few transactions and provides different types of txs.
    const addr = '0x6994eCe772cC4aBb5C9993c065a34C94544A4087';
    const expected = await rpcVector('parsed-transactions');
    const tx = initProv(await rpcVector('net_tx_transfers'));

    const transfers = (await tx.transfers(addr)).map((i) => ({ ...i, info: undefined }));
    deepStrictEqual(deepMapToObject(transfers), expected.transfers);

    const diff = calcTransfersDiff(transfers);
    const diffLast = diff[diff.length - 1];
    // From etherscan
    // 0.000130036071955215
    //      130036071955215n
    deepStrictEqual(diffLast.balances[addr.toLowerCase()], 130036071955215n);
    const tokenBalances = {
      '0xa1c7d450130bb77c6a23ddfaecbc4a060215384b': 195983216736205891626852908n,
      '0xb4bda5036c709e7e3d6cc7fe577fb616363cbb0c': 130626626738232824137856499n,
      '0x81db680b1a811b5e9be8b3a01a211f94f7c7fbf3': 1965780268797386852567451n,
      '0x528686c89db00e22f58703b2d4b02e200f3255eb': 26027502560778307541998806n,
      '0x1db9f66a900c0cb6d50e34d02985fc7bdafcde7e': 2892700371812082121621646155n,
      '0x35333e20391c171fc856d2f6e46304410949c452': 60882249518969761112698747n,
    };
    const tokenBalancesAll = {
      ...tokenBalances,
      //'0x3ab16af1315dc6c95f83cbf522fecf98d00fd9ba': 13282015786652313746188n, // LooksRare: balance call reverts
      // these have different amount. preemine or some other missed method?
      '0x106d3c66d22d2dd0446df23d7f5960752994d600': 8123054826641307911n, // LABRA
      '0x236d53148f83706c3d670064809577385f923a75': 14539885279977039623402n, // SHUSKY
    };
    deepStrictEqual(
      Object.fromEntries(
        Object.entries(diffLast.tokenBalances)
          .map(([k, v]) => [k, v[addr.toLowerCase()].get(1n)])
          .filter(([k, v]) => v && v !== 0n)
      ),
      tokenBalancesAll
    );
  });
  should('allowances', async () => {
    const addr = '0x6994eCe772cC4aBb5C9993c065a34C94544A4087';
    const tx = initProv(await rpcVector('net_allowances'));
    deepStrictEqual(await tx.allowances(addr), {
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

  should('transfers: limitLogs', async () => {
    const addr = '0x6994eCe772cC4aBb5C9993c065a34C94544A4087';
    const replay = mftch.replayable(fetch, await rpcVector('net_transfers_slow_clamp'), {
      getKey,
      offline: true,
    });
    const ftch = mftch.ftch(replay, { concurrencyLimit: 1 });
    const archive = new Web3Provider(mftch.jsonrpc(ftch, 'http://SOME_NODE/'));
    const transfers = (
      await archive.transfers(addr, {
        limitLogs: 10_000,
        fromBlock: 0,
        toBlock: await archive.height(),
      })
    ).map((i) => ({ ...i, info: undefined }));
    const diff = calcTransfersDiff(transfers);
    const diffLast = diff[diff.length - 1];
    deepStrictEqual(diffLast.balances[addr.toLowerCase()], 130036071955215n);
  });

  should('transfers: limitLogs clamp capture', async () => {
    const addr = '0x6994eCe772cC4aBb5C9993c065a34C94544A4087';
    const replay = mftch.replayable(fetch, await rpcVector('net_transfers_clamp'), {
      getKey,
      offline: true,
    });
    const ftch = mftch.ftch(replay, { concurrencyLimit: 1 });
    const archive = new Web3Provider(mftch.jsonrpc(ftch, 'http://SOME_NODE/'));
    const transfers = (
      await archive.transfers(addr, {
        limitLogs: 50,
        fromBlock: 15_065_022,
        toBlock: 15_065_121,
      })
    ).map((i) => ({ ...i, info: undefined }));
    const diff = calcTransfersDiff(transfers);
    const diffLast = diff[diff.length - 1];
    deepStrictEqual(
      {
        hashes: transfers.map((i) => i.hash),
        blocks: transfers.map((i) => i.block),
        balance: diffLast.balances[addr.toLowerCase()],
      },
      {
        hashes: [
          '0x9fbc50b02d051e96d6c4cfdab6744c12306e3fb9fe8decafd14bca21653ddcd7',
          '0xd0afcc12366ae3a44092ab607c2870bfb5f07213253368dcd87686da57bf1945',
          '0xdc582d7f8a8394dcfc17cabea6bbcc680ff3fd0fd70d588ebd9559d230b7e854',
          '0x6a2f1965bd322e370511577ffc8f8af4d65222db6f97252471465eed83c8cfb5',
          '0x86c5a4350c973cd990105ae461522d01aa313fecbe0a67727e941cd9cee28997',
          '0x69ea0cc22fea6cb5dc6a44a34a872c141e760f306a30646addcd973d778553d9',
          '0x01bcf8e4be50fcf0537865f658dc912f43710f2fe579aa46f133105d58945eb5',
          '0xdfdc260522826c1772fd522cda30344ad35ab42b86d2f239dd43106a91e3f54c',
        ],
        blocks: [
          15_065_024, 15_065_027, 15_065_030, 15_065_053, 15_065_081, 15_065_101, 15_065_105,
          15_065_121,
        ],
        balance: -1681823829451014121n,
      }
    );
  });

  should('transfers: limitLogs + batch', async () => {
    const addr = '0x6994eCe772cC4aBb5C9993c065a34C94544A4087';
    const replay = mftch.replayable(fetch, await rpcVector('net_transfers_batch_clamp'), {
      getKey,
      offline: true,
    });
    const ftch = mftch.ftch(replay, { concurrencyLimit: 1 });
    const archive = new Web3Provider(mftch.jsonrpc(ftch, 'http://SOME_NODE/', { batchSize: 5 }));
    // 2061s 566 (faster than without batch)
    // 1116.18s -> 269.53s (x4 faster) with erigon
    const transfers = (
      await archive.transfers(addr, {
        limitLogs: 10_000,
        fromBlock: 0,
        toBlock: await archive.height(),
      })
    ).map((i) => ({ ...i, info: undefined }));
    const diff = calcTransfersDiff(transfers);
    const diffLast = diff[diff.length - 1];
    deepStrictEqual(diffLast.balances[addr.toLowerCase()], 130036071955215n);
  });

  should('contractCapabilities', async () => {
    const replay = mftch.replayable(fetch, await rpcVector('net_contract_capabilities'), {
      getKey,
      offline: true,
    });
    const ftch = mftch.ftch(replay, { concurrencyLimit: 5 });
    const archive = new Web3Provider(mftch.jsonrpc(ftch, 'http://NODE_URL/', { batchSize: 10 }));

    const coolCats = '0x1a92f7381b9f03921564a437210bb9396471050c';
    deepStrictEqual(await archive.contractCapabilities(coolCats), {
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
    deepStrictEqual(await archive.contractCapabilities(metaverse), {
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
    deepStrictEqual(await archive.contractCapabilities(beanz), {
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
    deepStrictEqual(await archive.contractCapabilities(usdt), {
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
    await rejects(() => archive.contractCapabilities(dead));
  });
  should('tokenInfo', async () => {
    const replay = mftch.replayable(fetch, await rpcVector('net_token_info'), {
      getKey,
      offline: true,
    });
    const ftch = mftch.ftch(replay, { concurrencyLimit: 5 });
    const archive = new Web3Provider(mftch.jsonrpc(ftch, 'http://NODE_URL/', { batchSize: 10 }));

    const coolCats = '0x1a92f7381b9f03921564a437210bb9396471050c';
    deepStrictEqual(await archive.tokenInfo(coolCats), {
      abi: 'ERC721',
      contract: '0x1a92f7381b9f03921564a437210bb9396471050c',
      name: 'Cool Cats',
      symbol: 'COOL',
      totalSupply: 9968n,
      enumerable: true,
      metadata: true,
    });
    const metaverse = '0xce320d1484b9e6c6061f5de748484546cdae2206';
    deepStrictEqual(await archive.tokenInfo(metaverse), {
      contract: '0xce320d1484b9e6c6061f5de748484546cdae2206',
      abi: 'ERC1155',
    });
    const beanz = '0x306b1ea3ecdf94ab739f1910bbda052ed4a9f949';
    deepStrictEqual(await archive.tokenInfo(beanz), {
      contract: '0x306b1ea3ecdf94ab739f1910bbda052ed4a9f949',
      abi: 'ERC721',
      name: 'Beanz',
      symbol: 'BEANZ',
      metadata: true,
    });
    const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';
    deepStrictEqual(await archive.tokenInfo(usdt), {
      contract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      abi: 'ERC20',
      name: 'Tether USD',
      symbol: 'USDT',
      totalSupply: 76926220145483487n,
      decimals: 6,
    });
    const dead = '0x52903256dd18d85c2dc4a6c999907c9793ea61e3'; // self-destructed contract
    deepStrictEqual(await archive.tokenInfo(dead), {
      contract: '0x52903256dd18d85c2dc4a6c999907c9793ea61e3',
      error: 'not contract or destructed',
    });
  });
  should('preserves zero ERC20 decimals', async () => {
    const contract = '0x0000000000000000000000000000000000000001';
    const archive = new Web3Provider({
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
    deepStrictEqual(await archive.tokenInfo(contract), {
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
    const archive = new Web3Provider({
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
    deepStrictEqual(await archive.tokenBalances(address, [contract], { [contract]: new Set() }), {
      [contract]: new Map(),
    });
  });
  should('validates tokenURI token input', async () => {
    const archive = new Web3Provider({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    await rejects(() => archive.tokenURI(123 as any, 1n), /tokenURI: wrong token/);
  });
  should('validates tokenBalances token input', async () => {
    const archive = new Web3Provider({
      call: async () => {
        throw new Error('unexpected rpc call');
      },
    });
    const address = '0x0000000000000000000000000000000000000002';
    await rejects(() => archive.tokenBalances(address, [123 as any]), /tokenBalances: wrong token/);
    await rejects(
      () => archive.tokenBalances(address, [{ abi: 'ERC20' } as any]),
      /tokenBalances: wrong token/
    );
  });
  should('ignores malformed ERC1155 batch transfer logs', async () => {
    const word = (n) => n.toString(16).padStart(64, '0');
    const address = '0x0000000000000000000000000000000000000002';
    const to = '0x0000000000000000000000000000000000000003';
    const contract = '0x0000000000000000000000000000000000000001';
    const hash = `0x${'11'.repeat(32)}`;
    const blockHash = `0x${'22'.repeat(32)}`;
    const batch = events(ERC1155).TransferBatch;
    const log = {
      address: contract,
      topics: batch.topics({
        operator: address,
        from: address,
        to,
        ids: null,
        values: null,
      }),
      data: `0x${word(64n)}${word(160n)}${word(2n)}${word(7n)}${word(8n)}${word(1n)}${word(9n)}`,
      blockNumber: '0x1',
      transactionHash: hash,
      transactionIndex: '0x0',
      blockHash,
      logIndex: '0x0',
      removed: false,
    };
    const archive = new Web3Provider({
      call: async (method, ...args) => {
        if (method === 'trace_filter') return [];
        if (method === 'eth_getBlockByNumber')
          return { timestamp: '0x1', size: '0x0', number: '0x1' };
        if (method === 'eth_getTransactionByHash') {
          return {
            blockHash,
            blockNumber: '0x1',
            hash,
            transactionIndex: '0x0',
            type: '0x2',
            nonce: '0x0',
            input: '0x',
            r: '0x1',
            s: '0x1',
            chainId: '0x1',
            v: '0x0',
            gas: '0x5208',
            maxPriorityFeePerGas: '0x1',
            maxFeePerGas: '0x1',
            from: address,
            to,
            value: '0x0',
            gasPrice: '0x1',
            accessList: [],
          };
        }
        if (method === 'eth_getTransactionReceipt') {
          return {
            transactionHash: hash,
            blockHash,
            blockNumber: '0x1',
            logsBloom: `0x${'00'.repeat(256)}`,
            gasUsed: '0x0',
            contractAddress: null,
            cumulativeGasUsed: '0x0',
            transactionIndex: '0x0',
            from: address,
            to,
            type: '0x2',
            effectiveGasPrice: '0x0',
            logs: [log],
            status: '0x1',
          };
        }
        if (method === 'eth_getCode') return '0x01';
        if (method === 'eth_call') {
          const [{ data }] = args;
          if (data.startsWith('0x01ffc9a7')) {
            const cap = data.slice(10, 18);
            return `0x${'00'.repeat(31)}${cap === '01ffc9a7' || cap === 'd9b67a26' ? '01' : '00'}`;
          }
          throw new Error('optional metadata unavailable');
        }
        if (method === 'eth_getLogs') {
          const [req] = args;
          if (req.topics[0] === log.topics[0] && req.topics[2] === log.topics[2]) return [log];
          return [];
        }
        throw new Error(`unexpected rpc call ${method}`);
      },
    });
    const txs = await archive.transfers(address, {
      fromBlock: 1,
      toBlock: 1,
      limitTrace: 1,
      ignoreTxRebuildErrors: true,
    } as any);
    deepStrictEqual(
      txs.map((i) => i.tokenTransfers),
      [[]]
    );
  });
  should('discovers token info from related transaction receipts', async () => {
    const word = (n) => n.toString(16).padStart(64, '0');
    const address = '0x0000000000000000000000000000000000000002';
    const traceTo = '0x0000000000000000000000000000000000000003';
    const from = '0x0000000000000000000000000000000000000004';
    const to = '0x0000000000000000000000000000000000000005';
    const contract = '0x0000000000000000000000000000000000000001';
    const hash = `0x${'11'.repeat(32)}`;
    const blockHash = `0x${'22'.repeat(32)}`;
    const transfer = events(ERC20).Transfer;
    let traceCalls = 0;
    const log = {
      address: contract,
      topics: transfer.topics({ from, to, value: null }),
      data: `0x${word(5n)}`,
      blockNumber: '0x1',
      transactionHash: hash,
      transactionIndex: '0x0',
      blockHash,
      logIndex: '0x0',
      removed: false,
    };
    const archive = new Web3Provider({
      call: async (method, ...args) => {
        if (method === 'trace_filter') {
          return traceCalls++
            ? []
            : [
                {
                  action: { from: address, to: traceTo, gas: '0x0', input: '0x', value: '0x1' },
                  blockHash,
                  blockNumber: 1,
                  result: { gasUsed: '0x0', output: '0x' },
                  subtraces: 0,
                  traceAddress: [],
                  transactionHash: hash,
                  transactionPosition: 0,
                  type: 'call',
                },
              ];
        }
        if (method === 'eth_getBlockByNumber')
          return { timestamp: '0x1', size: '0x0', number: '0x1' };
        if (method === 'eth_getTransactionByHash') {
          return {
            blockHash,
            blockNumber: '0x1',
            hash,
            transactionIndex: '0x0',
            type: '0x2',
            nonce: '0x0',
            input: '0x',
            r: '0x1',
            s: '0x1',
            chainId: '0x1',
            v: '0x0',
            gas: '0x5208',
            maxPriorityFeePerGas: '0x1',
            maxFeePerGas: '0x1',
            from: address,
            to: traceTo,
            value: '0x0',
            gasPrice: '0x1',
            accessList: [],
          };
        }
        if (method === 'eth_getTransactionReceipt') {
          return {
            transactionHash: hash,
            blockHash,
            blockNumber: '0x1',
            logsBloom: `0x${'00'.repeat(256)}`,
            gasUsed: '0x0',
            contractAddress: null,
            cumulativeGasUsed: '0x0',
            transactionIndex: '0x0',
            from: address,
            to: traceTo,
            type: '0x2',
            effectiveGasPrice: '0x0',
            logs: [log],
            status: '0x1',
          };
        }
        if (method === 'eth_getCode') return '0x01';
        if (method === 'eth_call') {
          const [{ data }] = args;
          if (data.startsWith('0x01ffc9a7')) return `0x${'00'.repeat(32)}`;
          if (data.startsWith('0x18160ddd')) return `0x${word(100n)}`;
          throw new Error('optional metadata unavailable');
        }
        if (method === 'eth_getLogs') return [];
        throw new Error(`unexpected rpc call ${method}`);
      },
    });
    const txs = await archive.transfers(address, {
      fromBlock: 1,
      toBlock: 1,
      ignoreTxRebuildErrors: true,
    } as any);
    deepStrictEqual(
      txs.map((i) => i.tokenTransfers),
      [
        [
          {
            contract,
            abi: 'ERC20',
            name: undefined,
            symbol: undefined,
            totalSupply: 100n,
            decimals: undefined,
            from,
            to,
            tokens: new Map([[1n, 5n]]),
          },
        ],
      ]
    );
  });
  should('tokenBalances', async () => {
    const replay = mftch.replayable(fetch, await rpcVector('net_token_balances'), {
      getKey,
      offline: true,
    });
    const ftch = mftch.ftch(replay, { concurrencyLimit: 5 });
    const archive = new Web3Provider(mftch.jsonrpc(ftch, 'http://NODE_URL/', { batchSize: 10 }));

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

    deepStrictEqual(await archive.tokenBalances(addr, tokens), {
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
      await archive.tokenBalances(addr, [
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
    deepStrictEqual(await archive.tokenBalances(addr3, tokens), {
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
    deepStrictEqual(await archive.tokenBalances(addr4, tokens), {
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
      await archive.tokenBalances(
        addr4,
        [{ ...(await archive.tokenInfo(coolCats)), enumerable: false }],
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
      await archive.tokenBalances(addr5, [metaverse], {
        [metaverse]: new Set([46n]),
      }),
      { [metaverse]: new Map([[46n, 1n]]) }
    );
    // NFT URI: should be cached, it is per tokenId, not per account
    deepStrictEqual(await archive.tokenURI(coolCats, 1n), 'https://api.coolcatsnft.com/cat/1');
    deepStrictEqual(await archive.tokenURI(metaverse, 46n), 'https://themta.site/ipfs/46');
    deepStrictEqual(await archive.tokenURI(usdt, 1n), {
      contract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      error: 'not supported token type',
    });
  });
  should('tokenTransfers', async () => {
    const replay = mftch.replayable(fetch, await rpcVector('net_token_transfers_nft'), {
      getKey,
      offline: true,
    });
    const ftch = mftch.ftch(replay, { concurrencyLimit: 5 });
    const archive = new Web3Provider(mftch.jsonrpc(ftch, 'http://NODE_URL/', { batchSize: 10 }));

    const addr = '0x6994eCe772cC4aBb5C9993c065a34C94544A4087';
    const txs = await archive.transfers(addr);
    const diff = calcTransfersDiff(txs);
    const diffLast = diff[diff.length - 1];
    deepStrictEqual(diffLast.balances[addr.toLowerCase()], 130036071955215n);
    const tokenBalances = {};
    for (const contract in diffLast.tokenBalances)
      tokenBalances[contract] = diffLast.tokenBalances[contract][addr.toLowerCase()];
    deepStrictEqual(tokenBalances, {
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': new Map([[1n, 0n]]),
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': new Map([[1n, 0n]]),
      '0xf4d2888d29d722226fafa5d9b24f9164c092421e': new Map([[1n, 0n]]),
      '0x8a9c4dfe8b9d8962b31e4e16f8321c44d48e246e': new Map([[1n, 0n]]),
      '0x3472a5a71965499acd81997a54bba8d852c6e53d': new Map([[1n, 0n]]),
      '0xc32cc5b70bee4bd54aa62b9aefb91346d18821c4': new Map([[1n, 0n]]),
      '0xa1c7d450130bb77c6a23ddfaecbc4a060215384b': new Map([[1n, 195983216736205891626852908n]]),
      '0x7bef710a5759d197ec0bf621c3df802c2d60d848': new Map([[1n, 0n]]),
      '0xd5d86fc8d5c0ea1ac1ac5dfab6e529c9967a45e9': new Map([[1n, 0n]]),
      '0x7420b4b9a0110cdc71fb720908340c03f9bc03ec': new Map([[1n, 0n]]),
      '0xb4bda5036c709e7e3d6cc7fe577fb616363cbb0c': new Map([[1n, 130626626738232824137856499n]]),
      '0x81db680b1a811b5e9be8b3a01a211f94f7c7fbf3': new Map([[1n, 1965780268797386852567451n]]),
      '0x528686c89db00e22f58703b2d4b02e200f3255eb': new Map([[1n, 26027502560778307541998806n]]),
      '0x1db9f66a900c0cb6d50e34d02985fc7bdafcde7e': new Map([[1n, 2892700371812082121621646155n]]),
      '0x35333e20391c171fc856d2f6e46304410949c452': new Map([[1n, 60882249518969761112698747n]]),
      '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce': new Map([[1n, 0n]]),
      '0xe53ec727dbdeb9e2d5456c3be40cff031ab40a55': new Map([[1n, 0n]]),
      '0x467bccd9d29f223bce8043b84e8c8b282827790f': new Map([[1n, 0n]]),
      '0x626e8036deb333b408be468f951bdb42433cbf18': new Map([[1n, 0n]]),
      '0x3b484b82567a09e2588a13d54d032153f0c0aee0': new Map([[1n, 0n]]),
      '0xeb953eda0dc65e3246f43dc8fa13f35623bdd5ed': new Map([[1n, 0n]]),
      '0xec681f28f4561c2a9534799aa38e0d36a83cf478': new Map([[1n, 0n]]),
      '0x106d3c66d22d2dd0446df23d7f5960752994d600': new Map([[1n, 8123054826641307911n]]),
      '0x3d3d35bb9bec23b06ca00fe472b50e7a4c692c30': new Map([[1n, 0n]]),
      '0x3301ee63fb29f863f2333bd4466acb46cd8323e6': new Map([[1n, 0n]]),
      '0x236d53148f83706c3d670064809577385f923a75': new Map([[1n, 14539885279977039623402n]]),
      // NFTs:
      // Metaverse (832): https://etherscan.io/token/0xce320d1484b9e6c6061f5de748484546cdae2206?a=0x6994eCe772cC4aBb5C9993c065a34C94544A4087
      '0xce320d1484b9e6c6061f5de748484546cdae2206': new Map([[832n, 1n]]),
      // Metaverse Old (832) https://etherscan.io/token/0x2f8231e79e5d6510ba714511ff5a0c25ddf731b7?a=0x6994eCe772cC4aBb5C9993c065a34C94544A4087
      '0x2f8231e79e5d6510ba714511ff5a0c25ddf731b7': new Map([[832n, 1n]]),
      // Rich Baby Club (153): https://etherscan.io/token/0x033b77425bbfe777564618299fdfff5c67be6a70?a=0x6994eCe772cC4aBb5C9993c065a34C94544A4087
      '0x033b77425bbfe777564618299fdfff5c67be6a70': new Map([[153n, 1n]]),
      // Nigth City (6929): https://etherscan.io/token/0x3e7b38e7f6c089345ccca785b18890c528636673?a=6929
      '0x3e7b38e7f6c089345ccca785b18890c528636673': new Map([[6929n, 1n]]),
    });
  });
});

should.runWhen(import.meta.url);
