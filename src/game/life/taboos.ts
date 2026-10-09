// Los tabúes que nacen en la aldea (language §7): cuando alguien muere, su nombre de pila deja de
// decirse y la gente lo rodea («el viejo de la montaña»). Dos procesos: uno al compás de los
// eventos (declara el tabú de cada muerto de la aldea y cuenta los rodeos que se dijeron) y otro
// por día (con los años y los usos, el rodeo se vuelve la palabra o el tabú se olvida). La lengua
// sale del seed; el tabú vivo es lo que lee `converse` para armar y juzgar lo dicho.

import type {
  AgentId,
  EntityRef,
  EventId,
  PlaceRef,
  PlanetClock,
  SettlementId,
  Tick,
} from "../../core/index.ts";
import {
  BORN_TABOO,
  type BornTaboo,
  bornTabooDefs,
  bornTabooVerdict,
  type ConceptDef,
  draftEvent,
  ENTITY,
  type EventDraft,
  HEARD_WORDS,
  type HeardWords,
  type Language,
  learnHeardWords,
  normalize,
  PERSON,
  PERSON_NAME,
  PLACE,
  type ProcessDef,
  pickCircumlocution,
  type ReadonlyWorldTruth,
  type StateChange,
  setComponent,
  spokenTaboos,
  type TabooDef,
} from "../../sim/index.ts";

/** Lo de la forma de habla de la aldea que usan los tabúes (`ConverseForm` lo cumple). */
export interface TabooForm {
  readonly language: Language;
  readonly concepts: readonly ConceptDef[];
  readonly taboos: readonly TabooDef[];
  readonly culture: string;
}

export const BORN_TABOOS_PROCESS = "life.born_taboos";
export const BORN_TABOOS_SETTLE_PROCESS = "life.born_taboos_settle";

/** Lo grave que es, al nacer, decir el nombre de un muerto de la aldea (sin calibrar). */
export const DEAD_NAME_SEVERITY = 0.6;
/** Desde esta edad el muerto era «viejo» para el rodeo (años, sin calibrar). */
export const ELDER_AGE_YEARS = 50;

/** Los rodeos posibles, en orden de preferencia: de un viejo y de alguien más joven. */
export const ELDER_CIRCUMLOCUTIONS: readonly (readonly string[])[] = [
  ["old", "mountain"],
  ["old", "hill"],
  ["old", "stone"],
];
export const YOUNG_CIRCUMLOCUTIONS: readonly (readonly string[])[] = [
  ["small", "star"],
  ["small", "flower"],
  ["small", "stone"],
];

