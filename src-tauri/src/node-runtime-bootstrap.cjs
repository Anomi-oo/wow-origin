const { createRequire } = require('node:module');

const runtimeRequire = createRequire(process.execPath);
const candidates = [
  './server-runtime/dist/server.js',
  '../Resources/server-runtime/dist/server.js'
];
const runtimeScript = candidates.find((candidate) => {
  try {
    runtimeRequire.resolve(candidate);
    return true;
  } catch {
    return false;
  }
});

if (!runtimeScript) {
  throw new Error(`桌面运行入口不存在：${candidates.join('、')}`);
}

runtimeRequire(runtimeScript).start();
