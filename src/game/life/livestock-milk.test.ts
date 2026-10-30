import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  ANIMAL,
  checkInvariants,
  herdSpecies,
  LACTATING,
  LIVESTOCK,
  lactationFactor,
  nursedYoung,
  PERSON,
  sucklingShare,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { FULL_PROFILE } from "./profile.ts";

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
const OPTS = {
  frequency: 8,
  villageLivestock: true,
  livestockLife: true,
  livestockYield: true,
} as const;

describe("las cabras dan leche después de parir (livestock-yield-milk)", () => {
  it("pura: las lecheras solo llegan con su opción", () => {
    const all = content.all(LIVESTOCK);
    expect(herdSpecies(all, new Set()).map((s) => s.id)).not.toContain("goat");
    expect(herdSpecies(all, new Set(["dairy"])).map((s) => s.id)).toContain("goat");
  });

  it("encendido: la leche sale de cabras que parieron hace poco; apagado, no hay cabras", () => {
    const run = (dairy: boolean) => {
      const l = Life.create(7, content, { ...OPTS, livestockDairy: dairy });
      l.advanceTo(l.now + 150 * DAY);
      return l;
    };
    const on = run(true);
    const w = on.world;
    const goats = w.truth.ids(ANIMAL).filter((id) => w.truth.get(ANIMAL, id)?.species === "goat");
    expect(goats.length).toBeGreaterThan(0);
    const births = w.log
      .all()
      .filter(
        (e) =>
          e.kind === "living.animal_born" && (e.data as { species: string }).species === "goat",
      );
    expect(births.length).toBeGreaterThan(0);
    const milk = w.log
      .all()
      .filter(
        (e) => e.kind === "living.animal_yield" && (e.data as { good: string }).good === "milk",
      );
    expect(milk.length).toBeGreaterThan(0);
    // Cada cabra que dio leche había parido antes, ese mismo día o hasta 240 días atrás.
    for (const e of milk) {
      for (const id of (e.data as { from: string[] }).from) {
        const born = births.filter(
          (b) => (b.data as { mother: string }).mother === id && b.tick <= e.tick,
        );
        expect(born.length).toBeGreaterThan(0);
        expect(w.truth.get(ANIMAL, id as never)).toMatchObject({ species: "goat", sex: "female" });
      }
    }
    for (const b of births) {
      const mother = (b.data as { mother: string }).mother;
      expect(w.truth.get(LACTATING, mother as never)?.since).toBeGreaterThanOrEqual(b.tick);
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run(true).hash().total).toBe(on.hash().total);
    const off = run(false);
    const offGoats = off.world.truth
      .ids(ANIMAL)
      .filter((id) => off.world.truth.get(ANIMAL, id)?.species === "goat");
    expect(offGoats).toEqual([]);
    expect(off.world.truth.ids(LACTATING)).toEqual([]);
    expect(FULL_PROFILE).toMatchObject({ livestockDairy: true });
  }, 600_000);
});

describe("la leche sigue la curva de lactancia (livestock-milk-curve)", () => {
  it("pura: poca al parir, el pico a los 50 días, baja al final; media 1 en la temporada", () => {
    const milk = content
      .all(LIVESTOCK)
      .find((s) => s.id === "goat")
      ?.yields?.find((y) => y.good === "milk");
    if (!milk?.lactationDays || !milk.lactationCurve) throw new Error("la cabra sin curva");
    const f = (d: number) => lactationFactor(milk, d);
    let sum = 0;
    for (let d = 1; d <= milk.lactationDays; d++) sum += f(d);
    expect(sum / milk.lactationDays).toBeCloseTo(1, 6);
    expect(f(1)).toBeLessThan(f(50));
    expect(f(49)).toBeLessThanOrEqual(f(50));
    expect(f(51)).toBeLessThanOrEqual(f(50));
    expect(f(240)).toBeLessThan(f(50));
    expect(f(0)).toBe(f(1));
    expect(lactationFactor({ ...milk, lactationCurve: undefined }, 50)).toBe(1);
  });

  it("encendido: cada litro pesa según los días desde el parto; determinista", () => {
    const run = (curve: boolean) => {
      const l = Life.create(7, content, {
        ...OPTS,
        livestockDairy: true,
        livestockMilkCurve: curve,
      });
      l.advanceTo(l.now + 150 * DAY);
      return l;
    };
    const milkOf = (l: Life) =>
      l.world.log
        .all()
        .filter(
          (e) => e.kind === "living.animal_yield" && (e.data as { good: string }).good === "milk",
        )
        .map((e) => e.data as { grams: number; from: string[] });
    const on = run(true);
    const got = milkOf(on);
    expect(got.length).toBeGreaterThan(0);
    expect(got.some((e) => e.grams !== e.from.length * 1000)).toBe(true);
    for (const e of milkOf(run(false))) expect(e.grams).toBe(e.from.length * 1000);
    expect(on.world.ledger.audit()).toEqual([]);
    expect(run(true).hash().total).toBe(on.hash().total);
    expect(FULL_PROFILE).toMatchObject({ livestockMilkCurve: true });
  }, 600_000);
});

