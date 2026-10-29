import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type AnimalId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  ANIMAL,
  ASLEEP,
  checkInvariants,
  DRAFT_FATIGUE,
  draftFatigueFactor,
  draftFatigueStep,
  draftRestThreshold,
  ENTITY,
  hexPath,
  INNATE,
  LIVESTOCK,
  LOCATION,
  PERSON,
  PLACE,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { draftDefsOf, draftFor } from "./draft.ts";
import { Life } from "./life.ts";
import { FULL_PROFILE } from "./profile.ts";
import { ROUTINE } from "./routine.ts";
import { NPC_HARVESTED_EVENT } from "./sleepers.ts";

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

  it("el jugador que trabaja el campo suma horas al buey de su hogar; esperando, no", () => {
    const hoursAfter = (verb: "work" | "wait") => {
      const l = Life.create(SEED, content, {
        ...OPTS,
        livestockDraft: true,
        livestockDraftFatigue: true,
      });
      // Un día para que el proceso diario abra el registro de cada buey.
      l.advanceTo(l.now + DAY);
      const w = l.world;
      const t = w.truth;
      const year = w.clock.year;
      const ox = (t.ids(DRAFT_FATIGUE) as string[]).find(
        (id) => (l.now - (t.get(ANIMAL, id as never)?.bornAt ?? 0)) / year >= 2,
      );
      const owner = ox === undefined ? undefined : t.get(ANIMAL, ox as never)?.owner;
      const me = t.get(PERSON, l.player);
      if (ox === undefined || owner === undefined || me === undefined) throw new Error("sin buey");
      // El personaje pasa a ser de la casa del buey y se para en el campo.
      t.set(PERSON, l.player, { ...me, household: owner });
      const field = t.ids(PLACE).flatMap((id) => {
        const p = t.get(PLACE, id);
        return p?.kind === "fields" ? [...p.hexes] : [];
      })[0];
      if (field === undefined) throw new Error("sin campos");
      t.set(LOCATION, l.player, { hex: field });
      const plan: ActionPlan = {
        actor: l.player,
        source: "player",
        root: {
          kind: "do",
          verb,
          args: [{ role: "for", seconds: 2 * 3600 }],
          manner: [],
        },
        manner: [],
        causes: [{ kind: "state", entity: l.player, key: "intent" }],
      };
      l.turn(plan, 1);
      expect(w.ledger.audit()).toEqual([]);
      return t.get(DRAFT_FATIGUE, ox as never)?.hours ?? 0;
    };
    expect(hoursAfter("work")).toBeGreaterThan(hoursAfter("wait"));
  }, 600_000);

  it("los dormidos cansan al buey con sus horas de campo; determinista", () => {
    const run = (fatigue: boolean) => {
      const l = Life.create(SEED, content, {
        ...OPTS,
        livestockDraft: true,
        livestockDraftFatigue: fatigue,
        sleepers: { near: 0, food: "grain" },
      });
      // El personaje se va lejos: la aldea entera (salvo su casa) se duerme y vive por tramos.
      const w = l.world;
      const place = w.truth.ids(PLACE)[0] as string;
      const hexes = (w.truth.get(PLACE, place as never)?.hexes ?? []) as number[];
      let far = hexes[0] as number;
      for (let i = 0; i < 6; i++) {
        far =
          (w.map.neighbors[far] ?? []).find(
            (n) => !hexes.includes(n) && hexPath(w.map, n, hexes[0] as number).length > i,
          ) ?? far;
      }
      w.truth.set(LOCATION, l.player, { hex: far });
      l.advanceTo(l.now + 10 * DAY);
      return l;
    };
    const on = run(true);
    const t = on.world.truth;
    const slept = on.world.log.all().filter((e) => e.kind === NPC_HARVESTED_EVENT);
    expect(slept.length).toBeGreaterThan(0);
    // Un buey cuya casa entera duerme solo se cansa con las horas de los tramos.
    const asleepHouse = (household: string | undefined) => {
      const members = (t.ids(PERSON) as AgentId[]).filter(
        (id) =>
          t.get(PERSON, id)?.household === household && t.get(ENTITY, id)?.endedAt === undefined,
      );
      return members.length > 0 && members.every((id) => t.get(ASLEEP, id) !== undefined);
    };
    const tired = t
      .ids(DRAFT_FATIGUE)
      .filter(
        (id) =>
          asleepHouse(t.get(ANIMAL, id as never)?.owner) &&
          (t.get(DRAFT_FATIGUE, id)?.level ?? 0) > 0,
      );
    expect(tired.length).toBeGreaterThan(0);
    expect(on.world.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: t, log: on.world.log, ledger: on.world.ledger })).toEqual([]);
    expect(run(true).hash().total).toBe(on.hash().total);
    const grams = (l: Life) =>
      harvestGrams(l) +
      l.world.log
        .all()
        .filter((e) => e.kind === NPC_HARVESTED_EVENT)
        .reduce((n, e) => n + (e.data as { grams: number }).grams, 0);
    expect(grams(on)).toBeLessThan(grams(run(false)));
  }, 900_000);
});

