'use strict';

// ── State ──
let socket, myPlayerId, mySeat, myTeam;
let players = [];
let myHand = [];
let selectedIds = new Set();
let currentState = {};
let exchangeSelection = { left: null, across: null, right: null };
let exchangePhase = false;
let wishPending = false;

const SUIT_ICON = { jade: '🌿', sword: '⭐', pagoda: '🏠', star: '💜' };
const SUIT_LABEL = { jade: '옥', sword: '검', pagoda: '탑', star: '별' };
const RANK_DISPLAY = { mahjong: '🐦', dog: '🐶', phoenix: '🦚', dragon: '🐉' };

// ── Init ──
window.addEventListener('DOMContentLoaded', () => {
  socket = io();
  setupSocketListeners();
  setupButtonListeners();

  // Retrieve session
  myPlayerId = sessionStorage.getItem('playerId');
  // Wait for server to push state
});

// ── Socket Listeners ──
function setupSocketListeners() {
  socket.on('game:roundStart', (data) => {
    players = data.players;
    mySeat = data.seat;
    myPlayerId = data.playerId;
    myTeam = mySeat % 2;
    myHand = data.hand8;
    currentState = { totalScores: data.totalScores, phase: 'grand_tichu' };

    setupPlayerZones();
    updateScores(data.totalScores);
    showGrandTichuModal(myHand);
    log('새 라운드가 시작됩니다!');
  });

  socket.on('game:dealComplete', ({ hand }) => {
    myHand = hand;
    hideModal('modal-grand-tichu');
    showExchangeModal();
    renderMyHand();
  });

  socket.on('game:handUpdate', ({ hand }) => {
    myHand = hand;
    renderMyHand();
    hideModal('modal-exchange');
    exchangePhase = false;
    log('카드 교환 완료!');
  });

  socket.on('game:grandTichuDecided', ({ playerId, call }) => {
    const p = players.find(x => x.id === playerId);
    if (call) log(`${p?.name || '?'}가 라지 티츄를 선언했습니다! 👑`);
    updateTichuBadges();
  });

  socket.on('game:exchangePhase', () => {
    myHand = currentState.hand || myHand; // updated by dealComplete
    showExchangeModal();
  });

  socket.on('game:exchangeProgress', ({ submitted }) => {
    const count = submitted.length;
    document.getElementById('exchange-status').textContent = `${count}/4명 교환 완료...`;
  });

  socket.on('game:turnStart', (data) => {
    Object.assign(currentState, data);
    renderTrick(data.currentTrick);
    updateHandCounts(data.handCounts);
    updateActivePlayer(data.activePlayerId);
    updateWishIndicator(data.wishRank);
    updateTichuBadges(data.tichuCalls, data.grandTichuCalls);
    updateFinishBadges(data.finishOrder);

    const isMyTurn = data.activePlayerId === myPlayerId;
    setStatus(isMyTurn ? '내 차례예요!' : `${getPlayerName(data.activePlayerId)}의 차례`);

    enableActions(isMyTurn, data.currentTrick);

    // Show tichu button if eligible
    const myTichuCall = data.tichuCalls && data.tichuCalls[myPlayerId];
    const hasPlayed = currentState.tichuPlayed;
    document.getElementById('btn-tichu').style.display =
      (!hasPlayed && myTichuCall === null) ? '' : 'none';
  });

  socket.on('game:played', ({ playerId, combination, handCount, wishRank }) => {
    const name = getPlayerName(playerId);
    const comboDesc = describeCombo(combination);
    log(`${name}: ${comboDesc}`);
    if (wishRank) log(`⭐ 소원: ${wishRank}`);
    updateHandCount(playerId, handCount);
    selectedIds.clear();
  });

  socket.on('game:passed', ({ playerId }) => {
    log(`${getPlayerName(playerId)}: 패스`);
  });

  socket.on('game:trickWon', ({ winnerId }) => {
    log(`✨ ${getPlayerName(winnerId)}가 트릭을 가져갑니다!`);
    clearTrick();
  });

  socket.on('game:dragonGivePhase', ({ playerId }) => {
    if (playerId === myPlayerId) showDragonModal();
  });

  socket.on('game:dragonGiven', ({ winnerId, targetId }) => {
    log(`🐉 ${getPlayerName(winnerId)}가 트릭을 ${getPlayerName(targetId)}에게 주었습니다`);
  });

  socket.on('game:tichuAnnounce', ({ playerId, type }) => {
    const name = getPlayerName(playerId);
    const label = type === 'grandTichu' ? '라지 티츄 👑' : '티츄! 🎯';
    log(`${name}: ${label}`);
    updateTichuBadges();
  });

  socket.on('game:playerOut', ({ playerId, position }) => {
    const pos = ['🥇', '🥈', '🥉'][position - 1] || `${position}등`;
    log(`${pos} ${getPlayerName(playerId)} 아웃!`);
    updateFinishBadges([...((currentState.finishOrder || [])), playerId]);
  });

  socket.on('game:state', (state) => {
    Object.assign(currentState, state);
    myHand = state.myHand || myHand;
    renderMyHand();
    updateScores(state.totalScores);
  });

  socket.on('game:roundOver', ({ deltas, finishOrder, totalScores }) => {
    updateScores(totalScores);
    showRoundOverModal(deltas, finishOrder, totalScores);
    disableActions();
  });

  socket.on('game:gameOver', ({ winningTeam, totalScores }) => {
    hideModal('modal-round-over');
    showGameOverModal(winningTeam, totalScores);
  });

  socket.on('game:error', ({ message }) => {
    setStatus(`⚠️ ${message}`);
    log(`오류: ${message}`);
  });
}

