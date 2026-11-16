// Pedir una misión (novel2-missions-ask): el personaje le pide una misión a un anciano de su secta; el
// anciano mira lo que le falta al alquimista y le da una (la anota `sect-duty` en `SECT_MISSION`), o
// dice por qué no: ya tiene una, no hace falta nada. Quien no es anciano no da misiones.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityRef,
  externalAccount,
  HOUR,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  checkInvariants,
  LOCATION,
  MISSION_ASSIGNED_EVENT,
  MISSION_DONE_EVENT,
  MISSION_LAPSED_EVENT,
  MISSION_PROGRESS_EVENT,
  MISSION_WATCH_HOURS,
  normalize,
  ORG_RELATION,
  PERSON,
  PLACE,
  SECT,
  SECT_CONTRIBUTION,
  SECT_GRIEVANCES,
  SECT_MEMBER,
  SECT_MISSION,
  understand,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { treasuryAccount } from "./sect-hall.ts";
import { watchPosts } from "./sect-watch.ts";
import { skipPlan } from "./skip.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

const say = (actor: AgentId, to: AgentId, text: string): ActionPlan => ({
  actor,
  source: "player",
  root: {
    kind: "do",
    verb: "speak",
    args: [
      { role: "to", entity: to },
      { role: "content", text },
    ],
    manner: [],
  },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

const lex = { people: [], goods: [] } as unknown as Parameters<typeof understand>[1];

describe("pedir una misión (novel2-missions-ask)", () => {
  it("se entiende como su propio acto", () => {
    for (const text of [
      "¿Hay alguna misión?",
      "Dame un encargo para la secta",
      "¿Tiene misiones para mí?",
    ]) {
      expect(understand(text, lex).kind, normalize(text)).toBe("mission");
    }
    expect(understand("Hablé con el encargado", lex).kind).not.toBe("mission");
  });

  it("el anciano da la de hierbas si al alquimista le faltan; una a la vez; sin falta, no hay", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    w.truth.set(LOCATION, me, { hex });
    life.advanceTo(life.now + 2 * HOUR);
    const members = w.truth
      .ids(SECT_MEMBER)
      .map((id) => ({ id: id as AgentId, m: w.truth.get(SECT_MEMBER, id) }))
      .filter((x) => x.m?.org === org && x.id !== me);
    const elder = members.find((x) => x.m?.rank === "elder" || x.m?.rank === "master")?.id;
    const outer = members.find((x) => x.m?.rank === "outer" || x.m?.rank === "inner")?.id;
    if (!elder || !outer) throw new Error("sin anciano o sin discípulo en la secta");
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });

    // El tesoro sin píldoras de reunir qi ni hierbas: al alquimista le falta.
    const treasury = treasuryAccount(org);
    const first = w.log.all()[0];
    if (!first) throw new Error("sin eventos");
    const move = (good: string, amount: number) => {
      const unit = ledgerUnit(`good:${good}`);
      const source = externalAccount(good === "spirit-herb" ? "herb" : "seed");
      const from = amount > 0 ? source : treasury;
      const to = amount > 0 ? treasury : source;
      if (amount !== 0)
        w.ledger.post({
          tick: first.tick,
          eventId: first.id,
          transfers: [{ unit, from, to, amount: Math.abs(amount) }],
        });
    };
    move("pill-qi-gathering", -w.ledger.balance(treasury, ledgerUnit("good:pill-qi-gathering")));
    move("spirit-herb", -w.ledger.balance(treasury, ledgerUnit("good:spirit-herb")));

    const meet = (other: AgentId) => {
      const here = w.truth.get(LOCATION, me);
      if (!here) throw new Error("sin lugar");
      w.truth.set(LOCATION, other, here);
      for (const id of [me, other]) {
        const body = w.truth.get(BODY_STATE, id);
        if (body) w.truth.set(BODY_STATE, id, { ...body, sleepDebt: 0, fatigue: 0 });
      }
    };
    const ask = (other: AgentId, text: string) => {
      meet(other);
      const report = life.turn(say(me, other, text), 1);
      const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === other);
      return {
        line: (reply?.data as { effect?: { reply: string } } | undefined)?.effect?.reply,
        assigned: report.events.find((e) => e.kind === MISSION_ASSIGNED_EVENT),
      };
    };

    // Quien no es anciano no da misiones.
    expect(ask(outer, "¿Hay alguna misión?").line).toBe("mission.no");

    const given = ask(elder, "Anciano, ¿hay alguna misión para mí?");
    expect(given.line).toBe("mission.give.herbs");
    expect(given.assigned?.actors).toEqual([me, elder]);
    const mission = w.truth.get(SECT_MISSION, me);
    expect(mission).toMatchObject({ org, kind: "herbs", herb: "spirit-grass", by: elder, done: 0 });
    expect(mission?.grams).toBeGreaterThan(0);
    expect(mission?.cause).toBe(given.assigned?.id);
    expect(mission?.due).toBeGreaterThan(life.now);

    // Una a la vez.
    expect(ask(elder, "Dame otra misión").line).toBe("mission.refuse.busy");

    // Entregar las hierbas al anciano en la sede (novel2-missions-herbs): pasan al tesoro y se anotan
    // los puntos de lo que cuenta; la que la completa la cierra.
    const grams = mission?.grams ?? 0;
    const herb = ledgerUnit("good:spirit-herb");
    w.ledger.post({
      tick: first.tick,
      eventId: first.id,
      transfers: [
        {
          unit: herb,
          from: externalAccount("herb"),
          to: holderAccount(me as unknown as HolderRef),
          amount: grams + 10,
        },
      ],
    });
    const give = (text: string) => {
      meet(elder);
      return life.turn(
        {
          actor: me,
          source: "player",
          root: {
            kind: "do",
            verb: "give",
            args: [
              { role: "to", entity: elder },
              { role: "what", text },
            ],
            manner: [],
          },
          manner: [],
          causes: [{ kind: "state", entity: me, key: "intent" }],
        },
        1,
      ).events;
    };
    const inTreasury = () => w.ledger.balance(treasury, herb);
    const pointsBefore = w.truth.get(SECT_CONTRIBUTION, me)?.points ?? 0;
    const half = Math.floor(grams / 2);
    const firstGive = give(`${half} g de hierba espiritual`);
    const progress = firstGive.find((e) => e.kind === MISSION_PROGRESS_EVENT);
    expect(progress?.actors).toEqual([me, elder]);
    expect(progress?.causes).toContainEqual({ kind: "event", event: given.assigned?.id });
    expect(inTreasury()).toBe(half);
    expect(w.truth.get(SECT_MISSION, me)?.done).toBe(half);
    const partial = (w.truth.get(SECT_CONTRIBUTION, me)?.points ?? 0) - pointsBefore;
    expect(partial).toBeGreaterThan(0);
    const rest = grams - half + 10;
    const done = give(`${rest} g de hierba espiritual`).find((e) => e.kind === MISSION_DONE_EVENT);
    expect(done).toBeDefined();
    expect(w.truth.has(SECT_MISSION, me)).toBe(false);
    // Lo de más también va al tesoro, pero solo lo que pedía la misión da puntos.
    expect(inTreasury()).toBe(grams + 10);
    const total = (w.truth.get(SECT_CONTRIBUTION, me)?.points ?? 0) - pointsBefore;
    expect(total).toBeCloseTo(mission?.points ?? 0, 1);

    // La misión vencida se cae sin más puntos.
    if (!mission) throw new Error("sin misión");
    w.truth.set(SECT_MISSION, me, { ...mission, done: 0, due: life.now - 1 });
    const before = w.log.all().length;
    life.advanceTo(life.now + 2 * HOUR);
    expect(
      w.log
        .all()
        .slice(before)
        .some((e) => e.kind === MISSION_LAPSED_EVENT && e.actors[0] === me),
    ).toBe(true);
    expect(w.truth.has(SECT_MISSION, me)).toBe(false);

    // Con el tesoro lleno de hierbas, no hace falta nada.
    if (w.truth.has(SECT_MISSION, me)) w.truth.deleteRaw(SECT_MISSION.name, me);
    move("spirit-herb", 1_000_000);
    const none = ask(elder, "¿Hay alguna misión?");
    expect(none.line).toBe("mission.refuse.none");
    expect(none.assigned).toBeUndefined();
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);
});

