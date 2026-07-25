import { sha256 } from '@noble/hashes/sha2.js';
import * as P from 'micro-packed';
import { aarray, astring, isBytes, isObject } from "../utils.js";
/*

Simple serialize (SSZ) is the serialization method used on the Beacon Chain.
SSZ is designed to be deterministic and also to Merkleize efficiently.
SSZ can be thought of as having two components:
a serialization scheme and a Merkleization scheme
that is designed to work efficiently with the serialized data structure.

- https://github.com/ethereum/consensus-specs/blob/f5277700e3b89c4d62bd4e88a559c2b938c6b0a5/ssz/simple-serialize.md
- https://github.com/ethereum/consensus-specs/blob/f5277700e3b89c4d62bd4e88a559c2b938c6b0a5/ssz/merkle-proofs.md
- https://www.ssz.dev/show

API difference:
- containers (vec/list) have arguments like (len, child).
  this is different from other SSZ library, but compatible with packed.
  there is good reason to do that: it allows create anonymous structures inside:
  `const t = SSZ.vector(10, SSZ.container({
    ...long multiline definition here...
  }))`
  if length is second argument it would look more complex and harder to read.
- bytes provided as bytes instead of hex strings (same as other libs)

*/
// SSZ merkleization operates on 32-byte chunks; keep this aligned with chunk
// splitting and zero-chunk padding.
const BYTES_PER_CHUNK = 32;
// Canonical zero SSZ chunk; callers that expose mutable chunk arrays must wrap
// or copy this singleton.
const EMPTY_CHUNK = /* @__PURE__ */ new Uint8Array(BYTES_PER_CHUNK);
/**
 * Slot numbers at which each Ethereum consensus fork activates on mainnet.
 * Fork activations happen at epoch boundaries, so each published slot here should
 * be `activation_epoch * 32`.
 * @example
 * Branch consensus handling on the active fork range.
 * ```ts
 * const slot = 7_000_000;
 * const isCapella = slot >= ForkSlots.Capella && slot < ForkSlots.Deneb;
 * ```
 */
export const ForkSlots = /* @__PURE__ */ (() => Object.freeze({
    Phase0: 0, // 2020-12-01
    Altair: 2375680, // 2021-10-27
    // EIP-6953: Bellatrix mainnet activation epoch 144896, so slot 4636672.
    Bellatrix: 4636672, // 2022-09-06
    Capella: 6209536, // 2023-04-12
    Deneb: 8626176, // 2024-03-13
    Electra: 11649024, // 2025-05-07
    Fulu: 13164544, // 2025-12-03
}))();
// Utils for hashing
function chunks(data) {
    const res = [];
    for (let i = 0; i < Math.ceil(data.length / BYTES_PER_CHUNK); i++) {
        // Full chunks stay zero-copy views into `data`; only the final short chunk is
        // copied before zero-padding.
        const chunk = data.subarray(i * BYTES_PER_CHUNK, (i + 1) * BYTES_PER_CHUNK);
        if (chunk.length === BYTES_PER_CHUNK)
            res.push(chunk);
        else {
            const tmp = EMPTY_CHUNK.slice();
            tmp.set(chunk);
            res.push(tmp);
        }
    }
    return res;
}
// SSZ Merkle interior nodes hash two 32-byte child chunks as sha256(left || right).
const hash = (a, b) => sha256.create().update(a).update(b).digest();
// SSZ list-like roots mix the logical length as the right child encoded as a
// 32-byte little-endian uint256.
const mixInLength = (root, length) => hash(root, P.U256LE.encode(BigInt(length)));
const mixInSelector = (root, selector) => {
    const chunk = EMPTY_CHUNK.slice();
    chunk[0] = selector;
    return hash(root, chunk);
};
// Will OOM without this, because tree padded to next power of two.
// `zeroHashes[d]` caches the all-zero Merkle root for a subtree of depth `d`,
// starting from the zero chunk at depth 0.
const zeroHashes = /* @__PURE__ */ (() => {
    const res = [EMPTY_CHUNK.slice()];
    for (let i = 0; i < 64; i++)
        res.push(hash(res[i], res[i]));
    return res;
})();
const merkleize = (chunks, limit) => {
    let cs = chunks;
    let chunksLen = cs.length;
    if (limit !== undefined) {
        if (limit < cs.length) {
            throw new Error(`SSZ/merkleize: limit (${limit}) is less than the number of chunks (${cs.length})`);
        }
        chunksLen = limit;
    }
    // `limit` widens the virtual zero-padded tree; empty inputs should still resolve to the cached zero root for that depth.
    if (chunksLen === 0)
        return zeroHashes[0];
    // log2(next power of two), we cannot use binary ops since it can be bigger than 2**32.
    const depth = Math.ceil(Math.log2(chunksLen));
    if (cs.length == 0)
        return zeroHashes[depth];
    for (let l = 0; l < depth; l++) {
        const level = [];
        for (let i = 0; i < cs.length; i += 2)
            level.push(hash(cs[i], i + 1 < cs.length ? cs[i + 1] : zeroHashes[l]));
        cs = level;
    }
    return cs[0];
};
const merkleizeProgressive = (chunks, numLeaves = 1) => {
    const cs = chunks;
    // simple-serialize.md: progressive merkleization returns Bytes32() for empty input, not `merkleize([])`.
    if (cs.length === 0)
        return EMPTY_CHUNK.slice();
    return hash(merkleize(cs.slice(0, numLeaves), numLeaves), merkleizeProgressive(cs.slice(numLeaves), numLeaves * 4));
};
// Shared minimum surface for generic SSZ builders; deeper packed-coder invariants are validated later.
const checkSSZ = (o, title = 'element') => {
    if (!isObject(o) ||
        Array.isArray(o) ||
        typeof o.encode !== 'function' ||
        typeof o.decode !== 'function' ||
        typeof o.merkleRoot !== 'function' ||
        typeof o.composite !== 'boolean' ||
        typeof o.chunkCount !== 'number') {
        throw new TypeError(`"${title}" expected SSZ coder, got type=${typeof o}`);
    }
};
// SSZ coders expose `default` as a getter; generic deep-freezing would materialize huge defaults.
const freezeSSZ = (coder) => {
    if (Object.isFrozen(coder))
        return coder;
    const info = coder.info;
    if (isObject(info)) {
        if (isObject(info.inner))
            freezeSSZ(info.inner);
        if (isObject(info.fields)) {
            for (const value of Object.values(info.fields))
                freezeSSZ(value);
            Object.freeze(info.fields);
        }
        if (isObject(info.types)) {
            for (const value of Object.values(info.types)) {
                if (value !== null)
                    freezeSSZ(value);
            }
            Object.freeze(info.types);
        }
        if (isObject(info.container))
            freezeSSZ(info.container);
        if (Array.isArray(info.activeFields))
            Object.freeze(info.activeFields);
        Object.freeze(info);
    }
    return Object.freeze(coder);
};
const freezeRegistry = (registry) => {
    if (Object.isFrozen(registry))
        return registry;
    for (const value of Object.values(registry)) {
        if (!isObject(value))
            continue;
        if (typeof value.encode === 'function' && typeof value.decode === 'function')
            freezeSSZ(value);
        else
            freezeRegistry(value);
    }
    return Object.freeze(registry);
};
// TODO: improve
// SSZ simple-serialize Compatible Merkleization defines a closed substitution relation
// with an "all other types are incompatible" fallback; matching roots for sample values
// are not enough to accept `profile(..., replaceType)`.
const isProgressiveCompat = (a, b) => {
    const ca = a;
    const cb = b;
    if (ca === cb)
        return true; // fast path
    const _a = ca;
    const _b = cb;
    if (_a.info && _b.info) {
        const aI = _a.info;
        const bI = _b.info;
        // Bitlist[N] / Bitvector[N] field types are compatible if they share the same capacity N.
        const bitTypes = ['bitList', 'bitVector'];
        if (bitTypes.includes(aI.type) && bitTypes.includes(bI.type) && aI.N === bI.N)
            return true;
        // List[T, N] / Vector[T, N] field types are compatible if T is compatible and if they also share the same capacity N.
        const listTypes = ['list', 'vector'];
        if (listTypes.includes(aI.type) &&
            listTypes.includes(bI.type) &&
            aI.N === bI.N &&
            aI.inner._isProgressiveCompat(bI.inner)) {
            return true;
        }
        // Container field types are compatible if they share field names in order and inner field types are compatible.
        if (aI.type === 'container' && bI.type === 'container') {
            const kA = Object.keys(aI.fields);
            const kB = Object.keys(bI.fields);
            if (kA.length !== kB.length)
                return false;
            for (let i = 0; i < kA.length; i++) {
                const fA = kA[i];
                const fB = kB[i];
                if (fA !== fB)
                    return false;
                if (!aI.fields[fA]._isProgressiveCompat(bI.fields[fA]))
                    return false;
            }
            return true;
        }
        if (aI.type === 'progressiveList' && bI.type === 'progressiveList')
            return aI.inner._isProgressiveCompat(bI.inner);
        if (aI.type === 'progressiveBitList' && bI.type === 'progressiveBitList')
            return true;
        if (aI.type === 'progressiveContainer' && bI.type === 'progressiveContainer') {
            const byPos = (info) => {
                let field = 0;
                const res = {};
                const keys = Object.keys(info.fields);
                for (let i = 0; i < info.activeFields.length; i++) {
                    if (!info.activeFields[i])
                        continue;
                    res[i] = keys[field++];
                }
                return res;
            };
            const aPos = byPos(aI);
            const bPos = byPos(bI);
            const oneSide = new Set();
            for (const i of new Set([...Object.keys(aPos), ...Object.keys(bPos)])) {
                const aName = aPos[+i];
                const bName = bPos[+i];
                if (aName !== undefined && bName !== undefined) {
                    if (aName !== bName)
                        return false;
                    if (!aI.fields[aName]._isProgressiveCompat(bI.fields[bName]))
                        return false;
                }
                else
                    oneSide.add((aName || bName));
            }
            for (const name of oneSide)
                if (aI.fields[name] && bI.fields[name])
                    return false;
            return true;
        }
        if (aI.type === 'compatibleUnion' && bI.type === 'compatibleUnion') {
            for (const aT of Object.values(aI.types))
                for (const bT of Object.values(bI.types))
                    if (!aT._isProgressiveCompat(bT))
                        return false;
            return true;
        }
        // Profile[X] field types are compatible with ProgressiveContainer types compatible with X, and
        // are compatible with Profile[Y] where Y is compatible with X if also all inner field types
        // are compatible. Differences solely in optionality do not affect merkleization compatibility.
        if (aI.type === 'profile' || bI.type === 'profile') {
            //console.log('PROF PROF?', aI.type, bI.type, aI.container._isProgressiveCompat(bI));
            if (aI.type === 'profile' && bI.type === 'progressiveContainer')
                return aI.container._isProgressiveCompat(cb);
            if (aI.type === 'progressiveContainer' && bI.type === 'profile')
                return ca._isProgressiveCompat(bI.container);
            if (aI.type === 'profile' && bI.type === 'profile')
                return aI.container._isProgressiveCompat(bI.container);
        }
    }
    return false;
};
// Basic SSZ objects hash as a single 32-byte chunk with their serialized bytes right-padded by zeros.
const basic = (type, inner, def) => freezeSSZ({
    ...inner,
    default: def,
    chunkCount: 1,
    composite: false,
    info: { type },
    _isProgressiveCompat(other) {
        return isProgressiveCompat(this, other);
    },
    chunks(value) {
        return [this.merkleRoot(value)];
    },
    merkleRoot: (value) => {
        const res = new Uint8Array(32);
        res.set(inner.encode(value));
        return res;
    },
});
// Keep <=32-bit SSZ uints on the ergonomic JS number surface while preserving bigint for wider widths.
const int = (len, small = true) => P.apply(P.bigint(len, true), {
    encode: (from) => {
        if (!small)
            return from;
        if (BigInt(Number(from)) !== BigInt(from))
            throw new Error('ssz int: small integer is too big');
        return Number(from);
    },
    decode: (to) => {
        if (typeof to === 'bigint')
            return to;
        if (typeof to !== 'number' || !Number.isSafeInteger(to))
            throw new Error(`wrong type=${typeof to} expected number`);
        return BigInt(to);
    },
});
const _0n = /* @__PURE__ */ BigInt(0);
/** SSZ coder for 8-bit unsigned integers. */
export const uint8 = /* @__PURE__ */ basic('uint8', /* @__PURE__ */ int(1), 0);
/** SSZ coder for 16-bit unsigned integers. */
export const uint16 = /* @__PURE__ */ basic('uint16', /* @__PURE__ */ int(2), 0);
/** SSZ coder for 32-bit unsigned integers. */
export const uint32 = /* @__PURE__ */ basic('uint32', /* @__PURE__ */ int(4), 0);
/** SSZ coder for 64-bit unsigned integers. */
export const uint64 = /* @__PURE__ */ basic('uint64', 
/* @__PURE__ */ int(8, false), _0n);
/** SSZ coder for 128-bit unsigned integers. */
export const uint128 = /* @__PURE__ */ basic('uint128', 
/* @__PURE__ */ int(16, false), _0n);
/** SSZ coder for 256-bit unsigned integers. */
export const uint256 = /* @__PURE__ */ basic('uint256', 
/* @__PURE__ */ int(32, false), _0n);
/** SSZ coder for booleans. */
export const boolean = /* @__PURE__ */ basic('boolean', P.bool, false);
const array = (len, inner) => {
    const item = inner;
    checkSSZ(item, 'inner');
    let arr = P.array(len, item);
    // variable size arrays
    if (inner.size === undefined) {
        arr = P.wrap({
            encodeStream: P.array(len, P.pointer(P.U32LE, item)).encodeStream,
            decodeStream: (r) => {
                const res = [];
                // Empty input is only valid for genuinely empty dynamic lists; fixed-length callers still need a full offset table.
                const fixedLen = typeof len === 'number' ? len : undefined;
                if (!r.leftBytes) {
                    if (fixedLen !== undefined)
                        throw r.err('SSZ/array: wrong fixed size length');
                    return res;
                }
                const first = P.U32LE.decodeStream(r);
                const offsetCount = (first - r.pos) / P.U32LE.size;
                if (!Number.isSafeInteger(offsetCount))
                    throw r.err('SSZ/array: wrong fixed size length');
                if (fixedLen !== undefined && offsetCount + 1 !== fixedLen)
                    throw r.err('SSZ/array: wrong fixed size length');
                const rest = P.array(offsetCount, P.U32LE).decodeStream(r);
                const offsets = [first, ...rest];
                // SSZ decoding requires very specific encoding and should throw on data constructed differently.
                // There is also ZST problem here (as in ETH ABI), but it is impossible to exploit since
                // definitions are hardcoded. Also, pointers very strict here.
                for (let i = 0; i < offsets.length; i++) {
                    const pos = offsets[i];
                    const next = i + 1 < offsets.length ? offsets[i + 1] : r.totalBytes;
                    if (next < pos)
                        throw r.err('SSZ/array: decreasing offset');
                    const len = next - pos;
                    if (r.pos !== pos)
                        throw r.err('SSZ/array: wrong offset');
                    res.push(item.decode(r.bytes(len)));
                }
                return res;
            },
        });
    }
    return arr;
};
/**
 * Creates an SSZ vector coder.
 * @param len - Exact element count stored in the vector.
 * @param inner - Element coder used for every position.
 * @returns Fixed-size SSZ vector coder.
 * @throws On wrong argument types. {@link TypeError}
 * @throws If the vector length is invalid. {@link Error}
 * @example
 * Encode exactly two `uint8` values with a fixed-size SSZ vector.
 * ```ts
 * import { uint8, vector } from 'micro-eth-signer/advanced/ssz.js';
 * vector(2, uint8).encode([1, 2]);
 * ```
 */
