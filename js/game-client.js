import { listenRoom, saveGameState, setRoomPhase } from './room-manager.js';
import { initHostRunner, onRoomStateChange, hostStartRound } from './host-runner.js';
import { startRound, setGrandTichu, submitExchange, callTichu, playCards, pass, giveDragonTrick, PHASE } from './engine/gameState.js';
import { detectCombination } from './engine/combinations.js';

// ── State ──
let myPlayerId, mySeat, myTeam, myRoomId, isHost;
let players = [];
let myHand = [];
let selectedIds = new Set();
let currentGs = null;
let exchangeSelection = { left: null, across: null, right: null };
let exchangePhase = false;
let lastRoundPhase = null;
let sortMode = 'rank'; // 'rank' | 'suit'

const SUIT_ICON = { jade: '🌿', sword: '⭐', pagoda: '🏠', star: '💜' };
const RANK_DISPLAY = { mahjong: '🐦', dog: '🐶', phoenix: '🦚', dragon: '🐉' };

// ── Init ──
window.addEventListener('DOMContentLoaded', async () => {
  myPlayerId = sessionStorage.getItem('playerId');
  myRoomId = sessionStorage.getItem('roomId');
  isHost = sessionStorage.getItem('isHost') === 'true';
  const autoStart = sessionStorage.getItem('autoStart') === 'true';

  if (!myPlayerId || !myRoomId) { window.location.href = './index.html'; return; }

  sessionStorage.removeItem('autoStart');
  setupButtonListeners();

  if (isHost) initHostRunner(myRoomId, myPlayerId);

  // Listen to room state
  listenRoom(myRoomId, async (room) => {
    players = room.players;
    const gs = room.gameState;

    // Host: start round if game just navigated here with autoStart or no game yet
    if (isHost && (!gs || !gs.currentRound) && room.phase === 'lobby') {
      if (autoStart || room.players.length === 4) {
        const newGs = { players: room.players, totalScores: { team0: 0, team1: 0 }, rounds: [], currentRound: null, phase: 'deal_8', gameOver: false, winningTeam: null, targetScore: 1000 };
        startRound(newGs);
        await saveGameState(myRoomId, newGs);
        return;
      }
    }

    if (!gs || !gs.currentRound) return;

    currentGs = gs;
    const me = players.find(p => p.id === myPlayerId);
    if (me) { mySeat = me.seat; myTeam = me.teamIndex; }

    const r = gs.currentRound;

    // Detect phase transitions
    if (r.phase !== lastRoundPhase) {
      handlePhaseChange(r.phase, gs, r);
      lastRoundPhase = r.phase;
    }

    // Always update hand (may change on exchange completion etc.)
    myHand = (r.hands && r.hands[myPlayerId]) ? r.hands[myPlayerId] : [];
    renderMyHand();
    updateScores(gs.totalScores);
    updateTichuBadges(r.tichuCalls, r.grandTichuCalls);
    updateFinishBadges(r.finishOrder);
    renderTrick(r.currentTrick);

    if (r.phase === PHASE.PLAY) {
      const handCounts = {};
      for (const p of players) handCounts[p.id] = (r.hands[p.id] || []).length;
      updateHandCounts(handCounts);
      updateActivePlayer(r.activePlayerId);
      updateWishIndicator(r.wishRank);
      const isMyTurn = r.activePlayerId === myPlayerId;
      setStatus(isMyTurn ? '내 차례예요!' : `${getPlayerName(r.activePlayerId)}의 차례`);
      enableActions(isMyTurn, r.currentTrick);

      const myTichuCall = r.tichuCalls && r.tichuCalls[myPlayerId];
      document.getElementById('btn-tichu').style.display =
        (!r.tichuPlayed[myPlayerId] && (myTichuCall === null || myTichuCall === undefined)) ? '' : 'none';
    }

    if (r.phase === PHASE.DRAGON_GIVE && r.dragonGiveWinner === myPlayerId && !players.find(p => p.id === myPlayerId)?.isAI) {
      showDragonModal();
    }

    if (r.phase === PHASE.ROUND_OVER && lastRoundPhase !== PHASE.ROUND_OVER) {
      const lastRound = gs.rounds[gs.rounds.length - 1] || r;
      // recalc deltas from total scores change
      showRoundOverModal(r.finishOrder, gs.totalScores, gs.rounds.length);
      disableActions();
    }

    if (r.phase === PHASE.GAME_OVER) {
      hideModal('modal-round-over');
      showGameOverModal(gs.winningTeam, gs.totalScores);
    }

    // Host: run AI
    if (isHost) await onRoomStateChange(room, myPlayerId);
  });
});

