import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, rejects } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, normalize } from 'node:path';
import {
  CLEARSIG_REPO,
  Decoder,
  ERC20,
  ERCS,
  OURS,
  TOKENS,
  addTokens,
  createContract,
  decodeData,
  decodeTx,
} from '../src/advanced/abi.ts';
import { CLEARSIG_REPO_FULL } from '../src/advanced/clearsig-repo-full.ts';
import { eip712 } from '../src/advanced/clearsig.ts';
import { Transaction } from '../src/core/tx.ts';
import { encoder, getDomainType } from '../src/core/typed-data.ts';
import { cloneDeep, ethHex } from '../src/utils.ts';
import { getVectorsPath } from './util.ts';

const vectorRoot = getVectorsPath('clear-signing');
const vectors = JSON.parse(readFileSync(`${vectorRoot}/erc7730-registry-vectors.json`, 'utf8'));
const registry = JSON.parse(readFileSync(`${vectorRoot}/erc7730-registry-cases.json`, 'utf8'));
const clearSigFiles = (desc: any) => {
  if (Array.isArray(desc)) return Object.fromEntries(desc.map((d, i) => [`inline/${i}.json`, d]));
  if (desc && typeof desc === 'object' && (desc.display || desc.context || desc.includes))
    return { 'inline.json': desc };
  return desc;
};
const calldata = async (desc: any, input: any, opt: any = {}) => {
  const inline =
    Array.isArray(desc) ||
    (desc && typeof desc === 'object' && (desc.display || desc.context || desc.includes));
  const chainId = input.chainId === undefined ? undefined : BigInt(input.chainId);
  const decoder = new Decoder().addClearSig(
    clearSigFiles(desc),
    inline ? { bind: { address: input.to, chainId } } : {}
  );
  if (opt.resolveFactory) await decoder.resolve({ ...opt, address: input.to, chainId });
  const res = decodeData(input.to, input.data, input.value, {
    ...opt,
    decoder,
    noDefault: true,
    chainId,
    from: input.from,
  });
  if (!res || Array.isArray(res)) return;
  return res.clearSig;
};

const txInput = (tx: ReturnType<typeof Transaction.fromHex>) => {
  if (tx.raw.to === '0x') throw new Error('clearSig test: contract creation has no target');
  let from: string | undefined;
  try {
    if (tx.isSigned) from = tx.sender;
  } catch {
    // Sender recovery is not required by these renderer fixtures.
  }
  return { to: tx.raw.to, from, data: tx.raw.data, value: tx.raw.value, chainId: tx.raw.chainId };
};

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const SABAI = '0xb5d730d442e1d5b119fb4e5c843c48a64202ef92';
const ROUTER02 = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45';
const ASSET = '0x00000000000000000000000000000000000000aa';
const SHARE = '0x00000000000000000000000000000000000000bb';
const RESOLVER_TARGET = '0x0000000000000000000000000000000000000101';
const RESOLVER_PROXY = '0x0000000000000000000000000000000000000102';
const RESOLVER_FACTORY = '0x0000000000000000000000000000000000000103';
const RESOLVER_TOKEN = '0x0000000000000000000000000000000000000104';
const RESOLVER_ACCOUNT = '0x0000000000000000000000000000000000000105';
const compact = (s: unknown) => `${s}`.replace(/\s+/g, '').toLowerCase();
const json = (path: string) => JSON.parse(readFileSync(`${vectorRoot}/${path}`, 'utf8'));
const descFile = (path: string) => path.replace('/tests/', '/').replace(/\.tests\.json$/, '.json');
const descs = new Map<string, any>();
const inlineIncludes = (desc: any, base: string): any => {
  const out = cloneDeep(desc);
  if (!out.includes) return out;
  const incs = Array.isArray(out.includes) ? out.includes : [out.includes];
  out.includes = incs.map((inc) => {
    if (typeof inc !== 'string') return inlineIncludes(inc, base);
    const path = normalize(`${base}/${inc}`).replace(/\\/g, '/');
    return inlineIncludes(json(path), dirname(path));
  });
  return out;
};
const registryExpected = (texts: string[] = []) => {
  const out: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    // Registry vectors include device/container rows that are outside ERC-7730 field rendering.
    if (['interaction with', 'max fees'].includes(text.toLowerCase())) {
      i++;
      continue;
    }
    // Date string rendering is wallet UI policy. The registry mixes Ledger 12h UTC
    // strings, RFC3339 strings, and date-only strings; this library uses legacy
    // hint-compatible `Date#toUTCString()` for deterministic UTC display.
    if (/^\d{4}-\d{2}-\d{2}(?:t\d{2}:\d{2}:\d{2}z| \d{2}:\d{2}:\d{2} [ap]m utc)?$/i.test(text))
      continue;
    out.push(compact(text));
  }
  return out;
};
const registryActual = (res: Awaited<ReturnType<typeof calldata>>) =>
  [res.intent, ...Object.entries(res.fields).flatMap(([label, field]) => [label, field.value])].map(
    compact
  );
const registryMatched = (expected: string[], actual: string[]) => {
  const pool = actual.slice();
  return expected.map((entry) => {
    const idx = pool.indexOf(entry);
    if (idx < 0) return `missing:${entry}`;
    pool.splice(idx, 1);
    return entry;
  });
};
const registryDesc = (path: string) => {
  const file = descFile(path);
  let desc = descs.get(file);
  if (!desc) {
    desc = inlineIncludes(json(file), dirname(file));
    descs.set(file, desc);
  }
  return desc;
};
const UNREAD_BYTE_VECTORS = new Set([
  'registry/1inch/tests/calldata-AggregationRouterV3.tests.json#1',
  'registry/1inch/tests/calldata-AggregationRouterV4.tests.json#0',
  'registry/1inch/tests/calldata-AggregationRouterV6.tests.json#2',
  'registry/1inch/tests/calldata-AggregationRouterV6.tests.json#3',
  'registry/1inch/tests/calldata-AggregationRouterV6.tests.json#4',
  'registry/1inch/tests/calldata-AggregationRouterV6.tests.json#5',
  'registry/1inch/tests/calldata-AggregationRouterV6.tests.json#6',
  'registry/1inch/tests/calldata-AggregationRouterV6.tests.json#7',
  'registry/1inch/tests/calldata-AggregationRouterV6.tests.json#10',
  'registry/1inch/tests/calldata-AggregationRouterV6.tests.json#11',
  'registry/morpho/tests/calldata-MorphoBundlerV3.tests.json#0',
  'registry/morpho/tests/calldata-gauntlet-gtDAIcore.tests.json#0',
  'registry/morpho/tests/calldata-gauntlet-gtWBTCc.tests.json#0',
  'registry/morpho/tests/calldata-gauntlet-gtWETH.tests.json#0',
  'registry/morpho/tests/calldata-gauntlet-gteUSDc.tests.json#0',
  'registry/morpho/tests/calldata-gauntlet-gtusdcf.tests.json#1',
  'registry/morpho/tests/calldata-steakhouse_financial-bbqDAI.tests.json#0',
  'registry/morpho/tests/calldata-steakhouse_financial-bbqDAI.tests.json#3',
  'registry/morpho/tests/calldata-steakhouse_financial-bbqUSDC.tests.json#1',
  'registry/morpho/tests/calldata-steakhouse_financial-bbqUSDT.tests.json#0',
  'registry/morpho/tests/calldata-steakhouse_financial-steakPYUSD.tests.json#0',
  'registry/morpho/tests/calldata-steakhouse_financial-steakRUSD.tests.json#0',
  'registry/okx/tests/calldata-OkxDexRouterV1.0.7-multi-commission.tests.json#0',
  'registry/okx/tests/calldata-OkxDexRouterV1.0.7-multi-commission.tests.json#1',
  'registry/okx/tests/calldata-OkxDexRouterV1.0.7-multi-commission.tests.json#4',
  'registry/okx/tests/calldata-OkxDexRouterV1.0.7-multi-commission.tests.json#5',
  'registry/okx/tests/calldata-OkxDexRouterV1.0.7-multi-commission.tests.json#6',
  'registry/weth/tests/calldata-weth.tests.json#0',
]);
const STRICT_CONTEXT_VECTORS = new Set([
  // ERC-7730 says eip712.deployments require domain.chainId + verifyingContract.
  // This fixture has verifyingContract plus salt, but no chainId, so strict matching rejects it.
  'registry/rarible/tests/eip712-rarible-exchange-v2-meta-tx.tests.json#0',
]);
const registryOpt = (item: { file: string; index: number }) => {
  const opt: any = {
    async resolveToken(req: any) {
      return TOKENS[req.address.toLowerCase()];
    },
  };
  // 1inch vectors append shady unread bytes after ABI args; other copied fixtures
  // carry similar referral/commission suffixes. Keep normal decode strict.
  if (UNREAD_BYTE_VECTORS.has(`${item.file}#${item.index}`)) opt.allowUnreadBytes = true;
  return opt;
};
const registryInput = (path: string, test: any) => {
  const input = test.rawTx || test.data;
  if (typeof input !== 'string') return input;
  if (test.rawTx) {
    let tx: ReturnType<typeof Transaction.fromHex> | undefined;
    try {
      tx = Transaction.fromHex(input);
    } catch {
      // Not an RLP transaction; copied registry calldata fixtures use `rawTx` for bare calldata.
    }
    if (tx) return txInput(tx);
  }
  const deployment = registryDesc(path).context?.contract?.deployments?.[0];
  if (!deployment) return { data: input };
  // Registry calldata fixtures often call bare calldata `rawTx`; provide the
  // missing container from the descriptor so deployment constraints are still checked.
  return { to: deployment.address, chainId: deployment.chainId, data: input };
};
const registryRender = (desc: any, input: any, opt: any = {}) =>
  input &&
  typeof input === 'object' &&
  Object.hasOwn(input, 'types') &&
  Object.hasOwn(input, 'primaryType') &&
  Object.hasOwn(input, 'domain') &&
  Object.hasOwn(input, 'message')
    ? eip712(input, { ...opt, clearSig: desc })
    : calldata(desc, input, opt);

const ERC20_CLEAR = {
  display: {
    formats: {
      'transfer(address _to, uint256 _value)': {
        intent: 'Send',
        interpolatedIntent: 'Send {_value} to {_to}',
        fields: [
          {
            path: '_value',
            label: 'Amount',
            format: 'tokenAmount',
            params: { tokenPath: '@.to' },
            visible: 'always',
          },
          {
            path: '_to',
            label: 'To',
            format: 'addressName',
            params: { types: ['eoa'], sources: ['local', 'ens'] },
            visible: 'always',
          },
        ],
      },
    },
  },
};
const ERC20_USDC_CLEAR = {
  ...ERC20_CLEAR,
  metadata: { token: { ticker: 'USDC', decimals: 6 } },
};

