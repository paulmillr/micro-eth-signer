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

/**
 * Online companion to airgapped decodeTx: probes the transaction target, binds
 * generic ERC-7730 descriptors, then decodes with provider-backed resolvers.
 */
export async function discoverTx(
  prov: RpcClient,
  transaction: string,
  clearSig: Record<string, ClearSigDef> = CLEARSIG_REPO,
  opt: TArg<TxDecodeOpt & { tokens?: ClearSigTokens }> = {}
): Promise<ReturnType<typeof decodeTx>> {
  const tx = Transaction.fromHex(transaction);
  const tokens: ClearSigTokens = { ...opt.tokens };
  const to = tx.raw.to.toLowerCase();
  if (tx.raw.to !== '0x' && !tokens[to]) {
    const info = await tokenInfo(prov, tx.raw.to);
    if (!('error' in info)) {
      const token: ClearSigTokens[string] = { abi: info.abi, chainId: tx.raw.chainId };
      if ('name' in info) token.name = info.name;
      if ('symbol' in info) token.symbol = info.symbol;
      if ('decimals' in info) token.decimals = info.decimals;
      tokens[to] = token;
    }
  }
  return decodeTx(transaction, {
    ...clearSigCallbacks(prov),
    ...opt,
    clearSig: addTokens(clearSig, tokens, tx.raw.chainId),
  });
}

/** Standard ERC-7730 clear-signing resolvers backed by a Web3 provider. */
export function clearSigCallbacks(prov: RpcClient): TRet<ClearSigOpt> {
  return {
    async resolveToken(req) {
      const info = await tokenInfo(prov, req.address);
      if ('error' in info || info.abi !== 'ERC20') return undefined;
      return { name: info.name, symbol: info.symbol, decimals: info.decimals };
    },
    async resolveNft(req) {
      const info = await tokenInfo(prov, req.collection);
      if ('error' in info || info.abi !== 'ERC721' || !info.name) return undefined;
      const uri = await tokenURI(prov, info, req.tokenId);
      return {
        name: `${info.name} #${req.tokenId}`,
        source: typeof uri === 'string' ? uri : undefined,
        verified: true,
      };
    },
    async resolveBlock(req) {
      return (await prov.blockInfo(Number(req.block))).timestamp;
    },
  };
}
