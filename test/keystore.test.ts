import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, rejects } from 'node:assert';
import { privFromLegacyKeystore, privFromLegacySaleKeystore, privToLegacyKeystore } from '../src/advanced/keystore.ts';
import { addr } from '../src/core/address.ts';
import WALLET_VECTORS from './keystore_vectors.json' with { type: 'json' };

const fixturePrivateKey = '0xefca4cdd31923b50f4214af5d2ae10e7ac45a5019e9431cc195482d707485378';
const fixturePrivateKeyBytes = hexToBytes(fixturePrivateKey.slice(2));
const privateKeyHex = (privateKey: Uint8Array) => `0x${bytesToHex(privateKey)}`;
const addressOf = (privateKey: Uint8Array) => addr.fromPrivateKey(privateKey).toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('keystore', () => {
  should('privToLegacyKeystore', async () => {
    const password = 'testtest';
    const salt = '0xdc9e4a98886738bd8aae134a1f89aaa5a502c3fbd10e336136d4d5fe47448ad6';
    const iv = '0xcecacd85e9cb89788b5aab2f93361233';
    const uuid = '0x7e59dc028d42d09db29aa8a0f862cc81';

    deepStrictEqual(
      await privToLegacyKeystore(fixturePrivateKeyBytes, password, {
        kdf: 'pbkdf2',
        c: 262144,
        salt,
        iv,
        uuid,
      }),
      JSON.parse(
        '{"version":3,"id":"7e59dc02-8d42-409d-b29a-a8a0f862cc81","address":"b14ab53e38da1c172f877dbc6d65e4a1b0474c3c","crypto":{"ciphertext":"01ee7f1a3c8d187ea244c92eea9e332ab0bb2b4c902d89bdd71f80dc384da1be","cipherparams":{"iv":"cecacd85e9cb89788b5aab2f93361233"},"cipher":"aes-128-ctr","kdf":"pbkdf2","kdfparams":{"dklen":32,"salt":"dc9e4a98886738bd8aae134a1f89aaa5a502c3fbd10e336136d4d5fe47448ad6","c":262144,"prf":"hmac-sha256"},"mac":"0c02cd0badfebd5e783e0cf41448f84086a96365fc3456716c33641a86ebc7cc"}}'
      )
    );
    deepStrictEqual(
      await privToLegacyKeystore(fixturePrivateKey, password, {
        kdf: 'scrypt',
        n: 262144,
        r: 8,
        p: 1,
        salt,
        iv,
        uuid,
      }),
      JSON.parse(
        '{"version":3,"id":"7e59dc02-8d42-409d-b29a-a8a0f862cc81","address":"b14ab53e38da1c172f877dbc6d65e4a1b0474c3c","crypto":{"ciphertext":"c52682025b1e5d5c06b816791921dbf439afe7a053abb9fac19f38a57499652c","cipherparams":{"iv":"cecacd85e9cb89788b5aab2f93361233"},"cipher":"aes-128-ctr","kdf":"scrypt","kdfparams":{"dklen":32,"salt":"dc9e4a98886738bd8aae134a1f89aaa5a502c3fbd10e336136d4d5fe47448ad6","n":262144,"r":8,"p":1},"mac":"27b98c8676dc6619d077453b38db645a4c7c17a3e686ee5adaf53c11ac1b890e"}}'
      )
    );
  });

  should('round-trips legacy keystores and validates options', async () => {
    const password = 'test';
    const salt = '';
    const iv = 'ffffffffffffffffffffffffffffffff';
    const uuid = 'ffffffffffffffffffffffffffffffff';
    const pbkdf2Store = await privToLegacyKeystore(fixturePrivateKey, password, {
      kdf: 'pbkdf2',
      c: 2,
      salt,
      iv,
      uuid,
    });
    deepStrictEqual(pbkdf2Store.crypto.kdfparams.salt, '');
    deepStrictEqual(privateKeyHex(await privFromLegacyKeystore(pbkdf2Store, password)), fixturePrivateKey);
    const emptySaltBytesStore = await privToLegacyKeystore(fixturePrivateKey, password, {
      kdf: 'pbkdf2',
      c: 2,
      salt: hexToBytes(''),
      iv,
      uuid,
    });
    deepStrictEqual(emptySaltBytesStore.crypto.kdfparams.salt, '');
    deepStrictEqual(
      privateKeyHex(await privFromLegacyKeystore(emptySaltBytesStore, password)),
      fixturePrivateKey
    );

    const scryptStore = await privToLegacyKeystore(fixturePrivateKey, password, {
      kdf: 'scrypt',
      n: 16,
      r: 1,
      p: 1,
      salt: '0x',
      iv: '0x' + iv,
      uuid: '0x' + uuid,
    });
    deepStrictEqual(scryptStore.crypto.kdfparams.salt, '');
    deepStrictEqual(scryptStore.crypto.cipherparams.iv, iv);
    deepStrictEqual(privateKeyHex(await privFromLegacyKeystore(scryptStore, password)), fixturePrivateKey);

    await rejects(() => privToLegacyKeystore(hexToBytes('001122'), password), /invalid private key/);
    await rejects(
      () => privToLegacyKeystore(fixturePrivateKey, password, { kdf: 'superkey' }),
      /Unsupported kdf/
    );
    await rejects(
      () => privToLegacyKeystore(fixturePrivateKey, password, { salt: 'f' }),
      /invalid salt: expected string or Uint8Array/
    );
    await rejects(
      () => privToLegacyKeystore(fixturePrivateKey, password, { iv: 'ff' }),
      /invalid iv: expected string or Uint8Array of length 32/
    );
    await rejects(
      () => privToLegacyKeystore(fixturePrivateKey, password, { uuid: 'ff' }),
      /invalid uuid: expected string or Uint8Array of length 32/
    );
  });

  should('imports legacy keystores', async () => {
    const pbkdf2Store =
      '{"crypto":{"cipher":"aes-128-ctr","cipherparams":{"iv":"6087dab2f9fdbbfaddc31a909735c1e6"},"ciphertext":"5318b4d5bcd28de64ee5559e671353e16f075ecae9f99c7a79a38af5f869aa46","kdf":"pbkdf2","kdfparams":{"c":262144,"dklen":32,"prf":"hmac-sha256","salt":"ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd"},"mac":"517ead924a9d0dc3124507e3393d175ce3ff7c1e96529c6c555ce9e51205e9b2"},"id":"3198bc9c-6672-5ab3-d995-4942343ae5b6","version":3}';
    deepStrictEqual(
      addressOf(await privFromLegacyKeystore(JSON.parse(pbkdf2Store), 'testpassword')),
      '0x008aeeda4d805471df9b2a5b0f38a0c3bcba786b'
    );

    const scryptStore =
      '{"address":"2f91eb73a6cd5620d7abb50889f24eea7a6a4feb","crypto":{"cipher":"aes-128-ctr","cipherparams":{"iv":"a2bc4f71e8445d64ceebd1247079fbd8"},"ciphertext":"6b9ab7954c9066fa1e54e04e2c527c7d78a77611d5f84fede1bd61ab13c51e3e","kdf":"scrypt","kdfparams":{"dklen":32,"n":262144,"r":1,"p":8,"salt":"caf551e2b7ec12d93007e528093697a4c68e8a50e663b2a929754a8085d9ede4"},"mac":"506cace9c5c32544d39558025cb3bf23ed94ba2626e5338c82e50726917e1a15"},"id":"1b3cad9b-fa7b-4817-9022-d5e598eb5fe3","version":3}';
    deepStrictEqual(
      addressOf(await privFromLegacyKeystore(JSON.parse(scryptStore), 'testtest')),
      '0x2f91eb73a6cd5620d7abb50889f24eea7a6a4feb'
    );

    await rejects(() => privFromLegacyKeystore(JSON.parse(pbkdf2Store), 'wrongtestpassword'), /Key derivation failed/);
    await rejects(() => privFromLegacyKeystore(JSON.parse('{"version":2}'), 'testpassword'), /Not a V3 keystore/);
    await rejects(
      () => privFromLegacyKeystore(JSON.parse('{"crypto":{"kdf":"superkey"},"version":3}'), 'testpassword'),
      /Unsupported key derivation scheme/
    );
    await rejects(
      () =>
        privFromLegacyKeystore(
          JSON.parse('{"crypto":{"kdf":"pbkdf2","kdfparams":{"prf":"invalid"}},"version":3}'),
          'testpassword'
        ),
      /Unsupported parameters to PBKDF2/
    );

    const mixedCase =
      JSON.parse('{"Crypto":{"cipher":"aes-128-ctr","cipherparams":{"iv":"6087dab2f9fdbbfaddc31a909735c1e6"},"ciphertext":"5318b4d5bcd28de64ee5559e671353e16f075ecae9f99c7a79a38af5f869aa46","kdf":"pbkdf2","kdfparams":{"c":262144,"dklen":32,"prf":"hmac-sha256","salt":"ae3cd4e7013836a3df6bd7241b12db061dbe2c6785853cce422d148a624ce0bd"},"mac":"517ead924a9d0dc3124507e3393d175ce3ff7c1e96529c6c555ce9e51205e9b2"},"id":"3198bc9c-6672-5ab3-d995-4942343ae5b6","version":3}');
    deepStrictEqual(
      addressOf(await privFromLegacyKeystore(mixedCase, 'testpassword', true)),
      '0x008aeeda4d805471df9b2a5b0f38a0c3bcba786b'
    );
    await rejects(() => privFromLegacyKeystore(mixedCase, 'testpassword'));
  });

  should('imports legacy sale keystore', async () => {
    const valid = WALLET_VECTORS.legacysale.valid;
    deepStrictEqual(valid.length, 13);
    deepStrictEqual(
      valid.filter((v) => v.source === 'generated-pyethsaletool-compatible').length,
      10
    );
    for (const [i, vector] of valid.entries()) {
      const input = i % 2 === 0 ? vector.wallet : (vector.wallet);
      const privateKey = await privFromLegacySaleKeystore(input, vector.password);
      deepStrictEqual(addressOf(privateKey), vector.expectedAddress, vector.id);
      deepStrictEqual(privateKeyHex(privateKey), vector.expectedPrivateKey, vector.id);
    }
  });

  should('rejects wallet edge-case vectors', async () => {
    deepStrictEqual(WALLET_VECTORS.edgeCases.length, 10);
    for (const vector of WALLET_VECTORS.edgeCases) {
      const error = new RegExp(escapeRe(vector.expectedError));
      if (vector.method === 'fromLegacySale') {
        await rejects(() => privFromLegacySaleKeystore(vector.wallet, vector.password), new RegExp(''), vector.id);
      } else if (vector.method === 'fromLegacy') {
        await rejects(() => privFromLegacyKeystore(vector.keystore, vector.password), error, vector.id);
      } else {
        throw new Error(`Unknown wallet vector method: ${vector.method}`);
      }
    }
  });
});
should.runWhen(import.meta.url);
