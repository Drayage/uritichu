'use strict';

// combination types
const TYPE = {
  SINGLE: 'single',
  PAIR: 'pair',
  TRIPLE: 'triple',
  STEPS: 'steps',        // consecutive pairs (Steps)
  FULLHOUSE: 'fullhouse',
  STRAIGHT: 'straight',
  BOMB_QUAD: 'bomb_quad',
  BOMB_SF: 'bomb_sf',
};

function isPhoenix(c) { return c.rank === 'phoenix'; }
function isDragon(c)  { return c.rank === 'dragon'; }
function isDog(c)     { return c.rank === 'dog'; }
function isMahjong(c) { return c.rank === 'mahjong'; }

function stdVal(c) { return c.numericValue; }

// group standard (non-phoenix) cards by numericValue
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

  // Dog can only be played alone as a lead (validated separately)
  if (cards.length === 1) {
    const c = cards[0];
    if (isDog(c)) return { type: TYPE.SINGLE, cards, rank: 0, length: 1, isBomb: false };
    if (isDragon(c)) return { type: TYPE.SINGLE, cards, rank: 16, length: 1, isBomb: false };
    if (isMahjong(c)) return { type: TYPE.SINGLE, cards, rank: 1, length: 1, isBomb: false };
    if (isPhoenix(c)) return { type: TYPE.SINGLE, cards, rank: -1, length: 1, isBomb: false }; // rank resolved at play time
    return { type: TYPE.SINGLE, cards, rank: c.numericValue, length: 1, isBomb: false };
  }

  if (hasPhoenix) {
    // Phoenix cannot be in a bomb
    if (cards.length === 1) return null; // shouldn't reach here
  }

  // Dog cannot be combined
  if (cards.some(isDog)) return null;
  // Dragon can only be played as single
  if (cards.some(isDragon)) return null;

  const len = cards.length;

  if (len === 2) return detectPair(sorted, hasPhoenix, cards);
  if (len === 3) return detectTriple(sorted, hasPhoenix, cards);
  if (len === 4) return detectLen4(sorted, hasPhoenix, cards);
  if (len === 5) return detectLen5(sorted, hasPhoenix, cards);
  if (len >= 6) return detectLen6Plus(sorted, hasPhoenix, cards);

  return null;
}

function detectPair(sorted, hasPhoenix, orig) {
  if (sorted.length === 2 && !hasPhoenix) {
    if (sorted[0].numericValue === sorted[1].numericValue)
      return { type: TYPE.PAIR, cards: orig, rank: sorted[0].numericValue, length: 2, isBomb: false };
  }
  if (sorted.length === 1 && hasPhoenix) {
    // Mahjong can pair with Phoenix only if Mahjong is the only standard card
    return { type: TYPE.PAIR, cards: orig, rank: sorted[0].numericValue, length: 2, isBomb: false };
  }
  return null;
}

function detectTriple(sorted, hasPhoenix, orig) {
  if (sorted.length === 3 && !hasPhoenix) {
    const v = sorted[0].numericValue;
    if (sorted.every(c => c.numericValue === v))
      return { type: TYPE.TRIPLE, cards: orig, rank: v, length: 3, isBomb: false };
  }
  if (sorted.length === 2 && hasPhoenix) {
    if (sorted[0].numericValue === sorted[1].numericValue)
      return { type: TYPE.TRIPLE, cards: orig, rank: sorted[0].numericValue, length: 3, isBomb: false };
  }
  return null;
}

function detectLen4(sorted, hasPhoenix, orig) {
  if (!hasPhoenix && sorted.length === 4) {
    const v = sorted[0].numericValue;
    if (sorted.every(c => c.numericValue === v))
      return { type: TYPE.BOMB_QUAD, cards: orig, rank: v, length: 4, isBomb: true };
  }
  // 3 same + phoenix = triple (not bomb)
  if (hasPhoenix && sorted.length === 3) {
    const v = sorted[0].numericValue;
    if (sorted.every(c => c.numericValue === v))
      return { type: TYPE.TRIPLE, cards: orig, rank: v, length: 4, isBomb: false };
  }
  return null;
}

