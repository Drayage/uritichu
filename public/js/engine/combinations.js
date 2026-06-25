const TYPE = {
  SINGLE: 'single', PAIR: 'pair', TRIPLE: 'triple', STEPS: 'steps',
  FULLHOUSE: 'fullhouse', STRAIGHT: 'straight', BOMB_QUAD: 'bomb_quad', BOMB_SF: 'bomb_sf',
};

const isPhoenix = c => c.rank === 'phoenix';
const isDragon  = c => c.rank === 'dragon';
const isDog     = c => c.rank === 'dog';

function groupByValue(cards) {
  const map = new Map();
  for (const c of cards) {
    if (!isPhoenix(c)) {
      if (!map.has(c.numericValue)) map.set(c.numericValue, []);
      map.get(c.numericValue).push(c);
    }
  }
  return map;
}

function detectCombination(cards) {
  if (!cards || cards.length === 0) return null;
  const hasPhoenix = cards.some(isPhoenix);
  const std = cards.filter(c => !isPhoenix(c));
  const sorted = [...std].sort((a, b) => a.numericValue - b.numericValue);

  if (cards.length === 1) {
    const c = cards[0];
    if (c.rank === 'dog') return { type: TYPE.SINGLE, cards, rank: 0, length: 1, isBomb: false };
    if (c.rank === 'dragon') return { type: TYPE.SINGLE, cards, rank: 16, length: 1, isBomb: false };
    if (c.rank === 'mahjong') return { type: TYPE.SINGLE, cards, rank: 1, length: 1, isBomb: false };
    if (isPhoenix(c)) return { type: TYPE.SINGLE, cards, rank: -1, length: 1, isBomb: false };
    return { type: TYPE.SINGLE, cards, rank: c.numericValue, length: 1, isBomb: false };
  }

  if (cards.some(isDog) || cards.some(isDragon)) return null;

  const len = cards.length;
  if (len === 2) return detectPair(sorted, hasPhoenix, cards);
  if (len === 3) return detectTriple(sorted, hasPhoenix, cards);
  if (len === 4) return detectLen4(sorted, hasPhoenix, cards);
  if (len === 5) return detectLen5(sorted, hasPhoenix, cards);
  if (len >= 6) return detectLen6Plus(sorted, hasPhoenix, cards);
  return null;
}

function detectPair(sorted, hasPhoenix, orig) {
  if (sorted.length === 2 && !hasPhoenix && sorted[0].numericValue === sorted[1].numericValue)
    return { type: TYPE.PAIR, cards: orig, rank: sorted[0].numericValue, length: 2, isBomb: false };
  if (sorted.length === 1 && hasPhoenix)
    return { type: TYPE.PAIR, cards: orig, rank: sorted[0].numericValue, length: 2, isBomb: false };
  return null;
}

function detectTriple(sorted, hasPhoenix, orig) {
  if (sorted.length === 3 && !hasPhoenix && sorted.every(c => c.numericValue === sorted[0].numericValue))
    return { type: TYPE.TRIPLE, cards: orig, rank: sorted[0].numericValue, length: 3, isBomb: false };
  if (sorted.length === 2 && hasPhoenix && sorted[0].numericValue === sorted[1].numericValue)
    return { type: TYPE.TRIPLE, cards: orig, rank: sorted[0].numericValue, length: 3, isBomb: false };
  return null;
}

function detectLen4(sorted, hasPhoenix, orig) {
  if (!hasPhoenix && sorted.length === 4 && sorted.every(c => c.numericValue === sorted[0].numericValue))
    return { type: TYPE.BOMB_QUAD, cards: orig, rank: sorted[0].numericValue, length: 4, isBomb: true };
  // Phoenix + 2 same rank = triple (logical length 3, not 4)
  if (hasPhoenix && sorted.length === 3 && sorted.every(c => c.numericValue === sorted[0].numericValue))
    return { type: TYPE.TRIPLE, cards: orig, rank: sorted[0].numericValue, length: 3, isBomb: false };
  // 4-card steps (2 consecutive pairs), e.g. 3-3-4-4 or 3-4-4+phoenix
  const steps = trySteps(sorted, hasPhoenix, 4);
  if (steps) return { type: TYPE.STEPS, cards: orig, rank: steps.topRank, length: 4, isBomb: false };
  return null;
}

