// Vectors for the high-level decodeData / decodeTx / decodeEvent / decodeError API.
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';

// tx hash: 0x6fd66d7b306f77fc01a397f55d4efe19256458badd8782d523d06ed450851d0a
// USDT, but the caller does not know that -- both `to` and `data` come from the tx.
export const USDT_TRANSFER = {
  to: USDT,
  data: 'a9059cbb000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec70000000000000000000000000000000000000000000000000000000542598700',
  tx: '0xf8a901851d1a94a20082c12a94dac17f958d2ee523a2206206994597c13d831ec780b844a9059cbb000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000000000000000000000000000000000054259870025a066fcb560b50e577f6dc8c8b2e3019f760da78b4c04021382ba490c572a303a42a0078f5af8ac7e11caba9b7dc7a64f7bdc3b4ce1a6ab0a1246771d7cc3524a7200',
  info: {
    name: 'transfer',
    signature: 'transfer(address,uint256)',
    value: {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: 22588000000n,
    },
  },
  // Same call decoded through the ERC-7730 descriptor ABI, which names args _to/_value.
  descriptorInfo: {
    name: 'transfer',
    signature: 'transfer(address,uint256)',
    value: {
      _to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      _value: 22588000000n,
    },
  },
  clearSig: {
    intent: 'Send',
    interpolatedIntent: 'Transfer 22588 USDT to 0xdac17f958d2ee523a2206206994597c13d831ec7',
    structuredIntent: [
      'Transfer ',
      { value: '22588 USDT', format: 'tokenAmount', rawValue: 22588000000n },
      ' to ',
      {
        value: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        format: 'addressName',
        rawValue: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      },
    ],
    fields: {
      Amount: { value: '22588 USDT', format: 'tokenAmount', rawValue: 22588000000n },
      To: {
        value: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        format: 'addressName',
        rawValue: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      },
    },
  },
};

// Uniswap v2 router contract, but the caller does not know it: it was part of the tx.
export const UNISWAP_SWAP = {
  to: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
  data: '7ff36ab5000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000080000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000106d3c66d22d2dd0446df23d7f5960752994d600',
  amount: 100000000000000000n,
  // User defines other tokens
  customContracts: {
    '0x106d3c66d22d2dd0446df23d7f5960752994d600': { abi: 'ERC20', symbol: 'LABRA', decimals: 9 },
  },
  info: {
    name: 'swapExactETHForTokens',
    signature: 'swapExactETHForTokens(uint256,address[],address,uint256)',
    value: {
      amountOutMin: 12345678901234567891n,
      path: [
        '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        '0x106d3c66d22d2dd0446df23d7f5960752994d600',
      ],
      to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      deadline: 1876543210n,
    },
  },
  clearSig: {
    intent: 'Swap',
    interpolatedIntent:
      'Swap 0.1 ETH for at least 12345678901.234567891 LABRA. Expires at Tue, 19 Jun 2029 06:00:10 GMT',
    structuredIntent: [
      'Swap ',
      { value: '0.1 ETH', format: 'amount', rawValue: 100000000000000000n },
      ' for at least ',
      {
        value: '12345678901.234567891 LABRA',
        format: 'tokenAmount',
        rawValue: 12345678901234567891n,
      },
      '. Expires at ',
      { value: 'Tue, 19 Jun 2029 06:00:10 GMT', format: 'date', rawValue: 1876543210n },
    ],
    fields: {
      'Amount to Send': { value: '0.1 ETH', format: 'amount', rawValue: 100000000000000000n },
      'Minimum to Receive': {
        value: '12345678901.234567891 LABRA',
        format: 'tokenAmount',
        rawValue: 12345678901234567891n,
      },
      Beneficiary: {
        value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        format: 'addressName',
        rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      },
      Deadline: {
        value: 'Tue, 19 Jun 2029 06:00:10 GMT',
        format: 'date',
        rawValue: 1876543210n,
      },
    },
  },
  // Without custom token metadata, display falls back; ABI decoding still works.
  fallbackInfo: {
    name: 'swapExactETHForTokens',
    signature: 'swapExactETHForTokens(uint256,address[],address,uint256)',
    value: {
      amountOutMin: 12345678901234567891n,
      path: [
        '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        '0x106d3c66d22d2dd0446df23d7f5960752994d600',
      ],
      to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      deadline: 1876543210n,
    },
  },
  fallbackClearSig: {
    intent: 'Swap',
    interpolatedIntent:
      'Swap 0.1 ETH for at least 12345678901234567891 ???. Expires at Tue, 19 Jun 2029 06:00:10 GMT',
    structuredIntent: [
      'Swap ',
      { value: '0.1 ETH', format: 'amount', rawValue: 100000000000000000n },
      ' for at least ',
      {
        value: '12345678901234567891 ???',
        format: 'tokenAmount',
        rawValue: 12345678901234567891n,
      },
      '. Expires at ',
      { value: 'Tue, 19 Jun 2029 06:00:10 GMT', format: 'date', rawValue: 1876543210n },
    ],
    fields: {
      'Amount to Send': { value: '0.1 ETH', format: 'amount', rawValue: 100000000000000000n },
      'Minimum to Receive': {
        value: '12345678901234567891 ???',
        format: 'tokenAmount',
        rawValue: 12345678901234567891n,
      },
      Beneficiary: {
        value: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        format: 'addressName',
        rawValue: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      },
      Deadline: {
        value: 'Tue, 19 Jun 2029 06:00:10 GMT',
        format: 'date',
        rawValue: 1876543210n,
      },
    },
  },
};

