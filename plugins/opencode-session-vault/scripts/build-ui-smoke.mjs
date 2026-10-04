import {build} from 'esbuild';
import {solidPlugin} from 'esbuild-plugin-solid';
await build({entryPoints:['scripts/ui-smoke.tsx'],outfile:'scripts/ui-smoke.mjs',bundle:true,format:'esm',platform:'node',target:'esnext',packages:'external',plugins:[solidPlugin({solid:{moduleName:'@opentui/solid',generate:'universal'}})]});