// ── Button Listeners ──
function setupButtonListeners() {
  document.getElementById('btn-play').addEventListener('click', onPlay);
  document.getElementById('btn-pass').addEventListener('click', onPass);
  document.getElementById('btn-tichu').addEventListener('click', () => {
    socket.emit('game:tichu');
    document.getElementById('btn-tichu').style.display = 'none';
    log('티츄를 선언했습니다! 🎯');
  });
  document.getElementById('btn-grand-tichu-yes').addEventListener('click', () => {
    socket.emit('game:grandTichu', { call: true });
    hideModal('modal-grand-tichu');
  });
  document.getElementById('btn-grand-tichu-no').addEventListener('click', () => {
    socket.emit('game:grandTichu', { call: false });
    hideModal('modal-grand-tichu');
  });
  document.getElementById('btn-exchange-confirm').addEventListener('click', onExchangeConfirm);
  document.getElementById('btn-next-round').addEventListener('click', () => {
    hideModal('modal-round-over');
    socket.emit('game:nextRound');
  });
  document.getElementById('btn-wish-none').addEventListener('click', () => {
    hideModal('modal-wish');
    doPlay(null);
  });
}

// ── Play actions ──
function onPlay() {
  const cards = myHand.filter(c => selectedIds.has(c.id));
  if (cards.length === 0) return;

  // Check if mahjong is in selection
  const hasMahjong = cards.some(c => c.rank === 'mahjong');
  if (hasMahjong) {
    showWishModal(cards);
    return;
  }

  doPlay(null);
}

function doPlay(wishRank) {
  const cards = myHand.filter(c => selectedIds.has(c.id));
  socket.emit('game:play', { cardIds: cards.map(c => c.id), wishRank });
}

function onPass() {
  socket.emit('game:pass');
  selectedIds.clear();
  renderMyHand();
}

function onExchangeConfirm() {
  const { left, across, right } = exchangeSelection;
  if (!left || !across || !right) return;
  socket.emit('game:exchange', { left, across, right });
}

