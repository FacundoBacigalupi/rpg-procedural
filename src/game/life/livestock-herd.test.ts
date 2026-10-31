import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  ANIMAL,
  BUILDING,
  checkInvariants,
  ENTITY,
  fleeceShare,
  keepChance,
  LIVESTOCK,
  LOCATION,
  SHORN,
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

describe("el ganado de la aldea (livestock-herd)", () => {
  it("sin la opción no hay animales; con ella, cada casa trae los suyos con origen y dueño", () => {
    expect([...Life.create(7, content, { frequency: 8 }).world.truth.ids(ANIMAL)]).toEqual([]);
    const w = Life.create(7, content, { frequency: 8, villageLivestock: true }).world;
    const animals = [...w.truth.ids(ANIMAL)];
    expect(animals.length).toBeGreaterThan(0);
    const species = new Set<string>();
    for (const id of animals) {
      const a = w.truth.get(ANIMAL, id);
      if (a === undefined) throw new Error("sin fila");
      species.add(a.species);
      const home = w.truth.get(BUILDING, a.home);
      expect(home?.household).toBe(a.owner);
      expect(w.truth.get(LOCATION, id)).toEqual({ hex: home?.hex });
      const origin = w.truth.get(ENTITY, id)?.originEventId;
      const brought = w.log.all().find((e) => e.id === origin);
      expect(brought?.kind).toBe("settlement.livestock_brought");
      expect(brought?.causes).toEqual([{ kind: "event", event: home?.builtBy }]);
      expect(a.bornAt).toBeLessThanOrEqual(w.truth.get(ENTITY, id)?.createdAt ?? 0);
    }
    expect(species.has("hen")).toBe(true);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(FULL_PROFILE).toMatchObject({ villageLivestock: true });
  }, 300_000);

  it("es determinista: mismo seed, mismo ganado", () => {
    const a = Life.create(7, content, { frequency: 8, villageLivestock: true }).world;
    const b = Life.create(7, content, { frequency: 8, villageLivestock: true }).world;
    const rows = (w: typeof a) => [...w.truth.ids(ANIMAL)].map((id) => w.truth.get(ANIMAL, id));
    expect(rows(b)).toEqual(rows(a));
  }, 300_000);
});

describe("qué casas tienen cabras y bueyes según la tierra (livestock-milk-culture-terrain)", () => {
  it("pura: la cabra sube en la loma y el buey baja; sin `keeps`, siempre", () => {
    const def = (id: string) => content.all(LIVESTOCK).find((s) => s.id === id);
    const goat = def("goat");
    const ox = def("ox");
    const hen = def("hen");
    if (!goat || !ox || !hen) throw new Error("sin especies");
    expect(keepChance(goat, 1)).toBeGreaterThan(keepChance(goat, 0));
    expect(keepChance(ox, 1)).toBeLessThan(keepChance(ox, 0));
    expect(keepChance(hen, 1)).toBe(1);
    expect(keepChance(goat, 5)).toBe(1);
  });

  it("encendido: algunas casas no traen cabras o bueyes, con la tierra como causa; determinista", () => {
    const opts = { frequency: 8, villageLivestock: true, livestockDairy: true } as const;
    const owners = (w: ReturnType<typeof Life.create>["world"], species: string) =>
      new Set(
        [...w.truth.ids(ANIMAL)]
          .map((id) => w.truth.get(ANIMAL, id))
          .filter((a) => a?.species === species)
          .map((a) => a?.owner),
      );
    const off = Life.create(7, content, opts).world;
    const on = Life.create(7, content, { ...opts, livestockTerrain: true }).world;
    const fewer = ["goat", "ox"].map((s) => owners(off, s).size - owners(on, s).size);
    expect(fewer.every((d) => d >= 0)).toBe(true);
    expect(fewer.some((d) => d > 0)).toBe(true);
    const brought = on.log.all().filter((e) => e.kind === "settlement.livestock_brought");
    expect(brought.some((e) => e.causes.some((c) => c.kind === "state" && c.key === "land"))).toBe(
      true,
    );
    expect(checkInvariants({ truth: on.truth, log: on.log, ledger: on.ledger })).toEqual([]);
    const again = Life.create(7, content, { ...opts, livestockTerrain: true });
    expect(again.hash().total).toBe(
      Life.create(7, content, { ...opts, livestockTerrain: true }).hash().total,
    );
    expect(FULL_PROFILE).toMatchObject({ livestockTerrain: true });
  }, 300_000);
});

