import React from 'react';
import { backend, koreaDate, unwrap } from './backend';

export const requestLabel = kind => kind === 'rest' ? '한 번 쉬기' : '경기 제외';
export function MemberGameRequests({ meeting, requests, ready, busy, run, reload, userId }) {
  const mine = requests.filter(request => request.user_id === userId);
  const pending = mine.find(request => request.status === 'pending');
  const latest = mine[mine.length - 1];
  const profiles = meeting.game_state?.playerProfiles || {};
  const isMine = key => profiles[key]?.user_id === userId || (!profiles[key] && key.endsWith(` · ${userId.slice(0, 8)}`));
  const excluded = meeting.game_state?.excludedPlayers?.some(isMine);
  const resting = meeting.game_state?.restOnce?.some(isMine);
  const enabled = ready && !busy && !pending && !excluded && !meeting.cancelled && koreaDate(meeting.starts_at) === koreaDate() && Boolean(meeting.game_state);
  const submit = kind => run(async () => { unwrap(await backend.rpc('submit_game_request', { p_meeting: meeting.id, p_kind: kind })); await reload(); });
  return <div className="member-request-actions"><div className="request-buttons"><button className="quiet" disabled={!enabled || resting} onClick={() => submit('rest')}>한 번 쉬기 요청</button><button className="quiet danger" disabled={!enabled} onClick={() => submit('exclude')}>경기 제외 요청</button></div>
    {pending ? <div className="request-feedback" role="status"><span>{requestLabel(pending.kind)} 요청 · 운영자 확인 중</span><button className="quiet" disabled={busy} onClick={() => run(async () => { unwrap(await backend.rpc('cancel_game_request', { p_request: pending.id })); await reload(); })}>요청 취소</button></div> : <small role="status">{!ready ? '요청 기능을 준비 중입니다.' : excluded ? '이번 모임의 경기 참여가 종료됐습니다.' : latest?.status === 'approved' ? `${requestLabel(latest.kind)} 요청이 승인됐습니다.` : latest?.status === 'rejected' ? `${requestLabel(latest.kind)} 요청이 반려됐습니다. 운영자에게 확인해 주세요.` : !meeting.game_state || koreaDate(meeting.starts_at) !== koreaDate() ? '모임 당일, 경기 운영 시작 후 요청할 수 있습니다.' : '요청은 운영자 승인 후 반영됩니다. 경기 중이라면 대기 인원으로 돌아온 후 반영됩니다.'}</small>}
  </div>;
}

export function AdminGameRequests({ requests, roster, busy, onReview, state }) {
  const pending = requests.filter(request => request.status === 'pending');
  if (!pending.length) return null;
  const waiting = [...(state?.participants || []), ...(state?.priorityCarry || [])];
  const findKey = request => waiting.find(key => state?.playerProfiles?.[key]?.user_id === request.user_id || (!state?.playerProfiles?.[key] && key.endsWith(` · ${request.user_id.slice(0, 8)}`)));
  return <section className="admin-game-requests" aria-label="회원 경기 요청"><h3>회원 경기 요청 · {pending.length}건</h3>{pending.map(request => {
    const person = roster.find(p => p.user_id === request.user_id);
    const available = Boolean(findKey(request));
    return <article key={request.id}><div><strong>{person?.name || '회원'} · {requestLabel(request.kind)}</strong><small>{available ? '승인하면 경기 상태에 바로 저장됩니다.' : '대기 인원으로 돌아온 후 승인할 수 있습니다.'}</small></div><div className="request-buttons"><button disabled={busy || !available} onClick={() => onReview(request, true)}>승인</button><button className="quiet" disabled={busy} onClick={() => onReview(request, false)}>반려</button></div></article>;
  })}</section>;
}
