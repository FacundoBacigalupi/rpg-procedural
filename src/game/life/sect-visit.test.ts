import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  BODY_STATE,
  CULTIVATION_TECHNIQUE,
  compassOf,
  LOCATION,
  ORG_RELATION,
  offeredRank,
  PERSON,
  PLACE,
  RIVAL_VISIT_LAG_DAYS,
  SECT,
  SECT_ANNOUNCE_DAYS,
  SECT_HERALD_EVENT,
  SECT_JOINED_EVENT,
  SECT_LORE,
  SECT_MEMBER,
  SECT_POACHED_EVENT,
  SECT_REPORT_DAYS,
  SECT_SCHOOL,
  SECT_TRIAL,
  SECT_TRIAL_EVENT,
  SECT_VISIT_EVENT,
  SECTS_HEARD,
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
import { pendingOffer } from "./sect-visit.ts";
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

  it("el aceptado queda discípulo externo con la citación a la sede (novel-cult-sect-join-member)", () => {
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
    const me = w.truth.get(PERSON, w.player);
    const talent = w.truth.get(TALENT, w.player);
    if (!me || !talent) throw new Error("sin personaje");
    w.scheduler.advanceTo(visit.start - 3600);
    // Doce años, en la plaza, con una raíz de fuego que la piedra no puede no ver.
    w.truth.set(PERSON, w.player, { ...me, born: life.now - 12 * w.clock.year });
    w.truth.set(TALENT, w.player, {
      ...talent,
      innate: { ...talent.innate, spirit_root: 3.5, root_fire: 2 },
    });
    const at = w.truth.get(LOCATION, w.player);
    if (!at) throw new Error("sin lugar");
    w.truth.set(LOCATION, w.player, { ...at, space: VILLAGE_SQUARE });
    const before = life.now;
    w.scheduler.advanceTo(visit.start + 3 * 3600);

    expect(w.truth.get(SECT_TRIAL, w.player)?.accepted).toBe(true);
    const member = w.truth.get(SECT_MEMBER, w.player);
    expect(member).toMatchObject({ org, rank: "outer", trialYear: visit.year });
    expect(member?.reportBy).toBe(visit.end + SECT_REPORT_DAYS * w.clock.day);
    const joined = w.log
      .all()
      .filter((e) => e.kind === SECT_JOINED_EVENT && e.actors[0] === w.player);
    expect(joined).toHaveLength(1);
    expect(joined[0]?.causes).toContainEqual({
      kind: "state",
      entity: w.player,
      key: SECT_TRIAL.name,
    });
    // La citación: el rumbo y las jornadas de la verdad, sin dudas.
    const lore = w.truth.get(SECT_LORE, w.player);
    expect(lore).toMatchObject({
      org,
      seat: sect.seatPlace,
      bearing: compassOf(sect.seat.bearingDeg),
      confidence: 1,
    });
    expect(lore?.visitAt).toBe(visit.start);
    const cues = playerView(w, [], { heardSince: before }).self.cues;
    expect(cues).toContain("trial_accepted");
    expect(cues).toContain("sect_joined");
    // La escuela: le enseñan la técnica de entrada y le nombran el reino (novel-cult-school).
    const school = w.truth.get(SECT_SCHOOL, org);
    expect(school).toBeDefined();
    expect(w.truth.get(CULTIVATION_TECHNIQUE, w.player)).toMatchObject({
      org,
      name: school?.technique.name,
      factor: school?.technique.factor,
    });
    const self = playerView(w, [], { heardSince: before }).self;
    expect(self.cues).toContain("technique_taught");
    expect(self.technique).toBe(school?.technique.name);
    expect(self.realm).toEqual({ name: school?.realms[0]?.name, layer: 1, word: "capa" });

    // Todo aceptado es miembro y nadie se suma dos veces.
    for (const e of w.log.all().filter((x) => x.kind === SECT_TRIAL_EVENT)) {
      const accepted = (e.data as { accepted?: boolean }).accepted === true;
      expect(w.truth.get(SECT_MEMBER, e.actors[0] as never) !== undefined).toBe(accepted);
    }
    w.scheduler.advanceTo(visit.end + 3600);
    const all = w.log
      .all()
      .filter((e) => e.kind === SECT_JOINED_EVENT)
      .map((e) => e.actors[0]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("la rival baja unos días después: mide al ya citado, se lo disputa y le deja la oferta; el personaje se cambia yendo a su sede (novel4-recruit-visit, novel4-recruit-choice, novel4-recruit-player)", () => {
    const life = Life.create(3, content, {
      cultivation: true,
      rivalSect: true,
      sectSeatRegion: true,
    });
    const w = life.world;
    const first = w.truth.get(SECT_LORE, w.player)?.org;
    const rival = w.truth.ids(SECT).find((id) => id !== first);
    const a = first ? w.truth.get(SECT, first) : undefined;
    const b = rival ? w.truth.get(SECT, rival) : undefined;
    if (!first || !rival || !a || !b) throw new Error("sin las dos sectas");
    const yearDays = Math.round(w.clock.year / w.clock.day);
    // La rival nace con su día, unos días después del de la primera.
    expect(b.visitDay).toBe(((a.visitDay ?? 0) + RIVAL_VISIT_LAG_DAYS) % yearDays);
    const offset = Math.round((w.map.lonDeg / 360) * w.clock.day);
    const today = Math.floor((life.now + offset) / w.clock.day) % yearDays;
    const dayA = (today + 2) % yearDays;
    const dayB = (dayA + RIVAL_VISIT_LAG_DAYS) % yearDays;
    w.truth.set(SECT, first, { ...a, visitDay: dayA });
    w.truth.set(SECT, rival, { ...b, visitDay: dayB });
    const visitA = upcomingVisit(life.now, dayA, w.clock, offset);
    const visitB = upcomingVisit(life.now, dayB, w.clock, offset);
    const me = w.truth.get(PERSON, w.player);
    const talent = w.truth.get(TALENT, w.player);
    if (!me || !talent) throw new Error("sin personaje");
    const body = w.truth.get(BODY_STATE, w.player);
    if (!body) throw new Error("sin cuerpo");
    const toSquare = () => {
      const at = w.truth.get(LOCATION, w.player);
      if (!at) throw new Error("sin lugar");
      w.truth.set(LOCATION, w.player, { ...at, space: VILLAGE_SQUARE });
    };
    // Un chico de la aldea sin secta, con la raíz que la piedra lee alta: va a la plaza las dos veces.
    const kid = living(w.truth).find(
      (id) => id !== w.player && w.truth.has(TALENT, id) && !w.truth.has(SECT_MEMBER, id),
    );
    if (!kid) throw new Error("sin chico");
    const kidTalent = w.truth.get(TALENT, kid);
    const kidPerson = w.truth.get(PERSON, kid);
    if (!kidTalent || !kidPerson) throw new Error("sin chico");
    const kidToSquare = (start: number) => {
      // Justo antes de la primera hora de la bajada, que es cuando miden.
      w.scheduler.advanceTo(Math.ceil(start / 3600) * 3600 - 1);
      const at = w.truth.get(LOCATION, kid);
      if (!at) throw new Error("sin lugar");
      w.truth.set(LOCATION, kid, { ...at, space: VILLAGE_SQUARE });
    };
    w.scheduler.advanceTo(visitA.start - 3600);
    w.truth.set(PERSON, w.player, { ...me, born: life.now - 12 * w.clock.year });
    w.truth.set(TALENT, w.player, {
      ...talent,
      innate: { ...talent.innate, spirit_root: 3.5, root_fire: 2 },
    });
    w.truth.set(PERSON, kid, { ...kidPerson, born: life.now - 12 * w.clock.year });
    w.truth.set(TALENT, kid, {
      ...kidTalent,
      innate: { ...kidTalent.innate, spirit_root: 3.5, root_fire: 2 },
    });
    toSquare();
    kidToSquare(visitA.start);
    w.scheduler.advanceTo(visitA.start + 3 * 3600);
    expect(w.truth.get(SECT_MEMBER, kid)).toMatchObject({ org: first, rank: "outer" });
    expect(w.truth.get(SECT_MEMBER, w.player)).toMatchObject({
      org: first,
      trialYear: visitA.year,
    });
    // El aviso de la rival: la fecha en lo que oyó de ella; la primera sigue siendo la que conoce.
    // Comido entre una bajada y la otra (el test no cocina).
    while (life.now < visitB.start - 3600) {
      w.truth.set(BODY_STATE, w.player, { ...body, updatedAt: life.now });
      w.scheduler.advanceTo(Math.min(visitB.start - 3600, life.now + 6 * 3600));
    }
    expect(w.truth.get(SECTS_HEARD, w.player)?.toward[rival]?.visitAt).toBe(visitB.start);
    expect(w.truth.get(SECT_LORE, w.player)?.org).toBe(first);
    toSquare();
    kidToSquare(visitB.start);
    w.scheduler.advanceTo(visitB.start + 3 * 3600);
    // El chico (novel4-recruit-choice): la rival se lo disputa como interno y se cambia; la primera
    // guarda la ofensa y lo que creía de ella queda entre lo que oyó.
    expect(w.truth.get(SECT_TRIAL, kid)).toMatchObject({
      org: rival,
      accepted: true,
      rank: "inner",
    });
    expect(w.truth.get(SECT_MEMBER, kid)).toMatchObject({
      org: rival,
      rank: "inner",
      trialYear: visitB.year,
    });
    const moved = w.log
      .all()
      .find((e) => e.kind === SECT_JOINED_EVENT && e.actors[0] === kid && e.tick >= visitB.start);
    expect(moved?.data).toMatchObject({ org: rival, rank: "inner", from: first });
    const poached = w.log.all().find((e) => e.kind === SECT_POACHED_EVENT);
    expect(poached?.actors).toEqual([kid]);
    expect(poached?.causes).toEqual([{ kind: "event", event: moved?.id }]);
    const tie = w.truth.get(ORG_RELATION, first)?.toward[rival];
    expect(tie?.grievances).toContain(poached?.id);
    expect(w.truth.get(SECT_LORE, kid)).toMatchObject({ org: rival, confidence: 1 });
    expect(w.truth.get(SECTS_HEARD, kid)?.toward[first]?.org).toBe(first);
    expect(w.truth.get(SECTS_HEARD, kid)?.toward[rival]).toBeUndefined();
    const mine = w.log
      .all()
      .filter((e) => e.kind === SECT_TRIAL_EVENT && e.actors[0] === w.player)
      .map((e) => (e.data as { org: string }).org);
    expect(mine).toEqual([first, rival]);
    // Aceptado también por la rival: no se suma, queda la oferta.
    const offer = w.truth.get(SECT_TRIAL, w.player);
    expect(offer).toMatchObject({ org: rival, accepted: true });
    expect(offer?.rank).toBe(offeredRank(offer?.reading ?? { elements: [], quality: 0 }, true));
    expect(w.truth.get(SECT_MEMBER, w.player)?.org).toBe(first);
    w.scheduler.advanceTo(visitB.end + 3600);
    // Nadie se suma ni se mide dos veces en la misma secta el mismo año.
    const joined = w.log
      .all()
      .filter((e) => e.kind === SECT_JOINED_EVENT)
      .map((e) => `${e.actors[0]}|${(e.data as { org: string }).org}`);
    expect(new Set(joined).size).toBe(joined.length);
    const trials = w.log
      .all()
      .filter((e) => e.kind === SECT_TRIAL_EVENT)
      .map((e) => `${e.actors[0]}|${(e.data as { org: string }).org}`);
    expect(new Set(trials).size).toBe(trials.length);
    expect(trials.some((t) => t.endsWith(`|${rival}`))).toBe(true);
    // El personaje (novel4-recruit-player): sabe de la oferta y, mientras no vaya, sigue en la primera.
    expect(playerView(w, [], { heardSince: visitB.start }).self.cues).toContain("trial_offer");
    expect(pendingOffer(w.truth, w.player, life.now)).toMatchObject({ org: rival, from: first });
    expect(w.truth.get(SECT_MEMBER, w.player)?.org).toBe(first);
    // Se presenta en la sede de la rival antes de la fecha: lo anotan con el rango ofrecido.
    const seatHex = w.truth.get(PLACE, b.seatPlace)?.hexes[0];
    const at = w.truth.get(LOCATION, w.player);
    if (seatHex === undefined || !at) throw new Error("sin sede");
    const before = life.now;
    w.truth.set(BODY_STATE, w.player, { ...body, updatedAt: life.now });
    w.truth.set(LOCATION, w.player, { ...at, hex: seatHex });
    w.scheduler.advanceTo(life.now + 2 * 3600);
    expect(w.truth.get(SECT_MEMBER, w.player)).toMatchObject({ org: rival, rank: offer?.rank });
    const switched = w.log
      .all()
      .find((e) => e.kind === SECT_JOINED_EVENT && e.actors[0] === w.player && e.tick >= before);
    expect(switched?.data).toMatchObject({ org: rival, from: first });
    const lost = w.log.all().find((e) => e.kind === SECT_POACHED_EVENT && e.actors[0] === w.player);
    expect(lost?.causes).toEqual([{ kind: "event", event: switched?.id }]);
    expect(w.truth.get(ORG_RELATION, first)?.toward[rival]?.grievances).toContain(lost?.id);
    expect(w.truth.get(SECT_LORE, w.player)?.org).toBe(rival);
    expect(pendingOffer(w.truth, w.player, life.now)).toBeUndefined();
    expect(playerView(w, [], { heardSince: before }).self.cues).toContain("sect_switched");
    // Una sola vez.
    w.scheduler.advanceTo(life.now + 3 * 3600);
    expect(
      w.log.all().filter((e) => e.kind === SECT_JOINED_EVENT && e.actors[0] === w.player),
    ).toHaveLength(2);
  });
});
