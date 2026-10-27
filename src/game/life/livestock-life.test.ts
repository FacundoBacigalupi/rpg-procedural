import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AnimalId,
  type ContentSource,
  externalAccount,
  holderAccount,
  loadContent,
} from "../../core/index.ts";
import {
  ANIMAL,
  CARCASS_SOURCE,
  carcassYield,
  checkInvariants,
  ENTITY,
  LIVESTOCK,
  LOCATION,
  stepChance,
  yearlyMortality,
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
// Gallinas que ponen todos los días: la cría sale el primer día que hay gallo.
const fertile = loadContent(
  GAME_CONTENT_KINDS,
  sources("content").map((s) =>
    s.kind === "livestock"
      ? {
          ...s,
          data: (s.data as { id: string; breeding?: object }[]).map((d) =>
            d.id === "hen" ? { ...d, breeding: { ...d.breeding, littersPerYear: 365 } } : d,
          ),
        }
      : s,
  ),
);
const DAY = 86_400;
const OPTS = { frequency: 8, villageLivestock: true, livestockLife: true } as const;

describe("el ganado envejece, muere y pare (livestock-life)", () => {
  it("la muerte por edad: casi nada de joven, segura pasada la vida típica", () => {
    expect(yearlyMortality(1, 12)).toBeLessThan(0.05);
    expect(yearlyMortality(12, 12)).toBeCloseTo(0.53);
    expect(yearlyMortality(30, 12)).toBe(1);
    expect(stepChance(1, DAY, 365 * DAY)).toBe(1);
    expect(stepChance(0.5, 365 * DAY, 365 * DAY)).toBeCloseTo(0.5);
  });

  it("el ganado del comienzo tiene la edad contada desde el comienzo y no muere todo de viejo (life-56)", () => {
    const life = Life.create(7, content, OPTS);
    const w = life.world;
    const start = life.now;
    const ids = w.truth.ids(ANIMAL);
    for (const id of ids) {
      const a = w.truth.get(ANIMAL, id);
      const def = content.all(LIVESTOCK).find((s) => s.id === a?.species);
      if (!a || !def) throw new Error("animal sin especie");
      expect((start - a.bornAt) / (365 * 86_400)).toBeLessThanOrEqual(0.6 * def.lifespanYears);
    }
    life.advanceTo(start + 5 * 86_400);
    const alive = ids.filter((id) => w.truth.get(ENTITY, id)?.endedAt === undefined);
    expect(alive.length).toBeGreaterThan(ids.length / 2);
  }, 300_000);

  it("el buey del comienzo ya está en edad de tirar; con el motor anterior, no siempre (life-57)", () => {
    const oxAges = (o: object) => {
      const life = Life.create(7, content, { ...OPTS, ...o });
      const t = life.world.truth;
      return t
        .ids(ANIMAL)
        .map((id) => t.get(ANIMAL, id))
        .filter((a) => a?.species === "ox")
        .map((a) => (life.now - (a?.bornAt ?? 0)) / (365 * DAY));
    };
    const now = oxAges({});
    expect(now.length).toBeGreaterThan(0);
    for (const age of now) {
      expect(age).toBeGreaterThanOrEqual(3);
      expect(age).toBeLessThanOrEqual(10);
    }
    // Seed 7 con el motor anterior trae los dos bueyes por debajo de los 2 años.
    expect(oxAges({ legacyLivestockHerdAges: true }).every((age) => age < 2)).toBe(true);
  }, 300_000);

  it("el animal viejo muere con evento causado por su edad y deja de estar", () => {
    const life = Life.create(7, content, OPTS);
    const w = life.world;
    const old = [...w.truth.ids(ANIMAL)].sort()[0] as AnimalId;
    const row = w.truth.get(ANIMAL, old);
    if (row === undefined) throw new Error("sin ganado");
    w.truth.set(ANIMAL, old, { ...row, bornAt: life.now - 100 * 365 * DAY });
    life.advanceTo(life.now + 2 * DAY);
    const end = w.truth.get(ENTITY, old)?.endEventId;
    const died = w.log.all().find((e) => e.id === end);
    expect(died?.kind).toBe("living.animal_died");
    expect(died?.causes).toEqual([{ kind: "state", entity: old, key: "age" }]);
    expect(w.truth.get(LOCATION, old)).toBeUndefined();
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(FULL_PROFILE).toMatchObject({ livestockLife: true });
  }, 300_000);

  it("el buey muerto deja carne y piel en su casa, con el evento de la muerte (livestock-carcass)", () => {
    const life = Life.create(7, content, OPTS);
    const w = life.world;
    const ox = [...w.truth.ids(ANIMAL)]
      .sort()
      .find((id) => w.truth.get(ANIMAL, id)?.species === "ox") as AnimalId | undefined;
    const row = ox === undefined ? undefined : w.truth.get(ANIMAL, ox);
    if (ox === undefined || row === undefined) throw new Error("sin buey");
    w.truth.set(ANIMAL, ox, { ...row, bornAt: life.now - 100 * 365 * DAY });
    life.advanceTo(life.now + 2 * DAY);
    const end = w.truth.get(ENTITY, ox)?.endEventId;
    const got = w.ledger.journal().filter((j) => j.eventId === end);
    const ofSource = got.filter((j) => j.from === externalAccount(CARCASS_SOURCE));
    expect(ofSource.map((j) => [j.unit, j.to, j.amount])).toEqual([
      ["good:beef", holderAccount(row.owner), 202_500],
      ["good:hide", holderAccount(row.owner), 31_500],
    ]);
    expect(w.ledger.audit()).toEqual([]);
    const ox0 = content.all(LIVESTOCK).find((s) => s.id === "ox");
    const hen = content.all(LIVESTOCK).find((s) => s.id === "hen");
    if (!ox0 || !hen) throw new Error("sin especies");
    expect(carcassYield(hen, 0.05)).toEqual([{ good: "chicken", grams: 120 }]);
    expect(carcassYield({ ...ox0, carcass: undefined }, 10)).toEqual([]);
  }, 300_000);

  it("la gallina con gallo pare una camada con origen en ella, en su casa y del mismo dueño", () => {
    const life = Life.create(7, fertile, OPTS);
    const w = life.world;
    const hens = [...w.truth.ids(ANIMAL)]
      .sort()
      .filter((id) => w.truth.get(ANIMAL, id)?.species === "hen") as AnimalId[];
    const [mother, cock] = hens;
    const m = mother === undefined ? undefined : w.truth.get(ANIMAL, mother);
    if (mother === undefined || m === undefined) throw new Error("sin gallinas");
    // Gallo y gallina adultos en la misma casa; el resto de las gallinas, de otra casa no importa.
    const sameHouse = hens.filter((id) => w.truth.get(ANIMAL, id)?.owner === m.owner);
    const male = sameHouse.find((id) => id !== mother) ?? cock;
    if (male === undefined) throw new Error("una sola gallina");
    const adult = life.now - 2 * 365 * DAY;
    w.truth.set(ANIMAL, mother, { ...m, sex: "female", bornAt: adult });
    const mr = w.truth.get(ANIMAL, male);
    if (mr === undefined) throw new Error("sin gallo");
    w.truth.set(ANIMAL, male, { ...mr, owner: m.owner, home: m.home, sex: "male", bornAt: adult });
    const before = new Set(w.truth.ids(ANIMAL));
    life.advanceTo(life.now + 2 * DAY);
    const born = w.log.all().filter((e) => e.kind === "living.animal_born");
    const own = born.find((e) => (e.data as { mother: string }).mother === mother);
    expect(own?.causes).toEqual([{ kind: "state", entity: mother, key: "pregnancy" }]);
    const young = (own?.data as { young: AnimalId[] } | undefined)?.young ?? [];
    expect(young.length).toBeGreaterThan(0);
    for (const id of young) {
      expect(before.has(id)).toBe(false);
      expect(w.truth.get(ENTITY, id)?.originEventId).toBe(own?.id);
      expect(w.truth.get(ANIMAL, id)).toMatchObject({
        species: "hen",
        owner: m.owner,
        home: m.home,
      });
      expect(w.truth.get(LOCATION, id)).toEqual(w.truth.get(LOCATION, mother));
    }
    // El tope de la casa: nunca más de 10 gallinas por casa.
    const perHouse = new Map<string, number>();
    for (const id of w.truth.ids(ANIMAL)) {
      const a = w.truth.get(ANIMAL, id);
      if (a?.species !== "hen" || w.truth.get(ENTITY, id)?.endedAt !== undefined) continue;
      perHouse.set(a.owner, (perHouse.get(a.owner) ?? 0) + 1);
    }
    expect(Math.max(...perHouse.values())).toBeLessThanOrEqual(10);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);

  it("es determinista, y sin la opción el ganado no cambia", () => {
    const run = (opts: typeof OPTS | { frequency: 8; villageLivestock: true }) => {
      const l = Life.create(7, fertile, opts);
      l.advanceTo(l.now + 30 * DAY);
      return [...l.world.truth.ids(ANIMAL)]
        .sort()
        .map((id) => [id, l.world.truth.get(ANIMAL, id), l.world.truth.get(ENTITY, id)?.endedAt]);
    };
    expect(run(OPTS)).toEqual(run(OPTS));
    const still = Life.create(7, fertile, { frequency: 8, villageLivestock: true });
    const start = [...still.world.truth.ids(ANIMAL)].sort();
    still.advanceTo(still.now + 30 * DAY);
    expect([...still.world.truth.ids(ANIMAL)].sort()).toEqual(start);
    expect(still.world.log.all().some((e) => e.kind.startsWith("living.animal_"))).toBe(false);
  }, 600_000);
});
