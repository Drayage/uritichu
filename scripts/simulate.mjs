#!/usr/bin/env node
/**
 * AI vs AI Tichu simulation — runs N games and prints statistics.
 * Usage: node scripts/simulate.mjs [--games 1000]
 */
import {
  createGameState, startRound, setGrandTichu, submitExchange,
  callTichu, playCards, pass, giveDragonTrick, PHASE,
} from '../public/js/engine/gameState.js';
import { decideAction } from '../public/js/ai/aiPlayer.js';
import { getAllCombinations } from '../public/js/engine/combinations.js';

// ── CLI arg ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const gamesIdx = args.indexOf('--games');
const NUM_GAMES = gamesIdx >= 0 ? parseInt(args[gamesIdx + 1], 10) : 1000;

// ── Players ──────────────────────────────────────────────────────────────────
const PLAYERS = [
  { id: 'p0', name: '냥이',   seat: 0, teamIndex: 0, isAI: true },
  { id: 'p1', name: '토순이', seat: 1, teamIndex: 1, isAI: true },
  { id: 'p2', name: '곰돌이', seat: 2, teamIndex: 0, isAI: true },
  { id: 'p3', name: '여우',   seat: 3, teamIndex: 1, isAI: true },
];
// team0 = p0+p2, team1 = p1+p3

