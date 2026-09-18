import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareLxSource } from './prepare-lx.mjs';
import { preparePlatformModules } from './prepare-platforms.mjs';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const generatedDirectory = path.join(projectDirectory, 'cloudflare', 'generated');

const [source, moduleCount] = await Promise.all([
  prepareLxSource({
    sourceUrl: process.env.CF_LX_SOURCE_URL || '',
    outputPath: path.join(generatedDirectory, 'lx-source.ts')
  }),
  preparePlatformModules({
    projectDirectory,
    outputPath: path.join(generatedDirectory, 'platform-modules.js')
  })
]);

console.log(`[cloudflare] 洛雪全局源: ${source.enabled ? `${source.name || '未命名源'} (${source.digest.slice(0, 12)})` : '未配置'}`);
console.log(`[cloudflare] 平台模块: ${moduleCount}`);