function detectLen5(sorted, hasPhoenix, orig) {
  const fh = detectFullHouse(sorted, hasPhoenix, orig);
  if (fh) return fh;
  if (!hasPhoenix && allSameSuit(sorted)) {
    const st = isStraightSeq(sorted, false);
    if (st) return { type: TYPE.BOMB_SF, cards: orig, rank: st.topRank * 100 + 5, length: 5, isBomb: true };
  }
  const st = tryStraight(sorted, hasPhoenix);
  if (st) return { type: TYPE.STRAIGHT, cards: orig, rank: st.topRank, length: 5, isBomb: false };
  return null;
}

function detectLen6Plus(sorted, hasPhoenix, orig) {
  const len = orig.length;
  if (!hasPhoenix && allSameSuit(sorted)) {
    const st = isStraightSeq(sorted, false);
    if (st) return { type: TYPE.BOMB_SF, cards: orig, rank: st.topRank * 100 + len, length: len, isBomb: true };
  }
  if (len % 2 === 0 && len >= 4) {
    const steps = trySteps(sorted, hasPhoenix, len);
    if (steps) return { type: TYPE.STEPS, cards: orig, rank: steps.topRank, length: len, isBomb: false };
  }
  const st = tryStraight(sorted, hasPhoenix);
  if (st) return { type: TYPE.STRAIGHT, cards: orig, rank: st.topRank, length: len, isBomb: false };
  return null;
}

function detectFullHouse(sorted, hasPhoenix, orig) {
  if (orig.length !== 5) return null;
  const groups = groupByValue(orig);
  const vals = [...groups.keys()].sort((a, b) => a - b);
  if (!hasPhoenix) {
    if (vals.length !== 2) return null;
    const [v1, v2] = vals;
    const c1 = groups.get(v1).length, c2 = groups.get(v2).length;
    if (c1 === 3 && c2 === 2) return { type: TYPE.FULLHOUSE, cards: orig, rank: v1, length: 5, isBomb: false };
    if (c1 === 2 && c2 === 3) return { type: TYPE.FULLHOUSE, cards: orig, rank: v2, length: 5, isBomb: false };
    return null;
  }
  if (vals.length === 2) {
    const [v1, v2] = vals;
    const c1 = groups.get(v1).length, c2 = groups.get(v2).length;
    if (c1 === 3 && c2 === 1) return { type: TYPE.FULLHOUSE, cards: orig, rank: v1, length: 5, isBomb: false };
    if (c1 === 1 && c2 === 3) return { type: TYPE.FULLHOUSE, cards: orig, rank: v2, length: 5, isBomb: false };
    if (c1 === 2 && c2 === 2) return { type: TYPE.FULLHOUSE, cards: orig, rank: v2, length: 5, isBomb: false };
  }
  if (vals.length === 1) return { type: TYPE.FULLHOUSE, cards: orig, rank: vals[0], length: 5, isBomb: false };
  return null;
}

function allSameSuit(sorted) {
  const s = sorted[0].suit;
  return s && sorted.every(c => c.suit === s);
}

function isStraightSeq(sorted, allowGap) {
  if (sorted.some(isDragon) || sorted.some(isDog)) return null;
  let gaps = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i].numericValue - sorted[i-1].numericValue;
    if (diff === 1) continue;
    if (diff === 2 && allowGap && gaps === 0) { gaps++; continue; }
    return null;
  }
  return { topRank: sorted[sorted.length - 1].numericValue, gaps };
}

function tryStraight(sorted, hasPhoenix) {
  if (sorted.some(isDragon) || sorted.some(isDog)) return null;
  const result = isStraightSeq(sorted, hasPhoenix);
  if (!result || (!hasPhoenix && result.gaps > 0)) return null;
  return result;
}

