import { describe, expect, it } from "vitest";
import { assignCharacters, assignIdentities, getRequiredFails, getTeamSize, getWitchCount } from "../shared/rules";

describe("game rules", () => {
  it("assigns the configured number of identities for every supported room size", () => {
    for (let playerCount = 5; playerCount <= 10; playerCount += 1) {
      const identities = assignIdentities(playerCount, () => 0.5);
      expect(identities).toHaveLength(playerCount);
      expect(identities.filter((identity) => identity.camp === "WITCH")).toHaveLength(
        getWitchCount(playerCount)
      );
      expect(identities.map((identity) => identity.id)).toContain("possessed");
      expect(identities.map((identity) => identity.id)).toContain("detective");
    }
  });

  it("uses the configured team sizes and the double-sabotage threshold", () => {
    expect(getTeamSize(5, 1)).toBe(2);
    expect(getTeamSize(8, 4)).toBe(5);
    expect(getRequiredFails(6, 4)).toBe(1);
    expect(getRequiredFails(7, 4)).toBe(2);
    expect(getRequiredFails(10, 5)).toBe(1);
  });

  it("rejects unsupported player counts", () => {
    expect(() => assignIdentities(4)).toThrow("游戏人数必须为 5–10 人。");
  });

  it("assigns distinct public characters and restricts Maga to seven-player games", () => {
    for (let playerCount = 5; playerCount <= 10; playerCount += 1) {
      const characters = assignCharacters(playerCount, () => 0.999);
      expect(characters).toHaveLength(playerCount);
      expect(new Set(characters).size).toBe(playerCount);
      if (playerCount !== 7) expect(characters).not.toContain("maga");
    }
    expect(assignCharacters(7, () => 0.999)).toContain("maga");
  });
});
