import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  AMENDS,
  BODY_STATE,
  checkInvariants,
  ENTITY,
  MEMORIES,
  OWN_DEEDS,
  PERSON,
  RELATIONS,
  strangerDims,
} from "../../sim/index.ts";
import { createLife } from "../life/create.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { buildChronicle } from "./chronicle.ts";
import { relationWeight } from "./people.ts";
import { renderChronicle } from "./render.ts";

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
const marks = { mode: "realista", inspected: false };

/** Una vida en la que el personaje muere de hambre a los pocos días. */
function starved(seed: number, before?: (w: ReturnType<typeof createLife>["world"]) => void) {
  const { world } = createLife(seed, content);
  before?.(world);
  const sched = world.scheduler;
  const body = world.truth.get(BODY_STATE, world.player);
  if (!body) throw new Error("sin cuerpo");
  const entered = sched.now;
  sched.advanceTo(entered + 3 * world.clock.day);
  world.truth.set(BODY_STATE, world.player, {
    ...body,
    death: { cause: "starvation", at: sched.now + 2 * world.clock.day },
  });
  sched.advanceTo(sched.now + 2 * world.clock.day);
  return { world, entered };
}

describe("la crónica mínima", { timeout: 60_000 }, () => {
  it("no hay crónica mientras el personaje vive", () => {
    const { world } = createLife(11, content);
    expect(() => buildChronicle(world, world.scheduler.now, marks)).toThrow(/vivo/);
  });

  it("dice la causa real, cita eventos que existen y cierra con la muerte", () => {
    const { world, entered } = starved(11);
    expect(world.truth.get(ENTITY, world.player)?.endedAt).toBeDefined();
    const c = buildChronicle(world, entered, marks);
    expect(c.death.cause).toBe("starvation");
    for (const id of c.sources) expect(world.log.has(id)).toBe(true);
    expect(c.chapters.at(-1)?.title.closedBy).toBe("death");
    expect(c.chapters[0]?.span.from).toBe(entered);
    for (let i = 1; i < c.chapters.length; i++) {
      expect(c.chapters[i]?.span.from).toBe(c.chapters[i - 1]?.span.to);
    }
    const text = renderChronicle(
      c,
      world.clock,
      (id) => world.log.get(id),
      () => "alguien",
    );
    expect(text).toContain("murió de hambre");
    expect(checkInvariants({ truth: world.truth, log: world.log })).toEqual([]);
  });

  it("es determinista: mismo seed, misma crónica", () => {
    const a = starved(5);
    const b = starved(5);
    expect(buildChronicle(a.world, a.entered, marks)).toEqual(
      buildChronicle(b.world, b.entered, marks),
    );
  });
});

/** Una vida en la que muere de hambre alguien a quien el personaje quería, sin que se entere. */
function lostFriend(seed: number) {
  let friend: AgentId | undefined;
  const { world, entered } = starved(seed, (w) => {
    const me = w.player;
    friend = (w.truth.ids(PERSON) as AgentId[]).find(
      (id) => id !== me && w.truth.get(ENTITY, id)?.endedAt === undefined,
    );
    const fbody = friend && w.truth.get(BODY_STATE, friend);
    if (!friend || !fbody) throw new Error("sin vecinos");
    const dims = { ...strangerDims(w.relationDims), familiarity: 0.9, affection: 0.9 };
    w.truth.set(RELATIONS, me, {
      toward: { [friend]: { dims, bonds: [], history: [], updated: w.scheduler.now } },
      originEventId: w.truth.get(ENTITY, me)?.originEventId as never,
    });
    w.truth.set(BODY_STATE, friend, {
      ...fbody,
      death: { cause: "starvation", at: w.scheduler.now + w.clock.day },
    });
  });
  return { world, entered, friend: friend as AgentId };
}

describe("personas importantes y lo que nunca supiste", { timeout: 60_000 }, () => {
  it("pesa más la relación fuerte que el extraño", () => {
    const stranger = strangerDims([]);
    expect(relationWeight({ ...stranger, familiarity: 0.9, affection: 0.9 })).toBeGreaterThan(
      relationWeight(stranger),
    );
  });

  it("la persona querida figura primero y su muerte ignorada está en lo que nunca supiste", () => {
    const { world, entered, friend } = lostFriend(11);
    expect(world.truth.get(ENTITY, friend)?.endedAt).toBeDefined();
    // El amigo murió antes que el personaje y él no tiene memoria ni creencia de que haya muerto.
    const c = buildChronicle(world, entered, marks);
    expect(c.people[0]?.who).toBe(friend);
    const entry = c.neverKnew.find((u) => u.who === friend);
    expect(entry?.kind).toBe("died_unknown");
    expect(c.sources).toContain(entry?.event);
    for (const id of c.sources) expect(world.log.has(id)).toBe(true);
    expect(c.people.length).toBeLessThanOrEqual(5);
    expect(c.neverKnew.length).toBeLessThanOrEqual(6);
  });

  it("recordar un hecho con otra gente de la que estuvo cuenta como recuerdo equivocado", () => {
    const { world, entered, friend } = lostFriend(11);
    const death = world.truth.get(ENTITY, friend)?.endEventId;
    if (!death) throw new Error("el amigo no murió");
    const other = (world.truth.ids(PERSON) as AgentId[]).find(
      (id) => id !== friend && id !== world.player,
    ) as AgentId;
    world.truth.set(MEMORIES, world.player, {
      gists: [],
      items: [
        {
          eventId: death,
          perceived: {
            kind: "body.died",
            with: [other],
            place: world.log.get(death)?.place as never,
          },
          source: "told",
          at: world.scheduler.now,
          intensity: 0.8,
          valence: -0.8,
          confidence: 0.5,
          distortion: 0,
          salience: 0.9,
          measured: world.scheduler.now,
          lastRecalled: world.scheduler.now,
          recalls: 0,
        },
      ],
    });
    const c = buildChronicle(world, entered, marks);
    const entry = c.neverKnew.find((u) => u.kind === "misremembered");
    expect(entry?.who).toBe(friend);
    expect(entry?.believedWith).toEqual([other]);
  });

  it("es determinista", () => {
    const a = lostFriend(5);
    const b = lostFriend(5);
    const ca = buildChronicle(a.world, a.entered, marks);
    expect(ca).toEqual(buildChronicle(b.world, b.entered, marks));
    expect(ca.people.map((p) => p.score)).toEqual(
      [...ca.people.map((p) => p.score)].sort((x, y) => y - x),
    );
  });
});

describe("la culpa en la crónica", { timeout: 60_000 }, () => {
  it("cuenta lo que cargó y qué decidió, citando el hecho", () => {
    const { world, entered } = starved(11);
    const deed = world.log.all()[0];
    const victim = world.truth.ids(PERSON).find((id) => id !== world.player) as AgentId;
    if (!deed) throw new Error("sin eventos");
    world.truth.set(OWN_DEEDS, world.player, {
      deeds: [{ kind: "theft", victim, at: deed.tick, event: deed.id, harm: 0.4 }],
    });
    world.truth.set(AMENDS, world.player, {
      byDeed: { [deed.id]: { response: "confess", guilt: 0.8, decided: deed.tick } },
    });
    const c = buildChronicle(world, entered, marks);
    expect(c.guilt.map((g) => g.deed)).toEqual([deed.id]);
    expect(c.sources).toContain(deed.id);
    const text = renderChronicle(
      c,
      world.clock,
      (id) => world.log.get(id),
      () => "Ana",
    );
    expect(text).toContain("Lo que cargaste:");
    expect(text).toContain("un peso enorme");
  });
});
