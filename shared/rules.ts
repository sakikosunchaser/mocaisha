import type { Camp, CharacterId, Identity, IdentityId } from "./game.js";
import { CHARACTER_CARDS } from "./characters.js";

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;
export const MAX_ROUNDS = 5;
export const WITCH_WIN_THRESHOLD = 3;
export const MAGICAL_GIRL_WIN_THRESHOLD = 3;

export const TEAM_SIZES: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5]
};

const identityDefinitions: Record<IdentityId, Identity> = {
  possessed: {
    id: "possessed",
    name: "凭依者",
    camp: "MAGICAL_GIRL",
    canSabotage: false
  },
  detective: {
    id: "detective",
    name: "大侦探",
    camp: "MAGICAL_GIRL",
    canSabotage: false
  },
  halfWitch: {
    id: "halfWitch",
    name: "半魔女",
    camp: "WITCH",
    canSabotage: true
  },
  goodWitch: {
    id: "goodWitch",
    name: "善良魔女",
    camp: "WITCH",
    canSabotage: false
  },
  magicalGirl: {
    id: "magicalGirl",
    name: "魔法少女",
    camp: "MAGICAL_GIRL",
    canSabotage: false
  },
  witch: {
    id: "witch",
    name: "魔女",
    camp: "WITCH",
    canSabotage: true
  }
};

export function getIdentity(id: IdentityId): Identity {
  return identityDefinitions[id];
}

export function getWitchCount(playerCount: number): number {
  if (playerCount <= 6) return 2;
  if (playerCount <= 9) return 3;
  return 4;
}

export function getTeamSize(playerCount: number, round: number): number {
  const sizes = TEAM_SIZES[playerCount];
  if (!sizes || round < 1 || round > MAX_ROUNDS) {
    throw new Error("无法为当前人数或轮次计算队伍人数。");
  }
  return sizes[round - 1];
}

export function getRequiredFails(playerCount: number, round: number): number {
  return playerCount >= 7 && round === 4 ? 2 : 1;
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function assignIdentities(
  playerCount: number,
  random: () => number = Math.random
): Identity[] {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`游戏人数必须为 ${MIN_PLAYERS}–${MAX_PLAYERS} 人。`);
  }

  const witchCount = getWitchCount(playerCount);
  const identities: IdentityId[] = ["possessed", "detective", "halfWitch", "goodWitch"];
  identities.push(...Array.from({ length: playerCount - 4 - (witchCount - 2) }, () => "magicalGirl" as const));
  identities.push(...Array.from({ length: witchCount - 2 }, () => "witch" as const));
  return shuffle(identities.map(getIdentity), random);
}

export function assignCharacters(
  playerCount: number,
  random: () => number = Math.random
): CharacterId[] {
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`游戏人数必须为 ${MIN_PLAYERS}–${MAX_PLAYERS} 人。`);
  }
  const eligibleCharacters = CHARACTER_CARDS
    .filter((character) => character.id !== "maga" || playerCount === 7)
    .map((character) => character.id);
  return shuffle(eligibleCharacters, random).slice(0, playerCount);
}

export function getPrivateMessage(
  identity: Identity,
  playerId: string,
  allPlayers: Array<{ id: string; name: string }>,
  identities: Map<string, Identity>
): string {
  if (identity.id === "possessed") {
    const knownWitches = allPlayers.filter((player) => {
      const otherIdentity = identities.get(player.id);
      return otherIdentity?.camp === "WITCH" && otherIdentity.id !== "goodWitch";
    });
    return knownWitches.length
      ? `你知道以下玩家是魔女：${knownWitches.map((player) => player.name).join("、")}。善良魔女不会显示。`
      : "你知道魔女阵营的部分成员；善良魔女不会显示。";
  }

  if (identity.id === "detective") {
    const specialPlayers = allPlayers.filter((player) => {
      const id = identities.get(player.id)?.id;
      return id === "possessed" || id === "halfWitch";
    });
    return `以下两人中，一人为凭依者，一人为半魔女：${specialPlayers.map((player) => player.name).join("、")}。`;
  }

  if (identity.camp === "WITCH") {
    const teammates = allPlayers.filter(
      (player) => player.id !== playerId && identities.get(player.id)?.camp === "WITCH"
    );
    return teammates.length
      ? `你的魔女队友是：${teammates.map((player) => player.name).join("、")}。`
      : "你属于魔女阵营。";
  }

  return "暂时没有额外的身份情报。";
}

export function getCampLabel(camp: Camp): string {
  return camp === "MAGICAL_GIRL" ? "魔法少女阵营" : "魔女阵营";
}
