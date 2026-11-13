// El tablero de misiones (novel2-missions-board): las necesidades salen del tesoro y de las bandas
// cercanas; el encargo resta lo que ya salieron a hacer otros y respeta el rango.

import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef } from "../../core/index.ts";
import {
  herbNeeds,
  MISSION_HERB_GRAMS,
  MISSION_HERB_MIN_GRAMS,
  MISSION_POINTS_PER_GRAM,
  MISSION_WATCH_RADIUS,
  missionDue,
  missionFits,
  missionLapsed,
  missionLeft,
  pickMission,
  type SectMission,
  watchNeeds,
} from "./mission.ts";
import type { PillDef } from "./pill.ts";

const pills = [
  {
    id: "a",
    good: "pill-a",
    effect: "gather",
    qi: 20,
    purity: 0.7,
    endowPerHead: 3,
    recipe: { herb: "grass", grams: 20 },
  },
  {
    id: "b",
    good: "pill-b",
    effect: "break",
    purity: 0.8,
    prep: 0.2,
    endowPerHead: 0.2,
    recipe: { herb: "grass", grams: 400 },
  },
  { id: "c", good: "pill-c", effect: "gather", qi: 5, purity: 0.5, endowPerHead: 1 },
] as PillDef[];

const org = "org" as EntityRef;
const taken = (m: Partial<SectMission>): SectMission => ({
  org,
  kind: "herbs",
  done: 0,
  points: 0,
  by: "e" as AgentId,
  at: 0,
  due: 10,
  ...m,
});

describe("el tablero de misiones (novel2-missions-board)", () => {
  it("las hierbas que faltan: píldoras por cabeza menos el tesoro, por hierba", () => {
    // 10 vivos: faltan 30-10 de a (400 g) y 2-0 de b (800 g); en el tesoro hay 300 g.
    const needs = herbNeeds(pills, { alive: 10, pills: { "pill-a": 10 }, herbs: { grass: 300 } });
    expect(needs).toEqual([{ kind: "herbs", herb: "grass", grams: 900 }]);
    // Con todo en el tesoro, no hay necesidad.
    expect(
      herbNeeds(pills, { alive: 10, pills: { "pill-a": 30, "pill-b": 2 }, herbs: {} }),
    ).toEqual([]);
    expect(herbNeeds(pills, { alive: 10, pills: {}, herbs: { grass: 5000 } })).toEqual([]);
  });

  it("vigilar: solo bandas cerca, la más cercana primero", () => {
    const needs = watchNeeds([
      { band: "b2", hex: 7, distance: 2 },
      { band: "b1", hex: 5, distance: MISSION_WATCH_RADIUS + 1 },
      { band: "b3", hex: 9, distance: 1 },
    ]);
    expect(needs.map((n) => (n.kind === "watch" ? n.band : ""))).toEqual(["b3", "b2"]);
  });

  it("el encargo: vigilar primero si el rango alcanza; hierbas en tandas, menos lo que ya salió", () => {
    const needs = [
      { kind: "herbs" as const, herb: "grass", grams: 900 },
      ...watchNeeds([{ band: "b", hex: 4, distance: 1 }]),
    ];
    expect(pickMission(org, "inner", needs, [])).toMatchObject({
      kind: "watch",
      band: "b",
      hex: 4,
    });
    const herbs = pickMission(org, "outer", needs, []);
    expect(herbs).toMatchObject({ kind: "herbs", grams: MISSION_HERB_GRAMS });
    expect(herbs?.points).toBe(MISSION_HERB_GRAMS * MISSION_POINTS_PER_GRAM);
    // Ya hay alguien vigilando esa banda y dos tandas afuera (una a medias): queda poco.
    const out = [
      taken({ kind: "watch", band: "b" }),
      taken({ herb: "grass", grams: 400 }),
      taken({ herb: "grass", grams: 400, done: 100 }),
    ];
    expect(pickMission(org, "inner", needs, out)).toMatchObject({ kind: "herbs", grams: 200 });
    // Lo de otra secta no cuenta.
    expect(
      pickMission(org, "inner", needs, [
        taken({ org: "x" as EntityRef, kind: "watch", band: "b" }),
      ]),
    ).toMatchObject({ kind: "watch" });
    // Por debajo del mínimo, no hay misión; los ancianos no salen.
    const small = [{ kind: "herbs" as const, herb: "grass", grams: MISSION_HERB_MIN_GRAMS - 1 }];
    expect(pickMission(org, "outer", small, [])).toBeUndefined();
    expect(pickMission(org, "elder", needs, [])).toBeUndefined();
    expect(missionFits("watch", "outer")).toBe(false);
    expect(missionFits("watch", "core")).toBe(true);
  });

  it("plazo, vencimiento y lo que falta", () => {
    expect(missionDue("herbs", 100, 10)).toBe(240);
    const m = taken({ grams: 400, done: 150, due: 240 });
    expect(missionLeft(m)).toBe(250);
    expect(missionLapsed(m, 240)).toBe(false);
    expect(missionLapsed(m, 241)).toBe(true);
    expect(missionLeft(taken({ kind: "watch", hours: 8, done: 9 }))).toBe(0);
  });
});
