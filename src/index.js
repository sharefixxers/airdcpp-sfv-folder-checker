'use strict';

if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '32';
}

process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.code === 'DEP0169') {
    return;
  }
  console.error(warning.stack || `${warning.name}: ${warning.message}`);
});

const { ManagedExtension } = require('airdcpp-extension');
const Entry = require('./main');

ManagedExtension(Entry, {

});
