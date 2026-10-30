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
