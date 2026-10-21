import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, throws } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import {
  bytewords,
  cbor,
  chooseDegree,
  chooseFragments,
  crc32,
  decodeUR,
  encodeUR,
  findNominalFragmentLength,
  FountainDecoder,
  FountainEncoder,
  partFromCbor,
  partitionMessage,
  partToCbor,
  RandomSampler,
  shuffled,
  Tagged,
  UREncoder,
  URDecoder,
  Xoshiro256,
} from '../airgap/ur.js';

/*
Unit tests for examples/airgap/ur.js, the Uniform Resources transport of the
air-gap demo. Reference vectors come verbatim from the bc-ur C++ test suite
(fixtures/ur-vectors.json): sender and receiver derive fountain part mixes
independently, so every PRNG/sampler step has to match the reference exactly.
  node examples/test/ur.test.ts
*/

const V = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'ur-vectors.json'), 'utf8')
);
const utf8 = (s: string) => new TextEncoder().encode(s);
// reference test helpers: make_message / make_message_ur
const makeMessage = (len: number, seed = 'Wolf') => new Xoshiro256(seed).nextData(len);
const makeMessageUR = (len: number, seed = 'Wolf') => cbor.encode(makeMessage(len, seed));
const u32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);

describe('ur: reference vectors (bc-ur)', () => {
  should('crc32', () => {
    deepStrictEqual(crc32(utf8('Hello, world!')), 0xebe6c6e6);
    deepStrictEqual(crc32(utf8('Wolf')), 0x598c84dc);
  });
  should('bytewords minimal', () => {
    const input = Uint8Array.of(0, 1, 2, 128, 255);
    deepStrictEqual(bytewords.encode(input), 'aeadaolazmjendeoti');
    deepStrictEqual(bytewords.decode('aeadaolazmjendeoti'), input);
    deepStrictEqual(bytewords.decode('AEADAOLAZMJENDEOTI'), input, 'case-insensitive');
    throws(() => bytewords.decode('aeadaolazojendeowf'), /checksum/);
    const long = Uint8Array.from(V.bytewordsInput);
    deepStrictEqual(bytewords.encode(long), V.bytewordsMinimal);
    deepStrictEqual(bytewords.decode(V.bytewordsMinimal), long);
  });
  should('xoshiro256**', () => {
    const r1 = new Xoshiro256('Wolf');
    deepStrictEqual(
      Array.from({ length: 100 }, () => Number(r1.next() % 100n)),
      V.rng1
    );
    const r2 = new Xoshiro256(u32(crc32(utf8('Wolf'))));
    deepStrictEqual(
      Array.from({ length: 100 }, () => Number(r2.next() % 100n)),
      V.rng2
    );
    const r3 = new Xoshiro256('Wolf');
    deepStrictEqual(
      Array.from({ length: 100 }, () => r3.nextInt(1, 10)),
      V.rng3
    );
  });
  should('nominal fragment length', () => {
    deepStrictEqual(findNominalFragmentLength(12345, 1005, 1955), 1764);
    deepStrictEqual(findNominalFragmentLength(12345, 1005, 30000), 12345);
  });
  should('random sampler', () => {
    const sampler = new RandomSampler([1, 2, 4, 8]);
    const rng = new Xoshiro256('Wolf');
    deepStrictEqual(
      Array.from({ length: 500 }, () => sampler.next(() => rng.nextDouble())),
      V.sampler
    );
  });
  should('shuffle', () => {
    const rng = new Xoshiro256('Wolf');
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    deepStrictEqual(
      Array.from({ length: 10 }, () => shuffled(values, rng)),
      V.shuffle
    );
  });
  should('partition, degrees, fragment choice', () => {
    const message = makeMessage(1024);
    const fragmentLen = findNominalFragmentLength(message.length, 10, 100);
    const fragments = partitionMessage(message, fragmentLen);
    deepStrictEqual(fragments.map(bytesToHex), V.partition);
    const degrees = Array.from({ length: 200 }, (_, i) =>
      chooseDegree(fragments.length, new Xoshiro256(`Wolf-${i + 1}`))
    );
    deepStrictEqual(degrees, V.degrees);
    const checksum = crc32(message);
    deepStrictEqual(
      Array.from({ length: 30 }, (_, i) => chooseFragments(i + 1, fragments.length, checksum)),
      V.fragments
    );
  });
  should('fountain encoder parts', () => {
    const encoder = new FountainEncoder(makeMessage(256), 30);
    const parts = Array.from({ length: 20 }, () => encoder.nextPart());
    deepStrictEqual(
      parts.map((p) => bytesToHex(partToCbor(p))),
      V.fountainCbor
    );
    const back = partFromCbor(hexToBytes(V.fountainCbor[12]));
    deepStrictEqual(bytesToHex(partToCbor(back)), V.fountainCbor[12], 'part cbor round trip');
  });
  should('single-part UR', () => {
    const payload = makeMessageUR(50);
    deepStrictEqual(encodeUR('bytes', payload), V.singlePart);
    deepStrictEqual(decodeUR(V.singlePart), { type: 'bytes', payload });
    deepStrictEqual(decodeUR(V.singlePart.toUpperCase()).payload, payload, 'QR alphanumeric');
  });
  should('multi-part UR encoder', () => {
    const encoder = new UREncoder('bytes', makeMessageUR(256), 30);
    deepStrictEqual(
      Array.from({ length: 20 }, () => encoder.nextPart()),
      V.urParts
    );
    deepStrictEqual(encoder.pureParts(), V.urParts.slice(0, 9), 'the seqLen pure parts');
  });
});

