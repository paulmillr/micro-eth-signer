/*! micro-eth-signer - MIT License (c) Paul Miller (paulmillr.com) */
export declare const CHAIN_TYPES: {
    mainnet: number;
    ropsten: number;
    rinkeby: number;
    goerli: number;
    kovan: number;
};
export declare const TRANSACTION_TYPES: {
    legacy: number;
    eip2930: number;
    eip1559: number;
};
export declare function add0x(hex: string): string;
export declare function strip0x(hex: string): string;
declare type Chain = keyof typeof CHAIN_TYPES;
declare type Type = keyof typeof TRANSACTION_TYPES;
declare const FIELDS: readonly ["nonce", "gasPrice", "gasLimit", "to", "value", "data", "v", "r", "s"];
declare const FIELDS2930: readonly ["chainId", "nonce", "gasPrice", "gasLimit", "to", "value", "data", "accessList", "yParity", "r", "s"];
declare const FIELDS1559: readonly ["chainId", "nonce", "maxPriorityFeePerGas", "maxFeePerGas", "gasLimit", "to", "value", "data", "accessList", "yParity", "r", "s"];
export declare type Field = typeof FIELDS[number] | typeof FIELDS2930[number] | typeof FIELDS1559[number] | 'address' | 'storageKey';
export declare type RawTxLegacy = [string, string, string, string, string, string, string, string, string];
export declare type RawTx2930 = [string, string, string, string, string, string, [string, string[]][], string, string, string];
export declare type RawTx1559 = [string, string, string, string, string, string, string, [string, string[]][], string, string, string];
export declare type RawTx = RawTxLegacy | RawTx2930 | RawTx1559;
export declare type RawTxMap = {
    chainId?: string;
    nonce: string;
    gasPrice?: string;
    maxPriorityFeePerGas?: string;
    maxFeePerGas?: string;
    gasLimit: string;
    to: string;
    value: string;
    data: string;
    accessList?: [string, string[]][];
    yParity?: string;
    v?: string;
    r: string;
    s: string;
};
export declare const Address: {
    fromPrivateKey(key: string | Uint8Array): string;
    fromPublicKey(key: string | Uint8Array): string;
    checksum(nonChecksummedAddress: string): string;
    verifyChecksum(address: string): boolean;
};
export declare class Transaction {
    readonly hardfork: string;
    static DEFAULT_HARDFORK: string;
    static DEFAULT_CHAIN: Chain;
    static DEFAULT_TYPE: Type;
    readonly hex: string;
    readonly raw: RawTxMap;
    readonly isSigned: boolean;
    readonly type: Type;
    constructor(data: string | Uint8Array | RawTx | RawTxMap, chain?: Chain, hardfork?: string, type?: Type);
    get bytes(): Uint8Array;
    equals(other: Transaction): boolean;
    get chain(): Chain | undefined;
    get sender(): string;
    get amount(): bigint;
    get fee(): bigint;
    get upfrontCost(): bigint;
    get to(): string;
    get nonce(): number;
    private supportsReplayProtection;
    getMessageToSign(signed?: boolean): string;
    get hash(): string;
    sign(privateKey: string | Uint8Array): Promise<Transaction>;
    recoverSenderPublicKey(): string | undefined;
}
export {};
