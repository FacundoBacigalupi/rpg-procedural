import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import {
  type ActionPlan,
  ANIMAL,
  checkInvariants,
  ENTITY,
  LIVESTOCK,
  LOCATION,
  PERSON,
  TANNING,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { animalMarksOf } from "./animal-marks.ts";
import { Life } from "./life.ts";
import { FULL_PROFILE } from "./profile.ts";
import { slaughterTargetOf } from "./slaughter.ts";

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
const SEED = 3;
const MUTTON = ledgerUnit("good:mutton");
const HIDE = ledgerUnit("good:hide");
const LEATHER = ledgerUnit("good:leather");
const DAY = 24 * 3600;

const plan = (actor: string, what: string): ActionPlan => ({
  actor: actor as never,
  source: "player",
  root: { kind: "do", verb: "slaughter", args: [{ role: "what", text: what }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor as never, key: "intent" }],
});

/** El personaje pasa a la casa de una cabra y se para a su lado; devuelve la cabra y la casa. */
function nextToGoat(l: Life): { goat: string; owner: string } {
  const t = l.world.truth;
  const goat = (t.ids(ANIMAL) as string[])
    .sort()
    .find(
      (id) =>
        t.get(ANIMAL, id as never)?.species === "goat" &&
        t.get(ENTITY, id as never)?.endedAt === undefined,
    );
  const owner = goat === undefined ? undefined : t.get(ANIMAL, goat as never)?.owner;
  const hex = goat === undefined ? undefined : t.get(LOCATION, goat as never)?.hex;
  const me = t.get(PERSON, l.player);
  if (goat === undefined || owner === undefined || hex === undefined || me === undefined) {
    throw new Error("sin cabra");
  }
  t.set(PERSON, l.player, { ...me, household: owner });
  t.set(LOCATION, l.player, { hex });
  return { goat, owner };
}

describe("carnear un animal de la casa (livestock-slaughter)", () => {
  it("elige por especie un animal vivo de la casa en el mismo hex; otro nombre o lejos, nada", () => {
    const l = Life.create(SEED, content, {
      frequency: 8,
      villageLivestock: true,
      livestockDairy: true,
    });
    const { goat, owner } = nextToGoat(l);
    const t = l.world.truth;
    const o = { species: content.all(LIVESTOCK), year: l.world.clock.year };
    const got = slaughterTargetOf(t, l.player, "la cabra vieja", l.now, o);
    expect(t.get(ANIMAL, got?.animal as never)?.species).toBe("goat");
    expect(t.get(ANIMAL, got?.animal as never)?.owner).toBe(owner);
    expect(got?.holder).toBe(owner);
    expect(got?.yields.map((y) => y.unit).sort()).toEqual([HIDE, MUTTON].sort());
    expect(slaughterTargetOf(t, l.player, "el cerdo", l.now, o)).toBeUndefined();
    expect(slaughterTargetOf(t, l.player, "mi animal", l.now, o)).toBeDefined();
    // De otra casa, no.
    const me = t.get(PERSON, l.player);
    if (me === undefined) throw new Error("sin jugador");
    t.set(PERSON, l.player, { ...me, household: "household:none" as never });
    expect(slaughterTargetOf(t, l.player, "cabra", l.now, o)).toBeUndefined();
    t.set(PERSON, l.player, { ...me, household: owner as never });
    expect(goat).toBeDefined();
  }, 300_000);

  it("con refs, «la vieja», «la cría», «el macho» eligen un animal al que se le note eso (livestock-slaughter-refs)", () => {
    const l = Life.create(SEED, content, {
      frequency: 8,
      villageLivestock: true,
      livestockDairy: true,
    });
    const { owner } = nextToGoat(l);
    const t = l.world.truth;
    const species = content.all(LIVESTOCK);
    const o = { species, year: l.world.clock.year, refs: true };
    const year = l.world.clock.year;
    const hex = t.get(LOCATION, l.player)?.hex;
    const herd = [...t.ids(ANIMAL)].filter((id) => {
      const a = t.get(ANIMAL, id as never);
      return a?.owner === owner && t.get(LOCATION, id as never)?.hex === hex;
    });
    const marksOf = (id: string) => {
      const a = t.get(ANIMAL, id as never);
      const def = species.find((s) => s.id === a?.species);
      return a === undefined ? [] : animalMarksOf(t, id as never, a.bornAt, def, l.now, year);
    };
    const check = (text: string, ok: (id: string) => boolean) => {
      const got = slaughterTargetOf(t, l.player, text, l.now, o);
      if (herd.some(ok)) expect(ok(got?.animal as string)).toBe(true);
      else expect(got).toBeUndefined();
    };
    check("la cabra vieja", (id) => marksOf(id).includes("old"));
    check("la cría", (id) => marksOf(id).includes("young"));
    check("el macho", (id) => t.get(ANIMAL, id as never)?.sex === "male");
    check("la hembra", (id) => t.get(ANIMAL, id as never)?.sex === "female");
    // Una cría vieja no existe: no hay a cuál.
    expect(slaughterTargetOf(t, l.player, "la cría vieja", l.now, o)).toBeUndefined();
    // Sin refs, la palabra de más no elige y una que no conoce sigue sin dar nada.
    expect(
      slaughterTargetOf(t, l.player, "la cría vieja", l.now, { species, year }),
    ).toBeUndefined();
    expect(
      slaughterTargetOf(t, l.player, "la cabra vieja", l.now, { species, year }),
    ).toBeDefined();
    expect(FULL_PROFILE).toMatchObject({ livestockSlaughterRefs: true });
  }, 300_000);

  it("encendido: la cabra termina y su carne y su piel quedan en la despensa; determinista", () => {
    const run = (on: boolean) => {
      const l = Life.create(SEED, content, {
        frequency: 8,
        villageLivestock: true,
        livestockDairy: true,
        livestockLife: true,
        livestockSlaughter: on,
      });
      const { owner } = nextToGoat(l);
      const larder = holderAccount(owner as HolderRef);
      const before = {
        mutton: l.world.ledger.balance(larder, MUTTON),
        hide: l.world.ledger.balance(larder, HIDE),
      };
      const living = (l.world.truth.ids(ANIMAL) as string[]).filter(
        (id) => l.world.truth.get(ENTITY, id as never)?.endedAt === undefined,
      ).length;
      l.turn(plan(l.player, "la cabra"), 1);
      return { l, larder, before, living };
    };
    const { l, larder, before, living } = run(true);
    const w = l.world;
    // Si la tirada sale bien (seed fijo), una cabra menos y la despensa con su cuerpo.
    const alive = (w.truth.ids(ANIMAL) as string[]).filter(
      (id) => w.truth.get(ENTITY, id as never)?.endedAt === undefined,
    ).length;
    expect(alive).toBe(living - 1);
    expect(w.ledger.balance(larder, MUTTON)).toBeGreaterThan(before.mutton);
    expect(w.ledger.balance(larder, HIDE)).toBeGreaterThan(before.hide);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run(true).l.hash().total).toBe(l.hash().total);
    // Apagado: no hay qué carnear y la cabra sigue.
    const off = run(false);
    const offAlive = (off.l.world.truth.ids(ANIMAL) as string[]).filter(
      (id) => off.l.world.truth.get(ENTITY, id as never)?.endedAt === undefined,
    ).length;
    expect(offAlive).toBe(off.living);
    expect(off.l.world.ledger.balance(off.larder, MUTTON)).toBe(off.before.mutton);
    expect(FULL_PROFILE).toMatchObject({ livestockSlaughter: true });
  }, 600_000);

  it("curtido: la piel de la cabra pasa a la tina y a los días vuelve cuero; determinista", () => {
    const run = (tan: boolean) => {
      const l = Life.create(SEED, content, {
        frequency: 8,
        villageLivestock: true,
        livestockDairy: true,
        livestockLife: true,
        livestockSlaughter: true,
        livestockTan: tan,
      });
      const { owner } = nextToGoat(l);
      const larder = holderAccount(owner as HolderRef);
      const leather0 = l.world.ledger.balance(larder, LEATHER);
      l.turn(plan(l.player, "la cabra"), 1);
      const hide = l.world.ledger.balance(larder, HIDE);
      l.advanceTo(l.now + 2 * DAY);
      const t = l.world.truth;
      const batch = (t.ids(TANNING) as string[])
        .map((id) => t.get(TANNING, id as never))
        .find((b) => b?.household === owner);
      const hideInVat = l.world.ledger.balance(larder, HIDE);
      l.advanceTo(l.now + 50 * DAY);
      return { l, larder, leather0, hide, batch, hideInVat };
    };
    const on = run(true);
    const w = on.l.world;
    expect(on.hide).toBeGreaterThanOrEqual(500);
    // Al otro día la piel ya no está en la despensa: está en la tina de la casa.
    expect(on.batch?.grams).toBeGreaterThanOrEqual(500);
    expect(on.hideInVat).toBeLessThan(500);
    // Pasados los días del curtido, la casa tiene cuero (un tercio, más o menos, de la piel).
    const leather = w.ledger.balance(on.larder, LEATHER) - on.leather0;
    expect(leather).toBeGreaterThan(0);
    expect(leather).toBeLessThan(on.batch?.grams ?? 0);
    expect(w.log.all().some((e) => e.kind === "living.hide_tanned")).toBe(true);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run(true).l.hash().total).toBe(on.l.hash().total);
    // Apagado: no hay tinas y la piel se queda en la despensa (pudriéndose).
    const off = run(false);
    expect(off.batch).toBeUndefined();
    expect([...off.l.world.truth.ids(TANNING)]).toEqual([]);
    expect(FULL_PROFILE).toMatchObject({ livestockTan: true });
  }, 900_000);
});
