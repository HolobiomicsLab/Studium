import {afterEach,describe,expect,it,vi} from 'vitest';
import {callLessonApi} from './http-client.js';
afterEach(()=>{vi.unstubAllEnvs();});
describe('HTTP client destination controls',()=>{
  it('rejects a route that could redirect credentials outside the local API',async()=>{
    await expect(callLessonApi('https://example.com/')).rejects.toThrow('Invalid API route');
    await expect(callLessonApi('//example.com/')).rejects.toThrow('Invalid API route');
  });
  it.each(['https://localhost','http://example.com','http://user:password@localhost','http://localhost/private','http://localhost/?token=x'])(
    'rejects invalid configured origin %s',async base=>{
      vi.stubEnv('STUDIUM_API_URL',base);
      await expect(callLessonApi('/health')).rejects.toThrow('plain loopback HTTP origin');
    });
  it('explains missing client authentication without a request',async()=>{
    vi.stubEnv('STUDIUM_API_URL','http://127.0.0.1:8130');
    vi.stubEnv('STUDIUM_API_TOKEN','');
    await expect(callLessonApi('/health')).rejects.toThrow('Set STUDIUM_API_TOKEN');
  });
});
