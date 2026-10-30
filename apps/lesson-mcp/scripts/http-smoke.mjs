/** Synthetic API/CLI/standard-report smoke; no model or scientific execution. */
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const out = resolve(process.argv[2] ?? '.studium-session/int052-api');
await mkdir(out,{recursive:false});
const probe=createServer(); await new Promise(r=>probe.listen(0,'127.0.0.1',r));
const port=probe.address().port; await new Promise(r=>probe.close(r));
const env={...process.env,STUDIUM_API_TOKEN:randomBytes(32).toString('hex'),STUDIUM_API_PORT:String(port),STUDIUM_API_URL:`http://127.0.0.1:${port}`,BUNDLES_ROOT:resolve(root,'fixtures'),STUDIUM_API_LIVE:'0',STUDIUM_TELEMETRY_CONSENT:'',STUDIUM_DATA_DIR:''};
const tsx=resolve(root,'apps/lesson-mcp/node_modules/.bin/tsx');
const server=spawn(tsx,[resolve(root,'apps/lesson-mcp/src/http-entry.ts')],{cwd:root,env,stdio:['ignore','ignore','pipe']});
let launchError;server.on('error',error=>{launchError=error;});
let stderr='';server.stderr.on('data',d=>{stderr+=d;});
const report={scope:'Synthetic learner contributions; actual HTTP entry, independent CLI processes and standard export. No model/science/real learner.',checks:[]};
function check(name,value){assert.ok(value,name);report.checks.push(name);}
async function cli(operation,envelope){
 const args=[resolve(root,'apps/lesson-mcp/src/http-client.ts'),operation];
 if(envelope){const file=resolve(out,`${operation}.request.json`);await writeFile(file,JSON.stringify(envelope));args.push(file);}
 const result=await exec('pnpm',['--silent','--filter','@studium/lesson-mcp','api:call',...args.slice(1)],{cwd:root,env}); return JSON.parse(result.stdout);
}
try{
 let ready=false;
 for(let i=0;i<60;i++){
   if(launchError) throw launchError;
   try{ready=(await cli('health')).status==='ready';}catch{}
   if(ready)break;
   await new Promise(r=>setTimeout(r,100));
 }
 check('actual server starts and CLI authenticates',ready);
 const discovery=await cli('operations'); await writeFile(resolve(out,'operations.json'),JSON.stringify(discovery,null,2));
 check('schema discovery includes experiment and run APIs', ['record_experiment','submit_run_result'].every(n=>discovery.operations.some(o=>o.name===n)));
 const start={request_id:'synthetic-start',arguments:{bundle_ref:'capsule-judgment-demo/lesson.json',learner_id:'synthetic-http-smoke',presentation_language:'fr'}};
 const first=await cli('start_lesson_session',start);const session_id=first.session_id;
 check('retry returns same live session',(await cli('start_lesson_session',start)).session_id===session_id);
 const context=await cli('get_operator_context',{arguments:{session_id}});await writeFile(resolve(out,'operator-context.json'),JSON.stringify(context,null,2));
 check('new CLI process resumes public context',context.session_id===session_id&&context.scene.id===first.presentation.scene.id);
 const scene_id=context.scene.id;
 const inputs=[{kind:'predict',prediction:'Synthetic audit prediction, not a learner assessment.',justification:'Transport audit only.',confidence:2,consent:true,authorship:'learner'},
 {kind:'begin'}, {kind:'observe',text:'Synthetic observation; no scientific execution.',evidence_refs:[],consent:true,authorship:'learner'},
 {kind:'conclude',text:'Synthetic conclusion; verifies transport continuity only.',confidence:2,consent:true,authorship:'learner'}];
 for(const input of inputs){await cli('record_experiment',{request_id:`synthetic-${input.kind}`,expected_scene_id:scene_id,arguments:{session_id,scene_id,input:{...input,experiment_id:'synthetic-api'}}});}
 const journal=await cli('get_experiment_journal',{arguments:{session_id}});await writeFile(resolve(out,'journal.json'),JSON.stringify(journal,null,2));
 check('four ordered journal contributions survive client switches',journal.experiments[0].events.length===4);
 const answer={request_id:'synthetic-answer',expected_scene_id:scene_id,arguments:{session_id,input:{kind:'ack'}}};
 const a=await cli('submit_response',answer),b=await cli('submit_response',answer);
 check('response retry does not advance twice',JSON.stringify(a)===JSON.stringify(b));
 check('current scene advances on accepted response',(await cli('get_current_scene',{arguments:{session_id}})).presentation.scene.id!==scene_id);
 await cli('set_session_language',{request_id:'synthetic-language',arguments:{session_id,presentation_language:'en'}});
 check('language selection survives another client',(await cli('get_operator_context',{arguments:{session_id}})).language.selected_language==='en');
 const exported=await exec(resolve(root,'.venv/bin/python'),['tools/learner_report.py','export',resolve(out,'report'),'--journal',resolve(out,'journal.json')],{cwd:root,env});
 const verified=await exec(resolve(root,'.venv/bin/python'),['tools/learner_report.py','verify',resolve(out,'report')],{cwd:root,env});
 await writeFile(resolve(out,'export.log'),exported.stdout+verified.stdout);
 check('canonical ASTRA/ARA/MySTRA report exports and verifies',true);
 await cli('forget_session',{request_id:'synthetic-forget',arguments:{session_id}});
 let erased=false;try{await cli('start_lesson_session',start);}catch(error){erased=String(error.stderr).includes('410');}
 check('forget erases cached creation output',erased);
 report.passed=true;
}catch(error){report.passed=false;report.error=String(error);process.exitCode=1;}
finally{
 if(!launchError && server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}
 await writeFile(resolve(out,'server.log'),stderr);
 await writeFile(resolve(out,'audit.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
