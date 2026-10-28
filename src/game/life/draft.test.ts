import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  ANIMAL,
  checkInvariants,
  DRAFT_FATIGUE,
  draftFatigueFactor,
  draftFatigueStep,
  ENTITY,
  LIVESTOCK,
  PERSON,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { draftDefsOf, draftFor } from "./draft.ts";
import { Life } from "./life.ts";
import { FULL_PROFILE } from "./profile.ts";
import { ROUTINE } from "./routine.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const DAY = 86_400;
// Seed 3: con `herdAgeYears` (life-57) todos los bueyes empiezan adultos en cualquier seed.
const SEED = 3;
const OPTS = { frequency: 8, villageLivestock: true } as const;
const harvestGrams = (l: Life) =>
  l.world.log
    .all()
    .filter((e) => e.kind === "routine.harvested")
    .reduce((n, e) => n + (e.data as { grams: number }).grams, 0);

describe("el buey tira del arado (livestock-yield-draft)", () => {
  it("la gente del hogar con buey adulto se reparte la ganancia; sin buey o joven, a mano", () => {
    const life = Life.create(SEED, content, OPTS);
    const t = life.world.truth;
    const year = life.world.clock.year;
    const o = { defs: draftDefsOf(content.all(LIVESTOCK)), year, workAge: ROUTINE.workAge };
    expect([...o.defs.keys()]).toEqual(["ox"]);
    const workersOf = (household: string | undefined) =>
      (t.ids(PERSON) as AgentId[]).filter((id) => {
        const p = t.get(PERSON, id);
        return (
          p !== undefined &&
          p.household === household &&
          t.get(ENTITY, id)?.endedAt === undefined &&
          (life.now - p.born) / year >= ROUTINE.workAge
        );
      });
    const oxen = (t.ids(ANIMAL) as string[]).filter(
      (id) => t.get(ANIMAL, id as never)?.species === "ox",
    );
    const ageOf = (id: string) => (life.now - (t.get(ANIMAL, id as never)?.bornAt ?? 0)) / year;
    const grown = oxen.filter((id) => ageOf(id) >= 2);
    expect(grown.length).toBeGreaterThan(0);
    for (const ox of oxen) {
      const owner = t.get(ANIMAL, ox as never)?.owner;
      const workers = workersOf(owner);
      const pulling = grown.filter((id) => t.get(ANIMAL, id as never)?.owner === owner);
      for (const w of workers) {
        const got = draftFor(t, w, life.now, o);
        if (pulling.length === 0) {
          expect(got).toBeUndefined();
          continue;
        }
        // Un puesto por buey repartido entre toda la gente en edad de trabajar.
        expect(got?.animals).toEqual(pulling);
        expect(got?.rate).toBeCloseTo(1 + 0.5 * Math.min(1, pulling.length / workers.length));
      }
    }
    const [w] = workersOf(t.get(ANIMAL, grown[0] as never)?.owner);
    if (w === undefined) throw new Error("sin gente");
    expect(draftFor(t, w, life.now, { ...o, defs: new Map() })).toBeUndefined();
  }, 300_000);

  it("encendido: la cosecha con buey cita al animal y rinde más; determinista; el ledger cuadra", () => {
    const run = (draft: boolean) => {
      const l = Life.create(SEED, content, { ...OPTS, livestockDraft: draft });
      l.advanceTo(l.now + 10 * DAY);
      return l;
    };
    const on = run(true);
    const pulled = on.world.log
      .all()
      .filter((e) => e.kind === "routine.harvested" && (e.data as { draft?: string[] }).draft);
    expect(pulled.length).toBeGreaterThan(0);
    for (const e of pulled) {
      for (const ox of (e.data as { draft: string[] }).draft) {
        expect(on.world.truth.get(ANIMAL, ox as never)?.species).toBe("ox");
        expect(e.causes).toContainEqual({ kind: "state", entity: ox, key: "draft" });
      }
    }
    expect(on.world.ledger.audit()).toEqual([]);
    expect(
      checkInvariants({ truth: on.world.truth, log: on.world.log, ledger: on.world.ledger }),
    ).toEqual([]);
    expect(run(true).hash().total).toBe(on.hash().total);
    const off = run(false);
    expect(off.world.log.all().some((e) => (e.data as { draft?: unknown } | null)?.draft)).toBe(
      false,
    );
    expect(harvestGrams(on)).toBeGreaterThan(harvestGrams(off));
    expect(FULL_PROFILE).toMatchObject({ livestockDraft: true });
  }, 600_000);
});

