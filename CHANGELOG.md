# Changelog for micro-eth-signer

## 0.20.1 (2026-08-29)

- Renamed `Transaction#setWholeAmount` to `setMaxAmount`. It no longer bumps
  `maxPriorityFeePerGas` to burn the remainder (`burnRemaining` option removed):
  fee fields are preserved, so a lower actual fee leaves a small remainder in the account
- Made `RpcClient.prepare()` and `fees()` follow one of two fixed population policies:
  `viem_v3` (default; tries `eth_fillTransaction` first, caches unsupported nodes, and falls
  back to viem-style manual population) or `ethers_v6`
- Added optional `latest` / `pending` tag argument to `RpcClient.nonce()`
- Added `isValidPrivateKey` and improved the history API
- Hardened networking code: anti-DoS protections and various network improvements

## 0.20.0 (2026-08-09)

### Major features

1. Support for GNS (Gwei Name Service), and one resolver for both GNS + ENS
2. net/quoter.js: price quoter, supporting different providers chainlink, uniswap-v2, uniswap-v3.
   Automatically fetches prices from the largest uniswap pool.
3. net/history.js, net/enrich.js: new APIs for block explorer-like functionality.
   We've built a block explorer demo with it, in the repo.
4. 10x RLP speed-up, with -81% smaller size
5. Faster KZG and SSZ

### Breaking

Removed `advanced`: all modules were moved to the top-level.

**Network layer.** `Web3Provider` is now `RpcClient`, and `net.js` no longer re-exports the
protocol wrappers:

| 0.19.0 (`net.js`) | HEAD |
|---|---|
| `Web3Provider` | `RpcClient` (`net.js`) |
| `ENS` | `NameResolver` (`net/resolver.js`) |
| `UniswapV2`, `UniswapV3` | same names, `net/uniswap.js` |
| `Chainlink` | folded into `Quoter` (`net/quoter.js`) as the `'chainlink'` provider |
| `calcTransfersDiff` | `net/history.js` |

**Transaction.**

- `Transaction.fromRawBytes()` → `Transaction.fromBytes()`.
- Constructor takes an options object: `new Transaction(type, raw, { strict, allowSignatureFields })`
  instead of positional `(type, raw, strict, allowSignatureFields)`.
- `setWholeAmount(balance, burnRemaining)` → `setWholeAmount(balance, { burnRemaining })`.
- `toBytes()` / `toHex()` take `{ includeSignature }`, defaulting to `true` when signed.

**Address.**

- `addr.fromSecretKey` removed — use `addr.fromPrivateKey`.
- `addr.RE` removed.
- The `allowEmpty` parameter is gone from `addr.parse`, `addr.addChecksum` and `addr.isValid`.

**Typed data.** `recoverPublicKeyTyped` → `recoverAddressTyped`, which returns a checksummed
address instead of secp256k1 public key bytes. Internally `core/typed-data.ts` split into
`core/message.ts` and `core/authorization.ts`.

**RLP.** The exported `InternalRLP` type (the old tagged intermediate tree) is removed; it was
reachable through the `./core/rlp.js` subpath. `RLP.encode(3.5)` now throws
`invalid integer as argument` instead of misbehaving during byte conversion. The
`CoderType<RLPInput>` public API is otherwise unchanged.

## 0.19.0 (2026-06-16)

- Hardening changes related to May 2026 audit
- Add support for BLS validator & legacy keystores in new `advanced/keystore.js` submodule
- Add support for Clear Signing (ERC-7730)
- tx: fix EIP-4844 fee calculation
- ssz: add support for progressive ssz (EIP-7688)
- ssz: support for fulu (osaka) and fixed support for electra by @EvilJordan in https://github.com/paulmillr/micro-eth-signer/pull/43
- net: fix (unused) chainlink tokens dai address

### New Contributors

- @EvilJordan made their first contribution in https://github.com/paulmillr/micro-eth-signer/pull/43

## 0.18.1 (2025-11-22)

- Re-publishing 0.18.0, because GitHub Actions is a failure.

## 0.18.0 (2025-11-22)

- Remove verkle submodule. It was removed from eth roadmap.
- fix: remove tx value range check in non-strict mode by @lgiussan in https://github.com/paulmillr/micro-eth-signer/pull/40
- fix: handle tuple array type in MapType definition by @xMuratY in https://github.com/paulmillr/micro-eth-signer/pull/41
- Update jsbt dev dependency, enable immutable releases on GitHub

