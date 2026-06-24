// ── Replay Recording & Viewing ──

const STORAGE_KEY = 'tichu_replays';
const MAX_GAMES = 10;

let _rec = null;
let _viewGame = null;
let _viewRound = 0;
let _viewTrick = 0; // -1 = initial hands

// ── Recording API ──

export function startRecording(players) {
  _rec = {
    id: Date.now().toString(),
    date: new Date().toISOString(),
    players: players.map(p => ({
      id: p.id, name: p.name, avatar: p.avatar || '🙂',
      teamIndex: p.teamIndex, seat: p.seat
    })),
    rounds: [],
    finalScores: null,
    winner: null
  };
}

function slim(c) {
  return { id: c.id, suit: c.suit, rank: c.rank, numericValue: c.numericValue, pointValue: c.pointValue, isSpecial: !!c.isSpecial };
}

export function recordRoundStart(hands) {
  if (!_rec) return;
  const slimHands = {};
  for (const [pid, cards] of Object.entries(hands)) {
    slimHands[pid] = cards.map(slim);
  }
  _rec.rounds.push({ startHands: slimHands, tricks: [], scoreDeltas: null, finishOrder: [] });
}

export function recordTrick(trick) {
  if (!_rec || !_rec.rounds.length) return;
  const round = _rec.rounds[_rec.rounds.length - 1];
  round.tricks.push({
    leadPlayerId: trick.leadPlayerId,
    winnerId: trick.givenTo || trick.winnerId,
    dragonGiven: !!trick.givenTo,
    dragonOrigWinner: trick.givenTo ? trick.winnerId : null,
    plays: (trick.plays || []).map(p => ({
      playerId: p.playerId,
      cards: (p.combination?.cards || []).map(slim)
    }))
  });
}

export function recordRoundEnd(scoreDeltas, finishOrder) {
  if (!_rec || !_rec.rounds.length) return;
  const round = _rec.rounds[_rec.rounds.length - 1];
  round.scoreDeltas = scoreDeltas;
  round.finishOrder = [...(finishOrder || [])];
}

