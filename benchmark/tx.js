import { compare, utils as butils } from 'micro-bmark';

import { parseGwei } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import * as micro from '../esm/index.js';
import { amounts } from '../esm/utils.js';
import * as viem from 'viem';
import * as ethers from 'ethers';

const PRIV = '0x0d3f15106182dd987498bec735ff2c229a0fe62529d30e2959227d4158112280';
const VIEM_PRIV = privateKeyToAccount(PRIV);
const ETHERS_PRIV = new ethers.Wallet(PRIV);
const TO_ADDR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const TX =
  '0x02f86b014584b2d05e008504a817c80082520894f39fd6e51aad88f6f4ce6ab8827279cfffb922668080c080a0a9ff766b8c2faa724e9658625e7c18c6694b1e8d1d740aa4075a5191abccd73ca008a1238402eb55cf19edcd197daf1b73c94d74bd16a1d590897956e6f881b326';

console.log(micro.Transaction.fromHex(TX).removeSignature().signBy(PRIV).toHex());

const TX_PARAMS = {
  ethers: {
    chainId: 1,
    maxFeePerGas: parseGwei('20'),
    maxPriorityFeePerGas: parseGwei('3'),
    gasLimit: 21000n, // gasLimit
    nonce: 69,
    to: TO_ADDR,
  },
  viem: {
    chainId: 1,
    maxFeePerGas: parseGwei('20'),
    maxPriorityFeePerGas: parseGwei('3'),
    gas: 21000n, // gasLimit
    nonce: 69,
    to: TO_ADDR,
  },
  micro: {
    chainId: 1n,
    maxFeePerGas: 20n * amounts.GWEI,
    maxPriorityFeePerGas: 3n * amounts.GWEI,
    nonce: 69n,
    to: TO_ADDR,
    value: 0n,
  },
};

const LIBS = {
  decodeTx: {
    samples: 30_000,
    ethers: () => ethers.Transaction.from(TX),
    viem: () => viem.parseTransaction(TX),
    'micro-eth-signer': () => micro.Transaction.fromHex(TX),
  },
  decodeTxFrom: {
    samples: 1_000,
    ethers: () => ethers.Transaction.from(TX).from,
    'micro-eth-signer': () => micro.Transaction.fromHex(TX).recoverSender().address,
  },
  decodeTxHash: {
    samples: 10_000,
    ethers: () => ethers.Transaction.from(TX).hash,
    'micro-eth-signer': () => micro.Transaction.fromHex(TX).calcHash(true),
  },
  sign: {
    samples: 10_000,
    ethers: async () => await ETHERS_PRIV.signTransaction(TX_PARAMS.ethers),
    viem: async () => await VIEM_PRIV.signTransaction(TX_PARAMS.viem),
    'micro-eth-signer': () => micro.Transaction.prepare(TX_PARAMS.micro).signBy(PRIV).toHex(true),
  },
};

export async function main() {
  // Sanity check
  const parsed = Object.fromEntries(
    Object.entries(LIBS.decodeTx)
      .filter(([k, _]) => k !== 'samples')
      .map(([k, v]) => [k, v()])
  );
  deepStrictEqual(parsed.viem.to, parsed['micro-eth-signer'].raw.to.toLowerCase());
  deepStrictEqual(parsed.ethers.to, parsed['micro-eth-signer'].raw.to);
  // I have no idea how to do same with viem. But ethers API seems better.
  // Seems viem gets transaction hash via web3 node.
  deepStrictEqual(parsed.ethers.from, parsed['micro-eth-signer'].recoverSender().address);
  deepStrictEqual(parsed.ethers.unsignedHash, `0x${parsed['micro-eth-signer'].calcHash(false)}`);
  deepStrictEqual(parsed.ethers.hash, `0x${parsed['micro-eth-signer'].calcHash(true)}`);
  const signed = Object.fromEntries(
    (
      await Promise.all(
        Object.entries(LIBS.sign)
          .filter(([k, _]) => k !== 'samples')
          .map(([k, v]) => v())
      )
    ).map((i, j) => [Object.keys(LIBS.sign).filter((i) => i !== 'samples')[j], i])
  );

  deepStrictEqual(signed.viem, signed['micro-eth-signer']);
  deepStrictEqual(signed.ethers, signed['micro-eth-signer']);

  for (const fnName in LIBS) {
    const fns = Object.entries(LIBS[fnName]).filter(([k, _]) => k !== 'samples');
    const { samples } = LIBS[fnName];
    await compare(`${fnName}`, samples, Object.fromEntries(fns));
  }

  butils.logMem();
}

// ESM is broken.
import url from 'node:url';
import { deepStrictEqual } from 'node:assert';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  main();
}