export const vector = (len, inner) => {
    const item = inner;
    if (!Number.isSafeInteger(len) || len <= 0)
        throw new Error(`SSZ/vector: wrong length=${len} (should be positive integer)`);
    return freezeSSZ({
        ...array(len, item),
        info: { type: 'vector', N: len, inner: item },
        _isProgressiveCompat(other) {
            return isProgressiveCompat(this, other);
        },
        // Mutable inner defaults need per-slot copies; `fill(inner.default)` aliases one shared value across the vector.
        get default() {
            const res = new Array(len);
            for (let i = 0; i < len; i++)
                res[i] = item.default;
            return res;
        },
        composite: true,
        chunkCount: item.composite ? Math.ceil((len * item.size) / 32) : len,
        chunks(value) {
            if (!item.composite)
                return chunks(this.encode(value));
            return value.map((i) => item.merkleRoot(i));
        },
        merkleRoot(value) {
            return merkleize(this.chunks(value));
        },
    });
};
/**
 * Creates an SSZ list coder.
 * @param maxLen - Maximum number of elements allowed in the list.
 * @param inner - Element coder used for every position.
 * @returns Variable-size SSZ list coder.
 * @throws On wrong argument types. {@link TypeError}
 * @example
 * Encode a variable-length list with an upper bound of two elements.
 * ```ts
 * import { list, uint8 } from 'micro-eth-signer/advanced/ssz.js';
 * list(2, uint8).encode([1]);
 * ```
 */
export const list = (maxLen, inner) => {
    const item = inner;
    checkSSZ(item, 'inner');
    const coder = P.validate(array(null, item), (value) => {
        if (!Array.isArray(value) || value.length > maxLen)
            throw new Error(`SSZ/list: wrong value=${value} (len=${value.length} maxLen=${maxLen})`);
        return value;
    });
    return freezeSSZ({
        ...coder,
        info: { type: 'list', N: maxLen, inner: item },
        _isProgressiveCompat(other) {
            return isProgressiveCompat(this, other);
        },
        composite: true,
        chunkCount: !item.composite ? Math.ceil((maxLen * item.size) / BYTES_PER_CHUNK) : maxLen,
        // List defaults are public values too; reusing one mutable array lets caller edits leak into later defaults.
        get default() {
            return [];
        },
        chunks(value) {
            if (item.composite)
                return value.map((i) => item.merkleRoot(i));
            return chunks(this.encode(value));
        },
        merkleRoot(value) {
            return mixInLength(merkleize(this.chunks(value), this.chunkCount), value.length);
        },
    });
};
/**
 * Creates an unbounded SSZ progressive-list coder.
 * @param inner - Element coder used for every position.
 * @returns Variable-size progressive list coder.
 * @throws On wrong argument types. {@link TypeError}
 * @example
 * Encode a progressive list of small integers.
 * ```ts
 * import { progressiveList, uint8 } from 'micro-eth-signer/advanced/ssz.js';
 * progressiveList(uint8).encode([1, 2]);
 * ```
 */
export const progressiveList = (inner) => {
    const item = inner;
    checkSSZ(item, 'inner');
    const coder = P.validate(array(null, item), (value) => {
        if (!Array.isArray(value))
            throw new Error(`SSZ/progressiveList: wrong value=${value}`);
        return value;
    });
    return freezeSSZ({
        ...coder,
        info: { type: 'progressiveList', inner: item },
        _isProgressiveCompat(other) {
            return isProgressiveCompat(this, other);
        },
        composite: true,
        chunkCount: NaN,
        get default() {
            return [];
        },
        chunks(value) {
            if (item.composite)
                return value.map((i) => item.merkleRoot(i));
            return chunks(this.encode(value));
        },
        merkleRoot(value) {
            return mixInLength(merkleizeProgressive(this.chunks(value)), value.length);
        },
    });
};
// Dynamic SSZ fields occupy a uint32 offset slot in the fixed section; fixed-size fields stay inline.
const wrapPointer = (p) => (p.size === undefined ? P.pointer(P.U32LE, p) : p);
const wrapRawPointer = (p) => (p.size === undefined ? P.U32LE : p);
// TODO: improve, unclear how
const fixOffsets = (r, fields, offsetFields, obj, offset) => {
    // Patch the fixed-section decode result in place: offsets are consumed in field order, and equal offsets
    // are valid when an earlier dynamic field is empty.
    const offsets = [];
    for (const f of offsetFields)
        offsets.push(obj[f] + offset);
    for (let i = 0; i < offsets.length; i++) {
        // TODO: how to merge this with array?
        const name = offsetFields[i];
        const pos = offsets[i];
        const next = i + 1 < offsets.length ? offsets[i + 1] : r.totalBytes;
        if (next < pos)
            throw r.err('SSZ/container: decreasing offset');
        const len = next - pos;
        if (r.pos !== pos)
            throw r.err('SSZ/container: wrong offset');
        obj[name] = fields[name].decode(r.bytes(len));
    }
    return obj;
};
/**
 * Creates an SSZ container coder from named fields.
 * @param fields - Field coders keyed by the serialized field name.
 * @returns SSZ container coder with Merkle tree support.
 * @throws On wrong argument types. {@link TypeError}
 * @throws If the field set is empty or contains invalid SSZ coders. {@link Error}
 * @example
 * Encode a single-field SSZ container object.
 * ```ts
 * import { container, uint8 } from 'micro-eth-signer/advanced/ssz.js';
 * container({ a: uint8 }).encode({ a: 1 });
 * ```
 */
export const container = (fields) => {
    if (!isObject(fields))
        throw new TypeError(`"fields" expected object, got type=${typeof fields}`);
    const fs = { ...fields };
    if (!Object.keys(fs).length)
        throw new Error('SSZ/container: no fields');
    for (const k in fs)
        checkSSZ(fs[k], `fields.${k}`);
    const ptrCoder = P.struct(Object.fromEntries(Object.entries(fs).map(([k, v]) => [k, wrapPointer(v)])));
    const fixedCoder = P.struct(Object.fromEntries(Object.entries(fs).map(([k, v]) => [k, wrapRawPointer(v)])));
    const offsetFields = Object.keys(fs).filter((i) => fs[i].size === undefined);
    const coder = P.wrap({
        encodeStream: ptrCoder.encodeStream,
        decodeStream: (r) => fixOffsets(r, fs, offsetFields, fixedCoder.decodeStream(r), 0),
    });
    return freezeSSZ({
        ...coder,
        info: { type: 'container', fields: fs },
        _isProgressiveCompat(other) {
            return isProgressiveCompat(this, other);
        },
        size: offsetFields.length ? undefined : fixedCoder.size, // structure is fixed size if all fields is fixed size
        // Container defaults are public values too; reusing child defaults here lets caller edits leak into later defaults.
        get default() {
            return Object.fromEntries(Object.entries(fs).map(([k, v]) => [k, v.default]));
        },
        composite: true,
        chunkCount: Object.keys(fs).length,
        chunks(value) {
            if (!isObject(value))
                throw new TypeError(`"value" expected object, got type=${typeof value}`);
            const val = value;
            return Object.entries(fs).map(([k, v]) => v.merkleRoot(val[k]));
        },
        merkleRoot(value) {
            return merkleize(this.chunks(value));
        },
    });
};
// Like 'P.bits', but different direction
const bitsCoder = (len) => ({
    encode: (data) => {
        const res = [];
        for (const byte of data)
            for (let i = 0; i < 8; i++)
                res.push(!!(byte & (1 << i)));
        for (let i = len; i < res.length; i++) {
            if (res[i])
                throw new Error('SSZ/bitsCoder/encode: non-zero padding');
        }
        return res.slice(0, len);
    },
    decode: (data) => {
        // Caller must already clip to exactly `len` bits; otherwise extra booleans spill into the serialized padding bits.
        const res = new Uint8Array(Math.ceil(len / 8));
        for (let i = 0; i < data.length; i++)
            if (data[i])
                res[Math.floor(i / 8)] |= 1 << (i % 8);
        return res;
    },
});
/**
 * Creates an SSZ bitvector coder.
 * @param len - Exact number of bits stored in the vector.
 * @returns Fixed-size bitvector coder.
 * @throws If the bitvector length is invalid. {@link Error}
 * @example
 * Encode exactly four boolean flags.
 * ```ts
 * bitvector(4).encode([true, false, true, false]);
 * ```
 */
export const bitvector = (len) => {
    if (!Number.isSafeInteger(len) || len <= 0)
        throw new Error(`SSZ/bitVector: wrong length=${len} (should be positive integer)`);
    const bytesLen = Math.ceil(len / 8);
    // Fixed bitvectors must reject caller arrays that are not exactly N bits; otherwise extra bits spill into serialized padding.
    const coder = P.validate(P.apply(P.bytes(bytesLen), bitsCoder(len)), (value) => {
        if (!Array.isArray(value) || value.length !== len)
            throw new Error(`SSZ/bitVector: wrong value=${value} (len=${value?.length} expected=${len})`);
        return value;
    });
    return freezeSSZ({
        ...coder,
        info: { type: 'bitVector', N: len },
        _isProgressiveCompat(other) {
            return isProgressiveCompat(this, other);
        },
        // Bitvector defaults are public values too; reusing one mutable array lets caller edits leak into later defaults.
        get default() {
            return new Array(len).fill(false);
        },
        composite: true,
        chunkCount: Math.ceil(len / 256),
        chunks(value) {
            return chunks(this.encode(value));
        },
        merkleRoot(value) {
            return merkleize(this.chunks(value), this.chunkCount);
        },
    });
};
/**
 * Creates an SSZ bitlist coder.
 * @param maxLen - Maximum number of bits allowed in the list.
 * @returns Variable-size bitlist coder.
 * @throws If the bitlist length or encoded value is invalid. {@link Error}
 * @example
 * Encode up to four boolean flags with a terminator bit.
 * ```ts
 * bitlist(4).encode([true, false, true]);
 * ```
 */
export const bitlist = (maxLen) => {
    if (!Number.isSafeInteger(maxLen) || maxLen <= 0)
        throw new Error(`SSZ/bitList: wrong max length=${maxLen} (should be positive integer)`);
    const chunkCount = Math.ceil(maxLen / 256);
    const emptyRoot = zeroHashes[Math.ceil(Math.log2(chunkCount))];
    let coder = P.wrap({
        encodeStream: (w, value) => {
            w.bytes(bitsCoder(value.length + 1).decode([...value, true])); // last true bit is terminator
        },
        decodeStream: (r) => {
            const bytes = r.bytes(r.leftBytes); // use everything
            if (!bytes.length || bytes[bytes.length - 1] === 0)
                throw new Error('SSZ/bitlist: empty trailing byte');
            const bits = bitsCoder(bytes.length * 8).encode(bytes);
            const terminator = bits.lastIndexOf(true);
            if (terminator === -1)
                throw new Error('SSZ/bitList: no terminator');
            return bits.slice(0, terminator);
        },
    });
    coder = P.validate(coder, (value) => {
        if (!Array.isArray(value) || value.length > maxLen)
            throw new Error(`SSZ/bitList/encode: wrong value=${value} (${typeof value})`);
        return value;
    });
    return freezeSSZ({
        ...coder,
        info: { type: 'bitList', N: maxLen },
        _isProgressiveCompat(other) {
            return isProgressiveCompat(this, other);
        },
        size: undefined,
        // Bitlist defaults are public values too; reusing one mutable array lets caller edits leak into later defaults.
        get default() {
            return [];
        },
        chunkCount,
        composite: true,
        chunks(value) {
            const data = value.length ? bitvector(value.length).encode(value) : EMPTY_CHUNK.slice();
            return chunks(data);
        },
        merkleRoot(value) {
            const root = value.length ? merkleize(this.chunks(value), this.chunkCount) : emptyRoot;
            return mixInLength(root, value.length);
        },
    });
};
/**
 * Creates an unbounded SSZ progressive-bitlist coder.
 * @returns Variable-size progressive bitlist coder with terminator-bit serialization.
 * @example
 * Encode boolean flags with progressive bitlist serialization.
 * ```ts
 * import { progressiveBitlist } from 'micro-eth-signer/advanced/ssz.js';
 * progressiveBitlist().encode([true, false]);
 * ```
 */
export const progressiveBitlist = () => {
    let coder = P.wrap({
        encodeStream: (w, value) => {
            w.bytes(bitsCoder(value.length + 1).decode([...value, true]));
        },
        decodeStream: (r) => {
            const bytes = r.bytes(r.leftBytes);
            if (!bytes.length || bytes[bytes.length - 1] === 0)
                throw new Error('SSZ/progressiveBitlist: empty trailing byte');
            const bits = bitsCoder(bytes.length * 8).encode(bytes);
            const terminator = bits.lastIndexOf(true);
            if (terminator === -1)
                throw new Error('SSZ/progressiveBitList: no terminator');
            return bits.slice(0, terminator);
        },
    });
    coder = P.validate(coder, (value) => {
        if (!Array.isArray(value))
            throw new Error(`SSZ/progressiveBitList/encode: wrong value=${value} (${typeof value})`);
        return value;
    });
    return freezeSSZ({
        ...coder,
        info: { type: 'progressiveBitList' },
        _isProgressiveCompat(other) {
            return isProgressiveCompat(this, other);
        },
        size: undefined,
        get default() {
            return [];
        },
        chunkCount: NaN,
        composite: true,
        chunks(value) {
            if (!value.length)
                return [];
            return chunks(bitsCoder(value.length).decode(value));
        },
        merkleRoot(value) {
            return mixInLength(merkleizeProgressive(this.chunks(value)), value.length);
        },
    });
};
/**
 * Creates an SSZ union coder from ordered variants.
 * @param types - Variant coders in discriminant order.
 * @returns Union coder that serializes the active variant index and payload.
 * @throws On wrong argument types. {@link TypeError}
 * @throws If the union variants are invalid or the selector/value pair is incompatible. {@link Error}
 * @example
 * Encode the second union variant with selector `1`.
 * ```ts
 * import { uint8, union } from 'micro-eth-signer/advanced/ssz.js';
 * union(null, uint8).encode({ selector: 1, value: 7 });
 * ```
 */
