import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {hostModuleShimSource, HOST_NAMESPACE_SOURCE, sharedTreeShakingPlugin} from './esbuild-host-plugins.mjs';

export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
// A developer may supply an installed Engine for build tools; release builds install this package's pinned dependencies.
const engine=process.env.MARINARA_ENGINE_ROOT;
const toolRequire=engine ? createRequire(path.join(path.resolve(engine),'package.json')) : require;
export const esbuild=toolRequire('esbuild');
const out=path.join(root,'dist/package');
const buildRoot=path.join(root,'dist/build-source');
await fs.mkdir(buildRoot,{recursive:true});
await fs.cp(path.join(root,'src/host-client-overlay'),buildRoot,{recursive:true});
await fs.cp(path.join(root,'src/engine'),buildRoot,{recursive:true});
const nodePaths=engine ? ['node_modules','packages/client/node_modules','packages/server/node_modules','packages/shared/node_modules'].map(p=>path.join(path.resolve(engine),p)) : [path.join(root,'node_modules')];
const shared=path.join(root,'src/shared/index.js');
const tree=()=>sharedTreeShakingPlugin({roots:[path.dirname(shared)]});
const common={bundle:true,minify:true,metafile:true,nodePaths,alias:{'@marinara-engine/shared':shared}};
const entries={client:await fs.readFile(path.join(root,'src/client-entry.tsx'),'utf8'),server:await fs.readFile(path.join(root,'src/server-entry.ts'),'utf8')};
for(const name of Object.keys(entries)) entries[name]=entries[name].replaceAll('./engine/', buildRoot.split(path.sep).join('/')+'/');
await fs.mkdir(out,{recursive:true});
const exports=JSON.parse(await fs.readFile(path.join(root,'scripts/host-module-exports.json'),'utf8'));
const host={name:'pinned-engine-host',setup(build){
 build.onResolve({filter:/^marinara:host$/},()=>({path:'host',namespace:'host'}));
 build.onLoad({filter:/.*/,namespace:'host'},()=>({contents:HOST_NAMESPACE_SOURCE,loader:'js'}));
 build.onResolve({filter:/.*/},args=>Object.hasOwn(exports,args.path)?{path:args.path,namespace:'host-module'}:undefined);
 build.onLoad({filter:/.*/,namespace:'host-module'},args=>({contents:hostModuleShimSource(args.path,exports[args.path]),loader:'js'}));
}};
const client=await esbuild.build({...common,stdin:{contents:entries.client,resolveDir:path.join(root,'src'),loader:'tsx'},platform:'browser',format:'esm',target:'es2020',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false','import.meta.env.PROD':'true','import.meta.env.MODE':'"production"'},plugins:[host,tree()],outfile:path.join(out,'client.js')});
const server=await esbuild.build({...common,stdin:{contents:entries.server,resolveDir:path.join(root,'src'),loader:'ts'},platform:'node',format:'esm',target:'node22',external:['nanoid','zod','jsonrepair'],banner:{js:"import {createRequire as __createRequire} from 'node:module'; const require=__createRequire(import.meta.url);"},plugins:[tree()],outfile:path.join(out,'server.mjs')});
await fs.writeFile(path.join(root,'dist/metafile.json'),JSON.stringify({client:client.metafile,server:server.metafile},null,2));
for(const name of ['manifest.json','agents.json','locales','LICENSE','README.md','THIRD-PARTY.md','CHANGELOG.md']) await fs.cp(path.join(root,name),path.join(out,name),{recursive:true});
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
console.log(`Prepared ${manifest.name} ${manifest.version}; catalog workflow owns publishing, hashes and ZIPs.`);