function detectLen5(sorted, hasPhoenix, orig) {
  // fullhouse check first (only 5-card combo that isn't straight/bomb)
  const fh = detectFullHouse(sorted, hasPhoenix, orig);
  if (fh) return fh;

  // bomb_sf: 5 same suit no phoenix
  if (!hasPhoenix && allSameSuit(sorted)) {
    const straight = isStraightSeq(sorted, false);
    if (straight !== null)
      return { type: TYPE.BOMB_SF, cards: orig, rank: straight.topRank * 100 + 5, length: 5, isBomb: true };
  }

  // straight
  const st = tryStraight(sorted, hasPhoenix);
  if (st !== null)
    return { type: TYPE.STRAIGHT, cards: orig, rank: st.topRank, length: 5, isBomb: false };

  return null;
}

function detectLen6Plus(sorted, hasPhoenix, orig) {
  const len = orig.length;

  // bomb_sf: no phoenix, same suit, straight
  if (!hasPhoenix && allSameSuit(sorted)) {
    const st = isStraightSeq(sorted, false);
    if (st !== null)
      return { type: TYPE.BOMB_SF, cards: orig, rank: st.topRank * 100 + len, length: len, isBomb: true };
  }

  // steps (even length, >= 4)
  if (len % 2 === 0 && len >= 4) {
    const steps = trySteps(sorted, hasPhoenix, len);
    if (steps !== null)
      return { type: TYPE.STEPS, cards: orig, rank: steps.topRank, length: len, isBomb: false };
  }

  // straight
  const st = tryStraight(sorted, hasPhoenix);
  if (st !== null)
    return { type: TYPE.STRAIGHT, cards: orig, rank: st.topRank, length: len, isBomb: false };

  return null;
}

function detectFullHouse(sorted, hasPhoenix, orig) {
  // exactly 5 cards total
  if (orig.length !== 5) return null;

  const groups = groupByValue(orig);
  const vals = [...groups.keys()].sort((a, b) => a - b);

  if (!hasPhoenix) {
    if (vals.length !== 2) return null;
    const [v1, v2] = vals;
    const c1 = groups.get(v1).length;
    const c2 = groups.get(v2).length;
    if ((c1 === 3 && c2 === 2)) return { type: TYPE.FULLHOUSE, cards: orig, rank: v1, length: 5, isBomb: false };
    if ((c1 === 2 && c2 === 3)) return { type: TYPE.FULLHOUSE, cards: orig, rank: v2, length: 5, isBomb: false };
    return null;
  }

  // with phoenix (4 standard cards in 2 groups)
  if (vals.length === 2) {
    const [v1, v2] = vals;
    const c1 = groups.get(v1).length;
    const c2 = groups.get(v2).length;
    // 3+1 → phoenix makes the pair complete: triple is the 3-group
    if (c1 === 3 && c2 === 1) return { type: TYPE.FULLHOUSE, cards: orig, rank: v1, length: 5, isBomb: false };
    if (c1 === 1 && c2 === 3) return { type: TYPE.FULLHOUSE, cards: orig, rank: v2, length: 5, isBomb: false };
    // 2+2 → phoenix joins one to make triple; bigger triple is stronger
    if (c1 === 2 && c2 === 2) return { type: TYPE.FULLHOUSE, cards: orig, rank: v2, length: 5, isBomb: false };
  }
  // 1 group of 4: phoenix joins as pair
  if (vals.length === 1) {
    return { type: TYPE.FULLHOUSE, cards: orig, rank: vals[0], length: 5, isBomb: false };
  }
  return null;
}

function allSameSuit(sorted) {
  const s = sorted[0].suit;
  return s && sorted.every(c => c.suit === s);
}

function isStraightSeq(sorted, allowGap) {
  // sorted must be non-phoenix cards only
  // Mahjong has value 1
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
  if (result === null) return null;
  if (!hasPhoenix && result.gaps > 0) return null;
  return result;
}

function trySteps(sorted, hasPhoenix, totalLen) {
  // pairs must be consecutive values
  const gmap = new Map();
  for (const c of sorted) {
    if (!gmap.has(c.numericValue)) gmap.set(c.numericValue, 0);
    gmap.set(c.numericValue, gmap.get(c.numericValue) + 1);
  }

  const numPairs = totalLen / 2;
  // Allow phoenix to complete one singleton into a pair
  let phoenixUsed = false;
  const pairs = [];

  for (const [v, count] of [...gmap.entries()].sort((a, b) => a[0] - b[0])) {
    if (count === 2) {
      pairs.push(v);
    } else if (count === 1 && hasPhoenix && !phoenixUsed) {
      pairs.push(v);
      phoenixUsed = true;
    } else {
      return null; // triple or more in one value, or needs phoenix but already used
    }
  }

  if (pairs.length !== numPairs) return null;

  // check consecutive
  for (let i = 1; i < pairs.length; i++) {
    if (pairs[i] !== pairs[i-1] + 1) return null;
  }

  return { topRank: pairs[pairs.length - 1] };
}

