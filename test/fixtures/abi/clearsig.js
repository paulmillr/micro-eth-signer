// Decoder + ERC-7730 clear-signing vectors for known contracts (USDT, Uniswap V2/V3, Kyber).
const h = (s) => Uint8Array.from(s.match(/../g) || [], (b) => parseInt(b, 16));

const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const LABRA = '0x106d3c66d22d2dd0446df23d7f5960752994d600';
const LAYER = '0x0ff6ffcfda92c53f615a4a75d982f399c989366b';
const PLUTON = '0xd8912c10681d8b21fd3742244f44658dba12264e';
const TRUBIT = '0xf65b5c5104c4fafd4b709d9d60a185eae063276c';
const AAVE = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9';
const ENJ = '0xf629cbd94d3791c9250152bd8dfbdf380e2a3b9c';
const RAE = '0xe5a3229ccb22b6484594973a03a3851dcd948756';
const NIIFI = '0x852e5427c86a3b46dd25e5fe027bb15f53c4bcb8';
const SHIB = '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce';
const AKITA = '0x3301ee63fb29f863f2333bd4466acb46cd8323e6';
const SUSD = '0x57ab1ec28d129707052df4df418d58a2d46d5f51';

// Token metadata the decoder does not ship with.
export const CUSTOM_TOKENS = {
  [LABRA]: { abi: 'ERC20', symbol: 'LABRA', decimals: 9 },
  [LAYER]: { abi: 'ERC20', symbol: 'LAYER', decimals: 18 },
  [PLUTON]: { abi: 'ERC20', symbol: 'PLUTON', decimals: 18 },
  [TRUBIT]: { abi: 'ERC20', symbol: 'TRU', decimals: 18 },
  [AAVE]: { abi: 'ERC20', symbol: 'AAVE', decimals: 18 },
  [ENJ]: { abi: 'ERC20', symbol: 'ENJ', decimals: 18 },
  [RAE]: { abi: 'ERC20', symbol: 'RAE', decimals: 18 },
  [NIIFI]: { abi: 'ERC20', symbol: 'NIIFI', decimals: 15 },
  [SHIB]: { abi: 'ERC20', symbol: 'SHIB', decimals: 18 },
  [AKITA]: { abi: 'ERC20', symbol: 'AKITA', decimals: 18 },
  [SUSD]: { abi: 'ERC20', symbol: 'SUSD', decimals: 18 },
};

