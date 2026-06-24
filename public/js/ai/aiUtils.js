// Track which high cards (A, dragon, phoenix) have already been played
// Returns { remainingAs, dragonOut, phoenixOut, totalHighRemaining }
function getHighCardContext(roundState) {
  const playedIds = new Set();

  for (const trick of (roundState.pastTricks || [])) {
    for (const play of (trick.plays || [])) {
      for (const card of (play.cards || [])) playedIds.add(card.id);
    }
  }
  for (const play of (roundState.currentTrick?.plays || [])) {
    for (const card of (play.cards || [])) playedIds.add(card.id);
  }

  const dragonOut = playedIds.has('dragon');
  const phoenixOut = playedIds.has('phoenix');

  let asPlayed = 0;
  for (const suit of ['sword', 'pagoda', 'jade', 'star']) {
    if (playedIds.has(`${suit}-A`)) asPlayed++;
  }
  const remainingAs = 4 - asPlayed;

  return {
    remainingAs,
    dragonOut,
    phoenixOut,
    totalHighRemaining: remainingAs + (dragonOut ? 0 : 1) + (phoenixOut ? 0 : 1),
  };
}

function getPartnerId(players, myId) {
  const me = players.find(p => p.id === myId);
  if (!me) return null;
  return players.find(p => p.seat === (me.seat + 2) % 4)?.id ?? null;
}

function getLeftOpponentId(players, myId) {
  const me = players.find(p => p.id === myId);
  if (!me) return null;
  return players.find(p => p.seat === (me.seat + 1) % 4)?.id ?? null;
}

function getRightOpponentId(players, myId) {
  const me = players.find(p => p.id === myId);
  if (!me) return null;
  return players.find(p => p.seat === (me.seat + 3) % 4)?.id ?? null;
}

export { getHighCardContext, getPartnerId, getLeftOpponentId, getRightOpponentId };
