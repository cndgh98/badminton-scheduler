import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import Scheduler from './App';
import GameBoard from './GameBoard';
import { prepareGameState } from './gameState';
const roster = Array.from({ length: 6 }, (_, i) => ({ user_id: `${String(i + 1).padStart(8,'0')}-test`, name: `회원${i + 1}`, gender: i % 2 ? '여성' : '남성', status: 'confirmed' }));
const meeting = { location: '우리 체육관', starts_at: '2026-10-30T01:00:00Z' };

function setup() {
  const initial = prepareGameState(null, roster);
  const changed = jest.fn();
  render(<Scheduler initialState={initial} onStateChange={changed} renderGame={state => <GameBoard state={state} profiles={initial.playerProfiles} meeting={meeting} busy={false} />} />);
  return changed;
}

test('new operation UI shows the confirmed roster and gender without the old name-entry form', async () => {
  setup();
  const waiting = screen.getByRole('region', { name: '경기 대기 인원' });
  expect(await within(waiting).findByText('회원1')).toBeInTheDocument();
  expect(within(waiting).getAllByText(/여성 · 0경기/)).toHaveLength(3);
  expect(screen.queryByText(/인원 입력/)).not.toBeInTheDocument();
});

test('team formation preserves all players, and finishing a court increments counts', async () => {
  const changed = setup();
  fireEvent.click(screen.getByText('🏸 팀 편성하기'));
  await waitFor(() => expect(changed.mock.calls.at(-1)[0].courts[0].team).toHaveLength(4));
  const state = changed.mock.calls.at(-1)[0];
  const finished = [...state.courts[0].team];
  expect(new Set([...state.participants, ...state.priorityCarry, ...state.teamQueue.flat(), ...state.courts.flatMap(c => c.team || [])]).size).toBe(6);
  fireEvent.click(screen.getAllByRole('button', { name: '경기 종료' })[0]);
  await waitFor(() => expect(changed.mock.calls.at(-1)[0].playedCount[finished[0]]).toBe(1));
  expect(changed.mock.calls.at(-1)[0].participants).toHaveLength(4);
});

test('touch placement moves an attendee from waiting into a court once', async () => {
  const changed = setup();
  const waiting = screen.getByRole('region', { name: '경기 대기 인원' });
  fireEvent.click(within(waiting).getByRole('button', { name: /회원1 남성/ }));
  fireEvent.click(screen.getAllByRole('button', { name: '+ 선수 배치' })[0]);
  await waitFor(() => expect(changed.mock.calls.at(-1)[0].courts[0].team).toHaveLength(1));
  expect(changed.mock.calls.at(-1)[0].participants).toHaveLength(5);
});

test('two taps can swap players on the same court without losing either player', async () => {
  const changed = setup();
  const waiting = screen.getByRole('region', { name: '경기 대기 인원' });
  for (const number of [1, 2]) {
    fireEvent.click(within(waiting).getByRole('button', { name: new RegExp(`회원${number} (남성|여성)`) }));
    fireEvent.click(screen.getAllByRole('button', { name: '+ 선수 배치' }).find(button => !button.disabled));
  }
  const before = [...changed.mock.calls.at(-1)[0].courts[0].team];
  const courts = screen.getByRole('region', { name: '진행 코트' });
  fireEvent.click(within(courts).getByRole('button', { name: /회원1 남성/ }));
  fireEvent.click(within(courts).getByRole('button', { name: /회원2 여성/ }));
  await waitFor(() => expect(changed.mock.calls.at(-1)[0].courts[0].team).toEqual([...before].reverse()));
});

test('priority players taking a rest remain in the player pool after the next draw', async () => {
  const changed = setup();
  fireEvent.click(screen.getByText('🏸 팀 편성하기'));
  const priority = changed.mock.calls.at(-1)[0].priorityCarry[0];
  const name = priority.split(' · ')[0];
  fireEvent.click(screen.getByRole('button', { name: `${name} 한 번 쉬기` }));
  fireEvent.click(screen.getAllByRole('button', { name: '경기 종료' })[0]);
  fireEvent.click(screen.getByText('🏸 팀 편성하기'));
  await waitFor(() => expect(changed.mock.calls.at(-1)[0].participants).toContain(priority));
  const state = changed.mock.calls.at(-1)[0];
  expect([...state.participants, ...state.priorityCarry, ...state.teamQueue.flat(), ...state.courts.flatMap(c => c.team || [])]).toHaveLength(6);
});
