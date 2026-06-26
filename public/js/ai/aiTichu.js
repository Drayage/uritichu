function handStrength8(hand) {
  let score = 0;
  const counts = {};
  for (const c of hand) {
    if (c.rank === 'dragon')        score += 4;
    else if (c.rank === 'phoenix')  score += 3;
    else if (c.rank === 'A')        score += 3;
    else if (c.rank === 'K')        score += 2;
    else if (c.rank === 'Q')        score += 1;
    else if (c.rank === '2' || c.rank === '3') score -= 1;
    else if (c.rank === 'dog')      score -= 2;
    counts[c.numericValue] = (counts[c.numericValue] || 0) + 1;
  }
  for (const v of Object.values(counts)) if (v >= 4) score += 5;
  return score;
}

function handStrength14(hand) {
  let score = 0;
  const counts = {};
  const values = [];

  for (const c of hand) {
    if (c.rank === 'dragon')        score += 5;
    else if (c.rank === 'phoenix')  score += 4;
    else if (c.rank === 'A')        score += 3;
    else if (c.rank === 'K')        score += 2;
    else if (c.rank === 'Q')        score += 1;
    else if (c.rank === '2' || c.rank === '3') score -= 0.5;
    else if (c.rank === 'dog')      score -= 1;
    if (!c.isSpecial) {
      counts[c.numericValue] = (counts[c.numericValue] || 0) + 1;
      values.push(c.numericValue);
    }
  }

  // Combo bonuses: bomb >> triple > pair
  for (const cnt of Object.values(counts)) {
    if (cnt >= 4)       score += 8;
    else if (cnt === 3) score += 2;
    else if (cnt === 2) score += 1;
  }

  // Multiple aces
  const aceCount = hand.filter(c => c.rank === 'A').length;
  if (aceCount >= 2) score += aceCount;

  // Long straight potential
  const sortedVals = [...new Set(values)].sort((a, b) => a - b);
  let maxRun = 1, curRun = 1;
  for (let i = 1; i < sortedVals.length; i++) {
    if (sortedVals[i] === sortedVals[i - 1] + 1) { curRun++; maxRun = Math.max(maxRun, curRun); }
    else curRun = 1;
  }
  // Long straights let you clear dead cards in one lead: give extra bonus
  if (maxRun >= 6) score += 2;
  else if (maxRun >= 5) score += 1;

  // ── Lead cards vs Dead cards ─────────────────────────────────────────────
  // Lead cards: cards that near-guarantee taking the lead (~1 lead each).
  // Each dead card needs one lead to get played out, so net = leadCards - deadCards.
  let leadCards = 0;
  for (const cnt of Object.values(counts)) if (cnt >= 4) leadCards += 2; // bomb = 2 leads
  if (hand.some(c => c.rank === 'mahjong')) leadCards += 1;
  if (hand.some(c => c.rank === 'dragon'))  leadCards += 1;
  if (hand.some(c => c.rank === 'phoenix')) leadCards += 1;
  leadCards += aceCount;

  // Dead cards: isolated low cards (≤5) with no adjacent value and no pair
  let deadCards = 0;
  for (const v of sortedVals) {
    if (v > 5) continue;
    const hasNeighbor = sortedVals.includes(v - 1) || sortedVals.includes(v + 1)
                     || (counts[v] >= 2);
    if (!hasNeighbor) deadCards++;
  }

  const leadNet = leadCards - deadCards;
  if      (leadNet >= 4)  score += 6;
  else if (leadNet >= 3)  score += 4;
  else if (leadNet >= 2)  score += 2;
  else if (leadNet === 1) score += 0;
  else if (leadNet === 0) score -= 3;
  else                    score -= 6; // dead cards > lead cards → tichu is very risky

  return score;
}

function shouldCallGrandTichu(hand8, partnerCalledGT = false) {
  return handStrength8(hand8) >= (partnerCalledGT ? 18 : 12);
}
function shouldCallTichu(hand14, partnerHasTichu = false) {
  return handStrength14(hand14) >= (partnerHasTichu ? 26 : 19);
}

export { shouldCallGrandTichu, shouldCallTichu };
