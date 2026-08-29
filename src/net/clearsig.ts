import {
  CLEARSIG_REPO,
  addTokens,
  decodeTx,
  type ClearSigDef,
  type ClearSigOpt,
  type TxDecodeOpt,
} from '../abi/index.ts';
import type { ClearSigTokens } from '../clearsig.ts';
import { Transaction } from '../core/tx.ts';
import type { TArg, TRet } from '../utils.ts';
import type { RpcClient } from '../net.ts';
import { tokenInfo, tokenURI } from './tokens.ts';

const MAINNET_CHAIN_ID = /* @__PURE__ */ BigInt(1);
const assertRpcChain = async (prov: RpcClient, expected: bigint, name: string): Promise<void> => {
  const actual = await prov.chainId();
  if (actual !== expected)
    throw new Error(`${name}: RPC chain id ${actual} does not match expected chain id ${expected}`);
};

/**
 * Online companion to airgapped decodeTx: probes the transaction target, then
 * decodes with provider-backed resolvers. Probe results stay unverified and do
 * not bind generic ERC-7730 descriptors; pass curated `opt.tokens` to opt in.
 * Besides signed raw hex, accepts a parsed (possibly still unsigned)
 * Transaction — e.g. `Transaction.prepare(fields)` — so a wallet can render
 * the clear-signing intent on the confirmation screen BEFORE signing (pass
 * `opt.from` for unsigned transactions, since no sender can be recovered).
 * The transaction/request chain defaults to mainnet and must match the RPC
 * provider before any metadata is trusted.
 */
export async function discoverTx(
  prov: RpcClient,
  transaction: string | ReturnType<typeof Transaction.fromHex>,
  clearSig: Record<string, ClearSigDef> = CLEARSIG_REPO,
  opt: TArg<TxDecodeOpt & { tokens?: ClearSigTokens }> = {}
): Promise<ReturnType<typeof decodeTx>> {
  const tx = typeof transaction === 'string' ? Transaction.fromHex(transaction) : transaction;
  if (opt.chainId !== undefined && typeof opt.chainId !== 'bigint')
    throw new TypeError(`discoverTx: expected bigint chainId, got ${typeof opt.chainId}`);
  if (opt.chainId !== undefined && tx.raw.chainId !== undefined && opt.chainId !== tx.raw.chainId)
    throw new Error(
      `discoverTx: requested chain id ${opt.chainId} does not match transaction chain id ${tx.raw.chainId}`
    );
  const chainId = opt.chainId ?? tx.raw.chainId ?? MAINNET_CHAIN_ID;
  await assertRpcChain(prov, chainId, 'discoverTx');
  const tokens: ClearSigTokens = { ...opt.tokens };
  const to = tx.raw.to.toLowerCase();
  if (tx.raw.to !== '0x' && !tokens[to]) {
    const info = await tokenInfo(prov, tx.raw.to);
    if (!('error' in info)) {
      const token: ClearSigTokens[string] = { abi: info.abi, chainId };
      if ('name' in info) token.name = info.name;
      if ('symbol' in info) token.symbol = info.symbol;
      if ('decimals' in info) token.decimals = info.decimals;
      token.verified = info.verified;
      tokens[to] = token;
    }
  }
  return decodeTx(tx, {
    ...clearSigCallbacks(prov, chainId),
    ...opt,
    chainId,
    clearSig: addTokens(clearSig, tokens, chainId),
  });
}

/**
 * The ERC-7730 intent of a transaction as one display string — discoverTx
 * plus clear-signing resolution collapsed for confirmation screens:
 * `'Send 2.5 USDC to 0x…'`. Returns undefined when there is nothing to
 * clear-sign (no calldata, guess-only selector match, no descriptor) or when
 * decoding/resolution fails: the intent is decorative, so errors never
 * surface — render the raw transaction fields regardless and treat the
 * intent as an extra.
 */
export async function txIntent(
  prov: RpcClient,
  transaction: string | ReturnType<typeof Transaction.fromHex>,
  clearSig?: Record<string, ClearSigDef>,
  opt: TArg<TxDecodeOpt & { tokens?: ClearSigTokens }> = {}
): Promise<string | undefined> {
  try {
    const decoded = await discoverTx(prov, transaction, clearSig, opt);
    if (!decoded || Array.isArray(decoded) || !decoded.clearSig) return undefined;
    const clear = await decoded.clearSig;
    return clear?.interpolatedIntent || clear?.intent;
  } catch {
    return undefined;
  }
}

/**
 * Provider-backed resolvers whose self-reported token/NFT metadata stays unverified.
 * @param prov - RPC provider used for metadata lookups.
 * @param chainId - Expected provider chain. Defaults to mainnet.
 * @returns Chain-bound clear-signing resolver callbacks.
 */
export function clearSigCallbacks(
  prov: RpcClient,
  chainId: bigint = MAINNET_CHAIN_ID
): TRet<ClearSigOpt> {
  if (typeof chainId !== 'bigint')
    throw new TypeError(`clearSigCallbacks: expected bigint chainId, got ${typeof chainId}`);
  let verified: Promise<void> | undefined;
  const verify = (requested?: bigint) => {
    const expected = requested ?? chainId;
    if (expected !== chainId)
      throw new Error(
        `clearSigCallbacks: request chain id ${expected} does not match expected chain id ${chainId}`
      );
    return (verified ||= assertRpcChain(prov, chainId, 'clearSigCallbacks'));
  };
  return {
    async resolveToken(req) {
      await verify(req.chainId);
      const info = await tokenInfo(prov, req.address);
      if ('error' in info || info.abi !== 'ERC20') return undefined;
      return {
        name: info.name,
        symbol: info.symbol,
        decimals: info.decimals,
        verified: info.verified,
      };
    },
    async resolveNft(req) {
      await verify(req.chainId);
      const info = await tokenInfo(prov, req.collection);
      if ('error' in info || info.abi !== 'ERC721' || !info.name) return undefined;
      const uri = await tokenURI(prov, info, req.tokenId);
      return {
        name: `${info.name} #${req.tokenId}`,
        source: typeof uri === 'string' ? uri : undefined,
        verified: info.verified,
      };
    },
    async resolveBlock(req) {
      await verify(req.chainId);
      return (await prov.blockInfo(Number(req.block))).timestamp;
    },
  };
}