describe("ovejas que dan lana (livestock-milk-culture-species)", () => {
  it("encendido: hay ovejas y dan lana a la casa; apagado, ninguna; determinista", () => {
    const opts = {
      frequency: 8,
      villageLivestock: true,
      livestockLife: true,
      livestockYield: true,
    } as const;
    const sheep = (l: ReturnType<typeof Life.create>) =>
      [...l.world.truth.ids(ANIMAL)].filter(
        (id) => l.world.truth.get(ANIMAL, id)?.species === "sheep",
      );
    const off = Life.create(7, content, opts);
    expect(sheep(off)).toEqual([]);
    const on = Life.create(7, content, { ...opts, livestockSheep: true });
    expect(sheep(on).length).toBeGreaterThan(0);
    on.advanceTo(on.now + 400 * 86_400);
    const wool = on.world.log
      .all()
      .filter(
        (e) => e.kind === "living.animal_yield" && (e.data as { good?: string }).good === "wool",
      );
    expect(wool.length).toBeGreaterThan(0);
    const w = on.world;
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(Life.create(7, content, { ...opts, livestockSheep: true }).hash().total).toBe(
      Life.create(7, content, { ...opts, livestockSheep: true }).hash().total,
    );
    expect(FULL_PROFILE).toMatchObject({ livestockSheep: true });
  }, 600_000);
});

describe("la vaca lechera (livestock-milk-culture-cow)", () => {
  it("encendido: hay vacas grandes que dan leche; sin la lechería, ninguna; determinista", () => {
    const opts = {
      frequency: 8,
      villageLivestock: true,
      livestockLife: true,
      livestockYield: true,
      livestockDairy: true,
    } as const;
    const cows = (l: ReturnType<typeof Life.create>) =>
      [...l.world.truth.ids(ANIMAL)].filter(
        (id) => l.world.truth.get(ANIMAL, id)?.species === "cow",
      );
    expect(cows(Life.create(7, content, opts))).toEqual([]);
    expect(
      cows(Life.create(7, content, { ...opts, livestockDairy: false, livestockCow: true })),
    ).toEqual([]);
    const on = Life.create(7, content, { ...opts, livestockCow: true });
    const herd = cows(on);
    expect(herd.length).toBeGreaterThan(0);
    on.advanceTo(on.now + 400 * 86_400);
    const milk = on.world.log
      .all()
      .filter(
        (e) =>
          e.kind === "living.animal_yield" &&
          (e.data as { good?: string }).good === "milk" &&
          ((e.data as { from?: string[] }).from ?? []).some((a) => herd.includes(a as never)),
      );
    expect(milk.length).toBeGreaterThan(0);
    const w = on.world;
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(Life.create(7, content, { ...opts, livestockCow: true }).hash().total).toBe(
      Life.create(7, content, { ...opts, livestockCow: true }).hash().total,
    );
    expect(FULL_PROFILE).toMatchObject({ livestockCow: true });
  }, 600_000);
});

describe("la esquila en su temporada (livestock-milk-culture-sheep-shear)", () => {
  it("pura: el vellón crece parejo hasta el año", () => {
    expect(fleeceShare(0)).toBe(0);
    expect(fleeceShare(182.5)).toBeCloseTo(0.5);
    expect(fleeceShare(500)).toBe(1);
  });

  it("encendido: cada oveja adulta se esquila una vez y queda esquilada; apagado, nunca; determinista", () => {
    const opts = {
      frequency: 8,
      villageLivestock: true,
      livestockLife: true,
      livestockYield: true,
      livestockSheep: true,
    } as const;
    const off = Life.create(7, content, opts);
    off.advanceTo(off.now + 400 * 86_400);
    expect(off.world.truth.ids(SHORN)).toEqual([]);
    const on = Life.create(7, content, { ...opts, livestockShear: true });
    on.advanceTo(on.now + 400 * 86_400);
    const w = on.world;
    const shorn = [...w.truth.ids(SHORN)];
    expect(shorn.length).toBeGreaterThan(0);
    for (const id of shorn) expect(w.truth.get(ANIMAL, id)?.species).toBe("sheep");
    const wool = w.log
      .all()
      .filter(
        (e) => e.kind === "living.animal_yield" && (e.data as { good?: string }).good === "wool",
      );
    expect(wool.length).toBeGreaterThan(0);
    // Ninguna se esquila dos veces en menos de 300 días.
    const last = new Map<string, number>();
    for (const e of wool) {
      for (const id of (e.data as { from: string[] }).from) {
        const was = last.get(id);
        if (was !== undefined) expect(e.tick - was).toBeGreaterThanOrEqual(300 * 86_400);
        last.set(id, e.tick);
      }
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(Life.create(7, content, { ...opts, livestockShear: true }).hash().total).toBe(
      Life.create(7, content, { ...opts, livestockShear: true }).hash().total,
    );
    expect(FULL_PROFILE).toMatchObject({ livestockShear: true });
  }, 600_000);
});
