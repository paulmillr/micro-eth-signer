import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, should } from '@paulmillr/jsbt/test.js';
import { deepStrictEqual, throws } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import * as snappy from 'snappyjs';
import * as yaml from 'yaml';
import * as SSZ from '../src/advanced/ssz.ts';
import { getVectorsPath } from './util.ts';

const SSZ_PATH = getVectorsPath('ssz');
const yamlOpt = { intAsBigInt: true };

function* readGenericVectorCases(path) {
  for (const category of readdirSync(path)) {
    for (const valid of ['valid', 'invalid']) {
      for (const name of readdirSync(`${path}/${category}/${valid}`)) {
        const curPath = `${path}/${category}/${valid}/${name}`;
        const fullName = `${category}/${name}`;
        yield { path: curPath, name: fullName, valid: valid === 'valid' };
      }
    }
  }
}

const readSerialized = (path) => {
  const bytes = snappy.uncompress(readFileSync(`${path}/serialized.ssz_snappy`));
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
};
const readRoot = (path) => yaml.parse(readFileSync(`${path}/meta.yaml`, 'utf8'), yamlOpt).root;

const readGenericVector = (path) => ({
  root: readRoot(path),
  value: yaml.parse(readFileSync(`${path}/value.yaml`, 'utf8'), yamlOpt),
  serialized: readSerialized(path),
});

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
  const mapArray = (arr, fn) => {
    for (let i = 0; i < arr.length; i++) arr[i] = fn(arr[i]);
    return arr;
  };
  const progVar = (v) => {
    v.A = num(v.A);
    v.B = mapArray(v.B, num);
    v.C = bit(v.C);
    return v;
  };
  const progSingle = (v) => {
    v.A = num(v.A);
    return v;
  };
  const progSingleList = (v) => {
    v.C = bit(v.C);
    return v;
  };

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
    const getCoder = (name) => {
      if (name.startsWith('basic_progressive_list/')) {
        const type = /^basic_progressive_list\/proglist_([^_]+)_/.exec(name)[1];
        return SSZ.progressiveList(type === 'bool' ? SSZ.boolean : SSZ[type]);
      } else if (name.startsWith('progressive_bitlist/')) {
        return SSZ.progressiveBitlist();
      } else if (name.startsWith('progressive_containers/')) {
        return progressiveStructs[/^progressive_containers\/([^_]+)/.exec(name)[1]];
      } else if (name.startsWith('compatible_unions/')) {
        return compatibleUnions[
          /^compatible_unions\/(CompatibleUnionABCA|CompatibleUnionBC|CompatibleUnionA)_/.exec(
            name
          )[1]
        ];
      } else throw new Error(`missing progressive test: ${name}`);
    };
    const getValue = (name, value, coder) => {
      if (name.startsWith('basic_progressive_list/')) {
        const type = /^basic_progressive_list\/proglist_([^_]+)_/.exec(name)[1];
        mapArray(value, (i) => (typeof i === 'string' ? BigInt(i) : i));
        return isSmall(type) ? mapArray(value, num) : value;
      } else if (name.startsWith('progressive_bitlist/')) {
        return coder.decode(hexToBytes(value.slice(2)));
      } else if (name.startsWith('progressive_containers/')) {
        const type = /^progressive_containers\/([^_]+)/.exec(name)[1];
        if (type === 'ProgressiveSingleFieldContainerTestStruct') return progSingle(value);
        if (type === 'ProgressiveSingleListContainerTestStruct') return progSingleList(value);
        if (type === 'ProgressiveVarTestStruct') return progVar(value);
        if (type === 'ProgressiveComplexTestStruct') {
          value.A = num(value.A);
          value.B = mapArray(value.B, num);
          value.C = bit(value.C);
          value.D = mapArray(value.D, (n) => (typeof n === 'bigint' ? n : BigInt(n)));
          value.E = mapArray(value.E, (v) => {
            v.A = num(v.A);
            v.B = num(v.B);
            return v;
          });
          value.F = mapArray(value.F, (list) =>
            mapArray(list, (v) => {
              v.A = num(v.A);
              v.B = mapArray(v.B, num);
              v.C = num(v.C);
              return v;
            })
          );
          value.G = mapArray(value.G, progSingle);
          value.H = mapArray(value.H, progVar);
          return value;
        }
        throw new Error(`missing progressive value mapper: ${type}`);
      } else if (name.startsWith('compatible_unions/')) {
        const selector = Number(value.selector);
        let data;
        if (selector === 1 || selector === 4) data = progSingle(value.data);
        else if (selector === 2) data = progSingleList(value.data);
        else if (selector === 3) data = progVar(value.data);
        else throw new Error(`missing compatible-union selector mapper: ${selector}`);
        value.selector = selector;
        value.data = data;
        return value;
      } else throw new Error(`missing progressive value mapper: ${name}`);
    };

    for (const t of readGenericVectorCases(`${SSZ_PATH}/progressive`)) {
      const coder = getCoder(t.name);

      if (t.valid) {
        const vector = readGenericVector(t.path);
        const { root, serialized } = vector;
        let val = getValue(t.name, vector.value, coder);
        vector.value = undefined;
        deepStrictEqual(coder.encode(val), serialized, `${t.name}: encode`);
        deepStrictEqual(`0x${bytesToHex(coder.merkleRoot(val))}`, root, `${t.name}: root`);
        val = undefined;
        deepStrictEqual(coder.encode(coder.decode(serialized)), serialized, `${t.name}: decode`);
      }

      if (!t.valid) throws(() => coder.decode(readSerialized(t.path)), t.name);
    }
  });
});

should.runWhen(import.meta.url);
