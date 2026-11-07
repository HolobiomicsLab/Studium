/** Inspect the real bundled help with the extension's graph and scene renderer. */
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {resolve} from 'node:path';
const require=createRequire(new URL('../apps/studium-vscode/package.json',import.meta.url));
const {buildSync}=require('esbuild');
const browserRequire=createRequire(new URL('../apps/teacher-dashboard/package.json',import.meta.url));
const {chromium}=browserRequire('@playwright/test');
const [outArg]=process.argv.slice(2);if(!outArg)throw Error('Usage: node tools/audit-context-help-vscode.mjs NEW_OUTPUT');
const out=resolve(outArg);await mkdir(out,{recursive:false});
const build=buildSync({entryPoints:['apps/studium-vscode/src/contextual-help.ts'],bundle:true,write:false,platform:'node',format:'cjs',loader:{'.css':'text'}});
const module={exports:{}};runInNewContext(build.outputFiles[0].text,{module,exports:module.exports});const help=module.exports;
const css=await readFile('apps/lesson-panel-ui/src/graph-pane.css','utf8');
const pageHTML=`<!doctype html><html lang="fr"><head><style>${help.helpStyles}\n${css}</style></head><body>${help.graphHelp()}<div id="graph" style="background:#eef4f2">Graph canvas layout fixture</div><div id="legend">Synthetic layout check</div></body></html>`;
await writeFile(out+'/graph.html',pageHTML);
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:390,height:844}});
const result={checks:[],scope:'Production graph CSS and compiled helper; no VS Code Extension Host or graph data.'};
const check=(name,passed)=>{result.checks.push({name,passed:!!passed});if(!passed)throw Error(name);};
try{
 await page.setContent(pageHTML);const tip=page.locator('.studium-help');
 await tip.locator(':scope > summary').click();check('graph does not intercept help click',await tip.getAttribute('open')!==null);
 check('French graph explanation visible',(await tip.innerText()).includes('Variantes explorées'));
 check('no mobile overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:out+'/graph-help.png',fullPage:true});
 await tip.locator(':scope > summary').click();check('graph help dismisses',await tip.getAttribute('open')===null);
 const pane=await readFile('apps/lesson-panel-ui/src/artifact-pane.js','utf8');
 await page.setContent(`<html lang="fr"><head><style>${help.helpStyles}</style></head><body>${help.lessonHelpTemplates()}<div id="pane"></div></body></html>`);
 await page.addScriptTag({content:pane});await page.evaluate(()=>window.__render({scene:{type:'meta_checkpoint',title:'Synthetic confidence scene'},scene_assets:[]}));
 await page.locator('#pane .studium-help > summary').click();
 check('actual pane renders method help',(await page.locator('#pane .studium-help').innerText()).includes('Confiance'));
 result.passed=true;
}catch(e){result.passed=false;result.failure=String(e);process.exitCode=1;}
finally{await writeFile(out+'/report.json',JSON.stringify(result,null,2)+'\n');await browser.close();}
console.log(JSON.stringify(result));
