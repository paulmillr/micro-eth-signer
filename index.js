"use strict";
/*! micro-eth-signer - MIT License (c) Paul Miller (paulmillr.com) */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transaction = exports.Address = exports.strip0x = exports.add0x = exports.TRANSACTION_TYPES = exports.CHAIN_TYPES = void 0;
const sha3_1 = require("@noble/hashes/sha3");
const utils_1 = require("@noble/hashes/utils");
const secp256k1 = require("@noble/secp256k1");
const rlp_1 = require("rlp");
exports.CHAIN_TYPES = { mainnet: 1, ropsten: 3, rinkeby: 4, goerli: 5, kovan: 42 };
exports.TRANSACTION_TYPES = { legacy: 0, eip2930: 1, eip1559: 2 };
function add0x(hex) {
    return /^0x/i.test(hex) ? hex : `0x${hex}`;
}
exports.add0x = add0x;
function strip0x(hex) {
    return hex.replace(/^0x/i, '');
}
exports.strip0x = strip0x;
function cloneDeep(obj) {
    if (Array.isArray(obj)) {
        return obj.map((i) => cloneDeep(i));
    }
    else if (typeof obj === 'bigint') {
        return BigInt(obj);
    }
    else if (typeof obj === 'object') {
        let res = {};
        for (let key in obj)
            res[key] = cloneDeep(obj[key]);
        return res;
    }
    else
        return obj;
}
const padHex = (hex) => (hex.length & 1 ? `0${hex}` : hex);
function hexToBytes(hex) {
    hex = padHex(strip0x(hex));
    const array = new Uint8Array(hex.length / 2);
    for (let i = 0; i < array.length; i++) {
        const j = i * 2;
        array[i] = Number.parseInt(hex.slice(j, j + 2), 16);
    }
    return array;
}
function numberToHex(num) {
    return padHex(num.toString(16));
}
function hexToNumber(hex) {
    if (typeof hex !== 'string') {
        throw new TypeError('hexToNumber: expected string, got ' + typeof hex);
    }
    return hex ? BigInt(add0x(hex)) : 0n;
}
const FIELDS = ['nonce', 'gasPrice', 'gasLimit', 'to', 'value', 'data', 'v', 'r', 's'];
const FIELDS2930 = [
    'chainId', 'nonce', 'gasPrice', 'gasLimit',
    'to', 'value', 'data', 'accessList', 'yParity', 'r', 's'
];
const FIELDS1559 = [
    'chainId', 'nonce', 'maxPriorityFeePerGas', 'maxFeePerGas', 'gasLimit',
    'to', 'value', 'data', 'accessList', 'yParity', 'r', 's'
];
const TypeToFields = {
    legacy: FIELDS,
    eip2930: FIELDS2930,
    eip1559: FIELDS1559,
};
const FIELD_NUMBER = new Set([
    'chainId', 'nonce', 'gasPrice', 'maxPriorityFeePerGas', 'maxFeePerGas',
    'gasLimit', 'value', 'v', 'yParity', 'r', 's'
]);
const FIELD_DATA = new Set(['data', 'to', 'storageKey', 'address']);
function normalizeField(field, value) {
    if (FIELD_NUMBER.has(field)) {
        if (value instanceof Uint8Array)
            value = add0x((0, utils_1.bytesToHex)(value));
        if (field === 'yParity' && typeof value === 'boolean')
            value = value ? '0x1' : '0x0';
        if (typeof value === 'string')
            value = BigInt(value === '0x' ? '0x0' : value);
        if (typeof value === 'number' || typeof value === 'bigint')
            value = add0x(padHex(value.toString(16)));
        if (field === 'gasLimit' && (!value || BigInt(value) === 0n))
            value = '0x5208';
        if (typeof value !== 'string')
            throw new TypeError(`Invalid type for field ${field}`);
        if (field === 'gasPrice' && BigInt(value) === 0n)
            throw new TypeError('The gasPrice must have non-zero value');
        return BigInt(value) === 0n ? '' : value;
    }
    if (FIELD_DATA.has(field)) {
        if (!value)
            value = '';
        if (value instanceof Uint8Array)
            value = (0, utils_1.bytesToHex)(value);
        if (typeof value !== 'string')
            throw new TypeError(`Invalid type for field ${field}`);
        value = add0x(value);
        return value === '0x' ? '' : value;
    }
    if (field === 'accessList') {
        if (!value)
            return [];
        let res = {};
        if (Array.isArray(value)) {
            for (let access of value) {
                if (Array.isArray(access)) {
                    if (access.length !== 2 || !Array.isArray(access[1]))
                        throw new TypeError(`Invalid type for field ${field}`);
                    const key = normalizeField('address', access[0]);
                    if (!res[key])
                        res[key] = new Set();
                    for (let i of access[1])
                        res[key].add(normalizeField('storageKey', i));
                }
                else {
                    if (typeof access !== 'object' ||
                        access == null ||
                        !access.address ||
                        !Array.isArray(access.storageKeys))
                        throw new TypeError(`Invalid type for field ${field}`);
                    const key = normalizeField('address', access.address);
                    if (!res[key])
                        res[key] = new Set();
                    for (let i of access.storageKeys)
                        res[key].add(normalizeField('storageKey', i));
                }
            }
        }
        else {
            if (typeof value !== 'object' || value == null || value instanceof Uint8Array)
                throw new TypeError(`Invalid type for field ${field}`);
            for (let k in value) {
                const key = normalizeField('address', k);
                if (!value[k])
                    continue;
                if (!Array.isArray(value[k]))
                    throw new TypeError(`Invalid type for field ${field}`);
                res[key] = new Set(value[k].map((i) => normalizeField('storageKey', i)));
            }
        }
        return Object.keys(res).map((i) => [i, Array.from(res[i])]);
    }
    throw new TypeError(`Invalid type for field ${field}`);
}
function possibleTypes(input) {
    let types = new Set(Object.keys(exports.TRANSACTION_TYPES));
    const keys = new Set(Object.keys(input));
    if (keys.has('maxPriorityFeePerGas') || keys.has('maxFeePerGas')) {
        types.delete('legacy');
        types.delete('eip2930');
    }
    if (keys.has('accessList') || keys.has('yParity'))
        types.delete('legacy');
    if (keys.has('gasPrice'))
        types.delete('eip1559');
    return types;
}
const RawTxLength = { 9: 'legacy', 11: 'eip2930', 12: 'eip1559' };
const RawTxLengthRev = { legacy: 9, eip2930: 11, eip1559: 12 };
function rawToSerialized(input, chain, type) {
    let chainId;
    if (chain)
        chainId = exports.CHAIN_TYPES[chain];
    if (Array.isArray(input)) {
        if (!type)
            type = RawTxLength[input.length];
        if (!type || RawTxLengthRev[type] !== input.length)
            throw new Error(`Invalid fields length for ${type}`);
    }
    else {
        const types = possibleTypes(input);
        if (type && !types.has(type)) {
            throw new Error(`Invalid type=${type}. Possible types with current fields: ${Array.from(types)}`);
        }
        if (!type) {
            if (types.has('legacy'))
                type = 'legacy';
            else if (!types.size)
                throw new Error('Impossible fields set');
            else
                type = Array.from(types)[0];
        }
        if (input.chainId) {
            if (chain) {
                const fromChain = normalizeField('chainId', exports.CHAIN_TYPES[chain]);
                const fromInput = normalizeField('chainId', input.chainId);
                if (fromChain !== fromInput) {
                    throw new Error(`Both chain=${chain}(${fromChain}) and chainId=${input.chainId}(${fromInput}) specified at same time`);
                }
            }
            chainId = input.chainId;
        }
        else
            input.chainId = chainId;
        input = TypeToFields[type].map((key) => input[key]);
    }
    if (input) {
        const sign = input.slice(-3);
        if (!sign[0] || !sign[1] || !sign[2]) {
            input = input.slice(0, -3);
            if (type === 'legacy' && chainId)
                input.push(normalizeField('chainId', chainId), '', '');
        }
    }
    let normalized = input.map((value, i) => normalizeField(TypeToFields[type][i], value));
    if (chainId)
        chainId = normalizeField('chainId', chainId);
    if (type !== 'legacy' && chainId && normalized[0] !== chainId)
        throw new Error(`ChainId=${normalized[0]} incompatible with Chain=${chainId}`);
    const tNum = exports.TRANSACTION_TYPES[type];
    return (tNum ? `0x0${tNum}` : '0x') + (0, utils_1.bytesToHex)(rlp_1.default.encode(normalized));
}
exports.Address = {
    fromPrivateKey(key) {
        if (typeof key === 'string')
            key = hexToBytes(key);
        return exports.Address.fromPublicKey(secp256k1.getPublicKey(key));
    },
    fromPublicKey(key) {
        if (typeof key === 'string')
            key = hexToBytes(key);
        const len = key.length;
        if (![33, 65].includes(len))
            throw new Error(`Invalid key with length "${len}"`);
        const pub = len === 65 ? key : secp256k1.Point.fromHex(key).toRawBytes(false);
        const addr = (0, utils_1.bytesToHex)((0, sha3_1.keccak_256)(pub.slice(1, 65))).slice(24);
        return exports.Address.checksum(addr);
    },
    checksum(nonChecksummedAddress) {
        const addr = strip0x(nonChecksummedAddress.toLowerCase());
        if (addr.length !== 40)
            throw new Error('Invalid address, must have 40 chars');
        const hash = strip0x((0, utils_1.bytesToHex)((0, sha3_1.keccak_256)(addr)));
        let checksummed = '';
        for (let i = 0; i < addr.length; i++) {
            const nth = Number.parseInt(hash[i], 16);
            let char = addr[i];
            if (nth > 7)
                char = char.toUpperCase();
            checksummed += char;
        }
        return add0x(checksummed);
    },
    verifyChecksum(address) {
        const addr = strip0x(address);
        if (addr.length !== 40)
            throw new Error('Invalid address, must have 40 chars');
        if (addr === addr.toLowerCase() || addr === addr.toUpperCase())
            return true;
        const hash = (0, utils_1.bytesToHex)((0, sha3_1.keccak_256)(addr.toLowerCase()));
        for (let i = 0; i < 40; i++) {
            const nth = Number.parseInt(hash[i], 16);
            const char = addr[i];
            if (nth > 7 && char.toUpperCase() !== char)
                return false;
            if (nth <= 7 && char.toLowerCase() !== char)
                return false;
        }
        return true;
    },
};
class Transaction {
    constructor(data, chain, hardfork = Transaction.DEFAULT_HARDFORK, type) {
        this.hardfork = hardfork;
        let norm;
        if (typeof data === 'string') {
            norm = data;
        }
        else if (data instanceof Uint8Array) {
            norm = (0, utils_1.bytesToHex)(data);
        }
        else if (Array.isArray(data) || (typeof data === 'object' && data != null)) {
            norm = rawToSerialized(data, chain, type);
        }
        else {
            throw new TypeError('Expected valid serialized tx');
        }
        if (norm.length <= 6)
            throw new Error('Invalid tx length');
        this.hex = add0x(norm);
        let txData;
        const prevType = type;
        if (this.hex.startsWith('0x01'))
            [txData, type] = [add0x(this.hex.slice(4)), 'eip2930'];
        else if (this.hex.startsWith('0x02'))
            [txData, type] = [add0x(this.hex.slice(4)), 'eip1559'];
        else
            [txData, type] = [this.hex, 'legacy'];
        if (prevType && prevType !== type)
            throw new Error('Invalid transaction type');
        this.type = type;
        const ui8a = rlp_1.default.decode(txData);
        this.raw = ui8a.reduce((res, value, i) => {
            const name = TypeToFields[type][i];
            if (!name)
                return res;
            res[name] = normalizeField(name, value);
            return res;
        }, {});
        if (!this.raw.chainId) {
            if (type === 'legacy' && !this.raw.r && !this.raw.s) {
                this.raw.chainId = this.raw.v;
                this.raw.v = '';
            }
        }
        if (!this.raw.chainId) {
            this.raw.chainId = normalizeField('chainId', exports.CHAIN_TYPES[chain || Transaction.DEFAULT_CHAIN]);
        }
        this.isSigned = !!(this.raw.r && this.raw.r !== '0x');
    }
    get bytes() {
        return hexToBytes(this.hex);
    }
    equals(other) {
        return this.getMessageToSign() === other.getMessageToSign();
    }
    get chain() {
        for (let k in exports.CHAIN_TYPES)
            if (exports.CHAIN_TYPES[k] === Number(this.raw.chainId))
                return k;
    }
    get sender() {
        const sender = this.recoverSenderPublicKey();
        if (!sender)
            throw new Error('Invalid signed transaction');
        return exports.Address.fromPublicKey(sender);
    }
    get gasPrice() {
        if (this.type === 'eip1559')
            throw new Error('Field only available for "legacy" transactions');
        return BigInt(this.raw.gasPrice);
    }
    get maxFeePerGas() {
        if (this.type !== 'eip1559')
            throw new Error('Field only available for "eip1559" transactions');
        return BigInt(this.raw.maxFeePerGas);
    }
    get maxPriorityFeePerGas() {
        if (this.type !== 'eip1559')
            throw new Error('Field only available for "eip1559" transactions');
        return BigInt(this.raw.maxPriorityFeePerGas);
    }
    get gasLimit() {
        return BigInt(this.raw.gasLimit);
    }
    get amount() {
        return BigInt(this.raw.value);
    }
    get fee() {
        const price = this.type === 'eip1559' ? this.maxFeePerGas : this.gasPrice;
        return price * this.gasLimit;
    }
    get upfrontCost() {
        return this.amount + this.fee;
    }
    get to() {
        return exports.Address.checksum(this.raw.to);
    }
    get nonce() {
        return Number.parseInt(this.raw.nonce, 16) || 0;
    }
    supportsReplayProtection() {
        const properBlock = !['chainstart', 'homestead', 'dao', 'tangerineWhistle'].includes(this.hardfork);
        if (!this.isSigned)
            return true;
        const v = Number(hexToNumber(this.raw.v));
        const chainId = Number(this.raw.chainId);
        const meetsConditions = v === chainId * 2 + 35 || v === chainId * 2 + 36;
        return properBlock && meetsConditions;
    }
    getMessageToSign(signed = false) {
        let values = TypeToFields[this.type].map((i) => this.raw[i]);
        if (!signed) {
            values = values.slice(0, -3);
            if (this.type === 'legacy' && this.supportsReplayProtection())
                values.push(this.raw.chainId, '', '');
        }
        let encoded = rlp_1.default.encode(values);
        if (this.type !== 'legacy')
            encoded = new Uint8Array([exports.TRANSACTION_TYPES[this.type], ...Array.from(encoded)]);
        return (0, utils_1.bytesToHex)((0, sha3_1.keccak_256)(encoded));
    }
    get hash() {
        if (!this.isSigned)
            throw new Error('Expected signed transaction');
        return this.getMessageToSign(true);
    }
    async sign(privateKey) {
        if (this.isSigned)
            throw new Error('Expected unsigned transaction');
        if (typeof privateKey === 'string')
            privateKey = strip0x(privateKey);
        const [hex, recovery] = await secp256k1.sign(this.getMessageToSign(), privateKey, {
            recovered: true,
        });
        const signature = secp256k1.Signature.fromHex(hex);
        const chainId = Number(this.raw.chainId);
        const vv = this.type === 'legacy' ? (chainId ? recovery + (chainId * 2 + 35) : recovery + 27) : recovery;
        const [v, r, s] = [vv, signature.r, signature.s].map((n) => add0x(numberToHex(n)));
        const signedRaw = this.type === 'legacy'
            ? { ...this.raw, v, r, s }
            : { ...cloneDeep(this.raw), yParity: v, r, s };
        return new Transaction(signedRaw, this.chain, this.hardfork, this.type);
    }
    recoverSenderPublicKey() {
        if (!this.isSigned)
            throw new Error('Expected signed transaction: cannot recover sender of unsigned tx');
        const [r, s] = [this.raw.r, this.raw.s].map((n) => hexToNumber(n));
        const sig = new secp256k1.Signature(r, s);
        if (this.hardfork !== 'chainstart' && sig.hasHighS()) {
            throw new Error('Invalid signature: s is invalid');
        }
        const signature = sig.toHex();
        const v = Number(hexToNumber(this.type === 'legacy' ? this.raw.v : this.raw.yParity));
        const chainId = Number(this.raw.chainId);
        const recovery = this.type === 'legacy' ? (chainId ? v - (chainId * 2 + 35) : v - 27) : v;
        return secp256k1.recoverPublicKey(this.getMessageToSign(), signature, recovery);
    }
}
exports.Transaction = Transaction;
Transaction.DEFAULT_HARDFORK = 'london';
Transaction.DEFAULT_CHAIN = 'mainnet';
Transaction.DEFAULT_TYPE = 'eip1559';
