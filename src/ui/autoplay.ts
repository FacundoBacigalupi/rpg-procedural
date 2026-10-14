// Jugador automático (ROADMAP perfil5): maneja la sesión del juego (`session.ts`) con una política
// determinista de turnos, sin LLM, para medir una partida larga con el personaje activo. Escribe líneas
// al parser sin red y elige opciones sugeridas, como lo haría una persona; no toca la sim por la
// espalda. Las medidas: tiempo por turno y por año, memoria, invariantes, supervivencia del personaje
// y de la aldea, y cuánto pisa la rutina inactiva (`idlePlayerRoutine`) al personaje que juega.

import { type AgentId, type Event, HOUR, MINUTE, Rng } from "../core/index.ts";
import { PLAN_STATE } from "../game/life/act.ts";
import { alarmingSigns } from "../game/life/interrupts.ts";
import {
  BODY_STATE,
  bodySigns,
  capabilitiesOf,
  checkInvariants,
  ENTITY,
  LOCATION,
  PERSON,
  PLACE,
} from "../sim/index.ts";
import type { Session } from "./session.ts";

export interface AutoplayConfig {
  readonly seed: number;
  /** Años de mundo a jugar (puede ser fraccionario). */
  readonly years: number;
  /** Cada cuántos días de mundo se corren los invariantes. */
  readonly checkEveryDays: number;
  /** Tope de líneas escritas, por si algo no avanza. */
  readonly maxTurns?: number;
}

/** Una línea o una opción sugerida con ese id. */
export type AutoplayMove = { readonly say: string } | { readonly choose: string };

export interface PolicyView {
  readonly suggestions: readonly { id: string; kind: string; salience: number }[];
  readonly stalled: number;
}

/** Actividades de rutina del personaje (peso, línea): de la hora al mes. */
const ACTIVITIES: readonly (readonly [number, string])[] = [
  [2, "miro alrededor"],
  [2, "hablo con mi madre"],
  [1, "hablo con mi padre"],
  [1, "hablo con mi hermana"],
  [2, "busco leña"],
  [3, "trabajo en el campo hasta que anochezca"],
  [1, "voy al campo"],
  [1, "descanso"],
  [1, "espero 2 horas"],
  [2, "espero un día"],
  [1, "espero 3 días"],
  [1, "espero 7 días"],
  [1, "espero 30 días"],
];

/**
 * La política de turnos: primero lo que el cuerpo pide (las opciones sugeridas de necesidad), después
 * una actividad sorteada con el RNG de la corrida. Pura: mismo seed y mismas vistas, mismos turnos.
 */
export function choosePolicy(rng: Rng, view: PolicyView): AutoplayMove {
  if (view.stalled >= 8) return { say: "espero una hora" };
  const need = view.suggestions
    .filter(
      (s) =>
        (["drink", "eat", "tend"].includes(s.kind) && s.salience >= 0.7) ||
        (s.kind === "sleep" && s.salience >= 0.5),
    )
    .sort((a, b) => b.salience - a.salience)[0];
  if (need) return { choose: need.id };
  const i = rng.weighted(ACTIVITIES.map(([w]) => w));
  return { say: (ACTIVITIES[i] as readonly [number, string])[1] };
}

/** Cómo anduvo el cuerpo del personaje al final de cada turno que gastó tiempo (ROADMAP perfil5-body-wear). */
export interface BodyStats {
  readonly samples: number;
  readonly meanSleepDebtH: number;
  readonly maxSleepDebtH: number;
  readonly meanFatigue: number;
  /** Fracción de los turnos que terminaron con cada signo (sed, cansancio, cojera...). */
  readonly signShare: Readonly<Record<string, number>>;
  readonly meanLocomotion: number;
}

/** Las esperas largas ("espero N días", N >= 2): cuántas llegaron a su fin y qué las cortó. */
export interface LongWaitStats {
  readonly count: number;
  readonly requestedDays: number;
  readonly livedDays: number;
  readonly completed: number;
  /** De las que empezaron en la aldea o junto al agua (donde la rutina mínima puede beber): cuántas y cuántas llegaron a su fin. */
  readonly atWater: number;
  readonly atWaterCompleted: number;
  /** Signos graves del cuerpo al cortarse. */
  readonly cutBy: Readonly<Record<string, number>>;
}

