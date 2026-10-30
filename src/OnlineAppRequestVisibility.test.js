import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OnlineApp from './OnlineApp';
import { backend } from './backend';
jest.mock('./backend', () => ({ ...jest.requireActual('./backend'), backend: { auth: { getSession:jest.fn(),onAuthStateChange:jest.fn() },from:jest.fn(),rpc:jest.fn() } }));
const userId='12345678-user';
function setup(role='member', attendanceStatus='confirmed') {
  const meeting={id:'m1',title:'테스트 모임',location:'체육관',starts_at:new Date().toISOString(),capacity:20,game_state:{courts:[{id:1,name:'코트 1',team:['회원 · 12345678']}],playerProfiles:{'회원 · 12345678':{name:'회원',user_id:userId}}}};
  backend.auth.getSession.mockResolvedValue({data:{session:{user:{id:userId}}}});
  backend.auth.onAuthStateChange.mockReturnValue({data:{subscription:{unsubscribe:jest.fn()}}});
  backend.rpc.mockResolvedValue({data:[],error:null});
  backend.from.mockImplementation(table=>({select:()=>{
    if(table==='profiles')return {eq:()=>({single:async()=>({data:{id:userId,name:'회원',role},error:null})})};
    if(table==='meetings')return {order:async()=>({data:[meeting],error:null})};
    if(table==='attendance')return Promise.resolve({data:attendanceStatus?[{meeting_id:'m1',user_id:userId,status:attendanceStatus}]:[],error:null});
    if(table==='game_requests')return {eq:()=>({order:async()=>({data:[],error:null})})};
    throw new Error(table);
  }}));
  render(<OnlineApp/>);
}
async function openMeeting() { const button = await screen.findByRole('button',{name:/테스트 모임/}); await act(async () => { fireEvent.click(button); }); }
test('request buttons remain visible and enabled for confirmed members while their court is running',async()=>{
 setup();await openMeeting();
 await waitFor(()=>expect(screen.getByRole('button',{name:'한 번 쉬기 요청'})).toBeEnabled());
 expect(screen.getByRole('button',{name:'경기 제외 요청'})).toBeEnabled();
 expect(screen.getByText('코트 1')).toBeInTheDocument();
});
test('an attending admin also sees their own request buttons in the game viewing screen',async()=>{
 setup('admin');await openMeeting();
 await waitFor(()=>expect(screen.getByRole('button',{name:'한 번 쉬기 요청'})).toBeEnabled());
 expect(screen.getByRole('button',{name:'경기 제외 요청'})).toBeEnabled();
});
test('missing attendance shows visible request buttons and an explanation instead of hiding them',async()=>{
 setup('member',null);await openMeeting();
 await waitFor(()=>expect(screen.getByText(/이 계정의 모임 참석이 확정되지 않았습니다/)).toBeInTheDocument());
 expect(screen.getByRole('button',{name:'한 번 쉬기 요청'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'경기 제외 요청'})).toBeDisabled();
});
