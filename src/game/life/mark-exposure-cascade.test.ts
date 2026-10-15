// perfil2c-mark-exposure-cascade: el `scam.discovered` que emite `life.marks` (perceive) al repasar
// una marca falsa llega, en la segunda ronda `perceiveCascade` del scheduler, a `life.mark_exposure`
// (rumor `fraud`, `marks.cleared`, `MARK_CLEARED`) y a `life.deeds` (el fraude en `KNOWN_DEEDS`).
// De punta a punta con una Life real: el personaje recibió un lote con la marca de un vecino copiada
// por otro y lo mira (`look`) hasta descubrirlo.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EventId,
  loadContent,
  type Tick,
} from "../../core/index.ts";
import { type ActionPlan, KNOWN_DEEDS, PERSON, RUMORS } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { engineOptions, Life } from "./life.ts";
import { MARK_CLEARED, MARK_CLEARED_EVENT } from "./markexposure.ts";
import { LOT_MARKS } from "./marks.ts";
import { SCAM_DISCOVERED } from "./scamdiscovery.ts";
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
const OPTIONS = { scam: true, marks: true, marksExpose: true, marksGossip: true } as const;
const LOOKS = 12;

function look(actor: AgentId): ActionPlan {
  return {
    actor,
    source: "player",
    root: { kind: "do", verb: "look", args: [], manner: [] },
    manner: [],
    causes: [{ kind: "state", entity: actor, key: "intent" }],
  };
}

function run(engine?: string) {
  const life = Life.create(3, content, engine ? engineOptions(engine, OPTIONS) : OPTIONS);
  const w = life.world;
  const me = life.player;
  const [forger, copied] = (living(w.truth) as AgentId[])
    .filter((x) => x !== me && w.truth.get(PERSON, x) !== undefined)
    .sort();
  if (!forger || !copied) throw new Error("faltan vecinos");
  const deal = w.log.all()[0]?.id as EventId;
  // Lo que dejó el trato: un lote de grano con la marca de `copied` estampada por `forger`, mal copiada,
  // que el personaje creyó auténtica al recibirlo.
  w.truth.set(LOT_MARKS, me, {
    lots: [
      {
        event: deal,
        unit: "good:grain",
        grams: 1000,
        mark: {
          claimedBy: copied,
          stampedBy: forger,
          tick: life.now as Tick,
          claimed: 0.8,
          fidelity: 0,
        },
        seemsForged: false,
        credence: 0.8,
      },
    ],
  });
  for (let seq = 1; seq <= LOOKS && life.alive; seq++) {
    life.turn(look(me), seq);
    if (w.log.all().some((e) => e.kind === SCAM_DISCOVERED)) break;
  }
  return { life, w, me, forger, copied };
}

describe("la falsificación descubierta llega a la exposición (perceiveCascade)", () => {
  it("mirar el lote destapa la marca falsa: rumor fraud, marks.cleared y el hecho conocido", () => {
    const r = run();
    const log = r.w.log.all();
    const found = log.find((e) => e.kind === SCAM_DISCOVERED);
    if (!found) throw new Error("el personaje no descubrió la marca falsa");
    expect(found.actors).toEqual([r.forger, r.me, r.copied]);
    expect((found.data as { forgedMark?: boolean }).forgedMark).toBe(true);
    // life.mark_exposure: la reparación del copiado, con causa en el descubrimiento.
    const cleared = log.find((e) => e.kind === MARK_CLEARED_EVENT);
    expect(cleared?.causes).toEqual([{ kind: "event", event: found.id }]);
    expect(cleared?.tick).toBe(found.tick);
    expect(r.w.truth.get(MARK_CLEARED, r.copied)?.entries).toMatchObject([
      { buyer: r.me, forger: r.forger },
    ]);
    // El rumor `fraud` en la cabeza del comprador (creencia, no verdad).
    const rumor = r.w.truth.get(RUMORS, r.me)?.items.find((x) => x.root === found.id);
    expect(rumor?.content).toMatchObject({ kind: "fraud", by: r.forger, victim: r.me });
    // life.deeds: el fraude queda entre lo que sabe, con quién fue.
    const deed = r.w.truth.get(KNOWN_DEEDS, r.me)?.deeds.find((d) => d.event === found.id);
    expect(deed).toMatchObject({ kind: "fraud", by: r.forger, victim: r.me });
    // Determinista: los mismos turnos dejan el mismo mundo.
    expect(run().life.hash().total).toBe(r.life.hash().total);
  }, 240_000);

  it("el replay de un motor anterior a life-27 conserva el bug: nada llega a la exposición", () => {
    const r = run("life-26");
    const log = r.w.log.all();
    const found = log.find((e) => e.kind === SCAM_DISCOVERED);
    if (!found) throw new Error("el personaje no descubrió la marca falsa");
    expect(log.some((e) => e.kind === MARK_CLEARED_EVENT)).toBe(false);
    expect(r.w.truth.get(MARK_CLEARED, r.copied)).toBeUndefined();
    expect(r.w.truth.get(KNOWN_DEEDS, r.me)?.deeds.some((d) => d.event === found.id)).not.toBe(
      true,
    );
  }, 240_000);
});
