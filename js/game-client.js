import { listenRoom, saveGameState, setRoomPhase } from './room-manager.js';
import { initHostRunner, onRoomStateChange, hostStartRound, setAIFastMode } from './host-runner.js';
import { startRound, setGrandTichu, submitExchange, callTichu, playCards, pass, giveDragonTrick, PHASE } from './engine/gameState.js';
import { detectCombination, canBeat, getBombs, getValidMoves, TYPE } from './engine/combinations.js';
import { sfxCard, sfxPass, sfxTrickWon, sfxBomb, sfxFinish, sfxTichu, sfxDragon, sfxRoundOver, sfxError, sfxExchange, startBgMusic, stopBgMusic, toggleMute } from './audio.js';
import { startRecording, recordRoundStart, recordTrick, recordRoundEnd, saveGame } from './replay.js';

// ── State ──
let myPlayerId, mySeat, myTeam, myRoomId, isHost;
let players = [];
let myHand = [];
let selectedIds = new Set();
let currentGs = null;
let prevGs = null;
let exchangeSelection = { left: null, across: null, right: null };
let exchangePhase = false;
let lastRoundPhase = null;
let sortMode = 'rank'; // 'rank' | 'suit'
let _lastExchangeCard = null;
let _replayActive = false;
let _aiFastMode = false;
let _lastTrickFirstPlayId = null;
let _lastTrickPlaysLength = 0;
// card id → sender avatar, set after exchange so hand renders the badge
const _receivedFromAvatar = new Map();

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

    // Replay recording: start at first round's grand-tichu phase
    const r0 = gs.currentRound;
    if (!_replayActive && gs.rounds.length === 0 &&
        (r0.phase === PHASE.DEAL_8 || r0.phase === PHASE.GRAND_TICHU)) {
      startRecording(players);
      _replayActive = true;
    }

    // Detect pass/play events from state diff
    if (prevGs?.currentRound && gs.currentRound) detectStateEffects(prevGs, gs);
    prevGs = gs;

    currentGs = gs;
    const me = players.find(p => p.id === myPlayerId);
    if (me) { mySeat = me.seat; myTeam = me.teamIndex; }

    // Always refresh player zone display (handles page refresh mid-game)
    if (mySeat !== undefined) setupPlayerZones();

    const r = gs.currentRound;

    // Detect phase transitions
    const prevRoundPhase = lastRoundPhase;
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

    // Show speed button when there are AI players (host only)
    if (r.phase === PHASE.PLAY && isHost) {
      const hasAI = players.some(p => p.isAI);
      document.getElementById('btn-speed').style.display = hasAI ? '' : 'none';
    } else {
      document.getElementById('btn-speed').style.display = 'none';
    }

    if (r.phase === PHASE.PLAY) {
      const handCounts = {};
      for (const p of players) handCounts[p.id] = (r.hands[p.id] || []).length;
      updateHandCounts(handCounts);
      updateActivePlayer(r.activePlayerId);
      updateWishIndicator(r.wishRank);
      updateTrickPoints(r);
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

    if (r.phase === PHASE.ROUND_OVER && prevRoundPhase !== PHASE.ROUND_OVER) {
      recordRoundEnd(r.scoreDeltas, r.finishOrder);
      showRoundOverModal(r, gs.totalScores);
      disableActions();
    }

    if (r.phase === PHASE.GAME_OVER) {
      if (_replayActive) { saveGame(gs.totalScores); _replayActive = false; }
      hideModal('modal-round-over');
      showGameOverModal(gs.winningTeam, gs.totalScores);
    }

    // Host: run AI
    if (isHost) await onRoomStateChange(room, myPlayerId);
  });
});