function handlePhaseChange(phase, gs, r) {
  if (phase === PHASE.DEAL_8 || phase === PHASE.GRAND_TICHU) {
    setupPlayerZones();
    const me = gs.players.find(p => p.id === myPlayerId);
    if (me && !me.isAI) {
      myHand = r.hands[myPlayerId] || [];
      showGrandTichuModal(myHand);
      log('새 라운드가 시작됩니다!');
    }
  }
  if (phase === PHASE.EXCHANGE) {
    hideModal('modal-grand-tichu');
    myHand = r.hands[myPlayerId] || [];
    const me = gs.players.find(p => p.id === myPlayerId);
    if (me && !me.isAI) showExchangeModal();
    log('카드 교환 시간!');
  }
  if (phase === PHASE.PLAY && lastRoundPhase === PHASE.EXCHANGE) {
    hideModal('modal-exchange');
    exchangePhase = false;
    log('게임 시작!');
  }
}

// ── Button Listeners ──
function setupButtonListeners() {
  document.getElementById('btn-play').addEventListener('click', onPlay);
  document.getElementById('btn-pass').addEventListener('click', onPass);
  document.getElementById('btn-tichu').addEventListener('click', async () => {
    if (!currentGs) return;
    const gs = JSON.parse(JSON.stringify(currentGs));
    callTichu(gs, myPlayerId);
    document.getElementById('btn-tichu').style.display = 'none';
    log('티츄를 선언했습니다! 🎯');
    await saveGameState(myRoomId, gs);
  });
  document.getElementById('btn-grand-tichu-yes').addEventListener('click', () => onGrandTichu(true));
  document.getElementById('btn-grand-tichu-no').addEventListener('click', () => onGrandTichu(false));
  document.getElementById('btn-exchange-confirm').addEventListener('click', onExchangeConfirm);
  document.getElementById('btn-next-round').addEventListener('click', async () => {
    hideModal('modal-round-over');
    if (!isHost) return;
    if (!currentGs) return;
    const gs = JSON.parse(JSON.stringify(currentGs));
    startRound(gs);
    lastRoundPhase = null;
    await saveGameState(myRoomId, gs);
  });
  document.getElementById('btn-wish-none').addEventListener('click', () => {
    hideModal('modal-wish');
    doPlay(null);
  });
}

async function onGrandTichu(call) {
  hideModal('modal-grand-tichu');
  if (!currentGs) return;
  const gs = JSON.parse(JSON.stringify(currentGs));
  setGrandTichu(gs, myPlayerId, call);
  await saveGameState(myRoomId, gs);
}

function onPlay() {
  const cards = myHand.filter(c => selectedIds.has(c.id));
  if (cards.length === 0) return;
  if (cards.some(c => c.rank === 'mahjong')) { showWishModal(); return; }
  doPlay(null);
}

async function doPlay(wishRank) {
  const cards = myHand.filter(c => selectedIds.has(c.id));
  if (cards.length === 0) return;
  const combo = detectCombination(cards);
  if (!combo) { setStatus('⚠️ 낼 수 없는 패입니다'); return; }
  if (!currentGs) return;
  const gs = JSON.parse(JSON.stringify(currentGs));
  const result = playCards(gs, myPlayerId, combo, wishRank);
  if (result.error) { setStatus(`⚠️ ${result.error}`); return; }
  selectedIds.clear();
  await saveGameState(myRoomId, gs);
}

async function onPass() {
  if (!currentGs) return;
  const gs = JSON.parse(JSON.stringify(currentGs));
  const result = pass(gs, myPlayerId);
  if (result.error) { setStatus(`⚠️ ${result.error}`); return; }
  selectedIds.clear();
  await saveGameState(myRoomId, gs);
}