export function saveGame(totalScores) {
  if (!_rec) return;
  const a = totalScores?.team0 ?? 0, b = totalScores?.team1 ?? 0;
  _rec.finalScores = { teamA: a, teamB: b };
  _rec.winner = a > b ? 'A' : b > a ? 'B' : 'tie';
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    saved.unshift(_rec);
    if (saved.length > MAX_GAMES) saved.splice(MAX_GAMES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch (e) { console.warn('replay save:', e); }
  _rec = null;
}

export function loadGames() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

// ── UI ──

export function openReplayModal() {
  document.getElementById('modal-replay').style.display = 'flex';
  showList();
}

export function closeReplayModal() {
  document.getElementById('modal-replay').style.display = 'none';
}

function showList() {
  document.getElementById('replay-list-view').style.display = '';
  document.getElementById('replay-detail-view').style.display = 'none';

  const games = loadGames();
  const list = document.getElementById('replay-game-list');
  list.innerHTML = '';

  if (!games.length) {
    list.innerHTML = '<div class="replay-empty">아직 완료된 게임 기록이 없습니다.<br>게임을 완료하면 자동 저장됩니다.</div>';
    return;
  }

  games.forEach(game => {
    const d = new Date(game.date);
    const dateStr = `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const teamA = game.players.filter(p => p.teamIndex === 0).map(p => p.name).join('+');
    const teamB = game.players.filter(p => p.teamIndex === 1).map(p => p.name).join('+');
    const sA = game.finalScores?.teamA ?? '?';
    const sB = game.finalScores?.teamB ?? '?';
    const winLabel = game.winner === 'A' ? '🏆 팀A 승' : game.winner === 'B' ? '🏆 팀B 승' : '무승부';

    const item = document.createElement('div');
    item.className = 'replay-list-item';
    item.innerHTML = `
      <div class="replay-item-top">
        <span class="replay-date">${dateStr}</span>
        <span class="replay-win-label">${winLabel}</span>
        <span class="replay-rounds-count">${game.rounds.length}라운드</span>
      </div>
      <div class="replay-item-bottom">
        <span class="team-a-text">${teamA}</span>
        <span class="replay-score-mid">${sA} : ${sB}</span>
        <span class="team-b-text">${teamB}</span>
      </div>
    `;
    item.onclick = () => openDetail(game);
    list.appendChild(item);
  });
}

function openDetail(game) {
  _viewGame = game;
  _viewRound = 0;
  _viewTrick = -1;
  document.getElementById('replay-list-view').style.display = 'none';
  document.getElementById('replay-detail-view').style.display = '';
  renderTabs();
  renderTrickView();
}

function renderTabs() {
  const tabs = document.getElementById('replay-round-tabs');
  tabs.innerHTML = '';
  (_viewGame.rounds || []).forEach((_, i) => {
    const btn = document.createElement('button');
    btn.className = 'replay-tab' + (i === _viewRound ? ' active' : '');
    btn.textContent = `${i+1}라운드`;
    btn.onclick = () => { _viewRound = i; _viewTrick = -1; renderTabs(); renderTrickView(); };
    tabs.appendChild(btn);
  });
}

function pName(pid) { return _viewGame.players.find(p => p.id === pid)?.name || '?'; }
function pTeam(pid) { return _viewGame.players.find(p => p.id === pid)?.teamIndex ?? -1; }
function pAvatar(pid) { return _viewGame.players.find(p => p.id === pid)?.avatar || '🙂'; }
function teamCls(pid) { return pTeam(pid) === 0 ? 'team-a-text' : 'team-b-text'; }

function renderTrickView() {
  const round = _viewGame.rounds[_viewRound];
  const total = round?.tricks?.length ?? 0;
  const pos = document.getElementById('replay-trick-pos');
  const display = document.getElementById('replay-trick-display');
  const prevBtn = document.getElementById('replay-prev');
  const nextBtn = document.getElementById('replay-next');

  if (_viewTrick === -1) {
    pos.textContent = '초기 패';
    prevBtn.disabled = true;
    nextBtn.disabled = total === 0;
    display.innerHTML = renderHands(round);
    return;
  }

  pos.textContent = `트릭 ${_viewTrick + 1} / ${total}`;
  prevBtn.disabled = false;
  nextBtn.disabled = _viewTrick >= total - 1;
  display.innerHTML = renderTrick(round, _viewTrick);
}

function renderHands(round) {
  if (!round?.startHands) return '<div class="replay-empty">패 정보 없음</div>';
  let html = '<div class="replay-hands-grid">';
  for (const player of _viewGame.players) {
    const cards = round.startHands[player.id];
    if (!cards) continue;
    const sorted = [...cards].sort((a, b) => a.numericValue - b.numericValue);
    html += `
      <div class="replay-hand-row">
        <div class="replay-player-label ${teamCls(player.id)}">${player.avatar} ${player.name}</div>
        <div class="replay-cards-row">${sorted.map(miniCard).join('')}</div>
      </div>`;
  }
  return html + '</div>';
}

function renderTrick(round, idx) {
  const trick = round.tricks[idx];
  if (!trick) return '';
  let html = '<div class="replay-trick-card">';

  for (const play of trick.plays) {
    const isWinner = play.playerId === trick.winnerId && play === trick.plays[trick.plays.length - 1];
    const sorted = [...play.cards].sort((a, b) => a.numericValue - b.numericValue);
    const pts = play.cards.reduce((s, c) => s + (c.pointValue || 0), 0);
    html += `
      <div class="replay-play-row ${isWinner ? 'winner-row' : ''}">
        <div class="replay-play-player ${teamCls(play.playerId)}">
          ${pAvatar(play.playerId)} ${pName(play.playerId)}
          ${isWinner ? '<span class="replay-crown">👑</span>' : ''}
        </div>
        <div class="replay-cards-row">${sorted.map(miniCard).join('')}</div>
        ${pts !== 0 ? `<div class="replay-play-pts">${pts > 0 ? '+' : ''}${pts}</div>` : ''}
      </div>`;
  }

  if (trick.dragonGiven) {
    html += `<div class="replay-dragon-note">🐉 ${pName(trick.dragonOrigWinner)} → ${pName(trick.winnerId)}에게 전달</div>`;
  }

  // Total trick points
  const allPts = (trick.plays || []).flatMap(p => p.cards).reduce((s, c) => s + (c.pointValue || 0), 0);
  if (allPts !== 0) html += `<div class="replay-trick-pts-total">${allPts > 0 ? '+' : ''}${allPts}점</div>`;

  html += '</div>';

  // Round result on last trick
  if (idx === round.tricks.length - 1 && round.scoreDeltas) {
    const d = round.scoreDeltas;
    html += `<div class="replay-round-result">
      <span class="team-a-text">팀A ${d.team0 >= 0 ? '+' : ''}${d.team0}</span>
      <span class="replay-result-sep">|</span>
      <span class="team-b-text">팀B ${d.team1 >= 0 ? '+' : ''}${d.team1}</span>
    </div>`;
  }

  return html;
}

const SUIT_EMOJI = { sword: '⭐', pagoda: '🏠', jade: '🌿', star: '💜' };

function miniCard(c) {
  if (c.isSpecial) {
    const inner = c.rank === 'dragon' ? '🐉' : c.rank === 'phoenix' ? '🦚' : c.rank === 'dog' ? '🐕' : '一';
    return `<div class="r-card r-special">${inner}</div>`;
  }
  const suit = SUIT_EMOJI[c.suit] || c.suit;
  const rank = c.rank;
  const cls = ['sword','jade'].includes(c.suit) ? 'r-dark' : 'r-warm';
  return `<div class="r-card ${cls}"><span class="r-rank">${rank}</span><span class="r-suit">${suit}</span></div>`;
}

// Navigation (called from HTML)
export function replayPrev() {
  if (_viewTrick > -1) { _viewTrick--; renderTrickView(); }
}
export function replayNext() {
  const total = _viewGame?.rounds[_viewRound]?.tricks?.length ?? 0;
  if (_viewTrick < total - 1) { _viewTrick++; renderTrickView(); }
}
export function replayBackToList() { showList(); }
