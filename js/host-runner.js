import { decideAction } from './ai/aiPlayer.js';
import { startRound, setGrandTichu, submitExchange, callTichu, playCards, pass, giveDragonTrick, PHASE } from './engine/gameState.js';
import { saveGameState, getLatestGameState } from './room-manager.js';

let _running = false;
let _roomId = null;
let _hostId = null;
let _watchdogTimer = null;
let _watchdogForId = null;
let _pendingRoomData = null;
let _pendingMyId = null;
let _fastMode = false;

export function setAIFastMode(fast) { _fastMode = fast; }

export function initHostRunner(roomId, hostId) {
  _roomId = roomId;
  _hostId = hostId;
}

export async function onRoomStateChange(roomData, myId) {
  if (roomData.hostId !== myId) return;
  if (_running) {
    _pendingRoomData = roomData;
    _pendingMyId = myId;
    return;
  }
  const gs = roomData.gameState;
  if (!gs || !gs.currentRound) return;
  const r = gs.currentRound;
  if (r.phase === PHASE.ROUND_OVER || r.phase === PHASE.GAME_OVER) return;

  // Grand tichu phase
  if (r.phase === PHASE.DEAL_8 || r.phase === PHASE.GRAND_TICHU) {
    const pendingAI = gs.players.filter(p => p.isAI && (r.grandTichuCalls[p.id] === null || r.grandTichuCalls[p.id] === undefined));
    if (pendingAI.length > 0) {
      await _runWithDelay(async () => {
        const fresh = JSON.parse(JSON.stringify(gs));
        for (const p of pendingAI) {
          const action = decideAction(fresh, p.id);
          if (action?.action === 'grandTichu') setGrandTichu(fresh, p.id, action.data.call);
        }
        await saveGameState(_roomId, fresh);
      });
    }
    return;
  }

  // Exchange phase
  if (r.phase === PHASE.EXCHANGE) {
    const pendingAI = gs.players.filter(p => p.isAI && !r.exchangeSubmitted[p.id]);
    if (pendingAI.length > 0) {
      await _runWithDelay(async () => {
        const fresh = JSON.parse(JSON.stringify(gs));
        for (const p of pendingAI) {
          const action = decideAction(fresh, p.id);
          if (action?.action === 'exchange') submitExchange(fresh, p.id, action.data.cards);
        }
        await saveGameState(_roomId, fresh);
      });
    }
    return;
  }

  // Dragon give
  if (r.phase === PHASE.DRAGON_GIVE) {
    const winner = gs.players.find(p => p.id === r.dragonGiveWinner);
    if (winner?.isAI) {
      _clearWatchdog();
      await _runWithDelay(async () => {
        const fresh = JSON.parse(JSON.stringify(gs));
        const action = decideAction(fresh, winner.id);
        if (action?.action === 'dragonGive') giveDragonTrick(fresh, winner.id, action.data.targetId);
        await saveGameState(_roomId, fresh);
      });
    }
    return;
  }

  // Play phase
  if (r.phase === PHASE.PLAY && r.activePlayerId) {
    // Guard: skip if active player already finished (shouldn't happen but prevents infinite loops)
    if (r.finishOrder.includes(r.activePlayerId)) return;
    const active = gs.players.find(p => p.id === r.activePlayerId);
    if (active?.isAI) {
      _armWatchdog(active.id, gs);
      await _runWithDelay(async () => {
        _clearWatchdog();
        // Re-fetch latest state before acting — a human may have bombed during the delay window
        const latestGs = await getLatestGameState(_roomId);
        if (!latestGs?.currentRound || latestGs.currentRound.activePlayerId !== active.id) return;

        const fresh = JSON.parse(JSON.stringify(latestGs));
        let action = decideAction(fresh, active.id);

        // Tichu call: do it then immediately decide the actual play in same save
        if (action?.action === 'tichu') {
          callTichu(fresh, active.id);
          action = decideAction(fresh, active.id);
        }

        if (!action || action.action === 'pass') {
          const result = pass(fresh, active.id);
          if (result?.error) console.warn('[HostRunner] pass error:', result.error);
        } else if (action.action === 'play') {
          const result = playCards(fresh, active.id, action.data.combination, action.data.wishRank || null);
          if (result?.error) {
            console.warn('[HostRunner] play error, falling back to pass:', result.error);
            pass(fresh, active.id);
          }
        }

        await saveGameState(_roomId, fresh);
      }, _fastMode ? 180 : 1500);
    } else {
      _clearWatchdog();
    }
  }
}

async function _runWithDelay(fn, delay = 900) {
  if (_running) return;
  _running = true;
  await new Promise(r => setTimeout(r, delay));
  try {
    await fn();
  } catch (e) {
    console.error('[HostRunner] error:', e);
  } finally {
    _running = false;
    // Re-process any state change that arrived while we were busy
    if (_pendingRoomData) {
      const pending = _pendingRoomData;
      const pendingId = _pendingMyId;
      _pendingRoomData = null;
      _pendingMyId = null;
      setTimeout(() => onRoomStateChange(pending, pendingId), 0);
    }
  }
}

function _armWatchdog(playerId, gs) {
  if (_watchdogForId === playerId) return;  // already watching this player
  _clearWatchdog();
  _watchdogForId = playerId;
  _watchdogTimer = setTimeout(async () => {
    console.warn('[HostRunner] Watchdog: AI stuck for 10s, forcing pass for', playerId);
    _running = false;
    _watchdogForId = null;
    _watchdogTimer = null;
    try {
      const fresh = JSON.parse(JSON.stringify(gs));
      const r = fresh.currentRound;
      if (r.activePlayerId === playerId) {
        pass(fresh, playerId);
        await saveGameState(_roomId, fresh);
      }
    } catch (e) {
      console.error('[HostRunner] Watchdog save error:', e);
    }
  }, 10000);
}

function _clearWatchdog() {
  if (_watchdogTimer) { clearTimeout(_watchdogTimer); _watchdogTimer = null; }
  _watchdogForId = null;
}

export async function hostStartRound(gs) {
  const fresh = JSON.parse(JSON.stringify(gs));
  startRound(fresh);
  await saveGameState(_roomId, fresh);
  return fresh;
}
