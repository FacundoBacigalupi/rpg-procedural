// Chisme entre vecinos (information §2-§3): cada hora, los NPC que comparten lugar pueden contarse
// lo que saben de lo que otros hicieron. Contar sale de las ganas (`tellDesire`: novedad, gravedad,
// sociabilidad contra proteger o temerle al culpable) y el hecho sale deformado de la boca del que
// cuenta (`distortRumor`, con el rencor y la memoria del narrador). El oyente lo pesa por quién lo
// cuenta (`hearRumor`): lo guarda como rumor con su salto en el linaje (`RUMORS`), como hecho
// `told` (`KNOWN_DEEDS`) si lo cree lo bastante, y como memoria `told` (`MEMORIES`). Cada contada es
// un evento `rumor.told` con causa en el hecho real. Nadie lee la verdad: solo lo que sabe
// (`KNOWN_DEEDS`, `RUMORS`), sus relaciones y su temperamento. El personaje del jugador queda
// afuera (lo que cuenta lo decide él en el diálogo).

import type { AgentId, EventId } from "../../core/index.ts";
import {
  addMemory,
  BELIEVED_AT,
  clampTemper,
  contentOfDeed,
  type DeedKind,
  decidesToTell,
  distortRumor,
  ENTITY,
  type EventDraft,
  firstHand,
  formMemory,
  type HeardRumor,
  hearRumor,
  INNATE,
  KIND_WEIGHT,
  KNOWN_DEEDS,
  type KnownDeeds,
  keepRumor,
  LOCATION,
  MEMORIES,
  type Memories,
  MIND,
  markTold,
  PERSON,
  type ProcessDef,
  RELATIONS,
  RUMORS,
  type Rumors,
  relationship,
  rumorAsKnown,
  type StateChange,
  setComponent,
  spoken,
  standardize,
  tellDesire,
} from "../../sim/index.ts";
import { suspectOf, type TestifyOptions } from "./testify.ts";

export const GOSSIP_PROCESS = "life.gossip";
export const RUMOR_TOLD_EVENT = "rumor.told";

export interface GossipOptions extends TestifyOptions {
  readonly player: AgentId;
}

const DAY = 86_400;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

interface Candidate {
  readonly rumor: HeardRumor;
  readonly desire: number;
  readonly listener: AgentId;
}

