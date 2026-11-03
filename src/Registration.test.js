import { createClient } from '@supabase/supabase-js';
import { registerAccount } from './backend';
jest.mock('@supabase/supabase-js',()=>({createClient:jest.fn()}));
const details={email:'newuser@members.invalid',password:'test-password',options:{data:{username:'newuser',name:'신규회원',gender:'남성'}}};
let auth;
beforeEach(()=>{auth={signUp:jest.fn(),signOut:jest.fn().mockResolvedValue({error:null})};createClient.mockReturnValue({auth});});
test('approval rejection of the automatic signup token is reported as registered and pending',async()=>{
 auth.signUp.mockResolvedValue({data:{user:null,session:null},error:{status:403,message:'관리자 승인 대기 중이거나 삭제된 계정입니다.'}});
 const result=await registerAccount(details);
 expect(result.error).toBeNull();expect(result.approvalPending).toBe(true);
 expect(result.data.session).toBeNull();expect(auth.signOut).not.toHaveBeenCalled();
});
test.each([
 {status:422,code:'weak_password',message:'Password is too weak'},
 {status:422,code:'user_already_exists',message:'User already registered'},
 {status:500,message:'Error running hook'},
 {status:403,message:'Signup is not permitted'},
])('real signup failures are preserved: $message',async error=>{
 auth.signUp.mockResolvedValue({data:{user:null,session:null},error});
 expect((await registerAccount(details)).error).toBe(error);
});
test('normal signup uses an isolated session and signs it out locally',async()=>{
 const result={data:{user:{id:'created'},session:{access_token:'temporary'}},error:null};
 auth.signUp.mockResolvedValue(result);
 expect(await registerAccount(details)).toBe(result);
 expect(createClient.mock.calls.at(-1)[2]).toEqual(expect.objectContaining({auth:expect.objectContaining({persistSession:false,autoRefreshToken:false})}));
 expect(auth.signOut).toHaveBeenCalledWith({scope:'local'});
});
test('temporary-client cleanup cannot mask a successful registration',async()=>{
 const result={data:{user:{id:'created'},session:{}},error:null};
 auth.signUp.mockResolvedValue(result);auth.signOut.mockRejectedValue(new Error('network unavailable'));
 expect(await registerAccount(details)).toBe(result);
});
