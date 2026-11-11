// Presentarse (novel-names-introduce): a un desconocido el personaje no le sabe el nombre; si se lo
// pregunta, el otro lo dice, el personaje lo guarda y desde ahí lo reconoce y lo nombra al verlo.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, HOUR, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  callName,
  checkInvariants,
  greets,
  introduces,
  LOCATION,
  normalize,
  PERSON,
  PERSON_NAME,
  type Percept,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { knownEntities } from "./known.ts";
import { KNOWN_NAMES } from "./known-names.ts";
import { Life } from "./life.ts";
import { playerView } from "./view.ts";
import { acquaintances, playerObserver } from "./witness.ts";
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

describe("presentarse", () => {
  it("preguntar el nombre o presentarse es su propio acto", () => {
    for (const text of ["Hola, ¿cómo te llamás?", "Me llamo Ponya", "¿Cuál es su nombre?"]) {
      expect(introduces(normalize(text))).toBe(true);
    }
    expect(introduces(normalize("Hola, ¿cómo andás?"))).toBe(false);
    expect(greets(normalize("Hola"))).toBe(true);
  });

  it("el desconocido dice su nombre y desde ahí el personaje lo reconoce", () => {
    const life = Life.create(7, content);
    const w = life.world;
    const me = life.player;
    const home = w.truth.get(PERSON, me)?.household;
    const stranger = living(w.truth).find(
      (id) =>
        id !== me &&
        w.truth.get(PERSON, id)?.household !== home &&
        w.truth.has(PERSON_NAME, id) &&
        (life.now - (w.truth.get(PERSON, id)?.born ?? life.now)) / w.clock.year > 16,
    ) as AgentId;
    expect(stranger).toBeDefined();
    const here = w.truth.get(LOCATION, me);
    if (!here) throw new Error("sin lugar");
    w.truth.set(LOCATION, stranger, here);
    const seenNow = () => {
      let seen: readonly Percept[] = [];
      playerView(w, [], { intro: true, onSeen: (p) => (seen = p) });
      return knownEntities(w, seen).filter((k) => k.ref === stranger);
    };
    const given = callName(w.truth.get(PERSON_NAME, stranger) ?? { language: "", parts: [] });
    expect(given).toBeDefined();
    // Antes: una figura sin nombre.
    expect(seenNow().some((k) => k.names.includes(given as string))).toBe(false);
    expect(acquaintances(w).has(stranger)).toBe(false);

    const report = life.turn(say(me, stranger, "Hola, ¿cómo te llamás?"), 1);
    const reply = report.events.find((e) => e.kind === "action.speak" && e.actors[0] === stranger);
    const effect = (reply?.data as { effect?: { reply: string; text: string } } | undefined)
      ?.effect;
    expect(effect?.reply).toBe("introduce");
    expect(effect?.text).toContain(given as string);
    expect(w.truth.get(KNOWN_NAMES, me)?.people[stranger]?.name).toBe(given);
    expect(acquaintances(w).get(stranger)?.name).toBe(given);
    // Después: lo cuenta entre sus conocidos y, al verlo, lo reconoce (la identidad se lee con la
    // vista y puede fallar en una mirada, como con la familia) y lo nombra.
    expect(playerObserver(w, 1, life.now).familiar.get(stranger)).toBeGreaterThan(0);
    let named = false;
    for (let h = 0; h < 6 && !named; h++) {
      life.advanceTo(life.now + HOUR);
      const at = w.truth.get(LOCATION, me);
      if (at) w.truth.set(LOCATION, stranger, at);
      named = seenNow().some((k) => k.names.includes(given as string));
    }
    expect(named).toBe(true);
    expect(checkInvariants({ truth: w.truth, log: w.log })).toEqual([]);
  }, 60_000);
});