export const union = (...types) => {
    const ts = types;
    if (ts.length < 1 || ts.length >= 128)
        throw Error('SSZ/union: should have [1...128) types');
    if (ts[0] === null && ts.length < 2)
        throw new Error('SSZ/union: should have at least 2 types if first is null');
    for (let i = 0; i < ts.length; i++) {
        if (i > 0 && ts[i] === null)
            throw new Error('SSZ/union: only first type can be null');
        if (ts[i] !== null)
            checkSSZ(ts[i], `types.${i}`);
    }
    const none = P.apply(P.magicBytes(P.EMPTY), {
        encode: () => null,
        decode: (value) => {
            if (value !== null && value !== undefined)
                throw new Error(`SSZ/union: wrong null-branch value=${value}`);
            return undefined;
        },
    });
    const coder = P.apply(P.tag(P.U8, Object.fromEntries(ts.map((t, i) => [i, t === null ? none : P.prefix(null, t)]))), {
        encode: ({ TAG, data }) => ({ selector: TAG, value: data }),
        decode: ({ selector, value }) => ({ TAG: selector, data: value }),
    });
    const res = {
        ...coder,
        size: undefined, // union is always variable size
        chunkCount: NaN,
        // SSZ None maps to public `null`; `undefined` is still accepted on encode for older callers.
        get default() {
            return { selector: 0, value: ts[0] === null ? null : ts[0].default };
        },
        _isProgressiveCompat(other) {
            return isProgressiveCompat(this, other);
        },
        composite: true,
        chunks({ selector, value }) {
            const type = ts[selector];
            if (type === null)
                return [EMPTY_CHUNK.slice()];
            return [ts[selector].merkleRoot(value)];
        },
        merkleRoot: ({ selector, value }) => {
            const type = ts[selector];
            if (type === null)
                return mixInSelector(EMPTY_CHUNK, 0);
            return mixInSelector(ts[selector].merkleRoot(value), selector);
        },
    };
    return freezeSSZ(res);
};
/**
 * Creates an SSZ compatible-union coder from explicit selector options.
 * @param types - Variant coders keyed by uint8 selectors 1 through 127.
 * @returns Compatible-union coder that serializes selector byte plus payload.
 * @throws On wrong argument types. {@link TypeError}
 * @throws If the selector map is empty, out of range, or has incompatible variants. {@link Error}
 * @example
 * Encode a value with selector `1`.
 * ```ts
 * import { compatibleUnion, uint8 } from 'micro-eth-signer/advanced/ssz.js';
 * compatibleUnion({ 1: uint8 }).encode({ selector: 1, data: 7 });
 * ```
 */
export const compatibleUnion = (types) => {
    const ts = { ...types };
    if (!isObject(types) || !Object.keys(ts).length)
        throw new Error('SSZ/compatibleUnion: no types');
    const entries = Object.entries(ts);
    for (let i = 0; i < entries.length; i++) {
        const [k, t] = entries[i];
        const selector = Number(k);
        if (`${selector}` !== k || !Number.isSafeInteger(selector) || selector < 1 || selector > 127)
            throw new Error(`SSZ/compatibleUnion: wrong selector=${k}`);
        checkSSZ(t, `types.${k}`);
        for (let j = 0; j < i; j++) {
            if (!t._isProgressiveCompat(entries[j][1]))
                throw new Error(`SSZ/compatibleUnion: incompatible selector=${k}`);
        }
    }
    const coder = P.apply(P.tag(P.U8, Object.fromEntries(entries.map(([k, t]) => [k, P.prefix(null, t)]))), {
        encode: ({ TAG, data }) => ({ selector: TAG, data }),
        decode: ({ selector, data }) => ({ TAG: selector, data }),
    });
    const res = {
        ...coder,
        info: { type: 'compatibleUnion', types: ts },
        size: undefined,
        chunkCount: NaN,
        get default() {
            throw new Error('SSZ/compatibleUnion: no default');
        },
        _isProgressiveCompat(other) {
            return isProgressiveCompat(this, other);
        },
        composite: true,
        chunks({ selector, data }) {
            return [ts[selector].merkleRoot(data)];
        },
        merkleRoot({ selector, data }) {
            return mixInSelector(ts[selector].merkleRoot(data), selector);
        },
    };
    return freezeSSZ(res);
};
/**
 * Creates an SSZ byte-list coder.
 * @param maxLen - Maximum number of bytes allowed in the list.
 * @returns Variable-size byte-list coder.
 * @throws If the maximum length or encoded byte list is invalid. {@link Error}
 * @example
 * Encode a variable-length byte payload with a four-byte limit.
 * ```ts
 * bytelist(4).encode(new Uint8Array([1, 2]));
 * ```
 */
export const bytelist = (maxLen) => {
    // maxLen is structural SSZ metadata; non-integer or negative bounds make chunkCount and Merkle limits incoherent.
    if (!Number.isSafeInteger(maxLen) || maxLen < 0)
        throw new Error(`SSZ/bytelist: wrong length=${maxLen} (should be non-negative integer)`);
    const coder = P.validate(P.bytes(null), (value) => {
        if (!isBytes(value) || value.length > maxLen)
            throw new Error(`SSZ/bytelist: wrong value=${value}`);
        return value;
    });
    return freezeSSZ({
        ...coder,
        info: { type: 'list', N: maxLen, inner: byte },
        _isProgressiveCompat(other) {
            return isProgressiveCompat(this, other);
        },
        get default() {
            return Uint8Array.of();
        },
        composite: true,
        chunkCount: Math.ceil(maxLen / 32),
        chunks(value) {
            return chunks(this.encode(value));
        },
        merkleRoot(value) {
            return mixInLength(merkleize(this.chunks(value), this.chunkCount), value.length);
        },
    });
};
/**
 * Creates an SSZ byte-vector coder.
 * @param len - Exact number of bytes stored in the vector.
 * @returns Fixed-size byte-vector coder.
 * @throws If the byte-vector length is invalid. {@link Error}
 * @example
 * Encode exactly two bytes.
 * ```ts
 * bytevector(2).encode(new Uint8Array([1, 2]));
 * ```
 */
export const bytevector = (len) => {
    if (!Number.isSafeInteger(len) || len <= 0)
        throw new Error(`SSZ/vector: wrong length=${len} (should be positive integer)`);
    return freezeSSZ({
        ...P.bytes(len),
        info: { type: 'vector', N: len, inner: byte },
        _isProgressiveCompat(other) {
            return isProgressiveCompat(this, other);
        },
        // Bytevector defaults are public values too; reusing one mutable Uint8Array lets caller edits leak into later defaults.
        get default() {
            return new Uint8Array(len);
        },
        composite: true,
        chunkCount: Math.ceil(len / 32),
        chunks(value) {
            return chunks(this.encode(value));
        },
        merkleRoot(value) {
            return merkleize(this.chunks(value));
        },
    });
};
/**
 * Creates an SSZ progressive-container coder.
 * @param activeFields - Progressive active-field bitmap. It must end in `1` and contain exactly one `1` per field.
 * @param fields - Field coders keyed by field name.
 * @returns Progressive-container coder compatible with SSZ profiles.
 * @throws On wrong argument types. {@link TypeError}
 * @throws If the field set or active-field bitmap is invalid. {@link Error}
 * @example
 * Encode a progressive container with one active field.
 * ```ts
 * import { progressiveContainer, uint8 } from 'micro-eth-signer/advanced/ssz.js';
 * progressiveContainer([1], { side: uint8 }).encode({ side: 3 });
 * ```
 */
export const progressiveContainer = (activeFields, fields) => {
    if (!isObject(fields))
        throw new TypeError(`"fields" expected object, got type=${typeof fields}`);
    const fs = { ...fields };
    const fieldsLen = Object.keys(fs).length;
    if (!fieldsLen)
        throw new Error('SSZ/progressiveContainer: no fields');
    for (const k in fs)
        checkSSZ(fs[k], `fields.${k}`);
    aarray(activeFields, 'activeFields');
    if (!activeFields.length || activeFields.length > 256)
        throw new Error('SSZ/progressiveContainer: wrong activeFields');
    const active = activeFields.map((i) => {
        if (i === true || i === 1)
            return true;
        if (i === false || i === 0)
            return false;
        throw new Error('SSZ/progressiveContainer: wrong activeFields');
    });
    // simple-serialize.md §Illegal types: active_fields must end in 1 and contain exactly one 1 per field.
    if (!active[active.length - 1])
        throw new Error('SSZ/progressiveContainer: trailing inactive');
    if (active.filter(Boolean).length !== fieldsLen)
        throw new Error('SSZ/progressiveContainer: activeFields/fields mismatch');
    const coder = container(fs);
    return freezeSSZ({
        ...coder,
        info: { type: 'progressiveContainer', activeFields: active, fields: fs },
        _isProgressiveCompat(other) {
            return isProgressiveCompat(this, other);
        },
        // Object spread materializes the wrapped container getter once; keep progressive defaults fresh too.
        get default() {
            return coder.default;
        },
        chunkCount: active.length,
        chunks(value) {
            if (!isObject(value))
                throw new TypeError(`"value" expected object, got type=${typeof value}`);
            const res = [];
            let field = 0;
            const entries = Object.entries(fs);
            for (const enabled of active) {
                if (!enabled) {
                    res.push(EMPTY_CHUNK.slice());
                    continue;
                }
                const [k, v] = entries[field++];
                // Progressive active-field positions are part of the Merkle input, so inactive slots stay as zero chunks.
                res.push(v.merkleRoot(value[k]));
            }
            return res;
        },
        merkleRoot(value) {
            const activeChunk = EMPTY_CHUNK.slice();
            activeChunk.set(bitsCoder(active.length).decode(active));
            return hash(merkleizeProgressive(this.chunks(value)), activeChunk);
        },
    });
};
/**
 * Creates an SSZ profile coder over a progressive container.
 * @param c - Base progressive-container coder.
 * @param optFields - Field names marked optional in the profile.
 * @param requiredFields - Field names that must stay present in the profile.
 * @param replaceType - Optional type replacements for profiled fields.
 * @returns Profile coder constrained to the selected optional fields.
 * @throws On wrong argument types. {@link TypeError}
 * @throws If the progressive container, field lists, or replacement types are invalid. {@link Error}
 * @example
 * Build related required-field and optional-field views over one progressive container.
 * ```ts
 * import * as SSZ from 'micro-eth-signer/advanced/ssz.js';
 * const Shape = SSZ.progressiveContainer([1, 1, 1], {
 *   side: SSZ.uint16,
 *   color: SSZ.uint8,
 *   radius: SSZ.uint16,
 * });
 * const Square = SSZ.profile(Shape, [], ['side', 'color']);
 * const Circle = SSZ.profile(Shape, ['radius'], ['color']);
 * const Circle2 = SSZ.profile(Shape, ['radius'], ['color'], { color: SSZ.byte });
 * ```
 * @example
 * Build a required-field view over a progressive container.
 * ```ts
 * import { profile, progressiveContainer, uint8 } from 'micro-eth-signer/advanced/ssz.js';
 * const Shape = progressiveContainer([1], { side: uint8 });
 * profile(Shape, [], ['side']).encode({ side: 3 });
 * ```
 */
export const profile = (c, optFields, requiredFields = [], replaceType = {}) => {
    const base = c;
    checkSSZ(base, 'c');
    if (base.info.type !== 'progressiveContainer')
        throw new Error('profile: expected progressiveContainer');
    const containerFields = new Set(Object.keys(base.info.fields));
    aarray(optFields, 'optFields', astring);
    const optFS = new Set(optFields);
    for (const f of optFS) {
        if (!containerFields.has(f))
            throw new Error(`profile: unexpected optional field ${f}`);
    }
    aarray(requiredFields, 'requiredFields', astring);
    const reqFS = new Set(requiredFields);
    for (const f of reqFS) {
        if (!containerFields.has(f))
            throw new Error(`profile: unexpected required field ${f}`);
        if (optFS.has(f))
            throw new Error(`profile: field ${f} is declared both as optional and required`);
    }
    if (!isObject(replaceType))
        throw new Error('profile: replaceType should be object');
    for (const k in replaceType) {
        if (!containerFields.has(k))
            throw new Error(`profile/replaceType: unexpected field ${k}`);
        checkSSZ(replaceType[k], `replaceType.${k}`);
        if (!replaceType[k]._isProgressiveCompat(base.info.fields[k]))
            throw new Error(`profile/replaceType: incompatible field ${k}`);
    }
    // Order should be same
    const allFields = Object.keys(base.info.fields).filter((i) => optFS.has(i) || reqFS.has(i));
    // bv is omitted if all fields are required!
    const fieldCoders = { ...base.info.fields, ...replaceType };
    let coder;
    let profileRoot = false;
    if (optFS.size === 0) {
        // All fields are required, it is just container, possible with size
        coder = container(Object.fromEntries(allFields.map((k) => [k, fieldCoders[k]])));
        profileRoot = true;
    }
    else {
        // NOTE: we cannot merge this with progressive container,
        // because some fields are active and some is not (based on required/non-required)
        const bv = bitvector(optFS.size);
        const forFields = (fn) => {
            let optPos = 0;
            for (const f of allFields) {
                const isOpt = optFS.has(f);
                fn(f, isOpt ? optPos : undefined);
                if (isOpt)
                    optPos++;
            }
        };
        coder = {
            ...P.wrap({
                encodeStream: (w, value) => {
                    const bsVal = new Array(optFS.size).fill(false);
                    const ptrCoder = {};
                    forFields((f, optPos) => {
                        const val = value[f];
                        if (optPos !== undefined && val !== undefined)
                            bsVal[optPos] = true;
                        if (optPos === undefined && val === undefined)
                            throw new Error(`profile.encode: empty required field ${f}`);
                        if (val !== undefined)
                            ptrCoder[f] = wrapPointer(fieldCoders[f]);
                    });
                    bv.encodeStream(w, bsVal);
                    w.bytes(P.struct(ptrCoder).encode(value));
                },
                decodeStream: (r) => {
                    let bsVal = bv.decodeStream(r);
                    const fixedCoder = {};
                    const offsetFields = [];
                    forFields((f, optPos) => {
                        if (optPos !== undefined && bsVal[optPos] === false)
                            return;
                        if (fieldCoders[f].size === undefined)
                            offsetFields.push(f);
                        fixedCoder[f] = wrapRawPointer(fieldCoders[f]);
                    });
                    return fixOffsets(r, fieldCoders, offsetFields, P.struct(fixedCoder).decodeStream(r), bv.size);
                },
            }),
            size: undefined,
        };
    }
    return freezeSSZ({
        ...coder,
        info: { type: 'profile', container: base },
        // Profile defaults are public values too; reusing mutable required-field defaults lets caller edits leak into later defaults.
        get default() {
            return Object.fromEntries(Array.from(reqFS).map((f) => [f, fieldCoders[f].default]));
        },
        _isProgressiveCompat(other) {
            return isProgressiveCompat(this, other);
        },
        composite: true,
        chunkCount: profileRoot ? coder.chunkCount : base.info.activeFields.length,
        chunks(value) {
            // Current consensus profiles are ordinary SSZ containers; only old optional-profile shapes use the base container root.
            return profileRoot ? coder.chunks(value) : base.chunks(value);
        },
        merkleRoot(value) {
            return profileRoot ? coder.merkleRoot(value) : base.merkleRoot(value);
        },
    });
};
// Aliases
/** Alias for `uint8`. */
export const byte = uint8;
/** Alias for `boolean`. */
export const bit = boolean;
/** Alias for `boolean`. */
export const bool = boolean;
/**
 * Alias for `bytevector`.
 * @param len - Exact number of bytes stored in the vector.
 * @returns Fixed-size byte-vector coder.
 * @example
 * Use the `bytevector` alias to encode exactly two bytes.
 * ```ts
 * bytes(2).encode(new Uint8Array([1, 2]));
 * ```
 */