// ── Stats object ─────────────────────────────────────────────────────────────
function makeStats() {
  return {
    games: 0, rounds: 0,
    // Tichu
    grandTichu:  { calls: 0, success: 0 },
    smallTichu:  { calls: 0, success: 0 },
    partnerGTOpportunities: 0, partnerGTBoth: 0,    // GT partner double
    partnerTichuOpportunities: 0, partnerTichuBoth: 0, // small tichu partner double
    opponentTichuBlocked: 0, opponentTichuTotal: 0, // blocking opp tichu
    // Card plays
    bombs: { total: 0, offensive: 0, defensive: 0 }, // offensive=own lead, defensive=steal
    dragon: { plays: 0, trickPoints: 0 },            // dragon trick point total
    phoenix: { singles: 0, combos: 0, trickNums: [] }, // trick # when phoenix used
    dog: { plays: 0, partnerGotLead: 0 },
    passes: 0, plays: 0,
    // Hand management
    turnsPerRound: [],
    wishTurns: [],       // which play# in round was the wish made
    wishFulfillLag: [],  // turns from wish to fulfillment
    wishRanks: {},       // rank → count
    lastPlayerCards: [], // card count for last finisher
    deadCardRounds: 0,   // rounds where last player stuck on isolated low card
    reverseFrom3: 0,     // player had ≤3 cards but ended last
    // Team coordination
    oneTwoCount: 0,      // same-team 1st+2nd in same round
    consecutiveTricks: [], // consecutive tricks won by same team
    // Scoring
    roundDeltas: [],     // round score deltas (absolute)
    exchangeRanks: {},   // which ranks were given as exchange cards
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function partnerId(playerId) {
  const me = PLAYERS.find(p => p.id === playerId);
  const seat = (me.seat + 2) % 4;
  return PLAYERS.find(p => p.seat === seat).id;
}

function teamOf(playerId) {
  return PLAYERS.find(p => p.id === playerId).teamIndex;
}

function isDeadCardStuck(hand) {
  if (hand.length === 0) return false;
  const combos = getAllCombinations(hand, null);
  const inCombo = new Set();
  for (const m of combos) {
    if (m.cards.length >= 2) m.cards.forEach(c => inCombo.add(c.id));
  }
  return hand.some(c => !inCombo.has(c.id) && !c.isSpecial && c.numericValue <= 5);
}

function pct(n, d) {
  if (d === 0) return 'N/A';
  return ((n / d) * 100).toFixed(1) + '%';
}

function avg(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
}

function topN(obj, n = 8) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}:${v}`)
    .join('  ');
}

// ── Per-round simulation ───────────────────────────────────────────────────────
function runRound(gs, stats) {
  startRound(gs);
  const r = gs.currentRound;

  // 1. Grand Tichu
  for (const p of PLAYERS) {
    const act = decideAction(gs, p.id);
    const call = act.data.call;
    if (call) stats.grandTichu.calls++;
    setGrandTichu(gs, p.id, call);
  }

  // 2. Exchange
  const exchangeGiven = {}; // playerId → {left, across, right}
  for (const p of PLAYERS) {
    const act = decideAction(gs, p.id);
    const cards = act.data.cards; // {left, across, right}
    exchangeGiven[p.id] = cards;
    // Track what ranks are exchanged
    for (const c of Object.values(cards)) {
      if (c) stats.exchangeRanks[c.rank] = (stats.exchangeRanks[c.rank] || 0) + 1;
    }
    submitExchange(gs, p.id, cards);
  }

  // 3. Play phase
  let turnNum = 0;
  const MAX_TURNS = 600;
  let wishActiveTurn = null;
  let wishFulfilled = false;

  // Track who had ≤3 cards during the round (to detect reverseFrom3)
  const hadFewCards = new Set();

  // Track consecutive tricks by team
  let lastTrickTeam = -1;
  let curStreak = 0;
  const streaks = [];

  // Track tichu state BEFORE we process to detect newly called tichus
  const tichuCalledBefore = {};

  while ((gs.currentRound?.phase === PHASE.PLAY || gs.currentRound?.phase === PHASE.DRAGON_GIVE)
         && turnNum < MAX_TURNS) {
    const r2 = gs.currentRound;
    turnNum++;

    // Check who has ≤3 cards (before their turn)
    for (const p of PLAYERS) {
      const h = r2.hands[p.id] || [];
      if (h.length > 0 && h.length <= 3 && !r2.finishOrder.includes(p.id)) {
        hadFewCards.add(p.id);
      }
    }

    // Tichu call window: all players not yet having played a card
    for (const p of PLAYERS) {
      if (r2.tichuPlayed[p.id]) continue;
      if (r2.tichuCalls[p.id] !== null && r2.tichuCalls[p.id] !== undefined) continue;
      if (r2.finishOrder.includes(p.id)) continue;
      const act = decideAction(gs, p.id);
      if (act?.action === 'tichu') {
        callTichu(gs, p.id);
        stats.smallTichu.calls++;
      }
    }

    if (gs.currentRound?.phase === PHASE.DRAGON_GIVE) {
      const r3 = gs.currentRound;
      const winnerId = r3.dragonGiveWinner;
      const act = decideAction(gs, winnerId);
      giveDragonTrick(gs, winnerId, act.data.targetId);
      continue;
    }

    if (!gs.currentRound || gs.currentRound.phase !== PHASE.PLAY) break;
    const r3 = gs.currentRound;

    const activeId = r3.activePlayerId;
    if (!activeId) break;
    const act = decideAction(gs, activeId);
    if (!act) break;

    if (act.action === 'pass') {
      stats.passes++;
      stats.plays++;
      pass(gs, activeId);
      continue;
    }

    if (act.action !== 'play') break;

    const combo = act.data.combination;
    stats.plays++;

    // Track bomb
    if (combo.isBomb) {
      stats.bombs.total++;
      const r4 = gs.currentRound;
      if (r4.currentTrick && r4.currentTrick.winnerId !== activeId &&
          teamOf(r4.currentTrick.winnerId) !== teamOf(activeId)) {
        stats.bombs.defensive++;
      } else {
        stats.bombs.offensive++;
      }
    }

    // Track dragon
    if (combo.cards.some(c => c.rank === 'dragon')) {
      stats.dragon.plays++;
      const r4 = gs.currentRound;
      const trickPts = (r4.currentTrick?.cards || []).reduce((s, c) => s + (c.pointValue || 0), 0)
        + combo.cards.reduce((s, c) => s + (c.pointValue || 0), 0);
      stats.dragon.trickPoints += trickPts;
    }

    // Track phoenix
    if (combo.cards.some(c => c.rank === 'phoenix')) {
      const r4 = gs.currentRound;
      const trickNum = (r4.pastTricks?.length || 0) + 1;
      stats.phoenix.trickNums.push(trickNum);
      if (combo.cards.length === 1) stats.phoenix.singles++;
      else stats.phoenix.combos++;
    }

    // Track dog
    if (combo.cards.some(c => c.rank === 'dog')) {
      stats.dog.plays++;
    }

    // Track wish
    const wishRankArg = act.data.wishRank ?? null;
    if (wishRankArg && combo.cards.some(c => c.rank === 'mahjong')) {
      wishActiveTurn = turnNum;
      wishFulfilled = false;
      stats.wishTurns.push(turnNum);
      stats.wishRanks[wishRankArg] = (stats.wishRanks[wishRankArg] || 0) + 1;
    }

    // Check if wish is being fulfilled this turn
    const r4 = gs.currentRound;
    if (r4.wishRank && combo.cards.some(c =>
      c.rank === r4.wishRank || String(c.numericValue) === String(r4.wishRank)
    )) {
      if (wishActiveTurn !== null && !wishFulfilled) {
        stats.wishFulfillLag.push(turnNum - wishActiveTurn);
        wishFulfilled = true;
      }
    }

    playCards(gs, activeId, combo, wishRankArg);

    // Dog effect: check if partner got the lead
    if (combo.cards.some(c => c.rank === 'dog')) {
      const r5 = gs.currentRound;
      if (r5 && r5.leadPlayerId) {
        const partId = partnerId(activeId);
        if (r5.leadPlayerId === partId) stats.dog.partnerGotLead++;
      }
    }
  }

  // Round ended — evaluate results
  const r5 = gs.currentRound || gs.rounds[gs.rounds.length - 1];
  if (!r5) return;

  stats.rounds++;
  stats.turnsPerRound.push(turnNum);

  // GT/tichu success
  const winner = r5.finishOrder[0];
  for (const p of PLAYERS) {
    const myGT    = r5.grandTichuCalls?.[p.id] === true;
    const mySmall = r5.tichuCalls?.[p.id]       === true;
    if (myGT)    { if (p.id === winner) stats.grandTichu.success++; }
    if (mySmall) { if (p.id === winner) stats.smallTichu.success++; }
  }

  // Opponent tichu blocking (opp called tichu but didn't win)
  for (const p of PLAYERS) {
    const hasTichu = r5.grandTichuCalls?.[p.id] === true || r5.tichuCalls?.[p.id] === true;
    if (hasTichu) {
      stats.opponentTichuTotal++;
      if (r5.finishOrder[0] !== p.id) stats.opponentTichuBlocked++;
    }
  }

  // Partner double-call: for each player, if partner called tichu did I also call?
  // Measure at round end with full picture.
  for (const p of PLAYERS) {
    const partId = partnerId(p.id);
    const partnerCalled = r5.grandTichuCalls?.[partId] === true || r5.tichuCalls?.[partId] === true;
    const iCalled       = r5.grandTichuCalls?.[p.id]   === true || r5.tichuCalls?.[p.id]   === true;
    if (partnerCalled) {
      stats.partnerTichuOpportunities++;
      if (iCalled) stats.partnerTichuBoth++;
    }
  }

  // GT partner double-call specifically
  for (const p of PLAYERS) {
    const partId = partnerId(p.id);
    if (r5.grandTichuCalls?.[partId] === true) {
      stats.partnerGTOpportunities++;
      if (r5.grandTichuCalls?.[p.id] === true) stats.partnerGTBoth++;
    }
  }

  // One-Two
  if (r5.finishOrder.length >= 2) {
    const p1 = r5.finishOrder[0], p2 = r5.finishOrder[1];
    if (teamOf(p1) === teamOf(p2)) stats.oneTwoCount++;
  }

  // Last player stats
  const lastId = r5.finishOrder[r5.finishOrder.length - 1];
  const lastHand = r5.lastPlayerHand || r5.hands?.[lastId] || [];
  stats.lastPlayerCards.push(lastHand.length);
  if (isDeadCardStuck(lastHand)) stats.deadCardRounds++;

  // Reverse from 3: last player had ≤3 cards at some point
  if (hadFewCards.has(lastId)) stats.reverseFrom3++;

  // Scoring
  const delta = r5.scoreDeltas;
  if (delta) {
    stats.roundDeltas.push(Math.abs(delta.team0 - delta.team1));
  }
}

// ── Main simulation loop ───────────────────────────────────────────────────────
function runGame(stats) {
  const gs = createGameState(JSON.parse(JSON.stringify(PLAYERS)));
  let roundsInGame = 0;
  const MAX_ROUNDS = 200;

  while (!gs.gameOver && roundsInGame < MAX_ROUNDS) {
    runRound(gs, stats);
    roundsInGame++;
    // If current round errored or got stuck, check game state
    if (gs.currentRound && gs.currentRound.phase === PHASE.ROUND_OVER) {
      // startRound will be called at top of next iteration
    }
    if (gs.currentRound && gs.currentRound.phase === PHASE.GAME_OVER) {
      gs.gameOver = true;
    }
  }
  stats.games++;
}

// ── Run ────────────────────────────────────────────────────────────────────────
const stats = makeStats();
process.stdout.write(`시뮬레이션 시작: ${NUM_GAMES}게임...\n`);
const t0 = Date.now();

for (let i = 0; i < NUM_GAMES; i++) {
  runGame(stats);
  if ((i + 1) % 100 === 0) {
    process.stdout.write(`  ${i + 1}/${NUM_GAMES} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// ── Report ────────────────────────────────────────────────────────────────────
const D = '─'.repeat(52);
function section(title) { console.log(`\n${D}\n  ${title}\n${D}`); }
function row(label, value) { console.log(`  ${label.padEnd(32)} ${value}`); }

console.log(`\n${'═'.repeat(52)}`);
console.log(`  티추 AI 시뮬레이션 결과  (${NUM_GAMES}게임 / ${stats.rounds}라운드 / ${elapsed}초)`);
console.log('═'.repeat(52));

section('🎴 티츄 선언');
const gtCalls = stats.grandTichu.calls;
const gtSucc  = stats.grandTichu.success;
const stCalls = stats.smallTichu.calls;
const stSucc  = stats.smallTichu.success;
row('라지티츄 선언 (라운드당)',   `${gtCalls}회 (${(gtCalls / stats.rounds).toFixed(2)}회/라운드)`);
row('라지티츄 성공률',           `${gtSucc}/${gtCalls} = ${pct(gtSucc, gtCalls)}`);
row('스몰티츄 선언 (라운드당)',   `${stCalls}회 (${(stCalls / stats.rounds).toFixed(2)}회/라운드)`);
row('스몰티츄 성공률',           `${stSucc}/${stCalls} = ${pct(stSucc, stCalls)}`);
row('파트너 GT 시 같이 GT 선언', `${stats.partnerGTBoth}/${stats.partnerGTOpportunities} = ${pct(stats.partnerGTBoth, stats.partnerGTOpportunities)}`);
row('파트너 티츄 시 같이 티츄',  `${stats.partnerTichuBoth}/${stats.partnerTichuOpportunities} = ${pct(stats.partnerTichuBoth, stats.partnerTichuOpportunities)}`);

section('🃏 패 진행');
const totalActs = stats.plays;
row('패스 비율',          `${stats.passes}/${totalActs} = ${pct(stats.passes, totalActs)}`);
row('평균 턴 수/라운드', `${avg(stats.turnsPerRound).toFixed(1)} ± ${stddev(stats.turnsPerRound).toFixed(1)}`);
row('평균 폭탄 사용/게임', `${(stats.bombs.total / NUM_GAMES).toFixed(2)}회`);
row('  공격적 (선 뺏기)', `${stats.bombs.offensive}회`);
row('  방어적 (상대 트릭 탈취)', `${stats.bombs.defensive}회`);

section('🐉 특수 카드');
const dragonAvgPts = stats.dragon.plays > 0 ? (stats.dragon.trickPoints / stats.dragon.plays).toFixed(1) : 'N/A';
row('용 사용 횟수/게임',     `${(stats.dragon.plays / NUM_GAMES).toFixed(2)}회`);
row('용 트릭 평균 점수',     `${dragonAvgPts}점`);
row('봉황 단독 사용',        `${stats.phoenix.singles}회`);
row('봉황 조합 사용',        `${stats.phoenix.combos}회`);
if (stats.phoenix.trickNums.length > 0) {
  row('봉황 평균 트릭#',     `${avg(stats.phoenix.trickNums).toFixed(1)}번째 트릭`);
}
row('개 사용',              `${stats.dog.plays}회`);
row('개 → 파트너 선 이전', `${stats.dog.partnerGotLead}/${stats.dog.plays} = ${pct(stats.dog.partnerGotLead, stats.dog.plays)}`);

section('🙏 소원');
row('소원 선언 횟수/라운드', `${(stats.wishTurns.length / stats.rounds).toFixed(2)}회`);
if (stats.wishTurns.length > 0) {
  row('평균 소원 선언 턴',     `${avg(stats.wishTurns).toFixed(1)}번째 플레이`);
}
if (stats.wishFulfillLag.length > 0) {
  row('소원 충족까지 평균 턴', `${avg(stats.wishFulfillLag).toFixed(1)}턴`);
}
if (Object.keys(stats.wishRanks).length > 0) {
  row('소원 랭크 분포 (상위)',  topN(stats.wishRanks));
}

section('🤝 팀 협력');
row('원이치 (같은팀 1·2위)',  `${stats.oneTwoCount}/${stats.rounds} = ${pct(stats.oneTwoCount, stats.rounds)}`);

section('💀 핸드 관리');
row('마지막 플레이어 평균 잔여 카드',  `${avg(stats.lastPlayerCards).toFixed(1)}장 ± ${stddev(stats.lastPlayerCards).toFixed(1)}`);
row('Dead Card로 막힌 라운드',         `${stats.deadCardRounds}/${stats.rounds} = ${pct(stats.deadCardRounds, stats.rounds)}`);
row('3장 이하에서 역전패',             `${stats.reverseFrom3}회`);

section('📊 점수 분포');
if (stats.roundDeltas.length > 0) {
  row('라운드 득실 차이 평균', `${avg(stats.roundDeltas).toFixed(1)}점 ± ${stddev(stats.roundDeltas).toFixed(1)}`);
}

section('🔄 교환 패턴 (상위 카드)');
console.log('  ' + topN(stats.exchangeRanks, 12));

console.log(`\n${'═'.repeat(52)}\n`);
