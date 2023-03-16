import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: '../index.js',
  output: {
    file: 'build/micro-eth-signer.js',
    format: 'umd',
    name: 'microEthSigner',
    exports: 'named',
    preferConst: true,
  },
  plugins: [resolve(), commonjs()],
};
