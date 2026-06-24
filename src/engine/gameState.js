'use strict';

const { createDeck, shuffleDeck, dealCards } = require('./cards');
const { applyExchanges } = require('./exchange');
const { scoreRound } = require('./scoring');

const PHASE = {
  DEAL_8: 'deal_8',
  GRAND_TICHU: 'grand_tichu',
  DEAL_6: 'deal_6',
  EXCHANGE: 'exchange',
  PLAY: 'play',
  DRAGON_GIVE: 'dragon_give',
  ROUND_OVER: 'round_over',
  GAME_OVER: 'game_over',
};

function createGameState(players, targetScore = 1000) {
  // players: [{ id, name, seat, teamIndex, isAI }]
  return {
    players,
    totalScores: { team0: 0, team1: 0 },
    rounds: [],
    currentRound: null,
    phase: PHASE.DEAL_8,
    gameOver: false,
    winningTeam: null,
    targetScore,
  };
}

function startRound(gameState) {
  const deck = shuffleDeck(createDeck());
  const { hands, remaining } = dealCards(deck);

  const players = gameState.players;
  const roundState = {
    phase: PHASE.DEAL_8,
    hands: {}, // { [playerId]: Card[] }
    remaining: {}, // remaining 6 cards per player
    grandTichuCalls: {}, // { [playerId]: true/false/null }
    tichuCalls: {}, // { [playerId]: true/false/null }
    tichuPlayed: {}, // { [playerId]: boolean } - has this player played their first card
    exchangeCards: {}, // { [playerId]: {left,across,right} }
    exchangeSubmitted: {}, // { [playerId]: boolean }
    wishRank: null,
    currentTrick: null,
    pastTricks: [],
    trickWinners: {}, // { [playerId]: Card[] } accumulated won cards
    finishOrder: [],
    leadPlayerId: null,
    activePlayerId: null,
    passCount: 0,
    dragonGivePending: false,
    dragonGiveWinner: null,
  };

  // Assign 8-card hands by seat index
  for (const p of players) {
    roundState.hands[p.id] = hands[p.seat];
    roundState.remaining[p.id] = remaining[p.seat];
    roundState.grandTichuCalls[p.id] = null;
    roundState.tichuCalls[p.id] = null;
    roundState.tichuPlayed[p.id] = false;
    roundState.trickWinners[p.id] = [];
    roundState.exchangeSubmitted[p.id] = false;
  }

  gameState.currentRound = roundState;
  gameState.phase = PHASE.DEAL_8;
  return roundState;
}

function setGrandTichu(gameState, playerId, call) {
  const r = gameState.currentRound;
  if (r.phase !== PHASE.DEAL_8 && r.phase !== PHASE.GRAND_TICHU) return { error: 'wrong phase' };
  if (r.grandTichuCalls[playerId] !== null) return { error: 'already decided' };
  r.grandTichuCalls[playerId] = call;
  r.phase = PHASE.GRAND_TICHU;

  // Check if all players decided
  const allDecided = gameState.players.every(p => r.grandTichuCalls[p.id] !== null);
  if (allDecided) {
    // Deal remaining 6 cards
    for (const p of gameState.players) {
      r.hands[p.id] = [...r.hands[p.id], ...r.remaining[p.id]];
    }
    r.phase = PHASE.EXCHANGE;
  }
  return { ok: true };
}

function submitExchange(gameState, playerId, cards) {
  // cards: { left: Card, across: Card, right: Card }
  const r = gameState.currentRound;
  if (r.phase !== PHASE.EXCHANGE) return { error: 'wrong phase' };
  r.exchangeCards[playerId] = cards;
  r.exchangeSubmitted[playerId] = true;

  const allDone = gameState.players.every(p => r.exchangeSubmitted[p.id]);
  if (allDone) {
    const playersBySeat = [...gameState.players].sort((a, b) => a.seat - b.seat);
    r.hands = applyExchanges(r.hands, r.exchangeCards, playersBySeat);
    r.phase = PHASE.PLAY;

    // Find who has Mahjong → first lead
    for (const p of gameState.players) {
      if (r.hands[p.id].some(c => c.rank === 'mahjong')) {
        r.leadPlayerId = p.id;
        r.activePlayerId = p.id;
        break;
      }
    }
  }
  return { ok: true };
}

