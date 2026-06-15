import { createReadStream, readFileSync } from 'node:fs';
import { dirname, join as pjoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { createGunzip, gunzipSync } from 'node:zlib';
export const __dirname = dirname(fileURLToPath(import.meta.url));
export const getVectorsPath = (path) => pjoin(__dirname, 'vectors', path);
export const jsonGZ = (path) => JSON.parse(gunzipSync(readFileSync(pjoin(__dirname, path))));
export const getEthersVectors = (path) => jsonGZ(pjoin('vectors', 'ethers', 'testcases', path));
export const getViemVectors = (path) => jsonGZ(pjoin('vectors', 'viem', 'vectors', 'src', path));

let gc: (() => void) | undefined;
export const forceGC = () => {
  if (!gc) {
    if (typeof (globalThis as any).gc === 'function') gc = (globalThis as any).gc;
    else {
      try {
        setFlagsFromString('--expose-gc');
        gc = runInNewContext('gc');
      } catch {
        return;
      }
    }
  }
  gc();
  gc();
};

export async function* jsonGZItems(path) {
  const stream = createReadStream(pjoin(__dirname, path)).pipe(createGunzip());
  const decoder = new TextDecoder();
  let started = false;
  let itemStarted = false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let item = '';
  const finish = function* () {
    const text = item.trim();
    if (text) yield JSON.parse(text);
    item = '';
    itemStarted = false;
  };
  const handle = function* (text) {
    for (const ch of text) {
      if (!started) {
        if (/\s/.test(ch)) continue;
        if (ch !== '[') throw new Error(`jsonGZItems: expected top-level array in ${path}`);
        started = true;
        continue;
      }
      if (!itemStarted) {
        if (/\s|,/.test(ch)) continue;
        if (ch === ']') return;
        itemStarted = true;
      } else if (!inString && depth === 0 && (ch === ',' || ch === ']')) {
        yield* finish();
        if (ch === ']') return;
        continue;
      }
      item += ch;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') {
          inString = false;
          if (depth === 0) yield* finish();
        }
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
      if (depth === 0 && itemStarted && (ch === '}' || ch === ']')) yield* finish();
    }
  };
  for await (const chunk of stream) {
    for (const value of handle(decoder.decode(chunk, { stream: true }))) yield value;
  }
  for (const value of handle(decoder.decode())) yield value;
  for (const value of finish()) yield value;
}
export const getViemVectorItems = (path) =>
  jsonGZItems(pjoin('vectors', 'viem', 'vectors', 'src', path));
