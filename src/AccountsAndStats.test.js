import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
 backend.rpc.mockResolvedValue({data:true,error:null});registerAccount.mockResolvedValue({data:{user:null,session:null},error:null,approvalPending:true});
 render(<Auth run={run} busy={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'처음 오셨나요? 회원가입'}));
 fireEvent.change(screen.getByLabelText('이름'),{target:{value:'새회원'}});
 fireEvent.change(screen.getByLabelText('아이디'),{target:{value:'newuser'}});
 fireEvent.change(screen.getByLabelText('비밀번호'),{target:{value:'password123'}});
 fireEvent.click(screen.getByRole('button',{name:'가입하기'}));
 expect(await screen.findByText(/가입 신청이 완료됐습니다/)).toBeInTheDocument();
 expect(registerAccount).toHaveBeenCalled();expect(backend.auth.signInWithPassword).not.toHaveBeenCalled();
});


test('statistics support selecting a month and navigating across the year boundary',async()=>{
 backend.rpc.mockResolvedValue({data:[],error:null});
 render(<AttendanceStatistics userId="me"/>);
 const picker=screen.getByLabelText('조회 월');
 const current=picker.value;
 fireEvent.change(picker,{target:{value:'2025-12'}});
 await waitFor(()=>expect(backend.rpc).toHaveBeenLastCalledWith('monthly_attendance_ranking',{p_month:'2025-12-01'}));
 expect(screen.getByRole('heading',{name:'2025년 12월 참석 랭킹'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'다음 달 통계'}));
 await waitFor(()=>expect(backend.rpc).toHaveBeenLastCalledWith('monthly_attendance_ranking',{p_month:'2026-01-01'}));
 fireEvent.click(screen.getByRole('button',{name:'이전 달 통계'}));
 await waitFor(()=>expect(picker.value).toBe('2025-12'));
 fireEvent.click(screen.getByRole('button',{name:'이번 달'}));
 await waitFor(()=>expect(backend.rpc).toHaveBeenLastCalledWith('monthly_attendance_ranking',{p_month:`${current}-01`}));
 expect(screen.getByRole('button',{name:'다음 달 통계'})).toBeDisabled();
});

test('a late response from an older month cannot overwrite the selected months rankings',async()=>{
 let resolveOlder,resolveSelected;
 backend.rpc.mockResolvedValueOnce({data:[{rank:1,user_id:'me',name:'현재회원',attendance_count:3}],error:null})
 .mockImplementationOnce(()=>new Promise(resolve=>{resolveOlder=resolve;}))
 .mockImplementationOnce(()=>new Promise(resolve=>{resolveSelected=resolve;}));
 render(<AttendanceStatistics userId="me"/>);
 expect(await screen.findByText('현재회원')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('조회 월'),{target:{value:'2025-12'}});
 expect(screen.queryByText('현재회원')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('조회 월'),{target:{value:'2025-11'}});
 await act(async()=>resolveSelected({data:[{rank:1,user_id:'me',name:'선택월회원',attendance_count:2}],error:null}));
 expect(screen.getByText('2회')).toBeInTheDocument();
 await act(async()=>resolveOlder({data:[{rank:1,user_id:'me',name:'이전월회원',attendance_count:8}],error:null}));
 expect(screen.getByText('선택월회원')).toBeInTheDocument();
 expect(screen.queryByText('이전월회원')).not.toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'2025년 11월 참석 랭킹'})).toBeInTheDocument();
});


test('duplicate signup remains a failure with guidance instead of a false completion message',async()=>{
 backend.rpc.mockResolvedValue({data:true,error:null});
 registerAccount.mockResolvedValue({data:{user:null,session:null},error:{code:'user_already_exists',message:'User already registered'}});
 const errors=[];
 render(<Auth run={action=>action().catch(error=>errors.push(error.message))} busy={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'처음 오셨나요? 회원가입'}));
 fireEvent.change(screen.getByLabelText('이름'),{target:{value:'새회원'}});
 fireEvent.change(screen.getByLabelText('아이디'),{target:{value:'newuser'}});
 fireEvent.change(screen.getByLabelText('비밀번호'),{target:{value:'password123'}});
 fireEvent.click(screen.getByRole('button',{name:'가입하기'}));
 await waitFor(()=>expect(errors[0]).toMatch(/이미 사용 중인 아이디/));
 expect(screen.queryByText(/가입 신청이 완료됐습니다/)).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'가입하기'})).toBeInTheDocument();
});

test('approval denial during ordinary login still blocks access and never reports signup success',async()=>{
 backend.auth.signInWithPassword.mockResolvedValue({data:{session:null},error:{status:403,message:'관리자 승인 대기 중이거나 삭제된 계정입니다.'}});
 const errors=[];
 render(<Auth run={action=>action().catch(error=>errors.push(error.message))} busy={false}/>);
 fireEvent.change(screen.getByLabelText('아이디'),{target:{value:'newuser'}});
 fireEvent.change(screen.getByLabelText('비밀번호'),{target:{value:'password123'}});
 fireEvent.click(screen.getByRole('button',{name:'로그인'}));
 await waitFor(()=>expect(errors).toEqual(['관리자 승인 대기 중이거나 삭제된 계정입니다.']));
 expect(registerAccount).not.toHaveBeenCalled();
 expect(screen.queryByText(/가입 신청이 완료됐습니다/)).not.toBeInTheDocument();
});
