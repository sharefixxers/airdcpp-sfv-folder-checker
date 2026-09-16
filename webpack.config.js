// Bundles src/main.js (and its local ./lib.js, plus npm dependencies like
// airdcpp-extension-settings) into a single, fully self-contained
// dist/main.js. The client only ever copies that one file into its extensions
// folder -- there is no node_modules folder alongside it at runtime, so
// anything not bundled in here would fail to load.
//
// Only genuine Node.js built-ins (fs, path, zlib, ...) are left as real
// require() calls, since those always exist wherever Node itself runs.
const path = require('path');

module.exports = {
  mode: 'production',
  target: 'node',
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'main.js',
    libraryTarget: 'commonjs2',
  },
  externalsPresets: { node: true },
};