function trySteps(sorted, hasPhoenix, totalLen) {
  const gmap = new Map();
  for (const c of sorted) {
    if (!gmap.has(c.numericValue)) gmap.set(c.numericValue, 0);
    gmap.set(c.numericValue, gmap.get(c.numericValue) + 1);
  }
  const numPairs = totalLen / 2;
  let phoenixUsed = false;
  const pairs = [];
  for (const [v, count] of [...gmap.entries()].sort((a, b) => a[0] - b[0])) {
    if (count === 2) pairs.push(v);
    else if (count === 1 && hasPhoenix && !phoenixUsed) { pairs.push(v); phoenixUsed = true; }
    else return null;
  }
  if (pairs.length !== numPairs) return null;
  for (let i = 1; i < pairs.length; i++) if (pairs[i] !== pairs[i-1] + 1) return null;
  return { topRank: pairs[pairs.length - 1] };
}

function canBeat(incoming, current) {
  if (!current) return true;
  if (incoming.isBomb && !current.isBomb) return true;
  if (!incoming.isBomb && current.isBomb) return false;
  if (incoming.isBomb && current.isBomb) {
    if (incoming.type === TYPE.BOMB_SF && current.type === TYPE.BOMB_QUAD) return true;
    if (incoming.type === TYPE.BOMB_QUAD && current.type === TYPE.BOMB_SF) return false;
    if (incoming.type === TYPE.BOMB_SF && current.type === TYPE.BOMB_SF) {
      if (incoming.length !== current.length) return incoming.length > current.length;
      return incoming.rank > current.rank;
    }
    return incoming.rank > current.rank;
  }
  if (incoming.type !== current.type || incoming.length !== current.length) return false;
  if (incoming.type === TYPE.SINGLE) {
    if (incoming.rank === 16) return current.rank !== 16;
    if (incoming.rank === -1) return current.rank < 16;
    return incoming.rank > current.rank;
  }
  return incoming.rank > current.rank;
}

function phoenixSingleRank(currentRank) {
  return currentRank === null ? 1.5 : currentRank + 0.5;
}

function getValidMoves(hand, currentCombo, wishRank) {
  const hasWishedCard = (m) => m.cards.some(c => c.rank === wishRank || String(c.numericValue) === String(wishRank));

  if (!currentCombo) {
    // Lead turn: bombs don't exempt from wish obligation; must lead with wish rank if possible
    const all = getAllCombinations(hand, null);
    if (wishRank) {
      const withWish = all.filter(hasWishedCard);
      if (withWish.length > 0) return withWish;
    }
    return all;
  }

  const moves = [];
  const bombs = getBombs(hand);
  for (const b of bombs) if (canBeat(b, currentCombo)) moves.push(b);

  const candidates = getCombinationsOfType(hand, currentCombo.type, currentCombo.length);
  for (const combo of candidates) if (canBeat(combo, currentCombo)) moves.push(combo);

  if (wishRank) {
    // Non-bomb moves that beat AND contain wished rank
    const normalWithWish = moves.filter(m => !m.isBomb && hasWishedCard(m));
    if (normalWithWish.length > 0) {
      // Must play wish-fulfilling, OR can bomb to escape temporarily
      return [...normalWithWish, ...moves.filter(m => m.isBomb)];
    }
    // Bomb is the only way to contain wished rank (e.g., quad-bomb of that rank)
    const bombWithWish = moves.filter(m => m.isBomb && hasWishedCard(m));
    if (bombWithWish.length > 0) return bombWithWish;
  }
  return moves;
}

