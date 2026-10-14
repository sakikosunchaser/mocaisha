import { randomInt, randomUUID } from "node:crypto";
import type {
  Camp,
  CharacterId,
  GamePhase,
  Identity,
  IdentityId,
  MagicAction,
  MissionAction,
  MissionResult,
  PrivateGameState,
  PublicGameState,
  PublicPlayer
} from "../shared/game.js";
import {
  assignIdentities,
  assignCharacters,
  getPrivateMessage,
  getRequiredFails,
  getIdentity,
  getTeamSize,
  MAX_PLAYERS,
  MAX_ROUNDS,
  MIN_PLAYERS,
  shuffle
} from "../shared/rules.js";
import { getCharacter } from "../shared/characters.js";

interface PlayerRecord extends PublicPlayer {
  socketId: string;
}

interface GameRoom {
  code: string;
  players: PlayerRecord[];
  hostId: string;
  phase: GamePhase;
  identities: Map<string, Identity>;
  privateMessages: Map<string, string>;
  alignments: Map<string, Camp>;
  characters: Map<string, CharacterId>;
  round: number;
  leaderIndex: number;
  successCount: number;
  failCount: number;
  publicSuccessCount: number;
  publicFailCount: number;
  currentTeam: string[];
  teamVotes: Map<string, boolean>;
  lastTeamVotes: Map<string, boolean>;
  missionActions: Map<string, MissionAction[]>;
  failedProposals: number;
  forceTeamApproval: boolean;
  lastMissionResult: MissionResult | null;
  hideLastMissionResult: boolean;
  winner: Camp | null;
  logs: string[];
  candidacyVotes: Map<string, boolean>;
  magicCandidates: string[];
  magicElectorate: string[];
  magicVotes: Map<string, string | null>;
  magicRunoff: boolean;
  magicUserId: string | null;
  magicAbilityUsed: boolean;
  magicElectionDone: boolean;
  magicResultByPlayer: Map<string, string>;
  magicEffect: {
    blockWitchFailRound3: boolean;
    invasionBlockedRound: number | null;
    hiddenMissionResult: boolean;
    revealActualSaboteur: boolean;
    extraActionCount: number;
    hannaWitchSabotage: boolean;
    reiaOwnAction: MissionAction | null;
    emmaWitchArmed: boolean;
  };
  shuffledMissionDecisions: Array<{ playerId: string; actionIndex: number; action: MissionAction }> | null;
  reiaReducedTeamRound: number | null;
  replayRoundTwoBy: string | null;
  magicResolutionResolved: boolean;
  emmaWitchDeclared: boolean;
}

type Result = { ok: true } | { ok: false; error: string };
const IDENTITY_IDS = new Set<IdentityId>([
  "possessed", "detective", "halfWitch", "goodWitch", "magicalGirl", "witch"
]);

export interface RoomUpdate {
  publicState: PublicGameState;
  privateState: PrivateGameState | null;
}

