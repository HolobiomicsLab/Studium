/** Smoke the authored help on real web applications; uses no learner records. */
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const require=createRequire(new URL('../apps/teacher-dashboard/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const [teacher,author,student,outArg]=process.argv.slice(2);
if(!outArg)throw Error('Usage: node tools/audit-context-help-web.mjs TEACHER_URL AUTHOR_URL STUDENT_URL NEW_OUTPUT');
const out=resolve(outArg);await mkdir(out,{recursive:false});
const browser=await chromium.launch({channel:'chrome'}), page=await browser.newPage({viewport:{width:390,height:844}});
const result={checks:[],errors:[]};page.on('pageerror',e=>result.errors.push(String(e)));
const check=(name,pass)=>{result.checks.push({name,passed:!!pass});if(!pass)throw Error(name);};
try{
 for(const [name,url,topic] of [['teacher',teacher,'mastery'],['calibration',teacher+'/courses/context-help-demo/calibration','confidence'],['author',author,'review'],['student',student+'/consent','studium']]){
  await page.goto(url);const tip=page.locator(`[data-help-topic="${topic}"]`).first();await tip.locator(':scope > summary').click();
  check(name+' French help opens',await tip.getAttribute('open')!==null && (await tip.innerText()).includes('Objectif'));
  check(name+' inactive English hidden',!await tip.locator('[data-help-locale="en"]').last().isVisible());
  check(name+' no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:out+'/'+name+'.png',fullPage:true});
  await page.keyboard.press('Escape');check(name+' Escape works',await tip.getAttribute('open')===null);
 }
 check('no uncaught browser errors',result.errors.length===0);result.passed=true;
}catch(e){result.passed=false;result.failure=String(e);process.exitCode=1;}
finally{await writeFile(out+'/report.json',JSON.stringify(result,null,2)+'\n');await browser.close();}
console.log(JSON.stringify(result));
