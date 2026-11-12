import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  aptitudeOf,
  CULTIVATION_LAW,
  CULTIVATION_LAW_EVENT,
  checkInvariants,
  ENTITY,
  HEAVEN_LAW,
  HEAVEN_LAW_EVENT,
  PERSON,
  PLACE_NAME,
  SECT,
  SECT_FOUNDED_EVENT,
  SECT_LORE,
  TALENT,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { aboutPanel } from "./about.ts";
import { knownEntities } from "./known.ts";
import { Life } from "./life.ts";
import { lexiconWords } from "./view.ts";
import { living } from "./world.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

// Hash de develop (el mismo de techknow.test.ts): apagado no debe moverlo.
const BASE_HASH = "b218098c25ac14a61ca65cbd61b1324438ae2a400978faa2e6bfd7efa9b29f26";

describe("la ley del cultivo en la vida nueva (novel-cult-law)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  it("apagado deja el hash de develop, sin ley ni talento", () => {
    const off = Life.create(3, content, {});
    expect(off.hash().total).toBe(BASE_HASH);
    expect(off.world.truth.ids(CULTIVATION_LAW)).toEqual([]);
    expect(off.world.truth.ids(TALENT)).toEqual([]);
    expect(off.world.truth.ids(SECT)).toEqual([]);
    expect(off.world.truth.ids(HEAVEN_LAW)).toEqual([]);
  });

  it("encendido: la ley en el plano con su evento de origen y el talento de cada persona", () => {
    const on = Life.create(3, content, { cultivation: true });
    const w = on.world;
    const planes = w.truth.ids(CULTIVATION_LAW);
    expect(planes).toHaveLength(1);
    const plane = planes[0];
    if (plane === undefined) throw new Error("sin plano");
    const law = w.truth.get(CULTIVATION_LAW, plane);
    const origin = law ? w.log.get(law.originEventId) : undefined;
    expect(origin?.kind).toBe(CULTIVATION_LAW_EVENT);
    expect(origin?.causes).toEqual([{ kind: "seed" }]);
    expect(w.truth.get(ENTITY, plane)?.originEventId).toBe(law?.originEventId);
    // La fuerza del Cielo en el mismo plano, con su evento del seed (novel2-trib-heaven).
    const heaven = w.truth.get(HEAVEN_LAW, plane);
    const heavenOrigin = heaven ? w.log.get(heaven.originEventId) : undefined;
    expect(heavenOrigin?.kind).toBe(HEAVEN_LAW_EVENT);
    expect(heavenOrigin?.causes).toEqual([{ kind: "seed" }]);
    const people = w.truth.ids(PERSON);
    expect([...w.truth.ids(TALENT)].sort()).toEqual([...people].sort());
    // Hijo de padres con talento: lo hereda (sus padres en el genoma del talento).
    const child = people.find((p) => {
      const r = w.truth.get(PERSON, p);
      return (
        r?.mother && r.father && w.truth.get(TALENT, r.mother) && w.truth.get(TALENT, r.father)
      );
    });
    if (child !== undefined) {
      const r = w.truth.get(PERSON, child);
      expect(w.truth.get(TALENT, child)?.genome.parents).toEqual([r?.mother, r?.father]);
    }
    if (!law) throw new Error("sin ley");
    const rooted = people.filter(
      (p) => aptitudeOf(law, w.truth.get(TALENT, p)?.innate ?? {}).roots.length > 0,
    );
    expect(rooted.length).toBeLessThan(people.length / 2);
    // Mismo seed, misma vida.
    expect(Life.create(3, content, { cultivation: true }).hash().total).toBe(on.hash().total);
  });

  it("la ley es más vieja que la secta que la cita: invariantes limpias al crear", () => {
    for (const seed of [1, 2]) {
      const w = Life.create(seed, content, { cultivation: true }).world;
      expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    }
  });

  it("encendido: una secta cercana con sede nombrada y fundada antes (novel-cult-sect-place)", () => {
    const on = Life.create(3, content, { cultivation: true });
    const w = on.world;
    const orgs = w.truth.ids(SECT);
    expect(orgs).toHaveLength(1);
    const org = orgs[0];
    const sect = org ? w.truth.get(SECT, org) : undefined;
    if (!org || !sect) throw new Error("sin secta");
    const origin = w.log.get(sect.originEventId);
    expect(origin?.kind).toBe(SECT_FOUNDED_EVENT);
    expect(origin?.tick).toBe(sect.founded);
    expect(sect.founded).toBeLessThan(on.now);
    expect(origin?.causes.length).toBeGreaterThan(0);
    expect(w.truth.get(ENTITY, org)?.originEventId).toBe(sect.originEventId);
    expect(w.truth.get(PLACE_NAME, sect.seatPlace)?.form.length).toBeGreaterThan(0);
    expect(sect.seat.hops).toBeLessThanOrEqual(2);
    expect(sect.slots.some((s) => s.rank === "master")).toBe(true);
  });

  it("la aldea la sabe de oídas y el personaje la nombra solo si la oyó (novel-cult-sect-known)", () => {
    const on = Life.create(3, content, { cultivation: true });
    const w = on.world;
    const org = w.truth.ids(SECT)[0];
    const sect = org ? w.truth.get(SECT, org) : undefined;
    if (!org || !sect) throw new Error("sin secta");
    const name = w.truth.get(PLACE_NAME, sect.seatPlace)?.form ?? "";
    const ages = living(w.truth).map((p) => ({ p, r: w.truth.get(PERSON, p) }));
    const adults = ages.filter((x) => (on.now - (x.r?.born ?? 0)) / w.clock.year >= 14);
    const babies = ages.filter((x) => (on.now - (x.r?.born ?? 0)) / w.clock.year < 7);
    const knowing = adults.filter((x) => w.truth.get(SECT_LORE, x.p));
    expect(knowing.length).toBeGreaterThan(adults.length / 2);
    expect(babies.every((x) => !w.truth.get(SECT_LORE, x.p))).toBe(true);
    for (const x of knowing) expect(w.truth.get(SECT_LORE, x.p)?.seat).toBe(sect.seatPlace);

    // Sin haberla oído, ni la nombra ni la cuenta.
    w.truth.deleteRaw(SECT_LORE.name, w.player);
    expect(lexiconWords(w, false)).not.toContain(name);
    expect(knownEntities(w).some((k) => k.ref === sect.seatPlace)).toBe(false);
    // Oída: lugar nombrable, lejos, y el panel dice lo que cree.
    w.truth.set(SECT_LORE, w.player, {
      org,
      seat: sect.seatPlace,
      bearing: "ne",
      days: 4,
      confidence: 0.5,
      learnedAt: on.now,
    });
    expect(lexiconWords(w, false)).toContain(name);
    const seat = knownEntities(w).find((k) => k.ref === sect.seatPlace);
    expect(seat?.names).toContain("la secta");
    expect(seat?.present).toBe(false);
    expect(aboutPanel(w, sect.seatPlace, "la secta").hearsay).toEqual({
      what: "sect",
      bearing: "ne",
      days: 4,
      surety: "unsure",
    });
  });
});
