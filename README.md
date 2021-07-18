# micro-eth-signer

Create, sign and validate Ethereum transactions & addresses with minimum deps.

Library's size is <500 lines of code, or 3KiB gzipped (8.7KiB minified). Uses three dependencies (SHA-3, RLP & secp256k1), four libraries combined are 13KiB gzipped (37KiB minified).

Validated with over 3MiB of ethers.js test vectors!

## Usage

> npm install micro-eth-signer

Supports Node.js & all major browsers. If you're looking for a fully-contained single-file version, check out Releases page on GitHub.

```js
const { Address, Transaction } = require('micro-eth-signer');

(async () => {
  const tx = new Transaction({
    to: '0xdf90dea0e0bf5ca6d2a7f0cb86874ba6714f463e',
    gasPrice: 100n * 10n ** 9n, // 100 gwei in wei
    value: 10n ** 18n, // 1 eth in wei
    nonce: 1
  });
  const privateKey = '6b911fd37cdf5c81d4c0adb1ab7fa822ed253ab0ad9aa18d77257c88b29b718e';
  const signedTx = await tx.sign(privateKey); // Uint8Array is also accepted
  const {hash, hex} = signedTx;

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
})();
```

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

- `new Transaction(serialized[, chain, hardfork])` - creates transaction from Raw TX string.
    - `chain`: optional argument (default is `mainnet`; `ropsten`, `rinkeby`, `goerli`, `kovan` etc)
    - `hardfork`: optional argument (default is `berlin`). The only place we're checking for `hardfork`
      is the replay protection code. There are very old transactions that don't support replay protection,
      you'll probably won't need them
- `new Transaction(rawTx[, chain, hardfork])` - creates transaction from Raw TX data.
    - `rawTx` must have fields `to`, `value`, `nonce`, `gasPrice`, `gasLimit`
    - It could optionally specify `data`
    - `to` is recipient's address
    - `value` is amount to send in wei
    - `nonce` is sender's nonce in number
    - `gasLimit` is transaction's Gas Limit in wei (minimum is `21000`)
    - `gasPrice` is transaction's Gas Price in wei (100 gwei is `100 * 10 ** 9`)
    - `data` is transaction's data if it's calling some smart contracts
- `Transaction#sign(privateKey: string | Uint8Array): Promise<Transaction>` —
  creates new transaction with same data, but signed by following private key
- `Transaction#recoverSenderPublicKey(): string` — recovers sender's public key from **signed transaction**

##### Transaction Properties

- `isSigned: boolean` - whether tx is signed with private key
- `amount: bigint` - amount (aka `value`) in wei
- `fee: bigint` - fee in wei (`gasLimit` * `gasPrice`)
- `upfrontCost: bigint` - amount + fee in wei, combined
- `to: string` - address that receives the tx
- `nonce: number` - account's nonce
- `sender: string` - address that sends the tx. Only signed txs have the field
- `hash: string` - signed tx hash used in block explorers. Example: `50b6e7b58320c885ab7b2ee0d0b5813a697268bd2494a06de792790b13668c08`
- `raw: Object` - raw transaction's data with fields encoded as strings

## License

MIT License

Copyright (c) 2021 Paul Miller (https://paulmillr.com)
