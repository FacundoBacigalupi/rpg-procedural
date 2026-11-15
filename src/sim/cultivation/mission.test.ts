// El tablero de misiones (novel2-missions-board): las necesidades salen del tesoro y de las bandas
// cercanas; el encargo resta lo que ya salieron a hacer otros y respeta el rango.

import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, EventId, Tick } from "../../core/index.ts";
import {
  envoyNeeds,
  herbNeeds,
  MISSION_ENVOY_POINTS,
  MISSION_HERB_GRAMS,
  MISSION_HERB_MIN_GRAMS,
  MISSION_POINTS_PER_GRAM,
  MISSION_WATCH_RADIUS,
  missionDue,
  missionFits,
  missionLapsed,
  missionLeft,
  pickMission,
  rivalWatchNeeds,
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

describe("llevar la exigencia (novel4-grievance-envoy-mission)", () => {
  it("las exigencias, la más vieja primero; después de cazar y antes de vigilar; una por hecho", () => {
    const rival = "org:2" as EntityRef;
    const needs = envoyNeeds([
      { against: rival, deed: "event:9" as EventId, at: 50 as Tick },
      { against: rival, deed: "event:3" as EventId, at: 10 as Tick },
    ]);
    expect(needs.map((n) => (n.kind === "envoy" ? n.deed : ""))).toEqual(["event:3", "event:9"]);
    const all = [...watchNeeds([{ band: "b", hex: 4, distance: 1 }]), ...needs];
    expect(pickMission(org, "inner", all, [])).toEqual({
      org,
      kind: "envoy",
      against: rival,
      deed: "event:3",
      points: MISSION_ENVOY_POINTS,
    });
    // Ya hay quien lleva la primera: le toca la segunda.
    const out = [taken({ kind: "envoy", against: rival, deed: "event:3" as EventId })];
    expect(pickMission(org, "inner", all, out)).toMatchObject({ kind: "envoy", deed: "event:9" });
    // Un externo no representa a la secta: le toca otra cosa o nada.
    expect(pickMission(org, "outer", needs, [])).toBeUndefined();
  });
});

describe("vigilar el camino hacia la otra secta (novel4-watch-need)", () => {
  it("la más cercana primero; una guardia por secta, aparte de las bandas", () => {
    const a = "org:5" as EntityRef;
    const b = "org:3" as EntityRef;
    const needs = rivalWatchNeeds([
      { against: a, hex: 8, distance: 2 },
      { against: b, hex: 6, distance: 2 },
      { against: "org:9" as EntityRef, hex: 4, distance: 1 },
    ]);
    expect(needs.map((n) => (n.kind === "watch" ? n.against : ""))).toEqual(["org:9", b, a]);
    const one = rivalWatchNeeds([{ against: a, hex: 8, distance: 2 }]);
    const offer = pickMission(org, "inner", one, []);
    expect(offer).toMatchObject({ org, kind: "watch", against: a, hex: 8 });
    expect(offer && "band" in offer).toBe(false);
    // Ya hay quien vigila hacia esa secta: no se da otra; vigilar una banda no la tapa.
    expect(pickMission(org, "inner", one, [taken({ kind: "watch", against: a })])).toBeUndefined();
    expect(pickMission(org, "inner", one, [taken({ kind: "watch", band: "b" })])).toMatchObject({
      against: a,
    });
    // Y la guardia hacia la secta no tapa la de la banda.
    const band = watchNeeds([{ band: "b", hex: 4, distance: 1 }]);
    expect(pickMission(org, "inner", band, [taken({ kind: "watch", against: a })])).toMatchObject({
      band: "b",
    });
  });
});