function callTichu(gameState, playerId) {
  const r = gameState.currentRound;
  if (r.phase !== PHASE.PLAY) return { error: 'wrong phase' };
  if (r.tichuPlayed[playerId]) return { error: 'already played a card' };
  if (r.tichuCalls[playerId] !== null) return { error: 'already called' };
  r.tichuCalls[playerId] = true;
  return { ok: true };
}

function playCards(gameState, playerId, combination, wishRank) {
  const r = gameState.currentRound;
  if (r.phase !== PHASE.PLAY) return { error: 'wrong phase' };
  if (r.activePlayerId !== playerId) return { error: 'not your turn' };

  // Remove cards from hand
  const cardIds = new Set(combination.cards.map(c => c.id));
  r.hands[playerId] = r.hands[playerId].filter(c => !cardIds.has(c.id));
  r.tichuPlayed[playerId] = true;

  // Handle Dog
  if (combination.cards.length === 1 && combination.cards[0].rank === 'dog') {
    return handleDog(gameState, playerId);
  }

  // Mahjong wish
  if (combination.cards.some(c => c.rank === 'mahjong') && wishRank) {
    r.wishRank = wishRank;
  }

  // Check if wish fulfilled
  if (r.wishRank && combination.cards.some(c => c.rank === r.wishRank || String(c.numericValue) === String(r.wishRank))) {
    r.wishRank = null;
  }

  // Add to trick
  if (!r.currentTrick) {
    r.currentTrick = { plays: [], leadPlayerId: playerId, winnerId: playerId, winningCombo: combination, cards: [] };
  }
  r.currentTrick.plays.push({ playerId, combination });
  r.currentTrick.cards.push(...combination.cards);
  r.currentTrick.winnerId = playerId;
  r.currentTrick.winningCombo = combination;
  r.passCount = 0;

  // Check if player is out
  if (r.hands[playerId].length === 0) {
    r.finishOrder.push(playerId);
  }

  // Dragon: must give trick (only if round not over)
  if (combination.cards.some(c => c.rank === 'dragon') && r.finishOrder.length < 3) {
    r.dragonGivePending = true;
    r.dragonGiveWinner = playerId;
    r.phase = PHASE.DRAGON_GIVE;
    return { ok: true, dragonGive: true };
  }

  // Round ends immediately when 3 players have gone out
  if (r.finishOrder.length >= 3) {
    // Award current trick to its winner immediately
    if (r.currentTrick) {
      const winner = r.currentTrick.winnerId;
      r.trickWinners[winner] = [...(r.trickWinners[winner] || []), ...r.currentTrick.cards];
      r.pastTricks.push(r.currentTrick);
      r.currentTrick = null;
    }
    return endRound(gameState);
  }

  return advanceTurn(gameState, playerId);
}

function pass(gameState, playerId) {
  const r = gameState.currentRound;
  if (r.phase !== PHASE.PLAY) return { error: 'wrong phase' };
  if (r.activePlayerId !== playerId) return { error: 'not your turn' };
  if (!r.currentTrick) return { error: 'cannot pass on lead' };

  r.passCount++;
  // Active = players NOT yet out
  const stillIn = gameState.players.filter(p => !r.finishOrder.includes(p.id));
  // Trick ends when all active players except the current winner have passed
  if (r.passCount >= stillIn.length - 1) {
    return endTrick(gameState);
  }

  return advanceTurn(gameState, playerId);
}

function handleDog(gameState, playerId) {
  const r = gameState.currentRound;
  const p = gameState.players.find(x => x.id === playerId);
  const partnerSeat = (p.seat + 2) % 4;
  let partner = gameState.players.find(x => x.seat === partnerSeat);

  // If partner already out, give to partner's right (opponent)
  if (r.finishOrder.includes(partner.id)) {
    const rightSeat = (partnerSeat + 1) % 4;
    partner = gameState.players.find(x => x.seat === rightSeat);
  }

  // Dog goes to lead to partner; no trick is "won"
  r.currentTrick = null;
  r.passCount = 0;
  r.leadPlayerId = partner.id;
  r.activePlayerId = partner.id;
  return { ok: true, dog: true, newLead: partner.id };
}