describe("el hogar descansa al buey cansado (livestock-draft-rest)", () => {
  it("pura: el cansado descansa al llegar a sus horas; el fresco sigue hasta el tope", () => {
    const ox = content.all(LIVESTOCK).find((s) => s.id === "ox")?.draft;
    if (!ox?.fatigue?.restAbove) throw new Error("el buey sin descanso");
    expect(draftFatigueFactor(ox, { hours: 6, level: 0.3 }, true)).toBe(0);
    expect(draftFatigueFactor(ox, { hours: 6, level: 0.3 })).toBeCloseTo(0.7);
    expect(draftFatigueFactor(ox, { hours: 5, level: 0.3 }, true)).toBeCloseTo(0.7);
    expect(draftFatigueFactor(ox, { hours: 7, level: 0.1 }, true)).toBeCloseTo(0.9);
  });

  it("encendido: los bueyes quedan menos cansados; determinista; el ledger cuadra", () => {
    const run = (rest: boolean) => {
      const l = Life.create(SEED, content, {
        ...OPTS,
        livestockDraft: true,
        livestockDraftFatigue: true,
        livestockDraftRest: rest,
      });
      l.advanceTo(l.now + 10 * DAY);
      return l;
    };
    const tiredness = (l: Life) =>
      (l.world.truth.ids(DRAFT_FATIGUE) as string[]).reduce(
        (n, id) => n + (l.world.truth.get(DRAFT_FATIGUE, id as never)?.level ?? 0),
        0,
      );
    const on = run(true);
    const off = run(false);
    expect(tiredness(off)).toBeGreaterThan(0);
    expect(tiredness(on)).toBeLessThan(tiredness(off));
    expect(on.world.ledger.audit()).toEqual([]);
    expect(
      checkInvariants({ truth: on.world.truth, log: on.world.log, ledger: on.world.ledger }),
    ).toEqual([]);
    expect(run(true).hash().total).toBe(on.hash().total);
    expect(FULL_PROFILE).toMatchObject({ livestockDraftRest: true });
  }, 600_000);
});

describe("quien trabaja al buey decide cuándo descansarlo (livestock-draft-rest-choice)", () => {
  it("pura: el cálido lo descansa antes y el frío lo sigue arreando, dentro de un margen", () => {
    const ox = content.all(LIVESTOCK).find((s) => s.id === "ox")?.draft;
    if (!ox?.fatigue?.restAbove) throw new Error("el buey sin descanso");
    expect(draftRestThreshold(ox, 0)).toBeCloseTo(ox.fatigue.restAbove);
    expect(draftRestThreshold(ox, 0.6)).toBeLessThan(ox.fatigue.restAbove);
    expect(draftRestThreshold(ox, -0.6)).toBeGreaterThan(ox.fatigue.restAbove);
    expect(draftRestThreshold(ox, 10)).toBe(0.05);
    expect(draftRestThreshold(ox, -10)).toBe(0.95);
    expect(draftRestThreshold({ ...ox, fatigue: undefined }, 1)).toBeUndefined();
    const row = { hours: 6, level: 0.3 };
    expect(draftFatigueFactor(ox, row, true, draftRestThreshold(ox, -0.6))).toBeCloseTo(0.7);
    expect(draftFatigueFactor(ox, row, true, draftRestThreshold(ox, 0.6))).toBe(0);
  });

  it("con el mismo buey cansado, el cálido de la casa lo deja y el frío lo usa; apagado, el fijo", () => {
    const life = Life.create(SEED, content, OPTS);
    const t = life.world.truth;
    const year = life.world.clock.year;
    const o0 = { defs: draftDefsOf(content.all(LIVESTOCK)), year, workAge: ROUTINE.workAge };
    const worker0 = (owner: string) =>
      (t.ids(PERSON) as AgentId[]).sort().find((id) => {
        const p = t.get(PERSON, id);
        return (
          p !== undefined &&
          p.household === owner &&
          t.get(ENTITY, id)?.endedAt === undefined &&
          (life.now - p.born) / year >= ROUTINE.workAge
        );
      }) as AgentId;
    const ox = (t.ids(ANIMAL) as AnimalId[]).find((id) => {
      const a = t.get(ANIMAL, id);
      return (
        a?.species === "ox" &&
        (life.now - a.bornAt) / year >= 2 &&
        t.get(ENTITY, id)?.endedAt === undefined &&
        draftFor(t, worker0(a.owner), life.now, o0)?.animals.includes(id) === true
      );
    });
    if (ox === undefined) throw new Error("sin buey adulto");
    const worker = worker0(t.get(ANIMAL, ox)?.owner as string);
    if (worker === undefined) throw new Error("sin gente");
    t.set(DRAFT_FATIGUE, ox, { hours: 6, level: 0.3 });
    const o = { ...o0, fatigue: true, rest: true };
    const pulls = (warmth: number, restChoice: boolean) => {
      t.set(INNATE, worker, { ...t.get(INNATE, worker), warmth });
      return draftFor(t, worker, life.now, { ...o, restChoice })?.animals.includes(ox) === true;
    };
    expect(pulls(0.6, true)).toBe(false);
    expect(pulls(-0.6, true)).toBe(true);
    expect(pulls(-0.6, false)).toBe(false);
    expect(FULL_PROFILE).toMatchObject({ livestockDraftRestChoice: true });
  }, 300_000);
});
