// Retar a duelo hablando (novel3-challenge-ask): el retado pesa lo que cree de los dos (oficio y
// umbrales cruzados, que entre los de una secta se ven), su cuerpo, el temperamento, los presentes,
// el rango y el rencor. Si acepta, `combat.challenge` y `life.duels` anota el duelo a los dos con la
// regla y un día de plazo; si se niega delante de otros, pierde cara y quien retó gana la mitad.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EntityRef,
  type Event,
  loadContent,
} from "../../core/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  CHALLENGE_EVENT,
  CULTIVATION_STATE,
  checkInvariants,
  DUEL,
  DUEL_DAYS,
  FACE,
  INNATE,
  KNOWN_DEEDS,
  LOCATION,
  PERSON,
  PLACE,
  SECT,
  SECT_MEMBER,
  sectSpaceKey,
  worstDeed,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { DUEL_GRUDGE_EVENT, DUEL_SETTLED_EVENT } from "./duels.ts";
import { Life } from "./life.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

const DAY = 86400;

const hit = (actor: AgentId, target: AgentId): ActionPlan => ({
  actor,
  source: "player",
  root: { kind: "do", verb: "strike", args: [{ role: "target", entity: target }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor, key: "intent" }],
});

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

describe("retar a duelo hablando (novel3-challenge-ask)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  /** El jugador, discípulo de afuera, reta a otro de la secta con `myStage` y `theirStage`. */
  const run = (o: {
    myStage: number;
    theirStage: number;
    text: string;
    witnesses: number;
    theirBlood?: number;
  }) => {
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });
    // Un vecino adulto, hecho discípulo de afuera como él.
    const rival = w.truth
      .ids(PERSON)
      .map((id) => id as AgentId)
      .filter((id) => id !== me && w.truth.get(BODY_STATE, id)?.death === null)
      .filter((id) => life.now - (w.truth.get(PERSON, id)?.born ?? life.now) > 18 * 365 * DAY)
      .sort()[0];
    if (!rival) throw new Error("sin vecino");
    w.truth.set(SECT_MEMBER, rival, { org, rank: "outer", since: life.now });
    const here = w.truth.get(LOCATION, me);
    if (!here) throw new Error("sin lugar");
    const others = w.truth
      .ids(PERSON)
      .map((id) => id as AgentId)
      .filter((id) => id !== me && id !== rival && w.truth.get(BODY_STATE, id)?.death === null)
      .sort()
      .slice(0, o.witnesses);
    for (const id of [rival, ...others]) w.truth.set(LOCATION, id, here);
    for (const [id, stage] of [
      [me, o.myStage],
      [rival, o.theirStage],
    ] as const) {
      const c = w.truth.get(CULTIVATION_STATE, id);
      w.truth.set(CULTIVATION_STATE, id, { sensitivity: 1, hours: 100, ...c, stage });
    }
    for (const id of [me, rival, ...others]) {
      const body = w.truth.get(BODY_STATE, id);
      if (body) {
        w.truth.set(BODY_STATE, id, {
          ...body,
          sleepDebt: 0,
          fatigue: 0,
          activity: "idle",
          ...(id === rival && o.theirBlood !== undefined ? { blood: o.theirBlood } : {}),
        });
      }
    }
    const faceBefore = w.truth.get(FACE, rival)?.value;
    const myFaceBefore = w.truth.get(FACE, me)?.value;
    const report = life.turn(say(me, rival, o.text), 1);
    const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === rival);
    return {
      life,
      w,
      me,
      rival,
      faceBefore,
      myFaceBefore,
      line: (reply?.data as { effect?: { reply: string } } | undefined)?.effect?.reply,
      challenge: report.events.find((e) => e.kind === CHALLENGE_EVENT),
    };
  };

  it("el que se cree más fuerte acepta y el duelo queda anotado a los dos", () => {
    const { life, w, me, rival, line, challenge } = run({
      myStage: 0,
      theirStage: 4,
      text: "Te desafío a un duelo, a primera sangre",
      witnesses: 0,
    });
    expect(challenge?.data).toMatchObject({ rule: "first_blood", response: "accept" });
    expect(line).toBe("challenge.accept.first_blood");
    const mine = w.truth.get(DUEL, me);
    expect(mine).toMatchObject({ with: rival, rule: "first_blood", challenger: me });
    expect(w.truth.get(DUEL, rival)).toMatchObject({ with: me, rule: "first_blood" });
    expect(mine?.until).toBe((mine?.at ?? 0) + DUEL_DAYS * DAY);
    expect(mine?.until).toBeGreaterThan(life.now);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  });

  it("el que se cree perdido rechaza el de muerte; delante de otros le cuesta cara", () => {
    const { w, me, rival, line, challenge, faceBefore, myFaceBefore } = run({
      myStage: 4,
      theirStage: 0,
      text: "Te reto a duelo a muerte",
      witnesses: 3,
      theirBlood: 0.6,
    });
    expect(challenge?.data).toMatchObject({ rule: "death", response: "refuse" });
    expect(line).toBe("challenge.refuse");
    expect(w.truth.get(DUEL, me)).toBeUndefined();
    expect(w.truth.get(DUEL, rival)).toBeUndefined();
    const lost = (challenge?.data as { refuseFace?: number } | undefined)?.refuseFace ?? 0;
    expect(lost).toBeGreaterThan(0);
    expect(w.truth.get(FACE, rival)?.value ?? 0).toBeLessThan(faceBefore ?? 0.5);
    expect(w.truth.get(FACE, me)?.value ?? 0).toBeGreaterThan(myFaceBefore ?? 0.5);
  });

  it("pegarle con el duelo vivo pelea por la regla: sin delito, se cierra y mueve la cara", () => {
    const { life, w, me, rival, challenge } = run({
      myStage: 0,
      theirStage: 4,
      text: "Te reto a un duelo hasta que uno se rinda",
      witnesses: 2,
    });
    expect(challenge?.data).toMatchObject({ rule: "yield", response: "accept" });
    const before = { me: w.truth.get(FACE, me)?.value, rival: w.truth.get(FACE, rival)?.value };
    const fights: Event[] = [];
    let settled: Event | undefined;
    for (let i = 0; i < 6 && !settled; i++) {
      const report = life.turn(hit(me, rival), 1);
      fights.push(...report.events.filter((e) => e.kind === "combat.fight"));
      settled = report.events.find((e) => e.kind === DUEL_SETTLED_EVENT);
    }
    expect(fights.length).toBeGreaterThan(0);
    for (const f of fights) {
      expect(f.data).toMatchObject({ duel: { rule: "yield", kept: true } });
    }
    expect(settled?.data).toMatchObject({ rule: "yield" });
    if (!settled) throw new Error("sin duelo cerrado");
    const { winner, loser } = settled.data as { winner: AgentId; loser: AgentId };
    expect([winner, loser].sort()).toEqual([me, rival].sort());
    expect(w.truth.get(DUEL, me)).toBeUndefined();
    expect(w.truth.get(DUEL, rival)).toBeUndefined();
    // Sin delito: el retado no lo anota como agresor.
    expect(worstDeed(w.truth.get(KNOWN_DEEDS, rival), me)).toBeNull();
    const after = {
      me: w.truth.get(FACE, me)?.value ?? 0.5,
      rival: w.truth.get(FACE, rival)?.value ?? 0.5,
    };
    const won = winner === me ? after.me - (before.me ?? 0.5) : after.rival - (before.rival ?? 0.5);
    const lost =
      winner === me ? after.rival - (before.rival ?? 0.5) : after.me - (before.me ?? 0.5);
    expect(won).toBeGreaterThan(0);
    expect(lost).toBeLessThan(0);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  });

  it("determinista", () => {
    const a = run({ myStage: 1, theirStage: 1, text: "Te desafío", witnesses: 2 });
    const b = run({ myStage: 1, theirStage: 1, text: "Te desafío", witnesses: 2 });
    expect(b.challenge?.data).toEqual(a.challenge?.data);
    expect(b.w.truth.get(DUEL, b.me)).toEqual(a.w.truth.get(DUEL, a.me));
  });
});

