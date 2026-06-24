import { getValidMoves } from '../engine/combinations.js';

function decideFollow(hand, roundState, myId, players) {
  const { currentTrick, wishRank, tichuCalls, grandTichuCalls, finishOrder } = roundState;
  if (!currentTrick) return null;

  const winningCombo = currentTrick.winningCombo;
  const winnerId = currentTrick.winnerId;
  const myTeam = players.find(p => p.id === myId)?.teamIndex;
  const partnerWinning = players.find(p => p.id === winnerId)?.teamIndex === myTeam;

  const trickPts = currentTrick.cards.reduce((s, c) => s + (c.pointValue || 0), 0);
  const dragonInTrick = currentTrick.cards.some(c => c.rank === 'dragon');

  const validMoves = getValidMoves(hand, winningCombo, wishRank);
  if (validMoves.length === 0) return 'pass';

  const nonBombs = validMoves.filter(m => !m.isBomb);
  const bombs = validMoves.filter(m => m.isBomb);

  // Opponent called tichu/grand tichu and still playing?
  const opponentTichu = players.some(p =>
    p.teamIndex !== myTeam &&
    !(finishOrder || []).includes(p.id) &&
    (tichuCalls?.[p.id] === true || grandTichuCalls?.[p.id] === true)
  );

  // ── Partner winning ──
  if (partnerWinning && !dragonInTrick) {
    // Always save cards — partner takes the trick for the team.
    // Exception: use bomb to secure the trick if opponent has called tichu
    if (opponentTichu && bombs.length > 0 && trickPts >= 10) {
      bombs.sort((a, b) => a.rank - b.rank);
      return bombs[0];
    }
    return 'pass';
  }

  // ── Opponent winning (or dragon present) ──

  if (nonBombs.length > 0) {
    // Don't waste 3+ card combos on a 0-point trick with no tichu threat
    if (trickPts === 0 && !opponentTichu && !dragonInTrick) {
      const cheap = nonBombs.filter(m => m.length <= 2);
      if (cheap.length > 0) { cheap.sort((a, b) => a.rank - b.rank); return cheap[0]; }
      return 'pass'; // would need big combo on a worthless trick
    }
    nonBombs.sort((a, b) => a.rank - b.rank);
    return nonBombs[0];
  }

  // Only bombs left — use when justified
  const bombJustified = trickPts >= 15 || hand.length <= 5 || opponentTichu || dragonInTrick;
  if (bombs.length > 0 && bombJustified) {
    bombs.sort((a, b) => a.rank - b.rank);
    return bombs[0];
  }

  return 'pass';
}

function decideDragonGive(players, myId, roundState) {
  const myTeam = players.find(p => p.id === myId)?.teamIndex;
  const finishOrder = roundState.finishOrder || [];
  const alive = players.filter(p => p.teamIndex !== myTeam && !finishOrder.includes(p.id));
  const opponents = alive.length > 0 ? alive : players.filter(p => p.teamIndex !== myTeam);
  if (opponents.length === 0) return players.find(p => p.teamIndex !== myTeam)?.id;
  // Give to the opponent with MORE cards remaining — they're further from finishing,
  // so giving them the lead next is less immediately dangerous for us.
  let target = opponents[0], maxCards = -1;
  for (const opp of opponents) {
    const n = (roundState.hands?.[opp.id] || []).length;
    if (n > maxCards) { maxCards = n; target = opp; }
  }
  return target.id;
}

export { decideFollow, decideDragonGive };
