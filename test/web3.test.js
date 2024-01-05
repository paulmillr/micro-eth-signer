import { should } from 'micro-should';

import './abi.test.js';
import './ens.test.js';
import './uniswap.test.js';

// ESM is broken.
import url from 'url';
if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  should.run();
}
