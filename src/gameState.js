export const playerKey = player => `${player.name} · ${player.user_id.slice(0, 8)}`;

// Preserve running courts and queues; import only confirmed members not already playing.
export function prepareGameState(saved, roster) {
  const state = saved || {};
  const playerProfiles = { ...(state.playerProfiles || {}) };
  for (const player of roster) playerProfiles[playerKey(player)] = { user_id: player.user_id, name: player.name, gender: player.gender || playerProfiles[playerKey(player)]?.gender };
  const confirmed = roster.filter(player => player.status === 'confirmed').map(playerKey);
  const excluded = new Set(state.excludedPlayers || []);
  const confirmedSet = new Set(confirmed.filter(key => !excluded.has(key)));
  const eligible = key => !excluded.has(key) && (!playerProfiles[key] || confirmedSet.has(key));
  const priorityCarry = (state.priorityCarry || []).filter(eligible);
  const participants = (state.participants || []).filter(eligible);
  const occupied = new Set([...participants, ...priorityCarry, ...(state.teamQueue || []).flat(), ...(state.courts || []).flatMap(court => court.team || [])]);
  return {
    ...state, playerProfiles, priorityCarry,
    participants: [...participants, ...confirmed.filter(key => !excluded.has(key) && !occupied.has(key))],
    restOnce: (state.restOnce || []).filter(eligible),
  };
}

export function playerInfo(key, profiles = {}) {
  return profiles[key] || { name: key.replace(/ · [a-f0-9]{8}$/i, ''), gender: null };
}
