import {
  ERC1155,
  ERC20,
  ERC721,
  WETH,
  Decoder,
  TOKENS,
  createContract,
  events,
} from '../abi/index.ts';
import { addChecksum, isValidAddress, parseAddress } from '../core/address.ts';
import { ethHex } from '../utils.ts';
import type { PreparedTx } from '../net.ts';
import {
  isReverted,
  mapPool,
  throwIfAborted,
  withRetry,
  type Log,
  type Topics,
  type RpcClient,
} from '../net.ts';

const ERC_TRANSFER = /* @__PURE__ */ (() => events(ERC20).Transfer)();
const WETH_DEPOSIT = /* @__PURE__ */ (() => events(WETH).Deposit)();
const WETH_WITHDRAW = /* @__PURE__ */ (() => events(WETH).Withdrawal)();
const ERC721_TRANSFER = /* @__PURE__ */ (() => events(ERC721).Transfer)();
const ERC1155_SINGLE = /* @__PURE__ */ (() => events(ERC1155).TransferSingle)();
const ERC1155_BATCH = /* @__PURE__ */ (() => events(ERC1155).TransferBatch)();
const _0n = /* @__PURE__ */ BigInt(0);
const _1n = /* @__PURE__ */ BigInt(1);
// Full ERC-721 enumeration is a wallet convenience, not a bulk-indexing API.
// The balance is returned by an untrusted contract, so cap it before allocating
// indexes or issuing tokenOfOwnerByIndex calls.
const MAX_ERC721_ENUMERABLE_BALANCE = BigInt(4096);

