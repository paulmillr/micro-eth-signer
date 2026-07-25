import { keccak_256 } from '@noble/hashes/sha3.js';
import { abytes, bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import * as P from 'micro-packed';
import { aarray, add0x, ethHex, isBytes, isObject, omit, strip0x, zip, } from "../utils.js";
import { ARRAY_RE, mapArgs, mapComponent, } from "./abi-mapper.js";
import { _chain as clearSigChain, repository as clearSigRepository, } from "./clearsig.js";
function fnSignature(o) {
    if (!o.type)
        throw new Error('ABI.fnSignature wrong argument');
    if (o.type === 'function' || o.type === 'event')
        return `${o.name || 'function'}(${(o.inputs || []).map((i) => fnSignature(i)).join(',')})`;
    if (o.type.startsWith('tuple')) {
        // Keep selector generation aligned with the mapper policy: empty tuples are disabled.
        if (!o.components || !o.components.length)
            throw new Error('ABI.fnSignature wrong tuple');
        return `(${o.components.map((i) => fnSignature(i)).join(',')})${o.type.slice(5)}`;
    }
    return o.type;
}
// Function signature hash
export function evSigHash(o) {
    return bytesToHex(keccak_256(utf8ToBytes(fnSignature(o))));
}
export function fnSigHash(o) {
    return evSigHash(o).slice(0, 8);
}
export function createContract(abi, net, contract) {
    aarray(abi, 'abi');
    // Find non-uniq function names so we can handle overloads
    let nameCnt = {};
    for (let fn of abi) {
        if (fn.type !== 'function')
            continue;
        const name = fn.name || 'function';
        if (!nameCnt[name])
            nameCnt[name] = 1;
        else
            nameCnt[name]++;
    }
    const res = {};
    for (let fn of abi) {
        if (fn.type !== 'function')
            continue;
        let name = fn.name || 'function';
        if (nameCnt[name] > 1)
            name = fnSignature(fn);
        const sh = fnSigHash(fn);
        const inputs = fn.inputs && fn.inputs.length ? mapArgs(fn.inputs) : undefined;
        const outputs = fn.outputs ? mapArgs(fn.outputs) : undefined;
        const decodeOutput = (b) => {
            if (outputs && !isBytes(b))
                throw new TypeError('"b" expected Uint8Array, got type=' + typeof b);
            return outputs && outputs.decode(b);
        };
        const encodeInput = (v) => concatBytes(hexToBytes(sh), inputs ? inputs.encode(v) : Uint8Array.of());
        res[name] = { decodeOutput, encodeInput };
        // .call and .estimateGas call network, when net is available
        if (!net)
            continue;
        res[name].call = async (args, overrides = {}) => {
            if (!contract && !overrides.to)
                throw new Error('No contract address');
            const data = add0x(bytesToHex(encodeInput(args)));
            const callArgs = Object.assign({ to: contract, data }, overrides);
            return decodeOutput(hexToBytes(strip0x(await net.ethCall(callArgs))));
        };
        res[name].estimateGas = async (args, overrides = {}) => {
            if (!contract && !overrides.to)
                throw new Error('No contract address');
            const data = add0x(bytesToHex(encodeInput(args)));
            const callArgs = Object.assign({ to: contract, data }, overrides);
            return await net.estimateGas(callArgs);
        };
    }
    return res;
}
export function deployContract(abi, bytecodeHex, ...args) {
    aarray(abi, 'abi');
    const bytecode = ethHex.decode(bytecodeHex);
    let consCall;
    for (let fn of abi) {
        if (fn.type !== 'constructor')
            continue;
        const inputs = fn.inputs && fn.inputs.length ? mapArgs(fn.inputs) : undefined;
        // Dynamic ABI typing may force callers to pass `undefined` for constructorless contracts.
        const emptyArgs = !args.length || (args.length === 1 && args[0] === undefined);
        if (inputs === undefined && !emptyArgs)
            throw new Error('arguments to constructor without any');
        consCall = inputs ? inputs.encode(args[0]) : Uint8Array.of();
    }
    if (!consCall)
        throw new Error('constructor not found');
    return ethHex.encode(concatBytes(bytecode, consCall));
}
// TODO: try to simplify further
export function events(abi) {
    aarray(abi, 'abi');
    let res = {};
    for (let elm of abi) {
        // Only named events supported
        if (elm.type !== 'event' || !elm.name)
            continue;
        const inputs = elm.inputs || [];
        let hasNames = true;
        for (let i of inputs)
            if (!i.name)
                hasNames = false;
        const plainInp = inputs.filter((i) => !i.indexed);
        const indexedInp = inputs.filter((i) => i.indexed);
        const indexed = indexedInp.map((i) => !['string', 'bytes', 'tuple'].includes(i.type) && !ARRAY_RE.exec(i.type)
            ? mapArgs([i])
            : null);
        const parser = mapArgs(hasNames ? plainInp : plainInp.map((i) => omit(i, 'name')));
        const sigHash = evSigHash(elm);
        res[elm.name] = {
            decode(topics, _data) {
                aarray(topics, 'topics');
                const data = hexToBytes(strip0x(_data));
                if (!elm.anonymous) {
                    if (!topics[0])
                        throw new Error('No signature on non-anonymous event');
                    if (strip0x(topics[0]).toLowerCase() !== sigHash)
                        throw new Error('Wrong signature');
                    topics = topics.slice(1);
                }
                if (topics.length !== indexed.length)
                    throw new Error('Wrong topics length');
                let parsed = parser ? parser.decode(data) : hasNames ? {} : [];
                // Indexed dynamic / tuple / array fields are logged only as keccak256 hashes, so decode can return only the raw topic hex for those values.
                const indexedParsed = indexed.map((p, i) => p ? p.decode(hexToBytes(strip0x(topics[i]))) : topics[i]);
                if (plainInp.length === 1)
                    parsed = hasNames ? { [plainInp[0].name]: parsed } : [parsed];
                if (hasNames) {
                    let res = { ...parsed };
                    for (let [a, p] of zip(indexedInp, indexedParsed))
                        res[a.name] = p;
                    return res;
                }
                else
                    return inputs.map((i) => (!i.indexed ? parsed : indexedParsed).shift());
            },
            topics(values) {
                if (!isObject(values))
                    throw new TypeError('"values" expected object or array, got type=' + typeof values);
                let res = [];
                if (!elm.anonymous)
                    res.push(add0x(sigHash));
                // We require all keys to be set, even if they are null, to be sure nothing is accidentaly missed
                if ((hasNames ? Object.keys(values) : values).length !== inputs.length)
                    throw new Error('Wrong topics args');
                for (let i = 0, ii = 0; i < inputs.length && ii < indexed.length; i++) {
                    const [input, packer] = [inputs[i], indexed[ii]];
                    if (!input.indexed)
                        continue;
                    const value = values[Array.isArray(values) ? i : inputs[i].name];
                    if (value === null) {
                        res.push(null);
                        continue;
                    }
                    let topic;
                    if (packer)
                        topic = bytesToHex(packer.encode(value));
                    else if (['string', 'bytes'].includes(input.type))
                        topic = bytesToHex(keccak_256(typeof value === 'string' ? utf8ToBytes(value) : value));
                    else {
                        let m, parts;
                        if ((m = ARRAY_RE.exec(input.type))) {
                            // This hashing path bypasses mapComponent's array wrapper, so fixed arrays must still enforce their ABI length here.
                            if (m[3] !== undefined && value.length !== Number.parseInt(m[3]))
                                throw new Error('Wrong topics args');
                            // Tuple arrays need components preserved after peeling the array suffix.
                            const inner = mapComponent({ ...input, type: m[1] });
                            parts = value.map((j) => inner.encode(j));
                        }
                        else if (input.type === 'tuple' && input.components) {
                            let tupleHasNames = true;
                            for (const j of input.components)
                                if (!j.name)
                                    tupleHasNames = false;
                            // Mixed tuple components use positional values, matching mapComponent's tuple carrier.
                            parts = input.components.map((j, n) => mapArgs([j]).encode(tupleHasNames ? value[j.name] : value[n]));
                        }
                        else
                            throw new Error('Unknown unsized type');
                        topic = bytesToHex(keccak_256(concatBytes(...parts)));
                    }
                    res.push(add0x(topic));
                    ii++;
                }
                return res;
            },
        };
    }
    return res;
}
/**
 * Mutable ABI decoder registry for exact contract matches and selector guesses.
 * @example
 * Decode calldata through a caller-owned registry.
 * ```ts
 * const decoder = new Decoder();
 * ```
 */
export class Decoder {
    contracts = {};
    sighashes = {};
    evContracts = {};
    evSighashes = {};
    clearSig;
    clearSigFactories = [];
    clearSigResolved = {};
    // Repository arrays preserve descriptor order; this mirror keeps per-call selector lookup O(1).
    clearSigSelectors = {};
    addClearSigEntry(chain, address, entry_, seen) {
        const entry = entry_;
        if (!entry.fn)
            return;
        const contract = strip0x(address, 'contract').toLowerCase();
        const sh = fnSigHash(entry.fn);
        if (seen) {
            const key = `${chain}:${contract}:${entry.source}:${sh}`;
            if (seen[key])
                throw new Error(`clearSig: duplicate selector ${sh}`);
            seen[key] = true;
        }
        const cur = this.contracts[contract] && this.contracts[contract][sh];
        const byAddr = this.clearSigSelectors[chain] || (this.clearSigSelectors[chain] = {});
        const bySel = byAddr[add0x(contract)] || (byAddr[add0x(contract)] = {});
        if (!bySel[sh])
            bySel[sh] = entry;
        if (cur)
            return;
        this.add(add0x(contract), [entry.fn]);
    }
    /** Adds ERC-7730 descriptors to this decoder, hashing ABI selectors through the normal ABI path. */
    addClearSig(files, opt = {}) {
        const repo = clearSigRepository(files);
        const local = this.clearSig || (this.clearSig = { contracts: {}, generic: [] });
        const seen = {};
        for (const chain of Object.keys(repo.contracts)) {
            const byAddr = repo.contracts[chain];
            const dstChain = local.contracts[chain] || (local.contracts[chain] = {});
            for (const address of Object.keys(byAddr)) {
                const dst = dstChain[address] || (dstChain[address] = []);
                for (const entry of byAddr[address]) {
                    dst.push(entry);
                    this.addClearSigEntry(chain, address, entry, seen);
                }
            }
        }
        // Deployment-less descriptors can be loaded once and bound later to a concrete tx target.
        local.generic.push(...repo.generic);
        if (opt.bind) {
            const bind = opt.bind;
            const id = clearSigChain(bind.chainId);
            const address = add0x(strip0x(bind.address, 'address').toLowerCase());
            const byAddr = local.contracts[`${id}`] || (local.contracts[`${id}`] = {});
            const dst = byAddr[address] || (byAddr[address] = []);
            for (const entry of local.generic) {
                dst.push(entry);
                this.addClearSigEntry(`${id}`, address, entry, seen);
            }
        }
        this.clearSigFactories.push(...repo.factories);
        return this;
    }
    /** Resolves factory-backed ERC-7730 descriptors into exact contract bindings. */
    async resolve(opt) {
        const o = opt;
        const id = clearSigChain(o.chainId);
        const address = strip0x(o.address, 'address').toLowerCase();
        const candidates = this.clearSigFactories.filter((i) => !i.deployments.length || i.deployments.some((d) => d.chainId === id));
        if (!candidates.length || !o.resolveFactory)
            return false;
        // Factory descriptors may be added after an earlier resolve attempt. Cache
        // against the candidate set, not just the target, or a pre-index miss poisons
        // later addClearSig() calls for the same address.
        const fp = candidates
            .map((i) => [
            i.deployEvent || '',
            i.deployments.map((d) => `${d.chainId}:${d.address}`).join(','),
            i.entries
                .map((e) => {
                const src = e.source === undefined ? '' : e.source;
                const sig = e.fn ? fnSigHash(e.fn) : '';
                return `${src}:${sig}`;
            })
                .join(','),
        ].join(';'))
            .join('|');
        const key = `${id}:${address}:${fp}`;
        if (Object.hasOwn(this.clearSigResolved, key))
            return this.clearSigResolved[key];
        const proved = await o.resolveFactory({
            address: add0x(address),
            chainId: id,
            factories: candidates.map((i) => ({
                factory: i.factory,
                deployments: i.deployments,
                deployEvent: i.deployEvent,
            })),
            descriptor: undefined,
            context: { to: add0x(address), chainId: id },
        });
        let ok = false;
        for (const idx of Array.isArray(proved) ? proved : proved === undefined ? [] : [proved]) {
            if (typeof idx !== 'number' || !Number.isSafeInteger(idx) || idx < 0 || !candidates[idx])
                throw new Error(`clearSig: wrong factory result index ${idx}`);
            if (!this.clearSig)
                this.clearSig = { contracts: {}, generic: [] };
            const branch = this.clearSig.contracts;
            const byAddr = branch[`${id}`] || (branch[`${id}`] = {});
            const entries = byAddr[add0x(address)] || (byAddr[add0x(address)] = []);
            for (const entry of candidates[idx].entries) {
                entries.push(entry);
                this.addClearSigEntry(`${id}`, add0x(address), entry);
                if (entry.fn)
                    ok = true;
            }
        }
        return (this.clearSigResolved[key] = ok);
    }
    /** Looks up a chain-scoped ERC-7730 renderer for already-decoded calldata. */
    clearSigEntry(contract, data, chainId) {
        data = abytes(data, undefined, 'data');
        if (data.length < 4)
            return;
        const id = clearSigChain(chainId);
        const address = add0x(strip0x(contract, 'contract').toLowerCase());
        const selector = bytesToHex(data.slice(0, 4));
        return this.clearSigSelectors[`${id}`]?.[address]?.[selector];
    }
    add(contract, abi) {
        contract = strip0x(contract, 'contract').toLowerCase();
        aarray(abi, 'abi');
        if (!this.contracts[contract])
            this.contracts[contract] = {};
        if (!this.evContracts[contract])
            this.evContracts[contract] = {};
        for (let fn of abi) {
            if (!isObject(fn) || Array.isArray(fn))
                throw new TypeError('"abi item" expected object, got type=' + typeof fn);
            if (fn.type === 'function') {
                const selector = fnSigHash(fn);
                const value = {
                    name: fn.name || 'function',
                    signature: fnSignature(fn),
                    packer: fn.inputs && fn.inputs.length ? mapArgs(fn.inputs) : undefined,
                    hook: fn.hook,
                };
                this.contracts[contract][selector] = value;
                if (!this.sighashes[selector])
                    this.sighashes[selector] = [];
                this.sighashes[selector].push(value);
            }
            else if (fn.type === 'event') {
                if (fn.anonymous || !fn.name)
                    continue;
                const selector = evSigHash(fn);
                // Event names can be overloaded, so bind the decoder to this ABI item instead of a name-keyed map.
                const decoder = events([fn])[fn.name]?.decode;
                const value = {
                    name: fn.name,
                    signature: fnSignature(fn),
                    decoder,
                    hint: fn.hint,
                };
                this.evContracts[contract][selector] = value;
                if (!this.evSighashes[selector])
                    this.evSighashes[selector] = [];
                this.evSighashes[selector].push(value);
            }
        }
    }
    method(contract, data) {
        contract = strip0x(contract, 'contract').toLowerCase();
        data = abytes(data, undefined, 'data');
        const sh = bytesToHex(data.slice(0, 4));
        if (!this.contracts[contract] || !this.contracts[contract][sh])
            return;
        const { name } = this.contracts[contract][sh];
        return name;
    }
    // Returns: exact match, possible options of matches (array) or undefined.
    // Note that empty value possible if there is no arguments in call.
    decode(contract, _data, opt = {}) {
        contract = strip0x(contract, 'contract').toLowerCase();
        _data = abytes(_data, undefined, 'data');
        const sh = bytesToHex(_data.slice(0, 4));
        const data = _data.slice(4);
        const unread = opt.allowUnreadBytes ? { allowUnreadBytes: true } : undefined;
        if (this.contracts[contract] && this.contracts[contract][sh]) {
            let { name, signature, packer, hook } = this.contracts[contract][sh];
            // Zero-arg functions have no packer, but calldata after the selector is still invalid.
            if (!packer && data.length && !opt.allowUnreadBytes)
                throw new Error('Unexpected trailing calldata');
            const value = packer ? packer.decode(data, unread) : undefined;
            let res = { name, signature, value };
            // Hook functions run only on exact contract matches, never on selector guesses.
            if (hook)
                res = hook(this, contract, res, opt);
            return res;
        }
        if (!this.sighashes[sh] || !this.sighashes[sh].length)
            return;
        let res = [];
        for (let { name, signature, packer } of this.sighashes[sh]) {
            try {
                if (!packer && data.length)
                    continue;
                res.push({ name, signature, value: packer ? packer.decode(data) : undefined });
            }
            catch (err) { }
        }
        if (res.length)
            return res;
        return;
    }
    decodeEvent(contract, topics, data, _opt) {
        contract = strip0x(contract, 'contract').toLowerCase();
        aarray(topics, 'topics');
        if (!topics.length)
            return;
        const sh = strip0x(topics[0]);
        const event = this.evContracts[contract];
        if (event && event[sh]) {
            let { name, signature, decoder, hint } = event[sh];
            const value = decoder(topics, data);
            let res = { name, signature, value };
            // Event hints are post-transaction receipt labels. Keep them separate from
            // ERC-7730 signing prompts. They run only on exact contract matches, never
            // on topic guesses, and decode stays robust if metadata is incomplete.
            try {
                if (hint)
                    res.hint = hint(value, Object.assign({ contract: add0x(contract) }, _opt));
            }
            catch (err) { }
            return res;
        }
        if (!this.evSighashes[sh] || !this.evSighashes[sh].length)
            return;
        let res = [];
        for (let { name, signature, decoder } of this.evSighashes[sh]) {
            try {
                res.push({ name, signature, value: decoder(topics, data) });
            }
            catch (err) { }
        }
        if (res.length)
            return res;
        return;
    }
}
//# sourceMappingURL=abi-decoder.js.map