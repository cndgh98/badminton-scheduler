import React, { useCallback, useEffect, useState } from 'react';
import { backend, koreaDate, unwrap } from './backend';
import './AccountsAndStats.css';

export function AccountManagement({ currentUserId, run, busy }) {
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const load = useCallback(async () => {
    const result = await backend.from('profiles').select('id,name,username,gender,role,status,created_at').order('created_at', { ascending: false });
    if (result.error) {
      setLoaded(false);
      setError(result.error.code === '42703' ? '계정관리 데이터베이스 설정이 필요합니다.' : result.error.message);
      return;
    }
    setAccounts(unwrap(result)); setLoaded(true); setError('');
  }, []);
  useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
  const update = (account, action) => run(async () => { unwrap(await backend.rpc('admin_update_account', { p_user: account.id, p_action: action })); await load(); });
  const remove = account => {
    if (!window.confirm(`${account.name} 을 삭제하시겠습니까?`)) return;
    run(async () => { unwrap(await backend.rpc('admin_delete_account', { p_user: account.id })); await load(); });
  };
  const visible = accounts.filter(account => (filter !== 'pending' || account.status === 'pending') && `${account.name} ${account.username}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="account-page"><div className="page-intro"><div><span className="eyebrow">CLUB MEMBERS</span><h2>계정관리</h2><p>가입 신청을 확인하고 회원 권한을 관리하세요.</p></div><button className="quiet" disabled={busy} onClick={() => run(load)}>새로고침</button></div>
    <div className="account-summary"><div><span>전체 회원</span><strong>{loaded ? accounts.length : '—'}</strong></div><div><span>승인 대기</span><strong>{loaded ? accounts.filter(a => a.status === 'pending').length : '—'}</strong></div><div><span>관리자</span><strong>{loaded ? accounts.filter(a => a.role === 'admin' && a.status === 'approved').length : '—'}</strong></div></div>
    <div className="account-filter"><input aria-label="회원 검색" placeholder="이름 또는 아이디 검색" value={search} onChange={e => setSearch(e.target.value)} /><button className={filter === 'all' ? '' : 'quiet'} onClick={() => setFilter('all')}>전체</button><button className={filter === 'pending' ? '' : 'quiet'} onClick={() => setFilter('pending')}>승인 대기</button></div>
    {error && <p className="notice" role="alert">{error}</p>}
    <div className="account-list">{visible.map(account => <article key={account.id}><div className="account-identity"><div><strong>{account.name}</strong>{account.id === currentUserId && <span className="account-tag">내 계정</span>}</div><p>@{account.username} · {account.gender}</p></div><div className="account-badges"><span className={`account-tag ${account.status === 'pending' ? 'pending' : ''}`}>{account.status === 'pending' ? '승인 대기' : '승인 완료'}</span><span className="account-tag">{account.role === 'admin' ? '관리자' : '일반 회원'}</span></div><div className="account-buttons">{account.status === 'pending' ? <button disabled={busy} onClick={() => update(account, 'approve')}>가입 승인</button> : <button className="quiet" disabled={busy || account.id === currentUserId} onClick={() => update(account, account.role === 'admin' ? 'make_member' : 'make_admin')}>{account.role === 'admin' ? '일반 회원으로 변경' : '관리자로 변경'}</button>}<button className="quiet danger" disabled={busy || account.id === currentUserId} onClick={() => remove(account)}>삭제</button></div></article>)}</div>
    {loaded && !visible.length && <p className="empty">표시할 회원이 없습니다.</p>}
    <small>본인 계정의 권한 변경과 삭제는 할 수 없습니다. 삭제된 계정의 이전 경기에는 ‘삭제된 회원’으로 표시됩니다.</small>
  </section>;
}

export function AttendanceStatistics({ userId }) {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const month = koreaDate().slice(0, 7);
  const load = useCallback(async () => {
    setLoaded(false); setError('');
    const result = await backend.rpc('monthly_attendance_ranking', { p_month: `${month}-01` });
    if (result.error) { setError(result.error.code === 'PGRST202' ? '통계 데이터베이스 설정이 필요합니다.' : result.error.message); return; }
    setRows(unwrap(result)); setLoaded(true);
  }, [month]);
  useEffect(() => { load().catch(e => setError(e.message)); }, [load]);
  const mine = rows.find(row => row.user_id === userId);
  return <section className="statistics-page"><div className="page-intro"><div><span className="eyebrow">MONTHLY LEADERBOARD</span><h2>{Number(month.slice(5))}월 참석 랭킹</h2><p>이번 달, 함께 코트에 가장 많이 선 회원은?</p></div><button className="quiet" onClick={() => load().catch(e => setError(e.message))}>새로고침</button></div>
    <div className="my-attendance"><div><span>나의 이번 달 참석</span><strong>{loaded ? `${mine?.attendance_count || 0}회` : '—'}</strong></div><div><span>내 순위</span><strong>{loaded && mine ? `${mine.rank}위` : '—'}</strong></div></div>
    <p className="statistics-rule">한국 시간 기준 {month.replace('-', '년 ')}월 · 시작한 모임의 참석 확정 기록으로 집계합니다. 취소 모임과 예정 모임은 제외하며, 같은 횟수는 공동 순위입니다.</p>
    {error && <p className="notice" role="alert">{error}</p>}
    {!error && !loaded && <p role="status">참석 기록을 불러오는 중…</p>}
    <ol className="ranking-list">{rows.map(row => <li className={row.user_id === userId ? 'my-rank' : ''} key={row.user_id}><span className={`ranking-number ${row.rank <= 3 ? 'top-rank' : ''}`}>{row.rank}</span><div><strong>{row.name}</strong>{row.user_id === userId && <span className="account-tag">나</span>}</div><strong>{row.attendance_count}<small>회</small></strong></li>)}</ol>
    {loaded && !rows.length && <p className="empty">이번 달 참석 기록이 아직 없습니다.</p>}
  </section>;
}
