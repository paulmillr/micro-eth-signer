// ABI event decode/topics vectors. Based on ethers.js test cases (MIT licensed).
const h = (s) => Uint8Array.from(s.match(/../g) || [], (b) => parseInt(b, 16));

export const ABI_EVENTS = {
  transfer: {
    data: '0x000000000000000000000000000000000000000000000000000000003b9aca00',
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x00000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
      '0x0000000000000000000000002e20d41bb097b9c625c873bc74f063861c14e10b',
    ],
    fn: 'Transfer',
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"name":"from","type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Transfer","type":"event"}]',
    decodeOutput: {
      from: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
      to: '0x2e20d41bb097b9c625c873bc74f063861c14e10b',
      value: 1000000000n,
    },
    topicsInput: {
      from: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
      to: '0x2e20d41bb097b9c625c873bc74f063861c14e10b',
      value: 1000000000n,
    },
  },
  transfer_unnamed1: {
    data: '0x000000000000000000000000000000000000000000000000000000003b9aca00',
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x00000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
      '0x0000000000000000000000002e20d41bb097b9c625c873bc74f063861c14e10b',
    ],
    fn: 'Transfer',
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":false,"name":"value","type":"uint256"}],"name":"Transfer","type":"event"}]',
    decodeOutput: [
      '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
      '0x2e20d41bb097b9c625c873bc74f063861c14e10b',
      1000000000n,
    ],
    topicsInput: [
      '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
      '0x2e20d41bb097b9c625c873bc74f063861c14e10b',
      1000000000n,
    ],
  },
  transfer_unnamed2: {
    data: '0x000000000000000000000000000000000000000000000000000000003b9aca00',
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x00000000000000000000000088e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
      '0x0000000000000000000000002e20d41bb097b9c625c873bc74f063861c14e10b',
    ],
    fn: 'Transfer',
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":false,"type":"uint256"}],"name":"Transfer","type":"event"}]',
    decodeOutput: [
      '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
      '0x2e20d41bb097b9c625c873bc74f063861c14e10b',
      1000000000n,
    ],
    topicsInput: [
      '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
      '0x2e20d41bb097b9c625c873bc74f063861c14e10b',
      1000000000n,
    ],
  },
  simple1: {
    data: '0x0000000000000000000000000123456789012345678901234567890123456789',
    topics: ['0x2f5b0995274d6e666f9673d35e391cc76e98498ebd9200c9d53ec6251a255137'],
    abi: '[{"anonymous":false,"inputs":[{"indexed":false,"name":"p0","type":"address"}],"name":"testEvent","type":"event"}]',
    decodeOutput: { p0: '0x0123456789012345678901234567890123456789' },
    topicsInput: { p0: '0x0123456789012345678901234567890123456789' },
  },
  simple1_unnamed: {
    data: '0x0000000000000000000000000123456789012345678901234567890123456789',
    topics: ['0x2f5b0995274d6e666f9673d35e391cc76e98498ebd9200c9d53ec6251a255137'],
    abi: '[{"anonymous":false,"inputs":[{"indexed":false,"type":"address"}],"name":"testEvent","type":"event"}]',
    decodeOutput: ['0x0123456789012345678901234567890123456789'],
    topicsInput: ['0x0123456789012345678901234567890123456789'],
  },
  simple2: {
    data: '0x',
    topics: [
      '0x2f5b0995274d6e666f9673d35e391cc76e98498ebd9200c9d53ec6251a255137',
      '0x0000000000000000000000000123456789012345678901234567890123456789',
    ],
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"name":"p0","type":"address"}],"name":"testEvent","type":"event"}]',
    decodeOutput: { p0: '0x0123456789012345678901234567890123456789' },
    topicsInput: { p0: '0x0123456789012345678901234567890123456789' },
  },
  simple2_unnamed: {
    data: '0x',
    topics: [
      '0x2f5b0995274d6e666f9673d35e391cc76e98498ebd9200c9d53ec6251a255137',
      '0x0000000000000000000000000123456789012345678901234567890123456789',
    ],
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"type":"address"}],"name":"testEvent","type":"event"}]',
    decodeOutput: ['0x0123456789012345678901234567890123456789'],
    topicsInput: ['0x0123456789012345678901234567890123456789'],
  },
  simple3: {
    data: '0x0000000000000000000000000123456789012345678901234567890123456789',
    topics: [],
    abi: '[{"anonymous":true,"inputs":[{"indexed":false,"name":"p0","type":"address"}],"name":"testEvent","type":"event"}]',
    decodeOutput: { p0: '0x0123456789012345678901234567890123456789' },
    topicsInput: { p0: '0x0123456789012345678901234567890123456789' },
  },
  simple3_unnamed: {
    data: '0x0000000000000000000000000123456789012345678901234567890123456789',
    topics: [],
    abi: '[{"anonymous":true,"inputs":[{"indexed":false,"type":"address"}],"name":"testEvent","type":"event"}]',
    decodeOutput: ['0x0123456789012345678901234567890123456789'],
    topicsInput: ['0x0123456789012345678901234567890123456789'],
  },
  simple4: {
    data: '0x',
    topics: ['0x0000000000000000000000000123456789012345678901234567890123456789'],
    abi: '[{"anonymous":true,"inputs":[{"indexed":true,"name":"p0","type":"address"}],"name":"testEvent","type":"event"}]',
    decodeOutput: { p0: '0x0123456789012345678901234567890123456789' },
    topicsInput: { p0: '0x0123456789012345678901234567890123456789' },
  },
  simple4_unnamed: {
    data: '0x',
    topics: ['0x0000000000000000000000000123456789012345678901234567890123456789'],
    abi: '[{"anonymous":true,"inputs":[{"indexed":true,"type":"address"}],"name":"testEvent","type":"event"}]',
    decodeOutput: ['0x0123456789012345678901234567890123456789'],
    topicsInput: ['0x0123456789012345678901234567890123456789'],
  },
  mixed: {
    data: '0x0000000000000000000000000000000000000000000000000000000000005678',
    topics: [
      '0xc936f634b321af770b9973f248164ad915cf7adf254864edf3ba29c50da878bd',
      '0x0000000000000000000000000000000000000000000000000000000000000123',
      '0x0000000000000000000000000000000000000000000000000000000000009012',
      '0x0000000000000000000000000000000000000000000000000000000000003456',
    ],
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"name":"p0","type":"uint256"},{"indexed":false,"name":"p1","type":"uint256"},{"indexed":true,"name":"p2","type":"uint256"},{"indexed":true,"name":"p3","type":"uint256"}],"name":"testEvent","type":"event"}]',
    decodeOutput: { p0: 0x0123n, p1: 0x5678n, p2: 0x9012n, p3: 0x3456n },
    topicsInput: { p0: 0x0123n, p1: 0x5678n, p2: 0x9012n, p3: 0x3456n },
  },
  mixed_unnamed: {
    data: '0x0000000000000000000000000000000000000000000000000000000000005678',
    topics: [
      '0xc936f634b321af770b9973f248164ad915cf7adf254864edf3ba29c50da878bd',
      '0x0000000000000000000000000000000000000000000000000000000000000123',
      '0x0000000000000000000000000000000000000000000000000000000000009012',
      '0x0000000000000000000000000000000000000000000000000000000000003456',
    ],
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"type":"uint256"},{"indexed":false,"name":"p1","type":"uint256"},{"indexed":true,"name":"p2","type":"uint256"},{"indexed":true,"name":"p3","type":"uint256"}],"name":"testEvent","type":"event"}]',
    decodeOutput: [0x0123n, 0x5678n, 0x9012n, 0x3456n],
    topicsInput: [0x0123n, 0x5678n, 0x9012n, 0x3456n],
  },
  string: {
    data: '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b48656c6c6f20576f726c64000000000000000000000000000000000000000000',
    topics: ['0x4c2aaf95bd72b0b4730a09397fa14d7c339e8b90471d39e1ec89baed0628ed24'],
    abi: '[{"anonymous":false,"inputs":[{"indexed":false,"name":"p0","type":"string"}],"name":"testEvent","type":"event"}]',
    decodeOutput: { p0: 'Hello World' },
    topicsInput: { p0: 'Hello World' },
  },
  string_unnamed: {
    data: '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b48656c6c6f20576f726c64000000000000000000000000000000000000000000',
    topics: ['0x4c2aaf95bd72b0b4730a09397fa14d7c339e8b90471d39e1ec89baed0628ed24'],
    abi: '[{"anonymous":false,"inputs":[{"indexed":false,"type":"string"}],"name":"testEvent","type":"event"}]',
    decodeOutput: ['Hello World'],
    topicsInput: ['Hello World'],
  },
  string_indexed: {
    data: '0x',
    topics: [
      '0x4c2aaf95bd72b0b4730a09397fa14d7c339e8b90471d39e1ec89baed0628ed24',
      '0x592fa743889fc7f92ac2a37bb1f5ba1daf2a5c84741ca0e0061d243a2e6707ba',
    ],
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"name":"p0","type":"string"}],"name":"testEvent","type":"event"}]',
    decodeOutput: { p0: '0x592fa743889fc7f92ac2a37bb1f5ba1daf2a5c84741ca0e0061d243a2e6707ba' },
    topicsInput: { p0: 'Hello World' },
  },
  string_indexed_unnamed: {
    data: '0x',
    topics: [
      '0x4c2aaf95bd72b0b4730a09397fa14d7c339e8b90471d39e1ec89baed0628ed24',
      '0x592fa743889fc7f92ac2a37bb1f5ba1daf2a5c84741ca0e0061d243a2e6707ba',
    ],
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"type":"string"}],"name":"testEvent","type":"event"}]',
    decodeOutput: ['0x592fa743889fc7f92ac2a37bb1f5ba1daf2a5c84741ca0e0061d243a2e6707ba'],
    topicsInput: ['Hello World'],
  },
  bytes: {
    data: '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000033141590000000000000000000000000000000000000000000000000000000000',
    topics: ['0x2ce5127ffbcf8acfb18ee9becb119aaa6d5e46218a20b766ce68378e63713408'],
    abi: '[{"anonymous":false,"inputs":[{"indexed":false,"type":"bytes"}],"name":"testEvent","type":"event"}]',
    decodeOutput: [h('314159')],
    topicsInput: [h('314159')],
  },
  bytes_indexed: {
    data: '0x',
    topics: [
      '0x2ce5127ffbcf8acfb18ee9becb119aaa6d5e46218a20b766ce68378e63713408',
      '0xe4bcb5983c3ee7d73bfe7de42193f2c31801d4c6a92c5afb6d2f3fad360c94f3',
    ],
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"type":"bytes"}],"name":"testEvent","type":"event"}]',
    decodeOutput: ['0xe4bcb5983c3ee7d73bfe7de42193f2c31801d4c6a92c5afb6d2f3fad360c94f3'],
    topicsInput: [h('314159')],
  },
  array: {
    data: '0x000000000000000000000000000000000000000000000000000000000000003100000000000000000000000000000000000000000000000000000000000000410000000000000000000000000000000000000000000000000000000000000059',
    topics: ['0x04ae8b9eb2cf1ed11fa2be26c58c59c650419343649af89f32823f0c3c406f17'],
    abi: '[{"anonymous":false,"inputs":[{"indexed":false,"type":"uint256[3]"}],"name":"testEvent","type":"event"}]',
    decodeOutput: [[0x31n, 0x41n, 0x59n]],
    topicsInput: [[0x31n, 0x41n, 0x59n]],
  },
  array_indexed: {
    data: '0x',
    topics: [
      '0x04ae8b9eb2cf1ed11fa2be26c58c59c650419343649af89f32823f0c3c406f17',
      '0x7bbf05ea7037b610b84c73f24e8f4540a7e6334431ddcf51a027cff418b197fe',
    ],
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"type":"uint256[3]"}],"name":"testEvent","type":"event"}]',
    decodeOutput: ['0x7bbf05ea7037b610b84c73f24e8f4540a7e6334431ddcf51a027cff418b197fe'],
    topicsInput: [[0x31n, 0x41n, 0x59n]],
  },
  array_2d: {
    data: '0x000000000000000000000000000000000000000000000000000000000000003100000000000000000000000000000000000000000000000000000000000000410000000000000000000000000000000000000000000000000000000000000087000000000000000000000000000000000000000000000000000000000000006500000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000019',
    topics: ['0xb8ff47a1b7969be53d334923ced84ef2808fde3d357196e0b40a40cb59421e47'],
    abi: '[{"anonymous":false,"inputs":[{"indexed":false,"type":"uint256[2][3]"}],"name":"testEvent","type":"event"}]',
    decodeOutput: [
      [
        [0x31n, 0x41n],
        [0x87n, 0x65n],
        [0x12n, 0x19n],
      ],
    ],
    topicsInput: [
      [
        [0x31n, 0x41n],
        [0x87n, 0x65n],
        [0x12n, 0x19n],
      ],
    ],
  },
  array_2d_indexed: {
    data: '0x',
    topics: [
      '0xb8ff47a1b7969be53d334923ced84ef2808fde3d357196e0b40a40cb59421e47',
      '0x1e231c1c4af7d5a0d0c4170b9722b2220a1511daeb43ff090d0d5238172e3054',
    ],
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"type":"uint256[2][3]"}],"name":"testEvent","type":"event"}]',
    decodeOutput: ['0x1e231c1c4af7d5a0d0c4170b9722b2220a1511daeb43ff090d0d5238172e3054'],
    topicsInput: [
      [
        [0x31n, 0x41n],
        [0x87n, 0x65n],
        [0x12n, 0x19n],
      ],
    ],
  },
  array_dynamic: {
    data: '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000310000000000000000000000000000000000000000000000000000000000000041000000000000000000000000000000000000000000000000000000000000008700000000000000000000000000000000000000000000000000000000000000650000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001900000000000000000000000000000000000000000000000000000000000000990000000000000000000000000000000000000000000000000000000000000088',
    name: 'array-dynamic',
    topics: ['0xc5ec573bed94fb189702b4361b228e2976f05dea3d9f5e7d3657e7f80084e4f9'],
    abi: '[{"anonymous":false,"inputs":[{"indexed":false,"type":"uint256[2][]"}],"name":"testEvent","type":"event"}]',
    decodeOutput: [
      [
        [0x31n, 0x41n],
        [0x87n, 0x65n],
        [0x12n, 0x19n],
        [0x99n, 0x88n],
      ],
    ],
    topicsInput: [
      [
        [0x31n, 0x41n],
        [0x87n, 0x65n],
        [0x12n, 0x19n],
        [0x99n, 0x88n],
      ],
    ],
  },
  array_dynamic_indexed: {
    data: '0x',
    name: 'array-dynamic-indexed',
    topics: [
      '0xc5ec573bed94fb189702b4361b228e2976f05dea3d9f5e7d3657e7f80084e4f9',
      '0xf23e5decff1af9fbd7f398a32c5fe1afc46f52058bf9adba5c87de2c44dd71c4',
    ],
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"type":"uint256[2][]"}],"name":"testEvent","type":"event"}]',
    decodeOutput: ['0xf23e5decff1af9fbd7f398a32c5fe1afc46f52058bf9adba5c87de2c44dd71c4'],
    topicsInput: [
      [
        [0x31n, 0x41n],
        [0x87n, 0x65n],
        [0x12n, 0x19n],
        [0x99n, 0x88n],
      ],
    ],
  },
  bytes5_array: {
    data: '0x11223344550000000000000000000000000000000000000000000000000000006677889900000000000000000000000000000000000000000000000000000000',
    name: 'bytes5-array',
    topics: ['0xe885c0e1b6c0f9edb63047f326ecb9f963bc9bacd034fe203f6d1d1e83cf72b4'],
    abi: '[{"anonymous":false,"inputs":[{"indexed":false,"type":"bytes5[2]"}],"name":"testEvent","type":"event"}]',
    decodeOutput: [[h('1122334455'), h('6677889900')]],
    topicsInput: [[h('1122334455'), h('6677889900')]],
  },
  // Fixed size bytes encoded as is
  random6: {
    data: '0x0000000000000000000000003fe8515cecac23bb5fbb584d6ff5159e53a9037500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000002200000000000000000000000007e2fffb888d637662a0b8b0505d61fdd6f2ac167000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000001434c6f72656d20697073756d20646f6c6f722073697420616d65742c20636f6e73656374657475722061646970697363696e6720656c69742c2073656420646f20656975736d6f642074656d706f7220696e6369646964756e74207574206c61626f726520657420646f6c6f7265206d61676e6120616c697175612e20557420656e696d206164206d696e696d2076656e69616d2c2071756973206e6f737472756420657865726369746174696f6e20756c6c616d636f206c61626f726973206e69736920757420616c697175697020657820656120636f6d6d6f646f20636f6e7365717561742e2044756973206175746520697275726520646f6c6f7220696e20726570726568656e646572697420696e20766f6c7570746174652076656c697420657373652063696c6c756d20646f6c6f726520657520667567696174206e756c6c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000035ca1444f7266e8d727e6c8a9d4cfaf30ef27d6648a93ae00d52f970d206bde9183b5dea63ace52e491476d5c2f6e8153cf678e740a50000000000000000000000',
    topics: ['0x8c17580600000000000000000000000000000000000000000000000000000000'],
    abi: '[{"anonymous":true,"inputs":[{"indexed":true,"name":"p0","type":"bytes4"},{"indexed":false,"name":"p1","type":"address"},{"indexed":false,"name":"p2","type":"string"},{"indexed":false,"name":"p3","type":"bytes"},{"indexed":false,"name":"p4","type":"address"},{"indexed":false,"name":"p5","type":"bool"}],"name":"testEvent","type":"event"}]',
    decodeOutput: {
      p0: h('8c175806'),
      p1: '0x3fe8515cecac23bb5fbb584d6ff5159e53a90375',
      p2: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat null',
      p3: h(
        'ca1444f7266e8d727e6c8a9d4cfaf30ef27d6648a93ae00d52f970d206bde9183b5dea63ace52e491476d5c2f6e8153cf678e740a5'
      ),
      p4: '0x7e2fffb888d637662a0b8b0505d61fdd6f2ac167',
      p5: true,
    },
    topicsInput: {
      p0: h('8c175806'),
      p1: '0x3fe8515cecac23bb5fbb584d6ff5159e53a90375',
      p2: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat null',
      p3: h(
        'ca1444f7266e8d727e6c8a9d4cfaf30ef27d6648a93ae00d52f970d206bde9183b5dea63ace52e491476d5c2f6e8153cf678e740a5'
      ),
      p4: '0x7e2fffb888d637662a0b8b0505d61fdd6f2ac167',
      p5: true,
    },
  },
  random6_unnamed: {
    data: '0x0000000000000000000000003fe8515cecac23bb5fbb584d6ff5159e53a9037500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000002200000000000000000000000007e2fffb888d637662a0b8b0505d61fdd6f2ac167000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000001434c6f72656d20697073756d20646f6c6f722073697420616d65742c20636f6e73656374657475722061646970697363696e6720656c69742c2073656420646f20656975736d6f642074656d706f7220696e6369646964756e74207574206c61626f726520657420646f6c6f7265206d61676e6120616c697175612e20557420656e696d206164206d696e696d2076656e69616d2c2071756973206e6f737472756420657865726369746174696f6e20756c6c616d636f206c61626f726973206e69736920757420616c697175697020657820656120636f6d6d6f646f20636f6e7365717561742e2044756973206175746520697275726520646f6c6f7220696e20726570726568656e646572697420696e20766f6c7570746174652076656c697420657373652063696c6c756d20646f6c6f726520657520667567696174206e756c6c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000035ca1444f7266e8d727e6c8a9d4cfaf30ef27d6648a93ae00d52f970d206bde9183b5dea63ace52e491476d5c2f6e8153cf678e740a50000000000000000000000',
    topics: ['0x8c17580600000000000000000000000000000000000000000000000000000000'],
    abi: '[{"anonymous":true,"inputs":[{"indexed":true,"type":"bytes4"},{"indexed":false,"name":"p1","type":"address"},{"indexed":false,"name":"p2","type":"string"},{"indexed":false,"name":"p3","type":"bytes"},{"indexed":false,"name":"p4","type":"address"},{"indexed":false,"name":"p5","type":"bool"}],"name":"testEvent","type":"event"}]',
    decodeOutput: [
      h('8c175806'),
      '0x3fe8515cecac23bb5fbb584d6ff5159e53a90375',
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat null',
      h(
        'ca1444f7266e8d727e6c8a9d4cfaf30ef27d6648a93ae00d52f970d206bde9183b5dea63ace52e491476d5c2f6e8153cf678e740a5'
      ),
      '0x7e2fffb888d637662a0b8b0505d61fdd6f2ac167',
      true,
    ],
    topicsInput: [
      h('8c175806'),
      '0x3fe8515cecac23bb5fbb584d6ff5159e53a90375',
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat null',
      h(
        'ca1444f7266e8d727e6c8a9d4cfaf30ef27d6648a93ae00d52f970d206bde9183b5dea63ace52e491476d5c2f6e8153cf678e740a5'
      ),
      '0x7e2fffb888d637662a0b8b0505d61fdd6f2ac167',
      true,
    ],
  },
  // indexed array of bool[1][1] is still hashed
  random343: {
    data: '0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000005c00000000000000000000000000000000000000000000000000000000d5559a71000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c84c6f72656d20697073756d20646f6c6f722073697420616d65742c20636f6e73656374657475722061646970697363696e6720656c69742c2073656420646f20656975736d6f642074656d706f7220696e6369646964756e74207574206c61626f726520657420646f6c6f7265206d61676e6120616c697175612e20557420656e696d206164206d696e696d2076656e69616d2c2071756973206e6f737472756420657865726369746174696f6e20756c6c616d636f206c61626f726973206e6973692075742061000000000000000000000000000000000000000000000000',
    topics: [
      '0x58b4bd2578023467a3ed6bd0681ded255e7e26bea614d5d5180be506a50fa5e9',
      '0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563',
      '0xab08a90000000000000000000000000000000000000000000000000000000000',
    ],
    abi: '[{"anonymous":false,"inputs":[{"indexed":false,"name":"p0","type":"bool"},{"indexed":true,"name":"p1","type":"bool[1][1]"},{"indexed":false,"name":"p2","type":"int8"},{"indexed":true,"name":"p3","type":"bytes3"},{"indexed":false,"name":"p4","type":"int120"},{"indexed":false,"name":"p5","type":"string"}],"name":"testEvent","type":"event"}]',
    decodeOutput: {
      p4: 0xd5559a71n,
      p1: '0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563',
      p2: 0x5cn,
      p0: true,
      p5: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut a',
      p3: h('ab08a9'),
    },
    topicsInput: {
      p4: 0xd5559a71n,
      p1: [[false]],
      p2: 0x5cn,
      p0: true,
      p5: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut a',
      p3: h('ab08a9'),
    },
  },
  random383: {
    data: '0x0000000000000000000000000000000000000000000000000000000000000000',
    topics: [
      '0xae6380f90582392af1644d36d82c98ff9d1381806066c8584f54c50f652cdde2',
      '0xd6656096af6c3caaee13a823013600336d0e9a63cc5674d77d1e4e8c4d9b5ebe',
      '0xe754b0224c182b2c871585bb1aae9443c2c9808a1a6bb011634972863024d7f2',
    ],
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"type":"bool[3][3][1]"},{"indexed":true,"name":"p1","type":"bytes"},{"indexed":false,"type":"bool"}],"name":"testEvent","type":"event"}]',
    decodeOutput: [
      '0xd6656096af6c3caaee13a823013600336d0e9a63cc5674d77d1e4e8c4d9b5ebe',
      '0xe754b0224c182b2c871585bb1aae9443c2c9808a1a6bb011634972863024d7f2',
      false,
    ],
    topicsInput: [
      [
        [
          [true, true, true],
          [true, false, false],
          [false, true, true],
        ],
      ],
      h('c380282903e00e5eff9a4bcdfd3b06b9cb53c97a81033244f459ef90ef1d57332d'),
      false,
    ],
  },
};