export const bytes = bytevector;
// TODO: this required for tests, but can be useful for other ETH related stuff.
// Also, blobs here. Since lib is pretty small (thanks to packed), why not?
// Deneb (last eth2 fork) types:
const MAX_VALIDATORS_PER_COMMITTEE = 2048;
const MAX_PROPOSER_SLASHINGS = 16;
const MAX_ATTESTER_SLASHINGS = 2;
const MAX_ATTESTATIONS = 128;
const MAX_DEPOSITS = 16;
const MAX_VOLUNTARY_EXITS = 16;
const MAX_TRANSACTIONS_PER_PAYLOAD = 1048576;
const BYTES_PER_LOGS_BLOOM = 256;
const MAX_EXTRA_DATA_BYTES = 32;
const DEPOSIT_CONTRACT_TREE_DEPTH = /* @__PURE__ */ (() => 2 ** 5)();
const SYNC_COMMITTEE_SIZE = 512;
const MAX_BYTES_PER_TRANSACTION = 1073741824;
const MAX_BLS_TO_EXECUTION_CHANGES = 16;
const MAX_WITHDRAWALS_PER_PAYLOAD = 16;
const MAX_BLOB_COMMITMENTS_PER_BLOCK = 4096;
const SLOTS_PER_HISTORICAL_ROOT = 8192;
const HISTORICAL_ROOTS_LIMIT = 16777216;
const SLOTS_PER_EPOCH = 32;
const EPOCHS_PER_ETH1_VOTING_PERIOD = 64;
const VALIDATOR_REGISTRY_LIMIT = 1099511627776;
const EPOCHS_PER_HISTORICAL_VECTOR = 65536;
const EPOCHS_PER_SLASHINGS_VECTOR = 8192;
const JUSTIFICATION_BITS_LENGTH = 4;
const BYTES_PER_FIELD_ELEMENT = 32;
const FIELD_ELEMENTS_PER_BLOB = 4096;
const KZG_COMMITMENT_INCLUSION_PROOF_DEPTH = 17;
const SYNC_COMMITTEE_SUBNET_COUNT = 4;
const NEXT_SYNC_COMMITTEE_DEPTH = 5;
const BLOCK_BODY_EXECUTION_PAYLOAD_DEPTH = 4;
const FINALIZED_ROOT_DEPTH = 6;
// Electra
// Electra light-client sync-protocol.md defines gindices 86/87/169, whose floorlog2 depths are 6/6/7.
const ELECTRA_SYNC_COMMITTEE_DEPTH = 6;
const ELECTRA_FINALIZED_ROOT_DEPTH = 7;
const MAX_COMMITTEES_PER_SLOT = 64;
const PENDING_PARTIAL_WITHDRAWALS_LIMIT = 134217728;
const PENDING_DEPOSITS_LIMIT = 134217728;
const PENDING_CONSOLIDATIONS_LIMIT = 262144;
const MAX_ATTESTER_SLASHINGS_ELECTRA = 1;
const MAX_ATTESTATIONS_ELECTRA = 8;
const MAX_DEPOSIT_REQUESTS_PER_PAYLOAD = 8192;
const MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD = 16;
const MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD = 2;
// Fulu
const PROPOSER_LOOKAHEAD_VECTOR = 64;
const FIELD_ELEMENTS_PER_CELL = 64;
const NUMBER_OF_COLUMNS = 128;
const KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH = 4;
// We can reduce size if we inline these. But updates for new forks would be hard.
const Slot = uint64;
const Epoch = uint64;
const CommitteeIndex = uint64;
const ValidatorIndex = uint64;
const WithdrawalIndex = uint64;
const BlobIndex = uint64;
const ColumnIndex = uint64;
const RowIndex = uint64;
const Gwei = uint64;
const Root = /* @__PURE__ */ bytevector(32);
const Hash32 = /* @__PURE__ */ bytevector(32);
const Bytes32 = /* @__PURE__ */ bytevector(32);
const Version = /* @__PURE__ */ bytevector(4);
const DomainType = /* @__PURE__ */ bytevector(4);
const ForkDigest = /* @__PURE__ */ bytevector(4);
const Domain = /* @__PURE__ */ bytevector(32);
const BLSPubkey = /* @__PURE__ */ bytevector(48);
const KZGCommitment = /* @__PURE__ */ bytevector(48);
const KZGProof = /* @__PURE__ */ bytevector(48);
const BLSSignature = /* @__PURE__ */ bytevector(96);
const Ether = uint64;
const ParticipationFlags = uint8;
const ExecutionAddress = /* @__PURE__ */ bytevector(20);
const PayloadId = /* @__PURE__ */ bytevector(8);
const Transaction = /* @__PURE__ */ bytelist(MAX_BYTES_PER_TRANSACTION);
// Tree-shaking: esbuild can keep parent schema builders alive through inline arithmetic args.
const Blob = /* @__PURE__ */ bytevector(
/* @__PURE__ */ (() => BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_BLOB)());
const Cell = /* @__PURE__ */ bytevector(
/* @__PURE__ */ (() => BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_CELL)());
const Checkpoint = 
/* @__PURE__ */ container({ epoch: Epoch, root: Root });
// Forks keep the same SSZ layout here; only the meaning of `index` changes after Electra.
const AttestationData = /* @__PURE__ */ container({
    slot: Slot,
    index: CommitteeIndex,
    beacon_block_root: Root,
    source: Checkpoint,
    target: Checkpoint,
});
// Legacy attestation stays 3-field; Electra widens the outer container via `AttestationElectra` below.
const Attestation = /* @__PURE__ */ container({
    aggregation_bits: /* @__PURE__ */ bitlist(MAX_VALIDATORS_PER_COMMITTEE),
    data: AttestationData,
    signature: BLSSignature,
});
// Legacy aggregate-and-proof wrapper; Electra gossip wrappers are intentionally not exported below.
const AggregateAndProof = /* @__PURE__ */ container({
    aggregator_index: ValidatorIndex,
    aggregate: Attestation,
    selection_proof: BLSSignature,
});
// Legacy indexed attestation keeps per-committee list bounds; Electra widens them in `IndexedAttestationElectra`.
const IndexedAttestation = /* @__PURE__ */ container({
    attesting_indices: /* @__PURE__ */ list(MAX_VALIDATORS_PER_COMMITTEE, ValidatorIndex),
    data: AttestationData,
    signature: BLSSignature,
});
// Legacy attester slashings reference legacy indexed attestations; Electra swaps both branches together.
const AttesterSlashing = /* @__PURE__ */ container({
    attestation_1: IndexedAttestation,
    attestation_2: IndexedAttestation,
});
// Later forks reuse this Capella registration message as-is; only the signed wrapper and block-body list placement vary.
const BLSToExecutionChange = /* @__PURE__ */ container({
    validator_index: ValidatorIndex,
    from_bls_pubkey: BLSPubkey,
    to_execution_address: ExecutionAddress,
});
// Current payload forks in this repo still reuse the Capella four-field withdrawal container.
const Withdrawal = /* @__PURE__ */ container({
    index: WithdrawalIndex,
    validator_index: ValidatorIndex,
    address: ExecutionAddress,
    amount: Gwei,
});
// This plain export tracks the V3 payload shape (withdrawals + blob gas); older fork differences are handled by separate block/header exports below.
const ExecutionPayload = /* @__PURE__ */ container({
    parent_hash: Hash32,
    fee_recipient: ExecutionAddress,
    state_root: Bytes32,
    receipts_root: Bytes32,
    logs_bloom: /* @__PURE__ */ bytevector(BYTES_PER_LOGS_BLOOM),
    prev_randao: Bytes32,
    block_number: uint64,
    gas_limit: uint64,
    gas_used: uint64,
    timestamp: uint64,
    extra_data: /* @__PURE__ */ bytelist(MAX_EXTRA_DATA_BYTES),
    base_fee_per_gas: uint256,
    block_hash: Hash32,
    transactions: /* @__PURE__ */ list(MAX_TRANSACTIONS_PER_PAYLOAD, Transaction),
    withdrawals: /* @__PURE__ */ list(MAX_WITHDRAWALS_PER_PAYLOAD, Withdrawal),
    blob_gas_used: uint64,
    excess_blob_gas: uint64,
});
MAX_WITHDRAWALS_PER_PAYLOAD;
// compute_signing_root hashes the signed object's SSZ root together with a 32-byte domain for BLS domain separation.
const SigningData = 
/* @__PURE__ */ container({ object_root: Root, domain: Domain });
// Kept as the legacy fixed header because changing `latest_block_header` hashing would break BeaconState roots across forks.
const BeaconBlockHeader = /* @__PURE__ */ container({
    slot: Slot,
    proposer_index: ValidatorIndex,
    parent_root: Root,
    state_root: Root,
    body_root: Root,
});
// The signature is over compute_signing_root(message, proposer domain); this wrapper keeps the raw header bytes for slashing and sidecar transport.
const SignedBeaconBlockHeader = /* @__PURE__ */ container({
    message: BeaconBlockHeader,
    signature: BLSSignature,
});
// Carries the two conflicting signed proposer headers unchanged; later forks only vary the surrounding list cap.
const ProposerSlashing = /* @__PURE__ */ container({
    signed_header_1: SignedBeaconBlockHeader,
    signed_header_2: SignedBeaconBlockHeader,
});
// Legacy deposit tuple is the fixed four-field prefix that EIP-6110 deposit requests later extend with a sequential index.
const DepositData = /* @__PURE__ */ container({
    pubkey: BLSPubkey,
    withdrawal_credentials: Bytes32,
    amount: Gwei,
    signature: BLSSignature,
});
// Deposit proofs carry the tree branch plus the final mix-in-length chunk, so the fixed proof vector is DEPOSIT_CONTRACT_TREE_DEPTH + 1.
const Deposit = /* @__PURE__ */ container({
    proof: /* @__PURE__ */ vector(/* @__PURE__ */ (() => DEPOSIT_CONTRACT_TREE_DEPTH + 1)(), Bytes32),
    data: DepositData,
});
// Signed wrappers and block bodies reuse this bare exit request unchanged; only the outer signature/list placement varies.
const VoluntaryExit = /* @__PURE__ */ container({ epoch: Epoch, validator_index: ValidatorIndex });
// Altair defines the sync aggregate as the committee participation bitvector plus one aggregate BLS signature, and later bodies reuse that pair unchanged.
const SyncAggregate = /* @__PURE__ */ container({
    sync_committee_bits: /* @__PURE__ */ bitvector(SYNC_COMMITTEE_SIZE),
    sync_committee_signature: BLSSignature,
});
// Legacy eth1 voting tracks the deposit root/count together with the execution block hash that produced them; later forks still reuse this tuple in BeaconState during the EIP-6110 transition.
const Eth1Data = /* @__PURE__ */ container({
    deposit_root: Root,
    deposit_count: uint64,
    block_hash: Hash32,
});
// The signed wrapper preserves the raw voluntary-exit request plus one BLS signature, and later block bodies only list these envelopes.
const SignedVoluntaryExit = /* @__PURE__ */ container({
    message: VoluntaryExit,
    signature: BLSSignature,
});
// The signed wrapper keeps the Capella withdrawal-address registration request plus one BLS signature, and later block bodies only list these envelopes.
const SignedBLSToExecutionChange = /* @__PURE__ */ container({
    message: BLSToExecutionChange,
    signature: BLSSignature,
});
// This plain export keeps the pre-Electra beacon body with eth1/deposit/execution-payload fields; later fork-specific variants are exposed separately below.
const BeaconBlockBody = /* @__PURE__ */ container({
    randao_reveal: BLSSignature,
    eth1_data: Eth1Data,
    graffiti: Bytes32,
    proposer_slashings: /* @__PURE__ */ list(MAX_PROPOSER_SLASHINGS, ProposerSlashing),
    attester_slashings: /* @__PURE__ */ list(MAX_ATTESTER_SLASHINGS, AttesterSlashing),
    attestations: /* @__PURE__ */ list(MAX_ATTESTATIONS, Attestation),
    deposits: /* @__PURE__ */ list(MAX_DEPOSITS, Deposit),
    voluntary_exits: /* @__PURE__ */ list(MAX_VOLUNTARY_EXITS, SignedVoluntaryExit),
    sync_aggregate: SyncAggregate,
    execution_payload: ExecutionPayload,
    bls_to_execution_changes: /* @__PURE__ */ list(MAX_BLS_TO_EXECUTION_CHANGES, SignedBLSToExecutionChange),
    blob_kzg_commitments: /* @__PURE__ */ list(MAX_BLOB_COMMITMENTS_PER_BLOCK, KZGCommitment),
});
// The outer block wrapper stays the fixed slot/proposer/parent/state/body container; later forks swap the body type via separate exports instead of mutating this plain export.
const BeaconBlock = /* @__PURE__ */ container({
    slot: Slot,
    proposer_index: ValidatorIndex,
    parent_root: Root,
    state_root: Root,
    body: BeaconBlockBody,
});
// Sync committees carry the full 512-member pubkey vector together with the aggregate pubkey used by sync-aggregate verification.
const SyncCommittee = /* @__PURE__ */ container({
    pubkeys: /* @__PURE__ */ vector(SYNC_COMMITTEE_SIZE, BLSPubkey),
    aggregate_pubkey: BLSPubkey,
});
// Fork metadata tracks the version transition from `previous_version` to `current_version` at `epoch`; digest helpers key off the current version.
const Fork = /* @__PURE__ */ container({
    previous_version: Version,
    current_version: Version,
    epoch: Epoch,
});
// Validators intentionally stay on the fixed Phase0 field set; later fork logic updates balances and epochs around this object instead of redefining the container.
const Validator = /* @__PURE__ */ container({
    pubkey: BLSPubkey,
    withdrawal_credentials: Bytes32,
    effective_balance: Gwei,
    slashed: boolean,
    activation_eligibility_epoch: Epoch,
    activation_epoch: Epoch,
    exit_epoch: Epoch,
    withdrawable_epoch: Epoch,
});
// Plain execution payload headers stay on the V3 field set; later progressive and Electra exports layer request roots or profiles on top instead of mutating this base header.
const ExecutionPayloadHeader = /* @__PURE__ */ container({
    parent_hash: Hash32,
    fee_recipient: ExecutionAddress,
    state_root: Bytes32,
    receipts_root: Bytes32,
    logs_bloom: /* @__PURE__ */ bytevector(BYTES_PER_LOGS_BLOOM),
    prev_randao: Bytes32,
    block_number: uint64,
    gas_limit: uint64,
    gas_used: uint64,
    timestamp: uint64,
    extra_data: /* @__PURE__ */ bytelist(MAX_EXTRA_DATA_BYTES),
    base_fee_per_gas: uint256,
    block_hash: Hash32,
    transactions_root: Root,
    withdrawals_root: Root,
    blob_gas_used: uint64,
    excess_blob_gas: uint64,
});
// Historical summaries keep the Capella pair of block and state summary roots; later progressive and Electra beacon states reuse the same inner item type.
const HistoricalSummary = /* @__PURE__ */ container({
    block_summary_root: Root,
    state_summary_root: Root,
});
// Plain BeaconState keeps the legacy pre-progressive field set; later progressive and Electra state coders are exposed separately instead of mutating this base container in place.
const BeaconState = /* @__PURE__ */ container({
    genesis_time: uint64,
    genesis_validators_root: Root,
    slot: Slot,
    fork: Fork,
    latest_block_header: BeaconBlockHeader,
    block_roots: /* @__PURE__ */ vector(SLOTS_PER_HISTORICAL_ROOT, Root),
    state_roots: /* @__PURE__ */ vector(SLOTS_PER_HISTORICAL_ROOT, Root),
    historical_roots: /* @__PURE__ */ list(HISTORICAL_ROOTS_LIMIT, Root),
    eth1_data: Eth1Data,
    eth1_data_votes: /* @__PURE__ */ list(
    /* @__PURE__ */ (() => EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH)(), Eth1Data),
    eth1_deposit_index: uint64,
    validators: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, Validator),
    balances: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, Gwei),
    randao_mixes: /* @__PURE__ */ vector(EPOCHS_PER_HISTORICAL_VECTOR, Bytes32),
    slashings: /* @__PURE__ */ vector(EPOCHS_PER_SLASHINGS_VECTOR, Gwei),
    previous_epoch_participation: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ParticipationFlags),
    current_epoch_participation: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ParticipationFlags),
    justification_bits: /* @__PURE__ */ bitvector(JUSTIFICATION_BITS_LENGTH),
    previous_justified_checkpoint: Checkpoint,
    current_justified_checkpoint: Checkpoint,
    finalized_checkpoint: Checkpoint,
    inactivity_scores: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, uint64),
    current_sync_committee: SyncCommittee,
    next_sync_committee: SyncCommittee,
    latest_execution_payload_header: ExecutionPayloadHeader,
    next_withdrawal_index: WithdrawalIndex,
    next_withdrawal_validator_index: ValidatorIndex,
    historical_summaries: /* @__PURE__ */ list(HISTORICAL_ROOTS_LIMIT, HistoricalSummary),
});
/**
 * Deneb BeaconState coder.
 * Deneb changes BeaconState through `latest_execution_payload_header`; the
 * plain BeaconState above already uses Deneb execution payload header fields.
 */
