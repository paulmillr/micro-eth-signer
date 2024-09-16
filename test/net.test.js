import { deepStrictEqual } from 'node:assert';
import { describe, should } from 'micro-should';
import { tokenFromSymbol } from '../esm/abi/index.js';
import {
  Web3Provider,
  calcTransfersDiff,
  ENS,
  Chainlink,
  UniswapV3,
} from '../esm/net/index.js';
import * as mftch from 'micro-ftch';
import { weieth, numberTo0xHex } from '../esm/utils.js';
// These real network responses from real nodes, captured by replayable
import { default as NET_TX_REPLAY } from './vectors/rpc/transactions.js';
import { default as NET_ENS_REPLAY } from './vectors/rpc/ens.js';
import { default as NET_CHAINLINK_REPLAY } from './vectors/rpc/chainlink.js';
import { default as NET_UNISWAP_REPLAY } from './vectors/rpc/uniswap.js';
import { default as NET_ESTIMATE_GAS_REPLAY } from './vectors/rpc/estimateGas.js';
import { default as NET_TX_VECTORS } from './vectors/rpc/parsed-transactions.js';
import { default as NET_TX_SLOW_REPLAY } from './vectors/rpc/net_transfers_slow.js';
import { default as NET_TX_BATCH_REPLAY } from './vectors/rpc/net_transfers_batch.js';

const NODE_URL = 'https://NODE_URL/';
const getKey = (url, opt) => JSON.stringify({ url: NODE_URL, opt });

function initProv(replayJson) {
  const replay = mftch.replayable(fetch, replayJson, { getKey, offline: true });
  const provider = mftch.jsonrpc(replay, NODE_URL);
  const archive = new Web3Provider(provider);
  return archive;
}

describe('Network', () => {
  should('ENS', async () => {
    const ens = new ENS(initProv(NET_ENS_REPLAY));
    const vitalikAddr = await ens.nameToAddress('vitalik.eth');
    const vitalikName = await ens.addressToName(vitalikAddr);
    deepStrictEqual(vitalikAddr, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
    deepStrictEqual(vitalikName, 'vitalik.eth');
  });
  should('Chainlink', async () => {
    const chainlink = new Chainlink(initProv(NET_CHAINLINK_REPLAY));
    const btcPrice = await chainlink.coinPrice('BTC');
    deepStrictEqual(btcPrice, 69369.10271);
  });

  should('UniswapV3', async () => {
    const univ3 = new UniswapV3(initProv(NET_UNISWAP_REPLAY));
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
    const archive = initProv(NET_ESTIMATE_GAS_REPLAY);
    const gasLimit = await archive.estimateGas({
      from: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      to: '0xe592427a0aece92de3edee1f18e0157c05861564',
      value: numberTo0xHex(weieth.decode('1.23')),
      data: '0xc04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000000019077fd30000000000000000000000000000000000000000000000000001111d67bb1bb0000000000000000000000000000000000000000000000000102d6906ca33403f40b0000000000000000000000000000000000000000000000000000000000000042c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480001f46b175474e89094c44da98b954eedeac495271d0f000000000000000000000000000000000000000000000000000000000000',
    });
    deepStrictEqual(gasLimit, 236082n);
  });

  should('Transactions', async () => {
    // Random address from abi tests which test for fingerprinted data in encoding.
    // Perfect for tests: only has a few transactions and provides different types of txs.
    const addr = '0x6994eCe772cC4aBb5C9993c065a34C94544A4087';
    const tx = initProv(NET_TX_REPLAY);
    // Blocks
    deepStrictEqual(await tx.blockInfo(15_010_733), NET_TX_VECTORS.block);
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
    for (const i of internal) deepStrictEqual(i, NET_TX_VECTORS.internal);
    // Make sure that all equal and pagination works
    for (let i = 1; i < internal.length; i++) deepStrictEqual(internal[i - 1], internal[i]);

    // 15_065_121 -- last tx from address
    const logsTokenFrom = await tx.tokenTransfers(addr, {
      fromBlock: 14_200_000,
      toBlock: 15_065_121,
      limit: 10_000,
    });
    deepStrictEqual(logsTokenFrom[0], NET_TX_VECTORS.allFrom);
    // works with alchemy, doesn't work with quicknode
    deepStrictEqual((await tx.tokenTransfers(addr, {}))[0], NET_TX_VECTORS.allFrom);
    deepStrictEqual(
      await tx.txInfo('0x01bcf8e4be50fcf0537865f658dc912f43710f2fe579aa46f133105d58945eb5'),
      NET_TX_VECTORS.txInfo
    );
    deepStrictEqual(
      await tx.txInfo('0xba296ea35b5ff390b8c180ae8f536159dc8723871b43ed7f80e0c218cf171a05'),
      NET_TX_VECTORS.blobTx
    );
    deepStrictEqual(
      await tx.txInfo('0x86c5a4350c973cd990105ae461522d01aa313fecbe0a67727e941cd9cee28997'),
      NET_TX_VECTORS.legacyTx
    );
    // Dynamically get tokenInfo for unknown token
    deepStrictEqual(
      { price: undefined, ...(await tx.tokenInfo(tokenFromSymbol('BAT').contract)) },
      tokenFromSymbol('BAT')
    );
    const transfers = (await tx.transfers(addr)).map((i) => ({ ...i, info: undefined }));
    deepStrictEqual(transfers, NET_TX_VECTORS.transfers);

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
      '0x3ab16af1315dc6c95f83cbf522fecf98d00fd9ba': 13282015786652313746188n, // LooksRare: balance call reverts
      // these have different amount. preemine or some other missed method?
      '0x106d3c66d22d2dd0446df23d7f5960752994d600': 8123054826641307911n, // LABRA
      '0x236d53148f83706c3d670064809577385f923a75': 14539885279977039623402n, // SHUSKY
    };
    deepStrictEqual(
      Object.fromEntries(
        Object.entries(diffLast.tokenBalances)
          .map(([k, v]) => [k, v[addr.toLowerCase()]])
          .filter(([k, v]) => v !== 0n)
      ),
      tokenBalancesAll
    );
    deepStrictEqual(await tx.tokenBalances(addr, Object.keys(tokenBalances)), tokenBalances);

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
    const replay = mftch.replayable(fetch, NET_TX_SLOW_REPLAY, {
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

  should('transfers: limitLogs + batch', async () => {
    const addr = '0x6994eCe772cC4aBb5C9993c065a34C94544A4087';
    const replay = mftch.replayable(fetch, NET_TX_BATCH_REPLAY, {
      getKey,
      offline: true,
    });
    const ftch = mftch.ftch(replay, { concurrencyLimit: 1 });
    const archive = new Web3Provider(
      mftch.jsonrpc(ftch, 'http://SOME_NODE/', { batchSize: 5 })
    );
    // 2061s 566 (faster than without batch)
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
});

// ESM is broken.
import url from 'node:url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  should.run();
}
