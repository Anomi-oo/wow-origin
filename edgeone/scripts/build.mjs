import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outputPath = path.join(projectDirectory, 'cloud-functions', '[[default]].js');

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await build({
  entryPoints: [path.join(projectDirectory, 'edgeone', 'entry.ts')],
  outfile: outputPath,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  charset: 'utf8',
  logLevel: 'info',
  legalComments: 'none',
  // express 必须整包打进产物：线上函数运行时没有 node_modules，
  // 任何残留的 require('express') 都会在请求时抛 MODULE_NOT_FOUND。
  // 默认导出必须写成字面量，CLI 二次打包时才会生成它期望的 stdin_default 绑定。
  footer: { js: 'export default app;' },
  banner: {
    js: [
      // EdgeOne CLI 会把自己的同名 banner 注入最终入口，这里使用独立别名避免重复声明。
      "import { createRequire as __edgeoneCreateRequire } from 'node:module';",
      "import { fileURLToPath as __edgeoneFileURLToPath } from 'node:url';",
      "import { dirname as __edgeonePathDirname } from 'node:path';",
      'const require = __edgeoneCreateRequire(import.meta.url);',
      'const __filename = __edgeoneFileURLToPath(import.meta.url);',
      'const __dirname = __edgeonePathDirname(__filename);',
      // EdgeOne CLI 靠 AST 里的 express 导入 + express() 调用识别框架函数，
      // 产物里必须保留这个字面量 import（CLI 打包时会再解析一次，不影响运行）。
      "import express from 'express';",
      'const __edgeone_framework_marker = express();'
    ].join('\n')
  }
});

const stats = await fs.stat(outputPath);
console.log(
  `[edgeone] 构建完成: ${path.relative(projectDirectory, outputPath)} (${(stats.size / 1024 / 1024).toFixed(2)} MiB)`
);
