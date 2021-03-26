"use strict";
/*! micro-eth-signer - MIT License (c) Paul Miller (paulmillr.com) */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transaction = exports.Address = exports.strip0x = exports.add0x = exports.CHAIN_TYPES = void 0;
const js_sha3_1 = require("js-sha3");
const rlp = require("micro-rlp");
const secp256k1 = require("noble-secp256k1");
exports.CHAIN_TYPES = { mainnet: 1, ropsten: 3, rinkeby: 4, goerli: 5, kovan: 42 };
function add0x(hex) {
    return /^0x/i.test(hex) ? hex : `0x${hex}`;
}
exports.add0x = add0x;
function strip0x(hex) {
    return hex.replace(/^0x/i, '');
}
exports.strip0x = strip0x;
function bytesToHex(uint8a) {
    let hex = '';
    for (let i = 0; i < uint8a.length; i++) {
        hex += uint8a[i].toString(16).padStart(2, '0');
    }
    return hex;
}
function hexToBytes(hex) {
    hex = strip0x(hex);
    if (hex.length & 1)
        hex = `0${hex}`;
    const array = new Uint8Array(hex.length / 2);
    for (let i = 0; i < array.length; i++) {
        const j = i * 2;
        array[i] = Number.parseInt(hex.slice(j, j + 2), 16);
    }
    return array;
}
function hexToBytesUnpadded(num) {
    return num === '0x' || BigInt(num) === 0n ? new Uint8Array() : hexToBytes(num);
}
function numberToHex(num, padToBytes = 0) {
    const hex = num.toString(16);
    const p1 = hex.length & 1 ? `0${hex}` : hex;
    return p1.padStart(padToBytes * 2, '0');
}
function hexToNumber(hex) {
    if (typeof hex !== 'string') {
        throw new TypeError('hexToNumber: expected string, got ' + typeof hex);
    }
    return hex ? BigInt(add0x(hex)) : 0n;
}
const FIELDS = ['nonce', 'gasPrice', 'gasLimit', 'to', 'value', 'data', 'v', 'r', 's'];
function mapToArray(input) {
    return FIELDS.map((key) => input[key]);
}
function normalizeField(field, value) {
    if (['nonce', 'gasPrice', 'gasLimit', 'value'].includes(field)) {
        if (typeof value === 'string') {
            if (value === '0x')
                value = '';
        }
        else if (typeof value === 'number' || typeof value === 'bigint') {
            value = value.toString(16);
        }
        else {
            throw new TypeError('Invalid type');
        }
    }
    if (field === 'gasLimit' && !value) {
        value = '0x5208';
    }
    if (['nonce', 'gasPrice', 'value'].includes(field) && !value) {
        throw new TypeError('The field must have non-zero value');
    }
    if (typeof value !== 'string')
        throw new TypeError('Invalid type');
    return value;
}
function rawToSerialized(input) {
    let array = Array.isArray(input) ? input : mapToArray(input);
    for (let i = 0; i < array.length; i++) {
        const field = FIELDS[i];
        const value = array[i];
        const adjusted = normalizeField(field, value);
        if (typeof value === 'string')
            array[i] = add0x(adjusted);
    }
    return add0x(bytesToHex(rlp.encode(array)));
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
        const addr = js_sha3_1.keccak256(pub.slice(1, 65)).slice(24);
        return exports.Address.checksum(addr);
    },
    checksum(nonChecksummedAddress) {
        const addr = strip0x(nonChecksummedAddress.toLowerCase());
        const hash = strip0x(js_sha3_1.keccak256(addr));
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
        if (addr === addr.toLowerCase() || addr === addr.toUpperCase())
            return true;
        const hash = js_sha3_1.keccak256(addr.toLowerCase());
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
    constructor(data, chain = Transaction.DEFAULT_CHAIN, hardfork = Transaction.DEFAULT_HARDFORK) {
        this.chain = chain;
        this.hardfork = hardfork;
        let norm;
        if (typeof data === 'string') {
            norm = data;
        }
        else if (data instanceof Uint8Array) {
            norm = bytesToHex(data);
        }
        else if (Array.isArray(data) || (typeof data === 'object' && data != null)) {
            norm = rawToSerialized(data);
        }
        else {
            throw new TypeError('Expected valid serialized tx');
        }
        if (norm.length <= 6)
            throw new Error('Invalid tx length');
        this.hex = norm;
        const ui8a = rlp.decode(add0x(norm));
        const arr = ui8a.map(bytesToHex).map((i) => (i ? add0x(i) : i));
        this.raw = arr.reduce((res, value, i) => {
            const name = FIELDS[i];
            res[name] = value;
            return res;
        }, {});
        this.isSigned = !!(this.raw.r && this.raw.r !== '0x');
    }
    get bytes() {
        return hexToBytes(this.hex);
    }
    equals(other) {
        return this.getMessageToSign() === other.getMessageToSign();
    }
    get sender() {
        const sender = this.recoverSenderPublicKey();
        if (!sender)
            throw new Error('Invalid signed transaction');
        return exports.Address.fromPublicKey(sender);
    }
    get amount() {
        return BigInt(this.raw.value);
    }
    get fee() {
        return BigInt(this.raw.gasPrice) * BigInt(this.raw.gasLimit);
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
    prepare() {
        return [
            hexToBytesUnpadded(this.raw.nonce),
            hexToBytesUnpadded(this.raw.gasPrice),
            hexToBytesUnpadded(this.raw.gasLimit),
            hexToBytes(this.raw.to),
            hexToBytesUnpadded(this.raw.value),
            hexToBytesUnpadded(this.raw.data),
            hexToBytesUnpadded(this.raw.v),
            hexToBytesUnpadded(this.raw.r),
            hexToBytesUnpadded(this.raw.s),
        ];
    }
    supportsReplayProtection() {
        const properBlock = !['chainstart', 'homestead', 'dao', 'tangerineWhistle'].includes(this.hardfork);
        if (!this.isSigned)
            return true;
        const v = Number(hexToNumber(this.raw.v));
        const chainId = exports.CHAIN_TYPES[this.chain];
        const meetsConditions = v === chainId * 2 + 35 || v === chainId * 2 + 36;
        return properBlock && meetsConditions;
    }
    getMessageToSign() {
        const values = this.prepare().slice(0, 6);
        if (this.supportsReplayProtection()) {
            values.push(hexToBytes(numberToHex(exports.CHAIN_TYPES[this.chain])));
            values.push(new Uint8Array());
            values.push(new Uint8Array());
        }
        return js_sha3_1.keccak256(rlp.encode(values));
    }
    get hash() {
        if (!this.isSigned)
            throw new Error('Expected signed transaction');
        return js_sha3_1.keccak256(rlp.encode(this.prepare()));
    }
    async sign(privateKey) {
        if (this.isSigned)
            throw new Error('Expected unsigned transaction');
        if (typeof privateKey === 'string')
            privateKey = strip0x(privateKey);
        const [hex, recovery] = await secp256k1.sign(this.getMessageToSign(), privateKey, {
            recovered: true,
            canonical: true,
        });
        const signature = secp256k1.Signature.fromHex(hex);
        const chainId = exports.CHAIN_TYPES[this.chain];
        const vv = chainId ? recovery + (chainId * 2 + 35) : recovery + 27;
        const [v, r, s] = [vv, signature.r, signature.s].map((n) => add0x(numberToHex(n)));
        const signedRaw = Object.assign({}, this.raw, { v, r, s });
        return new Transaction(signedRaw, this.chain, this.hardfork);
    }
    recoverSenderPublicKey() {
        if (!this.isSigned) {
            throw new Error('Expected signed transaction: cannot recover sender of unsigned tx');
        }
        const [vv, r, s] = [this.raw.v, this.raw.r, this.raw.s].map((n) => hexToNumber(n));
        if (this.hardfork !== 'chainstart' && s && s > secp256k1.CURVE.n / 2n) {
            throw new Error('Invalid signature: s is invalid');
        }
        const signature = new secp256k1.Signature(r, s).toHex();
        const chainId = exports.CHAIN_TYPES[this.chain];
        const v = Number(vv);
        const recovery = chainId ? v - (chainId * 2 + 35) : v - 27;
        return secp256k1.recoverPublicKey(this.getMessageToSign(), signature, recovery);
    }
}
exports.Transaction = Transaction;
Transaction.DEFAULT_HARDFORK = 'muirGlacier';
Transaction.DEFAULT_CHAIN = 'mainnet';
