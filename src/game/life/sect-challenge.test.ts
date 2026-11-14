// Retar a duelo hablando (novel3-challenge-ask): el retado pesa lo que cree de los dos (oficio y
// umbrales cruzados, que entre los de una secta se ven), su cuerpo, el temperamento, los presentes,
// el rango y el rencor. Si acepta, `combat.challenge` y `life.duels` anota el duelo a los dos con la
// regla y un día de plazo; si se niega delante de otros, pierde cara y quien retó gana la mitad.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, type EntityRef, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  BODY_STATE,
  CHALLENGE_EVENT,
  CULTIVATION_STATE,
  checkInvariants,
  DUEL,
  DUEL_DAYS,
  FACE,
  LOCATION,
  PERSON,
  SECT,
  SECT_MEMBER,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
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

  it("determinista", () => {
    const a = run({ myStage: 1, theirStage: 1, text: "Te desafío", witnesses: 2 });
    const b = run({ myStage: 1, theirStage: 1, text: "Te desafío", witnesses: 2 });
    expect(b.challenge?.data).toEqual(a.challenge?.data);
    expect(b.w.truth.get(DUEL, b.me)).toEqual(a.w.truth.get(DUEL, a.me));
  });
});
