import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EventId,
  loadContent,
  makeId,
} from "../../core/index.ts";
import { GAME_CONTENT_KINDS } from "../../game/index.ts";
import { emptyMental, MENTAL, openCondition, PERSON } from "../../sim/index.ts";
import { Life, playerView } from "./index.ts";
import { thoughtsOf } from "./thoughts.ts";

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

/** Una vida real con una hora de corrida; devuelve el inicio del "turno" y un evento ya asentado. */
function lived() {
  const life = Life.create(7, content);
  const w = life.world;
  life.advanceTo(life.now + w.clock.day / 24);
  const since = life.now;
  life.advanceTo(since + w.clock.day / 24);
  const first = w.log.all()[0];
  if (!first) throw new Error("sin eventos");
  const others = [...w.truth.ids(PERSON)].filter((id) => id !== life.player) as AgentId[];
  return { life, w, since, cause: first.id, place: first.place, other: others[0] as AgentId };
}

function emit(
  w: ReturnType<typeof lived>["w"],
  place: ReturnType<typeof lived>["place"],
  kind: string,
  actor: AgentId,
  cause: EventId,
  data: unknown = {},
) {
  w.log.append({
    id: makeId("event", w.log.lastNumber + 1),
    tick: w.scheduler.now,
    kind,
    actors: [actor],
    place,
    data,
    emissions: {},
    causes: [{ kind: "event", event: cause }],
    resolution: "scene",
  });
}

describe("thoughtsOf con una vida real", () => {
  it("la pesadilla de la noche pasa a modo sueño, con el miedo de su condición", () => {
    const { life, w, since, cause, place, other } = lived();
    w.truth.set(
      MENTAL,
      life.player,
      openCondition(emptyMental(cause, 0), "trauma", 0.8, cause, { who: other }, 0),
    );
    emit(w, place, "mind.nightmare", life.player, cause);
    const out = thoughtsOf(w, { since, present: [], known: new Set([other]) });
    expect(out.mode).toBe("dream");
    expect(out.thoughts[0]).toMatchObject({ kind: "feel", mood: "fear" });
  });

  it("una condición abierta durante el turno deja el modo secuela", () => {
    const { life, w, since, cause, other } = lived();
    w.truth.set(
      MENTAL,
      life.player,
      openCondition(emptyMental(cause, 0), "guilt", 0.6, cause, { who: other }, since + 1),
    );
    const out = thoughtsOf(w, { since, present: [], known: new Set() });
    expect(out.mode).toBe("aftermath");
  });

  it("la intrusión con el disparador presente recuerda a esa persona y no hay modo", () => {
    const { life, w, since, cause, place, other } = lived();
    w.truth.set(
      MENTAL,
      life.player,
      openCondition(emptyMental(cause, 0), "trauma", 0.8, cause, { who: other }, 0),
    );
    emit(w, place, "mind.intrusion", life.player, cause, { who: other });
    const out = thoughtsOf(w, { since, present: [other], known: new Set([other]) });
    expect(out.mode).toBeUndefined();
    expect(out.thoughts[0]).toMatchObject({ kind: "remember", mood: "fear", about: other });
    // A quien no conoce no se le pone etiqueta.
    const stranger = thoughtsOf(w, { since, present: [], known: new Set() });
    expect(stranger.thoughts[0]?.about).toBeUndefined();
  });

  it("armar la vista no cambia el estado (el replay no se entera)", () => {
    const { life, w, since, cause, place } = lived();
    emit(w, place, "mind.nightmare", life.player, cause);
    const before = life.hash();
    const view = playerView(w, [], { heardSince: since });
    expect(view.mode).toBe("dream");
    expect(life.hash()).toEqual(before);
  });
});
