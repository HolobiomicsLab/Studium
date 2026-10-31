import {afterEach,describe,expect,it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildServer} from './server.js';
import {writeMiniBundle,cleanupTmp,MINI_BUNDLE} from './test-support.js';

afterEach(cleanupTmp);
describe('legacy REST learner projections', () => {
  it('removes quiz answer keys on create and current-scene reads',async()=>{
    const {root,ref}=writeMiniBundle();
    writeFileSync(join(root,ref),JSON.stringify({...MINI_BUNDLE,scenes:MINI_BUNDLE.scenes.slice(1)}));
    const app=buildServer({bundlesRoot:root,live:false});
    try{
      const response=await app.inject({method:'POST',url:'/sessions',payload:{bundle_ref:ref}});
      const created=response.json();
      expect(created.presentation.scene.choices.every((c:Record<string,unknown>)=>!('correct' in c))).toBe(true);
      const current=await app.inject({method:'GET',url:`/sessions/${created.session_id}`});
      expect(current.json().presentation.scene.choices.every((c:Record<string,unknown>)=>!('correct' in c))).toBe(true);
    }finally{await app.close();}
  });
  it('removes answer keys from transitions without changing the scene contract',async()=>{
    const {root,ref}=writeMiniBundle();const app=buildServer({bundlesRoot:root,live:false});
    try{
      const response=await app.inject({method:'POST',url:'/sessions',payload:{bundle_ref:ref}});
      const next=await app.inject({method:'POST',url:`/sessions/${response.json().session_id}/respond`,payload:{input:{kind:'ack'}}});
      expect(next.json().transition.presentation.scene.id).toBe('s1');
      expect(next.json().transition.presentation.scene.choices.every((c:Record<string,unknown>)=>!('correct' in c))).toBe(true);
    }finally{await app.close();}
  });
  // LS-1 (production sprint): the HTTP host serves the same projection as the MCP host. The two tests
  // above only look at `choices[].correct`; this one walks the whole wire for every answer-bearing
  // field family, on every route that returns a scene.
  it('never puts feedback, hints, claims, key points or model_* answers on the wire, on any route', async () => {
    const base = {objective_refs:[],concept_refs:['c1'],estimated_seconds:0,adaptation_hooks:[]};
    const bundle = {
      ...MINI_BUNDLE,
      scenes: [
        {...base,id:'q0',type:'quiz',title:'Q',question:'?',
          choices:[{id:'a',text:'A',correct:false},{id:'b',text:'B',correct:true}],
          feedback_correct:'FB-OK-SECRET',feedback_incorrect:'FB-KO-SECRET',hints:['HINT-SECRET']},
        {...base,id:'f0',type:'spot_the_flaw',title:'F',flawed_content:'N is 1s2 2s2 2p4',
          claims:[{id:'k1',text:'CLAIM-SECRET',flaws_expected:['FLAW-SECRET']}],
          model_correction:'MODEL-CORRECTION-SECRET',rubric:{completeness:1,evidence_quality:1,tone:1}},
        {...base,id:'e0',type:'explain_back',title:'E',prompt:'Explain it',
          key_points:[{id:'k1',text:'KEYPOINT-SECRET',cues:['CUE-SECRET']}],
          model_explanation:'MODEL-EXPLANATION-SECRET',rubric:{completeness:1,evidence_quality:1,tone:1}},
      ],
    };
    const {root,ref}=writeMiniBundle();
    writeFileSync(join(root,ref),JSON.stringify(bundle));
    const app=buildServer({bundlesRoot:root,live:false});
    const secrets=['FB-OK-SECRET','FB-KO-SECRET','HINT-SECRET','CLAIM-SECRET','FLAW-SECRET','MODEL-CORRECTION-SECRET',
      'KEYPOINT-SECRET','CUE-SECRET','MODEL-EXPLANATION-SECRET'];
    const wires:string[]=[];
    const learnerWire=(body:string)=>{const j=JSON.parse(body);if(j.transition)delete j.transition.verdict;return JSON.stringify(j);};
    let verdictFeedback:unknown;
    try{
      const created=await app.inject({method:'POST',url:'/sessions',payload:{bundle_ref:ref}});
      wires.push(created.body);
      const sid=created.json().session_id;
      wires.push((await app.inject({method:'GET',url:`/sessions/${sid}`})).body);
      // quiz -> spot_the_flaw -> explain_back, reading each scene back from the current-scene route too.
      const t1=await app.inject({method:'POST',url:`/sessions/${sid}/respond`,payload:{input:{kind:'quiz_choice',choiceId:'b'}}});
      wires.push(learnerWire(t1.body));
      verdictFeedback=t1.json().transition.verdict.feedback;
      expect(t1.json().transition.presentation.scene.type).toBe('spot_the_flaw');
      wires.push((await app.inject({method:'GET',url:`/sessions/${sid}`})).body);
      const t2=await app.inject({method:'POST',url:`/sessions/${sid}/respond`,payload:{input:{kind:'flaw_report',text:'the 2p filling violates hund'}}});
      wires.push(learnerWire(t2.body));
      expect(t2.json().transition.presentation.scene.type).toBe('explain_back');
      wires.push((await app.inject({method:'GET',url:`/sessions/${sid}`})).body);
      // the attemptable text is still there
      expect(wires[2]).toContain('N is 1s2 2s2 2p4');
      expect(wires[4]).toContain('Explain it');
    }finally{await app.close();}
    // The `verdict` on a transition is the EARNED feedback for the scene just answered (it carries
    // `correct` and the matching feedback text by design); everything else on the wire is the learner
    // projection and must stay clean.
    expect(verdictFeedback).toBe('FB-KO-SECRET');
    for (const wire of wires) {
      for (const secret of secrets) expect(wire).not.toContain(secret);
      for (const field of ['"correct"','"claims"','"key_points"','"hints"','"feedback_correct"','"feedback_incorrect"','"model_correction"','"model_explanation"'])
        expect(wire).not.toContain(field);
    }
  });
});