describe('ur: decoding', () => {
  should('fountain-decode a large message from mixed parts (reference test)', () => {
    const message = makeMessage(32767);
    const encoder = new FountainEncoder(message, 1000, 100);
    const decoder = new FountainDecoder();
    let parts = 0;
    while (!decoder.result) (decoder.receive(encoder.nextPart()), parts++);
    deepStrictEqual(decoder.result, message);
    // starts past the pure parts: everything arrives mixed
    deepStrictEqual(parts > encoder.seqLen, true);
  });
  should('recover from any subset of the stream, out of order', () => {
    const payload = makeMessageUR(1000, 'Hare');
    const encoder = new UREncoder('bytes', payload, 100);
    const stream = Array.from({ length: 200 }, () => encoder.nextPart());
    // drop every third frame and read backwards: a camera missing frames
    const decoder = new URDecoder(['bytes']);
    for (const part of stream.filter((_, i) => i % 3).reverse()) {
      decoder.receive(part);
      if (decoder.isComplete) break;
    }
    deepStrictEqual(decoder.payload, payload);
    deepStrictEqual(decoder.receive(stream[0]), false, 'complete: nothing new');
  });
  should('pure parts alone are enough, duplicates are harmless', () => {
    const payload = makeMessageUR(500);
    const parts = new UREncoder('bytes', payload, 120).pureParts();
    const decoder = new URDecoder();
    deepStrictEqual(decoder.receive(parts[0]), true);
    deepStrictEqual(decoder.receive(parts[0]), false, 'duplicate');
    deepStrictEqual(decoder.progress, { received: 1, expected: parts.length });
    for (const part of parts.slice(1)) decoder.receive(part.toUpperCase());
    deepStrictEqual(decoder.payload, payload);
    deepStrictEqual(decoder.type, 'bytes');
  });
  should('a new message on screen restarts collection', () => {
    const first = new UREncoder('bytes', makeMessageUR(300, 'one'), 60).pureParts();
    const secondPayload = makeMessageUR(300, 'two');
    const second = new UREncoder('bytes', secondPayload, 60).pureParts();
    const decoder = new URDecoder();
    decoder.receive(first[0]);
    decoder.receive(first[1]);
    for (const part of second) decoder.receive(part);
    deepStrictEqual(decoder.payload, secondPayload);
  });
  should('single-part payloads stay single-part', () => {
    const payload = cbor.encode(new Map([[1, 'small']]));
    const encoder = new UREncoder('bytes', payload, 200);
    deepStrictEqual(encoder.isSinglePart, true);
    deepStrictEqual(encoder.nextPart(), encoder.nextPart(), 'same string every frame');
    deepStrictEqual(encoder.pureParts(), [encodeUR('bytes', payload)]);
  });
});