### New Contributors

- @lgiussan made their first contribution in https://github.com/paulmillr/micro-eth-signer/pull/40
- @xMuratY made their first contribution in https://github.com/paulmillr/micro-eth-signer/pull/41

## 0.17.3 (2025-09-23)

- fix: correct export path for ./advanced/abi.js in package.json by @odalmaz in https://github.com/paulmillr/micro-eth-signer/pull/39

### New Contributors

- @odalmaz made their first contribution in https://github.com/paulmillr/micro-eth-signer/pull/39

## 0.17.2 (2025-09-18)

- Add back export maps for text editor autocompletion

## 0.17.1 (2025-08-25)

- Upgrade to stable noble v2

## 0.17.0 (2025-08-20)

- Upgrade deps to noble v2 beta
- Move submodules into 3 dirs: core, net, advanced
    - core now contains rlp, address, tx-internal, tx
    - advanced now contains abi, ssz, kzg, verkle
    - abi-decoder got split into abi-decoder & abi-mapper

## 0.16.0 (2025-06-30)

- Increase minimum node.js version to v20.19.
- The package is now ESM-only. Node v20.19+ supports loading ESM modules from Common.js code
- Decrease package size from 306KB to 242KB, unpacked size from 2.3MB to 1.3MB
- Use noble-hashes v2 beta
- Increase tx data limit to 512KB as per EIP-7907

### New Contributors

- @bee344 made their first contribution in https://github.com/paulmillr/micro-eth-signer/pull/38

## 0.15.0 (2025-05-14)

- Rename exports from /module to /module.js
- kzg: Implement PeerDAS from EIP-7594
- net: add ots api to web3provider
- Update dependencies

## 0.14.0 (2025-03-01)

- **IMPORTANT:** change SIGN logic, use hedged signatures by default. Closes https://github.com/paulmillr/micro-eth-signer/issues/31. Commit https://github.com/paulmillr/micro-eth-signer/commit/83a29461411f3ec97e895ab1c98ef829bc676933
- sign: ban generated signatures with recovery id = 2 or 3. This has been long disallowed in ETH yellow paper. Chance of getting such sig is 1 in 2^128 (very rare)
- ssz: add hardfork-specific data structures
- Make package erasableSyntax-friendly: Replace js imports with ts
- Generate provenance for standalone built files in github releases. You can verify standalone built files using github CLI:
  `gh attestation verify --owner paulmillr micro-eth-signer.js`

## 0.13.3 (2025-01-19)

- Use typescript verbatimModuleSyntax to support future node.js type stripping
- Update dependencies

## 0.13.2 (2024-12-25)

- Fix bug in web3provider for empty addresses

## 0.13.1 (2024-12-25)

- Web3Provider: Add support for ERC1155 and nft balances

## 0.13.0 (2024-11-23)

- Upgrade dependencies
- Speed-up verkle, delay init until first run
- Remove bigint literals

## 0.12.2 (2024-11-09)

- Transaction: Allow zero address when deploying contract
- Fix ABI decoding not accepting 0-argument inputs

## 0.12.1 (2024-11-03)

- Implement experimental Verkle cryptography in `/verkle` submodule.

## 0.12.0 (2024-09-24)

