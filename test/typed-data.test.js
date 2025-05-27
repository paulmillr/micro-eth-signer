import { keccak_256 } from '@noble/hashes/sha3.js';
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, should } from 'micro-should';
import { deepStrictEqual, throws } from 'node:assert';
import { addr } from '../esm/address.js';
import * as typed from '../esm/typed-data.js';
import { jsonGZ } from './util.js';

const typedData = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
    ],
  },
  primaryType: 'Mail',
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: 1,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  message: {
    from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
    to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
    contents: 'Hello, Bob!',
  },
};

describe('typedData (EIP-712)', () => {
  // Stolen from EIP itself
  should('Basic', () => {
    const privateKey = keccak_256(utf8ToBytes('cow'));
    const address = addr.fromPrivateKey(privateKey);
    deepStrictEqual(address, '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826');
    deepStrictEqual(
      typed.encodeData(typedData),
      '0xa0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2fc71e5fa27ff56c350aa531bc129ebdf613b772b6604664f5d8dbe21b85eb0c8cd54f074a4af31b4411ff6a60c9719dbd559c221c8ac3492d9d872b041d703d1b5aadf3154a261abdd9086fc627b61efca26ae5702701d05cd2305f7c52a2fc8'
    );
    const e = typed.encoder(typedData.types, typedData.domain);
    deepStrictEqual(
      e._getHash(typedData.primaryType, typedData.message),
      '0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2'
    );
    const sig =
      '0x4355c47d63924e8a72e509b65029052eb6c299d53a04e167c5775fd466751c9d' +
      '07299936d304c153f6443dfa05f40ff007d72911b6f72307f996231605b91562' +
      (28).toString(16);
    deepStrictEqual(e.sign(typedData.primaryType, typedData.message, privateKey, false), sig);
    deepStrictEqual(e.verify(typedData.primaryType, sig, typedData.message, address), true);
    deepStrictEqual(e.recoverPublicKey(typedData.primaryType, sig, typedData.message), address);
    // Utils
    deepStrictEqual(typed.signTyped(typedData, privateKey, false), sig);
    deepStrictEqual(typed.verifyTyped(sig, typedData, address), true);
    deepStrictEqual(typed.recoverPublicKeyTyped(sig, typedData), address);
  });

  describe('Utils', () => {
    const { parseType, getDependencies, getTypes, encoder } = typed._TEST;
    should('parseType', () => {
      deepStrictEqual(parseType('string'), {
        base: 'string',
        item: 'string',
        arrayLen: undefined,
        type: 'dynamic',
        isArray: false,
      });
      deepStrictEqual(parseType('string[]'), {
        base: 'string',
        item: 'string',
        arrayLen: undefined,
        type: 'dynamic',
        isArray: true,
      });
      deepStrictEqual(parseType('string[3]'), {
        base: 'string',
        item: 'string',
        arrayLen: 3,
        type: 'dynamic',
        isArray: true,
      });
      deepStrictEqual(parseType('string[][4][][5]'), {
        base: 'string',
        item: 'string[][4][]',
        arrayLen: 5,
        type: 'dynamic',
        isArray: true,
      });
      deepStrictEqual(parseType('string[][][][][]'), {
        base: 'string',
        item: 'string[][][][]',
        arrayLen: undefined,
        type: 'dynamic',
        isArray: true,
      });
      deepStrictEqual(parseType('string[][][][][][9999]'), {
        base: 'string',
        item: 'string[][][][][]',
        arrayLen: 9999,
        type: 'dynamic',
        isArray: true,
      });
      deepStrictEqual(parseType('bytes32]'), {
        base: 'bytes32]',
        item: 'bytes32]',
        arrayLen: undefined,
        type: 'struct',
        isArray: false,
      });
      deepStrictEqual(parseType('Person'), {
        base: 'Person',
        item: 'Person',
        arrayLen: undefined,
        type: 'struct',
        isArray: false,
      });
      deepStrictEqual(parseType('Person[]'), {
        base: 'Person',
        item: 'Person',
        arrayLen: undefined,
        type: 'struct',
        isArray: true,
      });
      deepStrictEqual(parseType('bytes32'), {
        base: 'bytes32',
        item: 'bytes32',
        arrayLen: undefined,
        type: 'atomic',
        isArray: false,
      });
      deepStrictEqual(parseType('bool'), {
        base: 'bool',
        item: 'bool',
        arrayLen: undefined,
        type: 'atomic',
        isArray: false,
      });
      deepStrictEqual(parseType('address'), {
        base: 'address',
        item: 'address',
        arrayLen: undefined,
        type: 'atomic',
        isArray: false,
      });
      deepStrictEqual(parseType('uint256'), {
        base: 'uint256',
        item: 'uint256',
        arrayLen: undefined,
        type: 'atomic',
        isArray: false,
      });
      // These may be valid structs in theory, but probably mistake.
      throws(() => parseType('uint255'));
      throws(() => parseType('uint7'));
      throws(() => parseType('string['));

      throws(() => parseType('string[abc]'));
      throws(() => parseType('string[0xab]'));
    });
    should('getDependencies', () => {
      deepStrictEqual(
        getDependencies({
          Person: [
            { name: 'name', type: 'string' },
            { name: 'wallet', type: 'address' },
          ],
          Mail: [
            { name: 'from', type: 'Person' },
            { name: 'to', type: 'Person' },
            { name: 'contents', type: 'string' },
          ],
        }),
        {
          Mail: new Set(['Person']),
          Person: new Set(),
        }
      );
      deepStrictEqual(
        getDependencies({
          Order: [
            { name: 'customer', type: 'Customer' },
            { name: 'products', type: 'Product[]' },
            { name: 'shippingAddress', type: 'Address' },
          ],
          Customer: [
            { name: 'name', type: 'string' },
            { name: 'address', type: 'Address' },
          ],
          Product: [
            { name: 'id', type: 'string' },
            { name: 'price', type: 'uint256' },
          ],
          Address: [
            { name: 'street', type: 'string' },
            { name: 'city', type: 'string' },
          ],
        }),
        {
          Order: new Set(['Customer', 'Product', 'Address']),
          Customer: new Set(['Address']),
          Product: new Set(),
          Address: new Set(),
        }
      );
      deepStrictEqual(
        getDependencies({
          Company: [
            { name: 'name', type: 'string' },
            { name: 'departments', type: 'Department[]' },
          ],
          Department: [
            { name: 'name', type: 'string' },
            { name: 'employees', type: 'Employee[]' },
          ],
          Employee: [
            { name: 'name', type: 'string' },
            { name: 'address', type: 'Address' },
            { name: 'role', type: 'Role' },
          ],
          Address: [
            { name: 'street', type: 'string' },
            { name: 'city', type: 'string' },
          ],
          Role: [
            { name: 'title', type: 'string' },
            { name: 'level', type: 'uint256' },
          ],
        }),
        {
          Company: new Set(['Department', 'Employee', 'Address', 'Role']),
          Department: new Set(['Employee', 'Address', 'Role']),
          Employee: new Set(['Address', 'Role']),
          Address: new Set(),
          Role: new Set(),
        }
      );
      deepStrictEqual(
        getDependencies({
          Name: [
            { name: 'first', type: 'string' },
            { name: 'last', type: 'string' },
          ],
          Person: [
            { name: 'name', type: 'Name' },
            { name: 'wallet', type: 'address' },
            { name: 'favoriteColors', type: 'string[3]' },
            { name: 'foo', type: 'uint256' },
            { name: 'age', type: 'uint8' },
            { name: 'isCool', type: 'bool' },
          ],
          Mail: [
            { name: 'timestamp', type: 'uint256' },
            { name: 'from', type: 'Person' },
            { name: 'to', type: 'Person' },
            { name: 'contents', type: 'string' },
            { name: 'hash', type: 'bytes' },
          ],
        }),
        {
          Person: new Set(['Name']),
          Mail: new Set(['Person', 'Name']),
          Name: new Set([]),
        }
      );
      // A -> B -> C -> D
      deepStrictEqual(
        getDependencies({
          A: [{ name: 'b', type: 'B' }],
          B: [{ name: 'c', type: 'C' }],
          C: [{ name: 'a', type: 'D' }],
          D: [{ name: 'value', type: 'uint256' }],
        }),
        {
          A: new Set(['B', 'C', 'D']),
          B: new Set(['C', 'D']),
          C: new Set(['D']),
          D: new Set(),
        }
      );
      // Cycle A -> B -> C -> A
      deepStrictEqual(
        getDependencies({
          A: [{ name: 'b', type: 'B' }],
          B: [{ name: 'c', type: 'C' }],
          C: [{ name: 'a', type: 'A[]' }],
          D: [{ name: 'value', type: 'uint256' }],
        }),
        {
          A: new Set(['B', 'C']),
          B: new Set(['A', 'C']),
          C: new Set(['A', 'B']),
          D: new Set(),
        }
      );
    });
    should('getTypes', () => {
      deepStrictEqual(
        getTypes({
          Person: [
            { name: 'name', type: 'string' },
            { name: 'wallet', type: 'address' },
          ],
          Mail: [
            { name: 'from', type: 'Person' },
            { name: 'to', type: 'Person' },
            { name: 'contents', type: 'string' },
          ],
        }),
        {
          names: {
            Person: 'Person(string name,address wallet)',
            Mail: 'Mail(Person from,Person to,string contents)',
          },
          fullNames: {
            Person: 'Person(string name,address wallet)',
            Mail: 'Mail(Person from,Person to,string contents)Person(string name,address wallet)',
          },
          hashes: {
            Person: hexToBytes('b9d8c78acf9b987311de6c7b45bb6a9c8e1bf361fa7fd3467a2163f994c79500'),
            Mail: hexToBytes('a0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2'),
          },
          fields: {
            Person: new Set(['name', 'wallet']),
            Mail: new Set(['from', 'to', 'contents']),
          },
        }
      );
    });
    should('encoder', () => {
      const e = encoder(typedData.types, typedData.domain);
      deepStrictEqual(
        e.encodeData('Mail', typedData.message),
        '0xa0cedeb2dc280ba39b857546d74f5549c3a1d7bdc2dd96bf881f76108e23dac2fc71e5fa27ff56c350aa531bc129ebdf613b772b6604664f5d8dbe21b85eb0c8cd54f074a4af31b4411ff6a60c9719dbd559c221c8ac3492d9d872b041d703d1b5aadf3154a261abdd9086fc627b61efca26ae5702701d05cd2305f7c52a2fc8'
      );
      deepStrictEqual(
        e.structHash(typedData.primaryType, typedData.message),
        '0xc52c0ee5d84264471806290a3f2c4cecfc5490626bf912d01f240d7a274b371e'
      );
      deepStrictEqual(
        e.structHash('EIP712Domain', typedData.domain),
        '0xf2cee375fa42b42143804025fc449deafd50cc031ca257e0b194a650a912090f'
      );
    });
  });
  describe('personal', () => {
    should('Basic', () => {
      deepStrictEqual(
        typed.personal._getHash('Hello World'),
        '0xa1de988600a42c4b4ab089b619297c17d53cffae5d5120d82d8a92d0bb3b78f2'
      );
      deepStrictEqual(
        typed.personal._getHash(new Uint8Array([0x42, 0x43])),
        '0x0d3abc18ec299cf9b42ba439ac6f7e3e6ec9f5c048943704e30fc2d9c7981438'
      );
      deepStrictEqual(
        typed.personal._getHash('0x4243'),
        '0x6d91b221f765224b256762dcba32d62209cf78e9bebb0a1b758ca26c76db3af4'
      );
    });
    should('Sign', () => {
      const privateKey = hexToBytes(
        '4af1bceebf7f3634ec3cff8a2c38e51178d5d4ce585c52d6043e5e2cc3418bb0'
      );
      const address = addr.fromPrivateKey(privateKey);
      const message = 'Hello, world!';
      const sig = typed.personal.sign(message, privateKey, false);
      deepStrictEqual(
        sig,
        '0x90a938f7457df6e8f741264c32697fc52f9a8f867c52dd70713d9d2d472f2e415d9c94148991bbe1f4a1818d1dff09165782749c877f5cf1eff4ef126e55714d1c'
      );
      deepStrictEqual(typed.personal.verify(sig, message, address), true);
      deepStrictEqual(typed.personal.recoverPublicKey(sig, message), address);
    });
    should('more tests (based on @metamask/eth-sig-util)', () => {
      const VECTORS = [
        {
          message: utf8ToBytes('hello world'),
          signature:
            '0xce909e8ea6851bc36c007a0072d0524b07a3ff8d4e623aca4c71ca8e57250c4d0a3fc38fa8fbaaa81ead4b9f6bd03356b6f8bf18bccad167d78891636e1d69561b',
          address: '0xbe93f9bacbcffc8ee6663f2647917ed7a20a57bb',
          key: hexToBytes('6969696969696969696969696969696969696969696969696969696969696969'),
        },
        {
          message: hexToBytes('0cc175b9c0f1b6a831c399e26977266192eb5ffee6ae2fec3ad71c777531578f'),
          signature:
            '0x9ff8350cc7354b80740a3580d0e0fd4f1f02062040bc06b893d70906f8728bb5163837fd376bf77ce03b55e9bd092b32af60e86abce48f7b8d3539988ee5a9be1c',
          address: '0xbe93f9bacbcffc8ee6663f2647917ed7a20a57bb',
          key: hexToBytes('6969696969696969696969696969696969696969696969696969696969696969'),
        },
        {
          message: hexToBytes('0cc175b9c0f1b6a831c399e26977266192eb5ffee6ae2fec3ad71c777531578f'),
          signature:
            '0xa2870db1d0c26ef93c7b72d2a0830fa6b841e0593f7186bc6c7cc317af8cf3a42fda03bd589a49949aa05db83300cdb553116274518dbe9d90c65d0213f4af491b',
          address: '0xe0da1edcea030875cd0f199d96eb70f6ab78faf2',
          key: hexToBytes('4545454545454545454545454545454545454545454545454545454545454545'),
        },
      ];
      for (const t of VECTORS) {
        const sig = typed.personal.sign(t.message, t.key, false);
        deepStrictEqual(sig, t.signature);
        deepStrictEqual(typed.personal.verify(sig, t.message, t.address), true);
        deepStrictEqual(typed.personal.recoverPublicKey(sig, t.message).toLowerCase(), t.address);
      }
    });
  });

  // Stolen from other libraries
  should('ethers', () => {
    const ETHERS_TYPED = jsonGZ('./vectors/ethers/testcases/typed-data.json.gz');
    for (const t of ETHERS_TYPED) {
      const e = typed.encoder(
        { EIP712Domain: typed.getDomainType(t.domain), ...t.types },
        t.domain
      );
      deepStrictEqual(e.encodeData(t.primaryType, t.data), t.encoded);
      deepStrictEqual(e._getHash(t.primaryType, t.data), t.digest);
    }
  });
  describe('viem', () => {
    const typedData = {
      basic: {
        domain: {
          name: 'Ether Mail',
          version: '1',
          chainId: 1,
          verifyingContract: '0x0000000000000000000000000000000000000000',
        },
        types: {
          Person: [
            { name: 'name', type: 'string' },
            { name: 'wallet', type: 'address' },
          ],
          Mail: [
            { name: 'from', type: 'Person' },
            { name: 'to', type: 'Person' },
            { name: 'contents', type: 'string' },
          ],
        },
        message: {
          from: {
            name: 'Cow',
            wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
          },
          to: {
            name: 'Bob',
            wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
          },
          contents: 'Hello, Bob!',
        },
      },
      complex: {
        domain: {
          name: 'Ether Mail 🥵',
          version: '1.1.1',
          chainId: 1,
          verifyingContract: '0x0000000000000000000000000000000000000000',
        },
        types: {
          Name: [
            { name: 'first', type: 'string' },
            { name: 'last', type: 'string' },
          ],
          Person: [
            { name: 'name', type: 'Name' },
            { name: 'wallet', type: 'address' },
            { name: 'favoriteColors', type: 'string[3]' },
            { name: 'foo', type: 'uint256' },
            { name: 'age', type: 'uint8' },
            { name: 'isCool', type: 'bool' },
          ],
          Mail: [
            { name: 'timestamp', type: 'uint256' },
            { name: 'from', type: 'Person' },
            { name: 'to', type: 'Person' },
            { name: 'contents', type: 'string' },
            { name: 'hash', type: 'bytes' },
          ],
        },
        message: {
          timestamp: 1234567890n,
          contents: 'Hello, Bob! 🖤',
          hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          from: {
            name: {
              first: 'Cow',
              last: 'Burns',
            },
            wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
            age: 69,
            foo: 123123123123123123n,
            favoriteColors: ['red', 'green', 'blue'],
            isCool: false,
          },
          to: {
            name: { first: 'Bob', last: 'Builder' },
            wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
            age: 70,
            foo: 123123123123123123n,
            favoriteColors: ['orange', 'yellow', 'green'],
            isCool: true,
          },
        },
      },
    };
    const address = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
    const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const VECTORS = {
      basic: {
        t: { ...typedData.basic, primaryType: 'Mail' },
        sig: '0x32f3d5975ba38d6c2fba9b95d5cbed1febaa68003d3d588d51f2de522ad54117760cfc249470a75232552e43991f53953a3d74edf6944553c6bef2469bb9e5921b',
      },
      minimal: {
        t: {
          types: { EIP712Domain: [] },
          primaryType: 'EIP712Domain',
          domain: {},
          message: {},
        },
        sig: '0xda87197eb020923476a6d0149ca90bc1c894251cc30b38e0dd2cdd48567e12386d3ed40a509397410a4fd2d66e1300a39ac42f828f8a5a2cb948b35c22cf29e81c',
      },
      complex: {
        t: { ...typedData.complex, primaryType: 'Mail' },
        sig: '0xc4d8bcda762d35ea79d9542b23200f46c2c1899db15bf929bbacaf609581db0831538374a01206517edd934e474212a0f1e2d62e9a01cd64f1cf94ea2e0988491c',
      },
      domain_chainId: {
        t: { ...typedData.complex, domain: { chainId: 0 }, primaryType: 'Mail' },
        sig: '0x0ab57c83d3eebb0015ea5382d70aae9a5724a35fb9904f52c505bf783c10364639c126471a542ac6a1b5dcd8f1dc2dc5b1ce346f063ff6104750d53029a7c8cb1c',
      },
      domain_chainId1: {
        t: { ...typedData.complex, domain: { chainId: 1 }, primaryType: 'Mail' },
        sig: '0x6e100a352ec6ad1b70802290e18aeed190704973570f3b8ed42cb9808e2ea6bf4a90a229a244495b41890987806fcbd2d5d23fc0dbe5f5256c2613c039d76db81c',
      },
      domain_name: {
        t: { ...typedData.complex, domain: { name: '' }, primaryType: 'Mail' },
        sig: '0x270eb0f0209a0d43d328327dad9b04bf1ec67dc1fca3fb3235385b7b4a64410621fea5d2d64d3ef41266b17fffda854bc03083ba7ce8e9b740d643ac9dc98e911c',
      },
      domain_name1: {
        t: { ...typedData.complex, domain: { name: 'Ether!' }, primaryType: 'Mail' },
        sig: '0xb2b9704a23b0e5a5e728623113ab57e93a9de055b53c15d5d0f1a6485932efc503d77c0cfc2eca82cd9b4ecd2b39355457e4dd390ccb6d5c4457a2631b53baa21b',
      },
      domain_verifyingContract: {
        t: {
          ...typedData.complex,
          domain: { verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' },
          primaryType: 'Mail',
        },
        sig: '0xa74d8aa1ff14231fedeaf7a929e86ac55d80256bee24e1f8ebba9bd092a9351651b6669da7f5d0a7209243f8dee1026b018ed03dd5ce01b7ecb75a8880deeeb01b',
      },
      // domain_salt: {
      //   t: {
      //     ...typedData.complex,
      //     domain: {
      //       salt: hexToBytes('123512315aaaa1231313b1231b23b13b123aa12312211b1b1b111bbbb1affafa'),
      //     },
      //     primaryType: 'Mail',
      //   },
      //   sig: '0xa74d8aa1ff14231fedeaf7a929e86ac55d80256bee24e1f8ebba9bd092a9351651b6669da7f5d0a7209243f8dee1026b018ed03dd5ce01b7ecb75a8880deeeb01b',
      // },
    };
    for (const k in VECTORS) {
      should(k, () => {
        const { t, sig } = VECTORS[k];
        deepStrictEqual(typed.signTyped(t, privateKey, false), sig);
        deepStrictEqual(typed.recoverPublicKeyTyped(sig, t).toLocaleLowerCase(), address);
      });
    }
  });
  describe('eth-sig-util', () => {
    const privateKey = '4af1bceebf7f3634ec3cff8a2c38e51178d5d4ce585c52d6043e5e2cc3418bb0';
    should('recursive', () => {
      // This is pretty complex, since it depeneds on ignoring not present fields, which
      // won't allow us to catch these error by types. There is no optional fields in EIP712,
      // but you can use different types for this.
      const t = {
        types: {
          EIP712Domain: [],
          Person: [
            { name: 'name', type: 'string' },
            { name: 'wallet', type: 'address' },
          ],
          Mail: [
            { name: 'from', type: 'Person' },
            { name: 'to', type: 'Person' },
            { name: 'contents', type: 'string' },
            { name: 'replyTo', type: 'Mail' },
          ],
        },
        domain: {},
        primaryType: 'Mail',
        message: {
          from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
          to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
          contents: 'Hello, Bob!',
          replyTo: {
            to: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
            from: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
            contents: 'Hello!',
          },
        },
      };
      deepStrictEqual(
        typed.encodeData(t, privateKey),
        '0x66658e9662034bcd21df657297dab8ba47f0ae05dd8aa253cc935d9aacfd9d10fc71e5fa27ff56c350aa531bc129ebdf613b772b6604664f5d8dbe21b85eb0c8cd54f074a4af31b4411ff6a60c9719dbd559c221c8ac3492d9d872b041d703d1b5aadf3154a261abdd9086fc627b61efca26ae5702701d05cd2305f7c52a2fc8161abe35f76debc1e0496baa54308eb1f1331218276bf01c4af34ee637780b25'
      );
    });
  });
  describe('geth', () => {
    should('gnosis', () => {
      const t = {
        types: {
          EIP712Domain: [{ type: 'address', name: 'verifyingContract' }],
          SafeTx: [
            { type: 'address', name: 'to' },
            { type: 'uint256', name: 'value' },
            { type: 'bytes', name: 'data' },
            { type: 'uint8', name: 'operation' },
            { type: 'uint256', name: 'safeTxGas' },
            { type: 'uint256', name: 'baseGas' },
            { type: 'uint256', name: 'gasPrice' },
            { type: 'address', name: 'gasToken' },
            { type: 'address', name: 'refundReceiver' },
            { type: 'uint256', name: 'nonce' },
          ],
        },
        domain: {
          verifyingContract: '0x25a6c4BBd32B2424A9c99aEB0584Ad12045382B3',
        },
        primaryType: 'SafeTx',
        message: {
          to: '0x9eE457023bB3De16D51A003a247BaEaD7fce313D',
          value: '20000000000000000',
          data: '0x',
          operation: 0,
          safeTxGas: 27845,
          baseGas: 0,
          gasPrice: '0',
          gasToken: '0x0000000000000000000000000000000000000000',
          refundReceiver: '0x0000000000000000000000000000000000000000',
          nonce: 3,
        },
      };
      deepStrictEqual(
        typed.sigHash(t),
        '0x28bae2bd58d894a1d9b69e5e9fde3570c4b98a6fc5499aefb54fb830137e831f'
      );
    });
    should('arrays', () => {
      const t = {
        types: {
          EIP712Domain: [
            {
              name: 'name',
              type: 'string',
            },
            {
              name: 'version',
              type: 'string',
            },
            {
              name: 'chainId',
              type: 'uint256',
            },
            {
              name: 'verifyingContract',
              type: 'address',
            },
          ],
          Foo: [
            {
              name: 'addys',
              type: 'address[]',
            },
            {
              name: 'stringies',
              type: 'string[]',
            },
            {
              name: 'inties',
              type: 'uint[]',
            },
          ],
        },
        primaryType: 'Foo',
        domain: {
          name: 'Lorem',
          version: '1',
          chainId: '1',
          verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
        },
        message: {
          addys: [
            '0x0000000000000000000000000000000000000001',
            '0x0000000000000000000000000000000000000002',
            '0x0000000000000000000000000000000000000003',
          ],
          stringies: ['lorem', 'ipsum', 'dolores'],
          inties: ['0x0000000000000000000000000000000000000001', '3', 4.0],
        },
      };
      deepStrictEqual(
        typed.encodeData(t),
        '0x20259eda63cf4f1c8c331d57d8e044683c26c3bb1c97b25c56f0c2ff963f3f9d6e0c627900b24bd432fe7b1f713f1b0744091a646a9fe4a65a18dfed21f2949cfdd277c623d919b59ae5ce87e31a89f081611b0036f04a506517bb1b2b17747caba7d5d4fe9af307550a2b994140e4d4aec2a2dc7c3a38ffb88b0c020c377417'
      );
    });
    should('custom_arraytype', () => {
      const t = {
        types: {
          EIP712Domain: [
            {
              name: 'name',
              type: 'string',
            },
            {
              name: 'version',
              type: 'string',
            },
            {
              name: 'chainId',
              type: 'uint256',
            },
            {
              name: 'verifyingContract',
              type: 'address',
            },
          ],
          Person: [
            {
              name: 'name',
              type: 'string',
            },
          ],
          Mail: [
            {
              name: 'from',
              type: 'Person',
            },
            {
              name: 'to',
              type: 'Person[]',
            },
            {
              name: 'contents',
              type: 'string',
            },
          ],
        },
        primaryType: 'Mail',
        domain: {
          name: 'Ether Mail',
          version: '1',
          chainId: '1',
          verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
        },
        message: {
          from: { name: 'Cow' },
          to: [{ name: 'Moose' }, { name: 'Goose' }],
          contents: 'Hello, Bob!',
        },
      };
      deepStrictEqual(
        typed.encodeData(t),
        '0xef61350d5e86546c92ecd89ebd469611ddf0af2e7e89a0b20aa97f91bff967b2bfb54ec5e6bf391ea339a110356cb0fd003296b0dabe4b0b2e51d0e50c815c8a44470a26ef91e1456b46eab63fd9c426f81bfd7869b3c51f1e33aff56cede602b5aadf3154a261abdd9086fc627b61efca26ae5702701d05cd2305f7c52a2fc8'
      );
    });
    should('fail', () => {
      const VECTORS = {
        arraytype_overload: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
            ],
            Person: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'wallet',
                type: 'address',
              },
            ],
            'Person[]': [
              {
                name: 'baz',
                type: 'string',
              },
            ],
            Mail: [
              {
                name: 'from',
                type: 'Person',
              },
              {
                name: 'to',
                type: 'Person[]',
              },
              {
                name: 'contents',
                type: 'string',
              },
            ],
          },
          primaryType: 'Mail',
          domain: {
            name: 'Ether Mail',
            version: '1',
            chainId: '1',
            verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
          },
          message: {
            from: {
              name: 'Cow',
              wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
            },
            to: { baz: 'foo' },
            contents: 'Hello, Bob!',
          },
        },
        datamismatch_1: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
            ],
            Person: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'wallet',
                type: 'address',
              },
            ],
            Mail: [
              {
                name: 'from',
                type: 'Person',
              },
              {
                name: 'to',
                type: 'Person',
              },
              {
                name: 'contents',
                type: 'Person',
              },
            ],
          },
          primaryType: 'Mail',
          domain: {
            name: 'Ether Mail',
            version: '1',
            chainId: '1',
            verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
          },
          message: {
            from: {
              name: 'Cow',
              wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
            },
            to: {
              name: 'Bob',
              wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
            },
            contents: 'Hello, Bob!',
          },
        },
        extradata1: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256 ... and now for something completely different',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
            ],
            Person: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'test',
                type: 'uint8',
              },
              {
                name: 'test2',
                type: 'uint8',
              },
              {
                name: 'wallet',
                type: 'address',
              },
            ],
            Mail: [
              {
                name: 'from',
                type: 'Person',
              },
              {
                name: 'to',
                type: 'Person',
              },
              {
                name: 'contents',
                type: 'string',
              },
            ],
          },
          primaryType: 'Mail',
          domain: {
            name: 'Ether Mail',
            version: '1',
            chainId: '1',
            verifyingContract: '0xCCCcccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
          },
          message: {
            from: {
              name: 'Cow',
              test: '3',
              test2: 5.0,
              wallet: '0xcD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
            },
            to: {
              name: 'Bob',
              test: '0',
              test2: 5,
              wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
            },
            contents: 'Hello, Bob!',
          },
        },
        extradata2: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
            ],
            Person: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'test',
                type: 'uint8',
              },
              {
                name: 'test2',
                type: 'uint8',
              },
              {
                name: 'wallet',
                type: 'address',
              },
            ],
            Mail: [
              {
                name: 'from',
                type: 'Person',
              },
              {
                name: 'to',
                type: 'Person',
              },
              {
                name: 'contents',
                type: 'string',
              },
            ],
          },
          primaryType: 'Mail',
          domain: {
            name: 'Ether Mail',
            version: '1',
            chainId: '1',
            verifyingContract: '0xCCCcccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
          },
          message: {
            blahonga: 'zonk bonk',
            from: {
              name: 'Cow',
              test: '3',
              test2: 5.0,
              wallet: '0xcD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
            },
            to: {
              name: 'Bob',
              test: '0',
              test2: 5,
              wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
            },
            contents: 'Hello, Bob!',
          },
        },
        malformeddomainkeys: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
            ],
            Person: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'wallet',
                type: 'address',
              },
            ],
            Mail: [
              {
                name: 'from',
                type: 'Person',
              },
              {
                name: 'to',
                type: 'Person',
              },
              {
                name: 'contents',
                type: 'string',
              },
            ],
          },
          primaryType: 'Mail',
          domain: {
            name: 'Ether Mail',
            version: '1',
            chainId: '1',
            vFAILFAILerifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
          },
          message: {
            from: {
              name: 'Cow',
              wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
            },
            to: {
              name: 'Bob',
              wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
            },
            contents: 'Hello, Bob!',
          },
        },
        nonexistant_type: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
            ],
            Person: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'wallet',
                type: 'address',
              },
            ],
            Mail: [
              {
                name: 'from',
                type: 'Person',
              },
              {
                name: 'to',
                type: 'Person',
              },
              {
                name: 'contents',
                type: 'Blahonga',
              },
            ],
          },
          primaryType: 'Mail',
          domain: {
            name: 'Ether Mail',
            version: '1',
            chainId: '1',
            verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
          },
          message: {
            from: {
              name: 'Cow',
              wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
            },
            to: {
              name: 'Bob',
              wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
            },
            contents: 'Hello, Bob!',
          },
        },
        toolargeuint: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
            ],
            Mail: [
              {
                name: 'test',
                type: 'uint8',
              },
            ],
          },
          primaryType: 'Mail',
          domain: {
            name: 'Ether Mail',
            version: '1',
            chainId: '1',
            verifyingContract: '0xCCCcccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
          },
          message: {
            test: '257',
          },
        },
        toolargeuint2: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
            ],
            Mail: [
              {
                name: 'test',
                type: 'uint8',
              },
            ],
          },
          primaryType: 'Mail',
          domain: {
            name: 'Ether Mail',
            version: '1',
            chainId: '1',
            verifyingContract: '0xCCCcccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
          },
          message: {
            test: 257,
          },
        },
        unconvertiblefloat: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
            ],
            Mail: [
              {
                name: 'test',
                type: 'uint8',
              },
            ],
          },
          primaryType: 'Mail',
          domain: {
            name: 'Ether Mail',
            version: '1',
            chainId: '1',
            verifyingContract: '0xCCCcccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
          },
          message: {
            test: '255.3',
          },
        },
        unconvertiblefloat2: {
          types: {
            EIP712Domain: [
              {
                name: 'name',
                type: 'string',
              },
              {
                name: 'version',
                type: 'string',
              },
              {
                name: 'chainId',
                type: 'uint256',
              },
              {
                name: 'verifyingContract',
                type: 'address',
              },
            ],
            Mail: [
              {
                name: 'test',
                type: 'uint8',
              },
            ],
          },
          primaryType: 'Mail',
          domain: {
            name: 'Ether Mail',
            version: '1',
            chainId: '1',
            verifyingContract: '0xCCCcccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
          },
          message: {
            test: 255.3,
          },
        },
      };
      for (const k in VECTORS) throws(() => typed.encodeData(VECTORS[k]), k);
    });
  });
});

should.runWhen(import.meta.url);
