import {afterEach,expect,it,vi} from 'vitest';
import {requireFirebaseAuth} from '../api/_firebaseAuth.js';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('requests the trusted verification claim for publication while preserving other API callers',async()=>{
  vi.stubEnv('FIREBASE_WEB_API_KEY','synthetic-not-a-secret');
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({users:[{localId:'synthetic',email:'owner@example.test',emailVerified:false}]})})));
  const req={headers:{authorization:'Bearer synthetic-token'}};const res={status:vi.fn(),json:vi.fn()};
  expect(await requireFirebaseAuth(req,res)).toEqual({uid:'synthetic',email:'owner@example.test'});
  expect(await requireFirebaseAuth(req,res,{includeVerification:true})).toEqual({uid:'synthetic',email:'owner@example.test',emailVerified:false});
});
