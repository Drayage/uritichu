'use strict';

const socket = io();
let myPlayerId = null;
let myRoomId = null;

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
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim() || '익명';
  socket.emit('lobby:create', { playerName: name, config: {} });
});

// Join room
document.getElementById('btn-join').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim() || '익명';
  const code = document.getElementById('input-room-code').value.trim().toUpperCase();
  if (!code) { alert('방 코드를 입력하세요'); return; }
  socket.emit('lobby:join', { roomId: code, playerName: name });
});

// Solo mode
document.getElementById('btn-solo').addEventListener('click', () => {
  const name = document.getElementById('input-solo-name').value.trim() || '나';
  socket.emit('lobby:create', { playerName: name, config: { fillWithAI: true } });
  // After joining, immediately add AI and start
  socket._soloMode = true;
});

// Add AI
document.getElementById('btn-add-ai').addEventListener('click', () => {
  socket.emit('lobby:addAI');
});

// Start game
document.getElementById('btn-start').addEventListener('click', () => {
  socket.emit('lobby:start');
});

// Copy room code
document.getElementById('btn-copy').addEventListener('click', () => {
  const code = document.getElementById('room-code-display').textContent;
  navigator.clipboard.writeText(code).then(() => {
    document.getElementById('btn-copy').textContent = '✅ 복사됨';
    setTimeout(() => document.getElementById('btn-copy').textContent = '📋 복사', 1500);
  });
});

// Socket events
socket.on('lobby:joined', ({ roomId, playerId, seat }) => {
  myPlayerId = playerId;
  myRoomId = roomId;
  sessionStorage.setItem('playerId', playerId);
  sessionStorage.setItem('roomId', roomId);

  document.getElementById('panel-main').style.display = 'none';
  document.getElementById('panel-room').style.display = '';
  document.getElementById('room-code-display').textContent = roomId;

  // Solo mode: auto-fill and start
  if (socket._soloMode) {
    for (let i = 0; i < 3; i++) socket.emit('lobby:addAI');
    setTimeout(() => socket.emit('lobby:start'), 300);
  }
});

socket.on('lobby:state', (room) => {
  renderSeats(room);
});

socket.on('lobby:error', ({ message }) => {
  const el = document.getElementById('room-error');
  el.textContent = message;
  el.style.display = '';
  setTimeout(() => el.style.display = 'none', 3000);
});

// When game starts, redirect to game page
socket.on('game:roundStart', () => {
  window.location.href = '/game';
});

function renderSeats(room) {
  const grid = document.getElementById('seats-grid');
  grid.innerHTML = '';

  const teamNames = ['A', 'B'];
  const seatPositions = ['남쪽(나)', '서쪽', '북쪽', '동쪽'];

  for (let seat = 0; seat < 4; seat++) {
    const player = room.players.find(p => p.seat === seat);
    const teamClass = seat % 2 === 0 ? 'team-a' : 'team-b';
    const teamLabel = `팀 ${teamNames[seat % 2]}`;

    const div = document.createElement('div');
    div.className = `seat-card ${player ? teamClass : 'empty'}`;

    if (player) {
      div.innerHTML = `
        <div class="seat-avatar">${player.avatar || '🙂'}</div>
        <div class="seat-name">${escHtml(player.name)}</div>
        <div class="seat-label">${teamLabel} · ${seatPositions[seat]}</div>
        ${player.isAI ? '<div style="font-size:10px;color:var(--text-light);">🤖 AI</div>' : ''}
      `;
    } else {
      div.innerHTML = `
        <div style="font-size:24px; color:#ccc;">＋</div>
        <div class="seat-label">${teamLabel} · ${seatPositions[seat]}</div>
      `;
    }
    grid.appendChild(div);
  }
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