export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();

  createRoom(name: string, socketId: string): { room: GameRoom; player: PlayerRecord } {
    const code = this.createCode();
    const player = this.createPlayer(name, 0, socketId, true);
    const room: GameRoom = {
      code,
      players: [player],
      hostId: player.id,
      phase: "LOBBY",
      identities: new Map(),
      privateMessages: new Map(),
      alignments: new Map(),
      characters: new Map(),
      round: 0,
      leaderIndex: 0,
      successCount: 0,
      failCount: 0,
      publicSuccessCount: 0,
      publicFailCount: 0,
      currentTeam: [],
      teamVotes: new Map(),
      lastTeamVotes: new Map(),
      missionActions: new Map(),
      failedProposals: 0,
      forceTeamApproval: false,
      lastMissionResult: null,
      hideLastMissionResult: false,
      winner: null,
      logs: ["房间已创建，等待玩家加入。"],
      candidacyVotes: new Map(),
      magicCandidates: [],
      magicElectorate: [],
      magicVotes: new Map(),
      magicRunoff: false,
      magicUserId: null,
      magicAbilityUsed: false,
      magicElectionDone: false,
      magicResultByPlayer: new Map(),
      magicEffect: {
        blockWitchFailRound3: false,
        invasionBlockedRound: null,
        hiddenMissionResult: false,
        revealActualSaboteur: false,
        extraActionCount: 0,
        hannaWitchSabotage: false,
        reiaOwnAction: null,
        emmaWitchArmed: false
      },
      shuffledMissionDecisions: null,
      reiaReducedTeamRound: null,
      replayRoundTwoBy: null,
      magicResolutionResolved: false,
      emmaWitchDeclared: false
    };
    this.rooms.set(code, room);
    return { room, player };
  }

  joinRoom(code: string, name: string, socketId: string): { room: GameRoom; player: PlayerRecord } {
    const room = this.rooms.get(code);
    if (!room) throw new Error("没有找到这个房间，请检查房间码。");
    if (room.phase !== "LOBBY") throw new Error("游戏已经开始，无法加入。");
    if (room.players.length >= MAX_PLAYERS) throw new Error(`房间最多容纳 ${MAX_PLAYERS} 位玩家。`);

    const player = this.createPlayer(name, room.players.length, socketId, false);
    room.players.push(player);
    this.addLog(room, `${player.name} 加入了房间。`);
    return { room, player };
  }

  reconnect(code: string, playerId: string, socketId: string): { room: GameRoom; player: PlayerRecord } {
    const room = this.rooms.get(code);
    const player = room?.players.find((entry) => entry.id === playerId);
    if (!room || !player) throw new Error("房间或玩家信息已失效，请重新加入房间。");
    player.socketId = socketId;
    player.connected = true;
    return { room, player };
  }

  getRoom(code: string): GameRoom | undefined {
    return this.rooms.get(code);
  }

  leaveRoom(roomCode: string | undefined, playerId: string | undefined):
    | { ok: true; room: GameRoom | null }
    | { ok: false; error: string } {
    if (!roomCode || !playerId) return { ok: false, error: "你当前不在房间中。" };
    const room = this.rooms.get(roomCode);
    const playerIndex = room?.players.findIndex((entry) => entry.id === playerId) ?? -1;
    if (!room || playerIndex < 0) return { ok: false, error: "房间或玩家信息已失效。" };
    if (room.phase !== "LOBBY") {
      return { ok: false, error: "游戏已经开始，无法离开当前对局。" };
    }

    const [player] = room.players.splice(playerIndex, 1);
    this.addLog(room, `${player.name} 离开了房间。`);
    if (room.players.length === 0) {
      this.rooms.delete(roomCode);
      return { ok: true, room: null };
    }

    room.players.forEach((entry, index) => {
      entry.seatIndex = index;
      entry.isHost = entry.id === room.hostId;
    });
    if (room.hostId === playerId) {
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
      this.addLog(room, `${room.players[0].name} 成为新房主。`);
    }
    return { ok: true, room };
  }

  disconnect(roomCode: string | undefined, playerId: string | undefined): GameRoom | undefined {
    if (!roomCode || !playerId) return undefined;
    const room = this.rooms.get(roomCode);
    const player = room?.players.find((entry) => entry.id === playerId);
    if (!room || !player) return undefined;
    player.connected = false;
    return room;
  }

  startGame(room: GameRoom, player: PlayerRecord): Result {
    if (player.id !== room.hostId) return this.reject("只有房主可以开始游戏。");
    if (room.phase !== "LOBBY") return this.reject("游戏已经开始。");
    if (room.players.length < MIN_PLAYERS) {
      return this.reject(`至少需要 ${MIN_PLAYERS} 位玩家才能开始。`);
    }
    if (room.players.length > MAX_PLAYERS) {
      return this.reject(`最多支持 ${MAX_PLAYERS} 位玩家。`);
    }

    const identities = assignIdentities(
      room.players.length,
      () => randomInt(0, 2 ** 32) / 2 ** 32
    );
    room.identities = new Map(
      room.players.map((entry, index) => [entry.id, identities[index]])
    );
    room.privateMessages = new Map(
      room.players.map((entry) => [
        entry.id,
        getPrivateMessage(
          room.identities.get(entry.id)!,
          entry.id,
          room.players.map(({ id, name }) => ({ id, name })),
          room.identities
        )
      ])
    );
    room.alignments = new Map(
      room.players.map((entry, index) => [entry.id, identities[index].camp])
    );
    const characters = assignCharacters(room.players.length, () => randomInt(0, 2 ** 32) / 2 ** 32);
    room.characters = new Map(room.players.map((entry, index) => [entry.id, characters[index]]));
    room.players.forEach((entry) => {
      entry.characterId = room.characters.get(entry.id) ?? null;
    });
    room.round = 1;
    room.leaderIndex = randomInt(room.players.length);
    room.phase = "SELECT_TEAM";
    this.addLog(room, "身份已秘密分配，游戏开始。");
    this.addLog(room, `${room.players[room.leaderIndex].name} 成为第 1 轮领袖。`);
    return { ok: true };
  }

  selectTeam(room: GameRoom, player: PlayerRecord, playerIds: string[]): Result {
    if (room.phase !== "SELECT_TEAM") return this.reject("当前不是提名队伍阶段。");
    if (room.players[room.leaderIndex]?.id !== player.id) {
      return this.reject("只有当前领袖可以选择队伍。");
    }
    if (!Array.isArray(playerIds)) return this.reject("队伍名单无效。");
    const requiredSize = this.getRequiredTeamSize(room, playerIds);
    if (playerIds.length !== requiredSize) {
      return this.reject(`本轮必须选择 ${requiredSize} 位队员。`);
    }
    if (new Set(playerIds).size !== playerIds.length) {
      return this.reject("队伍中不能重复选择同一位玩家。");
    }
    if (playerIds.some((id) => !room.players.some((entry) => entry.id === id))) {
      return this.reject("队伍包含不存在的玩家。");
    }

    room.currentTeam = [...playerIds];
    room.teamVotes.clear();
    room.lastTeamVotes.clear();
    room.missionActions.clear();
    room.shuffledMissionDecisions = null;
    room.lastMissionResult = null;
    const teamNames = playerIds.map((id) => room.players.find((entry) => entry.id === id)!.name);
    this.addLog(room, `${player.name} 提名了任务队伍：${teamNames.join("、")}。`);

    if (room.forceTeamApproval) {
      room.forceTeamApproval = false;
      room.failedProposals = 0;
      room.phase = "MISSION_ACTION";
      this.addLog(room, "连续三次提名未通过，本次队伍自动通过。");
    } else {
      room.phase = "TEAM_VOTE";
    }
    return { ok: true };
  }

  voteTeam(room: GameRoom, player: PlayerRecord, approve: boolean): Result {
    if (room.phase !== "TEAM_VOTE") return this.reject("当前不是队伍投票阶段。");
    if (room.teamVotes.has(player.id)) return this.reject("你已经投过票了。");
    if (typeof approve !== "boolean") return this.reject("投票内容无效。");
    room.teamVotes.set(player.id, approve);
    if (room.teamVotes.size === room.players.length) this.resolveTeamVote(room);
    return { ok: true };
  }

  missionAction(room: GameRoom, player: PlayerRecord, action: MissionAction | MissionAction[]): Result {
    if (room.phase !== "MISSION_ACTION") return this.reject("当前不是执行任务阶段。");
    if (!room.currentTeam.includes(player.id)) return this.reject("你不在本轮任务队伍中。");
    if (room.missionActions.has(player.id)) return this.reject("你已经提交了任务行动。");
    const actions = Array.isArray(action) ? action : [action];
    if (actions.some((entry) => entry !== "SUCCESS" && entry !== "FAIL")) {
      return this.reject("任务行动无效。");
    }
    const characterId = room.characters.get(room.magicUserId ?? "");
    const expectedActions = room.round === 3 && player.id === room.magicUserId
      && room.alignments.get(player.id) === "MAGICAL_GIRL"
      && characterId === "hanna" && room.magicEffect.extraActionCount > 0 ? 2 : 1;
    if (actions.length !== expectedActions) {
      return this.reject(expectedActions === 2 ? "远野汉娜第三轮需要提交两次决定。" : "每位队员只能提交一次决定。");
    }
    const identity = room.identities.get(player.id);
    if (!identity) return this.reject("没有找到你的身份信息，请联系房主重开游戏。");
    if (actions.includes("FAIL") && (room.alignments.get(player.id) !== "WITCH" || !this.canSabotage(room, player.id, identity))) {
      return this.reject("你的身份不能破坏任务。");
    }
    if (
      actions.includes("FAIL") &&
      room.round === 3 &&
      room.magicEffect.blockWitchFailRound3 &&
      room.alignments.get(player.id) === "WITCH"
    ) {
      return this.reject("第三轮魔女只能选择破解。");
    }
    room.missionActions.set(player.id, actions);
    if (room.missionActions.size === room.currentTeam.length) this.resolveMission(room);
    return { ok: true };
  }

  continueAfterResult(room: GameRoom, player: PlayerRecord): Result {
    if (room.phase !== "MISSION_RESULT") return this.reject("当前没有待继续的任务结果。");
    if (room.players[room.leaderIndex]?.id !== player.id) {
      return this.reject("只有下一轮领袖可以继续游戏。");
    }
    if (room.round >= MAX_ROUNDS) {
      room.phase = "ENDED";
      room.winner = room.successCount > room.failCount ? "MAGICAL_GIRL" : "WITCH";
      this.addLog(room, "五轮结束，按最终任务结果判定胜负。");
      return { ok: true };
    }
    room.round += 1;
    if (room.round === 3 && !room.magicElectionDone) {
      room.phase = "MAGIC_CANDIDACY";
      room.candidacyVotes.clear();
      room.magicCandidates = [];
      room.magicElectorate = [];
      room.magicVotes.clear();
      this.addLog(room, "第三轮开始前开启魔法竞选。");
      return { ok: true };
    }
    room.phase = "SELECT_TEAM";
    room.lastMissionResult = null;
    room.magicResolutionResolved = false;
    this.addLog(room, `进入第 ${room.round} 轮。`);
    this.addLog(room, `${room.players[room.leaderIndex].name} 成为本轮领袖。`);
    return { ok: true };
  }

  useMagic(room: GameRoom, player: PlayerRecord, action: MagicAction): Result {
    if (!action || typeof action !== "object" || typeof action.type !== "string") {
      return this.reject("魔法行动无效。");
    }
    if (room.phase === "INVASION_MAGIC") {
      if (room.magicUserId !== player.id || room.magicAbilityUsed) {
        return this.reject("只有尚未发动魔法的竞选胜者可以执行身份交换。");
      }
      const characterId = room.characters.get(player.id);
      const identity = room.identities.get(player.id);
      if (characterId !== "milia" || !identity) return this.reject("当前角色不能在侵染阶段发动该魔法。");
      if (action.type === "PASS") {
        room.magicAbilityUsed = true;
        room.phase = "INVASION";
        return { ok: true };
      }
      if (action.type !== "SWAP_IDENTITIES") return this.reject("该阶段只能交换身份或放弃发动。");
      if (action.firstId !== player.id) return this.reject("佐伯米莉亚只能与自己交换身份。");
      if (action.revealSelf !== undefined && typeof action.revealSelf !== "boolean") {
        return this.reject("身份公开选项无效。");
      }
      const swapResult = this.swapIdentities(room, action.firstId, action.secondId);
      if (!swapResult.ok) return swapResult;
      room.magicAbilityUsed = true;
      room.phase = "INVASION";
      if (room.alignments.get(player.id) === "WITCH" && action.revealSelf) {
        const currentIdentity = room.identities.get(player.id);
        this.addLog(room, `${player.name} 宣布自己现在是${currentIdentity?.name ?? "未知身份"}。`);
      }
      this.addLog(room, "竞选胜者在侵染前发动了灵魂互换。");
      return { ok: true };
    }
    if (room.phase !== "MAGIC_USE") return this.reject("当前不是发动魔法阶段。");
    if (room.magicUserId !== player.id) return this.reject("只有竞选胜者可以使用魔法。");
    if (room.magicAbilityUsed) return this.reject("本局魔法已经使用。");
    const identity = room.identities.get(player.id);
    const characterId = room.characters.get(player.id);
    if (!identity || !characterId || !room.alignments.has(player.id)) {
      return this.reject("没有找到你的角色或身份。");
    }
    if (action.type === "PASS") {
      if (characterId !== "milia") {
        return this.reject("魔法竞选胜者必须立即发动角色魔法。");
      }
      room.magicAbilityUsed = characterId !== "milia";
      room.magicElectionDone = true;
      room.phase = "SELECT_TEAM";
      this.addLog(room, "魔法竞选胜者选择保留魔法。");
      return { ok: true };
    }
    return this.applyMagic(room, player, characterId, room.alignments.get(player.id)!, action);
  }

  declareMagicCandidacy(room: GameRoom, player: PlayerRecord, isCandidate: boolean): Result {
    if (room.phase !== "MAGIC_CANDIDACY") return this.reject("当前不是魔法竞选报名阶段。");
    if (room.candidacyVotes.has(player.id)) return this.reject("你已经提交过竞选意向。");
    if (typeof isCandidate !== "boolean") return this.reject("竞选意向无效。");
    room.candidacyVotes.set(player.id, isCandidate);
    if (room.candidacyVotes.size === room.players.length) this.resolveMagicCandidacy(room);
    return { ok: true };
  }

  voteMagic(room: GameRoom, player: PlayerRecord, candidateId: string | null): Result {
    if (room.phase !== "MAGIC_VOTE") return this.reject("当前不是魔法竞选投票阶段。");
    if (!room.magicElectorate.includes(player.id)) return this.reject("竞选者不能参与本轮投票。");
    if (room.magicVotes.has(player.id)) return this.reject("你已经投过竞选票了。");
    if (candidateId !== null && !room.magicCandidates.includes(candidateId)) {
      return this.reject("请选择一位当前候选人或弃票。");
    }
    room.magicVotes.set(player.id, candidateId);
    if (room.magicVotes.size === room.magicElectorate.length) this.resolveMagicVote(room);
    return { ok: true };
  }

  resolveMagic(room: GameRoom, player: PlayerRecord, action: MagicAction): Result {
    if (!action || typeof action !== "object" || typeof action.type !== "string") {
      return this.reject("魔法结算行动无效。");
    }
    if (room.phase !== "MAGIC_RESOLUTION") return this.reject("当前没有待处理的魔法效果。");
    if (room.magicUserId !== player.id) return this.reject("只有竞选胜者可以结算这个魔法。");
    const characterId = room.characters.get(player.id);
    const alignment = room.alignments.get(player.id);
    if (!characterId || !alignment) return this.reject("没有找到你的角色或身份。");
    if (action.type === "PASS") {
      if (characterId === "noah" && alignment === "MAGICAL_GIRL"
        && [...room.missionActions.values()].some((actions) => actions.includes("FAIL"))) {
        return this.reject("第三轮有破坏决定，需要公布破坏者。");
      }
      if (characterId === "emma" && alignment === "WITCH" && this.canEmmaWitchRewrite(room)) {
        room.magicResolutionResolved = true;
        this.resolveMission(room);
        return { ok: true };
      }
      room.magicResolutionResolved = true;
      this.resolveMission(room);
      return { ok: true };
    }
    if (action.type === "DECLARE_EMMA_WITCH") {
      if (characterId !== "emma" || alignment !== "WITCH" || !this.canEmmaWitchRewrite(room)) {
        return this.reject("当前条件下不能发动樱羽艾玛的魔女技能。");
      }
      room.emmaWitchDeclared = true;
      room.magicResolutionResolved = true;
      this.addLog(room, `${player.name} 公布了自己的魔女身份并改写了第三轮结果。`);
      this.resolveMission(room);
      return { ok: true };
    }
    if (action.type === "MISSION_OVERRIDE") {
      if (characterId !== "anna") {
        return this.reject("当前角色不能改写任务决定。");
      }
      if (room.round !== 3 || !room.currentTeam.includes(action.targetId)) {
        return this.reject("请选择一位本轮队伍成员。");
      }
      if (action.replacement !== "SUCCESS" && action.replacement !== "FAIL") {
        return this.reject("替换后的任务决定无效。");
      }
      const targetActions = room.missionActions.get(action.targetId);
      const actionIndex = action.actionIndex ?? 0;
      if (!targetActions?.length || !Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex >= targetActions.length) {
        return this.reject("没有找到该玩家的任务决定。");
      }
      if (characterId === "anna" && alignment === "MAGICAL_GIRL" && action.replacement !== "SUCCESS") {
        return this.reject("魔法少女阵营只能将一项决定改为破解。");
      }
      if (action.replacement === "FAIL" && alignment === "WITCH") {
        const identity = room.identities.get(player.id);
        if (!identity || !this.canSabotage(room, player.id, identity)) {
          return this.reject("你的身份不能提交破坏决定。");
        }
      }
      targetActions[actionIndex] = action.replacement;
      this.addLog(room, "竞选胜者改变了一项第三轮任务决定。");
      room.magicResolutionResolved = true;
      this.resolveMission(room);
      return { ok: true };
    }
    if (action.type === "COCO_REPLACE_DECISION") {
      if (characterId !== "coco" || alignment !== "WITCH" || room.round !== 3) {
        return this.reject("当前角色不能替换任务决定。");
      }
      const decisions = room.shuffledMissionDecisions;
      if (!decisions || !Number.isInteger(action.decisionIndex)
        || action.decisionIndex < 0 || action.decisionIndex >= decisions.length) {
        return this.reject("请选择一项有效的匿名任务决定。");
      }
      if (action.replacement !== "SUCCESS" && action.replacement !== "FAIL") {
        return this.reject("替换后的任务决定无效。");
      }
      const decision = decisions[action.decisionIndex];
      const targetActions = room.missionActions.get(decision.playerId);
      const identity = room.identities.get(player.id);
      if (!targetActions || !identity) return this.reject("找不到对应的任务决定。");
      if (action.replacement === "FAIL" && !this.canSabotage(room, player.id, identity)) {
        return this.reject("你的身份不能提交破坏决定。");
      }
      targetActions[decision.actionIndex] = action.replacement;
      this.addLog(room, "竞选胜者用自己的决定替换了一项匿名任务决定。");
      room.magicResolutionResolved = true;
      this.resolveMission(room);
      return { ok: true };
    }
    if (action.type === "REIA_DECISIONS") {
      if (characterId !== "reia" || room.round !== 3) return this.reject("当前角色不能移除任务决定。");
      const requiredRemoveCount = alignment === "MAGICAL_GIRL" ? 1 : 2;
      const decisions = room.shuffledMissionDecisions;
      if (!decisions || !Array.isArray(action.removedDecisionIndexes)
        || action.removedDecisionIndexes.length !== requiredRemoveCount
        || new Set(action.removedDecisionIndexes).size !== requiredRemoveCount
        || action.removedDecisionIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= decisions.length)) {
        return this.reject(`必须选择 ${requiredRemoveCount} 项不同的任务决定。`);
      }
      if (alignment === "MAGICAL_GIRL" && action.ownAction !== undefined && action.ownAction !== "SUCCESS") {
        return this.reject("魔法少女阵营只能放入破解决定。");
      }
      if (alignment === "WITCH" && action.ownAction !== "SUCCESS" && action.ownAction !== "FAIL") {
        return this.reject("放入的决定无效。");
      }
      const identity = room.identities.get(player.id);
      if (alignment === "WITCH" && action.ownAction === "FAIL"
        && (!identity || !this.canSabotage(room, player.id, identity))) {
        return this.reject("你的身份不能提交破坏决定。");
      }
      const removedDecisions = action.removedDecisionIndexes.map((index) => decisions[index]);
      const removalsByPlayer = new Map<string, number[]>();
      for (const decision of removedDecisions) {
        const indexes = removalsByPlayer.get(decision.playerId) ?? [];
        indexes.push(decision.actionIndex);
        removalsByPlayer.set(decision.playerId, indexes);
      }
      for (const [id, indexes] of removalsByPlayer) {
        const actions = room.missionActions.get(id);
        if (!actions) return this.reject("找不到对应的任务决定。");
        for (const index of indexes.sort((left, right) => right - left)) actions.splice(index, 1);
        if (actions.length === 0) room.missionActions.delete(id);
      }
      room.magicEffect.reiaOwnAction = action.ownAction ?? null;
      this.addLog(room, "竞选胜者移除了部分任务决定并放入自己的决定。");
      room.magicResolutionResolved = true;
      this.resolveMission(room);
      return { ok: true };
    }
    if (action.type === "ANNOUNCE_SABOTEUR") {
      if (characterId !== "noah" || room.round !== 3) return this.reject("当前角色不能公布破坏者。");
      if (alignment === "MAGICAL_GIRL") {
        const targetActions = room.missionActions.get(action.targetId);
        if (!targetActions?.includes("FAIL")) return this.reject("只能公布实际选择破坏的玩家。");
      } else if (room.missionActions.get(action.targetId)?.includes("FAIL")) {
        return this.reject("魔女技能需要选择一位没有选择破坏的玩家。");
      }
      const target = room.players.find(({ id }) => id === action.targetId);
      if (!target) return this.reject("请选择一位有效玩家。");
      this.addLog(room, `${player.name} 公布${target.name}是破坏者。`);
      room.magicResolutionResolved = true;
      this.resolveMission(room);
      return { ok: true };
    }
    if (action.type === "PEEK_DECISIONS") {
      if (characterId !== "coco" || alignment !== "MAGICAL_GIRL" || room.round !== 3) {
        return this.reject("当前角色不能查看任务决定。");
      }
      if (!Array.isArray(action.targetIds) || action.targetIds.length > 2
        || new Set(action.targetIds).size !== action.targetIds.length
        || action.targetIds.some((id) => !room.currentTeam.includes(id) || !room.missionActions.has(id))) {
        return this.reject("最多选择两位已提交行动的队伍成员。");
      }
      const privateResult = action.targetIds
        .map((id) => {
          const name = room.players.find((entry) => entry.id === id)?.name ?? "队伍成员";
          const actions = room.missionActions.get(id) ?? [];
          return `${name}：${actions.map((decision) => decision === "SUCCESS" ? "破解" : "破坏").join("、")}`;
        })
        .join("；");
      room.magicResultByPlayer.set(player.id, privateResult || "你没有选择查看任务决定。");
      const shuffled = room.shuffledMissionDecisions ?? [];
      this.addLog(room, `第三轮洗混后的任务决定：${shuffled.map(({ action }) => action === "SUCCESS" ? "破解" : "破坏").join("、")}。`);
      room.magicResolutionResolved = true;
      this.resolveMission(room);
      return { ok: true };
    }
    return this.reject("该魔法不能在任务结算阶段使用。");
  }

  invade(room: GameRoom, player: PlayerRecord, targetPlayerId: string): Result {
    if (room.phase !== "INVASION") return this.reject("当前不是侵染阶段。");
    const identity = room.identities.get(player.id);
    if (!identity || room.alignments.get(player.id) !== "WITCH") {
      return this.reject("只有魔女阵营可以执行侵染。");
    }
    if (typeof targetPlayerId !== "string" || !room.players.some(({ id }) => id === targetPlayerId)) {
      return this.reject("请选择一位有效的玩家作为目标。");
    }

    const targetIdentity = room.identities.get(targetPlayerId);
    if (!targetIdentity) return this.reject("没有找到目标玩家的身份信息。");
    if (room.alignments.get(targetPlayerId) !== "MAGICAL_GIRL") {
      return this.reject("侵染目标必须属于魔法少女阵营。");
    }
    room.phase = "ENDED";
    room.winner = targetIdentity.id === "possessed" ? "WITCH" : "MAGICAL_GIRL";
    this.addLog(
      room,
      room.winner === "WITCH"
        ? "侵染命中凭依者，魔女阵营获得胜利。"
        : "侵染未命中凭依者，魔法少女阵营获得胜利。"
    );
    return { ok: true };
  }

  createUpdate(room: GameRoom, player: PlayerRecord): RoomUpdate {
    const identity = room.identities.get(player.id);
    const magicCharacter = room.characters.get(room.magicUserId ?? "");
    const decisions = [...room.missionActions.entries()].flatMap(([playerId, actions]) =>
      actions.map((action, actionIndex) => ({ playerId, actionIndex, action }))
    );
    const decisionPreview: PrivateGameState["magic"]["decisionPreview"] =
      room.phase !== "MAGIC_RESOLUTION" || room.magicUserId !== player.id
        ? []
        : magicCharacter === "reia"
          ? (room.shuffledMissionDecisions ?? []).map(({ action }, index) => ({ index, action }))
          : magicCharacter === "coco" && room.alignments.get(player.id) === "MAGICAL_GIRL"
            ? room.currentTeam.map((playerId, index) => ({
                index,
                playerId,
                playerName: room.players.find((entry) => entry.id === playerId)?.name
              }))
            : magicCharacter === "coco" && room.alignments.get(player.id) === "WITCH"
              ? (room.shuffledMissionDecisions ?? []).map((_, index) => ({ index }))
              : magicCharacter === "anna"
              ? decisions.map(({ playerId, actionIndex, action }, index) => ({
                  index,
                  playerId,
                  playerName: room.players.find((entry) => entry.id === playerId)?.name,
                  actionIndex,
                  action
                }))
              : [];
    const privateState: PrivateGameState | null = identity
      ? {
          identity,
          alignment: room.alignments.get(player.id) ?? identity.camp,
          canSabotage: this.canSabotage(room, player.id, identity),
          invasionTargets: room.phase === "INVASION" && room.alignments.get(player.id) === "WITCH"
            ? room.players
                .filter((entry) => room.alignments.get(entry.id) === "MAGICAL_GIRL")
                .map((entry) => entry.id)
            : [],
          privateMessage: room.privateMessages.get(player.id) ?? "暂时没有额外的身份情报。",
          isOnTeam: room.currentTeam.includes(player.id),
          hasVoted: room.teamVotes.has(player.id),
          hasActed: room.missionActions.has(player.id),
          magic: {
            hasDeclaredCandidacy: room.candidacyVotes.has(player.id),
            isCandidate: room.candidacyVotes.get(player.id) === true,
            hasVotedMagic: room.magicVotes.has(player.id),
            canVoteMagic: room.magicElectorate.includes(player.id),
            isMagicUser: room.magicUserId === player.id,
            magicMessage: room.magicUserId === player.id && room.characters.has(player.id)
              ? room.alignments.get(player.id) === "WITCH"
                ? getCharacter(room.characters.get(player.id)!).witchSkill
                : getCharacter(room.characters.get(player.id)!).magicalGirlSkill
              : null,
            magicResult: room.magicResultByPlayer.get(player.id) ?? null,
            magicTargets: room.phase === "MAGIC_RESOLUTION"
              && room.magicUserId === player.id
              && room.characters.get(player.id) === "noah"
              ? room.players
                  .filter((entry) => {
                    const sabotaged = room.missionActions.get(entry.id)?.includes("FAIL") ?? false;
                    return room.alignments.get(player.id) === "MAGICAL_GIRL" ? sabotaged : !sabotaged;
                  })
                  .map((entry) => entry.id)
              : [],
            decisionPreview
          }
        }
      : null;

    return {
      publicState: this.createPublicState(room),
      privateState
    };
  }

  private resolveTeamVote(room: GameRoom): void {
    room.lastTeamVotes = new Map(room.teamVotes);
    const approvals = [...room.teamVotes.values()].filter(Boolean).length;
    const rejections = room.players.length - approvals;
    if (approvals > room.players.length / 2) {
      room.failedProposals = 0;
      room.phase = "MISSION_ACTION";
      this.addLog(room, `队伍投票通过（赞成 ${approvals}，反对 ${rejections}）。`);
      return;
    }

    room.failedProposals += 1;
    room.phase = "SELECT_TEAM";
    this.addLog(room, `队伍投票未通过（赞成 ${approvals}，反对 ${rejections}）。`);
    if (room.failedProposals >= 3) {
      room.forceTeamApproval = true;
      this.addLog(room, "下一次提名的队伍将自动通过。");
    }
    this.advanceLeader(room);
  }

  private resolveMagicCandidacy(room: GameRoom): void {
    room.magicRunoff = false;
    room.magicCandidates = room.players
      .filter((player) => room.candidacyVotes.get(player.id) === true)
      .map((player) => player.id);
    room.magicElectorate = room.players
      .filter((player) => room.candidacyVotes.get(player.id) !== true)
      .map((player) => player.id);
    if (!room.magicCandidates.length) {
      room.magicElectionDone = true;
      room.phase = "SELECT_TEAM";
      this.addLog(room, "没有玩家参加魔法竞选，直接进入第三轮。");
      return;
    }
    if (!room.magicElectorate.length) {
      if (room.magicCandidates.length === 1) {
        room.magicUserId = room.magicCandidates[0];
        room.magicAbilityUsed = false;
        room.phase = "MAGIC_USE";
        this.addLog(room, "只有一位候选人且无人可投票，候选人自动获得魔法使用权。");
      } else {
        room.magicElectionDone = true;
        room.phase = "SELECT_TEAM";
        this.addLog(room, "所有玩家都参加竞选且无人可以投票，本次竞选跳过。");
      }
      return;
    }
    room.magicVotes.clear();
    room.phase = "MAGIC_VOTE";
    room.magicRunoff = false;
    this.addLog(room, "魔法竞选报名结束，未参选玩家开始投票。");
  }

  private resolveMagicVote(room: GameRoom): void {
    const counts = new Map<string, number>();
    for (const candidateId of room.magicVotes.values()) {
      if (candidateId === null) continue;
      counts.set(candidateId, (counts.get(candidateId) ?? 0) + 1);
    }
    if (counts.size === 0) {
      room.magicAbilityUsed = true;
      room.magicElectionDone = true;
      room.phase = "SELECT_TEAM";
      this.addLog(room, "魔法竞选中所有投票者均弃票，本次竞选跳过。");
      return;
    }
    const highestVotes = Math.max(...counts.values());
    const topCandidates = room.magicCandidates.filter((id) => counts.get(id) === highestVotes);
    if (topCandidates.length > 1) {
      room.magicCandidates = topCandidates;
      room.magicElectorate = [...topCandidates];
      room.magicVotes.clear();
      room.magicRunoff = true;
      this.addLog(room, "魔法竞选出现并列，仅并列候选人进入重新投票。");
      return;
    }
    room.magicUserId = topCandidates[0];
    room.magicAbilityUsed = false;
    room.magicElectionDone = true;
    room.magicRunoff = false;
    room.phase = "MAGIC_USE";
    const winner = room.players.find((player) => player.id === room.magicUserId);
    this.addLog(room, `${winner?.name ?? "竞选胜者"}赢得魔法使用权。`);
  }

  private applyMagic(
    room: GameRoom,
    player: PlayerRecord,
    characterId: CharacterId,
    alignment: Camp,
    action: MagicAction
  ): Result {
    if (action.type === "INVESTIGATE_IDENTITY" && characterId === "naya") {
      if (typeof action.reveal !== "boolean") return this.reject("公开选项无效。");
      const target = room.players.find(({ id }) => id === action.targetId);
      const targetIdentity = room.identities.get(action.targetId);
      if (!target || !targetIdentity) return this.reject("请选择一位有效玩家。");
      const claimId = alignment === "WITCH" ? action.claimIdentityId ?? targetIdentity.id : targetIdentity.id;
      if (!IDENTITY_IDS.has(claimId)) return this.reject("请选择有效身份进行宣称。");
      const claim = getIdentity(claimId);
      if (action.reveal && alignment === "MAGICAL_GIRL" && claimId !== targetIdentity.id) {
        return this.reject("魔法少女阵营只能如实公布身份。");
      }
      room.magicResultByPlayer.set(player.id, `你查看到 ${target.name} 的身份是：${targetIdentity.name}。`);
      room.magicAbilityUsed = true;
      room.magicElectionDone = true;
      room.phase = "SELECT_TEAM";
      this.addLog(room, action.reveal
        ? `${player.name} 公开宣称 ${target.name} 的身份是${claim.name}。`
        : `${player.name} 发动了幻视。`);
      return { ok: true };
    }
    if (action.type === "INVESTIGATE_CAMP" && characterId === "meruru") {
      if (typeof action.claimSame !== "boolean") return this.reject("阵营宣称无效。");
      const target = room.players.find(({ id }) => id === action.targetId);
      const targetCamp = room.alignments.get(action.targetId);
      if (!target || !targetCamp) return this.reject("请选择一位有效玩家。");
      const trueSameCamp = targetCamp === alignment;
      const claimSame = alignment === "MAGICAL_GIRL" ? trueSameCamp : action.claimSame;
      room.magicResultByPlayer.set(
        player.id,
        `${target.name} 的阵营与你${trueSameCamp ? "相同" : "不同"}。`
      );
      room.magicAbilityUsed = true;
      room.magicElectionDone = true;
      room.phase = "SELECT_TEAM";
      this.addLog(room, `${player.name} 宣布 ${target.name} 的阵营与自己${claimSame ? "相同" : "不同"}。`);
      return { ok: true };
    }
    if (action.type === "SET_INVASION_BLOCK" && characterId === "arisa") {
      if (!Number.isInteger(action.round) || action.round < 3 || action.round > 5) {
        return this.reject("只能选择第三至第五轮。");
      }
      room.magicEffect.invasionBlockedRound = alignment === "MAGICAL_GIRL" ? action.round : null;
      room.magicAbilityUsed = true;
      room.magicElectionDone = true;
      room.phase = "SELECT_TEAM";
      this.addLog(room, alignment === "MAGICAL_GIRL"
        ? `竞选胜者封锁了第 ${action.round} 轮后的侵染。`
        : "竞选胜者发动火焰操控，但魔女身份使封锁侵染效果无效。");
      return { ok: true };
    }
    if (action.type === "SWAP_IDENTITIES" && characterId === "maga") {
      const swapped = this.swapIdentities(room, action.firstId, action.secondId);
      if (!swapped.ok) return swapped;
      room.magicAbilityUsed = true;
      room.magicElectionDone = true;
      room.phase = "SELECT_TEAM";
      this.addLog(room, "第三轮身份卡已交换，阵营胜利条件保持不变。");
      return { ok: true };
    }
    if (action.type === "REPLAY_ROUND_TWO" && characterId === "hiro" && alignment === "MAGICAL_GIRL") {
      if (room.round !== 3 || !room.lastMissionResult) return this.reject("没有可重开的第二轮结果。");
      const previousResult = room.lastMissionResult;
      if (previousResult.succeeded) {
        room.successCount = Math.max(0, room.successCount - 1);
        room.publicSuccessCount = Math.max(0, room.publicSuccessCount - 1);
      } else {
        room.failCount = Math.max(0, room.failCount - 1);
        room.publicFailCount = Math.max(0, room.publicFailCount - 1);
      }
      room.replayRoundTwoBy = player.id;
      room.lastMissionResult = null;
      room.round = 2;
      room.currentTeam = [];
      room.missionActions.clear();
      room.magicAbilityUsed = true;
      room.magicElectionDone = true;
      room.phase = "SELECT_TEAM";
      this.addLog(room, "第二轮结果作废，开始重新执行第二轮。");
      return { ok: true };
    }
    if (action.type === "CHANGE_ROUND_TWO_RESULT" && (
      characterId === "hiro" && alignment === "WITCH" || characterId === "shirley"
    )) {
      if (typeof action.succeeded !== "boolean") return this.reject("第二轮结果无效。");
      if (!room.lastMissionResult || room.round !== 3) {
        return this.reject("没有可改写的第二轮任务结果。");
      }
      const succeeded = characterId === "shirley" && alignment === "MAGICAL_GIRL" ? true : action.succeeded;
      const previousResult = room.lastMissionResult;
      this.adjustSecondRoundResult(room, succeeded);
      if (characterId === "hiro" && alignment === "WITCH") {
        if (previousResult.succeeded) room.publicSuccessCount = Math.max(0, room.publicSuccessCount - 1);
        else room.publicFailCount = Math.max(0, room.publicFailCount - 1);
        if (succeeded) room.publicSuccessCount += 1;
        else room.publicFailCount += 1;
        room.lastMissionResult = { succeeded, failActions: succeeded ? 0 : 1 };
        this.addLog(room, `竞选胜者宣布第二轮结果为${succeeded ? "破解" : "破坏"}。`);
      }
      room.magicResultByPlayer.set(player.id, `第二轮结果已改写为${succeeded ? "破解" : "破坏"}。`);
      room.magicAbilityUsed = true;
      room.magicElectionDone = true;
      room.phase = "SELECT_TEAM";
      this.addLog(room, "竞选胜者发动了一项魔法。");
      return { ok: true };
    }
    if (characterId === "milia" && action.type !== "PASS") {
      return this.reject("佐伯米莉亚的魔法要在侵染阶段发动。");
    }
    if (action.type === "SET_MISSION_EFFECT") {
      const supported = this.configureMissionEffect(room, characterId, alignment, action);
      if (!supported.ok) return supported;
      room.magicAbilityUsed = true;
      room.magicElectionDone = true;
      room.phase = "SELECT_TEAM";
      this.addLog(room, `${getCharacter(characterId).name} 的魔法已生效。`);
      return { ok: true };
    }
    return this.reject("这张角色牌不能执行所选魔法。");
  }

  private configureMissionEffect(
    room: GameRoom,
    characterId: CharacterId,
    alignment: Camp,
    action: Extract<MagicAction, { type: "SET_MISSION_EFFECT" }>
  ): Result {
    if (characterId === "emma" && alignment === "MAGICAL_GIRL" && action.effect === "BLOCK_WITCH_FAIL") {
      room.magicEffect.blockWitchFailRound3 = true;
      return { ok: true };
    }
    if (characterId === "emma" && alignment === "WITCH" && action.effect === "ARM_EMMA_WITCH") {
      room.magicEffect.emmaWitchArmed = true;
      return { ok: true };
    }
    if (characterId === "anna" && action.effect === "REPLACE_MISSION_ACTION") {
      return { ok: true };
    }
    if (characterId === "noah" && alignment === "MAGICAL_GIRL" && action.effect === "REVEAL_SABOTEUR") {
      room.magicEffect.revealActualSaboteur = true;
      return { ok: true };
    }
    if (characterId === "noah" && alignment === "WITCH" && action.effect === "REVEAL_SABOTEUR") {
      return { ok: true };
    }
    if (characterId === "noah" && alignment === "MAGICAL_GIRL" && action.effect === "HIDDEN_RESULT") {
      room.magicEffect.hiddenMissionResult = true;
      return { ok: true };
    }
    if (characterId === "noah" && alignment === "MAGICAL_GIRL" && action.effect === "NOAH_MG") {
      room.magicEffect.hiddenMissionResult = true;
      room.magicEffect.revealActualSaboteur = true;
      return { ok: true };
    }
    if (characterId === "reia" && action.effect === "ADD_MISSION_ACTION") {
      if (alignment === "MAGICAL_GIRL") room.reiaReducedTeamRound = 3;
      return { ok: true };
    }
    if (characterId === "hanna" && action.effect === "ADD_MISSION_ACTION") {
      if (alignment === "MAGICAL_GIRL") room.magicEffect.extraActionCount = 1;
      else room.magicEffect.hannaWitchSabotage = true;
      return { ok: true };
    }
    if (characterId === "coco" && alignment === "MAGICAL_GIRL" && action.effect === "HIDDEN_RESULT") {
      return { ok: true };
    }
    if (characterId === "coco" && alignment === "WITCH" && action.effect === "REPLACE_MISSION_ACTION") {
      return { ok: true };
    }
    return this.reject("当前角色或阵营不能使用该效果。");
  }

  private swapIdentities(room: GameRoom, firstId: string, secondId: string): Result {
    if (firstId === secondId) return this.reject("请选择两位不同的玩家交换身份。");
    const firstIdentity = room.identities.get(firstId);
    const secondIdentity = room.identities.get(secondId);
    if (!firstIdentity || !secondIdentity) return this.reject("请选择两位有效玩家。");
    room.identities.set(firstId, secondIdentity);
    room.identities.set(secondId, firstIdentity);
    return { ok: true };
  }

  private adjustSecondRoundResult(room: GameRoom, succeeded: boolean): void {
    const previous = room.lastMissionResult;
    if (!previous) return;
    if (previous.succeeded) room.successCount = Math.max(0, room.successCount - 1);
    else room.failCount = Math.max(0, room.failCount - 1);
    if (succeeded) room.successCount += 1;
    else room.failCount += 1;
  }

  private canEmmaWitchRewrite(room: GameRoom): boolean {
    const failActions = [...room.missionActions.values()].flat().filter((action) => action === "FAIL").length;
    const alreadySucceeded = failActions < getRequiredFails(room.players.length, room.round);
    return room.round === 3 && alreadySucceeded && room.successCount >= 2;
  }

  private shouldResolveMagicBeforeMission(room: GameRoom, wouldSucceed: boolean): boolean {
    if (room.round !== 3 || room.magicResolutionResolved || !room.magicUserId) return false;
    const characterId = room.characters.get(room.magicUserId);
    const alignment = room.alignments.get(room.magicUserId);
    return characterId === "anna"
      || characterId === "noah"
      || characterId === "reia"
      || characterId === "coco"
      || (characterId === "emma" && alignment === "WITCH" && room.magicEffect.emmaWitchArmed
        && wouldSucceed && room.successCount >= 2);
  }

  private getRequiredTeamSize(room: GameRoom, selectedPlayerIds: string[] = []): number {
    let size = getTeamSize(room.players.length, room.round);
    if (room.round === 3 && room.reiaReducedTeamRound === 3) size -= 1;
    if (
      room.round === 3
      && room.magicAbilityUsed
      && room.magicUserId
      && room.alignments.get(room.magicUserId) === "MAGICAL_GIRL"
      && room.characters.get(room.magicUserId) === "hanna"
      && room.magicEffect.extraActionCount > 0
      && selectedPlayerIds.includes(room.magicUserId)
    ) size -= 1;
    return Math.max(1, size);
  }

  private resolveMission(room: GameRoom): void {
    const actions = [...room.missionActions.values()].flat();
    const failActions = actions.filter((action) => action === "FAIL").length
      + (room.magicEffect.reiaOwnAction === "FAIL" ? 1 : 0);
    const initialSucceeded = failActions < getRequiredFails(room.players.length, room.round);
    if (!room.magicResolutionResolved && this.shouldResolveMagicBeforeMission(room, initialSucceeded)) {
      const characterId = room.characters.get(room.magicUserId ?? "");
      if (characterId === "reia" || characterId === "coco") {
        const decisions = [...room.missionActions.entries()].flatMap(([playerId, playerActions]) =>
          playerActions.map((action, actionIndex) => ({ playerId, actionIndex, action }))
        );
        room.shuffledMissionDecisions = shuffle(decisions, () => randomInt(0, 2 ** 32) / 2 ** 32);
      }
      room.phase = "MAGIC_RESOLUTION";
      return;
    }
    const succeeded = room.emmaWitchDeclared && room.round === 3 && initialSucceeded
      ? false
      : initialSucceeded;
    const replayedRoundTwo = room.round === 2 && room.replayRoundTwoBy !== null;
    const missionFails = succeeded ? failActions : Math.max(1, failActions);
    if (succeeded) room.successCount += 1;
    else room.failCount += 1;
    const hiddenResult = (room.round === 3 && room.magicEffect.hiddenMissionResult) || replayedRoundTwo;
    room.hideLastMissionResult = hiddenResult;
    if (!hiddenResult) {
      if (succeeded) room.publicSuccessCount += 1;
      else room.publicFailCount += 1;
    } else {
      const actualSaboteurs = [...room.missionActions.entries()]
        .filter(([, playerActions]) => playerActions.includes("FAIL"))
        .map(([id]) => room.players.find((entry) => entry.id === id)?.name)
        .filter((name): name is string => Boolean(name));
      const userId = room.magicUserId;
      if (userId) {
        room.magicResultByPlayer.set(
          userId,
          `第三轮结果：${succeeded ? "破解成功" : "破坏成功"}。${room.magicEffect.revealActualSaboteur
            ? `破坏者：${actualSaboteurs.join("、") || "无人"}。`
            : ""}`
        );
      }
    }
    if (room.replayRoundTwoBy && room.round === 2) {
      room.magicResultByPlayer.set(
        room.replayRoundTwoBy,
        `重开的第二轮结果：${succeeded ? "破解成功" : "破坏成功"}。`
      );
      room.replayRoundTwoBy = null;
    }
    room.lastMissionResult = { succeeded, failActions: missionFails };
    room.phase = "MISSION_RESULT";
    this.advanceLeader(room);
    room.magicResolutionResolved = false;
    room.magicEffect.reiaOwnAction = null;
    room.emmaWitchDeclared = false;

    if (room.failCount >= 3) {
      room.phase = "ENDED";
      room.winner = "WITCH";
      this.addLog(room, "魔女阵营破坏三次机关，获得胜利。");
    } else if (room.round >= 3 && room.round <= MAX_ROUNDS) {
      if (room.magicEffect.invasionBlockedRound === room.round) {
        if (room.successCount >= 3) {
          room.phase = "ENDED";
          room.winner = "MAGICAL_GIRL";
          this.addLog(room, `第 ${room.round} 轮侵染被封锁，魔法少女阵营已破解三处机关并获胜。`);
        } else {
          room.phase = "MISSION_RESULT";
          this.addLog(room, `第 ${room.round} 轮侵染被封锁，游戏继续。`);
        }
      } else {
        room.phase = room.magicUserId && room.characters.get(room.magicUserId) === "milia" && !room.magicAbilityUsed
          ? "INVASION_MAGIC"
          : "INVASION";
        this.addLog(room, `第 ${room.round} 轮结束，进入侵染阶段。`);
      }
    } else {
      this.addLog(
        room,
        hiddenResult
          ? `第 ${room.round} 轮任务结算完成，具体结果暂不公开。`
          : succeeded
            ? `第 ${room.round} 轮机关破解成功。`
            : `第 ${room.round} 轮机关遭到破坏（${missionFails} 次破坏）。`
      );
    }
  }

  private createPublicState(room: GameRoom): PublicGameState {
    const leader = room.phase === "LOBBY" ? null : room.players[room.leaderIndex]?.id ?? null;
    return {
      code: room.code,
      phase: room.phase,
      players: room.players.map(({ id, name, seatIndex, connected, isHost, characterId }) => ({
        id,
        name,
        seatIndex,
        connected,
        isHost,
        characterId
      })),
      round: room.round,
      leaderId: leader,
      successCount: room.publicSuccessCount,
      failCount: room.publicFailCount,
      currentTeam: [...room.currentTeam],
      teamSize: room.phase === "LOBBY" ? 0 : this.getRequiredTeamSize(room),
      hannaCountsAsTwo: Boolean(
        room.magicAbilityUsed
        && room.magicUserId
        && room.alignments.get(room.magicUserId) === "MAGICAL_GIRL"
        && room.characters.get(room.magicUserId) === "hanna"
        && room.magicEffect.extraActionCount > 0
      ),
      teamVotesSubmitted: room.teamVotes.size,
      lastTeamVotes: room.phase === "TEAM_VOTE" && room.teamVotes.size < room.players.length
        ? []
        : [...room.lastTeamVotes.entries()].map(([playerId, approve]) => ({ playerId, approve })),
      missionActionsSubmitted: room.missionActions.size,
      failedProposals: room.failedProposals,
      forceTeamApproval: room.forceTeamApproval,
      lastMissionResult: room.hideLastMissionResult ? null : room.lastMissionResult,
      winner: room.winner,
      logs: [...room.logs],
      magicCandidates: [...room.magicCandidates],
      magicVotesSubmitted: room.magicVotes.size,
      magicElectorateSize: room.magicElectorate.length,
      magicUserId: room.magicUserId,
      magicAbilityUsed: room.magicAbilityUsed,
      magicCandidacySubmitted: room.candidacyVotes.size,
      magicTiedVote: room.phase === "MAGIC_VOTE" && room.magicRunoff
    };
  }

  private advanceLeader(room: GameRoom): void {
    room.leaderIndex = (room.leaderIndex + 1) % room.players.length;
  }

  private canSabotage(room: GameRoom, playerId: string, identity: Identity): boolean {
    const magicAbilityActive = room.magicAbilityUsed
      && room.magicUserId !== null
      && room.alignments.get(playerId) === "WITCH";
    const characterId = room.magicUserId ? room.characters.get(room.magicUserId) : undefined;
    const magaAbilityActive = magicAbilityActive
      && characterId === "maga"
      && room.magicUserId !== null
      && room.alignments.get(room.magicUserId) === "WITCH";
    const hannaAbilityActive = magicAbilityActive
      && room.magicUserId === playerId
      && room.alignments.get(playerId) === "WITCH"
      && characterId === "hanna"
      && room.magicEffect.hannaWitchSabotage;
    return identity.canSabotage || magaAbilityActive || hannaAbilityActive;
  }

  private addLog(room: GameRoom, message: string): void {
    room.logs.push(message);
    if (room.logs.length > 40) room.logs.splice(0, room.logs.length - 40);
  }

  private createPlayer(name: string, seatIndex: number, socketId: string, isHost: boolean): PlayerRecord {
    return {
      id: randomUUID(),
      name,
      seatIndex,
      connected: true,
      isHost,
      characterId: null,
      socketId
    };
  }

  private createCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    do {
      code = Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join("");
    } while (this.rooms.has(code));
    return code;
  }

  private reject(error: string): Result {
    return { ok: false, error };
  }
}

export type { GameRoom, PlayerRecord };
