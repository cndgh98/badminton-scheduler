import React, { useEffect, useMemo, useState } from "react";

export default function BadmintonScheduler() {
  // -----------------------------
  // State
  // -----------------------------
  const [namesInput, setNamesInput] = useState("");
  const [participants, setParticipants] = useState([]); // 대기 인원(개인)
  const [teamQueue, setTeamQueue] = useState([]); // 대기 팀(배열의 배열)
  const [courts, setCourts] = useState([{ id: 1 }, { id: 2 }]);
  const [courtCountInput, setCourtCountInput] = useState("2");
  const [lastTeamSigByPlayer, setLastTeamSigByPlayer] = useState({}); // {name: "A|B|C|D"}
  const [priorityCarry, setPriorityCarry] = useState([]); // 직전 라운드에서 남은 1~3명
  const [restOnce, setRestOnce] = useState([]); // "쉼"으로 표시되어 다음 1회 팀짜기에서 제외할 인원

  // -----------------------------
  // Persistence (localStorage)
  // -----------------------------
  useEffect(() => {
    const raw = localStorage.getItem("badminton_state_v1");
    if (!raw) return;
    try {
      const s = JSON.parse(raw);
      if (Array.isArray(s.participants)) setParticipants(s.participants);
      if (Array.isArray(s.teamQueue)) setTeamQueue(s.teamQueue);
      if (Array.isArray(s.courts)) setCourts(s.courts);
      if (typeof s.courtCountInput === "string") setCourtCountInput(s.courtCountInput);
      if (typeof s.namesInput === "string") setNamesInput(s.namesInput);
      if (s.lastTeamSigByPlayer && typeof s.lastTeamSigByPlayer === "object")
        setLastTeamSigByPlayer(s.lastTeamSigByPlayer);
      if (Array.isArray(s.priorityCarry)) setPriorityCarry(s.priorityCarry);
      if (Array.isArray(s.restOnce)) setRestOnce(s.restOnce);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const payload = {
      participants,
      teamQueue,
      courts,
      courtCountInput,
      namesInput,
      lastTeamSigByPlayer,
      priorityCarry,
      restOnce,
    };
    localStorage.setItem("badminton_state_v1", JSON.stringify(payload));
  }, [participants, teamQueue, courts, courtCountInput, namesInput, lastTeamSigByPlayer, priorityCarry, restOnce]);

  // -----------------------------
  // Helpers (pure)
  // -----------------------------
  function parseNames(raw) {
    return raw
      .split(/\r?\n/) // ✅ 줄바꿈 기준 분리 (CRLF/LF 모두)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function uniquePreserveOrder(list) {
    const seen = new Set();
    const out = [];
    for (const n of list) {
      const key = n.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(n);
      }
    }
    return out;
  }

  // Fisher–Yates shuffle
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function teamSignature(team) {
    return [...team].sort((a, b) => a.localeCompare(b)).join("|");
  }

  function isExactRepeatTeamWithMap(team, map) {
    if (team.length !== 4) return false;
    const sig = teamSignature(team);
    return team.every((name) => map[name] === sig);
  }

  function isExactRepeatTeam(team) {
    return isExactRepeatTeamWithMap(team, lastTeamSigByPlayer);
  }

  function markTeamAsStarted(team) {
    const sig = teamSignature(team);
    setLastTeamSigByPlayer((prev) => {
      const next = { ...prev };
      for (const name of team) next[name] = sig;
      return next;
    });
  }

  function tryBreak(group, tail) {
    // group(길이 4)이 직전과 완전 동일이면 tail에서 한 명과 스왑 시도
    for (let gi = 0; gi < group.length; gi++) {
      for (let tj = 0; tj < tail.length; tj++) {
        const swapped = [...group];
        swapped[gi] = tail[tj];
        if (!isExactRepeatTeam(swapped)) {
          const newTail = [...tail];
          newTail[tj] = group[gi];
          return [swapped, newTail];
        }
      }
    }
    return null;
  }

  // 이번 라운드에서 제외된(restOnce) 사람을 한 번 쉬고 나서 다시 participants로 돌려놓기
  function mergeRestOnceBack(rest, participantsBefore, restOnceList) {
    const restSet = new Set(restOnceList);
    const justRested = participantsBefore.filter((p) => restSet.has(p)); // 기존 대기열에서 쉰 사람만 추출 (순서 보전)
    return [...justRested, ...rest];
  }

  // -----------------------------
  // DnD payload helpers (no TS)
  // -----------------------------
  function setDragData(e, data) {
    e.dataTransfer.setData("application/json", JSON.stringify(data));
    e.dataTransfer.effectAllowed = "move";
  }
  function getDragData(e) {
    const raw = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // ✅ 같은 영역으로의 드롭을 전부 금지하는 헬퍼
  function canDrop(source, target) {
    if (!source || !target) return false;

    // 참가자 → 참가자 금지
    if (source.from === "participants" && target.type === "participants") return false;

    // 같은 대기팀(같은 인덱스) 금지
    if (source.from === "queue" && target.type === "queue" && source.teamIndex === target.teamIndex) return false;

    // 같은 코트 금지
    if (source.from === "court" && target.type === "court" && source.courtId === target.courtId) return false;

    return true;
  }

  // -----------------------------
  // Actions
  // -----------------------------
  function handleConfirmNames() {
    const raw = parseNames(namesInput);
    const uniq = uniquePreserveOrder(raw);
    setParticipants(uniq);
    setTeamQueue([]);
    setPriorityCarry([]); // 새 명단 확정 시 우선순위 잔여 인원 초기화
    setRestOnce([]); // 쉼 목록도 초기화
    // 코트에 있던 팀은 유지
  }

  function applyCourtCount() {
    const n = Math.max(0, Math.min(32, Number(courtCountInput) || 0));
    if (n === courts.length) return;

    if (n > courts.length) {
      // 확장
      const next = [...courts];
      const oldLen = next.length;
      for (let i = oldLen + 1; i <= n; i++) next.push({ id: i });
      setCourts(next);
    } else {
      // 축소: 잘려나간 코트의 팀을 대기팀 앞으로
      const toRemove = courts.slice(n);
      const survivors = courts.slice(0, n);
      const displacedTeams = toRemove.map((c) => c.team).filter(Boolean);
      const mergedQueue = [...displacedTeams, ...teamQueue];
      setCourts(survivors.map((c, idx) => ({ id: idx + 1, team: c.team })));
      setTeamQueue(mergedQueue);
    }
  }

  // [팀 짜기]
  function handleMakeTeams() {
    const restSet = new Set(restOnce);

    // "쉼" 표시된 인원은 이번 1회 팀짜기에서 제외
    const eligibleParticipants = participants.filter((p) => !restSet.has(p));
    const eligiblePriorityCarry = priorityCarry.filter((p) => !restSet.has(p));

    const totalAvailable = eligibleParticipants.length + eligiblePriorityCarry.length;
    if (totalAvailable < 4) {
      // 한 번 제외만 해야 하므로, 여기서도 restOnce는 소모(클리어) → 다음엔 다시 참여 가능
      setRestOnce([]);
      return; // 4명 미만이면 동작 X
    }

    // 1) 작업용 풀: priorityCarry(쉼 제외) 먼저, 나머지는 섞어서 뒤에
    const others = eligibleParticipants.filter((p) => !eligiblePriorityCarry.includes(p));
    const shuffledOthers = shuffle(others);

    const newTeams = [];

    // 2) 첫 팀: eligiblePriorityCarry(1~3명) 기반 → 부족분은 shuffledOthers로 보충
    let idxInOthers = 0;
    let arr = [];

    if (eligiblePriorityCarry.length > 0) {
      const firstTeam = [...eligiblePriorityCarry];
      while (firstTeam.length < 4 && idxInOthers < shuffledOthers.length) {
        firstTeam.push(shuffledOthers[idxInOthers++]);
      }
      let tail = shuffledOthers.slice(idxInOthers);
      const broken = isExactRepeatTeam(firstTeam) ? tryBreak(firstTeam, tail) : null;
      const finalFirstTeam = broken ? broken[0] : firstTeam;
      tail = broken ? broken[1] : tail;
      newTeams.push(finalFirstTeam);
      arr = tail; // 남은 사람들
    } else {
      // priorityCarry가 없다면 전원을 섞은 상태로 그대로 사용
      arr = [...shuffledOthers];
    }

    // 3) 나머지 사람들(arr)로 랜덤+제약 팀 편성
    while (arr.length >= 4) {
      let group = arr.slice(0, 4);
      let tail = arr.slice(4);

      if (isExactRepeatTeam(group)) {
        const broken = tryBreak(group, tail);
        if (broken) {
          [group, tail] = broken;
        } else {
          if (arr.length > 4) {
            arr = shuffle(arr);
            continue;
          }
          // 마지막 묶음이면 허용
        }
      }

      newTeams.push(group);
      arr = tail;
    }

    // 4) 이번 라운드 남는 0~3명 → 다음 라운드 우선순위로 저장
    const rest = arr; // 길이 0~3
    setPriorityCarry(rest);

    // 5) 코트 배정: 기존 대기팀 → 새로 만든 팀 순서
    const nextCourts = courts.map((c) => ({ ...c }));
    const existingQueue = [...teamQueue];
    const queueAfterAssign = [];

    // 기존 대기팀 먼저 빈 코트에
    for (const c of nextCourts) {
      if (!c.team && existingQueue.length > 0) {
        const nextTeam = existingQueue.shift();
        c.team = nextTeam;
        markTeamAsStarted(nextTeam);
      }
    }

    // 그 다음 새 팀을 빈 코트에
    let i = 0;
    for (const c of nextCourts) {
      if (!c.team && i < newTeams.length) {
        c.team = newTeams[i++];
        markTeamAsStarted(c.team);
      }
    }

    // 남는 새 팀은 대기열 뒤에
    while (i < newTeams.length) queueAfterAssign.push(newTeams[i++]);

    const finalQueue = [...existingQueue, ...queueAfterAssign];

    // 👉 쉼 효과는 1회용: 팀짜기 직후 클리어
    // 그리고 '쉼' 했던 사람은 반드시 대기 인원으로 복귀시킨다.
    const nextParticipants = mergeRestOnceBack(rest, participants, restOnce);

    setCourts(nextCourts);
    setTeamQueue(finalQueue);
    setParticipants(nextParticipants);
    setRestOnce([]); // 마지막에 비우기
  }

  // 코트별 [경기 종료]
  function handleFinishCourt(courtId) {
    const idx = courts.findIndex((c) => c.id === courtId);
    if (idx < 0) return;

    const nextCourts = courts.map((c) => ({ ...c }));
    const finishedTeam = nextCourts[idx].team || [];

    // 코트 비우고, 대기팀이 있으면 즉시 입장
    const existingQueue = [...teamQueue];
    if (existingQueue.length > 0) {
      const nextTeam = existingQueue.shift();
      nextCourts[idx].team = nextTeam;
      markTeamAsStarted(nextTeam);
      setTeamQueue(existingQueue);
    } else {
      nextCourts[idx].team = undefined;
    }

    // 끝난 팀은 대기 인원으로 복귀
    const returned = [...participants, ...finishedTeam];
    setParticipants(returned);
    setCourts(nextCourts);
  }

  function handleResetAll() {
    if (!window.confirm("모든 데이터를 초기화할까요?")) return;
    setNamesInput("");
    setParticipants([]);
    setTeamQueue([]);
    setCourts([{ id: 1 }, { id: 2 }]);
    setCourtCountInput("2");
    setLastTeamSigByPlayer({});
    setPriorityCarry([]);
    setRestOnce([]);
    localStorage.removeItem("badminton_state_v1");
  }

  // ---------- DnD: 공통 조작 ----------
  function removeFromSource(state) {
    if (!state) return;
    if (state.from === "participants" && typeof state.fromIndex === "number") {
      setParticipants((prev) => {
        const next = [...prev];
        next.splice(state.fromIndex, 1);
        return next;
      });
      return;
    }
    if (state.from === "queue" && typeof state.teamIndex === "number" && typeof state.memberIndex === "number") {
      setTeamQueue((prev) => {
        const next = prev.map((t) => [...t]);
        next[state.teamIndex].splice(state.memberIndex, 1);
        if (next[state.teamIndex].length === 0) next.splice(state.teamIndex, 1);
        return next;
      });
      return;
    }
    if (state.from === "court" && typeof state.courtId === "number" && typeof state.memberIndex === "number") {
      setCourts((prev) => {
        const next = prev.map((c) => ({ ...c, team: c.team ? [...c.team] : undefined }));
        const idx = next.findIndex((c) => c.id === state.courtId);
        if (idx >= 0 && next[idx].team) {
          next[idx].team.splice(state.memberIndex, 1);
          if (next[idx].team.length === 0) next[idx].team = undefined;
        }
        return next;
      });
      return;
    }
  }

  function addToParticipants(name, atIndex) {
    setParticipants((prev) => {
      const filtered = prev.filter((n) => n !== name);
      if (typeof atIndex === "number") {
        const next = [...filtered];
        next.splice(Math.min(Math.max(atIndex, 0), next.length), 0, name);
        return next;
      }
      return [...filtered, name];
    });
  }

  function addToQueue(name, teamIndex, memberIndex) {
    setTeamQueue((prev) => {
      const next = prev.map((t) => [...t]);
      if (!next[teamIndex]) next[teamIndex] = [];
      // 스왑
      if (typeof memberIndex === "number") {
        next[teamIndex][memberIndex] = name;
        return next;
      }
      // append (4명 제한)
      if (next[teamIndex].length >= 4) return prev;
      next[teamIndex].push(name);
      return next;
    });
  }

  function addToCourt(name, courtId, memberIndex) {
    setCourts((prev) => {
      const next = prev.map((c) => ({ ...c, team: c.team ? [...c.team] : undefined }));
      const idx = next.findIndex((c) => c.id === courtId);
      if (idx < 0) return prev;
      if (!next[idx].team) next[idx].team = [];
      if (typeof memberIndex === "number" && next[idx].team[memberIndex] != null) {
        next[idx].team[memberIndex] = name; // 스왑 자리 지정
        return next;
      }
      if (next[idx].team.length >= 4) return prev; // 정원 4
      next[idx].team.push(name);
      return next;
    });
  }

  function returnReplacedToSource(replaced, source) {
    if (!replaced || !source) return;
    if (source.from === "participants" && typeof source.fromIndex === "number") {
      addToParticipants(replaced, source.fromIndex);
      return;
    }
    if (source.from === "queue" && typeof source.teamIndex === "number" && typeof source.memberIndex === "number") {
      setTeamQueue((prev) => {
        const next = prev.map((t) => [...t]);
        if (!next[source.teamIndex]) next[source.teamIndex] = [];
        next[source.teamIndex].splice(source.memberIndex, 0, replaced);
        return next;
      });
      return;
    }
    if (source.from === "court" && typeof source.courtId === "number" && typeof source.memberIndex === "number") {
      setCourts((prev) => {
        const next = prev.map((c) => ({ ...c, team: c.team ? [...c.team] : [] }));
        const idx = next.findIndex((c) => c.id === source.courtId);
        if (idx >= 0) {
          if (!next[idx].team) next[idx].team = [];
          next[idx].team.splice(source.memberIndex, 0, replaced);
        }
        return next;
      });
      return;
    }
  }

  // 참가자 컨테이너로 드롭
  function handleDropToParticipants(e) {
    e.preventDefault();
    const data = getDragData(e);
    if (!data) return;
    if (!canDrop(data, { type: "participants" })) return; // ✅ 자기영역 금지
    removeFromSource(data);
    addToParticipants(data.name);
  }

  // 대기팀 컨테이너로 드롭 (맨 뒤 추가)
  function handleDropToQueueContainer(e, teamIndex) {
    e.preventDefault();
    const data = getDragData(e);
    if (!data) return;
    if (!canDrop(data, { type: "queue", teamIndex })) return; // ✅ 자기 팀 금지
    const targetTeam = teamQueue[teamIndex] || [];
    if (targetTeam.length >= 4) return;
    removeFromSource(data);
    addToQueue(data.name, teamIndex);
  }

  // 대기팀 칩(자리)로 드롭 (교체)
  function handleDropToQueueChip(e, teamIndex, memberIndex) {
    e.preventDefault();
    e.stopPropagation();
    const data = getDragData(e);
    if (!data) return;
    if (!canDrop(data, { type: "queue", teamIndex })) return; // ✅ 자기 팀 금지
    const replaced = teamQueue[teamIndex]?.[memberIndex];
    removeFromSource(data);
    addToQueue(data.name, teamIndex, memberIndex);
    if (replaced) returnReplacedToSource(replaced, data);
  }

  // 코트 컨테이너로 드롭 (맨 뒤 추가)
  function handleDropToCourtContainer(e, courtId) {
    e.preventDefault();
    const data = getDragData(e);
    if (!data) return;
    if (!canDrop(data, { type: "court", courtId })) return; // ✅ 자기 코트 금지
    const court = courts.find((c) => c.id === courtId);
    const currentLen = court?.team?.length ?? 0;
    if (currentLen >= 4) return;
    removeFromSource(data);
    addToCourt(data.name, courtId);
  }

  // 코트 칩(자리) 위로 드롭 (교체)
  function handleDropToCourtChip(e, courtId, memberIndex) {
    e.preventDefault();
    e.stopPropagation();
    const data = getDragData(e);
    if (!data) return;
    if (!canDrop(data, { type: "court", courtId })) return; // ✅ 자기 코트 금지
    const court = courts.find((c) => c.id === courtId);
    const replaced = court?.team?.[memberIndex];
    removeFromSource(data);
    addToCourt(data.name, courtId, memberIndex);
    if (replaced) returnReplacedToSource(replaced, data);
  }

  // -----------------------------
  // X / 쉼 버튼 로직
  // -----------------------------
  function handleRemoveParticipant(name, index) {
    setParticipants((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    setRestOnce((prev) => prev.filter((n) => n !== name));
    setPriorityCarry((prev) => prev.filter((n) => n !== name));
  }

  function handleRestOnce(name) {
    setRestOnce((prev) => (prev.includes(name) ? prev : [...prev, name]));
  }

  const stats = useMemo(() => {
    const onCourts = courts.reduce((acc, c) => acc + (c.team ? c.team.length : 0), 0);
    const queued = teamQueue.reduce((acc, t) => acc + t.length, 0);
    return {
      waitingPeople: participants.length,
      onCourts,
      queued,
      total: participants.length + onCourts + queued,
    };
  }, [participants, courts, teamQueue]);

  // -----------------------------
  // Dev tests (console-only)
  // -----------------------------
  useEffect(() => {
    try {
      const r1 = parseNames("A\nB\n\nC");
      console.assert(r1.length === 3 && r1[0] === "A" && r1[2] === "C", "parseNames \\n 실패");

      const r2 = parseNames("A\r\nB\r\nC");
      console.assert(r2.length === 3 && r2[1] === "B", "parseNames \\r\\n 실패");

      const r3 = parseNames("  A  \n   B\n\n  ");
      console.assert(r3.length === 2 && r3[0] === "A" && r3[1] === "B", "parseNames trim 실패");

      console.assert(
        teamSignature(["b", "a", "c"]) === teamSignature(["c", "b", "a"]),
        "teamSignature 일관성 실패"
      );
      const arr = [1, 2, 3, 4, 5, 6];
      console.assert(shuffle(arr).length === arr.length, "shuffle 길이 보존 실패");

      const lastMap = {};
      const prev = ["A", "B", "C", "D"];
      const sigPrev = teamSignature(prev);
      prev.forEach((n) => (lastMap[n] = sigPrev));
      console.assert(isExactRepeatTeamWithMap(["A", "B", "C", "D"], lastMap) === true, "동일팀 감지 실패");

      // NEW: restOnce 필터링 확인
      const restSet = new Set(["A"]);
      const eligiblePC = ["A", "B"].filter((p) => !restSet.has(p));
      const eligiblePP = ["A", "B", "C"].filter((p) => !restSet.has(p));
      console.assert(eligiblePC.length === 1 && eligiblePC[0] === "B", "restOnce 우선순위 필터 실패");
      console.assert(eligiblePP.length === 2 && eligiblePP.includes("B") && eligiblePP.includes("C"), "restOnce 참여자 필터 실패");

      // NEW: mergeRestOnceBack — 쉼 한 번 후에도 대기 인원에 남는지
      const merged = (function () {
        const before = ["A", "B", "C", "D", "E"]; // A가 쉼
        const rest = ["X", "Y"]; // 이번 라운드 남은 사람 가정
        const ro = ["A"];
        return mergeRestOnceBack(rest, before, ro);
      })();
      console.assert(merged.includes("A") && merged.length === 3, "mergeRestOnceBack 실패");

      // NEW: canDrop 기본 동작 확인
      console.assert(canDrop({from:"queue",teamIndex:0},{type:"queue",teamIndex:0}) === false, "same queue must be blocked");
      console.assert(canDrop({from:"queue",teamIndex:0},{type:"queue",teamIndex:1}) === true, "different queue allowed");
      console.assert(canDrop({from:"court",courtId:2},{type:"court",courtId:2}) === false, "same court must be blocked");
      console.assert(canDrop({from:"court",courtId:2},{type:"court",courtId:3}) === true, "different court allowed");
      console.assert(canDrop({from:"participants"},{type:"participants"}) === false, "participants to participants blocked");

      // eslint-disable-next-line no-console
      console.log("[DevTests] OK");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[DevTests] 실패", e);
    }
  }, []);

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-bold">🏸 우주민턴 배드민턴 경기 매칭 도우미</h1>
          <div className="flex items-center gap-2 text-sm">
            <span className="px-2 py-1 rounded-full bg-gray-100">총 인원: {stats.total}</span>
            <span className="px-2 py-1 rounded-full bg-gray-100">대기 인원: {stats.waitingPeople}</span>
            <span className="px-2 py-1 rounded-full bg-gray-100">코트 진행: {stats.onCourts}</span>
            <span className="px-2 py-1 rounded-full bg-gray-100">대기 팀 인원: {stats.queued}</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4">
        {/* 설정 영역 */}
        <section className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold mb-2">① 인원 입력 (엔터로 구분)</h2>
            <textarea
              className="w-full h-40 p-3 border rounded-xl focus:outline-none focus:ring"
              placeholder={`예)\n김철수\n이영희\n...`}
              value={namesInput}
              onChange={(e) => setNamesInput(e.target.value)}
            />
            <div className="flex items-center gap-2 mt-3">
              <button
                className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700"
                onClick={handleConfirmNames}
              >
                확정 → 대기 인원에 반영
              </button>
              <button
                className="px-3 py-2 rounded-xl bg-gray-200 hover:bg-gray-300"
                onClick={() => setNamesInput("")}
              >
                입력 초기화
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">동명이인은 한 번만 반영됩니다(대소문자 무시).</p>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold mb-2">② 코트 수 설정</h2>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={32}
                className="w-24 p-2 border rounded-xl"
                value={courtCountInput}
                onChange={(e) => setCourtCountInput(e.target.value)}
              />
              <button
                className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={applyCourtCount}
              >
                적용
              </button>
              <button className="px-3 py-2 rounded-xl bg-gray-200 hover:bg-gray-300" onClick={handleResetAll}>
                전체 초기화
              </button>

              <div className="mt-4 md:mt-0 md:ml-auto w-full md:w-auto">
                <button
                  className="px-4 py-3 rounded-2xl bg-indigo-600 text-white hover:bg-indigo-700 w-full"
                  onClick={handleMakeTeams}
                  disabled={participants.length + priorityCarry.length - restOnce.length < 4}
                  title={
                    participants.length + priorityCarry.length - restOnce.length < 4
                      ? "대기 인원이 4명 이상 필요합니다"
                      : "대기 인원에서 팀을 묶고 코트/대기팀 배정"
                  }
                >
                  팀 짜기 (랜덤/중복 최소화 + 우선순위/쉼 반영)
                </button>
                {participants.length + priorityCarry.length - restOnce.length < 4 && (
                  <p className="text-xs text-gray-500 mt-2">4명 미만이면 팀을 만들 수 없습니다.</p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 진행 현황 */}
        <section className="grid md:grid-cols-3 gap-4">
          {/* 대기 인원 */}
          <div
            className="bg-white rounded-2xl shadow p-4"
            onDragOver={(e) => {
              e.preventDefault();
              const data = getDragData(e);
              if (data && !canDrop(data, { type: "participants" })) {
                e.dataTransfer.dropEffect = "none";
              } else {
                e.dataTransfer.dropEffect = "move";
              }
            }}
            onDrop={handleDropToParticipants}
          >
            <h3 className="font-semibold mb-2">대기 인원 ({participants.length})</h3>
            {participants.length === 0 ? (
              <p className="text-sm text-gray-500">현재 대기 인원이 없습니다.</p>
            ) : (
              <ul className="text-sm grid grid-cols-1 gap-1 max-h-96 overflow-auto pr-1">
                {participants.map((n, i) => {
                  const resting = restOnce.includes(n);
                  return (
                    <li
                      key={n + i}
                      className={`flex items-center justify-between gap-2 px-2 py-1 rounded-lg border ${
                        resting ? "bg-amber-50 border-amber-200" : "bg-gray-50"
                      }`}
                      draggable
                      onDragStart={(e) => setDragData(e, { name: n, from: "participants", fromIndex: i })}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-gray-800">
                          {i + 1}. {n}
                        </span>
                        {resting && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">쉼</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          className="text-[11px] px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white"
                          title="다음 한 번의 팀짜기에서만 제외"
                          onClick={() => handleRestOnce(n)}
                        >
                          쉼
                        </button>
                        <button
                          className="text-[11px] px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-700 text-white"
                          title="대기 인원에서 제거"
                          onClick={() => handleRemoveParticipant(n, i)}
                        >
                          X
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {priorityCarry.length > 0 && (
              <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                우선순위 잔여 인원: {priorityCarry.join(", ")}
              </div>
            )}
          </div>

          {/* 코트 */}
          <div className="md:col-span-2 bg-white rounded-2xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">코트 배정</h3>
              <span className="text-xs text-gray-500">
                빈 코트: {courts.filter((c) => !c.team).length} / {courts.length}
              </span>
            </div>
            {courts.length === 0 ? (
              <p className="text-sm text-gray-500">코트가 없습니다. 코트 수를 설정해 주세요.</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {courts.map((court) => (
                  <div
                    key={court.id}
                    className="border rounded-2xl p-3"
                    onDragOver={(e) => {
                      e.preventDefault();
                      const data = getDragData(e);
                      if (data && !canDrop(data, { type: "court", courtId: court.id })) {
                        e.dataTransfer.dropEffect = "none";
                      } else {
                        e.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(e) => handleDropToCourtContainer(e, court.id)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold">코트 {court.id}</div>
                      <button
                        className={`px-3 py-1.5 rounded-xl border ${
                          court.team ? "bg-rose-600 text-white border-rose-600 hover:bg-rose-700" : "bg-gray-100 text-gray-500"
                        }`}
                        onClick={() => handleFinishCourt(court.id)}
                        disabled={!court.team}
                        title={court.team ? "경기 종료 후 다음 대기팀 입장" : "배정된 팀이 없습니다"}
                      >
                        경기 종료
                      </button>
                    </div>

                    {court.team ? (
                      <ul className="text-sm grid grid-cols-2 gap-1">
                        {court.team.map((name, mi) => (
                          <li
                            key={name + mi}
                            className="px-2 py-1 rounded-lg bg-emerald-50 border"
                            draggable
                            onDragStart={(e) =>
                              setDragData(e, {
                                name,
                                from: "court",
                                courtId: court.id,
                                memberIndex: mi,
                              })
                            }
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const data = getDragData(e);
                              if (data && !canDrop(data, { type: "court", courtId: court.id })) {
                                e.dataTransfer.dropEffect = "none";
                              } else {
                                e.dataTransfer.dropEffect = "move";
                              }
                            }}
                            onDrop={(e) => {
                              e.stopPropagation();
                              handleDropToCourtChip(e, court.id, mi);
                            }}
                            title="드롭하면 이 자리와 교체됩니다"
                          >
                            {name}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-sm text-gray-500">배정 대기</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 대기 팀 */}
            <div className="mt-6">
              <h3 className="font-semibold mb-2">대기 팀 ({teamQueue.length})</h3>
              {teamQueue.length === 0 ? (
                <p className="text-sm text-gray-500">대기 팀이 없습니다.</p>
              ) : (
                <div className="grid md:grid-cols-2 gap-3">
                  {teamQueue.map((team, idx) => (
                    <div
                      key={idx}
                      className="border rounded-2xl p-3"
                      onDragOver={(e) => {
                        e.preventDefault();
                        const data = getDragData(e);
                        if (data && !canDrop(data, { type: "queue", teamIndex: idx })) {
                          e.dataTransfer.dropEffect = "none";
                        } else {
                          e.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDrop={(e) => handleDropToQueueContainer(e, idx)}
                    >
                      <div className="font-semibold mb-2">대기 {idx + 1}팀</div>
                      <ul className="text-sm grid grid-cols-2 gap-1">
                        {team.map((name, mi) => (
                          <li
                            key={name + mi}
                            className="px-2 py-1 rounded-lg bg-indigo-50 border"
                            draggable
                            onDragStart={(e) =>
                              setDragData(e, {
                                name,
                                from: "queue",
                                teamIndex: idx,
                                memberIndex: mi,
                              })
                            }
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const data = getDragData(e);
                              if (data && !canDrop(data, { type: "queue", teamIndex: idx })) {
                                e.dataTransfer.dropEffect = "none";
                              } else {
                                e.dataTransfer.dropEffect = "move";
                              }
                            }}
                            onDrop={(e) => {
                              e.stopPropagation();
                              handleDropToQueueChip(e, idx, mi);
                            }}
                            title="드롭하면 이 자리와 교체됩니다"
                          >
                            {name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 팁 */}
        <section className="mt-8 text-xs text-gray-500">
          <ul className="list-disc pl-5 space-y-1">
            <li>이름 입력 시 공백 줄은 무시되고, 동일 이름은 한 번만 반영됩니다.</li>
            <li>[팀 짜기]는 대기 인원이 4명 이상일 때만 동작합니다.</li>
            <li>코트 수를 줄이면 잘려나간 코트의 팀은 대기팀 앞으로 이동합니다.</li>
            <li>[경기 종료]를 누르면 해당 팀은 대기 인원으로 돌아가고, 대기 1팀이 자동 입장합니다.</li>
            <li>동일 4인 팀의 연속 재배정을 최소화합니다(인원이 부족하면 허용될 수 있음).</li>
            <li>직전 라운드 남은 1~3명은 다음 라운드에서 우선 처리됩니다.</li>
            <li>드래그&드롭으로 대기/대기팀/코트 간에 이동하거나 칩 위 드롭으로 교체(스왑)할 수 있습니다.</li>
            <li>대기 인원 옆 <strong>쉼</strong> 버튼은 해당 인원을 <strong>다음 1회 팀짜기에서만 제외</strong>합니다. 이후 자동 복귀합니다.</li>
            <li><strong>X</strong> 버튼은 해당 인원을 <strong>대기 목록에서 즉시 제거</strong>합니다.</li>
          </ul>
        </section>
      </main>

      <footer className="text-center text-xs text-gray-400 py-6">© {new Date().getFullYear()} 우주민턴 배드민턴 경기 매칭 도우미</footer>
    </div>
  );
}
