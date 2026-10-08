// La pelea mortal a la escala de una persona (combat.md §1-§4, §7, §8, §11, §12): pulsos de un
// segundo con preparación, golpe y hueco; espacio continuo con alcance; cada golpe se cruza con la
// defensa de quien lo ve venir; el daño son heridas de `sim/body`, sin puntos de vida. Una pelea
// termina porque alguien no puede (cae, muere), no quiere (huye, se rinde) o nadie sigue (se
// separan). Todo es determinista: el ruido sale de `rng.fork(pulso, quién, rol)` y el orden de
// cálculo no importa (las decisiones salen de una foto del pulso y los golpes se aplican ordenados).

import { type AgentId, type EventId, hypot, type Rng, type Tick } from "../../core/index.ts";
import {
  advanceBody,
  type Body,
  type BodyCapabilities,
  type BodyPlanDef,
  capabilitiesOf,
  injure,
  setActivity,
} from "../body/index.ts";
import { believedOdds, type RivalRead, readRival, resolveBreak, resolveFeint } from "./reading.ts";

export const FIGHT_INTENTS = ["kill", "subdue", "drive_off", "escape"] as const;
export type FightIntent = (typeof FIGHT_INTENTS)[number];

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface FighterInput {
  readonly id: AgentId;
  readonly side: string;
  readonly plan: BodyPlanDef;
  readonly body: Body;
  /** Rasgos innatos en desvíos estándar (`boldness`, `willpower`, `constitution`). */
  readonly z: Readonly<Record<string, number>>;
  /** 0-1: el nivel de pelea (la habilidad de `brawling`). */
  readonly skill: number;
  /** 0-1: el ojo entrenado (faceta `reading`); si falta, se usa `skill`. Solo en peleas con lectura. */
  readonly eye?: number;
  /** 0-1: familiaridad con el estilo de los rivales (skills §2.3). Solo en peleas con lectura. */
  readonly familiarity?: number;
  /** 0-1: cuánto esconde su nivel (combat §5). Solo en peleas con lectura. */
  readonly hides?: number;
  readonly intent: FightIntent;
  readonly at: Vec2;
  /** No sabe que lo van a atacar: no se defiende hasta que lo golpean o ve venir un golpe. */
  readonly unaware?: boolean;
}

export interface FightInput {
  readonly fighters: readonly FighterInput[];
  readonly start: Tick;
  /** 0-1: la luz de la escena. */
  readonly light: number;
  readonly rng: Rng;
  /** El evento que arrancó la pelea: causa de cada herida. */
  readonly cause: EventId;
  /** Tope de pulsos antes de que se separen (calibración abierta); cuenta la pelea entera. */
  readonly maxPulses?: number;
  /**
   * El peleador que maneja el jugador: la pelea se pausa cuando algo que él percibe lo pide
   * (combat §16) y devuelve en `paused` con qué retomarla.
   */
  readonly control?: AgentId;
  /** Retomar una pelea pausada: lo que cada uno traía y los pulsos que ya corrieron. */
  readonly resume?: FightSnapshot;
  /**
   * Pelea con lectura (combat §5, §11): cada uno lee al rival con ruido (`readRival`), sus chances
   * salen de esa lectura (`believedOdds`), se quiebra con `resolveBreak` y puede fintar. Sin esto,
   * el comportamiento es el de siempre (chances desde la verdad con ruido de vista y `breakAt`).
   */
  readonly reading?: boolean;
}

/** Lo que de cada peleador no sale de su cuerpo ni de su carácter: sirve para retomar. */
export interface FighterSnapshot {
  readonly id: AgentId;
  readonly at: Vec2;
  readonly phase: Phase;
  readonly until: Tick;
  readonly target: AgentId | null;
  readonly breath: number;
  readonly balance: number;
  readonly alert: boolean;
  readonly woundsTaken: number;
  readonly landed: number;
  readonly odds: number;
  /** La última lectura del rival y de quién (solo en peleas con lectura). */
  readonly read?: RivalRead;
  readonly readOf?: AgentId;
  /** Ventaja que le dejó una finta comprada para su próximo golpe (0-1). */
  readonly opening?: number;
}

