import { getValidMoves, getAllCombinations } from '../engine/combinations.js';

// Count minimum combos needed to empty the given hand (greedy: largest first)
function minCombosNeeded(hand) {
  if (hand.length === 0) return 0;
  const moves = getAllCombinations(hand, null);
  if (moves.length === 0) return hand.length;
  let remaining = [...hand];
  let count = 0;
  while (remaining.length > 0) {
    const avail = getAllCombinations(remaining, null);
    if (avail.length === 0) { count += remaining.length; break; }
    avail.sort((a, b) => b.cards.length - a.cards.length || b.rank - a.rank);
    const best = avail[0];
    const usedIds = new Set(best.cards.map(c => c.id));
    remaining = remaining.filter(c => !usedIds.has(c.id));
    count++;
  }
  return count;
}

// Score remaining hand quality after removing playedCards.
// Lower is better (fewer isolated dead cards, fewer combos needed).
// 0 = perfect (empty hand).
function remainingHandScore(hand, playedCards) {
  const playedIds = new Set(playedCards.map(c => c.id));
  const rem = hand.filter(c => !playedIds.has(c.id));
  if (rem.length === 0) return 0; // best: empty hand

  const remCombos = getAllCombinations(rem, null);
  const inCombos = new Set();
  for (const m of remCombos) {
    if (m.cards.length >= 2) m.cards.forEach(c => inCombos.add(c.id));
  }
  let deadCardPenalty = 0;
  let remDeadCount = 0;
  for (const c of rem) {
    if (inCombos.has(c.id)) continue;
    if (c.rank === 'dog')      deadCardPenalty += 4;
    else if (c.rank === 'mahjong') deadCardPenalty -= 2;
    else if (c.isSpecial)      deadCardPenalty += 1;
    else if (c.numericValue <= 3) deadCardPenalty += 4;
    else if (c.numericValue <= 5) deadCardPenalty += 3;
    else if (c.numericValue <= 7) deadCardPenalty += 2;
    else if (c.numericValue <= 9) deadCardPenalty += 1;
    if (!c.isSpecial && c.numericValue <= 5) remDeadCount++;
  }

  const combosNeeded = minCombosNeeded(rem);
  let base = combosNeeded * 3 + deadCardPenalty;

  // Lead-waste penalty: playing 2+ lead cards (A/dragon/phoenix) in one combo burns
  // lead opportunities needed to clear dead cards later.
  const leadCardsInPlay = playedCards.filter(c =>
    c.rank === 'A' || c.rank === 'dragon' || c.rank === 'phoenix'
  ).length;
  if (leadCardsInPlay >= 2 && remDeadCount > 0) {
    base += remDeadCount * 3;
  }

  // Stuck penalty: if ALL remaining non-special cards are low (≤5), we have no
  // high cards to win future leads. This is a critical trap.
  const remNonSpecial = rem.filter(c => !c.isSpecial);
  if (remNonSpecial.length > 0 && remNonSpecial.every(c => c.numericValue <= 5)) {
    base += 14;
  }

  return base;
}

// Find next active (non-finished) player clockwise from myId
function getNextActivePlayer(myId, roundState, players) {
  if (!players) return null;
  const seats = players.map(p => p.seat).sort((a, b) => a - b);
  const me = players.find(p => p.id === myId);
  if (!me) return null;
  let seatIdx = seats.indexOf(me.seat);
  for (let i = 0; i < 4; i++) {
    seatIdx = (seatIdx + 1) % 4;
    const next = players.find(p => p.seat === seats[seatIdx]);
    if (next && !(roundState.finishOrder || []).includes(next.id) && next.id !== myId) return next;
  }
  return null;
}

function decideLead(hand, roundState, myId, players) {
  const { wishRank } = roundState;
  const moves = getValidMoves(hand, null, wishRank);
  if (moves.length === 0) return null;
  if (wishRank) {
    const wishMoves = moves.filter(m =>
      m.cards.some(c => c.rank === wishRank || String(c.numericValue) === String(wishRank))
    );
    if (wishMoves.length > 0) return chooseLead(wishMoves, hand, roundState, myId, players);
  }
  return chooseLead(moves, hand, roundState, myId, players);
}