const PERMIT2_CLEAR = {
  context: {
    eip712: {
      domain: { name: 'Permit2' },
      deployments: [{ chainId: 1, address: '0x000000000022D473030F116dDEE9F6B43aC78BA3' }],
    },
  },
  metadata: { owner: 'Uniswap Labs' },
  display: {
    formats: {
      'PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)':
        {
          intent: 'Authorize spending of token',
          interpolatedIntent:
            'Authorize {spender} to spend {details.amount} until {details.expiration}',
          fields: [
            { path: 'spender', label: 'Spender', format: 'raw', visible: 'always' },
            {
              path: 'details.amount',
              label: 'Amount allowance',
              format: 'tokenAmount',
              params: { tokenPath: 'details.token' },
              visible: 'always',
            },
            {
              path: 'details.expiration',
              label: 'Approval expires',
              format: 'date',
              params: { encoding: 'timestamp' },
            },
            { label: 'Sig Deadline', path: 'sigDeadline', visible: 'never' },
          ],
        },
    },
  },
};

const UNISWAP_V3_ROUTER02_CLEAR = {
  context: {
    contract: { deployments: [{ chainId: 1, address: ROUTER02 }] },
  },
  metadata: { owner: 'Uniswap Labs', contractName: 'Uniswap V3 Router02' },
  display: {
    formats: {
      'exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params)':
        {
          intent: 'Swap',
          interpolatedIntent:
            'Swap {params.amountIn} for at least {params.amountOutMinimum} to {params.recipient}',
          fields: [
            {
              path: 'params.amountIn',
              label: 'Amount to Send',
              format: 'tokenAmount',
              params: { tokenPath: 'params.path.[0:20]' },
              visible: 'always',
            },
            {
              path: 'params.amountOutMinimum',
              label: 'Minimum to Receive',
              format: 'tokenAmount',
              params: { tokenPath: 'params.path.[-20:]' },
              visible: 'always',
            },
            {
              path: 'params.recipient',
              label: 'Beneficiary',
              format: 'addressName',
              params: { types: ['eoa', 'contract'], sources: ['local', 'ens'] },
              visible: 'always',
            },
          ],
        },
    },
  },
};

const BATCH_ABI = [
  {
    type: 'function',
    name: 'batchExecute',
    inputs: [
      { name: 'targets', type: 'address[]' },
      { name: 'datas', type: 'bytes[]' },
      { name: 'values', type: 'uint256[]' },
    ],
  },
] as const;

const BATCH_CLEAR = {
  display: {
    formats: {
      'batchExecute(address[] targets,bytes[] datas,uint256[] values)': {
        intent: 'Batch',
        interpolatedIntent: 'Batch {datas}',
        fields: [
          {
            path: 'datas.[]',
            label: 'Nested Calls',
            format: 'calldata',
            params: { calleePath: 'targets.[]', amountPath: 'values.[]' },
          },
        ],
      },
    },
  },
};

const PATH_ABI = [
  {
    type: 'function',
    name: 'paths',
    inputs: [
      { name: 'text', type: 'string' },
      { name: 'nums', type: 'uint256[]' },
      { name: 'items', type: 'tuple[]', components: [{ name: 'name', type: 'string' }] },
    ],
  },
] as const;

const PATH_CLEAR = {
  display: {
    formats: {
      'paths(string text,uint256[] nums,(string name)[] items)': {
        intent: 'Paths',
        fields: [
          { path: 'text.[1:4]', label: 'Text', format: 'raw' },
          { path: 'nums.[-2:]', label: 'Tail', format: 'raw' },
          { path: 'items[0].name', label: 'First', format: 'raw' },
          { path: 'items.length', label: 'Count', format: 'raw' },
        ],
      },
    },
  },
};

const EXECUTE_ABI = [
  {
    type: 'function',
    name: 'execute',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
  },
] as const;

const EXECUTE_CLEAR = {
  display: {
    formats: {
      'execute(address to,uint256 value,bytes data)': {
        intent: 'Execute',
        interpolatedIntent: 'Execute {data}',
        fields: [
          {
            path: 'data',
            label: 'Call',
            format: 'calldata',
            params: { calleePath: 'to', amountPath: 'value', selector: '0xa9059cbb' },
          },
        ],
      },
    },
  },
};

const DISTRIBUTE_ABI = [
  {
    type: 'function',
    name: 'distribute',
    inputs: [
      { name: 'recipients', type: 'address[]' },
      { name: 'percentages', type: 'uint256[]' },
    ],
  },
] as const;

const DISTRIBUTE_CLEAR = {
  display: {
    formats: {
      'distribute(address[] recipients,uint256[] percentages)': {
        intent: 'Distribute fees',
        interpolatedIntent: 'Distribute fees {percentages} among recipients {recipients}',
        fields: [
          { path: '@.value', label: 'Total Distributed Amount', format: 'amount' },
          {
            label: 'Recipients and Fees',
            iteration: 'bundled',
            fields: [
              {
                path: 'recipients.[]',
                label: 'Recipients',
                format: 'addressName',
                separator: 'Recipient {index}',
              },
              {
                path: 'percentages.[]',
                label: 'Percentages',
                format: 'unit',
                params: { base: '%', decimals: 2 },
              },
            ],
          },
        ],
      },
    },
  },
};

const INCLUDE_BASE = {
  display: {
    formats: {
      'transfer(address to,uint256 value)': {
        intent: 'Send',
        interpolatedIntent: 'Send {value}',
        fields: [
          {
            path: 'value',
            label: 'Amount',
            format: 'tokenAmount',
            params: { tokenPath: '@.to' },
          },
          { value: '$.metadata.constants.asset', label: 'Asset', format: 'raw' },
        ],
      },
    },
  },
};

const INCLUDE_CHILD = {
  includes: 'erc20',
  metadata: { constants: { asset: 'USDC' } },
};

const VISIBILITY_ABI = [
  {
    type: 'function',
    name: 'pay',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'legacy', type: 'uint256' },
      { name: 'fee', type: 'uint256' },
    ],
  },
] as const;

const VISIBILITY_CLEAR = {
  context: { contract: { deployments: [{ chainId: 1, address: USDC }] } },
  metadata: { token: { ticker: 'USDC', decimals: 6 } },
  display: {
    formats: {
      'pay(address to,uint256 value,uint256 legacy,uint256 fee)': {
        intent: 'Send',
        interpolatedIntent: 'Send {value} to {to}',
        fields: [
          { path: 'to', label: 'To', format: 'addressName' },
          {
            path: 'value',
            label: 'Amount',
            format: 'tokenAmount',
            params: { tokenPath: '@.to' },
          },
          { path: 'legacy', label: 'Legacy', format: 'raw', visible: { mustMatch: [0] } },
          { path: 'fee', label: 'Fee', format: 'amount', visible: { ifNotIn: [0] } },
        ],
      },
    },
  },
};

const DURATION_ABI = [
  {
    type: 'function',
    name: 'timeout',
    inputs: [{ name: 'seconds', type: 'uint256' }],
  },
] as const;

const DURATION_CLEAR = {
  display: {
    formats: {
      'timeout(uint256 seconds)': {
        intent: 'Set Timeout',
        interpolatedIntent: 'Set timeout {seconds}',
        fields: [
          { path: 'seconds', label: 'Timeout', format: 'duration' },
          { value: 'soft', label: 'Mode', format: 'raw', visible: 'optional' },
        ],
      },
    },
  },
};

const MAP_ABI = [
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'minShares', type: 'uint256' },
    ],
  },
] as const;

const MAP_CLEAR = {
  metadata: {
    maps: {
      underlying: { values: { '1': ASSET } },
      shares: { values: { '1': SHARE } },
    },
  },
  display: {
    formats: {
      'deposit(uint256 amount,uint256 minShares)': {
        intent: { Action: 'Deposit', Type: 'Mapped token' },
        interpolatedIntent: 'Deposit {amount} to receive at least {minShares}',
        fields: [
          {
            path: 'amount',
            label: 'Deposit Amount',
            format: 'tokenAmount',
            params: { token: { map: '$.metadata.maps.underlying', keyPath: '@.chainId' } },
          },
          {
            path: 'minShares',
            label: 'Min Shares',
            format: 'tokenAmount',
            params: { token: { map: '$.metadata.maps.shares', keyPath: '@.chainId' } },
          },
        ],
      },
    },
  },
};

const INTERPOLATE_CLEAR = {
  display: {
    formats: {
      'deposit(uint256 amount,uint256 minShares)': {
        intent: 'Deposit fallback',
        interpolatedIntent: 'Deposit {amount} {missing}',
        fields: [{ path: 'amount', label: 'Amount', format: 'raw' }],
      },
    },
  },
};

const INTERPOLATE_ESCAPED_CLEAR = {
  display: {
    formats: {
      'deposit(uint256 amount,uint256 minShares)': {
        intent: 'Deposit fallback',
        interpolatedIntent: 'Deposit {{amount}} {amount} }}',
        fields: [{ path: 'amount', label: 'Amount', format: 'raw' }],
      },
    },
  },
};

const ENCRYPTED_ABI = [
  {
    type: 'function',
    name: 'encrypted',
    inputs: [{ name: 'payload', type: 'bytes32' }],
  },
] as const;

const ENCRYPTED_CLEAR = {
  context: { contract: { deployments: [{ chainId: 1, address: USDC }] } },
  metadata: { token: { ticker: 'USDC', decimals: 6 } },
  display: {
    formats: {
      'encrypted(bytes32 payload)': {
        intent: 'Encrypted Transfer',
        interpolatedIntent: 'Encrypted Transfer {payload}',
        fields: [
          {
            path: 'payload',
            label: 'Amount',
            format: 'tokenAmount',
            encryption: {
              scheme: 'fhevm',
              plaintextType: 'uint64',
              fallbackLabel: '[Encrypted Amount]',
            },
          },
        ],
      },
    },
  },
};

const RESOLVER_ABI = [
  {
    type: 'function',
    name: 'resolve',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'account', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'tokenId', type: 'uint256' },
      { name: 'blockNumber', type: 'uint256' },
      { name: 'interop', type: 'bytes' },
    ],
  },
] as const;