// Can `incoming` beat `current`?
// For Phoenix single, pass phoenixBeatRank = current rank + 0.5
function canBeat(incoming, current) {
  if (!current) return true; // no current trick, anything goes

  // bombs beat non-bombs
  if (incoming.isBomb && !current.isBomb) return true;
  if (!incoming.isBomb && current.isBomb) return false;

  if (incoming.isBomb && current.isBomb) {
    if (incoming.type === TYPE.BOMB_SF && current.type === TYPE.BOMB_QUAD) return true;
    if (incoming.type === TYPE.BOMB_QUAD && current.type === TYPE.BOMB_SF) return false;
    // both SF: longer wins, same length: higher rank
    if (incoming.type === TYPE.BOMB_SF && current.type === TYPE.BOMB_SF) {
      if (incoming.length !== current.length) return incoming.length > current.length;
      return incoming.rank > current.rank;
    }
    // both quad
    return incoming.rank > current.rank;
  }

  // non-bombs: must match type and length
  if (incoming.type !== current.type) return false;
  if (incoming.length !== current.length) return false;

  if (incoming.type === TYPE.SINGLE) {
    // dragon beats everything non-bomb single except another dragon
    if (incoming.rank === 16) return current.rank !== 16;
    // phoenix as single: beats current by 0.5, but not dragon
    if (incoming.rank === -1) return current.rank < 16 && current.rank !== 16;
    return incoming.rank > current.rank;
  }

  return incoming.rank > current.rank;
}

// Effective rank of phoenix when played as a single on top of `currentRank`
function phoenixSingleRank(currentRank) {
  return currentRank === null ? 1.5 : currentRank + 0.5;
}

// Get all valid combinations from hand that beat currentCombo (null = leading)
function getValidMoves(hand, currentCombo, wishRank) {
  const moves = [];

  if (!currentCombo) {
    // leading: enumerate all valid combinations
    return getAllCombinations(hand, wishRank);
  }

  // must match type & length, and beat rank; OR play a bomb
  const { type, length, rank } = currentCombo;

  // always add bombs
  const bombs = getBombs(hand);
  for (const b of bombs) {
    if (canBeat(b, currentCombo)) moves.push(b);
  }

  // enumerate matching type+length combos
  const candidates = getCombinationsOfType(hand, type, length);
  for (const combo of candidates) {
    if (canBeat(combo, currentCombo)) moves.push(combo);
  }

  // wish enforcement: if wish active and some move contains the wished rank, filter to those
  if (wishRank) {
    const movesWithWish = moves.filter(m => m.cards.some(c => c.rank === wishRank || String(c.numericValue) === String(wishRank)));
    if (movesWithWish.length > 0) return movesWithWish;
  }

  return moves;
}

function getBombs(hand) {
  const bombs = [];
  // quad bombs
  const groups = new Map();
  for (const c of hand) {
    if (c.isSpecial) continue;
    if (!groups.has(c.numericValue)) groups.set(c.numericValue, []);
    groups.get(c.numericValue).push(c);
  }
  for (const [, cards] of groups) {
    if (cards.length === 4) {
      const combo = detectCombination(cards);
      if (combo) bombs.push(combo);
    }
    // Check SF bombs of 5+ within same suit subsets
    for (const suit of ['jade','sword','pagoda','star']) {
      const suitCards = hand.filter(c => c.suit === suit && !c.isSpecial);
      if (suitCards.length >= 5) {
        const sf = findStraightFlushBombs(suitCards);
        bombs.push(...sf);
      }
    }
  }
  // deduplicate by card ids
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
      // check consecutive
      let ok = true;
      for (let k = 1; k < subset.length; k++) {
        if (subset[k].numericValue !== subset[k-1].numericValue + 1) { ok = false; break; }
      }
      if (ok) {
        const len = subset.length;
        const topRank = subset[len-1].numericValue;
        bombs.push({ type: TYPE.BOMB_SF, cards: subset, rank: topRank * 100 + len, length: len, isBomb: true });
      }
    }
  }
  return bombs;
}

