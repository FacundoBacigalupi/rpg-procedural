import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  LOCATION,
  PERSON,
  SECT,
  SECT_ANNOUNCE_DAYS,
  SECT_HERALD_EVENT,
  SECT_LORE,
  SECT_TRIAL,
  SECT_TRIAL_EVENT,
  SECT_VISIT_EVENT,
  sectVisitDay,
  TALENT,
  TRIAL_MAX_YEARS,
  TRIAL_MIN_YEARS,
  upcomingVisit,
  VILLAGE_SQUARE,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { living } from "./living.ts";
import { playerView } from "./view.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

const CLOCK = { day: 86_400, year: 86_400 * 360 };

describe("la bajada de la secta: el calendario (novel-cult-sect-visit)", () => {
  it("el día: unos días después del pico de la cosecha, dentro del año", () => {
    const season = (d: number) => (d === 200 ? 5 : 1);
    expect(sectVisitDay(season, 360)).toBe(215);
    expect(sectVisitDay((d) => (d === 355 ? 5 : 1), 360)).toBe(10);
  });

  it("la próxima bajada: la de este año si no terminó, si no la del que viene", () => {
    const v = upcomingVisit(0, 10, CLOCK, 0);
    expect(v.year).toBe(0);
    expect(v.start).toBe(10 * 86_400 + 9 * 3600);
    expect(v.end).toBe(v.start + 8 * 3600);
    expect(upcomingVisit(v.start + 3600, 10, CLOCK, 0)).toEqual(v);
    const after = upcomingVisit(v.end, 10, CLOCK, 0);
    expect(after.year).toBe(1);
    expect(after.start).toBe(v.start + CLOCK.year);
    // La hora es local: al este, empieza antes en ticks.
    expect(upcomingVisit(0, 10, CLOCK, 3600).start).toBe(v.start - 3600);
  });
});

describe("la bajada de la secta en la vida (novel-cult-sect-visit)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  it("una semana antes el aviso, que todos los grandes creen; el día, la secta en la plaza", () => {
    const life = Life.create(3, content, { cultivation: true });
    const w = life.world;
    const org = w.truth.ids(SECT)[0];
    const sect = org ? w.truth.get(SECT, org) : undefined;
    if (!org || !sect || sect.visitDay === undefined) throw new Error("sin secta con bajada");
    // Que baje en diez días, para no correr un año entero.
    const offset = Math.round((w.map.lonDeg / 360) * w.clock.day);
    const yearDays = Math.round(w.clock.year / w.clock.day);
    const today = Math.floor((life.now + offset) / w.clock.day) % yearDays;
    w.truth.set(SECT, org, { ...sect, visitDay: (today + 10) % yearDays });
    const visit = upcomingVisit(life.now, (today + 10) % yearDays, w.clock, offset);

    const before = life.now;
    w.scheduler.advanceTo(visit.start - (SECT_ANNOUNCE_DAYS - 1) * w.clock.day);
    const herald = w.log.all().filter((e) => e.kind === SECT_HERALD_EVENT);
    expect(herald).toHaveLength(1);
    expect(herald[0]?.data).toMatchObject({ org, visitAt: visit.start });
    for (const id of living(w.truth)) {
      const age = (life.now - (w.truth.get(PERSON, id)?.born ?? 0)) / w.clock.year;
      if (age >= 7) expect(w.truth.get(SECT_LORE, id)?.visitAt).toBe(visit.start);
    }
    expect(w.log.all().some((e) => e.kind === SECT_VISIT_EVENT)).toBe(false);
    expect(playerView(w, [], { heardSince: before }).self.cues).toContain("sect_coming");
    const announced = life.now;

    w.scheduler.advanceTo(visit.start + 2 * 3600);
    const visits = w.log.all().filter((e) => e.kind === SECT_VISIT_EVENT);
    expect(visits).toHaveLength(1);
    expect(visits[0]?.tick).toBeGreaterThanOrEqual(visit.start);
    expect(visits[0]?.tick).toBeLessThan(visit.end);
    expect(w.log.all().filter((e) => e.kind === SECT_HERALD_EVENT)).toHaveLength(1);
    // El personaje (de siete o más) lo esperaba: sabe que están en la plaza.
    expect(playerView(w, [], { heardSince: announced }).self.cues).toContain("sect_here");
  });

  it("en la plaza miden a los chicos con la piedra: el personaje si fue, los demás si los llevan", () => {
    const life = Life.create(3, content, { cultivation: true });
    const w = life.world;
    const org = w.truth.ids(SECT)[0];
    const sect = org ? w.truth.get(SECT, org) : undefined;
    if (!org || !sect) throw new Error("sin secta");
    const offset = Math.round((w.map.lonDeg / 360) * w.clock.day);
    const yearDays = Math.round(w.clock.year / w.clock.day);
    const today = Math.floor((life.now + offset) / w.clock.day) % yearDays;
    w.truth.set(SECT, org, { ...sect, visitDay: (today + 2) % yearDays });
    const visit = upcomingVisit(life.now, (today + 2) % yearDays, w.clock, offset);
    // El personaje tiene doce años y está en la plaza cuando llegan.
    const me = w.truth.get(PERSON, w.player);
    if (!me) throw new Error("sin personaje");
    w.scheduler.advanceTo(visit.start - 3600);
    w.truth.set(PERSON, w.player, { ...me, born: life.now - 12 * w.clock.year });
    const at = w.truth.get(LOCATION, w.player);
    if (!at) throw new Error("sin lugar");
    w.truth.set(LOCATION, w.player, { ...at, space: VILLAGE_SQUARE });
    const before = life.now;
    w.scheduler.advanceTo(visit.start + 3 * 3600);

    const trials = w.log.all().filter((e) => e.kind === SECT_TRIAL_EVENT);
    const mine = trials.filter((e) => e.actors[0] === w.player);
    expect(mine).toHaveLength(1);
    const row = w.truth.get(SECT_TRIAL, w.player);
    expect(row?.org).toBe(org);
    expect(mine[0]?.data).toMatchObject({
      accepted: row?.accepted,
      elements: row?.reading.elements,
    });
    expect(mine[0]?.causes).toContainEqual({ kind: "state", entity: w.player, key: TALENT.name });
    const cue = row?.accepted
      ? "trial_accepted"
      : (row?.reading.elements.length ?? 0) > 0
        ? "trial_rejected"
        : "trial_dark";
    expect(playerView(w, [], { heardSince: before }).self.cues).toContain(cue);

    // Nadie se mide dos veces el mismo año, y solo los de 8 a 16.
    const who = trials.map((e) => e.actors[0]);
    expect(new Set(who).size).toBe(who.length);
    for (const e of trials) {
      const born = w.truth.get(PERSON, e.actors[0] as never)?.born ?? 0;
      const age = (e.tick - born) / w.clock.year;
      expect(age).toBeGreaterThanOrEqual(TRIAL_MIN_YEARS);
      expect(age).toBeLessThan(TRIAL_MAX_YEARS);
    }
    const kids = living(w.truth).filter((id) => {
      const age = (life.now - (w.truth.get(PERSON, id)?.born ?? 0)) / w.clock.year;
      return id !== w.player && age >= TRIAL_MIN_YEARS + 0.1 && age < TRIAL_MAX_YEARS - 0.1;
    });
    if (kids.length >= 3) expect(trials.length).toBeGreaterThan(1);
  });
});
