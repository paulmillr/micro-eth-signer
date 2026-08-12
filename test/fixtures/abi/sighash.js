// Function/event signature-hash vectors, plus the Solidity ABI-spec example contract.

export const TUPLE_ABI = [
  {
    name: 'f',
    type: 'function',
    inputs: [
      {
        name: 's',
        type: 'tuple',
        components: [
          {
            name: 'a',
            type: 'uint256',
          },
          {
            name: 'b',
            type: 'uint256[]',
          },
          {
            name: 'c',
            type: 'tuple[]',
            components: [
              {
                name: 'x',
                type: 'uint256',
              },
              {
                name: 'y',
                type: 'uint256',
              },
            ],
          },
        ],
      },
      {
        name: 't',
        type: 'tuple',
        components: [
          {
            name: 'x',
            type: 'uint256',
          },
          {
            name: 'y',
            type: 'uint256',
          },
        ],
      },
      {
        name: 'a',
        type: 'uint256',
      },
    ],
    outputs: [],
  },
];

export const EV_SIGHASH = [
  [
    '8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          name: 'owner',
          type: 'address',
        },
        {
          indexed: true,
          name: 'spender',
          type: 'address',
        },
        {
          indexed: false,
          name: 'value',
          type: 'uint256',
        },
      ],
      name: 'Approval',
      type: 'event',
    },
  ],
  [
    'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          name: 'from',
          type: 'address',
        },
        {
          indexed: true,
          name: 'to',
          type: 'address',
        },
        {
          indexed: false,
          name: 'value',
          type: 'uint256',
        },
      ],
      name: 'Transfer',
      type: 'event',
    },
  ],
];

export const FN_SIGHASH = [
  [
    '24ee0097',
    {
      name: 'myMethod',
      type: 'function',
      inputs: [
        {
          type: 'uint256',
          name: 'myNumber',
        },
        {
          type: 'string',
          name: 'myString',
        },
      ],
    },
  ],
  [
    '27b00c93',
    {
      name: 'myMethod',
      type: 'function',
      inputs: [
        {
          type: 'string',
          name: 'myNumber',
        },
        {
          type: 'bytes8',
          name: 'myString',
        },
      ],
    },
  ],
  [
    '724ff7a1',
    {
      name: 'Somthing',
      type: 'function',
      inputs: [
        {
          type: 'uint16',
          name: 'myNumber',
        },
        {
          type: 'bytes',
          name: 'myString',
        },
      ],
    },
  ],
  [
    'a7a0d537',
    {
      name: 'something',
      type: 'function',
      inputs: [],
    },
  ],
  [
    '04d36f08',
    {
      name: 'create',
      type: 'function',
      inputs: [
        {
          name: 'tokenId',
          type: 'uint256',
        },
        {
          name: 'itemOwner',
          type: 'address',
        },
        {
          name: 'keys',
          type: 'bytes32[]',
        },
        {
          name: 'values',
          type: 'bytes32[]',
        },
      ],
    },
  ],
];

// FROM SPEC: https://docs.soliditylang.org/en/develop/abi-spec.html#argument-encoding
export const SPEC_CONTRACT = [
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
      {
        internalType: 'uint32[]',
        name: '',
        type: 'uint32[]',
      },
      {
        internalType: 'bytes10',
        name: '',
        type: 'bytes10',
      },
      {
        internalType: 'string',
        name: '',
        type: 'string',
      },
    ],
    name: 'd',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256[][]',
        name: '',
        type: 'uint256[][]',
      },
      {
        internalType: 'string[]',
        name: '',
        type: 'string[]',
      },
    ],
    name: 'g',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes3[2]',
        name: '',
        type: 'bytes3[2]',
      },
    ],
    name: 'bar',
    outputs: [],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint32',
        name: 'x',
        type: 'uint32',
      },
      {
        internalType: 'bool',
        name: 'y',
        type: 'bool',
      },
    ],
    name: 'baz',
    outputs: [
      {
        internalType: 'bool',
        name: 'r',
        type: 'bool',
      },
    ],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [],
    name: 'f',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: 'uint256',
            name: 'a',
            type: 'uint256',
          },
          {
            internalType: 'uint256[]',
            name: 'b',
            type: 'uint256[]',
          },
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct Foo.T[]',
            name: 'c',
            type: 'tuple[]',
          },
        ],
        internalType: 'struct Foo.S',
        name: '',
        type: 'tuple',
      },
      {
        components: [
          {
            internalType: 'uint256',
            name: 'x',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'y',
            type: 'uint256',
          },
        ],
        internalType: 'struct Foo.T',
        name: '',
        type: 'tuple',
      },
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    name: 'f',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: '',
        type: 'bytes',
      },
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
      {
        internalType: 'uint256[]',
        name: '',
        type: 'uint256[]',
      },
    ],
    name: 'sam',
    outputs: [],
    stateMutability: 'pure',
    type: 'function',
  },
];