const FROM_TARGET = '0x0000000000000000000000000000000000001200';

export const CLEARSIG_FROM = {
  target: FROM_TARGET,
  from: '0x2222222222222222222222222222222222222222',
  files: {
    'from.json': {
      context: { contract: { deployments: [{ chainId: 1, address: FROM_TARGET }] } },
      display: {
        formats: {
          'mark(uint256 value)': {
            intent: 'Mark',
            interpolatedIntent: 'Mark {@.from} with {value}',
            fields: [
              { path: '@.from', label: 'From', format: 'raw' },
              { path: 'value', label: 'Value', format: 'raw' },
            ],
          },
        },
      },
    },
  },
  withFrom: {
    intent: 'Mark',
    interpolatedIntent: 'Mark 0x2222222222222222222222222222222222222222 with 7',
    structuredIntent: [
      'Mark ',
      {
        value: '0x2222222222222222222222222222222222222222',
        format: 'raw',
        rawValue: '0x2222222222222222222222222222222222222222',
      },
      ' with ',
      { value: '7', format: 'raw', rawValue: 7n },
    ],
    fields: {
      From: {
        value: '0x2222222222222222222222222222222222222222',
        format: 'raw',
        rawValue: '0x2222222222222222222222222222222222222222',
      },
      Value: { value: '7', format: 'raw', rawValue: 7n },
    },
  },
  noFrom: {
    intent: 'Mark',
    interpolatedIntent: 'Mark',
    fields: {
      Value: { value: '7', format: 'raw', rawValue: 7n },
    },
  },
  signed: {
    intent: 'Mark',
    interpolatedIntent: 'Mark 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A with 7',
    structuredIntent: [
      'Mark ',
      {
        value: '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A',
        format: 'raw',
        rawValue: '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A',
      },
      ' with ',
      { value: '7', format: 'raw', rawValue: 7n },
    ],
    fields: {
      From: {
        value: '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A',
        format: 'raw',
        rawValue: '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A',
      },
      Value: { value: '7', format: 'raw', rawValue: 7n },
    },
  },
};

const CHAIN_TARGET = '0x0000000000000000000000000000000000001300';

export const CLEARSIG_CHAIN = {
  target: CHAIN_TARGET,
  known: '0x0000000000000000000000000000000000001301',
  files: {
    'chain.json': {
      context: { contract: { deployments: [{ chainId: 5, address: CHAIN_TARGET }] } },
      display: {
        formats: {
          'mark(uint256 value)': {
            intent: 'Chain',
            interpolatedIntent: 'Chain {value}',
            fields: [{ path: 'value', label: 'Value', format: 'raw' }],
          },
        },
      },
    },
  },
  clearSig: {
    intent: 'Chain',
    interpolatedIntent: 'Chain 7',
    structuredIntent: ['Chain ', { value: '7', format: 'raw', rawValue: 7n }],
    fields: { Value: { value: '7', format: 'raw', rawValue: 7n } },
  },
};