async function onExchangeConfirm() {
  const { left, across, right } = exchangeSelection;
  if (!left || !across || !right) return;
  if (!currentGs) return;
  const gs = JSON.parse(JSON.stringify(currentGs));
  submitExchange(gs, myPlayerId, { left, across, right });
  await saveGameState(myRoomId, gs);
}

// ── Rendering ──
function sortHand(hand) {
  const SUIT_ORDER = { jade: 0, sword: 1, pagoda: 2, star: 3 };
  return [...hand].sort((a, b) => {
    if (sortMode === 'suit') {
      const sa = a.isSpecial ? 4 : (SUIT_ORDER[a.suit] ?? 4);
      const sb = b.isSpecial ? 4 : (SUIT_ORDER[b.suit] ?? 4);
      if (sa !== sb) return sa - sb;
      return a.numericValue - b.numericValue;
    }
    // rank mode
    if (a.numericValue !== b.numericValue) return a.numericValue - b.numericValue;
    return (a.suit || '').localeCompare(b.suit || '');
  });
}

function setSortMode(mode) {
  sortMode = mode;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === mode));
  renderMyHand();
  if (exchangePhase) renderExchangeHand();
}
window._setSortMode = setSortMode;

function renderSortBar(target) {
  const bar = document.createElement('div');
  bar.className = 'sort-bar';
  for (const [mode, label] of [['rank','숫자순'],['suit','모양순']]) {
    const btn = document.createElement('button');
    btn.className = 'sort-btn' + (sortMode === mode ? ' active' : '');
    btn.dataset.sort = mode;
    btn.textContent = label;
    btn.addEventListener('click', () => setSortMode(mode));
    bar.appendChild(btn);
  }
  target.appendChild(bar);
}