const RESOLVER_CLEAR = {
  display: {
    formats: {
      'resolve(address token,address account,uint256 amount,uint256 tokenId,uint256 blockNumber,bytes interop)':
        {
          intent: 'Resolve',
          interpolatedIntent:
            'Resolve {token} {amount} for {account} NFT {tokenId} at {blockNumber} {interop}',
          fields: [
            { path: 'token', label: 'Token', format: 'tokenTicker' },
            {
              path: 'amount',
              label: 'Amount',
              format: 'tokenAmount',
              params: { tokenPath: 'token' },
            },
            {
              path: 'account',
              label: 'Account',
              format: 'addressName',
              params: { types: ['eoa'], sources: ['ens'] },
            },
            {
              path: 'tokenId',
              label: 'NFT',
              format: 'nftName',
              params: { collectionPath: 'token' },
            },
            {
              path: 'blockNumber',
              label: 'Block',
              format: 'date',
              params: { encoding: 'blockheight' },
            },
            { value: '@.chainId', label: 'Network', format: 'chainId' },
            { path: 'interop', label: 'Interop', format: 'interoperableAddressName' },
          ],
        },
    },
  },
};

const DEPLOYED_RESOLVER_CLEAR = {
  ...RESOLVER_CLEAR,
  context: { contract: { deployments: [{ chainId: 1, address: RESOLVER_TARGET }] } },
};

const FACTORY_RESOLVER_CLEAR = {
  ...RESOLVER_CLEAR,
  context: {
    contract: {
      factory: {
        deployEvent: 'Deployed(address indexed instance)',
        deployments: [{ chainId: 1, address: RESOLVER_FACTORY }],
      },
    },
  },
};

const FACTORY_MISS_CLEAR = {
  ...RESOLVER_CLEAR,
  context: {
    contract: {
      factory: {
        deployEvent: 'Miss(address indexed instance)',
        deployments: [{ chainId: 1, address: RESOLVER_FACTORY }],
      },
    },
  },
  display: { formats: { 'miss()': { intent: 'Miss', fields: [] } } },
};

