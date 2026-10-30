import React, { useCallback, useEffect, useRef, useState } from 'react';
import Scheduler from './App';
import GameBoard from './GameBoard';
import { prepareGameState, gameStateFingerprint } from './gameState';
import { MemberGameRequests, AdminGameRequests } from './GameRequests';
import MatchOverview from './MatchOverview';
import { backend, koreaDate, loginEmail, unwrap } from './backend';
import './OnlineApp.css';

function Auth({ run, busy }) {
  const [signup, setSignup] = useState(false);
  return <section className="auth-card"><h2>{signup ? '회원가입' : '로그인'}</h2><p>함께 운동할 다음 모임을 확인하세요.</p>
    <form onSubmit={e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); run(async () => {
      if (signup) {
        const data = unwrap(await backend.auth.signUp({ email: loginEmail(f.username), password: f.password, options: { data: { username: f.username.trim().toLowerCase(), name: f.name.trim(), gender: f.gender } } }));
        if (!data.session) throw new Error('가입 후 로그인이 되지 않았습니다. 운영자에게 가입 설정 확인을 요청하세요.');
      } else unwrap(await backend.auth.signInWithPassword({ email: loginEmail(f.username), password: f.password }));
    }); }}>
      {signup && <><label>이름<input name="name" required maxLength={40} autoComplete="name" /></label><label>성별<select name="gender"><option>남성</option><option>여성</option></select></label></>}
      <label>아이디<input name="username" required pattern="[a-zA-Z0-9_]{4,24}" title="영문, 숫자, 밑줄 4~24자" autoComplete="username" autoCapitalize="none" /></label>
      <label>비밀번호<input name="password" type="password" minLength={8} maxLength={72} required autoComplete={signup ? 'new-password' : 'current-password'} /></label>
      <button disabled={busy}>{busy ? '처리 중…' : signup ? '가입하기' : '로그인'}</button>
    </form><button className="quiet" onClick={() => setSignup(!signup)}>{signup ? '로그인으로 돌아가기' : '처음 오셨나요? 회원가입'}</button>
    <small>비밀번호를 잊으셨다면 운영자에게 문의하세요.</small></section>;
}

