// Clear-signing hint regressions: zero-decimal / zero-value token metadata and
// legacy WETH field names. `fn` + `args` are fed to the contract's encodeInput.
const h = (s) => Uint8Array.from(s.match(/../g) || [], (b) => parseInt(b, 16));

const ZERO_IN = '0x1111111111111111111111111111111111111111';
const ZERO_OUT = '0x2222222222222222222222222222222222222222';
const MID = '0x3333333333333333333333333333333333333333';
const BENEFICIARY = '0x4444444444444444444444444444444444444444';
const GUY = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
const SRC = '0x000000000000000000000000000000000000000f';

export const WETH_LEGACY = [
  {
    fn: 'approve',
    args: { guy: GUY, wad: 7n },
    opt: {},
    clearSig: {
      intent: 'Approve',
      interpolatedIntent:
        'Allow spending 0.000000000000000007 WETH by 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      structuredIntent: [
        'Allow spending ',
        { value: '0.000000000000000007 WETH', format: 'tokenAmount', rawValue: 7n },
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
        Amount: {
          value: '0.000000000000000007 WETH',
          format: 'tokenAmount',
          rawValue: 7n,
        },
      },
    },
  },
  {
    fn: 'transferFrom',
    args: { src: SRC, dst: GUY, wad: 7n },
    opt: {},
    clearSig: {
      intent: 'Transfer',
      interpolatedIntent:
        'Transfer 0.000000000000000007 WETH from 0x000000000000000000000000000000000000000f to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      structuredIntent: [
        'Transfer ',
        { value: '0.000000000000000007 WETH', format: 'tokenAmount', rawValue: 7n },
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
        Amount: {
          value: '0.000000000000000007 WETH',
          format: 'tokenAmount',
          rawValue: 7n,
        },
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
    },
  },
];

