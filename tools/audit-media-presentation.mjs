/** Check real local media decoding and source-before-prediction in Chrome. */
import {createRequire} from 'node:module';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const require = createRequire(new URL('../apps/teacher-dashboard/package.json', import.meta.url));
const {chromium} = require('@playwright/test');
const [activityArg, outputArg] = process.argv.slice(2);
if (!activityArg || !outputArg) throw Error('Usage: node tools/audit-media-presentation.mjs ACTIVITY NEW_AUDIT_DIR');
const activity = resolve(activityArg), output = resolve(outputArg);
await mkdir(output, {recursive:false});
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage({viewport:{width:1280,height:950}});
const report = {checks:[], errors:[], requests:[], fixture:'Museum photograph plus synthetic tone/colour clip; no AI generation.'};
const check = (name, passed) => {report.checks.push({name,passed:!!passed}); if (!passed) throw Error(name);};
page.on('pageerror', error => report.errors.push(String(error)));
page.on('request', request => {if (/^https?:/.test(request.url())) report.requests.push(request.url());});
try {
  await page.goto(pathToFileURL(activity+'/index.html').href);
  await page.waitForFunction(() => document.querySelector('#introAssets img')?.naturalWidth > 0);
  check('primary photograph visible before prediction', await page.locator('#introAssets img').isVisible());
  check('source rights inspectable', /CC0/.test(await page.locator('#introAssets').innerText()));
  check('candidate claims and explanations hidden before prediction', !await page.locator('#result').isVisible() && !await page.locator('#visualSupport').isVisible());
  check('no automatic playback or preload', await page.locator('audio,video').evaluateAll(players => players.length === 2 && players.every(p => p.controls && p.paused && !p.autoplay && p.preload === 'none')));
  check('transcripts available before playback', await page.locator('#introAssets .scientific-support__transcript').count() === 2);
  const decoded = await page.locator('audio,video').evaluateAll(async players => Promise.all(players.map(player => new Promise(resolve => {
    const timer = setTimeout(() => resolve({kind:player.localName,error:'metadata timeout'}), 10000);
    player.addEventListener('loadedmetadata', () => {clearTimeout(timer); resolve({kind:player.localName,duration:player.duration,width:player.videoWidth});}, {once:true});
    player.addEventListener('error', () => {clearTimeout(timer); resolve({kind:player.localName,error:player.error?.message});}, {once:true});
    player.load();
  }))));
  report.decoded = decoded;
  check('audio and video actually decode', decoded.length === 2 && decoded.every(p => p.duration > 0 && !p.error) && decoded.find(p => p.kind === 'video').width > 0);
  await page.waitForFunction(() => document.querySelector('video track')?.readyState === 2);
  check('WebVTT cues actually loaded', await page.locator('video').evaluate(p => p.textTracks[0]?.cues?.length > 0));
  const playback = await page.locator('audio,video').evaluateAll(async players => Promise.all(players.map(async player => {
    player.muted = true;
    await player.play();
    await new Promise(resolve => player.addEventListener('timeupdate', resolve, {once:true}));
    player.pause();
    return player.currentTime > 0;
  })));
  check('explicit playback advances both players', playback.every(Boolean));
  await page.locator('#noTrace').click();
  await page.locator('#prediction').fill('I can observe features; use and date require attributed evidence.');
  await page.locator('#reveal').click();
  await page.locator('#visualSupport summary').click();
  await page.waitForSelector('#supportAssets .scientific-support__download');
  const expectedPrompts = await page.evaluate(() => PRESENTATION.render_assets.filter(a => a.kind === 'protocol_md').map(a => a.payload));
  for (let index=0; index<expectedPrompts.length; index+=1) {
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.scientific-support__download').nth(index).click();
    const download = await downloadPromise;
    const saved = output+'/prompt-'+index+'.txt';
    await download.saveAs(saved);
    check('prompt '+index+' downloaded as text', download.suggestedFilename().endsWith('.txt') && await readFile(saved,'utf8') === expectedPrompts[index]);
  }
  const generated = await page.evaluate(async () => {
    const box=document.createElement('div'); box.id='generatedNoticeAudit'; document.querySelector('main').append(box);
    const asset=structuredClone(PRESENTATION.render_assets.find(a => a.kind === 'video'));
    asset.meta.origin='generated'; asset.provenance='Synthetic browser notice test: no model was called.';
    await window.StudiumSupport.render(box,[asset]);
    const text=box.querySelector('.scientific-support__notice')?.textContent || '';
    const notice=/AI-generated video/.test(text) && /inaccurate/.test(text);
    box.remove(); return notice;
  });
  check('generated video notice immutable', generated);
  await page.locator('#activityLanguage').selectOption('fr');
  check('language switch preserves learner words', await page.locator('#prediction').inputValue() === 'I can observe features; use and date require attributed evidence.');
  check('observation heading translated', await page.locator('#introSupportTitle').innerText() === 'Documents à observer');
  await page.locator('#introSupport').screenshot({path:output+'/media.png'});
  await page.setViewportSize({width:390,height:844});
  check('mobile no horizontal page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
  await page.screenshot({path:output+'/mobile.png',fullPage:true});
  check('no remote media or provider requests', report.requests.length === 0);
  check('no browser errors', report.errors.length === 0);
  report.passed=true;
} finally {
  await writeFile(output+'/report.json',JSON.stringify(report,null,2)+'\n');
  await browser.close();
}
console.log(JSON.stringify(report));
