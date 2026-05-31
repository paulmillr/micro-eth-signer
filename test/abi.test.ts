import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, should } from '@paulmillr/jsbt/test.js';
import * as P from 'micro-packed';
import { deepStrictEqual, throws } from 'node:assert';
import { addHints } from '../src/advanced/abi-common.ts';
import * as abi from '../src/advanced/abi-decoder.ts';
import { mapArgs, mapComponent } from '../src/advanced/abi-mapper.ts';
import {
  CONTRACTS,
  TOKENS,
  decodeData,
  decodeEvent,
  decodeTx,
  deployContract,
  tokenFromSymbol,
} from '../src/advanced/abi.ts';
import { strip0x } from '../src/utils.ts';

import ERC20, { hints as ERC20_HINTS } from '../src/advanced/abi-erc20.ts';
import {
  default as KYBER_NETWORK_PROXY,
  KYBER_NETWORK_PROXY_CONTRACT,
} from '../src/advanced/abi-kyber.ts';
import {
  default as UNISWAP_V2_ROUTER,
  UNISWAP_V2_ROUTER_CONTRACT,
} from '../src/advanced/abi-uniswap-v2.ts';
import {
  default as UNISWAP_V3_ROUTER,
  UNISWAP_V3_ROUTER_CONTRACT,
} from '../src/advanced/abi-uniswap-v3.ts';
import WETH_ABI from '../src/advanced/abi-weth.ts';

const hex = { encode: bytesToHex, decode: hexToBytes };

