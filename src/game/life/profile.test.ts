import { describe, expect, it } from "vitest";
import { ScenarioLife } from "../../sim/index.ts";
import { defaultParts, type LifeOptions, optInParts } from "./create.ts";
import { assertLifeDependencies, FULL_PROFILE, validateLifeDependencies } from "./profile.ts";

describe("perfil completo opt-in", () => {
  it("sobrevive JSON y el esquema del guardado sin perder ninguna opción", () => {
    const json = JSON.parse(JSON.stringify(FULL_PROFILE));
    expect(json).toEqual(FULL_PROFILE);
    expect(ScenarioLife.parse(json)).toEqual(FULL_PROFILE);
    expect(validateLifeDependencies(FULL_PROFILE)).toEqual([]);
    expect(() => assertLifeDependencies(FULL_PROFILE)).not.toThrow();
  });

  it("cablea sus flags y conserva el default cuando no se elige", () => {
    const parts = optInParts(FULL_PROFILE);
    expect(parts.births).toBe(true);
    expect(parts.npcJourneyDays).toBe(30);
    expect(parts.loanBondageSkillWage).toBe(true);
    expect(optInParts({})).toEqual({});
    expect(defaultParts({})).toEqual({ persistGoalLayers: true });
    expect(validateLifeDependencies({})).toEqual([]);
  });

  it.each([
    [{ births: true }, "births", "conception"],
    [{ conceptionRateScale: 0 }, "conceptionRateScale", "conception"],
    [{ npcJourneyDays: 2, npcVerbs: [] }, "npcJourneyDays", "npcVerbs"],
    [{ npcJourneyDays: 2, npcVerbs: ["work"] }, "npcJourneyDays", "npcVerbs.move"],
    [{ npcTransit: true }, "npcTransit", "npcJourneyDays"],
    [{ npcInterrupt: true }, "npcInterrupt", "npcVerbs"],
    [{ npcTemplates: { work: "fieldwork" }, npcVerbs: ["move"] }, "npcTemplates", "npcVerbs.work"],
    [{ marksExpose: true, marks: true }, "marksExpose", "scam"],
    [{ recognizeGoalProgress: true }, "recognizeGoalProgress", "debtKnowledge"],
    [{ loanWorkout: true }, "loanWorkout", "loanContagion"],
    [{ objectCues: true, cueLocal: true, cravingCues: true }, "objectCues", "consumables"],
    [{ craftGoals: true, persistGoalLayers: false }, "craftGoals", "persistGoalLayers"],
  ] satisfies readonly (readonly [LifeOptions, string, string])[])(
    "detecta dependencia de %j",
    (options, option, requires) => {
      expect(validateLifeDependencies(options)).toEqual(
        expect.arrayContaining([expect.objectContaining({ option, requires })]),
      );
      expect(() => assertLifeDependencies(options)).toThrow();
    },
  );

  it("respeta flags falsos, cero significativo y capas por default de life-2", () => {
    expect(
      validateLifeDependencies({ births: false, npcInterrupt: false, craftGoals: true }),
    ).toEqual([]);
    expect(validateLifeDependencies({ conception: true, conceptionRateScale: 0 })).toEqual([]);
  });
});
