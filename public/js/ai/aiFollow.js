import { getValidMoves } from '../engine/combinations.js';

function decideFollow(hand, roundState, myId, players) {
  const { currentTrick, wishRank } = roundState;
  if (!currentTrick) return null;
  const currentWinningCombo = currentTrick.winningCombo;
  const currentWinnerId = currentTrick.winnerId;
  const myTeam = players.find(p => p.id === myId).teamIndex;
  const winnerTeam = players.find(p => p.id === currentWinnerId).teamIndex;
  const partnerIsWinning = winnerTeam === myTeam;
  const validMoves = getValidMoves(hand, currentWinningCombo, wishRank);
  if (validMoves.length === 0) return 'pass';
  if (partnerIsWinning && !currentWinningCombo.cards.some(c => c.rank === 'dragon')) {
    const trickPts = currentTrick.cards.reduce((s, c) => s + (c.pointValue || 0), 0);
    if (trickPts <= 10) return 'pass';
  }
  const nonBombs = validMoves.filter(m => !m.isBomb);
  const bombs = validMoves.filter(m => m.isBomb);
  if (nonBombs.length > 0) { nonBombs.sort((a, b) => a.rank - b.rank); return nonBombs[0]; }
  const trickPts = currentTrick.cards.reduce((s, c) => s + (c.pointValue || 0), 0);
  if (bombs.length > 0 && (trickPts >= 20 || hand.length <= 6)) { bombs.sort((a, b) => a.rank - b.rank); return bombs[0]; }
  return 'pass';
}

function decideDragonGive(players, myId, roundState) {
  const myTeam = players.find(p => p.id === myId).teamIndex;
  const opponents = players.filter(p => p.teamIndex !== myTeam);
  let target = opponents[0], maxPts = -Infinity;
  for (const opp of opponents) {
    const pts = (roundState.trickWinners[opp.id] || []).reduce((s, c) => s + (c.pointValue || 0), 0);
    if (pts > maxPts) { maxPts = pts; target = opp; }
  }
  return target.id;
}

export { decideFollow, decideDragonGive };
