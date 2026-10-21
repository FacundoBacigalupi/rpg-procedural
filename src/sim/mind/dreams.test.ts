import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, type PlaceRef, Rng, type Seed } from "../../core/index.ts";
import { composeDream, DREAM_MIN_QUALITY, MAX_DREAM_SOURCES, THEME_SYMBOLS } from "./dreams.ts";
import { formMemory, type Memory } from "./memory.ts";
import type { Theme } from "./mind.ts";

const A = "agent:1" as AgentId;
const PLACE = { kind: "none" } as unknown as PlaceRef;
const DAY = 86_400;

const mem = (i: number, intensity: number, at = 0, valence = -0.6): Memory =>
  formMemory({
    eventId: `event:${i}` as EventId,
    kind: "combat.fight",
    with: [],
    place: PLACE,
    at,
    intensity,
    valence,
  });

const themeOf = (): Theme => "violence";
const rng = (s = 1) => Rng.root(s as unknown as Seed).fork("dream", A, 0);
const base = (memories: Memory[], quality = 0.8, now = DAY) => ({
  dreamer: A,
  night: 0,
  memories,
  now,
  quality,
  themeOf,
  rng: rng(),
});

describe("sueños con contenido", () => {
  it("sin materia o con sueño pésimo no hay sueño", () => {
    expect(composeDream(base([]))).toBeUndefined();
    expect(composeDream(base([mem(1, 0.9)], DREAM_MIN_QUALITY - 0.01))).toBeUndefined();
    // Vieja y floja: no entra.
    expect(composeDream(base([mem(1, 0.2, 0)], 0.8, 30 * DAY))).toBeUndefined();
  });

  it("las fuentes son memorias reales, topadas y ordenadas por peso", () => {
    const ms = [0, 1, 2, 3, 4].map((i) => mem(i, 0.3 + i * 0.1, 0));
    const d = composeDream(base(ms));
    expect(d?.sources.length).toBe(MAX_DREAM_SOURCES);
    for (const s of d?.sources ?? []) expect(ms.some((m) => m.eventId === s)).toBe(true);
    expect(d?.sources).toContain("event:4");
  });

  it("una memoria vieja pero intensa vuelve; el tono sale de su valencia", () => {
    const d = composeDream(base([mem(1, 0.9, 0, -0.8)], 0.8, 30 * DAY));
    expect(d?.sources).toEqual(["event:1"]);
    expect(d?.valence).toBeLessThan(0);
    expect(d?.arousal).toBeCloseTo(0.9);
    expect(d?.nightmare).toBe(false);
  });

  it("los símbolos salen del vocabulario del tema y la pesadilla fija sus causas primero", () => {
    const ms = [mem(1, 0.9), mem(2, 0.4), mem(3, 0.5), mem(4, 0.6)];
    const d = composeDream({ ...base(ms), nightmareCauses: ["event:2" as EventId] });
    expect(d?.nightmare).toBe(true);
    expect(d?.sources).toContain("event:2");
    for (const s of d?.symbols ?? []) expect(THEME_SYMBOLS.violence).toContain(s);
  });

  it("determinista con el mismo stream", () => {
    const ms = [mem(1, 0.9), mem(2, 0.7)];
    expect(composeDream(base(ms))).toEqual(composeDream(base(ms)));
  });
});