describe("la cría mama su parte (livestock-milk-suckle)", () => {
  it("pura: cada cría viva se toma su parte los primeros días; después, nada", () => {
    const milk = content
      .all(LIVESTOCK)
      .find((s) => s.id === "goat")
      ?.yields?.find((y) => y.good === "milk");
    if (!milk?.suckle) throw new Error("la cabra sin cría que mame");
    expect(sucklingShare(milk, 0, 1)).toBeCloseTo(milk.suckle.sharePerYoung);
    expect(sucklingShare(milk, 10, 2)).toBeCloseTo(Math.min(1, 2 * milk.suckle.sharePerYoung));
    expect(sucklingShare(milk, 10, 0)).toBe(0);
    expect(sucklingShare(milk, milk.suckle.days, 1)).toBe(0);
    expect(sucklingShare(milk, 0, 10)).toBe(1);
    expect(sucklingShare({ ...milk, suckle: undefined }, 0, 1)).toBe(0);
  });

  it("encendido: a la casa le llega menos leche y lo mamado queda en el evento; determinista", () => {
    const run = (suckle: boolean) => {
      const l = Life.create(7, content, {
        ...OPTS,
        livestockDairy: true,
        livestockSuckle: suckle,
      });
      l.advanceTo(l.now + 150 * DAY);
      return l;
    };
    const milkOf = (l: Life) =>
      l.world.log
        .all()
        .filter(
          (e) => e.kind === "living.animal_yield" && (e.data as { good: string }).good === "milk",
        )
        .map((e) => e.data as { grams: number; from: string[]; suckled?: number });
    const on = run(true);
    const got = milkOf(on);
    expect(got.some((e) => (e.suckled ?? 0) > 0)).toBe(true);
    for (const e of got) expect(e.grams + (e.suckled ?? 0)).toBe(e.from.length * 1000);
    const w = on.world;
    const withYoung = w.truth
      .ids(LACTATING)
      .filter((id) => (w.truth.get(LACTATING, id)?.young?.length ?? 0) > 0);
    expect(withYoung.length).toBeGreaterThan(0);
    expect(milkOf(run(false)).every((e) => e.suckled === undefined)).toBe(true);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run(true).hash().total).toBe(on.hash().total);
    expect(FULL_PROFILE).toMatchObject({ livestockSuckle: true });
  }, 600_000);
});

describe("la cría que mama no come de la casa; la huérfana pasa hambre (livestock-milk-orphan)", () => {
  it("encendido: los cabritos que maman no comen de la casa; menos comida al ganado; determinista", () => {
    const species = new Map(content.all(LIVESTOCK).map((s) => [s.id, s]));
    const run = (orphan: boolean, check = false) => {
      const l = Life.create(7, content, {
        ...OPTS,
        livestockFeed: true,
        livestockDairy: true,
        livestockSuckle: true,
        livestockOrphan: orphan,
      });
      let seen = 0;
      for (let d = 0; d < 150; d++) {
        const from = l.now;
        const before = check ? nursedYoung(l.world.truth, from, l.world.clock.year, species) : null;
        l.advanceTo(from + DAY);
        if (!before) continue;
        const after = nursedYoung(l.world.truth, l.now, l.world.clock.year, species);
        const both = [...before].filter((k) => after.has(k));
        seen += both.length;
        for (const e of l.world.log.all()) {
          if (e.tick <= from || e.kind !== "living.animal_fed") continue;
          const eaters = (e.data as { eaters: string[] }).eaters;
          for (const k of both) expect(eaters).not.toContain(k);
        }
      }
      return { l, seen };
    };
    const fedGrams = (l: Life) =>
      l.world.log
        .all()
        .filter((e) => e.kind === "living.animal_fed")
        .flatMap((e) => Object.values((e.data as { grams: Record<string, number> }).grams))
        .reduce((n, g) => n + g, 0);
    const on = run(true, true);
    expect(on.seen).toBeGreaterThan(0);
    const off = run(false);
    expect(fedGrams(on.l)).toBeLessThan(fedGrams(off.l));
    const w = on.l.world;
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run(true).l.hash().total).toBe(on.l.hash().total);
    expect(FULL_PROFILE).toMatchObject({ livestockOrphan: true });
  }, 600_000);
});

