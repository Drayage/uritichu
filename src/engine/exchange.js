'use strict';

// exchanges: { [playerId]: { left: card, across: card, right: card } }
// seats: { [playerId]: seatIndex }
// hands: { [playerId]: Card[] }
// returns new hands after exchange
function applyExchanges(hands, exchanges, playersBySeat) {
  // playersBySeat: array of { id, seat } sorted by seat 0-3
  const seatToId = {};
  const idToSeat = {};
  for (const p of playersBySeat) {
    seatToId[p.seat] = p.id;
    idToSeat[p.id] = p.seat;
  }

  // Build what each player receives
  const received = {};
  for (const p of playersBySeat) received[p.id] = [];

  for (const senderId of Object.keys(exchanges)) {
    const senderSeat = idToSeat[senderId];
    const { left, across, right } = exchanges[senderId];
    const leftSeat = (senderSeat + 1) % 4;
    const acrossSeat = (senderSeat + 2) % 4;
    const rightSeat = (senderSeat + 3) % 4;
    received[seatToId[leftSeat]].push(left);
    received[seatToId[acrossSeat]].push(across);
    received[seatToId[rightSeat]].push(right);
  }

  // Build cards to remove from each sender
  const newHands = {};
  for (const p of playersBySeat) {
    const pid = p.id;
    const ex = exchanges[pid];
    const sentIds = new Set([ex.left.id, ex.across.id, ex.right.id]);
    const kept = hands[pid].filter(c => !sentIds.has(c.id));
    newHands[pid] = [...kept, ...received[pid]];
  }

  return newHands;
}

module.exports = { applyExchanges };
