# micro-eth-signer

Minimal library for Ethereum transactions, addresses and smart contracts.

- 🔓 Secure: 3 deps, audited [noble](https://paulmillr.com/noble/) cryptography, no network code
- 🔻 Tree-shaking-friendly: use only what's necessary, other code won't be included
- 🔍 Reliable: 150MB of test vectors from EIPs, ethers and viem
- ✍️ Create, sign and decode transactions using human-readable hints
- 🌍 Fetch historical transactions and token balances from an archive node
- 🆎 Call smart contracts: Chainlink and Uniswap APIs are included
- 🦺 Typescript-friendly ABI, RLP and SSZ decoding
- 🪶 1200 lines for core functionality

Check out article [ZSTs, ABIs, stolen keys and broken legs](https://github.com/paulmillr/micro-eth-signer/discussions/20) about caveats of secure ABI parsing found during development of the library.

_Check out all web3 utility libraries:_ [ETH](https://github.com/paulmillr/micro-eth-signer), [BTC](https://github.com/paulmillr/scure-btc-signer), [SOL](https://github.com/paulmillr/micro-sol-signer)

## Usage

> npm install micro-eth-signer

We support all major platforms and runtimes.
For [Deno](https://deno.land), ensure to use [npm specifier](https://deno.land/manual@v1.28.0/node/npm_specifiers).
For React Native, you may need a [polyfill for getRandomValues](https://github.com/LinusU/react-native-get-random-values).
If you don't like NPM, a standalone [eth-signer.js](https://github.com/paulmillr/micro-eth-signer/releases) is also available.

- [Transactions: create, sign](#create-and-sign-transactions)
- [Addresses: create, checksum](#create-and-checksum-addresses)
- [Generate random wallet](#generate-random-keys-and-addresses)
- [Fetch balances and history using RPC](#fetch-balances-and-history-using-rpc)
- [Call smart contracts](#call-smart-contracts)
  - [Fetch Chainlink oracle prices](#fetch-chainlink-oracle-prices)
  - [Swap tokens with Uniswap](#swap-tokens-with-uniswap)
- [ABI type inference](#abi-type-inference)
- Parsing
  - [Human-readable transaction hints](#human-readable-transaction-hints)
  - [Human-readable event hints](#human-readable-event-hints)
  - [RLP parsing](#rlp-parsing)
  - [SSZ parsing](#ssz-parsing)
- [Sign and verify messages](#sign-and-verify-messages)
- [Security](#security)
- [Performance](#performance)
- [License](#license)

### Transactions: create, sign

```ts
import { addr, amounts, Transaction } from 'micro-eth-signer';
const privateKey = '0x6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e';
const senderAddr = addr.fromPrivateKey(privateKey);
const unsignedTx = Transaction.prepare({
  to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
  maxFeePerGas: 100n * amounts.GWEI, // 100 gwei in wei
  value: 1n * amounts.ETHER, // 1 eth in wei
  nonce: 0n,
});
const tx = unsignedTx.signBy(privateKey); // Uint8Array is also accepted
console.log('signed tx', tx, tx.toHex());
console.log('need total wei', tx.calcAmounts().wei.amountWithFee);
console.log('address is same', tx.sender === senderAddr);
```

We support legacy, EIP2930, EIP1559 and EIP4844 (Dencun / Cancun) transactions.

### Addresses: create, checksum

```ts
import { addr } from 'micro-eth-signer';
const priv = '0x0687640ee33ef844baba3329db9e16130bd1735cbae3657bd64aed25e9a5c377';
const pub = '030fba7ba5cfbf8b00dd6f3024153fc44ddda93727da58c99326eb0edd08195cdb';
const nonChecksummedAddress = '0x0089d53f703f7e0843953d48133f74ce247184c2';
const checksummedAddress = addr.addChecksum(nonChecksummedAddress);
console.log(
  checksummedAddress, // 0x0089d53F703f7E0843953D48133f74cE247184c2
  addr.verifyChecksum(checksummedAddress), // true
  addr.verifyChecksum(nonChecksummedAddress), // also true
  addr.fromPrivateKey(priv),
  addr.fromPublicKey(pub)
);
```

### Generate random wallet

```ts
import { addr } from 'micro-eth-signer';
const random = addr.random(); // Secure: uses CSPRNG
console.log(random.privateKey, random.address);
// 0x17ed046e6c4c21df770547fad9a157fd17b48b35fe9984f2ff1e3c6a62700bae
// 0x26d930712fd2f612a107A70fd0Ad79b777cD87f6
```

### Fetch balances and history using RPC

```ts
import { TxProvider, calcTransfersDiff } from 'micro-eth-signer/net/tx';
const txp = TxProvider(fetchProvider(fetch));
const addr = '0x26d930712fd2f612a107A70fd0Ad79b777cD87f6';
const _2 = await txp.height();
const _3 = await txp.transfers(addr);
const _4 = await txp.allowances(addr);
const _5 = await txp.tokenBalances(addr);
// High-level methods are `height`, `unspent`, `transfers`, `allowances` and `tokenBalances`.
//
// Low-level methods are `blockInfo`, `internalTransactions`, `ethLogs`, `tokenTransfers`, `wethTransfers`,
// `tokenInfo` and `txInfo`.
```

An archive node is required. Reth has 100-block window limit, which means it's too slow for now.

### Call smart contracts

User explicitly passes built-in function `fetch` to enable network access to JSON-RPC web3 node.

#### Fetch Chainlink oracle prices

```ts
import FetchProvider from 'micro-eth-signer/net/provider';
import Chainlink from 'micro-eth-signer/net/chainlink';
const provider = new FetchProvider(thisGlobal.fetch, 'https://nodes.mewapi.io/rpc/eth', {
  Origin: 'https://www.myetherwallet.com',
});
const link = new Chainlink(provider);
const btc = await link.coinPrice('BTC');
const bat = await link.tokenPrice('BAT');
console.log({ btc, bat }); // BTC 19188.68870991, BAT 0.39728989 in USD
```

#### Swap tokens with Uniswap

> Btw cool tool, glad you built it!

_Uniswap Founder_

Swap 12.12 USDT to BAT with uniswap V3 defaults of 0.5% slippage, 30 min expiration.

```ts
import { tokenFromSymbol } from 'micro-eth-signer/abi';
import FetchProvider from 'micro-eth-signer/net/provider';
// import Uniswap2 from 'micro-eth-signer/net/uniswap-v2';
import Uniswap3 from 'micro-eth-signer/net/uniswap-v3';

const provider = new FetchProvider(thisGlobal.fetch, 'https://nodes.mewapi.io/rpc/eth', {
  Origin: 'https://www.myetherwallet.com',
});
const USDT = tokenFromSymbol('USDT');
const BAT = tokenFromSymbol('BAT');
const u3 = new Uniswap3(provider); // or new UniswapV2(provider)
const fromAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const toAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const swap = await u3.swap(USDT, BAT, '12.12', { slippagePercent: 0.5, ttl: 30 * 60 });
const swapData = await swap.tx(fromAddress, toAddress);
console.log(swapData.amount, swapData.expectedAmount, swapData.allowance);
```

### ABI type inference

The ABI is type-safe when `as const` is specified:

```ts
import { createContract } from 'micro-eth-signer/abi';
const PAIR_CONTRACT = [
  {
    type: 'function',
    name: 'getReserves',
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
  },
] as const;

const contract = createContract(PAIR_CONTRACT);
// Would create following typescript type:
{
  getReserves: {
    encodeInput: () => Uint8Array;
    decodeOutput: (b: Uint8Array) => {
      reserve0: bigint;
      reserve1: bigint;
      blockTimestampLast: bigint;
    };
  }
}
```

We're parsing values as:

```js
// no inputs
{} -> encodeInput();
// single input
{inputs: [{type: 'uint'}]} -> encodeInput(bigint);
// all inputs named
{inputs: [{type: 'uint', name: 'lol'}, {type: 'address', name: 'wut'}]} -> encodeInput({lol: bigint, wut: string})
// at least one input is unnamed
{inputs: [{type: 'uint', name: 'lol'}, {type: 'address'}]} -> encodeInput([bigint, string])
// Same applies for output!
```

There are following limitations:

- Fixed size arrays can have 999 elements at max: string[], string[1], ..., string[999]
- Fixed size 2d arrays can have 39 elements at max: string[][], string[][1], ..., string[39][39]
- Which is enough for almost all cases
- ABI must be described as constant value: `[...] as const`
- We're not able to handle contracts with method overload (same function names with different args) — the code will still work, but not types

Check out [`src/net/ens.ts`](./src/net/ens.ts) for type-safe contract execution example.

### Parsers

#### Human-readable transaction hints

The transaction sent ERC-20 USDT token between addresses. The library produces a following hint:

> Transfer 22588 USDT to 0xdac17f958d2ee523a2206206994597c13d831ec7

```ts
import { decodeTx } from 'micro-eth-signer/abi';

const tx =
  '0xf8a901851d1a94a20082c12a94dac17f958d2ee523a2206206994597c13d831ec780b844a9059cbb000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000000000000000000000000000000000054259870025a066fcb560b50e577f6dc8c8b2e3019f760da78b4c04021382ba490c572a303a42a0078f5af8ac7e11caba9b7dc7a64f7bdc3b4ce1a6ab0a1246771d7cc3524a7200';
// Decode tx information
deepStrictEqual(decodeTx(tx), {
  name: 'transfer',
  signature: 'transfer(address,uint256)',
  value: {
    to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    value: 22588000000n,
  },
  hint: 'Transfer 22588 USDT to 0xdac17f958d2ee523a2206206994597c13d831ec7',
});
```

Or if you have already decoded tx:

```ts
import { decodeData } from 'micro-eth-signer/abi';

const to = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const data =
  '7ff36ab5000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000080000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000106d3c66d22d2dd0446df23d7f5960752994d600';
const value = 100000000000000000n;

deepStrictEqual(decodeData(to, data, value, { customContracts }), {
  name: 'swapExactETHForTokens',
  signature: 'swapExactETHForTokens(uint256,address[],address,uint256)',
  value: {
    amountOutMin: 12345678901234567891n,
    path: [
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      '0x106d3c66d22d2dd0446df23d7f5960752994d600',
    ],
    to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    deadline: 1876543210n,
  },
});

// With custom tokens/contracts
const customContracts = {
  '0x106d3c66d22d2dd0446df23d7f5960752994d600': { abi: 'ERC20', symbol: 'LABRA', decimals: 9 },
};
deepStrictEqual(decodeData(to, data, value, { customContracts }), {
  name: 'swapExactETHForTokens',
  signature: 'swapExactETHForTokens(uint256,address[],address,uint256)',
  value: {
    amountOutMin: 12345678901234567891n,
    path: [
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      '0x106d3c66d22d2dd0446df23d7f5960752994d600',
    ],
    to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    deadline: 1876543210n,
  },
  hint: 'Swap 0.1 ETH for at least 12345678901.234567891 LABRA. Expires at Tue, 19 Jun 2029 06:00:10 GMT',
});
```

#### Human-readable event hints

Decoding the event produces the following hint:

> Allow 0xe592427a0aece92de3edee1f18e0157c05861564 spending up to 1000 BAT from 0xd8da6bf26964af9d7eed9e03e53415d37aa96045

```ts
import { decodeEvent } from 'micro-eth-signer/abi';

const to = '0x0d8775f648430679a709e98d2b0cb6250d2887ef';
const topics = [
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
  '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
  '0x000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564',
];
const data = '0x00000000000000000000000000000000000000000000003635c9adc5dea00000';
const einfo = decodeEvent(to, topics, data);
console.log(einfo);
```

#### RLP parsing

We implement RLP in just 100 lines of code, powered by [packed](https://github.com/paulmillr/micro-packed):

```ts
import { RLP } from 'micro-eth-signer/rlp';
RLP.decode(RLP.encode('dog'));
```

#### SSZ parsing

Simple serialize (SSZ) is the serialization method used on the Beacon Chain.
We implement RLP in just 900 lines of code, powered by [packed](https://github.com/paulmillr/micro-packed):

```ts
import * as ssz from 'micro-eth-signer/ssz';
```

### Sign and verify messages

EIP-712 is not supported yet.

```ts
import { addr, messenger } from 'micro-eth-signer';
const { privateKey, address } = addr.random();
const msg = 'noble';
const sig = messenger.sign(msg, privateKey);
const isValid = messenger.verify(sig, msg, address);
```

## Security

Main points to consider when auditing the library:

- ABI correctness
  - All ABI JSON should be compared to some external source
  - There are different databases of ABI: one is hosted by Etherscan, when you open contract page
- Network access
  - There must be no network calls in the library
  - Some functionality requires network: these need external network interface, conforming to `Web3Provider`
  - `createContract(abi)` should create purely offline contract
  - `createContract(abi, net)` would create contract that calls network using `net`, using external interface
- Skipped test vectors
  - There is `SKIPPED_ERRORS`, which contains list of test vectors from other libs that we skip
  - They are skipped because we consider them invalid, or so
  - If you believe they're skipped for wrong reasons, investigate and report

The library is cross-tested against other libraries (last update on 25 Feb 2024):

- ethereum-tests v13.1
- ethers 6.11.1
- viem v2.7.13

## Performance

Transaction signature matches `noble-curves` `sign()` speed,
which means over 4000 times per second on macs.

The first call of `sign` will take 20ms+ due to noble-curves secp256k1 `utils.precompute`.

To run benchmarks, execute `npm run bench`.

## Contributing

Make sure to use recursive cloning for tests:

    git clone --recursive https://github.com/paulmillr/micro-eth-signer.git

## License

MIT License

Copyright (c) 2021 Paul Miller (https://paulmillr.com)