function renderMyHand() {
  const container = document.getElementById('my-hand');
  container.innerHTML = '';
  document.getElementById('my-hand-count').textContent = myHand.length;
  for (const card of sortHand(myHand)) {
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
    el.innerHTML = `<div class="card-rank-top">${RANK_DISPLAY[card.rank]||card.rank}</div><div class="card-suit" style="font-size:32px;">${RANK_DISPLAY[card.rank]||''}</div><div class="card-rank-bot">${RANK_DISPLAY[card.rank]||card.rank}</div>`;
  } else {
    el.classList.add(`suit-${card.suit}`);
    el.innerHTML = `<div class="card-rank-top">${card.rank}<br><span style="font-size:10px;">${SUIT_ICON[card.suit]}</span></div><div class="card-suit">${SUIT_ICON[card.suit]}</div><div class="card-rank-bot">${card.rank}<br><span style="font-size:10px;">${SUIT_ICON[card.suit]}</span></div>`;
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
  if (exchangePhase) { handleExchangeSelect(card); return; }
  if (selectedIds.has(card.id)) { selectedIds.delete(card.id); el.classList.remove('selected'); }
  else { selectedIds.add(card.id); el.classList.add('selected'); }
  updateSelectedInfo();
}

function updateSelectedInfo() {
  const count = selectedIds.size;
  document.getElementById('selected-info').textContent = count > 0 ? `${count}장 선택됨` : '';
}

function renderTrick(trick) {
  const area = document.getElementById('trick-area');
  area.innerHTML = '';
  if (!trick || !trick.plays || trick.plays.length === 0) return;
  for (const play of trick.plays) {
    const div = document.createElement('div');
    div.className = 'trick-play';
    for (const card of play.combination.cards) div.appendChild(createCardEl(card));
    area.appendChild(div);
  }
}

// ── Player Zones ──
function setupPlayerZones() {
  const zones = ['north', 'west', 'east'];
  const relSeats = [2, 1, 3];
  for (let i = 0; i < 3; i++) {
    const seat = (mySeat + relSeats[i]) % 4;
    const p = players.find(x => x.seat === seat);
    if (!p) continue;
    document.getElementById(`avatar-${zones[i]}`).textContent = p.avatar || '🙂';
    document.getElementById(`name-${zones[i]}`).textContent = p.name;
    document.getElementById(`count-${zones[i]}`).textContent = '14';
  }
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
  return 'east';
}

function updateHandCounts(counts) {
  if (!counts) return;
  for (const [pid, count] of Object.entries(counts)) {
    if (pid === myPlayerId) { document.getElementById('my-hand-count').textContent = count; continue; }
    const p = players.find(x => x.id === pid);
    if (!p) continue;
    const zone = getZoneForSeat(p.seat);
    if (zone === 'me') continue;
    const el = document.getElementById(`count-${zone}`);
    if (el) el.textContent = count;
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

function updateActivePlayer(activeId) {
  ['north', 'west', 'east'].forEach(z => document.getElementById(`avatar-${z}`)?.classList.remove('active'));
  if (!activeId || activeId === myPlayerId) return;
  const p = players.find(x => x.id === activeId);
  if (!p) return;
  const zone = getZoneForSeat(p.seat);
  if (zone !== 'me') document.getElementById(`avatar-${zone}`)?.classList.add('active');
}

function updateTichuBadges(tichuCalls, grandTichuCalls) {
  const tc = tichuCalls || {};
  const gc = grandTichuCalls || {};
  for (const zone of ['north', 'west', 'east', 'me']) {
    const pid = zone === 'me' ? myPlayerId : getPlayerIdForZone(zone);
    const el = document.getElementById(`tichu-badge-${zone}`);
    if (!el || !pid) continue;
    if (gc[pid] === true) el.innerHTML = '<div class="tichu-badge grand">라지티츄 👑</div>';
    else if (tc[pid] === true) el.innerHTML = '<div class="tichu-badge">티츄! 🎯</div>';
    else el.innerHTML = '';
  }
}

function getPlayerIdForZone(zone) {
  const relSeats = { north: 2, west: 1, east: 3 };
  const seat = (mySeat + relSeats[zone]) % 4;
  return players.find(x => x.seat === seat)?.id;
}

function updateFinishBadges(finishOrder) { /* logged below */ }

function updateWishIndicator(wishRank) {
  const el = document.getElementById('wish-indicator');
  if (wishRank) { el.classList.add('active'); document.getElementById('wish-rank-text').textContent = wishRank; }
  else el.classList.remove('active');
}

function updateScores(scores) {
  if (!scores) return;
  document.getElementById('score-a').textContent = scores.team0 || 0;
  document.getElementById('score-b').textContent = scores.team1 || 0;
}

function enableActions(isMyTurn, currentTrick) {
  document.getElementById('btn-play').disabled = !isMyTurn;
  document.getElementById('btn-pass').disabled = !isMyTurn || !currentTrick;
}

function disableActions() {
  document.getElementById('btn-play').disabled = true;
  document.getElementById('btn-pass').disabled = true;
}

// ── Modals ──
function renderGrandTichuHand(hand8) {
  const container = document.getElementById('grand-tichu-hand');
  container.innerHTML = '';
  for (const card of sortHand(hand8)) container.appendChild(createCardEl(card));
}

function showGrandTichuModal(hand8) {
  renderGrandTichuHand(hand8);
  // sort bar in grand tichu modal
  const sortWrap = document.getElementById('grand-tichu-sort');
  if (sortWrap) {
    sortWrap.innerHTML = '';
    for (const [mode, label] of [['rank','숫자순'],['suit','모양순']]) {
      const btn = document.createElement('button');
      btn.className = 'sort-btn' + (sortMode === mode ? ' active' : '');
      btn.dataset.sort = mode;
      btn.textContent = label;
      btn.addEventListener('click', () => { setSortMode(mode); renderGrandTichuHand(hand8); });
      sortWrap.appendChild(btn);
    }
  }
  showModal('modal-grand-tichu');
  let timeLeft = 15;
  const fill = document.getElementById('grand-tichu-timer');
  const interval = setInterval(() => {
    timeLeft--;
    fill.style.width = `${(timeLeft / 15) * 100}%`;
    if (timeLeft <= 0) { clearInterval(interval); onGrandTichu(false); hideModal('modal-grand-tichu'); }
  }, 1000);
  document.getElementById('modal-grand-tichu')._timer = interval;
}

function showExchangeModal() {
  exchangePhase = true;
  exchangeSelection = { left: null, across: null, right: null };
  const slots = document.getElementById('exchange-slots');
  slots.innerHTML = '';
  const dirs = [{ key: 'left', label: '왼쪽 상대' }, { key: 'across', label: '파트너' }, { key: 'right', label: '오른쪽 상대' }];
  for (const { key, label } of dirs) {
    const slotDiv = document.createElement('div');
    slotDiv.className = 'exchange-slot';
    const box = document.createElement('div');
    box.className = 'exchange-slot-box';
    box.id = `slot-${key}`;
    box.textContent = '?';
    box.addEventListener('click', () => {
      if (exchangeSelection[key]) {
        exchangeSelection[key] = null;
        box.innerHTML = '?';
        box.classList.remove('filled');
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
  for (const card of sortHand(myHand)) {
    const el = createCardEl(card, true);
    if (selectedInSlots.has(card.id)) { el.classList.add('dim'); el.style.cursor = 'default'; }
    else el.addEventListener('click', () => handleExchangeSelect(card));
    container.appendChild(el);
  }
}

function handleExchangeSelect(card) {
  for (const key of ['left', 'across', 'right']) {
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

function showWishModal() {
  const grid = document.getElementById('wish-rank-grid');
  grid.innerHTML = '';
  for (const r of ['2','3','4','5','6','7','8','9','10','J','Q','K','A']) {
    const btn = document.createElement('button');
    btn.className = 'rank-btn';
    btn.textContent = r;
    btn.addEventListener('click', () => { hideModal('modal-wish'); doPlay(r); });
    grid.appendChild(btn);
  }
  showModal('modal-wish');
}

function showDragonModal() {
  const container = document.getElementById('dragon-opponents');
  container.innerHTML = '';
  const opponents = players.filter(p => p.teamIndex !== myTeam);
  for (const opp of opponents) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-danger';
    btn.style.cssText = 'flex:1;padding:16px;border-radius:14px;flex-direction:column;display:flex;align-items:center;gap:6px;';
    btn.innerHTML = `<span style="font-size:28px;">${opp.avatar||'🙂'}</span><span>${escHtml(opp.name)}</span>`;
    btn.addEventListener('click', async () => {
      hideModal('modal-dragon');
      if (!currentGs) return;
      const gs = JSON.parse(JSON.stringify(currentGs));
      giveDragonTrick(gs, myPlayerId, opp.id);
      await saveGameState(myRoomId, gs);
    });
    container.appendChild(btn);
  }
  showModal('modal-dragon');
}

function showRoundOverModal(finishOrder, totalScores, roundNum) {
  const el = document.getElementById('round-result');
  const finishNames = finishOrder.map((pid, i) => `${['🥇','🥈','🥉','4등'][i]} ${getPlayerName(pid)}`).join('<br>');
  el.innerHTML = `
    <div style="margin-bottom:12px;font-size:14px;color:var(--text-light);">${finishNames}</div>
    <div style="font-size:13px;color:var(--text-light);">누적: 팀 A ${totalScores.team0}점 · 팀 B ${totalScores.team1}점</div>
  `;
  showModal('modal-round-over');
}

function showGameOverModal(winningTeam, totalScores) {
  const winLabel = winningTeam === 0 ? '🌿 팀 A 승리!' : '💜 팀 B 승리!';
  const myWin = myTeam === winningTeam;
  document.getElementById('game-over-emoji').textContent = myWin ? '🎉' : '😢';
  document.getElementById('game-over-title').textContent = winLabel;
  document.getElementById('game-over-scores').innerHTML = `
    <div style="display:flex;gap:12px;justify-content:center;margin-bottom:12px;">
      <div class="score-row team-a" style="flex:1;"><span>🌿 팀 A</span><span class="score-points">${totalScores.team0}</span></div>
      <div class="score-row team-b" style="flex:1;"><span>💜 팀 B</span><span class="score-points">${totalScores.team1}</span></div>
    </div>
  `;
  showModal('modal-game-over');
}

// ── Utils ──
function showModal(id) { document.getElementById(id).style.display = 'flex'; }
function hideModal(id) {
  const el = document.getElementById(id);
  el.style.display = 'none';
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
function getPlayerName(pid) { return players.find(x => x.id === pid)?.name || pid; }
function escHtml(str) { return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