// ── Rendering ──
function renderMyHand() {
  const container = document.getElementById('my-hand');
  container.innerHTML = '';
  document.getElementById('my-hand-count').textContent = myHand.length;

  const sortedHand = [...myHand].sort((a, b) => {
    if (a.numericValue !== b.numericValue) return a.numericValue - b.numericValue;
    return (a.suit || '').localeCompare(b.suit || '');
  });

  for (const card of sortedHand) {
    const el = createCardEl(card, true);
    el.addEventListener('click', () => toggleSelect(card, el));
    if (selectedIds.has(card.id)) el.classList.add('selected');
    container.appendChild(el);
  }

  updateSelectedInfo();
}

function createCardEl(card, clickable = false) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = card.id;

  if (card.isSpecial) {
    el.classList.add('special', `special-${card.rank}`);
    el.innerHTML = `
      <div class="card-rank-top">${RANK_DISPLAY[card.rank] || card.rank}</div>
      <div class="card-suit" style="font-size:32px;">${RANK_DISPLAY[card.rank] || ''}</div>
      <div class="card-rank-bot">${RANK_DISPLAY[card.rank] || card.rank}</div>
    `;
  } else {
    el.classList.add(`suit-${card.suit}`);
    el.innerHTML = `
      <div class="card-rank-top">${card.rank}<br><span style="font-size:10px;">${SUIT_ICON[card.suit]}</span></div>
      <div class="card-suit">${SUIT_ICON[card.suit]}</div>
      <div class="card-rank-bot">${card.rank}<br><span style="font-size:10px;">${SUIT_ICON[card.suit]}</span></div>
    `;
  }

  return el;
}

function createCardBack() {
  const el = document.createElement('div');
  el.className = 'card-back';
  el.textContent = '🀄';
  return el;
}

function toggleSelect(card, el) {
  if (exchangePhase) {
    handleExchangeSelect(card);
    return;
  }
  if (selectedIds.has(card.id)) {
    selectedIds.delete(card.id);
    el.classList.remove('selected');
  } else {
    selectedIds.add(card.id);
    el.classList.add('selected');
  }
  updateSelectedInfo();
}

function updateSelectedInfo() {
  const count = selectedIds.size;
  const el = document.getElementById('selected-info');
  el.textContent = count > 0 ? `${count}장 선택됨` : '';
}

function renderTrick(trick) {
  const area = document.getElementById('trick-area');
  area.innerHTML = '';
  if (!trick || !trick.plays || trick.plays.length === 0) return;

  for (const play of trick.plays) {
    const div = document.createElement('div');
    div.className = 'trick-play';
    for (const card of play.combination.cards) {
      div.appendChild(createCardEl(card));
    }
    area.appendChild(div);
  }
}

function clearTrick() {
  document.getElementById('trick-area').innerHTML = '';
}

// ── Player Zones ──
function setupPlayerZones() {
  // Rotate so mySeat is always "south" (bottom)
  // north = (mySeat+2)%4, west = (mySeat+1)%4, east = (mySeat+3)%4
  const zones = ['north', 'west', 'east'];
  const relSeats = [2, 1, 3]; // offsets from mySeat

  for (let i = 0; i < 3; i++) {
    const zone = zones[i];
    const seat = (mySeat + relSeats[i]) % 4;
    const p = players.find(x => x.seat === seat);
    if (!p) continue;

    document.getElementById(`avatar-${zone}`).textContent = p.avatar || '🙂';
    document.getElementById(`name-${zone}`).textContent = p.name;
    document.getElementById(`count-${zone}`).textContent = '14';
  }

  // My info
  const me = players.find(x => x.id === myPlayerId);
  if (me) {
    document.getElementById('avatar-me').textContent = me.avatar || '🙂';
    document.getElementById('name-me').textContent = me.name;
  }
}