export interface FightSnapshot {
  /** Pulsos que ya corrieron en toda la pelea. */
  readonly pulses: number;
  /** El tick del próximo pulso. */
  readonly next: Tick;
  readonly fighters: readonly FighterSnapshot[];
}

/** Por qué se pausó: lo que el peleador de `control` nota (combat §16, el jugador no ve la verdad). */
export type PauseReason = "wounded" | "foe_fleeing";

export interface FightPause {
  readonly reason: PauseReason;
  readonly snapshot: FightSnapshot;
}

export type FighterOutcome = "standing" | "down" | "dead" | "fled" | "yielded";

export type FightEnd = "decided" | "separated";

export type FightLogKind =
  | "close"
  | "windup"
  | "hit"
  | "parried"
  | "whiffed"
  | "flee"
  | "yield"
  | "fell"
  | "feint";

export interface FightLogEntry {
  readonly t: Tick;
  readonly kind: FightLogKind;
  readonly actor: AgentId;
  readonly target?: AgentId;
  /** Zona herida (solo `hit`). */
  readonly zone?: string;
  /** Gravedad de la herida (solo `hit`). */
  readonly severity?: number;
  /** El golpe se vio venir (en los intercambios); en `feint`, el defensor la leyó como falsa. */
  readonly seen?: boolean;
}

export interface FighterResult {
  readonly id: AgentId;
  readonly body: Body;
  readonly outcome: FighterOutcome;
  /** Heridas nuevas que recibió. */
  readonly woundsTaken: number;
  /** Con qué ganas terminó, 0-1 (para el miedo y el trauma después). */
  readonly myOdds: number;
}

export interface FightResult {
  readonly fighters: readonly FighterResult[];
  readonly seconds: number;
  readonly end: FightEnd;
  readonly log: readonly FightLogEntry[];
  /** La pelea sigue y quien la maneja tiene que decidir: no es un final. */
  readonly paused?: FightPause;
}

/** Alcance de un puño, metros. */
export const FIST_REACH = 0.8;
/** Metros por pulso de un cuerpo entero. */
export const STRIDE = 1.5;
/** Distancia a la que quien huyó rompe el contacto, metros. */
export const ESCAPE_DISTANCE = 14;
/** Pulsos por defecto antes de separarse (un minuto y medio: las peleas reales son cortas). */
export const MAX_PULSES = 90;
/** Severidad desde la que una herida propia se nota en plena pelea y no la tapa la adrenalina (calibración abierta). */
export const PAIN_NOTICE = 0.2;
/** Pulsos mínimos entre dos pausas, para no pedirle una decisión por golpe (calibración abierta). */
export const PAUSE_MIN_PULSES = 3;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const dist = (a: Vec2, b: Vec2) => hypot(a.x - b.x, a.y - b.y);

type Phase = "ready" | "windup" | "recover" | "fleeing";

interface State {
  readonly id: AgentId;
  readonly side: string;
  readonly plan: BodyPlanDef;
  body: Body;
  caps: BodyCapabilities;
  readonly z: Readonly<Record<string, number>>;
  readonly skill: number;
  readonly eye: number;
  readonly familiarity: number;
  readonly hides: number;
  readonly intent: FightIntent;
  at: Vec2;
  phase: Phase;
  until: Tick;
  target: AgentId | null;
  breath: number;
  balance: number;
  alert: boolean;
  outcome: FighterOutcome;
  woundsTaken: number;
  /** Golpes que metió: lo que ve de su propia pelea. */
  landed: number;
  odds: number;
  read: RivalRead | null;
  readOf: AgentId | null;
  opening: number;
}

