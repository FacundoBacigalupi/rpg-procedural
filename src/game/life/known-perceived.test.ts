import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  EARTHLIKE_CLOCK,
  type EntityRef,
  loadContent,
} from "../../core/index.ts";
import {
  ageBand,
  checkInvariants,
  type IntentDraft,
  LOCATION,
  PERSON,
  type Percept,
  planFromDraft,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { featuresOfPercept, knownEntities } from "./known.ts";
import { Life } from "./life.ts";
import { playerView } from "./view.ts";
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

describe("lo que el personaje ve se puede nombrar al escribir", () => {
  it("dos desconocidos a la vista se resuelven en plural: «me acerco a los …»", () => {
    const life = Life.create(7, content, { frequency: 8 });
    const w = life.world;
    const me = w.truth.get(PERSON, w.player);
    // Dos personas de otra casa, de la misma figura, que aparecen a su lado.
    const others = living(w.truth).filter(
      (id) => id !== w.player && w.truth.get(PERSON, id)?.household !== me?.household,
    );
    const figure = (id: AgentId) => {
      const p = w.truth.get(PERSON, id);
      return `${p?.sex}/${ageBand((life.now - (p?.born ?? 0)) / EARTHLIKE_CLOCK.year)}`;
    };
    const byFigure = new Map<string, AgentId[]>();
    for (const id of others) byFigure.set(figure(id), [...(byFigure.get(figure(id)) ?? []), id]);
    const pair = [...byFigure.values()].find((g) => g.length >= 2)?.slice(0, 2) as AgentId[];
    expect(pair).toHaveLength(2);
    const here = w.truth.get(LOCATION, w.player);
    if (!here) throw new Error("sin lugar");
    // Los demás se van lejos: solo esos dos están a la vista.
    for (const id of others) w.truth.set(LOCATION, id, pair.includes(id) ? here : { hex: -1 });

    let seen: readonly Percept[] = [];
    playerView(w, [], { intro: true, onSeen: (p) => (seen = p) });
    const known = knownEntities(w, seen);
    const seenKnown = known.filter((k) => pair.includes(k.ref as AgentId));
    // Sin nombre (no los reconoce) y con lo que se ve; presentes.
    expect(seenKnown).toHaveLength(2);
    for (const k of seenKnown) {
      expect(k.present).toBe(true);
      expect(k.names).toEqual([]);
      expect(k.features).toContain("persona");
    }
    const word = featuresOfPercept(seen.find((p) => p.sourceEntityId === pair[0]) as Percept)[1];
    expect(word).toBeDefined();

    const draft: IntentDraft = {
      kind: "act",
      plan: {
        kind: "do",
        verb: "move",
        args: [{ role: "to", ref: { text: `los ${word}s`, kind: "person", features: [] } }],
      },
    } as IntentDraft;
    const made = planFromDraft(draft, {
      actor: w.player,
      source: "player",
      catalog: w.catalog,
      known,
      clock: w.clock,
      causes: [{ kind: "state", entity: w.player, key: "intent" }],
      here: here.hex,
    });
    // Antes: «No sabés quién o qué es los niños»; ahora se acerca a mirar y escuchar.
    expect(made.kind).toBe("plan");
    if (made.kind !== "plan") return;
    expect(made.groups?.[0]?.members).toEqual(expect.arrayContaining(pair as EntityRef[]));
    expect(made.plan.root).toMatchObject({ kind: "do", verb: "look" });
    const report = life.turn(made.plan, 1);
    expect(report.steps.length).toBeGreaterThan(0);
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);
});
