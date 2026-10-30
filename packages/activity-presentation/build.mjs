/** Bundle local renderers and inline licensed KaTeX fonts for portable HTML. */
import {build} from 'esbuild';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
const require = createRequire(import.meta.url);
const katexRoot = dirname(require.resolve('katex/package.json'));
let css = await readFile(join(katexRoot, 'dist/katex.min.css'), 'utf8');
const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(match => match[1]);
for (const url of urls) {
  const extension = url.split('.').at(-1);
  const data = await readFile(join(katexRoot, 'dist', url));
  css = css.replaceAll(`url(${url})`, `url(data:font/${extension};base64,${data.toString('base64')})`);
}
css += await readFile(new URL('../../ui/scientific-support.css', import.meta.url), 'utf8');
await mkdir(new URL('./dist/', import.meta.url), {recursive:true});
const bundled = await build({entryPoints:[new URL('./entry.mjs', import.meta.url).pathname],bundle:true,write:false,
  format:'iife',platform:'browser',minify:true,target:'es2020',legalComments:'inline',
  define:{STUDIUM_MATH_CSS:JSON.stringify(css)}});
const licenses = await Promise.all([
  ['katex', 'LICENSE'], ['mermaid', 'LICENSE'], ['smiles-drawer', 'LICENSE.md'],
].map(async ([name, file]) => {
  return `\n${name}\n${await readFile(new URL(`./node_modules/${name}/${file}`, import.meta.url), 'utf8')}`;
}));
const notice = `/*! Local renderer licenses\n${licenses.join('\n').replaceAll('*/', '* /')}\n*/\n`;
await writeFile(new URL('./dist/support.js', import.meta.url), notice + bundled.outputFiles[0].text);
console.log(`Local scientific renderers: ${bundled.outputFiles[0].contents.length} bytes`);