type Action =
  | { readonly kind: "idle" }
  | { readonly kind: "close"; readonly to: AgentId }
  | { readonly kind: "windup"; readonly to: AgentId }
  | { readonly kind: "feint"; readonly to: AgentId }
  | { readonly kind: "flee"; readonly from: AgentId }
  | { readonly kind: "yield" };

function active(s: State): boolean {
  return (
    s.outcome === "standing" &&
    s.body.death === null &&
    s.body.consciousness !== "unconscious" &&
    s.caps.cognition > 0.12
  );
}

/** La mano: cuánto rinde el cuerpo y el aire en un golpe. */
const edgeOf = (s: State) => Math.sqrt(s.caps.manipulation) * (0.5 + 0.5 * s.breath);

/** Cuánto se nota la preparación del golpe (baja con el nivel de quien pega). */
const telegraphOf = (s: State) => 0.75 - 0.4 * s.skill;

/** Potencia para pelear que cree tener: el cuerpo que le queda y el aire. */
function powerOf(s: State): number {
  const c = s.caps;
  return ((c.manipulation + c.locomotion + c.strength + c.cognition) / 4) * (0.5 + 0.5 * s.breath);
}

/** Dónde quiere pegar quien sabe apuntar, según qué busca. */
const AIM: Readonly<Record<FightIntent, Readonly<Record<string, number>>>> = {
  kill: { head: 3, neck: 3, chest: 4, abdomen: 1 },
  subdue: { left_arm: 2, right_arm: 2, left_leg: 2, right_leg: 2, abdomen: 2, chest: 1 },
  drive_off: { left_arm: 2, right_arm: 2, chest: 2, abdomen: 1, head: 1 },
  escape: { left_arm: 1, right_arm: 1, abdomen: 1 },
};

/** Cuándo se quiebra: el audaz y el de voluntad aguantan más; quien viene a matar, también. */
function breakAt(s: State): number {
  if (s.intent === "escape") return 1;
  const v =
    0.32 -
    0.2 * (s.z["boldness"] ?? 0) -
    0.1 * (s.z["willpower"] ?? 0) -
    (s.intent === "kill" ? 0.1 : 0);
  return Math.min(0.6, Math.max(0.02, v));
}

/**
 * Las chances que cree tener (combat §11): su potencia contra la del rival tal como la ve. Con
 * mala vista o poca luz subestima lo herido que está el otro.
 */
function oddsOf(s: State, rival: State, light: number): number {
  const seen = clamp01(s.caps.sight * (0.3 + 0.7 * light));
  const perceived = 1 - (1 - powerOf(rival)) * seen;
  // Cada golpe que come baja sus chances y cada uno que mete las sube (combat §11).
  const seenHits = 0.06 * (s.landed - s.woundsTaken);
  return clamp01(0.5 + 0.8 * (powerOf(s) - perceived) + seenHits);
}

