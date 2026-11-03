import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GuestAttendance from './GuestAttendance';
import { backend } from './backend';
jest.mock('./backend',()=>({...jest.requireActual('./backend'),backend:{rpc:jest.fn()}}));
const host={id:'host-id',name:'김회원'};
const meeting={id:'m1',starts_at:new Date(Date.now()+3600000).toISOString()};
const attendance=[{user_id:host.id,status:'confirmed'},{user_id:host.id,participant_id:'guest1',guest_number:1,status:'confirmed'},{user_id:host.id,participant_id:'guest2',guest_number:2,status:'waiting'}];
const props=()=>({host,meeting,attendance,roster:[{user_id:'someone',status:'waiting'},{user_id:'guest2',status:'waiting'}],ready:true,busy:false,run:action=>action(),reload:jest.fn().mockResolvedValue()});
beforeEach(()=>backend.rpc.mockResolvedValue({data:null,error:null}));
test('host can add a guest and see numbered names and the shared waiting position',async()=>{
 const p=props();render(<GuestAttendance {...p}/>);
 expect(screen.getByText('김회원-G1')).toBeInTheDocument();
 expect(screen.getByText('김회원-G2')).toBeInTheDocument();
 expect(screen.getByText('모임 대기 2번')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'게스트 추가 +'}));
 await waitFor(()=>expect(p.reload).toHaveBeenCalled());
 expect(backend.rpc).toHaveBeenCalledWith('reserve_guest',{p_meeting:'m1',p_guest:null,p_cancel:false});
});
test('host can cancel a particular guest reservation',async()=>{
 const p=props();render(<GuestAttendance {...p}/>);
 fireEvent.click(screen.getByRole('button',{name:'김회원-G1 참석 취소'}));
 await waitFor(()=>expect(p.reload).toHaveBeenCalled());
 expect(backend.rpc).toHaveBeenCalledWith('reserve_guest',{p_meeting:'m1',p_guest:'guest1',p_cancel:true});
});
test('adding guests requires a host attendance record and database readiness',()=>{
 const p=props();const view=render(<GuestAttendance {...p} attendance={[]}/>);
 expect(screen.getByRole('button',{name:'게스트 추가 +'})).toBeDisabled();
 expect(screen.getByText(/본인 참석 신청 후/)).toBeInTheDocument();
 view.rerender(<GuestAttendance {...p} ready={false}/>);
 expect(screen.getByRole('button',{name:'게스트 추가 +'})).toBeDisabled();
});
