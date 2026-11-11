import { describe, expect, it } from "vitest";
import {
  FULL_PROFILE,
  groupOptions,
  LIFE_GROUPS,
  lifeGroupOptions,
  PROFILE_GROUPS,
  validateLifeDependencies,
} from "./profile.ts";

describe("grupos de opciones (novel-flags-groups-core)", () => {
  it("los grupos del perfil lo parten sin solaparse y su unión es el perfil", () => {
    const seen = new Map<string, string>();
    for (const g of PROFILE_GROUPS) {
      for (const key of Object.keys(groupOptions(g))) {
        expect(seen.get(key), key).toBeUndefined();
        seen.set(key, g);
      }
    }
    expect([...seen.keys()].sort()).toEqual(Object.keys(FULL_PROFILE).sort());
    expect(lifeGroupOptions(PROFILE_GROUPS).options).toEqual(FULL_PROFILE);
    expect(lifeGroupOptions(PROFILE_GROUPS).groups).toEqual(PROFILE_GROUPS);
  });

  it("cada grupo, con lo que pide, arma una vida sin dependencias rotas", () => {
    for (const g of LIFE_GROUPS) {
      const r = lifeGroupOptions([g]);
      expect(validateLifeDependencies(r.options), g).toEqual([]);
      expect(r.groups).toContain(g);
    }
    expect(lifeGroupOptions(["cultivation"])).toEqual({
      groups: ["cultivation"],
      options: { cultivation: true },
    });
    expect(lifeGroupOptions([]).options).toEqual({});
  });

  it("sacar un grupo saca solo sus flags", () => {
    const without = lifeGroupOptions(PROFILE_GROUPS.filter((g) => g !== "livestock"));
    expect(without.groups).not.toContain("livestock");
    expect(Object.keys(without.options).some((k) => k.startsWith("livestock"))).toBe(false);
    expect(without.options).toMatchObject({ npcMove: true, scam: true });
  });
});
