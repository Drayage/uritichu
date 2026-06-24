'use strict';

function scoreTrick(cards) {
  return cards.reduce((sum, c) => sum + (c.pointValue || 0), 0);
}

// Returns { team0: delta, team1: delta }
function scoreRound(roundState, players) {
  // players: array of { id, seat, teamIndex }
  const teamOf = (playerId) => {
    const p = players.find(p => p.id === playerId);
    return p ? p.teamIndex : 0;
  };

  const { finishOrder, trickWinners, hands } = roundState;
  // finishOrder: all 4 players in finish order (last = 4th place)
  const lastPlayer = finishOrder[finishOrder.length - 1];

  // Check 1-2 finish (both players of a team finish 1st and 2nd)
  const first = finishOrder[0];
  const second = finishOrder[1];
  if (first && second && teamOf(first) === teamOf(second)) {
    const winTeam = teamOf(first);
    const loseTeam = 1 - winTeam;
    const result = { team0: 0, team1: 0 };
    result[`team${winTeam}`] = 200;
    result[`team${loseTeam}`] = 0;
    // still apply tichu bonuses
    return applyTichuBonuses(result, roundState, players);
  }

  // Normal scoring
  const teamPoints = { team0: 0, team1: 0 };
  const allPlayerIds = players.map(p => p.id);

  // Sum trick points per player
  const playerTrickPts = {};
  for (const pid of allPlayerIds) playerTrickPts[pid] = 0;

  for (const pid of allPlayerIds) {
    const won = trickWinners[pid] || [];
    playerTrickPts[pid] = scoreTrick(won);
  }

  // Last player's tricks → opponent team of last player
  const lastTeam = teamOf(lastPlayer);
  const oppTeam = 1 - lastTeam;
  teamPoints[`team${oppTeam}`] += playerTrickPts[lastPlayer];

  // Last player's remaining hand cards → team of 1st place finisher
  const firstTeam = teamOf(first);
  const handCards = hands[lastPlayer] || [];
  const handPts = scoreTrick(handCards);
  teamPoints[`team${firstTeam}`] += handPts;

  // Everyone else's tricks → their own team
  for (const pid of allPlayerIds) {
    if (pid === lastPlayer) continue;
    teamPoints[`team${teamOf(pid)}`] += playerTrickPts[pid];
  }

  return applyTichuBonuses(teamPoints, roundState, players);
}

function applyTichuBonuses(teamPoints, roundState, players) {
  const { finishOrder, grandTichuCalls, tichuCalls } = roundState;
  const first = finishOrder[0];
  const teamOf = (pid) => players.find(p => p.id === pid).teamIndex;
  const result = { ...teamPoints };

  for (const p of players) {
    const pid = p.id;
    if (grandTichuCalls[pid] === true) {
      const success = first === pid;
      result[`team${p.teamIndex}`] += success ? 200 : -200;
    }
    if (tichuCalls[pid] === true) {
      const success = first === pid;
      result[`team${p.teamIndex}`] += success ? 100 : -100;
    }
  }

  return result;
}

module.exports = { scoreTrick, scoreRound };