// Based on ethers.js test cases (MIT licensed)
const abiTestEvents = {
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
    decodeOutput: [hex.decode('314159')],
    topicsInput: [hex.decode('314159')],
  },
  bytes_indexed: {
    data: '0x',
    topics: [
      '0x2ce5127ffbcf8acfb18ee9becb119aaa6d5e46218a20b766ce68378e63713408',
      '0xe4bcb5983c3ee7d73bfe7de42193f2c31801d4c6a92c5afb6d2f3fad360c94f3',
    ],
    abi: '[{"anonymous":false,"inputs":[{"indexed":true,"type":"bytes"}],"name":"testEvent","type":"event"}]',
    decodeOutput: ['0xe4bcb5983c3ee7d73bfe7de42193f2c31801d4c6a92c5afb6d2f3fad360c94f3'],
    topicsInput: [hex.decode('314159')],
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
    decodeOutput: [[hex.decode('1122334455'), hex.decode('6677889900')]],
    topicsInput: [[hex.decode('1122334455'), hex.decode('6677889900')]],
  },
  // Fixed size bytes encoded as is
  random6: {
    data: '0x0000000000000000000000003fe8515cecac23bb5fbb584d6ff5159e53a9037500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000002200000000000000000000000007e2fffb888d637662a0b8b0505d61fdd6f2ac167000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000001434c6f72656d20697073756d20646f6c6f722073697420616d65742c20636f6e73656374657475722061646970697363696e6720656c69742c2073656420646f20656975736d6f642074656d706f7220696e6369646964756e74207574206c61626f726520657420646f6c6f7265206d61676e6120616c697175612e20557420656e696d206164206d696e696d2076656e69616d2c2071756973206e6f737472756420657865726369746174696f6e20756c6c616d636f206c61626f726973206e69736920757420616c697175697020657820656120636f6d6d6f646f20636f6e7365717561742e2044756973206175746520697275726520646f6c6f7220696e20726570726568656e646572697420696e20766f6c7570746174652076656c697420657373652063696c6c756d20646f6c6f726520657520667567696174206e756c6c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000035ca1444f7266e8d727e6c8a9d4cfaf30ef27d6648a93ae00d52f970d206bde9183b5dea63ace52e491476d5c2f6e8153cf678e740a50000000000000000000000',
    topics: ['0x8c17580600000000000000000000000000000000000000000000000000000000'],
    abi: '[{"anonymous":true,"inputs":[{"indexed":true,"name":"p0","type":"bytes4"},{"indexed":false,"name":"p1","type":"address"},{"indexed":false,"name":"p2","type":"string"},{"indexed":false,"name":"p3","type":"bytes"},{"indexed":false,"name":"p4","type":"address"},{"indexed":false,"name":"p5","type":"bool"}],"name":"testEvent","type":"event"}]',
    decodeOutput: {
      p0: hex.decode('8c175806'),
      p1: '0x3fe8515cecac23bb5fbb584d6ff5159e53a90375',
      p2: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat null',
      p3: hex.decode(
        'ca1444f7266e8d727e6c8a9d4cfaf30ef27d6648a93ae00d52f970d206bde9183b5dea63ace52e491476d5c2f6e8153cf678e740a5'
      ),
      p4: '0x7e2fffb888d637662a0b8b0505d61fdd6f2ac167',
      p5: true,
    },
    topicsInput: {
      p0: hex.decode('8c175806'),
      p1: '0x3fe8515cecac23bb5fbb584d6ff5159e53a90375',
      p2: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat null',
      p3: hex.decode(
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
      hex.decode('8c175806'),
      '0x3fe8515cecac23bb5fbb584d6ff5159e53a90375',
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat null',
      hex.decode(
        'ca1444f7266e8d727e6c8a9d4cfaf30ef27d6648a93ae00d52f970d206bde9183b5dea63ace52e491476d5c2f6e8153cf678e740a5'
      ),
      '0x7e2fffb888d637662a0b8b0505d61fdd6f2ac167',
      true,
    ],
    topicsInput: [
      hex.decode('8c175806'),
      '0x3fe8515cecac23bb5fbb584d6ff5159e53a90375',
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat null',
      hex.decode(
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
      p3: hex.decode('ab08a9'),
    },
    topicsInput: {
      p4: 0xd5559a71n,
      p1: [[false]],
      p2: 0x5cn,
      p0: true,
      p5: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut a',
      p3: hex.decode('ab08a9'),
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
      hex.decode('c380282903e00e5eff9a4bcdfd3b06b9cb53c97a81033244f459ef90ef1d57332d'),
      false,
    ],
  },
};

const tupleABI = [
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

const evSigHashTests = [
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

const fnSigHashTests = [
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

const SPEC_CONTRACT = [
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

should('fnSigHash', () => {
  deepStrictEqual(abi.fnSigHash(tupleABI[0]), '6f2be728');
  for (let [exp, fn] of fnSigHashTests) deepStrictEqual(abi.fnSigHash(fn), exp);
});
should('evSigHash', () => {
  for (let [exp, fn] of evSigHashTests) deepStrictEqual(abi.evSigHash(fn), exp);
});

// Ugly and probably broken, but ok for tests.
function unwrapTestType(s) {
  let stack = [];
  let cur = '';
  const top = () => stack[stack.length - 1];
  for (const i of s) {
    if (i === '(') {
      const cur = { type: 'tuple', components: [] };
      if (top()) top().components.push(cur);
      stack.push(cur);
      continue;
    }
    if (i === ' ') continue;
    if (i === ',' || i === ')') {
      if (cur) top().components.push({ type: cur });
      cur = '';
      if (i === ')') {
        if (stack.length === 1) return stack[0];
        stack.pop();
      }
      continue;
    }
    cur += i;
  }
  // can be only if there is no types
  if (cur) return { type: cur };
  return stack[0];
}

should('unwrapTestType', () => {
  deepStrictEqual(unwrapTestType('string'), { type: 'string' });
  deepStrictEqual(unwrapTestType('((uint8,uint8), uint8)'), {
    type: 'tuple',
    components: [
      { type: 'tuple', components: [{ type: 'uint8' }, { type: 'uint8' }] },
      { type: 'uint8' },
    ],
  });
  deepStrictEqual(
    unwrapTestType('(bool,(bytes32,int256,(bytes24,bytes8)),(bool,bool,bool),string)'),
    {
      type: 'tuple',
      components: [
        { type: 'bool' },
        {
          type: 'tuple',
          components: [
            { type: 'bytes32' },
            { type: 'int256' },
            { type: 'tuple', components: [{ type: 'bytes24' }, { type: 'bytes8' }] },
          ],
        },
        { type: 'tuple', components: [{ type: 'bool' }, { type: 'bool' }, { type: 'bool' }] },
        { type: 'string' },
      ],
    }
  );
});

function t(type, value, exp) {
  should(`mapType(${type}, ${value}, ${exp})`, () => {
    const p = mapComponent(unwrapTestType(type));
    deepStrictEqual(hex.encode(p.encode(value)), exp);
    deepStrictEqual(p.decode(hex.decode(strip0x(exp))), value);
  });
}
function tErr(type, value, exp) {
  const p = mapComponent(unwrapTestType(type));
  if (value !== undefined) throws(() => hex.encode(p.encode(value)));
  if (exp !== undefined) throws(() => p.decode(hex.decode(strip0x(exp))));
}
describe('Type mapping', () => {
  t(
    'string',
    'USDT',
    '000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553445400000000000000000000000000000000000000000000000000000000'
  );
  t(
    'string',
    'sssssssssssssssssssssssssssssssss',
    '0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002173737373737373737373737373737373737373737373737373737373737373737300000000000000000000000000000000000000000000000000000000000000'
  );
  t(
    'string',
    'ssssssssssssssssssssssssssssssss',
    '000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000207373737373737373737373737373737373737373737373737373737373737373'
  );
  t('int8', -127n, 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff81');
  t('int8', -128n, 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff80');
  t('int8', 127n, '000000000000000000000000000000000000000000000000000000000000007f');
  tErr('int8', -129n, 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f');
  tErr('int8', 128n, '0000000000000000000000000000000000000000000000000000000000000080');
  t('uint8', 255n, '00000000000000000000000000000000000000000000000000000000000000ff');
  tErr('uint8', -1n, 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  tErr('uint8', 256n, '0000000000000000000000000000000000000000000000000000000000000100');
  t('int256', -314159n, 'fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffb34d1');
  t('int256', 314159n, '000000000000000000000000000000000000000000000000000000000004cb2f');
  t('uint256', 314159n, '000000000000000000000000000000000000000000000000000000000004cb2f');
  t(
    'address',
    '0x4bbeeb066ed09b7aed07bf39eee0460dfa261520',
    '0000000000000000000000004bbeeb066ed09b7aed07bf39eee0460dfa261520'
  );
  t(
    'address',
    '0x407d73d8a49eeb85d32cf465507dd71d507100c1',
    '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c1'
  );
  t(
    'address[2]',
    ['0x407d73d8a49eeb85d32cf465507dd71d507100c1', '0x407d73d8a49eeb85d32cf465507dd71d507100c3'],
    '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c1000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c3'
  );
  t(
    'address[]',
    ['0x407d73d8a49eeb85d32cf465507dd71d507100c1', '0x407d73d8a49eeb85d32cf465507dd71d507100c3'],
    '00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002' +
      '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c1000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c3'
  );
  t(
    'address[2][]',
    [
      ['0x407d73d8a49eeb85d32cf465507dd71d507100c1', '0x407d73d8a49eeb85d32cf465507dd71d507100c2'],
      ['0x407d73d8a49eeb85d32cf465507dd71d507100c3', '0x407d73d8a49eeb85d32cf465507dd71d507100c4'],
    ],
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c1' +
      '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c2' +
      '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c3' +
      '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c4'
  );

  t(
    'address[][2]',
    [
      ['0x407d73d8a49eeb85d32cf465507dd71d507100c1', '0x407d73d8a49eeb85d32cf465507dd71d507100c2'],
      ['0x407d73d8a49eeb85d32cf465507dd71d507100c3', '0x407d73d8a49eeb85d32cf465507dd71d507100c4'],
    ],
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000040' +
      '00000000000000000000000000000000000000000000000000000000000000a0' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c1' +
      '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c2' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c3' +
      '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c4'
  );

  t(
    'address[][]',
    [
      ['0x407d73d8a49eeb85d32cf465507dd71d507100c1', '0x407d73d8a49eeb85d32cf465507dd71d507100c2'],
      ['0x407d73d8a49eeb85d32cf465507dd71d507100c3', '0x407d73d8a49eeb85d32cf465507dd71d507100c4'],
    ],
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '0000000000000000000000000000000000000000000000000000000000000040' +
      '00000000000000000000000000000000000000000000000000000000000000a0' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c1' +
      '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c2' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c3' +
      '000000000000000000000000407d73d8a49eeb85d32cf465507dd71d507100c4'
  );

  t('bool', true, '0000000000000000000000000000000000000000000000000000000000000001');
  t('bool', false, '0000000000000000000000000000000000000000000000000000000000000000');
  tErr('bool', undefined, '00000000000000000000000000000000000000000000000000000000000000013');
  t(
    'bool[2]',
    [true, false],
    '0000000000000000000000000000000000000000000000000000000000000001' +
      '0000000000000000000000000000000000000000000000000000000000000000'
  );
  t(
    'bool[]',
    [true, true, false],
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000003' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      '0000000000000000000000000000000000000000000000000000000000000000'
  );
  t('int', 1n, '0000000000000000000000000000000000000000000000000000000000000001');
  t('int', 16n, '0000000000000000000000000000000000000000000000000000000000000010');
  t('int', -1n, 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  t(
    'int[]',
    [],
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000000'
  );
  t(
    'int[]',
    [3n],
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      '0000000000000000000000000000000000000000000000000000000000000003'
  );
  t(
    'int[3][]',
    [
      [1n, 2n, 3n],
      [4n, 5n, 6n],
    ],
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '0000000000000000000000000000000000000000000000000000000000000003' +
      '0000000000000000000000000000000000000000000000000000000000000004' +
      '0000000000000000000000000000000000000000000000000000000000000005' +
      '0000000000000000000000000000000000000000000000000000000000000006'
  );
  t(
    'uint',
    115792089237316195423570985008687907853269984665640564039457584007913129639935n,
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  );
  t(
    'bytes',
    hex.decode('6761766f66796f726b'),
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000009' +
      '6761766f66796f726b0000000000000000000000000000000000000000000000'
  );
  t(
    'bytes',
    hex.decode('731a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b'),
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000020' +
      '731a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b'
  );
  t(
    'bytes',
    hex.decode(
      '131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b231a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b'
    ),
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000040' +
      '131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b' +
      '231a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b'
  );
  t(
    'bytes',
    hex.decode(
      '131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b' +
        '231a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b' +
        '331a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b'
    ),
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000060' +
      '131a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b' +
      '231a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b' +
      '331a3afc00d1b1e3461b955e53fc866dcf303b3eb9f4c16f89e388930f48134b'
  );
  t(
    'string',
    'Heeäööä👅D34ɝɣ24Єͽ-.,äü+#/',
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '000000000000000000000000000000000000000000000000000000000000002' +
      '6486565c3a4c3b6c3b6c3a4f09f9185443334c99dc9a33234d084cdbd2d2e2c' +
      'c3a4c3bc2b232f0000000000000000000000000000000000000000000000000000'
  );
  t(
    'string',
    'welcome to ethereum. welcome to ethereum. welcome to ethereum.',
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '000000000000000000000000000000000000000000000000000000000000003e' +
      '77656c636f6d6520746f20657468657265756d2e2077656c636f6d6520746f20' +
      '657468657265756d2e2077656c636f6d6520746f20657468657265756d2e0000'
  );
  t(
    'bytes32',
    hex.decode('c3a40000c3a40000000000000000000000000000000000000000000000000000'),
    'c3a40000c3a40000000000000000000000000000000000000000000000000000'
  );
  t(
    'bytes1[4]',
    ['cf', '68', '4d', 'fb'].map((i) => hex.decode(i)),
    'cf00000000000000000000000000000000000000000000000000000000000000' +
      '6800000000000000000000000000000000000000000000000000000000000000' +
      '4d00000000000000000000000000000000000000000000000000000000000000' +
      'fb00000000000000000000000000000000000000000000000000000000000000'
  );
  t(
    '(uint8, uint8, ((uint8,uint8), uint8))',
    [1n, 2n, [[3n, 4n], 5n]],
    //{ 0: 1n, 1: 2n, 2: { 0: { 0: 3n, 1: 4n }, 1: 5n } },
    '0000000000000000000000000000000000000000000000000000000000000001' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '0000000000000000000000000000000000000000000000000000000000000003' +
      '0000000000000000000000000000000000000000000000000000000000000004' +
      '0000000000000000000000000000000000000000000000000000000000000005'
  );
  t(
    'uint[][]',
    [[1n, 2n], [3n]],
    '0000000000000000000000000000000000000000000000000000000000000020' + // 00 - offset of [[1, 2] [3]] = 32  0
      '0000000000000000000000000000000000000000000000000000000000000002' + // - count for [[1, 2], [3]]       32
      '0000000000000000000000000000000000000000000000000000000000000040' + // - offset of [1, 2] = 64         64
      '00000000000000000000000000000000000000000000000000000000000000a0' + // - offset of [3] = 160           96
      '0000000000000000000000000000000000000000000000000000000000000002' + // - count for [1, 2]              128
      '0000000000000000000000000000000000000000000000000000000000000001' + // - encoding of 1                 160
      '0000000000000000000000000000000000000000000000000000000000000002' + // - encoding of 2                 192
      '0000000000000000000000000000000000000000000000000000000000000001' + // - count for [3]                 224
      '0000000000000000000000000000000000000000000000000000000000000003' // - encoding of 3                   256
  );
  t(
    '(string,string)',
    ['welcome to ethereum.', 'welcome to ethereum.'],
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000040' +
      '0000000000000000000000000000000000000000000000000000000000000080' +
      '0000000000000000000000000000000000000000000000000000000000000014' +
      '77656c636f6d6520746f20657468657265756d2e000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000014' +
      '77656c636f6d6520746f20657468657265756d2e000000000000000000000000'
  );
  t(
    '(bytes,bytes)',
    ['77656c636f6d6520746f20657468657265756d2e', '77656c636f6d6520746f20657468657265756d2e'].map(
      (i) => hex.decode(i)
    ),
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000040' +
      '0000000000000000000000000000000000000000000000000000000000000080' +
      '0000000000000000000000000000000000000000000000000000000000000014' +
      '77656c636f6d6520746f20657468657265756d2e000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000014' +
      '77656c636f6d6520746f20657468657265756d2e000000000000000000000000'
  );
  t(
    '(bytes,bool,uint256)',
    [hex.decode('77656c636f6d6520746f20657468657265756d2e'), true, 124515n],
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000060' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      '000000000000000000000000000000000000000000000000000000000001e663' +
      '0000000000000000000000000000000000000000000000000000000000000014' +
      '77656c636f6d6520746f20657468657265756d2e000000000000000000000000'
  );
  t(
    '(string,(bool,int256),address)',
    ['hello', [true, -151n], '0x0175010374017501037401750103740175010374'],
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000080' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff69' +
      '0000000000000000000000000175010374017501037401750103740175010374' +
      '0000000000000000000000000000000000000000000000000000000000000005' +
      '68656c6c6f000000000000000000000000000000000000000000000000000000'
  );
  t(
    '((bool,bool),(address,address),(string,string))',
    [
      [true, false],
      ['0x81017589ab81017589ab81017589ab81017589ab', '0x81017589ab81017589ab81017589ab81017589ab'],
      ['string One', 'string Two'],
    ],
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '00000000000000000000000081017589ab81017589ab81017589ab81017589ab' +
      '00000000000000000000000081017589ab81017589ab81017589ab81017589ab' +
      '00000000000000000000000000000000000000000000000000000000000000a0' +
      '0000000000000000000000000000000000000000000000000000000000000040' +
      '0000000000000000000000000000000000000000000000000000000000000080' +
      '000000000000000000000000000000000000000000000000000000000000000a' +
      '737472696e67204f6e6500000000000000000000000000000000000000000000' +
      '000000000000000000000000000000000000000000000000000000000000000a' +
      '737472696e672054776f00000000000000000000000000000000000000000000'
  );
  t(
    '(((bool,bool),(bytes,bytes),(address,bool)),address)',
    [
      [
        [false, false],
        ['0ab1394581edfa2ef9ca71', '15abe391df19aef19a4561'].map((i) => hex.decode(i)),
        ['0xec2270c849236333c86834728e783cd2f789088e', true],
      ],
      '0x81017589ab81017589ab81017589ab81017589ab',
    ],
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000040' +
      '00000000000000000000000081017589ab81017589ab81017589ab81017589ab' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '00000000000000000000000000000000000000000000000000000000000000a0' +
      '000000000000000000000000ec2270c849236333c86834728e783cd2f789088e' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      '0000000000000000000000000000000000000000000000000000000000000040' +
      '0000000000000000000000000000000000000000000000000000000000000080' +
      '000000000000000000000000000000000000000000000000000000000000000b' +
      '0ab1394581edfa2ef9ca71000000000000000000000000000000000000000000' +
      '000000000000000000000000000000000000000000000000000000000000000b' +
      '15abe391df19aef19a4561000000000000000000000000000000000000000000'
  );
  t(
    '(address,address,(string,(int256,int256),string))',
    [
      '0x1981710abe1981710abe1981710abe1981710abe',
      '0x1981710abe1981710abe1981710abe1981710abe',
      ['structs are great', [-1951n, 194018n], 'so many possibilities'],
    ],
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000001981710abe1981710abe1981710abe1981710abe' +
      '0000000000000000000000001981710abe1981710abe1981710abe1981710abe' +
      '0000000000000000000000000000000000000000000000000000000000000060' +
      '0000000000000000000000000000000000000000000000000000000000000080' +
      'fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff861' +
      '000000000000000000000000000000000000000000000000000000000002f5e2' +
      '00000000000000000000000000000000000000000000000000000000000000c0' +
      '0000000000000000000000000000000000000000000000000000000000000011' +
      '7374727563747320617265206772656174000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000015' +
      '736f206d616e7920706f73736962696c69746965730000000000000000000000'
  );
  t(
    '(bool,(bytes32,int256,(bytes24,bytes8)),(bool,bool,bool),string)',
    [
      true,
      [
        hex.decode('abdef18710a18a18abdef18710a18a18abdef18710a18a18abdef18710a18a18'),
        -18291849n,
        ['abdef18710a18a18abdef18710a18a18abdef18710a18a18', 'abdef18710a18a18'].map((i) =>
          hex.decode(i)
        ),
      ],
      [false, true, false],
      'testing testing',
    ],
    '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      'abdef18710a18a18abdef18710a18a18abdef18710a18a18abdef18710a18a18' +
      'fffffffffffffffffffffffffffffffffffffffffffffffffffffffffee8e377' +
      'abdef18710a18a18abdef18710a18a18abdef18710a18a180000000000000000' +
      'abdef18710a18a18000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000120' +
      '000000000000000000000000000000000000000000000000000000000000000f' +
      '74657374696e672074657374696e670000000000000000000000000000000000'
  );
});
should('ABI named tuple fields can shadow object prototype names', () => {
  const component = {
    type: 'tuple',
    components: [
      { name: 'toString', type: 'uint256' },
      { name: 'hasOwnProperty', type: 'bool' },
    ],
  } as const;
  const coder = mapComponent(component);
  const data =
    '0000000000000000000000000000000000000000000000000000000000000007' +
    '0000000000000000000000000000000000000000000000000000000000000001';
  deepStrictEqual(hex.encode(coder.encode({ toString: 7n, hasOwnProperty: true })), data);
  deepStrictEqual(coder.decode(hex.decode(data)), { toString: 7n, hasOwnProperty: true });
  throws(() =>
    mapComponent({
      type: 'tuple',
      components: [
        { name: 'toString', type: 'uint256' },
        { name: 'toString', type: 'uint256' },
      ],
    })
  );
});
should('mapArgs', () => {
  function t(contract, fn, args, exp) {
    let m = mapArgs(contract.find((i) => i.name == fn).inputs, true);
    deepStrictEqual(hex.encode(m.encode(args)), exp);
  }
  // FROM SPEC: https://docs.soliditylang.org/en/develop/abi-spec.html#argument-encoding
  // If we wanted to call sam with the arguments "dave", true and [1,2,3], we would pass 292 bytes total, broken down into:
  t(
    SPEC_CONTRACT,
    'sam',
    [utf8ToBytes('dave'), true, [1, 2, 3]],
    '0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000464617665000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003'
  );
  // A call to a function with the signature f(uint,uint32[],bytes10,bytes) with values (0x123, [0x456, 0x789], "1234567890", "Hello, world!")
  t(
    SPEC_CONTRACT,
    'd',
    [0x123, [0x456, 0x789], utf8ToBytes('1234567890'), 'Hello, world!'],
    '0000000000000000000000000000000000000000000000000000000000000123' +
      '0000000000000000000000000000000000000000000000000000000000000080' +
      '3132333435363738393000000000000000000000000000000000000000000000' +
      '00000000000000000000000000000000000000000000000000000000000000e0' +
      '0000000000000000000000000000000000000000000000000000000000000002' +
      '0000000000000000000000000000000000000000000000000000000000000456' +
      '0000000000000000000000000000000000000000000000000000000000000789' +
      '000000000000000000000000000000000000000000000000000000000000000d' +
      '48656c6c6f2c20776f726c642100000000000000000000000000000000000000'
  );
  // Let us apply the same principle to encode the data for a function with a signature g(uint[][],string[]) with values ([[1, 2], [3]], ["one", "two", "three"])
  t(
    SPEC_CONTRACT,
    'g',
    [
      [[1n, 2n], [3n]],
      ['one', 'two', 'three'],
    ],
    '0000000000000000000000000000000000000000000000000000000000000040' + // - offset of [[1, 2], [3]]
      '0000000000000000000000000000000000000000000000000000000000000140' + // - offset of ["one", "two", "three"]
      '0000000000000000000000000000000000000000000000000000000000000002' + // - count for [[1, 2], [3]]
      '0000000000000000000000000000000000000000000000000000000000000040' + // - offset of [1, 2]
      '00000000000000000000000000000000000000000000000000000000000000a0' + // - offset of [3]
      '0000000000000000000000000000000000000000000000000000000000000002' + // - count for [1, 2]
      '0000000000000000000000000000000000000000000000000000000000000001' + // - encoding of 1
      '0000000000000000000000000000000000000000000000000000000000000002' + // - encoding of 2
      '0000000000000000000000000000000000000000000000000000000000000001' + // - count for [3]
      '0000000000000000000000000000000000000000000000000000000000000003' + // - encoding of 3
      '0000000000000000000000000000000000000000000000000000000000000003' + // - count for ["one", "two", "three"]
      '0000000000000000000000000000000000000000000000000000000000000060' + // - offset for "one"
      '00000000000000000000000000000000000000000000000000000000000000a0' + // - offset for "two"
      '00000000000000000000000000000000000000000000000000000000000000e0' + // - offset for "three"
      '0000000000000000000000000000000000000000000000000000000000000003' + // - count for "one"
      '6f6e650000000000000000000000000000000000000000000000000000000000' + // - encoding of "one"
      '0000000000000000000000000000000000000000000000000000000000000003' + // - count for "two"
      '74776f0000000000000000000000000000000000000000000000000000000000' + // - encoding of "two"
      '0000000000000000000000000000000000000000000000000000000000000005' + // - count for "three"
      '7468726565000000000000000000000000000000000000000000000000000000' // - encoding of "three"
  );
  const shadow = mapArgs([
    { name: 'toString', type: 'uint256' },
    { name: 'ok', type: 'bool' },
  ] as const);
  const data =
    '0000000000000000000000000000000000000000000000000000000000000001' +
    '0000000000000000000000000000000000000000000000000000000000000001';
  deepStrictEqual(hex.encode(shadow.encode({ toString: 1n, ok: true })), data);
  deepStrictEqual(shadow.decode(hex.decode(data)), { toString: 1n, ok: true });
  throws(() =>
    mapArgs([
      { name: 'toString', type: 'uint256' },
      { name: 'toString', type: 'uint256' },
    ] as const)
  );
});
should('Decoder', () => {
  const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  let d = new abi.Decoder();
  d.add(USDT, ERC20);
  // tx hash: 0x6fd66d7b306f77fc01a397f55d4efe19256458badd8782d523d06ed450851d0a
  const data = hex.decode(
    'a9059cbb000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec70000000000000000000000000000000000000000000000000000000542598700'
  );
  const value = {
    name: 'transfer',
    signature: 'transfer(address,uint256)',
    value: { to: USDT, value: 22588000000n },
  };
  // Strict-match
  deepStrictEqual(d.decode(USDT, data), value);
  // Sig-hash match: we don't know anything about contract, but we know sighash
  deepStrictEqual(d.decode(WETH, data), [value]);
  // Hint
  deepStrictEqual(
    d.decode(USDT, data, {
      contractInfo: { decimals: 6, symbol: 'USDT' },
    }).hint,
    'Transfer 22588 USDT to 0xdac17f958d2ee523a2206206994597c13d831ec7'
  );
  // Uni
  const UNISWAP = UNISWAP_V2_ROUTER_CONTRACT;
  d.add(UNISWAP, UNISWAP_V2_ROUTER);
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

  const CUSTOM_TOKENS = {
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
  const uniOpt = {
    contract: UNISWAP,
    contracts: Object.assign({}, CONTRACTS, CUSTOM_TOKENS),
    contractInfo: CONTRACTS[UNISWAP],
  };
  const tx0 = hex.decode(
    '7ff36ab5000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000080000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000106d3c66d22d2dd0446df23d7f5960752994d600'
  );
  deepStrictEqual(
    d.decode(UNISWAP, tx0, Object.assign(uniOpt, { amount: 100000000000000000n })).hint,
    'Swap 0.1 ETH for at least 12345678901.234567891 LABRA. Expires at Tue, 19 Jun 2029 06:00:10 GMT'
  );
  const tx1 = hex.decode(
    '38ed17390000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000000000000000000000000000ab54a98ceb1f0ad300000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea00000000000000000000000000000000000000000000000000000000000000030000000000000000000000000ff6ffcfda92c53f615a4a75d982f399c989366b000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7'
  );
  deepStrictEqual(
    d.decode(UNISWAP, tx1, Object.assign(uniOpt, { amount: 0n })).hint,
    'Swap exact 98.765432109876543212 LAYER for at least 12345678901234.567891 USDT. Expires at Tue, 19 Jun 2029 06:00:10 GMT'
  );
  const tx2 = hex.decode(
    '18cbafe50000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000000000000000000000000000ab54a98ceb1f0ad300000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000d8912c10681d8b21fd3742244f44658dba12264e000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
  );
  deepStrictEqual(
    d.decode(UNISWAP, tx2, Object.assign(uniOpt, { amount: 0n })).hint,
    'Swap exact 98.765432109876543212 PLUTON for at least 12.345678901234567891 ETH. Expires at Tue, 19 Jun 2029 06:00:10 GMT'
  );
  const tx3 = hex.decode(
    'fb3bdb41000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000080000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000f65b5c5104c4fafd4b709d9d60a185eae063276c'
  );
  deepStrictEqual(
    d.decode(UNISWAP, tx3, Object.assign(uniOpt, { amount: 98765432109876543212n })).hint,
    'Swap up to 98.765432109876543212 ETH for exact 12.345678901234567891 TRU. Expires at Tue, 19 Jun 2029 06:00:10 GMT'
  );
  // Kyber
  const KYBER = KYBER_NETWORK_PROXY_CONTRACT;
  d.add(KYBER, KYBER_NETWORK_PROXY);
  const kyberOpt = {
    contract: KYBER,
    contracts: Object.assign({}, CONTRACTS, CUSTOM_TOKENS),
    contractInfo: CONTRACTS[KYBER],
  };
  const tx4 = hex.decode(
    'ae591d540000000000000000000000007fc66500c84a76ad7e9c93437bfc5ac33e2ddae90000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000f629cbd94d3791c9250152bd8dfbdf380e2a3b9c000000000000000000000000dc083bf73176bd3ed63907424d26d02571d92b95000000000000000000000000000000000000000000000000ab54a98ceb1f0ad300000000000000000000000000000000000000000000000aef84762139eb8000000000000000000000000000de63aef60307655405835da74ba02ce4db1a42fb000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000000'
  );
  const kyberTx4 = d.decode(
    KYBER,
    tx4,
    Object.assign(kyberOpt, { amount: 0n })
  ) as abi.SignatureInfo;
  deepStrictEqual(
    kyberTx4.hint,
    'Swap 98.765432109876543212 AAVE For 19923.60398191190745624 ENJ (with platform fee: 0.177777777797777777 AAVE)'
  );
  const tx5 = hex.decode(
    'ae591d54000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000e5a3229ccb22b6484594973a03a3851dcd9487560000000000000000000000004f8f521ce1a74a2fc62ce75db676f56965b7d957000000000000000000000000000000000000000000000000ab54a98ceb1f0ad300000000000000000000000000000000000000000000005ac6d2e744f38f9272000000000000000000000000440bbd6a888a36de6e2f6a25f65bc4e16874faa90000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001aa5241452041505200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000002710'
  );
  deepStrictEqual(
    d.decode(KYBER, tx5, Object.assign(kyberOpt, { amount: 7864074000000000n })).hint,
    'Swap 98.765432109876543212 ETH For 165386.047848908022190687 RAE (with platform fee: 0.079012345687901234 ETH)'
  );
  const tx6 = hex.decode(
    'ae591d54000000000000000000000000e5a3229ccb22b6484594973a03a3851dcd9487560000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000f2ec13ceda50f54544a209840d8f734706cb8f7c000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000002043a4218e5e6000000000000000000000000440bbd6a888a36de6e2f6a25f65bc4e16874faa90000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001aa5241452041505200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000002710'
  );
  deepStrictEqual(
    d.decode(KYBER, tx6, Object.assign(kyberOpt, { amount: 0n })).hint,
    'Swap 98.765432109876543212 RAE For 0.056059083163201264 ETH (with platform fee: 0.079012345687901234 RAE)'
  );
  const kyberHint = (KYBER_NETWORK_PROXY as abi.ContractABI).find(
    (fn) => fn.type === 'function' && fn.name === 'tradeWithHintAndFee'
  )?.hint;
  if (!kyberHint) throw new Error('missing Kyber hint');
  throws(
    () =>
      kyberHint(kyberTx4.value, {
        ...kyberOpt,
        contracts: Object.assign({}, kyberOpt.contracts, {
          [ENJ]: { abi: 'ERC20', symbol: 'ENJ' },
        }),
      }),
    /Not enough info/
  );
  throws(
    () =>
      kyberHint(kyberTx4.value, {
        ...kyberOpt,
        contracts: Object.assign({}, kyberOpt.contracts, {
          [AAVE]: { abi: 'ERC20', decimals: 18 },
        }),
      }),
    /Not enough info/
  );
  const zeroSrc = '0x1111111111111111111111111111111111111111';
  const zeroDest = '0x2222222222222222222222222222222222222222';
  deepStrictEqual(
    kyberHint(
      {
        src: zeroSrc,
        srcAmount: 7n,
        dest: zeroDest,
        minConversionRate: 10n ** 18n,
        platformFeeBps: 100n,
      },
      {
        ...kyberOpt,
        contracts: Object.assign({}, kyberOpt.contracts, {
          [zeroSrc]: { abi: 'ERC20', symbol: 'ZSRC', decimals: 0 },
          [zeroDest]: { abi: 'ERC20', symbol: 'ZDST', decimals: 0 },
        }),
      }
    ),
    'Swap 7 ZSRC For 7 ZDST (with platform fee: 0 ZSRC)'
  );
  const UNISWAP3 = UNISWAP_V3_ROUTER_CONTRACT;
  d.add(UNISWAP3, UNISWAP_V3_ROUTER);
  const uni3Opt = {
    contract: UNISWAP3,
    contracts: Object.assign({}, CONTRACTS, CUSTOM_TOKENS),
    contractInfo: CONTRACTS[UNISWAP3],
  };
  const mtx0 = hex.decode(
    'ac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001c00000000000000000000000000000000000000000000000000000000000000144f28c0498000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000056bc75e2d63100000000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000042852e5427c86a3b46dd25e5fe027bb15f53c4bcb8000bb8dac17f958d2ee523a2206206994597c13d831ec7000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000412210e8a00000000000000000000000000000000000000000000000000000000'
  );
  // Multi-call signature unwrap
  deepStrictEqual(
    d.decode(UNISWAP3, mtx0, Object.assign(uni3Opt, { amount: 4308416152274164000n })),
    {
      name: 'multicall(exactOutput, refundETH)',
      signature: 'multicall(exactOutput((bytes,address,uint256,uint256,uint256)), refundETH())',
      value: [
        {
          path: hex.decode(
            '852e5427c86a3b46dd25e5fe027bb15f53c4bcb8000bb8dac17f958d2ee523a2206206994597c13d831ec7000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
          ),
          recipient: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
          deadline: 1876543210n,
          amountOut: 100000000000000000000n,
          amountInMaximum: 12345678901234567891n,
        },
        undefined,
      ],
      hint: 'Swap up to 12.345678901234567891 WETH for exact 100000 NIIFI. Expires at Tue, 19 Jun 2029 06:00:10 GMT',
    }
  );
  const multicall = (UNISWAP_V3_ROUTER as any).find((i: any) => i.name === 'multicall');
  const refundETH = (UNISWAP_V3_ROUTER as any).find((i: any) => i.name === 'refundETH');
  const unknownAbi = hex.decode('12345678');
  const multicallTx = (data: Uint8Array[]) =>
    hex.decode(abi.fnSigHash(multicall) + hex.encode(mapArgs(multicall.inputs).encode(data)));
  deepStrictEqual(d.decode(UNISWAP3, multicallTx([unknownAbi]), uni3Opt), {
    name: 'multicall(unknownAbi(0x12345678))',
    signature: 'multicall(unknownAbi(0x12345678))',
    value: [unknownAbi],
  });
  deepStrictEqual(
    d.decode(UNISWAP3, multicallTx([hex.decode(abi.fnSigHash(refundETH)), unknownAbi]), uni3Opt),
    {
      name: 'multicall(refundETH, unknownAbi(0x12345678))',
      signature: 'multicall(refundETH(), unknownAbi(0x12345678))',
      value: [undefined, unknownAbi],
    }
  );
  const tx7 = hex.decode(
    '414bf389000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000095ad61b0a150d79219dcf64e1e6cc01f0b64c4ce0000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000000'
  );
  deepStrictEqual(
    d.decode(UNISWAP3, tx7, Object.assign(uni3Opt, { amount: 12345678901234567891n })).hint,
    'Swap exact 98.765432109876543212 WETH for at least 12.345678901234567891 SHIB. Expires at Tue, 19 Jun 2029 06:00:10 GMT'
  );
  const tx8 = hex.decode(
    '414bf389000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000003301ee63fb29f863f2333bd4466acb46cd8323e60000000000000000000000000000000000000000000000000000000000002710000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000000'
  );
  deepStrictEqual(
    d.decode(UNISWAP3, tx8, Object.assign(uni3Opt, { amount: 40000000000000000n })).hint,
    'Swap exact 98.765432109876543212 WETH for at least 12.345678901234567891 AKITA. Expires at Tue, 19 Jun 2029 06:00:10 GMT'
  );
  const tx9 = hex.decode(
    '414bf389000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000000'
  );
  deepStrictEqual(
    d.decode(UNISWAP3, tx9, Object.assign(uni3Opt, { amount: 0n })).hint,
    'Swap exact 98.765432109876543212 WETH for at least 12345678901234.567891 USDC. Expires at Tue, 19 Jun 2029 06:00:10 GMT'
  );
  // TODO
  const tx10 = hex.decode(
    'c04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000055aa54d38e5267eec000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000042dac17f958d2ee523a2206206994597c13d831ec70001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb480001f457ab1ec28d129707052df4df418d58a2d46d5f51000000000000000000000000000000000000000000000000000000000000'
  );
  deepStrictEqual(
    d.decode(UNISWAP3, tx10, Object.assign(uni3Opt, { amount: 0n })).hint,
    'Swap exact 98765432109876.543212 USDT for at least 12.345678901234567891 SUSD. Expires at Tue, 19 Jun 2029 06:00:10 GMT'
  );
  const exactInput = (UNISWAP_V3_ROUTER as any).find((i: any) => i.name === 'exactInput');
  const exactInputSingle = (UNISWAP_V3_ROUTER as any).find(
    (i: any) => i.name === 'exactInputSingle'
  );
  const exactOutput = (UNISWAP_V3_ROUTER as any).find((i: any) => i.name === 'exactOutput');
  const noFeePath = hex.decode(strip0x(WETH) + strip0x(SHIB));
  const wrongFeePath = hex.decode(strip0x(WETH) + '000bb800' + strip0x(SHIB));
  throws(
    () =>
      exactInput.hint(
        {
          path: noFeePath,
          deadline: 1876543210n,
          amountIn: 12345678901234567891n,
          amountOutMinimum: 12345678901234567891n,
        },
        uni3Opt
      ),
    /Invalid Uniswap V3 path/
  );
  throws(
    () =>
      exactOutput.hint(
        {
          path: wrongFeePath,
          deadline: 1876543210n,
          amountOut: 12345678901234567891n,
          amountInMaximum: 12345678901234567891n,
        },
        uni3Opt
      ),
    /Invalid Uniswap V3 path/
  );
  const zeroIn = '0x1111111111111111111111111111111111111111';
  const zeroOut = '0x2222222222222222222222222222222222222222';
  const zeroOpt = {
    ...uni3Opt,
    contracts: Object.assign({}, uni3Opt.contracts, {
      [zeroIn]: { decimals: 0, symbol: 'ZIN' },
      [zeroOut]: { decimals: 0, symbol: 'ZOUT' },
    }),
  };
  deepStrictEqual(
    exactInputSingle.hint(
      {
        tokenIn: zeroIn,
        tokenOut: zeroOut,
        deadline: 0n,
        amountIn: 7n,
        amountOutMinimum: 9n,
      },
      zeroOpt
    ),
    'Swap exact 7 ZIN for at least 9 ZOUT. Expires at Thu, 01 Jan 1970 00:00:00 GMT'
  );
  deepStrictEqual(
    exactInput.hint(
      {
        path: hex.decode(strip0x(zeroIn) + '000bb8' + strip0x(zeroOut)),
        deadline: 0n,
        amountIn: 7n,
        amountOutMinimum: 9n,
      },
      zeroOpt
    ),
    'Swap exact 7 ZIN for at least 9 ZOUT. Expires at Thu, 01 Jan 1970 00:00:00 GMT'
  );
});
should('Decoder rejects trailing calldata for zero-arg functions', () => {
  const contract = '0x1111111111111111111111111111111111111111';
  const unknown = '0x2222222222222222222222222222222222222222';
  const ping = [{ type: 'function', name: 'ping', inputs: [], outputs: [] }] as const;
  const selector = abi.fnSigHash(ping[0]);
  const call = hex.decode(selector);
  const trailing = hex.decode(`${selector}${'00'.repeat(32)}`);
  const d = new abi.Decoder();
  d.add(contract, ping);
  deepStrictEqual(d.decode(contract, call), {
    name: 'ping',
    signature: 'ping()',
    value: undefined,
  });
  deepStrictEqual(d.decode(unknown, call), [
    {
      name: 'ping',
      signature: 'ping()',
      value: undefined,
    },
  ]);
  throws(() => d.decode(contract, trailing), /Unexpected trailing calldata/);
  deepStrictEqual(d.decode(unknown, trailing), undefined);
});
should('addHints only uses own hint-map properties', () => {
  const hint = () => 'hint';
  const a = [
    { type: 'function', name: 'transfer' },
    { type: 'event', name: 'Approval' },
    { type: 'function', name: 'toString' },
    { type: 'constructor', name: 'transfer' },
  ] as const;
  const inherited = Object.create({ transfer: hint, Approval: hint, toString: hint });
  deepStrictEqual(addHints(a, inherited), a);
  deepStrictEqual(addHints(a, { toString: hint, Approval: hint }), [
    { type: 'function', name: 'transfer' },
    { type: 'event', name: 'Approval', hint },
    { type: 'function', name: 'toString', hint },
    { type: 'constructor', name: 'transfer' },
  ]);
});
should('ERC20 hints accept zero-decimal token metadata', () => {
  const opt = { contractInfo: { decimals: 0, symbol: 'ZERO' } };
  const owner = '0x1111111111111111111111111111111111111111';
  const spender = '0x2222222222222222222222222222222222222222';
  const from = '0x3333333333333333333333333333333333333333';
  const to = '0x4444444444444444444444444444444444444444';
  deepStrictEqual(
    ERC20_HINTS.approve({ spender, value: 7n }, opt),
    `Allow spending 7 ZERO by ${spender}`
  );
  deepStrictEqual(
    ERC20_HINTS.transferFrom({ from, to, value: 7n }, opt),
    `Transfer 7 ZERO from ${from} to ${to}`
  );
  deepStrictEqual(ERC20_HINTS.transfer({ to, value: 7n }, opt), `Transfer 7 ZERO to ${to}`);
  deepStrictEqual(
    ERC20_HINTS.Approval({ owner, spender, value: 7n }, opt),
    `Allow ${spender} spending up to 7 ZERO from ${owner}`
  );
  deepStrictEqual(
    ERC20_HINTS.Transfer({ from, to, value: 7n }, opt),
    `Transfer 7 ZERO from ${from} to ${to}`
  );
});
should('WETH hints map legacy field names to ERC20 hints', () => {
  const opt = { contractInfo: { decimals: 18, symbol: 'WETH' } };
  const src = '0x1111111111111111111111111111111111111111';
  const guy = '0x2222222222222222222222222222222222222222';
  const dst = '0x3333333333333333333333333333333333333333';
  const wad = 7000000000000000000n;
  const hint = (name: string) => {
    const item = (WETH_ABI as any).find((i: any) => i.name === name);
    if (!item?.hint) throw new Error(`missing WETH hint: ${name}`);
    return item.hint;
  };
  deepStrictEqual(hint('approve')({ guy, wad }, opt), `Allow spending 7 WETH by ${guy}`);
  deepStrictEqual(
    hint('transferFrom')({ src, dst, wad }, opt),
    `Transfer 7 WETH from ${src} to ${dst}`
  );
  deepStrictEqual(hint('transfer')({ dst, wad }, opt), `Transfer 7 WETH to ${dst}`);
  deepStrictEqual(
    hint('Approval')({ src, guy, wad }, opt),
    `Allow ${guy} spending up to 7 WETH from ${src}`
  );
  deepStrictEqual(
    hint('Transfer')({ src, dst, wad }, opt),
    `Transfer 7 WETH from ${src} to ${dst}`
  );
});
should('built-in registries deep-freeze metadata and ABIs', () => {
  const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const routerABI = CONTRACTS[UNISWAP_V2_ROUTER_CONTRACT].abi as any;
  const wethABI = CONTRACTS[weth].abi as any;
  deepStrictEqual(
    {
      token: Object.isFrozen(TOKENS[usdt]),
      sharedContract: Object.isFrozen(CONTRACTS[usdt]),
      router: Object.isFrozen(CONTRACTS[UNISWAP_V2_ROUTER_CONTRACT]),
      routerABI: Object.isFrozen(routerABI),
      routerABIItem: Object.isFrozen(routerABI[0]),
      weth: Object.isFrozen(CONTRACTS[weth]),
      wethABI: Object.isFrozen(wethABI),
      wethABIItem: Object.isFrozen(wethABI[0]),
    },
    {
      token: true,
      sharedContract: true,
      router: true,
      routerABI: true,
      routerABIItem: true,
      weth: true,
      wethABI: true,
      wethABIItem: true,
    }
  );
  throws(() => ((TOKENS[usdt] as any).symbol = 'MUT'), TypeError);
  throws(() => ((CONTRACTS[usdt] as any).symbol = 'MUT'), TypeError);
  throws(() => ((CONTRACTS[UNISWAP_V2_ROUTER_CONTRACT] as any).name = 'MUT'), TypeError);
  throws(() => routerABI.push({}), TypeError);
  throws(() => (routerABI[0].name = 'MUT'), TypeError);
  throws(() => ((CONTRACTS[weth] as any).symbol = 'MUT'), TypeError);
  throws(() => wethABI.push({}), TypeError);
  throws(() => (wethABI[0].name = 'MUT'), TypeError);
  deepStrictEqual(TOKENS[usdt].symbol, 'USDT');
  deepStrictEqual(CONTRACTS[usdt].symbol, 'USDT');
  deepStrictEqual(CONTRACTS[UNISWAP_V2_ROUTER_CONTRACT].name, 'UNISWAP V2 ROUTER');
  deepStrictEqual(CONTRACTS[weth].symbol, 'WETH');
});
should('tokenFromSymbol ignores inherited token registry entries', () => {
  const key = 'evilToken';
  const prev = Object.getOwnPropertyDescriptor(Object.prototype, key);
  Object.defineProperty(Object.prototype, key, {
    value: { abi: 'ERC20', symbol: 'FAKE', decimals: 18 },
    enumerable: true,
    configurable: true,
  });
  try {
    throws(() => tokenFromSymbol('FAKE'), /unknown token/);
  } finally {
    if (prev) Object.defineProperty(Object.prototype, key, prev);
    else delete (Object.prototype as Record<string, unknown>)[key];
  }
});
should('Uniswap V2 hints accept zero-decimal route token metadata', () => {
  const swap = (UNISWAP_V2_ROUTER as any).find((i: any) => i.name === 'swapExactTokensForTokens');
  const zeroIn = '0x1111111111111111111111111111111111111111';
  const zeroOut = '0x2222222222222222222222222222222222222222';
  deepStrictEqual(
    swap.hint(
      {
        amountIn: 7n,
        amountOutMin: 9n,
        path: [zeroIn, '0x3333333333333333333333333333333333333333', zeroOut],
        deadline: 0n,
      },
      {
        contracts: {
          [zeroIn]: { decimals: 0, symbol: 'ZIN' },
          [zeroOut]: { decimals: 0, symbol: 'ZOUT' },
        },
      }
    ),
    'Swap exact 7 ZIN for at least 9 ZOUT. Expires at Thu, 01 Jan 1970 00:00:00 GMT'
  );
});
should('Uniswap V2 swapETHForExactTokens hint accepts zero ETH amount', () => {
  const swap = (UNISWAP_V2_ROUTER as any).find((i: any) => i.name === 'swapETHForExactTokens');
  const token = '0x2222222222222222222222222222222222222222';
  deepStrictEqual(
    swap.hint(
      {
        amountOut: 9000000000000000000n,
        path: ['0x1111111111111111111111111111111111111111', token],
        deadline: 0n,
      },
      {
        amount: 0n,
        contracts: { [token]: { decimals: 18, symbol: 'TOK' } },
      }
    ),
    'Swap up to 0 ETH for exact 9 TOK. Expires at Thu, 01 Jan 1970 00:00:00 GMT'
  );
});
should('Uniswap V2 swapExactETHForTokens hint accepts zero ETH amount', () => {
  const swap = (UNISWAP_V2_ROUTER as any).find((i: any) => i.name === 'swapExactETHForTokens');
  const token = '0x2222222222222222222222222222222222222222';
  deepStrictEqual(
    swap.hint(
      {
        amountOutMin: 9000000000000000000n,
        path: ['0x1111111111111111111111111111111111111111', token],
        deadline: 0n,
      },
      {
        amount: 0n,
        contracts: { [token]: { decimals: 18, symbol: 'TOK' } },
      }
    ),
    'Swap 0 ETH for at least 9 TOK. Expires at Thu, 01 Jan 1970 00:00:00 GMT'
  );
});
should('Uniswap V2 fee-on-transfer ETH swap hint accepts zero ETH amount', () => {
  const swap = (UNISWAP_V2_ROUTER as any).find(
    (i: any) => i.name === 'swapExactETHForTokensSupportingFeeOnTransferTokens'
  );
  const token = '0x2222222222222222222222222222222222222222';
  deepStrictEqual(
    swap.hint(
      {
        amountOutMin: 9000000000000000000n,
        path: ['0x1111111111111111111111111111111111111111', token],
        deadline: 0n,
      },
      {
        amount: 0n,
        contracts: { [token]: { decimals: 18, symbol: 'TOK' } },
      }
    ),
    'Swap 0 ETH for at least 9 TOK. Expires at Thu, 01 Jan 1970 00:00:00 GMT'
  );
});
describe('ABI events', () => {
  for (let k in abiTestEvents) {
    should(k, () => {
      const t = abiTestEvents[k];
      const events = abi.events(JSON.parse(t.abi));
      const ev = events[t.fn || 'testEvent'];
      deepStrictEqual(ev.decode(t.topics, t.data), t.decodeOutput, 'decode');
      deepStrictEqual(ev.topics(t.topicsInput), t.topics, 'topics');
    });
  }
});
should('ABI Events: null values', () => {
  const events = abi.events(JSON.parse(abiTestEvents.transfer.abi));
  const ev = events.Transfer;
  deepStrictEqual(
    ev.topics({ from: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', to: null, value: null }),
    [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
      null,
    ]
  );
  deepStrictEqual(
    ev.topics({ to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', from: null, value: null }),
    [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      null,
      '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
    ]
  );
});
should('ABI Events: indexed tuples with unnamed components', () => {
  const event = {
    type: 'event',
    name: 'TupleEvent',
    anonymous: false,
    inputs: [
      {
        indexed: true,
        name: 'value',
        type: 'tuple',
        components: [{ type: 'uint256' }, { type: 'address' }],
      },
    ],
  } as const;
  const addr = '0x1111111111111111111111111111111111111111';
  const encoded = bytesToHex(
    keccak_256(
      concatBytes(
        mapComponent({ type: 'uint256' }).encode(7n),
        mapComponent({ type: 'address' }).encode(addr)
      )
    )
  );
  deepStrictEqual(abi.events([event]).TupleEvent.topics({ value: [7n, addr] }), [
    `0x${abi.evSigHash(event)}`,
    `0x${encoded}`,
  ]);
});
should('ABI Events: indexed arrays of tuples', () => {
  const components = [
    { name: 'amount', type: 'uint256' },
    { name: 'account', type: 'address' },
  ] as const;
  const dynamicEvent = {
    type: 'event',
    name: 'TupleArrayEvent',
    anonymous: false,
    inputs: [{ indexed: true, name: 'values', type: 'tuple[]', components }],
  } as const;
  const staticEvent = {
    type: 'event',
    name: 'TupleStaticArrayEvent',
    anonymous: false,
    inputs: [{ indexed: true, name: 'values', type: 'tuple[2]', components }],
  } as const;
  const values = [
    { amount: 7n, account: '0x1111111111111111111111111111111111111111' },
    { amount: 8n, account: '0x2222222222222222222222222222222222222222' },
  ];
  const tuple = mapComponent({ type: 'tuple', components });
  const encoded = bytesToHex(
    keccak_256(concatBytes(tuple.encode(values[0]), tuple.encode(values[1])))
  );
  deepStrictEqual(abi.events([dynamicEvent]).TupleArrayEvent.topics({ values }), [
    `0x${abi.evSigHash(dynamicEvent)}`,
    `0x${encoded}`,
  ]);
  deepStrictEqual(abi.events([staticEvent]).TupleStaticArrayEvent.topics({ values }), [
    `0x${abi.evSigHash(staticEvent)}`,
    `0x${encoded}`,
  ]);
  throws(() =>
    abi.events([staticEvent]).TupleStaticArrayEvent.topics({ values: values.slice(0, 1) })
  );
  throws(() =>
    abi.events([staticEvent]).TupleStaticArrayEvent.topics({ values: [...values, values[0]] })
  );
});
should('ABI Events: Decoder', () => {
  const BAT = '0x0d8775f648430679a709e98d2b0cb6250d2887ef';
  let d = new abi.Decoder();
  d.add(BAT, ERC20);
  const usdtOpt = {
    contract: BAT,
    contracts: Object.assign({}, CONTRACTS),
    contractInfo: CONTRACTS[BAT],
  };
  deepStrictEqual(
    d.decodeEvent(
      BAT,
      [
        '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
        '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
        '0x000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564',
      ],
      '0x00000000000000000000000000000000000000000000003635c9adc5dea00000',
      usdtOpt
    ),
    {
      name: 'Approval',
      signature: 'Approval(address,address,uint256)',
      value: {
        value: 1000000000000000000000n,
        owner: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        spender: '0xe592427a0aece92de3edee1f18e0157c05861564',
      },
      hint: 'Allow 0xe592427a0aece92de3edee1f18e0157c05861564 spending up to 1000 BAT from 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    }
  );
});
should('ABI Events: Decoder keeps overloaded events distinct', () => {
  const contract = '0x1111111111111111111111111111111111111111';
  const overloads = [
    {
      type: 'event',
      name: 'Ping',
      anonymous: false,
      inputs: [{ indexed: false, name: 'value', type: 'uint256' }],
    },
    {
      type: 'event',
      name: 'Ping',
      anonymous: false,
      inputs: [{ indexed: false, name: 'value', type: 'address' }],
    },
  ] as const;
  const uintData = `0x${bytesToHex(mapArgs(overloads[0].inputs).encode(7n))}`;
  const address = '0x2222222222222222222222222222222222222222';
  const addressData = `0x${bytesToHex(mapArgs(overloads[1].inputs).encode(address))}`;
  const uintTopics = [`0x${abi.evSigHash(overloads[0])}`];
  const addressTopics = [`0x${abi.evSigHash(overloads[1])}`];
  const d = new abi.Decoder();
  d.add(contract, overloads);
  deepStrictEqual(d.decodeEvent(contract, uintTopics, uintData, {}), {
    name: 'Ping',
    signature: 'Ping(uint256)',
    value: { value: 7n },
  });
  deepStrictEqual(d.decodeEvent(contract, addressTopics, addressData, {}), {
    name: 'Ping',
    signature: 'Ping(address)',
    value: { value: address },
  });
  deepStrictEqual(
    d.decodeEvent('0x3333333333333333333333333333333333333333', uintTopics, uintData, {}),
    [
      {
        name: 'Ping',
        signature: 'Ping(uint256)',
        value: { value: 7n },
      },
    ]
  );
});

should('example/libra', async () => {
  let d = new abi.Decoder();
  const UNISWAP = UNISWAP_V2_ROUTER_CONTRACT;
  d.add(UNISWAP, UNISWAP_V2_ROUTER);
  const LABRA = '0x106d3c66d22d2dd0446df23d7f5960752994d600';

  const CUSTOM_TOKENS = {
    [LABRA]: { abi: 'ERC20', symbol: 'LABRA', decimals: 9 },
  };
  const uniOpt = {
    contract: UNISWAP,
    contracts: Object.assign({}, CONTRACTS, CUSTOM_TOKENS),
    contractInfo: CONTRACTS[UNISWAP],
  };
  const tx0 = hex.decode(
    '7ff36ab5000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000080000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000106d3c66d22d2dd0446df23d7f5960752994d600'
  );
  deepStrictEqual(
    d.decode(UNISWAP, tx0, Object.assign(uniOpt, { amount: 100000000000000000n })).hint,
    'Swap 0.1 ETH for at least 12345678901.234567891 LABRA. Expires at Tue, 19 Jun 2029 06:00:10 GMT'
  );
  // console.log(d.decode(UNISWAP, tx0, Object.assign(uniOpt, { amount: 100000000000000000n })));
});

should('ABI integer inputs reject unsafe numbers', () => {
  const unsafe = Number.MAX_SAFE_INTEGER + 1;
  const uint = mapComponent(unwrapTestType('uint256'));
  const int = mapComponent(unwrapTestType('int256'));
  deepStrictEqual(uint.encode(7 as unknown as bigint), uint.encode(7n));
  deepStrictEqual(int.encode(-7 as unknown as bigint), int.encode(-7n));
  throws(() => uint.encode(unsafe as unknown as bigint));
  throws(() => int.encode(-unsafe as unknown as bigint));
});

should('ZST', () => {
  const payload = hex.decode(
    '000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000FFFFFFFF'
  );
  const TYPES = {
    // Will crash (fixed size, but very big)
    'uint256[0][4294967295]': unwrapTestType('uint256[0][4294967295]'),
    'uint32[0][4294967295]': unwrapTestType('uint32[0][4294967295]'),
    // Make sure that it won't crash
    'uint256[4294967295][4294967295]': unwrapTestType('uint256[4294967295][4294967295]'),
    'uint32[4294967295][4294967295]': unwrapTestType('uint32[4294967295][4294967295]'),
    'uint256[0][]': unwrapTestType('uint32[0][]'),
    'uint256[0][]': unwrapTestType('uint32[0][]'),
    '()[]': { type: 'tuple[]', components: [] }, // not supported in test methods
    '(())[]': { type: 'tuple[]', components: [{ type: 'tuple', components: [] }] },
    '(uint32[0])[]': { type: 'tuple[]', components: [{ type: 'uint32[0]' }] },
    '((uint32[0]))[]': {
      type: 'tuple[]',
      components: [{ type: 'tuple', components: [{ type: 'uint32[0]' }] }],
    },
  };

  for (const type in TYPES) {
    // it would crash process before
    throws(() => mapComponent(TYPES[type]).decode(payload));
  }
  // Empty tuples are disabled too; no built-in ABI needs them, and arrays of ZSTs can DoS decoding.
  const emptyTuple = { type: 'tuple', components: [] } as const;
  throws(() => mapComponent(emptyTuple));
  throws(() => abi.fnSigHash({ type: 'function', name: 'f', inputs: [emptyTuple] }));
  throws(() => abi.fnSigHash({ type: 'event', name: 'E', inputs: [emptyTuple] }));
  throws(() => mapComponent({ type: 'tuple[]', components: [] }));
  throws(() => mapComponent({ type: 'tuple[2]', components: [] }));
  deepStrictEqual(
    mapComponent({ type: 'uint32[]' }).encode([]),
    new Uint8Array([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0,
    ])
  );
});

should('Recursive ptrs', () => {
  //const EPad = (p) => P.padLeft(32, p, P.ZeroPad);
  //const PTR = EPad(P.U32BE);
  const arr2 = mapComponent(unwrapTestType('uint256[][]'));
  const arr4 = mapComponent(unwrapTestType('uint256[][][][]'));
  const arr10 = mapComponent(unwrapTestType('uint256[][][][][][][][][][]'));
  const a = [[], [], [], [], [], [], [], [], [], []];
  const p = arr2.encode(a);
  const ptrArr = mapComponent(unwrapTestType('uint256[]'));
  deepStrictEqual(
    hex.encode(p),

    '0000000000000000000000000000000000000000000000000000000000000020' + // ptr
      '000000000000000000000000000000000000000000000000000000000000000a' + // len=10
      '0000000000000000000000000000000000000000000000000000000000000140' +
      '0000000000000000000000000000000000000000000000000000000000000160' +
      '0000000000000000000000000000000000000000000000000000000000000180' +
      '00000000000000000000000000000000000000000000000000000000000001a0' +
      '00000000000000000000000000000000000000000000000000000000000001c0' +
      '00000000000000000000000000000000000000000000000000000000000001e0' +
      '0000000000000000000000000000000000000000000000000000000000000200' +
      '0000000000000000000000000000000000000000000000000000000000000220' +
      '0000000000000000000000000000000000000000000000000000000000000240' +
      '0000000000000000000000000000000000000000000000000000000000000260' + // ptrs end (10)
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' +
      '0000000000000000000000000000000000000000000000000000000000000000' // 10 values
  );
  const a2 = ptrArr.decode(p, { allowUnreadBytes: true }); // we need to read only ptrs, not values);

  // 0x20 == 32
  const changePtr = ptrArr.encode(a2.map((i) => 32n));
  // default PoC
  const payload =
    '0000000000000000000000000000000000000000000000000000000000000020' +
    '000000000000000000000000000000000000000000000000000000000000000a' +
    '0000000000000000000000000000000000000000000000000000000000000020'.repeat(64);
  throws(() => arr10.decode(hex.decode(payload)));
  // Try to break check
  const p2 = hex.encode(
    ptrArr.encode(Array.from({ length: 10 * 1024 }, (i, j) => BigInt(j + 1) * 32n))
  );
  // Kinda slow, but input is 320 kb
  throws(() => arr10.decode(hex.decode(p2)));
  throws(() => arr4.decode(hex.decode(p2)));
  throws(() => arr2.decode(hex.decode(p2)));
});

should('Recursive ptrs2', () => {
  const arr10 = mapComponent(unwrapTestType('uint256[][][][][][][][][][]'));
  const a = [[], [], [], [], [], [], [], [], [], []];
  const ptrArr = mapComponent(unwrapTestType('uint256[]'));
  const mainPtr = hex.encode(ptrArr.encode(a.map((_, i) => BigInt(a.length - i + 1) * 32n)));
  throws(() => arr10.decode(hex.decode(mainPtr.repeat(10 + 1))));
});

should('ABI dynamic words reject high bits', () => {
  const str = mapComponent(unwrapTestType('string'));
  const arr = mapComponent(unwrapTestType('uint256[]'));
  const high = '0000000000000000000000000000000000000000000000010000000000000020';
  const tail =
    '0000000000000000000000000000000000000000000000000000000000000003' + '616263'.padEnd(64, '0');
  throws(() => str.decode(hex.decode(high + tail)));
  throws(() => arr.decode(hex.decode(high + tail)));
});

should('Interleave ptrs', () => {
  const ptrArr = mapComponent(unwrapTestType('uint256[]'));
  const raw = P.array(null, P.U256BE);
  const arr2 = mapComponent(unwrapTestType('uint256[][]'));

  const getArr = (length) => {
    const arr = Array.from({ length }, (i, j) => BigInt(length - j) * 32n);

    // 10: 32 * (length + 256 + 2*length +2)
    // 11: 32 * (length + 256 + 5*length+3)
    // 12: 32 * (length + 256 + 8*lenght+4)
    //    return hex.encode(ptrArr.encode(arr)) + '00'.repeat(32 * (30 * length + 3));

    const repeats = {
      4: 47, // 6kb -> 6kb (+0x)
      8: 109, // 15kb -> 30kb (+1x)
      16: 233, // 30kb -> 123kb (+3x)
      32: 481, // 63kb -> 510kb (+7x)
      64: 977, // 129kb -> 2mb (+15x)
      128: 1969, // 260kb -> 8mb (+31x)
      256: 3953, // 522kb -> 33mb (+63x)
      512: 7921, // 1mb -> 133mb (+127x)
      1024: 15857, // 2mb -> 533mb (+255x)
      2048: 32000, // 4mb -> 2gb (+511x)
      4096: 64000, // 8mb -> est: 8gb (+1023x)
    };

    return hex.encode(ptrArr.encode(arr)) + '00'.repeat(32 * 2 * repeats[length]);
  };

  for (const l of [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096]) {
    const ptrEnc = getArr(l);
    // console.log('encoding ptr', l, ptrEnc.length);
    //console.log('PTR', ptrArr.decode(hex.decode(ptrEnc)));
    //console.log('RAW', raw.decode(hex.decode(ptrEnc)));
    throws(() => arr2.encode(arr2.decode(hex.decode(ptrEnc))));
    // will bypass check, very slow and crash at the end)
    const TRY_POC = false;
    if (TRY_POC) {
      const realSz = arr2.encode(
        arr2.decode(hex.decode(ptrEnc), { allowMultipleReads: true })
      ).length;
      // console.log('REAL', realSz);
      // console.log(
      //   'DIFF',
      //   realSz - ptrEnc.length,
      //   `+${Math.floor((realSz - ptrEnc.length) / ptrEnc.length)}x`
      // );
      // console.log(
      //   'ARR2',
      //   arr2.decode(hex.decode(ptrEnc)).map((i) => i.length)
      // );
    }
  }
});

should('Junk data', () => {
  const t = mapComponent(unwrapTestType('uint256[]'));
  const DATA = [1n, 2n, 3n, 4n];
  const encoded = hex.encode(t.encode(DATA));
  const dataWithFingerpint = encoded + '11'.repeat(32);
  // by default: catch unread bytes even with pointers!
  throws(() => t.decode(hex.decode(dataWithFingerpint)));
  // allow to read tx if user insists
  const decoded = t.decode(hex.decode(dataWithFingerpint), { allowUnreadBytes: true });
  deepStrictEqual(decoded, DATA);
});

should('Junk data from real tx', () => {
  // https://etherscan.io/tx/0x62d0afd1d7815ee9b2da236ddc6af07386072acea20eef27497ad29e37533fdd
  const tx =
    '7ff36ab50000000000000000000000000000000000000000000000164054d8356b4f5c2800000000000000000000000000000000000000000000000000000000000000800000000000000000000000006994ece772cc4abb5c9993c065a34c94544a40870000000000000000000000000000000000000000000000000000000062b348620000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000106d3c66d22d2dd0446df23d7f5960752994d6007a6572696f6e';
  // uniswap v2
  const ABI = [
    {
      inputs: [
        { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
        { internalType: 'address[]', name: 'path', type: 'address[]' },
        { internalType: 'address', name: 'to', type: 'address' },
        { internalType: 'uint256', name: 'deadline', type: 'uint256' },
      ],
      name: 'swapExactETHForTokens',
      outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
      stateMutability: 'payable',
      type: 'function',
    },
  ];
  const sh = abi.fnSigHash(ABI[0]);
  const inputs = mapArgs(ABI[0].inputs);
  const txBytes = hex.decode(tx);

  const txSigHash = hex.encode(txBytes.slice(0, 4));
  const txData = txBytes.slice(4);
  // verify function signature hash to make sure we decode correct ABI
  deepStrictEqual(sh, txSigHash);
  // Error: Reader(): unread byte ranges: (224/6)[7a6572696f6e] (total=230)
  throws(() => inputs.decode(txData));
  const params = inputs.decode(txData, { allowUnreadBytes: true });
  /*
  Exactly same data as shown in etherscan:
  {
  amountOutMin: 410463937262026447912n,
  path: [
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    '0x106d3c66d22d2dd0446df23d7f5960752994d600'
  ],
  to: '0x6994ece772cc4abb5c9993c065a34c94544a4087',
  deadline: 1655916642n
  }
  */

  // Lets try manual decoding

  deepStrictEqual(
    tx,
    '7ff36ab5' + // function signature hash
      /*  00 */ '0000000000000000000000000000000000000000000000164054d8356b4f5c28' + // amountMin 410463937262026447912n in hex (uint256be)
      /*  32 */ '0000000000000000000000000000000000000000000000000000000000000080' + // array pointer (128 byte)
      /*  64 */ '0000000000000000000000006994ece772cc4abb5c9993c065a34c94544a4087' + // to param
      /*  96 */ '0000000000000000000000000000000000000000000000000000000062b34862' + // deadline (1655916642n in hex)
      /* 128 */ '0000000000000000000000000000000000000000000000000000000000000002' + // array length (array pointer points here)
      /* 160 */ '000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' + // first element of path
      /* 192 */ '000000000000000000000000106d3c66d22d2dd0446df23d7f5960752994d600' + // second element of path
      /* 224 */ '7a6572696f6e' // fingerprint! (or memory leak, or whatever). 6 bytes
  );
  // Encoded version doesn't include last 6 bytes, but is identical otherwise
  deepStrictEqual(hex.encode(inputs.encode(params)), tx.slice(8, -12));
  // '0000000000000000000000000000000000000000000000164054d8356b4f5c28' +
  // '0000000000000000000000000000000000000000000000000000000000000080' +
  // '0000000000000000000000006994ece772cc4abb5c9993c065a34c94544a4087' +
  // '0000000000000000000000000000000000000000000000000000000062b34862' +
  // '0000000000000000000000000000000000000000000000000000000000000002' +
  // '000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' +
  // '000000000000000000000000106d3c66d22d2dd0446df23d7f5960752994d600'
});

describe('simple decoder API', () => {
  should('decodeData', () => {
    // tx hash: 0x6fd66d7b306f77fc01a397f55d4efe19256458badd8782d523d06ed450851d0a
    const to0 = '0xdac17f958d2ee523a2206206994597c13d831ec7'; // USDT, but we don't know that. It is part of tx
    const data =
      'a9059cbb000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec70000000000000000000000000000000000000000000000000000000542598700';
    deepStrictEqual(decodeData(to0, data), {
      name: 'transfer',
      signature: 'transfer(address,uint256)',
      value: {
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        value: 22588000000n,
      },
      hint: 'Transfer 22588 USDT to 0xdac17f958d2ee523a2206206994597c13d831ec7',
    });
  });
  should('decodeData with custom tokens', () => {
    // User defines other tokens
    const customContracts = {
      '0x106d3c66d22d2dd0446df23d7f5960752994d600': { abi: 'ERC20', symbol: 'LABRA', decimals: 9 },
    };
    // Uniswap v2 router contract, but user doesn't know it. It was part of tx.
    const to = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d';
    const data =
      '7ff36ab5000000000000000000000000000000000000000000000000ab54a98ceb1f0ad30000000000000000000000000000000000000000000000000000000000000080000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045000000000000000000000000000000000000000000000000000000006fd9c6ea0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000106d3c66d22d2dd0446df23d7f5960752994d600';

    deepStrictEqual(decodeData(to, data, 100000000000000000n, { customContracts }), {
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
      hint: 'Swap 0.1 ETH for at least 12345678901.234567891 LABRA. Expires at Tue, 19 Jun 2029 06:00:10 GMT',
    });
    // Without information about custom contracts/tokens there is no hint, but we still try to decode what we can
    deepStrictEqual(decodeData(to, data, 100000000000000000n), {
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
    });
  });
  should('decodeData ignores inherited custom contract entries', () => {
    const to = '0x1111111111111111111111111111111111111111';
    const data =
      '0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222' +
      '0000000000000000000000000000000000000000000000000000000000000007';
    const customContracts = Object.create({
      [to]: { abi: 'ERC20', symbol: 'FAKE', decimals: 18 },
    });
    deepStrictEqual(
      decodeData(to, data, undefined, { noDefault: true, customContracts }),
      undefined
    );
  });
  should('decodeTx', () => {
    // tx hash 0x6fd66d7b306f77fc01a397f55d4efe19256458badd8782d523d06ed450851d0a
    const tx =
      '0xf8a901851d1a94a20082c12a94dac17f958d2ee523a2206206994597c13d831ec780b844a9059cbb000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000000000000000000000000000000000054259870025a066fcb560b50e577f6dc8c8b2e3019f760da78b4c04021382ba490c572a303a42a0078f5af8ac7e11caba9b7dc7a64f7bdc3b4ce1a6ab0a1246771d7cc3524a7200';
    // Decode tx information
    deepStrictEqual(decodeTx(tx), {
      name: 'transfer',
      signature: 'transfer(address,uint256)',
      value: {
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        value: 22588000000n,
      },
      hint: 'Transfer 22588 USDT to 0xdac17f958d2ee523a2206206994597c13d831ec7',
    });
  });
  should('decodeTx ignores contract creation transactions', () => {
    const tx =
      '0x02f8500180010182cf0880808260ffc080a0eb34cd1e43ec7a160d1e830eb7252370ef598c904131473d3720bb909b0c14b9a05d626dccdae1507c37adeaf0d3356e5f1831b5a86b445ebdf2c313951fb1b43e';
    deepStrictEqual(decodeTx(tx), undefined);
  });
  should('decodeEvent', () => {
    const to = '0x0d8775f648430679a709e98d2b0cb6250d2887ef'; // BAT, but user doesn't know that!
    const topics = [
      '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
      '0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
      '0x000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564',
    ];
    const data = '0x00000000000000000000000000000000000000000000003635c9adc5dea00000';
    deepStrictEqual(decodeEvent(to, topics, data), {
      name: 'Approval',
      signature: 'Approval(address,address,uint256)',
      value: {
        value: 1000000000000000000000n,
        owner: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
        spender: '0xe592427a0aece92de3edee1f18e0157c05861564',
      },
      hint: 'Allow 0xe592427a0aece92de3edee1f18e0157c05861564 spending up to 1000 BAT from 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    });
  });
  should('decodeEvent with custom ERC1155 tag', () => {
    const to = '0x1111111111111111111111111111111111111111';
    const topics = [
      '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
      '0x0000000000000000000000003333333333333333333333333333333333333333',
      '0x0000000000000000000000004444444444444444444444444444444444444444',
      '0x0000000000000000000000005555555555555555555555555555555555555555',
    ];
    const data =
      '0x0000000000000000000000000000000000000000000000000000000000000007' +
      '0000000000000000000000000000000000000000000000000000000000000009';
    deepStrictEqual(
      decodeEvent(to, topics, data, {
        noDefault: true,
        customContracts: { [to]: { abi: 'ERC1155' } },
      }),
      {
        name: 'TransferSingle',
        signature: 'TransferSingle(address,address,address,uint256,uint256)',
        value: {
          operator: '0x3333333333333333333333333333333333333333',
          from: '0x4444444444444444444444444444444444444444',
          to: '0x5555555555555555555555555555555555555555',
          id: 7n,
          value: 9n,
        },
      }
    );
  });
  should('decoding receipts', () => {
    // Random example from 'https://docs.alchemy.com/reference/eth-gettransactionreceipt'
    const result = {
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
    };
    const res = result.logs.map((log) => ({
      data: decodeData(log.address, log.data),
      event: decodeEvent(log.address, log.topics, log.data),
    }));
    deepStrictEqual(res, [
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
    ]);
  });
  describe('contract create', () => {
    should('accepts omitted or undefined args for constructors without inputs', () => {
      const bytecode = '0x00';
      const empty = [{ type: 'constructor', stateMutability: 'nonpayable' }] as const;
      deepStrictEqual(
        deployContract(
          [{ type: 'constructor', inputs: [], stateMutability: 'nonpayable' }] as const,
          bytecode
        ),
        bytecode
      );
      deepStrictEqual(deployContract(empty, bytecode), bytecode);
      deepStrictEqual(deployContract(empty, bytecode, undefined), bytecode);
    });
    should('rejects concrete args for constructors without inputs', () => {
      const bytecode = '0x00';
      const empty = [{ type: 'constructor', stateMutability: 'nonpayable' }] as const;
      throws(() => deployContract(empty, bytecode, 0n));
      throws(() => deployContract(empty, bytecode, {}));
      throws(() => deployContract(empty, bytecode, []));
    });
    should('basic', () => {
      // Empty constructor
      deepStrictEqual(
        deployContract(
          [{ type: 'constructor', inputs: [], stateMutability: 'nonpayable' }],
          '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea2646970667358221220116554d4ba29ee08da9e97dc54ff9a2a65d67a648140d616fc225a25ff08c86364736f6c63430008070033'
        ),
        '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea2646970667358221220116554d4ba29ee08da9e97dc54ff9a2a65d67a648140d616fc225a25ff08c86364736f6c63430008070033'
      );
      deepStrictEqual(
        deployContract(
          [{ type: 'constructor', stateMutability: 'nonpayable' }],
          '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea2646970667358221220116554d4ba29ee08da9e97dc54ff9a2a65d67a648140d616fc225a25ff08c86364736f6c63430008070033'
        ),
        '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea2646970667358221220116554d4ba29ee08da9e97dc54ff9a2a65d67a648140d616fc225a25ff08c86364736f6c63430008070033'
      );
      deepStrictEqual(
        deployContract(
          [
            {
              type: 'constructor',
              inputs: [{ name: 'a', type: 'uint256' }],
              stateMutability: 'nonpayable',
            },
          ],
          '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea2646970667358221220116554d4ba29ee08da9e97dc54ff9a2a65d67a648140d616fc225a25ff08c86364736f6c63430008070033',
          69420n
        ),
        '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea2646970667358221220116554d4ba29ee08da9e97dc54ff9a2a65d67a648140d616fc225a25ff08c86364736f6c634300080700330000000000000000000000000000000000000000000000000000000000010f2c'
      );
      // No constructor
      throws(() =>
        deployContract(
          [{}],
          '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea2646970667358221220116554d4ba29ee08da9e97dc54ff9a2a65d67a648140d616fc225a25ff08c86364736f6c63430008070033',
          69420n
        )
      );
      // Arguments to constructor without any
      throws(() =>
        deployContract(
          [{ type: 'constructor', stateMutability: 'nonpayable' }],
          '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea2646970667358221220116554d4ba29ee08da9e97dc54ff9a2a65d67a648140d616fc225a25ff08c86364736f6c63430008070033',
          69420n
        )
      );
      throws(() =>
        deployContract(
          [{ type: 'constructor', inputs: undefined, stateMutability: 'nonpayable' }],
          '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052600080fdfea2646970667358221220116554d4ba29ee08da9e97dc54ff9a2a65d67a648140d616fc225a25ff08c86364736f6c63430008070033',
          69420n
        )
      );
    });
  });
});

should.runWhen(import.meta.url);
