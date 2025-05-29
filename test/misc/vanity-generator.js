import { addr } from '../src/index.ts';
import { add0x } from '../src/utils.ts';
function search(letters) {
  // speed-up: `import { secp256k1 } from '@noble/curves/secp256k1'; secp256k1.utils.precompute(16)`
  const prefix = add0x(letters);
  const estimate = Math.round(16 ** letters.length / 2);
  console.log(`Searching vanity address starting with ${prefix}`);
  console.log(`50% chance to find after ${estimate.toLocaleString()} tries`);
  for (let i = 1, start = Date.now(); ; i++) {
    if (i % 25000 === 0) {
      const passed = (Date.now() - start) / 1000;
      const speed = Math.round(i / passed);
      const min = Math.round((estimate - passed) / (speed * 60));
      console.log(`current: ${i}, speed: ${speed}/s, ETA: ${min} min`);
    }
    const curr = addr.random();
    if (curr.address.toLowerCase().startsWith(prefix)) {
      console.log(curr.privateKey, curr.address);
    }
  }
}
const letters = process.argv[2];
if (letters) search(letters);
else console.log('node vanity.js 1234') && process.exit(1);