describe("lo que le cuesta al buey (livestock-draft-cost)", () => {
  it("encendido: los días de campo el buey come más y su comida cita el tiro; determinista", () => {
    const run = (cost: boolean) => {
      const l = Life.create(SEED, content, {
        ...OPTS,
        livestockFeed: true,
        livestockDraft: true,
        livestockDraftCost: cost,
      });
      l.advanceTo(l.now + 10 * DAY);
      return l;
    };
    const fed = (l: Life) => l.world.log.all().filter((e) => e.kind === "living.animal_fed");
    const grams = (l: Life) =>
      fed(l).reduce(
        (n, e) =>
          n +
          Object.values((e.data as { grams: Record<string, number> }).grams).reduce(
            (a, b) => a + b,
            0,
          ),
        0,
      );
    const on = run(true);
    const pulling = fed(on).flatMap((e) =>
      e.causes.filter((c) => c.kind === "state" && c.key === "draft"),
    );
    expect(pulling.length).toBeGreaterThan(0);
    for (const c of pulling) {
      expect(on.world.truth.get(ANIMAL, (c as { entity: string }).entity as never)?.species).toBe(
        "ox",
      );
    }
    expect(on.world.ledger.audit()).toEqual([]);
    expect(
      checkInvariants({ truth: on.world.truth, log: on.world.log, ledger: on.world.ledger }),
    ).toEqual([]);
    expect(run(true).hash().total).toBe(on.hash().total);
    const off = run(false);
    expect(
      fed(off).some((e) => e.causes.some((c) => c.kind === "state" && c.key === "draft")),
    ).toBe(false);
    expect(grams(on)).toBeGreaterThan(grams(off));
    expect(FULL_PROFILE).toMatchObject({ livestockDraftCost: true });
  }, 600_000);
});

describe("el buey se cansa (livestock-draft-fatigue)", () => {
  it("pura: el cansancio sube con las horas de más y baja con el descanso", () => {
    const ox = content.all(LIVESTOCK).find((s) => s.id === "ox")?.draft;
    if (!ox?.fatigue) throw new Error("el buey sin cansancio");
    expect(draftFatigueStep(0, 6, ox)).toBe(0);
    expect(draftFatigueStep(0, 9, ox)).toBeCloseTo(0.5 * 0.5);
    expect(draftFatigueStep(0.4, 0, ox)).toBeCloseTo(0.2);
    expect(draftFatigueStep(1, 20, ox)).toBe(1);
    expect(draftFatigueFactor(ox, undefined)).toBe(1);
    expect(draftFatigueFactor(ox, { hours: 2, level: 0.25 })).toBe(0.75);
    expect(draftFatigueFactor(ox, { hours: 8, level: 0 })).toBe(0);
  });

  it("encendido: las horas de campo cansan al buey y la cosecha rinde menos; determinista", () => {
    const run = (fatigue: boolean) => {
      const l = Life.create(SEED, content, {
        ...OPTS,
        livestockDraft: true,
        livestockDraftFatigue: fatigue,
      });
      l.advanceTo(l.now + 10 * DAY);
      return l;
    };
    const on = run(true);
    const t = on.world.truth;
    const rows = t.ids(DRAFT_FATIGUE);
    expect(rows.length).toBeGreaterThan(0);
    for (const id of rows) expect(t.get(ANIMAL, id as never)?.species).toBe("ox");
    // Algún buey trabajó de más algún día y quedó cansado.
    const tired = rows.filter((id) => (t.get(DRAFT_FATIGUE, id)?.level ?? 0) > 0);
    expect(tired.length).toBeGreaterThan(0);
    expect(on.world.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: t, log: on.world.log, ledger: on.world.ledger })).toEqual([]);
    expect(run(true).hash().total).toBe(on.hash().total);
    const off = run(false);
    expect(off.world.truth.ids(DRAFT_FATIGUE)).toEqual([]);
    expect(harvestGrams(on)).toBeLessThan(harvestGrams(off));
    expect(FULL_PROFILE).toMatchObject({ livestockDraftFatigue: true });
  }, 600_000);
});