function handlePhaseChange(phase, gs, r) {
  if (phase === PHASE.DEAL_8 || phase === PHASE.GRAND_TICHU) {
    // Reset speed mode at start of each round
    if (_aiFastMode) {
      _aiFastMode = false;
      setAIFastMode(false);
      const btn = document.getElementById('btn-speed');
      if (btn) { btn.textContent = '▶▶'; btn.classList.remove('active'); }
    }
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
    if (me && !me.isAI) showExchangeModal(gs, r);
    log('카드 교환 시간!');
  }
  if (phase === PHASE.PLAY && lastRoundPhase === PHASE.EXCHANGE) {
    hideModal('modal-exchange');
    exchangePhase = false;
    recordRoundStart(r.hands);
    sfxExchange();
    showReceivedCards(r);
    log('게임 시작!');
    // Hand is now confirmed (14 cards) — re-measure viewport height so the
    // action buttons are correctly placed once the full hand renders.
    window._fixAppHeight?.();
    requestAnimationFrame(() => window._fixAppHeight?.());
    setTimeout(() => window._fixAppHeight?.(), 200);
  }
  if (phase === PHASE.PLAY) {
    startBgMusic();
  }
  if (phase === PHASE.ROUND_OVER || phase === PHASE.GAME_OVER) {
    stopBgMusic();
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
  const r = currentGs.currentRound;

  // Enforce wish on lead turn: if wish is active and we can satisfy it, we must
  const activeWish = r?.wishRank;
  const isLeadTurn = !r?.currentTrick || r.currentTrick.plays.length === 0;
  if (activeWish && isLeadTurn) {
    const comboHasWish = combo.cards.some(c => c.rank === activeWish || String(c.numericValue) === String(activeWish));
    if (!comboHasWish) {
      const validMoves = getValidMoves(myHand, null, activeWish);
      const canSatisfy = validMoves.some(m => m.cards.some(c => c.rank === activeWish || String(c.numericValue) === String(activeWish)));
      if (canSatisfy) {
        sfxError();
        showWarnToast(`⭐ 소원 ${activeWish} 포함된 패를 내야 해요!`);
        return;
      }
    }
  }

  const gs = JSON.parse(JSON.stringify(currentGs));
  const result = playCards(gs, myPlayerId, combo, wishRank);
  if (result.error) { setStatus(`⚠️ ${result.error}`); return; }
  selectedIds.clear();
  sfxCard();
  await saveGameState(myRoomId, gs);
}

async function onPass() {
  if (!currentGs) return;
  const gs = JSON.parse(JSON.stringify(currentGs));
  const result = pass(gs, myPlayerId);
  if (result.error) { sfxError(); showWarnToast(`⭐ ${result.error}`); return; }
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
window._showBombModal = showBombModal;
window._hideModal = hideModal;
window._toggleMute = () => {
  const muted = toggleMute();
  const btn = document.getElementById('btn-mute');
  if (btn) btn.textContent = muted ? '🔇' : '🔊';
};

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
    const fromAvatar = _receivedFromAvatar.get(card.id);
    if (fromAvatar) {
      const badge = document.createElement('div');
      badge.className = 'card-from';
      badge.textContent = fromAvatar;
      el.appendChild(badge);
    }
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
    if (card.rank === 'mahjong') {
      el.innerHTML = `<div class="card-rank-top">1</div><div class="card-suit">🐦</div><div class="card-rank-bot">1</div>`;
    } else {
      const sym = RANK_DISPLAY[card.rank] || card.rank;
      el.innerHTML = `<div class="card-rank-top">${sym}</div><div class="card-suit">${sym}</div><div class="card-rank-bot">${sym}</div>`;
    }
  } else {
    el.classList.add(`suit-${card.suit}`);
    const icon = SUIT_ICON[card.suit];
    el.innerHTML = `<div class="card-rank-top">${card.rank}</div><div class="card-suit">${icon}</div><div class="card-rank-bot">${card.rank}</div>`;
  }
  const pts = card.pointValue || 0;
  if (pts !== 0) {
    const ptEl = document.createElement('div');
    ptEl.className = 'card-pts' + (pts < 0 ? ' neg' : '');
    ptEl.textContent = pts > 0 ? `+${pts}` : `${pts}`;
    el.appendChild(ptEl);
  }
  return el;
}

function createCardBack() {
  const el = document.createElement('div');
  el.className = 'card-back';
  el.textContent = '🀄';
  return el;
}

const SPECIAL_INFO = {
  mahjong: { name: '참새 🐦', desc: '선공권 획득. 내면서 상대가 반드시 내야 할 숫자를 소원으로 빌 수 있어요.' },
  dog:     { name: '개 🐶',   desc: '파트너에게 선공권을 넘겨줘요. 단독으로만 낼 수 있어요.' },
  phoenix: { name: '불사조 🦚', desc: '어떤 패에나 끼워 쓸 수 있는 조커. 단장으로 낼 땐 현재 패보다 0.5 높게, 폭탄에는 사용 불가.' },
  dragon:  { name: '용 🐉',   desc: '가장 강한 단장(15). 이긴 트릭 전체를 상대팀 중 원하는 상대에게 줘야 해요.' },
};

function toggleSelect(card, el) {
  if (exchangePhase) { handleExchangeSelect(card); return; }
  if (selectedIds.has(card.id)) { selectedIds.delete(card.id); el.classList.remove('selected'); }
  else { selectedIds.add(card.id); el.classList.add('selected'); }
  updateSelectedInfo();
  if (selectedIds.size > 0) {
    // Stage 2: hide all playable glow, show only combinable cards
    document.querySelectorAll('#my-hand .card.playable').forEach(e => e.classList.remove('playable'));
    updateCombinableHighlight();
  } else {
    // Stage 1: back to showing all playable cards
    document.querySelectorAll('#my-hand .card.combinable').forEach(e => e.classList.remove('combinable'));
    const r = currentGs?.currentRound;
    updatePlayableHighlight(r?.currentTrick);
  }
}

