import { addr } from '../core/address.ts';
import { Transaction } from '../core/tx.ts';
import { astring, deepFreeze, ethHex, type TArg, type TRet } from '../utils.ts';
import {
  type ContractABI as _ContractABI,
  type ContractInfo as _ContractInfo,
  Decoder,
  type SignatureInfo as _SignatureInfo,
  createContract as _createContract,
  deployContract as _deployContract,
  events as _events,
} from './abi-decoder.ts';
import { default as _ERC1155 } from './abi-erc1155.ts';
import { default as _ERC20 } from './abi-erc20.ts';
import { default as _ERC721 } from './abi-erc721.ts';
import {
  _source as clearSigSource,
  eip712 as clearSigEip712,
  type ClearSigDef,
  type ClearSigOpt as ClearSigRenderOpt,
  type ClearSigResult,
  type ClearSigSource,
  type ClearSigTypedInput,
} from './clearsig.ts';
import { ERCS, OURS, addTokens } from './clearsig-repo.ts';
export { ERCS, OURS, addTokens } from './clearsig-repo.ts';
import {
  default as KYBER_NETWORK_PROXY,
  KYBER_NETWORK_PROXY_CONTRACT as _KYBER_NETWORK_PROXY_CONTRACT,
} from './abi-kyber.ts';
import {
  default as UNISWAP_V2_ROUTER,
  UNISWAP_V2_ROUTER_CONTRACT as _UNISWAP_V2_ROUTER_CONTRACT,
} from './abi-uniswap-v2.ts';
import {
  default as UNISWAP_V3_ROUTER,
  UNISWAP_V3_ROUTER_CONTRACT as _UNISWAP_V3_ROUTER_CONTRACT,
} from './abi-uniswap-v3.ts';
import { default as _WETH, WETH_CONTRACT } from './abi-weth.ts';

// We need to export raw contracts: CONTRACTS entries include addresses, so the
// registry shape cannot be reused in createContract with nice types.
/**
 * ERC-1155 ABI fragments used by the decoder helpers.
 * @example
 * Build a typed event topic encoder for ERC-1155 transfer logs.
 * ```ts
 * import { ERC1155, events } from 'micro-eth-signer/advanced/abi.js';
 * const erc1155 = events(ERC1155);
 * erc1155.TransferSingle.topics({
 *   operator: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
 *   from: null,
 *   to: null,
 *   id: null,
 *   value: null,
 * });
 * ```
 */
export const ERC1155 = _ERC1155;
/**
 * ERC-20 ABI fragments used by the decoder helpers.
 * @example
 * Encode an ERC-20 transfer call from the shared ABI fragments.
 * ```ts
 * import { ERC20, createContract } from 'micro-eth-signer/advanced/abi.js';
 * const erc20 = createContract(ERC20);
 * erc20.transfer.encodeInput({ to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', value: 1n });
 * ```
 */
export const ERC20 = _ERC20;
/**
 * ERC-721 ABI fragments used by the decoder helpers.
 * @example
 * Encode a standard ERC-721 balance lookup.
 * ```ts
 * import { ERC721, createContract } from 'micro-eth-signer/advanced/abi.js';
 * const erc721 = createContract(ERC721);
 * erc721.balanceOf.encodeInput('0xd8da6bf26964af9d7eed9e03e53415d37aa96045');
 * ```
 */
export const ERC721 = _ERC721;
/** Kyber router address used by the default decoder registry. */
export const KYBER_NETWORK_PROXY_CONTRACT = _KYBER_NETWORK_PROXY_CONTRACT;
/** Uniswap V2 router address used by the default decoder registry. */
export const UNISWAP_V2_ROUTER_CONTRACT = _UNISWAP_V2_ROUTER_CONTRACT;
/** Uniswap V3 router address used by the default decoder registry. */
export const UNISWAP_V3_ROUTER_CONTRACT = _UNISWAP_V3_ROUTER_CONTRACT;
/**
 * WETH ABI fragments used by decoder and routing helpers.
 * @example
 * Encode the payable WETH deposit call with the shared ABI wrapper.
 * ```ts
 * import { WETH, createContract } from 'micro-eth-signer/advanced/abi.js';
 * createContract(WETH).deposit.encodeInput();
 * ```
 */
