import React from 'react';
import { backend, unwrap } from './backend';

export default function GuestAttendance({ meeting, host, attendance, roster, ready, busy, run, reload }) {
  const mine = attendance.find(row => row.user_id === host.id && !row.guest_number);
  const guests = attendance.filter(row => row.user_id === host.id && row.guest_number).sort((a, b) => a.guest_number - b.guest_number);
  const queue = roster.filter(row => row.status === 'waiting');
  const started = new Date(meeting.starts_at) <= new Date();
  const update = (guest = null) => run(async () => {
    unwrap(await backend.rpc('reserve_guest', { p_meeting: meeting.id, p_guest: guest?.participant_id || null, p_cancel: Boolean(guest) }));
    await reload();
  });
  return <section className="guest-attendance" aria-label="동반 게스트 참석"><div><h3>동반 게스트 <span>{guests.length}명</span></h3><button className="quiet" disabled={!ready || !mine || busy || started || meeting.cancelled} onClick={() => update()}>게스트 추가 +</button></div>
    <small>{!ready ? '게스트 참석 기능을 준비 중입니다.' : meeting.cancelled ? '취소된 모임입니다.' : !mine ? '본인 참석 신청 후 게스트를 추가할 수 있습니다.' : started ? '모임 시작 후에는 게스트를 추가할 수 없습니다.' : '게스트도 정원에 포함되며, 정원이 차면 신청 순서대로 대기 등록됩니다.'}</small>
    {guests.map(guest => {
      const position = queue.findIndex(row => row.user_id === guest.participant_id);
      return <div className="guest-reservation" key={guest.participant_id}><span><strong>{host.name}-G{guest.guest_number}</strong><small>{guest.status === 'confirmed' ? '참석 확정' : position >= 0 ? `모임 대기 ${position + 1}번` : '모임 대기'}</small></span><button className="quiet danger" aria-label={`${host.name}-G${guest.guest_number} 참석 취소`} disabled={busy || meeting.cancelled} onClick={() => update(guest)}>참석 취소</button></div>;
    })}
  </section>;
}
