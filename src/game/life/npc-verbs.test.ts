import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type HolderRef,
  holderAccount,
  loadContent,
} from "../../core/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  checkInvariants,
  GOODS,
  KNOWN_DEEDS,
  LOCATION,
  PERSON,
  PLACE,
  PLANS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { PLAN_STATE } from "./act.ts";
import { NPC_DECISION } from "./decide.ts";
import { Life } from "./life.ts";
import { NPC_JOURNEY, planFromDecision } from "./npc-verbs.ts";
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
const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));
const me = "agent:1" as AgentId;

describe("planFromDecision", () => {
  it("arma el plan del catálogo con los argumentos del id, en orden", () => {
    const gather = planFromDecision({ id: "gather:hierba", verb: "gather" }, catalog, me);
    expect(gather?.source).toBe("utility");
    expect(gather?.root).toEqual({
      kind: "do",
      verb: "gather",
      args: [{ role: "what", text: "hierba" }],
      manner: [],
    });
    expect(planFromDecision({ id: "gather:", verb: "gather" }, catalog, me)?.root).toMatchObject({
      args: [],
    });
    expect(
      planFromDecision({ id: "trade:agent:2+grano", verb: "trade" }, catalog, me)?.root,
    ).toMatchObject({
      args: [
        { role: "with", entity: "agent:2" },
        { role: "what", text: "grano" },
      ],
    });
    // El hurto creído (`take:<dueño>+<bien>`) se vuelve un `take` con `from` y `what`.
    expect(
      planFromDecision({ id: "take:agent:2+pan", verb: "take" }, catalog, me)?.root,
    ).toMatchObject({
      args: [
        { role: "from", entity: "agent:2" },
        { role: "what", text: "pan" },
      ],
    });
  });

  it("ir hacia alguien es caminar al lugar: el destino es el lugar, la persona es el porqué", () => {
    expect(
      planFromDecision({ id: "move:place:4+toward:agent:7", verb: "move" }, catalog, me)?.root,
    ).toEqual({
      kind: "do",
      verb: "move",
      args: [{ role: "to", entity: "place:4" }],
      manner: [],
    });
    expect(planFromDecision({ id: "move:", verb: "move" }, catalog, me)).toBe(undefined);
  });

  it("el acto de habla de la decisión viaja como contenido del speak", () => {
    const act = { kind: "greet" } as const;
    expect(
      planFromDecision({ id: "speak:agent:2", verb: "speak", act }, catalog, me)?.root,
    ).toMatchObject({
      args: [
        { role: "to", entity: "agent:2" },
        { role: "content", text: "", act },
      ],
    });
    expect(
      planFromDecision({ id: "speak:agent:2+hola", verb: "speak", act }, catalog, me)?.root,
    ).toMatchObject({
      args: [
        { role: "to", entity: "agent:2" },
        { role: "content", text: "hola", act },
      ],
    });
    // el acto solo cuenta en speak
    expect(
      planFromDecision({ id: "gather:", verb: "gather", act }, catalog, me)?.root,
    ).toMatchObject({
      args: [],
    });
  });

  it("no ejecuta ids de otro proceso, verbos desconocidos ni argumentos que faltan", () => {
    expect(planFromDecision({ id: "speak:agent:2+borrow:té", verb: "speak" }, catalog, me)).toBe(
      undefined,
    );
    expect(planFromDecision({ id: "give:agent:2+pawn:hoz", verb: "give" }, catalog, me)).toBe(
      undefined,
    );
    expect(planFromDecision({ id: "nada:", verb: "nada" }, catalog, me)).toBe(undefined);
    expect(planFromDecision({ id: "trade:", verb: "trade" }, catalog, me)).toBe(undefined);
    expect(planFromDecision({ id: "gather:a+b", verb: "gather" }, catalog, me)).toBe(undefined);
  });
});