describe("llevar la exigencia como misión (novel4-grievance-envoy-mission)", () => {
  it("al de rango que pide, el anciano le da llevar la exigencia; el asunto lo anota de enviado", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, {
      cultivation: true,
      sectSeatRegion: true,
      rivalSect: true,
    });
    const w = life.world;
    const me = life.player;
    const [org, rival] = w.truth.ids(SECT) as EntityRef[];
    const sect = org ? w.truth.get(SECT, org) : undefined;
    if (!org || !rival || !sect) throw new Error("sin sectas");
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    w.truth.set(LOCATION, me, { hex });
    life.advanceTo(life.now + 2 * HOUR);
    const elder = w.truth
      .ids(SECT_MEMBER)
      .map((id) => ({ id: id as AgentId, m: w.truth.get(SECT_MEMBER, id) }))
      .find((x) => x.m?.org === org && (x.m.rank === "elder" || x.m.rank === "master"))?.id;
    if (!elder) throw new Error("sin anciano");
    w.truth.set(SECT_MEMBER, me, { org, rank: "inner", since: life.now });
    const deed = w.log.all()[0]?.id;
    if (!deed) throw new Error("sin eventos");
    w.truth.set(SECT_GRIEVANCES, org, {
      entries: [
        {
          deed,
          against: rival,
          kind: "assault",
          by: elder,
          victim: me,
          at: life.now,
          response: { choice: "demand", at: life.now },
        },
      ],
    });
    const here = w.truth.get(LOCATION, me);
    if (!here) throw new Error("sin lugar");
    w.truth.set(LOCATION, elder, here);
    for (const id of [me, elder]) {
      const body = w.truth.get(BODY_STATE, id);
      if (body) w.truth.set(BODY_STATE, id, { ...body, sleepDebt: 0, fatigue: 0 });
    }
    const report = life.turn(say(me, elder, "Anciano, ¿hay alguna misión para mí?"), 1);
    const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === elder);
    expect((reply?.data as { effect?: { reply: string } } | undefined)?.effect?.reply).toBe(
      "mission.give.envoy",
    );
    const mission = w.truth.get(SECT_MISSION, me);
    expect(mission).toMatchObject({ org, kind: "envoy", against: rival, deed, by: elder });
    life.advanceTo(life.now + 26 * HOUR);
    expect(w.truth.get(SECT_GRIEVANCES, org)?.entries[0]?.envoy).toEqual({
      who: me,
      due: mission?.due,
    });
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  });
});