describe("otra madre adopta a la huérfana (livestock-milk-foster)", () => {
  it("encendido: la cría que su madre deja de amamantar pasa a otra de la casa; apagado, no; determinista", () => {
    const run = (foster: boolean) => {
      const l = Life.create(7, content, {
        ...OPTS,
        livestockFeed: true,
        livestockDairy: true,
        livestockSuckle: true,
        livestockOrphan: true,
        livestockFoster: foster,
      });
      const t = l.world.truth;
      // El primer día con dos madres de la misma casa amamantando: una deja a sus crías.
      let orphans: string[] = [];
      for (let d = 0; d < 400 && orphans.length === 0; d++) {
        l.advanceTo(l.now + DAY);
        const nursing = [...t.ids(LACTATING)].sort().filter((id) => {
          const k = t.get(LACTATING, id as never);
          return (
            (k?.young?.length ?? 0) > 0 &&
            ((l.now - (k?.since ?? 0)) * 365) / l.world.clock.year < 20
          );
        });
        for (const m of nursing) {
          const owner = t.get(ANIMAL, m as never)?.owner;
          const other = nursing.find((n) => n !== m && t.get(ANIMAL, n as never)?.owner === owner);
          if (other === undefined) continue;
          orphans = [...(t.get(LACTATING, m as never)?.young ?? [])];
          t.deleteRaw(LACTATING.name, m);
          break;
        }
      }
      expect(orphans.length).toBeGreaterThan(0);
      const from = l.now;
      l.advanceTo(from + 60 * DAY);
      const fostered = l.world.log
        .all()
        .filter((e) => e.tick > from && e.kind === "living.animal_fostered");
      return { l, orphans, fostered };
    };
    const on = run(true);
    expect(on.fostered.length).toBeGreaterThan(0);
    const t = on.l.world.truth;
    for (const e of on.fostered) {
      const { mother, young } = e.data as { mother: string; young: string };
      expect(on.orphans).toContain(young);
      expect(t.get(LACTATING, mother as never)?.young ?? []).toContain(young);
    }
    const adopted = new Set(on.fostered.map((e) => (e.data as { young: string }).young));
    expect(adopted.size).toBe(on.fostered.length);
    expect(run(false).fostered).toEqual([]);
    const w = on.l.world;
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run(true).l.hash().total).toBe(on.l.hash().total);
    expect(FULL_PROFILE).toMatchObject({ livestockFoster: true });
  }, 600_000);
});

describe("el ordeñe es trabajo del hogar (livestock-milk-work)", () => {
  it("encendido: alguien del hogar ordeña; sin nadie que ordeñe, se pierde y la cabra se seca", () => {
    const run = (work: boolean, owner?: string) => {
      const l = Life.create(7, content, {
        ...OPTS,
        livestockDairy: true,
        livestockSuckle: true,
        livestockMilkWork: work,
      });
      const w = l.world;
      if (owner !== undefined) {
        // Ese hogar se queda sin nadie que ordeñe (se mudan a otro).
        const people = w.truth.ids(PERSON).sort();
        const other = people
          .map((p) => w.truth.get(PERSON, p)?.household)
          .find((h) => h !== undefined && h !== owner);
        if (!other) throw new Error("sin otro hogar");
        for (const p of people) {
          const r = w.truth.get(PERSON, p);
          if (r?.household === owner) w.truth.set(PERSON, p, { ...r, household: other });
        }
      }
      l.advanceTo(l.now + 150 * DAY);
      return l;
    };
    const milkOf = (l: Life) =>
      l.world.log
        .all()
        .filter(
          (e) => e.kind === "living.animal_yield" && (e.data as { good: string }).good === "milk",
        )
        .map(
          (e) =>
            e.data as {
              owner: string;
              grams: number;
              from: string[];
              suckled?: number;
              lost?: number;
              unmilked?: string[];
              milkedBy?: string[];
            },
        );
    const on = run(true);
    const got = milkOf(on);
    expect(got.some((e) => (e.milkedBy?.length ?? 0) > 0)).toBe(true);
    for (const e of got) {
      expect(e.grams + (e.suckled ?? 0) + (e.lost ?? 0)).toBe(e.from.length * 1000);
    }
    const owner = got[0]?.owner;
    if (owner === undefined) throw new Error("sin leche");
    const theirs = milkOf(run(true, owner)).filter((e) => e.owner === owner);
    expect(theirs.length).toBeGreaterThan(0);
    for (const e of theirs) {
      expect(e.grams).toBe(0);
      expect(e.milkedBy).toBeUndefined();
    }
    expect(theirs.some((e) => (e.lost ?? 0) > 0)).toBe(true);
    expect(milkOf(run(false)).every((e) => e.milkedBy === undefined)).toBe(true);
    const w = on.world;
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run(true).hash().total).toBe(on.hash().total);
    expect(FULL_PROFILE).toMatchObject({ livestockMilkWork: true });
  }, 600_000);
});