function endTrick(gameState) {
  const r = gameState.currentRound;
  const trick = r.currentTrick;
  const winnerId = trick.winnerId;

  // Collect cards
  r.trickWinners[winnerId] = [...(r.trickWinners[winnerId] || []), ...trick.cards];
  r.pastTricks.push(trick);
  r.currentTrick = null;
  r.passCount = 0;

  // Check round over (3+ players out)
  if (r.finishOrder.length >= 3) {
    return endRound(gameState);
  }

  // Next lead
  // If winner is out, they still lead (next available)
  r.leadPlayerId = winnerId;
  r.activePlayerId = winnerId;
  r.phase = PHASE.PLAY;

  // Skip out players
  if (r.finishOrder.includes(winnerId)) {
    return advanceTurn(gameState, winnerId, true);
  }

  return { ok: true, trickWon: true, winnerId };
}

function giveDragonTrick(gameState, winnerId, targetPlayerId) {
  const r = gameState.currentRound;
  if (r.phase !== PHASE.DRAGON_GIVE) return { error: 'wrong phase' };

  const trick = r.currentTrick;
  r.trickWinners[targetPlayerId] = [...(r.trickWinners[targetPlayerId] || []), ...trick.cards];
  r.pastTricks.push({ ...trick, givenTo: targetPlayerId });
  r.currentTrick = null;
  r.passCount = 0;
  r.dragonGivePending = false;
  r.phase = PHASE.PLAY;

  if (r.finishOrder.length >= 3) {
    return endRound(gameState);
  }

  r.leadPlayerId = winnerId;
  r.activePlayerId = winnerId;

  if (r.finishOrder.includes(winnerId)) {
    return advanceTurn(gameState, winnerId, true);
  }

  return { ok: true, dragonGiven: true };
}

function advanceTurn(gameState, currentPlayerId, skipCurrent = false) {
  const r = gameState.currentRound;
  const players = gameState.players;
  const seats = players.map(p => p.seat).sort((a, b) => a - b);

  const currentP = players.find(p => p.id === currentPlayerId);
  let seatIdx = seats.indexOf(currentP.seat);

  let attempts = 0;
  while (attempts < 4) {
    seatIdx = (seatIdx + 1) % 4;
    const nextSeat = seats[seatIdx];
    const next = players.find(p => p.seat === nextSeat);
    if (next && !r.finishOrder.includes(next.id)) {
      // Skip if already out AND it's not their lead
      r.activePlayerId = next.id;
      return { ok: true };
    }
    attempts++;
  }

  return { ok: true };
}

function endRound(gameState) {
  const r = gameState.currentRound;
  r.phase = PHASE.ROUND_OVER;

  // The 4th player (last remaining)
  const allIds = gameState.players.map(p => p.id);
  const lastPlayer = allIds.find(id => !r.finishOrder.includes(id));
  if (lastPlayer) r.finishOrder.push(lastPlayer);

  // Last player's remaining hand goes to scoring
  // (trickWinners tracks won tricks; hand cards of last player are separate)
  r.lastPlayerHand = r.hands[lastPlayer] || [];

  const deltas = scoreRound({
    finishOrder: r.finishOrder,
    trickWinners: r.trickWinners,
    hands: { [lastPlayer]: r.lastPlayerHand },
    grandTichuCalls: r.grandTichuCalls,
    tichuCalls: r.tichuCalls,
  }, gameState.players);

  gameState.totalScores.team0 += deltas.team0;
  gameState.totalScores.team1 += deltas.team1;
  gameState.rounds.push(r);

  // Check game over
  const t0 = gameState.totalScores.team0;
  const t1 = gameState.totalScores.team1;
  if (t0 >= gameState.targetScore || t1 >= gameState.targetScore) {
    gameState.phase = PHASE.GAME_OVER;
    gameState.gameOver = true;
    gameState.winningTeam = t0 > t1 ? 0 : 1;
  }

  return { ok: true, roundOver: true, deltas, finishOrder: r.finishOrder };
}

module.exports = { createGameState, startRound, setGrandTichu, submitExchange, callTichu, playCards, pass, giveDragonTrick, PHASE };
