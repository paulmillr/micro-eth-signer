import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, rejects } from 'node:assert';
import { Web3Provider } from '../src/net.ts';
import {
  CLEARSIG_REPO,
  Decoder,
  OURS,
  TOKENS,
  createContract,
  decodeData,
  decodeTx,
} from '../src/advanced/abi.ts';
import { Transaction } from '../src/index.ts';
import { ethHex } from '../src/utils.ts';

const TARGET = '0x0000000000000000000000000000000000001001';
const FACTORY = '0x0000000000000000000000000000000000001002';
const TOKEN = '0x0000000000000000000000000000000000001003';
const ACCOUNT = '0x0000000000000000000000000000000000001004';
const NFT = '0x0000000000000000000000000000000000001005';
const BAYC = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d';
const KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';
const USDT_TX =
  '0xf8a901851d1a94a20082c12a94dac17f958d2ee523a2206206994597c13d831ec780b844a9059cbb000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000000000000000000000000000000000054259870025a066fcb560b50e577f6dc8c8b2e3019f760da78b4c04021382ba490c572a303a42a0078f5af8ac7e11caba9b7dc7a64f7bdc3b4ce1a6ab0a1246771d7cc3524a7200';

const ABI = [
  {
    type: 'function',
    name: 'tokenResolve',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'nftResolve',
    inputs: [
      { name: 'collection', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'blockResolve',
    inputs: [{ name: 'blockNumber', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nestedResolve',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'inner', type: 'bytes' },
    ],
  },
  {
    type: 'function',
    name: 'archiveResolve',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'account', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'collection', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'interop', type: 'bytes' },
      { name: 'inner', type: 'bytes' },
    ],
  },
] as const;

const ERC20_ABI = [
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
  },
] as const;

const INNER_CLEAR = {
  display: {
    formats: {
      'transfer(address to,uint256 value)': {
        intent: 'Send',
        interpolatedIntent: 'Send {value} to {to}',
        fields: [
          { path: 'value', label: 'Amount', format: 'tokenAmount', params: { tokenPath: '@.to' } },
          { path: 'to', label: 'To', format: 'addressName' },
        ],
      },
    },
  },
};

const CLEAR = {
  context: {
    contract: {
      factory: {
        deployEvent: 'Deployed(address indexed instance)',
        deployments: [{ chainId: 1, address: FACTORY }],
      },
    },
  },
  display: {
    formats: {
      'tokenResolve(address token,uint256 amount)': {
        intent: 'Token Lookup',
        interpolatedIntent: 'Token Lookup {token} {amount}',
        fields: [
          { path: 'token', label: 'Token', format: 'tokenTicker' },
          {
            path: 'amount',
            label: 'Amount',
            format: 'tokenAmount',
            params: { tokenPath: 'token' },
          },
        ],
      },
      'nftResolve(address collection,uint256 tokenId)': {
        intent: 'NFT Lookup',
        interpolatedIntent: 'NFT Lookup {tokenId}',
        fields: [
          {
            path: 'tokenId',
            label: 'NFT',
            format: 'nftName',
            params: { collectionPath: 'collection' },
          },
        ],
      },
      'blockResolve(uint256 blockNumber)': {
        intent: 'Block Lookup',
        interpolatedIntent: 'Block Lookup {blockNumber}',
        fields: [
          {
            path: 'blockNumber',
            label: 'Block',
            format: 'date',
            params: { encoding: 'blockheight' },
          },
        ],
      },
      'nestedResolve(address token,bytes inner)': {
        intent: 'Nested Call',
        interpolatedIntent: 'Nested Call {inner}',
        fields: [
          {
            path: 'inner',
            label: 'Call',
            format: 'calldata',
            params: { calleePath: 'token' },
          },
        ],
      },
      'archiveResolve(address token,address account,uint256 amount,address collection,uint256 tokenId,uint256 blockNumber,bytes interop,bytes inner)':
        {
          intent: 'Archive Resolve',
          interpolatedIntent:
            'Archive Resolve {token} {amount} for {account} NFT {tokenId} at {blockNumber} on {@.chainId} via {interop} and {inner}',
          fields: [
            { path: 'token', label: 'Token', format: 'tokenTicker' },
            {
              path: 'amount',
              label: 'Amount',
              format: 'tokenAmount',
              params: { tokenPath: 'token' },
            },
            { path: 'account', label: 'Account', format: 'addressName' },
            {
              path: 'tokenId',
              label: 'NFT',
              format: 'nftName',
              params: { collectionPath: 'collection' },
            },
            {
              path: 'blockNumber',
              label: 'Block',
              format: 'date',
              params: { encoding: 'blockheight' },
            },
            { path: '@.chainId', label: 'Network', format: 'chainId' },
            { path: 'interop', label: 'Interop', format: 'interoperableAddressName' },
            {
              path: 'inner',
              label: 'Call',
              format: 'calldata',
              params: { calleePath: 'token' },
            },
          ],
        },
    },
  },
};
const DIRECT_CLEAR = {
  context: {
    contract: {
      deployments: [{ chainId: 1, address: TARGET }],
      factory: CLEAR.context.contract.factory,
    },
  },
  display: CLEAR.display,
};
const calldata = async (
  input: { to: string; data: string; value?: bigint; chainId?: bigint },
  opt: any = {}
) => {
  const chainId = input.chainId;
  const decoder = new Decoder().addClearSig(
    { 'inline.json': opt.clearSig },
    { bind: { address: input.to, chainId } }
  );
  if (opt.resolveFactory) await decoder.resolve({ ...opt, address: input.to, chainId });
  const next = { ...opt, decoder, noDefault: true, chainId };
  delete next.clearSig;
  const res = decodeData(input.to, input.data, input.value, next);
  if (!res || Array.isArray(res)) return;
  return res.clearSig;
};

