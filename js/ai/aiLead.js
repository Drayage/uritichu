import { getValidMoves } from '../engine/combinations.js';

function decideLead(hand, roundState, myId) {
  const { wishRank } = roundState;
  const moves = getValidMoves(hand, null, wishRank);
  if (moves.length === 0) return null;
  if (wishRank) {
    const wishMoves = moves.filter(m => m.cards.some(c => c.rank === wishRank || String(c.numericValue) === String(wishRank)));
    if (wishMoves.length > 0) return chooseLead(wishMoves, hand);
  }
  return chooseLead(moves, hand);
}

function chooseLead(moves, hand) {
  if (hand.length <= 4) { const bomb = moves.find(m => m.isBomb); if (bomb) return bomb; }
  const straights = moves.filter(m => m.type === 'straight' && !m.isBomb);
  if (straights.length > 0) { straights.sort((a, b) => b.length - a.length); return straights[0]; }
  const steps = moves.filter(m => m.type === 'steps');
  if (steps.length > 0) { steps.sort((a, b) => b.length - a.length); return steps[0]; }
  const fullhouses = moves.filter(m => m.type === 'fullhouse');
  if (fullhouses.length > 0) return fullhouses[0];
  const singles = moves.filter(m => m.type === 'single' && !m.isBomb);
  if (singles.length > 0) {
    const nonDragon = singles.filter(m => m.cards[0].rank !== 'dragon');
    if (nonDragon.length > 0) { nonDragon.sort((a, b) => b.rank - a.rank); return nonDragon[0]; }
    return singles[singles.length - 1];
  }
  moves.sort((a, b) => a.length - b.length);
  return moves[0];
}

export { decideLead };
