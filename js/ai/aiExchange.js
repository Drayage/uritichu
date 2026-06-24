// Exchange strategy with full tichu-context awareness.
// At exchange time only grandTichuCalls are relevant (regular tichu is called later).
function decideExchange(hand, mySeat, gameState, playerId) {
  const r = gameState.currentRound;
  const players = gameState.players;

  const partnerSeat = (mySeat + 2) % 4;
  const leftSeat   = (mySeat + 1) % 4;
  const rightSeat  = (mySeat + 3) % 4;

  const partnerId = players.find(p => p.seat === partnerSeat)?.id;
  const leftId    = players.find(p => p.seat === leftSeat)?.id;
  const rightId   = players.find(p => p.seat === rightSeat)?.id;

  const gc = r.grandTichuCalls || {};
  const myGT        = !!gc[playerId];
  const partnerTichu = !!(partnerId && gc[partnerId]);
  const leftTichu    = !!(leftId   && gc[leftId]);
  const rightTichu   = !!(rightId  && gc[rightId]);

  const dragon  = hand.find(c => c.rank === 'dragon');
  const phoenix = hand.find(c => c.rank === 'phoenix');
  const dog     = hand.find(c => c.rank === 'dog');
  const aces    = hand.filter(c => c.rank === 'A');
  const topCards = [dragon, phoenix, ...aces].filter(Boolean);

  const regularAsc  = hand.filter(c => !c.isSpecial).sort((a, b) => a.numericValue - b.numericValue);
  const regularDesc = [...regularAsc].reverse();

  const chosen = new Set();
  function useCard(c) { if (c) chosen.add(c.id); return c; }

  // Best card not yet chosen: dragon > phoenix > aces (desc) > regular (desc)
  function getBest() {
    const cands = [
      dragon, phoenix,
      ...aces.slice().sort((a, b) => b.numericValue - a.numericValue),
      ...regularDesc,
    ].filter(Boolean);
    return cands.find(c => !chosen.has(c.id)) ?? null;
  }

  // Worst regular card not yet chosen
  function getWorstRegular() {
    return regularAsc.find(c => !chosen.has(c.id)) ?? null;
  }

  // Worst card overall (regular first; fallback: dog > mahjong > phoenix > dragon)
  function getWorst() {
    const reg = getWorstRegular();
    if (reg) return reg;
    const fallback = [dog, hand.find(c => c.rank === 'mahjong'), phoenix, dragon].filter(Boolean);
    return fallback.find(c => !chosen.has(c.id)) ?? null;
  }

  let forLeft, forAcross, forRight;

  // ── Priority 1: Partner declared grand tichu → give them the best card ──
  if (partnerTichu) {
    forAcross = useCard(getBest());
    // Burden tichu-calling opponents with dog; otherwise give worst regular (not phoenix)
    forLeft = leftTichu && dog && !chosen.has(dog.id)
      ? useCard(dog)
      : useCard(getWorstRegular() ?? getWorst());
    forRight = rightTichu && dog && !chosen.has(dog.id)
      ? useCard(dog)
      : useCard(getWorstRegular() ?? getWorst());
  }
  // ── Priority 2: I declared grand tichu and received dog → offload dog to right ──
  else if (myGT && dog) {
    forRight = useCard(dog);  // dog wastes a turn when racing to go out first
    // Give a solid high card to partner so they can support
    const midHigh = regularDesc.find(c => !chosen.has(c.id) && c.numericValue >= 11);
    forAcross = useCard(midHigh ?? getWorstRegular() ?? getWorst());
    forLeft = useCard(getWorstRegular() ?? getWorst());
  }
  // ── Priority 3: Opponent declared grand tichu → give dog or worst to them ──
  else if (leftTichu || rightTichu) {
    if (leftTichu && rightTichu) {
      forLeft  = dog && !chosen.has(dog.id) ? useCard(dog) : useCard(getWorstRegular() ?? getWorst());
      forRight = useCard(getWorstRegular() ?? getWorst());
    } else if (leftTichu) {
      forLeft  = dog && !chosen.has(dog.id) ? useCard(dog) : useCard(getWorstRegular() ?? getWorst());
      forRight = useCard(getWorstRegular() ?? getWorst());
    } else {
      forRight = dog && !chosen.has(dog.id) ? useCard(dog) : useCard(getWorstRegular() ?? getWorst());
      forLeft  = useCard(getWorstRegular() ?? getWorst());
    }
    forAcross = useCard(getBest());
  }
  // ── Default: no grand tichu context ──
  else {
    if (topCards.length <= 1) {
      // Consolidate: send our best card to partner
      forAcross = useCard(getBest());
    } else {
      // Multiple top cards: share a high regular card (K+) with partner, keep the best
      const spare = regularDesc.find(c => !chosen.has(c.id) && c.numericValue >= 13);
      forAcross = useCard(spare ?? getBest());
    }
    // Give our two worst regular cards to opponents (avoid sending phoenix to opponents)
    forLeft  = useCard(getWorstRegular() ?? getWorst());
    forRight = useCard(getWorstRegular() ?? getWorst());
  }

  // Fallback: fill any remaining nulls
  const remaining = hand.filter(c => !chosen.has(c.id));
  let ri = 0;
  if (!forLeft)   forLeft   = useCard(remaining[ri++]);
  if (!forAcross) forAcross = useCard(remaining[ri++]);
  if (!forRight)  forRight  = useCard(remaining[ri++]);

  return { left: forLeft, across: forAcross, right: forRight };
}

export { decideExchange };
