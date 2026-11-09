#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { hash } = require('./native-trial.cjs');
const STOCK_HASH = '046b41aee0242ced3d3fcd9d5e0c0adb68e17ea3bfe14efa13d6225b6050bfad';
const PARTS = ['native-platform.js', 'free-my-tv-native.js', 'native-entry.js'];
// The expected hash defaults to the 55A7KAU stock bundle this builder was
// written for. Pass a third argument to build the same parts against another
// pinned revision; a build that cannot name its stock revision cannot be
// rolled back safely.
function build(stockFile, output, expect = STOCK_HASH) {
  const stock = fs.readFileSync(stockFile);
  assert.equal(hash(stock), expect, 'wrong stock launcher revision');
  const license = fs.readFileSync(path.join(__dirname, 'third-party/free-my-tv/LICENSE'), 'utf8');
  const candidate = '/* ALVIDAA_FREE_MY_TV_NATIVE_V1\n' + license + '\n*/\n' + stock + '\n;\n' +
    PARTS.map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n;\n');
  new vm.Script(candidate, { filename: 'native-candidate.js' });
  if (output) {
    const target = path.resolve(output);
    const privateRoot = path.resolve(__dirname, '../../firmware') + path.sep;
    assert.ok(target.startsWith(privateRoot) || target.startsWith('/tmp/'), 'vendor-containing output must stay private');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, candidate, { mode: 0o600 });
    fs.chmodSync(target, 0o600);
  }
  return candidate;
}
if (require.main === module) {
  const [stock, output, expect] = process.argv.slice(2);
  assert.ok(stock && output, 'Usage: build-native.cjs private-stock.js private-output.js [expected-sha256]');
  const candidate = build(stock, output, expect || STOCK_HASH);
  console.log('Built native candidate: ' + Buffer.byteLength(candidate) + ' bytes; sha256 ' + hash(candidate));
}
module.exports = { build, STOCK_HASH, PARTS };
