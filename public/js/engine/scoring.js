function scoreTrick(cards) {
  return cards.reduce((sum, c) => sum + (c.pointValue || 0), 0);
}

function scoreRound(roundState, players) {
  const teamOf = (playerId) => {
    const p = players.find(p => p.id === playerId);
    return p ? p.teamIndex : 0;
  };

  const { finishOrder, trickWinners, hands } = roundState;
  const lastPlayer = finishOrder[finishOrder.length - 1];
  const first = finishOrder[0];
  const second = finishOrder[1];

  if (first && second && teamOf(first) === teamOf(second)) {
    const winTeam = teamOf(first);
    const result = { team0: 0, team1: 0 };
    result[`team${winTeam}`] = 200;
    return applyTichuBonuses(result, roundState, players);
  }

  const teamPoints = { team0: 0, team1: 0 };
  const allPlayerIds = players.map(p => p.id);
  const playerTrickPts = {};
  for (const pid of allPlayerIds) playerTrickPts[pid] = 0;
  for (const pid of allPlayerIds) playerTrickPts[pid] = scoreTrick(trickWinners[pid] || []);

  const lastTeam = teamOf(lastPlayer);
  const oppTeam = 1 - lastTeam;
  teamPoints[`team${oppTeam}`] += playerTrickPts[lastPlayer];

  const firstTeam = teamOf(first);
  const handPts = scoreTrick(hands[lastPlayer] || []);
  teamPoints[`team${firstTeam}`] += handPts;

  for (const pid of allPlayerIds) {
    if (pid === lastPlayer) continue;
    teamPoints[`team${teamOf(pid)}`] += playerTrickPts[pid];
  }

  return applyTichuBonuses(teamPoints, roundState, players);
}

function applyTichuBonuses(teamPoints, roundState, players) {
  const { finishOrder, grandTichuCalls, tichuCalls } = roundState;
  const first = finishOrder[0];
  const result = { ...teamPoints };
  for (const p of players) {
    const pid = p.id;
    if (grandTichuCalls[pid] === true) result[`team${p.teamIndex}`] += first === pid ? 200 : -200;
    if (tichuCalls[pid] === true) result[`team${p.teamIndex}`] += first === pid ? 100 : -100;
  }
  return result;
}

export { scoreTrick, scoreRound };