export function Game({ meeting, roster, run, busy, reload, close, requests = [], reloadRequests = async () => {} }) {
  const draft = useRef(null);
  const version = useRef(meeting.game_version);
  const savedState = useRef(meeting.game_state);
  const [engineKey, setEngineKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const initial = useRef(prepareGameState(meeting.game_state, roster));
  const autoSaveRequested = useRef(false);
  const saveAction = useRef(null);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  saveAction.current = snapshot => {
    if (!snapshot || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveStatus('saving');
    return run(async () => {
      try {
        version.current = unwrap(await backend.rpc('save_game', { p_meeting: meeting.id, p_state: snapshot, p_version: version.current }));
        savedState.current = snapshot;
        setDirty(draft.current !== snapshot);
        setSaveStatus('saved');
        await reload();
      } catch (error) {
        setSaveStatus('failed');
        throw error;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    });
  };
  const changed = useCallback(value => {
    draft.current = { ...value, playerProfiles: initial.current.playerProfiles };
    setDirty(gameStateFingerprint(draft.current) !== gameStateFingerprint(savedState.current));
    if (autoSaveRequested.current) {
      autoSaveRequested.current = false;
      saveAction.current(draft.current);
    }
  }, []);
  useEffect(() => {
    const protect = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);
  const reviewRequest = (request, approve) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    return run(async () => {
      try {
        const result = unwrap(await backend.rpc('review_game_request', { p_request: request.id, p_approve: approve, p_state: approve ? draft.current : null, p_version: approve ? version.current : null }));
        if (approve) {
          initial.current = result.game_state;
          savedState.current = result.game_state;
          draft.current = result.game_state;
          version.current = result.version;
          setDirty(false);
          setSaveStatus('saved');
          setEngineKey(value => value + 1);
        }
        await Promise.all([reload(), reloadRequests()]);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    });
  };
  return <><div className="game-toolbar"><button className="quiet" disabled={saving} onClick={() => { if (!dirty || window.confirm('저장하지 않은 경기 변경을 버리고 나갈까요?')) close(); }}>← 모임으로</button><strong>{meeting.title}</strong><button disabled={busy || saving || !dirty} onClick={() => saveAction.current(draft.current)}>{saving ? '저장 중…' : '경기 저장'}</button></div>
    <p className="game-note">팀 편성·선수 이동·경기 종료·경기 제외는 자동 저장됩니다. 코트 설정 등 다른 변경 후에는 ‘경기 저장’을 눌러주세요.</p>
    <p className={`game-save-status ${saveStatus === 'failed' ? 'save-failed' : ''}`} role="status">{saveStatus === 'saving' ? '경기 결과를 저장하고 있습니다…' : saveStatus === 'failed' ? '저장하지 못했습니다. 변경은 화면에 유지됩니다. 경기 저장을 눌러 다시 시도하세요.' : saveStatus === 'saved' && !dirty ? '경기 저장 완료 · 회원에게 대기 순서가 공개됩니다.' : dirty ? '저장하지 않은 변경이 있습니다.' : ''}</p>
    <Scheduler key={engineKey} initialState={initial.current} onStateChange={changed} renderGame={state => {
      const autoSave = action => (...args) => {
        if (savingRef.current) return;
        autoSaveRequested.current = true;
        action(...args);
      };
      return <><AdminGameRequests requests={requests} roster={roster} busy={busy || saving} onReview={reviewRequest} state={{ ...state, playerProfiles: initial.current.playerProfiles }} /><GameBoard state={{
        ...state,
        handleMakeTeams: autoSave(state.handleMakeTeams),
        movePlayer: autoSave(state.movePlayer),
        handleFinishCourt: autoSave(state.handleFinishCourt),
        handleExcludePlayer: autoSave(state.handleExcludePlayer),
        handleRestorePlayer: autoSave(state.handleRestorePlayer),
      }} profiles={initial.current.playerProfiles} meeting={meeting} busy={busy || saving} /></>;
    }} /></>;
}

export default function OnlineApp() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [selected, setSelected] = useState(null);
  const [roster, setRoster] = useState([]);
  const [requests, setRequests] = useState([]);
  const [requestsReady, setRequestsReady] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [month, setMonth] = useState(koreaDate().slice(0, 7));
  const [day, setDay] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [game, setGame] = useState(false);
  const [newMeeting, setNewMeeting] = useState(false);
  const admin = profile?.role === 'admin';
  const run = async action => { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e.message || '요청을 처리하지 못했습니다. 다시 시도해 주세요.'); } finally { setBusy(false); } };
  useEffect(() => {
    if (!backend) { setReady(true); return; }
    backend.auth.getSession().then(({ data, error: e }) => { if (e) setError(e.message); setSession(data.session); setReady(true); });
    const { data } = backend.auth.onAuthStateChange((_event, value) => { setSession(value); if (!value) { setProfile(null); setMeetings([]); setAttendance([]); setSelected(null); setGame(false); } });
    return () => data.subscription.unsubscribe();
  }, []);
  const load = useCallback(async () => {
    if (!session) return;
    const [p, m, a] = await Promise.all([
      backend.from('profiles').select('*').eq('id', session.user.id).single(),
      backend.from('meetings').select('*').order('starts_at'),
      backend.from('attendance').select('*')
    ]);
    setProfile(unwrap(p)); setMeetings(unwrap(m)); setAttendance(unwrap(a));
  }, [session]);
  const loadRoster = useCallback(async () => {
    if (!selected) return;
    let people = unwrap(await backend.rpc('roster', { p_meeting: selected }));
    if (profile?.role === 'admin' && people.length) {
      const profiles = unwrap(await backend.from('profiles').select('id,gender').in('id', people.map(p => p.user_id)));
      const genders = Object.fromEntries(profiles.map(p => [p.id, p.gender]));
      people = people.map(p => ({ ...p, gender: genders[p.user_id] }));
    }
    setRoster(people);
  }, [selected, profile?.role]);
  const loadRequests = useCallback(async () => {
    if (!session || !selected) return;
    const result = await backend.from('game_requests').select('*').eq('meeting_id', selected).order('created_at');
    if (result.error) {
      setRequests([]);
      setRequestsReady(false);
      setRequestError(['PGRST205', '42P01'].includes(result.error.code) ? '' : '경기 요청을 불러오지 못했습니다. 새로고침해 주세요.');
      return;
    }
    setRequests(unwrap(result)); setRequestsReady(true); setRequestError('');
  }, [session, selected]);
  useEffect(() => {
    setRequests([]); setRequestsReady(false); setRequestError('');
    if (!session || !selected) return;
    const refresh = () => loadRequests().catch(() => setRequestError('경기 요청을 불러오지 못했습니다. 새로고침해 주세요.'));
    refresh(); const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [loadRequests, session, selected]);
  useEffect(() => { if (!session) return; let live = true; const refresh = () => { load().catch(e => { if (live) setError(e.message); }); }; refresh(); const timer = setInterval(refresh, 15000); return () => { live = false; clearInterval(timer); }; }, [load, session]);
  useEffect(() => { setRoster([]); if (!session || !selected) return; const refresh = () => loadRoster().catch(e => setError(e.message)); refresh(); const timer = setInterval(refresh, 15000); return () => clearInterval(timer); }, [selected, session, loadRoster]);
  const meeting = meetings.find(m => m.id === selected);
  const meetingRequests = requests.filter(request => request.meeting_id === selected);
  const mine = attendance.find(a => a.meeting_id === selected && a.user_id === session?.user.id);
  const confirmed = attendance.filter(a => a.meeting_id === selected && a.status === 'confirmed').length;
  const waiting = roster.filter(r => r.status === 'waiting');
  const visible = meetings.filter(m => koreaDate(m.starts_at).startsWith(month) && (!day || koreaDate(m.starts_at) === day));
  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  const shiftMonth = amount => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + amount); setMonth(d.toISOString().slice(0, 7)); setDay(null); };
  return <div className="club"><header className="club-header"><div><span className="eyebrow">OUR COURT, OUR CLUB</span><h1>우주민턴<span>함께 치는 즐거움</span></h1></div>{session && <div className="account"><span>{profile?.name || '회원'} · {admin ? '관리자' : '일반 회원'}</span><button className="quiet" disabled={busy} onClick={() => { if (!game || window.confirm('저장하지 않은 경기 변경이 있으면 사라집니다. 로그아웃할까요?')) run(async () => { unwrap(await backend.auth.signOut()); }); }}>로그아웃</button></div>}</header>
    {error && <div className="notice error" role="alert">{error}<button onClick={() => setError('')} aria-label="오류 닫기">×</button></div>}
    {!backend ? <section className="auth-card"><h2>온라인 서비스 연결 준비 중</h2><p>운영자가 데이터베이스 연결을 마치면 회원가입과 모임 신청을 사용할 수 있습니다.</p></section> : !ready ? <p role="status">불러오는 중…</p> : !session ? <Auth run={run} busy={busy} /> : game && meeting && admin ? <Game key={meeting.id} meeting={meeting} roster={roster} run={run} busy={busy} reload={load} close={() => setGame(false)} requests={meetingRequests} reloadRequests={loadRequests} /> : <>
    <section className="welcome"><div><span className="eyebrow">LET’S PLAY</span><h2>다음 모임에서 만나요.</h2><p>날짜를 고르고, 함께할 경기를 신청하세요.</p></div>{admin && <button onClick={() => setNewMeeting(!newMeeting)}>+ 모임 등록</button>}</section>
    {admin && newMeeting && <section className="panel"><h2>새 모임</h2><form className="meeting-form" onSubmit={e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); run(async () => {
      unwrap(await backend.from('meetings').insert({ title: f.title.trim(), location: f.location.trim(), starts_at: new Date(`${f.starts_at}:00+09:00`).toISOString(), capacity: Number(f.capacity) }));
      setNewMeeting(false); await load();
    }); }}><label>모임 이름<input name="title" required maxLength={100} /></label><label>일시 · 한국 시간<input name="starts_at" type="datetime-local" required /></label><label>장소<input name="location" required maxLength={200} /></label><label>참석 정원<input name="capacity" type="number" defaultValue="20" min="1" max="500" required /></label><button disabled={busy}>등록하기</button></form></section>}
    <div className="club-grid"><section className="panel"><div className="month-nav"><button className="quiet" onClick={() => shiftMonth(-1)} aria-label="이전 달">←</button><h2>{month.replace('-', '년 ')}월</h2><button className="quiet" onClick={() => shiftMonth(1)} aria-label="다음 달">→</button></div><div className="calendar">{['일','월','화','수','목','금','토'].map(d => <span className="weekday" key={d}>{d}</span>)}{Array.from({ length: first }, (_, i) => <span key={`blank-${i}`} />)}{Array.from({ length: days }, (_, i) => { const date = `${month}-${String(i + 1).padStart(2, '0')}`; const count = meetings.filter(m => koreaDate(m.starts_at) === date && !m.cancelled).length; return <button key={date} aria-label={`${date}${count ? ` 모임 ${count}개` : ''}`} aria-pressed={day === date} className={`${day === date ? 'selected' : ''} ${date === koreaDate() ? 'today' : ''}`} onClick={() => setDay(day === date ? null : date)}>{i + 1}<span>{count ? '●' : '\u00a0'}</span></button>; })}</div><button className="quiet" onClick={() => setDay(null)}>이번 달 전체 보기</button><div className="meeting-list">{!visible.length && <p className="muted">등록된 모임이 없습니다.</p>}{visible.map(m => <button className={`meeting-item ${selected === m.id ? 'active' : ''}`} key={m.id} onClick={() => { setSelected(m.id); }}><span>{new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(m.starts_at))}</span><strong>{m.title}</strong><span>{m.cancelled ? '취소된 모임' : `${m.location} · ${attendance.filter(a => a.meeting_id === m.id && a.status === 'confirmed').length}/${m.capacity}명`}</span></button>)}</div></section>
    <section className="panel details">{!meeting ? <div className="empty"><span>🏸</span><h2>어떤 날 함께할까요?</h2><p>달력에서 모임을 선택해 주세요.</p></div> : <><span className="eyebrow">MEETING</span><h2>{meeting.title}</h2><p>{new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'full', timeStyle: 'short' }).format(new Date(meeting.starts_at))}</p><p>{meeting.location}</p><div className="capacity"><strong>참석 {confirmed} / {meeting.capacity}명</strong><span>대기 {waiting.length}명</span></div>
    {meeting.cancelled ? <p className="notice">취소된 모임입니다.</p> : <><button className="wide" disabled={busy || (!mine && new Date(meeting.starts_at) <= new Date())} onClick={() => run(async () => { unwrap(await backend.rpc('reserve', { p_meeting: meeting.id, p_cancel: Boolean(mine) })); await Promise.all([load(), loadRoster()]); })}>{mine ? mine.status === 'confirmed' ? '참석 취소' : `대기 ${waiting.findIndex(r => r.user_id === session.user.id) + 1 || '…'}번 · 대기 취소` : new Date(meeting.starts_at) <= new Date() ? '신청 마감' : confirmed >= meeting.capacity ? '대기 신청' : '참석하기'}</button><small>빈자리가 생기면 대기 신청 순서대로 자동 참석 처리됩니다. 정보는 15초마다 갱신됩니다.</small></>}
    <h3>참석자</h3><div className="people">{roster.filter(r => r.status === 'confirmed').map(r => <span key={r.user_id}>{r.name}{r.user_id === session.user.id ? ' (나)' : ''}</span>)}{!confirmed && <p className="muted">첫 번째 참석자가 되어 주세요.</p>}</div><h3>모임 참석 대기 순서</h3>{waiting.length ? <ol className="reservation-waitlist">{waiting.map((r, index) => <li key={r.user_id}><strong>{index + 1}번</strong> {r.name}{r.user_id === session.user.id ? ' (나)' : ''}</li>)}</ol> : <p className="muted">모임 참석 대기자가 없습니다.</p>}
    {admin && !meeting.cancelled && <div className="admin-actions"><button disabled={busy || koreaDate(meeting.starts_at) !== koreaDate()} onClick={() => run(async () => { await Promise.all([load(), loadRoster(), loadRequests()]); setGame(true); })}>경기 운영 시작</button><small>경기 운영은 한국 시간 기준 모임 당일에 열립니다.</small><button className="quiet danger" disabled={busy} onClick={() => { if (window.confirm('이 모임을 취소할까요?')) run(async () => { unwrap(await backend.rpc('cancel_meeting', { p_meeting: meeting.id })); await load(); }); }}>모임 취소</button></div>}
    <MatchOverview gameState={meeting.game_state} userId={session.user.id} />
    {requestError && <p role="alert">{requestError}</p>}
    {admin && meetingRequests.some(request => request.status === 'pending') && <p className="notice">확인할 회원 요청 {meetingRequests.filter(request => request.status === 'pending').length}건 · 경기 운영에서 승인·반려할 수 있습니다.</p>}
    <div className="member-game-actions"><button className="quiet" disabled={busy} onClick={() => run(async () => { await Promise.all([load(), loadRoster(), loadRequests()]); })}>최신 정보 새로고침</button>
    {!admin && mine?.status === 'confirmed' && <MemberGameRequests meeting={meeting} requests={meetingRequests} ready={requestsReady} busy={busy} run={run} reload={async () => { await Promise.all([loadRequests(), load()]); }} userId={session.user.id} />}</div></>}</section></div></>}
    <footer>우주민턴 · 함께 운동하는 우리들의 공간</footer></div>;
}
