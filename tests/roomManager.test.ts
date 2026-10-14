import { describe, expect, it } from "vitest";
import { RoomManager } from "../server/roomManager";
import { getIdentity, getTeamSize } from "../shared/rules";

function createStartedRoom() {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom("房主", "socket-0");
  const players = [host];
  for (let index = 1; index < 5; index += 1) {
    players.push(manager.joinRoom(room.code, `玩家${index}`, `socket-${index}`).player);
  }
  return { manager, room, players };
}

function createInvasionRoom(round = 3) {
  const { manager, room, players } = createStartedRoom();
  manager.startGame(room, players[0]);
  const roles = ["possessed", "detective", "halfWitch", "goodWitch", "magicalGirl"] as const;
  players.forEach((player, index) => {
    room.identities.set(player.id, getIdentity(roles[index]));
    room.alignments.set(player.id, getIdentity(roles[index]).camp);
  });
  room.round = round;
  room.successCount = 2;

  const team = players.slice(0, getTeamSize(players.length, round));
  expect(manager.selectTeam(room, players[room.leaderIndex], team.map((player) => player.id)).ok).toBe(true);
  for (const player of players) manager.voteTeam(room, player, true);
  for (const player of team) manager.missionAction(room, player, "SUCCESS");
  return { manager, room, players };
}

