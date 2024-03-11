import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
export const __dirname = dirname(fileURLToPath(import.meta.url));
const jsonGZ = (path) => JSON.parse(gunzipSync(readFileSync(`${__dirname}/${path}`)));
export const getEthersVectors = (path) => jsonGZ(`vectors/ethers/testcases/${path}`);
export const getViemVectors = (path) => jsonGZ(`vectors/viem/vectors/src/${path}`);
