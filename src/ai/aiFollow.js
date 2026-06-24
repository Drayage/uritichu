'use strict';

const { canBeat, getValidMoves } = require('../engine/combinations');

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

  // If partner is winning with a non-dragon combo and trick value is low: pass
  if (partnerIsWinning && !currentWinningCombo.cards.some(c => c.rank === 'dragon')) {
    const trickPts = currentTrick.cards.reduce((s, c) => s + (c.pointValue || 0), 0);
    if (trickPts <= 10) return 'pass';
  }

  // Don't use bombs unless necessary
  const nonBombs = validMoves.filter(m => !m.isBomb);
  const bombs = validMoves.filter(m => m.isBomb);

  // If we can win without bomb, do so with minimum cost
  if (nonBombs.length > 0) {
    // Pick move with lowest "cost" that still beats
    nonBombs.sort((a, b) => a.rank - b.rank);
    return nonBombs[0];
  }

  // Use bomb only if we want to win this trick (high value or near end of hand)
  const trickPts = currentTrick.cards.reduce((s, c) => s + (c.pointValue || 0), 0);
  if (bombs.length > 0 && (trickPts >= 20 || hand.length <= 6)) {
    bombs.sort((a, b) => a.rank - b.rank);
    return bombs[0];
  }

  return 'pass';
}

// Choose which opponent to give dragon trick to
function decideDragonGive(players, myId, roundState) {
  const myTeam = players.find(p => p.id === myId).teamIndex;
  const opponents = players.filter(p => p.teamIndex !== myTeam);
  // Give to opponent with more tricks (they already have more points, spread them)
  let target = opponents[0];
  let maxPts = -Infinity;
  for (const opp of opponents) {
    const pts = (roundState.trickWinners[opp.id] || []).reduce((s, c) => s + (c.pointValue || 0), 0);
    if (pts > maxPts) { maxPts = pts; target = opp; }
  }
  return target.id;
}

module.exports = { decideFollow, decideDragonGive };