function getBombs(hand) {
  const bombs = [];
  const groups = new Map();
  for (const c of hand) {
    if (c.isSpecial) continue;
    if (!groups.has(c.numericValue)) groups.set(c.numericValue, []);
    groups.get(c.numericValue).push(c);
  }
  // Quad bombs
  for (const [, cards] of groups) {
    if (cards.length === 4) { const combo = detectCombination(cards); if (combo) bombs.push(combo); }
  }
  // Straight flush bombs (outside the groups loop to avoid duplicate scanning)
  for (const suit of ['jade','sword','pagoda','star']) {
    const sc = hand.filter(c => c.suit === suit && !c.isSpecial);
    if (sc.length >= 5) bombs.push(...findStraightFlushBombs(sc));
  }
  const seen = new Set();
  return bombs.filter(b => {
    const key = b.cards.map(c=>c.id).sort().join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findStraightFlushBombs(suitCards) {
  const sorted = [...suitCards].sort((a,b) => a.numericValue - b.numericValue);
  const bombs = [];
  for (let i = 0; i < sorted.length - 4; i++) {
    for (let j = i + 4; j < sorted.length; j++) {
      const subset = sorted.slice(i, j + 1);
      let ok = true;
      for (let k = 1; k < subset.length; k++) {
        if (subset[k].numericValue !== subset[k-1].numericValue + 1) { ok = false; break; }
      }
      if (ok) bombs.push({ type: TYPE.BOMB_SF, cards: subset, rank: subset[subset.length-1].numericValue * 100 + subset.length, length: subset.length, isBomb: true });
    }
  }
  return bombs;
}

function getAllCombinations(hand, wishRank) {
  const combos = [];
  const n = hand.length;
  for (const c of hand) combos.push(detectCombination([c]));
  for (let i = 0; i < n; i++)
    for (let j = i+1; j < n; j++) { const c = detectCombination([hand[i], hand[j]]); if (c && c.type === TYPE.PAIR) combos.push(c); }
  for (let i = 0; i < n; i++)
    for (let j = i+1; j < n; j++)
      for (let k = j+1; k < n; k++) { const c = detectCombination([hand[i], hand[j], hand[k]]); if (c && c.type === TYPE.TRIPLE) combos.push(c); }
  combos.push(...getBombs(hand), ...getStraights(hand), ...getSteps(hand), ...getFullHouses(hand));
  const valid = combos.filter(Boolean);
  if (wishRank) {
    const w = valid.filter(m => m.cards.some(c => c.rank === wishRank || String(c.numericValue) === wishRank));
    if (w.length > 0) return w;
  }
  return valid;
}

function getCombinationsOfType(hand, type, length) {
  const combos = [];
  const n = hand.length;
  if (type === TYPE.SINGLE) {
    for (const c of hand) { const r = detectCombination([c]); if (r && r.type === TYPE.SINGLE) combos.push(r); }
  } else if (type === TYPE.PAIR) {
    for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++) { const c = detectCombination([hand[i], hand[j]]); if (c && c.type === TYPE.PAIR) combos.push(c); }
  } else if (type === TYPE.TRIPLE) {
    for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++) for (let k = j+1; k < n; k++) { const c = detectCombination([hand[i], hand[j], hand[k]]); if (c && c.type === TYPE.TRIPLE) combos.push(c); }
  } else if (type === TYPE.FULLHOUSE) combos.push(...getFullHouses(hand));
  else if (type === TYPE.STRAIGHT) combos.push(...getStraights(hand, length));
  else if (type === TYPE.STEPS) combos.push(...getSteps(hand, length));
  return combos;
}

function getStraights(hand, requiredLength) {
  const results = [];
  const eligible = hand.filter(c => !isDragon(c) && !isDog(c));
  const phoenix = hand.find(isPhoenix);
  const std = eligible.filter(c => !isPhoenix(c));
  const sorted = [...std].sort((a, b) => a.numericValue - b.numericValue);
  const vals = [...new Set(sorted.map(c => c.numericValue))];
  const minLen = requiredLength || 5;
  const maxLen = requiredLength || 14;

  for (let len = minLen; len <= maxLen && len <= sorted.length + (phoenix ? 1 : 0); len++) {
    if (requiredLength && len !== requiredLength) continue;
    for (let startIdx = 0; startIdx < vals.length; startIdx++) {
      const window = [];
      let needed = len, phoenixUsed = false, valid = true, prev = null;
      for (let pos = startIdx; needed > 0; pos++) {
        if (pos >= vals.length) {
          if (phoenix && !phoenixUsed && needed === 1) { window.push(phoenix); phoenixUsed = true; needed--; }
          else { valid = false; break; }
        } else {
          const cur = vals[pos];
          if (prev !== null && cur !== prev + 1) {
            if (cur === prev + 2 && phoenix && !phoenixUsed) {
              const card = sorted.find(c => c.numericValue === cur);
              if (!card) { valid = false; break; }
              window.push(phoenix); phoenixUsed = true; window.push(card); needed -= 2; prev = cur;
            } else { valid = false; break; }
          } else {
            const card = sorted.find(c => c.numericValue === cur);
            if (!card) { valid = false; break; }
            window.push(card); needed--; prev = cur;
          }
        }
      }
      if (valid && window.length === len) {
        const combo = detectCombination(window);
        if (combo && (combo.type === TYPE.STRAIGHT || combo.type === TYPE.BOMB_SF)) results.push(combo);
      }
    }
  }
  return results;
}

function getSteps(hand, requiredLength) {
  const results = [];
  const phoenix = hand.find(isPhoenix);
  const std = hand.filter(c => !isPhoenix(c) && !c.isSpecial);
  const groups = new Map();
  for (const c of std) { if (!groups.has(c.numericValue)) groups.set(c.numericValue, []); groups.get(c.numericValue).push(c); }
  const vals = [...groups.keys()].filter(v => groups.get(v).length >= 2).sort((a,b)=>a-b);
  const singletons = [...groups.keys()].filter(v => groups.get(v).length === 1).sort((a,b)=>a-b);
  const minPairs = (requiredLength || 4) / 2;
  const maxPairs = requiredLength ? requiredLength / 2 : 7;

  for (let numPairs = minPairs; numPairs <= maxPairs; numPairs++) {
    if (requiredLength && numPairs * 2 !== requiredLength) continue;
    for (let i = 0; i <= vals.length - numPairs; i++) {
      const window = vals.slice(i, i + numPairs);
      let isConsec = true;
      for (let k = 1; k < window.length; k++) if (window[k] !== window[k-1] + 1) { isConsec = false; break; }
      if (!isConsec) continue;
      const cards = [];
      for (const v of window) cards.push(...groups.get(v).slice(0, 2));
      const combo = detectCombination(cards);
      if (combo && combo.type === TYPE.STEPS) results.push(combo);
    }
    if (phoenix) {
      for (const sv of singletons) {
        for (let pi = 0; pi <= vals.length - (numPairs - 1); pi++) {
          const pw = vals.slice(pi, pi + (numPairs - 1));
          if (pw.length < numPairs - 1) continue;
          let ok = true;
          for (let k = 1; k < pw.length; k++) if (pw[k] !== pw[k-1] + 1) { ok = false; break; }
          if (!ok) continue;
          const combined = [...pw, sv].sort((a,b)=>a-b);
          let consec = true;
          for (let k = 1; k < combined.length; k++) if (combined[k] !== combined[k-1] + 1) { consec = false; break; }
          if (!consec) continue;
          const cards = [];
          for (const v of pw) cards.push(...groups.get(v).slice(0, 2));
          cards.push(groups.get(sv)[0], phoenix);
          const combo = detectCombination(cards);
          if (combo && combo.type === TYPE.STEPS) results.push(combo);
        }
      }
    }
  }
  const seen = new Set();
  return results.filter(c => { const key = c.cards.map(x=>x.id).sort().join(','); if (seen.has(key)) return false; seen.add(key); return true; });
}

function getFullHouses(hand) {
  const results = [];
  const phoenix = hand.find(isPhoenix);
  const std = hand.filter(c => !isPhoenix(c) && !c.isSpecial);
  const groups = new Map();
  for (const c of std) { if (!groups.has(c.numericValue)) groups.set(c.numericValue, []); groups.get(c.numericValue).push(c); }
  const vals = [...groups.keys()];
  for (let i = 0; i < vals.length; i++) {
    for (let j = 0; j < vals.length; j++) {
      if (i === j) continue;
      const tripCards = groups.get(vals[i]), pairCards = groups.get(vals[j]);
      if (tripCards.length >= 3 && pairCards.length >= 2) {
        const combo = detectCombination([...tripCards.slice(0,3), ...pairCards.slice(0,2)]);
        if (combo && combo.type === TYPE.FULLHOUSE) results.push(combo);
      }
      if (phoenix && tripCards.length >= 2 && pairCards.length >= 2) {
        const combo = detectCombination([...tripCards.slice(0,2), phoenix, ...pairCards.slice(0,2)]);
        if (combo && combo.type === TYPE.FULLHOUSE) results.push(combo);
      }
      if (phoenix && tripCards.length >= 3 && pairCards.length >= 1) {
        const combo = detectCombination([...tripCards.slice(0,3), pairCards[0], phoenix]);
        if (combo && combo.type === TYPE.FULLHOUSE) results.push(combo);
      }
    }
  }
  return results;
}

export { detectCombination, canBeat, getValidMoves, getAllCombinations, phoenixSingleRank, getBombs, getStraights, getSteps, getFullHouses, TYPE };
