/*! micro-eth-signer - MIT License (c) Paul Miller (paulmillr.com) */
export declare const CHAIN_TYPES: {
    mainnet: number;
    ropsten: number;
    rinkeby: number;
    goerli: number;
    kovan: number;
};
export declare function add0x(hex: string): string;
export declare function strip0x(hex: string): string;
declare type Chain = keyof typeof CHAIN_TYPES;
declare const FIELDS: readonly ["nonce", "gasPrice", "gasLimit", "to", "value", "data", "v", "r", "s"];
export declare type Field = typeof FIELDS[number];
export declare type RawTx = [string, string, string, string, string, string, string, string, string];
export declare type RawTxMap = Record<Field, string>;
export declare const Address: {
    fromPrivateKey(key: string | Uint8Array): string;
    fromPublicKey(key: string | Uint8Array): string;
    checksum(nonChecksummedAddress: string): string;
    verifyChecksum(address: string): boolean;
};
export declare class Transaction {
    readonly chain: Chain;
    readonly hardfork: string;
    static DEFAULT_HARDFORK: string;
    static DEFAULT_CHAIN: Chain;
    readonly hex: string;
    readonly raw: RawTxMap;
    readonly isSigned: boolean;
    constructor(data: string | Uint8Array | RawTx | RawTxMap, chain?: Chain, hardfork?: string);
    get bytes(): Uint8Array;
    equals(other: Transaction): boolean;
    get sender(): string;
    get amount(): bigint;
    get fee(): bigint;
    get upfrontCost(): bigint;
    get to(): string;
    get nonce(): number;
    private prepare;
    private supportsReplayProtection;
    getMessageToSign(): string;
    get hash(): string;
    sign(privateKey: string | Uint8Array): Promise<Transaction>;
    recoverSenderPublicKey(): string | undefined;
}
export {};
