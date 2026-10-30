import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Game } from './OnlineApp';
import { backend } from './backend';

jest.mock('./backend', () => ({
  ...jest.requireActual('./backend'),
  backend: { rpc: jest.fn() },
}));
jest.mock('./App', () => function SchedulerStub({ onStateChange }) {
  require('react').useEffect(() => { onStateChange({ courts: [] }); }, [onStateChange]);
  return <button onClick={() => onStateChange({ courts: [{ id: 1 }] })}>경기 수정</button>;
});

test('background refresh cannot advance the version of a locally edited game', async () => {
  backend.rpc.mockResolvedValueOnce({ data: 1, error: null }).mockResolvedValueOnce({ data: 2, error: null });
  const props = { meeting: { id: 'meeting-1', title: '모임', game_version: 0, game_state: { courts: [] } }, roster: [], busy: false, reload: jest.fn().mockResolvedValue(), close: jest.fn(), run: action => action() };
  const view = render(<Game {...props} />);
  // A different administrator saves while this editor remains open.
  view.rerender(<Game {...props} meeting={{ ...props.meeting, game_version: 5 }} />);
  fireEvent.click(screen.getByText('경기 저장'));
  await waitFor(() => expect(props.reload).toHaveBeenCalledTimes(1));
  expect(backend.rpc).toHaveBeenNthCalledWith(1, 'save_game', expect.objectContaining({ p_version: 0 }));
  fireEvent.click(screen.getByText('경기 수정'));
  fireEvent.click(screen.getByText('경기 저장'));
  await waitFor(() => expect(props.reload).toHaveBeenCalledTimes(2));
  expect(backend.rpc).toHaveBeenNthCalledWith(2, 'save_game', expect.objectContaining({ p_version: 1 }));
});