describe("RoomManager", () => {
  it("removes a player who leaves the lobby so rejoining does not create a duplicate seat", () => {
    const { manager, room, players } = createStartedRoom();
    const leavingPlayer = players[2];

    expect(manager.leaveRoom(room.code, leavingPlayer.id)).toEqual({ ok: true, room });
    expect(room.players.map((player) => player.id)).not.toContain(leavingPlayer.id);
    expect(room.players.map((player) => player.seatIndex)).toEqual([0, 1, 2, 3]);

    const rejoinedPlayer = manager.joinRoom(room.code, leavingPlayer.name, "new-socket").player;
    expect(room.players).toHaveLength(5);
    expect(room.players.filter((player) => player.name === leavingPlayer.name)).toHaveLength(1);
    expect(rejoinedPlayer.id).not.toBe(leavingPlayer.id);
  });

  it("transfers room ownership to the next player when the host leaves", () => {
    const { manager, room, players } = createStartedRoom();

    expect(manager.leaveRoom(room.code, players[0].id)).toEqual({ ok: true, room });
    expect(room.hostId).toBe(players[1].id);
    expect(room.players[0].isHost).toBe(true);
    expect(room.players.slice(1).some((player) => player.isHost)).toBe(false);
  });

  it("does not remove players from an active game when they try to leave", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);

    expect(manager.leaveRoom(room.code, players[1].id)).toEqual({
      ok: false,
      error: "游戏已经开始，无法离开当前对局。"
    });
    expect(room.players).toHaveLength(5);
  });

  it("deletes an empty lobby after its final player leaves", () => {
    const manager = new RoomManager();
    const { room, player } = manager.createRoom("房主", "socket-0");

    expect(manager.leaveRoom(room.code, player.id)).toEqual({ ok: true, room: null });
    expect(manager.getRoom(room.code)).toBeUndefined();
  });

  it("keeps identities private while assigning useful role information", () => {
    const { manager, room, players } = createStartedRoom();
    expect(manager.startGame(room, players[0])).toEqual({ ok: true });

    for (const player of players) {
      const update = manager.createUpdate(room, player);
      expect(update.publicState.players[0]).not.toHaveProperty("identity");
      expect(update.privateState?.identity).toBeDefined();
    }
    expect(room.identities.size).toBe(players.length);
  });

  it("rejects illegal sabotage and transitions after all team votes", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    const leader = players[room.leaderIndex];
    const team = players.slice(0, 2).map((player) => player.id);
    expect(manager.selectTeam(room, leader, team)).toEqual({ ok: true });

    for (const player of players) manager.voteTeam(room, player, player === players[0]);
    expect(room.phase).toBe("SELECT_TEAM");
    expect(room.failedProposals).toBe(1);

    const nextLeader = players[room.leaderIndex];
    const magicalPlayer = players.find(
      (player) => room.alignments.get(player.id) === "MAGICAL_GIRL"
    );
    expect(magicalPlayer).toBeDefined();
    const illegalTeam = [magicalPlayer!.id, ...players.filter((player) => player.id !== magicalPlayer!.id).slice(0, 1).map((player) => player.id)];
    expect(manager.selectTeam(room, nextLeader, illegalTeam)).toEqual({ ok: true });
    for (const player of players) manager.voteTeam(room, player, true);
    expect(room.phase).toBe("MISSION_ACTION");
    expect(manager.missionAction(room, magicalPlayer!, "FAIL")).toEqual({
      ok: false,
      error: "你的身份不能破坏任务。"
    });
  });

  it("automatically approves the next nomination after three rejected proposals", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const leader = players[room.leaderIndex];
      expect(manager.selectTeam(room, leader, players.slice(0, 2).map((player) => player.id)).ok).toBe(true);
      for (const player of players) manager.voteTeam(room, player, false);
    }

    expect(room.forceTeamApproval).toBe(true);
    const leader = players[room.leaderIndex];
    expect(manager.selectTeam(room, leader, players.slice(0, 2).map((player) => player.id))).toEqual({ ok: true });
    expect(room.phase).toBe("MISSION_ACTION");
    expect(room.forceTeamApproval).toBe(false);
  });

  it.each([3, 4, 5])("opens the invasion phase after a mission in round %i, including a third success", (round) => {
    const { room } = createInvasionRoom(round);
    expect(room.successCount).toBe(3);
    expect(room.phase).toBe("INVASION");
    expect(room.winner).toBeNull();
  });

  it("does not open invasion before the third round", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.round = 2;
    room.successCount = 1;
    const team = players.slice(0, 3);
    expect(manager.selectTeam(room, players[room.leaderIndex], team.map((player) => player.id)).ok).toBe(true);
    for (const player of players) manager.voteTeam(room, player, true);
    for (const player of team) manager.missionAction(room, player, "SUCCESS");
    expect(room.successCount).toBe(2);
    expect(room.phase).toBe("MISSION_RESULT");
  });

  it("lets a Witch invade the possessed and keeps the picker out of public logs", () => {
    const { manager, room, players } = createInvasionRoom();
    expect(manager.invade(room, players[2], players[0].id)).toEqual({ ok: true });
    expect(room.phase).toBe("ENDED");
    expect(room.winner).toBe("WITCH");
    const publicState = manager.createUpdate(room, players[0]).publicState;
    expect(publicState.logs.at(-1)).toContain("侵染命中凭依者");
    expect(publicState.logs.at(-1)).not.toContain(players[2].name);
    expect(publicState).not.toHaveProperty("invasionTarget");
  });

  it("lets a wrong invasion target win for the Magical Girls", () => {
    const { manager, room, players } = createInvasionRoom();
    expect(manager.invade(room, players[2], players[1].id)).toEqual({ ok: true });
    expect(room.phase).toBe("ENDED");
    expect(room.winner).toBe("MAGICAL_GIRL");
    expect(room.logs.at(-1)).toContain("未命中凭依者");
  });

  it("rejects non-Witches and invalid invasion targets without exposing or resolving a choice", () => {
    const { manager, room, players } = createInvasionRoom();
    expect(manager.invade(room, players[0], players[1].id)).toEqual({
      ok: false,
      error: "只有魔女阵营可以执行侵染。"
    });
    expect(manager.invade(room, players[2], "unknown-player")).toEqual({
      ok: false,
      error: "请选择一位有效的玩家作为目标。"
    });
    expect(room.phase).toBe("INVASION");
    expect(room.winner).toBeNull();
  });

  it("keeps the three-failure Witch victory ahead of invasion", () => {
    const { manager, room, players } = createInvasionRoom();
    room.phase = "MISSION_ACTION";
    room.failCount = 2;
    room.currentTeam = [players[0].id, players[2].id];
    room.missionActions.clear();
    manager.missionAction(room, players[0], "SUCCESS");
    manager.missionAction(room, players[2], "FAIL");
    expect(room.phase).toBe("ENDED");
    expect(room.winner).toBe("WITCH");
  });

  it("elects only from non-candidates and advances the winner to the magic phase", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.round = 3;
    room.phase = "MAGIC_CANDIDACY";
    for (const player of players) {
      expect(manager.declareMagicCandidacy(room, player, player === players[0])).toEqual({ ok: true });
    }
    expect(room.phase).toBe("MAGIC_VOTE");
    expect(manager.createUpdate(room, players[0]).publicState.magicTiedVote).toBe(false);
    expect(manager.voteMagic(room, players[0], players[0].id)).toEqual({
      ok: false,
      error: "竞选者不能参与本轮投票。"
    });
    for (const [index, player] of players.slice(1).entries()) {
      manager.voteMagic(room, player, index < 2 ? players[0].id : players[0].id);
    }
    expect(room.phase).toBe("MAGIC_USE");
    expect(room.magicUserId).toBe(players[0].id);
  });

  it("re-votes among only the tied candidates", () => {
    const manager = new RoomManager();
    const { room, player: host } = manager.createRoom("房主", "socket-0");
    const players = [host];
    for (let index = 1; index < 6; index += 1) {
      players.push(manager.joinRoom(room.code, `玩家${index}`, `socket-${index}`).player);
    }
    manager.startGame(room, players[0]);
    room.round = 3;
    room.phase = "MAGIC_CANDIDACY";
    for (const player of players) {
      expect(manager.declareMagicCandidacy(room, player, player === players[0] || player === players[1]).ok).toBe(true);
    }
    for (const [index, player] of players.slice(2).entries()) {
      manager.voteMagic(room, player, index < 2 ? players[0].id : players[1].id);
    }
    expect(room.phase).toBe("MAGIC_VOTE");
    expect(room.magicCandidates).toEqual([players[0].id, players[1].id]);
    expect(room.magicElectorate).toEqual([players[0].id, players[1].id]);
    expect(manager.createUpdate(room, players[0]).publicState.magicTiedVote).toBe(true);
    manager.voteMagic(room, players[0], players[1].id);
    manager.voteMagic(room, players[1], players[1].id);
    expect(room.phase).toBe("MAGIC_USE");
    expect(room.magicUserId).toBe(players[1].id);
  });

  it("skips the election when nobody declares candidacy", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.round = 3;
    room.phase = "MAGIC_CANDIDACY";
    for (const player of players) manager.declareMagicCandidacy(room, player, false);
    expect(room.phase).toBe("SELECT_TEAM");
    expect(room.magicElectionDone).toBe(true);
  });

  it("keeps Noah's real sabotage targets private to the magic winner", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "noah");
    players[0].characterId = "noah";
    room.alignments.set(players[0].id, "MAGICAL_GIRL");
    room.magicUserId = players[0].id;
    room.magicAbilityUsed = true;
    room.magicResolutionResolved = false;
    room.round = 3;
    room.currentTeam = [players[0].id, players[1].id];
    room.phase = "MISSION_ACTION";
    room.alignments.set(players[1].id, "WITCH");
    room.identities.set(players[1].id, getIdentity("halfWitch"));
    room.missionActions.set(players[1].id, ["FAIL"]);
    expect(manager.missionAction(room, players[0], "SUCCESS")).toEqual({ ok: true });
    const winnerUpdate = manager.createUpdate(room, players[0]);
    const otherUpdate = manager.createUpdate(room, players[2]);
    expect(winnerUpdate.publicState.phase).toBe("MAGIC_RESOLUTION");
    expect(winnerUpdate.privateState?.magic.magicTargets).toEqual([players[1].id]);
    expect(otherUpdate.privateState?.magic.magicTargets).toEqual([]);
  });

  it("lets Reia remove anonymous shuffled decisions without exposing their owners", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "reia");
    players[0].characterId = "reia";
    room.alignments.set(players[0].id, "MAGICAL_GIRL");
    room.magicUserId = players[0].id;
    room.magicAbilityUsed = true;
    room.round = 3;
    room.currentTeam = [players[1].id, players[2].id];
    room.alignments.set(players[1].id, "MAGICAL_GIRL");
    room.alignments.set(players[2].id, "WITCH");
    room.identities.set(players[2].id, getIdentity("halfWitch"));
    room.phase = "MISSION_ACTION";
    room.missionActions.clear();
    manager.missionAction(room, players[1], "SUCCESS");
    expect(manager.missionAction(room, players[2], "FAIL")).toEqual({ ok: true });
    expect(room.phase).toBe("MAGIC_RESOLUTION");
    const preview = manager.createUpdate(room, players[0]).privateState?.magic.decisionPreview;
    expect(preview).toHaveLength(2);
    expect(preview?.every((decision) => !("playerName" in decision))).toBe(true);
    const failIndex = room.shuffledMissionDecisions!.findIndex(({ action }) => action === "FAIL");
    expect(manager.resolveMagic(room, players[0], { type: "REIA_DECISIONS", removedDecisionIndexes: [failIndex] })).toEqual({ ok: true });
    expect(room.phase).toBe("INVASION");
    expect(room.successCount).toBe(1);
  });

  it("requires Milia's invasion swap to include herself and uses the swapped identity for the guess", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "milia");
    room.alignments.set(players[0].id, "WITCH");
    room.identities.set(players[0].id, getIdentity("goodWitch"));
    room.identities.set(players[1].id, getIdentity("possessed"));
    room.magicUserId = players[0].id;
    room.magicAbilityUsed = false;
    room.phase = "INVASION_MAGIC";
    expect(manager.useMagic(room, players[0], {
      type: "SWAP_IDENTITIES",
      firstId: players[1].id,
      secondId: players[2].id
    })).toEqual({ ok: false, error: "佐伯米莉亚只能与自己交换身份。" });
    expect(manager.useMagic(room, players[0], {
      type: "SWAP_IDENTITIES",
      firstId: players[0].id,
      secondId: players[1].id
    })).toEqual({ ok: true });
    expect(room.identities.get(players[0].id)?.id).toBe("possessed");
    const swappedState = manager.createUpdate(room, players[0]).privateState;
    expect(swappedState?.alignment).toBe("WITCH");
    expect(swappedState?.identity.camp).toBe("MAGICAL_GIRL");
    room.alignments.set(players[2].id, "WITCH");
    expect(manager.invade(room, players[2], players[0].id)).toEqual({ ok: true });
    expect(room.winner).toBe("WITCH");
  });

  it("enforces Emma's third-round restriction on witch sabotage", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "emma");
    room.alignments.set(players[0].id, "MAGICAL_GIRL");
    room.magicUserId = players[0].id;
    room.phase = "MAGIC_USE";
    expect(manager.useMagic(room, players[0], {
      type: "SET_MISSION_EFFECT",
      effect: "BLOCK_WITCH_FAIL"
    })).toEqual({ ok: true });
    room.round = 3;
    room.phase = "MISSION_ACTION";
    room.currentTeam = [players[1].id];
    room.alignments.set(players[1].id, "WITCH");
    room.identities.set(players[1].id, getIdentity("halfWitch"));
    expect(manager.missionAction(room, players[1], "FAIL")).toEqual({
      ok: false,
      error: "第三轮魔女只能选择破解。"
    });
  });

  it("keeps the Witch's sabotage option after Maga exchanges a Witch and Magical Girl identity", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "maga");
    players[0].characterId = "maga";
    room.alignments.set(players[0].id, "WITCH");
    room.alignments.set(players[1].id, "MAGICAL_GIRL");
    room.identities.set(players[0].id, getIdentity("halfWitch"));
    room.identities.set(players[1].id, getIdentity("magicalGirl"));
    room.magicUserId = players[0].id;
    room.phase = "MAGIC_USE";
    expect(manager.useMagic(room, players[0], {
      type: "SWAP_IDENTITIES",
      firstId: players[0].id,
      secondId: players[1].id
    })).toEqual({ ok: true });
    expect(room.identities.get(players[0].id)?.canSabotage).toBe(false);
    room.round = 3;
    room.phase = "MISSION_ACTION";
    room.currentTeam = [players[0].id];
    expect(manager.missionAction(room, players[0], "FAIL")).toEqual({ ok: true });
  });

  it("changes Shirley's private second-round outcome without rewriting the public record", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "shirley");
    room.alignments.set(players[0].id, "MAGICAL_GIRL");
    room.magicUserId = players[0].id;
    room.phase = "MAGIC_USE";
    room.round = 3;
    room.successCount = 1;
    room.failCount = 1;
    room.publicSuccessCount = 1;
    room.publicFailCount = 1;
    room.lastMissionResult = { succeeded: false, failActions: 1 };
    expect(manager.useMagic(room, players[0], {
      type: "CHANGE_ROUND_TWO_RESULT",
      succeeded: false
    })).toEqual({ ok: true });
    expect(room.successCount).toBe(2);
    expect(room.failCount).toBe(0);
    expect(manager.createUpdate(room, players[0]).privateState?.magic.magicResult).toContain("破解");
    expect(manager.createUpdate(room, players[1]).publicState.lastMissionResult).toEqual({
      succeeded: false,
      failActions: 1
    });
    expect(room.logs.at(-1)).not.toContain("改写");
  });

  it("lets Anna review named decisions and change one specific task action", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "anna");
    room.alignments.set(players[0].id, "MAGICAL_GIRL");
    room.magicUserId = players[0].id;
    room.magicAbilityUsed = true;
    room.round = 3;
    room.phase = "MISSION_ACTION";
    room.currentTeam = [players[1].id, players[2].id];
    room.missionActions.set(players[1].id, ["SUCCESS", "FAIL"]);
    manager.missionAction(room, players[2], "SUCCESS");
    expect(room.phase).toBe("MAGIC_RESOLUTION");
    const preview = manager.createUpdate(room, players[0]).privateState?.magic.decisionPreview;
    expect(preview?.find((decision) => decision.action === "FAIL")?.playerName).toBe(players[1].name);
    expect(manager.resolveMagic(room, players[0], {
      type: "MISSION_OVERRIDE",
      targetId: players[1].id,
      actionIndex: 1,
      replacement: "SUCCESS"
    })).toEqual({ ok: true });
    expect(room.phase).toBe("INVASION");
    expect(room.successCount).toBe(1);
  });

  it("requires Witch Anna's identity to permit sabotage when replacing a decision with failure", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "anna");
    room.alignments.set(players[0].id, "WITCH");
    room.identities.set(players[0].id, getIdentity("goodWitch"));
    room.magicUserId = players[0].id;
    room.magicAbilityUsed = true;
    room.round = 3;
    room.phase = "MAGIC_RESOLUTION";
    room.currentTeam = [players[1].id];
    room.missionActions.set(players[1].id, ["SUCCESS"]);
    expect(manager.resolveMagic(room, players[0], {
      type: "MISSION_OVERRIDE",
      targetId: players[1].id,
      replacement: "FAIL"
    })).toEqual({ ok: false, error: "你的身份不能提交破坏决定。" });
    room.identities.set(players[0].id, getIdentity("halfWitch"));
    expect(manager.resolveMagic(room, players[0], {
      type: "MISSION_OVERRIDE",
      targetId: players[1].id,
      replacement: "FAIL"
    })).toEqual({ ok: true });
    expect(room.failCount).toBe(1);
  });

  it("counts Hanna as two team members while keeping the required team size correct", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "hanna");
    players[0].characterId = "hanna";
    room.magicUserId = players[0].id;
    room.magicAbilityUsed = true;
    room.magicEffect.extraActionCount = 1;
    room.round = 3;
    room.leaderIndex = 0;
    expect(manager.selectTeam(room, players[0], [players[0].id])).toEqual({ ok: true });
    for (const player of players) manager.voteTeam(room, player, true);
    expect(manager.missionAction(room, players[0], ["SUCCESS", "SUCCESS"])).toEqual({ ok: true });
    expect(room.successCount).toBe(1);
    expect(room.phase).toBe("INVASION");
  });

  it("rejects a malformed team payload without throwing", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.leaderIndex = 0;
    expect(manager.selectTeam(room, players[0], null as unknown as string[])).toEqual({
      ok: false,
      error: "队伍名单无效。"
    });
  });

  it("keeps the original identity clue stable after identity cards are exchanged", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    const originalClue = room.privateMessages.get(players[0].id);
    room.identities.set(players[0].id, getIdentity("witch"));
    const update = manager.createUpdate(room, players[0]);
    expect(update.privateState?.identity.id).toBe("witch");
    expect(update.privateState?.privateMessage).toBe(originalClue);
  });

  it("keeps Coco's pre-shuffle decision selection private and limited to two players", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "coco");
    players[0].characterId = "coco";
    room.alignments.set(players[0].id, "MAGICAL_GIRL");
    room.magicUserId = players[0].id;
    room.magicAbilityUsed = true;
    room.round = 3;
    room.phase = "MISSION_ACTION";
    room.currentTeam = [players[1].id, players[2].id];
    room.identities.set(players[2].id, getIdentity("halfWitch"));
    room.alignments.set(players[1].id, "MAGICAL_GIRL");
    room.alignments.set(players[2].id, "WITCH");
    room.missionActions.set(players[1].id, ["SUCCESS"]);
    expect(manager.missionAction(room, players[2], "FAIL")).toEqual({ ok: true });

    const winnerUpdate = manager.createUpdate(room, players[0]);
    const otherUpdate = manager.createUpdate(room, players[3]);
    expect(winnerUpdate.publicState.phase).toBe("MAGIC_RESOLUTION");
    expect(winnerUpdate.privateState?.magic.decisionPreview).toEqual([
      { index: 0, playerId: players[1].id, playerName: players[1].name },
      { index: 1, playerId: players[2].id, playerName: players[2].name }
    ]);
    expect(otherUpdate.privateState?.magic.decisionPreview).toEqual([]);
    expect(manager.resolveMagic(room, players[0], {
      type: "PEEK_DECISIONS",
      targetIds: [players[1].id, players[2].id, players[3].id]
    }).ok).toBe(false);
    expect(manager.resolveMagic(room, players[0], {
      type: "PEEK_DECISIONS",
      targetIds: [players[2].id]
    })).toEqual({ ok: true });
    expect(manager.createUpdate(room, players[0]).privateState?.magic.magicResult).toContain(`${players[2].name}：破坏`);
    expect(manager.createUpdate(room, players[3]).privateState?.magic.magicResult).toBeNull();
    const publicShuffleLog = room.logs.find((log) => log.includes("洗混后的任务决定"));
    expect(publicShuffleLog).toBeDefined();
    expect(publicShuffleLog).not.toContain(players[2].name);
  });

  it("lets Witch Coco replace one anonymous decision without exposing its owner or value", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "coco");
    players[0].characterId = "coco";
    room.alignments.set(players[0].id, "WITCH");
    room.identities.set(players[0].id, getIdentity("halfWitch"));
    room.magicUserId = players[0].id;
    room.magicAbilityUsed = true;
    room.round = 3;
    room.phase = "MISSION_ACTION";
    room.currentTeam = [players[1].id, players[2].id];
    room.alignments.set(players[1].id, "MAGICAL_GIRL");
    room.alignments.set(players[2].id, "MAGICAL_GIRL");
    room.missionActions.set(players[1].id, ["SUCCESS"]);
    expect(manager.missionAction(room, players[2], "SUCCESS")).toEqual({ ok: true });

    const preview = manager.createUpdate(room, players[0]).privateState?.magic.decisionPreview;
    expect(preview).toEqual([{ index: 0 }, { index: 1 }]);
    const targetDecision = room.shuffledMissionDecisions![0];
    expect(manager.resolveMagic(room, players[0], {
      type: "COCO_REPLACE_DECISION",
      decisionIndex: 0,
      replacement: "FAIL"
    })).toEqual({ ok: true });
    expect(room.missionActions.get(targetDecision.playerId)?.[targetDecision.actionIndex]).toBe("FAIL");
  });

  it("stores Meruru's true investigation result privately even when a Witch lies publicly", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "meruru");
    players[0].characterId = "meruru";
    room.alignments.set(players[0].id, "WITCH");
    room.alignments.set(players[1].id, "MAGICAL_GIRL");
    room.magicUserId = players[0].id;
    room.phase = "MAGIC_USE";
    expect(manager.useMagic(room, players[0], {
      type: "INVESTIGATE_CAMP",
      targetId: players[1].id,
      claimSame: true
    })).toEqual({ ok: true });
    expect(manager.createUpdate(room, players[0]).privateState?.magic.magicResult).toContain("不同");
    expect(room.logs.at(-1)).toContain("相同");
  });

  it("does not reveal Noah's hidden third-round result through end-game score totals", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "noah");
    room.alignments.set(players[0].id, "MAGICAL_GIRL");
    room.magicUserId = players[0].id;
    room.magicAbilityUsed = true;
    room.magicEffect.hiddenMissionResult = true;
    room.magicEffect.revealActualSaboteur = true;
    room.round = 3;
    room.phase = "MISSION_ACTION";
    room.currentTeam = [players[1].id, players[2].id];
    room.failCount = 2;
    room.successCount = 1;
    room.publicSuccessCount = 1;
    room.publicFailCount = 0;
    room.identities.set(players[2].id, getIdentity("halfWitch"));
    room.alignments.set(players[1].id, "MAGICAL_GIRL");
    room.alignments.set(players[2].id, "WITCH");
    room.missionActions.set(players[1].id, ["SUCCESS"]);
    expect(manager.missionAction(room, players[2], "FAIL")).toEqual({ ok: true });
    expect(room.phase).toBe("MAGIC_RESOLUTION");
    expect(manager.resolveMagic(room, players[0], {
      type: "ANNOUNCE_SABOTEUR",
      targetId: players[2].id
    })).toEqual({ ok: true });
    expect(room.phase).toBe("ENDED");
    const publicState = manager.createUpdate(room, players[1]).publicState;
    expect(publicState.lastMissionResult).toBeNull();
    expect(publicState.successCount).toBe(1);
    expect(publicState.failCount).toBe(0);
    expect(publicState.winner).toBe("WITCH");
  });

  it("does not let Magical Girl Maga grant extra sabotage permission to Witches", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "maga");
    players[0].characterId = "maga";
    room.alignments.set(players[0].id, "MAGICAL_GIRL");
    room.identities.set(players[0].id, getIdentity("magicalGirl"));
    room.alignments.set(players[1].id, "WITCH");
    room.identities.set(players[1].id, getIdentity("goodWitch"));
    room.magicUserId = players[0].id;
    room.phase = "MAGIC_USE";
    expect(manager.useMagic(room, players[0], {
      type: "SWAP_IDENTITIES",
      firstId: players[0].id,
      secondId: players[1].id
    })).toEqual({ ok: true });
    room.round = 3;
    room.phase = "MISSION_ACTION";
    room.currentTeam = [players[1].id];
    expect(manager.missionAction(room, players[1], "FAIL")).toEqual({
      ok: false,
      error: "你的身份不能破坏任务。"
    });
  });

  it("prevents Witch Reia from inserting a sabotage decision when her identity cannot sabotage", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "reia");
    room.alignments.set(players[0].id, "WITCH");
    room.identities.set(players[0].id, getIdentity("goodWitch"));
    room.magicUserId = players[0].id;
    room.magicAbilityUsed = true;
    room.round = 3;
    room.phase = "MISSION_ACTION";
    room.currentTeam = [players[1].id, players[2].id];
    room.alignments.set(players[1].id, "MAGICAL_GIRL");
    room.alignments.set(players[2].id, "MAGICAL_GIRL");
    room.missionActions.set(players[1].id, ["SUCCESS"]);
    expect(manager.missionAction(room, players[2], "SUCCESS")).toEqual({ ok: true });
    expect(room.phase).toBe("MAGIC_RESOLUTION");
    expect(manager.resolveMagic(room, players[0], {
      type: "REIA_DECISIONS",
      removedDecisionIndexes: [0, 1],
      ownAction: "FAIL"
    })).toEqual({ ok: false, error: "你的身份不能提交破坏决定。" });
  });

  it("lets Witch Emma publicly reveal herself and convert a qualifying third-round success", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "emma");
    room.alignments.set(players[0].id, "WITCH");
    room.magicUserId = players[0].id;
    room.magicAbilityUsed = true;
    room.magicEffect.emmaWitchArmed = true;
    room.round = 3;
    room.successCount = 2;
    room.phase = "MISSION_ACTION";
    room.currentTeam = [players[1].id, players[2].id];
    room.missionActions.set(players[1].id, ["SUCCESS"]);
    expect(manager.missionAction(room, players[2], "SUCCESS")).toEqual({ ok: true });
    expect(room.phase).toBe("MAGIC_RESOLUTION");
    expect(manager.resolveMagic(room, players[0], { type: "DECLARE_EMMA_WITCH" })).toEqual({ ok: true });
    expect(room.failCount).toBe(1);
    expect(room.lastMissionResult?.succeeded).toBe(false);
    expect(room.logs.find((log) => log.includes("公布了自己的魔女身份"))).toContain(players[0].name);
  });

  it("lets Witch Hiro choose and publicly announce the replacement second-round result", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "hiro");
    room.alignments.set(players[0].id, "WITCH");
    room.magicUserId = players[0].id;
    room.phase = "MAGIC_USE";
    room.round = 3;
    room.successCount = 1;
    room.failCount = 1;
    room.publicSuccessCount = 1;
    room.publicFailCount = 1;
    room.lastMissionResult = { succeeded: false, failActions: 1 };
    expect(manager.useMagic(room, players[0], {
      type: "CHANGE_ROUND_TWO_RESULT",
      succeeded: true
    })).toEqual({ ok: true });
    expect(room.successCount).toBe(2);
    expect(room.failCount).toBe(0);
    expect(room.publicSuccessCount).toBe(2);
    expect(room.publicFailCount).toBe(0);
    expect(manager.createUpdate(room, players[1]).publicState.lastMissionResult).toEqual({
      succeeded: true,
      failActions: 0
    });
    expect(room.logs.find((log) => log.includes("第二轮结果为破解"))).toBeDefined();
  });

  it("replays the second round for Magical Girl Hiro and privately reveals only the replay result", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "hiro");
    room.alignments.set(players[0].id, "MAGICAL_GIRL");
    room.magicUserId = players[0].id;
    room.phase = "MAGIC_USE";
    room.round = 3;
    room.successCount = 1;
    room.failCount = 1;
    room.publicSuccessCount = 1;
    room.publicFailCount = 1;
    room.lastMissionResult = { succeeded: false, failActions: 1 };
    expect(manager.useMagic(room, players[0], { type: "REPLAY_ROUND_TWO" })).toEqual({ ok: true });
    expect(room.round).toBe(2);
    expect(room.phase).toBe("SELECT_TEAM");
    expect(room.failCount).toBe(0);
    room.phase = "MISSION_ACTION";
    room.currentTeam = [players[1].id];
    expect(manager.missionAction(room, players[1], "SUCCESS")).toEqual({ ok: true });
    expect(room.lastMissionResult?.succeeded).toBe(true);
    expect(room.hideLastMissionResult).toBe(true);
    expect(manager.createUpdate(room, players[0]).privateState?.magic.magicResult).toContain("重开的第二轮结果：破解成功");
    expect(manager.createUpdate(room, players[1]).publicState.lastMissionResult).toBeNull();
    expect(manager.createUpdate(room, players[1]).publicState.successCount).toBe(1);
    expect(manager.createUpdate(room, players[1]).publicState.failCount).toBe(1);
  });

  it("blocks the chosen invasion window for Magical Girl Arisa but not Witch Arisa", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "arisa");
    room.magicUserId = players[0].id;
    room.round = 3;
    room.phase = "MAGIC_USE";
    room.alignments.set(players[0].id, "MAGICAL_GIRL");
    expect(manager.useMagic(room, players[0], {
      type: "SET_INVASION_BLOCK",
      round: 3
    })).toEqual({ ok: true });
    room.phase = "MISSION_ACTION";
    room.currentTeam = [players[1].id, players[2].id];
    room.missionActions.set(players[1].id, ["SUCCESS"]);
    expect(manager.missionAction(room, players[2], "SUCCESS")).toEqual({ ok: true });
    expect(room.phase).toBe("MISSION_RESULT");

    const otherGame = createStartedRoom();
    otherGame.manager.startGame(otherGame.room, otherGame.players[0]);
    otherGame.room.characters.set(otherGame.players[0].id, "arisa");
    otherGame.room.magicUserId = otherGame.players[0].id;
    otherGame.room.round = 3;
    otherGame.room.phase = "MAGIC_USE";
    otherGame.room.alignments.set(otherGame.players[0].id, "WITCH");
    expect(otherGame.manager.useMagic(otherGame.room, otherGame.players[0], {
      type: "SET_INVASION_BLOCK",
      round: 3
    })).toEqual({ ok: true });
    expect(otherGame.room.magicEffect.invasionBlockedRound).toBeNull();
  });

  it("lets Witch Naya privately see the true identity while publicly claiming a false one", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "naya");
    room.alignments.set(players[0].id, "WITCH");
    room.identities.set(players[1].id, getIdentity("detective"));
    room.magicUserId = players[0].id;
    room.phase = "MAGIC_USE";
    expect(manager.useMagic(room, players[0], {
      type: "INVESTIGATE_IDENTITY",
      targetId: players[1].id,
      reveal: true,
      claimIdentityId: "possessed"
    })).toEqual({ ok: true });
    expect(manager.createUpdate(room, players[0]).privateState?.magic.magicResult).toContain("大侦探");
    expect(room.logs.at(-1)).toContain("凭依者");
    expect(room.logs.at(-1)).not.toContain("大侦探");
  });

  it("lets Witch Noah accuse a non-saboteur while keeping the action owner hidden", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "noah");
    room.alignments.set(players[0].id, "WITCH");
    room.magicUserId = players[0].id;
    room.magicAbilityUsed = true;
    room.round = 3;
    room.phase = "MISSION_ACTION";
    room.currentTeam = [players[1].id, players[2].id];
    room.alignments.set(players[1].id, "MAGICAL_GIRL");
    room.alignments.set(players[2].id, "WITCH");
    room.identities.set(players[2].id, getIdentity("halfWitch"));
    room.missionActions.set(players[1].id, ["SUCCESS"]);
    expect(manager.missionAction(room, players[2], "FAIL")).toEqual({ ok: true });
    expect(manager.createUpdate(room, players[0]).privateState?.magic.magicTargets).toContain(players[1].id);
    expect(manager.resolveMagic(room, players[0], {
      type: "ANNOUNCE_SABOTEUR",
      targetId: players[1].id
    })).toEqual({ ok: true });
    const accusationLog = room.logs.find((log) => log.includes("是破坏者"));
    expect(accusationLog).toContain(`${players[0].name} 公布${players[1].name}`);
    expect(accusationLog).not.toContain(players[2].name);
  });

  it("allows Hanna Witch to submit two actions including sabotage", () => {
    const { manager, room, players } = createStartedRoom();
    manager.startGame(room, players[0]);
    room.characters.set(players[0].id, "hanna");
    room.alignments.set(players[0].id, "WITCH");
    room.identities.set(players[0].id, getIdentity("goodWitch"));
    room.magicUserId = players[0].id;
    room.magicAbilityUsed = true;
    room.magicEffect.extraActionCount = 1;
    room.round = 3;
    room.phase = "MISSION_ACTION";
    room.currentTeam = [players[0].id];
    expect(manager.missionAction(room, players[0], ["SUCCESS", "FAIL"])).toEqual({ ok: true });
    expect(room.failCount).toBe(1);
    expect(room.phase).toBe("INVASION");
  });
});
