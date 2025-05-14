import { should } from 'micro-should';

import './fee.test.js';
import './rlp.test.js';
import './tx.test.js';
// ABI stuff
import './abi.test.js';
import './ens.test.js';
import './kzg.test.js';
import './net.test.js';
import './peerdas.test.js';
import './ssz.test.js';
import './typed-data.test.js';
import './uniswap.test.js';

should.runWhen(import.meta.url);