function comboLabel(combo) {
  if (!combo) return '';
  // Phoenix single: rank is stored as float (e.g. 8.5) after adjustment
  if (combo.type === TYPE.SINGLE && combo.cards?.length === 1 && combo.cards[0]?.rank === 'phoenix') {
    if (typeof combo.rank === 'number' && !Number.isInteger(combo.rank)) {
      const base = Math.round(combo.rank - 0.5);
      return `🦚 불사조 단장 (현재값 ${combo.rank} · ${base}보다 강함)`;
    }
  }
  const rv = { '-1': '불사조', 0: '개', 1: '참새', 16: '용' };
  const r = rv[String(combo.rank)] ?? combo.rank;
  return ({
    single: `단장 ${r}`,
    pair: `페어 ${r}`,
    triple: `트리플 ${r}`,
    steps: `연속페어 ${combo.length}장 (최고 ${r})`,
    fullhouse: `풀하우스 (${r} 트리플)`,
    straight: `스트레이트 ${combo.length}장`,
    bomb_quad: `💣 포카드 ${r}`,
    bomb_sf: `💣 스티플 ${combo.length}장`,
  })[combo.type] || combo.type;
}

function updateSelectedInfo() {
  const el = document.getElementById('selected-info');
  const hint = document.getElementById('combo-hint');
  const count = selectedIds.size;

  if (count === 0) { el.textContent = ''; if (hint) hint.innerHTML = ''; return; }

  el.textContent = `${count}장 선택`;

  if (!hint) return;

  // Special card single-select info
  if (count === 1) {
    const card = myHand.find(c => selectedIds.has(c.id));
    if (card?.isSpecial) {
      const info = SPECIAL_INFO[card.rank];
      if (info) { hint.innerHTML = `<span class="hint-name">${info.name}</span><span class="hint-desc">${info.desc}</span>`; return; }
    }
  }

  const cards = myHand.filter(c => selectedIds.has(c.id));
  const combo = detectCombination(cards);
  if (!combo) { hint.innerHTML = '<span class="hint-invalid">❌ 낼 수 없는 패</span>'; return; }

  const label = comboLabel(combo);
  const r = currentGs?.currentRound;
  const currentTrick = r?.currentTrick;
  const currentCombo = currentTrick?.winningCombo;

  if (!currentCombo) {
    hint.innerHTML = `<span class="hint-valid">✅ ${label}</span>`;
  } else {
    const ok = canBeat(combo, currentCombo);
    hint.innerHTML = ok
      ? `<span class="hint-valid">✅ ${label}</span>`
      : `<span class="hint-invalid">❌ ${label} — 현재 패를 이길 수 없어요</span>`;
  }
}