describe("vigilar el camino hacia la otra secta (novel4-watch-need)", () => {
  it("con rencor a la otra, el anciano da la guardia en el camino hacia su sede", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, {
      cultivation: true,
      sectSeatRegion: true,
      rivalSect: true,
    });
    const w = life.world;
    const me = life.player;
    const [org, rival] = w.truth.ids(SECT) as EntityRef[];
    const sect = org ? w.truth.get(SECT, org) : undefined;
    const other = rival ? w.truth.get(SECT, rival) : undefined;
    if (!org || !rival || !sect || !other) throw new Error("sin sectas");
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    const theirHex = w.truth.get(PLACE, other.seatPlace)?.hexes[0] as number;
    w.truth.set(LOCATION, me, { hex });
    life.advanceTo(life.now + 2 * HOUR);
    const elder = w.truth
      .ids(SECT_MEMBER)
      .map((id) => ({ id: id as AgentId, m: w.truth.get(SECT_MEMBER, id) }))
      .find((x) => x.m?.org === org && (x.m.rank === "elder" || x.m.rank === "master"))?.id;
    if (!elder) throw new Error("sin anciano");
    w.truth.set(SECT_MEMBER, me, { org, rank: "inner", since: life.now });
    const relations = w.truth.get(ORG_RELATION, org);
    const tie = relations?.toward[rival];
    if (!relations || !tie) throw new Error("sin relación");
    w.truth.set(ORG_RELATION, org, {
      toward: {
        ...relations.toward,
        [rival]: { ...tie, sentiment: { ...tie.sentiment, resentment: 0.8 } },
      },
    });
    const here = w.truth.get(LOCATION, me);
    if (!here) throw new Error("sin lugar");
    w.truth.set(LOCATION, elder, here);
    for (const id of [me, elder]) {
      const body = w.truth.get(BODY_STATE, id);
      if (body) w.truth.set(BODY_STATE, id, { ...body, sleepDebt: 0, fatigue: 0 });
    }
    const report = life.turn(say(me, elder, "Anciano, ¿hay alguna misión para mí?"), 1);
    const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === elder);
    expect((reply?.data as { effect?: { reply: string } } | undefined)?.effect?.reply).toBe(
      "mission.give.watch_rival",
    );
    const mission = w.truth.get(SECT_MISSION, me);
    expect(mission).toMatchObject({ org, kind: "watch", against: rival, by: elder });
    // El puesto es el del camino hacia la otra sede, fuera de la propia.
    expect(mission?.hex).toBe(watchPosts(life.world.map)(w.truth, org, rival)?.hex);
    expect(mission?.hex).not.toBe(hex);
    expect(theirHex).not.toBe(hex);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  });

  it("las horas de espera en el puesto cuentan; cumplidas, se cobra al volver (novel4-watch-guard)", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, {
      cultivation: true,
      sectSeatRegion: true,
      rivalSect: true,
    });
    const w = life.world;
    const me = life.player;
    const [org, rival] = w.truth.ids(SECT) as EntityRef[];
    const sect = org ? w.truth.get(SECT, org) : undefined;
    if (!org || !rival || !sect) throw new Error("sin sectas");
    const seatHex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    const post = watchPosts(w.map)(w.truth, org, rival)?.hex;
    if (post === undefined) throw new Error("sin puesto");
    w.truth.set(SECT_MEMBER, me, { org, rank: "inner", since: life.now });
    w.truth.set(SECT_MISSION, me, {
      org,
      kind: "watch",
      against: rival,
      hex: post,
      hours: MISSION_WATCH_HOURS,
      done: 0,
      points: 16,
      by: me,
      at: life.now,
      due: life.now + 7 * 24 * HOUR,
    });
    // Esperar fuera del puesto no cuenta.
    w.truth.set(LOCATION, me, { hex: seatHex });
    life.turn(skipPlan(me, 2 * HOUR), 1);
    expect(w.truth.get(SECT_MISSION, me)?.done).toBe(0);
    // Uno de la otra secta anda afuera en el puesto (novel4-watch-report).
    const passer = w.truth
      .ids(PERSON)
      .find(
        (id) =>
          id !== me &&
          w.truth.get(SECT_MEMBER, id) === undefined &&
          (w.truth.get(BODY_STATE, id)?.death ?? null) === null &&
          w.truth.get(LOCATION, id) !== undefined,
      ) as AgentId | undefined;
    if (!passer) throw new Error("sin nadie");
    w.truth.set(SECT_MEMBER, passer, { org: rival, rank: "outer", since: life.now });
    const fearBefore = w.truth.get(ORG_RELATION, org)?.toward[rival]?.sentiment.fear ?? 0;
    // En el puesto, sí, hasta las horas pedidas.
    for (
      let i = 0;
      i < 6 && (w.truth.get(SECT_MISSION, me)?.done ?? 0) < MISSION_WATCH_HOURS;
      i++
    ) {
      w.truth.set(LOCATION, me, { hex: post });
      w.truth.set(LOCATION, passer, { hex: post });
      const body = w.truth.get(BODY_STATE, me);
      if (body) w.truth.set(BODY_STATE, me, { ...body, sleepDebt: 0, fatigue: 0 });
      life.turn(skipPlan(me, 3 * HOUR), 1);
    }
    const kept = w.truth.get(SECT_MISSION, me);
    expect(kept?.done).toBe(MISSION_WATCH_HOURS);
    expect(kept?.watched).toBeDefined();
    expect(kept?.sighted).toEqual([passer]);
    expect(w.log.all().some((e) => e.kind === MISSION_PROGRESS_EVENT && e.actors[0] === me)).toBe(
      true,
    );
    // Cumplida, no se vence aunque pase el plazo; se cobra en la sede.
    w.truth.set(LOCATION, me, { hex: seatHex });
    life.advanceTo(life.now + HOUR);
    expect(w.truth.get(SECT_MISSION, me)).toBeUndefined();
    const done = w.log.all().find((e) => e.kind === MISSION_DONE_EVENT && e.actors[0] === me);
    expect(done?.data).toMatchObject({ org, kind: "watch", against: rival, sighted: 1 });
    const tie = w.truth.get(ORG_RELATION, org)?.toward[rival];
    expect(tie?.sentiment.fear).toBeGreaterThan(fearBefore);
    expect(tie?.believedStrength.disciples).toBeGreaterThanOrEqual(1);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  });
});

