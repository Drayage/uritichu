import { createDeck, shuffleDeck, dealCards } from './cards.js';
import { applyExchanges } from './exchange.js';
import { scoreRound } from './scoring.js';
import { canBeat } from './combinations.js';

const PHASE = {
  DEAL_8: 'deal_8', GRAND_TICHU: 'grand_tichu', DEAL_6: 'deal_6',
  EXCHANGE: 'exchange', PLAY: 'play', DRAGON_GIVE: 'dragon_give',
  ROUND_OVER: 'round_over', GAME_OVER: 'game_over',
};

function createGameState(players, targetScore = 1000) {
  return { players, totalScores: { team0: 0, team1: 0 }, rounds: [], currentRound: null, phase: PHASE.DEAL_8, gameOver: false, winningTeam: null, targetScore };
}

function startRound(gameState) {
  const deck = shuffleDeck(createDeck());
  const { hands, remaining } = dealCards(deck);
  const players = gameState.players;
  const roundState = {
    phase: PHASE.DEAL_8, hands: {}, remaining: {}, grandTichuCalls: {}, tichuCalls: {},
    tichuPlayed: {}, exchangeCards: {}, exchangeSubmitted: {}, wishRank: null,
    currentTrick: null, pastTricks: [], trickWinners: {}, finishOrder: [],
    leadPlayerId: null, activePlayerId: null, passCount: 0,
    dragonGivePending: false, dragonGiveWinner: null,
  };
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
  const allDecided = gameState.players.every(p => r.grandTichuCalls[p.id] !== null);
  if (allDecided) {
    for (const p of gameState.players) r.hands[p.id] = [...r.hands[p.id], ...r.remaining[p.id]];
    r.phase = PHASE.EXCHANGE;
  }
  return { ok: true };
}

function submitExchange(gameState, playerId, cards) {
  const r = gameState.currentRound;
  if (r.phase !== PHASE.EXCHANGE) return { error: 'wrong phase' };
  r.exchangeCards[playerId] = cards;
  r.exchangeSubmitted[playerId] = true;
  const allDone = gameState.players.every(p => r.exchangeSubmitted[p.id]);
  if (allDone) {
    const playersBySeat = [...gameState.players].sort((a, b) => a.seat - b.seat);
    r.hands = applyExchanges(r.hands, r.exchangeCards, playersBySeat);
    r.phase = PHASE.PLAY;
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
  const isMyTurn = r.activePlayerId === playerId;
  if (!isMyTurn) {
    if (!combination.isBomb) return { error: 'not your turn' };
    if (!r.currentTrick?.winningCombo) return { error: '선공 상태에서는 차례에 내야 해요' };
    if (!canBeat(combination, r.currentTrick.winningCombo)) return { error: '현재 패를 이길 수 없어요' };
  }
  const cardIds = new Set(combination.cards.map(c => c.id));
  r.hands[playerId] = r.hands[playerId].filter(c => !cardIds.has(c.id));
  r.tichuPlayed[playerId] = true;
  if (combination.cards.length === 1 && combination.cards[0].rank === 'dog') return handleDog(gameState, playerId);
  if (combination.cards.some(c => c.rank === 'mahjong') && wishRank) r.wishRank = wishRank;
  if (r.wishRank && combination.cards.some(c => c.rank === r.wishRank || String(c.numericValue) === String(r.wishRank))) r.wishRank = null;
  if (!r.currentTrick) r.currentTrick = { plays: [], leadPlayerId: playerId, winnerId: playerId, winningCombo: combination, cards: [] };
  r.currentTrick.plays.push({ playerId, combination });
  r.currentTrick.cards.push(...combination.cards);
  r.currentTrick.winnerId = playerId;
  r.currentTrick.winningCombo = combination;
  r.passCount = 0;
  if (r.hands[playerId].length === 0) r.finishOrder.push(playerId);
  if (combination.cards.some(c => c.rank === 'dragon') && r.finishOrder.length < 3) {
    r.dragonGivePending = true;
    r.dragonGiveWinner = playerId;
    r.phase = PHASE.DRAGON_GIVE;
    return { ok: true, dragonGive: true };
  }
  if (r.finishOrder.length >= 3) {
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
  const stillIn = gameState.players.filter(p => !r.finishOrder.includes(p.id));
  if (r.passCount >= stillIn.length - 1) return endTrick(gameState);
  return advanceTurn(gameState, playerId);
}

function handleDog(gameState, playerId) {
  const r = gameState.currentRound;
  const p = gameState.players.find(x => x.id === playerId);
  const partnerSeat = (p.seat + 2) % 4;
  let partner = gameState.players.find(x => x.seat === partnerSeat);
  if (r.finishOrder.includes(partner.id)) {
    const rightSeat = (partnerSeat + 1) % 4;
    partner = gameState.players.find(x => x.seat === rightSeat);
  }
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
  r.trickWinners[winnerId] = [...(r.trickWinners[winnerId] || []), ...trick.cards];
  r.pastTricks.push(trick);
  r.currentTrick = null;
  r.passCount = 0;
  if (r.finishOrder.length >= 3) return endRound(gameState);
  r.leadPlayerId = winnerId;
  r.activePlayerId = winnerId;
  r.phase = PHASE.PLAY;
  if (r.finishOrder.includes(winnerId)) return advanceTurn(gameState, winnerId, true);
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
  if (r.finishOrder.length >= 3) return endRound(gameState);
  r.leadPlayerId = winnerId;
  r.activePlayerId = winnerId;
  if (r.finishOrder.includes(winnerId)) return advanceTurn(gameState, winnerId, true);
  return { ok: true, dragonGiven: true };
}

function advanceTurn(gameState, currentPlayerId, skipCurrent = false) {
  const r = gameState.currentRound;
  const players = gameState.players;
  const seats = players.map(p => p.seat).sort((a, b) => a - b);
  const currentP = players.find(p => p.id === currentPlayerId);
  let seatIdx = seats.indexOf(currentP.seat);
  for (let attempts = 0; attempts < 4; attempts++) {
    seatIdx = (seatIdx + 1) % 4;
    const next = players.find(p => p.seat === seats[seatIdx]);
    if (next && !r.finishOrder.includes(next.id)) { r.activePlayerId = next.id; return { ok: true }; }
  }
  return { ok: true };
}

function endRound(gameState) {
  const r = gameState.currentRound;
  r.phase = PHASE.ROUND_OVER;
  const allIds = gameState.players.map(p => p.id);
  const lastPlayer = allIds.find(id => !r.finishOrder.includes(id));
  if (lastPlayer) r.finishOrder.push(lastPlayer);
  r.lastPlayerHand = r.hands[lastPlayer] || [];
  const deltas = scoreRound({
    finishOrder: r.finishOrder, trickWinners: r.trickWinners,
    hands: { [lastPlayer]: r.lastPlayerHand },
    grandTichuCalls: r.grandTichuCalls, tichuCalls: r.tichuCalls,
  }, gameState.players);
  gameState.totalScores.team0 += deltas.team0;
  gameState.totalScores.team1 += deltas.team1;
  gameState.rounds.push(r);
  const t0 = gameState.totalScores.team0, t1 = gameState.totalScores.team1;
  if (t0 >= gameState.targetScore || t1 >= gameState.targetScore) {
    gameState.phase = PHASE.GAME_OVER;
    gameState.gameOver = true;
    gameState.winningTeam = t0 > t1 ? 0 : 1;
  }
  return { ok: true, roundOver: true, deltas, finishOrder: r.finishOrder };
}

export { createGameState, startRound, setGrandTichu, submitExchange, callTichu, playCards, pass, giveDragonTrick, PHASE };