export const CLEARSIG_GENERIC = {
  target: '0x0000000000000000000000000000000000000104',
  to: '0x0000000000000000000000000000000000000105',
  files: {
    'generic.json': {
      context: { contract: {} },
      display: {
        formats: {
          'transfer(address to,uint256 value)': {
            intent: 'Transfer',
            interpolatedIntent: 'Transfer {value} to {to}',
            fields: [
              { path: 'value', label: 'Value', format: 'raw' },
              { path: 'to', label: 'To', format: 'raw' },
            ],
          },
        },
      },
    },
  },
  info: {
    name: 'transfer',
    signature: 'transfer(address,uint256)',
    value: {
      to: '0x0000000000000000000000000000000000000105',
      value: 9n,
    },
  },
  clearSig: {
    intent: 'Transfer',
    interpolatedIntent: 'Transfer 9 to 0x0000000000000000000000000000000000000105',
    structuredIntent: [
      'Transfer ',
      { value: '9', format: 'raw', rawValue: 9n },
      ' to ',
      {
        value: '0x0000000000000000000000000000000000000105',
        format: 'raw',
        rawValue: '0x0000000000000000000000000000000000000105',
      },
    ],
    fields: {
      Value: { value: '9', format: 'raw', rawValue: 9n },
      To: {
        value: '0x0000000000000000000000000000000000000105',
        format: 'raw',
        rawValue: '0x0000000000000000000000000000000000000105',
      },
    },
  },
};

const FACTORY_ADDRESS = '0x0000000000000000000000000000000000000103';

export const CLEARSIG_FACTORY = {
  target: '0x0000000000000000000000000000000000000102',
  factory: FACTORY_ADDRESS,
  files: {
    'factory.json': {
      context: {
        contract: {
          factory: {
            deployEvent: 'Made(address indexed instance)',
            deployments: [{ chainId: 1, address: FACTORY_ADDRESS }],
          },
        },
      },
      display: {
        formats: {
          'resolve(uint256 value)': {
            intent: 'Resolve',
            interpolatedIntent: 'Resolve {value}',
            fields: [{ path: 'value', label: 'Value', format: 'raw' }],
          },
        },
      },
    },
  },
  info: { name: 'resolve', signature: 'resolve(uint256)', value: 7n },
  clearSig: {
    intent: 'Resolve',
    interpolatedIntent: 'Resolve 7',
    structuredIntent: ['Resolve ', { value: '7', format: 'raw', rawValue: 7n }],
    fields: {
      Value: { value: '7', format: 'raw', rawValue: 7n },
    },
  },
};

// Contract creation transaction: nothing to decode.
export const CREATE_TX =
  '0x02f8500180010182cf0880808260ffc080a0eb34cd1e43ec7a160d1e830eb7252370ef598c904131473d3720bb909b0c14b9a05d626dccdae1507c37adeaf0d3356e5f1831b5a86b445ebdf2c313951fb1b43e';