/** Las heridas del personaje (ROADMAP perfil5-more-seeds2): cuántas, de qué tipo y cómo se curaron. */
export interface WoundStats {
  readonly total: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly fractures: number;
  readonly fracturesSplinted: number;
  readonly fracturesNeverSplinted: number;
  readonly infected: number;
  readonly maxInfection: number;
  /** Turnos `[tend]` y cuántos no cambiaron ninguna marca de cura (vendada, limpia, entablillada). */
  readonly tendTurns: number;
  readonly tendNoChange: number;
}

interface SeenWound {
  kind: string;
  fracture: boolean;
  splinted: boolean;
  maxInf: number;
}

export interface YearRow {
  readonly year: number;
  readonly turns: number;
  readonly wallMs: number;
  readonly worldDays: number;
  readonly msPerTurn: number;
  readonly secPerWorldYear: number;
  readonly rssMiB: number;
  readonly villagers: number;
  readonly playerAlive: boolean;
}

export interface AutoplayReport {
  readonly seed: number;
  readonly years: number;
  readonly completedYears: number;
  readonly turns: number;
  readonly rejected: number;
  readonly warned: number;
  readonly lineTurns: number;
  readonly chooseTurns: number;
  readonly checks: number;
  readonly problems: readonly string[];
  readonly playerAlive: boolean;
  readonly playerEnd: { readonly tick: number; readonly cause?: string } | null;
  readonly villagersStart: number;
  readonly villagersEnd: number;
  readonly births: number;
  readonly deaths: number;
  readonly deathsByCause: Readonly<Record<string, number>>;
  /** Eventos de rutina atribuidos al personaje (la rutina inactiva pisando al que juega). */
  readonly routineOnPlayer: number;
  /** Comidas y bebidas que la rutina mínima le dio al personaje mientras esperaba (`life-6`). */
  readonly waitTended: number;
  readonly routineOnPlayerByKind: Readonly<Record<string, number>>;
  readonly turnMs: {
    readonly mean: number;
    readonly p50: number;
    readonly p95: number;
    readonly max: number;
  };
  readonly worstTurns: readonly {
    readonly turn: number;
    readonly line: string;
    readonly ms: number;
    readonly days: number;
  }[];
  readonly byYear: readonly YearRow[];
  readonly body: BodyStats;
  readonly wounds: WoundStats;
  readonly longWaits: LongWaitStats;
  readonly peakRssMiB: number;
  /** Hash del estado final: la misma corrida debe dar el mismo antes y después de una optimización. */
  readonly stateHash: string;
  readonly replies: Readonly<Record<string, number>>;
  readonly topKinds: Readonly<Record<string, number>>;
  readonly wallSeconds: number;
  readonly failure?: string;
}

const MiB = 1024 * 1024;

function woundStats(
  seen: ReadonlyMap<string, SeenWound>,
  tendTurns: number,
  tendNoChange: number,
): WoundStats {
  const byKind: Record<string, number> = {};
  let fractures = 0;
  let splinted = 0;
  let infected = 0;
  let maxInfection = 0;
  for (const x of seen.values()) {
    byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;
    if (x.fracture) {
      fractures++;
      if (x.splinted) splinted++;
    }
    if (x.maxInf > 0.05) infected++;
    maxInfection = Math.max(maxInfection, x.maxInf);
  }
  return {
    total: seen.size,
    byKind,
    fractures,
    fracturesSplinted: splinted,
    fracturesNeverSplinted: fractures - splinted,
    infected,
    maxInfection: Math.round(maxInfection * 100) / 100,
    tendTurns,
    tendNoChange,
  };
}

function pct(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
}

