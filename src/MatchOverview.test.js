import { render, screen, within } from '@testing-library/react';
import MatchOverview from './MatchOverview';

const gameState = {
  courts: [{ id: 1, name: '코트 1', team: ['a'] }],
  teamQueue: [['b'], ['c']], priorityCarry: ['d'], participants: ['e'],
  playerProfiles: {
    a: { name: '경기회원', gender: '남성', user_id: 'user-a' },
    b: { name: '첫대기', gender: '여성', user_id: 'user-b' },
    c: { name: '내이름', gender: '남성', user_id: 'user-c' },
    d: { name: '우선회원', gender: '여성', user_id: 'user-d' },
    e: { name: '미편성회원', gender: '남성', user_id: 'user-e' },
  },
};
test('members can see the ordered game queue and their own position', () => {
  render(<MatchOverview gameState={gameState} userId="user-c" />);
  expect(screen.getByRole('status')).toHaveTextContent('경기 대기 2번 팀');
  const teams = screen.getAllByRole('listitem');
  expect(within(teams[0]).getByText('첫대기')).toBeInTheDocument();
  expect(within(teams[0]).getByText('1번')).toBeInTheDocument();
  expect(within(teams[1]).getByText('내이름')).toBeInTheDocument();
  expect(screen.getByText('미편성회원')).toBeInTheDocument();
  expect(screen.getByText('다음 편성 우선')).toBeInTheDocument();
});
test('members see a clear explanation before the first team draw', () => {
  render(<MatchOverview gameState={null} userId="user-c" />);
  expect(screen.getByText(/관리자가 팀을 편성하면/)).toBeInTheDocument();
});