export const UNISWAP_V2_HINTS = [
  {
    fn: 'swapExactTokensForTokens',
    args: {
      amountIn: 7n,
      amountOutMin: 9n,
      path: [ZERO_IN, MID, ZERO_OUT],
      to: BENEFICIARY,
      deadline: 0n,
    },
    opt: {
      amount: 0n,
      contracts: {
        [ZERO_IN]: { abi: 'ERC20', decimals: 0, symbol: 'ZIN' },
        [ZERO_OUT]: { abi: 'ERC20', decimals: 0, symbol: 'ZOUT' },
        [MID]: { abi: 'ERC20', decimals: 18, symbol: 'MID' },
      },
    },
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap exact 7 ZIN for at least 9 ZOUT. Expires at Thu, 01 Jan 1970 00:00:00 GMT',
      structuredIntent: [
        'Swap exact ',
        { value: '7 ZIN', format: 'tokenAmount', rawValue: 7n },
        ' for at least ',
        { value: '9 ZOUT', format: 'tokenAmount', rawValue: 9n },
        '. Expires at ',
        { value: 'Thu, 01 Jan 1970 00:00:00 GMT', format: 'date', rawValue: 0n },
      ],
      fields: {
        'Amount to Send': { value: '7 ZIN', format: 'tokenAmount', rawValue: 7n },
        'Minimum to Receive': { value: '9 ZOUT', format: 'tokenAmount', rawValue: 9n },
        Beneficiary: {
          value: '0x4444444444444444444444444444444444444444',
          format: 'addressName',
          rawValue: '0x4444444444444444444444444444444444444444',
        },
        Deadline: {
          value: 'Thu, 01 Jan 1970 00:00:00 GMT',
          format: 'date',
          rawValue: 0n,
        },
      },
    },
  },
  {
    fn: 'swapETHForExactTokens',
    args: { amountOut: 9000000000000000000n, path: [MID, ZERO_OUT], to: BENEFICIARY, deadline: 0n },
    opt: {
      amount: 0n,
      contracts: {
        [ZERO_OUT]: { abi: 'ERC20', decimals: 18, symbol: 'TOK' },
        [MID]: { abi: 'ERC20', decimals: 18, symbol: 'MID' },
      },
    },
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap up to 0 ETH for exact 9 TOK. Expires at Thu, 01 Jan 1970 00:00:00 GMT',
      structuredIntent: [
        'Swap up to ',
        { value: '0 ETH', format: 'amount', rawValue: 0n },
        ' for exact ',
        { value: '9 TOK', format: 'tokenAmount', rawValue: 9000000000000000000n },
        '. Expires at ',
        { value: 'Thu, 01 Jan 1970 00:00:00 GMT', format: 'date', rawValue: 0n },
      ],
      fields: {
        'Maximum to Send': { value: '0 ETH', format: 'amount', rawValue: 0n },
        'Amount to Receive': {
          value: '9 TOK',
          format: 'tokenAmount',
          rawValue: 9000000000000000000n,
        },
        Beneficiary: {
          value: '0x4444444444444444444444444444444444444444',
          format: 'addressName',
          rawValue: '0x4444444444444444444444444444444444444444',
        },
        Deadline: {
          value: 'Thu, 01 Jan 1970 00:00:00 GMT',
          format: 'date',
          rawValue: 0n,
        },
      },
    },
  },
  {
    fn: 'swapExactETHForTokens',
    args: {
      amountOutMin: 9000000000000000000n,
      path: [MID, ZERO_OUT],
      to: BENEFICIARY,
      deadline: 0n,
    },
    opt: {
      amount: 0n,
      contracts: {
        [ZERO_OUT]: { abi: 'ERC20', decimals: 18, symbol: 'TOK' },
        [MID]: { abi: 'ERC20', decimals: 18, symbol: 'MID' },
      },
    },
    clearSig: {
      intent: 'Swap',
      interpolatedIntent: 'Swap 0 ETH for at least 9 TOK. Expires at Thu, 01 Jan 1970 00:00:00 GMT',
      structuredIntent: [
        'Swap ',
        { value: '0 ETH', format: 'amount', rawValue: 0n },
        ' for at least ',
        { value: '9 TOK', format: 'tokenAmount', rawValue: 9000000000000000000n },
        '. Expires at ',
        { value: 'Thu, 01 Jan 1970 00:00:00 GMT', format: 'date', rawValue: 0n },
      ],
      fields: {
        'Amount to Send': { value: '0 ETH', format: 'amount', rawValue: 0n },
        'Minimum to Receive': {
          value: '9 TOK',
          format: 'tokenAmount',
          rawValue: 9000000000000000000n,
        },
        Beneficiary: {
          value: '0x4444444444444444444444444444444444444444',
          format: 'addressName',
          rawValue: '0x4444444444444444444444444444444444444444',
        },
        Deadline: {
          value: 'Thu, 01 Jan 1970 00:00:00 GMT',
          format: 'date',
          rawValue: 0n,
        },
      },
    },
  },
  {
    fn: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
    args: {
      amountOutMin: 9000000000000000000n,
      path: [MID, ZERO_OUT],
      to: BENEFICIARY,
      deadline: 0n,
    },
    opt: {
      amount: 0n,
      contracts: {
        [ZERO_OUT]: { abi: 'ERC20', decimals: 18, symbol: 'TOK' },
        [MID]: { abi: 'ERC20', decimals: 18, symbol: 'MID' },
      },
    },
    clearSig: {
      intent: 'Swap',
      interpolatedIntent: 'Swap 0 ETH for at least 9 TOK. Expires at Thu, 01 Jan 1970 00:00:00 GMT',
      structuredIntent: [
        'Swap ',
        { value: '0 ETH', format: 'amount', rawValue: 0n },
        ' for at least ',
        { value: '9 TOK', format: 'tokenAmount', rawValue: 9000000000000000000n },
        '. Expires at ',
        { value: 'Thu, 01 Jan 1970 00:00:00 GMT', format: 'date', rawValue: 0n },
      ],
      fields: {
        'Amount to Send': { value: '0 ETH', format: 'amount', rawValue: 0n },
        'Minimum to Receive': {
          value: '9 TOK',
          format: 'tokenAmount',
          rawValue: 9000000000000000000n,
        },
        Beneficiary: {
          value: '0x4444444444444444444444444444444444444444',
          format: 'addressName',
          rawValue: '0x4444444444444444444444444444444444444444',
        },
        Deadline: {
          value: 'Thu, 01 Jan 1970 00:00:00 GMT',
          format: 'date',
          rawValue: 0n,
        },
      },
    },
  },
];

const UNISWAP_V3_OPT = {
  contracts: {
    [ZERO_IN]: { abi: 'ERC20', decimals: 0, symbol: 'ZIN' },
    [ZERO_OUT]: { abi: 'ERC20', decimals: 0, symbol: 'ZOUT' },
  },
};

