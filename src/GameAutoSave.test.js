import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Game } from './OnlineApp';
import { backend } from './backend';
jest.mock('./backend', () => ({ ...jest.requireActual('./backend'), backend: { rpc: jest.fn() } }));
const roster = Array.from({ length: 12 }, (_, i) => ({ user_id: `${String(i).padStart(8, '0')}-test`, name: `참석${i}`, gender: i % 2 ? '여성' : '남성', status: 'confirmed' }));
function setup() {
  const errors = [];
  const reload = jest.fn().mockResolvedValue();
  render(<Game meeting={{ id: 'm1', title: '오늘 모임', location: '체육관', starts_at: '2026-10-30T01:00:00Z', game_version: 3, game_state: null }} roster={roster} run={action => action().catch(e => errors.push(e.message))} busy={false} reload={reload} close={jest.fn()} />);
  return { errors, reload };
}
beforeEach(() => backend.rpc.mockReset());
test('draw automatically saves the newly formed teams, not the previous state', async () => {
  backend.rpc.mockResolvedValue({ data: 4, error: null });
  const { reload } = setup();
  expect(backend.rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('🏸 팀 편성하기'));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(backend.rpc).toHaveBeenCalledTimes(1);
  const [method, args] = backend.rpc.mock.calls[0];
  expect(method).toBe('save_game');
  expect(args.p_version).toBe(3);
  expect(args.p_state.courts.filter(c => c.team?.length === 4)).toHaveLength(2);
  expect(args.p_state.teamQueue).toHaveLength(1);
  expect(screen.getByText(/경기 저장 완료/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '경기 저장' })).toBeDisabled();
});
test('failed auto save retains the draw and allows a manual retry with the original version', async () => {
  backend.rpc.mockResolvedValueOnce({ error: { message: '연결 실패' } }).mockResolvedValueOnce({ data: 4, error: null });
  const { errors, reload } = setup();
  fireEvent.click(screen.getByText('🏸 팀 편성하기'));
  await waitFor(() => expect(errors).toEqual(['연결 실패']));
  expect(screen.getByText(/저장하지 못했습니다/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '경기 저장' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '경기 저장' }));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(backend.rpc.mock.calls[1][1].p_version).toBe(3);
  expect(backend.rpc.mock.calls[1][1].p_state).toEqual(backend.rpc.mock.calls[0][1].p_state);
});

test('moving a player saves the updated placement automatically', async () => {
  backend.rpc.mockResolvedValue({ data: 4, error: null });
  const { reload } = setup();
  fireEvent.click(screen.getByRole('button', { name: /참석0 남성/ }));
  fireEvent.click(screen.getAllByRole('button', { name: '+ 선수 배치' })[0]);
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(backend.rpc).toHaveBeenCalledTimes(1);
  const state = backend.rpc.mock.calls[0][1].p_state;
  expect(state.courts[0].team).toEqual(['참석0 · 00000000']);
  expect(state.participants).not.toContain('참석0 · 00000000');
  expect(state.participants).toHaveLength(11);
});

test('finishing a court auto saves counts, returned players and next team with the next version', async () => {
  backend.rpc.mockResolvedValueOnce({ data: 4, error: null }).mockResolvedValueOnce({ data: 5, error: null });
  const { reload } = setup();
  fireEvent.click(screen.getByText('🏸 팀 편성하기'));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  const draw = backend.rpc.mock.calls[0][1].p_state;
  const finished = draw.courts[0].team;
  fireEvent.click(screen.getAllByRole('button', { name: '경기 종료' })[0]);
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  const saved = backend.rpc.mock.calls[1][1];
  expect(saved.p_version).toBe(4);
  expect(saved.p_state.courts[0].team).toEqual(draw.teamQueue[0]);
  expect(saved.p_state.teamQueue).toHaveLength(0);
  for (const player of finished) {
    expect(saved.p_state.participants).toContain(player);
    expect(saved.p_state.playedCount[player]).toBe(1);
  }
});

test('operation buttons stay locked while auto save is pending, preventing duplicate game endings', async () => {
  let completeSave;
  backend.rpc.mockResolvedValueOnce({ data: 4, error: null }).mockImplementationOnce(() => new Promise(resolve => { completeSave = resolve; }));
  const { reload } = setup();
  fireEvent.click(screen.getByText('🏸 팀 편성하기'));
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  const finishButton = screen.getAllByRole('button', { name: '경기 종료' })[0];
  fireEvent.click(finishButton);
  await waitFor(() => expect(backend.rpc).toHaveBeenCalledTimes(2));
  expect(finishButton).toBeDisabled();
  expect(screen.getByRole('button', { name: '저장 중…' })).toBeDisabled();
  fireEvent.click(finishButton);
  expect(backend.rpc).toHaveBeenCalledTimes(2);
  completeSave({ data: 5, error: null });
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
});

test('a no-op move does not block a subsequent valid auto-saved move', async () => {
  backend.rpc.mockResolvedValue({ data: 4, error: null });
  const { reload } = setup();
  fireEvent.click(screen.getByRole('button', { name: /참석0 남성/ }));
  fireEvent.click(screen.getByRole('button', { name: '대기로 이동' }));
  expect(backend.rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /참석0 남성/ }));
  fireEvent.click(screen.getAllByRole('button', { name: '+ 선수 배치' })[0]);
  await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  expect(backend.rpc.mock.calls[0][1].p_state.courts[0].team).toEqual(['참석0 · 00000000']);
});
