import { createRoom, joinRoom, addAI, removeAI, fillWithAI, listenRoom } from './room-manager.js';
import { openReplayModal, closeReplayModal, replayPrev, replayNext, replayBackToList } from './replay.js';

let myPlayerId = null;
let myRoomId = null;
let unsubscribeRoom = null;
let selectedAvatar = localStorage.getItem('selectedAvatar') || '🐱';

// Avatar picker
{
  const grid = document.getElementById('avatar-grid');
  grid.querySelectorAll('.avatar-opt').forEach(btn => {
    if (btn.dataset.emoji === selectedAvatar) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.avatar-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedAvatar = btn.dataset.emoji;
      localStorage.setItem('selectedAvatar', selectedAvatar);
    });
  });
}

// Tab switching
document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const which = tab.dataset.tab;
    document.getElementById('tab-online').style.display = which === 'online' ? '' : 'none';
    document.getElementById('tab-solo').style.display = which === 'solo' ? '' : 'none';
  });
});

// Create room
document.getElementById('btn-create').addEventListener('click', async () => {
  const name = document.getElementById('input-name').value.trim() || '익명';
  try {
    const { roomId, playerId } = await createRoom(name, selectedAvatar);
    myPlayerId = playerId;
    myRoomId = roomId;
    sessionStorage.setItem('playerId', playerId);
    sessionStorage.setItem('roomId', roomId);
    sessionStorage.setItem('isHost', 'true');
    showRoomPanel(roomId);
    startListening(roomId);
  } catch (e) { showError(e.message); }
});

// Join room
document.getElementById('btn-join').addEventListener('click', async () => {
  const name = document.getElementById('input-name').value.trim() || '익명';
  const code = document.getElementById('input-room-code').value.trim().toUpperCase();
  if (!code) { showError('방 코드를 입력하세요'); return; }
  try {
    const { roomId, playerId } = await joinRoom(code, name, selectedAvatar);
    myPlayerId = playerId;
    myRoomId = roomId;
    sessionStorage.setItem('playerId', playerId);
    sessionStorage.setItem('roomId', roomId);
    sessionStorage.setItem('isHost', 'false');
    showRoomPanel(roomId);
    startListening(roomId);
  } catch (e) { showError(e.message); }
});

// Solo mode
document.getElementById('btn-solo').addEventListener('click', async () => {
  const name = document.getElementById('input-solo-name').value.trim() || '나';
  try {
    const { roomId, playerId } = await createRoom(name, selectedAvatar);
    myPlayerId = playerId;
    myRoomId = roomId;
    sessionStorage.setItem('playerId', playerId);
    sessionStorage.setItem('roomId', roomId);
    sessionStorage.setItem('isHost', 'true');
    await fillWithAI(roomId);
    // Start immediately by navigating to game (host will start round)
    sessionStorage.setItem('autoStart', 'true');
    window.location.href = './game.html';
  } catch (e) { showError(e.message); }
});

// Add AI
document.getElementById('btn-add-ai').addEventListener('click', async () => {
  if (!myRoomId) return;
  try { await addAI(myRoomId); } catch (e) { showError(e.message); }
});

// Start game
document.getElementById('btn-start').addEventListener('click', () => {
  if (!myRoomId) return;
  window.location.href = './game.html';
});

// Copy room code
document.getElementById('btn-replay').addEventListener('click', () => openReplayModal());
window._closeReplayModal = closeReplayModal;
window._replayPrev = replayPrev;
window._replayNext = replayNext;
window._replayBackToList = replayBackToList;

document.getElementById('btn-copy').addEventListener('click', () => {
  const code = document.getElementById('room-code-display').textContent;
  navigator.clipboard.writeText(code).then(() => {
    document.getElementById('btn-copy').textContent = '✅ 복사됨';
    setTimeout(() => document.getElementById('btn-copy').textContent = '📋 복사', 1500);
  });
});

function showRoomPanel(roomId) {
  document.getElementById('panel-main').style.display = 'none';
  document.getElementById('panel-room').style.display = '';
  document.getElementById('room-code-display').textContent = roomId;
}

function startListening(roomId) {
  if (unsubscribeRoom) unsubscribeRoom();
  unsubscribeRoom = listenRoom(roomId, (room) => renderSeats(room));
}

function showError(msg) {
  const el = document.getElementById('room-error');
  el.textContent = msg;
  el.style.display = '';
  setTimeout(() => el.style.display = 'none', 3000);
}

function renderSeats(room) {
  const grid = document.getElementById('seats-grid');
  grid.innerHTML = '';
  const teamNames = ['A', 'B'];
  const seatPositions = ['남쪽(나)', '서쪽', '북쪽', '동쪽'];
  const amHost = room.hostId === myPlayerId;

  for (let seat = 0; seat < 4; seat++) {
    const player = room.players.find(p => p.seat === seat);
    const teamClass = seat % 2 === 0 ? 'team-a' : 'team-b';
    const div = document.createElement('div');
    div.className = `seat-card ${player ? teamClass : 'empty'}`;
    if (player) {
      div.innerHTML = `
        <div class="seat-avatar">${player.avatar || '🙂'}</div>
        <div class="seat-name">${escHtml(player.name)}</div>
        <div class="seat-label">팀 ${teamNames[seat % 2]} · ${seatPositions[seat]}</div>
        ${player.isAI ? '<div style="font-size:10px;color:var(--text-light);">🤖 AI</div>' : ''}
      `;
      if (player.isAI && amHost) {
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '❌ 빼기';
        removeBtn.style.cssText = 'margin-top:6px;font-size:11px;padding:3px 10px;border-radius:50px;background:rgba(255,100,100,0.12);color:#c0392b;border:1px solid rgba(255,100,100,0.3);cursor:pointer;';
        removeBtn.addEventListener('click', async () => {
          try { await removeAI(myRoomId, player.id); } catch (e) { showError(e.message); }
        });
        div.appendChild(removeBtn);
      }
    } else {
      div.innerHTML = `<div style="font-size:24px;color:#ccc;">＋</div><div class="seat-label">팀 ${teamNames[seat % 2]} · ${seatPositions[seat]}</div>`;
    }
    grid.appendChild(div);
  }
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── PWA Install Banner ──
{
  const banner  = document.getElementById('pwa-install-banner');
  const btnInst = document.getElementById('btn-pwa-install');
  const btnDism = document.getElementById('btn-pwa-dismiss');

  // beforeinstallprompt may have fired before this module loaded — check early capture
  if (window._pwaPrompt && banner) banner.style.display = 'flex';

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    window._pwaPrompt = e;
    if (banner) banner.style.display = 'flex';
  });

  btnInst?.addEventListener('click', async () => {
    if (!window._pwaPrompt) return;
    await window._pwaPrompt.prompt();
    await window._pwaPrompt.userChoice;
    if (banner) banner.style.display = 'none';
    window._pwaPrompt = null;
  });

  btnDism?.addEventListener('click', () => {
    if (banner) banner.style.display = 'none';
  });

  window.addEventListener('appinstalled', () => {
    if (banner) banner.style.display = 'none';
  });
}