/** Juega la sesión hasta `years` años de mundo, la muerte del personaje o `maxTurns`. */
export async function runAutoplay(
  session: Session,
  config: AutoplayConfig,
  progress?: (line: string) => void,
): Promise<AutoplayReport> {
  const life = session.life;
  const w = life.world;
  const rng = Rng.root(config.seed).fork("autoplay");
  const from = life.now;
  const target = from + Math.round(config.years * w.clock.year);
  const checkStep = config.checkEveryDays * w.clock.day;
  const maxTurns = config.maxTurns ?? 100_000;
  const villagers = (): number =>
    w.truth.ids(PERSON).filter((id) => w.truth.get(ENTITY, id as AgentId)?.endedAt === undefined)
      .length;
  const villagersStart = villagers();

  const started = performance.now();
  const problems: string[] = [];
  const times: number[] = [];
  const worst: { turn: number; line: string; ms: number; days: number }[] = [];
  const replies: Record<string, number> = {};
  const kinds = new Map<string, number>();
  const routineByKind: Record<string, number> = {};
  const deathsByCause: Record<string, number> = {};
  const byYear: YearRow[] = [];
  const bodySum = { n: 0, debt: 0, maxDebt: 0, fatigue: 0, loco: 0 };
  const signCount: Record<string, number> = {};
  const seenWounds = new Map<string, SeenWound>();
  const careMarks = (): string => {
    const b = w.truth.get(BODY_STATE, life.player);
    return b
      ? b.wounds
          .map((x) => `${x.splinted ? 1 : 0}${x.bandaged ? 1 : 0}${x.cleaned ? 1 : 0}`)
          .join(",")
      : "";
  };
  let tendTurns = 0;
  let tendNoChange = 0;
  const wait = { count: 0, requested: 0, lived: 0, completed: 0, atWater: 0, atWaterCompleted: 0 };
  /** Si el personaje está en la aldea o junto al agua (`drink` pide lo mismo). */
  const atWaterNow = (): boolean => {
    const hex = w.truth.get(LOCATION, life.player)?.hex;
    return w.truth.ids(PLACE).some((id) => {
      const p = w.truth.get(PLACE, id);
      return (
        (p?.kind === "village" || p?.kind === "water") && hex !== undefined && p.hexes.includes(hex)
      );
    });
  };
  const waitCut: Record<string, number> = {};
  let scanned = 0;
  let births = 0;
  let deaths = 0;
  let routineOnPlayer = 0;
  let waitTended = 0;
  let playerEnd: AutoplayReport["playerEnd"] = null;
  const scan = (): void => {
    const all: readonly Event[] = w.log.all();
    for (; scanned < all.length; scanned++) {
      const e = all[scanned] as Event;
      if (e.tick <= from) continue;
      kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
      if (e.kind === "family.birth") births++;
      if (e.kind === "body.died") {
        deaths++;
        const cause = String((e.data as { cause?: unknown }).cause ?? "unknown");
        deathsByCause[cause] = (deathsByCause[cause] ?? 0) + 1;
        if (e.actors.includes(life.player)) playerEnd = { tick: e.tick, cause };
      }
      if (e.kind.startsWith("routine.") && e.actors.includes(life.player)) {
        // Lo que la rutina mínima le hace al que espera (`life-6`) no es una pisada: es lo previsto.
        if ((e.data as { waiting?: unknown }).waiting === true) {
          waitTended++;
          continue;
        }
        routineOnPlayer++;
        routineByKind[e.kind] = (routineByKind[e.kind] ?? 0) + 1;
      }
    }
  };

  let turns = 0;
  let rejected = 0;
  let warned = 0;
  let lineTurns = 0;
  let chooseTurns = 0;
  let stalled = 0;
  // Opciones que no gastaron tiempo (p. ej. dormir de día): se dejan de sugerir un rato.
  const banned = new Map<string, number>();
  let checks = 0;
  let nextCheck = from + checkStep;
  let peak = process.memoryUsage().rss;
  let yearTurns = 0;
  let yearStart = performance.now();
  let yearFromTick = from;
  let failure: string | undefined;
  const count = (key: string) => {
    replies[key] = (replies[key] ?? 0) + 1;
  };

  try {
    while (life.now < target && life.alive && turns < maxTurns && problems.length === 0) {
      const view: PolicyView = {
        suggestions: session
          .suggested(true)
          .filter((s) => (banned.get(s.id) ?? 0) <= life.now)
          .map((s) => ({
            id: s.id,
            kind: s.kind,
            salience: s.salience,
          })),
        stalled,
      };
      const move = choosePolicy(rng.fork("turn", turns), view);
      const line = "say" in move ? move.say : `[${move.choose}]`;
      const t0 = performance.now();
      const before = life.now;
      const wasAtWater = atWaterNow();
      const marksBefore = "choose" in move && move.choose.includes("tend") ? careMarks() : null;
      let reply = "say" in move ? await session.say(move.say) : await session.choose(move.choose);
      // Un aviso de factibilidad se repite la mitad de las veces, como haría quien insiste.
      if (!reply.turn && "say" in move && /repetilo\.$/.test(reply.text)) {
        warned++;
        if (rng.fork("insist", turns).chance(0.5)) reply = await session.say(move.say);
      }
      const ms = performance.now() - t0;
      if (process.env["AUTOPLAY_TRACE"]) {
        const days = ((life.now - before) / w.clock.day).toFixed(2);
        const plan = w.truth.get(PLAN_STATE, life.player);
        const planBytes = plan ? JSON.stringify(plan).length : 0;
        const b = w.truth.get(BODY_STATE, life.player);
        const bodyTrace = b
          ? ` | cuerpo fat=${b.fatigue.toFixed(2)} deb=${b.sleepDebt.toFixed(1)}h agua=${b.water.toFixed(2)}L glu=${Math.round(b.glycogen)} grasa=${Math.round(b.fat)} mus=${b.muscle.toFixed(2)} ${b.activity} heridas=${b.wounds.length}${b.wounds.map((x) => `[${x.kind}/${x.zone} sev${x.severity.toFixed(2)}${x.fracture ? " fx" : ""} ${x.stage} rep${x.repair.toFixed(2)} inf${x.infection.toFixed(2)}${x.splinted ? " spl" : ""}${x.bandaged ? " bnd" : ""}${x.cleaned ? " cln" : ""} t${x.at} cause=${x.cause}]`).join("")}${b.massKg.toFixed(0)}kg en ${JSON.stringify(w.truth.get(LOCATION, life.player))} agua=${wasAtWater}`
          : "";
        progress?.(
          `  turno ${turns + 1} ${line}: ${Math.round(ms)} ms, +${days} d, plan ${plan?.steps.length ?? 0} pasos/${planBytes} B, ${reply.text.split("\n")[0]?.slice(0, 80)}${bodyTrace}`,
        );
      }
      if (marksBefore !== null) {
        tendTurns++;
        if (careMarks() === marksBefore) tendNoChange++;
      }
      for (const x of w.truth.get(BODY_STATE, life.player)?.wounds ?? []) {
        const key = `${x.at}|${x.zone}|${x.kind}`;
        const seen = seenWounds.get(key) ?? {
          kind: x.kind,
          fracture: false,
          splinted: false,
          maxInf: 0,
        };
        seen.fracture ||= x.fracture;
        seen.splinted ||= x.splinted;
        seen.maxInf = Math.max(seen.maxInf, x.infection);
        seenWounds.set(key, seen);
      }
      if (reply.turn) {
        const body = w.truth.get(BODY_STATE, life.player);
        const plan = body && w.plans.find((p) => p.id === body.plan);
        if (body && plan) {
          bodySum.n++;
          bodySum.debt += body.sleepDebt;
          bodySum.maxDebt = Math.max(bodySum.maxDebt, body.sleepDebt);
          bodySum.fatigue += body.fatigue;
          bodySum.loco += capabilitiesOf(plan, body).locomotion;
          const signs = bodySigns(plan, body);
          for (const sg of new Set([...signs.general, ...signs.zones.flatMap((z) => z.signs)])) {
            signCount[sg] = (signCount[sg] ?? 0) + 1;
          }
        }
        const asked = "say" in move ? /^espero (\d+) días$/.exec(move.say) : null;
        if (asked && Number(asked[1]) >= 2) {
          const want = Number(asked[1]);
          const lived = (life.now - before) / w.clock.day;
          wait.count++;
          wait.requested += want;
          wait.lived += lived;
          if (wasAtWater) wait.atWater++;
          if (lived >= want - 0.01) {
            wait.completed++;
            if (wasAtWater) wait.atWaterCompleted++;
          } else {
            const cut = [...alarmingSigns(w)].sort().join("+") || "otro";
            waitCut[cut] = (waitCut[cut] ?? 0) + 1;
          }
        }
      }
      turns++;
      if ("say" in move) lineTurns++;
      else chooseTurns++;
      if (!("say" in move) && life.now - before < MINUTE) {
        banned.set(move.choose, life.now + 2 * HOUR);
        stalled++;
      } else if (life.now - before >= MINUTE) stalled = 0;
      if (reply.turn) {
        times.push(ms);
        yearTurns++;
        count("turn");
        const days = (life.now - before) / w.clock.day;
        worst.push({ turn: turns, line, ms: Math.round(ms), days: Math.round(days * 100) / 100 });
        worst.sort((a, b) => b.ms - a.ms);
        if (worst.length > 8) worst.length = 8;
      } else {
        rejected++;
        stalled++;
        count(
          /no se entiende/.test(reply.text)
            ? "unparsed"
            : /repetilo/.test(reply.text)
              ? "warning"
              : /Contestá/.test(reply.text)
                ? "clarify"
                : "other-no-time",
        );
      }
      if (reply.end === "dead") break;
      peak = Math.max(peak, process.memoryUsage().rss);
      if (life.now >= nextCheck) {
        scan();
        const found = checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger });
        checks++;
        problems.push(...found.map((p) => JSON.stringify(p)));
        nextCheck = life.now + checkStep;
        progress?.(
          `seed ${config.seed}: dia ${((life.now - from) / w.clock.day).toFixed(0)}, ${turns} turnos, ${found.length} problemas, aldea ${villagers()}, rss ${Math.round(process.memoryUsage().rss / MiB)} MiB`,
        );
      }
      if (life.now - yearFromTick >= w.clock.year) {
        const wall = performance.now() - yearStart;
        const days = (life.now - yearFromTick) / w.clock.day;
        byYear.push({
          year: byYear.length + 1,
          turns: yearTurns,
          wallMs: Math.round(wall),
          worldDays: Math.round(days),
          msPerTurn: Math.round(wall / Math.max(1, yearTurns)),
          secPerWorldYear: Math.round((wall / 1000) * (w.clock.year / (life.now - yearFromTick))),
          rssMiB: Math.round(process.memoryUsage().rss / MiB),
          villagers: villagers(),
          playerAlive: life.alive,
        });
        yearTurns = 0;
        yearStart = performance.now();
        yearFromTick = life.now;
      }
    }
  } catch (error) {
    failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  }
  scan();
  const final = checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger });
  checks++;
  problems.push(...final.map((p) => JSON.stringify(p)));
  const sorted = [...times].sort((a, b) => a - b);
  const top = [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 25);
  return {
    seed: config.seed,
    years: config.years,
    completedYears: Math.round(((life.now - from) / w.clock.year) * 1000) / 1000,
    turns,
    rejected,
    warned,
    lineTurns,
    chooseTurns,
    checks,
    problems,
    playerAlive: life.alive,
    playerEnd,
    villagersStart,
    villagersEnd: villagers(),
    births,
    deaths,
    deathsByCause,
    routineOnPlayer,
    waitTended,
    routineOnPlayerByKind: routineByKind,
    turnMs: {
      mean: Math.round(times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)),
      p50: Math.round(pct(sorted, 0.5)),
      p95: Math.round(pct(sorted, 0.95)),
      max: Math.round(sorted.at(-1) ?? 0),
    },
    worstTurns: worst,
    byYear,
    body: {
      samples: bodySum.n,
      meanSleepDebtH: Math.round((bodySum.debt / Math.max(1, bodySum.n)) * 10) / 10,
      maxSleepDebtH: Math.round(bodySum.maxDebt * 10) / 10,
      meanFatigue: Math.round((bodySum.fatigue / Math.max(1, bodySum.n)) * 100) / 100,
      signShare: Object.fromEntries(
        Object.entries(signCount)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => [k, Math.round((v / Math.max(1, bodySum.n)) * 100) / 100]),
      ),
      meanLocomotion: Math.round((bodySum.loco / Math.max(1, bodySum.n)) * 100) / 100,
    },
    wounds: woundStats(seenWounds, tendTurns, tendNoChange),
    longWaits: {
      count: wait.count,
      requestedDays: wait.requested,
      livedDays: Math.round(wait.lived * 100) / 100,
      completed: wait.completed,
      atWater: wait.atWater,
      atWaterCompleted: wait.atWaterCompleted,
      cutBy: waitCut,
    },
    peakRssMiB: Math.round(peak / MiB),
    stateHash: life.hash().total,
    replies,
    topKinds: Object.fromEntries(top),
    wallSeconds: Math.round((performance.now() - started) / 100) / 10,
    ...(failure ? { failure } : {}),
  };
}
