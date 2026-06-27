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
      _armWatchdog(active.id);
      // Extra pause when an AI is about to LEAD right after winning a trick, so
      // the "trick won" result is visible before the next card flies out.
      const leadingAfterTrick =
        (!r.currentTrick || (r.currentTrick.plays?.length ?? 0) === 0) &&
        (r.pastTricks?.length || 0) > 0;
      const base = _fastMode ? 380 : 1500;
      let delay = leadingAfterTrick ? base + (_fastMode ? 550 : 1000) : base;
      // A dog just handed the lead to the partner — pause so the 멍멍이 effect
      // is visible before the partner leads (otherwise the lead seems to jump).
      if (r.dogLeadPending) delay = Math.max(delay, base + (_fastMode ? 700 : 1200));
      await _runWithDelay(async () => {
        _clearWatchdog();
        await _applyAIMove(active.id);
      }, delay);
    } else {
      _clearWatchdog();
    }
  }
}

// Re-fetch the latest committed state, decide for `playerId`, apply, and save.
// Always works off fresh state (never a stale snapshot), so it can't clobber
// newer state, and it makes the CORRECT move instead of a blind pass. The
// seq-guarded saveGameState rejects the write if the state moved on meanwhile.
async function _applyAIMove(playerId) {
  const latestGs = await getLatestGameState(_roomId);
  const r = latestGs?.currentRound;
  if (!r || r.phase !== PHASE.PLAY) return;
  if (r.activePlayerId !== playerId) return;            // turn moved on — do nothing
  if ((r.finishOrder || []).includes(playerId)) return; // already finished

  const fresh = JSON.parse(JSON.stringify(latestGs));
  let action = decideAction(fresh, playerId);

  // Tichu call: do it then immediately decide the actual play in the same save
  if (action?.action === 'tichu') {
    callTichu(fresh, playerId);
    action = decideAction(fresh, playerId);
  }

  if (!action || action.action === 'pass') {
    const result = pass(fresh, playerId);
    if (result?.error) { console.warn('[HostRunner] pass error:', result.error); return; }
  } else if (action.action === 'play') {
    const result = playCards(fresh, playerId, action.data.combination, action.data.wishRank || null);
    if (result?.error) {
      console.warn('[HostRunner] play error, falling back to pass:', result.error);
      const pres = pass(fresh, playerId);
      if (pres?.error) return;
    }
  }

  await saveGameState(_roomId, fresh);
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

function _armWatchdog(playerId) {
  if (_watchdogForId === playerId) return;  // already watching this player
  _clearWatchdog();
  _watchdogForId = playerId;
  _watchdogTimer = setTimeout(async () => {
    console.warn('[HostRunner] Watchdog: AI stuck, recovering for', playerId);
    _running = false;
    _watchdogForId = null;
    _watchdogTimer = null;
    try {
      // Recover off FRESH state with the proper decision — never a stale
      // snapshot or a blind pass (which would wrongly pass a playable hand).
      await _applyAIMove(playerId);
    } catch (e) {
      console.error('[HostRunner] Watchdog recovery error:', e);
    }
  }, 6000);
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