function getZoneForSeat(seat) {
  const diff = ((seat - mySeat) + 4) % 4;
  if (diff === 0) return 'me';
  if (diff === 1) return 'west';
  if (diff === 2) return 'north';
  if (diff === 3) return 'east';
}

function updateHandCounts(counts) {
  if (!counts) return;
  for (const [pid, count] of Object.entries(counts)) {
    if (pid === myPlayerId) {
      document.getElementById('my-hand-count').textContent = count;
      continue;
    }
    const p = players.find(x => x.id === pid);
    if (!p) continue;
    const zone = getZoneForSeat(p.seat);
    if (zone === 'me') continue;
    const el = document.getElementById(`count-${zone}`);
    if (el) el.textContent = count;

    // Render card backs
    const handEl = document.getElementById(`hand-${zone}`);
    if (handEl) {
      handEl.innerHTML = '';
      const show = Math.min(count, 5);
      for (let i = 0; i < show; i++) handEl.appendChild(createCardBack());
      if (count > 5) {
        const more = document.createElement('span');
        more.style.cssText = 'font-size:12px;color:var(--text-light);margin-left:4px;align-self:center;';
        more.textContent = `+${count - 5}`;
        handEl.appendChild(more);
      }
    }
  }
}

function updateHandCount(playerId, count) {
  if (playerId === myPlayerId) {
    document.getElementById('my-hand-count').textContent = myHand.length;
    return;
  }
  const p = players.find(x => x.id === playerId);
  if (!p) return;
  const zone = getZoneForSeat(p.seat);
  if (zone === 'me') return;
  const el = document.getElementById(`count-${zone}`);
  if (el) el.textContent = count;
}

function updateActivePlayer(activeId) {
  ['north', 'west', 'east'].forEach(z => {
    document.getElementById(`avatar-${z}`).classList.remove('active', 'out');
  });
  if (!activeId || activeId === myPlayerId) return;
  const p = players.find(x => x.id === activeId);
  if (!p) return;
  const zone = getZoneForSeat(p.seat);
  if (zone !== 'me') document.getElementById(`avatar-${zone}`).classList.add('active');
}

function updateTichuBadges(tichuCalls, grandTichuCalls) {
  const tc = tichuCalls || currentState.tichuCalls || {};
  const gc = grandTichuCalls || currentState.grandTichuCalls || {};

  const zones = ['north', 'west', 'east', 'me'];
  for (const zone of zones) {
    const pid = zone === 'me' ? myPlayerId : getPlayerIdForZone(zone);
    if (!pid) continue;
    const el = document.getElementById(`tichu-badge-${zone}`);
    if (!el) continue;
    if (gc[pid] === true) {
      el.innerHTML = '<div class="tichu-badge grand">라지티츄 👑</div>';
    } else if (tc[pid] === true) {
      el.innerHTML = '<div class="tichu-badge">티츄! 🎯</div>';
    } else {
      el.innerHTML = '';
    }
  }
}

function getPlayerIdForZone(zone) {
  const relSeats = { north: 2, west: 1, east: 3 };
  const seat = (mySeat + relSeats[zone]) % 4;
  return players.find(x => x.seat === seat)?.id;
}

function updateFinishBadges(finishOrder) {
  if (!finishOrder) return;
  currentState.finishOrder = finishOrder;
}

function updateWishIndicator(wishRank) {
  const el = document.getElementById('wish-indicator');
  if (wishRank) {
    el.classList.add('active');
    document.getElementById('wish-rank-text').textContent = wishRank;
  } else {
    el.classList.remove('active');
  }
}

function updateScores(scores) {
  if (!scores) return;
  document.getElementById('score-a').textContent = scores.team0 || 0;
  document.getElementById('score-b').textContent = scores.team1 || 0;
}

// ── Actions ──
function enableActions(isMyTurn, currentTrick) {
  document.getElementById('btn-play').disabled = !isMyTurn;
  document.getElementById('btn-pass').disabled = !isMyTurn || !currentTrick;
}

