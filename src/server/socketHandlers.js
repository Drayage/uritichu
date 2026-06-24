'use strict';

const rm = require('./roomManager');
const gr = require('./gameRunner');
const { createGameState, startRound, setGrandTichu, submitExchange, callTichu, playCards, pass, giveDragonTrick, PHASE } = require('../engine/gameState');
const { getValidMoves } = require('../engine/combinations');

function register(io) {
  io.on('connection', (socket) => {
    console.log('connect', socket.id);

    socket.on('lobby:create', ({ playerName, config }) => {
      const { room, playerId } = rm.createRoom(socket.id, playerName || '익명', config);
      socket.join(room.roomId);
      socket.emit('lobby:joined', { roomId: room.roomId, playerId, seat: 0 });
      io.to(room.roomId).emit('lobby:state', rm.publicView(room));
    });

    socket.on('lobby:join', ({ roomId, playerName }) => {
      const result = rm.joinRoom(roomId, socket.id, playerName || '익명');
      if (result.error) { socket.emit('lobby:error', { message: result.error }); return; }
      const { room, playerId } = result;
      const me = room.players.find(p => p.socketId === socket.id);
      socket.join(roomId);
      socket.emit('lobby:joined', { roomId, playerId, seat: me.seat });
      io.to(roomId).emit('lobby:state', rm.publicView(room));
    });

    socket.on('lobby:addAI', () => {
      const room = rm.getRoomBySocket(socket.id);
      if (!room || room.hostId !== socket.id) return;
      const result = rm.addAIPlayer(room.roomId);
      if (result.error) { socket.emit('lobby:error', { message: result.error }); return; }
      io.to(room.roomId).emit('lobby:state', rm.publicView(result.room));
    });

    socket.on('lobby:start', () => {
      const room = rm.getRoomBySocket(socket.id);
      if (!room || room.hostId !== socket.id) return;
      if (room.players.length < 4) {
        // Auto-fill with AI
        while (room.players.length < 4) rm.addAIPlayer(room.roomId);
      }
      room.phase = 'playing';

      // Build player list
      const players = room.players.map(p => ({
        id: p.playerId,
        name: p.name,
        avatar: p.avatar || '🙂',
        seat: p.seat,
        teamIndex: p.seat % 2,
        isAI: p.isAI,
      }));

      room.gameState = createGameState(players, room.config.targetScore);
      const roundState = startRound(room.gameState);

      io.to(room.roomId).emit('lobby:state', rm.publicView(room));

      // Send each human player their 8-card hand
      for (const p of room.players) {
        if (p.isAI) continue;
        const s = io.sockets.sockets.get(p.socketId);
        if (!s) continue;
        s.emit('game:roundStart', {
          hand8: roundState.hands[p.playerId],
          players,
          seat: p.seat,
          playerId: p.playerId,
          totalScores: room.gameState.totalScores,
        });
      }

      gr.scheduleAITurn(io, room);
    });

    socket.on('game:grandTichu', ({ call }) => {
      const room = rm.getRoomBySocket(socket.id);
      if (!room || !room.gameState) return;
      const me = room.players.find(p => p.socketId === socket.id);
      if (!me) return;

      const gs = room.gameState;
      const result = setGrandTichu(gs, me.playerId, !!call);
      if (result.error) { socket.emit('game:error', result); return; }

      io.to(room.roomId).emit('game:grandTichuDecided', { playerId: me.playerId, call: !!call });

      if (gs.currentRound.phase === PHASE.EXCHANGE) {
        // All decided, deal remaining 6 cards
        for (const p of room.players) {
          if (p.isAI) continue;
          const s = io.sockets.sockets.get(p.socketId);
          if (!s) continue;
          s.emit('game:dealComplete', { hand: gs.currentRound.hands[p.playerId] });
        }
        io.to(room.roomId).emit('game:exchangePhase');
      }

      gr.scheduleAITurn(io, room);
    });

    socket.on('game:exchange', ({ left, across, right }) => {
      const room = rm.getRoomBySocket(socket.id);
      if (!room || !room.gameState) return;
      const me = room.players.find(p => p.socketId === socket.id);
      if (!me) return;

      const gs = room.gameState;
      const result = submitExchange(gs, me.playerId, { left, across, right });
      if (result.error) { socket.emit('game:error', result); return; }

      socket.emit('game:exchangeSubmitted', { playerId: me.playerId });
      io.to(room.roomId).emit('game:exchangeProgress', {
        submitted: Object.entries(gs.currentRound.exchangeSubmitted)
          .filter(([, v]) => v).map(([k]) => k)
      });

      if (gs.currentRound.phase === PHASE.PLAY) {
        // Exchange done - send updated hands
        for (const p of room.players) {
          if (p.isAI) continue;
          const s = io.sockets.sockets.get(p.socketId);
          if (!s) continue;
          s.emit('game:handUpdate', { hand: gs.currentRound.hands[p.playerId] });
        }
        gr.broadcastTurnStart(io, room);
        gr.scheduleAITurn(io, room);
      } else {
        gr.scheduleAITurn(io, room);
      }
    });

    socket.on('game:tichu', () => {
      const room = rm.getRoomBySocket(socket.id);
      if (!room || !room.gameState) return;
      const me = room.players.find(p => p.socketId === socket.id);
      if (!me) return;
      const result = callTichu(room.gameState, me.playerId);
      if (result.error) { socket.emit('game:error', result); return; }
      io.to(room.roomId).emit('game:tichuAnnounce', { playerId: me.playerId, type: 'tichu' });
    });

    socket.on('game:play', ({ cardIds, wishRank }) => {
      const room = rm.getRoomBySocket(socket.id);
      if (!room || !room.gameState) return;
      const me = room.players.find(p => p.socketId === socket.id);
      if (!me) return;

      const gs = room.gameState;
      const r = gs.currentRound;
      const hand = r.hands[me.playerId];
      const cards = cardIds.map(id => hand.find(c => c.id === id)).filter(Boolean);

      if (cards.length !== cardIds.length) { socket.emit('game:error', { message: 'Invalid cards' }); return; }

      const { detectCombination } = require('../engine/combinations');
      const combo = detectCombination(cards);
      if (!combo) { socket.emit('game:error', { message: 'Invalid combination' }); return; }

      // Validate can beat current
      const { canBeat } = require('../engine/combinations');
      if (r.currentTrick && !canBeat(combo, r.currentTrick.winningCombo)) {
        socket.emit('game:error', { message: 'Cannot beat current trick' }); return;
      }

      const result = playCards(gs, me.playerId, combo, wishRank || null);
      if (result && result.error) { socket.emit('game:error', result); return; }

      io.to(room.roomId).emit('game:played', {
        playerId: me.playerId,
        combination: combo,
        handCount: r.hands[me.playerId].length,
        wishRank: wishRank || null,
      });

      gr.broadcastState(io, room);
      handleResult(io, room, result, me.playerId);
    });

    socket.on('game:pass', () => {
      const room = rm.getRoomBySocket(socket.id);
      if (!room || !room.gameState) return;
      const me = room.players.find(p => p.socketId === socket.id);
      if (!me) return;

      const result = pass(room.gameState, me.playerId);
      if (result && result.error) { socket.emit('game:error', result); return; }

      io.to(room.roomId).emit('game:passed', { playerId: me.playerId });
      gr.broadcastState(io, room);
      handleResult(io, room, result, me.playerId);
    });

    socket.on('game:dragonGive', ({ targetPlayerId }) => {
      const room = rm.getRoomBySocket(socket.id);
      if (!room || !room.gameState) return;
      const me = room.players.find(p => p.socketId === socket.id);
      if (!me) return;

      const result = giveDragonTrick(room.gameState, me.playerId, targetPlayerId);
      if (result && result.error) { socket.emit('game:error', result); return; }

      io.to(room.roomId).emit('game:dragonGiven', { winnerId: me.playerId, targetId: targetPlayerId });
      gr.broadcastState(io, room);
      handleResult(io, room, result, me.playerId);
    });

    socket.on('game:nextRound', () => {
      const room = rm.getRoomBySocket(socket.id);
      if (!room || !room.gameState) return;
      if (room.gameState.gameOver) return;

      const gs = room.gameState;
      gs._lastFinishCount = 0;
      const roundState = startRound(gs);

      for (const p of room.players) {
        if (p.isAI) continue;
        const s = io.sockets.sockets.get(p.socketId);
        if (!s) continue;
        s.emit('game:roundStart', {
          hand8: roundState.hands[p.playerId],
          players: gs.players,
          seat: p.seat,
          playerId: p.playerId,
          totalScores: gs.totalScores,
        });
      }

      gr.scheduleAITurn(io, room);
    });

    socket.on('disconnect', () => {
      const room = rm.getRoomBySocket(socket.id);
      if (room) {
        rm.removePlayer(room.roomId, socket.id);
        io.to(room.roomId).emit('lobby:state', rm.publicView(room));
      }
    });
  });
}

function handleResult(io, room, result, playerId) {
  if (!result) return;
  const gs = room.gameState;
  const r = gs.currentRound;

  if (result.dragonGive) {
    io.to(room.roomId).emit('game:dragonGivePhase', { playerId });
    gr.scheduleAITurn(io, room);
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

  gr.broadcastTurnStart(io, room);
  gr.scheduleAITurn(io, room);
}

module.exports = { register };
