'use strict';

const { shouldCallGrandTichu, shouldCallTichu } = require('./aiTichu');
const { decideExchange } = require('./aiExchange');
const { decideLead } = require('./aiLead');
const { decideFollow, decideDragonGive } = require('./aiFollow');
const { detectCombination } = require('../engine/combinations');
const { PHASE } = require('../engine/gameState');

const AI_AVATARS = ['🐱', '🐰', '🐻', '🦊'];
const AI_NAMES = ['냥이', '토순이', '곰돌이', '여우'];

function getAIName(seat) {
  return AI_NAMES[seat % 4];
}

function getAIAvatar(seat) {
  return AI_AVATARS[seat % 4];
}

// Returns the action the AI should take given the current game state
// Returns: { action, data }
function decideAction(gameState, playerId) {
  const r = gameState.currentRound;
  const p = gameState.players.find(x => x.id === playerId);
  const hand = r.hands[playerId] || [];

  if (r.phase === PHASE.DEAL_8 || r.phase === PHASE.GRAND_TICHU) {
    // Grand Tichu decision (on 8 cards)
    if (r.grandTichuCalls[playerId] === null) {
      const call = shouldCallGrandTichu(hand);
      return { action: 'grandTichu', data: { call } };
    }
  }

  if (r.phase === PHASE.EXCHANGE) {
    if (!r.exchangeSubmitted[playerId]) {
      const cards = decideExchange(hand, p.seat);
      return { action: 'exchange', data: { cards } };
    }
  }

  if (r.phase === PHASE.PLAY) {
    // Maybe call tichu before first play
    if (!r.tichuPlayed[playerId] && r.tichuCalls[playerId] === null) {
      if (shouldCallTichu(hand)) {
        return { action: 'tichu', data: {} };
      }
    }

    if (r.activePlayerId !== playerId) return null;

    // Lead or follow
    if (!r.currentTrick || r.currentTrick.plays.length === 0) {
      // Lead
      const combo = decideLead(hand, r, playerId);
      if (!combo) return { action: 'pass', data: {} };

      // If mahjong in combo, choose wish rank
      let wishRank = null;
      if (combo.cards.some(c => c.rank === 'mahjong')) {
        wishRank = chooseMahjongWish(hand);
      }
      return { action: 'play', data: { combination: combo, wishRank } };
    } else {
      const result = decideFollow(hand, r, playerId, gameState.players);
      if (result === 'pass') return { action: 'pass', data: {} };
      return { action: 'play', data: { combination: result } };
    }
  }

  if (r.phase === PHASE.DRAGON_GIVE) {
    if (r.dragonGiveWinner === playerId) {
      const targetId = decideDragonGive(gameState.players, playerId, r);
      return { action: 'dragonGive', data: { targetId } };
    }
  }

  return null;
}

function chooseMahjongWish(hand) {
  // Wish for a rank we don't have (to disrupt opponents)
  // Simple: wish for 'A' if we don't have one
  const ranks = new Set(hand.map(c => c.rank));
  if (!ranks.has('A')) return 'A';
  if (!ranks.has('K')) return 'K';
  return 'Q';
}

module.exports = { decideAction, getAIName, getAIAvatar };
