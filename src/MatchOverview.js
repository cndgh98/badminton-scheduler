import React from 'react';
import { playerInfo } from './gameState';

export default function MatchOverview({ gameState, userId }) {
  if (!gameState) return <section className="match-overview" aria-label="경기 현황"><h3>경기 대기 순서</h3><p className="muted">관리자가 팀을 편성하면 코트와 경기 대기 순서가 여기에 표시됩니다.</p></section>;
  const profiles = gameState.playerProfiles || {};
  const courts = gameState.courts || [];
  const queue = gameState.teamQueue || [];
  const priority = gameState.priorityCarry || [];
  const waiting = [...new Set([...priority, ...(gameState.participants || [])])];
  const isMine = key => Boolean(userId) && (profiles[key]?.user_id === userId || (!profiles[key] && key.endsWith(` · ${userId.slice(0, 8)}`)));
  const myCourt = courts.find(c => c.team?.some(isMine));
  const myTeam = queue.findIndex(team => team.some(isMine));
  const myWaiting = waiting.find(isMine);
  function player(key) {
    const p = playerInfo(key, profiles);
    return <span className={`match-person ${isMine(key) ? 'is-me' : ''}`} key={key}>{p.name}{p.gender && <small>{p.gender}</small>}{isMine(key) && <b>나</b>}</span>;
  }
  const status = myCourt ? `${myCourt.name}에서 경기 중` : myTeam >= 0 ? `경기 대기 ${myTeam + 1}번 팀` : myWaiting ? priority.includes(myWaiting) ? '다음 팀 편성 우선 대기' : '팀 편성 대기 중' : null;
  return <section className="match-overview" aria-label="경기 현황"><div className="match-overview-heading"><h3>실시간 경기 현황</h3><span>15초마다 갱신</span></div>
    {status && <p className="my-match-status" role="status">내 경기 상태 · <strong>{status}</strong></p>}
    <h4>현재 코트</h4>{courts.map(c => <article className="court-summary" key={c.id}><strong>{c.name}</strong><div className="match-people">{c.team?.length ? c.team.map(player) : <p className="muted">입장 대기</p>}</div></article>)}
    <h4>경기 대기 팀 · 입장 순서</h4>{queue.length ? <ol className="match-team-queue">{queue.map((team, index) => <li className={team.some(isMine) ? 'my-team' : ''} key={index}><div><strong>{index + 1}번</strong><span>{index === 0 ? '다음 빈 코트 입장' : `${index + 1}번째 입장 예정`}</span></div><div className="match-people">{team.map(player)}</div></li>)}</ol> : <p className="muted">경기 대기 팀이 없습니다.</p>}
    <h4>팀 편성 대기 인원 · {waiting.length}명</h4>{waiting.length ? <div className="match-unassigned">{waiting.map(key => <div key={key}>{player(key)}{priority.includes(key) && <span className="priority-label">다음 편성 우선</span>}{gameState.restOnce?.includes(key) && <span className="priority-label">한 번 쉬기</span>}</div>)}</div> : <p className="muted">모든 인원이 팀에 배정됐습니다.</p>}
    <small>대기 팀은 표시된 순서대로 입장합니다. 미편성 인원은 다음 팀 편성 때 배정됩니다.</small>
  </section>;
}