export const WETH = _WETH;
/**
 * Contract ABI shape accepted by decoder helpers.
 * Passed into `createContract`, `Decoder.add`, `events`, and deployment helpers.
 */
export type ContractABI = _ContractABI;
/**
 * Metadata describing a contract and its known ABI.
 * Used in registries such as `CONTRACTS` and `TOKENS` to pair ABI fragments with token metadata.
 */
export type ContractInfo = _ContractInfo;
/** Decoded ABI signature information returned by decoder helpers. */
export type SignatureInfo = _SignatureInfo;
export type { ClearSigDef, ClearSigField, ClearSigResult, ClearSigTypedInput } from './clearsig.ts';
/** Clear-signing options for public ABI helpers. */
export type ClearSigOpt = Omit<ClearSigRenderOpt, 'clearSig'> & {
  /** Clear-signing descriptor files. Omitted means {@link CLEARSIG_REPO}. */
  clearSig?: Record<string, ClearSigDef>;
};
type CalldataInput = {
  to?: string;
  from?: string;
  data?: Uint8Array;
  value?: bigint;
  chainId?: bigint;
};
/**
 * Contract ABI decoder with signature/topic registries and optional ERC-7730 cache.
 * @example
 * Register a known contract before decoding its calldata or logs.
 * ```ts
 * const decoder = new Decoder();
 * decoder.add(
 *   '0xdac17f958d2ee523a2206206994597c13d831ec7',
 *   [{ type: 'function', name: 'totalSupply', outputs: [{ type: 'uint256' }] }] as const
 * );
 * ```
 */
export { Decoder };
/**
 * Creates a typed contract wrapper from ABI fragments.
 * @param abi - Contract ABI fragments to map into callable methods.
 * @param net - Optional provider used for `call` helpers.
 * @param contract - Optional contract address bound to the wrapper.
 * @returns Typed contract wrapper with encode/decode helpers.
 * @example
 * Build a typed wrapper and decode the fixed-size return payload.
 * ```ts
 * const abi = [
 *   {
 *     type: 'function',
 *     name: 'getReserves',
 *     outputs: [
 *       { name: 'reserve0', type: 'uint112' },
 *       { name: 'reserve1', type: 'uint112' },
 *       { name: 'blockTimestampLast', type: 'uint32' },
 *     ],
 *   },
 * ] as const;
 * createContract(abi).getReserves.decodeOutput(new Uint8Array(96));
 * ```
 */
export const createContract = _createContract;
/**
 * Creates deployment calldata from an ABI constructor definition.
 * @param abi - Contract ABI fragments that include the constructor.
 * @param bytecodeHex - Contract bytecode as a hex string.
 * @param args - Constructor arguments encoded against the ABI.
 * @returns Hex deployment payload ready to send in a contract-creation transaction.
 * @example
 * Append constructor arguments to contract bytecode before broadcasting it.
 * ```ts
 * const abi = [
 *   { type: 'constructor', inputs: [{ name: 'supply', type: 'uint256' }] },
 * ] as const;
 * deployContract(abi, '0x60ff', 1n);
 * ```
 */
export const deployContract = _deployContract;
/**
 * Builds typed event decoders from an ABI.
 * @param abi - Contract ABI fragments that include event definitions.
 * @returns Event-decoder object keyed by event name.
 * @example
 * Build an event decoder and precompute topic filters for indexed fields.
 * ```ts
 * const abi = [
 *   {
 *     type: 'event',
 *     name: 'Transfer',
 *     inputs: [
 *       { indexed: true, name: 'from', type: 'address' },
 *       { indexed: true, name: 'to', type: 'address' },
 *     ],
 *   },
 * ] as const;
 * events(abi).Transfer.topics({ from: null, to: null });
 * ```
 */
export const events = _events;

type TokenInfo = { abi: 'ERC20'; symbol: string; decimals: number; price?: number };