function setup(npcVerbs: readonly string[] | undefined, id: string, verb: string) {
  const life = Life.create(7, content, npcVerbs ? { npcVerbs } : {});
  const w = life.world;
  const npc = living(w.truth).find(
    (x) => x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
  ) as AgentId;
  const forest = w.truth.ids(PLACE).find((p) => w.truth.get(PLACE, p)?.kind === "forest");
  const hex = forest ? w.truth.get(PLACE, forest)?.hexes[0] : undefined;
  if (hex !== undefined) w.truth.set(LOCATION, npc, { hex });
  w.truth.set(NPC_DECISION, npc, { at: life.now, id, verb, utility: 1, options: 2 } as never);
  return { life, w, npc };
}

const HOUR = 3600;

describe("el NPC ejecuta su decisión (opt-in)", () => {
  it("gather: la decisión vigente se vuelve un action.gather suyo, una sola vez", () => {
    const on = setup(["gather"], "gather:", "gather");
    on.life.advanceTo(on.life.now + 6 * HOUR);
    const mine = on.w.log.all().filter((e) => e.kind === "action.gather" && e.actors[0] === on.npc);
    expect(mine.length).toBeGreaterThan(0);
    expect(on.w.truth.get(PLAN_STATE, on.npc)?.plan.source).toBe("utility");

    const off = setup(undefined, "gather:", "gather");
    off.life.advanceTo(off.life.now + 6 * HOUR);
    expect(off.w.log.all().some((e) => e.kind === "action.gather" && e.actors[0] === off.npc)).toBe(
      false,
    );
  }, 120_000);
});

/** Un NPC con la decisión de tratar o dar algo de su despensa a otro vecino que está a su lado. */
function withNeighbor(verb: "trade" | "give" | "speak") {
  const life = Life.create(7, content, { npcVerbs: [verb] });
  const w = life.world;
  const adults = living(w.truth).filter(
    (x) => x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
  );
  const npc = adults[0] as AgentId;
  const home = w.truth.get(PERSON, npc)?.household;
  const other = adults.find((x) => w.truth.get(PERSON, x)?.household !== home) as AgentId;
  const here = w.truth.get(LOCATION, npc);
  if (here) w.truth.set(LOCATION, other, here);
  const stock = w.ledger
    .holdings(holderAccount(home as unknown as HolderRef))
    .filter((h) => h.unit.startsWith("good:") && h.amount > 0)
    .map((h) => content.get(GOODS, h.unit.slice(5)))
    .find((g) => g !== undefined);
  const id = verb === "speak" ? `speak:${other}` : `${verb}:${other}+${stock?.name ?? "grano"}`;
  // El hablar lleva un saludo declarado: sin palabras, pero con el acto.
  const act = verb === "speak" ? { act: { kind: "greet" } } : {};
  w.truth.set(NPC_DECISION, npc, {
    at: life.now,
    id,
    verb,
    ...act,
    utility: 1,
    options: 2,
  } as never);
  return { life, w, npc, other };
}

describe("el NPC ejecuta tratar y dar (opt-in)", () => {
  for (const verb of ["trade", "give", "speak"] as const) {
    it(`${verb}: la decisión vigente se vuelve un action.${verb} suyo y el ledger cierra`, () => {
      const { life, w, npc, other } = withNeighbor(verb);
      const total = w.ledger.audit();
      life.advanceTo(life.now + 6 * HOUR);
      const mine = w.log.all().filter((e) => e.kind === `action.${verb}` && e.actors[0] === npc);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine[0]?.actors).toContain(other);
      expect(total).toEqual([]);
      expect(w.ledger.audit()).toEqual([]);
      expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    }, 120_000);
  }
});