export const DenebBeaconState = BeaconState;
const progressiveFields = (fields) => progressiveContainer(
// simple-serialize.md §Illegal types bans inactive trailing slots, so current consensus containers use only live fields.
Object.keys(fields).map(() => true), fields);
// Request commitments are not split into per-request roots on
// ExecutionPayloadHeader; future Gloas will use a separate bid field.
const ProgressiveExecutionPayloadHeader = /* @__PURE__ */ progressiveFields({
    parent_hash: Hash32,
    fee_recipient: ExecutionAddress,
    state_root: Bytes32,
    receipts_root: Bytes32,
    logs_bloom: /* @__PURE__ */ bytevector(BYTES_PER_LOGS_BLOOM),
    prev_randao: Bytes32,
    block_number: uint64,
    gas_limit: uint64,
    gas_used: uint64,
    timestamp: uint64,
    extra_data: /* @__PURE__ */ bytelist(MAX_EXTRA_DATA_BYTES),
    base_fee_per_gas: uint256,
    block_hash: Hash32,
    transactions_root: Root,
    withdrawals_root: Root, // [New in Capella]
    blob_gas_used: uint64, // [New in Deneb:EIP4844]
    excess_blob_gas: uint64, // [New in Deneb:EIP4844]
});
// consensus-specs specs/electra/beacon-chain.md §PendingDeposit: Electra queues full deposit request data plus the originating slot.
const PendingDeposit = /* @__PURE__ */ container({
    pubkey: BLSPubkey,
    withdrawal_credentials: Bytes32,
    amount: Gwei,
    signature: BLSSignature,
    slot: Slot,
});
// Kept for compatibility with older copied Electra vectors; current BeaconState uses PendingDeposit/pending_deposits.
const PendingBalanceDeposit = /* @__PURE__ */ container({
    index: ValidatorIndex,
    amount: Gwei,
});
// Electra pending partial withdrawals queue a validator index, amount, and the epoch when the withdrawal becomes processable.
const PendingPartialWithdrawal = /* @__PURE__ */ container({
    validator_index: ValidatorIndex,
    amount: Gwei,
    withdrawable_epoch: Epoch,
});
// Electra pending consolidations queue the source and target validator indices after the source exit is scheduled.
const PendingConsolidation = /* @__PURE__ */ container({
    source_index: ValidatorIndex,
    target_index: ValidatorIndex,
});
const ProgressiveBeaconState = /* @__PURE__ */ (() => progressiveFields({
    genesis_time: uint64,
    genesis_validators_root: Root,
    slot: Slot,
    fork: Fork,
    latest_block_header: BeaconBlockHeader,
    block_roots: /* @__PURE__ */ vector(SLOTS_PER_HISTORICAL_ROOT, Root),
    state_roots: /* @__PURE__ */ vector(SLOTS_PER_HISTORICAL_ROOT, Root),
    historical_roots: /* @__PURE__ */ list(HISTORICAL_ROOTS_LIMIT, Root),
    eth1_data: Eth1Data,
    eth1_data_votes: /* @__PURE__ */ list(
    /* @__PURE__ */ (() => EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH)(), Eth1Data),
    eth1_deposit_index: uint64,
    validators: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, Validator),
    balances: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, Gwei),
    randao_mixes: /* @__PURE__ */ vector(EPOCHS_PER_HISTORICAL_VECTOR, Bytes32),
    slashings: /* @__PURE__ */ vector(EPOCHS_PER_SLASHINGS_VECTOR, Gwei),
    previous_epoch_participation: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ParticipationFlags),
    current_epoch_participation: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ParticipationFlags),
    justification_bits: /* @__PURE__ */ bitvector(JUSTIFICATION_BITS_LENGTH),
    previous_justified_checkpoint: Checkpoint,
    current_justified_checkpoint: Checkpoint,
    finalized_checkpoint: Checkpoint,
    inactivity_scores: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, uint64),
    current_sync_committee: SyncCommittee,
    next_sync_committee: SyncCommittee,
    // Kept for compatibility with the existing Electra surface; this will change in Gloas to latest_execution_payload_bid.
    latest_execution_payload_header: ProgressiveExecutionPayloadHeader,
    next_withdrawal_index: WithdrawalIndex,
    next_withdrawal_validator_index: ValidatorIndex,
    historical_summaries: /* @__PURE__ */ list(HISTORICAL_ROOTS_LIMIT, HistoricalSummary),
    deposit_requests_start_index: uint64, // [New in Electra:EIP6110]
    deposit_balance_to_consume: Gwei, // [New in Electra:EIP7251]
    exit_balance_to_consume: Gwei, // [New in Electra:EIP7251]
    earliest_exit_epoch: Epoch, // [New in Electra:EIP7251]
    consolidation_balance_to_consume: Gwei, // [New in Electra:EIP7251]
    earliest_consolidation_epoch: Epoch, // [New in Electra:EIP7251]
    pending_deposits: /* @__PURE__ */ list(PENDING_DEPOSITS_LIMIT, PendingDeposit), // [New in Electra:EIP7251]
    pending_partial_withdrawals: /* @__PURE__ */ list(PENDING_PARTIAL_WITHDRAWALS_LIMIT, PendingPartialWithdrawal), // [New in Electra:EIP7251]
    pending_consolidations: /* @__PURE__ */ list(PENDING_CONSOLIDATIONS_LIMIT, PendingConsolidation), // [New in Electra:EIP7251]
    proposer_lookahead: vector(PROPOSER_LOOKAHEAD_VECTOR, ValidatorIndex), // [New in Fulu:EIP7917]
}))();
const ExecutionPayloadHeaderElectra = /* @__PURE__ */ profile(ProgressiveExecutionPayloadHeader, [], [
    'parent_hash',
    'fee_recipient',
    'state_root',
    'receipts_root',
    'logs_bloom',
    'prev_randao',
    'block_number',
    'gas_limit',
    'gas_used',
    'timestamp',
    'extra_data',
    'base_fee_per_gas',
    'block_hash',
    'transactions_root',
    'withdrawals_root',
    'blob_gas_used',
    'excess_blob_gas',
]);
const BeaconStateElectra = /* @__PURE__ */ profile(ProgressiveBeaconState, [], [
    'genesis_time',
    'genesis_validators_root',
    'slot',
    'fork',
    'latest_block_header',
    'block_roots',
    'state_roots',
    'historical_roots',
    'eth1_data',
    'eth1_data_votes',
    'eth1_deposit_index',
    'validators',
    'balances',
    'randao_mixes',
    'slashings',
    'previous_epoch_participation',
    'current_epoch_participation',
    'justification_bits',
    'previous_justified_checkpoint',
    'current_justified_checkpoint',
    'finalized_checkpoint',
    'inactivity_scores',
    'current_sync_committee',
    'next_sync_committee',
    'latest_execution_payload_header',
    'next_withdrawal_index',
    'next_withdrawal_validator_index',
    'historical_summaries',
    'deposit_requests_start_index',
    'deposit_balance_to_consume',
    'exit_balance_to_consume',
    'earliest_exit_epoch',
    'consolidation_balance_to_consume',
    'earliest_consolidation_epoch',
    'pending_deposits',
    'pending_partial_withdrawals',
    'pending_consolidations',
], {
    latest_execution_payload_header: ExecutionPayloadHeaderElectra,
});
const BeaconStateFulu = /* @__PURE__ */ profile(ProgressiveBeaconState, [], [
    'genesis_time',
    'genesis_validators_root',
    'slot',
    'fork',
    'latest_block_header',
    'block_roots',
    'state_roots',
    'historical_roots',
    'eth1_data',
    'eth1_data_votes',
    'eth1_deposit_index',
    'validators',
    'balances',
    'randao_mixes',
    'slashings',
    'previous_epoch_participation',
    'current_epoch_participation',
    'justification_bits',
    'previous_justified_checkpoint',
    'current_justified_checkpoint',
    'finalized_checkpoint',
    'inactivity_scores',
    'current_sync_committee',
    'next_sync_committee',
    'latest_execution_payload_header',
    'next_withdrawal_index',
    'next_withdrawal_validator_index',
    'historical_summaries',
    'deposit_requests_start_index',
    'deposit_balance_to_consume',
    'exit_balance_to_consume',
    'earliest_exit_epoch',
    'consolidation_balance_to_consume',
    'earliest_consolidation_epoch',
    'pending_deposits',
    'pending_partial_withdrawals',
    'pending_consolidations',
    'proposer_lookahead',
], {
    latest_execution_payload_header: ExecutionPayloadHeaderElectra,
});
// Blob identifiers stay a simple `{ block_root, index }` tuple for external blob lookup; BlobSidecar carries the full sidecar payload separately instead of nesting this helper.
const BlobIdentifier = /* @__PURE__ */ container({
    block_root: Root,
    index: BlobIndex,
});
// Blob sidecars carry the blob bytes together with the KZG witness data and the signed beacon block header needed to bind the blob to its block.
const BlobSidecar = /* @__PURE__ */ container({
    index: BlobIndex,
    blob: Blob,
    kzg_commitment: KZGCommitment,
    kzg_proof: KZGProof,
    signed_block_header: SignedBeaconBlockHeader,
    kzg_commitment_inclusion_proof: /* @__PURE__ */ vector(KZG_COMMITMENT_INCLUSION_PROOF_DEPTH, Bytes32),
});
const DataColumnSidecar = /* @__PURE__ */ container({
    index: ColumnIndex,
    column: /* @__PURE__ */ list(MAX_BLOB_COMMITMENTS_PER_BLOCK, Cell),
    kzg_commitments: /* @__PURE__ */ list(MAX_BLOB_COMMITMENTS_PER_BLOCK, KZGCommitment),
    kzg_proofs: /* @__PURE__ */ list(MAX_BLOB_COMMITMENTS_PER_BLOCK, KZGProof),
    signed_block_header: SignedBeaconBlockHeader,
    kzg_commitments_inclusion_proof: /* @__PURE__ */ vector(KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH, Bytes32),
});
const DataColumnsByRootIdentifier = /* @__PURE__ */ container({
    block_root: Root,
    columns: /* @__PURE__ */ list(NUMBER_OF_COLUMNS, ColumnIndex),
});
const MatrixEntry = /* @__PURE__ */ container({
    cell: Cell,
    kzg_proof: KZGProof,
    column_index: ColumnIndex,
    row_index: RowIndex,
});
// Sync committee contributions carry one subnet's participation bits together with the slot/root context and aggregate signature for that subcommittee.
const SyncCommitteeContribution = /* @__PURE__ */ container({
    slot: Slot,
    beacon_block_root: Root,
    subcommittee_index: uint64,
    aggregation_bits: /* @__PURE__ */ bitvector(
    /* @__PURE__ */ (() => SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT)()),
    signature: BLSSignature,
});
// The wrapper binds one sync committee contribution to the selected aggregator validator and its selection proof without changing the inner contribution layout.
const ContributionAndProof = /* @__PURE__ */ container({
    aggregator_index: ValidatorIndex,
    contribution: SyncCommitteeContribution,
    selection_proof: BLSSignature,
});
// Deposit messages keep only the unsigned deposit payload prefix; signatures and indices live in the larger deposit data / request wrappers.
const DepositMessage = /* @__PURE__ */ container({
    pubkey: BLSPubkey,
    withdrawal_credentials: Bytes32,
    amount: Gwei,
});
// Eth1Block matches the phase0 validator helper shape: timestamp plus deposit contract state; Eth1Data derives block_hash from hash_tree_root(block).
const Eth1Block = /* @__PURE__ */ container({
    timestamp: uint64,
    deposit_root: Root,
    deposit_count: uint64,
});
// ForkData stays the plain `{ current_version, genesis_validators_root }` pair hashed by `compute_fork_data_root`, even when later fork-digest helpers add extra runtime inputs.
const ForkData = /* @__PURE__ */ container({
    current_version: Version,
    genesis_validators_root: Root,
});
// HistoricalBatch keeps the archived `block_roots` / `state_roots` windows that historical roots commit to, so proofs can descend from a historical batch root back to per-slot roots.
const HistoricalBatch = /* @__PURE__ */ container({
    block_roots: /* @__PURE__ */ vector(SLOTS_PER_HISTORICAL_ROOT, Root),
    state_roots: /* @__PURE__ */ vector(SLOTS_PER_HISTORICAL_ROOT, Root),
});
// PendingAttestation keeps the legacy BeaconState wrapper that pairs attestation data with committee bits and inclusion metadata for later reward / proposer accounting.
const PendingAttestation = /* @__PURE__ */ container({
    aggregation_bits: /* @__PURE__ */ bitlist(MAX_VALIDATORS_PER_COMMITTEE),
    data: AttestationData,
    inclusion_delay: Slot,
    proposer_index: ValidatorIndex,
});
// PowBlock keeps the minimal merge-era PoW tuple: this block hash, its parent link, and total difficulty for terminal-block checks, not a full execution header.
const PowBlock = /* @__PURE__ */ container({
    block_hash: Hash32,
    parent_hash: Hash32,
    total_difficulty: uint256,
});
// Signed legacy aggregate-and-proof wrapper; Electra gossip wrappers are intentionally not exported below.
const SignedAggregateAndProof = /* @__PURE__ */ container({
    message: AggregateAndProof,
    signature: BLSSignature,
});
// SignedBeaconBlock stays the plain proposer-signature envelope over `BeaconBlock`; any fork-specific shape changes live in the nested block/body types, not in the outer wrapper.
const SignedBeaconBlock = /* @__PURE__ */ container({
    message: BeaconBlock,
    signature: BLSSignature,
});
// The signed wrapper adds no fork-specific fields of its own; it simply signs the existing `ContributionAndProof` payload used for sync committee aggregation.
const SignedContributionAndProof = /* @__PURE__ */ container({
    message: ContributionAndProof,
    signature: BLSSignature,
});
// Sync aggregator selection proofs sign only the target slot and the chosen sync subcommittee index; the contribution itself is carried separately later.
const SyncAggregatorSelectionData = /* @__PURE__ */ container({
    slot: Slot,
    subcommittee_index: uint64,
});
// Sync committee messages are the per-validator signed votes over one beacon block root for one slot; aggregates and slashing evidence compose these messages later.
const SyncCommitteeMessage = /* @__PURE__ */ container({
    slot: Slot,
    beacon_block_root: Root,
    validator_index: ValidatorIndex,
    signature: BLSSignature,
});
const LightClientHeader = /* @__PURE__ */ container({
    // Light-client headers pair a beacon header with the execution payload header plus the Merkle branch proving that execution header was included in the beacon block body.
    beacon: BeaconBlockHeader,
    execution: ExecutionPayloadHeader,
    execution_branch: /* @__PURE__ */ vector(BLOCK_BODY_EXECUTION_PAYLOAD_DEPTH, Bytes32),
});
// Light-client bootstraps pair one trusted header with the current sync committee and the Merkle branch proving that committee at the header state root.
const LightClientBootstrap = /* @__PURE__ */ container({
    header: LightClientHeader,
    current_sync_committee: SyncCommittee,
    current_sync_committee_branch: /* @__PURE__ */ vector(NEXT_SYNC_COMMITTEE_DEPTH, Bytes32),
});
// Light-client updates bundle the attested/finalized headers, the optional next-committee and finality proofs, the signing aggregate, and the slot that aggregate signed for.
const LightClientUpdate = /* @__PURE__ */ container({
    attested_header: LightClientHeader,
    next_sync_committee: SyncCommittee,
    next_sync_committee_branch: /* @__PURE__ */ vector(NEXT_SYNC_COMMITTEE_DEPTH, Bytes32),
    finalized_header: LightClientHeader,
    finality_branch: /* @__PURE__ */ vector(FINALIZED_ROOT_DEPTH, Bytes32),
    sync_aggregate: SyncAggregate,
    signature_slot: Slot,
});
// Finality-only light-client updates drop next-sync-committee data and keep only the finalized-header proof plus the signing aggregate and slot.
const LightClientFinalityUpdate = /* @__PURE__ */ container({
    attested_header: LightClientHeader,
    finalized_header: LightClientHeader,
    finality_branch: /* @__PURE__ */ vector(FINALIZED_ROOT_DEPTH, Bytes32),
    sync_aggregate: SyncAggregate,
    signature_slot: Slot,
});
// Optimistic light-client updates keep only the attested header plus the sync aggregate and slot used to rank and verify that optimistic head.
const LightClientOptimisticUpdate = /* @__PURE__ */ container({
    attested_header: LightClientHeader,
    sync_aggregate: SyncAggregate,
    signature_slot: Slot,
});
const lightClient = (header, syncDepth, finalityDepth) => {
    const LightClientBootstrapFork = /* @__PURE__ */ container({
        header,
        current_sync_committee: SyncCommittee,
        current_sync_committee_branch: /* @__PURE__ */ vector(syncDepth, Bytes32),
    });
    const LightClientUpdateFork = /* @__PURE__ */ container({
        attested_header: header,
        next_sync_committee: SyncCommittee,
        next_sync_committee_branch: /* @__PURE__ */ vector(syncDepth, Bytes32),
        finalized_header: header,
        finality_branch: /* @__PURE__ */ vector(finalityDepth, Bytes32),
        sync_aggregate: SyncAggregate,
        signature_slot: Slot,
    });
    const LightClientFinalityUpdateFork = /* @__PURE__ */ container({
        attested_header: header,
        finalized_header: header,
        finality_branch: /* @__PURE__ */ vector(finalityDepth, Bytes32),
        sync_aggregate: SyncAggregate,
        signature_slot: Slot,
    });
    const LightClientOptimisticUpdateFork = /* @__PURE__ */ container({
        attested_header: header,
        sync_aggregate: SyncAggregate,
        signature_slot: Slot,
    });
    return {
        LightClientHeader: header,
        LightClientBootstrap: LightClientBootstrapFork,
        LightClientUpdate: LightClientUpdateFork,
        LightClientFinalityUpdate: LightClientFinalityUpdateFork,
        LightClientOptimisticUpdate: LightClientOptimisticUpdateFork,
        // TRet annotates the public byte boundary; the generic header is already an SSZ coder.
    };
};
// Altair light-client headers contain only a beacon header.
const LightClientHeaderAltair = 
/* @__PURE__ */ container({ beacon: BeaconBlockHeader });
const LightClientAltair = 
/* @__PURE__ */ lightClient(LightClientHeaderAltair, NEXT_SYNC_COMMITTEE_DEPTH, FINALIZED_ROOT_DEPTH);
const LightClientDeneb = {
    LightClientHeader,
    LightClientBootstrap,
    LightClientUpdate,
    LightClientFinalityUpdate,
    LightClientOptimisticUpdate,
};
// Electra
// Deposit requests flatten the legacy deposit data and append the sequential request index used during the EIP-6110 transition.
const DepositRequest = /* @__PURE__ */ container({
    pubkey: BLSPubkey,
    withdrawal_credentials: Bytes32,
    amount: Gwei,
    signature: BLSSignature,
    index: uint64,
});
// Withdrawal requests carry the execution source address, validator pubkey, and requested amount exactly as dequeued from the EIP-7002 EL queue.
const WithdrawalRequest = /* @__PURE__ */ container({
    source_address: ExecutionAddress,
    validator_pubkey: BLSPubkey,
    amount: Gwei,
});
// Consolidation requests carry the EL source address plus the source/target validator pubkeys exactly as dequeued from the EIP-7251 EL queue.
const ConsolidationRequest = /* @__PURE__ */ container({
    source_address: ExecutionAddress,
    source_pubkey: BLSPubkey,
    target_pubkey: BLSPubkey,
});
// Electra p2p-interface sends single-attestation gossip with committee/attester indices outside AttestationData.
const SingleAttestation = /* @__PURE__ */ container({
    committee_index: CommitteeIndex,
    attester_index: ValidatorIndex,
    data: AttestationData,
    signature: BLSSignature,
});
// Private construction registry: older fork coders below need stable/shared
// pieces without accidentally depending on the public latest-fork ETH2_TYPES.
const ETH2_BASE = /* @__PURE__ */ freezeRegistry({
    Slot,
    Epoch,
    CommitteeIndex,
    ValidatorIndex,
    WithdrawalIndex,
    Gwei,
    Root,
    Hash32,
    Bytes32,
    Version,
    DomainType,
    ForkDigest,
    Domain,
    BLSPubkey,
    BLSSignature,
    Ether,
    ParticipationFlags,
    ExecutionAddress,
    PayloadId,
    KZGCommitment,
    KZGProof,
    // Containters
    Checkpoint,
    AttestationData,
    Attestation,
    AggregateAndProof,
    IndexedAttestation,
    AttesterSlashing,
    BLSToExecutionChange,
    ExecutionPayload,
    SyncAggregate,
    VoluntaryExit,
    BeaconBlockHeader,
    SigningData,
    SignedBeaconBlockHeader,
    ProposerSlashing,
    DepositData,
    Deposit,
    SignedVoluntaryExit,
    Eth1Data,
    Withdrawal,
    BeaconBlockBody,
    BeaconBlock,
    SyncCommittee,
    Fork,
    Validator,
    ExecutionPayloadHeader,
    HistoricalSummary,
    BeaconState,
    BeaconStateElectra,
    BeaconStateFulu,
    BlobIdentifier,
    BlobSidecar,
    DataColumnSidecar,
    DataColumnsByRootIdentifier,
    MatrixEntry,
    ContributionAndProof,
    DepositMessage,
    Eth1Block,
    ForkData,
    HistoricalBatch,
    PendingAttestation,
    PowBlock,
    Transaction,
    SignedAggregateAndProof,
    SignedBLSToExecutionChange,
    SignedBeaconBlock,
    SignedContributionAndProof,
    SyncAggregatorSelectionData,
    SyncCommitteeContribution,
    SyncCommitteeMessage,
    // Light client
    LightClientHeader,
    LightClientBootstrap,
    LightClientUpdate,
    LightClientOptimisticUpdate,
    LightClientFinalityUpdate,
    // Electra
    DepositRequest,
    WithdrawalRequest,
    ConsolidationRequest,
    SingleAttestation,
    PendingDeposit,
    PendingBalanceDeposit,
    PendingPartialWithdrawal,
    PendingConsolidation,
});
// Progressive attestation mirrors the Electra attestation field order under EIP-7688 progressive merkleization.
const ProgressiveAttestation = /* @__PURE__ */ progressiveFields({
    aggregation_bits: /* @__PURE__ */ bitlist(
    /* @__PURE__ */ (() => MAX_VALIDATORS_PER_COMMITTEE * MAX_COMMITTEES_PER_SLOT)()),
    data: AttestationData,
    signature: BLSSignature,
    committee_bits: /* @__PURE__ */ bitvector(MAX_COMMITTEES_PER_SLOT),
});
// Progressive indexed attestation mirrors the Electra slashable-evidence shape while widening `attesting_indices`.
const ProgressiveIndexedAttestation = /* @__PURE__ */ progressiveFields({
    attesting_indices: /* @__PURE__ */ list(
    /* @__PURE__ */ (() => MAX_VALIDATORS_PER_COMMITTEE * MAX_COMMITTEES_PER_SLOT)(), ValidatorIndex),
    data: AttestationData,
    signature: BLSSignature,
});
// Progressive attester slashing keeps the Electra slashable-evidence pair on widened indexed attestations without outer committee data.
const ProgressiveAttesterSlashing = /* @__PURE__ */ container({
    attestation_1: ProgressiveIndexedAttestation,
    attestation_2: ProgressiveIndexedAttestation,
});
// Consensus-specs Electra ExecutionRequests uses these short SSZ field names; the EIP request names are not the container API keys.
const ProgressiveExecutionRequests = /* @__PURE__ */ progressiveFields({
    deposits: /* @__PURE__ */ list(MAX_DEPOSIT_REQUESTS_PER_PAYLOAD, DepositRequest), // [New in Electra:EIP6110]
    withdrawals: /* @__PURE__ */ list(MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD, WithdrawalRequest), // [New in Electra:EIP7002:EIP7251]
    consolidations: /* @__PURE__ */ list(MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD, ConsolidationRequest), // [New in Electra:EIP7251]
});
// Electra carries execution requests beside the payload; future Gloas keeps that separation in ExecutionPayloadEnvelope.
const ProgressiveExecutionPayload = /* @__PURE__ */ progressiveFields({
    parent_hash: Hash32,
    fee_recipient: ExecutionAddress,
    state_root: Bytes32,
    receipts_root: Bytes32,
    logs_bloom: /* @__PURE__ */ bytevector(BYTES_PER_LOGS_BLOOM),
    prev_randao: Bytes32,
    block_number: uint64,
    gas_limit: uint64,
    gas_used: uint64,
    timestamp: uint64,
    extra_data: /* @__PURE__ */ bytelist(MAX_EXTRA_DATA_BYTES),
    base_fee_per_gas: uint256,
    block_hash: Hash32,
    transactions: /* @__PURE__ */ list(MAX_TRANSACTIONS_PER_PAYLOAD, Transaction),
    withdrawals: /* @__PURE__ */ list(MAX_WITHDRAWALS_PER_PAYLOAD, Withdrawal), // [New in Capella]
    blob_gas_used: uint64,
    excess_blob_gas: uint64,
});
const ProgressiveBeaconBlockBody = /* @__PURE__ */ progressiveFields({
    randao_reveal: BLSSignature,
    // EIP-8015 later removes eth1_data/deposits after EIP-6110 finalization; Electra keeps them.
    eth1_data: Eth1Data,
    graffiti: Bytes32,
    proposer_slashings: /* @__PURE__ */ list(MAX_PROPOSER_SLASHINGS, ProposerSlashing),
    attester_slashings: /* @__PURE__ */ list(MAX_ATTESTER_SLASHINGS_ELECTRA, ProgressiveAttesterSlashing), // [Modified in Electra:EIP7549]
    attestations: /* @__PURE__ */ list(MAX_ATTESTATIONS_ELECTRA, ProgressiveAttestation), // [Modified in Electra:EIP7549]
    deposits: /* @__PURE__ */ list(MAX_DEPOSITS, Deposit),
    voluntary_exits: /* @__PURE__ */ list(MAX_VOLUNTARY_EXITS, SignedVoluntaryExit),
    sync_aggregate: SyncAggregate,
    // This will change in Gloas: execution_payload/blob_kzg_commitments/execution_requests move out of BeaconBlockBody.
    execution_payload: ProgressiveExecutionPayload,
    bls_to_execution_changes: /* @__PURE__ */ list(MAX_BLS_TO_EXECUTION_CHANGES, SignedBLSToExecutionChange),
    blob_kzg_commitments: /* @__PURE__ */ list(MAX_BLOB_COMMITMENTS_PER_BLOCK, KZGCommitment),
    execution_requests: ProgressiveExecutionRequests,
});
/**
 * Progressive SSZ consensus coders.
 *
 * These are raw progressive-container building blocks for tests/experiments.
 * They may change with the progressive-SSZ spec; fork-aware callers should use
 * `ETH2_PROFILES.<fork>`.
 */