const hexWord = (n: bigint | number) => BigInt(n).toString(16).padStart(64, '0');
const hexString = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  const hex = ethHex.encode(bytes).slice(2);
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
  return `0x${hexWord(32)}${hexWord(bytes.length)}${padded}`;
};

const rpc = () => {
  const calls: string[] = [];
  const archive = new Web3Provider({
    async call(method, ...args) {
      calls.push(method);
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_getCode') return args[0] === ACCOUNT ? '0x' : '0x01';
      if (method === 'eth_getBlockByNumber')
        return { number: args[0], timestamp: '0x65e047b3', size: '0x1' };
      if (method === 'eth_getLogs')
        return [
          {
            address: FACTORY,
            topics: [],
            data: '0x',
            blockNumber: '0x1',
            transactionIndex: '0x0',
            logIndex: '0x0',
            transactionHash: `0x${'11'.repeat(32)}`,
            blockHash: `0x${'22'.repeat(32)}`,
            removed: false,
          },
        ];
      if (method === 'eth_call') {
        const [{ to, data }] = args;
        const selector = data.slice(0, 10);
        if (selector === '0x01ffc9a7') {
          const iface = data.slice(10, 18);
          const ok =
            to === NFT && (iface === '01ffc9a7' || iface === '80ac58cd' || iface === '5b5e139f');
          return `0x${hexWord(ok ? 1 : 0)}`;
        }
        if (to === TOKEN && selector === '0x06fdde03') return hexString('Mock Token');
        if (to === TOKEN && selector === '0x95d89b41') return hexString('MTK');
        if (to === TOKEN && selector === '0x313ce567') return `0x${hexWord(6)}`;
        if (to === TOKEN && selector === '0x18160ddd') return `0x${hexWord(1_000_000_000n)}`;
        if (to === NFT && selector === '0x06fdde03') return hexString('Archive NFT');
        if (to === NFT && selector === '0x95d89b41') return hexString('ANFT');
        if (to === NFT && selector === '0xc87b56dd') return hexString('ipfs://archive/42');
      }
      throw new Error(`unexpected rpc call ${method}`);
    },
  });
  return { archive, calls };
};