// Random example from 'https://docs.alchemy.com/reference/eth-gettransactionreceipt'
export const RECEIPT = {
  result: {
    transactionHash: '0x8fc90a6c3ee3001cdcbbb685b4fbe67b1fa2bec575b15b0395fea5540d0901ae',
    blockHash: '0x58a945e1558810523df00490ff28cbe111b37851c44679ce5be1eeaebb4b4907',
    blockNumber: '0xeb8822',
    logs: [
      {
        transactionHash: '0x8fc90a6c3ee3001cdcbbb685b4fbe67b1fa2bec575b15b0395fea5540d0901ae',
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        blockHash: '0x58a945e1558810523df00490ff28cbe111b37851c44679ce5be1eeaebb4b4907',
        blockNumber: '0xeb8822',
        data: '0x000000000000000000000000000000000000000000000000000000001debea42',
        logIndex: '0x6c',
        removed: false,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          '0x0000000000000000000000005067c042e35881843f2b31dfc2db1f4f272ef48c',
          '0x0000000000000000000000003ee18b2214aff97000d974cf647e7c347e8fa585',
        ],
        transactionIndex: '0x4e',
      },
      {
        transactionHash: '0x8fc90a6c3ee3001cdcbbb685b4fbe67b1fa2bec575b15b0395fea5540d0901ae',
        address: '0x98f3c9e6e3face36baad05fe09d375ef1464288b',
        blockHash: '0x58a945e1558810523df00490ff28cbe111b37851c44679ce5be1eeaebb4b4907',
        blockNumber: '0xeb8822',
        data: '0x000000000000000000000000000000000000000000000000000000000001371e000000000000000000000000000000000000000000000000000000006eca00000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000f000000000000000000000000000000000000000000000000000000000000008501000000000000000000000000000000000000000000000000000000001debea42000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000267c46aa713cfe47608dd1c16f8a0325208df084c3cbebf9f366ad0eafc2653e4000100000000000000000000000000000000000000000000000000000000001e8542000000000000000000000000000000000000000000000000000000',
        logIndex: '0x6d',
        removed: false,
        topics: [
          '0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2',
          '0x0000000000000000000000003ee18b2214aff97000d974cf647e7c347e8fa585',
        ],
        transactionIndex: '0x4e',
      },
    ],
    contractAddress: null,
    effectiveGasPrice: '0x2d7003407',
    cumulativeGasUsed: '0x76c649',
    from: '0x5067c042e35881843f2b31dfc2db1f4f272ef48c',
    gasUsed: '0x1a14b',
    logsBloom:
      '0x00000000000100000000008000000000000000000000000000000000000000000010000000000000001000000000000000000000000000000000000000000000000000000000000008008008000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000010000000000000000000000000000000000000000000000000010002000000000000000400000000000400200001000000000000000000000000040000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000',
    status: '0x1',
    to: '0x3ee18b2214aff97000d974cf647e7c347e8fa585',
    transactionIndex: '0x4e',
    type: '0x0',
  },
  expected: [
    {
      // It calls 'transferTokens' @ wormhole bridge, we don't know what it is.
      data: undefined,
      event: {
        name: 'Transfer',
        signature: 'Transfer(address,address,uint256)',
        value: {
          value: 502000194n,
          from: '0x5067c042e35881843f2b31dfc2db1f4f272ef48c',
          to: '0x3ee18b2214aff97000d974cf647e7c347e8fa585',
        },
        hint: 'Transfer 502.000194 USDC from 0x5067c042e35881843f2b31dfc2db1f4f272ef48c to 0x3ee18b2214aff97000d974cf647e7c347e8fa585',
      },
    },
    // this is wormhole abi, we have no idea about it.
    { data: undefined, event: undefined },
  ],
};

export const DECODE_ERROR = {
  // Vectors generated with ethers AbiCoder/Interface
  string:
    '0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001a4e6f7420656e6f7567682045746865722070726f76696465642e000000000000',
  panic: '0x4e487b710000000000000000000000000000000000000000000000000000000000000011',
  custom:
    '0xcf47918100000000000000000000000000000000000000000000000000000000000000070000000000000000000000000000000000000000000000000000000000000009',
};

export const MULTICALL3 = {
  // Vectors generated with ethers Interface
  dai: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  calldata:
    '0x82ad56cb00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000006b175474e89094c44da98b954eedeac495271d0f00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000406fdde03000000000000000000000000000000000000000000000000000000000000000000000000000000006b175474e89094c44da98b954eedeac495271d0f00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000495d89b4100000000000000000000000000000000000000000000000000000000',
  result:
    '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000007000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000',
};

// BAT, but the caller does not know that.
export const DECODE_EVENT_BAT = {
  to: '0x0d8775f648430679a709e98d2b0cb6250d2887ef',
  topics: [
    '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
    '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
    '0x000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564',
  ],
  data: '0x00000000000000000000000000000000000000000000003635c9adc5dea00000',
  expected: {
    name: 'Approval',
    signature: 'Approval(address,address,uint256)',
    value: {
      value: 1000000000000000000000n,
      owner: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      spender: '0xe592427a0aece92de3edee1f18e0157c05861564',
    },
    hint: 'Allow 0xe592427a0aece92de3edee1f18e0157c05861564 spending up to 1000 BAT from 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
  },
};