export const UNISWAP_V3_HINTS = [
  {
    fn: 'exactInputSingle',
    args: {
      tokenIn: ZERO_IN,
      tokenOut: ZERO_OUT,
      fee: 3000,
      recipient: BENEFICIARY,
      deadline: 0n,
      amountIn: 7n,
      amountOutMinimum: 9n,
      sqrtPriceLimitX96: 0n,
    },
    opt: UNISWAP_V3_OPT,
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap exact 7 ZIN for at least 9 ZOUT. Expires at Thu, 01 Jan 1970 00:00:00 GMT',
      structuredIntent: [
        'Swap exact ',
        { value: '7 ZIN', format: 'tokenAmount', rawValue: 7n },
        ' for at least ',
        { value: '9 ZOUT', format: 'tokenAmount', rawValue: 9n },
        '. Expires at ',
        { value: 'Thu, 01 Jan 1970 00:00:00 GMT', format: 'date', rawValue: 0n },
      ],
      fields: {
        'Amount to Send': { value: '7 ZIN', format: 'tokenAmount', rawValue: 7n },
        'Minimum to Receive': { value: '9 ZOUT', format: 'tokenAmount', rawValue: 9n },
        'Uniswap Fee': { value: '0.3 %', format: 'unit', rawValue: 3000n },
        Beneficiary: {
          value: '0x4444444444444444444444444444444444444444',
          format: 'addressName',
          rawValue: '0x4444444444444444444444444444444444444444',
        },
        Deadline: {
          value: 'Thu, 01 Jan 1970 00:00:00 GMT',
          format: 'date',
          rawValue: 0n,
        },
      },
    },
  },
  {
    fn: 'exactInput',
    args: {
      path: h(ZERO_IN.slice(2) + '000bb8' + ZERO_OUT.slice(2)),
      recipient: BENEFICIARY,
      deadline: 0n,
      amountIn: 7n,
      amountOutMinimum: 9n,
    },
    opt: UNISWAP_V3_OPT,
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap exact 7 ZIN for at least 9 ZOUT. Expires at Thu, 01 Jan 1970 00:00:00 GMT',
      structuredIntent: [
        'Swap exact ',
        { value: '7 ZIN', format: 'tokenAmount', rawValue: 7n },
        ' for at least ',
        { value: '9 ZOUT', format: 'tokenAmount', rawValue: 9n },
        '. Expires at ',
        { value: 'Thu, 01 Jan 1970 00:00:00 GMT', format: 'date', rawValue: 0n },
      ],
      fields: {
        'Amount to Send': { value: '7 ZIN', format: 'tokenAmount', rawValue: 7n },
        'Minimum to Receive': { value: '9 ZOUT', format: 'tokenAmount', rawValue: 9n },
        Beneficiary: {
          value: '0x4444444444444444444444444444444444444444',
          format: 'addressName',
          rawValue: '0x4444444444444444444444444444444444444444',
        },
        Deadline: {
          value: 'Thu, 01 Jan 1970 00:00:00 GMT',
          format: 'date',
          rawValue: 0n,
        },
      },
    },
  },
];

// ERC-7730 has no calculated-field arithmetic here, so this preserves the old
// zero-decimal metadata coverage but not the removed hint's derived fee amount.
export const KYBER_HINTS = [
  {
    fn: 'tradeWithHintAndFee',
    args: {
      src: ZERO_IN,
      srcAmount: 7n,
      dest: ZERO_OUT,
      destAddress: BENEFICIARY,
      maxDestAmount: 9n,
      minConversionRate: 1000000000000000000n,
      platformWallet: MID,
      platformFeeBps: 100n,
      hint: h(''),
    },
    opt: {
      contracts: {
        [ZERO_IN]: { abi: 'ERC20', decimals: 0, symbol: 'ZSRC' },
        [ZERO_OUT]: { abi: 'ERC20', decimals: 0, symbol: 'ZDST' },
      },
    },
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap 7 ZSRC for up to 9 ZDST to recipient 0x4444444444444444444444444444444444444444 with platform fee 1 %',
      structuredIntent: [
        'Swap ',
        { value: '7 ZSRC', format: 'tokenAmount', rawValue: 7n },
        ' for up to ',
        { value: '9 ZDST', format: 'tokenAmount', rawValue: 9n },
        ' to recipient ',
        {
          value: '0x4444444444444444444444444444444444444444',
          format: 'addressName',
          rawValue: '0x4444444444444444444444444444444444444444',
        },
        ' with platform fee ',
        { value: '1 %', format: 'unit', rawValue: 100n },
      ],
      fields: {
        'Amount to Send': { value: '7 ZSRC', format: 'tokenAmount', rawValue: 7n },
        'Maximum to Receive': { value: '9 ZDST', format: 'tokenAmount', rawValue: 9n },
        'Minimum Conversion Rate': {
          value: '1000000000000000000',
          format: 'raw',
          rawValue: 1000000000000000000n,
        },
        Beneficiary: {
          value: '0x4444444444444444444444444444444444444444',
          format: 'addressName',
          rawValue: '0x4444444444444444444444444444444444444444',
        },
        'Platform Fee': { value: '1 %', format: 'unit', rawValue: 100n },
        'Platform Wallet': {
          value: '0x3333333333333333333333333333333333333333',
          format: 'addressName',
          rawValue: '0x3333333333333333333333333333333333333333',
        },
      },
    },
  },
];