function chooseLead(moves, hand, roundState, myId, players) {
  const n = hand.length;
  const endgame = n <= 5;

  if (n <= 3) { const bomb = moves.find(m => m.isBomb); if (bomb) return bomb; }

  const straights  = moves.filter(m => m.type === 'straight' && !m.isBomb);
  const steps      = moves.filter(m => m.type === 'steps');
  const fullhouses = moves.filter(m => m.type === 'fullhouse');
  const triples    = moves.filter(m => m.type === 'triple');
  const pairs      = moves.filter(m => m.type === 'pair');
  const singles    = moves.filter(m => m.type === 'single' && !m.isBomb);

  // Check next player's hand size to avoid dangerous leads
  const nextPlayer = getNextActivePlayer(myId, roundState, players);
  const nextHandSize = nextPlayer ? (roundState.hands?.[nextPlayer.id] || []).length : 99;
  const nextVeryClose = nextHandSize <= 2; // next player is almost done

  // ── Endgame: empty hand as fast as possible ──
  if (endgame) {
    const candidates = [...straights, ...steps, ...fullhouses, ...triples, ...pairs, ...singles];
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const sa = remainingHandScore(hand, a.cards);
        const sb = remainingHandScore(hand, b.cards);
        if (sa !== sb) return sa - sb;
        return b.cards.length - a.cards.length || b.rank - a.rank;
      });
      return candidates[0];
    }
    return moves[0];
  }

  // ── When next player is nearly done: lead multi-card combos they can't follow ──
  if (nextVeryClose) {
    // Multi-card combos: next player can't follow a pair/triple/straight with 1 card
    const multiCard = [...straights, ...steps, ...fullhouses, ...triples, ...pairs];
    if (multiCard.length > 0) {
      multiCard.sort((a, b) => {
        const sa = remainingHandScore(hand, a.cards);
        const sb = remainingHandScore(hand, b.cards);
        if (sa !== sb) return sa - sb;
        return b.cards.length - a.cards.length || b.rank - a.rank;
      });
      return multiCard[0];
    }
    // Only singles available: prefer high ones they likely can't beat
    if (singles.length > 0) {
      const high = singles.filter(m =>
        m.cards[0].rank === 'dragon' || m.cards[0].rank === 'phoenix' ||
        m.cards[0].rank === 'A' || (m.cards[0].numericValue && m.cards[0].numericValue >= 13)
      );
      const pool = high.length > 0 ? high : singles;
      pool.sort((a, b) => remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards));
      return pool[0];
    }
    return moves[0];
  }

  // ── Normal game: prefer plays that leave the cleanest remaining hand ──

  // Straights: use remainingHandScore as primary, length as tiebreaker.
  // This avoids playing an overly long straight that leaves only dead cards.
  if (straights.length) {
    straights.sort((a, b) => {
      const sa = remainingHandScore(hand, a.cards);
      const sb = remainingHandScore(hand, b.cards);
      if (sa !== sb) return sa - sb;
      return b.cards.length - a.cards.length || b.rank - a.rank;
    });
    return straights[0];
  }

  if (steps.length) {
    steps.sort((a, b) => {
      const sa = remainingHandScore(hand, a.cards);
      const sb = remainingHandScore(hand, b.cards);
      if (sa !== sb) return sa - sb;
      return b.cards.length - a.cards.length || b.rank - a.rank;
    });
    return steps[0];
  }

  if (fullhouses.length) {
    fullhouses.sort((a, b) => remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards));
    return fullhouses[0];
  }

  if (triples.length) {
    triples.sort((a, b) => remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards));
    return triples[0];
  }

  if (pairs.length) {
    pairs.sort((a, b) => remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards));
    const bestPair = pairs[0];

    if (singles.length > 0) {
      const pairCardRank = bestPair.cards[0].rank;
      const altSingle = singles.find(m =>
        m.cards[0].rank === pairCardRank && m.cards[0].rank !== 'dragon'
      );
      if (altSingle) {
        const pairScore   = remainingHandScore(hand, bestPair.cards);
        const singleScore = remainingHandScore(hand, altSingle.cards);
        if (singleScore < pairScore - 3) return altSingle;
      }
    }
    return bestPair;
  }

  // Singles: avoid leading Dragon/Phoenix/A — save those for stealing opponent tricks.
  if (singles.length) {
    const nonHigh = singles.filter(m => {
      const rank = m.cards[0].rank;
      return rank !== 'dragon' && rank !== 'phoenix' && rank !== 'A';
    });
    const midPool = nonHigh.length > 0
      ? nonHigh
      : singles.filter(m => m.cards[0].rank !== 'dragon' && m.cards[0].rank !== 'phoenix');
    const pool = midPool.length > 0 ? midPool : singles;

    const deadCount = hand.filter(c => !c.isSpecial && c.numericValue <= 5).length;
    if (deadCount >= 1) {
      const lowPool = pool.filter(m => m.cards[0].numericValue <= 8 && !m.cards[0].isSpecial);
      if (lowPool.length > 0) {
        lowPool.sort((a, b) => remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards));
        return lowPool[0];
      }
    }

    pool.sort((a, b) => remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards) || a.rank - b.rank);
    return pool[0];
  }

  moves.sort((a, b) => remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards) || a.length - b.length);
  return moves[0];
}

export { decideLead };