describe("exigir la reparación de palabra (novel4-grievance-envoy-speak)", () => {
  it("se entiende como su propio acto, no como acusación", () => {
    for (const text of [
      "Exijo reparación por la ofensa",
      "Mi secta exige una satisfacción",
      "Vengo a reclamar justicia para los nuestros",
      "Queremos una compensación",
    ]) {
      expect(understand(text, lex).kind, normalize(text)).toBe("reparation");
    }
    expect(understand("Exijo reparación por el robo", lex).kind).toBe("reparation");
    expect(understand("¿Hay alguna misión?", lex).kind).toBe("mission");
  });

  it("el enviado la dice en la otra sede; contestan, el asunto se cierra y la misión se cobra al volver", () => {
    const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
    const life = Life.create(3, content, {
      cultivation: true,
      sectSeatRegion: true,
      rivalSect: true,
    });
    const w = life.world;
    const me = life.player;
    const [org, rival] = w.truth.ids(SECT) as EntityRef[];
    const sect = org ? w.truth.get(SECT, org) : undefined;
    const theirs = rival ? w.truth.get(SECT, rival) : undefined;
    if (!org || !rival || !sect || !theirs) throw new Error("sin sectas");
    const home = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    const away = w.truth.get(PLACE, theirs.seatPlace)?.hexes[0] as number;
    w.truth.set(LOCATION, me, { hex: home });
    life.advanceTo(life.now + 2 * HOUR);
    const members = w.truth
      .ids(SECT_MEMBER)
      .map((id) => ({ id: id as AgentId, m: w.truth.get(SECT_MEMBER, id) }));
    const elder = members.find(
      (x) => x.m?.org === org && (x.m.rank === "elder" || x.m.rank === "master"),
    )?.id;
    // La otra secta no tiene gente a mano: dos de la sede pasan a ser de ella.
    const [head, culprit] = members
      .filter((x) => x.m?.org === org && x.id !== me && x.id !== elder)
      .map((x) => x.id);
    if (head) w.truth.set(SECT_MEMBER, head, { org: rival, rank: "elder", since: life.now });
    if (culprit) w.truth.set(SECT_MEMBER, culprit, { org: rival, rank: "outer", since: life.now });
    if (!elder || !head || !culprit) throw new Error("sin anciano");
    w.truth.set(SECT_MEMBER, me, { org, rank: "inner", since: life.now });
    const deed = w.log.all()[0]?.id;
    if (!deed) throw new Error("sin eventos");
    w.truth.set(SECT_GRIEVANCES, org, {
      entries: [
        {
          deed,
          against: rival,
          kind: "assault",
          by: culprit,
          victim: me,
          at: life.now,
          response: { choice: "demand", at: life.now },
        },
      ],
    });
    const rest = (...ids: AgentId[]) => {
      for (const id of ids) {
        const body = w.truth.get(BODY_STATE, id);
        if (body) w.truth.set(BODY_STATE, id, { ...body, sleepDebt: 0, fatigue: 0 });
      }
    };
    const here = w.truth.get(LOCATION, me);
    if (!here) throw new Error("sin lugar");
    w.truth.set(LOCATION, elder, here);
    rest(me, elder);
    life.turn(say(me, elder, "Anciano, ¿hay alguna misión para mí?"), 1);
    const mission = w.truth.get(SECT_MISSION, me);
    expect(mission).toMatchObject({ kind: "envoy", against: rival, deed });
    const replyOf = (
      events: readonly { kind: string; actors: readonly string[]; data: unknown }[],
    ) =>
      (
        events.find((e) => e.kind === "action.speak" && e.actors[0] === head)?.data as
          | { effect?: { reply: string } }
          | undefined
      )?.effect?.reply;
    // Fuera de su sede no lo trata.
    const road = w.truth.get(LOCATION, me);
    if (!road) throw new Error("sin lugar");
    w.truth.set(LOCATION, head, road);
    rest(me, head);
    const early = life.turn(say(me, head, "Mi secta exige reparación por la ofensa"), 1);
    expect(replyOf(early.events)).toBe("reparation.refuse.not_here");
    // En su sede, contesta.
    w.truth.set(LOCATION, me, { hex: away });
    life.advanceTo(life.now + HOUR);
    const there = w.truth.get(LOCATION, me);
    if (!there) throw new Error("sin lugar");
    w.truth.set(LOCATION, head, there);
    rest(me, head);
    const report = life.turn(say(me, head, "Mi secta exige reparación por la ofensa"), 1);
    const answer = replyOf(report.events);
    expect(["reparation.pay", "reparation.refuse"]).toContain(answer);
    const entry = w.truth.get(SECT_GRIEVANCES, org)?.entries[0];
    expect(entry?.outcome?.result).toBe(answer === "reparation.pay" ? "paid" : "refused");
    const done = w.truth.get(SECT_MISSION, me);
    expect(done).toMatchObject({ kind: "envoy", done: 1 });
    expect(done?.reply).toBeDefined();
    // Vuelve a su sede y la cobra.
    const before = w.truth.get(SECT_CONTRIBUTION, me)?.points ?? 0;
    w.truth.set(LOCATION, me, { hex: home });
    life.advanceTo(life.now + 2 * HOUR);
    expect(w.truth.get(SECT_MISSION, me)).toBeUndefined();
    expect(w.log.all().some((e) => e.kind === MISSION_DONE_EVENT && e.actors[0] === me)).toBe(true);
    expect(w.truth.get(SECT_CONTRIBUTION, me)?.points ?? 0).toBeGreaterThan(before);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 600_000);
});
