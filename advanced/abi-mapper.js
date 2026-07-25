import * as P from 'micro-packed';
import {} from "../utils.js";
// Peel one trailing ABI array suffix at a time so nested types recurse from the right:
// address[][2] -> address[] + [2], then address + [].
export const ARRAY_RE = /(.+)(\[(\d+)?\])$/;
// ABI words are 32 bytes, so shorter fixed-width scalars and pointers get zero-left-padded into one slot.
function EPad(p) {
    return P.padLeft(32, p, P.ZeroPad);
}
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const U256BE_SAFE = P.wrap({
    size: 32,
    encodeStream: (w, value) => {
        if (!Number.isSafeInteger(value) || value < 0)
            throw new Error(`ABI word: expected safe uint, got ${value}`);
        P.U256BE.encodeStream(w, BigInt(value));
    },
    decodeStream: (r) => {
        const value = P.U256BE.decodeStream(r);
        // Offsets and lengths are uint256 ABI words, but JS readers need bounded numbers.
        if (value > MAX_SAFE)
            throw new Error(`ABI word: expected safe uint, got ${value}`);
        return Number(value);
    },
});
const PTR = U256BE_SAFE;
const U256BE_LEN = U256BE_SAFE;
// ABI dynamic arrays encode as len || tuple(elements), so nested element offsets are based from
// the post-length tuple head instead of the length word itself.
function ethArray(inner) {
    return P.wrap({
        size: undefined,
        encodeStream: (w, value) => {
            U256BE_LEN.encodeStream(w, value.length);
            w.bytes(P.array(value.length, inner).encode(value));
        },
        decodeStream: (r) => P.array(U256BE_LEN.decodeStream(r), inner).decodeStream(r.offsetReader(r.pos)),
    });
}
// Because u32 in eth is not real u32, just U256BE with limits...
const ethInt = (bits, signed = false) => {
    if (!Number.isSafeInteger(bits) || bits <= 0 || bits % 8 !== 0 || bits > 256)
        throw new Error('ethInt: invalid numeric type');
    const _bits = BigInt(bits);
    // ABI ints always occupy one 32-byte word on the wire; the declared bit width only constrains
    // the accepted numeric range inside that slot.
    const inner = P.bigint(32, false, signed);
    return P.validate(P.wrap({
        size: inner.size,
        encodeStream: (w, value) => inner.encodeStream(w, value),
        decodeStream: (r) => inner.decodeStream(r),
    }), (value) => {
        // TODO: validate useful for narrowing types, need to add support in types?
        // Numeric ABI values are typed as bigint; accept only unambiguous JS numbers at runtime.
        if (typeof value === 'number') {
            if (!Number.isSafeInteger(value))
                throw new Error(`ethInt: expected safe integer, got ${value}`);
            value = BigInt(value);
        }
        P.utils.checkBounds(value, _bits, !!signed);
        return value;
    });
};
// Ugly hack, because tuple of pointers considered "dynamic" without any reason.
function isDyn(args) {
    // In this mapper, ABI-dynamic children keep `size === undefined` even when their head slot is a
    // 32-byte pointer, so tuples with any such child must be wrapped in an outer pointer too.
    let res = false;
    if (Array.isArray(args)) {
        for (let arg of args)
            if (arg.size === undefined)
                res = true;
    }
    else {
        for (let arg in args)
            if (args[arg].size === undefined)
                res = true;
    }
    return res;
}
// NOTE: we need as const if we want to access string as values inside types :(
export function mapComponent(c) {
    // Arrays (should be first one, since recursive)
    let m;
    if ((m = ARRAY_RE.exec(c.type))) {
        const inner = mapComponent({ ...c, type: m[1] });
        if (inner.size === 0)
            throw new Error('mapComponent: arrays of zero-size elements disabled (possible DoS attack)');
        // Static array
        if (m[3] !== undefined) {
            const m3 = Number.parseInt(m[3]);
            if (!Number.isSafeInteger(m3))
                throw new Error(`mapComponent: wrong array size=${m[3]}`);
            let out = P.array(m3, inner);
            // Static array of dynamic values should be behind pointer too, again without reason.
            if (inner.size === undefined)
                out = P.pointer(PTR, out);
            return out;
        }
        else {
            // Dynamic array
            return P.pointer(PTR, ethArray(inner));
        }
    }
    if (c.type === 'tuple') {
        const components = c.components;
        // Empty tuples are pointless in supported built-in ABIs, and arrays of ZSTs can DoS decoding.
        if (!components || !components.length)
            throw new Error('mapComponent: zero-size tuple disabled');
        let hasNames = true;
        const args = [];
        for (let comp of components) {
            if (!comp.name)
                hasNames = false;
            args.push(mapComponent(comp));
        }
        let out;
        // If there is names for all fields -- return struct, otherwise tuple
        if (hasNames) {
            // Named tuples expose object-form values keyed by the ABI field names.
            // ABI field names like toString are valid keys; only own properties are duplicates.
            const struct = Object.create(null);
            for (const arg of components) {
                if (Object.hasOwn(struct, arg.name))
                    throw new Error(`mapType: same field name=${arg.name}`);
                struct[arg.name] = mapComponent(arg);
            }
            out = P.struct(struct);
        }
        else
            out = P.tuple(args);
        // If tuple has dynamic elements it becomes dynamic too, without reason.
        if (isDyn(args))
            out = P.pointer(PTR, out);
        return out;
    }
    if (c.type === 'string')
        return P.pointer(PTR, P.padRight(32, P.string(U256BE_LEN), P.ZeroPad));
    if (c.type === 'bytes')
        return P.pointer(PTR, P.padRight(32, P.bytes(U256BE_LEN), P.ZeroPad));
    if (c.type === 'address')
        return EPad(P.hex(20, { isLE: false, with0x: true }));
    if (c.type === 'bool')
        return EPad(P.bool);
    if ((m = /^(u?)int([0-9]+)?$/.exec(c.type)))
        return ethInt(m[2] ? +m[2] : 256, m[1] !== 'u');
    if ((m = /^bytes([0-9]{1,2})$/.exec(c.type))) {
        const parsed = +m[1];
        if (!parsed || parsed > 32)
            throw new Error('wrong bytes<N> type');
        return P.padRight(32, P.bytes(parsed), P.ZeroPad);
    }
    throw new Error(`mapComponent: unknown component=${c}`);
}
// Because args and output are not tuple
// TODO: try merge with mapComponent
export function mapArgs(args) {
    // More ergonomic input/output
    if (args.length === 1)
        return mapComponent(args[0]);
    let hasNames = true;
    for (const arg of args)
        if (!arg.name)
            hasNames = false;
    if (hasNames) {
        // Multi-argument object form is only available when every ABI input has a name.
        // ABI input names like toString are valid keys; only own properties are duplicates.
        const out = Object.create(null);
        for (const arg of args) {
            const name = arg.name;
            if (Object.hasOwn(out, name))
                throw new Error(`mapArgs: same field name=${name}`);
            out[name] = mapComponent(arg);
        }
        return P.struct(out);
    }
    else
        return P.tuple(args.map(mapComponent));
}
//# sourceMappingURL=abi-mapper.js.map