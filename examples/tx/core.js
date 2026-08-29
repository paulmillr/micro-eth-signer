// Shared logic of tx/index.html and tx/cli.js: derive an account from a private key,
// show it explorer-style (balances incl. every token seen in history, recent
// transactions), then build and sign an ETH or ERC-20 transfer.
//
// HARD CONSTRAINT: nothing in this module (or its UIs) ever broadcasts.
// There is no eth_sendRawTransaction / prov.broadcast call anywhere — the
// demo only creates a signed transaction and returns its hex.
import { jsonrpc } from 'micro-ftch';
import { addr, Transaction, weieth } from '../../index.js';
import { weigwei } from '../../utils.js';
import { tokenFromSymbol } from '../../abi/index.js';
import { RpcClient } from '../../net.js';
import { txIntent } from '../../net/clearsig.js';
import { history } from '../../net/history.js';
import { maxSpendable, spendableAssets, transferTx } from '../../net/tokens.js';
import {
  checksumAddress,
  formatUnits,
  isAddress,
  parseUnits,
  RPC_URL,
  slimRow,
  SYMBOLS,
} from '../explorer/core.js';

export {
  checksumAddress,
  formatUnits,
  isAddress,
  rowSummary,
  RPC_URL,
  short,
  withScheme,
} from '../explorer/core.js';

// The testnet switch selects one of these; chain id is verified against the
// node on load, so a mainnet key can't accidentally sign for the wrong chain.
// Curated symbols seed the balance check; tokens discovered in the account's
// history are added on top (that's how testnets get their tokens too).
export const NETWORKS = {
  mainnet: { label: 'Mainnet', chainId: 1n, rpcUrl: RPC_URL, symbols: SYMBOLS },
  sepolia: { label: 'Sepolia testnet', chainId: 11155111n, rpcUrl: RPC_URL, symbols: [] },
};

export const INVALID_KEY = 'Invalid private key: expected 64 hex characters.';
// rejects out-of-range scalars too, not just badly formatted hex
export const isPrivateKey = (value) =>
  typeof value === 'string' && addr.isValidPrivateKey(value.trim());
// the library accepts an optional 0x prefix and any hex case as-is
const requireKey = (value) => {
  if (!isPrivateKey(value)) throw new Error(INVALID_KEY);
  return value.trim();
};
export const randomKey = () => addr.random().privateKey;

export const balanceLine = (asset) =>
  `${(asset.symbol || 'TOKEN').padEnd(5)} ${formatUnits(asset.balance, asset.decimals)}`;

