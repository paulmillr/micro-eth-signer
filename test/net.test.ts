import { describe, should } from '@paulmillr/jsbt/test.js';
import * as mftch from 'micro-ftch';
import { deepStrictEqual, rejects } from 'node:assert';
import { tokenFromSymbol } from '../src/abi/index.ts';
import { calcTransfersDiff, Chainlink, ENS, UniswapV3, Web3Provider } from '../src/net/index.ts';
import { numberTo0xHex, weieth } from '../src/utils.ts';

// These real network responses from real nodes, captured by replayable
import { default as NET_CHAINLINK_REPLAY } from './vectors/rpc/chainlink.js';
import { default as NET_ENS_REPLAY } from './vectors/rpc/ens.js';
import { default as NET_ESTIMATE_GAS_REPLAY } from './vectors/rpc/estimateGas.js';
import { default as NET_UNISWAP_REPLAY } from './vectors/rpc/uniswap.js';

import { default as NET_TX_ALLOWANCES } from './vectors/rpc/net_allowances.js';
import { default as NET_TX_CONTRACT_CAPABILITIES } from './vectors/rpc/net_contract_capabilities.js';
import { default as NET_TX_TOKEN_BALANCES } from './vectors/rpc/net_token_balances.js';
import { default as NET_TX_TOKEN_INFO } from './vectors/rpc/net_token_info.js';
import { default as NET_TX_TOKEN_TRANSFERS_NFT } from './vectors/rpc/net_token_transfers_nft.js';
import { default as NET_TX_BATCH_REPLAY } from './vectors/rpc/net_transfers_batch.js';
import { default as NET_TX_SLOW_REPLAY } from './vectors/rpc/net_transfers_slow.js';
import { default as NET_TX_BASIC } from './vectors/rpc/net_tx_basic.js';
import { default as NET_TX_TRANSFERS } from './vectors/rpc/net_tx_transfers.js';
import { default as NET_TX_VECTORS } from './vectors/rpc/parsed-transactions.js';


const NODE_URL = 'https://NODE_URL/';
const getKey = (url, opt) => JSON.stringify({ url: NODE_URL, opt });

function initProv(replayJson) {
  const replay = mftch.replayable(fetch, replayJson, { getKey, offline: true });
  const provider = mftch.jsonrpc(replay, NODE_URL);
  const archive = new Web3Provider(provider);
  return archive;
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
  if (tx.info.accessList)
    tx.info.accessList = tx.info.accessList.map(([address, storageKeys]) => ({
      address,
      storageKeys,
    }));
  return tx;
};

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
  should('Transcations basic', async () => {
    // Random address from abi tests which test for fingerprinted data in encoding.
    // Perfect for tests: only has a few transactions and provides different types of txs.
    const addr = '0x6994eCe772cC4aBb5C9993c065a34C94544A4087';
    const tx = initProv(NET_TX_BASIC);
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
      fixTx(NET_TX_VECTORS.blobTx)
    );
    deepStrictEqual(
      await tx.txInfo('0x86c5a4350c973cd990105ae461522d01aa313fecbe0a67727e941cd9cee28997'),
      NET_TX_VECTORS.legacyTx
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
    const tx = initProv(NET_TX_TRANSFERS);

    const transfers = (await tx.transfers(addr)).map((i) => ({ ...i, info: undefined }));
    deepStrictEqual(deepMapToObject(transfers), NET_TX_VECTORS.transfers);

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
    const tx = initProv(NET_TX_ALLOWANCES);
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
    const replay = mftch.replayable(fetch, NET_TX_SLOW_REPLAY, { getKey, offline: true });
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
    const replay = mftch.replayable(fetch, NET_TX_CONTRACT_CAPABILITIES, { getKey, offline: true });
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
    const replay = mftch.replayable(fetch, NET_TX_TOKEN_INFO, { getKey, offline: true });
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
  should('tokenBalances', async () => {
    const replay = mftch.replayable(fetch, NET_TX_TOKEN_BALANCES, { getKey, offline: true });
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
    const replay = mftch.replayable(fetch, NET_TX_TOKEN_TRANSFERS_NFT, { getKey, offline: true });
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
