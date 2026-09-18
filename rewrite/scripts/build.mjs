import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rewriteDirectory = path.join(projectDirectory, 'rewrite');
const generatedDirectory = path.join(rewriteDirectory, 'generated');
const outputDirectory = path.join(rewriteDirectory, 'dist');
const serviceOrigin = String(process.env.WOW_REWRITE_ORIGIN || 'https://pinhaoge.xyz').replace(/\/+$/, '');
const serviceUrl = new URL(serviceOrigin);
if (!['http:', 'https:'].includes(serviceUrl.protocol) || serviceUrl.pathname !== '/') {
  throw new Error('WOW_REWRITE_ORIGIN 必须是没有路径的 HTTP(S) 地址');
}
const uiUrl = String(
  process.env.WOW_REWRITE_UI_URL
    || 'https://raw.githubusercontent.com/Anomi-oo/wow-origin/main/rewrite/ui/index.html'
);
if (!/^https:\/\//i.test(uiUrl)) throw new Error('WOW_REWRITE_UI_URL 必须是 HTTPS 地址');

const aliases = new Map([
  ['axios', path.join(rewriteDirectory, 'shims', 'axios.ts')],
  ['crypto', path.join(rewriteDirectory, 'shims', 'crypto.ts')],
  ['node:crypto', path.join(rewriteDirectory, 'shims', 'crypto.ts')],
  ['http', path.join(rewriteDirectory, 'shims', 'agents.ts')],
  ['https', path.join(rewriteDirectory, 'shims', 'agents.ts')],
  ['path', path.join(rewriteDirectory, 'shims', 'path.ts')],
  ['url', path.join(rewriteDirectory, 'shims', 'url.ts')]
]);

function resolveAliasPlugin() {
  return {
    name: 'rewrite-runtime-aliases',
    setup(esbuild) {
      esbuild.onResolve({ filter: /.*/ }, (args) => {
        const direct = aliases.get(args.path);
        if (direct) return { path: direct };
        if (/platforms\/PlatformFactory$/.test(args.path)) {
          return { path: path.join(rewriteDirectory, 'shims', 'platform-factory.ts') };
        }
        if (/core\/PlatformCache$/.test(args.path)) {
          return { path: path.join(rewriteDirectory, 'shims', 'cache.ts') };
        }
        return undefined;
      });
    }
  };
}

async function requiredRoutes() {
  const clients = await Promise.all([
    fs.readFile(path.join(projectDirectory, 'src', 'clients', 'NeteaseClient.ts'), 'utf8'),
    fs.readFile(path.join(projectDirectory, 'src', 'clients', 'QQClient.ts'), 'utf8')
  ]);
  const names = new Set();
  for (const source of clients) {
    for (const match of source.matchAll(/this\.call\('([^']+)'/g)) names.add(match[1]);
  }
  return [...names].sort();
}

async function generatePlatformModules() {
  const routes = await requiredRoutes();
  const imports = [];
  const registries = [];
  let index = 0;
  let count = 0;
  for (const platform of ['netease', 'qqmusic']) {
    const entries = [];
    for (const route of routes) {
      const file = path.join(projectDirectory, 'platforms', platform, 'module', `${route}.js`);
      try { await fs.access(file); } catch { continue; }
      const identifier = `module${index++}`;
      imports.push(`import ${identifier} from ${JSON.stringify(`../../platforms/${platform}/module/${route}.js`)};`);
      entries.push(`    ${JSON.stringify(route.replace(/_/g, '/'))}: ${identifier}`);
      count += 1;
    }
    registries.push(`  ${JSON.stringify(platform)}: {\n${entries.join(',\n')}\n  }`);
  }
  await fs.mkdir(generatedDirectory, { recursive: true });
  await fs.writeFile(
    path.join(generatedDirectory, 'platform-modules.ts'),
    `${imports.join('\n')}\n\nconst platformModules = {\n${registries.join(',\n')}\n};\nexport default platformModules;\n`,
    'utf8'
  );
  return count;
}

async function buildStandaloneHtml() {
  const standalone = await fs.readFile(path.join(rewriteDirectory, 'ui', 'index.html'), 'utf8');
  await fs.writeFile(path.join(outputDirectory, 'wow-origin.rewrite.html'), standalone, 'utf8');
  return standalone;
}

async function main() {
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true });
  const moduleCount = await generatePlatformModules();
  const standaloneHtml = await buildStandaloneHtml();
  const result = await build({
    entryPoints: [path.join(rewriteDirectory, 'entry.ts')],
    outfile: path.join(outputDirectory, 'wow-origin.rewrite.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['safari15'],
    banner: {
      js: 'var process={env:{NODE_ENV:"production"},on:function(){},once:function(){},emit:function(){},nextTick:function(fn){Promise.resolve().then(fn)}};'
    },
    minify: process.env.WOW_REWRITE_DEBUG !== '1',
    sourcemap: process.env.WOW_REWRITE_DEBUG === '1' ? 'inline' : false,
    legalComments: 'none',
    inject: [path.join(rewriteDirectory, 'shims', 'buffer.ts')],
    plugins: [resolveAliasPlugin()],
    define: {
      'process.env.NODE_ENV': '"production"',
      __REWRITE_HOST__: JSON.stringify(serviceUrl.hostname),
      __REWRITE_UI_URL__: JSON.stringify(uiUrl)
    },
    metafile: true,
    logLevel: 'warning'
  });
  const bytes = (await fs.stat(path.join(outputDirectory, 'wow-origin.rewrite.js'))).size;
  console.log(`[rewrite] 平台模块: ${moduleCount}`);
  console.log(`[rewrite] 通用单文件: rewrite/dist/wow-origin.rewrite.js (${(bytes / 1024).toFixed(1)} KiB)`);
  console.log(`[rewrite] 固定入口: ${serviceOrigin}`);
  console.log(`[rewrite] 管理页面: ${uiUrl}`);
  console.log('[rewrite] 前端上传文件: rewrite/dist/wow-origin.rewrite.html');
  console.log('[rewrite] QuanX 配置: rewrite/resources/wow-origin.quantumultx.snippet');
  console.log('[rewrite] Loon 插件: rewrite/resources/wow-origin.loon.plugin');
  if (!result.metafile) throw new Error('esbuild metafile was not generated');
}

await main();
