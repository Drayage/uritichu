'use strict';

function handStrength8(hand) {
  let score = 0;
  for (const c of hand) {
    if (c.rank === 'dragon') score += 4;
    else if (c.rank === 'phoenix') score += 3;
    else if (c.rank === 'A') score += 3;
    else if (c.rank === 'K') score += 2;
    else if (c.rank === 'Q') score += 1;
    else if (c.rank === '2' || c.rank === '3') score -= 1;
    else if (c.rank === 'dog') score -= 2;
  }
  // bonus for quad bomb in 8 cards
  const counts = {};
  for (const c of hand) counts[c.numericValue] = (counts[c.numericValue] || 0) + 1;
  for (const v of Object.values(counts)) if (v >= 4) score += 5;
  return score;
}

function handStrength14(hand) {
  let score = handStrength8(hand);
  // Check for bomb potential
  const counts = {};
  for (const c of hand) {
    if (!c.isSpecial) counts[c.numericValue] = (counts[c.numericValue] || 0) + 1;
  }
  for (const v of Object.values(counts)) {
    if (v === 4) score += 4;
    else if (v === 3) score += 1;
  }
  return score;
}

function shouldCallGrandTichu(hand8) {
  return handStrength8(hand8) >= 10;
}

function shouldCallTichu(hand14) {
  return handStrength14(hand14) >= 14;
}

module.exports = { shouldCallGrandTichu, shouldCallTichu };