export function gossipProcess(o: GossipOptions): ProcessDef {
  return {
    id: GOSSIP_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "hour", scene: "hour" },
    representation: "individual",
    phase: "decide",
    reads: [
      KNOWN_DEEDS.name,
      RUMORS.name,
      MEMORIES.name,
      RELATIONS.name,
      MIND.name,
      INNATE.name,
      PERSON.name,
      LOCATION.name,
      ENTITY.name,
    ],
    writes: [RUMORS.name, KNOWN_DEEDS.name, MEMORIES.name],
    run(ctx) {
      const truth = ctx.truth;
      const now = ctx.now;
      // Quien ya está en una conversación este paso no chismea (evita pisar lo que escribe `converse`).
      const busy = new Set<AgentId>();
      for (const e of ctx.recent) for (const a of e.actors) busy.add(a as AgentId);
      const groups = new Map<string, AgentId[]>();
      for (const id of truth.ids(PERSON).sort() as AgentId[]) {
        if (id === o.player || busy.has(id)) continue;
        if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const at = truth.get(LOCATION, id);
        if (!at) continue;
        const key = `${at.hex}:${at.space ?? ""}`;
        groups.set(key, [...(groups.get(key) ?? []), id]);
      }
      const rumors = new Map<AgentId, Rumors | undefined>();
      const known = new Map<AgentId, KnownDeeds | undefined>();
      const memories = new Map<AgentId, Memories | undefined>();
      const dirty = new Set<AgentId>();
      const rumorsOf = (id: AgentId) => (rumors.has(id) ? rumors.get(id) : truth.get(RUMORS, id));
      const knownOf = (id: AgentId) => (known.has(id) ? known.get(id) : truth.get(KNOWN_DEEDS, id));
      const memoriesOf = (id: AgentId) =>
        memories.has(id) ? memories.get(id) : truth.get(MEMORIES, id);
      const feeling = (from: AgentId, to: AgentId) =>
        relationship(truth.get(RELATIONS, from), to, now, {
          dims: o.dims,
          bonds: o.bonds,
          schemaStrength: (s) => truth.get(MIND, from)?.schemas[s]?.strength ?? 0,
        });
      const z = (id: AgentId) => {
        const innate = truth.get(INNATE, id);
        return innate ? standardize(innate, o.traits, truth.get(PERSON, id)?.sex ?? "female") : {};
      };
      const events: EventDraft[] = [];
      const tellers = [...groups.values()].flat().sort();
      for (const teller of tellers) {
        const here = groups.get(groupKey(truth, teller)) ?? [];
        if (here.length < 2) continue;
        const mine = candidatesOf(teller, rumorsOf(teller), knownOf(teller));
        if (mine.length === 0) continue;
        const zt = z(teller);
        let best: Candidate | null = null;
        for (const listener of here) {
          if (listener === teller) continue;
          const told = rumorsOf(teller)?.told ?? [];
          const lr = feeling(teller, listener).dims;
          for (const h of mine) {
            const { by, victim } = h.content;
            if (listener === by || listener === victim) continue;
            const knows =
              knownOf(listener)?.deeds.some((d) => d.event === h.root) === true ||
              rumorsOf(listener)?.items.some((x) => x.root === h.root) === true;
            const toDoer = by ? feeling(teller, by).dims : null;
            const toVictim = feeling(listener, victim).dims;
            const desire = tellDesire({
              content: h.content,
              ageDays: Math.max(0, (now - h.heardAt) / DAY),
              relevance: clamp01(Math.max(toVictim.affection, toVictim.familiarity)),
              sociability: clamp01(0.5 + 0.25 * clampTemper(zt["sociability"] ?? 0)),
              protects: toDoer ? clamp01(Math.max(0, toDoer.affection)) : 0,
              fearOfDoer: toDoer ? clamp01(toDoer.fear) : 0,
              trustInListener: clamp01(lr.trust),
              alreadyTold: knows || told.some((t) => t.root === h.root && t.to === listener),
            });
            if (desire > (best?.desire ?? 0)) best = { rumor: h, desire, listener };
          }
        }
        if (!best) continue;
        const { rumor: h, listener } = best;
        const rng = ctx.rng.fork("gossip", teller, listener, h.root);
        if (!decidesToTell(best.desire, rng)) continue;
        // Cómo lo cuenta: deformado por lo que él recuerda y a quién le guarda rencor.
        const suspect = suspectOf(
          truth,
          o,
          teller,
          [h.content.by, h.content.victim, listener],
          now,
        );
        const out = distortRumor(
          h.content,
          {
            memory: clamp01(0.4 + 0.3 * clampTemper(zt["memory"] ?? 0) + 0.3 * h.confidence),
            drama: clamp01(0.5 + 0.25 * clampTemper(zt["reactivity"] ?? 0)),
            hurry: 0,
            grudge: suspect ? { who: suspect.who, strength: suspect.resentment } : null,
          },
          rng.fork("distort"),
        );
        const said = spoken(h, out.content);
        const zl = z(listener);
        const toTeller = feeling(listener, teller).dims;
        const toDoer = out.content.by ? feeling(listener, out.content.by).dims : null;
        const prev = rumorsOf(listener)?.items.find((x) => x.root === h.root);
        const heard = hearRumor(
          prev,
          said,
          teller,
          listener,
          {
            trustInTeller: toTeller.trust,
            affectionToDoer: toDoer ? toDoer.affection : 0,
            credulity: clamp01(0.5 - 0.2 * clampTemper(zl["curiosity"] ?? 0)),
            attention: clamp01(0.5 + 0.25 * clampTemper(zl["memory"] ?? 0)),
          },
          now,
          rng.fork("hear"),
        );
        rumors.set(teller, markTold(rumorsOf(teller), h.root, listener));
        rumors.set(listener, keepRumor(rumorsOf(listener), heard));
        known.set(listener, rumorAsKnown(heard, knownOf(listener)));
        if (!prev && heard.confidence >= 0.1) {
          memories.set(
            listener,
            addMemory(
              memoriesOf(listener),
              formMemory({
                eventId: h.root,
                kind: `rumor.${heard.content.kind}`,
                with: heard.content.by
                  ? [heard.content.by, heard.content.victim]
                  : [heard.content.victim],
                place: o.placeOf(truth, listener),
                at: heard.at,
                intensity: KIND_WEIGHT[heard.content.kind as DeedKind] * 0.6,
                valence: -0.3 * KIND_WEIGHT[heard.content.kind as DeedKind],
                source: "told",
                toldBy: teller,
                clarity: heard.confidence,
              }),
              now,
            ),
          );
        }
        dirty.add(teller);
        dirty.add(listener);
        events.push({
          kind: RUMOR_TOLD_EVENT,
          actors: [teller, listener],
          place: o.placeOf(truth, teller),
          data: {
            deed: h.root,
            kind: out.content.kind,
            accused: out.content.by,
            hops: said.hops,
            credit: heard.confidence,
            // Solo para el inspector y los tests: qué cambió al contarlo.
            truthOf: { changes: out.changes },
          },
          emissions: {},
          causes: [{ kind: "event", event: h.root as EventId }],
        });
      }
      if (events.length === 0) return {};
      const changes: StateChange[] = [];
      for (const id of [...dirty].sort()) {
        const r = rumors.get(id);
        if (r) changes.push(setComponent(RUMORS, id, r));
        const k = known.get(id);
        if (k && k !== truth.get(KNOWN_DEEDS, id)) changes.push(setComponent(KNOWN_DEEDS, id, k));
        const m = memories.get(id);
        if (m) changes.push(setComponent(MEMORIES, id, m));
      }
      return { changes, events };
    },
  };
}

function groupKey(truth: Parameters<ProcessDef["run"]>[0]["truth"], id: AgentId): string {
  const at = truth.get(LOCATION, id);
  return at ? `${at.hex}:${at.space ?? ""}` : "";
}

/** Lo que `id` puede contar: sus rumores creídos y los hechos que sabe, sin repetir raíz. */
function candidatesOf(
  id: AgentId,
  rumors: Rumors | undefined,
  known: KnownDeeds | undefined,
): HeardRumor[] {
  const out = new Map<EventId, HeardRumor>();
  for (const h of rumors?.items ?? []) {
    if (h.confidence >= BELIEVED_AT) out.set(h.root, h);
  }
  for (const d of known?.deeds ?? []) {
    if (out.has(d.event)) continue;
    const fh = firstHand(d.event, contentOfDeed(d), d.at, d.at, id);
    out.set(
      d.event,
      d.via === "saw" ? fh : { ...fh, hops: 1, confidence: d.via === "heard" ? 0.7 : 0.5 },
    );
  }
  return [...out.values()].sort((a, b) => (a.root < b.root ? -1 : 1));
}
