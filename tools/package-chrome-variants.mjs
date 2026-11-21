import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const target = process.argv[2] || 'both';
const variants = target === 'both' ? ['personal', 'store'] : [target];
if (variants.some(variant => !['personal', 'store'].includes(variant))) {
  throw new Error('用法：npm run zip[:personal|:store]');
}

const outputDir = join(root, '.output');
const releaseDir = join(outputDir, 'releases');
mkdirSync(releaseDir, { recursive: true });

for (const variant of variants) {
  const env = { ...process.env };
  const npmCli = process.env.npm_execpath;
  const command = npmCli
    ? { executable: process.execPath, args: [npmCli, 'run', 'zip:raw'] }
    : { executable: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'zip:raw'] };
  const result = spawnSync(command.executable, command.args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: !npmCli && process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);

  const source = join(root, '.output', `poe2ultra-${version}-chrome.zip`);
  if (!existsSync(source)) throw new Error(`找不到 WXT 打包产物：${source}`);
  const destination = join(releaseDir, `poe2ultra-${version}-chrome-${variant}.zip`);
  copyFileSync(source, destination);

  const unpackedSource = join(outputDir, 'chrome-mv3');
  const manifestPath = join(unpackedSource, 'manifest.json');
  const optionsPath = join(unpackedSource, 'options.html');
  if (!existsSync(manifestPath) || !existsSync(optionsPath)) throw new Error(`WXT 未生成完整的未打包扩展目录：${unpackedSource}`);
  const optionsHtml = readFileSync(optionsPath, 'utf8');
  const hasCsvExport = optionsHtml.includes('btn-translations-csv-export');
  if (!hasCsvExport) throw new Error(`${variant} 版本缺少 CSV 导出按钮，未复制未打包目录。`);

  const unpackedDestination = join(releaseDir, `poe2ultra-${version}-chrome-${variant}-unpacked`);
  const safeReleaseDir = resolve(releaseDir) + sep;
  const safeUnpackedDestination = resolve(unpackedDestination);
  if (!safeUnpackedDestination.startsWith(safeReleaseDir)) throw new Error('未打包扩展输出路径超出 releases 目录。');
  rmSync(safeUnpackedDestination, { recursive: true, force: true });
  cpSync(unpackedSource, safeUnpackedDestination, { recursive: true });

  console.log(`已生成 ${variant === 'store' ? 'Chrome 商店版' : '自用版'} zip：${destination}`);
  console.log(`已生成 ${variant === 'store' ? 'Chrome 商店版' : '自用版'}未打包文件夹：${unpackedDestination}`);
}