export function createTxWallet(rpcUrl, networkKey = 'mainnet') {
  const network = NETWORKS[networkKey];
  if (!network) throw new Error(`Unknown network: ${networkKey}`);
  const prov = new RpcClient(jsonrpc(globalThis.fetch.bind(globalThis), rpcUrl, { batchSize: 10 }));
  // one token-discovery cache for the whole session
  const cache = new Map();

  // Recent history with every token movement visible: the default source
  // ('auto' = ots+logs) covers incoming token transfers that never call-touch
  // the address, and `discover` decodes transfers of tokens outside the
  // curated registry, so no movement renders as a bare 'contract call'.
  async function collectHistory(address) {
    const rows = [];
    // slimRow keeps only what the tables render; full receipts are not
    // needed once transfers are decoded
    for await (const row of history(prov, address, { discover: true, cache }))
      rows.push(slimRow(row));
    // the ots and logs passes yield separately: merge into one newest-first list
    return rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  async function load(privateKey) {
    const address = addr.fromPrivateKey(requireKey(privateKey));
    // the chain check rides the same batched round as the account reads; a
    // mismatch still fails the load before anything is shown
    const [chainId, account, rows] = await Promise.all([
      prov.chainId(),
      prov.accountState(address),
      collectHistory(address),
    ]);
    if (chainId !== network.chainId)
      throw new Error(
        `Node reports chain id ${chainId}, expected ${network.chainId} (${network.label}): ` +
          'check the RPC URL and the network switch.'
      );
    // ETH plus every ERC-20 with a non-zero balance, whether curated
    // (network.symbols) or discovered in history; NFTs are out of scope
    const assets = await spendableAssets(prov, address, {
      rows,
      tokens: network.symbols.map((symbol) => tokenFromSymbol(symbol)).filter(Boolean),
      ethBalance: account.balance,
    });
    return { address, nonce: account.nonce, assets, rows };
  }

  // Largest sendable amount as an input string: tokens spend in full; ETH
  // keeps a plain-transfer fee reserve at current worst-case gas price.
  const maxAmount = async (asset, from) =>
    formatUnits(
      await maxSpendable(prov, { from, token: asset.contract ? asset : undefined }),
      asset.decimals
    );

  /**
   * Builds and signs a transfer of `asset` (from `load().assets`) and returns
   * `{ hex, hash, normal, muted }` — signed raw hex plus label/value pairs for
   * display. The transaction is simulated (dryRun) and clear-sign previewed,
   * but NOT broadcast; that's the caller's explicit, out-of-scope decision.
   */
  async function build({ privateKey, asset, to, amount }) {
    const key = requireKey(privateKey);
    const from = addr.fromPrivateKey(key);
    if (typeof to !== 'string' || !isAddress(to.trim()))
      throw new Error('Invalid recipient address.');
    const recipient = checksumAddress(to.trim());
    let value;
    try {
      value = parseUnits(amount, asset.decimals);
    } catch {
      throw new Error(`Invalid amount: expected a decimal number of ${asset.symbol}.`);
    }
    // Validated fields in one round: ERC-20 calldata, nonce, fees, gas limit,
    // and the amount/balance/worst-case-fee/chain-id guards all live in the
    // library — checked against the live on-chain balance.
    // Tokens discovered in history (rather than curated) carry
    // verified: false, and transferTx refuses them without an explicit
    // opt-in. The demo shows the token's contract address and marks the
    // result 'unverified' below, so the user makes that call, not the code.
    const fields = await transferTx(prov, {
      from,
      to: recipient,
      amount: value,
      token: asset.contract ? asset : undefined,
      allowUnverified: asset.verified === false ? true : undefined,
      expectedChainId: network.chainId,
    });
    const unsigned = Transaction.prepare(fields);
    // The eth_call simulation and the clear-sign preview are independent: one
    // parallel round. Plain ETH transfers carry no calldata to preview (and
    // discoverTx would pointlessly probe the recipient as a token), so only
    // token transfers run the preview.
    const [simulation, intent] = await Promise.all([
      prov.dryRun({ from, to: fields.to, value: fields.value, data: fields.data }),
      // the held token's metadata is already known: seeding it lets the
      // preview interpolate offline instead of re-probing the contract
      !asset.contract
        ? undefined
        : txIntent(prov, unsigned, undefined, {
            from,
            tokens: {
              [asset.contract.toLowerCase()]: {
                abi: 'ERC20',
                chainId: network.chainId,
                symbol: asset.symbol,
                decimals: asset.decimals,
              },
            },
          }),
    ]);
    const signed = unsigned.signBy(key);
    const perGas = fields.type === 'legacy' ? fields.gasPrice : fields.maxFeePerGas;
    const maxFee = fields.gasLimit * perGas;
    return {
      hex: signed.toHex({ includeSignature: true }),
      hash: signed.hash,
      normal: [
        ['network', network.label],
        ['from', from],
        ['to', recipient],
        ['amount', `${formatUnits(value, asset.decimals)} ${asset.symbol}`],
        ...(asset.contract
          ? [['token', `${asset.contract}${asset.verified === false ? ' · unverified' : ''}`]]
          : []),
        ...(intent ? [['intent', intent]] : []),
        ['simulation', simulation.success ? 'would succeed' : `would revert: ${simulation.reason}`],
      ],
      muted: [
        ['type', fields.type],
        ['chain id', String(fields.chainId)],
        ['nonce', String(fields.nonce)],
        ['gas limit', String(fields.gasLimit)],
        [fields.type === 'legacy' ? 'gas price' : 'max fee per gas', `${weigwei.encode(perGas)} gwei`],
        ['max total fee', `${weieth.encode(maxFee)} ETH`],
        ['txid', signed.hash],
      ],
    };
  }

  return { load, maxAmount, build };
}