describe('ERC-7730 archive callbacks', () => {
  should('renders through archive-backed resolver callbacks', async () => {
    const { archive, calls } = rpc();
    const inner = createContract(ERC20_ABI).transfer.encodeInput({ to: ACCOUNT, value: 1000000n });
    const data = ethHex.encode(
      createContract(ABI).archiveResolve.encodeInput({
        token: TOKEN,
        account: ACCOUNT,
        amount: 123456n,
        collection: NFT,
        tokenId: 42n,
        blockNumber: 19332140n,
        interop: new Uint8Array([1, 2, 3]),
        inner,
      })
    );

    deepStrictEqual(
      await calldata({ to: TARGET, data, chainId: 1n }, { clearSig: CLEAR }),
      undefined
    );
    deepStrictEqual(
      await calldata(
        { to: TARGET, data, chainId: 1n },
        {
          clearSig: CLEAR,
          async resolveToken(req) {
            const info = await archive.tokenInfo(req.address);
            if ('error' in info || info.abi !== 'ERC20') return;
            return { name: info.name, symbol: info.symbol, decimals: info.decimals };
          },
          async resolveAddress(req) {
            await archive.call('eth_getCode', req.address, 'latest');
            return { name: 'vitalik.eth', source: 'archive', verified: true };
          },
          async resolveNft(req) {
            const info = await archive.tokenInfo(req.collection);
            if ('error' in info) return;
            const uri = await archive.tokenURI(info, req.tokenId);
            return {
              name: `${info.name} #${req.tokenId}`,
              source: typeof uri === 'string' ? uri : undefined,
              verified: true,
            };
          },
          async resolveBlock(req) {
            return Math.floor((await archive.blockInfo(Number(req.block))).timestamp / 1000);
          },
          async resolveChain(req) {
            deepStrictEqual(await archive.call('eth_chainId'), `0x${req.chainId.toString(16)}`);
            return { name: 'Ethereum Mainnet', ticker: 'ETH' };
          },
          async resolveInteroperableAddress(req) {
            await archive.call('eth_chainId');
            return `ens:${ethHex.encode(req.value).slice(2)}`;
          },
          async resolveCalldata(req) {
            await archive.tokenInfo(req.to);
            return INNER_CLEAR;
          },
          async resolveFactory(req) {
            const logs = await archive.ethLogs([], { fromBlock: 1, toBlock: 1 });
            return logs.some((log) => log.address === req.factories[0].deployments[0].address)
              ? 0
              : undefined;
          },
        }
      ),
      {
        intent: 'Archive Resolve',
        interpolatedIntent:
          'Archive Resolve MTK 0.123456 MTK for vitalik.eth NFT Archive NFT #42 at Thu, 29 Feb 2024 09:00:35 GMT on Ethereum Mainnet via ens:010203 and Send 1 MTK to vitalik.eth',
        structuredIntent: [
          'Archive Resolve ',
          { value: 'MTK', format: 'tokenTicker', rawValue: TOKEN },
          ' ',
          { value: '0.123456 MTK', format: 'tokenAmount', rawValue: 123456n },
          ' for ',
          { value: 'vitalik.eth', format: 'addressName', rawValue: ACCOUNT },
          ' NFT ',
          { value: 'Archive NFT #42', format: 'nftName', rawValue: 42n },
          ' at ',
          { value: 'Thu, 29 Feb 2024 09:00:35 GMT', format: 'date', rawValue: 19332140n },
          ' on ',
          { value: 'Ethereum Mainnet', format: 'chainId', rawValue: 1n },
          ' via ',
          {
            value: 'ens:010203',
            format: 'interoperableAddressName',
            rawValue: new Uint8Array([1, 2, 3]),
          },
          ' and ',
          { value: 'Send 1 MTK to vitalik.eth', format: 'calldata', rawValue: inner },
        ],
        fields: {
          Token: { value: 'MTK', format: 'tokenTicker', rawValue: TOKEN },
          Amount: { value: '0.123456 MTK', format: 'tokenAmount', rawValue: 123456n },
          Account: { value: 'vitalik.eth', format: 'addressName', rawValue: ACCOUNT },
          NFT: { value: 'Archive NFT #42', format: 'nftName', rawValue: 42n },
          Block: {
            value: 'Thu, 29 Feb 2024 09:00:35 GMT',
            format: 'date',
            rawValue: 19332140n,
          },
          Network: { value: 'Ethereum Mainnet', format: 'chainId', rawValue: 1n },
          Interop: {
            value: 'ens:010203',
            format: 'interoperableAddressName',
            rawValue: new Uint8Array([1, 2, 3]),
          },
          Call: { value: 'Send 1 MTK to vitalik.eth', format: 'calldata', rawValue: inner },
        },
      }
    );
    deepStrictEqual(calls.includes('eth_getLogs'), true);
    deepStrictEqual(calls.includes('eth_getBlockByNumber'), true);
  });
  should('clearSigCallbacks supplies the standard archive resolvers', async () => {
    const { archive, calls } = rpc();
    const opts = archive.clearSigCallbacks();
    const token = ethHex.encode(
      createContract(ABI).tokenResolve.encodeInput({ token: TOKEN, amount: 123456n })
    );
    deepStrictEqual(
      await calldata({ to: TARGET, data: token, chainId: 1n }, { ...opts, clearSig: DIRECT_CLEAR }),
      {
        intent: 'Token Lookup',
        interpolatedIntent: 'Token Lookup MTK 0.123456 MTK',
        structuredIntent: [
          'Token Lookup ',
          { value: 'MTK', format: 'tokenTicker', rawValue: TOKEN },
          ' ',
          { value: '0.123456 MTK', format: 'tokenAmount', rawValue: 123456n },
        ],
        fields: {
          Token: { value: 'MTK', format: 'tokenTicker', rawValue: TOKEN },
          Amount: { value: '0.123456 MTK', format: 'tokenAmount', rawValue: 123456n },
        },
      }
    );
    const nft = ethHex.encode(
      createContract(ABI).nftResolve.encodeInput({ collection: NFT, tokenId: 42n })
    );
    deepStrictEqual(
      await calldata({ to: TARGET, data: nft, chainId: 1n }, { ...opts, clearSig: DIRECT_CLEAR }),
      {
        intent: 'NFT Lookup',
        interpolatedIntent: 'NFT Lookup Archive NFT #42',
        structuredIntent: [
          'NFT Lookup ',
          { value: 'Archive NFT #42', format: 'nftName', rawValue: 42n },
        ],
        fields: { NFT: { value: 'Archive NFT #42', format: 'nftName', rawValue: 42n } },
      }
    );
    // ERC-20 contracts are not NFT collections: the standard resolver declines and
    // the renderer falls back to the raw token id.
    const erc20nft = ethHex.encode(
      createContract(ABI).nftResolve.encodeInput({ collection: TOKEN, tokenId: 42n })
    );
    deepStrictEqual(
      await calldata(
        { to: TARGET, data: erc20nft, chainId: 1n },
        { ...opts, clearSig: DIRECT_CLEAR }
      ),
      {
        intent: 'NFT Lookup',
        interpolatedIntent: 'NFT Lookup 42',
        structuredIntent: ['NFT Lookup ', { value: '42', format: 'nftName', rawValue: 42n }],
        fields: { NFT: { value: '42', format: 'nftName', rawValue: 42n } },
      }
    );
    const block = ethHex.encode(createContract(ABI).blockResolve.encodeInput(19332140n));
    deepStrictEqual(
      await calldata({ to: TARGET, data: block, chainId: 1n }, { ...opts, clearSig: DIRECT_CLEAR }),
      {
        intent: 'Block Lookup',
        interpolatedIntent: 'Block Lookup Thu, 29 Feb 2024 09:00:35 GMT',
        structuredIntent: [
          'Block Lookup ',
          { value: 'Thu, 29 Feb 2024 09:00:35 GMT', format: 'date', rawValue: 19332140n },
        ],
        fields: {
          Block: { value: 'Thu, 29 Feb 2024 09:00:35 GMT', format: 'date', rawValue: 19332140n },
        },
      }
    );
    deepStrictEqual(calls.includes('eth_getBlockByNumber'), true);
  });

  should('discoverTx binds generic descriptors for a probed unknown token', async () => {
    // The mock TOKEN contract is in no registry and no repository: online probing
    // detects ERC-20 metadata, binds ercs/calldata-erc20-tokens.json through the
    // token map, and the descriptor's format-key ABI supplies the signature info.
    const { archive, calls } = rpc();
    const tx = Transaction.prepare({
      to: TOKEN,
      chainId: 1n,
      nonce: 0n,
      maxFeePerGas: 10_000_000_000n,
      value: 0n,
      data: ethHex.encode(
        createContract(ERC20_ABI).transfer.encodeInput({ to: ACCOUNT, value: 123456n })
      ),
    })
      .signBy(KEY, false)
      .toHex();
    const decoded = await archive.discoverTx(tx, {
      'erc20.json': OURS['ercs/calldata-erc20-tokens.json'],
    });
    if (!decoded || Array.isArray(decoded) || !decoded.clearSig)
      throw new Error('missing discovered clearSig');
    const { clearSig, ...info } = decoded;
    deepStrictEqual(info, {
      name: 'transfer',
      signature: 'transfer(address,uint256)',
      value: { _to: ACCOUNT, _value: 123456n },
    });
    deepStrictEqual(await clearSig, {
      intent: 'Send',
      interpolatedIntent: `Transfer 0.123456 MTK to ${ACCOUNT}`,
      structuredIntent: [
        'Transfer ',
        { value: '0.123456 MTK', format: 'tokenAmount', rawValue: 123456n },
        ' to ',
        { value: ACCOUNT, format: 'addressName', rawValue: ACCOUNT },
      ],
      fields: {
        Amount: { value: '0.123456 MTK', format: 'tokenAmount', rawValue: 123456n },
        To: { value: ACCOUNT, format: 'addressName', rawValue: ACCOUNT },
      },
    });
    deepStrictEqual(calls.includes('eth_call'), true);
  });

  should('decodes raw transaction hex before rendering clear signing', async () => {
    const { archive } = rpc();
    const inner = createContract(ERC20_ABI).transfer.encodeInput({ to: ACCOUNT, value: 1000000n });
    const data = ethHex.encode(
      createContract(ABI).archiveResolve.encodeInput({
        token: TOKEN,
        account: ACCOUNT,
        amount: 123456n,
        collection: NFT,
        tokenId: 42n,
        blockNumber: 19332140n,
        interop: new Uint8Array([1, 2, 3]),
        inner,
      })
    );
    const tx = Transaction.prepare({
      to: TARGET,
      chainId: 1n,
      nonce: 0n,
      maxFeePerGas: 10_000_000_000n,
      value: 0n,
      data,
    })
      .signBy(KEY, false)
      .toHex();
    const decoded = decodeTx(tx, {
      noDefault: true,
      customContracts: { [TARGET]: { abi: ABI } },
      clearSig: { 'archive.json': DIRECT_CLEAR },
      async resolveToken(req) {
        const info = await archive.tokenInfo(req.address);
        if ('error' in info || info.abi !== 'ERC20') return;
        return { name: info.name, symbol: info.symbol, decimals: info.decimals };
      },
      async resolveAddress(req) {
        await archive.call('eth_getCode', req.address, 'latest');
        return { name: 'vitalik.eth', source: 'archive', verified: true };
      },
      async resolveNft(req) {
        const info = await archive.tokenInfo(req.collection);
        if ('error' in info) return;
        const uri = await archive.tokenURI(info, req.tokenId);
        return {
          name: `${info.name} #${req.tokenId}`,
          source: typeof uri === 'string' ? uri : undefined,
          verified: true,
        };
      },
      async resolveBlock(req) {
        return Math.floor((await archive.blockInfo(Number(req.block))).timestamp / 1000);
      },
      async resolveChain(req) {
        deepStrictEqual(await archive.call('eth_chainId'), `0x${req.chainId.toString(16)}`);
        return { name: 'Ethereum Mainnet', ticker: 'ETH' };
      },
      async resolveInteroperableAddress(req) {
        await archive.call('eth_chainId');
        return `ens:${ethHex.encode(req.value).slice(2)}`;
      },
      async resolveCalldata(req) {
        await archive.tokenInfo(req.to);
        return INNER_CLEAR;
      },
    });
    if (!decoded || Array.isArray(decoded) || !decoded.clearSig)
      throw new Error('missing decoded clearSig');
    const { clearSig, ...info } = decoded;
    const res = await clearSig;
    if (!res) throw new Error('missing clearSig result');
    deepStrictEqual(info, {
      name: 'archiveResolve',
      signature: 'archiveResolve(address,address,uint256,address,uint256,uint256,bytes,bytes)',
      value: {
        token: TOKEN,
        account: ACCOUNT,
        amount: 123456n,
        collection: NFT,
        tokenId: 42n,
        blockNumber: 19332140n,
        interop: new Uint8Array([1, 2, 3]),
        inner,
      },
    });
    deepStrictEqual(
      JSON.parse(
        JSON.stringify(
          { decoded: info, clearSig: res },
          (_, value) => {
            if (typeof value === 'bigint') return value.toString();
            if (value instanceof Uint8Array) return Array.from(value);
            return value;
          },
          2
        )
      ).clearSig.fields.Call.rawValue,
      Array.from(inner)
    );
  });
  should('renders split resolver transaction types from raw tx hex', async () => {
    const { archive } = rpc();
    const sign = (data: string) =>
      Transaction.prepare({
        to: TARGET,
        chainId: 1n,
        nonce: 0n,
        maxFeePerGas: 10_000_000_000n,
        value: 0n,
        data,
      })
        .signBy(KEY, false)
        .toHex();
    const opt = {
      noDefault: true,
      customContracts: { [TARGET]: { abi: ABI } },
      clearSig: { 'archive.json': DIRECT_CLEAR },
      async resolveToken(req) {
        const info = await archive.tokenInfo(req.address);
        if ('error' in info || info.abi !== 'ERC20') return;
        return { name: info.name, symbol: info.symbol, decimals: info.decimals };
      },
      async resolveAddress(req) {
        await archive.call('eth_getCode', req.address, 'latest');
        return { name: 'vitalik.eth', source: 'archive', verified: true };
      },
      async resolveNft(req) {
        const info = await archive.tokenInfo(req.collection);
        if ('error' in info) return;
        const uri = await archive.tokenURI(info, req.tokenId);
        return {
          name: `${info.name} #${req.tokenId}`,
          source: typeof uri === 'string' ? uri : undefined,
          verified: true,
        };
      },
      async resolveBlock(req) {
        return Math.floor((await archive.blockInfo(Number(req.block))).timestamp / 1000);
      },
      async resolveCalldata(req) {
        await archive.tokenInfo(req.to);
        return INNER_CLEAR;
      },
    };
    const token = decodeTx(
      sign(
        ethHex.encode(
          createContract(ABI).tokenResolve.encodeInput({ token: TOKEN, amount: 123456n })
        )
      ),
      opt
    );
    if (!token || Array.isArray(token) || !token.clearSig)
      throw new Error('missing token clearSig');
    deepStrictEqual(await token.clearSig, {
      intent: 'Token Lookup',
      interpolatedIntent: 'Token Lookup MTK 0.123456 MTK',
      structuredIntent: [
        'Token Lookup ',
        { value: 'MTK', format: 'tokenTicker', rawValue: TOKEN },
        ' ',
        { value: '0.123456 MTK', format: 'tokenAmount', rawValue: 123456n },
      ],
      fields: {
        Token: { value: 'MTK', format: 'tokenTicker', rawValue: TOKEN },
        Amount: { value: '0.123456 MTK', format: 'tokenAmount', rawValue: 123456n },
      },
    });
    const nft = decodeTx(
      sign(
        ethHex.encode(createContract(ABI).nftResolve.encodeInput({ collection: NFT, tokenId: 42n }))
      ),
      opt
    );
    if (!nft || Array.isArray(nft) || !nft.clearSig) throw new Error('missing nft clearSig');
    deepStrictEqual(await nft.clearSig, {
      intent: 'NFT Lookup',
      interpolatedIntent: 'NFT Lookup Archive NFT #42',
      structuredIntent: [
        'NFT Lookup ',
        { value: 'Archive NFT #42', format: 'nftName', rawValue: 42n },
      ],
      fields: { NFT: { value: 'Archive NFT #42', format: 'nftName', rawValue: 42n } },
    });
    const block = decodeTx(
      sign(ethHex.encode(createContract(ABI).blockResolve.encodeInput(19332140n))),
      opt
    );
    if (!block || Array.isArray(block) || !block.clearSig)
      throw new Error('missing block clearSig');
    deepStrictEqual(await block.clearSig, {
      intent: 'Block Lookup',
      interpolatedIntent: 'Block Lookup Thu, 29 Feb 2024 09:00:35 GMT',
      structuredIntent: [
        'Block Lookup ',
        { value: 'Thu, 29 Feb 2024 09:00:35 GMT', format: 'date', rawValue: 19332140n },
      ],
      fields: {
        Block: {
          value: 'Thu, 29 Feb 2024 09:00:35 GMT',
          format: 'date',
          rawValue: 19332140n,
        },
      },
    });
    const inner = createContract(ERC20_ABI).transfer.encodeInput({ to: ACCOUNT, value: 1000000n });
    const nested = decodeTx(
      sign(ethHex.encode(createContract(ABI).nestedResolve.encodeInput({ token: TOKEN, inner }))),
      opt
    );
    if (!nested || Array.isArray(nested) || !nested.clearSig)
      throw new Error('missing nested clearSig');
    deepStrictEqual(await nested.clearSig, {
      intent: 'Nested Call',
      interpolatedIntent: 'Nested Call Send 1 MTK to vitalik.eth',
      structuredIntent: [
        'Nested Call ',
        { value: 'Send 1 MTK to vitalik.eth', format: 'calldata', rawValue: inner },
      ],
      fields: { Call: { value: 'Send 1 MTK to vitalik.eth', format: 'calldata', rawValue: inner } },
    });
  });
  should('encodes real demo NFT preset address as raw tx hex', async () => {
    const data = ethHex.encode(
      createContract(ABI).nftResolve.encodeInput({ collection: BAYC, tokenId: 1n })
    );
    const tx = Transaction.prepare({
      to: TARGET,
      chainId: 1n,
      nonce: 0n,
      maxFeePerGas: 10_000_000_000n,
      value: 0n,
      data,
    })
      .signBy(KEY, false)
      .toHex();
    const decoded = decodeTx(tx, {
      noDefault: true,
      customContracts: { [TARGET]: { abi: ABI } },
      clearSig: { 'archive.json': DIRECT_CLEAR },
    });
    if (!decoded || Array.isArray(decoded) || !decoded.clearSig)
      throw new Error('missing nft clearSig');
    const { clearSig, ...info } = decoded;
    deepStrictEqual(info, {
      name: 'nftResolve',
      signature: 'nftResolve(address,uint256)',
      value: { collection: BAYC, tokenId: 1n },
    });
    deepStrictEqual(await clearSig, {
      intent: 'NFT Lookup',
      interpolatedIntent: 'NFT Lookup 1',
      structuredIntent: ['NFT Lookup ', { value: '1', format: 'nftName', rawValue: 1n }],
      fields: { NFT: { value: '1', format: 'nftName', rawValue: 1n } },
    });
  });
  should('renders a real mainnet raw tx with built-in clear-signing metadata', async () => {
    const decoded = decodeTx(USDT_TX, { clearSig: CLEARSIG_REPO });
    if (!decoded || Array.isArray(decoded) || !decoded.clearSig)
      throw new Error('missing decoded clearSig');
    const { clearSig, ...info } = decoded;
    deepStrictEqual(info, {
      name: 'transfer',
      signature: 'transfer(address,uint256)',
      value: {
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        value: 22588000000n,
      },
    });
    deepStrictEqual(await clearSig, {
      intent: 'Send',
      interpolatedIntent: 'Transfer 22588 USDT to 0xdac17f958d2ee523a2206206994597c13d831ec7',
      structuredIntent: [
        'Transfer ',
        { value: '22588 USDT', format: 'tokenAmount', rawValue: 22588000000n },
        ' to ',
        {
          value: '0xdac17f958d2ee523a2206206994597c13d831ec7',
          format: 'addressName',
          rawValue: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        },
      ],
      fields: {
        Amount: { value: '22588 USDT', format: 'tokenAmount', rawValue: 22588000000n },
        To: {
          value: '0xdac17f958d2ee523a2206206994597c13d831ec7',
          format: 'addressName',
          rawValue: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        },
      },
    });
  });
});

should.runWhen(import.meta.url);