export const ETH2_CONSENSUS = /* @__PURE__ */ freezeRegistry({
    ProgressiveAttestation,
    ProgressiveIndexedAttestation,
    ProgressiveAttesterSlashing,
    ProgressiveExecutionPayload,
    ProgressiveExecutionRequests,
    ProgressiveExecutionPayloadHeader,
    ProgressiveBeaconBlockBody,
    ProgressiveBeaconState,
});
// Tests (electra profiles): https://github.com/ethereum/consensus-specs/pull/3844#issuecomment-2239285376
// NOTE: these are different from EIP-7688 by some reasons, but since nothing is merged/completed in eth side, we just trying
// to pass these tests for now.
const IndexedAttestationElectra = /* @__PURE__ */ profile(ProgressiveIndexedAttestation, [], ['attesting_indices', 'data', 'signature']);
const AttesterSlashingElectra = /* @__PURE__ */ container({
    attestation_1: IndexedAttestationElectra,
    attestation_2: IndexedAttestationElectra,
});
const ExecutionRequests = /* @__PURE__ */ profile(ProgressiveExecutionRequests, [], ['deposits', 'withdrawals', 'consolidations']);
const AttestationElectra = /* @__PURE__ */ profile(ProgressiveAttestation, [], ['aggregation_bits', 'data', 'signature', 'committee_bits']);
const AggregateAndProofElectra = /* @__PURE__ */ container({
    aggregator_index: ValidatorIndex,
    aggregate: AttestationElectra,
    selection_proof: BLSSignature,
});
const SignedAggregateAndProofElectra = /* @__PURE__ */ container({
    message: AggregateAndProofElectra,
    signature: BLSSignature,
});
const ExecutionPayloadElectra = /* @__PURE__ */ profile(ProgressiveExecutionPayload, [], [
    'parent_hash',
    'fee_recipient',
    'state_root',
    'receipts_root',
    'logs_bloom',
    'prev_randao',
    'block_number',
    'gas_limit',
    'gas_used',
    'timestamp',
    'extra_data',
    'base_fee_per_gas',
    'block_hash',
    'transactions',
    'withdrawals',
    'blob_gas_used',
    'excess_blob_gas',
]);
const BeaconBlockBodyElectra = /* @__PURE__ */ profile(ProgressiveBeaconBlockBody, [], [
    'randao_reveal',
    'eth1_data',
    'graffiti',
    'proposer_slashings',
    'attester_slashings',
    'attestations',
    'deposits',
    'voluntary_exits',
    'sync_aggregate',
    'execution_payload',
    'bls_to_execution_changes',
    'blob_kzg_commitments',
    'execution_requests',
], {
    attester_slashings: /* @__PURE__ */ list(MAX_ATTESTER_SLASHINGS_ELECTRA, AttesterSlashingElectra),
    attestations: /* @__PURE__ */ list(MAX_ATTESTATIONS_ELECTRA, AttestationElectra),
    execution_payload: ExecutionPayloadElectra,
    execution_requests: ExecutionRequests,
});
const BeaconBlockElectra = /* @__PURE__ */ container({
    slot: Slot,
    proposer_index: ValidatorIndex,
    parent_root: Root,
    state_root: Root,
    body: BeaconBlockBodyElectra,
});
const SignedBeaconBlockElectra = /* @__PURE__ */ container({
    message: BeaconBlockElectra,
    signature: BLSSignature,
});
const LightClientHeaderElectra = /* @__PURE__ */ container({
    beacon: BeaconBlockHeader,
    execution: ExecutionPayloadHeaderElectra,
    execution_branch: /* @__PURE__ */ vector(BLOCK_BODY_EXECUTION_PAYLOAD_DEPTH, Bytes32),
});
const LightClientBootstrapElectra = /* @__PURE__ */ container({
    header: LightClientHeaderElectra,
    current_sync_committee: SyncCommittee,
    current_sync_committee_branch: /* @__PURE__ */ vector(ELECTRA_SYNC_COMMITTEE_DEPTH, Bytes32),
});
const LightClientUpdateElectra = /* @__PURE__ */ container({
    attested_header: LightClientHeaderElectra,
    next_sync_committee: SyncCommittee,
    next_sync_committee_branch: /* @__PURE__ */ vector(ELECTRA_SYNC_COMMITTEE_DEPTH, Bytes32),
    finalized_header: LightClientHeaderElectra,
    finality_branch: /* @__PURE__ */ vector(ELECTRA_FINALIZED_ROOT_DEPTH, Bytes32),
    sync_aggregate: SyncAggregate,
    signature_slot: Slot,
});
const LightClientFinalityUpdateElectra = /* @__PURE__ */ container({
    attested_header: LightClientHeaderElectra,
    finalized_header: LightClientHeaderElectra,
    finality_branch: /* @__PURE__ */ vector(ELECTRA_FINALIZED_ROOT_DEPTH, Bytes32),
    sync_aggregate: SyncAggregate,
    signature_slot: Slot,
});
const LightClientOptimisticUpdateElectra = /* @__PURE__ */ container({
    attested_header: LightClientHeaderElectra,
    sync_aggregate: SyncAggregate,
    signature_slot: Slot,
});
const LightClientElectra = {
    LightClientHeader: LightClientHeaderElectra,
    LightClientBootstrap: LightClientBootstrapElectra,
    LightClientUpdate: LightClientUpdateElectra,
    LightClientFinalityUpdate: LightClientFinalityUpdateElectra,
    LightClientOptimisticUpdate: LightClientOptimisticUpdateElectra,
};
/** Capella Types */
// Capella block bodies embed the full payload; only BeaconState.latest_execution_payload_header stores the header form.
const CapellaExecutionPayload = 
/* @__PURE__ */ (() => container({
    parent_hash: ETH2_BASE.Hash32,
    fee_recipient: ETH2_BASE.ExecutionAddress,
    state_root: ETH2_BASE.Bytes32,
    receipts_root: ETH2_BASE.Bytes32,
    logs_bloom: /* @__PURE__ */ bytevector(BYTES_PER_LOGS_BLOOM),
    prev_randao: ETH2_BASE.Bytes32,
    block_number: uint64,
    gas_limit: uint64,
    gas_used: uint64,
    timestamp: uint64,
    extra_data: /* @__PURE__ */ bytelist(MAX_EXTRA_DATA_BYTES),
    base_fee_per_gas: uint256,
    block_hash: ETH2_BASE.Hash32,
    transactions: /* @__PURE__ */ list(MAX_TRANSACTIONS_PER_PAYLOAD, ETH2_BASE.Transaction),
    withdrawals: /* @__PURE__ */ list(MAX_WITHDRAWALS_PER_PAYLOAD, ETH2_BASE.Withdrawal),
}))();
const _CapellaExecutionPayloadHeader = () => container({
    parent_hash: ETH2_BASE.Hash32,
    fee_recipient: ETH2_BASE.ExecutionAddress,
    state_root: ETH2_BASE.Bytes32,
    receipts_root: ETH2_BASE.Bytes32,
    logs_bloom: /* @__PURE__ */ bytevector(BYTES_PER_LOGS_BLOOM),
    prev_randao: ETH2_BASE.Bytes32,
    block_number: uint64,
    gas_limit: uint64,
    gas_used: uint64,
    timestamp: uint64,
    extra_data: /* @__PURE__ */ bytelist(MAX_EXTRA_DATA_BYTES),
    base_fee_per_gas: uint256,
    block_hash: ETH2_BASE.Hash32,
    transactions_root: ETH2_BASE.Root,
    withdrawals_root: ETH2_BASE.Root,
});
/**
 * SSZ coder for the Capella execution payload header.
 * @returns Capella execution payload header coder.
 * @example
 * Access the default Capella execution payload header.
 * ```ts
 * import { CapellaExecutionPayloadHeader } from 'micro-eth-signer/advanced/ssz.js';
 * const header = CapellaExecutionPayloadHeader.default;
 * ```
 */
