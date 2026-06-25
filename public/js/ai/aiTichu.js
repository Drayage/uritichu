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
    // dog is a minor burden when racing to go out first
    else if (c.rank === 'dog')      score -= 1;
    if (!c.isSpecial) {
      counts[c.numericValue] = (counts[c.numericValue] || 0) + 1;
      values.push(c.numericValue);
    }
  }

  // Combo bonuses: bomb >> triple > pair
  for (const cnt of Object.values(counts)) {
    if (cnt >= 4)      score += 8;  // bomb — nearly guarantees a trick
    else if (cnt === 3) score += 2;
    else if (cnt === 2) score += 1;
  }

  // Multiple aces give control over the single-card game
  const aceCount = hand.filter(c => c.rank === 'A').length;
  if (aceCount >= 2) score += aceCount;

  // Long straight potential: the longer, the more cards cleared at once
  const sortedVals = [...new Set(values)].sort((a, b) => a - b);
  let maxRun = 1, curRun = 1;
  for (let i = 1; i < sortedVals.length; i++) {
    if (sortedVals[i] === sortedVals[i - 1] + 1) { curRun++; maxRun = Math.max(maxRun, curRun); }
    else curRun = 1;
  }
  if (maxRun >= 5) score += maxRun - 2;  // +3 for 5-card run, +4 for 6-card, etc.

  // Lead control: count how many times we can reliably grab the lead.
  // Tichu requires enough lead control to be first out consistently.
  let leadControl = 0;
  for (const cnt of Object.values(counts)) if (cnt >= 4) leadControl += 6; // bomb
  if (hand.some(c => c.rank === 'mahjong')) leadControl += 4; // guaranteed first lead
  if (hand.some(c => c.rank === 'dragon'))  leadControl += 3;
  if (hand.some(c => c.rank === 'phoenix')) leadControl += 2;
  leadControl += hand.filter(c => c.rank === 'A').length * 1.5;
  // Long straights give big multi-card clears when leading
  if (maxRun >= 6) leadControl += 2;
  else if (maxRun >= 5) leadControl += 1;

  // Require at least 2 sure leads for tichu to be viable
  if (leadControl < 2) score -= 6;
  else if (leadControl >= 4) score += 3; // many lead opportunities = very good

  return score;
}

function shouldCallGrandTichu(hand8, partnerCalledGT = false) {
  return handStrength8(hand8) >= (partnerCalledGT ? 15 : 10);
}
function shouldCallTichu(hand14, partnerHasTichu = false) {
  return handStrength14(hand14) >= (partnerHasTichu ? 22 : 16);
}

export { shouldCallGrandTichu, shouldCallTichu };
