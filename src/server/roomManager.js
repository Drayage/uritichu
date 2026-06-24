'use strict';

const { getAIName, getAIAvatar } = require('../ai/aiPlayer');

const rooms = new Map();

function genId(len = 6) {
  return Math.random().toString(36).substring(2, 2 + len).toUpperCase();
}

function createRoom(socketId, playerName, config = {}) {
  const roomId = genId();
  const playerId = genId(8);
  const room = {
    roomId,
    hostId: socketId,
    players: [{
      socketId,
      playerId,
      name: playerName,
      seat: 0,
      ready: false,
      isAI: false,
      avatar: '🙂',
    }],
    aiSlots: new Set(),
    gameState: null,
    phase: 'lobby',
    createdAt: Date.now(),
    config: {
      fillWithAI: config.fillWithAI !== false,
      targetScore: config.targetScore || 1000,
    },
  };
  rooms.set(roomId, room);
  return { room, playerId };
}

function joinRoom(roomId, socketId, playerName) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.phase !== 'lobby') return { error: 'Game already started' };
  if (room.players.filter(p => !p.isAI).length >= 4) return { error: 'Room is full' };

  // Find first available seat
  const takenSeats = new Set(room.players.map(p => p.seat));
  let seat = -1;
  for (let i = 0; i < 4; i++) {
    if (!takenSeats.has(i)) { seat = i; break; }
  }
  if (seat === -1) return { error: 'No seats available' };

  const playerId = genId(8);
  room.players.push({ socketId, playerId, name: playerName, seat, ready: false, isAI: false, avatar: '🙂' });
  return { room, playerId };
}

function addAIPlayer(roomId) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  const takenSeats = new Set(room.players.map(p => p.seat));
  let seat = -1;
  for (let i = 0; i < 4; i++) {
    if (!takenSeats.has(i)) { seat = i; break; }
  }
  if (seat === -1) return { error: 'No seats available' };

  const playerId = `ai_${genId(6)}`;
  const aiPlayer = {
    socketId: null,
    playerId,
    name: getAIName(seat),
    avatar: getAIAvatar(seat),
    seat,
    ready: true,
    isAI: true,
  };
  room.players.push(aiPlayer);
  room.aiSlots.add(seat);
  return { room, playerId };
}

function removePlayer(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.players = room.players.filter(p => p.socketId !== socketId);
  if (room.players.length === 0) rooms.delete(roomId);
}

function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.socketId === socketId)) return room;
  }
  return null;
}

function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

function publicView(room) {
  return {
    roomId: room.roomId,
    phase: room.phase,
    config: room.config,
    players: room.players.map(p => ({
      playerId: p.playerId,
      name: p.name,
      avatar: p.avatar,
      seat: p.seat,
      ready: p.ready,
      isAI: p.isAI,
    })),
  };
}

// Clean up stale rooms (idle > 2h)
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.createdAt > 2 * 60 * 60 * 1000) rooms.delete(id);
  }
}, 10 * 60 * 1000);

module.exports = { createRoom, joinRoom, addAIPlayer, removePlayer, getRoomBySocket, getRoom, publicView };
