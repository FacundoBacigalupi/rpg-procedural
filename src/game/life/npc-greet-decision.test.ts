import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import { LOCATION, PERSON, PLACE } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import type { LifeOptions } from "./create.ts";
import { Life } from "./life.ts";
import { GREETED_EVENT } from "./npc-greetings.ts";
import { NPC_GREETED, NPC_MET } from "./npc-met.ts";
import { NPC_JOURNEY } from "./npc-verbs.ts";
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
const HOUR = 3600;
const BASE: LifeOptions = {
  npcVerbs: ["move", "speak"],
  npcJourneyDays: 6,
  npcMove: true,
  npcEncounters: true,
  npcGreetings: true,
};

/** Dos viajeros que se cruzaron y siguen en el mismo hex, con el viaje del primero abierto. */
function crossing(options: LifeOptions) {
  const life = Life.create(7, content, options);
  const w = life.world;
  const adults = living(w.truth).filter(
    (x) => x !== life.player && (w.truth.get(PERSON, x)?.born ?? 0) < life.now - 20 * 365 * 86_400,
  );
  const npc = adults[0] as AgentId;
  const other = adults[1] as AgentId;
  const here = w.truth.get(LOCATION, npc);
  if (here) w.truth.set(LOCATION, other, here);
  const from = here?.hex ?? -1;
  const place = w.truth.ids(PLACE).find((p) => !w.truth.get(PLACE, p)?.hexes.includes(from));
  if (!place) throw new Error("sin lugar");
  w.truth.set(NPC_JOURNEY, npc, { place, since: life.now, decision: "move:viejo" });
  w.truth.set(NPC_MET, npc, { since: life.now, met: [other] });
  return { life, w, npc, other, place };
}

describe("el saludo al cruzarse por la decisión (life-33)", () => {
  it("el viajero saluda con speak/greet, lo anota y el viaje sigue; no corre el efecto directo", () => {
    const { life, w, npc } = crossing(BASE);
    life.advanceTo(life.now + 8 * HOUR);
    const spoken = w.log.all().filter((e) => e.kind === "action.speak" && e.actors[0] === npc);
    expect(spoken.length).toBeGreaterThan(0);
    expect(w.log.all().some((e) => e.kind === GREETED_EVENT)).toBe(false);
    // Una sola vez por pareja y viaje: la libreta lo anota y no se repite el saludo.
    const book = w.truth.get(NPC_GREETED, npc);
    if (book) expect(new Set(book.greeted).size).toBe(book.greeted.length);
    // El viaje manda: sigue abierto o llegó, nunca quedó pisado por el saludo.
    const trip = w.log
      .all()
      .filter((e) => e.kind === "npc.journey" && e.actors[0] === npc)
      .map((e) => (e.data as { what: string }).what);
    expect(w.truth.get(NPC_JOURNEY, npc) !== undefined || trip.includes("arrived")).toBe(true);
    expect(w.log.all().some((e) => e.kind === "action.move" && e.actors[0] === npc)).toBe(true);
  }, 120_000);

  it("con el motor anterior (legacyNoGreetDecision) lo hace life.npc_greetings", () => {
    const { life, w, npc } = crossing({ ...BASE, legacyNoGreetDecision: true });
    life.advanceTo(life.now + 8 * HOUR);
    expect(w.log.all().some((e) => e.kind === GREETED_EVENT)).toBe(true);
    expect(w.log.all().some((e) => e.kind === "action.speak" && e.actors[0] === npc)).toBe(false);
  }, 120_000);

  it("sin speak en npcVerbs el efecto directo sigue como antes", () => {
    const { life, w } = crossing({ ...BASE, npcVerbs: ["move"] });
    life.advanceTo(life.now + 8 * HOUR);
    expect(w.log.all().some((e) => e.kind === GREETED_EVENT)).toBe(true);
  }, 120_000);

  it("es determinista: misma vida, mismo hash", () => {
    const run = () => {
      const { life } = crossing(BASE);
      life.advanceTo(life.now + 8 * HOUR);
      return life.hash();
    };
    expect(run()).toEqual(run());
  }, 240_000);
});
