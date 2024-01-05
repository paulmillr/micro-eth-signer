# micro-eth-signer

Create, sign and validate Ethereum transactions & addresses with minimum deps.

- Tiny: 500 lines of code, 3KB gzipped, 13KB bundled
- 3 dependencies: noble-hashes for sha3, noble-curves for secp256k1, rlp
- No network code in main package: allows simpler audits and offline usage
- Validated against 3MB of [ethers](https://github.com/ethers-io/ethers.js/) test vectors
- Using audited [noble](https://paulmillr.com/noble/) cryptography under the hood

Typesafe Web3 with minimum deps: call eth contracts directly from JS. Batteries included.

- Connect to web3 nodes
- Write typesafe code with auto inference of TypeScript types from ABI JSON
- Fetch token balances, resolve ENS domains, watch token prices with chainlink web3 oracle
- Decode transactions: create readable tx descriptions from tx data & ABIs
- No network code in main package: allows simpler audits and offline usage

*Check out all web3 utility libraries:* [ETH](https://github.com/paulmillr/micro-eth-signer), [BTC](https://github.com/paulmillr/scure-btc-signer), [SOL](https://github.com/paulmillr/micro-sol-signer), [tx-tor-broadcaster](https://github.com/paulmillr/tx-tor-broadcaster)

## Usage

> npm install micro-eth-signer

We support all major platforms and runtimes.
For [Deno](https://deno.land), ensure to use [npm specifier](https://deno.land/manual@v1.28.0/node/npm_specifiers).
For React Native, you may need a [polyfill for getRandomValues](https://github.com/LinusU/react-native-get-random-values).
If you don't like NPM, a standalone [eth-signer.js](https://github.com/paulmillr/micro-eth-signer/releases) is also available.

```js
import { Address, Transaction } from 'micro-eth-signer';

const tx = new Transaction({
  to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
  maxFeePerGas: 100n * 10n ** 9n, // 100 gwei in wei
  value: 10n ** 18n, // 1 eth in wei
  nonce: 1,
  maxPriorityFeePerGas: 0,
  chainId: 1
});

// keys, messages & other inputs can be Uint8Arrays or hex strings
// Uint8Array.from([0xde, 0xad, 0xbe, 0xef]) === 'deadbeef'
const privateKey = '6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e';
const signedTx = tx.sign(privateKey);
const { hash, hex } = signedTx;

// Strings can be used also
// tx = new Transaction({"nonce": "0x01"})
// Same goes to serialized representation
// tx = new Transaction('0xeb018502540be40082520894df90dea0e0bf5ca6d2a7f0cb86874ba6714f463e872386f26fc1000080808080');

// Various tx properties
console.log('Need wei', tx.upfrontCost); // also, tx.fee, tx.amount, tx.sender, etc

// Address manipulation
const addr = Address.fromPrivateKey(privateKey);
const pubKey = signedTx.recoverSenderPublicKey();
console.log('Verified', Address.verifyChecksum(addr));
console.log('addr is correct', signedTx.sender, signedTx.sender == addr);
console.log(signedTx);

// London style txs, EIP 1559
const legacyTx = new Transaction({
  to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
  gasPrice: 100n * 10n ** 9n, // 100 gwei in wei
  value: 10n ** 18n, // 1 eth in wei
  nonce: 1
}, undefined, undefined, 'legacy');

const berlinTx = new Transaction({
  to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
  maxFeePerGas: 100n * 10n ** 9n, // 100 gwei in wei
  maxPriorityFeePerGas: 1n * 10n ** 9n, // 1 gwei in wei
  value: 10n ** 18n, // 1 eth in wei
  nonce: 1,
  // the field can also be used in eip1559 txs
  accessList: [{
    "address": "0x123456789a123456789a123456789a123456789a",
    "storageKeys": [
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    ]
  }]
}, undefined, undefined, 'eip2930');
```


```ts
import web3 from 'micro-eth-signer/web3';
import contracts from 'micro-eth-signer/web3/contracts';
import web3net from 'micro-eth-signer/web3-net';
const DEF_CONTRACTS = contracts.DEFAULT_CONTRACTS;
```

### Decode transactions without network

```ts
import { hex } from '@scure/base';
const tx =
  'a9059cbb000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec70000000000000000000000000000000000000000000000000000000542598700';
const decoder = new web3.Decoder();
const USDT = contracts.tokenFromSymbol('USDT').contract;
decoder.add(USDT, contracts.ERC20);
const info = decoder.decode(USDT, hex.decode(tx), { contractInfo: DEF_CONTRACTS[USDT] });
console.log(info);
// { name: 'transfer', signature: 'transfer(address,uint256)',
// value: { to: '0xdac17f958d2ee523a2206206994597c13d831ec7', value: 22588000000n },
// hint: 'Transfer 22588 USDT to 0xdac17f958d2ee523a2206206994597c13d831ec7' }
```

### Decode events

```ts
const BAT = '0x0d8775f648430679a709e98d2b0cb6250d2887ef';
const decoder = new web3.Decoder();
decoder.add(BAT, contracts.ERC20);
const info = decoder.decodeEvent(
  BAT,
  [
    '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
    '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
    '0x000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564',
  ],
  '0x00000000000000000000000000000000000000000000003635c9adc5dea00000',
  { contract: BAT, contracts: { ...DEF_CONTRACTS }, contractInfo: DEF_CONTRACTS[BAT] }
);
console.log(info.hint);
// Allow 0xe592427a0aece92de3edee1f18e0157c05861564 spending up to 1000 BAT from 0xd8da6bf26964af9d7eed9e03e53415d37aa96045
```

### Fetch Chainlink oracle prices

```ts
import chainlink from 'micro-eth-signer/web3/api/chainlink';
const provider = new web3net.Web3({
  url: 'https://nodes.mewapi.io/rpc/eth',
  headers: { Origin: 'https://www.myetherwallet.com' },
});
const btc = await chainlink.coinPrice(provider, 'BTC');
const bat = await chainlink.tokenPrice(provider, 'BAT');
console.log({ btc, bat }); // BTC 19188.68870991, BAT 0.39728989 in USD
```

### Uniswap

Swap 12.12 USDT to BAT with uniswap V3 defaults of 0.5% slippage, 30 min expiration.

```ts
import univ2 from 'micro-eth-signer/web3/api/uniswap-v2';
import univ3 from 'micro-eth-signer/web3/api/uniswap-v3';

const provider = new web3net.Web3({
  url: 'https://nodes.mewapi.io/rpc/eth',
  headers: { Origin: 'https://www.myetherwallet.com' },
});
const USDT = contracts.tokenFromSymbol('USDT');
const BAT = contracts.tokenFromSymbol('BAT');
const u3 = new univ3.UniswapV3(provider); // or new univ2.UniswapV2(provider)
const fromAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const toAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const swap = await u3.swap(USDT, BAT, '12.12', { slippagePercent: 0.5, ttl: 30 * 60 });
const swapData = await swap.tx(fromAddress, toAddress);
console.log(swapData.amount, swapData.expectedAmount, swapData.allowance);
```

### Type inference

The ABI is type-safe with following limitations:

- Fixed size arrays can have 999 elements at max: string[], string[1], ..., string[999]
- Fixed size 2d arrays can have 39 elements at max: string[][], string[][1], ..., string[39][39]
- Which is enough for almost all cases
- ABI must be described as constant value: `[...] as const`
- We're not able to handle contracts with method overload (same function names with different args) — the code will still work, but not types

We're parsing values as:

```js
// no inputs
{} -> encodeInput();
// single input
{inputs: [{type: 'uint'}]} -> encodeInput(bigint);
// all inputs named
{inputs: [{type: 'uint', name: 'lol}, {type: 'address', name: 'wut'}]} -> encodeInput({lol: bigint, wut: string})
// at least one input is unnamed
{inputs: [{type: 'uint', name: 'lol}, {type: 'address'}]} -> encodeInput([bigint, string])
// Same applies for output!
```

Check out [`src/api/ens.ts`](./src/api/ens.ts) for type-safe contract execution example.

## API

### Address

Represents ETH address and has following methods:

- `Address.fromPrivateKey(privateKey: string | Uint8Array): string` - create address from private key
- `Address.fromPublicKey(publicKey: string | Uint8Array): string` - creates address from public key
- `Address.checksum(nonChecksummedAddress: string): string` - creates checksummed address from non-checksummed address
- `Address.verifyChecksum(address: string): boolean` - verifies checksummed & non-checksummed address

Usage:

```js
const addr = "0x0089d53f703f7e0843953d48133f74ce247184c2";
const addrc = Address.checksum(addr) // 0x0089d53F703f7E0843953D48133f74cE247184c2
Address.verifyChecksum(addrc) // true
Address.verifyChecksum(addr) // true also (non-checksummed)
Address.fromPrivateKey("0687640ee33ef844baba3329db9e16130bd1735cbae3657bd64aed25e9a5c377")
  // 0xD4fE407789e11a27b7888A324eC597435353dC35
Address.fromPublicKey("030fba7ba5cfbf8b00dd6f3024153fc44ddda93727da58c99326eb0edd08195cdb")
  // 0xD4fE407789e11a27b7888A324eC597435353dC35
```

### Transaction

Represents unsigned & signed ETH transactions. They are serialized & deserialized using RLP. Here's an example of the same transaction in raw state, and serialized state:

```js
// raw
{
  "nonce": "0x01", "gasLimit": "0x5208", "gasPrice": "0x02540be400",
  "to": "0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e",
  "value": "2386f26fc10000", "data": "0x"
}
// serialized
"0xeb018502540be40082520894df90dea0e0bf5ca6d2a7f0cb86874ba6714f463e872386f26fc1000080808080"
```

You can use either of those to initialize new `Transaction`. There are a few methods available:

- `new Transaction(serialized[, chain, hardfork, type])` - creates transaction from Raw TX string.
    - `chain`: optional argument (default is `mainnet`; `ropsten`, `rinkeby`, `goerli`, `kovan` etc)
    - `hardfork`: optional argument (default is `london`). The only place we're checking for `hardfork`
      is the replay protection code. There are very old transactions that don't support replay protection,
      you'll probably won't need them
    - `type`: optional argument (default is `eip1559`). Can be either `legacy`, `eip2930`, or `eip1559`
      (Berlin and London style transactions with access lists and `maxFeePerGas`/`maxPriorityFeePerGas`)
- `new Transaction(rawTx[, chain, hardfork, type])` - creates transaction from Raw TX data.
    - `rawTx` must have fields `to`, `value`, `nonce`, `gasLimit`
    - `rawTx` must have `maxFeePerGas` (eip1559 txs) or `gasPrice` (berlin & legacy txs)
    - `to` is recipient's address
    - `value` is amount to send in wei
    - `nonce` is sender's nonce in number
    - `gasLimit` is transaction's Gas Limit in wei (minimum is `21000`)
    - `maxFeePerGas` is eip1559 transaction's max acceptable gas price in wei (100 gwei is `100 * 10 ** 9`). Not applicable to legacy transactions
    - `maxPriorityFeePerGas` is eip1559 transaction's max acceptable tip in wei. Not applicable to legacy transactions
    - `gasPrice` is legacy transaction's Gas Price in wei. Not applicable to eip1559 transactions
    - `data` is transaction's data if it's calling some smart contracts
    - `accessList` is transaction's Access List, a list of addresses that its smart contract call touches. Basically an array of strings: `["0x123...", "0x456..."]`. Not applicable to legacy transactions
- `Transaction#sign(privateKey: string | Uint8Array): Transaction` —
  creates new transaction with same data, but signed by following private key
- `Transaction#recoverSenderPublicKey(): string` — recovers sender's public key from **signed transaction**

##### Transaction Properties

- `isSigned: boolean` - whether tx is signed with private key
- `gasPrice: bigint` - legacy wei/gas
- `maxFeePerGas: bigint`, `maxPriorityFeePerGas: bigint` - eip1559 wei/gas
- `amount: bigint` - amount (aka `value`) in wei
- `fee: bigint` - fee in wei (`maxFeePerGas` * `gasLimit` or `gasPrice` * `gasLimit`)
- `upfrontCost: bigint` - amount + fee in wei, combined
- `to: string` - address that receives the tx
- `nonce: number` - account's nonce
- `sender: string` - address that sends the tx. Only signed txs have the field
- `hash: string` - signed tx hash used in block explorers. Example: `50b6e7b58320c885ab7b2ee0d0b5813a697268bd2494a06de792790b13668c08`
- `raw: Object` - raw transaction's data with fields encoded as strings

### Additional modules

Those are optional:

```ts
import * as formatters from 'micro-eth-signer/formatters';
import { validateField, validateFields } from 'micro-eth-signer/tx-validator'

// formatters:
export function parseDecimal(s: string, precision: number): bigint;
export function formatDecimal(n: bigint, precision: number): string;
export function perCentDecimal(precision: number, price: number): bigint;
export function roundDecimal(n: bigint, roundPrecision: number, precision?: number, price?: number): bigint;
export function fromWei(wei: string | number | bigint): string;
export function formatUSD(amount: number): string;
```

## Performance

Transaction signature matches `noble-curves` `sign()` speed, which means over 4000 times per second on ARM Mac.

The first call of `sign` will take 20ms+ due to noble-curves secp256k1 `utils.precompute`.

To run benchmarks, execute `npm run bench`.

## License

MIT License

Copyright (c) 2021 Paul Miller (https://paulmillr.com)
