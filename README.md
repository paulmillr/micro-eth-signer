# micro-eth-signer

Minimal privacy-focused Ethereum library.

- 🔓 Core: audited [noble](https://paulmillr.com/noble/) cryptography, zero network access,
  [hedged signatures](#transactions-create-sign), 10KB gzipped, tree-shakeable
- 🦺 Opt-in modules: type-safe ABI with ERC-7730 Clear Signing, RLP, SSZ, KZG & PeerDAS, BLS keystores
- 🕵️ Privacy-first networking: account history, token & NFT balances, prices, ENS, Uniswap
  swaps — all derived from plain RPC against your own node. No Etherscan, no CoinGecko,
  no OpenSea: no third parties to leak your addresses to
- Reliable: 800MB of test vectors from EIPs, ethers and viem.

_Check out all web3 utility libraries:_ [ETH](https://github.com/paulmillr/micro-eth-signer), [BTC](https://github.com/paulmillr/scure-btc-signer), [SOL](https://github.com/paulmillr/micro-sol-signer)

## Usage

> `npm install micro-eth-signer`

> `jsr add jsr:@paulmillr/micro-eth-signer`

We support all major platforms and runtimes. React Native may need a
[polyfill for getRandomValues](https://github.com/LinusU/react-native-get-random-values).

- Core
  - [Create random wallet](#create-random-wallet)
  - [Transactions: create, sign](#transactions-create-sign)
  - [Addresses: create, checksum](#addresses-create-checksum)
  - [Messages: sign, verify](#messages-sign-verify)
- Advanced
  - [ABI parsing](#abi-parsing)
  - [Clear Signing](#clear-signing)
  - [Keystore: EIP-2333 & legacy](#keystore-eip-2333--legacy)
  - [RLP & SSZ](#rlp--ssz)
  - [KZG & PeerDAS](#kzg--peerdas)
- RPC provider
  - [Init network](#init-network)
  - [Fetch balances and history](#fetch-balances--history)
  - [Asset price quoting (uniswap, chainlink)](#asset-price-quoting-uniswap-chainlink)
  - [Resolve ENS and GNS names](#resolve-ens-and-gns-names)
  - [Swap tokens with Uniswap](#swap-tokens-with-uniswap)
- [Security](#security)
- [Speed](#speed)
- [License](#license)

## Core

```ts
import { addr, authorization, Transaction } from 'micro-eth-signer';
import { eip191Signer, recoverAddressTyped, signTyped, verifyTyped } from 'micro-eth-signer';
import { amounts, ethHex, ethHexNoLeadingZero, weieth, weigwei } from 'micro-eth-signer';
```

Core is everything done offline with a secp256k1 key — the three kinds of payloads Ethereum
signs: transactions (`Transaction`), EIP-7702 authorizations (`authorization`), and messages
(EIP-191 `eip191Signer`, EIP-712 `signTyped`), plus the addresses derived from those keys.
Heavy or specialized codecs (ABI, keystores, KZG, SSZ) live in opt-in modules instead.

### Create random wallet

```ts
import { addr } from 'micro-eth-signer';
const random = addr.random(); // Secure: uses CSPRNG
console.log(random.privateKey, random.address);
// '0x17ed046e6c4c21df770547fad9a157fd17b48b35fe9984f2ff1e3c6a62700bae'
// '0x26d930712fd2f612a107A70fd0Ad79b777cD87f6'
```

### Transactions: create, sign

```ts
import { addr, Transaction, weigwei, weieth } from 'micro-eth-signer';
const random = addr.random();
const tx = Transaction.prepare({
  to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
  value: weieth.decode('1.1'), // 1.1eth in wei
  maxFeePerGas: weigwei.decode('100'), // 100gwei in wei (priority fee is 1 gwei)
  nonce: 0n,
});
// Uses `random` from example above. Alternatively, pass 0x hex string or Uint8Array
const signedTx = tx.signBy(random.privateKey);
console.log('signed tx', signedTx, signedTx.toHex());
console.log('fee', signedTx.fee);

// Hedged signatures, with extra noise / security
const tx2 = tx.signBy(random.privateKey, true); // default, same as above
const tx3 = tx.signBy(random.privateKey, false); // disable

// Send whole account balance. See Security section for caveats
const CURRENT_BALANCE = '1.7182050000017'; // in eth
const txSendingWholeBalance = tx.setWholeAmount(weieth.decode(CURRENT_BALANCE));
```

We support legacy, EIP2930, EIP1559, EIP4844 and EIP7702 transactions.

Signing is done with [noble-curves](https://github.com/paulmillr/noble-curves), using RFC 6979.
Hedged signatures are also supported - check out the blog post
[Deterministic signatures are not your friends](https://paulmillr.com/posts/deterministic-signatures/).

### Addresses: create, checksum

```ts
import { addr } from 'micro-eth-signer';
const priv = '0x0687640ee33ef844baba3329db9e16130bd1735cbae3657bd64aed25e9a5c377';
const pub = '030fba7ba5cfbf8b00dd6f3024153fc44ddda93727da58c99326eb0edd08195cdb';
const nonChecksummedAddress = '0x0089d53f703f7e0843953d48133f74ce247184c2';
const checksummedAddress = addr.addChecksum(nonChecksummedAddress);
console.log(
  checksummedAddress, // 0x0089d53F703f7E0843953D48133f74cE247184c2
  addr.isValid(checksummedAddress), // true
  addr.isValid(nonChecksummedAddress), // also true
  addr.fromPrivateKey(priv),
  addr.fromPublicKey(pub)
);

// Contract addresses: CREATE (deployment tx) and CREATE2 (EIP-1014)
const factory = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const salt = `0x${'00'.repeat(32)}`;
const initCodeHash = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';
addr.getCreateAddress(factory, 1n);
addr.getCreate2Address(factory, salt, initCodeHash); // salt & initCodeHash are 32 bytes
```

### Messages: sign, verify

There are two messaging standards: [EIP-191](https://eips.ethereum.org/EIPS/eip-191) & [EIP-712](https://eips.ethereum.org/EIPS/eip-712).

#### EIP-191

```ts
import { eip191Signer } from 'micro-eth-signer';

// Example message
const message = 'Hello, Ethereum!';
const privateKey = '0x4c0883a69102937d6231471b5dbb6204fe512961708279f1d7b1b8e7e8b1b1e1';

// Sign the message
const signature = eip191Signer.sign(message, privateKey);
console.log('Signature:', signature);

// Verify the signature
const address = '0xYourEthereumAddress';
const isValid = eip191Signer.verify(signature, message, address);
console.log('Is valid:', isValid);

// The digest that gets signed ("hashMessage") is available directly:
eip191Signer.getHash(message);
// 65-byte wallet signatures (r || s || v) can be split & rebuilt:
import { parseSignature, serializeSignature } from 'micro-eth-signer';
const { r, s, yParity } = parseSignature(signature); // v: 0/1 or 27/28
serializeSignature({ r, s, yParity }); // back to 0x hex, v as 27/28
```

#### EIP-712

```ts
import { addr, ethHex, recoverAddressTyped, signTyped, verifyTyped } from 'micro-eth-signer';
import type { EIP712Domain, TypedData } from 'micro-eth-signer';

const types = {
  Person: [
    { name: 'name', type: 'string' },
    { name: 'wallet', type: 'address' },
  ],
  Mail: [
    { name: 'from', type: 'Person' },
    { name: 'to', type: 'Person' },
    { name: 'contents', type: 'string' },
  ],
};

// Define the domain
const domain: EIP712Domain = {
  name: 'Ether Mail',
  version: '1',
  chainId: 1n,
  verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  salt: ethHex.decode('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'),
};

// Define the message
const message = {
  from: {
    name: 'Alice',
    wallet: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  to: {
    name: 'Bob',
    wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
  },
  contents: 'Hello, Bob!',
};

// Create the typed data
const typedData: TypedData<typeof types, 'Mail'> = {
  types,
  primaryType: 'Mail',
  domain,
  message,
};

// Sign the typed data
const privateKey = '0x4c0883a69102937d6231471b5dbb6204fe512961708279f1d7b1b8e7e8b1b1e1';
const signature = signTyped(typedData, privateKey);
console.log('Signature:', signature);

// Verify the signature
const address = addr.fromPrivateKey(privateKey);
const isValid = verifyTyped(signature, typedData, address);
console.log('Is valid:', isValid);

// Recover the signer address
const recovered = recoverAddressTyped(signature, typedData);
console.log('Recovered:', recovered);
```

## Advanced

### ABI parsing

The ABI is type-safe when `as const` is specified:

```ts
import { createContract } from 'micro-eth-signer/abi.js';
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
type Contract = typeof contract;
// Contract type:
// {
//   getReserves: {
//     encodeInput: () => Uint8Array;
//     decodeOutput: (b: Uint8Array) => {
//       reserve0: bigint;
//       reserve1: bigint;
//       blockTimestampLast: bigint;
//     };
//   };
// }
```

Human-readable signatures can be parsed into JSON ABI with `parseAbi` / `parseAbiItem`.
Parsed ABIs are runtime-only: `createContract` / `events` return string-indexed untyped
methods for them, so prefer `as const` JSON ABIs when type inference matters:

```ts
import { createContract, parseAbi } from 'micro-eth-signer/abi.js';
const abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'error InsufficientBalance(uint256 available, uint256 required)',
]);
const erc20 = createContract(abi);
erc20.balanceOf.encodeInput('0x6B175474E89094C44Da98b954EedeAC495271d0F');
// Inline tuples work: 'function f((address a, uint256 b) point)'. Struct references don't.
```

Revert data of a failed call can be decoded with `decodeError`:

```ts
import { decodeError, parseAbi } from 'micro-eth-signer/abi.js';
decodeError(
  '0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001a4e6f7420656e6f7567682045746865722070726f76696465642e000000000000'
); // { name: 'Error', message: 'Not enough Ether provided.', ... }
decodeError('0x4e487b710000000000000000000000000000000000000000000000000000000000000011'); // { name: 'Panic', message: 'panic: arithmetic overflow...', ... }
// Custom errors are matched by selector against `type: 'error'` ABI entries:
decodeError(
  '0xcf47918100000000000000000000000000000000000000000000000000000000000000070000000000000000000000000000000000000000000000000000000000000009',
  parseAbi(['error InsufficientBalance(uint256 available, uint256 required)'])
);
```

We're parsing values as:

```text
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

Check out [`src/net/resolver.ts`](./src/net/resolver.ts) for a type-safe contract execution example.

### Clear Signing

The library supports [Clear Signing](https://clearsigning.org) through
ERC-7730 descriptor maps via `decodeTx`, `decodeData`, and `eip712`.

#### ERC-7730 descriptor maps

`CLEARSIG_REPO` is the batteries-included descriptor map: the generic ERC
interfaces (erc20/erc721/erc4626/...), curated and legacy contracts (uniswap
v2/v3, kyber, the metamask swap router, weth), and the built-in token registry
already bound to them - including an ERC-2612 permit binding per token.

```ts
import { CLEARSIG_REPO, addTokens } from 'micro-eth-signer/abi.js';
import { CLEARSIG_REPO_FULL } from 'micro-eth-signer/clearsig/repo-full.js';

// basic: generic ERCs + curated contracts + built-in tokens
const base = CLEARSIG_REPO;

// your own tokens: binds erc20/erc721 interfaces + an ERC-2612 permit per token
const mine = addTokens(CLEARSIG_REPO, {
  '0x0000000000000000000000000000000000000123': {
    abi: 'ERC20',
    symbol: 'MTK',
    decimals: 18,
  },
}); // chainId is optional, defaults to mainnet (1)

// full: every descriptor from the upstream registry on top.
// CLEARSIG_REPO_FULL is about 500KB of generated source; the normal ABI facade
// does not re-export it, so import this separate subpath only when needed.
const full = { ...CLEARSIG_REPO, ...CLEARSIG_REPO_FULL };
```

#### ERC-7730 transactions

`decodeTx` decodes a raw transaction through the built-in ABI and clear-signing
registries; matched transactions carry a `clearSig` promise with the rendered
intent and fields. Use `decodeData(to, data, value, opts)` when you already
have RPC calldata fields instead of full transaction hex.

Both default to `CLEARSIG_REPO` when you omit `clearSig`; pass `{ clearSig }` to
override it - with `addTokens(...)` output or your own descriptor map. Each call
returns the exact decoded call (carrying `clearSig`), an array of ABI-shape
guesses when no exact contract matches (these never carry `clearSig`), or
`undefined` for unknown selectors and contract creation - so guard with
`out && !Array.isArray(out)` before reading `clearSig`.

```ts
import { decodeTx } from 'micro-eth-signer/abi.js';

const tx =
  '0xf8a901851d1a94a20082c12a94dac17f958d2ee523a2206206994597c13d831ec780b844a9059cbb000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000000000000000000000000000000000054259870025a066fcb560b50e577f6dc8c8b2e3019f760da78b4c04021382ba490c572a303a42a0078f5af8ac7e11caba9b7dc7a64f7bdc3b4ce1a6ab0a1246771d7cc3524a7200';
const decoded = decodeTx(tx);
if (!decoded || Array.isArray(decoded)) throw new Error('expected exact ABI match');
console.log(decoded.value); // { to: '0xdac17f…31ec7', value: 22588000000n }
const clear = await decoded.clearSig;
console.log(clear.interpolatedIntent);
// 'Transfer 22588 USDT to 0xdac17f958d2ee523a2206206994597c13d831ec7'
console.log(clear.fields);
// { Amount: { value: '22588 USDT', format: 'tokenAmount', rawValue: 22588000000n },
//   To: { value: '0xdac17f…31ec7', format: 'addressName', rawValue: '0xdac17f…31ec7' } }
```

The user sees that sentence instead of raw calldata. Render `intent` as the headline and
`fields` (label -> `{ value, format, rawValue }`) as detail rows. `interpolatedIntent` (a
ready-to-print sentence) and `structuredIntent` (the same sentence split into literals and
formatted fields, for inline highlighting) are present only when the descriptor defines them —
the EIP-712 permit below renders with `intent` and `fields` alone.

Unsigned transactions decode through the same `decodeTx` - here with a custom
token bound via `addTokens`:

```ts
import { Transaction } from 'micro-eth-signer';
import { CLEARSIG_REPO, addTokens, decodeData, decodeTx } from 'micro-eth-signer/abi.js';

const to = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
const data =
  '7ff36ab5000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000080000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000106d3c66d22d2dd0446df23d7f5960752994d600';
const value = 100000000000000000n;
const customContracts = {
  '0x106d3c66d22d2dd0446df23d7f5960752994d600': { abi: 'ERC20', symbol: 'LABRA', decimals: 9 },
} as const;

// decodeData: for calldata fields you already have (to, data, value from RPC)
const call = decodeData(to, data, value, { customContracts });
// { name: 'swapExactETHForTokens', signature: 'swapExactETHForTokens(uint256,address[],address,uint256)',
//   value: { amountOutMin: 12345678901234567891n, path: [...], to: '0xd8da…6045', deadline: 1876543210n } }

// decodeTx with a clear-signing map extended by the same tokens:
const unsigned = Transaction.prepare({
  to, value, data, nonce: 0n, maxFeePerGas: 2000000000n, gasLimit: 250000n,
}).toHex({ includeSignature: false });
const decodedSwap = decodeTx(unsigned, { clearSig: addTokens(CLEARSIG_REPO, customContracts) });
if (!decodedSwap || Array.isArray(decodedSwap)) throw new Error('expected exact ABI match');
console.log((await decodedSwap.clearSig).interpolatedIntent);
// 'Swap 0.1 ETH for at least 12345678901.234567891 LABRA. Expires at Tue, 19 Jun 2029 06:00:10 GMT'
```

ERC-7730 does not describe plain value transfers (`data: '0x'`), so `decodeTx`
produces no `clearSig` for them; word those in the wallet itself (e.g.
"Send 0.5 ETH to ...") instead of showing an unknown-transaction fallback.

#### Network-backed metadata

`discoverTx(prov, tx)` wires `decodeTx` to RPC-backed callbacks. The clear-signing
renderer stays no-network by default; this path adds trusted token metadata,
names, NFT metadata, block timestamps, and factory proofs when a client is
available.

```ts
import { RpcClient } from 'micro-eth-signer/net.js';
import { discoverTx } from 'micro-eth-signer/net/clearsig.js';

async function reviewTx(prov: RpcClient, txHex: string) {
  const decoded = await discoverTx(prov, txHex);
  if (!decoded || Array.isArray(decoded)) throw new Error('expected exact ABI match');
  return decoded.clearSig;
}
```

Resolvers are independent of the network path: any `ClearSigOpt` callback -
`resolveAddress`, `resolveToken`, `resolveNft`, `resolveBlock`, `resolveChain` -
can be passed to `decodeTx`/`eip712` alongside `clearSig`, e.g.
`{ clearSig: CLEARSIG_REPO, resolveAddress: async ({ address }) => book[address] }`.
`resolveAddress` is intentionally left out of `discoverTx`'s bundle - what counts
as a trusted name is wallet policy. To teach the renderer about a non-token
contract, merge your own ERC-7730 descriptor files into the map
(`{ ...CLEARSIG_REPO, ...myDescriptors }`); descriptor maps are plain
`Record<string, ClearSigDef>`.

#### EIP-712 typed data

`eip712` defaults to `CLEARSIG_REPO` like `decodeTx`. Signature requests render
through the same repository. `addTokens` gives every ERC-20 an ERC-2612 permit
binding (the upstream permit descriptor ships
without deployments, so out of the box it matches nothing), and the bound
token metadata makes amounts render offline:

```ts
import { eip712 } from 'micro-eth-signer/abi.js';
import type { ClearSigTypedInput } from 'micro-eth-signer/abi.js';

const typed = {
  types: {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: 'Permit',
  domain: {
    name: 'USD Coin',
    version: '2',
    chainId: 1,
    verifyingContract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  },
  message: {
    owner: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    spender: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    value: 25000000n,
    nonce: 0n,
    deadline: 1893456000n,
  },
} as const;
const clear = (await eip712(typed as unknown as ClearSigTypedInput))!;
console.log(clear.intent); // 'Authorize spending of tokens'
console.log(clear.fields['Max spending amount']);
// { value: '25 USDC', format: 'tokenAmount', rawValue: 25000000n }
// other fields: Spender (raw address), 'Valid until' (date)
```

#### Decoding events

Receipt logs are post-transaction facts, not ERC-7730 signing prompts. Minimal
event hints still exist for decoded token events:

```ts
import { decodeEvent } from 'micro-eth-signer/abi.js';

const to = '0x0d8775f648430679a709e98d2b0cb6250d2887ef';
const topics = [
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
  '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
  '0x000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564',
];
const data = '0x00000000000000000000000000000000000000000000003635c9adc5dea00000';
const event = decodeEvent(to, topics, data)!;
// Arrays are ABI topic guesses used when no exact contract match is available.
if (Array.isArray(event)) throw new Error('expected exact event match');
console.log(event.name, event.value);
// 'Approval', { value: 1000000000000000000000n, owner: '0xd8da…6045', spender: '0xe592…1564' }
console.log(event.hint);
// 'Allow 0xe592427a0aece92de3edee1f18e0157c05861564 spending up to 1000 BAT from 0xd8da6bf26964af9d7eed9e03e53415d37aa96045'
```

### Keystore: EIP-2333 & legacy

`micro-eth-signer/keystore.js` implements various keystores:

- The module exposes EIP-2333, EIP-2334, and EIP-2335 for Ethereum consensus validator keys
- It also implements legacy v3 / sale keystores.
- bip32 is not included, but can be easily combined with [scure-bip32](https://github.com/paulmillr/scure-bip32)
- bip39 can be used from [scure-bip39](https://github.com/paulmillr/scure-bip39)

Public helpers:

- `hkdfModR`, `deriveMaster`, `deriveChild`, `deriveSeedTree`: low-level EIP-2333 / EIP-2334 BLS key derivation.
- `deriveEIP2334Key`, `deriveEIP2334SigningKey`: derive validator withdrawal or signing keys and paths.
- `EIP2335Keystore`, `decryptEIP2335Keystore`: encrypt and decrypt EIP-2335 consensus-layer keystore objects.
- `createDerivedEIP2334Keystores`: export multiple EIP-2335 keystores from one seed and password.
- `privToLegacyKeystore`, `privFromLegacyKeystore`: export and import execution-layer Web3 v3 keystores.
- `privFromLegacySaleKeystore`: import Ethereum legacy sale wallet files.

Online demo: [eip2333-tool](https://iancoleman.io/eip2333/)

> `npm install @scure/bip39` for mnemonic-to-seed helpers

```ts
import { mnemonicToSeedSync } from '@scure/bip39';
import {
  createDerivedEIP2334Keystores,
  decryptEIP2335Keystore,
} from 'micro-eth-signer/keystore.js';

const password = 'my_password';
const mnemonic = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
const keyType = 'signing'; // or 'withdrawal'
const indexes = [0, 1, 2, 3]; // create 4 keys

const keystores = createDerivedEIP2334Keystores(
  password,
  'scrypt',
  mnemonicToSeedSync(mnemonic, ''),
  keyType,
  indexes
);
const firstPrivateKey = decryptEIP2335Keystore(keystores[0], password);
```

Legacy Web3 v3 keystores protect execution-layer secp256k1 account keys:

```ts
import { addr } from 'micro-eth-signer';
import { privFromLegacyKeystore, privToLegacyKeystore } from 'micro-eth-signer/keystore.js';

const account = addr.random();
const legacyStore = await privToLegacyKeystore(account.privateKey, 'my_password');
const recoveredPrivateKey = await privFromLegacyKeystore(legacyStore, 'my_password');
```

### RLP & SSZ

```ts
import { RLP } from 'micro-eth-signer/core/rlp.js';
// More RLP examples in test/rlp.test.ts
RLP.decode(RLP.encode('dog'));
```

```ts
import * as ssz from 'micro-eth-signer/ssz.js';
// More SSZ examples in test/ssz.test.ts
```

SSZ includes EIP-7688 progressive containers.

### KZG & PeerDAS

Allows to create & verify KZG [EIP-4844](https://eips.ethereum.org/EIPS/eip-4844) proofs.
Supports PeerDAS from [EIP-7594](https://eips.ethereum.org/EIPS/eip-7594).

> `npm install @paulmillr/trusted-setups`

```ts
import { KZG } from 'micro-eth-signer/kzg.js';
// 400kb, 4-sec init
import { trustedSetup } from '@paulmillr/trusted-setups/small-kzg.js';

// 800kb, instant init
// import { trustedSetup } from '@paulmillr/trusted-setups/fast-kzg.js';
// PeerDAS EIP-7594
// import { trustedSetup } from '@paulmillr/trusted-setups/small-peerdas.js';
// import { trustedSetup } from '@paulmillr/trusted-setups/fast-peerdas.js';

// More KZG examples in
// https://github.com/ethereumjs/ethereumjs-monorepo

const kzg = new KZG(trustedSetup);

// Example blob and scalar
const blob = new Array(4096).fill(0n);
const commitment = kzg.blobToKzgCommitment(blob);
const z = 1n;

// Compute and verify proof
const [proof, y] = kzg.computeProof(blob, z);
console.log('Commitment:', commitment);
console.log('Proof:', proof);
console.log('Y:', y);
const isValid = kzg.verifyProof(commitment, z, y, proof);
console.log('Is valid:', isValid);

const blobProof = kzg.computeBlobProof(blob, commitment);
console.log('Blob proof:', blobProof);
console.log('Blob proof valid:', kzg.verifyBlobProof(blob, commitment, blobProof));
```

## RPC provider

Most wallets leak their users' address sets to third parties: an indexer API for history, a
price API for balances, an NFT API for images. Everything in this layer is instead derived from
standard `eth_*` RPC (plus optional OtterScan/trace namespaces): history via on-node discovery,
token and NFT state via contract reads, prices via on-chain Chainlink and Uniswap pools, ENS via
the registry. The only party that sees your queries is the node you choose — run your own and
nothing leaves your machine. NFT images are the single exception: metadata lives on external
hosts, so the IPFS gateway is caller-chosen (`ipfsToHttp`).

> `npm install micro-ftch`

### Init network

eth-signer is network-free and makes it easy to audit network-related code:
all requests are done with user-provided function, conforming to built-in `fetch()`.
We recommend using [micro-ftch](https://github.com/paulmillr/micro-ftch),
which implements kill-switch, logging, batching / concurrency and other features.

Most network APIs expect an instance of `RpcClient`.
The call stack would look like this:

- `Quoter` => `RpcClient` => `jsonrpc` => `fetch`

To initialize RpcClient, do the following:

```js
// Requests are made with fetch(), a built-in method
import { jsonrpc } from 'micro-ftch';
import { RpcClient } from 'micro-eth-signer/net.js';
const RPC_URL = 'http://localhost:8545';
const prov = new RpcClient(jsonrpc(fetch, RPC_URL));

// Example using mewapi RPC
const RPC_URL_2 = 'https://nodes.mewapi.io/rpc/eth';
const prov2 = new RpcClient(jsonrpc(fetch, RPC_URL_2, { Origin: 'https://www.myetherwallet.com' }));
```

micro-ftch can batch many JSON-RPC calls into a single HTTP request. Helpers such as
`tokenBalances` and `tokenInfo` can fire many small calls, so enabling it is a multi-x latency
win:

```js
const prov = new RpcClient(jsonrpc(fetch, RPC_URL, { batchSize: 20 }));
```

All network examples below assume a `prov` initialized as above.

#### Conventions

- All timestamps (e.g. `BlockInfo.timestamp`) are Unix **seconds**, as everywhere in Ethereum.
  Multiply by 1000 for `Date()`.
- Quantities which fit a JS number safely (block numbers, indexes, sizes) are `number`;
  everything measured in wei / token units (balances, fees, gas) is `bigint`.
- Addresses are returned as the node reports them: lowercase in logs, checksummed elsewhere.
  Compare case-insensitively, or normalize with `addr.addChecksum` from the core module.
- Methods throw on failure; `Web3Error` carries `method`, `rpcCode` and `isRevert`. The exception
  is per-contract errors in batch methods (`tokenInfo`, `tokenBalances`), which return
  `{ contract, error }` values so one broken token can't fail a whole batch.
- Methods needing more than a basic node say so in errors; probe support upfront with
  `prov.capabilities()`. Address history prefers OtterScan's `ots_*` namespace and falls back to
  token-only `eth_getLogs` discovery.

### Send transactions

The whole wallet loop — fetch nonce/fees/gasLimit, sign, broadcast, wait for inclusion:

```ts
import { Transaction } from 'micro-eth-signer';

async function main(privateKey: string) {
  const fields = await prov.prepare({
    from: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    to: '0x7aa96045d8da6bf26964af9d7eed9e03e53415d3',
    value: 10n ** 18n, // 1 eth in wei
  });
  const tx = Transaction.prepare(fields).signBy(privateKey);
  const txHash = await prov.broadcast(tx);
  const receipt = await prov.waitForReceipt(txHash, { confirmations: 2 });
  console.log(receipt.status === 1 ? 'confirmed' : 'reverted');
}
```

`prepare` runs `nonce()`, `fees()` (EIP-1559 suggestion from `eth_feeHistory`, `eth_gasPrice`
fallback on legacy chains), `estimateGas()` and `eth_chainId` in one parallel round.
`waitForReceipt` accepts `{ confirmations, timeoutMs, pollIntervalMs, signal }`.

Read-only calls can be batched into a single request through
[Multicall3](https://www.multicall3.com) (`aggregate3`, canonical deployment by default):

```ts
const [name, symbol] = await prov.multicall([
  { to: token, data: nameCalldata },
  { to: token, data: symbolCalldata, allowFailure: false },
]);
// [{ success: true, data: '0x...' }, ...]
```

### Fetch balances & history

`history()` streams wallet-grade rows. OtterScan-capable nodes get indexed discovery
(`source: 'auto'`); basic nodes fall back to `eth_getLogs`, whose rows are marked
`partial: 'tokens-only'` since plain/internal ETH-only transactions are invisible in logs.
`order: 'newest'` (default) pages backward with the `before` cursor; `order: 'oldest'` walks
forward with `after` — the direction for resumable sync (persist the last row's `block`).
`internal: true` adds per-transaction traces. Passing an address array merges several addresses into one
deduplicated stream, re-deriving every row for the set as one wallet. Full option and row
semantics live in the `HistoryOpts`/`HistoryTx` JSDoc; range-crawled `trace_filter` helpers in
`micro-eth-signer/net/trace.js`.

```ts
import { history } from 'micro-eth-signer/net/history.js';

const addr = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
async function main() {
  const block = await prov.blockInfo(await prov.height());
  console.log('current block', block.number, block.timestamp, block.baseFeePerGas);
  console.log('info for addr', addr, await prov.accountState(addr));
  for await (const tx of history(prov, addr, { depth: 'page', internal: true })) {
    console.log(tx.hash, tx.diff, tx.tokenTransfers, tx.internal);
  }
}
```

`RpcClient` covers transport and wallet lifecycle (`prepare`, `broadcast`, `waitForReceipt`,
`blockInfo`, `ethLogs`, `txInfo`, `capabilities`, typed `contract`). Higher-level free functions
ship per module — history, enrich, tokens/NFTs under `micro-eth-signer/net/*.js` — with full
signatures in each module's JSDoc.

### Enrich transactions: token discovery & clear signing

`enrichTx()` is the row primitive behind `history()`: one transaction as a wallet-grade row, for
detail pages or receipts already in hand. Unknown token contracts are discovered and decoded on
the fly; discovered metadata carries `verified: false` — it is attacker-controlled (symbols can
be phishing URLs), so render it distinctly from registry tokens. Clear-signing tiers: `'offline'`
(default) fills `method`/`intent` with zero extra RPC; lazy `row.clearSig()` or
`clearSig: 'resolve'` runs the full ERC-7730 resolvers. Only resolver-tier intents belong on a
signing screen.

```ts
import { enrichTx, rowCodec } from 'micro-eth-signer/net/enrich.js';
import { history } from 'micro-eth-signer/net/history.js';
import { nftCandidates, nftHoldings } from 'micro-eth-signer/net/tokens.js';

async function main() {
  const cache = new Map(); // one per session: dedupes discovery, speeds up clear signing
  const row = await enrichTx(prov, txHash, { address: addr, cache });
  console.log(row.method, row.intent, row.tokenTransfers);
  console.log(await row.clearSig?.()); // full ERC-7730 resolution, lazy + memoized

  // history() rows can opt into the same enrichment:
  const discovered = [];
  const rows = [];
  for await (const tx of history(prov, addr, { discover: true, onToken: (t) => discovered.push(t) }))
    rows.push(tx);
  // `discovered` metadata and rows are plain data; persist them across sessions:
  localStorage.rows = rowCodec.encode(rows); // bigint/Map-safe JSON
  // history is discovery, current state is truth — verify NFT ownership on-chain:
  const held = await nftHoldings(prov, addr, nftCandidates(rows));
}
```

### Asset price quoting (uniswap, chainlink)

```ts
import { DEFAULT_TOKENS } from 'micro-eth-signer/abi.js';
import { Quoter } from 'micro-eth-signer/net/quoter.js';

async function main() {
  const quoter = new Quoter(prov);
  const btc = await quoter.coinPrice('BTC'); // Chainlink is the default provider.
  const bat = await quoter.tokenPrice('BAT');

  const ethV2 = await quoter.coinPrice('ETH', 'uniswap-v2');
  const ethV3 = await quoter.coinPrice('ETH', 'uniswap-v3', { fees: [500, 3000] });
  const btc_eur = await quoter.coinPrice('BTC', 'uniswap-v3', { priceIn: 'EUR' });
  console.log({ btc, btc_eur, bat, ethV2, ethV3 }); // prices in USD
}

const quoterWithCustomToken = new Quoter(prov, {
  // `tokens` replaces the built-in table. Spread DEFAULT_TOKENS when extending it.
  tokens: {
    ...DEFAULT_TOKENS,
    '0x0000000000000000000000000000000000000001': {
      symbol: 'MYT',
      decimals: 18,
      feed: { contract: '0x0000000000000000000000000000000000000002', decimals: 8 },
    },
  },
});
```

Uniswap quote helpers default to USDT prices and can discover pairs or pools from the requested
asset before the first quote. Pass `priceIn` to use another quote token, or use
`rate(amount, provider, params)` for raw pair, pool, and vault conversions. `priceIn` accepts token
addresses, built-in token symbols such as `USDC` or `WBTC`, and the `EUR`/`EURC` aliases for
mainnet EURC. Uniswap v3 EUR/EURC auto prices route through USDC to avoid thin direct pools.
Call `quoter.clearRoutes()` to force auto-discovered Uniswap routes to be refreshed.

### Resolve ENS and GNS names

`NameResolver` handles both ENS and [Gwei Name Service](https://gwei.domains). GNS is an
ownerless ENS alternative: `.gwei` names are ERC-721 tokens whose ids are EIP-137 namehashes,
with registration fees burned instead of collected. Same contract address on Ethereum mainnet
and Sepolia. Forward resolution routes by TLD (`.gwei` goes to GNS, everything else to ENS);
reverse resolution takes an explicit mode, defaulting to ENS.

```ts
import { gnsRegistrationFee, gnsTokenId, NameResolver } from 'micro-eth-signer/net/resolver.js';

const resolver = new NameResolver(prov);
async function main() {
  const vitalikAddr = await resolver.nameToAddress('vitalik.eth');
  const aliceAddr = await resolver.nameToAddress('alice.gwei');
  if (!vitalikAddr || !aliceAddr) throw new Error('name not found');
  const primary = await resolver.addressToName(vitalikAddr); // ENS by default
  const gweiPrimary = await resolver.addressToName(aliceAddr, 'gns');
  const avatar = await resolver.getText('alice.gwei', 'avatar'); // works for ENS names too
  const free = await resolver.isAvailable('alice'); // GNS registration read
}
// Offline helpers: namehash('vitalik.eth') => EIP-137 node,
// gnsTokenId('alice.gwei') => ERC-721 token id (EIP-137 namehash),
// gnsRegistrationFee('alice') => burned fee in wei (fixed byte-length schedule).
// Other reads: getContenthash, getAddrForCoin (SLIP-44), expiresAt, premium.
```

GNS registration itself is on-chain commit-reveal (`commit`/`reveal` on the NameNFT contract) and
is not wrapped here; use the official dapp or build the calls with `micro-eth-signer/abi.js`.

### Swap tokens with Uniswap

> Btw cool tool, glad you built it!

_Uniswap Founder_

Swap 12.12 USDT to BAT with uniswap V3 defaults of 0.5% slippage, 30 min expiration.

```js
import { tokenFromSymbol } from 'micro-eth-signer/abi.js';
import { UniswapV2, UniswapV3 } from 'micro-eth-signer/net/uniswap.js';

const USDT = tokenFromSymbol('USDT');
const BAT = tokenFromSymbol('BAT');
if (!USDT || !BAT) throw new Error('unknown token');
const u3 = new UniswapV3(prov); // or new UniswapV2(provider)
const fromAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const toAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
async function main() {
  const swap = await u3.swap(USDT, BAT, '12.12', { slippagePercent: 0.5, ttl: 30 * 60 });
  if (!swap) throw new Error('No swap route found');
  const swapData = await swap.tx(fromAddress, toAddress);
  console.log(swapData.amount, swapData.expectedAmount, swapData.allowance);
}
```

## Security

- **Commits** are signed with PGP keys to prevent forgery. Be sure to verify the commit signatures
- **Releases** are made transparently through token-less GitHub CI and Trusted Publishing. Be sure to verify the [provenance logs](https://docs.npmjs.com/generating-provenance-statements) for authenticity.

Main points to consider when auditing the library:

- ABI correctness
  - All ABI JSON should be compared to some external source
  - There are different databases of ABI: one is hosted by Etherscan, when you open contract page
- Network access
  - There must be no network calls in the library
  - Some functionality requires network: these need an external network interface conforming to `IWeb3Provider`
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

Check out article [ZSTs, ABIs, stolen keys and broken legs](https://github.com/paulmillr/micro-eth-signer/discussions/20) about caveats of secure ABI parsing found during development of the library.

### Privacy considerations

Default priority fee is 1 gwei, which matches what other wallets have.
However, it's recommended to fetch recommended priority fee from a node.

### Sending whole balance

There is a method `setWholeAmount` which allows to send whole account balance:

```ts
import { Transaction, weigwei, weieth } from 'micro-eth-signer';
const tx = Transaction.prepare({
  to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
  value: weieth.decode('1.1'),
  maxFeePerGas: weigwei.decode('100'),
  nonce: 0n,
});
const CURRENT_BALANCE = '1.7182050000017'; // in eth
const txSendingWholeBalance = tx.setWholeAmount(weieth.decode(CURRENT_BALANCE));
```

It does two things:

1. `amount = accountBalance - maxFeePerGas * gasLimit`
2. `maxPriorityFeePerGas = maxFeePerGas`

Every eth block sets a fee for all its transactions, called base fee.
maxFeePerGas indicates how much gas user is able to spend in the worst case.
If the block's base fee is 5 gwei, while user is able to spend 10 gwei in maxFeePerGas,
the transaction would only consume 5 gwei. That means, base fee is unknown
before the transaction is included in a block.

By setting priorityFee to maxFee, we make the process deterministic:
`maxFee = 10, maxPriority = 10, baseFee = 5` would always spend 10 gwei.
In the end, the balance would become 0.

> [!WARNING]
> Using the method would decrease privacy of a transfer, because
> payments for services have specific amounts, and not _the whole amount_.

## Speed

> `npm run bench`

> [!NOTE]
> The first call of `sign` will take 20ms+ due to noble-curves secp256k1 BASE point precompute.

Highlights against ethers and viem: transaction-hash decoding is ~1.5x faster than ethers,
signing is on par, and the native-JS KZG initializes in 4ms versus 190ms for WASM builds while
verifying proofs at comparable speed. Benchmark numbers age quickly — run `npm run bench` in
`benchmark/` for current ones.

## Contributing

Make sure to use recursive cloning for the [eth-vectors](https://github.com/paulmillr/eth-vectors) submodule:

    git clone --recursive https://github.com/paulmillr/micro-eth-signer.git

## License

MIT License

Copyright (c) 2021 Paul Miller (https://paulmillr.com)
