function keepScore(card, hand) {
  if (card.rank === 'dragon') return 10;
  if (card.rank === 'phoenix') return 9;
  if (card.rank === 'mahjong') return 7;
  if (card.rank === 'dog') return 1;
  if (card.rank === 'A') return 8;
  if (card.rank === 'K') return 6;
  if (card.rank === 'Q') return 5;
  if (card.rank === 'J') return 4;
  const v = card.numericValue;
  const nearby = hand.filter(c => !c.isSpecial && Math.abs(c.numericValue - v) <= 2 && c !== card).length;
  return v * 0.3 + nearby * 0.5;
}

function decideExchange(hand, mySeat) {
  const scored = hand.map(c => ({ card: c, score: keepScore(c, hand) }));
  scored.sort((a, b) => a.score - b.score);
  const worstForOpp1 = scored[0].card;
  const worstForOpp2 = scored[1].card;
  const remaining = scored.slice(2).sort((a, b) => b.score - a.score);
  let forPartner = remaining[0].card;
  for (const { card } of remaining) { if (card.rank === 'A' || card.rank === 'K') { forPartner = card; break; } }
  return { left: worstForOpp1, across: forPartner, right: worstForOpp2 };
}

export { decideExchange };
