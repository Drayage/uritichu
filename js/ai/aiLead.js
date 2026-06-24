import { getValidMoves } from '../engine/combinations.js';

function decideLead(hand, roundState, myId) {
  const { wishRank } = roundState;
  const moves = getValidMoves(hand, null, wishRank);
  if (moves.length === 0) return null;
  if (wishRank) {
    const wishMoves = moves.filter(m =>
      m.cards.some(c => c.rank === wishRank || String(c.numericValue) === String(wishRank))
    );
    if (wishMoves.length > 0) return chooseLead(wishMoves, hand);
  }
  return chooseLead(moves, hand);
}

function chooseLead(moves, hand) {
  const n = hand.length;
  const endgame = n <= 5;

  // When almost out of cards, use bomb to secure the win
  if (n <= 3) { const bomb = moves.find(m => m.isBomb); if (bomb) return bomb; }

  const straights  = moves.filter(m => m.type === 'straight' && !m.isBomb);
  const steps      = moves.filter(m => m.type === 'steps');
  const fullhouses = moves.filter(m => m.type === 'fullhouse');
  const quads      = moves.filter(m => m.type === 'quad' && !m.isBomb);
  const triples    = moves.filter(m => m.type === 'triple');
  const pairs      = moves.filter(m => m.type === 'pair');
  const singles    = moves.filter(m => m.type === 'single' && !m.isBomb);

  // ── Endgame: empty hand as fast as possible ──
  if (endgame) {
    if (straights.length)  { straights.sort((a, b)  => b.length - a.length); return straights[0]; }
    if (steps.length)      { steps.sort((a, b)      => b.length - a.length); return steps[0]; }
    if (fullhouses.length) { fullhouses.sort((a, b) => b.rank   - a.rank);   return fullhouses[0]; }
    if (quads.length)      { quads.sort((a, b)      => b.rank   - a.rank);   return quads[0]; }
    if (triples.length)    { triples.sort((a, b)    => b.rank   - a.rank);   return triples[0]; }
    if (pairs.length)      { pairs.sort((a, b)      => b.rank   - a.rank);   return pairs[0]; }
    // Singles: highest first to try to win the trick
    const nonDragon = singles.filter(m => m.cards[0].rank !== 'dragon');
    const pool = nonDragon.length ? nonDragon : singles;
    pool.sort((a, b) => b.rank - a.rank);
    return pool[0] || moves[0];
  }

  // ── Normal game: prefer multi-card combos (clear hand efficiently) ──
  if (straights.length) {
    straights.sort((a, b) => b.length - a.length);
    return straights[0];
  }
  if (steps.length) {
    steps.sort((a, b) => b.length - a.length);
    return steps[0];
  }
  if (fullhouses.length) {
    fullhouses.sort((a, b) => b.rank - a.rank);
    return fullhouses[0];
  }
  // Lead pairs/triples before singles: harder to beat (requires matching combo type),
  // clears more cards per trick, and high pairs/triples are nearly unbeatable
  if (triples.length) {
    triples.sort((a, b) => b.rank - a.rank);
    return triples[0];
  }
  if (pairs.length) {
    pairs.sort((a, b) => b.rank - a.rank);
    return pairs[0];
  }

  // Singles: lead high to control the game and maintain the lead
  if (singles.length) {
    const nonDragon = singles.filter(m => m.cards[0].rank !== 'dragon');
    const pool = nonDragon.length ? nonDragon : singles;
    pool.sort((a, b) => b.rank - a.rank);
    return pool[0];
  }

  moves.sort((a, b) => a.length - b.length || a.rank - b.rank);
  return moves[0];
}

export { decideLead };