describe('ur: malformed input', () => {
  const good = V.singlePart;
  should('reject non-UR text and malformed paths', () => {
    for (const bad of ['', 'hello', 'ur:', 'ur:bytes', 'ur:bytes/', 'ur:by tes/aeae', 'ur:a/b/c/d'])
      throws(() => new URDecoder().receive(bad), `rejects ${JSON.stringify(bad)}`);
  });
  should('reject unexpected types with a clear message', () => {
    throws(
      () => new URDecoder(['eth-signature']).receive(good),
      /Expected ur:eth-signature, got ur:bytes/
    );
  });
  should('reject corrupted bytewords', () => {
    const corrupted = good.slice(0, 20) + (good[20] === 'a' ? 'e' : 'a') + good.slice(21);
    throws(() => decodeUR(corrupted), /checksum|invalid word/);
    throws(() => decodeUR(good.slice(0, -1)), /invalid length/);
  });
  should('reject inconsistent multi-part headers', () => {
    const [part] = new UREncoder('bytes', makeMessageUR(256), 30).pureParts();
    throws(() => new URDecoder().receive(part.replace('/1-9/', '/2-9/')), /sequence component/);
    throws(() => new URDecoder().receive(part.replace('/1-9/', '/x-9/')), /sequence component/);
    // header claims a sequence length the fragment size cannot produce
    const lying = partToCbor({
      seqNum: 1,
      seqLen: 3,
      messageLen: 256,
      checksum: 1,
      data: new Uint8Array(30),
    });
    throws(() => partFromCbor(lying), /sequence length/);
    const huge = partToCbor({
      seqNum: 1,
      seqLen: 1,
      messageLen: 2 ** 31,
      checksum: 1,
      data: new Uint8Array(30),
    });
    throws(() => partFromCbor(huge), /header/);
  });
  should('reject a reassembled message with the wrong checksum, then recover', () => {
    const payload = makeMessageUR(100);
    const encoder = new FountainEncoder(payload, 40);
    const parts = Array.from({ length: encoder.seqLen }, () => encoder.nextPart());
    const decoder = new FountainDecoder();
    const tampered = parts.map((p) => ({ ...p }));
    tampered[1] = {
      ...tampered[1],
      data: tampered[1].data.map((b: number, i: number) => (i ? b : b ^ 1)),
    };
    throws(() => tampered.forEach((p) => decoder.receive(p)), /checksum/);
    for (const p of parts) decoder.receive(p);
    deepStrictEqual(decoder.result, payload);
  });
});

describe('ur: cbor', () => {
  should('round-trip the value kinds the registry uses', () => {
    const value = new Map<number, unknown>([
      [1, new Tagged(37, Uint8Array.of(1, 2, 3))],
      [2, 'text ✓'],
      [3, [true, false, 0, 23, 24, 255, 256, 65535, 65536, 2 ** 32, -1, -25]],
      [4, 2n ** 64n - 1n],
    ]);
    const bytes = cbor.encode(value);
    deepStrictEqual(cbor.decode(bytes), value);
    deepStrictEqual(bytesToHex(cbor.encode(500)), '1901f4', 'shortest head');
    deepStrictEqual(bytesToHex(cbor.encode(-500)), '3901f3');
  });
  should('reject what the registry never uses', () => {
    for (const hex of [
      '', // empty
      'f6', // null
      'fa3f800000', // float
      '5f4100ff', // indefinite bytes
      '9f01ff', // indefinite array
      '1c', // reserved additional info
      '5a00010000', // byte string longer than the data
      'a20101' + '0102', // duplicate map key
      '0101', // trailing bytes
      '61ff', // invalid utf-8
      '9b0000000100000000', // 4G-element array header
    ])
      throws(() => cbor.decode(hexToBytes(hex)), `rejects ${hex}`);
    const deep = new Uint8Array(40).fill(0x81);
    throws(() => cbor.decode(Uint8Array.from([...deep, 0])), /deep/);
  });
});

should.runWhen(import.meta.url);
