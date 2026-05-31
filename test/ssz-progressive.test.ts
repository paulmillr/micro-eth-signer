import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, throws } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import * as snappy from 'snappyjs';
import * as yaml from 'yaml';
import * as SSZ from '../src/advanced/ssz.ts';
import { __dirname } from './util.ts';

const SSZ_PATH = `${__dirname}/new_vectors/ssz`;
const yamlOpt = { intAsBigInt: true };

const readGenericVectors = (path) => {
  const validVectors = {};
  const invalidVectors = {};
  for (const category of readdirSync(path)) {
    for (const valid of ['valid', 'invalid']) {
      for (const name of readdirSync(`${path}/${category}/${valid}`)) {
        const curPath = `${path}/${category}/${valid}/${name}`;
        const data = readFileSync(`${curPath}/serialized.ssz_snappy`);
        const hex = bytesToHex(snappy.uncompress(data));
        const fullName = `${category}/${name}`;

        if (valid === 'valid') {
          const meta = yaml.parse(readFileSync(`${curPath}/meta.yaml`, 'utf8'), yamlOpt);
          const value = yaml.parse(readFileSync(`${curPath}/value.yaml`, 'utf8'), yamlOpt);
          validVectors[fullName] = { meta, value, hex };
        } else {
          invalidVectors[fullName] = hex;
        }
      }
    }
  }
  return { valid: validVectors, invalid: invalidVectors };
};
const { valid: PROGRESSIVE_VALID, invalid: PROGRESSIVE_INVALID } = readGenericVectors(
  `${SSZ_PATH}/progressive`
);