export interface BornTabooOptions {
  readonly form: TabooForm;
  readonly clock: PlanetClock;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** El asentamiento de la aldea (el primer lugar de tipo aldea), si ya existe. */
export function villageOf(truth: ReadonlyWorldTruth): SettlementId | undefined {
  return truth.ids(PLACE).find((id) => truth.get(PLACE, id)?.kind === "village") as
    | SettlementId
    | undefined;
}

/** Los tabúes de la cultura más los que nacieron en la aldea y siguen vivos hoy. */
export function liveTaboos(
  truth: ReadonlyWorldTruth,
  form: TabooForm,
  now: Tick,
): readonly TabooDef[] {
  const village = villageOf(truth);
  if (village === undefined) return form.taboos;
  const born = bornTabooDefs(truth, village, form.culture, now);
  return born.length === 0 ? form.taboos : [...form.taboos, ...born];
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** El tabú que nace de la muerte de `dead`: su nombre de pila con un rodeo según la edad. */
function bornFrom(
  truth: ReadonlyWorldTruth,
  o: BornTabooOptions,
  village: SettlementId,
  dead: AgentId,
  cause: EventId,
  now: Tick,
): { row: Omit<BornTaboo, "originEventId">; word: readonly string[] } | undefined {
  const name = truth.get(PERSON_NAME, dead);
  const given = name?.parts.find((p) => p.kind === "given");
  if (!name || !given || name.language !== o.form.language.id || given.meaning.length === 0) {
    return undefined;
  }
  const person = truth.get(PERSON, dead);
  if (!person || truth.get(PERSON, dead)?.household === undefined) return undefined;
  const elder = (now - person.born) / o.clock.year >= ELDER_AGE_YEARS;
  const candidates = (elder ? ELDER_CIRCUMLOCUTIONS : YOUNG_CIRCUMLOCUTIONS).filter(
    (c) => !same(c, given.meaning),
  );
  const circumlocution = pickCircumlocution(o.form.language, candidates);
  if (!circumlocution) return undefined;
  return {
    word: given.meaning,
    row: {
      subject: dead,
      community: village,
      language: name.language,
      kind: "dead",
      word: given.meaning,
      circumlocution,
      severity: DEAD_NAME_SEVERITY,
      bornAt: now,
      uses: 0,
      status: "active",
      causeEvent: cause,
    },
  };
}

/**
 * Al compás de los eventos: de cada muerte en la aldea nace el tabú del nombre (con evento que
 * cuelga de la muerte), y cada cosa dicha que lleva el rodeo de un tabú vivo y no la palabra suma
 * un uso del rodeo.
 */
export function bornTaboosProcess(o: BornTabooOptions): ProcessDef {
  return {
    id: BORN_TABOOS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "settle",
    reads: [PERSON.name, PERSON_NAME.name, PLACE.name, ENTITY.name, BORN_TABOO.name],
    writes: [BORN_TABOO.name],
    run(ctx) {
      const village = villageOf(ctx.truth);
      if (village === undefined) return {};
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      const touched = new Map<EntityRef, BornTaboo>();
      const gloss = (c: string) => o.form.concepts.find((x) => x.id === c)?.es;
      for (const e of ctx.recent) {
        if (e.kind === "body.died") {
          const dead = e.actors[0] as AgentId | undefined;
          if (!dead || ctx.truth.get(BORN_TABOO, dead) || touched.has(dead)) continue;
          const born = bornFrom(ctx.truth, o, village, dead, e.id, ctx.now);
          if (!born) continue;
          const origin = draftEvent(events.length);
          events.push({
            kind: "language.taboo_born",
            actors: [],
            place: o.placeOf(ctx.truth, dead),
            data: { subject: dead, kind: "dead", word: [...born.word] },
            emissions: null,
            causes: [{ kind: "event", event: e.id }],
          });
          const row: BornTaboo = { ...born.row, originEventId: origin };
          touched.set(dead, row);
          changes.push(setComponent(BORN_TABOO, dead, row));
        } else if (e.kind === "action.speak") {
          const text = (e.data as { effect?: { text?: string | null } } | null)?.effect?.text;
          if (!text) continue;
          const norm = normalize(text);
          for (const id of ctx.truth.ids(BORN_TABOO)) {
            const row = touched.get(id) ?? ctx.truth.get(BORN_TABOO, id);
            if (!row || row.status !== "active" || row.community !== village) continue;
            const circ: TabooDef = {
              id: `rodeo.${row.subject}`,
              name: "rodeo",
              culture: o.form.culture,
              kind: row.kind,
              concepts: [...row.circumlocution],
              circumlocution: [...row.circumlocution],
              severity: 0,
              reason: "",
            };
            const said = spokenTaboos(norm, [circ], o.form.culture, gloss).length > 0;
            const word = spokenTaboos(
              norm,
              [{ ...circ, concepts: [...row.word] }],
              o.form.culture,
              gloss,
            ).length;
            if (!said || word > 0) continue;
            const next = { ...row, uses: row.uses + 1 };
            touched.set(id, next);
            changes.push(setComponent(BORN_TABOO, id, next));
          }
        }
      }
      return events.length === 0 && changes.length === 0 ? {} : { changes, events };
    },
  };
}

/** Por día: los tabúes que se sostuvieron se vuelven palabra normal y los que nadie sostuvo se olvidan. */
export function bornTaboosSettleProcess(o: { village: PlaceRef }): ProcessDef {
  return {
    id: BORN_TABOOS_SETTLE_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "settle",
    reads: [BORN_TABOO.name],
    writes: [BORN_TABOO.name],
    run(ctx) {
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];
      for (const id of ctx.truth.ids(BORN_TABOO)) {
        const row = ctx.truth.get(BORN_TABOO, id);
        const status = row ? bornTabooVerdict(row, ctx.now) : undefined;
        if (!row || !status) continue;
        events.push({
          kind: status === "lexicalized" ? "language.taboo_lexicalized" : "language.taboo_lapsed",
          actors: [],
          place: o.village,
          data: {
            subject: row.subject,
            word: [...row.word],
            circumlocution: [...row.circumlocution],
          },
          emissions: null,
          causes: [{ kind: "event", event: row.originEventId }],
        });
        changes.push(setComponent(BORN_TABOO, id, { ...row, status, settledAt: ctx.now }));
      }
      return changes.length === 0 ? {} : { changes, events };
    },
  };
}

export const HEARD_WORDS_PROCESS = "life.heard_words";

/**
 * Al compás de los eventos: las palabras de la forma de cada `action.speak` (el tratamiento y las
 * dichas con rodeo o tabú, `formWhitelist`) pasan al léxico de los dos que hablaron, que es lo que
 * el narrador puede citar (language §13).
 */
export function heardWordsProcess(): ProcessDef {
  return {
    id: HEARD_WORDS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "onEvent", scene: "onEvent" },
    representation: "individual",
    phase: "settle",
    reads: [HEARD_WORDS.name],
    writes: [HEARD_WORDS.name],
    run(ctx) {
      const next = new Map<EntityRef, HeardWords>();
      for (const e of ctx.recent) {
        if (e.kind !== "action.speak") continue;
        const form = (
          e.data as {
            effect?: { form?: { address?: string; words?: readonly { text: string }[] } };
          } | null
        )?.effect?.form;
        if (!form) continue;
        const said = [form.address ?? "", ...(form.words ?? []).map((w) => w.text)];
        for (const who of e.actors) {
          const row = learnHeardWords(next.get(who) ?? ctx.truth.get(HEARD_WORDS, who), said);
          if (row) next.set(who, row);
        }
      }
      const changes: StateChange[] = [...next].map(([who, row]) =>
        setComponent(HEARD_WORDS, who, row),
      );
      return changes.length === 0 ? {} : { changes };
    },
  };
}