export const CapellaExecutionPayloadHeader = 
/* @__PURE__ */ _CapellaExecutionPayloadHeader();
// Capella light-client headers add execution header proof fields.
const LightClientHeaderCapella = /* @__PURE__ */ container({
    beacon: BeaconBlockHeader,
    execution: CapellaExecutionPayloadHeader,
    execution_branch: /* @__PURE__ */ vector(BLOCK_BODY_EXECUTION_PAYLOAD_DEPTH, Bytes32),
});
const LightClientCapella = 
/* @__PURE__ */ lightClient(LightClientHeaderCapella, NEXT_SYNC_COMMITTEE_DEPTH, FINALIZED_ROOT_DEPTH);
const CapellaBeaconBlockBody = /* @__PURE__ */ (() => container({
    randao_reveal: ETH2_BASE.BLSSignature,
    eth1_data: ETH2_BASE.Eth1Data,
    graffiti: ETH2_BASE.Bytes32,
    proposer_slashings: /* @__PURE__ */ list(MAX_PROPOSER_SLASHINGS, ETH2_BASE.ProposerSlashing),
    attester_slashings: /* @__PURE__ */ list(MAX_ATTESTER_SLASHINGS, ETH2_BASE.AttesterSlashing),
    attestations: /* @__PURE__ */ list(MAX_ATTESTATIONS, ETH2_BASE.Attestation),
    deposits: /* @__PURE__ */ list(MAX_DEPOSITS, ETH2_BASE.Deposit),
    voluntary_exits: /* @__PURE__ */ list(MAX_VOLUNTARY_EXITS, ETH2_BASE.SignedVoluntaryExit),
    sync_aggregate: ETH2_BASE.SyncAggregate,
    execution_payload: CapellaExecutionPayload,
    bls_to_execution_changes: /* @__PURE__ */ list(MAX_BLS_TO_EXECUTION_CHANGES, ETH2_BASE.SignedBLSToExecutionChange),
}))();
const _CapellaBeaconBlock = () => container({
    slot: ETH2_BASE.Slot,
    proposer_index: ETH2_BASE.ValidatorIndex,
    parent_root: ETH2_BASE.Root,
    state_root: ETH2_BASE.Root,
    body: CapellaBeaconBlockBody,
});
/** SSZ coder for a Capella beacon block. */
export const CapellaBeaconBlock = /* @__PURE__ */ _CapellaBeaconBlock();
const _CapellaSignedBeaconBlock = () => container({
    message: CapellaBeaconBlock,
    signature: ETH2_BASE.BLSSignature,
});
/** SSZ coder for a signed Capella beacon block. */
export const CapellaSignedBeaconBlock = 
/* @__PURE__ */ _CapellaSignedBeaconBlock();
const _CapellaBeaconState = () => container({
    genesis_time: uint64,
    genesis_validators_root: ETH2_BASE.Root,
    slot: ETH2_BASE.Slot,
    fork: ETH2_BASE.Fork,
    latest_block_header: ETH2_BASE.BeaconBlockHeader,
    block_roots: /* @__PURE__ */ vector(SLOTS_PER_HISTORICAL_ROOT, ETH2_BASE.Root),
    state_roots: /* @__PURE__ */ vector(SLOTS_PER_HISTORICAL_ROOT, ETH2_BASE.Root),
    historical_roots: /* @__PURE__ */ list(HISTORICAL_ROOTS_LIMIT, ETH2_BASE.Root),
    eth1_data: ETH2_BASE.Eth1Data,
    eth1_data_votes: /* @__PURE__ */ list(
    /* @__PURE__ */ (() => EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH)(), ETH2_BASE.Eth1Data),
    eth1_deposit_index: uint64,
    validators: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ETH2_BASE.Validator),
    balances: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ETH2_BASE.Gwei),
    randao_mixes: /* @__PURE__ */ vector(EPOCHS_PER_HISTORICAL_VECTOR, ETH2_BASE.Bytes32),
    slashings: /* @__PURE__ */ vector(EPOCHS_PER_SLASHINGS_VECTOR, ETH2_BASE.Gwei),
    previous_epoch_participation: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ETH2_BASE.ParticipationFlags),
    current_epoch_participation: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ETH2_BASE.ParticipationFlags),
    justification_bits: /* @__PURE__ */ bitvector(JUSTIFICATION_BITS_LENGTH),
    previous_justified_checkpoint: ETH2_BASE.Checkpoint,
    current_justified_checkpoint: ETH2_BASE.Checkpoint,
    finalized_checkpoint: ETH2_BASE.Checkpoint,
    inactivity_scores: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, uint64),
    current_sync_committee: ETH2_BASE.SyncCommittee,
    next_sync_committee: ETH2_BASE.SyncCommittee,
    latest_execution_payload_header: CapellaExecutionPayloadHeader,
    next_withdrawal_index: uint64,
    next_withdrawal_validator_index: uint64,
    historical_summaries: /* @__PURE__ */ list(HISTORICAL_ROOTS_LIMIT, ETH2_BASE.HistoricalSummary),
});
/** SSZ coder for a Capella beacon state. */
export const CapellaBeaconState = /* @__PURE__ */ _CapellaBeaconState();
const _ElectraBeaconBlock = () => container({
    slot: ETH2_BASE.Slot,
    proposer_index: ETH2_BASE.ValidatorIndex,
    parent_root: ETH2_BASE.Root,
    state_root: ETH2_BASE.Root,
    body: ProgressiveBeaconBlockBody,
});
/** SSZ coder for a Electra beacon block. */
export const ElectraBeaconBlock = /* @__PURE__ */ _ElectraBeaconBlock();
const _ElectraSignedBeaconBlock = () => container({
    message: ElectraBeaconBlock,
    signature: ETH2_BASE.BLSSignature,
});
/** SSZ coder for a signed Electra beacon block. */
export const ElectraSignedBeaconBlock = 
/* @__PURE__ */ _ElectraSignedBeaconBlock();
/** Bellatrix Types */
// Bellatrix block bodies embed the full payload; only BeaconState.latest_execution_payload_header stores the header form.
const BellatrixExecutionPayload = 
/* @__PURE__ */ (() => container({
    parent_hash: ETH2_BASE.Hash32,
    fee_recipient: ETH2_BASE.ExecutionAddress,
    state_root: ETH2_BASE.Bytes32,
    receipts_root: ETH2_BASE.Bytes32,
    logs_bloom: /* @__PURE__ */ bytevector(BYTES_PER_LOGS_BLOOM),
    prev_randao: ETH2_BASE.Bytes32,
    block_number: uint64,
    gas_limit: uint64,
    gas_used: uint64,
    timestamp: uint64,
    extra_data: /* @__PURE__ */ bytelist(MAX_EXTRA_DATA_BYTES),
    base_fee_per_gas: uint256,
    block_hash: ETH2_BASE.Hash32,
    transactions: /* @__PURE__ */ list(MAX_TRANSACTIONS_PER_PAYLOAD, ETH2_BASE.Transaction),
}))();
const _BellatrixExecutionPayloadHeader = () => container({
    parent_hash: ETH2_BASE.Hash32,
    fee_recipient: ETH2_BASE.ExecutionAddress,
    state_root: ETH2_BASE.Bytes32,
    receipts_root: ETH2_BASE.Bytes32,
    logs_bloom: /* @__PURE__ */ bytevector(BYTES_PER_LOGS_BLOOM),
    prev_randao: ETH2_BASE.Bytes32,
    block_number: uint64,
    gas_limit: uint64,
    gas_used: uint64,
    timestamp: uint64,
    extra_data: /* @__PURE__ */ bytelist(MAX_EXTRA_DATA_BYTES),
    base_fee_per_gas: uint256,
    block_hash: ETH2_BASE.Hash32,
    transactions_root: ETH2_BASE.Root,
});
/**
 * SSZ coder for the Bellatrix execution payload header.
 * @returns Bellatrix execution payload header coder.
 * @example
 * Access the default Bellatrix execution payload header.
 * ```ts
 * import { BellatrixExecutionPayloadHeader } from 'micro-eth-signer/advanced/ssz.js';
 * const header = BellatrixExecutionPayloadHeader.default;
 * ```
 */
