import { ctr } from '@noble/ciphers/aes.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, throws } from 'node:assert';
// Public subpath is named by Ethereum validator-key purpose, not the underlying BLS curve.
import * as bls from '../src/advanced/bls.ts';

const vectors = [
  [
    'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
    '6083874454709270928345386274498605044986640685124978867557563392430687146096',
    0,
    '20397789859736650942317412262472558107875392172444076792671091975210932703118',
  ],
  [
    '3141592653589793238462643383279502884197169399375105820974944592',
    '29757020647961307431480504535336562678282505419141012933316116377660817309383',
    3141592653,
    '25457201688850691947727629385191704516744796114925897962676248250929345014287',
  ],
  [
    '0099FF991111002299DD7744EE3355BBDD8844115566CC55663355668888CC00',
    '27580842291869792442942448775674722299803720648445448686099262467207037398656',
    4294967295,
    '29358610794459428860402234341874281240803786294062035874021252734817515685787',
  ],
  [
    'd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3',
    '19022158461524446591288038168518313374041767046816487870552872741050760015818',
    42,
    '31372231650479070279774297061823572166496564838472787488249775572789064611981',
  ],
];
function bytesToNumberBE(item) {
  return BigInt(`0x${bytesToHex(item)}`);
}

describe('Validator keys', () => {
  should('derivation validators', () => {
    const seed = hexToBytes(vectors[0][0]);
    throws(() => bls.deriveSeedTree(seed, 1 as never), TypeError);
    throws(() => bls.deriveSeedTree(seed, 'x/12381/3600/0/0'), RangeError);
    throws(() => bls.deriveSeedTree(seed, 'm'), RangeError);
    throws(() => bls.deriveSeedTree(seed, 'm/12381'), RangeError);
    throws(() => bls.deriveSeedTree(seed, 'm/12381/3600/0'), RangeError);
    throws(() => bls.deriveSeedTree(seed, 'm/12381x/3600/0/0'), RangeError);
    throws(() => bls.deriveSeedTree(seed, 'm/12381/3600/0/0x'), RangeError);
    throws(() => bls.deriveEIP2334Key('x' as never, 'signing', 0), TypeError);
    throws(() => bls.deriveEIP2334Key(seed, 1 as never, 0), TypeError);
    throws(() => bls.deriveEIP2334Key(seed, 'other' as never, 0), RangeError);
    throws(() => bls.deriveEIP2334Key(seed, 'signing', -1), RangeError);
    throws(() => bls.deriveEIP2334Key(new Uint8Array(31), 'withdrawal', 0), RangeError);
    throws(() => bls.deriveEIP2334Key(new Uint8Array(31), 'signing', 0), RangeError);
  });
  describe('EIP2333', () => {
    should('hkdfModR rejects ikm shorter than 32 bytes', () => {
      throws(() => bls.hkdfModR(new Uint8Array(31)), RangeError);
    });
    should('deriveMaster rejects seeds shorter than 32 bytes', () => {
      throws(() => bls.deriveMaster(new Uint8Array(31)), RangeError);
    });
    should('deriveChild rejects parent keys that are not 32 bytes', () => {
      throws(() => bls.deriveChild(Uint8Array.of(1, 2, 3), 0), RangeError);
      throws(() => bls.deriveChild(new Uint8Array(33), 0), RangeError);
    });
    vectors.forEach((vector, i) => {
      should(`run vector ${i}`, () => {
        const [seed, expMaster, childIndex, expChild] = vector;
        const master = bls.deriveMaster(hexToBytes(seed));
        const child = bls.deriveChild(master, childIndex);
        deepStrictEqual(bytesToNumberBE(master), BigInt(expMaster), 'master key is not equal');
        deepStrictEqual(bytesToNumberBE(child), BigInt(expChild), 'child key is not equal');
      });
      should('deriveEIP2334SigningKey', () => {
        const seed = hexToBytes(
          'cbd1178c008ca4ee38654d6584f753e7f6c42b258ae0efd5a99d1c69e293f8488ce4e994c9ce06ae8b284a1b3a07a41059782e72036378427277d988fdd61c83'
        );
        const signing = bls.deriveEIP2334Key(seed, 'signing', 0);
        const withdrawal = bls.deriveEIP2334Key(seed, 'withdrawal', 0);
        const derivedSigning = bls.deriveEIP2334SigningKey(withdrawal.key);
        deepStrictEqual(derivedSigning, signing.key);
      });
    });
  });
  describe('EIP2335', () => {
    const ctx = () => {
      const values = [
        new Uint8Array(32).fill(1),
        new Uint8Array(16).fill(2),
        new Uint8Array(16).fill(3),
      ];
      const randomBytes = (len) => {
        const next = values.shift();
        if (!next || next.length !== len) throw new Error('wrong randomBytes call');
        return next;
      };
      return new bls.EIP2335Keystore('password', 'pbkdf2', randomBytes);
    };
    should('create rejects non-string paths', () => {
      throws(() => ctx().create(new Uint8Array(32).fill(9), 123 as never), TypeError);
    });
    should('createDerivedEIP2334 rejects seeds shorter than 32 bytes', () => {
      throws(() => ctx().createDerivedEIP2334(new Uint8Array(31), 'signing', 0), RangeError);
    });
    should('normalize keystore passwords', () => {
      const TESTS = [
        ['', ''],
        ['passphrase', 'passphrase'],
        ['𝔱𝔢𝔰𝔱𝔭𝔞𝔰𝔰𝔴𝔬𝔯𝔡🔑', 'testpassword🔑'],
        [
          new TextDecoder().decode(
            hexToBytes(
              '746573740001020304050607636f08090a0b0c0d0e0f6e741011121314151617726f18191a1b1c1d1e1f6c7f'
            )
          ),
          'testcontrol',
        ],
      ];
      for (const [input, exp] of TESTS) {
        deepStrictEqual(bls._TEST.normalizePassword(input), exp);
      }
    });
    const decryptScrypt = () => {
      const vector = {
        crypto: {
          kdf: {
            function: 'scrypt',
            params: {
              dklen: 32,
              n: 262144,
              p: 1,
              r: 8,
              salt: 'd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3',
            },
            message: '',
          },
          checksum: {
            function: 'sha256',
            params: {},
            message: 'd2217fe5f3e9a1e34581ef8a78f7c9928e436d36dacc5e846690a5581e8ea484',
          },
          cipher: {
            function: 'aes-128-ctr',
            params: {
              iv: '264daa3f303d7259501c93d997d84fe6',
            },
            message: '06ae90d55fe0a6e9c5c3bc5b170827b2e5cce3929ed3f116c2811e6366dfe20f',
          },
        },
        description: 'This is a test keystore that uses scrypt to secure the secret.',
        pubkey:
          '9612d7a727c9d0a22e185a1c768478dfe919cada9266988cb32359c11f2b7b27f4ae4040902382ae2910c15e2b420d07',
        path: 'm/12381/60/3141592653/589793238',
        uuid: '1d85ae20-35c5-4611-98e8-aa14a633906f',
        version: 4,
      };
      deepStrictEqual(
        bls.decryptEIP2335Keystore(vector, '𝔱𝔢𝔰𝔱𝔭𝔞𝔰𝔰𝔴𝔬𝔯𝔡🔑'),
        hexToBytes('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f')
      );
      const decryptInvalid = (store: unknown) =>
        bls.decryptEIP2335Keystore(store as bls.Keystore<'scrypt'>, '𝔱𝔢𝔰𝔱𝔭𝔞𝔰𝔰𝔴𝔬𝔯𝔡🔑');
      const missingPath = structuredClone(vector) as Partial<typeof vector>;
      delete missingPath.path;
      throws(() => decryptInvalid(missingPath));
      const badPath = structuredClone(vector) as typeof vector & { path: number | string };
      badPath.path = 123;
      throws(() => decryptInvalid(badPath));
    };
    should('decrypt PBKDF2', () => {
      const vector = {
        crypto: {
          kdf: {
            function: 'pbkdf2',
            params: {
              dklen: 32,
              c: 262144,
              prf: 'hmac-sha256',
              salt: 'd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3',
            },
            message: '',
          },
          checksum: {
            function: 'sha256',
            params: {},
            message: '8a9f5d9912ed7e75ea794bc5a89bca5f193721d30868ade6f73043c6ea6febf1',
          },
          cipher: {
            function: 'aes-128-ctr',
            params: {
              iv: '264daa3f303d7259501c93d997d84fe6',
            },
            message: 'cee03fde2af33149775b7223e7845e4fb2c8ae1792e5f99fe9ecf474cc8c16ad',
          },
        },
        description: 'This is a test keystore that uses PBKDF2 to secure the secret.',
        pubkey:
          '9612d7a727c9d0a22e185a1c768478dfe919cada9266988cb32359c11f2b7b27f4ae4040902382ae2910c15e2b420d07',
        path: 'm/12381/60/0/0',
        uuid: '64625def-3331-4eea-ab6f-782f3ed16a83',
        version: 4,
      };
      deepStrictEqual(
        bls.decryptEIP2335Keystore(vector, '𝔱𝔢𝔰𝔱𝔭𝔞𝔰𝔰𝔴𝔬𝔯𝔡🔑'),
        hexToBytes('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f')
      );
      vector.uuid = '64625DEF-3331-4EEA-AB6F-782F3ED16A83';
      deepStrictEqual(
        bls.decryptEIP2335Keystore(vector, '𝔱𝔢𝔰𝔱𝔭𝔞𝔰𝔰𝔴𝔬𝔯𝔡🔑'),
        hexToBytes('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f')
      );
    });
    should('decrypt PBKDF2 with stored module params', () => {
      const password = 'password';
      const salt = new Uint8Array(32).fill(4);
      const iv = new Uint8Array(16).fill(5);
      const secret = new Uint8Array(32).fill(6);
      const key = pbkdf2(sha256, utf8ToBytes(password), salt, { c: 1, dkLen: 32 });
      const ciphertext = ctr(key.subarray(0, 16), iv).encrypt(secret);
      const checksum = sha256(concatBytes(key.subarray(16, 32), ciphertext));
      deepStrictEqual(
        bls.decryptEIP2335Keystore(
          {
            version: 4,
            description: '',
            pubkey: undefined,
            path: '',
            uuid: '64625def-3331-4eea-ab6f-782f3ed16a83',
            crypto: {
              kdf: {
                function: 'pbkdf2',
                params: { dklen: 32, c: 1, prf: 'hmac-sha256', salt: bytesToHex(salt) },
                message: '',
              },
              checksum: { function: 'sha256', params: {}, message: bytesToHex(checksum) },
              cipher: {
                function: 'aes-128-ctr',
                params: { iv: bytesToHex(iv) },
                message: bytesToHex(ciphertext),
              },
            },
          },
          password
        ),
        secret
      );
    });
    should('throw on previous versions', () => {
      const vector = {
        crypto: {
          cipher: 'aes-128-ctr',
          cipherparams: {
            iv: '6087dab2f9fdbbfaddc31a909735c1e6',
          },
          ciphertext: '5318b4d5bcd28de64ee5559e671353e16f075ecae9f99c7a79a38af5f869aa46',
          kdf: 'pbkdf2',
          kdfparams: {
            c: 262144,
            dklen: 32,
            prf: 'hmac-sha256',
            salt: 'ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd',
          },
          mac: '517ead924a9d0dc3124507e3393d175ce3ff7c1e96529c6c555ce9e51205e9b2',
        },
        id: '3198bc9c-6672-5ab3-d995-4942343ae5b6',
        version: 3,
      };
      throws(() => bls.decryptEIP2335Keystore(vector, 'testpassword').privateKey);
    });
    const keystore = () => {
      const iv = hexToBytes('ea19787657550f76181bb4c0ce49cc8a');
      const salt = hexToBytes('9330c1010e6859591404baf9d0c490efd7f8b476314358111a09b4b41d9c4498');
      const uuid = hexToBytes('c2de70413e806097058393c2e8da2161');
      // const seed = await mnemonicToSeed(
      //   entropyToMnemonic(
      //     hexToBytes('8ba269cc68cb6c2eeaf4ff33536ab2a7f290da291c6f908532d8996ba30bf419'),
      //     wordlist
      //   ),
      //   ''
      // );
      const seed = hexToBytes(
        'cbd1178c008ca4ee38654d6584f753e7f6c42b258ae0efd5a99d1c69e293f8488ce4e994c9ce06ae8b284a1b3a07a41059782e72036378427277d988fdd61c83'
      );
      const randomBytes = (arr) => {
        const cur = Array.from(arr);
        return (len) => {
          const last = cur.shift();
          if (!last || last.length !== len) throw new Error('wrong randomBytes call');
          return last;
        };
      };
      const password = 'testwallet';
      const pbkdfStore = new bls.EIP2335Keystore(
        password,
        'pbkdf2',
        randomBytes([salt, iv, uuid, iv, uuid])
      );
      const scryptStore = new bls.EIP2335Keystore(
        password,
        'scrypt',
        randomBytes([salt, iv, uuid, iv, uuid])
      );
      // Tests against MyEtherWallet/eth2-keystore
      deepStrictEqual(pbkdfStore.createDerivedEIP2334(seed, 'signing', 0, ''), {
        crypto: {
          kdf: {
            function: 'pbkdf2',
            params: {
              dklen: 32,
              salt: '9330c1010e6859591404baf9d0c490efd7f8b476314358111a09b4b41d9c4498',
              c: 262144,
              prf: 'hmac-sha256',
            },
            message: '',
          },
          checksum: {
            function: 'sha256',
            params: {},
            message: '02e99d22418f87a00e7d3b26a970b1f0fd6e7891f9081bea756ccb2c2632837d',
          },
          cipher: {
            function: 'aes-128-ctr',
            params: { iv: 'ea19787657550f76181bb4c0ce49cc8a' },
            message: '40259d7fdc1fefb9bcd1284959cd0925093819f60c51f424a259cc8b5f476ec3',
          },
        },
        description: '',
        pubkey:
          'a31ede44c207ce1fcbe375c7d5f5d57da961ecd4a649ab8c97df193a3dcff98a81257d786be6a44313e0450272e2152f',
        path: 'm/12381/3600/0/0/0',
        uuid: 'c2de7041-3e80-4097-8583-93c2e8da2161',
        version: 4,
      });
      deepStrictEqual(pbkdfStore.createDerivedEIP2334(seed, 'withdrawal', 0, ''), {
        crypto: {
          kdf: {
            function: 'pbkdf2',
            params: {
              dklen: 32,
              salt: '9330c1010e6859591404baf9d0c490efd7f8b476314358111a09b4b41d9c4498',
              c: 262144,
              prf: 'hmac-sha256',
            },
            message: '',
          },
          checksum: {
            function: 'sha256',
            params: {},
            message: '0181392f64ede795fe495cd1ecb0e02fcd10850f031070a3834271a5655cdc14',
          },
          cipher: {
            function: 'aes-128-ctr',
            params: { iv: 'ea19787657550f76181bb4c0ce49cc8a' },
            message: '452012359a13d6feb91b05f018c7d79a0308372afce59a3a883e13e24a7616ca',
          },
        },
        description: '',
        pubkey:
          '8bb11cf87d5477fdc23c232db1ee6cf228a1362c5433f04a43001dfc6a1f68b2614b1e59ab87978ec09a955c8e1e585d',
        path: 'm/12381/3600/0/0',
        uuid: 'c2de7041-3e80-4097-8583-93c2e8da2161',
        version: 4,
      });
      deepStrictEqual(scryptStore.createDerivedEIP2334(seed, 'signing', 0, ''), {
        crypto: {
          kdf: {
            function: 'scrypt',
            params: {
              dklen: 32,
              salt: '9330c1010e6859591404baf9d0c490efd7f8b476314358111a09b4b41d9c4498',
              n: 262144,
              r: 8,
              p: 1,
            },
            message: '',
          },
          checksum: {
            function: 'sha256',
            params: {},
            message: '7757d3b7c9cbfa1b1fd9a2fa98d67a9490f509422923a432a78391656e412d81',
          },
          cipher: {
            function: 'aes-128-ctr',
            params: { iv: 'ea19787657550f76181bb4c0ce49cc8a' },
            message: '2a33b3508ff48e42b1eef2fb137e02559b442a202c393d5a9a4ddcf61acad98a',
          },
        },
        description: '',
        pubkey:
          'a31ede44c207ce1fcbe375c7d5f5d57da961ecd4a649ab8c97df193a3dcff98a81257d786be6a44313e0450272e2152f',
        path: 'm/12381/3600/0/0/0',
        uuid: 'c2de7041-3e80-4097-8583-93c2e8da2161',
        version: 4,
      });
      deepStrictEqual(scryptStore.createDerivedEIP2334(seed, 'withdrawal', 0, ''), {
        crypto: {
          kdf: {
            function: 'scrypt',
            params: {
              dklen: 32,
              salt: '9330c1010e6859591404baf9d0c490efd7f8b476314358111a09b4b41d9c4498',
              n: 262144,
              r: 8,
              p: 1,
            },
            message: '',
          },
          checksum: {
            function: 'sha256',
            params: {},
            message: 'f241ed29c6dfdcf398a91552926d4260474cbcf9ae2a5597d0413499899a7e61',
          },
          cipher: {
            function: 'aes-128-ctr',
            params: { iv: 'ea19787657550f76181bb4c0ce49cc8a' },
            message: '2f363c1ac9f8b705b424df425274dcea917404fcdc8d5344b02a039f0ffba183',
          },
        },
        description: '',
        pubkey:
          '8bb11cf87d5477fdc23c232db1ee6cf228a1362c5433f04a43001dfc6a1f68b2614b1e59ab87978ec09a955c8e1e585d',
        path: 'm/12381/3600/0/0',
        uuid: 'c2de7041-3e80-4097-8583-93c2e8da2161',
        version: 4,
      });
    };
    const multiple = () => {
      const seed = hexToBytes(
        'cbd1178c008ca4ee38654d6584f753e7f6c42b258ae0efd5a99d1c69e293f8488ce4e994c9ce06ae8b284a1b3a07a41059782e72036378427277d988fdd61c83'
      );
      const password = 'testwallet';
      // NOTE: no IV in this API (would be very unsafe and force re-usage, so we test by decription)
      const pbkdfKeys = bls
        .createDerivedEIP2334Keystores(password, 'pbkdf2', seed, 'signing', [0, 1, 2, 3])
        .map((i) => bls.decryptEIP2335Keystore(i, password));
      const scryptKeys = bls
        .createDerivedEIP2334Keystores(password, 'scrypt', seed, 'signing', [0, 1, 2, 3])
        .map((i) => bls.decryptEIP2335Keystore(i, password));
      deepStrictEqual(pbkdfKeys, scryptKeys);
      deepStrictEqual(scryptKeys, [
        bls.deriveEIP2334Key(seed, 'signing', 0).key,
        bls.deriveEIP2334Key(seed, 'signing', 1).key,
        bls.deriveEIP2334Key(seed, 'signing', 2).key,
        bls.deriveEIP2334Key(seed, 'signing', 3).key,
      ]);
    };
    should('scrypt keystore vectors', () => {
      decryptScrypt();
      keystore();
      multiple();
    });
  });
});

should.runWhen(import.meta.url);
