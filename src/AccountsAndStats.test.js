import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AccountManagement, AttendanceStatistics } from './AccountsAndStats';
import { Auth } from './OnlineApp';
import { backend, registerAccount } from './backend';
jest.mock('./backend',()=>({...jest.requireActual('./backend'),backend:{from:jest.fn(),rpc:jest.fn(),auth:{signInWithPassword:jest.fn()}},registerAccount:jest.fn()}));
const accounts=[{id:'admin',name:'운영자',username:'owner',gender:'남성',role:'admin',status:'approved'},
{id:'pending',name:'신규회원',username:'newuser',gender:'여성',role:'member',status:'pending'},
{id:'member',name:'일반회원',username:'player',gender:'남성',role:'member',status:'approved'}];
const run=action=>action();
beforeEach(()=>{jest.clearAllMocks();backend.from.mockReturnValue({select:()=>({order:async()=>({data:accounts,error:null})})});backend.rpc.mockResolvedValue({data:null,error:null});});
test('admins can approve a pending user and promote an approved member',async()=>{
 render(<AccountManagement currentUserId="admin" run={run} busy={false}/>);
 fireEvent.click(await screen.findByRole('button',{name:'가입 승인'}));
 await waitFor(()=>expect(backend.rpc).toHaveBeenCalledWith('admin_update_account',{p_user:'pending',p_action:'approve'}));
 fireEvent.click(screen.getByRole('button',{name:'관리자로 변경'}));
 await waitFor(()=>expect(backend.rpc).toHaveBeenCalledWith('admin_update_account',{p_user:'member',p_action:'make_admin'}));
});
test('account deletion requires the exact named confirmation and cancellation does not delete',async()=>{
 const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);
 render(<AccountManagement currentUserId="admin" run={run} busy={false}/>);
 const member=await screen.findByText('일반회원');const row=member.closest('article');
 fireEvent.click(within(row).getByRole('button',{name:'삭제'}));
 expect(confirm).toHaveBeenCalledWith('일반회원 을 삭제하시겠습니까?');
 expect(backend.rpc).not.toHaveBeenCalled();
 confirm.mockReturnValue(true);fireEvent.click(within(row).getByRole('button',{name:'삭제'}));
 await waitFor(()=>expect(backend.rpc).toHaveBeenCalledWith('admin_delete_account',{p_user:'member'}));
 const own=screen.getByText('운영자').closest('article');
 expect(within(own).getByRole('button',{name:'삭제'})).toBeDisabled();confirm.mockRestore();
});
test('monthly statistics show tied rankings and the current members count',async()=>{
 backend.rpc.mockResolvedValue({data:[{rank:1,user_id:'a',name:'회원가',attendance_count:3},{rank:1,user_id:'me',name:'회원나',attendance_count:3}],error:null});
 render(<AttendanceStatistics userId="me"/>);
 expect(await screen.findByText('회원나')).toBeInTheDocument();
 expect(screen.getByText('3회')).toBeInTheDocument();
 expect(screen.getAllByText('1')).toHaveLength(2);
 expect(backend.rpc).toHaveBeenCalledWith('monthly_attendance_ranking',expect.objectContaining({p_month:expect.stringMatching(/^\d{4}-\d{2}-01$/)}));
});
test('signup requests approval without logging into the main application',async()=>{
 backend.rpc.mockResolvedValue({data:true,error:null});registerAccount.mockResolvedValue({data:{user:{id:'new'}},error:null});
 render(<Auth run={run} busy={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'처음 오셨나요? 회원가입'}));
 fireEvent.change(screen.getByLabelText('이름'),{target:{value:'새회원'}});
 fireEvent.change(screen.getByLabelText('아이디'),{target:{value:'newuser'}});
 fireEvent.change(screen.getByLabelText('비밀번호'),{target:{value:'password123'}});
 fireEvent.click(screen.getByRole('button',{name:'가입하기'}));
 expect(await screen.findByText(/가입 신청이 완료됐습니다/)).toBeInTheDocument();
 expect(registerAccount).toHaveBeenCalled();expect(backend.auth.signInWithPassword).not.toHaveBeenCalled();
});