/** Hace la pelea. Las entradas no se tocan: el resultado trae los cuerpos nuevos. */
export function runFight(input: FightInput): FightResult {
  const base = input.resume?.pulses ?? 0;
  const maxPulses = (input.maxPulses ?? MAX_PULSES) - base;
  const states = new Map<AgentId, State>();
  for (const f of [...input.fighters].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const body = setActivity(f.body, "heavy");
    states.set(f.id, {
      id: f.id,
      side: f.side,
      plan: f.plan,
      body,
      caps: capabilitiesOf(f.plan, body),
      z: f.z,
      skill: clamp01(f.skill),
      eye: clamp01(f.eye ?? f.skill),
      familiarity: clamp01(f.familiarity ?? 0),
      hides: clamp01(f.hides ?? 0),
      intent: f.intent,
      at: f.at,
      phase: "ready",
      until: input.start,
      target: null,
      breath: 1,
      balance: 1,
      alert: f.unaware !== true,
      outcome: "standing",
      woundsTaken: 0,
      landed: 0,
      odds: 0.5,
      read: null,
      readOf: null,
      opening: 0,
    });
  }
  for (const saved of input.resume?.fighters ?? []) {
    const s = states.get(saved.id);
    if (!s) continue;
    s.at = saved.at;
    s.phase = saved.phase;
    s.until = saved.until;
    s.target = saved.target;
    s.breath = saved.breath;
    s.balance = saved.balance;
    s.alert = saved.alert;
    s.woundsTaken = saved.woundsTaken;
    s.landed = saved.landed;
    s.odds = saved.odds;
    s.read = saved.read ?? null;
    s.readOf = saved.readOf ?? null;
    s.opening = saved.opening ?? 0;
  }
  const order = [...states.values()];
  const log: FightLogEntry[] = [];
  const foes = (s: State) => order.filter((o) => o.side !== s.side && active(o));
  const hostile = () => order.some((a) => active(a) && foes(a).length > 0);

  let pulse = 0;
  let end: FightEnd = "decided";
  let paused: PauseReason | null = null;
  let noticed: PauseReason | null = null;
  const control = input.control === undefined ? undefined : states.get(input.control);
  for (; hostile(); pulse++) {
    if (pulse >= maxPulses) {
      end = "separated";
      break;
    }
    const t = input.start + pulse;
    // La sangre, el desmayo y la muerte corren con el tiempo (body-health).
    for (const s of order) {
      if (s.body.updatedAt < t && s.body.death === null) {
        s.body = advanceBody(s.plan, s.id, s.body, t).body;
        s.caps = capabilitiesOf(s.plan, s.body);
      }
    }
    for (const s of order) {
      if (s.outcome === "standing" && s.body.death) s.outcome = "dead";
      else if (s.outcome === "standing" && !active(s)) s.outcome = "down";
    }

    // 1. Decisiones, todas desde la foto del pulso.
    const actions = new Map<AgentId, Action>();
    for (const s of order) {
      if (!active(s) || s.phase === "recover" || s.phase === "windup") continue;
      actions.set(s.id, decide(s, foes(s), input, t));
    }

    // 2. Los golpes que caen en este pulso, contra la foto de quien los recibe.
    const landing = order.filter((s) => active(s) && s.phase === "windup" && s.until <= t);
    const snapshot = new Map(order.map((s) => [s.id, { phase: s.phase, alert: s.alert }]));
    const blows: { from: State; to: State; seen: boolean; hit: boolean }[] = [];
    for (const a of landing) {
      const d = a.target ? states.get(a.target) : undefined;
      if (!d || !active(d)) {
        a.phase = "recover";
        a.until = t + 1;
        a.target = null;
        continue;
      }
      const rng = input.rng.fork("fight", base + pulse, a.id, "exchange");
      const frozen = snapshot.get(d.id) as { phase: Phase; alert: boolean };
      const inReach = dist(a.at, d.at) <= FIST_REACH * 1.25;
      // Ver venir el golpe (§4.3): la vista, la luz, lo que se nota y el ojo de quien defiende.
      const seen =
        inReach &&
        rng.chance(
          clamp01(
            d.caps.sight *
              (0.3 + 0.7 * input.light) *
              (0.35 + 0.65 * telegraphOf(a)) *
              (0.55 + 0.45 * d.skill),
          ),
        );
      // Solo se defiende quien está libre y mira para ese lado (no huyendo, ni en su hueco).
      const free = frozen.phase === "ready" && (frozen.alert || seen);
      const atk = 0.25 + 0.55 * a.skill * edgeOf(a);
      // Una finta comprada deja al defensor mal parado para este golpe (combat §5).
      const def = 0.15 + 0.6 * d.skill * edgeOf(d) * (0.5 + 0.5 * d.balance) - 0.4 * a.opening;
      a.opening = 0;
      const defended = inReach && seen && free && rng.normal(def - atk, 0.2) > 0;
      const hit = inReach && !defended && rng.chance(clamp01(0.45 + 0.5 * atk * edgeOf(a)));
      a.breath = clamp01(a.breath - 0.1 / Math.max(0.3, a.caps.endurance));
      a.phase = "recover";
      a.until = t + 2 + (a.breath < 0.25 ? 1 : 0) + (hit || defended ? 0 : 1);
      a.target = null;
      if (hit) blows.push({ from: a, to: d, seen, hit });
      else {
        a.balance = clamp01(a.balance - (defended ? 0.1 : 0.25));
        if (defended) d.breath = clamp01(d.breath - 0.04);
        log.push({
          t,
          kind: defended ? "parried" : "whiffed",
          actor: a.id,
          target: d.id,
          seen,
        });
      }
      d.alert = d.alert || seen;
    }
    for (const b of blows.sort((x, y) => (x.from.id < y.from.id ? -1 : 1))) {
      if (b.to.body.death) continue;
      const rng = input.rng.fork("fight", base + pulse, b.from.id, "blow");
      const aimed = b.from.skill > 0.35 && rng.chance(b.from.skill);
      const zones = AIM[b.from.intent];
      const zone = aimed ? Object.keys(zones)[rng.weighted(Object.values(zones))] : undefined;
      const power = 0.34 + 0.08 * Math.max(-2, Math.min(2, b.from.z["constitution"] ?? 0));
      const force = clamp01(
        power * b.from.caps.strength * (0.7 + 0.3 * b.from.breath) * (0.8 + 0.4 * rng.float()),
      );
      const injury = injure(
        b.to.plan,
        b.to.body,
        { kind: "blunt", force, ...(zone ? { zone } : {}), cause: input.cause, at: t },
        rng.fork("injure"),
      );
      b.to.body = injury.body;
      b.to.caps = capabilitiesOf(b.to.plan, b.to.body);
      b.to.woundsTaken += 1;
      b.from.landed += 1;
      b.to.alert = true;
      b.to.balance = clamp01(b.to.balance - 0.15 - force);
      log.push({
        t,
        kind: "hit",
        actor: b.from.id,
        target: b.to.id,
        zone: injury.wound.zone,
        severity: injury.wound.severity,
        seen: b.seen,
      });
      if (injury.died) b.to.outcome = "dead";
      else if (b.to.body.consciousness === "unconscious") {
        b.to.outcome = "down";
        log.push({ t, kind: "fell", actor: b.to.id });
      }
    }

    // 3. Lo que cada uno hace en este pulso.
    for (const s of order) {
      const a = actions.get(s.id);
      if (!a || !active(s)) continue;
      const rival = a.kind === "idle" || a.kind === "yield" ? undefined : states.get(rivalOf(a));
      switch (a.kind) {
        case "idle":
          s.breath = clamp01(s.breath + 0.06 * s.caps.endurance);
          s.balance = clamp01(s.balance + 0.2);
          break;
        case "close":
          if (rival) {
            s.at = stepToward(s.at, rival.at, STRIDE * s.caps.locomotion, FIST_REACH * 0.9);
            s.breath = clamp01(s.breath - 0.04 / Math.max(0.3, s.caps.endurance));
            log.push({ t, kind: "close", actor: s.id, target: rival.id });
          }
          break;
        case "windup":
          s.phase = "windup";
          s.until = t + 1;
          s.target = a.to;
          log.push({ t, kind: "windup", actor: s.id, target: a.to });
          break;
        case "feint":
          if (rival) {
            // Preparación falsa: gasta tiempo y el defensor la compra o la lee (combat §5).
            const res = resolveFeint(
              { skill: s.skill },
              {
                sight: rival.caps.sight,
                skill: rival.eye,
                alert: rival.alert,
                familiarity: rival.familiarity,
              },
              input.light,
              input.rng.fork("fight", base + pulse, s.id, "feint"),
            );
            s.phase = "recover";
            s.until = t + res.cost;
            if (res.outcome === "bought") {
              rival.balance = clamp01(rival.balance - res.balanceLost);
              s.opening = res.opening;
            } else rival.alert = true;
            log.push({
              t,
              kind: "feint",
              actor: s.id,
              target: rival.id,
              seen: res.outcome === "read",
            });
          }
          break;
        case "flee":
          if (rival) {
            s.phase = "fleeing";
            s.at = stepAway(s.at, rival.at, STRIDE * s.caps.locomotion);
            s.breath = clamp01(s.breath - 0.05 / Math.max(0.3, s.caps.endurance));
            if (s.outcome === "standing" && !logged(log, s.id, "flee")) {
              log.push({ t, kind: "flee", actor: s.id, target: rival.id });
            }
            if (dist(s.at, rival.at) >= ESCAPE_DISTANCE) s.outcome = "fled";
          }
          break;
        case "yield":
          s.outcome = "yielded";
          log.push({ t, kind: "yield", actor: s.id });
          break;
      }
    }
    // Quien terminó su hueco vuelve a guardia.
    for (const s of order) {
      if (s.phase === "recover" && s.until <= t + 1) s.phase = "ready";
    }

    // 4. Lo que nota quien maneja el jugador pide una decisión (combat §16): una herida que
    // siente o un rival que empieza a huir. Lo que no percibe no pausa.
    if (control && active(control) && hostile()) {
      for (const l of log) {
        if (l.t !== t) continue;
        if (l.kind === "hit" && l.target === control.id && (l.severity ?? 0) >= PAIN_NOTICE) {
          noticed ??= "wounded";
        } else if (l.kind === "flee" && l.actor !== control.id) {
          const sees = clamp01(control.caps.sight * (0.3 + 0.7 * input.light));
          if (input.rng.fork("fight", t, control.id, "pause").chance(sees)) {
            noticed ??= "foe_fleeing";
          }
        }
      }
      if (noticed && pulse + 1 >= PAUSE_MIN_PULSES) {
        paused = noticed;
        pulse++;
        break;
      }
    }
  }

  // El tiempo que pasó de verdad: hasta el último pulso resuelto.
  const finish = input.start + pulse;
  return {
    fighters: order.map((s) => ({
      id: s.id,
      body: s.body.death === null ? advanceBody(s.plan, s.id, s.body, finish).body : s.body,
      outcome: s.outcome === "standing" && !active(s) ? "down" : s.outcome,
      woundsTaken: s.woundsTaken,
      myOdds: s.odds,
    })),
    seconds: pulse,
    end,
    log,
    ...(paused
      ? {
          paused: {
            reason: paused,
            snapshot: {
              pulses: base + pulse,
              next: finish,
              fighters: order.map((s) => ({
                id: s.id,
                at: s.at,
                phase: s.phase,
                until: s.until,
                target: s.target,
                breath: s.breath,
                balance: s.balance,
                alert: s.alert,
                woundsTaken: s.woundsTaken,
                landed: s.landed,
                odds: s.odds,
                ...(s.read && s.readOf ? { read: s.read, readOf: s.readOf } : {}),
                ...(s.opening > 0 ? { opening: s.opening } : {}),
              })),
            },
          },
        }
      : {}),
  };
}

