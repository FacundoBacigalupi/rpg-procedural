// La sede en su celda (novel-sect-seat-switch): con `sectSeatRegion`, el mapa de la vida es la
// región por tierra hasta la sede, y la sede es un lugar al que se llega caminando.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityRef,
  type EventId,
  HOUR,
  loadContent,
  type Tick,
} from "../../core/index.ts";
import {
  ABSORBED_EVENT,
  type ActionPlan,
  BODY_STATE,
  CULTIVATION_LAW,
  CULTIVATION_STATE,
  checkInvariants,
  ENTITY,
  hexPath,
  type IntentDraft,
  LOCATION,
  MIND,
  PERSON,
  PERSON_CULTURE,
  PERSON_NAME,
  PLACE,
  PLACE_QI,
  patchesOf,
  patchOf,
  planFromDraft,
  QI_TAKEN,
  SECT,
  SECT_MEMBER,
  SECT_SITE_SPACES,
  SELF_IMAGES,
  SKILL_STATE,
  sectSpaceKey,
  TALENT,
  TASTES_OF,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { knownEntities, knownSpaces } from "./known.ts";
import { Life } from "./life.ts";
import { qiPoolOf } from "./meditate.ts";
import { SECT_HALL, SECT_HALL_EVENT, SECT_UPKEEP_EVENT } from "./sect-hall.ts";
import { PLAYER_TREK } from "./trek.ts";
import { playerView } from "./view.ts";
import { playerSkyOf } from "./weather-panel.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

describe("la sede en su celda (novel-sect-seat-switch)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
  const options = { cultivation: true, sectSeatRegion: true } as const;
  const life = Life.create(3, content, options);
  const w = life.world;
  const org = w.truth.ids(SECT)[0];
  const sect = org ? w.truth.get(SECT, org) : undefined;
  if (!sect) throw new Error("sin secta");
  const seatCell = patchesOf(w.map).at(-1)?.cell;

  it("la sede es un lugar con un hex en el parche de su celda, al que se llega caminando", () => {
    const place = w.truth.get(PLACE, sect.seatPlace);
    expect(place?.kind).toBe("sect");
    const hex = place?.hexes[0] as number;
    expect(patchOf(w.map, hex).cell).toBe(seatCell);
    const from = w.truth.get(LOCATION, life.player);
    const start = from?.hex ?? 0;
    expect(hexPath(w.map, start, hex).length).toBeGreaterThan(0);
    // El ancla del guardado lleva la región entera.
    expect(patchesOf(life.anchor.map).length).toBe(patchesOf(w.map).length);
  });

  it("si la sede está en otra celda, el mapa tiene más de un parche y la aldea queda primero", () => {
    const patches = patchesOf(w.map);
    if (sect.seat.hops === 0) {
      expect(patches.length).toBe(1);
      return;
    }
    expect(patches.length).toBeGreaterThan(1);
    expect(patches[0]?.base).toBe(0);
    expect(patches[0]?.cell).toBe(w.map.cell);
  });

  it("unos días después: determinista y con invariantes limpios", () => {
    const a = Life.create(3, content, options);
    const b = Life.create(3, content, options);
    const t = a.now + 3 * a.world.clock.day;
    a.advanceTo(t);
    b.advanceTo(t);
    expect(a.hash().total).toBe(b.hash().total);
    const { truth, log, ledger } = a.world;
    expect(ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth, log })).toEqual([]);
  });

  it("con la marcha, un `move` a la sede va de la aldea a la sede en días, vivo", () => {
    const walker = Life.create(3, content, { ...options, playerTrek: true });
    const ww = walker.world;
    const me = walker.player;
    const s = ww.truth.get(SECT, ww.truth.ids(SECT)[0] as EntityRef);
    const target = s?.seatPlace as EntityRef;
    const goal = ww.truth.get(PLACE, target)?.hexes[0] as number;
    const plan: ActionPlan = {
      actor: me,
      source: "player",
      root: { kind: "do", verb: "move", args: [{ role: "to", entity: target }], manner: [] },
      manner: [],
      causes: [{ kind: "state", entity: me, key: "intent" }],
    };
    const from = walker.now;
    let turns = 0;
    while (walker.alive && ww.truth.get(LOCATION, me)?.hex !== goal && turns < 20) {
      walker.turn(plan, ++turns);
    }
    const trek = ww.log.all().filter((e) => e.kind === "life.trek" && e.actors.includes(me));
    const what = trek.map((e) => (e.data as { what: string }).what);
    expect({ alive: walker.alive, at: ww.truth.get(LOCATION, me)?.hex }).toEqual({
      alive: true,
      at: goal,
    });
    expect(what[0]).toBe("started");
    expect(what.at(-1)).toBe("arrived");
    expect(turns).toBeLessThan(5);
    // Más de una noche de camino: paró a dormir.
    expect((walker.now - from) / ww.clock.day).toBeGreaterThan(4);
    expect(ww.truth.has(PLAYER_TREK, me)).toBe(false);
    expect(ww.ledger.audit()).toEqual([]);
    // El turno en que llega, el narrador lo sabe.
    const last = trek.at(-1)?.tick ?? walker.now;
    expect(playerView(ww, [], { heardSince: last }).self.cues).toContain("trek_arrived");
    // En la sede, el tiempo es el de su celda (novel-sect-seat-weather).
    expect(playerSkyOf(ww).climate).toBe(patchOf(ww.map, goal).climate);
  });

  it("meditar en la sede toma de la reserva de su celda, no de la de la aldea (hall-qi)", () => {
    const life2 = Life.create(3, content, options);
    const w2 = life2.world;
    const me = life2.player;
    const org2 = w2.truth.ids(SECT)[0] as EntityRef;
    const s2 = w2.truth.get(SECT, org2);
    if (!s2) throw new Error("sin secta");
    const plane = w2.truth.ids(CULTIVATION_LAW)[0] as EntityRef;
    expect(w2.truth.get(PLACE_QI, s2.seatPlace)?.cell).toBe(s2.seat.cell);
    expect(qiPoolOf(w2.truth, w2.map, plane, me)).toBe(plane);
    // Ya sintiendo el qi, de pie en la sede.
    const t = w2.truth.get(TALENT, me);
    if (!t) throw new Error("sin talento");
    w2.truth.set(TALENT, me, {
      ...t,
      innate: { ...t.innate, spirit_root: 3, root_wood: 3, comprehension: 0.7 },
    });
    w2.truth.set(CULTIVATION_STATE, me, {
      sensitivity: 2,
      hours: 100,
      sensed: { at: 0 as Tick, event: "e0" as EventId },
    });
    const goal = w2.truth.get(PLACE, s2.seatPlace)?.hexes[0] as number;
    w2.truth.set(LOCATION, me, { hex: goal });
    expect(qiPoolOf(w2.truth, w2.map, plane, me)).toBe(s2.seatPlace);
    const body = w2.truth.get(BODY_STATE, me);
    if (body) w2.truth.set(BODY_STATE, me, { ...body, sleepDebt: 0, fatigue: 0, water: 0 });
    life2.turn(
      {
        actor: me,
        source: "player",
        root: {
          kind: "do",
          verb: "meditate",
          args: [{ role: "for", seconds: 4 * HOUR }],
          manner: [],
        },
        manner: [],
        causes: [{ kind: "state", entity: me, key: "intent" }],
      },
      1,
    );
    const drawn = w2.truth.get(QI_TAKEN, s2.seatPlace)?.drawn ?? 0;
    expect(drawn).toBeGreaterThan(0);
    expect(w2.truth.get(QI_TAKEN, plane)?.drawn ?? 0).toBe(0);
    // La gente de la sede también toma de ahí (hall-people-keep): lo del jugador es lo que absorbió.
    const absorbed = w2.log.all().filter((e) => e.kind === ABSORBED_EVENT && e.actors[0] === me);
    const mine = absorbed.reduce((t, e) => t + Number((e.data as { drawn?: number }).drawn), 0);
    expect(mine).toBeGreaterThan(0);
    expect(mine).toBeLessThanOrEqual(drawn + 1e-3);
    expect(w2.truth.get(CULTIVATION_STATE, me)?.qi ?? 0).toBeCloseTo(mine, 3);
    expect((absorbed[0]?.data as { cell?: number } | undefined)?.cell).toBe(s2.seat.cell);
  });

  it("la sede tiene portón, salón, dormitorios y cueva; estando ahí se va a la cueva (hall-spaces)", () => {
    const life3 = Life.create(3, content, options);
    const w3 = life3.world;
    const me = life3.player;
    const s3 = w3.truth.get(SECT, w3.truth.ids(SECT)[0] as EntityRef);
    if (!s3) throw new Error("sin secta");
    const goal = w3.truth.get(PLACE, s3.seatPlace)?.hexes[0] as number;
    const cave = sectSpaceKey(s3.seatPlace, "cave");
    const site = w3.spaces.spaces.filter((n) => n.hex === goal);
    expect(site.map((n) => n.key)).toEqual(
      expect.arrayContaining(SECT_SITE_SPACES.map((p) => sectSpaceKey(s3.seatPlace, p))),
    );
    expect(site.find((n) => n.key === cave)).toMatchObject({ indoor: true, wall: "cave" });
    // Desde la aldea no se nombran; en la sede sí.
    const names = () => knownSpaces(w3, knownEntities(w3)).flatMap((k) => k.names);
    expect(names()).not.toContain("la cueva");
    w3.truth.set(LOCATION, me, { hex: goal });
    expect(names()).toContain("la cueva");
    const known = knownEntities(w3);
    const made = planFromDraft(
      {
        kind: "act",
        plan: {
          kind: "do",
          verb: "move",
          args: [{ role: "to", ref: { text: "la cueva", kind: "place", features: [] } }],
        },
      } as IntentDraft,
      {
        actor: me,
        source: "player",
        catalog: w3.catalog,
        known,
        clock: w3.clock,
        causes: [{ kind: "state", entity: me, key: "intent" }],
        here: goal,
        spaces: knownSpaces(w3, known),
      },
    );
    if (made.kind !== "plan") throw new Error(`la cueva: ${made.kind}`);
    life3.turn(made.plan, 1);
    expect(w3.truth.get(LOCATION, me)).toEqual({ hex: goal, space: cave });
  });

  it("al llegar a la sede, sus ranuras se vuelven gente ahí, una sola vez (hall-people-born)", () => {
    const make = () => {
      const l = Life.create(3, content, options);
      const s4 = l.world.truth.get(SECT, l.world.truth.ids(SECT)[0] as EntityRef);
      if (!s4) throw new Error("sin secta");
      return { l, s4 };
    };
    const { l, s4 } = make();
    const w4 = l.world;
    const org4 = w4.truth.ids(SECT)[0] as EntityRef;
    const goal = w4.truth.get(PLACE, s4.seatPlace)?.hexes[0] as number;
    l.advanceTo(l.now + 2 * HOUR);
    expect(w4.truth.has(SECT_HALL, org4)).toBe(false);
    w4.truth.set(LOCATION, l.player, { hex: goal });
    l.advanceTo(l.now + 2 * HOUR);
    const hall = w4.truth.get(SECT_HALL, org4);
    expect(hall?.people.map((x) => x.slot)).toEqual(s4.slots.map((x) => x.slot));
    for (const { slot, person } of hall?.people ?? []) {
      const fixed = s4.slots.find((x) => x.slot === slot);
      const p = person as unknown as EntityRef;
      expect(w4.truth.get(PERSON, p)).toMatchObject({ sex: fixed?.sex, born: fixed?.born });
      expect(w4.truth.get(TALENT, p)).toEqual(fixed?.talent);
      expect(w4.truth.get(CULTIVATION_STATE, p)).toMatchObject({
        stage: fixed?.stage,
        purity: fixed?.purity,
        foundation: fixed?.foundation,
      });
      expect(w4.truth.get(SECT_MEMBER, p)?.org).toBe(org4);
      expect(w4.truth.get(LOCATION, p)?.hex).toBe(goal);
      expect(w4.truth.has(PERSON_NAME, p)).toBe(true);
    }
    const ranks = (hall?.people ?? []).map(
      (x) => w4.truth.get(SECT_MEMBER, x.person as unknown as EntityRef)?.rank,
    );
    expect(ranks).toContain("master");
    expect(ranks).toContain("inner");
    const born = w4.log.all().filter((e) => e.kind === SECT_HALL_EVENT);
    expect(born.length).toBe(1);
    expect(born[0]?.causes).toContainEqual({ kind: "event", event: s4.originEventId });
    const first = w4.truth.get(ENTITY, hall?.people[0]?.person as unknown as EntityRef);
    expect(first?.originEventId).toBe(born[0]?.id);
    // Unos días ahí: no se vuelven a materializar, mismo mundo con el mismo seed, invariantes limpios.
    l.advanceTo(l.now + 3 * w4.clock.day);
    expect(w4.log.all().filter((e) => e.kind === SECT_HALL_EVENT).length).toBe(1);
    const twin = make();
    twin.l.advanceTo(twin.l.now + 2 * HOUR);
    twin.l.world.truth.set(LOCATION, twin.l.player, { hex: goal });
    twin.l.advanceTo(l.now);
    expect(twin.l.hash().total).toBe(l.hash().total);
    expect(w4.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w4.truth, log: w4.log })).toEqual([]);
  });

  it("la gente de la sede come de su despensa, duerme en el dormitorio y medita en la cueva (hall-people-keep)", () => {
    const l = Life.create(3, content, options);
    const w5 = l.world;
    const org5 = w5.truth.ids(SECT)[0] as EntityRef;
    const s5 = w5.truth.get(SECT, org5);
    if (!s5) throw new Error("sin secta");
    const goal = w5.truth.get(PLACE, s5.seatPlace)?.hexes[0] as number;
    w5.truth.set(LOCATION, l.player, { hex: goal });
    l.advanceTo(l.now + 2 * HOUR);
    const born = w5.log.all().find((e) => e.kind === SECT_HALL_EVENT);
    expect(Number((born?.data as { stored?: number } | undefined)?.stored)).toBeGreaterThan(0);
    const people = new Set<string>(
      (w5.truth.get(SECT_HALL, org5)?.people ?? []).map((x) => x.person as string),
    );
    expect(people.size).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (let h = 0; h < 8 * 24; h++) {
      l.advanceTo(l.now + HOUR);
      for (const p of people) seen.add(w5.truth.get(LOCATION, p as EntityRef)?.space ?? "");
    }
    const seat = String(s5.seatPlace);
    expect(seen.has(sectSpaceKey(seat, "dorm"))).toBe(true);
    expect(seen.has(sectSpaceKey(seat, "cave"))).toBe(true);
    expect([...seen].every((k) => k.startsWith(`sect:${seat}/`))).toBe(true);
    const theirs = (kind: string) =>
      w5.log.all().filter((e) => e.kind === kind && e.actors.some((a) => people.has(a as string)));
    expect(theirs("routine.ate").length).toBeGreaterThanOrEqual(people.size * 3 * 7);
    expect(theirs("routine.meditate").length).toBeGreaterThan(people.size * 7);
    expect(theirs(ABSORBED_EVENT).length).toBeGreaterThan(0);
    expect(w5.truth.get(QI_TAKEN, s5.seatPlace)?.drawn ?? 0).toBeGreaterThan(0);
    // La despensa se repone cada semana desde la fuente declarada, sin romper la conservación.
    expect(w5.log.all().some((e) => e.kind === SECT_UPKEEP_EVENT)).toBe(true);
    for (const p of people) {
      expect(w5.truth.get(BODY_STATE, p as EntityRef)?.death ?? null).toBeNull();
    }
    expect(w5.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w5.truth, log: w5.log })).toEqual([]);
  });

  it("llegan con mente, cultura, habilidades y gustos, y contestan si se les habla (hall-people-talk)", () => {
    const l = Life.create(3, content, options);
    const w6 = l.world;
    const org6 = w6.truth.ids(SECT)[0] as EntityRef;
    const s6 = w6.truth.get(SECT, org6);
    if (!s6) throw new Error("sin secta");
    const goal = w6.truth.get(PLACE, s6.seatPlace)?.hexes[0] as number;
    w6.truth.set(LOCATION, l.player, { hex: goal });
    l.advanceTo(l.now + 2 * HOUR);
    const born = w6.log.all().find((e) => e.kind === SECT_HALL_EVENT);
    const people = (w6.truth.get(SECT_HALL, org6)?.people ?? []).map(
      (x) => x.person as unknown as EntityRef,
    );
    for (const p of people) {
      for (const t of [MIND, PERSON_CULTURE, SKILL_STATE, SELF_IMAGES, TASTES_OF]) {
        expect(w6.truth.has(t, p)).toBe(true);
      }
      expect(w6.truth.get(MIND, p)?.originEventId).toBe(born?.id);
    }
    const other = people[1] as unknown as AgentId;
    const at = w6.truth.get(LOCATION, other as unknown as EntityRef);
    if (at) w6.truth.set(LOCATION, l.player, at);
    const report = l.turn(
      {
        actor: l.player,
        source: "player",
        root: {
          kind: "do",
          verb: "speak",
          args: [
            { role: "to", entity: other },
            { role: "content", text: "Hola" },
          ],
          manner: [],
        },
        manner: [],
        causes: [{ kind: "state", entity: l.player, key: "intent" }],
      },
      1,
    );
    const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === other);
    expect(reply?.actors).toEqual([other, l.player]);
    expect(checkInvariants({ truth: w6.truth, log: w6.log })).toEqual([]);
  });

  it("apagado, el mapa es solo el parche de la aldea", () => {
    const off = Life.create(3, content, { cultivation: true });
    expect(patchesOf(off.world.map).length).toBe(1);
    const s = off.world.truth.ids(SECT)[0];
    const seat = s ? off.world.truth.get(SECT, s)?.seatPlace : undefined;
    expect(seat === undefined ? undefined : off.world.truth.get(PLACE, seat)).toBeUndefined();
  });
});
