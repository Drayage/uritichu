import { getValidMoves } from '../engine/combinations.js';

function decideFollow(hand, roundState, myId, players) {
  const { currentTrick, wishRank, tichuCalls, grandTichuCalls, finishOrder, hands } = roundState;
  if (!currentTrick) return null;

  const winningCombo = currentTrick.winningCombo;
  const winnerId     = currentTrick.winnerId;

  const myPlayer = players.find(p => p.id === myId);
  const myTeam   = myPlayer?.teamIndex;
  const partnerSeat = myPlayer ? (myPlayer.seat + 2) % 4 : -1;
  const partnerId   = players.find(p => p.seat === partnerSeat)?.id;

  const partnerWinning = players.find(p => p.id === winnerId)?.teamIndex === myTeam;
  const winnerIsOpp    = winnerId && players.find(p => p.id === winnerId)?.teamIndex !== myTeam;

  const trickPts    = currentTrick.cards.reduce((s, c) => s + (c.pointValue || 0), 0);
  const dragonInTrick = currentTrick.cards.some(c => c.rank === 'dragon');

  const validMoves = getValidMoves(hand, winningCombo, wishRank);
  if (validMoves.length === 0) return 'pass';

  const nonBombs = validMoves.filter(m => !m.isBomb);
  const bombs    = validMoves.filter(m => m.isBomb);

  // Does any unfinished opponent have tichu/grand tichu called?
  const opponentTichu = players.some(p =>
    p.teamIndex !== myTeam &&
    !(finishOrder || []).includes(p.id) &&
    (tichuCalls?.[p.id] === true || grandTichuCalls?.[p.id] === true)
  );

  // Does our partner have tichu/grand tichu called and is still playing?
  const partnerHasTichu = !!(partnerId &&
    !(finishOrder || []).includes(partnerId) &&
    (grandTichuCalls?.[partnerId] === true || tichuCalls?.[partnerId] === true)
  );

  // Is the current trick winner an opponent who is about to finish (≤2 cards left)?
  const winnerCardsLeft  = winnerIsOpp && winnerId ? (hands?.[winnerId] || []).length : 99;
  const opponentNearDone = winnerIsOpp && winnerCardsLeft <= 2;

  // ── Partner winning ──
  if (partnerWinning && !dragonInTrick) {
    // Save cards — partner takes this trick for the team.
    // Exception: use lowest bomb if opponent has tichu and trick has value
    if (opponentTichu && bombs.length > 0 && trickPts >= 10) {
      bombs.sort((a, b) => a.rank - b.rank);
      return bombs[0];
    }
    return 'pass';
  }

  // ── Opponent winning (or dragon in trick) ──

  // Tichu blocking: partner has tichu and the winning opponent is about to go out.
  // Try hard to steal the trick — use any non-bomb, or even a bomb.
  if (partnerHasTichu && opponentNearDone) {
    if (nonBombs.length > 0) {
      nonBombs.sort((a, b) => a.rank - b.rank);
      return nonBombs[0];
    }
    if (bombs.length > 0) {
      bombs.sort((a, b) => a.rank - b.rank);
      return bombs[0];
    }
    return 'pass';
  }

  if (nonBombs.length > 0) {
    // Don't waste 3+ card combos on a 0-point trick with no threat
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
  const myTeam     = players.find(p => p.id === myId)?.teamIndex;
  const finishOrder = roundState.finishOrder || [];
  const alive      = players.filter(p => p.teamIndex !== myTeam && !finishOrder.includes(p.id));
  const opponents  = alive.length > 0 ? alive : players.filter(p => p.teamIndex !== myTeam);
  if (opponents.length === 0) return players.find(p => p.teamIndex !== myTeam)?.id;
  // Give to opponent with MORE cards — they're further from finishing, so giving them
  // the lead next is less immediately dangerous.
  let target = opponents[0], maxCards = -1;
  for (const opp of opponents) {
    const n = (roundState.hands?.[opp.id] || []).length;
    if (n > maxCards) { maxCards = n; target = opp; }
  }
  return target.id;
}

export { decideFollow, decideDragonGive };
