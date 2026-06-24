'use strict';

const { decideAction } = require('../ai/aiPlayer');
const {
  setGrandTichu, submitExchange, callTichu,
  playCards, pass, giveDragonTrick, startRound, PHASE
} = require('../engine/gameState');

const AI_DELAY = 900; // ms

function scheduleAITurn(io, room) {
  const r = room.gameState.currentRound;
  if (!r) return;

  // Find which AI players need to act
  const aiPlayers = room.players.filter(p => p.isAI);

  for (const ai of aiPlayers) {
    const pid = ai.playerId;
    const gs = room.gameState;
    const round = gs.currentRound;

    // Check if this AI needs to decide
    let needsAction = false;

    if (round.phase === PHASE.DEAL_8 || round.phase === PHASE.GRAND_TICHU) {
      if (round.grandTichuCalls[pid] === null) needsAction = true;
    }
    if (round.phase === PHASE.EXCHANGE && !round.exchangeSubmitted[pid]) needsAction = true;
    if (round.phase === PHASE.PLAY && round.activePlayerId === pid) needsAction = true;
    if (round.phase === PHASE.PLAY && !round.tichuPlayed[pid] && round.tichuCalls[pid] === null) needsAction = true;
    if (round.phase === PHASE.DRAGON_GIVE && round.dragonGiveWinner === pid) needsAction = true;

    if (needsAction) {
      setTimeout(() => runAIAction(io, room, pid), AI_DELAY);
    }
  }
}

function runAIAction(io, room, playerId) {
  const gs = room.gameState;
  if (!gs || gs.gameOver) return;

  const action = decideAction(gs, playerId);
  if (!action) return;

  let result;

  if (action.action === 'grandTichu') {
    result = setGrandTichu(gs, playerId, action.data.call);
    io.to(room.roomId).emit('game:grandTichuDecided', { playerId, call: action.data.call });
    broadcastState(io, room);
    if (gs.currentRound.phase === PHASE.EXCHANGE) {
      scheduleAITurn(io, room);
    } else {
      scheduleAITurn(io, room);
    }
  } else if (action.action === 'exchange') {
    result = submitExchange(gs, playerId, action.data.cards);
    io.to(room.roomId).emit('game:exchangeSubmitted', { playerId });
    broadcastState(io, room);
    if (gs.currentRound.phase === PHASE.PLAY) {
      broadcastTurnStart(io, room);
      scheduleAITurn(io, room);
    } else {
      scheduleAITurn(io, room);
    }
  } else if (action.action === 'tichu') {
    callTichu(gs, playerId);
    io.to(room.roomId).emit('game:tichuAnnounce', { playerId, type: 'tichu' });
    scheduleAITurn(io, room);
  } else if (action.action === 'play') {
    result = playCards(gs, playerId, action.data.combination, action.data.wishRank || null);
    io.to(room.roomId).emit('game:played', {
      playerId,
      combination: action.data.combination,
      handCount: gs.currentRound.hands[playerId].length,
      wishRank: action.data.wishRank || null,
    });
    broadcastState(io, room);
    handlePlayResult(io, room, result, playerId);
  } else if (action.action === 'pass') {
    result = pass(gs, playerId);
    io.to(room.roomId).emit('game:passed', { playerId });
    broadcastState(io, room);
    handlePlayResult(io, room, result, playerId);
  } else if (action.action === 'dragonGive') {
    result = giveDragonTrick(gs, playerId, action.data.targetId);
    io.to(room.roomId).emit('game:dragonGiven', { winnerId: playerId, targetId: action.data.targetId });
    broadcastState(io, room);
    handlePlayResult(io, room, result, playerId);
  }
}

function handlePlayResult(io, room, result, playerId) {
  const gs = room.gameState;
  const r = gs.currentRound;

  if (!result) return;

  if (result.dragonGive) {
    io.to(room.roomId).emit('game:dragonGivePhase', { playerId });
    scheduleAITurn(io, room);
    return;
  }

  if (result.trickWon) {
    io.to(room.roomId).emit('game:trickWon', { winnerId: result.winnerId });
  }

  if (r.finishOrder.length > (gs._lastFinishCount || 0)) {
    gs._lastFinishCount = r.finishOrder.length;
    const lastOut = r.finishOrder[r.finishOrder.length - 1];
    io.to(room.roomId).emit('game:playerOut', { playerId: lastOut, position: r.finishOrder.length });
  }

  if (result.roundOver) {
    io.to(room.roomId).emit('game:roundOver', {
      deltas: result.deltas,
      finishOrder: result.finishOrder,
      totalScores: gs.totalScores,
    });
    if (gs.gameOver) {
      io.to(room.roomId).emit('game:gameOver', { winningTeam: gs.winningTeam, totalScores: gs.totalScores });
    }
    return;
  }

  broadcastTurnStart(io, room);
  scheduleAITurn(io, room);
}

function broadcastState(io, room) {
  const gs = room.gameState;
  const r = gs.currentRound;
  if (!r) return;

  // Send each player their private state
  for (const player of room.players) {
    if (player.isAI || !player.socketId) continue;
    const socket = io.sockets.sockets.get(player.socketId);
    if (!socket) continue;

    socket.emit('game:state', buildPlayerView(gs, r, player.playerId));
  }
}

function broadcastTurnStart(io, room) {
  const gs = room.gameState;
  const r = gs.currentRound;
  if (!r || r.phase !== PHASE.PLAY) return;

  io.to(room.roomId).emit('game:turnStart', {
    activePlayerId: r.activePlayerId,
    leadPlayerId: r.leadPlayerId,
    currentTrick: r.currentTrick ? {
      plays: r.currentTrick.plays,
      winnerId: r.currentTrick.winnerId,
      winningCombo: r.currentTrick.winningCombo,
    } : null,
    wishRank: r.wishRank,
    finishOrder: r.finishOrder,
    handCounts: Object.fromEntries(
      Object.entries(r.hands).map(([pid, h]) => [pid, h.length])
    ),
    tichuCalls: r.tichuCalls,
    grandTichuCalls: r.grandTichuCalls,
  });
}

function buildPlayerView(gs, r, playerId) {
  return {
    phase: r.phase,
    myHand: r.hands[playerId] || [],
    activePlayerId: r.activePlayerId,
    leadPlayerId: r.leadPlayerId,
    currentTrick: r.currentTrick ? {
      plays: r.currentTrick.plays,
      winnerId: r.currentTrick.winnerId,
      winningCombo: r.currentTrick.winningCombo,
    } : null,
    wishRank: r.wishRank,
    finishOrder: r.finishOrder,
    handCounts: Object.fromEntries(
      Object.entries(r.hands).map(([pid, h]) => [pid, h.length])
    ),
    tichuCalls: r.tichuCalls,
    grandTichuCalls: r.grandTichuCalls,
    totalScores: gs.totalScores,
  };
}

module.exports = { scheduleAITurn, broadcastState, broadcastTurnStart, buildPlayerView };
