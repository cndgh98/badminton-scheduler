import { prepareGameState, playerKey } from './gameState';
const player = (id, status = 'confirmed') => ({ user_id: `${String(id).padStart(8,'0')}-aaaa`, name: '동명이인', gender: id % 2 ? '남성' : '여성', status });

test('imports confirmed attendees, preserves identity and excludes reservation waitlist', () => {
  const roster = [player(1), player(2), player(3, 'waiting')];
  const state = prepareGameState(null, roster);
  expect(state.participants).toEqual([playerKey(roster[0]), playerKey(roster[1])]);
  expect(new Set(state.participants).size).toBe(2);
  expect(state.playerProfiles[state.participants[1]].gender).toBe('여성');
});
test('reopening imports newly confirmed people without duplicating active players or resetting scores', () => {
  const roster = [player(1), player(2), player(3)];
  const first = playerKey(roster[0]);
  const saved = { courts: [{ id: 1, team: [first] }], teamQueue: [[playerKey(roster[1])]], participants: [], playedCount: { [first]: 4 } };
  const state = prepareGameState(saved, roster);
  expect(state.courts).toEqual(saved.courts);
  expect(state.teamQueue).toEqual(saved.teamQueue);
  expect(state.participants).toEqual([playerKey(roster[2])]);
  expect(state.playedCount[first]).toBe(4);
});
test('canceled waiting players are removed while ongoing court assignments remain intact', () => {
  const roster = [player(1), player(2)];
  const saved = prepareGameState(null, roster);
  const playing = saved.participants[0];
  const state = prepareGameState({ ...saved, courts: [{ id: 1, team: [playing] }], participants: [saved.participants[1]] }, []);
  expect(state.participants).toEqual([]);
  expect(state.courts[0].team).toEqual([playing]);
});
