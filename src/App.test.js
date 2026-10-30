import { render, screen } from '@testing-library/react';
import OnlineApp from './OnlineApp';
import { koreaDate, loginEmail } from './backend';

test('shows setup screen without a configured backend', () => {
  render(<OnlineApp />);
  expect(screen.getByText('온라인 서비스 연결 준비 중')).toBeInTheDocument();
});
test('uses Korea dates across UTC midnight boundaries', () => {
  expect(koreaDate('2026-10-29T15:00:00Z')).toBe('2026-10-30');
  expect(koreaDate('2026-10-29T14:59:59Z')).toBe('2026-10-29');
});
test('normalizes the login identifier consistently', () => {
  expect(loginEmail(' Player_1 ')).toBe('player_1@members.invalid');
});
