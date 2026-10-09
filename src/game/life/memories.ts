// Qué recuerda cada quien de lo que vivió (npc-psychology §5, Fase 2). De cada evento que ya
// interpreta `life.appraise` sale una `Experience` por participante: con qué intensidad y valencia
// la vivió según el papel que tuvo. Quien estuvo lo vio de cerca (confianza plena); los que se
// enteran de lejos llegan con el rumor (información, Fase 3). Funciones puras: el proceso las aplica.

import type { AgentId, Event } from "../../core/index.ts";
import { type Experience, PERCEPT_KEYS, type Percept } from "../../sim/index.ts";

export interface Lived {
  readonly who: AgentId;
  readonly experience: Experience;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** El tipo de la memoria de un halago recibido (la cuenta del desgaste sale de ahí). */
export const FLATTERY_MEMORY_KIND = "action.speak.flatter";

function base(e: Event, others: readonly AgentId[]) {
  return { eventId: e.id, kind: e.kind, with: others, place: e.place, at: e.tick } as const;
}

interface FightData {
  readonly hits?: readonly { to?: string; severity?: number }[];
}

/** Una pelea o un remate: el golpeado la guarda más hondo y más dolorosa que quien pegó. */
function fightLived(e: Event): Lived[] {
  const [first, second] = e.actors as [AgentId | undefined, AgentId | undefined];
  if (!first || !second) return [];
  const hits = ((e.data ?? {}) as FightData).hits ?? [];
  const worstOn = (id: AgentId) =>
    Math.max(0, ...hits.filter((h) => h.to === id).map((h) => h.severity ?? 0));
  if (e.kind === "combat.finish") {
    return [
      { who: first, experience: { ...base(e, [second]), intensity: 0.6, valence: -0.5 } },
      { who: second, experience: { ...base(e, [first]), intensity: 0.95, valence: -1 } },
    ];
  }
  const hurtFirst = worstOn(first);
  const hurtSecond = worstOn(second);
  return [
    {
      who: first,
      experience: {
        ...base(e, [second]),
        intensity: clamp01(0.25 + 0.6 * hurtFirst + 0.15 * hurtSecond),
        valence: -clamp01(0.3 * hurtSecond + 0.7 * hurtFirst),
      },
    },
    {
      who: second,
      experience: {
        ...base(e, [first]),
        intensity: clamp01(0.25 + 0.6 * hurtSecond + 0.15 * hurtFirst),
        valence: -clamp01(0.3 * hurtFirst + 0.7 * hurtSecond),
      },
    },
  ];
}

interface Effect {
  readonly kind?: string;
  readonly to?: string;
  readonly with?: string;
  readonly target?: string;
  readonly grams?: number;
  readonly deal?: boolean;
  readonly edge?: number;
  readonly done?: boolean;
  readonly care?: number;
  readonly judged?: { readonly verdict?: string; readonly certain?: boolean };
  readonly form?: { readonly faceLoss?: number };
  readonly regard?: {
    readonly kind?: string;
    readonly response?: string;
    readonly faceLoss?: number;
    readonly deltas?: { readonly fear?: number };
  };
}

/** Lo que cada parte guarda de un evento, según el papel que tuvo. */
export function livedFrom(e: Event): Lived[] {
  const actor = e.actors[0] as AgentId | undefined;
  const second = e.actors[1] as AgentId | undefined;
  switch (e.kind) {
    case "combat.fight":
    case "combat.finish":
      return fightLived(e);
    case "combat.spare":
      return actor && second
        ? [
            { who: actor, experience: { ...base(e, [second]), intensity: 0.4, valence: 0.3 } },
            { who: second, experience: { ...base(e, [actor]), intensity: 0.7, valence: 0.8 } },
          ]
        : [];
    case "action.speak": {
      // Quien oyó creyó descubrir una mentira: lo guarda; el acusado lo vive como afrenta si era
      // sincero y como un susto si mentía (CaughtLie en memoria, dialogue §4).
      const eff = (e.data as { effect?: Effect } | null)?.effect;
      if (eff?.kind !== "speak" || !actor || !second) return [];
      const out: Lived[] = [];
      if (eff.judged?.verdict === "caught") {
        const sure = eff.judged.certain === true;
        out.push(
          { who: actor, experience: { ...base(e, [second]), intensity: 0.5, valence: -0.5 } },
          {
            who: second,
            experience: {
              ...base(e, [actor]),
              intensity: sure ? 0.4 : 0.55,
              valence: sure ? -0.3 : -0.5,
            },
          },
        );
      }
      // La ofensa de forma (dialogue §10): quien oyó la falta guarda lo que perdió de cara, tanto
      // más vívido cuanto más fue; quien la dijo no registra nada (no la notó o no le pesó).
      const loss = clamp01(eff.form?.faceLoss ?? 0);
      if (loss > 0) {
        out.push({
          who: actor,
          experience: {
            ...base(e, [second]),
            intensity: clamp01(0.2 + 0.7 * loss),
            valence: -clamp01(0.4 + 0.5 * loss),
          },
        });
      }
      // Una amenaza o un insulto (dialogue §9, §10): el amenazado/insultado lo guarda tanto más
      // vívido cuanto más miedo o cara le costó; quien lo dijo guarda haberlo dicho, más tenue.
      const regard = eff.regard;
      if (regard && (regard.kind === "threat" || regard.kind === "insult")) {
        const weight = clamp01(Math.max(regard.faceLoss ?? 0, regard.deltas?.fear ?? 0));
        out.push(
          {
            who: actor,
            experience: {
              ...base(e, [second]),
              intensity: clamp01(0.3 + 0.6 * weight),
              valence: -clamp01(0.4 + 0.5 * weight),
            },
          },
          {
            who: second,
            experience: { ...base(e, [actor]), intensity: 0.3, valence: -0.1 },
          },
        );
      }
      // Un halago (§10): el oyente lo guarda con su propio tipo, para que el desgaste de los
      // halagos repetidos del mismo (`FLATTERY_MEMORY_KIND`) salga de lo que recuerda.
      if (regard?.kind === "flattery") {
        const hollow = regard.response === "hollow";
        out.push({
          who: actor,
          experience: {
            ...base(e, [second]),
            kind: FLATTERY_MEMORY_KIND,
            intensity: hollow ? 0.25 : 0.15,
            valence: hollow ? -0.25 : 0.2,
          },
        });
      }
      return out;
    }
    case "household.repaid":
      return actor && second
        ? [
            { who: actor, experience: { ...base(e, [second]), intensity: 0.2, valence: 0.3 } },
            { who: second, experience: { ...base(e, [actor]), intensity: 0.25, valence: 0.4 } },
          ]
        : [];
    case "law.default":
    case "contract.pledge_broken":
      return actor && second
        ? [
            { who: actor, experience: { ...base(e, [second]), intensity: 0.3, valence: -0.3 } },
            { who: second, experience: { ...base(e, [actor]), intensity: 0.45, valence: -0.6 } },
          ]
        : [];
    case "action.give":
    case "action.trade":
    case "action.tend": {
      const eff = (e.data as { effect?: Effect } | null)?.effect;
      if (!actor || !eff) return [];
      if (eff.kind === "give" && eff.to && (eff.grams ?? 0) > 0) {
        const to = eff.to as AgentId;
        const size = clamp01((eff.grams ?? 0) / 1000);
        return [
          {
            who: actor,
            experience: { ...base(e, [to]), intensity: 0.1 + 0.2 * size, valence: 0.2 },
          },
          {
            who: to,
            experience: { ...base(e, [actor]), intensity: 0.15 + 0.5 * size, valence: 0.6 },
          },
        ];
      }
      if (eff.kind === "trade" && eff.deal && eff.with) {
        const other = eff.with as AgentId;
        const edge = Math.min(1, Math.max(-1, eff.edge ?? 0));
        // La ventaja del actor es lo que el otro cedió: un buen trato se anota, uno malo escuece.
        return [
          { who: actor, experience: { ...base(e, [other]), intensity: 0.1, valence: 0.2 * edge } },
          { who: other, experience: { ...base(e, [actor]), intensity: 0.1, valence: -0.2 * edge } },
        ];
      }
      if (eff.kind === "tend" && eff.done && eff.target && eff.target !== actor) {
        const cared = eff.target as AgentId;
        const care = clamp01(eff.care ?? 0);
        return [
          { who: actor, experience: { ...base(e, [cared]), intensity: 0.2, valence: 0.4 } },
          {
            who: cared,
            experience: { ...base(e, [actor]), intensity: 0.3 + 0.4 * care, valence: 0.7 },
          },
        ];
      }
      return [];
    }
    default:
      return [];
  }
}

/** Perder a alguien de la casa: pesa por la cercanía (0-1) que se tenía. */
export function lossLived(e: Event, who: AgentId, dead: AgentId, closeness: number): Lived {
  return {
    who,
    experience: {
      ...base(e, [dead]),
      intensity: clamp01(0.4 + 0.6 * closeness),
      valence: -0.9,
    },
  };
}

/** Qué tan bien vio un testigo: la confianza de lo que leyó, abajo si no supo ni quién ni qué fue. */
export function perceptClarity(p: Percept): number {
  const read = PERCEPT_KEYS.flatMap((k) => (p.fields[k] ? [p.fields[k].confidence] : []));
  if (read.length === 0) return 0;
  const mean = read.reduce((a, b) => a + b, 0) / read.length;
  const detail = p.detail === "identified" ? 1 : p.detail === "clear" ? 0.75 : 0.4;
  return clamp01(mean * detail);
}

/** Lo que el testigo siente de lo que pasó entre otros, frente a las partes (sin calibrar). */
export const WITNESS_INTENSITY = 0.5;
export const WITNESS_VALENCE = 0.6;
/** Bajo esta claridad el testigo no guarda nada: vio una sombra. */
export const WITNESS_MIN_CLARITY = 0.15;
/** Cuánto guarda quien presenció medio dormido (el `encoding` de la memoria). */
export const WITNESS_ASLEEP_ENCODING = 0.4;

/**
 * Lo que guardan los testigos que no son parte (perception §12, npc-psychology §5): de lo que
 * vieron u oyeron (`percepts`, uno por observador) forman una memoria más tenue que la de las
 * partes, con `clarity` de lo que percibieron (luz, distancia, atención) y `with` solo si
 * reconocieron a quién. Solo lo memorable: lo que ya tiene vivencia de las partes o una muerte.
 */
export function witnessLived(
  e: Event,
  percepts: readonly Percept[],
  encodingOf: (who: AgentId) => number = () => 1,
): Lived[] {
  let intensity = 0;
  let valence = 0;
  const lived = livedFrom(e);
  const parties = new Set<string>([...e.actors, ...lived.map((l) => l.who)]);
  if (e.kind === "body.died") {
    intensity = 0.5;
    valence = -0.5;
  } else if (lived.length > 0) {
    intensity = Math.max(...lived.map((l) => l.experience.intensity));
    valence = lived.reduce((s, l) => s + l.experience.valence, 0) / lived.length;
  } else {
    return [];
  }
  const out: Lived[] = [];
  for (const p of percepts) {
    if (parties.has(p.observer)) continue;
    const clarity = perceptClarity(p);
    if (clarity < WITNESS_MIN_CLARITY) continue;
    const knows = p.fields.identity?.value != null;
    const who = (knows ? e.actors : []).filter((a) => a !== p.observer) as AgentId[];
    out.push({
      who: p.observer,
      experience: {
        ...base(e, p.detail === "identified" ? who : who.slice(0, 1)),
        intensity: clamp01(intensity * WITNESS_INTENSITY),
        valence: Math.min(1, Math.max(-1, valence * WITNESS_VALENCE)),
        source: "witnessed",
        clarity,
        encoding: encodingOf(p.observer),
      },
    });
  }
  return out;
}
