import { db, ref, set, update, get, onValue } from './firebase-app.js';

function genRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function genPlayerId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

const AI_NAMES = ['냥이', '토순이', '곰돌이', '여우'];
const AI_AVATARS = ['🐱', '🐰', '🐻', '🦊'];

function roomRef(roomId) {
  return ref(db, `tichu/rooms/${roomId}`);
}

// Returns { roomId, playerId, isHost }
async function createRoom(playerName) {
  const roomId = genRoomId();
  const playerId = genPlayerId();
  const player = { id: playerId, name: playerName, seat: 0, teamIndex: 0, isAI: false, avatar: '🙂' };
  await set(roomRef(roomId), {
    hostId: playerId,
    phase: 'lobby',
    players: { [playerId]: player },
    gameStateJson: '',
    createdAt: Date.now(),
  });
  return { roomId, playerId, isHost: true };
}

// Returns { roomId, playerId, isHost } or throws
async function joinRoom(roomId, playerName) {
  const snap = await get(roomRef(roomId));
  if (!snap.exists()) throw new Error('방을 찾을 수 없어요');
  const data = snap.val();
  if (data.phase !== 'lobby') throw new Error('이미 게임이 시작됐어요');
  const existing = Object.values(data.players || {});
  if (existing.length >= 4) throw new Error('방이 꽉 찼어요');

  const playerId = genPlayerId();
  const takenSeats = existing.map(p => p.seat);
  const seat = [0,1,2,3].find(s => !takenSeats.includes(s));
  const player = { id: playerId, name: playerName, seat, teamIndex: seat % 2, isAI: false, avatar: '🙂' };
  await update(ref(db, `tichu/rooms/${roomId}/players`), { [playerId]: player });
  return { roomId, playerId, isHost: false };
}

async function addAI(roomId) {
  const snap = await get(roomRef(roomId));
  if (!snap.exists()) return;
  const data = snap.val();
  const existing = Object.values(data.players || {});
  if (existing.length >= 4) return;
  const takenSeats = existing.map(p => p.seat);
  const seat = [0,1,2,3].find(s => !takenSeats.includes(s));
  const aiId = 'ai_' + seat;
  const player = { id: aiId, name: AI_NAMES[seat], seat, teamIndex: seat % 2, isAI: true, avatar: AI_AVATARS[seat] };
  await update(ref(db, `tichu/rooms/${roomId}/players`), { [aiId]: player });
}

async function fillWithAI(roomId) {
  const snap = await get(roomRef(roomId));
  if (!snap.exists()) return;
  const data = snap.val();
  const existing = Object.values(data.players || {});
  for (let seat = 0; seat < 4; seat++) {
    if (!existing.find(p => p.seat === seat)) {
      const aiId = 'ai_' + seat;
      const player = { id: aiId, name: AI_NAMES[seat], seat, teamIndex: seat % 2, isAI: true, avatar: AI_AVATARS[seat] };
      existing.push(player);
      await update(ref(db, `tichu/rooms/${roomId}/players`), { [aiId]: player });
    }
  }
}

// Write game state as JSON string (avoids RTDB null-stripping issues)
async function saveGameState(roomId, gameState) {
  await update(roomRef(roomId), { gameStateJson: JSON.stringify(gameState), phase: 'playing' });
}

async function setRoomPhase(roomId, phase) {
  await update(roomRef(roomId), { phase });
}

function listenRoom(roomId, callback) {
  return onValue(roomRef(roomId), snap => {
    if (!snap.exists()) return;
    const data = snap.val();
    const players = Object.values(data.players || {}).sort((a, b) => a.seat - b.seat);
    const gameState = data.gameStateJson ? JSON.parse(data.gameStateJson) : null;
    callback({ ...data, players, gameState });
  });
}

export { createRoom, joinRoom, addAI, fillWithAI, saveGameState, setRoomPhase, listenRoom };