describe('SSZ progressive', () => {
  const SmallTestStruct = SSZ.container({
    A: SSZ.uint16,
    B: SSZ.uint16,
  });
  const VarTestStruct = SSZ.container({
    A: SSZ.uint16,
    B: SSZ.list(1024, SSZ.uint16),
    C: SSZ.uint8,
  });
  const ProgressiveSingleFieldContainerTestStruct = SSZ.progressiveContainer([1], {
    A: SSZ.byte,
  });
  const ProgressiveSingleListContainerTestStruct = SSZ.progressiveContainer([0, 0, 0, 0, 1], {
    C: SSZ.progressiveBitlist(),
  });
  const ProgressiveVarTestStruct = SSZ.progressiveContainer([1, 0, 1, 0, 1], {
    A: SSZ.byte,
    B: SSZ.list(123, SSZ.uint16),
    C: SSZ.progressiveBitlist(),
  });
  const ProgressiveComplexTestStruct = SSZ.progressiveContainer(
    [1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
    {
      A: SSZ.byte,
      B: SSZ.list(123, SSZ.uint16),
      C: SSZ.progressiveBitlist(),
      D: SSZ.progressiveList(SSZ.uint64),
      E: SSZ.progressiveList(SmallTestStruct),
      F: SSZ.progressiveList(SSZ.progressiveList(VarTestStruct)),
      G: SSZ.list(10, ProgressiveSingleFieldContainerTestStruct),
      H: SSZ.progressiveList(ProgressiveVarTestStruct),
    }
  );
  const CompatibleUnionA = SSZ.compatibleUnion({
    1: ProgressiveSingleFieldContainerTestStruct,
  });
  const CompatibleUnionBC = SSZ.compatibleUnion({
    2: ProgressiveSingleListContainerTestStruct,
    3: ProgressiveVarTestStruct,
  });
  const CompatibleUnionABCA = SSZ.compatibleUnion({
    1: ProgressiveSingleFieldContainerTestStruct,
    2: ProgressiveSingleListContainerTestStruct,
    3: ProgressiveVarTestStruct,
    4: ProgressiveSingleFieldContainerTestStruct,
  });
  const progressiveStructs = {
    ProgressiveSingleFieldContainerTestStruct,
    ProgressiveSingleListContainerTestStruct,
    ProgressiveVarTestStruct,
    ProgressiveComplexTestStruct,
  };
  const compatibleUnions = {
    CompatibleUnionA,
    CompatibleUnionBC,
    CompatibleUnionABCA,
  };
  const bit = (hex) => SSZ.progressiveBitlist().decode(hexToBytes(hex.slice(2)));
  const num = (n) => Number(n);
  const progVar = (v) => ({ A: num(v.A), B: v.B.map(num), C: bit(v.C) });
  const progSingle = (v) => ({ A: num(v.A) });
  const progSingleList = (v) => ({ C: bit(v.C) });

  should('builders', () => {
    throws(() => SSZ.progressiveContainer([], { A: SSZ.byte }));
    throws(() => SSZ.progressiveContainer([1, 0], { A: SSZ.byte }));
    throws(() => SSZ.progressiveContainer(new Array(257).fill(1), { A: SSZ.byte }));
    throws(() => SSZ.progressiveContainer([1, 1], { A: SSZ.byte }));
    throws(() => SSZ.compatibleUnion({}));
    throws(() => SSZ.compatibleUnion({ 0: ProgressiveSingleFieldContainerTestStruct }));
    throws(() =>
      SSZ.compatibleUnion({ 1: ProgressiveSingleFieldContainerTestStruct, 2: SSZ.byte })
    );

    const Shape = SSZ.progressiveContainer([1, 0, 1], {
      side: SSZ.uint16,
      color: SSZ.uint8,
    });
    const StandardShape = SSZ.container({ side: SSZ.uint16, color: SSZ.uint8 });
    const Square = SSZ.profile(Shape, [], ['side', 'color']);
    const value = { side: 0x42, color: 1 };
    deepStrictEqual(bytesToHex(Shape.encode(value)), '420001');
    deepStrictEqual(bytesToHex(Square.encode(value)), '420001');
    deepStrictEqual(
      bytesToHex(Square.merkleRoot(value)),
      bytesToHex(StandardShape.merkleRoot(value))
    );
    deepStrictEqual(
      SSZ.progressiveList(SSZ.uint8)._isProgressiveCompat(SSZ.progressiveList(SSZ.byte)),
      true
    );
    deepStrictEqual(CompatibleUnionA._isProgressiveCompat(CompatibleUnionABCA), true);
  });

  should('vectors', () => {
    const isSmall = (type) => ['uint8', 'uint16', 'uint32'].includes(type);
    for (const t in PROGRESSIVE_VALID) {
      const { meta, value, hex } = PROGRESSIVE_VALID[t];
      let coder;
      let val;
      if (t.startsWith('basic_progressive_list/')) {
        const type = /^basic_progressive_list\/proglist_([^_]+)_/.exec(t)[1];
        coder = SSZ.progressiveList(type === 'bool' ? SSZ.boolean : SSZ[type]);
        val = value.map((i) => (typeof i === 'string' ? BigInt(i) : i));
        if (isSmall(type)) val = val.map(num);
      } else if (t.startsWith('progressive_bitlist/')) {
        coder = SSZ.progressiveBitlist();
        val = coder.decode(hexToBytes(value.slice(2)));
      } else if (t.startsWith('progressive_containers/')) {
        const name = /^progressive_containers\/([^_]+)/.exec(t)[1];
        coder = progressiveStructs[name];
        if (name === 'ProgressiveSingleFieldContainerTestStruct') val = progSingle(value);
        else if (name === 'ProgressiveSingleListContainerTestStruct') val = progSingleList(value);
        else if (name === 'ProgressiveVarTestStruct') val = progVar(value);
        else if (name === 'ProgressiveComplexTestStruct') {
          val = {
            A: num(value.A),
            B: value.B.map(num),
            C: bit(value.C),
            D: value.D.map((n) => (typeof n === 'bigint' ? n : BigInt(n))),
            E: value.E.map((v) => ({ A: num(v.A), B: num(v.B) })),
            F: value.F.map((list) =>
              list.map((v) => ({ A: num(v.A), B: v.B.map(num), C: num(v.C) }))
            ),
            G: value.G.map(progSingle),
            H: value.H.map(progVar),
          };
        } else throw new Error(`missing progressive value mapper: ${name}`);
      } else if (t.startsWith('compatible_unions/')) {
        const name =
          /^compatible_unions\/(CompatibleUnionABCA|CompatibleUnionBC|CompatibleUnionA)_/.exec(
            t
          )[1];
        coder = compatibleUnions[name];
        const selector = Number(value.selector);
        let data;
        if (selector === 1 || selector === 4) data = progSingle(value.data);
        else if (selector === 2) data = progSingleList(value.data);
        else if (selector === 3) data = progVar(value.data);
        else throw new Error(`missing compatible-union selector mapper: ${selector}`);
        val = { selector, data };
      } else throw new Error('missing progressive test');
      deepStrictEqual(bytesToHex(coder.encode(val)), hex, `${t}: encode`);
      deepStrictEqual(coder.decode(hexToBytes(hex)), val, `${t}: decode`);
      deepStrictEqual(`0x${bytesToHex(coder.merkleRoot(val))}`, meta.root, `${t}: root`);
    }
    for (const t in PROGRESSIVE_INVALID) {
      const hex = PROGRESSIVE_INVALID[t];
      let coder;
      if (t.startsWith('basic_progressive_list/')) {
        const type = /^basic_progressive_list\/proglist_([^_]+)_/.exec(t)[1];
        coder = SSZ.progressiveList(type === 'bool' ? SSZ.boolean : SSZ[type]);
      } else if (t.startsWith('progressive_bitlist/')) {
        coder = SSZ.progressiveBitlist();
      } else if (t.startsWith('progressive_containers/')) {
        const name = /^progressive_containers\/([^_]+)/.exec(t)[1];
        coder = progressiveStructs[name];
      } else if (t.startsWith('compatible_unions/')) {
        const name =
          /^compatible_unions\/(CompatibleUnionABCA|CompatibleUnionBC|CompatibleUnionA)_/.exec(
            t
          )[1];
        coder = compatibleUnions[name];
      } else throw new Error('missing progressive invalid test');
      throws(() => coder.decode(hexToBytes(hex)), t);
    }
  });
});

should.runWhen(import.meta.url);
