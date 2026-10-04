import { build } from 'esbuild';
import { solidPlugin } from 'esbuild-plugin-solid';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', {recursive:true});
await build({entryPoints:['src/tui.tsx'], outfile:'dist/tui.js',bundle:true,format:'esm',platform:'node',target:'es2022',
  external:['@opencode-ai/plugin','@opencode-ai/sdk','@opentui/core','@opentui/solid','solid-js'],
  plugins:[solidPlugin({solid:{moduleName:'@opentui/solid',generate:'universal'}})]});
await build({entryPoints:['scripts/install.ts'], outfile:'dist/install.mjs',bundle:true,format:'esm',platform:'node',target:'es2022',alias:{'jsonc-parser':'jsonc-parser/lib/esm/main.js'}});
await build({entryPoints:['scripts/backups.ts'], outfile:'dist/backups.mjs',bundle:true,format:'esm',platform:'node',target:'es2022'});
for (const name of ['unlock','purge','offline-vault']) await build({entryPoints:[`scripts/${name}.ts`], outfile:`dist/${name}.mjs`,bundle:true,format:'esm',platform:'node',target:'es2022',external:['node:sqlite']});
await copyFile('scripts/maintenance-monitor.ps1', 'dist/maintenance-monitor.ps1');
