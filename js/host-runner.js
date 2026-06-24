import { decideAction } from './ai/aiPlayer.js';
import { startRound, setGrandTichu, submitExchange, callTichu, playCards, pass, giveDragonTrick, PHASE } from './engine/gameState.js';
import { saveGameState } from './room-manager.js';

let _running = false;
let _roomId = null;
let _hostId = null;

export function initHostRunner(roomId, hostId) {
  _roomId = roomId;
  _hostId = hostId;
}

// Called by the game client whenever room state changes
// Only the host executes this; others ignore
export async function onRoomStateChange(roomData, myId) {
  if (roomData.hostId !== myId) return;
  if (_running) return;
  const gs = roomData.gameState;
  if (!gs || !gs.currentRound) return;
  const r = gs.currentRound;
  if (r.phase === PHASE.ROUND_OVER || r.phase === PHASE.GAME_OVER) return;

  // Grand tichu phase: act for all AI that haven't decided
  if (r.phase === PHASE.DEAL_8 || r.phase === PHASE.GRAND_TICHU) {
    const pendingAI = gs.players.filter(p => p.isAI && (r.grandTichuCalls[p.id] === null || r.grandTichuCalls[p.id] === undefined));
    if (pendingAI.length > 0) {
      await _runWithDelay(async () => {
        const fresh = JSON.parse(JSON.stringify(gs));
        for (const p of pendingAI) {
          const action = decideAction(fresh, p.id);
          if (action && action.action === 'grandTichu') setGrandTichu(fresh, p.id, action.data.call);
        }
        await saveGameState(_roomId, fresh);
      });
    }
    return;
  }

  // Exchange phase: act for all AI that haven't submitted
  if (r.phase === PHASE.EXCHANGE) {
    const pendingAI = gs.players.filter(p => p.isAI && !r.exchangeSubmitted[p.id]);
    if (pendingAI.length > 0) {
      await _runWithDelay(async () => {
        const fresh = JSON.parse(JSON.stringify(gs));
        for (const p of pendingAI) {
          const action = decideAction(fresh, p.id);
          if (action && action.action === 'exchange') submitExchange(fresh, p.id, action.data.cards);
        }
        await saveGameState(_roomId, fresh);
      });
    }
    return;
  }

  // Dragon give
  if (r.phase === PHASE.DRAGON_GIVE) {
    const winner = gs.players.find(p => p.id === r.dragonGiveWinner);
    if (winner && winner.isAI) {
      await _runWithDelay(async () => {
        const fresh = JSON.parse(JSON.stringify(gs));
        const action = decideAction(fresh, winner.id);
        if (action && action.action === 'dragonGive') giveDragonTrick(fresh, winner.id, action.data.targetId);
        await saveGameState(_roomId, fresh);
      });
    }
    return;
  }

  // Play phase: act for active AI player
  if (r.phase === PHASE.PLAY && r.activePlayerId) {
    const active = gs.players.find(p => p.id === r.activePlayerId);
    if (active && active.isAI) {
      // Also check if AI needs to call tichu first
      await _runWithDelay(async () => {
        const fresh = JSON.parse(JSON.stringify(gs));
        const action = decideAction(fresh, active.id);
        if (!action) return;
        if (action.action === 'tichu') { callTichu(fresh, active.id); }
        else if (action.action === 'play') { playCards(fresh, active.id, action.data.combination, action.data.wishRank || null); }
        else if (action.action === 'pass') { pass(fresh, active.id); }
        await saveGameState(_roomId, fresh);
      });
    }
  }
}

async function _runWithDelay(fn, delay = 900) {
  if (_running) return;
  _running = true;
  await new Promise(r => setTimeout(r, delay));
  try { await fn(); } finally { _running = false; }
}

// Host starts the next round
export async function hostStartRound(gs) {
  const fresh = JSON.parse(JSON.stringify(gs));
  startRound(fresh);
  await saveGameState(_roomId, fresh);
  return fresh;
}
