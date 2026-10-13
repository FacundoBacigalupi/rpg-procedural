import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, EARTHLIKE_CLOCK, makeId, type Tick } from "../../core/index.ts";
import { LABOR, NPC_JOURNEY, PREGNANCY } from "../../game/index.ts";
import { ASLEEP, DEMOGRAPHY, ENTITY, PERSON, WorldTruth } from "../../sim/index.ts";
import { profileCoverage } from "./full-profile.ts";

const clock = EARTHLIKE_CLOCK;
const now = 0 as Tick;
const wife = makeId("agent", 1);
const husband = makeId("agent", 2);
const fertility = DEMOGRAPHY.schema.parse(
  JSON.parse(readFileSync("content/demography/preindustrial.json", "utf8"))[0],
).fertility;

function couple(age = 25) {
  const truth = new WorldTruth();
  for (const [id, sex, spouse, years] of [
    [wife, "female", husband, age],
    [husband, "male", wife, 30],
  ] as const) {
    truth.set(ENTITY, id, { id, createdAt: 0, originEventId: makeId("event", 1) });
    truth.set(PERSON, id, {
      sex,
      born: (-years * clock.year) as Tick,
      spouse,
      mother: null,
      father: null,
      household: makeId("household", 1),
    });
  }
  return truth;
}
const snapshot = (truth: WorldTruth) => profileCoverage(truth, now, clock, fertility);

describe("cobertura de oportunidades del perfil sin crear Life", () => {
  it("cuenta una pareja fértil recíproca y no modifica las filas", () => {
    const truth = couple();
    const before = canonicalJson(truth.rows());
    const a = snapshot(truth);
    expect(a).toMatchObject({
      livingPeople: 2,
      fertileCouples: 1,
      conceptionEligibleCouples: 1,
      activePregnancies: 0,
      npcJourneys: 0,
      asleepPeople: 0,
    });
    expect(a.fertileCouplesByAge.find((entry) => entry.fromAge === 25)?.couples).toBe(1);
    expect(snapshot(truth)).toEqual(a);
    expect(JSON.stringify(a)).not.toMatch(/agent:|household:|originEventId/);
    expect(canonicalJson(truth.rows())).toBe(before);
  });

  it.each([14, 50, 80])(
    "una mujer de %s años no tiene fecundidad positiva en la curva normal",
    (age) => {
      expect(snapshot(couple(age)).fertileCouples).toBe(0);
    },
  );
  it.each([15, 20, 49])(
    "la curva normal admite una pareja recíproca con mujer de %s años",
    (age) => {
      expect(snapshot(couple(age)).fertileCouples).toBe(1);
    },
  );

  it("excluye cónyuge muerto, relación unilateral y registro civil sin entidad", () => {
    const dead = couple();
    const entity = dead.get(ENTITY, husband);
    if (!entity) throw new Error("sin esposo");
    dead.set(ENTITY, husband, { ...entity, endedAt: -1 });
    expect(snapshot(dead)).toMatchObject({ livingPeople: 1, fertileCouples: 0 });
    const unilateral = couple();
    const person = unilateral.get(PERSON, husband);
    if (!person) throw new Error("sin registro civil");
    unilateral.set(PERSON, husband, { ...person, spouse: null });
    expect(snapshot(unilateral).fertileCouples).toBe(0);
    unilateral.deleteRaw(ENTITY.name, husband);
    expect(snapshot(unilateral).livingPeople).toBe(1);
  });

  it("distingue embarazo activo, parto ya resuelto y pausa posterior; ignora filas de muertos", () => {
    const truth = couple();
    truth.set(PREGNANCY, wife, {
      father: husband,
      conceivedAt: -180 * clock.day,
      dueAt: 100 * clock.day,
      parity: 1,
      originEventId: "event:1",
    });
    truth.set(NPC_JOURNEY, husband, { place: "place:1", since: -clock.day, decision: "move" });
    truth.set(ASLEEP, wife, { since: -clock.day, lastAdvanced: -clock.day });
    expect(snapshot(truth)).toMatchObject({
      fertileCouples: 1,
      conceptionEligibleCouples: 0,
      activePregnancies: 1,
      npcJourneys: 1,
      asleepPeople: 1,
    });
    truth.set(LABOR, wife, {
      dueAt: 100 * clock.day,
      at: -10 * clock.day,
      midwife: null,
      called: false,
      believedRisk: 0,
      complication: false,
      motherDied: false,
      infantDied: false,
      fever: false,
      paid: 0,
      cause: "event:2",
    });
    expect(snapshot(truth)).toMatchObject({ conceptionEligibleCouples: 0, activePregnancies: 0 });
    const labor = truth.get(LABOR, wife);
    if (!labor) throw new Error("sin parto");
    truth.set(LABOR, wife, { ...labor, at: -365 * clock.day });
    expect(snapshot(truth).conceptionEligibleCouples).toBe(1);
    for (const id of [wife, husband]) {
      const entity = truth.get(ENTITY, id);
      if (!entity) throw new Error("sin entidad");
      truth.set(ENTITY, id, { ...entity, endedAt: -1 });
    }
    expect(snapshot(truth)).toMatchObject({
      livingPeople: 0,
      fertileCouples: 0,
      activePregnancies: 0,
      npcJourneys: 0,
      asleepPeople: 0,
    });
  });
});