// WETH ships legacy src/dst/guy/wad argument names.
export const DECODE_EVENT_WETH = [
  {
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x0000000000000000000000001111111111111111111111111111111111111111',
      '0x0000000000000000000000002222222222222222222222222222222222222222',
    ],
    data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
    expected: {
      name: 'Transfer',
      signature: 'Transfer(address,address,uint256)',
      value: {
        wad: 1000000000000000000n,
        src: '0x1111111111111111111111111111111111111111',
        dst: '0x2222222222222222222222222222222222222222',
      },
      hint: 'Transfer 1 WETH from 0x1111111111111111111111111111111111111111 to 0x2222222222222222222222222222222222222222',
    },
  },
  {
    topics: [
      '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
      '0x0000000000000000000000001111111111111111111111111111111111111111',
      '0x0000000000000000000000002222222222222222222222222222222222222222',
    ],
    data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
    expected: {
      name: 'Approval',
      signature: 'Approval(address,address,uint256)',
      value: {
        wad: 1000000000000000000n,
        src: '0x1111111111111111111111111111111111111111',
        guy: '0x2222222222222222222222222222222222222222',
      },
      hint: 'Allow 0x2222222222222222222222222222222222222222 spending up to 1 WETH from 0x1111111111111111111111111111111111111111',
    },
  },
];

export const DECODE_EVENT_ERC20 = {
  to: '0x1111111111111111111111111111111111111111',
  topics: [
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    '0x0000000000000000000000003333333333333333333333333333333333333333',
    '0x0000000000000000000000004444444444444444444444444444444444444444',
  ],
  data: '0x0000000000000000000000000000000000000000000000000000000000000007',
  opt: {
    noDefault: true,
    customContracts: {
      '0x1111111111111111111111111111111111111111': { abi: 'ERC20', decimals: 0, symbol: 'ZERO' },
    },
  },
  expected: {
    name: 'Transfer',
    signature: 'Transfer(address,address,uint256)',
    value: {
      value: 7n,
      from: '0x3333333333333333333333333333333333333333',
      to: '0x4444444444444444444444444444444444444444',
    },
    hint: 'Transfer 7 ZERO from 0x3333333333333333333333333333333333333333 to 0x4444444444444444444444444444444444444444',
  },
};

export const DECODE_EVENT_ERC1155 = {
  to: '0x1111111111111111111111111111111111111111',
  topics: [
    '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
    '0x0000000000000000000000003333333333333333333333333333333333333333',
    '0x0000000000000000000000004444444444444444444444444444444444444444',
    '0x0000000000000000000000005555555555555555555555555555555555555555',
  ],
  data:
    '0x0000000000000000000000000000000000000000000000000000000000000007' +
    '0000000000000000000000000000000000000000000000000000000000000009',
  opt: {
    noDefault: true,
    customContracts: { '0x1111111111111111111111111111111111111111': { abi: 'ERC1155' } },
  },
  expected: {
    name: 'TransferSingle',
    signature: 'TransferSingle(address,address,address,uint256,uint256)',
    value: {
      operator: '0x3333333333333333333333333333333333333333',
      from: '0x4444444444444444444444444444444444444444',
      to: '0x5555555555555555555555555555555555555555',
      id: 7n,
      value: 9n,
    },
  },
};

export const DEPLOY_BYTECODE =
  '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea2646970667358221220116554d4ba29ee08da9e97dc54ff9a2a65d67a648140d616fc225a25ff08c86364736f6c63430008070033';
// Same bytecode with a uint256 constructor argument (69420) appended.
export const DEPLOY_WITH_ARG =
  DEPLOY_BYTECODE + '0000000000000000000000000000000000000000000000000000000000010f2c';

// Cross-checked with ethers.
export const PARSE_ABI_SELECTORS = [
  ['function transferFrom(address from, address to, uint256 value) returns (bool)', '23b872dd'],
  ['function balanceOf(address) view returns (uint256)', '70a08231'],
  ['function deposit() payable', 'd0e30db0'],
  // uint -> uint256 normalization, fixed arrays, data location keywords
  ['function submit(uint[] memory ids, bytes32[4] calldata proofs)', '3c3d01bb'],
  // inline tuple
  [
    'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)',
    '414bf389',
  ],
];
