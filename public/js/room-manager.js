// Firebase is loaded LAZILY (only for online play) so that solo/offline mode
// never depends on the Firebase CDN. The import is from gstatic; making it a
// hard top-level dependency would break the whole app (incl. solo) whenever
// that CDN is unreachable.
let _fbPromise = null;
function _fb() {
  if (!_fbPromise) _fbPromise = import('./firebase-app.js');
  return _fbPromise;
}

function genRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function genPlayerId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

const AI_NAMES = ['냥이', '토순이', '곰돌이', '여우'];
const AI_AVATARS = ['🐱', '🐰', '🐻', '🦊'];

// ── Local (offline) backend ───────────────────────────────────────────────
// Solo games run entirely in-memory, with no Firebase round-trips. This makes
// solo immune to the online write races, faster, and fully offline-capable.
// The functions below mirror the Firebase ones so game-client / host-runner
// work unchanged once local mode is enabled.
let _localMode = false;
let _localRoom = null; // { phase, players:{id:p}, gameStateJson, hostId, listeners:Set }

function initLocalRoom(players, hostId, savedGameStateJson = '') {
  _localMode = true;
  _localRoom = {
    phase: savedGameStateJson ? 'playing' : 'lobby',
    players: Object.fromEntries(players.map(p => [p.id, p])),
    gameStateJson: savedGameStateJson || '',
    hostId,
    listeners: new Set(),
  };
}
function isLocalMode() { return _localMode; }

function _localPayload() {
  const d = _localRoom;
  return {
    phase: d.phase,
    hostId: d.hostId,
    players: Object.values(d.players).sort((a, b) => a.seat - b.seat),
    gameState: d.gameStateJson ? JSON.parse(d.gameStateJson) : null,
  };
}
function _localNotify() {
  const payload = _localPayload();
  for (const cb of _localRoom.listeners) queueMicrotask(() => cb(payload));
}

// Returns { roomId, playerId, isHost }
async function createRoom(playerName, avatar = '🙂') {
  const { db, ref, set, onDisconnect } = await _fb();
  const roomId = genRoomId();
  const playerId = genPlayerId();
  const player = { id: playerId, name: playerName, seat: 0, teamIndex: 0, isAI: false, avatar };
  await set(ref(db, `tichu/rooms/${roomId}`), {
    hostId: playerId,
    phase: 'lobby',
    players: { [playerId]: player },
    gameStateJson: '',
    createdAt: Date.now(),
  });
  // 탭 종료/네트워크 단절 시 내 좌석만 자동으로 비운다 (room/gameStateJson은 그대로
  // 둬야 나머지 인원이 이어서 진행하거나, 재접속 시 상태를 복원할 수 있다).
  onDisconnect(ref(db, `tichu/rooms/${roomId}/players/${playerId}`)).remove();
  return { roomId, playerId, isHost: true };
}

// Returns { roomId, playerId, isHost } or throws
async function joinRoom(roomId, playerName, avatar = '🙂') {
  const { db, ref, get, update, onDisconnect } = await _fb();
  const snap = await get(ref(db, `tichu/rooms/${roomId}`));
  if (!snap.exists()) throw new Error('방을 찾을 수 없어요');
  const data = snap.val();
  if (data.phase !== 'lobby') throw new Error('이미 게임이 시작됐어요');
  const existing = Object.values(data.players || {});
  if (existing.length >= 4) throw new Error('방이 꽉 찼어요');

  const playerId = genPlayerId();
  const takenSeats = existing.map(p => p.seat);
  const seat = [0,1,2,3].find(s => !takenSeats.includes(s));
  const player = { id: playerId, name: playerName, seat, teamIndex: seat % 2, isAI: false, avatar };
  await update(ref(db, `tichu/rooms/${roomId}/players`), { [playerId]: player });
  onDisconnect(ref(db, `tichu/rooms/${roomId}/players/${playerId}`)).remove();
  return { roomId, playerId, isHost: false };
}

async function addAI(roomId) {
  const { db, ref, get, update } = await _fb();
  const snap = await get(ref(db, `tichu/rooms/${roomId}`));
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

async function removeAI(roomId, aiPlayerId) {
  const { db, ref, remove } = await _fb();
  await remove(ref(db, `tichu/rooms/${roomId}/players/${aiPlayerId}`));
}

async function fillWithAI(roomId) {
  const { db, ref, get, update } = await _fb();
  const snap = await get(ref(db, `tichu/rooms/${roomId}`));
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

// Write game state as JSON string (avoids RTDB null-stripping issues).
// Online: a seq-guarded transaction — the write only commits if the stored
// state still has the same seq the caller based its action on. This rejects
// stale / duplicate writes (online race), preventing "plays getting eaten"
// and the double-apply that skips the trick winner's lead. Returns true if
// committed.
async function saveGameState(roomId, gameState) {
  const baseSeq = gameState.seq || 0;
  if (_localMode) {
    // Single-threaded, no concurrency — just store and notify.
    _localRoom.gameStateJson = JSON.stringify({ ...gameState, seq: baseSeq + 1 });
    try { sessionStorage.setItem('soloGameState', _localRoom.gameStateJson); } catch (e) {}
    _localNotify();
    return true;
  }
  const { db, ref, runTransaction } = await _fb();
  const gsRef = ref(db, `tichu/rooms/${roomId}/gameStateJson`);
  const res = await runTransaction(gsRef, (currentJson) => {
    let curSeq = 0;
    if (currentJson) { try { curSeq = JSON.parse(currentJson).seq || 0; } catch (e) { curSeq = 0; } }
    if (curSeq !== baseSeq) return; // abort: someone already advanced the state
    return JSON.stringify({ ...gameState, seq: baseSeq + 1 });
  }, { applyLocally: false }); // only surface server-confirmed states (no optimistic flicker)
  return !!res.committed;
}

async function setRoomPhase(roomId, phase) {
  if (_localMode) { _localRoom.phase = phase; _localNotify(); return; }
  const { db, ref, update } = await _fb();
  await update(ref(db, `tichu/rooms/${roomId}`), { phase });
}

function listenRoom(roomId, callback) {
  if (_localMode) {
    _localRoom.listeners.add(callback);
    queueMicrotask(() => callback(_localPayload())); // initial fire
    return () => _localRoom.listeners.delete(callback);
  }
  let unsub = () => {};
  _fb().then(({ db, ref, onValue }) => {
    unsub = onValue(ref(db, `tichu/rooms/${roomId}`), snap => {
      if (!snap.exists()) return;
      const data = snap.val();
      const players = Object.values(data.players || {}).sort((a, b) => a.seat - b.seat);
      const gameState = data.gameStateJson ? JSON.parse(data.gameStateJson) : null;
      callback({ ...data, players, gameState });
    });
  });
  return () => unsub();
}

async function getLatestGameState(roomId) {
  if (_localMode) return _localRoom.gameStateJson ? JSON.parse(_localRoom.gameStateJson) : null;
  const { db, ref, get } = await _fb();
  const snap = await get(ref(db, `tichu/rooms/${roomId}`));
  if (!snap.exists()) return null;
  const data = snap.val();
  return data.gameStateJson ? JSON.parse(data.gameStateJson) : null;
}

export { createRoom, joinRoom, addAI, removeAI, fillWithAI, saveGameState, setRoomPhase, listenRoom, getLatestGameState, initLocalRoom, isLocalMode };