/** Built-in ERC-20 metadata used by decoder and swap helpers. */
export const TOKENS: Record<string, TokenInfo> = /* @__PURE__ */ (() =>
  deepFreeze(
    Object.fromEntries(
      (
        [
          ['UNI', '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'],
          ['BAT', '0x0d8775f648430679a709e98d2b0cb6250d2887ef'],
          // Required for Uniswap multi-hop routing
          ['USDT', '0xdac17f958d2ee523a2206206994597c13d831ec7', 6, 1],
          ['USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 6, 1],
          ['WETH', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'],
          ['WBTC', '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', 8],
          ['DAI', '0x6b175474e89094c44da98b954eedeac495271d0f', 18, 1],
          ['COMP', '0xc00e94cb662c3520282e6f5717214004a7f26888'],
          ['MKR', '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2'],
          ['AMPL', '0xd46ba6d942050d489dbd938a2c909a5d5039a161', 9],
        ] as [string, string, number?, number?][]
      ).map(([symbol, addr, decimals, price]) => [
        addr as string,
        { abi: 'ERC20' as const, symbol, decimals: decimals || 18, price },
      ])
    )
  ))();
/** Ready-to-use ERC-7730 descriptor files bound to the built-in token registry. */
export const CLEARSIG_REPO: Record<string, ClearSigDef> = /* @__PURE__ */ (() => {
  const tokens = { ...TOKENS };
  // WETH has a concrete descriptor with WETH ABI names (`dst`/`guy`/`wad`);
  // binding the generic ERC-20 file to the same address makes selector order matter.
  delete tokens[WETH_CONTRACT];
  return deepFreeze(addTokens({ ...ERCS, ...OURS }, tokens));
})();
// <address, contractInfo>
/** Built-in contract registry used by decode helpers. */
export const CONTRACTS: TRet<Record<string, ContractInfo>> = /* @__PURE__ */ (() =>
  // Public registries must be fully immutable; shallow freeze leaves ABI fragments
  // and metadata rewritable.
  deepFreeze({
    [UNISWAP_V2_ROUTER_CONTRACT]: { abi: UNISWAP_V2_ROUTER, name: 'UNISWAP V2 ROUTER' },
    [KYBER_NETWORK_PROXY_CONTRACT]: { abi: KYBER_NETWORK_PROXY, name: 'KYBER NETWORK PROXY' },
    [UNISWAP_V3_ROUTER_CONTRACT]: { abi: UNISWAP_V3_ROUTER, name: 'UNISWAP V3 ROUTER' },
    ...TOKENS,
    [WETH_CONTRACT]: { abi: WETH, name: 'WETH Token', decimals: 18, symbol: 'WETH' },
  }))();

/**
 * Renders ERC-7730 clear-signing data for EIP-712 typed data.
 * @param input - Typed-data object.
 * @param opts - Optional clear-signing descriptors and resolver callbacks. See {@link ClearSigOpt}.
 * @returns Clear-signing display data, or `undefined` when no descriptor matches.
 * @example
 * Render typed data through bundled clear-signing descriptors.
 * ```ts
 * const typed = { types: {}, primaryType: 'Msg', domain: {}, message: {} } as const;
 * await eip712(typed);
 * ```
 */
export function eip712(
  input: TArg<ClearSigTypedInput>,
  opts?: TArg<ClearSigOpt>
): Promise<ClearSigResult | undefined>;
export function eip712(
  input: TArg<ClearSigTypedInput>,
  opts: TArg<ClearSigOpt> = {}
): Promise<ClearSigResult | undefined> {
  const opt = opts as ClearSigOpt;
  const src = opt.clearSig || CLEARSIG_REPO;
  return clearSigEip712(input, { ...(opt as ClearSigRenderOpt), clearSig: src });
}

/**
 * Looks up a built-in token entry by symbol.
 * @param symbol - Uppercase token symbol such as `USDC` or `WETH`.
 * @returns Token metadata together with the contract address.
 * @throws If the symbol is unknown to the built-in token registry. {@link Error}
 * @example
 * Resolve a known token before building calldata or rendering balances.
 * ```ts
 * const token = tokenFromSymbol('WETH');
 * ```
 */
export const tokenFromSymbol = (
  symbol: string
): {
  contract: string;
} & TokenInfo => {
  // Built-in registry lookup must ignore enumerable properties injected on Object.prototype.
  for (const c of Object.keys(TOKENS)) {
    if (TOKENS[c].symbol === symbol) return Object.assign({ contract: c }, TOKENS[c]);
  }
  throw new Error('unknown token');
};

const getABI = (info: TArg<ContractInfo>) => {
  const abi = (info as ContractInfo).abi;
  if (typeof abi === 'string') {
    if (abi === 'ERC20') return ERC20;
    else if (abi === 'ERC721') return ERC721;
    else if (abi === 'ERC1155') return ERC1155;
    else throw new Error(`getABI: unknown abi type=${abi}`);
  }
  return abi;
};

/**
 * Options for the high-level transaction and event decoders.
 * Controls which ABI registry entries the high-level decode helpers can use.
 */
export type DecoderOpt = {
  /** Reusable decoder with caller-owned ABI entries. */
  decoder?: Decoder;
  /** Extra registry entries keyed by contract address. */
  customContracts?: Record<string, ContractInfo>;
  /** Skip the built-in registry and only use `customContracts`. */
  noDefault?: boolean;
  /** Allows calldata with non-ABI trailing bytes; strict decoding is the default. */
  allowUnreadBytes?: boolean;
};
/** Options for decoding raw transactions with optional ERC-7730 clear signing. */
export type TxDecodeOpt = DecoderOpt &
  ClearSigRenderOpt & {
    /** ERC-7730 clear-signing descriptor files. Omitted means {@link CLEARSIG_REPO}. */
    clearSig?: Record<string, ClearSigDef>;
    /** Overrides the chain id parsed from the transaction. */
    chainId?: bigint;
    /**
     * Sender address forwarded to clear-signing `@.from` paths.
     * For unsigned transactions and calldata-only decode, signer UIs should
     * pass the active account here; signed transactions recover it once.
     */
    from?: string;
  };

// TODO: export? Seems useful enough
// We cannot have this inside decoder itself,
// since it will create dependencies on all default contracts
const getDecoder = (opt_: TArg<TxDecodeOpt> = {}) => {
  const opt = opt_ as TxDecodeOpt;
  const decoder = opt.decoder || new Decoder();
  const contracts: Record<string, ContractInfo> = {};
  const custom = new Set<string>();
  // Add contracts
  if (!opt.noDefault) Object.assign(contracts, CONTRACTS);
  if (opt.customContracts) {
    // Caller registries may be plain objects; inherited keys must not become trusted contracts.
    for (const k of Object.keys(opt.customContracts)) {
      custom.add(k.toLowerCase());
      contracts[k.toLowerCase()] = opt.customContracts[k] as ContractInfo;
    }
  }
  // Contract info validation
  for (const k of Object.keys(contracts)) {
    if (!addr.isValid(k)) throw new Error(`getDecoder: invalid contract address=${k}`);
    const c = contracts[k];
    if (c.symbol !== undefined && typeof c.symbol !== 'string')
      throw new Error(`getDecoder: wrong symbol type=${c.symbol}`);
    if (c.decimals !== undefined && !Number.isSafeInteger(c.decimals))
      throw new Error(`getDecoder: wrong decimals type=${c.decimals}`);
    if (c.name !== undefined && typeof c.name !== 'string')
      throw new Error(`getDecoder: wrong name type=${c.name}`);
    if (c.price !== undefined && typeof c.price !== 'number')
      throw new Error(`getDecoder: wrong price type=${c.price}`);
    // Caller-owned decoders are not backfilled with the default registry; they
    // may still use the metadata map for hooks and clear-signing field rendering.
    if (!opt.decoder || custom.has(k)) decoder.add(k, getABI(c)); // validates c.abi
  }
  // Default one-call decodeTx/decodeData should render clear signing. Caller-owned
  // decoders stay exact: they attach clearSig only after explicit addClearSig().
  const clearSig =
    opt.clearSig !== undefined
      ? opt.clearSig
      : opt.noDefault || opt.decoder
        ? undefined
        : CLEARSIG_REPO;
  if (clearSig) decoder.addClearSig(clearSig);
  return { decoder, contracts };
};

// These methods are for case when user wants to inspect tx/logs/receipt,
// but doesn't know anything about which contract is used. If you work with
// specific contract it is better to use 'createContract' which will return nice types.
// 'to' can point to specific known contract, but also can point to any address (it is part of tx)
// 'to' should be part of real tx you want to parse, not hardcoded contract!
// Even if contract is unknown, we still try to process by known function signatures
// from other contracts.
// Can be used to parse tx or 'eth_getTransactionReceipt' output
/**
 * Decodes contract calldata using the built-in and custom ABI registry.
 * @param to - Contract address that received the calldata.
 * @param data - Hex calldata as returned by Ethereum RPC.
 * @param amount - Optional ETH amount that accompanied the call.
 * @param opt - Decoder registry, clear-signing, and defaults control. See {@link TxDecodeOpt}.
 * @returns Decoded call information. A single object is an exact registry match;
 * an array is only a best-guess candidate list from the 4-byte selector when no
 * exact contract match is available.
 * @throws If the contract address, calldata, amount, or decoder registry are invalid. {@link Error}
 * @example
 * Decode a known router call through the built-in ABI registry.
 * ```ts
 * const to = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
 * const data =
 *   '7ff36ab5000000000000000000000000000000000000000000000000ab54a98c' +
 *   'eb1f0ad300000000000000000000000000000000000000000000000000000000' +
 *   '00000080000000000000000000000000d8da6bf26964af9d7eed9e03e53415d3' +
 *   '7aa9604500000000000000000000000000000000000000000000000000000000' +
 *   '6fd9c6ea00000000000000000000000000000000000000000000000000000000' +
 *   '00000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead908' +
 *   '3c756cc2000000000000000000000000106d3c66d22d2dd0446df23d7f596075' +
 *   '2994d600';
 * const info = decodeData(to, data, 100000000000000000n);
 * ```
 */
export const decodeData = (
  to: string,
  data: string,
  amount?: bigint,
  opt: TArg<TxDecodeOpt> = {}
): TxInfo | SignatureInfo[] | undefined => {
  const options = opt as TxDecodeOpt;
  astring(to, 'to');
  if (!addr.isValid(to)) throw new Error(`decodeData: wrong to=${to}`);
  if (amount !== undefined && typeof amount !== 'bigint')
    throw new Error(`decodeData: wrong amount=${amount}`);
  const { decoder, contracts } = getDecoder(options);
  const bytes = ethHex.decode(data);
  const res = decoder.decode(to, bytes as Uint8Array, {
    contract: to,
    // Exchanges can use metadata about other contracts, especially tokens.
    contracts,
    contractInfo: contracts[to.toLowerCase()], // current contract info (for tokens)
    amount, // ETH-to-token router clear signing needs transaction value.
    allowUnreadBytes: options.allowUnreadBytes,
  });
  if (bytes.length < 4) return res;
  const entry = decoder.clearSigEntry(to, bytes, options.chainId);
  if (!entry) return res;
  const clearSig = entry(
    { to, from: options.from, data: bytes, value: amount, chainId: options.chainId },
    Object.assign({}, options, {
      contracts,
      renderCalldata: (
        desc: ClearSigSource,
        input: TArg<CalldataInput>,
        ropt: TArg<ClearSigOpt>
      ) => {
        const opt = Object.assign({}, options, ropt as ClearSigRenderOpt);
        const call = input as CalldataInput;
        if (!call.to || !call.data) return Promise.resolve(undefined);
        const to = call.to;
        const dataBytes = call.data;
        const src = clearSigSource(desc);
        const chainId = call.chainId;
        const decoder = new Decoder().addClearSig(
          src.files!,
          src.inline ? { bind: { address: to, chainId } } : {}
        );
        const next: TxDecodeOpt = { ...opt, decoder, noDefault: true, chainId, from: call.from };
        delete next.clearSig;
        const data = ethHex.encode(dataBytes);
        let out = decodeData(to, data, call.value, next);
        if ((!out || Array.isArray(out) || !out.clearSig) && opt.resolveFactory) {
          return decoder.resolve({ ...opt, address: to, chainId }).then(() => {
            out = decodeData(to, data, call.value, next);
            return out && !Array.isArray(out) ? out.clearSig : undefined;
          });
        }
        return out && !Array.isArray(out) ? out.clearSig : undefined;
      },
    }) as ClearSigRenderOpt
  );
  if (res && !Array.isArray(res)) return { ...res, clearSig };
  return res;
};

/** Exact decoded call from the ABI registry. `clearSig` is present when
 * clear-signing descriptors were supplied and matched.
 * Guess arrays never carry it, so `out && !Array.isArray(out)` is the whole
 * clear-signing consumer check. */
export type TxInfo = SignatureInfo & { clearSig?: Promise<ClearSigResult> };

// Requires deps on tx, but nicer API.
// Doesn't cover all use cases of decodeData, since it can't parse 'eth_getTransactionReceipt'
/**
 * Decodes a signed raw transaction.
 * @param transaction - Signed transaction encoded as hex, or an already parsed transaction.
 * Single result = exact call info from the ABI registry, including ABI entries
 * added by ERC-7730 descriptors; array = best-guess
 * candidates from the 4-byte selector when no exact contract match is available
 * (guesses never carry `clearSig`); undefined = unknown selector or creation.
 * @param opt - Registry overrides plus ERC-7730 clear-signing descriptors/resolvers.
 * See {@link TxDecodeOpt}.
 * @returns Decoded transaction call information for the transaction payload.
 * @throws If transaction parsing or decoder validation fails. {@link Error}
 * @example
 * Parse a signed ERC-20 transfer and decode its calldata.
 * ```ts
 * const tx =
 *   '0xf8a901851d1a94a20082c12a94dac17f958d2ee523a2206206994597c13d831ec780b844a9059cbb000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000000000000000000000000000000000054259870025a066fcb560b50e577f6dc8c8b2e3019f760da78b4c04021382ba490c572a303a42a0078f5af8ac7e11caba9b7dc7a64f7bdc3b4ce1a6ab0a1246771d7cc3524a7200';
 * decodeTx(tx);
 * ```
 */
export const decodeTx = (
  transaction: TArg<string | ReturnType<typeof Transaction.fromHex>>,
  opt: TArg<TxDecodeOpt> = {}
): TxInfo | SignatureInfo[] | undefined => {
  const tx =
    typeof transaction === 'string'
      ? Transaction.fromHex(transaction)
      : (transaction as ReturnType<typeof Transaction.fromHex>);
  // Contract creation carries initcode, not runtime calldata for an addressed contract.
  if (tx.raw.to === '0x') return;
  let from = opt.from;
  // Signed transactions must be internally valid: recover sender once here so
  // clear-signing @.from paths and callers share the same authenticated sender.
  if (tx.isSigned) {
    const sender = tx.sender;
    if (from && from.toLowerCase() !== sender.toLowerCase())
      throw new Error(`decodeTx: wrong from=${from}, expected ${sender}`);
    from = sender;
  }
  return decodeData(tx.raw.to, tx.raw.data, tx.raw.value, {
    ...opt,
    chainId: opt.chainId === undefined ? tx.raw.chainId : opt.chainId,
    from,
  });
};

// Parses output of eth_getLogs/eth_getTransactionReceipt
/**
 * Decodes a log entry using the built-in and custom ABI registry.
 * @param to - Contract address that emitted the event.
 * @param topics - Event topics from `eth_getLogs` or a receipt.
 * @param data - Event data payload as hex.
 * @param opt - Decoder registry overrides and defaults control. See {@link DecoderOpt}.
 * @returns Decoded event information. A single object is an exact registry
 * match; an array is only a best-guess candidate list from the topic signature
 * when no exact contract match is available.
 * @throws If the contract address, topics, event payload, or decoder registry are invalid. {@link Error}
 * @example
 * Decode an Approval event with the built-in token registry.
 * ```ts
 * const to = '0x0d8775f648430679a709e98d2b0cb6250d2887ef';
 * const topics = [
 *   '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
 *   '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
 *   '0x000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564',
 * ];
 * const data = '0x00000000000000000000000000000000000000000000003635c9adc5dea00000';
 * decodeEvent(to, topics, data);
 * ```
 */
export const decodeEvent = (
  to: string,
  topics: string[],
  data: string,
  opt: TArg<DecoderOpt> = {}
): SignatureInfo | SignatureInfo[] | undefined => {
  astring(to, 'to');
  if (!addr.isValid(to)) throw new Error(`decodeEvent: wrong to=${to}`);
  const { decoder, contracts } = getDecoder(opt);
  return decoder.decodeEvent(to, topics, data, {
    contract: to,
    contracts,
    contractInfo: contracts[to.toLowerCase()],
    // amount here is not used by our hooks. Should we ask it for consistency?
  });
};
