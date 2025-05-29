import { should } from 'micro-should';

import './fee.test.ts';
import './rlp.test.ts';
import './tx.test.ts';
// ABI stuff
import './abi.test.ts';
import './ens.test.ts';
import './kzg.test.ts';
import './net.test.ts';
import './peerdas.test.ts';
import './ssz.test.ts';
import './typed-data.test.ts';
import './uniswap.test.ts';

should.runWhen(import.meta.url);
