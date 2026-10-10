import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, PlanetClock } from "../../core/index.ts";
import { BELIEFS, cueCraving, LOCATION, learnCues, WorldTruth } from "../../sim/index.ts";
import {
  cueLocalOf,
  objectsInView,
  objectsSeen,
  peopleInView,
  placeHoldersInView,
} from "./cue-local.ts";
import { cueContextOf } from "./substances.ts";

const clock = { day: 24000 } as unknown as PlanetClock;
const me = "agent:1" as AgentId;
const at = (subject: string, hex: number, asOf: number) => ({
  prop: { kind: "attr", subject, attr: "at" },
  value: { hex },
  confidence: 1,
  asOf,
  learnedAt: asOf,
  sources: [],
  salience: 1,
  measured: asOf,
});

describe("life.cueLocalOf", () => {
  const t = new WorldTruth();
  t.set(LOCATION, me as unknown as EntityRef, { hex: 5 } as never);
  // Verdad: agent:2 está en el hex, agent:3 no; el personaje cree lo contrario.
  t.set(LOCATION, "agent:2" as unknown as EntityRef, { hex: 5 } as never);
  t.set(LOCATION, "agent:3" as unknown as EntityRef, { hex: 9 } as never);
  t.set(
    BELIEFS,
    me as unknown as EntityRef,
    {
      items: [at("agent:3", 5, 1000), at("agent:2", 9, 1000)],
    } as never,
  );

  it("cree presente a quien cree en el hex y hora por longitud", () => {
    const l = cueLocalOf(t, me, 1000, clock, -120);
    expect(l.believedPresent).toEqual(["agent:3"]);
    expect(l.hourOffset).toBe(-8);
    expect(cueContextOf(t, me, 6000, clock, l).hour).toBe(22);
  });

  it("sin opt-in el entorno sigue siendo el de la verdad", () => {
    expect(cueContextOf(t, me, 6000, clock).people).toEqual(["agent:2"]);
  });

  it("objectsSeen: solo los bienes que cree tener a mano, sin repetir y ordenados", () => {
    const have = (g: string) => ({ wine: 2, tea: 0.5, pipe: 1 })[g as "wine"] ?? 0;
    expect(objectsSeen(["wine", "tea", "pipe", "wine", "x"], have)).toEqual(["pipe", "wine"]);
    expect(objectsSeen([], have)).toEqual([]);
  });

  it("peopleInView: solo quien de verdad está en el mismo lugar (no lo que cree)", () => {
    expect(peopleInView(t, me)).toEqual(["agent:2"]);
    expect(peopleInView(new WorldTruth(), me)).toEqual([]);
  });

  it("objectsInView: suma lotes a la vista de otros y puestos, sin repetir", () => {
    const carried = (g: string) => (g === "wine" ? 1 : 0);
    const stall = (g: string) => (g === "tea" || g === "wine" ? 3 : 0);
    expect(objectsInView(["wine", "tea", "pipe"], [carried, stall])).toEqual(["tea", "wine"]);
    expect(objectsInView(["wine"], [])).toEqual([]);
  });

  it("ver el objeto sube el ansia por señales; sin verlo, no", () => {
    const l = cueLocalOf(t, me, 1000, clock, 0);
    const half = 60 * 24000;
    const cues = learnCues(
      [],
      "wine",
      cueContextOf(t, me, 6000, clock, { ...l, objects: ["wine"] }),
      6000,
      half,
    ).filter((c) => c.kind === "object");
    const seen = objectsSeen(["wine"], () => 1);
    const withSeen = cueCraving(
      cues,
      cueContextOf(t, me, 6000, clock, { ...l, objects: seen }),
      6000,
      half,
    );
    const without = cueCraving(cues, cueContextOf(t, me, 6000, clock, l), 6000, half);
    expect(withSeen).toBeGreaterThan(without);
  });

  it("una señal por objeto se aprende y despierta ansia solo con el objeto", () => {
    const l = cueLocalOf(t, me, 1000, clock, 0);
    const withObj = cueContextOf(t, me, 6000, clock, { ...l, objects: ["wine"] });
    expect(withObj.objects).toEqual(["wine"]);
    const cues = learnCues([], "wine", withObj, 6000, 60 * 24000);
    expect(cues.some((c) => c.kind === "object" && c.key === "obj:wine")).toBe(true);
    const bare = cueContextOf(t, me, 6000, clock, l);
    const onlyObj = cues.filter((c) => c.kind === "object");
    expect(cueCraving(onlyObj, bare, 6000, 60 * 24000)).toBe(0);
    expect(cueCraving(onlyObj, withObj, 6000, 60 * 24000)).toBeGreaterThan(0);
  });
});

describe("life.placeHoldersInView (suelo)", () => {
  const stall = { kind: "settlement", settlement: "settlement:1" } as never;
  const lot = { kind: "cell", cell: "cell:7" } as never;
  const cues = {
    stalls: (hex: number) => (hex === 5 ? [stall] : []),
    ground: (hex: number, space: string | undefined) =>
      hex === 5 && space === undefined ? [lot] : [],
  };

  it("suma puestos y suelo solo del hex y espacio donde está", () => {
    expect(placeHoldersInView(cues, { hex: 5 })).toEqual([stall, lot]);
    expect(placeHoldersInView(cues, { hex: 5, space: "room" })).toEqual([stall]);
    expect(placeHoldersInView(cues, { hex: 9 })).toEqual([]);
    expect(placeHoldersInView(cues, undefined)).toEqual([]);
    expect(placeHoldersInView({ stalls: cues.stalls }, { hex: 5 })).toEqual([stall]);
  });

  it("el suelo a la vista despierta el objeto como cualquier otro lote", () => {
    const amounts = new Map<unknown, number>([[lot, 2]]);
    const view = placeHoldersInView(cues, { hex: 5 }).map(
      (h) => (g: string) => (g === "wine" ? (amounts.get(h) ?? 0) : 0),
    );
    expect(objectsInView(["wine", "tea"], view)).toEqual(["wine"]);
    const far = placeHoldersInView(cues, { hex: 9 }).map(() => () => 1);
    expect(objectsInView(["wine"], far)).toEqual([]);
  });
});