function disableActions() {
  document.getElementById('btn-play').disabled = true;
  document.getElementById('btn-pass').disabled = true;
}

// ── Modals ──
function showGrandTichuModal(hand8) {
  const container = document.getElementById('grand-tichu-hand');
  container.innerHTML = '';
  for (const card of hand8) container.appendChild(createCardEl(card));

  showModal('modal-grand-tichu');

  // Timer: 15s
  let timeLeft = 15;
  const fill = document.getElementById('grand-tichu-timer');
  const interval = setInterval(() => {
    timeLeft--;
    fill.style.width = `${(timeLeft / 15) * 100}%`;
    if (timeLeft <= 0) {
      clearInterval(interval);
      socket.emit('game:grandTichu', { call: false });
      hideModal('modal-grand-tichu');
    }
  }, 1000);
  document.getElementById('modal-grand-tichu')._timer = interval;
}

function showExchangeModal() {
  exchangePhase = true;
  exchangeSelection = { left: null, across: null, right: null };

  const slots = document.getElementById('exchange-slots');
  slots.innerHTML = '';

  const dirs = [
    { key: 'left', label: '왼쪽 상대' },
    { key: 'across', label: '파트너' },
    { key: 'right', label: '오른쪽 상대' },
  ];

  for (const { key, label } of dirs) {
    const slotDiv = document.createElement('div');
    slotDiv.className = 'exchange-slot';
    const box = document.createElement('div');
    box.className = 'exchange-slot-box';
    box.id = `slot-${key}`;
    box.textContent = '?';
    box.addEventListener('click', () => {
      // Clear this slot
      if (exchangeSelection[key]) {
        exchangeSelection[key] = null;
        box.textContent = '?';
        box.classList.remove('filled');
        box.innerHTML = '?';
        updateExchangeConfirm();
        renderExchangeHand();
      }
    });
    const lbl = document.createElement('div');
    lbl.className = 'exchange-slot-label';
    lbl.textContent = label;
    slotDiv.appendChild(box);
    slotDiv.appendChild(lbl);
    slots.appendChild(slotDiv);
  }

  renderExchangeHand();
  showModal('modal-exchange');
}

function renderExchangeHand() {
  const container = document.getElementById('exchange-hand');
  container.innerHTML = '';
  const selectedInSlots = new Set(Object.values(exchangeSelection).filter(Boolean).map(c => c.id));

  for (const card of myHand) {
    const el = createCardEl(card, true);
    if (selectedInSlots.has(card.id)) { el.classList.add('dim'); el.style.cursor = 'default'; }
    else {
      el.addEventListener('click', () => handleExchangeSelect(card));
    }
    container.appendChild(el);
  }
}

function handleExchangeSelect(card) {
  // Fill next empty slot
  const dirs = ['left', 'across', 'right'];
  for (const key of dirs) {
    if (!exchangeSelection[key]) {
      exchangeSelection[key] = card;
      const box = document.getElementById(`slot-${key}`);
      box.innerHTML = '';
      box.classList.add('filled');
      box.appendChild(createCardEl(card));
      updateExchangeConfirm();
      renderExchangeHand();
      return;
    }
  }
}

function updateExchangeConfirm() {
  const { left, across, right } = exchangeSelection;
  document.getElementById('btn-exchange-confirm').disabled = !(left && across && right);
}

function showWishModal(cards) {
  const grid = document.getElementById('wish-rank-grid');
  grid.innerHTML = '';
  const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  for (const r of ranks) {
    const btn = document.createElement('button');
    btn.className = 'rank-btn';
    btn.textContent = r;
    btn.addEventListener('click', () => {
      hideModal('modal-wish');
      doPlay(r);
    });
    grid.appendChild(btn);
  }
  showModal('modal-wish');
}

