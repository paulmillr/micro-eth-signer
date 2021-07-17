const secp = require('noble-secp256k1');
const eth = require('micro-eth-signer');
function bytesToHex(uint8a) {
  // pre-caching chars could speed this up 6x.
  let hex = '';
  for (let i = 0; i < uint8a.length; i++) {
    hex += uint8a[i].toString(16).padStart(2, '0');
  }
  return hex;
}
secp.utils.precompute(16);
function search(letters) {
  const prefix = eth.add0x(letters);
  const estimate = Math.round((16 ** letters.length) / 2);
  console.log(`Searching vanity addr starting with ${prefix}. 50% chance to find after ${estimate.toLocaleString()} tries`);
  let start = Date.now();
  let i = 0;
  while (++i) {
    if (i % 25000 === 0) {
      const passed = ((Date.now() - start) / 1000);
      const speed = Math.round(i / (passed));
      console.log(`current: ${i}, speed: ${speed}/s, ETA: ${Math.round((estimate-passed)/(speed*60))} min`);
    }
    const priv = bytesToHex(secp.utils.randomPrivateKey());
    const addr = eth.Address.fromPrivateKey(priv);
    if (addr.toLowerCase().startsWith(prefix)) {
      console.log(eth.add0x(priv), addr);
    }
  }
}

const letters = process.argv[2];
if (letters) search(letters); else console.log('node vanity.js 1234') && process.exit(1);