function getAllCombinations(hand, wishRank) {
  const combos = [];
  const n = hand.length;

  // singles
  for (const c of hand) {
    combos.push(detectCombination([c]));
  }

  // pairs
  for (let i = 0; i < n; i++) {
    for (let j = i+1; j < n; j++) {
      const c = detectCombination([hand[i], hand[j]]);
      if (c && c.type === TYPE.PAIR) combos.push(c);
    }
  }

  // triples
  for (let i = 0; i < n; i++) {
    for (let j = i+1; j < n; j++) {
      for (let k = j+1; k < n; k++) {
        const c = detectCombination([hand[i], hand[j], hand[k]]);
        if (c && c.type === TYPE.TRIPLE) combos.push(c);
      }
    }
  }

  // for larger combos, use targeted generation
  combos.push(...getBombs(hand));
  combos.push(...getStraights(hand));
  combos.push(...getSteps(hand));
  combos.push(...getFullHouses(hand));

  const valid = combos.filter(Boolean);

  if (wishRank) {
    const withWish = valid.filter(m => m.cards.some(c => c.rank === wishRank || String(c.numericValue) === wishRank));
    if (withWish.length > 0) return withWish;
  }

  return valid;
}

function getCombinationsOfType(hand, type, length) {
  const combos = [];
  if (type === TYPE.SINGLE) {
    for (const c of hand) {
      const combo = detectCombination([c]);
      if (combo && combo.type === TYPE.SINGLE) combos.push(combo);
    }
  } else if (type === TYPE.PAIR) {
    for (let i = 0; i < hand.length; i++)
      for (let j = i+1; j < hand.length; j++) {
        const c = detectCombination([hand[i], hand[j]]);
        if (c && c.type === TYPE.PAIR) combos.push(c);
      }
  } else if (type === TYPE.TRIPLE) {
    for (let i = 0; i < hand.length; i++)
      for (let j = i+1; j < hand.length; j++)
        for (let k = j+1; k < hand.length; k++) {
          const c = detectCombination([hand[i], hand[j], hand[k]]);
          if (c && c.type === TYPE.TRIPLE) combos.push(c);
        }
  } else if (type === TYPE.FULLHOUSE) {
    combos.push(...getFullHouses(hand));
  } else if (type === TYPE.STRAIGHT) {
    combos.push(...getStraights(hand, length));
  } else if (type === TYPE.STEPS) {
    combos.push(...getSteps(hand, length));
  }
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
    // try each window of consecutive values
    for (let startIdx = 0; startIdx < vals.length; startIdx++) {
      const window = [];
      let v = vals[startIdx];
      let needed = len;
      let phoenixUsed = false;
      let valid = true;
      let prev = null;

      for (let pos = startIdx; needed > 0; pos++) {
        if (pos >= vals.length) {
          // can phoenix fill?
          if (phoenix && !phoenixUsed && needed === 1) {
            window.push(phoenix);
            phoenixUsed = true;
            needed--;
          } else {
            valid = false;
            break;
          }
        } else {
          const cur = vals[pos];
          if (prev !== null && cur !== prev + 1) {
            // gap
            if (cur === prev + 2 && phoenix && !phoenixUsed) {
              // fill gap with phoenix
              window.push(phoenix);
              phoenixUsed = true;
              // then push cur card
              const card = sorted.find(c => c.numericValue === cur);
              if (!card) { valid = false; break; }
              window.push(card);
              needed -= 2;
              prev = cur;
            } else {
              valid = false;
              break;
            }
          } else {
            const card = sorted.find(c => c.numericValue === cur);
            if (!card) { valid = false; break; }
            window.push(card);
            needed--;
            prev = cur;
          }
        }
      }

      if (valid && window.length === len) {
        const combo = detectCombination(window);
        if (combo && (combo.type === TYPE.STRAIGHT || combo.type === TYPE.BOMB_SF)) {
          results.push(combo);
        }
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
  for (const c of std) {
    if (!groups.has(c.numericValue)) groups.set(c.numericValue, []);
    groups.get(c.numericValue).push(c);
  }
  const vals = [...groups.keys()].filter(v => groups.get(v).length >= 2).sort((a,b)=>a-b);
  const singletons = [...groups.keys()].filter(v => groups.get(v).length === 1).sort((a,b)=>a-b);

  const minPairs = (requiredLength || 4) / 2;
  const maxPairs = requiredLength ? requiredLength / 2 : 7;

  for (let numPairs = minPairs; numPairs <= maxPairs; numPairs++) {
    if (requiredLength && numPairs * 2 !== requiredLength) continue;
    // try windows of consecutive pair values
    for (let i = 0; i <= vals.length - numPairs; i++) {
      const window = vals.slice(i, i + numPairs);
      let isConsec = true;
      for (let k = 1; k < window.length; k++) {
        if (window[k] !== window[k-1] + 1) { isConsec = false; break; }
      }
      if (!isConsec) continue;
      const cards = [];
      for (const v of window) {
        cards.push(...groups.get(v).slice(0, 2));
      }
      const combo = detectCombination(cards);
      if (combo && combo.type === TYPE.STEPS) results.push(combo);
    }

    // with phoenix: try adding a singleton adjacent to a window
    if (phoenix) {
      for (let i = 0; i <= vals.length; i++) {
        // try building numPairs pairs using available pairs + one singleton filled by phoenix
        // simplified: try all windows of (numPairs-1) pairs + one singleton
        for (const sv of singletons) {
          const pairWindow = [];
          // find numPairs-1 consecutive pairs that include sv or are adjacent
          for (let pi = 0; pi <= vals.length - (numPairs - 1); pi++) {
            const pw = vals.slice(pi, pi + (numPairs - 1));
            if (pw.length < numPairs - 1) continue;
            let ok = true;
            for (let k = 1; k < pw.length; k++) {
              if (pw[k] !== pw[k-1] + 1) { ok = false; break; }
            }
            if (!ok) continue;
            // singleton must be consecutive with window
            const combined = [...pw, sv].sort((a,b)=>a-b);
            let consec = true;
            for (let k = 1; k < combined.length; k++) {
              if (combined[k] !== combined[k-1] + 1) { consec = false; break; }
            }
            if (!consec) continue;
            const cards = [];
            for (const v of pw) cards.push(...groups.get(v).slice(0, 2));
            cards.push(groups.get(sv)[0]);
            cards.push(phoenix);
            const combo = detectCombination(cards);
            if (combo && combo.type === TYPE.STEPS) results.push(combo);
          }
        }
      }
    }
  }

  // deduplicate
  const seen = new Set();
  return results.filter(c => {
    const key = c.cards.map(x=>x.id).sort().join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getFullHouses(hand) {
  const results = [];
  const phoenix = hand.find(isPhoenix);
  const std = hand.filter(c => !isPhoenix(c) && !c.isSpecial);
  const groups = new Map();
  for (const c of std) {
    if (!groups.has(c.numericValue)) groups.set(c.numericValue, []);
    groups.get(c.numericValue).push(c);
  }

  const vals = [...groups.keys()];
  for (let i = 0; i < vals.length; i++) {
    for (let j = 0; j < vals.length; j++) {
      if (i === j) continue;
      const tripCards = groups.get(vals[i]);
      const pairCards = groups.get(vals[j]);
      if (tripCards.length >= 3 && pairCards.length >= 2) {
        const cards = [...tripCards.slice(0, 3), ...pairCards.slice(0, 2)];
        const combo = detectCombination(cards);
        if (combo && combo.type === TYPE.FULLHOUSE) results.push(combo);
      }
      // with phoenix completing triple
      if (phoenix && tripCards.length >= 2 && pairCards.length >= 2) {
        const cards = [...tripCards.slice(0, 2), phoenix, ...pairCards.slice(0, 2)];
        const combo = detectCombination(cards);
        if (combo && combo.type === TYPE.FULLHOUSE) results.push(combo);
      }
      // phoenix completing pair
      if (phoenix && tripCards.length >= 3 && pairCards.length >= 1) {
        const cards = [...tripCards.slice(0, 3), pairCards[0], phoenix];
        const combo = detectCombination(cards);
        if (combo && combo.type === TYPE.FULLHOUSE) results.push(combo);
      }
    }
  }
  return results;
}

module.exports = { detectCombination, canBeat, getValidMoves, phoenixSingleRank, TYPE };