function rivalOf(a: Action): AgentId {
  return a.kind === "close" || a.kind === "windup" || a.kind === "feint"
    ? a.to
    : (a as { from: AgentId }).from;
}

function logged(log: readonly FightLogEntry[], actor: AgentId, kind: FightLogKind): boolean {
  return log.some((l) => l.actor === actor && l.kind === kind);
}

function stepToward(from: Vec2, to: Vec2, step: number, stopAt: number): Vec2 {
  const d = dist(from, to);
  if (d <= stopAt || d === 0) return from;
  const k = Math.min(step, d - stopAt) / d;
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

function stepAway(from: Vec2, rival: Vec2, step: number): Vec2 {
  const d = dist(from, rival) || 1;
  return {
    x: from.x + ((from.x - rival.x) / d) * step,
    y: from.y + ((from.y - rival.y) / d) * step,
  };
}

/** Qué hace uno en este pulso con lo que percibe (combat §3, §11, §12). */
function decide(s: State, foes: readonly State[], input: FightInput, t: Tick): Action {
  // Ve al más cercano de los que puede ver; en la oscuridad, solo de cerca.
  const sight = s.caps.sight * (0.3 + 0.7 * input.light);
  const reach = 2 + 20 * sight;
  const visible = foes
    .filter((f) => dist(s.at, f.at) <= reach)
    .sort((a, b) => dist(s.at, a.at) - dist(s.at, b.at) || (a.id < b.id ? -1 : 1));
  const rival = visible[0];
  if (!rival) return { kind: "idle" };

  const rng = input.rng.fork("fight", t, s.id, "decide");
  const quicker = rival.caps.locomotion >= s.caps.locomotion * 1.2;
  const canRun = s.caps.locomotion > 0.4 && s.breath > 0.1;
  if (input.reading === true) {
    // Con lectura (§5, §11): cree lo que leyó del rival, no lo que es.
    const base =
      (rival.caps.manipulation +
        rival.caps.locomotion +
        rival.caps.strength +
        rival.caps.cognition) /
      4;
    s.read = readRival(
      { sight: s.caps.sight, skill: s.eye, familiarity: s.familiarity },
      {
        power: powerOf(rival),
        breath: rival.breath,
        hurt: clamp01(1 - base),
        fear: clamp01(1 - 2 * rival.odds),
        hides: rival.hides,
      },
      input.light,
      input.rng.fork("fight", t, s.id, "read"),
    );
    s.readOf = rival.id;
    const belief = believedOdds(s.read, {
      myPower: powerOf(s),
      landed: s.landed,
      taken: s.woundsTaken,
    });
    s.odds = belief.myOdds;
    const decision = resolveBreak(
      { belief, breakAt: breakAt(s), drivers: {}, canRun, cornered: false, foeFaster: quicker },
      rng.fork("break"),
    );
    if (decision.kind === "flee") return { kind: "flee", from: rival.id };
    if (decision.kind === "yield") return { kind: "yield" };
    if (decision.kind === "freeze") return { kind: "idle" };
  } else {
    s.odds = oddsOf(s, rival, input.light);
    // Quebrarse: huye si puede correr, se rinde si no (o si el otro lo alcanzaría).
    if (s.odds < breakAt(s)) {
      if (canRun && (!quicker || rng.chance(0.3))) return { kind: "flee", from: rival.id };
      return { kind: "yield" };
    }
  }
  if (s.phase === "fleeing") s.phase = "ready";
  const d = dist(s.at, rival.at);
  // Quien ganó no persigue lejos si solo quería echarlo.
  if (d > FIST_REACH * 1.25) {
    const chase = s.intent === "kill" || s.intent === "subdue" || d < 3;
    return chase && s.breath > 0.15 ? { kind: "close", to: rival.id } : { kind: "idle" };
  }
  if (s.intent === "escape") return { kind: "flee", from: rival.id };
  // Sin aire, retiene la guardia y respira (el cansancio, combat §8).
  if (s.breath < 0.18 && rng.chance(0.7)) return { kind: "idle" };
  // Se queda un instante si recién perdió el equilibrio.
  if (s.balance < 0.35 && rng.chance(0.5)) return { kind: "idle" };
  // Con lectura, quien sabe pelear a veces finta a un rival que está libre (§5).
  if (
    input.reading === true &&
    s.skill > 0.4 &&
    rival.phase === "ready" &&
    s.opening === 0 &&
    rng.fork("feint").chance(0.2 * s.skill)
  ) {
    return { kind: "feint", to: rival.id };
  }
  return { kind: "windup", to: rival.id };
}