- Add support for [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) account abstraction transactions (type=4)
- Add support for [EIP-7495](https://eips.ethereum.org/EIPS/eip-7495) SSZ stable containers
- EIP-4844 pure JS KZG implementation from v0.11 has been solidified.

## 0.11.0 (2024-09-16)

- Implement EIP-191 and EIP-712 message signing
- Implement EIP-4844 KZG in pure JS
- Rename ArchiveNodeProvider to Web3Provider
- Export `/address` module
- Upgrade noble-curves to v1.6, noble-hashes to v1.5

## 0.10.0 (2024-06-21)

- Remove `FetchProvider`. All code should now be using [micro-ftch](https://github.com/paulmillr/micro-ftch) instead
- Add `Transaction#fee`
- Remove `Transaction#calcAmounts`
- Improve ESM / CJS compatibility (remove CJS masquerading)

## 0.9.1 (2024-05-22)

- Rename utils ethDecimal and gweiDecimal to weieth and gweieth

## 0.9.0 (2024-05-17)

- Add ArchiveNodeProvider: fetching account balances and history from archive nodes (see [erigon docs](https://github.com/ledgerwatch/erigon))
- Implement [SSZ encoding](https://ethereum.org/en/developers/docs/data-structures-and-encoding/ssz/), used in consensus layer
- Rename addr.verifyChecksum to addr.isValid. Force 0x prefix
- Fix typescript autocomplete by moving compiled files from `lib` to root dir
- Update dependency micro-packed

## 0.8.1 (2024-03-17)

- Add support for eip1191 addresses
- Fix calculation of tx `amountWithFee`

## 0.8.0 (2024-03-11)

- Add support for EIP4844 transaction type from Dencun
- `Transaction` improvements
    - Improve transaction validation: now emits an array of errors for all fields
    - Stricter optional transaction validation: errors on technically correct, but bad values
    - `raw` property is now human-readable and easy to parse visually
- Add `FetchProvider` that consumes `fetch` built-in function and creates a Web3API-compatible interface
- Easy random key / address generation using `addr.random()`
- Add `messenger` to sign and verify messages by private key
- Remove dependency on RLP: use our own, on top of micro-packed
- Add 150MB of tests from ethers, viem, ethereum-tests and ethereumjs

## 0.7.2 (2024-01-12)

- Improve ABI parsing to eliminate some undefined behavior.

## 0.7.1 (2024-01-05)

- Improve ABI parsing

## 0.7.0 (2024-01-05)

- Integrate micro-web3:
    - Decode transactions and events
    - Typesafe ABI parser
    - Call smart contracts easily
- Switch package to hybrid common.js-esm

## 0.6.5 (2023-12-23)

- Update dependencies

## 0.6.4 (2023-08-25)

- Update dependencies.

## 0.6.3 (2023-07-22)

- Update dependencies

## 0.6.2 (2023-05-03)

- Testing automatic `npm publish` with github actions

## 0.6.1 (2023-04-12)

- Update noble-curves

## 0.6.0 (2023-03-16)

- Switch from noble-secp256k1 to noble-curves

## 0.5.1 (2023-02-11)

- Corrects bug in type discovery. by @MicahZoltu in https://github.com/paulmillr/micro-eth-signer/pull/11
- Increases strictness of type checker. by @MicahZoltu in https://github.com/paulmillr/micro-eth-signer/pull/12
- Updates to @ethereumjs/rlp by @MicahZoltu in https://github.com/paulmillr/micro-eth-signer/pull/13
- Small refactor

### New Contributors

- @MicahZoltu made their first contribution in https://github.com/paulmillr/micro-eth-signer/pull/11

## 0.5.0 (2022-07-17)

- Added new modules

## 0.4.8 (2022-06-18)

- Update dependencies
- Speed improvements
- Add benchmark

## 0.4.7 (2022-01-26)

- New `extraEntropy` option

## 0.4.6 (2022-01-25)

- Switch to official RLP package

## 0.4.5 (2022-01-18)

- Fix lint issues

## 0.4.4 (2022-01-18)

- Update dependencies

## 0.4.3 (2021-12-23)

- Update noble dependencies

## 0.4.2 (2021-11-21)

- Update deps

## 0.4.1 (2021-10-16)

- Update dependencies

## 0.4.0 (2021-10-13)

- Replace js-sha3 with noble-hashes

## 0.3.1 (2021-08-05)

- Make eip1559 default transaction type

## 0.3.0 (2021-08-05)

- Maintenance release

## 0.2.2 (2021-07-30)

- Add new transaction fields
- Small refactoring

## 0.2.1 (2021-07-18)

- README docs updates

## 0.2.0 (2021-07-18)

- Add support for London and Berlin transactions (EIP 1559, EIP 2930)

## 0.1.7 (2021-06-02)

- Fixed tx.sender bug

## 0.1.6 (2021-05-06)

- Allow zero value in transactions

## 0.1.5 (2021-05-01)

- Maintenance release

## 0.1.4 (2021-04-12)

- Nonce handling fixes

## 0.1.3 (2021-04-05)

- Bugfixes
- README improvements

## 0.1.2 (2021-03-30)

- Allow numbers as input values
- Fix package.json git url

## 0.1.1 (2021-03-26)

- Initial public release

## 0.1.0 (2021-03-26)

- Initial version