export const BellatrixExecutionPayloadHeader = 
/* @__PURE__ */ _BellatrixExecutionPayloadHeader();
const BellatrixBeaconBlockBody = /* @__PURE__ */ (() => container({
    randao_reveal: ETH2_BASE.BLSSignature,
    eth1_data: ETH2_BASE.Eth1Data,
    graffiti: ETH2_BASE.Bytes32,
    proposer_slashings: /* @__PURE__ */ list(MAX_PROPOSER_SLASHINGS, ETH2_BASE.ProposerSlashing),
    attester_slashings: /* @__PURE__ */ list(MAX_ATTESTER_SLASHINGS, ETH2_BASE.AttesterSlashing),
    attestations: /* @__PURE__ */ list(MAX_ATTESTATIONS, ETH2_BASE.Attestation),
    deposits: /* @__PURE__ */ list(MAX_DEPOSITS, ETH2_BASE.Deposit),
    voluntary_exits: /* @__PURE__ */ list(MAX_VOLUNTARY_EXITS, ETH2_BASE.SignedVoluntaryExit),
    sync_aggregate: ETH2_BASE.SyncAggregate,
    execution_payload: BellatrixExecutionPayload,
}))();
const _BellatrixBeaconBlock = () => container({
    slot: ETH2_BASE.Slot,
    proposer_index: ETH2_BASE.ValidatorIndex,
    parent_root: ETH2_BASE.Root,
    state_root: ETH2_BASE.Root,
    body: BellatrixBeaconBlockBody,
});
/** SSZ coder for a Bellatrix beacon block. */
export const BellatrixBeaconBlock = 
/* @__PURE__ */ _BellatrixBeaconBlock();
const _BellatrixSignedBeaconBlock = () => container({
    message: BellatrixBeaconBlock,
    signature: ETH2_BASE.BLSSignature,
});
/** SSZ coder for a signed Bellatrix beacon block. */
export const BellatrixSignedBeaconBlock = 
/* @__PURE__ */ _BellatrixSignedBeaconBlock();
const _BellatrixBeaconState = () => container({
    genesis_time: uint64,
    genesis_validators_root: ETH2_BASE.Root,
    slot: ETH2_BASE.Slot,
    fork: ETH2_BASE.Fork,
    latest_block_header: ETH2_BASE.BeaconBlockHeader,
    block_roots: /* @__PURE__ */ vector(SLOTS_PER_HISTORICAL_ROOT, ETH2_BASE.Root),
    state_roots: /* @__PURE__ */ vector(SLOTS_PER_HISTORICAL_ROOT, ETH2_BASE.Root),
    historical_roots: /* @__PURE__ */ list(HISTORICAL_ROOTS_LIMIT, ETH2_BASE.Root),
    eth1_data: ETH2_BASE.Eth1Data,
    eth1_data_votes: /* @__PURE__ */ list(
    /* @__PURE__ */ (() => EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH)(), ETH2_BASE.Eth1Data),
    eth1_deposit_index: uint64,
    validators: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ETH2_BASE.Validator),
    balances: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ETH2_BASE.Gwei),
    randao_mixes: /* @__PURE__ */ vector(EPOCHS_PER_HISTORICAL_VECTOR, ETH2_BASE.Bytes32),
    slashings: /* @__PURE__ */ vector(EPOCHS_PER_SLASHINGS_VECTOR, ETH2_BASE.Gwei),
    previous_epoch_participation: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ETH2_BASE.ParticipationFlags),
    current_epoch_participation: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ETH2_BASE.ParticipationFlags),
    justification_bits: /* @__PURE__ */ bitvector(JUSTIFICATION_BITS_LENGTH),
    previous_justified_checkpoint: ETH2_BASE.Checkpoint,
    current_justified_checkpoint: ETH2_BASE.Checkpoint,
    finalized_checkpoint: ETH2_BASE.Checkpoint,
    inactivity_scores: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, uint64),
    current_sync_committee: ETH2_BASE.SyncCommittee,
    next_sync_committee: ETH2_BASE.SyncCommittee,
    latest_execution_payload_header: BellatrixExecutionPayloadHeader,
});
/** SSZ coder for a Bellatrix beacon state. */
export const BellatrixBeaconState = 
/* @__PURE__ */ _BellatrixBeaconState();
const AltairBeaconBlockBody = /* @__PURE__ */ (() => container({
    randao_reveal: ETH2_BASE.BLSSignature,
    eth1_data: ETH2_BASE.Eth1Data,
    graffiti: ETH2_BASE.Bytes32,
    proposer_slashings: /* @__PURE__ */ list(MAX_PROPOSER_SLASHINGS, ETH2_BASE.ProposerSlashing),
    attester_slashings: /* @__PURE__ */ list(MAX_ATTESTER_SLASHINGS, ETH2_BASE.AttesterSlashing),
    attestations: /* @__PURE__ */ list(MAX_ATTESTATIONS, ETH2_BASE.Attestation),
    deposits: /* @__PURE__ */ list(MAX_DEPOSITS, ETH2_BASE.Deposit),
    voluntary_exits: /* @__PURE__ */ list(MAX_VOLUNTARY_EXITS, ETH2_BASE.SignedVoluntaryExit),
    sync_aggregate: ETH2_BASE.SyncAggregate,
}))();
const _AltairBeaconBlock = () => container({
    slot: ETH2_BASE.Slot,
    proposer_index: ETH2_BASE.ValidatorIndex,
    parent_root: ETH2_BASE.Root,
    state_root: ETH2_BASE.Root,
    body: AltairBeaconBlockBody,
});
/** SSZ coder for an Altair beacon block. */
export const AltairBeaconBlock = /* @__PURE__ */ _AltairBeaconBlock();
const _AltairSignedBeaconBlock = () => container({
    message: AltairBeaconBlock,
    signature: ETH2_BASE.BLSSignature,
});
/** SSZ coder for a signed Altair beacon block. */
export const AltairSignedBeaconBlock = 
/* @__PURE__ */ _AltairSignedBeaconBlock();
const _AltairBeaconState = () => container({
    genesis_time: uint64,
    genesis_validators_root: ETH2_BASE.Root,
    slot: ETH2_BASE.Slot,
    fork: ETH2_BASE.Fork,
    latest_block_header: ETH2_BASE.BeaconBlockHeader,
    block_roots: /* @__PURE__ */ vector(SLOTS_PER_HISTORICAL_ROOT, ETH2_BASE.Root),
    state_roots: /* @__PURE__ */ vector(SLOTS_PER_HISTORICAL_ROOT, ETH2_BASE.Root),
    historical_roots: /* @__PURE__ */ list(HISTORICAL_ROOTS_LIMIT, ETH2_BASE.Root),
    eth1_data: ETH2_BASE.Eth1Data,
    eth1_data_votes: /* @__PURE__ */ list(
    /* @__PURE__ */ (() => EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH)(), ETH2_BASE.Eth1Data),
    eth1_deposit_index: uint64,
    validators: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ETH2_BASE.Validator),
    balances: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ETH2_BASE.Gwei),
    randao_mixes: /* @__PURE__ */ vector(EPOCHS_PER_HISTORICAL_VECTOR, ETH2_BASE.Bytes32),
    slashings: /* @__PURE__ */ vector(EPOCHS_PER_SLASHINGS_VECTOR, ETH2_BASE.Gwei),
    previous_epoch_participation: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ETH2_BASE.ParticipationFlags),
    current_epoch_participation: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ETH2_BASE.ParticipationFlags),
    justification_bits: /* @__PURE__ */ bitvector(JUSTIFICATION_BITS_LENGTH),
    previous_justified_checkpoint: ETH2_BASE.Checkpoint,
    current_justified_checkpoint: ETH2_BASE.Checkpoint,
    finalized_checkpoint: ETH2_BASE.Checkpoint,
    inactivity_scores: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, uint64),
    current_sync_committee: ETH2_BASE.SyncCommittee,
    next_sync_committee: ETH2_BASE.SyncCommittee,
});
/** SSZ coder for an Altair beacon state. */
export const AltairBeaconState = /* @__PURE__ */ _AltairBeaconState();
const Phase0BeaconBlockBody = /* @__PURE__ */ (() => container({
    randao_reveal: ETH2_BASE.BLSSignature,
    eth1_data: ETH2_BASE.Eth1Data,
    graffiti: ETH2_BASE.Bytes32,
    proposer_slashings: /* @__PURE__ */ list(MAX_PROPOSER_SLASHINGS, ETH2_BASE.ProposerSlashing),
    attester_slashings: /* @__PURE__ */ list(MAX_ATTESTER_SLASHINGS, ETH2_BASE.AttesterSlashing),
    attestations: /* @__PURE__ */ list(MAX_ATTESTATIONS, ETH2_BASE.Attestation),
    deposits: /* @__PURE__ */ list(MAX_DEPOSITS, ETH2_BASE.Deposit),
    voluntary_exits: /* @__PURE__ */ list(MAX_VOLUNTARY_EXITS, ETH2_BASE.SignedVoluntaryExit),
}))();
const _Phase0BeaconBlock = () => container({
    slot: ETH2_BASE.Slot,
    proposer_index: ETH2_BASE.ValidatorIndex,
    parent_root: ETH2_BASE.Root,
    state_root: ETH2_BASE.Root,
    body: Phase0BeaconBlockBody,
});
/** SSZ coder for a Phase0 beacon block. */
export const Phase0BeaconBlock = /* @__PURE__ */ _Phase0BeaconBlock();
const _Phase0SignedBeaconBlock = () => container({
    message: Phase0BeaconBlock,
    signature: ETH2_BASE.BLSSignature,
});
/** SSZ coder for a signed Phase0 beacon block. */
export const Phase0SignedBeaconBlock = 
/* @__PURE__ */ _Phase0SignedBeaconBlock();
const _Phase0BeaconState = () => container({
    genesis_time: uint64,
    genesis_validators_root: ETH2_BASE.Root,
    slot: ETH2_BASE.Slot,
    fork: ETH2_BASE.Fork,
    latest_block_header: ETH2_BASE.BeaconBlockHeader,
    block_roots: /* @__PURE__ */ vector(SLOTS_PER_HISTORICAL_ROOT, ETH2_BASE.Root),
    state_roots: /* @__PURE__ */ vector(SLOTS_PER_HISTORICAL_ROOT, ETH2_BASE.Root),
    historical_roots: /* @__PURE__ */ list(HISTORICAL_ROOTS_LIMIT, ETH2_BASE.Root),
    eth1_data: ETH2_BASE.Eth1Data,
    eth1_data_votes: /* @__PURE__ */ list(
    /* @__PURE__ */ (() => EPOCHS_PER_ETH1_VOTING_PERIOD * SLOTS_PER_EPOCH)(), ETH2_BASE.Eth1Data),
    eth1_deposit_index: uint64,
    validators: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ETH2_BASE.Validator),
    balances: /* @__PURE__ */ list(VALIDATOR_REGISTRY_LIMIT, ETH2_BASE.Gwei),
    randao_mixes: /* @__PURE__ */ vector(EPOCHS_PER_HISTORICAL_VECTOR, ETH2_BASE.Bytes32),
    slashings: /* @__PURE__ */ vector(EPOCHS_PER_SLASHINGS_VECTOR, ETH2_BASE.Gwei),
    // Phase0 predates Altair participation flags and keeps pending attestation queues in state.
    previous_epoch_attestations: /* @__PURE__ */ list(
    /* @__PURE__ */ (() => MAX_ATTESTATIONS * SLOTS_PER_EPOCH)(), ETH2_BASE.PendingAttestation),
    current_epoch_attestations: /* @__PURE__ */ list(
    /* @__PURE__ */ (() => MAX_ATTESTATIONS * SLOTS_PER_EPOCH)(), ETH2_BASE.PendingAttestation),
    justification_bits: /* @__PURE__ */ bitvector(JUSTIFICATION_BITS_LENGTH),
    previous_justified_checkpoint: ETH2_BASE.Checkpoint,
    current_justified_checkpoint: ETH2_BASE.Checkpoint,
    finalized_checkpoint: ETH2_BASE.Checkpoint,
});
/** SSZ coder for a Phase0 beacon state. */
export const Phase0BeaconState = /* @__PURE__ */ _Phase0BeaconState();
const ETH2_LEGACY_PROFILE = {
    Attestation,
    AggregateAndProof,
    SignedAggregateAndProof,
    AttesterSlashing,
    IndexedAttestation,
};
/** Ethereum consensus fork profile coders. */
export const ETH2_PROFILES = /* @__PURE__ */ (() => freezeRegistry({
    phase0: {
        ...ETH2_LEGACY_PROFILE,
        BeaconBlockBody: Phase0BeaconBlockBody,
        BeaconBlock: Phase0BeaconBlock,
        SignedBeaconBlock: Phase0SignedBeaconBlock,
        BeaconState: Phase0BeaconState,
    },
    altair: {
        ...ETH2_LEGACY_PROFILE,
        ...LightClientAltair,
        BeaconBlockBody: AltairBeaconBlockBody,
        BeaconBlock: AltairBeaconBlock,
        SignedBeaconBlock: AltairSignedBeaconBlock,
        BeaconState: AltairBeaconState,
    },
    bellatrix: {
        ...ETH2_LEGACY_PROFILE,
        ...LightClientAltair,
        ExecutionPayloadHeader: BellatrixExecutionPayloadHeader,
        ExecutionPayload: BellatrixExecutionPayload,
        BeaconBlockBody: BellatrixBeaconBlockBody,
        BeaconBlock: BellatrixBeaconBlock,
        SignedBeaconBlock: BellatrixSignedBeaconBlock,
        BeaconState: BellatrixBeaconState,
    },
    capella: {
        ...ETH2_LEGACY_PROFILE,
        ...LightClientCapella,
        ExecutionPayloadHeader: CapellaExecutionPayloadHeader,
        ExecutionPayload: CapellaExecutionPayload,
        BeaconBlockBody: CapellaBeaconBlockBody,
        BeaconBlock: CapellaBeaconBlock,
        SignedBeaconBlock: CapellaSignedBeaconBlock,
        BeaconState: CapellaBeaconState,
    },
    deneb: {
        ...ETH2_LEGACY_PROFILE,
        ...LightClientDeneb,
        ExecutionPayloadHeader,
        ExecutionPayload,
        BeaconBlockBody,
        BeaconBlock,
        SignedBeaconBlock,
        BeaconState: DenebBeaconState,
        BlobIdentifier,
        BlobSidecar,
    },
    electra: {
        ...LightClientElectra,
        SingleAttestation,
        Attestation: AttestationElectra,
        AggregateAndProof: AggregateAndProofElectra,
        SignedAggregateAndProof: SignedAggregateAndProofElectra,
        AttesterSlashing: AttesterSlashingElectra,
        IndexedAttestation: IndexedAttestationElectra,
        ExecutionRequests,
        ExecutionPayloadHeader: ExecutionPayloadHeaderElectra,
        ExecutionPayload: ExecutionPayloadElectra,
        BeaconBlockBody: BeaconBlockBodyElectra,
        BeaconBlock: BeaconBlockElectra,
        SignedBeaconBlock: SignedBeaconBlockElectra,
        BeaconState: BeaconStateElectra,
    },
    fulu: {
        ...LightClientElectra,
        SingleAttestation,
        Attestation: AttestationElectra,
        AggregateAndProof: AggregateAndProofElectra,
        SignedAggregateAndProof: SignedAggregateAndProofElectra,
        AttesterSlashing: AttesterSlashingElectra,
        IndexedAttestation: IndexedAttestationElectra,
        ExecutionRequests,
        ExecutionPayloadHeader: ExecutionPayloadHeaderElectra,
        ExecutionPayload: ExecutionPayloadElectra,
        BeaconBlockBody: BeaconBlockBodyElectra,
        BeaconBlock: BeaconBlockElectra,
        SignedBeaconBlock: SignedBeaconBlockElectra,
        BeaconState: BeaconStateFulu,
        DataColumnSidecar,
        DataColumnsByRootIdentifier,
        MatrixEntry,
    },
}))();
/**
 * Latest default-mainnet Ethereum consensus SSZ coders plus shared helpers.
 *
 * Fork-sensitive names such as `BeaconState`, `BeaconBlock`, `Attestation`,
 * and `LightClientHeader` point at the latest bundled fork, currently Fulu.
 * This binding will change when a newer default-mainnet fork is bundled.
 * Prefer `ETH2_PROFILES.<fork>` for stable fork selection.
 * @example
 * Encode a checkpoint via the grouped ETH2 field registry.
 * ```ts
 * import { sha256 } from '@noble/hashes/sha2.js';
 * import { ETH2_TYPES } from 'micro-eth-signer/advanced/ssz.js';
 * const root = sha256(new TextEncoder().encode('checkpoint-root'));
 * ETH2_TYPES.Checkpoint.encode({ epoch: 0n, root });
 * ```
 */
export const ETH2_TYPES = /* @__PURE__ */ freezeRegistry(
/* @__PURE__ */ (() => ({ ...ETH2_BASE, ...ETH2_PROFILES.fulu }))());
//# sourceMappingURL=ssz.js.map