function renderTrick(trick) {
  const area = document.getElementById('trick-area');

  if (!trick || !trick.plays || trick.plays.length === 0) {
    area.innerHTML = '';
    _lastTrickFirstPlayId = null;
    _lastTrickPlaysLength = 0;
    return;
  }

  // Detect whether the trick contents actually changed (vs just a pass incrementing passCount)
  const firstPlayId = trick.plays[0]?.combination.cards.map(c => c.id).sort().join(',');
  const isNewTrick = firstPlayId !== _lastTrickFirstPlayId;
  const isNewPlay  = isNewTrick || trick.plays.length > _lastTrickPlaysLength;
  _lastTrickFirstPlayId = firstPlayId;
  _lastTrickPlaysLength = trick.plays.length;
  if (!isNewPlay) return; // passCount changed but no new card play — skip re-render

  area.innerHTML = '';

  // Who played (top)
  const who = document.createElement('div');
  who.className = 'trick-who';
  who.textContent = getPlayerName(trick.winnerId);
  area.appendChild(who);

  // Cards (animated entrance) — sorted by rank ascending
  const lastPlay = trick.plays[trick.plays.length - 1];
  const sortedCards = [...lastPlay.combination.cards].sort((a, b) => a.numericValue - b.numericValue);
  const div = document.createElement('div');
  div.className = 'trick-play anim';
  for (const card of sortedCards) div.appendChild(createCardEl(card));
  area.appendChild(div);

  // Combo label (bottom)
  const label = document.createElement('div');
  label.className = 'trick-combo-label';
  label.textContent = comboLabel(trick.winningCombo);
  area.appendChild(label);

  // Total points in this trick
  const pts = calcCardPoints(trick.cards || []);
  if (pts !== 0) {
    const ptsEl = document.createElement('div');
    ptsEl.className = 'trick-pts-total';
    ptsEl.textContent = `${pts > 0 ? '+' : ''}${pts}점`;
    area.appendChild(ptsEl);
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
      const isSide = zone === 'west' || zone === 'east';
      const maxShow = isSide ? 3 : 5;
      const show = Math.min(count, maxShow);
      for (let i = 0; i < show; i++) handEl.appendChild(createCardBack());
      if (count > maxShow) {
        const more = document.createElement('span');
        more.style.cssText = `font-size:11px;color:var(--text-light);${isSide?'':'margin-left:4px;'}align-self:center;text-align:center;`;
        more.textContent = `+${count - maxShow}`;
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
  document.getElementById('hand-area').classList.toggle('my-turn', isMyTurn);
  updateBombButton(currentTrick);
  if (isMyTurn) updatePlayableHighlight(currentTrick);
  else {
    document.querySelectorAll('#my-hand .card.playable').forEach(el => el.classList.remove('playable'));
    document.querySelectorAll('#my-hand .card.combinable').forEach(el => el.classList.remove('combinable'));
    document.getElementById('btn-pass')?.classList.remove('pulse-hint');
  }
}

function disableActions() {
  document.getElementById('btn-play').disabled = true;
  document.getElementById('btn-pass').disabled = true;
  document.getElementById('btn-bomb').style.display = 'none';
  document.getElementById('hand-area').classList.remove('my-turn');
  document.getElementById('btn-pass')?.classList.remove('pulse-hint');
}

function updateBombButton(currentTrick) {
  const btn = document.getElementById('btn-bomb');
  const me = (currentGs?.players || players).find(p => p.id === myPlayerId);
  if (me?.isAI) { btn.style.display = 'none'; return; }
  const myBombs = getBombs(myHand);
  if (myBombs.length === 0) { btn.style.display = 'none'; return; }

  const r = currentGs?.currentRound;
  const isMyTurn = r?.activePlayerId === myPlayerId;
  const hasActiveTrick = !!currentTrick?.winningCombo;

  // Show bomb button when: there's an active trick bomb can beat (out-of-turn OK),
  // OR it's my turn and I'm the lead (I can start with a bomb)
  if (!hasActiveTrick && !isMyTurn) { btn.style.display = 'none'; return; }
  const currentCombo = currentTrick?.winningCombo || null;
  const canThrow = myBombs.some(b => canBeat(b, currentCombo));
  btn.style.display = canThrow ? '' : 'none';
}

function showBombModal() {
  const list = document.getElementById('bomb-list');
  list.innerHTML = '';
  const currentCombo = currentGs?.currentRound?.currentTrick?.winningCombo || null;
  const bombs = getBombs(myHand).filter(b => canBeat(b, currentCombo));

  for (const bomb of bombs) {
    const row = document.createElement('div');
    row.className = 'bomb-row';

    const label = document.createElement('div');
    label.className = 'bomb-label';
    label.textContent = comboLabel(bomb);

    const cards = document.createElement('div');
    cards.className = 'bomb-cards';
    for (const card of bomb.cards) cards.appendChild(createCardEl(card));

    const btn = document.createElement('button');
    btn.className = 'btn btn-danger';
    btn.style.cssText = 'padding:8px 18px; font-size:13px; flex-shrink:0;';
    btn.textContent = '던지기 💣';
    btn.addEventListener('click', async () => {
      hideModal('modal-bomb');
      if (!currentGs) return;
      const gs = JSON.parse(JSON.stringify(currentGs));
      const result = playCards(gs, myPlayerId, bomb, null);
      if (result.error) { setStatus(`⚠️ ${result.error}`); return; }
      sfxBomb();
      selectedIds.clear();
      await saveGameState(myRoomId, gs);
    });

    row.appendChild(label);
    row.appendChild(cards);
    row.appendChild(btn);
    list.appendChild(row);
  }

  showModal('modal-bomb');
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

function showExchangeModal(gs, r) {
  exchangePhase = true;
  exchangeSelection = { left: null, across: null, right: null };
  _lastExchangeCard = null;

  // Show who called grand tichu
  const gtInfo = document.getElementById('exchange-grand-tichu-info');
  if (gtInfo && r?.grandTichuCalls) {
    const callers = players.filter(p => r.grandTichuCalls[p.id] === true).map(p => `👑 ${p.name}`);
    if (callers.length > 0) {
      gtInfo.textContent = `라지티츄: ${callers.join(', ')}`;
      gtInfo.style.display = '';
    } else {
      gtInfo.style.display = 'none';
    }
  }

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

  // Combinable highlight: cards that share combos with the last selected exchange card
  let combinableIds = new Set();
  if (_lastExchangeCard) {
    const allCombos = getValidMoves(myHand, null, null);
    for (const combo of allCombos) {
      if (combo.cards.some(c => c.id === _lastExchangeCard.id)) {
        for (const c of combo.cards) {
          if (c.id !== _lastExchangeCard.id && !selectedInSlots.has(c.id)) combinableIds.add(c.id);
        }
      }
    }
  }

  for (const card of sortHand(myHand)) {
    const el = createCardEl(card, true);
    if (selectedInSlots.has(card.id)) { el.classList.add('dim'); el.style.cursor = 'default'; }
    else {
      el.addEventListener('click', () => handleExchangeSelect(card));
      if (combinableIds.has(card.id)) el.classList.add('combinable');
    }
    container.appendChild(el);
  }
}

function handleExchangeSelect(card) {
  for (const key of ['left', 'across', 'right']) {
    if (!exchangeSelection[key]) {
      exchangeSelection[key] = card;
      _lastExchangeCard = card;
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
  // Current field context
  const trickEl = document.getElementById('wish-trick-preview');
  trickEl.innerHTML = '';
  const trick = currentGs?.currentRound?.currentTrick;
  if (trick?.plays?.length) {
    const lastPlay = trick.plays[trick.plays.length - 1];
    for (const card of lastPlay.combination.cards) trickEl.appendChild(createCardEl(card));
  } else {
    trickEl.innerHTML = '<span class="wish-empty">선공 (없음)</span>';
  }

  // Remaining hand after playing selected cards
  const handEl = document.getElementById('wish-hand-preview');
  handEl.innerHTML = '';
  for (const card of sortHand(myHand.filter(c => !selectedIds.has(c.id)))) {
    handEl.appendChild(createCardEl(card));
  }

  // Show cards I gave in exchange (still in opponents' hands → strategic info)
  const givenSection = document.getElementById('wish-given-section');
  const givenList = document.getElementById('wish-given-list');
  givenList.innerHTML = '';
  const myP = players.find(p => p.id === myPlayerId);
  const myGiven = currentGs?.currentRound?.exchangeCards?.[myPlayerId];
  if (myP && myGiven) {
    const mySeat = myP.seat;
    const givenTargets = [
      { relSeat: (mySeat + 1) % 4, key: 'left',   label: '왼쪽' },
      { relSeat: (mySeat + 2) % 4, key: 'across',  label: '파트너' },
      { relSeat: (mySeat + 3) % 4, key: 'right',   label: '오른쪽' },
    ];
    let hasGiven = false;
    for (const { relSeat, key, label } of givenTargets) {
      const recipient = players.find(p => p.seat === relSeat);
      const card = myGiven[key];
      if (!recipient || !card) continue;
      hasGiven = true;
      const item = document.createElement('div');
      item.className = 'received-item';
      item.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:3px;';
      const lbl = document.createElement('div');
      lbl.className = 'received-from';
      lbl.textContent = `${recipient.avatar || '🙂'} ${label}`;
      item.appendChild(lbl);
      item.appendChild(createCardEl(card));
      givenList.appendChild(item);
    }
    givenSection.style.display = hasGiven ? '' : 'none';
  } else {
    givenSection.style.display = 'none';
  }

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

function showRoundOverModal(r, totalScores) {
  sfxRoundOver();
  const el = document.getElementById('round-result');
  const placeEmoji = ['🥇','🥈','🥉','4등'];
  const teamLabel = (t) => t === 0 ? '🌿 팀 A' : '💜 팀 B';

  const firstPid = r.finishOrder[0];
  const secondPid = r.finishOrder[1];
  const lastPid = r.finishOrder[r.finishOrder.length - 1];
  const firstP = players.find(p => p.id === firstPid);
  const secondP = players.find(p => p.id === secondPid);
  const lastP = players.find(p => p.id === lastPid);
  const isTadak = firstP && secondP && firstP.teamIndex === secondP.teamIndex;

  // Finish order rows with individual trick points
  const finishRows = r.finishOrder.map((pid, i) => {
    const p = players.find(x => x.id === pid);
    const trickPts = calcCardPoints(r.trickWinners?.[pid] || []);
    const tl = p ? teamLabel(p.teamIndex) : '';
    const isFirst = i === 0;
    const calledGrand = r.grandTichuCalls?.[pid] === true;
    const calledSmall = r.tichuCalls?.[pid] === true;
    let tichuBadge = '';
    if (calledGrand) {
      tichuBadge = isFirst
        ? '<span class="tichu-badge tichu-success">👑 라지티츄 성공 +200</span>'
        : '<span class="tichu-badge tichu-fail">👑 라지티츄 실패 -200</span>';
    } else if (calledSmall) {
      tichuBadge = isFirst
        ? '<span class="tichu-badge tichu-success">🎯 티츄 성공 +100</span>'
        : '<span class="tichu-badge tichu-fail">🎯 티츄 실패 -100</span>';
    }
    return `<div class="result-row"><span>${placeEmoji[i]} ${escHtml(getPlayerName(pid))} <span class="result-team">${tl}</span>${tichuBadge}</span><span class="result-pts">${trickPts !== 0 ? trickPts+'점' : '-'}</span></div>`;
  }).join('');

  // Scoring notes
  let notes = '';
  if (isTadak) {
    notes = `<div class="result-note">🎊 따닥! ${teamLabel(firstP.teamIndex)} → <b>+200점</b></div>`;
  } else if (lastPid && lastP) {
    const lastTrickPts = calcCardPoints(r.trickWinners?.[lastPid] || []);
    const lastHandPts = calcCardPoints(r.lastPlayerHand || []);
    const oppTeam = 1 - lastP.teamIndex;
    if (lastTrickPts !== 0)
      notes += `<div class="result-note">💀 꼴등 먹은점수 <b>${lastTrickPts}점</b> → ${teamLabel(firstP?.teamIndex ?? 0)}</div>`;
    if (lastHandPts !== 0)
      notes += `<div class="result-note">💀 꼴등 손패점수 <b>${lastHandPts}점</b> → ${teamLabel(oppTeam)}</div>`;
  }

  let deltaHtml = '';
  if (r.scoreDeltas) {
    const d0 = r.scoreDeltas.team0;
    const d1 = r.scoreDeltas.team1;
    deltaHtml = `<div class="round-delta">이번 라운드: <span class="round-delta-val team-a-text">${d0 >= 0 ? '+' : ''}${d0}점</span> <span class="round-delta-sep">vs</span> <span class="round-delta-val team-b-text">${d1 >= 0 ? '+' : ''}${d1}점</span></div>`;
  }

  el.innerHTML = `
    <div class="result-header">개인 획득 트릭점수</div>
    ${finishRows}
    ${notes ? `<div class="result-notes">${notes}</div>` : ''}
    ${deltaHtml}
    <div class="result-total">🌿 팀 A <b>${totalScores.team0}점</b> &nbsp;·&nbsp; 💜 팀 B <b>${totalScores.team1}점</b></div>
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

// ── Effects ──
function detectStateEffects(prev, curr) {
  const pr = prev.currentRound;
  const cr = curr.currentRound;
  if (!pr || !cr) return;

  // Detect new tichu/grand tichu calls (any phase)
  for (const p of players) {
    const pid = p.id;
    if (!pr.tichuCalls?.[pid] && cr.tichuCalls?.[pid] === true) showTichuCallToast(pid, false);
    if (!pr.grandTichuCalls?.[pid] && cr.grandTichuCalls?.[pid] === true) showTichuCallToast(pid, true);
  }

  if (pr.phase !== 'play') return;

  const prevPast = pr.pastTricks?.length || 0;
  const currPast = cr.pastTricks?.length || 0;

  // Card play sound for other players (local player already hears sfxCard in doPlay)
  const prevPlays = pr.currentTrick?.plays?.length ?? 0;
  const currPlays = cr.currentTrick?.plays?.length ?? 0;
  if (currPlays > prevPlays && pr.activePlayerId && pr.activePlayerId !== myPlayerId) {
    if (!_aiFastMode) {
      const lastCombo = cr.currentTrick.plays[cr.currentTrick.plays.length - 1]?.combination;
      if (lastCombo?.isBomb) sfxBomb();
      else sfxCard();
    }
  }

  // Dog: lead changed without a trick being added to pastTricks
  if (cr.leadPlayerId !== pr.leadPlayerId && currPast === prevPast) {
    showDogToast(cr.leadPlayerId);
  }

  // Detect pass: passCount went up (regular pass — last pass is handled in trick-won block)
  if (cr.passCount > pr.passCount && pr.activePlayerId) {
    showPassEffect(pr.activePlayerId);
  }

  // Player finished (hand empty)
  const prevFinish = pr.finishOrder?.length || 0;
  const currFinish = cr.finishOrder?.length || 0;
  for (let i = prevFinish; i < currFinish; i++) {
    const pid = cr.finishOrder[i];
    const place = i + 1;
    const calledGrand = cr.grandTichuCalls?.[pid] === true;
    const calledTichu = cr.tichuCalls?.[pid] === true;
    if (place === 1 && (calledGrand || calledTichu)) {
      showTichuSuccessToast(pid, calledGrand);
      sfxTichu(calledGrand);
      setTimeout(() => showFinishToast(pid, place), 700);
    } else {
      showFinishToast(pid, place);
    }
  }

  // Trick won: pastTricks grew
  if (currPast > prevPast) {
    const wonTrick = cr.pastTricks[currPast - 1];
    recordTrick(wonTrick);
    const pts = calcCardPoints(wonTrick.cards || []);
    // Detect last pass: trick ended by passing (no new play added since prev state)
    const prevPlaysLen = pr.currentTrick?.plays?.length ?? 0;
    const wonPlaysLen = wonTrick.plays?.length ?? 0;
    const endedByPass = wonPlaysLen === prevPlaysLen && pr.activePlayerId;
    if (endedByPass) {
      showPassEffect(pr.activePlayerId);
      setTimeout(() => {
        if (wonTrick.givenTo) showDragonGiveToast(wonTrick.winnerId, wonTrick.givenTo, pts);
        else showTrickWonToast(wonTrick.winnerId, pts);
      }, 650);
    } else {
      if (wonTrick.givenTo) showDragonGiveToast(wonTrick.winnerId, wonTrick.givenTo, pts);
      else showTrickWonToast(wonTrick.winnerId, pts);
    }
  }
}

function _getZoneEl(playerId) {
  if (playerId === myPlayerId) return document.getElementById('hand-area');
  const p = players.find(x => x.id === playerId);
  if (!p) return null;
  const zone = getZoneForSeat(p.seat);
  return document.getElementById(`zone-${zone}`);
}

function showPassEffect(playerId) {
  sfxPass();
  const target = _getZoneEl(playerId);
  const toast = document.createElement('div');
  toast.className = 'pass-toast';
  toast.textContent = `${getPlayerName(playerId)} 패스`;
  if (target) {
    const rect = target.getBoundingClientRect();
    toast.style.left = `${rect.left + rect.width / 2}px`;
    toast.style.top = `${rect.top + rect.height / 2}px`;
  } else {
    toast.style.left = '50%'; toast.style.top = '50%';
  }
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1400);
}

function showPlayEffect(playerId) {
  const target = _getZoneEl(playerId);
  if (!target) return;
  const flash = document.createElement('div');
  flash.className = 'play-flash';
  target.appendChild(flash);
  setTimeout(() => flash.remove(), 600);
}

function showSurrenderModal() {
  showModal('modal-surrender');
}
window._showSurrenderModal = showSurrenderModal;
window._toggleAISpeed = () => {
  _aiFastMode = !_aiFastMode;
  setAIFastMode(_aiFastMode);
  const btn = document.getElementById('btn-speed');
  if (btn) { btn.textContent = _aiFastMode ? '⏩' : '▶▶'; btn.classList.toggle('active', _aiFastMode); }
};

// ── Trick points helpers ──
function calcCardPoints(cards) {
  return (cards || []).reduce((s, c) => s + (c.pointValue || 0), 0);
}

function updateTrickPoints(r) {
  if (!r?.trickWinners) return;
  for (const zone of ['north', 'west', 'east', 'me']) {
    const pid = zone === 'me' ? myPlayerId : getPlayerIdForZone(zone);
    const el = document.getElementById(`trick-pts-${zone}`);
    if (!el || !pid) continue;
    const pts = calcCardPoints(r.trickWinners[pid] || []);
    el.textContent = pts !== 0 ? `${pts}점` : '';
  }
}

let _lastTrickSfxAt = 0;
function showTrickWonToast(winnerId, pts) {
  // Throttle sfx in fast mode so audio context doesn't get overwhelmed
  const now = Date.now();
  if (!_aiFastMode || now - _lastTrickSfxAt > 280) {
    sfxTrickWon();
    _lastTrickSfxAt = now;
  }
  const toast = document.createElement('div');
  toast.className = 'trick-won-toast';
  const name = getPlayerName(winnerId);
  toast.textContent = pts !== 0
    ? `${name} ${pts > 0 ? '+' : ''}${pts}점 획득!`
    : `${name} 먹음`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), _aiFastMode ? 320 : 1800);
}

function showWarnToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'trick-won-toast warn-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

function showDogToast(newLeadId) {
  if (_aiFastMode) return;
  const toast = document.createElement('div');
  toast.className = 'trick-won-toast dog-toast';
  toast.textContent = `🐶 → ${getPlayerName(newLeadId)} 선공권`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1800);
}

function showFinishToast(playerId, place) {
  sfxFinish(place);
  const medals = ['🥇','🥈','🥉','4등'];
  const toast = document.createElement('div');
  toast.className = 'trick-won-toast finish-toast';
  toast.textContent = `${medals[place - 1] || place + '등'} ${getPlayerName(playerId)} 완주!`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

function showDragonGiveToast(winnerId, givenToId, pts) {
  sfxDragon();
  const toast = document.createElement('div');
  toast.className = 'trick-won-toast dragon-give-toast';
  toast.textContent = `🐉 ${getPlayerName(winnerId)} → ${getPlayerName(givenToId)}에게 (${pts > 0 ? '+' : ''}${pts}점)`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function showTichuSuccessToast(playerId, isGrand) {
  const toast = document.createElement('div');
  toast.className = 'trick-won-toast tichu-success-toast';
  toast.textContent = isGrand
    ? `👑 라지티츄 성공! ${getPlayerName(playerId)}`
    : `🎯 티츄 성공! ${getPlayerName(playerId)}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function showTichuCallToast(playerId, isGrand) {
  sfxTichu(isGrand);
  const toast = document.createElement('div');
  toast.className = isGrand
    ? 'trick-won-toast tichu-call-toast grand-tichu-call-toast'
    : 'trick-won-toast tichu-call-toast';
  toast.textContent = isGrand
    ? `👑 ${getPlayerName(playerId)} 라지티츄 선언!`
    : `🎯 ${getPlayerName(playerId)} 티츄 선언!`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Playable highlight ──
function updatePlayableHighlight(currentTrick) {
  document.querySelectorAll('#my-hand .card.playable').forEach(el => el.classList.remove('playable'));
  document.getElementById('btn-pass')?.classList.remove('pulse-hint');

  const r = currentGs?.currentRound;
  const wishRank = r?.wishRank || null;

  // Lead turn: highlight all cards (or wish-satisfying only if wish active)
  if (!currentTrick || !currentTrick.winningCombo) {
    if (!wishRank) {
      document.querySelectorAll('#my-hand .card').forEach(el => el.classList.add('playable'));
      return;
    }
    // Wish active: highlight only cards belonging to wish-satisfying combos
    const wishMoves = getValidMoves(myHand, null, wishRank).filter(m =>
      m.cards.some(c => c.rank === wishRank || String(c.numericValue) === String(wishRank))
    );
    if (wishMoves.length > 0) {
      const playableIds = new Set();
      for (const move of wishMoves) move.cards.forEach(c => playableIds.add(c.id));
      document.querySelectorAll('#my-hand .card').forEach(el => {
        if (playableIds.has(el.dataset.id)) el.classList.add('playable');
      });
    }
    return;
  }

  const validMoves = getValidMoves(myHand, currentTrick.winningCombo, wishRank);

  if (validMoves.length === 0) {
    document.getElementById('btn-pass')?.classList.add('pulse-hint');
  } else {
    const playableIds = new Set();
    for (const move of validMoves) move.cards.forEach(c => playableIds.add(c.id));
    document.querySelectorAll('#my-hand .card').forEach(el => {
      if (playableIds.has(el.dataset.id)) el.classList.add('playable');
    });
  }
}

// ── Combinable highlight (stage 2: cards that complete the current selection) ──
function updateCombinableHighlight() {
  document.querySelectorAll('#my-hand .card.combinable').forEach(el => el.classList.remove('combinable'));

  if (selectedIds.size === 0) return;

  const r = currentGs?.currentRound;
  const currentCombo = r?.currentTrick?.winningCombo || null;

  const selectedCards = myHand.filter(c => selectedIds.has(c.id));
  const validMoves = getValidMoves(myHand, currentCombo, r?.wishRank || null);

  // Match combos by rank multiset (not card ID) so duplicate-rank cards
  // (e.g. two 7s) all trigger the same highlight regardless of which instance is selected.
  const cardRank = c => c.numericValue ?? c.rank; // numeric for normal, string for specials
  const selectedRanks = selectedCards.map(cardRank).sort();

  function rankMultisetContains(comboRanks, needed) {
    const pool = [...comboRanks];
    for (const r of needed) {
      const i = pool.indexOf(r);
      if (i === -1) return false;
      pool.splice(i, 1);
    }
    return true;
  }

  const matchingCombos = validMoves.filter(combo =>
    rankMultisetContains(combo.cards.map(cardRank), selectedRanks)
  );

  // For each matching combo, find ranks not yet selected and highlight
  // any unselected hand card that satisfies those ranks.
  const combinableIds = new Set();
  for (const combo of matchingCombos) {
    const neededRanks = [...selectedRanks];
    const extraRanks = [];
    for (const c of combo.cards) {
      const rk = cardRank(c);
      const i = neededRanks.indexOf(rk);
      if (i !== -1) neededRanks.splice(i, 1);
      else extraRanks.push(rk);
    }
    // Match extra ranks to actual unselected hand cards (in order, one-to-one)
    const pool = [...extraRanks];
    for (const c of myHand) {
      if (selectedIds.has(c.id)) continue;
      const rk = cardRank(c);
      const i = pool.indexOf(rk);
      if (i !== -1) { combinableIds.add(c.id); pool.splice(i, 1); }
    }
  }

  document.querySelectorAll('#my-hand .card').forEach(el => {
    if (combinableIds.has(el.dataset.id)) el.classList.add('combinable');
  });
}

// ── Show received cards after exchange ──
function showReceivedCards(r) {
  if (!r.exchangeCards) return;
  const myP = players.find(p => p.id === myPlayerId);
  if (!myP) return;
  const seat = myP.seat;

  // Direction rules from exchange.js:
  // Sender at (seat+3)%4 sent their 'left' card to me (seat)
  // Sender at (seat+2)%4 sent their 'across' card to me (seat)
  // Sender at (seat+1)%4 sent their 'right' card to me (seat)
  const sources = [
    { relSeat: (seat + 3) % 4, key: 'left',  label: '왼쪽' },
    { relSeat: (seat + 2) % 4, key: 'across', label: '파트너' },
    { relSeat: (seat + 1) % 4, key: 'right',  label: '오른쪽' },
  ];

  _receivedFromAvatar.clear();
  const received = sources.map(({ relSeat, key, label }) => {
    const sender = players.find(p => p.seat === relSeat);
    if (!sender) return null;
    const card = r.exchangeCards[sender.id]?.[key];
    if (!card) return null;
    const avatar = sender.avatar || '🙂';
    _receivedFromAvatar.set(card.id, avatar); // remember for hand rendering
    return { card, senderName: sender.name, senderAvatar: avatar, label };
  }).filter(Boolean);

  if (received.length === 0) return;

  const overlay = document.createElement('div');
  overlay.className = 'received-cards-overlay';

  const box = document.createElement('div');
  box.className = 'received-cards-box';

  const title = document.createElement('div');
  title.className = 'received-title';
  title.textContent = '받은 카드 🎁';
  box.appendChild(title);

  const list = document.createElement('div');
  list.className = 'received-list';
  for (const { card, senderName, senderAvatar, label } of received) {
    const item = document.createElement('div');
    item.className = 'received-item';
    const from = document.createElement('div');
    from.className = 'received-from';
    from.textContent = `${label} · ${escHtml(senderName)}`;
    item.appendChild(from);
    const cardEl = createCardEl(card);
    const badge = document.createElement('div');
    badge.className = 'card-from';
    badge.textContent = senderAvatar;
    cardEl.appendChild(badge);
    item.appendChild(cardEl);
    list.appendChild(item);
  }
  box.appendChild(list);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  setTimeout(() => overlay.remove(), 4500);
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
