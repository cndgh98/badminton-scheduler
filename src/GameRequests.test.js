import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemberGameRequests, AdminGameRequests } from './GameRequests';
import { backend } from './backend';
import { Game } from './OnlineApp';
jest.mock('./backend', () => ({ ...jest.requireActual('./backend'), backend: { rpc: jest.fn() } }));
const meeting = { id:'m1', title:'오늘 모임', location:'체육관', starts_at:new Date().toISOString(), game_state:{participants:['회원 · 12345678'],playerProfiles:{'회원 · 12345678':{user_id:'12345678-user',name:'회원',gender:'남성'}}},game_version:3 };
const request = { id:'request1',meeting_id:'m1',user_id:'12345678-user',kind:'rest',status:'pending' };
const memberProps = () => ({ meeting, requests:[],ready:true,busy:false,run:action=>action(),reload:jest.fn().mockResolvedValue(),userId:'12345678-user' });
beforeEach(()=>backend.rpc.mockReset());
test('attending member can send a rest or exclusion request without writing game state',async()=>{
 backend.rpc.mockResolvedValue({data:'request1',error:null});
 const props=memberProps();render(<MemberGameRequests {...props}/>);
 fireEvent.click(screen.getByRole('button',{name:'한 번 쉬기 요청'}));
 await waitFor(()=>expect(props.reload).toHaveBeenCalledTimes(1));
 expect(backend.rpc).toHaveBeenCalledWith('submit_game_request',{p_meeting:'m1',p_kind:'rest'});
 fireEvent.click(screen.getByRole('button',{name:'경기 제외 요청'}));
 await waitFor(()=>expect(props.reload).toHaveBeenCalledTimes(2));
 expect(backend.rpc).toHaveBeenLastCalledWith('submit_game_request',{p_meeting:'m1',p_kind:'exclude'});
});
test('pending requests disable duplicate submissions and can be cancelled',async()=>{
 backend.rpc.mockResolvedValue({data:null,error:null});const props=memberProps();
 render(<MemberGameRequests {...props} requests={[request]}/>);
 expect(screen.getByRole('button',{name:'한 번 쉬기 요청'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'경기 제외 요청'})).toBeDisabled();
 expect(screen.getByRole('status')).toHaveTextContent('운영자 확인 중');
 fireEvent.click(screen.getByRole('button',{name:'요청 취소'}));
 await waitFor(()=>expect(props.reload).toHaveBeenCalled());
 expect(backend.rpc).toHaveBeenCalledWith('cancel_game_request',{p_request:'request1'});
});
test('requests stay disabled before database setup or after game exclusion',()=>{
 const props=memberProps();const view=render(<MemberGameRequests {...props} ready={false}/>);
 expect(screen.getByRole('button',{name:'한 번 쉬기 요청'})).toBeDisabled();
 view.rerender(<MemberGameRequests {...props} meeting={{...meeting,game_state:{...meeting.game_state,excludedPlayers:['회원 · 12345678']}}}/>);
 expect(screen.getByRole('button',{name:'경기 제외 요청'})).toBeDisabled();
});
test('admin approval is deferred while a requester is still assigned to a court',()=>{
 render(<AdminGameRequests requests={[request]} roster={[{user_id:request.user_id,name:'회원'}]} state={{...meeting.game_state,participants:[],courts:[{id:1,team:['회원 · 12345678']}]}} busy={false} onReview={jest.fn()}/>);
 expect(screen.getByRole('button',{name:'승인'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'반려'})).toBeEnabled();
});
test('approval updates the running editor and version together without creating a second save',async()=>{
 backend.rpc.mockImplementation(async(method,args)=>({data:{version:4,game_state:{...args.p_state,restOnce:['회원 · 12345678']}},error:null}));
 const reload=jest.fn().mockResolvedValue();const reloadRequests=jest.fn().mockResolvedValue();
 render(<Game meeting={meeting} roster={[{user_id:request.user_id,name:'회원',gender:'남성',status:'confirmed'}]} requests={[request]} reloadRequests={reloadRequests} busy={false} run={action=>action()} reload={reload} close={jest.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'승인'}));
 await waitFor(()=>expect(reloadRequests).toHaveBeenCalledTimes(1));
 expect(backend.rpc).toHaveBeenCalledTimes(1);
 expect(backend.rpc).toHaveBeenCalledWith('review_game_request',expect.objectContaining({p_request:'request1',p_approve:true,p_version:3}));
 expect(await screen.findByRole('button',{name:'회원 한 번 쉬기'})).toHaveAttribute('aria-pressed','true');
 await waitFor(()=>expect(screen.getByRole('button',{name:'경기 저장'})).toBeDisabled());
});
