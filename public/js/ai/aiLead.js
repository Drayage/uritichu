import { getValidMoves, getAllCombinations } from '../engine/combinations.js';
import { getHighCardContext } from './aiUtils.js';

// Count minimum combos needed to empty the given hand (greedy: largest first)
function minCombosNeeded(hand) {
  if (hand.length === 0) return 0;
  const moves = getAllCombinations(hand, null);
  if (moves.length === 0) return hand.length; // each card stuck alone
  // Greedy: pick biggest combo repeatedly
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
function remainingHandScore(hand, playedCards) {
  const playedIds = new Set(playedCards.map(c => c.id));
  const rem = hand.filter(c => !playedIds.has(c.id));
  if (rem.length === 0) return 1000; // best: empty hand (score as "very good")

  // Penalty for dead cards: non-special low cards (2–7) that appear alone
  // (not part of any 2+ card combo in remaining hand)
  const remCombos = getAllCombinations(rem, null);
  const inCombos = new Set();
  for (const m of remCombos) {
    if (m.cards.length >= 2) m.cards.forEach(c => inCombos.add(c.id));
  }
  let deadCardPenalty = 0;
  for (const c of rem) {
    if (inCombos.has(c.id)) continue;
    // Isolated card penalty scales with how unplayable it is
    if (c.rank === 'dog') deadCardPenalty += 4;       // dog stuck = bad
    else if (c.rank === 'mahjong') deadCardPenalty -= 2; // mahjong alone = OK (lead control)
    else if (c.isSpecial) deadCardPenalty += 1;
    else if (c.numericValue <= 4) deadCardPenalty += 3;  // very low isolated
    else if (c.numericValue <= 7) deadCardPenalty += 2;  // low isolated
    else if (c.numericValue <= 9) deadCardPenalty += 1;  // mid isolated
    // High singles (10+) are fine alone — can often win tricks
  }

  const combosNeeded = minCombosNeeded(rem);
  // Total score: fewer combos + fewer dead cards = better
  return combosNeeded * 3 + deadCardPenalty;
}

function decideLead(hand, roundState, myId) {
  const { wishRank } = roundState;
  const moves = getValidMoves(hand, null, wishRank);
  if (moves.length === 0) return null;
  if (wishRank) {
    const wishMoves = moves.filter(m =>
      m.cards.some(c => c.rank === wishRank || String(c.numericValue) === String(wishRank))
    );
    if (wishMoves.length > 0) return chooseLead(wishMoves, hand, roundState);
  }
  return chooseLead(moves, hand, roundState);
}

function chooseLead(moves, hand, roundState) {
  const n = hand.length;
  const endgame = n <= 5;

  // When almost out of cards, use bomb to secure the win
  if (n <= 3) { const bomb = moves.find(m => m.isBomb); if (bomb) return bomb; }

  const straights  = moves.filter(m => m.type === 'straight' && !m.isBomb);
  const steps      = moves.filter(m => m.type === 'steps');
  const fullhouses = moves.filter(m => m.type === 'fullhouse');
  const triples    = moves.filter(m => m.type === 'triple');
  const pairs      = moves.filter(m => m.type === 'pair');
  const singles    = moves.filter(m => m.type === 'single' && !m.isBomb);

  // ── Endgame: empty hand as fast as possible ──
  if (endgame) {
    // Pick the move that minimizes remaining hand score
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

  // ── Normal game: prefer plays that leave the cleanest remaining hand ──

  // Straights: pick longest, then by remaining hand score
  if (straights.length) {
    straights.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      return remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards);
    });
    return straights[0];
  }

  if (steps.length) {
    steps.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      return remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards);
    });
    return steps[0];
  }

  if (fullhouses.length) {
    // Pick fullhouse that leaves cleanest remaining hand
    fullhouses.sort((a, b) => remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards));
    return fullhouses[0];
  }

  if (triples.length) {
    triples.sort((a, b) => remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards));
    return triples[0];
  }

  // Pairs: pick the pair that leaves the cleanest remaining hand
  if (pairs.length) {
    pairs.sort((a, b) => remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards));
    return pairs[0];
  }

  // Singles: use card counting to pick the smartest lead
  if (singles.length) {
    const nonDragon = singles.filter(m => m.cards[0].rank !== 'dragon');
    const pool = nonDragon.length ? nonDragon : singles;

    // If dragon is still unknown (not played yet) and we only have one ace,
    // leading that ace risks losing it to an opponent's dragon.
    // Prefer leading K in that case to test waters first.
    if (roundState) {
      const ctx = getHighCardContext(roundState);
      const myAces = hand.filter(c => c.rank === 'A');
      if (!ctx.dragonOut && myAces.length === 1) {
        const kings = pool.filter(m => m.cards[0].rank === 'K');
        if (kings.length > 0) {
          kings.sort((a, b) => remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards));
          return kings[0];
        }
      }
    }

    // Prefer single that leaves cleanest remaining hand
    // But don't lead a high single (A, K) when we have many low dead cards — play low first
    const deadCount = hand.filter(c => {
      if (c.isSpecial) return false;
      return c.numericValue <= 5;
    }).length;

    if (deadCount >= 2) {
      // Lead low singles to dispose of dead cards
      const lowPool = pool.filter(m => m.cards[0].numericValue <= 7 && !m.cards[0].isSpecial);
      if (lowPool.length > 0) {
        lowPool.sort((a, b) => remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards));
        return lowPool[0];
      }
    }

    pool.sort((a, b) => remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards) || b.rank - a.rank);
    return pool[0];
  }

  moves.sort((a, b) => remainingHandScore(hand, a.cards) - remainingHandScore(hand, b.cards) || a.length - b.length);
  return moves[0];
}

export { decideLead };