function showDragonModal() {
  const container = document.getElementById('dragon-opponents');
  container.innerHTML = '';
  const myTeamIdx = mySeat % 2;
  const opponents = players.filter(p => p.teamIndex !== myTeamIdx);

  for (const opp of opponents) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-danger';
    btn.style.cssText = 'flex:1; padding:16px; border-radius:14px; flex-direction:column; display:flex; align-items:center; gap:6px;';
    btn.innerHTML = `<span style="font-size:28px;">${opp.avatar || '🙂'}</span><span>${escHtml(opp.name)}</span>`;
    btn.addEventListener('click', () => {
      socket.emit('game:dragonGive', { targetPlayerId: opp.id });
      hideModal('modal-dragon');
    });
    container.appendChild(btn);
  }

  showModal('modal-dragon');
}

function showRoundOverModal(deltas, finishOrder, totalScores) {
  const el = document.getElementById('round-result');
  const finishNames = finishOrder.map((pid, i) => `${['🥇','🥈','🥉','4등'][i]} ${getPlayerName(pid)}`).join('<br>');
  el.innerHTML = `
    <div style="margin-bottom:12px; font-size:14px; color:var(--text-light);">${finishNames}</div>
    <div style="display:flex; gap:12px; justify-content:center; margin-bottom:12px;">
      <div class="score-row team-a" style="flex:1;"><span>🌿 팀 A</span><span class="score-points">${deltas.team0 >= 0 ? '+' : ''}${deltas.team0}</span></div>
      <div class="score-row team-b" style="flex:1;"><span>💜 팀 B</span><span class="score-points">${deltas.team1 >= 0 ? '+' : ''}${deltas.team1}</span></div>
    </div>
    <div style="font-size:13px; color:var(--text-light);">누적: 팀 A ${totalScores.team0}점 · 팀 B ${totalScores.team1}점</div>
  `;
  showModal('modal-round-over');
}

function showGameOverModal(winningTeam, totalScores) {
  const winLabel = winningTeam === 0 ? '🌿 팀 A 승리!' : '💜 팀 B 승리!';
  const myWin = myTeam === winningTeam;
  document.getElementById('game-over-emoji').textContent = myWin ? '🎉' : '😢';
  document.getElementById('game-over-title').textContent = winLabel;
  document.getElementById('game-over-scores').innerHTML = `
    <div style="display:flex; gap:12px; justify-content:center; margin-bottom:12px;">
      <div class="score-row team-a" style="flex:1;"><span>🌿 팀 A</span><span class="score-points">${totalScores.team0}</span></div>
      <div class="score-row team-b" style="flex:1;"><span>💜 팀 B</span><span class="score-points">${totalScores.team1}</span></div>
    </div>
  `;
  showModal('modal-game-over');
}

// ── Utils ──
function showModal(id) { document.getElementById(id).style.display = 'flex'; }
function hideModal(id) {
  document.getElementById(id).style.display = 'none';
  const el = document.getElementById(id);
  if (el._timer) { clearInterval(el._timer); el._timer = null; }
}

function setStatus(msg) { document.getElementById('status-bar').textContent = msg; }

function log(msg) {
  const area = document.getElementById('log-area');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.textContent = msg;
  area.prepend(entry);
  while (area.children.length > 30) area.removeChild(area.lastChild);
}

function getPlayerName(pid) {
  return players.find(x => x.id === pid)?.name || pid;
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function describeCombo(combo) {
  if (!combo) return '?';
  const typeMap = {
    single: '단장', pair: '페어', triple: '트리플', steps: '연속페어',
    fullhouse: '풀하우스', straight: '스트레이트', bomb_quad: '💣포카드', bomb_sf: '💣스티플',
  };
  const cards = combo.cards.map(c => c.isSpecial ? RANK_DISPLAY[c.rank] : `${c.rank}${SUIT_ICON[c.suit]}`).join(' ');
  return `${typeMap[combo.type] || combo.type}(${cards})`;
}
