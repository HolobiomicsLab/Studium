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
});
