function applyExchanges(hands, exchanges, playersBySeat) {
  const seatToId = {};
  const idToSeat = {};
  for (const p of playersBySeat) {
    seatToId[p.seat] = p.id;
    idToSeat[p.id] = p.seat;
  }

  const received = {};
  for (const p of playersBySeat) received[p.id] = [];

  for (const senderId of Object.keys(exchanges)) {
    const senderSeat = idToSeat[senderId];
    const { left, across, right } = exchanges[senderId];
    received[seatToId[(senderSeat + 1) % 4]].push(left);
    received[seatToId[(senderSeat + 2) % 4]].push(across);
    received[seatToId[(senderSeat + 3) % 4]].push(right);
  }

  const newHands = {};
  for (const p of playersBySeat) {
    const pid = p.id;
    const ex = exchanges[pid];
    const sentIds = new Set([ex.left.id, ex.across.id, ex.right.id]);
    newHands[pid] = [...hands[pid].filter(c => !sentIds.has(c.id)), ...received[pid]];
  }
  return newHands;
}

export { applyExchanges };
