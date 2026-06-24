'use strict';

// Score a card for "how much do I want to keep this"
function keepScore(card, hand) {
  if (card.rank === 'dragon') return 10;
  if (card.rank === 'phoenix') return 9;
  if (card.rank === 'mahjong') return 7; // keep for wish
  if (card.rank === 'dog') return 1; // low priority to keep
  if (card.rank === 'A') return 8;
  if (card.rank === 'K') return 6;
  if (card.rank === 'Q') return 5;
  if (card.rank === 'J') return 4;
  // Check if part of potential straight
  const v = card.numericValue;
  const nearby = hand.filter(c => !c.isSpecial && Math.abs(c.numericValue - v) <= 2 && c !== card).length;
  return v * 0.3 + nearby * 0.5;
}

// Decide which 3 cards to send: { left, across, right }
// seat: my seat index (0-3); partner is (seat+2)%4
// leftSeat: (seat+1)%4, acrossSeat: (seat+2)%4, rightSeat: (seat+3)%4
function decideExchange(hand, mySeat) {
  const scored = hand.map(c => ({ card: c, score: keepScore(c, hand) }));
  scored.sort((a, b) => a.score - b.score); // worst first

  // Give to opponents: the two lowest-keep cards
  // Give to partner: a high-value card to help them

  const worstForOpp1 = scored[0].card; // to left opponent
  const worstForOpp2 = scored[1].card; // to right opponent

  // For partner: give the best card we can spare (high rank)
  const remaining = scored.slice(2);
  remaining.sort((a, b) => b.score - a.score); // best first for partner

  // Prefer giving partner A or K
  let forPartner = remaining[0].card;
  for (const { card } of remaining) {
    if (card.rank === 'A' || card.rank === 'K') { forPartner = card; break; }
  }

  const leftSeat = (mySeat + 1) % 4;
  const acrossSeat = (mySeat + 2) % 4;
  const rightSeat = (mySeat + 3) % 4;

  return {
    left: worstForOpp1,
    across: forPartner,
    right: worstForOpp2,
  };
}

module.exports = { decideExchange };
