import { keccak_256 } from '@noble/hashes/sha3.js';
import { concatBytes } from '@noble/hashes/utils.js';
import {
  astring,
  deepFreeze,
  ethHex,
  initSig,
  isObject,
  recoverPublicKey,
  sign,
  type TRet,
} from '../utils.ts';
import { addr } from './address.ts';
import { RLP } from './rlp.ts';
import {
  authorizationRequest,
  type AuthorizationItem,
  type AuthorizationRequest,
} from './tx-internal.ts';

/** EIP-7702 Authorizations: sign a delegation request, recover its authority. */
type AuthorizationHelpers = {
  _getHash: (req: AuthorizationRequest) => TRet<Uint8Array>;
  sign: (req: AuthorizationRequest, privateKey: string) => AuthorizationItem;
  getAuthority: (item: AuthorizationItem) => string;
};
export const authorization: TRet<AuthorizationHelpers> = /* @__PURE__ */ deepFreeze({
  _getHash(req: AuthorizationRequest): TRet<Uint8Array> {
    const msg = RLP.encode(authorizationRequest.decode(req));
    return keccak_256(concatBytes(new Uint8Array([0x05]), msg));
  },
  sign(req: AuthorizationRequest, privateKey: string): AuthorizationItem {
    astring(privateKey);
    const sig = sign(this._getHash(req), ethHex.decode(privateKey));
    return { ...req, r: sig.r, s: sig.s, yParity: sig.recovery! };
  },
  getAuthority(item: AuthorizationItem): string {
    if (!isObject(item)) throw new TypeError('"item" expected object, got type=' + typeof item);
    const { r, s, yParity, ...req } = item;
    const hash = this._getHash(req);
    const sig = initSig({ r, s }, yParity);
    // EIP-7702: an authorization with s > secp256k1n/2 is invalid on-chain,
    // so recovering an authority from one would be misleading
    if (sig.hasHighS()) throw new Error('invalid s');
    return addr.fromPublicKey(recoverPublicKey(sig, hash));
  },
});