describe("la plataforma de vida o muerte (novel3-challenge-platform)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  /** Un duelo a muerte ya pactado con un vecino de la secta, peleado en la plataforma de la sede. */
  const fight = (withElder: boolean) => {
    const life = Life.create(3, content, { cultivation: true, sectSeatRegion: true });
    const w = life.world;
    const me = life.player;
    const org = w.truth.ids(SECT)[0] as EntityRef;
    const sect = w.truth.get(SECT, org);
    if (!sect) throw new Error("sin secta");
    const hex = w.truth.get(PLACE, sect.seatPlace)?.hexes[0] as number;
    const arena = { hex, space: sectSpaceKey(sect.seatPlace, "arena") };
    const [rival, elder] = w.truth
      .ids(PERSON)
      .map((id) => id as AgentId)
      .filter((id) => id !== me && w.truth.get(BODY_STATE, id)?.death === null)
      .filter((id) => life.now - (w.truth.get(PERSON, id)?.born ?? life.now) > 18 * 365 * DAY)
      .sort();
    if (!rival || !elder) throw new Error("sin vecinos");
    w.truth.set(SECT_MEMBER, me, { org, rank: "outer", since: life.now });
    w.truth.set(SECT_MEMBER, rival, { org, rank: "outer", since: life.now });
    w.truth.set(SECT_MEMBER, elder, { org, rank: "elder", since: life.now });
    for (const id of withElder ? [me, rival, elder] : [me, rival]) w.truth.set(LOCATION, id, arena);
    for (const [id, stage] of [
      [me, 4],
      [rival, 0],
    ] as const) {
      const c = w.truth.get(CULTIVATION_STATE, id);
      w.truth.set(CULTIVATION_STATE, id, { sensitivity: 1, hours: 100, ...c, stage });
    }
    for (const id of [me, rival, elder]) {
      const body = w.truth.get(BODY_STATE, id);
      if (body) {
        w.truth.set(BODY_STATE, id, {
          ...body,
          sleepDebt: 0,
          fatigue: 0,
          activity: "idle",
          ...(id === rival ? { blood: 0.4 } : {}),
        });
      }
    }
    // La familia del retado, de sangre caliente: no va a respetar el acuerdo.
    const home = w.truth.get(PERSON, rival)?.household;
    for (const id of w.truth.ids(PERSON).map((x) => x as AgentId)) {
      const innate = w.truth.get(INNATE, id);
      if (id !== rival && innate && w.truth.get(PERSON, id)?.household === home) {
        w.truth.set(INNATE, id, { ...innate, reactivity: 1e6 });
      }
    }
    const event = w.log.all()[0]?.id;
    if (!event) throw new Error("sin eventos");
    const base = {
      rule: "death" as const,
      challenger: me,
      at: life.now,
      until: life.now + DAY,
      event,
    };
    w.truth.set(DUEL, me, { ...base, with: rival });
    w.truth.set(DUEL, rival, { ...base, with: me });
    const fights: Event[] = [];
    const grudges: Event[] = [];
    let settled: Event | undefined;
    for (let i = 0; i < 8 && !settled; i++) {
      const report = life.turn(hit(me, rival), 1);
      fights.push(...report.events.filter((e) => e.kind === "combat.fight"));
      grudges.push(...report.events.filter((e) => e.kind === DUEL_GRUDGE_EVENT));
      settled = report.events.find((e) => e.kind === DUEL_SETTLED_EVENT);
    }
    return { life, w, me, rival, elder, fights, grudges, settled };
  };

  it("ante un anciano, matar en el duelo a muerte no es delito; la familia puede no respetarlo", () => {
    const { w, me, rival, elder, fights, grudges, settled } = fight(true);
    expect(fights.length).toBeGreaterThan(0);
    for (const f of fights) {
      expect(f.data).toMatchObject({ duel: { rule: "death", kept: true, platform: elder } });
    }
    expect(worstDeed(w.truth.get(KNOWN_DEEDS, elder), me)).toBeNull();
    expect(settled?.data).toMatchObject({ rule: "death", winner: me, loser: rival });
    expect(grudges.length).toBeGreaterThan(0);
    for (const g of grudges) {
      expect(g.actors.slice(0, 2)).toEqual([me, rival]);
      const kin = g.actors[2] as AgentId;
      expect(w.truth.get(PERSON, kin)?.household).toBe(w.truth.get(PERSON, rival)?.household);
      expect(worstDeed(w.truth.get(KNOWN_DEEDS, kin), me)?.kind).toBe("assault");
    }
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  });

  it("sin anciano no hay plataforma: si alguien muere, el duelo no se respetó", () => {
    const { fights, grudges } = fight(false);
    expect(fights.length).toBeGreaterThan(0);
    for (const f of fights) {
      const d = f.data as {
        duel: { kept: boolean; platform?: string };
        outcomes: Record<string, string>;
      };
      expect(d.duel.platform).toBeUndefined();
      expect(d.duel.kept).toBe(!Object.values(d.outcomes).includes("dead"));
    }
    expect(grudges).toEqual([]);
  });
});