describe("hablar entre NPC no encadena respuestas sin fin", () => {
  it("en 24 horas de vida el intercambio queda acotado y el mundo sigue coherente", () => {
    const { life, w, npc, other } = withNeighbor("speak");
    life.advanceTo(life.now + 24 * HOUR);
    const talk = w.log
      .all()
      .filter(
        (e) => e.kind === "action.speak" && e.actors.includes(npc) && e.actors.includes(other),
      );
    // El dicho y su respuesta; más de un puñado sería un encadenamiento.
    expect(talk.length).toBeGreaterThan(0);
    expect(talk.length).toBeLessThanOrEqual(6);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 120_000);
});

describe("el NPC camina a un lugar decidido (opt-in)", () => {
  it("move: la decisión hacia un lugar se vuelve action.move con tiempo, no un salto", () => {
    const life = Life.create(7, content, { npcVerbs: ["move"] });
    const w = life.world;
    const npc = living(w.truth).find(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    ) as AgentId;
    const from = w.truth.get(LOCATION, npc)?.hex ?? -1;
    const place = w.truth.ids(PLACE).find((p) => !w.truth.get(PLACE, p)?.hexes.includes(from));
    if (!place) throw new Error("sin lugar");
    w.truth.set(NPC_DECISION, npc, {
      at: life.now,
      id: `move:${place}+toward:agent:99`,
      verb: "move",
      target: place,
      utility: 1,
      options: 2,
    } as never);
    life.advanceTo(life.now + 12 * HOUR);
    const steps = w.log.all().filter((e) => e.kind === "action.move" && e.actors[0] === npc);
    expect(steps.length).toBeGreaterThan(0);
    // Cada tramo tarda lo que cuesta caminarlo (horas, no un salto) y el NPC va acercándose.
    const seconds = (e: (typeof steps)[number]) => (e.data as { seconds?: number }).seconds ?? 0;
    expect(seconds(steps[0] as (typeof steps)[number])).toBeGreaterThan(HOUR);
    expect(w.truth.get(LOCATION, npc)?.hex).not.toBe(from);
  }, 120_000);

  /** Un NPC con viaje encendido y un lugar donde no está. */
  function traveler() {
    const life = Life.create(7, content, { npcVerbs: ["move"], npcJourneyDays: 6, npcMove: true });
    const w = life.world;
    const npc = living(w.truth).find(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    ) as AgentId;
    const from = w.truth.get(LOCATION, npc)?.hex ?? -1;
    const place = w.truth.ids(PLACE).find((p) => !w.truth.get(PLACE, p)?.hexes.includes(from));
    if (!place) throw new Error("sin lugar");
    const trip = () =>
      w.log
        .all()
        .filter((e) => e.kind === "npc.journey" && e.actors[0] === npc)
        .map((e) => (e.data as { what: string }).what);
    return { life, w, npc, place, trip };
  }

  it("con viaje, la decisión abre un viaje con comienzo y llegada como eventos y no lo reabre", () => {
    const { life, w, npc, place, trip } = traveler();
    w.truth.set(NPC_DECISION, npc, {
      at: life.now,
      id: `move:${place}+toward:agent:99`,
      verb: "move",
      target: place,
      utility: 1,
      options: 2,
    } as never);
    life.advanceTo(life.now + 6 * HOUR);
    // En el lugar, con npcMove se queda ahí el rato de la decisión.
    expect(w.truth.get(PLACE, place)?.hexes).toContain(w.truth.get(LOCATION, npc)?.hex);
    life.advanceTo(life.now + 3 * 86_400);
    expect(trip()).toEqual(["started", "arrived"]);
    expect(w.truth.get(NPC_JOURNEY, npc)).toBeUndefined();
  }, 120_000);

  it("un viaje en curso sigue sin que la decisión esté vigente y termina al llegar", () => {
    const { life, w, npc, place, trip } = traveler();
    w.truth.set(NPC_JOURNEY, npc, { place, since: life.now, decision: "move:viejo" });
    life.advanceTo(life.now + 2 * 86_400);
    expect(w.log.all().some((e) => e.kind === "action.move" && e.actors[0] === npc)).toBe(true);
    expect(trip()).toEqual(["arrived"]);
    expect(w.truth.get(NPC_JOURNEY, npc)).toBeUndefined();
  }, 120_000);

  it("un viaje que pasa del tope de días se rinde y queda dicho", () => {
    const { life, w, npc, place, trip } = traveler();
    w.truth.set(NPC_JOURNEY, npc, {
      place,
      since: life.now - 7 * 86_400,
      decision: "move:viejo",
    });
    life.advanceTo(life.now + 2 * HOUR);
    expect(trip()).toEqual(["gave_up"]);
    expect(w.truth.get(NPC_JOURNEY, npc)).toBeUndefined();
    expect(w.log.all().some((e) => e.kind === "action.move" && e.actors[0] === npc)).toBe(false);
  }, 120_000);
});

describe("el NPC hurta lo que decidió (opt-in)", () => {
  it("take: lo que lleva encima el otro pasa a su bolsillo, el ledger cierra y los invariantes pasan", () => {
    const life = Life.create(7, content, { npcVerbs: ["take"] });
    const w = life.world;
    const adults = living(w.truth).filter(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    );
    const npc = adults[0] as AgentId;
    const home = w.truth.get(PERSON, npc)?.household;
    const owner = adults.find((x) => w.truth.get(PERSON, x)?.household !== home) as AgentId;
    const here = w.truth.get(LOCATION, npc);
    if (here) w.truth.set(LOCATION, owner, here);
    // El dueño lleva un bien encima (la despensa de su casa a su bolsillo), no solo monedas.
    const ownerHome = w.truth.get(PERSON, owner)?.household as unknown as HolderRef;
    const stock = w.ledger
      .holdings(holderAccount(ownerHome))
      .find((h) => h.unit.startsWith("good:") && h.amount >= 1000);
    expect(stock).toBeDefined();
    const carried = w.ids.next("event");
    w.log.append({
      id: carried,
      tick: life.now,
      kind: "test.carried",
      actors: [owner],
      place: { kind: "none" } as never,
      data: null,
      emissions: {},
      causes: [{ kind: "seed" }],
      resolution: "local",
    });
    w.ledger.post({
      tick: life.now,
      eventId: carried,
      transfers: [
        {
          unit: stock?.unit as never,
          from: holderAccount(ownerHome),
          to: holderAccount(owner as unknown as HolderRef),
          amount: 1000,
        },
      ],
    });
    const pocket = (who: AgentId) =>
      w.ledger
        .holdings(holderAccount(who as unknown as HolderRef))
        .reduce((a, h) => a + h.amount, 0);
    const [mine0, theirs0] = [pocket(npc), pocket(owner)];
    expect(theirs0).toBeGreaterThan(0);
    w.truth.set(NPC_DECISION, npc, {
      at: life.now,
      id: `take:${owner}`,
      verb: "take",
      utility: 1,
      options: 2,
    } as never);
    life.advanceTo(life.now + 6 * HOUR);
    const taken = w.log.all().filter((e) => e.kind === "action.take" && e.actors[0] === npc);
    expect(taken.length).toBeGreaterThan(0);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    // Lo que sale del bolsillo del dueño entra al del ladrón, nada se crea ni se pierde.
    const moved = theirs0 - pocket(owner);
    expect(moved).toBe(1000);
    expect(pocket(npc) - mine0).toBe(moved);
    // Sin testigos ni descubrimiento, el robo no deja un hecho conocido (law §2): la sanción de
    // `takeBelieved` solo crece con los robos de los que alguien se enteró.
    expect(
      [...w.truth.ids(KNOWN_DEEDS)].flatMap((id) => w.truth.get(KNOWN_DEEDS, id)?.deeds ?? []),
    ).toEqual([]);
  }, 120_000);
});

describe("dos NPC le hablan a la vez al mismo vecino", () => {
  it("la disputa por lo que el oyente va a contestar se resuelve por iniciativa, sin romper el scheduler", () => {
    const life = Life.create(7, content, { npcVerbs: ["speak"] });
    const w = life.world;
    const adults = living(w.truth).filter(
      (x) =>
        x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
    );
    const [a, b, listener] = adults as [AgentId, AgentId, AgentId];
    const here = w.truth.get(LOCATION, a);
    if (here) for (const x of [b, listener]) w.truth.set(LOCATION, x, here);
    for (const who of [a, b]) {
      w.truth.set(NPC_DECISION, who, {
        at: life.now,
        id: `speak:${listener}`,
        verb: "speak",
        act: { kind: "greet" },
        utility: 1,
        options: 2,
      } as never);
    }
    expect(() => life.advanceTo(life.now + 6 * HOUR)).not.toThrow();
    const talk = w.log
      .all()
      .filter((e) => e.kind === "action.speak" && e.actors.includes(listener));
    expect(talk.length).toBeGreaterThan(0);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    // La disputa deja su registro: quién perdió y con qué iniciativa.
    const contests = w.log.all().filter((e) => e.kind === "contest");
    expect(contests.length).toBeGreaterThan(0);
  }, 240_000);
});
