import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EventId,
  type HolderRef,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import {
  type ActionPlan,
  addMemory,
  callName,
  checkInvariants,
  DEFAULT_FACE,
  FACE,
  formMemory,
  HEARD,
  KNOWN_DEEDS,
  LOCATION,
  MEMORIES,
  PERSON,
  PERSON_NAME,
  RELATION_BONDS,
  RELATION_DIMS,
  RELATIONS,
  relationship,
  SECRETS,
  STANDING_BELIEFS,
  STATUS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
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
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const grain = ledgerUnit("good:grain");

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

function scene(seed: number) {
  const life = Life.create(seed, content);
  const w = life.world;
  const me = life.player;
  const house = w.truth.get(PERSON, me)?.household;
  const mates = living(w.truth).filter(
    (id) => id !== me && w.truth.get(PERSON, id)?.household === house,
  );
  const other = mates[0] as AgentId;
  const here = w.truth.get(LOCATION, me);
  if (here) for (const id of mates) w.truth.set(LOCATION, id, here);
  return { life, w, me, other, mates, house: house as string };
}

const nameOf = (w: ReturnType<typeof scene>["w"], id: AgentId) =>
  callName(w.truth.get(PERSON_NAME, id) ?? { language: "", parts: [] }) ?? "Nadie";

describe("hablar con alguien de la casa", () => {
  it("el oyente contesta con un action.speak suyo, con causa, que el personaje oye", () => {
    const { life, me, other } = scene(7);
    const report = life.turn(say(me, other, "Hola"), 1);
    const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === other);
    expect(reply).toBeDefined();
    expect(reply?.actors).toEqual([other, me]);
    expect(reply?.causes[0]?.kind).toBe("state");
    const data = reply?.data as { effect: { text: string; reply: string } };
    expect(data.effect.reply).toBe("greet");
    expect(data.effect.text.length).toBeGreaterThan(0);
  }, 60_000);

  it("de alguien que no conoce dice que no sabe, sin inventar", () => {
    const { life, w, me, other } = scene(7);
    const home = w.truth.get(PERSON, me)?.household;
    const stranger = living(w.truth).find(
      (id) => w.truth.get(PERSON, id)?.household !== home,
    ) as AgentId;
    const report = life.turn(say(me, other, `¿Sabés dónde está ${nameOf(w, stranger)}?`), 1);
    const reply = report.events.find((e) => e.actors[0] === other && e.kind === "action.speak");
    const line = (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
    expect(["ask.unclear", "ask.unknown"]).toContain(line);
  }, 60_000);

  it("un pedido mueve grano de la casa al personaje sin romper el ledger", () => {
    const { life, w, me, other, house } = scene(7);
    const larder = holderAccount(house as unknown as HolderRef);
    const mine = holderAccount(me as unknown as HolderRef);
    const before = w.ledger.total(grain);
    const stock = w.ledger.balance(larder, grain);
    const got0 = w.ledger.balance(mine, grain);
    const report = life.turn(say(me, other, "Dame un poco de grano"), 1);
    const reply = report.events.find((e) => e.actors[0] === other && e.kind === "action.speak");
    const line = (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
    expect(["request.give", "request.credit", "request.short"]).toContain(line);
    if (line === "request.give" || line === "request.credit") {
      expect(w.ledger.balance(mine, grain)).toBeGreaterThan(got0);
      expect(w.ledger.balance(larder, grain)).toBeLessThan(stock);
    }
    expect(w.ledger.total(grain)).toBe(before);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 60_000);

  it("el rencor del oyente cierra el pedido aunque sea de la casa", () => {
    const { life, w, me, other } = scene(7);
    const dims = {
      dims: content.all(RELATION_DIMS),
      bonds: content.all(RELATION_BONDS),
      schemaStrength: () => 0,
    };
    const rel = relationship(w.truth.get(RELATIONS, other), me, life.now, dims);
    const toward = { ...(w.truth.get(RELATIONS, other)?.toward ?? {}) };
    toward[me] = { ...rel, dims: { ...rel.dims, resentment: 0.8 } };
    const row = w.truth.get(RELATIONS, other);
    w.truth.set(RELATIONS, other, {
      toward,
      originEventId: row?.originEventId ?? (w.log.all()[0]?.id as never),
    });
    const report = life.turn(say(me, other, "Dame un poco de grano"), 1);
    const reply = report.events.find((e) => e.actors[0] === other && e.kind === "action.speak");
    const line = (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
    expect(line).toBe("request.refuse.grudge");
  }, 60_000);

  it("un recuerdo doloroso y vívido del personaje enfría el saludo y cierra el pedido", () => {
    const wary = (text: string) => {
      const { life, w, me, other } = scene(7);
      const first = w.log.all()[0];
      const m = formMemory({
        eventId: first?.id as never,
        kind: "combat.fight",
        with: [me],
        place: first?.place as never,
        at: life.now,
        intensity: 0.9,
        valence: -0.9,
      });
      w.truth.set(MEMORIES, other, addMemory(w.truth.get(MEMORIES, other), m, life.now));
      const report = life.turn(say(me, other, text), 1);
      const reply = report.events.find((e) => e.actors[0] === other && e.kind === "action.speak");
      return (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
    };
    expect(wary("Hola")).toBe("greet.wary");
    expect(wary("Dame un poco de grano")).toBe("request.refuse.remembered");
  }, 60_000);

  it("no toma como dicho lo que contradice lo que ve", () => {
    const { life, w, me, other, mates } = scene(7);
    const third = mates.find((id) => id !== other);
    if (!third) return;
    life.turn(say(me, other, `Te cuento que ${nameOf(w, third)} murió`), 1);
    expect(w.truth.get(HEARD, other)?.claims ?? []).toEqual([]);
  }, 60_000);

  it("es determinista", () => {
    const run = () => {
      const { life, me, other } = scene(7);
      life.turn(say(me, other, "Hola"), 1);
      return life.hash();
    };
    expect(run()).toEqual(run());
  }, 60_000);
});

describe("hablarle a alguien sin decir nada", () => {
  it("el oyente lo toma como un saludo y contesta", () => {
    const { life, me, other } = scene(7);
    const report = life.turn(
      {
        actor: me,
        source: "player",
        root: { kind: "do", verb: "speak", args: [{ role: "to", entity: other }], manner: [] },
        manner: [],
        causes: [{ kind: "state", entity: me, key: "intent" }],
      },
      1,
    );
    const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === other);
    expect((reply?.data as { effect: { reply: string } } | undefined)?.effect.reply).toBe("greet");
  }, 60_000);
});

describe("proponer un trato", () => {
  it("una propuesta que el personaje no puede cumplir no mueve nada", () => {
    const { life, w, me, other, house } = scene(7);
    const larder = holderAccount(house as unknown as HolderRef);
    const stock = w.ledger.balance(larder, grain);
    const before = w.ledger.total(grain);
    const report = life.turn(say(me, other, "Te doy 900 kilos de grano por 1 kilo de grano"), 1);
    const reply = report.events.find((e) => e.actors[0] === other && e.kind === "action.speak");
    const line = (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
    expect(["offer.short", "offer.unvalued", "offer.refuse.grudge"]).toContain(line);
    expect(w.ledger.balance(larder, grain)).toBe(stock);
    expect(w.ledger.total(grain)).toBe(before);
    expect(w.ledger.audit()).toEqual([]);
  }, 60_000);
});

describe("amenazar, halagar e insultar a alguien de la casa", () => {
  it("el oyente contesta con una línea de amenaza y la relación guarda el miedo o el rencor", () => {
    const { life, w, me, other } = scene(7);
    const dims = {
      dims: content.all(RELATION_DIMS),
      bonds: content.all(RELATION_BONDS),
      schemaStrength: () => 0,
    };
    const before = relationship(w.truth.get(RELATIONS, other), me, life.now, dims).dims;
    const report = life.turn(say(me, other, "Te voy a matar"), 1);
    const reply = report.events.find((e) => e.actors[0] === other && e.kind === "action.speak");
    const line = (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
    expect(line?.startsWith("threat.")).toBe(true);
    const after = relationship(w.truth.get(RELATIONS, other), me, life.now, dims).dims;
    expect(after.fear + after.resentment).toBeGreaterThan(before.fear + before.resentment);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 120_000);

  it("un insulto baja el afecto del oyente", () => {
    const { life, w, me, other } = scene(7);
    const dims = {
      dims: content.all(RELATION_DIMS),
      bonds: content.all(RELATION_BONDS),
      schemaStrength: () => 0,
    };
    const before = relationship(w.truth.get(RELATIONS, other), me, life.now, dims).dims;
    const report = life.turn(say(me, other, "Sos un cobarde"), 1);
    const reply = report.events.find((e) => e.actors[0] === other && e.kind === "action.speak");
    const line = (reply?.data as { effect: { reply: string } } | undefined)?.effect.reply;
    expect(["insult.hurt", "insult.shrug"]).toContain(line);
    const after = relationship(w.truth.get(RELATIONS, other), me, life.now, dims).dims;
    expect(after.affection).toBeLessThan(before.affection);
  }, 120_000);
});

describe("sonsacar un secreto a alguien de la casa", () => {
  it("quien guarda un secreto sobre otro contesta con una línea de secreto, y lo soltado queda como oído", () => {
    const { life, w, me, other, mates } = scene(7);
    const about = mates.find((id) => id !== other) ?? me;
    if (about === me) return;
    w.truth.set(SECRETS, other, { items: [{ about, attr: "alive", stakes: 0.1 }] });
    const report = life.turn(
      say(me, other, `Ya me contaron lo de ${nameOf(w, about)}, contame`),
      1,
    );
    const reply = report.events.find((e) => e.actors[0] === other && e.kind === "action.speak");
    const effect = (
      reply?.data as
        | { effect: { reply: string; keep?: { outcome: string; about: string } } }
        | undefined
    )?.effect;
    expect(effect?.reply.startsWith("ask.secret.")).toBe(true);
    expect(effect?.keep?.about).toBe(about);
    if (effect?.keep?.outcome === "revealed") {
      expect(w.truth.get(HEARD, me)?.claims.some((c) => c.about === about)).toBe(true);
    }
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 120_000);
});

describe("acusar a alguien de la casa", () => {
  it("el acusado se defiende con una línea de acusación y deja la huella", () => {
    const { life, w, me, other } = scene(7);
    const report = life.turn(say(me, other, "Vos me robaste el grano"), 1);
    const reply = report.events.find((e) => e.actors[0] === other && e.kind === "action.speak");
    const effect = (
      reply?.data as
        | { effect: { reply: string; accusation?: { accused: string; unbacked: boolean } } }
        | undefined
    )?.effect;
    expect(effect?.reply.startsWith("accuse.")).toBe(true);
    expect(effect?.accusation?.accused).toBe("listener");
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 120_000);

  it("a un tercero con hecho respaldado lo pesa, y lo creído queda como contado", () => {
    const { life, w, me, other, mates } = scene(7);
    const third = mates.find((id) => id !== other);
    if (!third) return;
    const deed = {
      kind: "theft",
      by: third,
      victim: me,
      event: w.log.all()[0]?.id as EventId,
      at: life.now,
      via: "saw",
    } as const;
    w.truth.set(KNOWN_DEEDS, me, { deeds: [deed] });
    const report = life.turn(say(me, other, `${nameOf(w, third)} me robó, lo vi`), 1);
    const reply = report.events.find((e) => e.actors[0] === other && e.kind === "action.speak");
    const effect = (
      reply?.data as
        | { effect: { reply: string; accusation?: { unbacked: boolean; verdict?: string } } }
        | undefined
    )?.effect;
    expect(effect?.reply.startsWith("accuse.")).toBe(true);
    expect(effect?.accusation?.unbacked).toBe(false);
    if (effect?.accusation?.verdict === "believe" || effect?.accusation?.verdict === "weigh") {
      expect(w.truth.get(KNOWN_DEEDS, other)?.deeds.some((d) => d.by === third)).toBe(true);
    }
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 120_000);
});

/** Un extraño de otra casa en el mismo lugar: él (el oyente) campesino, el personaje criado. */
function meet(seed: number, reading?: number) {
  const s = scene(seed);
  const { life, w, me } = s;
  const home = w.truth.get(PERSON, me)?.household;
  const hearer = living(w.truth).find(
    (id) => id !== me && w.truth.get(PERSON, id)?.household !== home,
  ) as AgentId;
  const here = w.truth.get(LOCATION, me);
  if (here) w.truth.set(LOCATION, hearer, here);
  for (const [id, status] of [
    [hearer, "peasant"],
    [me, "servant"],
  ] as const) {
    const row = w.truth.get(STATUS, id);
    if (row) w.truth.set(STATUS, id, { ...row, status });
  }
  // Un extraño: sin respeto ni familiaridad, para que el usted solo salga del rango creído.
  const dims = {
    dims: content.all(RELATION_DIMS),
    bonds: content.all(RELATION_BONDS),
    schemaStrength: () => 0,
  };
  const rel = relationship(w.truth.get(RELATIONS, hearer), me, life.now, dims);
  const toward = { ...(w.truth.get(RELATIONS, hearer)?.toward ?? {}) };
  toward[me] = {
    ...rel,
    dims: { ...rel.dims, respect: 0.1, familiarity: 0.1, resentment: 0, trust: 0.3 },
  };
  const row = w.truth.get(RELATIONS, hearer);
  w.truth.set(RELATIONS, hearer, {
    toward,
    originEventId: row?.originEventId ?? (w.log.all()[0]?.id as never),
  });
  if (reading !== undefined) {
    w.truth.set(STANDING_BELIEFS, hearer, {
      beliefs: [
        {
          about: me,
          rank: reading,
          confidence: 0.9,
          basis: "attire",
          seenAt: life.now,
          originEventId: w.log.all()[0]?.id as EventId,
        },
      ],
    });
  }
  return { ...s, hearer };
}

const FORMAL_GREETS = ["Buen día tenga.", "Que le vaya bien."];

describe("el usted según la posición creída", () => {
  const greetBack = (reading?: number) => {
    const { life, me, hearer } = meet(7, reading);
    const report = life.turn(say(me, hearer, "Hola"), 1);
    const reply = report.events.find((e) => e.actors[0] === hearer && e.kind === "action.speak");
    return (reply?.data as { effect: { text: string } } | undefined)?.effect.text;
  };

  it("sin lectura del hablante el oyente extraño lo tutea; con lectura de rango alto, de usted", () => {
    const none = greetBack();
    const high = greetBack(2);
    expect(none).toBeDefined();
    expect(FORMAL_GREETS).not.toContain(none);
    expect(FORMAL_GREETS).toContain(high);
  }, 120_000);

  it("el impostor leído como alto recibe el usted aunque en verdad sea de rango bajo", () => {
    const { w, me } = meet(7, 2);
    expect(w.truth.get(STATUS, me)?.status).toBe("servant");
    expect(greetBack(2)).toBeDefined();
    expect(FORMAL_GREETS).toContain(greetBack(2));
  }, 120_000);
});

describe("la etiqueta omitida es una ofensa con causa", () => {
  const speakTo = (reading?: number) => {
    const { life, w, me, hearer } = meet(7, reading);
    const report = life.turn(say(me, hearer, "Dame un poco de grano"), 1);
    const reply = report.events.find((e) => e.actors[0] === hearer && e.kind === "action.speak");
    const offense = report.events.find((e) => e.kind === "social.offense");
    return { w, me, hearer, reply, offense };
  };

  it("quien cree al otro por debajo lo toma a mal: pierde cara y el evento cita el acto de habla", () => {
    const { w, me, hearer, reply, offense } = speakTo(0);
    expect(offense).toBeDefined();
    expect(offense?.actors).toEqual([me, hearer]);
    expect(offense?.causes[0]).toEqual({ kind: "event", event: reply?.id });
    const data = offense?.data as { norm: string; response: string };
    expect(["ignore", "rebuke", "punish"]).toContain(data.response);
    expect(w.truth.get(FACE, hearer)?.value ?? DEFAULT_FACE).toBeLessThan(DEFAULT_FACE);
    if (data.response !== "ignore") {
      expect(w.truth.get(FACE, me)?.value ?? DEFAULT_FACE).toBeLessThan(DEFAULT_FACE);
    }
  }, 120_000);

  it("sin lectura del hablante no hay con qué medir la falta: no hay ofensa", () => {
    expect(speakTo().offense).toBeUndefined();
  }, 120_000);
});
