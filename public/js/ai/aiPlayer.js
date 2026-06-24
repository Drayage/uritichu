import { shouldCallGrandTichu, shouldCallTichu } from './aiTichu.js';
import { decideExchange } from './aiExchange.js';
import { decideLead } from './aiLead.js';
import { decideFollow, decideDragonGive } from './aiFollow.js';

const AI_AVATARS = ['🐱', '🐰', '🐻', '🦊'];
const AI_NAMES = ['냥이', '토순이', '곰돌이', '여우'];

function getAIName(seat) { return AI_NAMES[seat % 4]; }
function getAIAvatar(seat) { return AI_AVATARS[seat % 4]; }

function decideAction(gameState, playerId) {
  const r = gameState.currentRound;
  const p = gameState.players.find(x => x.id === playerId);
  const hand = r.hands[playerId] || [];

  if (r.phase === 'deal_8' || r.phase === 'grand_tichu') {
    if (r.grandTichuCalls[playerId] === null || r.grandTichuCalls[playerId] === undefined) {
      return { action: 'grandTichu', data: { call: shouldCallGrandTichu(hand) } };
    }
  }
  if (r.phase === 'exchange') {
    if (!r.exchangeSubmitted[playerId]) {
      return { action: 'exchange', data: { cards: decideExchange(hand, p.seat, gameState, playerId) } };
    }
  }
  if (r.phase === 'play') {
    if (!r.tichuPlayed[playerId] && (r.tichuCalls[playerId] === null || r.tichuCalls[playerId] === undefined)) {
      if (shouldCallTichu(hand)) return { action: 'tichu', data: {} };
    }
    if (r.activePlayerId !== playerId) return null;
    if (!r.currentTrick || r.currentTrick.plays.length === 0) {
      const combo = decideLead(hand, r, playerId);
      if (!combo) return { action: 'pass', data: {} };
      let wishRank = null;
      if (combo.cards.some(c => c.rank === 'mahjong')) {
        const ranks = new Set(hand.map(c => c.rank));
        wishRank = !ranks.has('A') ? 'A' : !ranks.has('K') ? 'K' : 'Q';
      }
      return { action: 'play', data: { combination: combo, wishRank } };
    } else {
      const result = decideFollow(hand, r, playerId, gameState.players);
      if (result === 'pass') return { action: 'pass', data: {} };
      return { action: 'play', data: { combination: result } };
    }
  }
  if (r.phase === 'dragon_give' && r.dragonGiveWinner === playerId) {
    return { action: 'dragonGive', data: { targetId: decideDragonGive(gameState.players, playerId, r) } };
  }
  return null;
}

export { decideAction, getAIName, getAIAvatar };