const ERC165 = [
  {
    type: 'function',
    name: 'supportsInterface',
    inputs: [{ name: 'interfaceID', type: 'bytes4' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

const CONTRACT_CAPABILITIES: Record<string, string> = {
  erc165: '0x01ffc9a7',
  erc165_check: '0xffffffff',
  erc20: '0x36372b07',
  erc721: '0x80ac58cd',
  erc721_metadata: '0x5b5e139f',
  erc721_enumerable: '0x780e9d63',
  erc1155: '0xd9b67a26',
  erc1155_tokenreceiver: '0x4e2312e0',
  erc1155_metadata: '0x0e89341c',
};

type TokenProvider = Pick<RpcClient, 'call' | 'ethCall' | 'estimateGas' | 'ethLogs'>;

type ERC20Token = {
  abi: 'ERC20';
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply: bigint;
};
type ERC721Token = {
  abi: 'ERC721';
  name?: string;
  symbol?: string;
  totalSupply?: bigint;
  enumerable?: boolean;
  metadata?: boolean;
};
type ERC1155Token = { abi: 'ERC1155' };
export type TokenInfo = { contract: string } & (ERC20Token | ERC721Token | ERC1155Token);
export type TokenError = { contract: string; error: string };
type TokenBalanceSingle = Map<bigint, bigint>;

export type TokenBalances = Record<string, TokenBalanceSingle | TokenError>;
export type TokenTransfer = TokenInfo & { from: string; to: string; tokens: Map<bigint, bigint> };
export type TxAllowances = Record<string, Record<string, bigint>>;

/**
 * Offline token registry used by the OTS history helpers and
 * tokenTransferFromCalldata: contract address (lowercase) -> minimal metadata.
 * Defaults to the built-in TOKENS registry; receipt-log decoding falls back to
 * the log shape for unknown contracts (use tokenInfo() when their
 * symbol/decimals are needed).
 */
export type TokenRegistry = Record<
  string,
  {
    abi: 'ERC20' | 'ERC721' | 'ERC1155';
    symbol?: string;
    decimals?: number;
    /**
     * Set `false` for entries whose metadata came from on-chain probing rather
     * than a curated list; decoded transfers inherit it. Discovery marks its
     * entries automatically.
     */
    verified?: boolean;
  }
>;

/**
 * A token movement decoded offline (from receipt logs or calldata) against a
 * TokenRegistry. Same tokens Map shape as TokenTransfer, but without the
 * network-derived tokenInfo fields (totalSupply etc.).
 */
export type DecodedTokenTransfer = {
  contract: string;
  abi: 'ERC20' | 'ERC721' | 'ERC1155';
  symbol?: string;
  decimals?: number;
  /** Undefined only for calldata-decoded `transfer` when the tx sender is unknown. */
  from?: string;
  to: string;
  /** Map<tokenId, value>; ERC-20 always uses the single id 1n. */
  tokens: Map<bigint, bigint>;
  /**
   * `false` when symbol/decimals came from on-chain discovery: display-grade
   * only — on-chain metadata is attacker-controlled (symbols can be phishing
   * URLs). Absent for registry-sourced entries.
   */
  verified?: boolean;
};

const isTokenError = (token: unknown): token is TokenError => {
  if (token === null || typeof token !== 'object') return false;
  const t = token as Partial<TokenError>;
  return typeof t.contract === 'string' && typeof t.error === 'string';
};

const validateToken = (token: unknown, name: string): TokenInfo => {
  if (token === null || typeof token !== 'object') throw new Error(`${name}: wrong token`);
  const t = token as Partial<TokenInfo & TokenError>;
  if (typeof t.contract !== 'string') throw new Error(`${name}: wrong token`);
  if ('error' in t) throw new Error(`${name}: wrong token`);
  if (t.abi !== 'ERC20' && t.abi !== 'ERC721' && t.abi !== 'ERC1155')
    throw new Error(`${name}: wrong token`);
  return t as TokenInfo;
};

async function wait<T extends Record<string, Promise<any>>>(
  obj: T
): Promise<{ [K in keyof T]?: T[K] extends Promise<infer R> ? R : never }> {
  const keys = Object.keys(obj) as (keyof T)[];
  const p = await Promise.allSettled(Object.values(obj));
  const res = p.map((r, i) => [keys[i], r.status === 'fulfilled' ? r.value : undefined]);
  return Object.fromEntries(res) as { [K in keyof T]?: T[K] extends Promise<infer R> ? R : never };
}

export async function contractCapabilities(
  prov: TokenProvider,
  address: string,
  capabilities: Record<string, string> = {}
): Promise<{
  [k: string]: boolean;
}> {
  const all = { ...CONTRACT_CAPABILITIES, ...capabilities };
  const c = createContract(ERC165, prov, address);
  const keys = Object.keys(all);
  try {
    const promises = await Promise.all(
      Object.values(all).map((i) => c.supportsInterface.call(ethHex.decode(i)))
    );
    const res = Object.fromEntries(keys.map((k, i) => [k, promises[i]]));
    if (!res.erc165 || res.erc165_check) for (const k in res) res[k] = false;
    return res;
  } catch (e) {
    if (isReverted(e as Error)) return Object.fromEntries(keys.map((k) => [k, false]));
    throw e;
  }
}

export async function tokenInfo(
  prov: TokenProvider,
  contract: string,
  signal?: AbortSignal
): Promise<TokenInfo | TokenError> {
  const c = createContract(ERC20, prov, contract);
  // each probe retries transient node failures: a reverting name()/symbol() is
  // how non-ERC20 contracts answer (passed through), but a momentary outage
  // must not misclassify the token — results get cached for whole sessions
  const probe = <T>(fn: () => Promise<T>) => withRetry(fn, signal, 'tokenInfo');
  const t = await wait({
    code: probe(() => prov.call('eth_getCode', contract, 'latest')),
    capabilities: probe(() => contractCapabilities(prov, contract)),
    name: probe(() => c.name.call()),
    symbol: probe(() => c.symbol.call()),
    decimals: probe(() => c.decimals.call()),
    totalSupply: probe(() => c.totalSupply.call()),
  });
  // Probe failures are optional metadata, but cancellation must remain observable.
  throwIfAborted(signal, 'tokenInfo');
  if (t.code === '0x') return { contract, error: 'not contract or destructed' };
  if (t.capabilities && t.capabilities.erc1155) {
    return { contract, abi: 'ERC1155' };
  }
  if (t.capabilities && t.capabilities.erc721) {
    const res: Partial<ERC721Token> & { contract: string; abi: 'ERC721' } = {
      contract,
      abi: 'ERC721',
    };
    if (t.capabilities.erc721_metadata) {
      if (t.name === undefined) return { contract, error: 'ERC721+Metadata without name' };
      if (t.symbol === undefined) return { contract, error: 'ERC721+Metadata without symbol' };
      Object.assign(res, { name: t.name, symbol: t.symbol, metadata: true });
    }
    if (t.capabilities.erc721_enumerable) {
      if (t.totalSupply === undefined)
        return { contract, error: 'ERC721+Enumerable without totalSupply' };
      Object.assign(res, { totalSupply: t.totalSupply, enumerable: true });
    }
    return res as TokenInfo;
  }
  if (t.totalSupply === undefined) return { contract, error: 'not ERC20 token' };
  return {
    contract,
    abi: 'ERC20',
    name: t.name,
    symbol: t.symbol,
    totalSupply: t.totalSupply,
    decimals: t.decimals === undefined ? undefined : Number(t.decimals),
  };
}

async function tokenBalanceSingle(
  prov: TokenProvider,
  address: string,
  token: TokenInfo | TokenError,
  tokenIds?: Set<bigint>
): Promise<TokenBalanceSingle | TokenError> {
  if (isTokenError(token)) return token;
  token = validateToken(token, 'tokenBalanceSingle');
  if (token.abi === 'ERC20') {
    if (tokenIds && tokenIds.size === 0) return new Map();
    const balance = await createContract(ERC20, prov, token.contract).balanceOf.call(address);
    if (tokenIds && (tokenIds.size > 1 || Array.from(tokenIds)[0] !== _1n)) {
      return { contract: token.contract, error: 'unexpected tokenIds for ERC20' };
    }
    return new Map([[_1n, balance]]);
  } else if (token.abi === 'ERC721') {
    const c = createContract(ERC721, prov, token.contract);
    const balance = await c.balanceOf.call(address);
    if (!token.enumerable) {
      if (!tokenIds) {
        if (!balance) return new Map();
        return {
          contract: token.contract,
          error: 'erc721 contract not enumerable, but owner has ' + balance + ' tokens',
        };
      }
      const ids = Array.from(tokenIds);
      // History includes burned ids; their ownerOf revert must not hide other held candidates.
      const owners = await Promise.all(
        ids.map((i) =>
          c.ownerOf.call(i).catch((error) => {
            if (!isReverted(error)) throw error;
          })
        )
      );
      return new Map(
        ids.map((i, j) => [i, owners[j]?.toLowerCase() === address.toLowerCase() ? _1n : _0n])
      );
    }
    if (balance > MAX_ERC721_ENUMERABLE_BALANCE) {
      return {
        contract: token.contract,
        error: `erc721 enumerable balance ${balance} exceeds limit ${MAX_ERC721_ENUMERABLE_BALANCE}`,
      };
    }
    const indexes = Array.from({ length: Number(balance) }, (_, i) => BigInt(i));
    tokenIds = new Set(
      await mapPool(indexes, (index) => c.tokenOfOwnerByIndex.call({ owner: address, index }), {
        concurrency: 10,
        name: 'tokenBalanceSingle',
      })
    );
    const ids = Array.from(tokenIds!);
    return new Map(ids.map((i) => [i, _1n]));
  } else if (token.abi === 'ERC1155') {
    if (!tokenIds)
      return { contract: token.contract, error: 'cannot fetch erc1155 without tokenIds' };
    const c = createContract(ERC1155, prov, token.contract);
    const ids = Array.from(tokenIds);
    const balances = await c.balanceOfBatch.call({ accounts: ids.map((_) => address), ids });
    // balanceOfBatch must return one balance for every requested account/id pair.
    if (balances.length !== ids.length)
      throw new Error(`balanceOfBatch: expected ${ids.length} balances, got ${balances.length}`);
    const res = new Map(ids.map((i, j) => [i, balances[j]]));
    return res;
  }
  throw new Error('unknown token type');
}

export async function tokenURI(
  prov: TokenProvider,
  token: TokenInfo | TokenError | string,
  tokenId: bigint
): Promise<string | TokenError> {
  if (typeof token === 'string') token = await tokenInfo(prov, token);
  if (isTokenError(token)) return token;
  token = validateToken(token, 'tokenURI');
  if (token.abi === 'ERC721') {
    const c = createContract(ERC721, prov, token.contract);
    if (!token.metadata) return { contract: token.contract, error: 'erc721 without metadata' };
    return c.tokenURI.call(tokenId);
  } else if (token.abi === 'ERC1155') {
    const c = createContract(ERC1155, prov, token.contract);
    const uri = await c.uri.call(tokenId);
    // ERC-1155 metadata spec: clients MUST substitute '{id}' with the token id
    // as 64 hex chars, zero-padded, lowercase, without 0x
    return uri.replaceAll('{id}', tokenId.toString(16).padStart(64, '0'));
  }
  return { contract: token.contract, error: 'not supported token type' };
}

/**
 * Rewrites `ipfs://` (and the legacy `ipfs://ipfs/` form) to an HTTP gateway
 * URL; other URIs pass through unchanged. Offline. The default gateway is a
 * public one — production apps should pass their own.
 */
export function ipfsToHttp(uri: string, gateway: string = 'https://ipfs.io/ipfs/'): string {
  if (typeof uri !== 'string') throw new Error('ipfsToHttp: wrong uri');
  if (typeof gateway !== 'string' || !gateway) throw new Error('ipfsToHttp: wrong gateway');
  if (!gateway.endsWith('/')) gateway += '/';
  return uri.replace(/^ipfs:\/\/(ipfs\/)?/i, gateway);
}

/** Common fields of a fetched NFT metadata JSON; see nftMetadata(). */
export type NftMetadata = {
  name?: string;
  description?: string;
  image?: string;
  animationUrl?: string;
  externalUrl?: string;
};

/**
 * Extracts the common fields from a fetched NFT metadata JSON (`image_url` is
 * accepted as an `image` alias). Metadata is attacker-controlled — the same
 * trust class as discovered token symbols — so URL fields are dropped unless
 * they are http(s) or ipfs; a `javascript:` or `data:` payload never reaches
 * an image src or link. Offline; fetching the JSON is the caller's job.
 */
export function nftMetadata(json: unknown): NftMetadata {
  const out: NftMetadata = {};
  if (json === null || typeof json !== 'object') return out;
  const m = json as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
  const url = (value: unknown) => {
    const s = text(value);
    return s && /^(https?|ipfs):\/\//i.test(s) ? s : undefined;
  };
  // undefined keys are omitted so results survive JSON round-trips unchanged
  const name = text(m.name);
  if (name !== undefined) out.name = name;
  const description = text(m.description);
  if (description !== undefined) out.description = description;
  const image = url(m.image) ?? url(m.image_url);
  if (image !== undefined) out.image = image;
  const animationUrl = url(m.animation_url);
  if (animationUrl !== undefined) out.animationUrl = animationUrl;
  const externalUrl = url(m.external_url);
  if (externalUrl !== undefined) out.externalUrl = externalUrl;
  return out;
}

/**
 * Balances for a list of tokens. Contract-address strings cost one
 * `tokenInfo()` metadata probe each; pass `TokenInfo` objects (e.g. from the
 * offline registry) to skip those extra requests.
 * When the provider exposes `multicall` (RpcClient does), plain ERC-20
 * `balanceOf` reads are batched into one Multicall3 round instead of one
 * `eth_call` each; chains without the deployment fall back per-token.
 */
export async function tokenBalances(
  prov: TokenProvider & { multicall?: RpcClient['multicall'] },
  address: string,
  tokens: (string | TokenInfo)[],
  tokenIds?: Record<string, Set<bigint>>
): Promise<TokenBalances> {
  const _tokens: (TokenInfo | TokenError)[] = await Promise.all(
    tokens.map((i) => (typeof i === 'string' ? tokenInfo(prov, i) : i))
  );
  for (let i = 0; i < _tokens.length; i++) {
    const token = _tokens[i];
    if (!isTokenError(token)) _tokens[i] = validateToken(token, 'tokenBalances');
  }
  const balances: (TokenBalanceSingle | TokenError)[] = new Array(_tokens.length);
  // per-id NFT reads and error entries keep the per-token path; a single
  // ERC-20 gains nothing from the aggregate indirection
  let batch =
    typeof prov.multicall === 'function'
      ? _tokens.flatMap((t, i) =>
          !isTokenError(t) && t.abi === 'ERC20' && !(tokenIds && tokenIds[t.contract]) ? [i] : []
        )
      : [];
  if (batch.length > 1) {
    const balanceOf = createContract(ERC20).balanceOf;
    try {
      const res = await prov.multicall!(
        batch.map((i) => ({
          to: _tokens[i].contract,
          data: ethHex.encode(balanceOf.encodeInput(address)),
          allowFailure: true,
        }))
      );
      for (let j = 0; j < batch.length; j++) {
        const contract = _tokens[batch[j]].contract;
        try {
          if (!res[j].success) throw new Error('call failed');
          balances[batch[j]] = new Map([[_1n, balanceOf.decodeOutput(ethHex.decode(res[j].data))]]);
        } catch (e) {
          balances[batch[j]] = { contract, error: `balanceOf: ${(e as Error).message}` };
        }
      }
    } catch {
      batch = []; // no Multicall3 on this chain: per-token below
    }
  } else batch = [];
  const batched = new Set(batch);
  await Promise.all(
    _tokens.map(async (t, i) => {
      if (batched.has(i)) return;
      balances[i] = await tokenBalanceSingle(prov, address, t, tokenIds && tokenIds[t.contract]);
    })
  );
  return Object.fromEntries(_tokens.map((i, j) => [i.contract, balances[j]])) as any;
}

/**
 * ERC-20 amount out of a per-token result: tokenBalances() entries and
 * TokenTransfer.tokens both key ERC-20 movements as `map[1n]` (the shape that
 * unifies them with per-id NFT balances). Returns the amount (0n for an empty
 * map), or undefined for a TokenError / missing entry.
 */
export function erc20Amount(
  value: Map<bigint, bigint> | TokenError | undefined
): bigint | undefined {
  if (!(value instanceof Map)) return undefined;
  return value.get(_1n) ?? _0n;
}

/**
 * Signed per-id movement of one decoded transfer for the given address(es):
 * the token analogue of txDiff. Positive = received, negative = sent,
 * zero = a self-transfer within the watched set. ERC-20 amounts sit under
 * id 1n (unwrap with erc20Amount).
 */
export function tokenDiff(
  transfer: Pick<DecodedTokenTransfer, 'from' | 'to' | 'tokens'>,
  address: string | string[]
): Map<bigint, bigint> {
  const watched = new Set(
    (Array.isArray(address) ? address : [address]).map((a) => a.toLowerCase())
  );
  const out = new Map<bigint, bigint>();
  for (const [id, value] of transfer.tokens) {
    let diff = _0n;
    if (watched.has(transfer.to.toLowerCase())) diff += value;
    if (transfer.from !== undefined && watched.has(transfer.from.toLowerCase())) diff -= value;
    out.set(id, diff);
  }
  return out;
}

const tokenContract = (token: string | { contract: string } | undefined, name: string) => {
  if (token === undefined) return undefined;
  const contract = typeof token === 'string' ? token : token.contract;
  if (typeof contract !== 'string' || !isValidAddress(contract))
    throw new Error(`${name}: wrong token contract`);
  return addChecksum(contract);
};

export type TransferTxArgs = {
  from: string;
  to: string;
  /** Amount in base units (wei / token units); parse UI strings with createDecimal. */
  amount: bigint;
  /** ERC-20 contract address (or a TokenInfo-like object); omitted = plain ETH transfer. */
  token?: string | { contract: string };
  /** Throw when the node is on another chain; see RpcClient.prepare. */
  expectedChainId?: bigint;
  /** Verify the amount and the worst-case fee (gas is ETH even for tokens) against on-chain balances. Default true. */
  checkBalance?: boolean;
};

/**
 * Builds the fields of an ETH or ERC-20 transfer, ready for
 * `Transaction.prepare(fields).signBy(key)`: encodes `transfer(to, amount)`
 * calldata for tokens, fetches nonce/fees/gas limit/chain id in one round via
 * `prov.prepare`, and (by default) verifies the transfer is affordable
 * on-chain: the amount against the spent balance, and the worst-case fee
 * (`gasLimit * maxFeePerGas`, the mempool's reservation rule) against the
 * sender's ETH — gas is paid in ETH even for token transfers.
 * Nothing is signed or broadcast here.
 */
export async function transferTx(
  prov: Pick<RpcClient, 'prepare' | 'call' | 'ethCall' | 'estimateGas'>,
  args: TransferTxArgs
): Promise<PreparedTx> {
  const { checkBalance = true } = args;
  if (typeof args.from !== 'string' || !isValidAddress(args.from))
    throw new Error('transferTx: wrong from');
  if (typeof args.to !== 'string' || !isValidAddress(args.to))
    throw new Error('transferTx: wrong to');
  if (typeof args.amount !== 'bigint' || args.amount <= _0n)
    throw new Error('transferTx: wrong amount');
  const to = addChecksum(args.to);
  const token = tokenContract(args.token, 'transferTx');
  let ethBalance: bigint | undefined;
  if (checkBalance) {
    // gas is paid in ETH either way, so token transfers read both balances
    // (one batched round); the fee affordability itself is checked after
    // prepare, once the gas limit and fees are known
    const [eth, tokenBalance] = await Promise.all([
      prov.call('eth_getBalance', args.from, 'latest').then(BigInt),
      token ? createContract(ERC20, prov, token).balanceOf.call(args.from) : undefined,
    ]);
    ethBalance = eth;
    const available = token ? tokenBalance! : eth; // tokenBalance is set iff token is
    if (args.amount > available)
      throw new Error(`transferTx: amount ${args.amount} exceeds balance of ${available}`);
  }
  const call = token
    ? {
        from: args.from,
        to: token,
        data: ethHex.encode(createContract(ERC20).transfer.encodeInput({ to, value: args.amount })),
      }
    : { from: args.from, to, value: args.amount };
  const fields = await prov.prepare({ ...call, expectedChainId: args.expectedChainId });
  if (ethBalance !== undefined) {
    // the mempool rule: balance must cover value plus gasLimit * maxFeePerGas.
    // eth_estimateGas and eth_call run without fee fields and never check
    // this, so without the guard an unaffordable transfer builds "fine" and
    // only fails at broadcast
    const perGas = fields.type === 'legacy' ? fields.gasPrice : fields.maxFeePerGas;
    const maxFee = fields.gasLimit * perGas;
    if (token ? maxFee > ethBalance : args.amount + maxFee > ethBalance)
      throw new Error(
        token
          ? `transferTx: the worst-case fee of ${maxFee} exceeds the ETH balance of ${ethBalance} ` +
              '(gas is paid in ETH, not in the token)'
          : `transferTx: amount plus the worst-case fee of ${maxFee} exceeds balance of ${ethBalance} ` +
              '(use maxSpendable to reserve the fee)'
      );
  }
  return fields;
}

/**
 * Largest transferable amount in base units: the full token balance for
 * ERC-20s; for ETH, the balance minus a plain-transfer (21000 gas) reserve at
 * the current worst-case gas price — sends into contracts may need a larger
 * reserve.
 */
export async function maxSpendable(
  prov: Pick<RpcClient, 'fees' | 'call' | 'ethCall' | 'estimateGas'>,
  args: { from: string; token?: string | { contract: string } }
): Promise<bigint> {
  if (typeof args.from !== 'string' || !isValidAddress(args.from))
    throw new Error('maxSpendable: wrong from');
  const token = tokenContract(args.token, 'maxSpendable');
  if (token) return createContract(ERC20, prov, token).balanceOf.call(args.from);
  const [balance, fees] = await Promise.all([
    prov.call('eth_getBalance', args.from, 'latest'),
    prov.fees(),
  ]);
  const perGas = fees.type === 'legacy' ? fees.gasPrice : fees.maxFeePerGas;
  const spendable = BigInt(balance) - BigInt(21000) * perGas;
  return spendable > _0n ? spendable : _0n;
}

export function decodeTokenTransfer(
  token: TokenInfo | TokenError,
  log: Log
): TokenTransfer | undefined {
  if ('error' in token) return;
  if (token.abi === 'ERC20') {
    try {
      const decoded = ERC_TRANSFER.decode(log.topics, log.data);
      return {
        ...token,
        contract: log.address,
        to: decoded.to,
        from: decoded.from,
        tokens: new Map([[_1n, decoded.value]]),
      };
    } catch (e) {}
    try {
      const decoded = WETH_DEPOSIT.decode(log.topics, log.data);
      return {
        ...token,
        contract: log.address,
        from: log.address,
        to: decoded.dst,
        tokens: new Map([[_1n, decoded.wad]]),
      };
    } catch (e) {}
    try {
      const decoded = WETH_WITHDRAW.decode(log.topics, log.data);
      return {
        ...token,
        contract: log.address,
        from: decoded.src,
        to: log.address,
        tokens: new Map([[_1n, decoded.wad]]),
      };
    } catch (e) {}
  } else if (token.abi === 'ERC721') {
    try {
      const decoded = ERC721_TRANSFER.decode(log.topics, log.data);
      return {
        ...token,
        from: decoded.from,
        to: decoded.to,
        tokens: new Map([[decoded.tokenId, _1n]]),
      };
    } catch (e) {}
  } else if (token.abi === 'ERC1155') {
    try {
      const decoded = ERC1155_SINGLE.decode(log.topics, log.data);
      return {
        ...token,
        from: decoded.from,
        to: decoded.to,
        tokens: new Map([[decoded.id, decoded.value]]),
      };
    } catch (e) {}
    try {
      const decoded = ERC1155_BATCH.decode(log.topics, log.data);
      if (decoded.ids.length !== decoded.values.length)
        throw new Error('wrong ERC1155 batch lengths');
      return {
        ...token,
        from: decoded.from,
        to: decoded.to,
        tokens: new Map(decoded.ids.map((i, j) => [i, decoded.values[j]])),
      };
    } catch (e) {}
  }
  return;
}

/**
 * All token movements in a receipt, including between third parties, decoded
 * against a registry. Offline. Contracts outside the registry still decode:
 * the log's topic shape pins the standard and the raw movement, with
 * symbol/decimals left undefined and `verified: false` (pair with
 * detectTokenContracts + tokenInfos when metadata is needed).
 */
export function decodeReceiptAllTokenTransfers(
  receipt: { logs: Log[] } | undefined,
  tokens: TokenRegistry
): DecodedTokenTransfer[] {
  const out: DecodedTokenTransfer[] = [];
  for (const log of (receipt && receipt.logs) || []) {
    if (!log.address) continue;
    const contract = log.address.toLowerCase();
    let def = tokens[contract];
    if (!def) {
      const shape = logTransferShape(log);
      if (!shape) continue;
      def = { abi: shape.abi, verified: false };
    }
    const tt = decodeTokenTransfer({ contract, ...def } as TokenInfo, log);
    if (!tt) continue;
    // no explicit undefined keys: decoded rows must survive JSON round-trips
    const decoded: DecodedTokenTransfer = {
      contract,
      abi: def.abi,
      from: tt.from,
      to: tt.to,
      tokens: tt.tokens,
    };
    if (def.symbol !== undefined) decoded.symbol = def.symbol;
    if (def.decimals !== undefined) decoded.decimals = def.decimals;
    if (def.verified !== undefined) decoded.verified = def.verified;
    out.push(decoded);
  }
  return out;
}

/**
 * Token movements involving `address`, decoded from receipt logs already in
 * hand. Registry-based and offline; unknown transfer-shaped contracts decode
 * without metadata (see decodeReceiptAllTokenTransfers).
 */
export function decodeReceiptTokenTransfers(
  receipt: { logs: Log[] } | undefined,
  address: string,
  tokens: TokenRegistry
): DecodedTokenTransfer[] {
  const a = address.toLowerCase();
  return decodeReceiptAllTokenTransfers(receipt, tokens).filter(
    (tt) => tt.from?.toLowerCase() === a || tt.to.toLowerCase() === a
  );
}

// topic0 -> which indexed slots can hold a participating address, plus the
// standard when the topic alone decides it (the shared ERC-20/721 Transfer
// signature is disambiguated by indexed-parameter count instead).
const transferHints = /* @__PURE__ */ (() => {
  let hints: Record<string, { at: number[]; abi?: 'ERC20' | 'ERC1155' }> | undefined;
  return () => {
    if (!hints)
      hints = {
        [ERC_TRANSFER.topics({ from: null, to: null, value: null })[0] as string]: { at: [1, 2] },
        [ERC1155_SINGLE.topics({
          operator: null,
          from: null,
          to: null,
          id: null,
          value: null,
        })[0] as string]: { at: [2, 3], abi: 'ERC1155' },
        [ERC1155_BATCH.topics({
          operator: null,
          from: null,
          to: null,
          ids: null,
          values: null,
        })[0] as string]: { at: [2, 3], abi: 'ERC1155' },
        [WETH_DEPOSIT.topics({ dst: null, wad: null })[0] as string]: { at: [1], abi: 'ERC20' },
        [WETH_WITHDRAW.topics({ src: null, wad: null })[0] as string]: { at: [1], abi: 'ERC20' },
      };
    return hints;
  };
})();

// The standard a transfer-shaped log implies (ERC-20/721/1155 Transfer topics
// plus WETH Deposit/Withdrawal), with the indexed slots that can hold a
// participating address; undefined when the log is not transfer-shaped.
function logTransferShape(
  log: Log
): { abi: 'ERC20' | 'ERC721' | 'ERC1155'; at: number[] } | undefined {
  if (!log.address || !log.topics.length) return;
  const hint = transferHints()[log.topics[0].toLowerCase()];
  if (!hint) return;
  let abi: 'ERC20' | 'ERC721' | 'ERC1155' | undefined = hint.abi;
  if (!abi) {
    // shared Transfer signature: ERC-20 indexes from/to, ERC-721 also tokenId
    if (log.topics.length === 3) abi = 'ERC20';
    else if (log.topics.length === 4) abi = 'ERC721';
    else return;
  }
  return { abi, at: hint.at };
}

/**
 * Contracts whose logs look like token transfers, with the standard implied by
 * the log shape: ERC-20/721/1155 Transfer topics plus WETH Deposit/Withdrawal.
 * Offline discovery step: feed the result to tokenInfos() for metadata, then
 * decode with decodeReceiptTokenTransfers(). With `address`, only logs where
 * one of the participant slots is that address are considered.
 */
export function detectTokenContracts(
  logs: Log[] | { logs: Log[] } | undefined,
  address?: string
): Map<string, 'ERC20' | 'ERC721' | 'ERC1155'> {
  let account;
  try {
    // Topic suffix matching is exact only after normalizing a complete 20-byte address.
    account = address === undefined ? undefined : parseAddress(address).data.toLowerCase();
  } catch {
    throw new Error('detectTokenContracts: wrong address');
  }
  const out = new Map<string, 'ERC20' | 'ERC721' | 'ERC1155'>();
  const items = Array.isArray(logs) ? logs : logs?.logs || [];
  for (const log of items) {
    const shape = logTransferShape(log);
    if (!shape) continue;
    if (account && !shape.at.some((i) => log.topics[i]?.toLowerCase().endsWith(account))) continue;
    const contract = log.address.toLowerCase();
    const prev = out.get(contract);
    // a 4-topic Transfer or an 1155 event is more specific than an ERC-20 guess
    if (prev === undefined || prev === 'ERC20') out.set(contract, shape.abi);
  }
  return out;
}

/**
 * Metadata for many contracts via a concurrency-capped tokenInfo() pool.
 * Never rejects for a single bad contract: failures become TokenError entries.
 * Keys are lowercased; results are caller-owned (persist them as a registry).
 */
export async function tokenInfos(
  prov: TokenProvider,
  contracts: Iterable<string>,
  opts: { concurrency?: number; signal?: AbortSignal } = {}
): Promise<Record<string, TokenInfo | TokenError>> {
  const unique = [...new Set([...contracts].map((c) => c.toLowerCase()))];
  const infos = await mapPool(
    unique,
    (contract) =>
      tokenInfo(prov, contract, opts.signal).then(
        (info) => info,
        (error) => ({ contract, error: (error as Error).message })
      ),
    { ...opts, name: 'tokenInfos' }
  );
  return Object.fromEntries(unique.map((contract, i) => [contract, infos[i]]));
}

/** One ERC-20 contract an address's history has touched; see erc20Candidates(). */
export type Erc20Candidate = {
  /** Lowercased contract address. */
  contract: string;
  abi: 'ERC20';
  /** First symbol seen among the source transfers; display-grade if verified is false. */
  symbol?: string;
  /** First decimals seen; missing for shape-decoded unknown tokens (probe with tokenInfos). */
  decimals?: number;
  /** Mirrors DecodedTokenTransfer.verified for the transfer the metadata came from. */
  verified?: boolean;
};

/**
 * Collects the ERC-20 contracts an address's history has touched: the bridge
 * from history() rows to tokenBalances(), and the fungible twin of
 * nftCandidates(). One entry per contract with first-seen metadata; NFT
 * movements are ignored. History is only discovery — pass the result to
 * tokenBalances() for current holdings.
 */
export function erc20Candidates(
  rows: Iterable<{ tokenTransfers: DecodedTokenTransfer[] }>
): Erc20Candidate[] {
  const byContract = new Map<string, Erc20Candidate>();
  for (const row of rows) {
    if (!Array.isArray(row?.tokenTransfers)) throw new Error('erc20Candidates: wrong rows');
    for (const transfer of row.tokenTransfers) {
      if (transfer.abi !== 'ERC20') continue;
      const key = transfer.contract.toLowerCase();
      let entry = byContract.get(key);
      if (!entry) byContract.set(key, (entry = { contract: key, abi: 'ERC20' }));
      if (entry.symbol === undefined && transfer.symbol !== undefined) {
        entry.symbol = transfer.symbol;
        if (transfer.verified !== undefined) entry.verified = transfer.verified;
      }
      if (entry.decimals === undefined && transfer.decimals !== undefined)
        entry.decimals = transfer.decimals;
    }
  }
  return [...byContract.values()];
}

/** One spendable balance; `contract` is absent for the native asset (ETH). */
export type SpendableAsset = {
  symbol?: string;
  decimals: number;
  balance: bigint;
  contract?: string;
  /** Mirrors the provenance of discovered metadata; absent for curated/native entries. */
  verified?: boolean;
};

/**
 * What the account can actually spend: its native balance plus every ERC-20
 * with a non-zero balance among `opts.tokens` (a curated list) and the tokens
 * its history has touched (`opts.rows` via erc20Candidates). The asset list a
 * wallet's send screen offers — entries feed transferTx/maxSpendable as-is.
 * Discovered candidates without decimals are skipped (their amounts could not
 * be rendered); probe them with tokenInfos and pass via `opts.tokens` to
 * include them. Pass `opts.ethBalance` when the native balance is already in
 * hand to skip the extra read.
 */
export async function spendableAssets(
  prov: TokenProvider & { multicall?: RpcClient['multicall'] },
  address: string,
  opts: {
    rows?: Iterable<{ tokenTransfers: DecodedTokenTransfer[] }>;
    tokens?: { contract: string; symbol?: string; decimals: number }[];
    ethBalance?: bigint;
  } = {}
): Promise<SpendableAsset[]> {
  if (typeof address !== 'string') throw new Error('spendableAssets: wrong address');
  const byContract = new Map<string, Omit<SpendableAsset, 'balance'> & { contract: string }>();
  for (const token of opts.tokens ?? []) {
    if (typeof token?.contract !== 'string' || typeof token.decimals !== 'number')
      throw new Error('spendableAssets: wrong token entry');
    byContract.set(token.contract.toLowerCase(), {
      contract: token.contract,
      symbol: token.symbol,
      decimals: token.decimals,
    });
  }
  for (const candidate of erc20Candidates(opts.rows ?? [])) {
    if (typeof candidate.decimals !== 'number' || byContract.has(candidate.contract)) continue;
    const entry: Omit<SpendableAsset, 'balance'> & { contract: string } = {
      contract: addChecksum(candidate.contract),
      symbol: candidate.symbol,
      decimals: candidate.decimals,
    };
    if (candidate.verified !== undefined) entry.verified = candidate.verified;
    byContract.set(candidate.contract, entry);
  }
  const tokens = [...byContract.values()];
  const [ethBalance, balances] = await Promise.all([
    opts.ethBalance !== undefined
      ? opts.ethBalance
      : prov.call('eth_getBalance', address, 'latest').then(BigInt),
    tokens.length
      ? tokenBalances(
          prov,
          address,
          tokens.map((t) => ({ ...t, abi: 'ERC20' }) as TokenInfo)
        )
      : ({} as TokenBalances),
  ]);
  const assets: SpendableAsset[] = [{ symbol: 'ETH', decimals: 18, balance: ethBalance }];
  for (const token of tokens) {
    // per-token errors read as empty: the asset just doesn't appear
    const balance = erc20Amount(balances[token.contract]) ?? _0n;
    if (balance > _0n) assets.push({ ...token, balance });
  }
  return assets;
}

/** One NFT contract an address's history has touched; see nftCandidates(). */
export type NftCandidate = {
  /** Lowercased contract address. */
  contract: string;
  abi: 'ERC721' | 'ERC1155';
  /** First symbol seen among the source transfers; display-grade if verified is false. */
  symbol?: string;
  /** Mirrors DecodedTokenTransfer.verified for the transfer the symbol came from. */
  verified?: boolean;
  /** Every token id seen, with placeholder amounts — feed to nftHoldings() to verify. */
  tokens: Map<bigint, bigint>;
};

/**
 * Collects the NFT contracts and token ids an address's history has touched:
 * the bridge from history() rows to nftHoldings(). One entry per contract,
 * ids merged across transfers; ERC-20 movements are ignored. History is only
 * discovery — pass the result to nftHoldings() for on-chain ownership.
 */
export function nftCandidates(
  rows: Iterable<{ tokenTransfers: DecodedTokenTransfer[] }>
): NftCandidate[] {
  const byContract = new Map<string, NftCandidate>();
  for (const row of rows) {
    if (!Array.isArray(row?.tokenTransfers)) throw new Error('nftCandidates: wrong rows');
    for (const transfer of row.tokenTransfers) {
      if (transfer.abi !== 'ERC721' && transfer.abi !== 'ERC1155') continue;
      const key = transfer.contract.toLowerCase();
      let entry = byContract.get(key);
      if (!entry)
        byContract.set(key, (entry = { contract: key, abi: transfer.abi, tokens: new Map() }));
      if (entry.symbol === undefined && transfer.symbol !== undefined) {
        entry.symbol = transfer.symbol;
        if (transfer.verified !== undefined) entry.verified = transfer.verified;
      }
      for (const id of transfer.tokens.keys()) if (!entry.tokens.has(id)) entry.tokens.set(id, _1n);
    }
  }
  return [...byContract.values()];
}

/**
 * Current NFT inventory from transfer-derived candidates: history is only
 * discovery, ownership is verified on-chain (ownerOf for ERC-721, balanceOf
 * for ERC-1155). Zero-balance ids are dropped; per-contract failures become
 * TokenError entries. ERC-20 candidates are ignored.
 */
export async function nftHoldings(
  prov: TokenProvider,
  address: string,
  candidates: Iterable<Pick<DecodedTokenTransfer, 'contract' | 'abi' | 'tokens'>>,
  opts: { concurrency?: number; signal?: AbortSignal } = {}
): Promise<TokenBalances> {
  if (typeof address !== 'string') throw new Error('nftHoldings: wrong address');
  const byContract = new Map<string, { abi: 'ERC721' | 'ERC1155'; ids: Set<bigint> }>();
  for (const candidate of candidates) {
    if (candidate.abi !== 'ERC721' && candidate.abi !== 'ERC1155') continue;
    const key = candidate.contract.toLowerCase();
    let entry = byContract.get(key);
    if (!entry) byContract.set(key, (entry = { abi: candidate.abi, ids: new Set() }));
    for (const id of candidate.tokens.keys()) entry.ids.add(id);
  }
  const contracts = [...byContract];
  const out: TokenBalances = {};
  const _0n = BigInt(0);
  const balances = await mapPool(
    contracts,
    ([contract, { abi, ids }]) =>
      withRetry(() => tokenBalanceSingle(prov, address, { contract, abi }, ids), opts.signal).then(
        (value) => value,
        (error) => ({ contract, error: (error as Error).message })
      ),
    { ...opts, name: 'nftHoldings' }
  );
  for (let i = 0; i < contracts.length; i++) {
    const [contract] = contracts[i];
    const balance = balances[i];
    if (balance instanceof Map) {
      const held = new Map([...balance].filter(([, value]) => value > _0n));
      if (held.size) out[contract] = held;
    } else out[contract] = balance;
  }
  return out;
}

export function approvalTopics(address: string): Topics {
  if (typeof address !== 'string') throw new Error('approvalTopics: wrong address');
  const approval = events(ERC20).Approval;
  return approval.topics({ owner: address, spender: null, value: null });
}

export function calcAllowances(logs: Log[], address: string): TxAllowances {
  if (typeof address !== 'string') throw new Error('calcAllowances: wrong address');
  const approval = events(ERC20).Approval;
  const res: TxAllowances = {};
  for (const l of logs) {
    const decoded = approval.decode(l.topics, l.data);
    if (decoded.owner.toLowerCase() !== address.toLowerCase()) continue;
    if (!res[l.address]) res[l.address] = {};
    res[l.address][decoded.spender] = decoded.value;
  }
  return res;
}

/**
 * Token movement implied by a transaction's CALLDATA: direct `transfer` /
 * `transferFrom` calls on registry-known ERC-20 contracts. Pending (mempool)
 * transactions have no receipt logs yet; for confirmed transactions prefer
 * receipt logs. Offline, no requests.
 */
export function tokenTransferFromCalldata(
  tx: { to?: string | null; input?: string; from?: string },
  tokens: TokenRegistry = TOKENS as TokenRegistry
): DecodedTokenTransfer | undefined {
  if (tx === null || typeof tx !== 'object') throw new Error('tokenTransferFromCalldata: wrong tx');
  if (!tx.to || !tx.input || tx.input === '0x') return;
  const contract = tx.to.toLowerCase();
  const def = tokens[contract];
  if (!def || def.abi !== 'ERC20') return;
  let decoded;
  try {
    const decoder = new Decoder();
    decoder.add(contract, ERC20);
    decoded = decoder.decode(contract, ethHex.decode(tx.input), {});
  } catch (e) {
    return;
  }
  if (!decoded || Array.isArray(decoded) || !decoded.value) return;
  const value = decoded.value as { from?: string; to: string; value: bigint };
  if (decoded.name !== 'transfer' && decoded.name !== 'transferFrom') return;
  return {
    contract,
    abi: def.abi,
    symbol: def.symbol,
    decimals: def.decimals,
    from: decoded.name === 'transferFrom' ? value.from : tx.from,
    to: value.to,
    tokens: new Map([[_1n, value.value]]),
  };
}
