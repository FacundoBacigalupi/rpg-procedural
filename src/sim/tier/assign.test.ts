import { describe, expect, it } from "vitest";
import { type AgentId, makeId, type Tick } from "../../core/index.ts";
import { WorldTruth } from "../world/index.ts";
import {
  assignTiers,
  DEFAULT_TIER_CONFIG,
  type EngineTier,
  importanceScore,
  TIER,
  type TierCandidate,
  tierChanges,
} from "./assign.ts";

const a = (n: number) => makeId("agent", n);
const cand = (n: number, over: Partial<TierCandidate> = {}): TierCandidate => ({
  id: a(n),
  region: "r1",
  inActiveZone: false,
  bonded: false,
  importance: 0,
  ...over,
});

describe("sim.tier.assign", () => {
  it("importancia: suma ponderada con cada dimensión acotada a 0..1", () => {
    const zero = { power: 0, office: 0, longevity: 0, centrality: 0, activity: 0, uniqueness: 0 };
    expect(importanceScore(zero)).toBe(0);
    expect(importanceScore({ ...zero, power: 9 })).toBe(importanceScore({ ...zero, power: 1 }));
    expect(importanceScore({ ...zero, power: 1, office: 1 })).toBeGreaterThan(
      importanceScore({ ...zero, power: 1 }),
    );
  });

  it("tier 4 por vínculo y no baja; 2 en zona activa; 1 lejos", () => {
    const t = assignTiers([
      cand(1, { bonded: true }),
      cand(2, { previous: 4 }),
      cand(3, { inActiveZone: true }),
      cand(4),
    ]);
    expect([t.get(a(1)), t.get(a(2)), t.get(a(3)), t.get(a(4))]).toEqual([4, 4, 2, 1]);
  });

  it("histéresis: entra con enter, se queda hasta bajar de exit", () => {
    const { enter, exit } = DEFAULT_TIER_CONFIG;
    const mid = (enter + exit) / 2;
    expect(assignTiers([cand(1, { importance: mid })]).get(a(1))).toBe(1);
    expect(assignTiers([cand(1, { importance: mid, previous: 3 })]).get(a(1))).toBe(3);
    expect(assignTiers([cand(1, { importance: exit - 0.1, previous: 3 })]).get(a(1))).toBe(1);
    expect(assignTiers([cand(1, { importance: enter })]).get(a(1))).toBe(3);
  });

  it("cupos: quedan los de mayor puntaje; el resto baja", () => {
    const cfg = { enter: 1, exit: 0.5, perRegion: 2, world: 3 };
    const cs = [
      cand(1, { importance: 5 }),
      cand(2, { importance: 9 }),
      cand(3, { importance: 7, inActiveZone: true }),
      cand(4, { importance: 5 }),
      cand(5, { importance: 8, region: "r2" }),
      cand(6, { importance: 6, region: "r2" }),
    ];
    const t = assignTiers(cs, cfg);
    // r1 cupo 2: queda 2 (9) y 3 (7); r2: 5 (8) llena el cupo del mundo (3); el resto baja.
    expect(cs.map((c) => t.get(c.id))).toEqual([1, 3, 3, 1, 3, 1]);
    const t2 = assignTiers(
      [cand(1, { importance: 9 }), cand(2, { importance: 8, inActiveZone: true })],
      { ...cfg, perRegion: 1 },
    );
    expect(t2.get(a(2))).toBe(2);
  });

  it("determinismo: el orden de entrada no cambia el resultado", () => {
    const cs = Array.from({ length: 30 }, (_, i) =>
      cand(i + 1, {
        importance: (i * 7) % 10,
        region: `r${i % 3}`,
        ...(i % 4 === 0 ? { previous: 3 as const } : {}),
      }),
    );
    const dump = (m: Map<AgentId, EngineTier>) => [...m].sort(([p], [q]) => (p < q ? -1 : 1));
    expect(dump(assignTiers(cs))).toEqual(dump(assignTiers([...cs].reverse())));
  });

  it("registro: solo escribe lo que cambió", () => {
    const truth = new WorldTruth();
    const assigned = new Map<AgentId, EngineTier>([
      [a(1), 3],
      [a(2), 1],
    ]);
    const imp = new Map<AgentId, number>([[a(1), 6]]);
    const first = tierChanges(truth, assigned, imp, 10 as Tick);
    expect(first).toHaveLength(2);
    truth.set(TIER, a(1), { tier: 3, since: 10 as Tick, importance: 6 });
    expect(tierChanges(truth, assigned, imp, 20 as Tick)).toHaveLength(1);
    expect(truth.get(TIER, a(1))?.tier).toBe(3);
  });
});