// tx hash: 0x6fd66d7b306f77fc01a397f55d4efe19256458badd8782d523d06ed450851d0a
export const DECODER_TRANSFER = {
  data: 'a9059cbb000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec70000000000000000000000000000000000000000000000000000000542598700',
  value: {
    name: 'transfer',
    signature: 'transfer(address,uint256)',
    value: { to: USDT, value: 22588000000n },
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

export const DECODER_UNISWAP_V2 = [
  {
    data: '7ff36ab5000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000080000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000106d3c66d22d2dd0446df23d7f5960752994d600',
    amount: 100000000000000000n,
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
  },
  {
    data: '38ed17390000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000000000000000000000000000ab54a98ceb1f0ad300000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea00000000000000000000000000000000000000000000000000000000000000030000000000000000000000000ff6ffcfda92c53f615a4a75d982f399c989366b000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7',
    amount: 0n,
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap exact 98.765432109876543212 LAYER for at least 12345678901234.567891 USDT. Expires at Tue, 19 Jun 2029 06:00:10 GMT',
      structuredIntent: [
        'Swap exact ',
        {
          value: '98.765432109876543212 LAYER',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        ' for at least ',
        {
          value: '12345678901234.567891 USDT',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        '. Expires at ',
        { value: 'Tue, 19 Jun 2029 06:00:10 GMT', format: 'date', rawValue: 1876543210n },
      ],
      fields: {
        'Amount to Send': {
          value: '98.765432109876543212 LAYER',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        'Minimum to Receive': {
          value: '12345678901234.567891 USDT',
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
  },
  {
    data: '18cbafe50000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000000000000000000000000000ab54a98ceb1f0ad300000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000d8912c10681d8b21fd3742244f44658dba12264e000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    amount: 0n,
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap exact 98.765432109876543212 PLUTON for at least 12.345678901234567891 ETH. Expires at Tue, 19 Jun 2029 06:00:10 GMT',
      structuredIntent: [
        'Swap exact ',
        {
          value: '98.765432109876543212 PLUTON',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        ' for at least ',
        {
          value: '12.345678901234567891 ETH',
          format: 'amount',
          rawValue: 12345678901234567891n,
        },
        '. Expires at ',
        { value: 'Tue, 19 Jun 2029 06:00:10 GMT', format: 'date', rawValue: 1876543210n },
      ],
      fields: {
        'Amount to Send': {
          value: '98.765432109876543212 PLUTON',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        'Minimum to Receive': {
          value: '12.345678901234567891 ETH',
          format: 'amount',
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
  },
  {
    data: 'fb3bdb41000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000080000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000f65b5c5104c4fafd4b709d9d60a185eae063276c',
    amount: 98765432109876543212n,
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap up to 98.765432109876543212 ETH for exact 12.345678901234567891 TRU. Expires at Tue, 19 Jun 2029 06:00:10 GMT',
      structuredIntent: [
        'Swap up to ',
        {
          value: '98.765432109876543212 ETH',
          format: 'amount',
          rawValue: 98765432109876543212n,
        },
        ' for exact ',
        {
          value: '12.345678901234567891 TRU',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        '. Expires at ',
        { value: 'Tue, 19 Jun 2029 06:00:10 GMT', format: 'date', rawValue: 1876543210n },
      ],
      fields: {
        'Maximum to Send': {
          value: '98.765432109876543212 ETH',
          format: 'amount',
          rawValue: 98765432109876543212n,
        },
        'Amount to Receive': {
          value: '12.345678901234567891 TRU',
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
  },
];

export const DECODER_KYBER = [
  {
    data: 'ae591d540000000000000000000000007fc66500c84a76ad7e9c93437bfc5ac33e2ddae90000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000f629cbd94d3791c9250152bd8dfbdf380e2a3b9c000000000000000000000000dc083bf73176bd3ed63907424d26d02571d92b95000000000000000000000000000000000000000000000000ab54a98ceb1f0ad300000000000000000000000000000000000000000000000aef84762139eb8000000000000000000000000000de63aef60307655405835da74ba02ce4db1a42fb000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000000',
    amount: 0n,
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap 98.765432109876543212 AAVE for up to 12.345678901234567891 ENJ to recipient 0xdc083bf73176bd3ed63907424d26d02571d92b95 with platform fee 0.18 %',
      structuredIntent: [
        'Swap ',
        {
          value: '98.765432109876543212 AAVE',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        ' for up to ',
        {
          value: '12.345678901234567891 ENJ',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        ' to recipient ',
        {
          value: '0xdc083bf73176bd3ed63907424d26d02571d92b95',
          format: 'addressName',
          rawValue: '0xdc083bf73176bd3ed63907424d26d02571d92b95',
        },
        ' with platform fee ',
        { value: '0.18 %', format: 'unit', rawValue: 18n },
      ],
      fields: {
        'Amount to Send': {
          value: '98.765432109876543212 AAVE',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        'Maximum to Receive': {
          value: '12.345678901234567891 ENJ',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        'Minimum Conversion Rate': {
          value: '201726490294163832832',
          format: 'raw',
          rawValue: 201726490294163832832n,
        },
        Beneficiary: {
          value: '0xdc083bf73176bd3ed63907424d26d02571d92b95',
          format: 'addressName',
          rawValue: '0xdc083bf73176bd3ed63907424d26d02571d92b95',
        },
        'Platform Fee': { value: '0.18 %', format: 'unit', rawValue: 18n },
        'Platform Wallet': {
          value: '0xde63aef60307655405835da74ba02ce4db1a42fb',
          format: 'addressName',
          rawValue: '0xde63aef60307655405835da74ba02ce4db1a42fb',
        },
      },
    },
  },
  {
    data: 'ae591d54000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000e5a3229ccb22b6484594973a03a3851dcd9487560000000000000000000000004f8f521ce1a74a2fc62ce75db676f56965b7d957000000000000000000000000000000000000000000000000ab54a98ceb1f0ad300000000000000000000000000000000000000000000005ac6d2e744f38f9272000000000000000000000000440bbd6a888a36de6e2f6a25f65bc4e16874faa90000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001aa5241452041505200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000002710',
    amount: 7864074000000000n,
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap 98.765432109876543212 ETH for up to 12.345678901234567891 RAE to recipient 0x4f8f521ce1a74a2fc62ce75db676f56965b7d957 with platform fee 0.08 %',
      structuredIntent: [
        'Swap ',
        {
          value: '98.765432109876543212 ETH',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        ' for up to ',
        {
          value: '12.345678901234567891 RAE',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        ' to recipient ',
        {
          value: '0x4f8f521ce1a74a2fc62ce75db676f56965b7d957',
          format: 'addressName',
          rawValue: '0x4f8f521ce1a74a2fc62ce75db676f56965b7d957',
        },
        ' with platform fee ',
        { value: '0.08 %', format: 'unit', rawValue: 8n },
      ],
      fields: {
        'Amount to Send': {
          value: '98.765432109876543212 ETH',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        'Maximum to Receive': {
          value: '12.345678901234567891 RAE',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        'Minimum Conversion Rate': {
          value: '1674533734281808679538',
          format: 'raw',
          rawValue: 1674533734281808679538n,
        },
        Beneficiary: {
          value: '0x4f8f521ce1a74a2fc62ce75db676f56965b7d957',
          format: 'addressName',
          rawValue: '0x4f8f521ce1a74a2fc62ce75db676f56965b7d957',
        },
        'Platform Fee': { value: '0.08 %', format: 'unit', rawValue: 8n },
        'Platform Wallet': {
          value: '0x440bbd6a888a36de6e2f6a25f65bc4e16874faa9',
          format: 'addressName',
          rawValue: '0x440bbd6a888a36de6e2f6a25f65bc4e16874faa9',
        },
      },
    },
  },
  {
    data: 'ae591d54000000000000000000000000e5a3229ccb22b6484594973a03a3851dcd9487560000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000f2ec13ceda50f54544a209840d8f734706cb8f7c000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000002043a4218e5e6000000000000000000000000440bbd6a888a36de6e2f6a25f65bc4e16874faa90000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001aa5241452041505200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000002710',
    amount: 0n,
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap 98.765432109876543212 RAE for up to 12.345678901234567891 ETH to recipient 0xf2ec13ceda50f54544a209840d8f734706cb8f7c with platform fee 0.08 %',
      structuredIntent: [
        'Swap ',
        {
          value: '98.765432109876543212 RAE',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        ' for up to ',
        {
          value: '12.345678901234567891 ETH',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        ' to recipient ',
        {
          value: '0xf2ec13ceda50f54544a209840d8f734706cb8f7c',
          format: 'addressName',
          rawValue: '0xf2ec13ceda50f54544a209840d8f734706cb8f7c',
        },
        ' with platform fee ',
        { value: '0.08 %', format: 'unit', rawValue: 8n },
      ],
      fields: {
        'Amount to Send': {
          value: '98.765432109876543212 RAE',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        'Maximum to Receive': {
          value: '12.345678901234567891 ETH',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        'Minimum Conversion Rate': {
          value: '567598216963558',
          format: 'raw',
          rawValue: 567598216963558n,
        },
        Beneficiary: {
          value: '0xf2ec13ceda50f54544a209840d8f734706cb8f7c',
          format: 'addressName',
          rawValue: '0xf2ec13ceda50f54544a209840d8f734706cb8f7c',
        },
        'Platform Fee': { value: '0.08 %', format: 'unit', rawValue: 8n },
        'Platform Wallet': {
          value: '0x440bbd6a888a36de6e2f6a25f65bc4e16874faa9',
          format: 'addressName',
          rawValue: '0x440bbd6a888a36de6e2f6a25f65bc4e16874faa9',
        },
      },
    },
  },
];

// Multi-call signature unwrap.
export const DECODER_UNISWAP_V3_MULTICALL = {
  data: 'ac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001c00000000000000000000000000000000000000000000000000000000000000144f28c0498000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000056bc75e2d63100000000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000042852e5427c86a3b46dd25e5fe027bb15f53c4bcb8000bb8dac17f958d2ee523a2206206994597c13d831ec7000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000412210e8a00000000000000000000000000000000000000000000000000000000',
  amount: 4308416152274164000n,
  decoded: {
    name: 'multicall(exactOutput, refundETH)',
    signature: 'multicall(exactOutput((bytes,address,uint256,uint256,uint256)), refundETH())',
    value: [
      {
        path: h(
          '852e5427c86a3b46dd25e5fe027bb15f53c4bcb8000bb8dac17f958d2ee523a2206206994597c13d831ec7000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
        ),
        recipient: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        deadline: 1876543210n,
        amountOut: 100000000000000000000n,
        amountInMaximum: 12345678901234567891n,
      },
      undefined,
    ],
  },
  clearSig: {
    intent: 'Execute',
    interpolatedIntent:
      'Execute Swap up to 12.345678901234567891 WETH for exact 100000 NIIFI. Expires at Tue, 19 Jun 2029 06:00:10 GMT, Refund ETH',
    structuredIntent: [
      'Execute ',
      {
        value:
          'Swap up to 12.345678901234567891 WETH for exact 100000 NIIFI. Expires at Tue, 19 Jun 2029 06:00:10 GMT',
        format: 'calldata',
        rawValue: h(
          'f28c0498000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000056bc75e2d63100000000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000042852e5427c86a3b46dd25e5fe027bb15f53c4bcb8000bb8dac17f958d2ee523a2206206994597c13d831ec7000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000000000000000'
        ),
      },
      ', ',
      { value: 'Refund ETH', format: 'calldata', rawValue: h('12210e8a') },
    ],
    fields: {
      Call: {
        value:
          'Swap up to 12.345678901234567891 WETH for exact 100000 NIIFI. Expires at Tue, 19 Jun 2029 06:00:10 GMT',
        format: 'calldata',
        rawValue: h(
          'f28c0498000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000056bc75e2d63100000000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000042852e5427c86a3b46dd25e5fe027bb15f53c4bcb8000bb8dac17f958d2ee523a2206206994597c13d831ec7000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000000000000000'
        ),
      },
      'Call 2': { value: 'Refund ETH', format: 'calldata', rawValue: h('12210e8a') },
    },
  },
};

export const DECODER_UNISWAP_V3 = [
  {
    data: '414bf389000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000095ad61b0a150d79219dcf64e1e6cc01f0b64c4ce0000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000000',
    amount: 12345678901234567891n,
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap exact 98.765432109876543212 WETH for at least 12.345678901234567891 SHIB. Expires at Tue, 19 Jun 2029 06:00:10 GMT',
      structuredIntent: [
        'Swap exact ',
        {
          value: '98.765432109876543212 WETH',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        ' for at least ',
        {
          value: '12.345678901234567891 SHIB',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        '. Expires at ',
        { value: 'Tue, 19 Jun 2029 06:00:10 GMT', format: 'date', rawValue: 1876543210n },
      ],
      fields: {
        'Amount to Send': {
          value: '98.765432109876543212 WETH',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        'Minimum to Receive': {
          value: '12.345678901234567891 SHIB',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        'Uniswap Fee': { value: '0.3 %', format: 'unit', rawValue: 3000n },
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
  },
  {
    data: '414bf389000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000003301ee63fb29f863f2333bd4466acb46cd8323e60000000000000000000000000000000000000000000000000000000000002710000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000000',
    amount: 40000000000000000n,
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap exact 98.765432109876543212 WETH for at least 12.345678901234567891 AKITA. Expires at Tue, 19 Jun 2029 06:00:10 GMT',
      structuredIntent: [
        'Swap exact ',
        {
          value: '98.765432109876543212 WETH',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        ' for at least ',
        {
          value: '12.345678901234567891 AKITA',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        '. Expires at ',
        { value: 'Tue, 19 Jun 2029 06:00:10 GMT', format: 'date', rawValue: 1876543210n },
      ],
      fields: {
        'Amount to Send': {
          value: '98.765432109876543212 WETH',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        'Minimum to Receive': {
          value: '12.345678901234567891 AKITA',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        'Uniswap Fee': { value: '1 %', format: 'unit', rawValue: 10000n },
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
  },
  {
    data: '414bf389000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000000',
    amount: 0n,
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap exact 98.765432109876543212 WETH for at least 12345678901234.567891 USDC. Expires at Tue, 19 Jun 2029 06:00:10 GMT',
      structuredIntent: [
        'Swap exact ',
        {
          value: '98.765432109876543212 WETH',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        ' for at least ',
        {
          value: '12345678901234.567891 USDC',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        '. Expires at ',
        { value: 'Tue, 19 Jun 2029 06:00:10 GMT', format: 'date', rawValue: 1876543210n },
      ],
      fields: {
        'Amount to Send': {
          value: '98.765432109876543212 WETH',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        'Minimum to Receive': {
          value: '12345678901234.567891 USDC',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        'Uniswap Fee': { value: '0.05 %', format: 'unit', rawValue: 500n },
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
  },
  {
    data: 'c04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000042dac17f958d2ee523a2206206994597c13d831ec70001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480001f457ab1ec28d129707052df4df418d58a2d46d5f51000000000000000000000000000000000000000000000000000000000000',
    amount: 0n,
    clearSig: {
      intent: 'Swap',
      interpolatedIntent:
        'Swap exact 98765432109876.543212 USDT for at least 12.345678901234567891 SUSD. Expires at Tue, 19 Jun 2029 06:00:10 GMT',
      structuredIntent: [
        'Swap exact ',
        {
          value: '98765432109876.543212 USDT',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        ' for at least ',
        {
          value: '12.345678901234567891 SUSD',
          format: 'tokenAmount',
          rawValue: 12345678901234567891n,
        },
        '. Expires at ',
        { value: 'Tue, 19 Jun 2029 06:00:10 GMT', format: 'date', rawValue: 1876543210n },
      ],
      fields: {
        'Amount to Send': {
          value: '98765432109876.543212 USDT',
          format: 'tokenAmount',
          rawValue: 98765432109876543212n,
        },
        'Minimum to Receive': {
          value: '12.345678901234567891 SUSD',
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
  },
];