describe('ERC-7730 clear signing', () => {
  should('renders ERC-20 calldata with registry-style spaced ABI key', async () => {
    const data = ethHex.encode(
      createContract(ERC20).transfer.encodeInput({
        to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        value: 2500000n,
      })
    );
    deepStrictEqual(await calldata(ERC20_USDC_CLEAR, { to: USDC, data, chainId: 1 }), {
      intent: 'Send',
      interpolatedIntent: 'Send 2.5 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      structuredIntent: [
        'Send ',
        { value: '2.5 USDC', format: 'tokenAmount', rawValue: 2500000n },
        ' to ',
        {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      ],
      fields: {
        Amount: { value: '2.5 USDC', format: 'tokenAmount', rawValue: 2500000n },
        To: {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      },
    });
  });

  should('uses descriptor files and attaches decoder clearSig promises', async () => {
    const to = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
    const data = ethHex.encode(createContract(ERC20).transfer.encodeInput({ to, value: 2500000n }));
    const from = '0x000000000000000000000000000000000000000f';
    const approveData = ethHex.encode(
      createContract(ERC20).approve.encodeInput({ spender: to, value: 7000000n })
    );
    const transferFromData = ethHex.encode(
      createContract(ERC20).transferFrom.encodeInput({ from, to, value: 7000000n })
    );
    const files = addTokens(CLEARSIG_REPO, {
      [USDC]: { abi: 'ERC20', symbol: 'USDC', decimals: 6 },
    });
    deepStrictEqual(
      {
        ercs: Object.keys(ERCS).length,
        ours: Object.keys(OURS).length,
        full: Object.keys(CLEARSIG_REPO_FULL).length,
        fullHasNoErcs: Object.keys(CLEARSIG_REPO_FULL).some((k) => k.startsWith('ercs/')),
      },
      { ercs: 6, ours: 6, full: 378, fullHasNoErcs: false }
    );
    deepStrictEqual(
      {
        defaultFrozen: Object.isFrozen(CLEARSIG_REPO),
        customKeepsBase:
          files['tokens/1/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/calldata-erc20-tokens.json']
            .context.contract.deployments[0],
        hasFullWeth: Object.hasOwn(CLEARSIG_REPO, 'registry/weth/calldata-weth.json'),
        hasGenericWeth: Object.hasOwn(
          CLEARSIG_REPO,
          'tokens/1/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/calldata-erc20-tokens.json'
        ),
      },
      {
        defaultFrozen: true,
        customKeepsBase: {
          chainId: 1,
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        },
        hasFullWeth: true,
        hasGenericWeth: false,
      }
    );
    deepStrictEqual(await calldata(files, { to: USDC, data, chainId: 1 }), {
      intent: 'Send',
      interpolatedIntent: 'Transfer 2.5 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      structuredIntent: [
        'Transfer ',
        { value: '2.5 USDC', format: 'tokenAmount', rawValue: 2500000n },
        ' to ',
        {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      ],
      fields: {
        Amount: { value: '2.5 USDC', format: 'tokenAmount', rawValue: 2500000n },
        To: {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      },
    });
    deepStrictEqual(await calldata(files, { to: USDC, data: approveData, chainId: 1 }), {
      intent: 'Approve',
      interpolatedIntent: 'Allow spending 7 USDC by 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      structuredIntent: [
        'Allow spending ',
        { value: '7 USDC', format: 'tokenAmount', rawValue: 7000000n },
        ' by ',
        {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      ],
      fields: {
        Spender: {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
        Amount: { value: '7 USDC', format: 'tokenAmount', rawValue: 7000000n },
      },
    });
    deepStrictEqual(await calldata(files, { to: USDC, data: transferFromData, chainId: 1 }), {
      intent: 'Transfer',
      interpolatedIntent:
        'Transfer 7 USDC from 0x000000000000000000000000000000000000000f to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      structuredIntent: [
        'Transfer ',
        { value: '7 USDC', format: 'tokenAmount', rawValue: 7000000n },
        ' from ',
        {
          value: '0x000000000000000000000000000000000000000f',
          format: 'addressName',
          rawValue: '0x000000000000000000000000000000000000000f',
        },
        ' to ',
        {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      ],
      fields: {
        Amount: { value: '7 USDC', format: 'tokenAmount', rawValue: 7000000n },
        From: {
          value: '0x000000000000000000000000000000000000000f',
          format: 'addressName',
          rawValue: '0x000000000000000000000000000000000000000f',
        },
        To: {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      },
    });
    deepStrictEqual(await calldata(files, { to: WETH, data, chainId: 1 }), {
      intent: 'Send',
      interpolatedIntent:
        'Transfer 0.0000000000025 WETH to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      structuredIntent: [
        'Transfer ',
        { value: '0.0000000000025 WETH', format: 'tokenAmount', rawValue: 2500000n },
        ' to ',
        {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      ],
      fields: {
        Amount: { value: '0.0000000000025 WETH', format: 'tokenAmount', rawValue: 2500000n },
        To: {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      },
    });
    const included = addTokens(
      {
        'token/app.json': {
          includes: { includes: '../base.json' },
          context: { contract: { deployments: [{ chainId: 1, address: USDC }] } },
          display: {
            formats: {
              'transfer(address _to, uint256 _value)': { intent: 'Included Send' },
            },
          },
        },
        'base.json': OURS['ercs/calldata-erc20-tokens.json'],
      },
      { [USDC]: { abi: 'ERC20', symbol: 'USDC', decimals: 6 } }
    );
    deepStrictEqual(await calldata(included, { to: USDC, data, chainId: 1 }), {
      intent: 'Included Send',
      interpolatedIntent: 'Transfer 2.5 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      structuredIntent: [
        'Transfer ',
        { value: '2.5 USDC', format: 'tokenAmount', rawValue: 2500000n },
        ' to ',
        {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      ],
      fields: {
        Amount: { value: '2.5 USDC', format: 'tokenAmount', rawValue: 2500000n },
        To: {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      },
    });
    // ABI decode is independent of clear signing now; the repository renders the
    // same calldata through its chain-exact index instead of decoder attachment.
    const decoded = decodeData(USDC, data);
    if (!decoded || Array.isArray(decoded) || !decoded.clearSig)
      throw new Error('missing default clearSig result');
    const { clearSig, ...rest } = decoded;
    deepStrictEqual(rest, {
      name: 'transfer',
      signature: 'transfer(address,uint256)',
      value: {
        to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        value: 2500000n,
      },
    });
    deepStrictEqual(await clearSig, {
      intent: 'Send',
      interpolatedIntent: 'Transfer 2.5 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      structuredIntent: [
        'Transfer ',
        { value: '2.5 USDC', format: 'tokenAmount', rawValue: 2500000n },
        ' to ',
        {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      ],
      fields: {
        Amount: { value: '2.5 USDC', format: 'tokenAmount', rawValue: 2500000n },
        To: {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      },
    });
    deepStrictEqual(await calldata(files, { to: USDC, data, chainId: 1 }), {
      intent: 'Send',
      interpolatedIntent: 'Transfer 2.5 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      structuredIntent: [
        'Transfer ',
        { value: '2.5 USDC', format: 'tokenAmount', rawValue: 2500000n },
        ' to ',
        {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      ],
      fields: {
        Amount: { value: '2.5 USDC', format: 'tokenAmount', rawValue: 2500000n },
        To: {
          value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          format: 'addressName',
          rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        },
      },
    });
    // Descriptor binding is chain-exact: chain 56 has no entry for this selector.
    deepStrictEqual(await calldata(files, { to: USDC, data, chainId: 56 }), undefined);
  });

  should('synthesizes decodeTx info from a descriptor the ABI registry misses', async () => {
    // ERC-7730 format keys carry the ABI: matched descriptor files must yield
    // both signature info and clearSig even when no registry knows the selector.
    const files = addTokens(
      { 'erc20.json': OURS['ercs/calldata-erc20-tokens.json'] },
      { [WETH]: { abi: 'ERC20', symbol: 'WETH', decimals: 18 } }
    );
    const data = ethHex.encode(
      createContract(ERC20).transfer.encodeInput({ to: USDC, value: 2500000n })
    );
    const tx = Transaction.prepare({
      to: WETH,
      chainId: 1n,
      nonce: 0n,
      maxFeePerGas: 10_000_000_000n,
      value: 0n,
      data,
    })
      .signBy(`0x${'11'.repeat(32)}`, false)
      .toHex();
    // noDefault and no customContracts: the ABI registry knows nothing here.
    const decoded = decodeTx(tx, { noDefault: true, clearSig: files });
    if (!decoded || Array.isArray(decoded) || !decoded.clearSig)
      throw new Error('missing synthesized info');
    const { clearSig, ...info } = decoded;
    // Argument names come from the descriptor key 'transfer(address _to, uint256 _value)'.
    deepStrictEqual(info, {
      name: 'transfer',
      signature: 'transfer(address,uint256)',
      value: { _to: USDC, _value: 2500000n },
    });
    deepStrictEqual(await clearSig, {
      intent: 'Send',
      interpolatedIntent:
        'Transfer 0.0000000000025 WETH to 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      structuredIntent: [
        'Transfer ',
        { value: '0.0000000000025 WETH', format: 'tokenAmount', rawValue: 2500000n },
        ' to ',
        { value: USDC, format: 'addressName', rawValue: USDC },
      ],
      fields: {
        Amount: { value: '0.0000000000025 WETH', format: 'tokenAmount', rawValue: 2500000n },
        To: { value: USDC, format: 'addressName', rawValue: USDC },
      },
    });
  });

  should('does not use local address names when sources exclude local', async () => {
    const to = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
    const data = ethHex.encode(createContract(ERC20).transfer.encodeInput({ to, value: 1n }));
    deepStrictEqual(
      await calldata(
        {
          display: {
            formats: {
              'transfer(address to,uint256 value)': {
                intent: 'Send',
                interpolatedIntent: 'Send to {to}',
                fields: [
                  {
                    path: 'to',
                    label: 'To',
                    format: 'addressName',
                    params: { sources: ['ens'] },
                  },
                ],
              },
            },
          },
        },
        { to: USDC, data, chainId: 1 },
        {
          async resolveAddress() {
            return { name: 'Local Vitalik', source: 'local' };
          },
        }
      ),
      {
        intent: 'Send',
        interpolatedIntent: 'Send to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        structuredIntent: [
          'Send to ',
          {
            value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            format: 'addressName',
            rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          },
        ],
        fields: {
          To: {
            value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            format: 'addressName',
            rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          },
        },
      }
    );
  });

  should('selects EIP-712 format by encodeType and renders local token metadata', async () => {
    const files = addTokens(
      { 'permit2.json': PERMIT2_CLEAR },
      { [USDC]: { abi: 'ERC20', symbol: 'USDC', decimals: 6 } }
    );
    deepStrictEqual(await eip712(vectors.permit2Single.data, { clearSig: files }), {
      intent: 'Authorize spending of token',
      interpolatedIntent:
        'Authorize 0xE592427A0AEce92De3Edee1F18E0157C05861564 to spend 2500 USDC until Wed, 01 Jul 2026 00:00:00 GMT',
      structuredIntent: [
        'Authorize ',
        {
          value: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
          format: 'raw',
          rawValue: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        },
        ' to spend ',
        {
          value: '2500 USDC',
          format: 'tokenAmount',
          rawValue: '2500000000',
        },
        ' until ',
        {
          value: 'Wed, 01 Jul 2026 00:00:00 GMT',
          format: 'date',
          rawValue: 1782864000,
        },
      ],
      fields: {
        Spender: {
          value: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
          format: 'raw',
          rawValue: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        },
        'Amount allowance': {
          value: '2500 USDC',
          format: 'tokenAmount',
          rawValue: '2500000000',
        },
        'Approval expires': {
          value: 'Wed, 01 Jul 2026 00:00:00 GMT',
          format: 'date',
          rawValue: 1782864000,
        },
      },
    });
  });

  should('checks EIP-712 domainSeparator context offline', async () => {
    const typed = vectors.permit2Single.data;
    const domainSeparator = encoder(
      { EIP712Domain: getDomainType(typed.domain), ...typed.types },
      typed.domain
    ).structHash('EIP712Domain', typed.domain);
    const desc = {
      ...PERMIT2_CLEAR,
      context: {
        eip712: {
          domainSeparator,
          deployments: [{ chainId: 1, address: typed.domain.verifyingContract }],
        },
      },
    };
    const files = addTokens(
      { 'permit2.json': desc },
      { [USDC]: { abi: 'ERC20', symbol: 'USDC', decimals: 6 } }
    );
    deepStrictEqual(await eip712(typed, { clearSig: files }), {
      intent: 'Authorize spending of token',
      interpolatedIntent:
        'Authorize 0xE592427A0AEce92De3Edee1F18E0157C05861564 to spend 2500 USDC until Wed, 01 Jul 2026 00:00:00 GMT',
      structuredIntent: [
        'Authorize ',
        {
          value: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
          format: 'raw',
          rawValue: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        },
        ' to spend ',
        {
          value: '2500 USDC',
          format: 'tokenAmount',
          rawValue: '2500000000',
        },
        ' until ',
        {
          value: 'Wed, 01 Jul 2026 00:00:00 GMT',
          format: 'date',
          rawValue: 1782864000,
        },
      ],
      fields: {
        Spender: {
          value: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
          format: 'raw',
          rawValue: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        },
        'Amount allowance': {
          value: '2500 USDC',
          format: 'tokenAmount',
          rawValue: '2500000000',
        },
        'Approval expires': {
          value: 'Wed, 01 Jul 2026 00:00:00 GMT',
          format: 'date',
          rawValue: 1782864000,
        },
      },
    });
    deepStrictEqual(
      await eip712(typed, {
        clearSig: {
          ...PERMIT2_CLEAR,
          context: { eip712: { domainSeparator: `0x${'00'.repeat(32)}` } },
        },
      }),
      undefined
    );
  });

  should('matches EIP-712 domain constraints with bigint chainId', async () => {
    // EIP-712 domain chainId is uint256, so callers naturally pass bigint while
    // descriptor JSON stores a number; constraint matching must not strict-compare them.
    const desc = {
      context: { eip712: { domain: { name: 'Test', chainId: 1 } } },
      display: {
        formats: {
          'Mail(string body)': {
            intent: 'Mail',
            fields: [{ path: 'body', label: 'Body', format: 'raw' }],
          },
        },
      },
    };
    deepStrictEqual(
      await eip712(
        {
          types: { Mail: [{ name: 'body', type: 'string' }] },
          primaryType: 'Mail',
          domain: { name: 'Test', chainId: 1n, verifyingContract: USDC },
          message: { body: 'hi' },
        },
        { clearSig: desc }
      ),
      { intent: 'Mail', fields: { Body: { value: 'hi', format: 'raw', rawValue: 'hi' } } }
    );
  });

  should('lets resolveToken override the native token sentinel', async () => {
    // The 0xeeee... sentinel is a convention, not chain truth: on Polygon the native
    // token is POL, so a caller-provided resolver must win over the bundled fallback.
    const EEE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const data = ethHex.encode(
      createContract(ERC20).transfer.encodeInput({ to: USDC, value: 5000000000000000000n })
    );
    const desc = {
      display: {
        formats: {
          'transfer(address _to, uint256 _value)': {
            intent: 'Send',
            fields: [
              { path: '_value', label: 'Amount', format: 'tokenAmount', params: { token: EEE } },
            ],
          },
        },
      },
    };
    deepStrictEqual(
      await calldata(
        desc,
        { to: USDC, chainId: 137, data },
        {
          async resolveToken(req) {
            if (req.address === EEE) return { symbol: 'POL', decimals: 18 };
            return undefined;
          },
        }
      ),
      {
        intent: 'Send',
        fields: {
          Amount: { value: '5 POL', format: 'tokenAmount', rawValue: 5000000000000000000n },
        },
      }
    );
    // Without a resolver the bundled sentinel fallback still applies.
    deepStrictEqual(await calldata(desc, { to: USDC, chainId: 137, data }), {
      intent: 'Send',
      fields: {
        Amount: { value: '5 ETH', format: 'tokenAmount', rawValue: 5000000000000000000n },
      },
    });
  });

  should('matches EIP-712 domain verifyingContract constraints case-insensitively', async () => {
    // verifyingContract is an address: every other address comparison in clear
    // signing (deployments, repository index) is case-insensitive, so descriptor
    // domain constraints must not depend on checksum casing either.
    const desc = {
      context: {
        eip712: {
          domain: {
            name: 'Test',
            verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          },
        },
      },
      display: {
        formats: {
          'Mail(string body)': {
            intent: 'Mail',
            fields: [{ path: 'body', label: 'Body', format: 'raw' }],
          },
        },
      },
    };
    deepStrictEqual(
      await eip712(
        {
          types: { Mail: [{ name: 'body', type: 'string' }] },
          primaryType: 'Mail',
          domain: { name: 'Test', chainId: 1n, verifyingContract: USDC },
          message: { body: 'hi' },
        },
        { clearSig: desc }
      ),
      { intent: 'Mail', fields: { Body: { value: 'hi', format: 'raw', rawValue: 'hi' } } }
    );
  });

  should('matches non-standard EIP-712 types that back-reference the primary type', async () => {
    // encodeType rejects `:` identifiers, so matching uses the registry-compatibility
    // fallback; canonical EIP-712 encodeType never repeats the primary type in its
    // sorted dependency list, even when a nested type references it back.
    const desc = {
      display: {
        formats: {
          'Weird:Order(string what,Weird:Item item)Weird:Item(Weird:Order[] parents)': {
            intent: 'Order',
            fields: [{ path: 'what', label: 'What', format: 'raw' }],
          },
        },
      },
    };
    deepStrictEqual(
      await eip712(
        {
          types: {
            'Weird:Order': [
              { name: 'what', type: 'string' },
              { name: 'item', type: 'Weird:Item' },
            ],
            'Weird:Item': [{ name: 'parents', type: 'Weird:Order[]' }],
          },
          primaryType: 'Weird:Order',
          domain: { name: 'Weird' },
          message: { what: 'order', item: { parents: [] } },
        },
        { clearSig: desc }
      ),
      { intent: 'Order', fields: { What: { value: 'order', format: 'raw', rawValue: 'order' } } }
    );
  });

  should('renders the local MetaMask swap router descriptor', async () => {
    // Real mainnet calldata (tx 0xef99b8f4...): the router appends ONE non-ABI
    // referral byte after the encoded args, so the render needs
    // allowUnreadBytes - same story as the copied 1inch registry vectors.
    const to = '0x881d40237659c251811cec9c364ef91dc08d300c';
    const data =
      '0x5f5755290000000000000000000000000000000000000000000000000000000000000080000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec70000000000000000000000000000000000000000000000000000000001c9c38000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000018756e69737761705065726d69743246656544796e616d696300000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480000000000000000000000000000000000000000000000000000000001c9c3800000000000000000000000000000000000000000000000000000000001a7bf4e000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000001f7232000000000000000000000000e3478b0bb1a5084567c319096437924948be1964000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000004ce3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000006a1a59fd000000000000000000000000000000000000000000000000000000000000000110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000003c0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000003070b0e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000022000000000000000000000000000000000000000000000000000000000000002a000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000001c9c3800000000000000000000000000000000000000000000000000000000001c70c2a00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000060000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000074de5d4fcbf63e00296fd95d33236b97940166310000000000000000000000000000000000000000000000000000000000000000756e6978000038fe60af00000000000000000000000000000000000046';
    const opt = {
      async resolveToken(req: { address: string }) {
        if (req.address === '0xdac17f958d2ee523a2206206994597c13d831ec7')
          return { abi: 'ERC20', symbol: 'USDT', decimals: 6 };
        return undefined;
      },
    };
    const desc = OURS['local/legacy-metamask-swap-router.json'];
    deepStrictEqual(
      await calldata(desc, { to, chainId: 1, data }, { allowUnreadBytes: true, ...opt }),
      {
        intent: 'Swap',
        interpolatedIntent: 'Swap 30 USDT via uniswapPermit2FeeDynamic',
        structuredIntent: [
          'Swap ',
          { value: '30 USDT', format: 'tokenAmount', rawValue: 30000000n },
          ' via ',
          {
            value: 'uniswapPermit2FeeDynamic',
            format: 'raw',
            rawValue: 'uniswapPermit2FeeDynamic',
          },
        ],
        fields: {
          'Amount to Send': { value: '30 USDT', format: 'tokenAmount', rawValue: 30000000n },
          'Token to Send': {
            value: '0xdac17f958d2ee523a2206206994597c13d831ec7',
            format: 'addressName',
            rawValue: '0xdac17f958d2ee523a2206206994597c13d831ec7',
          },
          Aggregator: {
            value: 'uniswapPermit2FeeDynamic',
            format: 'raw',
            rawValue: 'uniswapPermit2FeeDynamic',
          },
        },
      }
    );
    // Strict decode (the default) refuses the trailing referral byte outright.
    await rejects(() => calldata(desc, { to, chainId: 1, data }, opt));
  });
  should(
    'renders decoded transaction context and supports bytes slices in token paths',
    async () => {
      deepStrictEqual(
        await calldata(
          UNISWAP_V3_ROUTER02_CLEAR,
          txInput(Transaction.fromHex(vectors.uniswapV3Router02.rawTx)),
          {
            async resolveToken(req) {
              if (req.address === SABAI.toLowerCase())
                return { abi: 'ERC20', symbol: 'SABAI', decimals: 18 };
              if (req.address === WETH.toLowerCase())
                return { abi: 'ERC20', symbol: 'WETH', decimals: 18 };
            },
          }
        ),
        {
          intent: 'Swap',
          interpolatedIntent:
            'Swap 1020.3493939635519715 SABAI for at least 0.000902656069426593 WETH to 0xc0fb1c01de1148fa7b1f151a1740e52b375c47f1',
          structuredIntent: [
            'Swap ',
            {
              value: '1020.3493939635519715 SABAI',
              format: 'tokenAmount',
              rawValue: 1020349393963551971500n,
            },
            ' for at least ',
            {
              value: '0.000902656069426593 WETH',
              format: 'tokenAmount',
              rawValue: 902656069426593n,
            },
            ' to ',
            {
              value: '0xc0fb1c01de1148fa7b1f151a1740e52b375c47f1',
              format: 'addressName',
              rawValue: '0xc0fb1c01de1148fa7b1f151a1740e52b375c47f1',
            },
          ],
          fields: {
            'Amount to Send': {
              value: '1020.3493939635519715 SABAI',
              format: 'tokenAmount',
              rawValue: 1020349393963551971500n,
            },
            'Minimum to Receive': {
              value: '0.000902656069426593 WETH',
              format: 'tokenAmount',
              rawValue: 902656069426593n,
            },
            Beneficiary: {
              value: '0xc0fb1c01de1148fa7b1f151a1740e52b375c47f1',
              format: 'addressName',
              rawValue: '0xc0fb1c01de1148fa7b1f151a1740e52b375c47f1',
            },
          },
        }
      );
    }
  );

  should('resolves ERC-7730 JSONPath subset and rejects unsupported selectors', async () => {
    const data = ethHex.encode(
      createContract(PATH_ABI).paths.encodeInput({
        text: 'abcdef',
        nums: [1n, 2n, 3n],
        items: [{ name: 'alice' }, { name: 'bob' }],
      })
    );
    deepStrictEqual(await calldata(PATH_CLEAR, { to: USDC, data }), {
      intent: 'Paths',
      fields: {
        Text: { value: 'bcd', format: 'raw', rawValue: 'bcd' },
        Tail: { value: '2', format: 'raw', rawValue: 2n },
        'Tail 2': { value: '3', format: 'raw', rawValue: 3n },
        First: { value: 'alice', format: 'raw', rawValue: 'alice' },
        Count: { value: '2', format: 'raw', rawValue: 2 },
      },
    });
    await rejects(
      calldata(
        {
          display: {
            formats: {
              'paths(string text,uint256[] nums,(string name)[] items)': {
                intent: 'Bad path',
                fields: [{ path: 'nums.[0:2:1]', label: 'Bad', format: 'raw' }],
              },
            },
          },
        },
        { to: USDC, data }
      ),
      /slice step/
    );
  });

  should('clamps out-of-range ERC-7730 path slice bounds like RFC 9535', async () => {
    const data = ethHex.encode(
      createContract(PATH_ABI).paths.encodeInput({
        text: 'abcdef',
        nums: [1n, 2n, 3n],
        items: [{ name: 'alice' }],
      })
    );
    // RFC 9535 (referenced by ERC-7730 path rules) clamps normalized slice bounds
    // to [0, len]; `[:-10]` on a 6-char value selects nothing, not bytes 0..len-4.
    deepStrictEqual(
      await calldata(
        {
          display: {
            formats: {
              'paths(string text,uint256[] nums,(string name)[] items)': {
                intent: 'Clamp',
                fields: [
                  { path: 'text.[:-10]', label: 'Empty', format: 'raw' },
                  { path: 'text.[4:100]', label: 'End', format: 'raw' },
                  { path: 'nums.[-10:]', label: 'All', format: 'raw' },
                ],
              },
            },
          },
        },
        { to: USDC, data }
      ),
      {
        intent: 'Clamp',
        fields: {
          Empty: { value: '', format: 'raw', rawValue: '' },
          End: { value: 'ef', format: 'raw', rawValue: 'ef' },
          All: { value: '1', format: 'raw', rawValue: 1n },
          'All 2': { value: '2', format: 'raw', rawValue: 2n },
          'All 3': { value: '3', format: 'raw', rawValue: 3n },
        },
      }
    );
  });

  should('recursively renders nested calldata fields', async () => {
    const to = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
    const erc20 = createContract(ERC20);
    const batch = createContract(BATCH_ABI).batchExecute;
    const transfer = erc20.transfer.encodeInput({ to, value: 1000000n });
    deepStrictEqual(
      await calldata([BATCH_CLEAR, ERC20_USDC_CLEAR], {
        to: ROUTER02,
        data: ethHex.encode(
          batch.encodeInput({
            targets: [USDC],
            datas: [transfer],
            values: [0n],
          })
        ),
      }),
      {
        intent: 'Batch',
        interpolatedIntent: 'Batch Send 1 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        structuredIntent: [
          'Batch ',
          {
            value: 'Send 1 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            format: 'calldata',
            rawValue: ethHex.decode(
              '0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa9604500000000000000000000000000000000000000000000000000000000000f4240'
            ),
          },
        ],
        fields: {
          'Nested Calls': {
            value: 'Send 1 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            format: 'calldata',
            rawValue: ethHex.decode(
              '0xa9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa9604500000000000000000000000000000000000000000000000000000000000f4240'
            ),
          },
        },
      }
    );
  });

  should('uses explicit selector for embedded calldata without selector bytes', async () => {
    const to = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
    const transfer = createContract(ERC20).transfer.encodeInput({ to, value: 1000000n }).slice(4);
    deepStrictEqual(
      await calldata([EXECUTE_CLEAR, ERC20_USDC_CLEAR], {
        to: ROUTER02,
        data: ethHex.encode(
          createContract(EXECUTE_ABI).execute.encodeInput({ to: USDC, value: 0n, data: transfer })
        ),
      }),
      {
        intent: 'Execute',
        interpolatedIntent: 'Execute Send 1 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        structuredIntent: [
          'Execute ',
          {
            value: 'Send 1 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            format: 'calldata',
            rawValue: ethHex.decode(
              '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa9604500000000000000000000000000000000000000000000000000000000000f4240'
            ),
          },
        ],
        fields: {
          Call: {
            value: 'Send 1 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            format: 'calldata',
            rawValue: ethHex.decode(
              '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa9604500000000000000000000000000000000000000000000000000000000000f4240'
            ),
          },
        },
      }
    );
  });

  should('renders bundled array groups with separators and array interpolation', async () => {
    const recipients = [
      '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      '0x1111111111111111111111111111111111111111',
    ];
    deepStrictEqual(
      await calldata(DISTRIBUTE_CLEAR, {
        to: ROUTER02,
        value: 1000000000000000000n,
        data: ethHex.encode(
          createContract(DISTRIBUTE_ABI).distribute.encodeInput({
            recipients,
            percentages: [1250n, 8750n],
          })
        ),
      }),
      {
        intent: 'Distribute fees',
        interpolatedIntent:
          'Distribute fees 12.5 %, 87.5 % among recipients 0xd8da6bf26964af9d7eed9e03e53415d37aa96045, 0x1111111111111111111111111111111111111111',
        structuredIntent: [
          'Distribute fees ',
          { value: '12.5 %', format: 'unit', rawValue: 1250n },
          ', ',
          { value: '87.5 %', format: 'unit', rawValue: 8750n },
          ' among recipients ',
          {
            value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            format: 'addressName',
            rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          },
          ', ',
          {
            value: '0x1111111111111111111111111111111111111111',
            format: 'addressName',
            rawValue: '0x1111111111111111111111111111111111111111',
          },
        ],
        fields: {
          'Total Distributed Amount': {
            value: '1 ETH',
            format: 'amount',
            rawValue: 1000000000000000000n,
          },
          'Recipient 0 Recipients': {
            value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            format: 'addressName',
            rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          },
          Percentages: { value: '12.5 %', format: 'unit', rawValue: 1250n },
          'Recipient 1 Recipients': {
            value: '0x1111111111111111111111111111111111111111',
            format: 'addressName',
            rawValue: '0x1111111111111111111111111111111111111111',
          },
          'Percentages 2': { value: '87.5 %', format: 'unit', rawValue: 8750n },
        },
      }
    );
  });

  should('renders unit formatter SI prefixes', async () => {
    const data = ethHex.encode(
      createContract(ERC20).transfer.encodeInput({
        to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        value: 1n,
      })
    );
    deepStrictEqual(
      await calldata(
        {
          display: {
            formats: {
              'transfer(address to,uint256 value)': {
                intent: 'Measure',
                fields: [
                  {
                    label: 'Delay',
                    value: '36000',
                    format: 'unit',
                    params: { base: 's', prefix: true },
                  },
                ],
              },
            },
          },
        },
        { to: USDC, data, chainId: 1 }
      ),
      {
        intent: 'Measure',
        fields: { Delay: { value: '36ks', format: 'unit', rawValue: '36000' } },
      }
    );
  });

  should('uses tokenAmount chainId for native currency metadata', async () => {
    const data = ethHex.encode(
      createContract(ERC20).transfer.encodeInput({
        to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        value: 1000000000000000000n,
      })
    );
    deepStrictEqual(
      await calldata(
        {
          display: {
            formats: {
              'transfer(address to,uint256 value)': {
                intent: 'Bridge',
                interpolatedIntent: 'Bridge {value}',
                fields: [
                  {
                    label: 'Amount',
                    path: 'value',
                    format: 'tokenAmount',
                    params: {
                      token: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                      nativeCurrencyAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                      chainId: 137,
                    },
                  },
                ],
              },
            },
          },
        },
        { to: USDC, data, chainId: 1 }
      ),
      {
        intent: 'Bridge',
        interpolatedIntent: 'Bridge 1 POL',
        structuredIntent: [
          'Bridge ',
          { value: '1 POL', format: 'tokenAmount', rawValue: 1000000000000000000n },
        ],
        fields: {
          Amount: { value: '1 POL', format: 'tokenAmount', rawValue: 1000000000000000000n },
        },
      }
    );
  });

  should('rejects mutually exclusive formatter parameters', async () => {
    const data = ethHex.encode(
      createContract(ERC20).transfer.encodeInput({
        to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        value: 1000000000000000000n,
      })
    );
    await rejects(
      calldata(
        {
          display: {
            formats: {
              'transfer(address to,uint256 value)': {
                intent: 'Bad',
                fields: [
                  {
                    label: 'Amount',
                    path: 'value',
                    format: 'tokenAmount',
                    params: { token: USDC, tokenPath: '@.to' },
                  },
                ],
              },
            },
          },
        },
        { to: USDC, data, chainId: 1 }
      ),
      /cannot combine token and tokenPath/
    );
  });

  should('rejects mutually exclusive field and visibility keys', async () => {
    const data = ethHex.encode(
      createContract(ERC20).transfer.encodeInput({
        to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        value: 1000000n,
      })
    );
    await rejects(
      calldata(
        {
          display: {
            formats: {
              'transfer(address to,uint256 value)': {
                intent: 'Bad',
                fields: [{ label: 'Amount', path: 'value', value: '1', format: 'raw' }],
              },
            },
          },
        },
        { to: USDC, data, chainId: 1 }
      ),
      /cannot combine path and value/
    );
    await rejects(
      calldata(
        {
          display: {
            formats: {
              'transfer(address to,uint256 value)': {
                intent: 'Bad',
                fields: [
                  {
                    label: 'Amount',
                    path: 'value',
                    format: 'raw',
                    visible: { ifNotIn: [0], mustMatch: [1000000] },
                  },
                ],
              },
            },
          },
        },
        { to: USDC, data, chainId: 1 }
      ),
      /cannot combine visible.ifNotIn and visible.mustMatch/
    );
  });

  should('rejects numeric values formatted as addresses', async () => {
    const data = ethHex.encode(
      createContract([{ name: 'set', type: 'function', inputs: [] }]).set.encodeInput(undefined)
    );
    await rejects(
      calldata(
        {
          display: {
            formats: {
              'set()': {
                intent: 'Set',
                fields: [{ label: 'To', value: 1, format: 'addressName' }],
              },
            },
          },
        },
        { to: USDC, data, chainId: 1 }
      ),
      /expected address/
    );
  });

  should('formats packed uint256 token identifiers only as tokenAmount tokens', async () => {
    const data = ethHex.encode(
      createContract([
        {
          name: 'pay',
          type: 'function',
          inputs: [
            { name: 'token', type: 'uint256' },
            { name: 'amount', type: 'uint256' },
          ],
        },
      ]).pay.encodeInput({
        token: BigInt(WETH),
        amount: 1000000000000000000n,
      })
    );
    deepStrictEqual(
      await calldata(
        {
          display: {
            formats: {
              'pay(uint256 token,uint256 amount)': {
                intent: 'Pay',
                fields: [
                  {
                    label: 'Amount',
                    path: 'amount',
                    format: 'tokenAmount',
                    params: { tokenPath: 'token' },
                  },
                ],
              },
            },
          },
        },
        { to: USDC, data, chainId: 1 },
        {
          async resolveToken(req) {
            if (req.address === WETH.toLowerCase()) return { symbol: 'WETH', decimals: 18 };
          },
        }
      ),
      {
        intent: 'Pay',
        fields: {
          Amount: {
            value: '1 WETH',
            format: 'tokenAmount',
            rawValue: 1000000000000000000n,
          },
        },
      }
    );
  });

  should('uses ABI scalar words for ERC-7730 integer path slices', async () => {
    const ok = ethHex.encode(
      createContract([
        { name: 'set160', type: 'function', inputs: [{ name: 'token', type: 'uint160' }] },
      ]).set160.encodeInput(BigInt(WETH))
    );
    deepStrictEqual(
      await calldata(
        {
          ...CLEARSIG_REPO,
          'test/slice160.json': {
            context: { contract: { deployments: [{ chainId: 1, address: USDC }] } },
            display: {
              formats: {
                'set160(uint160 token)': {
                  intent: 'Set',
                  fields: [{ label: 'Token', path: 'token.[-20:]', format: 'addressName' }],
                },
              },
            },
          },
        },
        { to: USDC, data: ok, chainId: 1 }
      ),
      {
        intent: 'Set',
        fields: {
          Token: {
            value: 'WETH Token',
            format: 'addressName',
            rawValue: new Uint8Array([
              192, 42, 170, 57, 178, 35, 254, 141, 10, 14, 92, 79, 39, 234, 217, 8, 60, 117, 108,
              194,
            ]),
          },
        },
      }
    );
    const short = ethHex.encode(
      createContract([
        { name: 'set128', type: 'function', inputs: [{ name: 'token', type: 'uint128' }] },
      ]).set128.encodeInput(0x11111111111111111111111111111111n)
    );
    deepStrictEqual(
      await calldata(
        {
          ...CLEARSIG_REPO,
          'test/slice128.json': {
            context: { contract: { deployments: [{ chainId: 1, address: USDC }] } },
            display: {
              formats: {
                'set128(uint128 token)': {
                  intent: 'Set',
                  fields: [{ label: 'Token', path: 'token.[-20:]', format: 'addressName' }],
                },
              },
            },
          },
        },
        { to: USDC, data: short, chainId: 1 }
      ),
      {
        intent: 'Set',
        fields: {
          Token: {
            value: '0x0000000011111111111111111111111111111111',
            format: 'addressName',
            rawValue: new Uint8Array([
              0, 0, 0, 0, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17,
            ]),
          },
        },
      }
    );
  });

  should('uses ABI path lookup for tuple-array scalar slices', async () => {
    const data = ethHex.encode(
      createContract([
        {
          name: 'set',
          type: 'function',
          inputs: [
            {
              name: 'items',
              type: 'tuple[]',
              components: [{ name: 'token', type: 'uint160' }],
            },
          ],
        },
      ]).set.encodeInput([{ token: BigInt(WETH) }])
    );
    deepStrictEqual(
      await calldata(
        {
          ...CLEARSIG_REPO,
          'test/tuple-slice.json': {
            context: { contract: { deployments: [{ chainId: 1, address: USDC }] } },
            display: {
              formats: {
                'set((uint160 token)[] items)': {
                  intent: 'Set',
                  fields: [
                    {
                      label: 'Token',
                      path: 'items.[0].token.[-20:]',
                      format: 'addressName',
                    },
                  ],
                },
              },
            },
          },
        },
        { to: USDC, data, chainId: 1 }
      ),
      {
        intent: 'Set',
        fields: {
          Token: {
            value: 'WETH Token',
            format: 'addressName',
            rawValue: new Uint8Array([
              192, 42, 170, 57, 178, 35, 254, 141, 10, 14, 92, 79, 39, 234, 217, 8, 60, 117, 108,
              194,
            ]),
          },
        },
      }
    );
  });

  should('rejects descriptors with duplicate calldata selectors up front', async () => {
    await rejects(
      calldata(
        {
          display: {
            formats: {
              'transfer(address to,uint256 value)': { intent: 'A', fields: [] },
              'transfer(address _to, uint256 _value)': { intent: 'B', fields: [] },
            },
          },
        },
        { to: USDC, data: '0x', chainId: 1 },
        undefined
      ),
      /duplicate selector/
    );
  });

  should('rejects deployed descriptors without a chain id', async () => {
    await rejects(
      calldata(
        {
          context: { contract: { deployments: [{ address: USDC }] } },
          display: { formats: { 'noop()': { intent: 'Noop', fields: [] } } },
        },
        { to: USDC, data: '0x', chainId: 1 }
      ),
      /missing deployment chainId/
    );
  });

  should('rejects unsafe clear-signing chain ids', async () => {
    await rejects(
      calldata(
        {
          context: { contract: { deployments: [{ chainId: 1, address: USDC }] } },
          display: { formats: { 'noop()': { intent: 'Noop', fields: [] } } },
        },
        { to: USDC, data: '0x', chainId: BigInt(Number.MAX_SAFE_INTEGER) + 1n }
      ),
      /expected safe integer chainId/
    );
  });

  should('merges static includes and renders descriptor value paths', async () => {
    const data = ethHex.encode(
      createContract(ERC20).transfer.encodeInput({
        to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        value: 2500000n,
      })
    );
    deepStrictEqual(
      await calldata(
        {
          ...INCLUDE_CHILD,
          includes: INCLUDE_BASE,
          context: { contract: { deployments: [{ chainId: 1, address: USDC }] } },
          metadata: {
            ...INCLUDE_CHILD.metadata,
            token: { ticker: 'USDC', decimals: 6 },
          },
        },
        { to: USDC, data, chainId: 1 },
        undefined
      ),
      {
        intent: 'Send',
        interpolatedIntent: 'Send 2.5 USDC',
        structuredIntent: [
          'Send ',
          { value: '2.5 USDC', format: 'tokenAmount', rawValue: 2500000n },
        ],
        fields: {
          Amount: { value: '2.5 USDC', format: 'tokenAmount', rawValue: 2500000n },
          Asset: { value: 'USDC', format: 'raw', rawValue: 'USDC' },
        },
      }
    );
    await rejects(
      calldata(INCLUDE_CHILD, { to: USDC, data, chainId: 1 }),
      /missing descriptor erc20/
    );
  });

  should('merges include fields by falsy descriptor values', async () => {
    const data = ethHex.encode(
      createContract(ERC20).transfer.encodeInput({
        to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        value: 1n,
      })
    );
    deepStrictEqual(
      await calldata(
        {
          includes: {
            display: {
              formats: {
                'transfer(address to,uint256 value)': {
                  intent: 'Falsy',
                  fields: [{ label: 'Base Zero', value: 0, format: 'raw' }],
                },
              },
            },
          },
          display: {
            formats: {
              'transfer(address to,uint256 value)': {
                fields: [{ label: 'Child Zero', value: 0, format: 'raw' }],
              },
            },
          },
        },
        { to: USDC, data, chainId: 1 },
        undefined
      ),
      {
        intent: 'Falsy',
        fields: { 'Child Zero': { value: '0', format: 'raw', rawValue: 0 } },
      }
    );
  });

  should('does not merge include fields only by label', async () => {
    const to = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
    const data = ethHex.encode(createContract(ERC20).transfer.encodeInput({ to, value: 1n }));
    deepStrictEqual(
      await calldata(
        {
          includes: {
            display: {
              formats: {
                'transfer(address to,uint256 value)': {
                  intent: 'Label',
                  fields: [{ path: 'value', label: 'Amount', format: 'raw' }],
                },
              },
            },
          },
          display: {
            formats: {
              'transfer(address to,uint256 value)': {
                fields: [{ path: 'to', label: 'Amount', format: 'addressName' }],
              },
            },
          },
        },
        { to: USDC, data, chainId: 1 },
        undefined
      ),
      {
        intent: 'Label',
        fields: {
          Amount: { value: '1', format: 'raw', rawValue: 1n },
          'Amount 2': {
            value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            format: 'addressName',
            rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          },
        },
      }
    );
  });

  should('applies mustMatch and ifNotIn visibility rules', async () => {
    const pay = createContract(VISIBILITY_ABI).pay;
    const to = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
    deepStrictEqual(
      await calldata(VISIBILITY_CLEAR, {
        to: USDC,
        chainId: 1,
        data: ethHex.encode(pay.encodeInput({ to, value: 3000000n, legacy: 0n, fee: 0n })),
      }),
      {
        intent: 'Send',
        interpolatedIntent: 'Send 3 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        structuredIntent: [
          'Send ',
          { value: '3 USDC', format: 'tokenAmount', rawValue: 3000000n },
          ' to ',
          {
            value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            format: 'addressName',
            rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          },
        ],
        fields: {
          To: {
            value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            format: 'addressName',
            rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          },
          Amount: { value: '3 USDC', format: 'tokenAmount', rawValue: 3000000n },
        },
      }
    );
    deepStrictEqual(
      await calldata(VISIBILITY_CLEAR, {
        to: USDC,
        chainId: 1,
        data: ethHex.encode(pay.encodeInput({ to, value: 3000000n, legacy: 0n, fee: 5n })),
      }),
      {
        intent: 'Send',
        interpolatedIntent: 'Send 3 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        structuredIntent: [
          'Send ',
          { value: '3 USDC', format: 'tokenAmount', rawValue: 3000000n },
          ' to ',
          {
            value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            format: 'addressName',
            rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          },
        ],
        fields: {
          To: {
            value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
            format: 'addressName',
            rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          },
          Amount: { value: '3 USDC', format: 'tokenAmount', rawValue: 3000000n },
          Fee: { value: '0.000000000000000005 ETH', format: 'amount', rawValue: 5n },
        },
      }
    );
    await rejects(
      calldata(VISIBILITY_CLEAR, {
        to: USDC,
        chainId: 1,
        data: ethHex.encode(pay.encodeInput({ to, value: 3000000n, legacy: 1n, fee: 0n })),
      }),
      /mustMatch/
    );
  });

  should('renders duration formatter and includes optional fields', async () => {
    deepStrictEqual(
      await calldata(DURATION_CLEAR, {
        to: USDC,
        data: ethHex.encode(createContract(DURATION_ABI).timeout.encodeInput(3661n)),
      }),
      {
        intent: 'Set Timeout',
        interpolatedIntent: 'Set timeout 01:01:01',
        structuredIntent: [
          'Set timeout ',
          { value: '01:01:01', format: 'duration', rawValue: 3661n },
        ],
        fields: {
          Timeout: { value: '01:01:01', format: 'duration', rawValue: 3661n },
          Mode: { value: 'soft', format: 'raw', rawValue: 'soft' },
        },
      }
    );
  });

  should(
    'falls back to raw date value for blockheight encoding without chain timing data',
    async () => {
      const data = ethHex.encode(
        createContract(ERC20).transfer.encodeInput({
          to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          value: 1n,
        })
      );
      deepStrictEqual(
        await calldata(
          {
            display: {
              formats: {
                'transfer(address to,uint256 value)': {
                  intent: 'Check',
                  fields: [
                    {
                      label: 'Block',
                      value: '19332140',
                      format: 'date',
                      params: { encoding: 'blockheight' },
                    },
                  ],
                },
              },
            },
          },
          { to: USDC, data, chainId: 1 }
        ),
        {
          intent: 'Check',
          fields: { Block: { value: '19332140', format: 'date', rawValue: '19332140' } },
        }
      );
    }
  );

  should('resolves chain-keyed token maps and interpolates formatted values', async () => {
    deepStrictEqual(
      await calldata(
        MAP_CLEAR,
        {
          to: USDC,
          chainId: 1,
          data: ethHex.encode(
            createContract(MAP_ABI).deposit.encodeInput({
              amount: 123456789n,
              minShares: 2000000000000000000n,
            })
          ),
        },
        {
          async resolveToken(req) {
            if (req.address === ASSET.toLowerCase())
              return { abi: 'ERC20', symbol: 'ASSET', decimals: 6 };
            if (req.address === SHARE.toLowerCase())
              return { abi: 'ERC20', symbol: 'SHARE', decimals: 18 };
          },
        }
      ),
      {
        intent: 'Action Deposit Type Mapped token',
        interpolatedIntent: 'Deposit 123.456789 ASSET to receive at least 2 SHARE',
        structuredIntent: [
          'Deposit ',
          { value: '123.456789 ASSET', format: 'tokenAmount', rawValue: 123456789n },
          ' to receive at least ',
          { value: '2 SHARE', format: 'tokenAmount', rawValue: 2000000000000000000n },
        ],
        fields: {
          'Deposit Amount': {
            value: '123.456789 ASSET',
            format: 'tokenAmount',
            rawValue: 123456789n,
          },
          'Min Shares': {
            value: '2 SHARE',
            format: 'tokenAmount',
            rawValue: 2000000000000000000n,
          },
        },
      }
    );
  });

  should('falls back when interpolated intent references a missing field', async () => {
    const data = ethHex.encode(
      createContract(MAP_ABI).deposit.encodeInput({ amount: 123n, minShares: 0n })
    );
    deepStrictEqual(await calldata(INTERPOLATE_CLEAR, { to: USDC, data }), {
      intent: 'Deposit fallback',
      interpolatedIntent: 'Deposit fallback',
      fields: { Amount: { value: '123', format: 'raw', rawValue: 123n } },
    });
    deepStrictEqual(await calldata(INTERPOLATE_ESCAPED_CLEAR, { to: USDC, data }), {
      intent: 'Deposit fallback',
      interpolatedIntent: 'Deposit {amount} 123 }',
      structuredIntent: [
        'Deposit {amount} ',
        { value: '123', format: 'raw', rawValue: 123n },
        ' }',
      ],
      fields: { Amount: { value: '123', format: 'raw', rawValue: 123n } },
    });
  });

  should('uses encrypted field fallback without attempting decryption', async () => {
    const payload = new Uint8Array(32).fill(7);
    deepStrictEqual(
      await calldata(ENCRYPTED_CLEAR, {
        to: USDC,
        chainId: 1,
        data: ethHex.encode(createContract(ENCRYPTED_ABI).encrypted.encodeInput(payload)),
      }),
      {
        intent: 'Encrypted Transfer',
        interpolatedIntent: 'Encrypted Transfer [Encrypted Amount]',
        structuredIntent: [
          'Encrypted Transfer ',
          {
            value: '[Encrypted Amount]',
            format: 'tokenAmount',
            rawValue: new Uint8Array([
              7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
              7, 7, 7,
            ]),
          },
        ],
        fields: {
          Amount: {
            value: '[Encrypted Amount]',
            format: 'tokenAmount',
            rawValue: new Uint8Array([
              7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
              7, 7, 7,
            ]),
          },
        },
      }
    );
  });

  should('uses renderer callbacks for external metadata formats', async () => {
    const calls: string[] = [];
    const data = ethHex.encode(
      createContract(RESOLVER_ABI).resolve.encodeInput({
        token: RESOLVER_TOKEN,
        account: RESOLVER_ACCOUNT,
        amount: 123456n,
        tokenId: 42n,
        blockNumber: 19332140n,
        interop: new Uint8Array([1, 2, 3]),
      })
    );
    deepStrictEqual(
      await calldata(
        RESOLVER_CLEAR,
        { to: RESOLVER_TARGET, data, chainId: 9999 },
        {
          async resolveToken(req) {
            calls.push(`token:${req.chainId}:${req.address}`);
            return { symbol: 'MTK', decimals: 4, name: 'Mock Token' };
          },
          async resolveAddress(req) {
            calls.push(`address:${req.chainId}:${req.address}:${req.sources?.join(',')}`);
            return { name: 'vitalik.eth', source: 'ens', types: ['eoa'], verified: true };
          },
          async resolveNft(req) {
            calls.push(`nft:${req.chainId}:${req.collection}:${req.tokenId}`);
            return { name: 'Mock NFT #42', source: 'local', verified: true };
          },
          async resolveBlock(req) {
            calls.push(`block:${req.chainId}:${req.block}`);
            return 1709197235;
          },
          async resolveChain(req) {
            calls.push(`chain:${req.chainId}`);
            return { name: 'Test Chain', ticker: 'TST' };
          },
          async resolveInteroperableAddress(req) {
            calls.push(`interop:${ethHex.encode(req.value)}`);
            return 'alice@test#abcd';
          },
        }
      ),
      {
        intent: 'Resolve',
        interpolatedIntent:
          'Resolve MTK 12.3456 MTK for vitalik.eth NFT Mock NFT #42 at Thu, 29 Feb 2024 09:00:35 GMT alice@test#abcd',
        structuredIntent: [
          'Resolve ',
          {
            value: 'MTK',
            format: 'tokenTicker',
            rawValue: '0x0000000000000000000000000000000000000104',
          },
          ' ',
          { value: '12.3456 MTK', format: 'tokenAmount', rawValue: 123456n },
          ' for ',
          {
            value: 'vitalik.eth',
            format: 'addressName',
            rawValue: '0x0000000000000000000000000000000000000105',
          },
          ' NFT ',
          { value: 'Mock NFT #42', format: 'nftName', rawValue: 42n },
          ' at ',
          {
            value: 'Thu, 29 Feb 2024 09:00:35 GMT',
            format: 'date',
            rawValue: 19332140n,
          },
          ' ',
          {
            value: 'alice@test#abcd',
            format: 'interoperableAddressName',
            rawValue: new Uint8Array([1, 2, 3]),
          },
        ],
        fields: {
          Token: {
            value: 'MTK',
            format: 'tokenTicker',
            rawValue: '0x0000000000000000000000000000000000000104',
          },
          Amount: { value: '12.3456 MTK', format: 'tokenAmount', rawValue: 123456n },
          Account: {
            value: 'vitalik.eth',
            format: 'addressName',
            rawValue: '0x0000000000000000000000000000000000000105',
          },
          NFT: { value: 'Mock NFT #42', format: 'nftName', rawValue: 42n },
          Block: {
            value: 'Thu, 29 Feb 2024 09:00:35 GMT',
            format: 'date',
            rawValue: 19332140n,
          },
          Network: { value: 'Test Chain', format: 'chainId', rawValue: 9999n },
          Interop: {
            value: 'alice@test#abcd',
            format: 'interoperableAddressName',
            rawValue: new Uint8Array([1, 2, 3]),
          },
        },
      }
    );
    deepStrictEqual(calls, [
      'token:9999:0x0000000000000000000000000000000000000104',
      'token:9999:0x0000000000000000000000000000000000000104',
      'address:9999:0x0000000000000000000000000000000000000105:ens',
      'nft:9999:0x0000000000000000000000000000000000000104:42',
      'block:9999:19332140',
      'chain:9999',
      'interop:0x010203',
    ]);
  });

  should('uses renderer callbacks for factory context checks', async () => {
    const calls: string[] = [];
    const data = ethHex.encode(
      createContract(RESOLVER_ABI).resolve.encodeInput({
        token: RESOLVER_TOKEN,
        account: RESOLVER_ACCOUNT,
        amount: 1n,
        tokenId: 1n,
        blockNumber: 1n,
        interop: new Uint8Array(),
      })
    );
    deepStrictEqual(
      await calldata(DEPLOYED_RESOLVER_CLEAR, { to: RESOLVER_PROXY, data, chainId: 1 }),
      undefined
    );
    deepStrictEqual(
      await calldata(FACTORY_RESOLVER_CLEAR, { to: RESOLVER_PROXY, data, chainId: 1 }),
      undefined
    );
    await calldata(
      [FACTORY_MISS_CLEAR, FACTORY_RESOLVER_CLEAR],
      {
        to: RESOLVER_PROXY,
        data,
        chainId: 1,
      },
      {
        async resolveFactory(req) {
          calls.push(`factory:${req.factories.map((i) => i.deployEvent).join('|')}`);
          return 1;
        },
      }
    );
    deepStrictEqual(calls, [
      'factory:Miss(address indexed instance)|Deployed(address indexed instance)',
    ]);
    calls.length = 0;
    deepStrictEqual(
      await calldata(
        FACTORY_RESOLVER_CLEAR,
        { to: RESOLVER_PROXY, data, chainId: 1 },
        {
          async resolveFactory(req) {
            calls.push(`factory:${req.chainId}:${req.address}:${req.factories[0].deployEvent}`);
            return 0;
          },
        }
      ),
      {
        intent: 'Resolve',
        interpolatedIntent:
          'Resolve 0x0000000000000000000000000000000000000104 1 ??? for 0x0000000000000000000000000000000000000105 NFT 1 at 1 0x',
        structuredIntent: [
          'Resolve ',
          {
            value: '0x0000000000000000000000000000000000000104',
            format: 'tokenTicker',
            rawValue: '0x0000000000000000000000000000000000000104',
          },
          ' ',
          { value: '1 ???', format: 'tokenAmount', rawValue: 1n },
          ' for ',
          {
            value: '0x0000000000000000000000000000000000000105',
            format: 'addressName',
            rawValue: '0x0000000000000000000000000000000000000105',
          },
          ' NFT ',
          { value: '1', format: 'nftName', rawValue: 1n },
          ' at ',
          { value: '1', format: 'date', rawValue: 1n },
          ' ',
          {
            value: '0x',
            format: 'interoperableAddressName',
            rawValue: new Uint8Array(),
          },
        ],
        fields: {
          Token: {
            value: '0x0000000000000000000000000000000000000104',
            format: 'tokenTicker',
            rawValue: '0x0000000000000000000000000000000000000104',
          },
          Amount: { value: '1 ???', format: 'tokenAmount', rawValue: 1n },
          Account: {
            value: '0x0000000000000000000000000000000000000105',
            format: 'addressName',
            rawValue: '0x0000000000000000000000000000000000000105',
          },
          NFT: { value: '1', format: 'nftName', rawValue: 1n },
          Block: { value: '1', format: 'date', rawValue: 1n },
          Network: { value: 'Ethereum Mainnet', format: 'chainId', rawValue: 1n },
          Interop: {
            value: '0x',
            format: 'interoperableAddressName',
            rawValue: new Uint8Array(),
          },
        },
      }
    );
    deepStrictEqual(calls, [
      'factory:1:0x0000000000000000000000000000000000000102:Deployed(address indexed instance)',
    ]);
  });

  should(
    'uses renderer callbacks for embedded calldata descriptors and encrypted values',
    async () => {
      const to = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
      const transfer = createContract(ERC20).transfer.encodeInput({ to, value: 1000000n }).slice(4);
      deepStrictEqual(
        await calldata(
          EXECUTE_CLEAR,
          {
            to: ROUTER02,
            data: ethHex.encode(
              createContract(EXECUTE_ABI).execute.encodeInput({
                to: USDC,
                value: 0n,
                data: transfer,
              })
            ),
          },
          {
            async resolveCalldata(req) {
              deepStrictEqual(
                {
                  to: req.to,
                  selector: req.selector,
                  chainId: req.chainId,
                  value: req.value,
                },
                {
                  to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                  selector: '0xa9059cbb',
                  chainId: 1n,
                  value: 0n,
                }
              );
              return ERC20_USDC_CLEAR;
            },
          }
        ),
        {
          intent: 'Execute',
          interpolatedIntent: 'Execute Send 1 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          structuredIntent: [
            'Execute ',
            {
              value: 'Send 1 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
              format: 'calldata',
              rawValue: ethHex.decode(
                '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa9604500000000000000000000000000000000000000000000000000000000000f4240'
              ),
            },
          ],
          fields: {
            Call: {
              value: 'Send 1 USDC to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
              format: 'calldata',
              rawValue: ethHex.decode(
                '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa9604500000000000000000000000000000000000000000000000000000000000f4240'
              ),
            },
          },
        }
      );
      const payload = new Uint8Array(32).fill(7);
      deepStrictEqual(
        await calldata(
          ENCRYPTED_CLEAR,
          {
            to: USDC,
            chainId: 1,
            data: ethHex.encode(createContract(ENCRYPTED_ABI).encrypted.encodeInput(payload)),
          },
          {
            async decrypt(req) {
              deepStrictEqual(req.scheme, 'fhevm');
              return 1000000n;
            },
          }
        ),
        {
          intent: 'Encrypted Transfer',
          interpolatedIntent: 'Encrypted Transfer 1 USDC',
          structuredIntent: [
            'Encrypted Transfer ',
            {
              value: '1 USDC',
              format: 'tokenAmount',
              rawValue: ethHex.decode(
                '0x0707070707070707070707070707070707070707070707070707070707070707'
              ),
            },
          ],
          fields: {
            Amount: {
              value: '1 USDC',
              format: 'tokenAmount',
              rawValue: ethHex.decode(
                '0x0707070707070707070707070707070707070707070707070707070707070707'
              ),
            },
          },
        }
      );
    }
  );

  should('rejects unread calldata bytes unless explicitly allowed', async () => {
    const item = {
      file: 'registry/1inch/tests/calldata-AggregationRouterV3.tests.json',
      index: 1,
    };
    const test = json(item.file).tests[item.index];
    await rejects(
      registryRender(registryDesc(item.file), registryInput(item.file, test)),
      /unread byte ranges|left after unpack/
    );
    deepStrictEqual(
      await registryRender(
        registryDesc(item.file),
        registryInput(item.file, test),
        registryOpt(item)
      ),
      {
        intent: 'Swap',
        fields: {
          'Amount to Send': {
            value: '0.00414225 ETH',
            format: 'tokenAmount',
            rawValue: 4142250000000000n,
          },
          'Minimum to Receive': {
            value: '4957007923890945718204719 ???',
            format: 'tokenAmount',
            rawValue: 4957007923890945718204719n,
          },
        },
      }
    );
  });

  should('matches copied ERC-7730 registry display vectors', async () => {
    deepStrictEqual(registry.testCount, registry.tests.length);
    for (const item of registry.tests) {
      if (STRICT_CONTEXT_VECTORS.has(`${item.file}#${item.index}`)) continue;
      const test = json(item.file).tests[item.index];
      let result;
      try {
        result = await registryRender(
          registryDesc(item.file),
          registryInput(item.file, test),
          registryOpt(item)
        );
      } catch (e) {
        throw new Error(`${item.file}#${item.index} ${item.description}: ${(e as Error).message}`);
      }
      deepStrictEqual(
        [typeof result.intent, !!result.fields, Array.isArray(result.fields)],
        ['string', true, false],
        `${item.file}#${item.index} ${item.description}`
      );
    }
    deepStrictEqual(registry.compareCount, registry.cases.length);
    for (const item of registry.cases) {
      if (STRICT_CONTEXT_VECTORS.has(`${item.file}#${item.index}`)) continue;
      const test = json(item.file).tests[item.index];
      const expected = registryExpected(test.expectedTexts);
      let result;
      try {
        result = await registryRender(
          registryDesc(item.file),
          registryInput(item.file, test),
          registryOpt(item)
        );
      } catch (e) {
        throw new Error(`${item.file}#${item.index} ${item.description}: ${(e as Error).message}`);
      }
      deepStrictEqual(
        registryMatched(expected, registryActual(result)),
        expected,
        `${item.file}#${item.index} ${item.description}`
      );
    }
  });
});

should.runWhen(import.meta.url);
