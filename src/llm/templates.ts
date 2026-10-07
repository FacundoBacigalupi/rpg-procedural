// El narrador sin red (narration §11): arma la narración de una `PlayerView` con las plantillas de
// `content/llm/templates/`, en el mismo formato marcado que el LLM (`{{e1|tu madre}}`), así pasa
// por el mismo validador. Seco pero correcto: es lo que se usa si el modelo no está o falla dos
// veces, y lo que corre la sim headless. Las variantes las elige el rng con la clave que pase quien
// llama (`fork("narration", tick)`), así el replay da la misma prosa.

import type { Rng } from "../core/index.ts";
import type {
  EffectView,
  LocalLabel,
  NarrationTemplate,
  OutcomeView,
  PerceptView,
  PlayerView,
} from "../game/index.ts";

export class TemplateBook {
  readonly #lines: ReadonlyMap<string, readonly string[]>;

  constructor(templates: readonly NarrationTemplate[]) {
    const lines = new Map<string, readonly string[]>();
    for (const t of templates) {
      if (lines.has(t.id)) throw new RangeError(`plantilla repetida: ${t.id}`);
      lines.set(t.id, t.lines);
    }
    this.#lines = lines;
  }

  has(id: string): boolean {
    return this.#lines.has(id);
  }

  lines(id: string): readonly string[] {
    const l = this.#lines.get(id);
    if (!l) throw new RangeError(`no hay plantilla ${id}`);
    return l;
  }

  /** Los ids de todas las plantillas, ordenados. */
  ids(): string[] {
    return [...this.#lines.keys()].sort();
  }
}

type Slots = Readonly<Record<string, string>>;

function fill(line: string, slots: Slots, id: string): string {
  return line.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = slots[key];
    if (v === undefined) throw new RangeError(`la plantilla ${id} pide {${key}}`);
    return v;
  });
}

/** Mayúscula al principio de la oración, también si empieza con una marca. */
function capitalize(s: string): string {
  const at = s.startsWith("{{") ? s.indexOf("|") + 1 : 0;
  return s.slice(0, at) + s.charAt(at).toUpperCase() + s.slice(at + 1);
}

export function renderView(view: PlayerView, book: TemplateBook, rng: Rng): string {
  const labels = new Map(view.labels.map((l) => [l.localId, l]));
  const out: string[] = [];
  const say = (id: string, slots: Slots = {}): void => {
    out.push(capitalize(fill(rng.pick(book.lines(id)), slots, id)));
  };
  const first = (id: string): string => book.lines(id)[0] as string;

  const surface = (l: LocalLabel): string => {
    if (l.name !== undefined) return l.name;
    if (l.relation !== undefined) return `tu ${l.relation}`;
    if (l.figure !== undefined) return first(`figure.${l.figure.sex}.${l.figure.age}`);
    return first("who.vague");
  };
  /** La referencia marcada a una etiqueta, o "alguien" sin marca si no hay a quién. */
  const ref = (id: string | undefined): string => {
    const l = id === undefined ? undefined : labels.get(id);
    return l ? `{{${l.localId}|${surface(l)}}}` : first("who.vague");
  };
  const good = (unit: string | null): string => {
    const id = unit === null ? null : `good.${unit.replace(/^good:/, "")}`;
    return id !== null && book.has(id) ? first(id) : first("good.unknown");
  };

  const s = view.scene;
  const arrived = view.outcomes.some((o) => o.effect.kind === "move" && o.effect.arrived === true);
  const idle = view.outcomes.length === 0 && view.percepts.length === 0;
  if (!s.familiar || arrived || idle) {
    say(s.home ? "scene.home" : `scene.${s.space}`);
    say(`time.${s.time}`);
  }

  for (const o of view.outcomes) outcome(o, say, ref, good, book);
  for (const p of view.percepts) percept(p, say, ref, book);
  for (const c of view.self.cues) say(`self.${c}`);
  if (out.length === 0 || (idle && view.self.cues.length === 0)) say("nothing");
  return out.join(" ");
}

type Say = (id: string, slots?: Slots) => void;

function outcome(
  o: OutcomeView,
  say: Say,
  ref: (id: string | undefined) => string,
  good: (unit: string | null) => string,
  book: TemplateBook,
): void {
  const e: EffectView = o.effect;
  switch (e.kind) {
    case "none": {
      const id = `outcome.${o.verb}.${o.believed}`;
      say(book.has(id) ? id : "outcome.none");
      break;
    }
    case "move":
      say(
        e.arrived === true
          ? "outcome.move.arrived"
          : e.arrived === false
            ? "outcome.move.short"
            : "outcome.move.lost",
      );
      if (e.stumbled) say("outcome.stumbled");
      break;
    case "observe":
      say(`outcome.look.${o.believed}`);
      break;
    case "search":
      if (e.target === undefined && !e.found && !e.glimpsed) say("outcome.search.missed_anyone");
      else {
        const target = ref(e.target);
        say(
          e.found
            ? "outcome.search.found"
            : e.glimpsed
              ? "outcome.search.glimpsed"
              : "outcome.search.missed",
          { target },
        );
      }
      break;
    case "gather": {
      const known = e.good !== null && book.has(`good.${e.good.replace(/^good:/, "")}`);
      const what = known ? good(e.good) : (e.what ?? good(null));
      if (e.amount <= 0 || e.good === null) say("outcome.gather.none");
      else
        say(o.believed === "success" ? "outcome.gather.some" : "outcome.gather.little", { what });
      if (e.stumbled) say("outcome.stumbled");
      break;
    }
    case "work":
      say(`outcome.work.${o.believed}`);
      if (e.hurt) say("outcome.work.hurt");
      break;
    case "speak":
      if (e.text !== null && e.text.length > 0) {
        if (e.to !== undefined) say("outcome.speak.to", { to: ref(e.to), text: e.text });
        else say("outcome.speak.said", { text: e.text });
      } else if (e.to !== undefined) say("outcome.speak.to_silent", { to: ref(e.to) });
      else say("outcome.speak.silent");
      if (!e.delivered) say("outcome.speak.unheard");
      break;
    case "strike": {
      if (e.target === undefined && !e.hit) say("outcome.strike.missed_anyone");
      else {
        const target = ref(e.target);
        say(
          !e.committed
            ? "outcome.strike.held"
            : e.hit && e.glancing
              ? "outcome.strike.glancing"
              : e.hit
                ? "outcome.strike.hit"
                : "outcome.strike.missed",
          { target },
        );
      }
      if (e.offBalance) say("outcome.strike.off_balance");
      break;
    }
    case "trade":
      if (e.moved !== undefined && e.deal) {
        const kilos = e.moved.grams / 1000;
        const grams =
          e.moved.grams >= 1000 ? `${Number(kilos.toFixed(1))} kilos` : `${e.moved.grams} gramos`;
        say(`outcome.trade.${e.moved.direction}.${e.terms}`, {
          with: ref(e.with),
          what: good(e.moved.good),
          grams,
          coins: `${e.moved.coins} ${e.moved.coins === 1 ? "moneda" : "monedas"}`,
        });
      } else if (e.with === undefined)
        say(e.deal ? "outcome.trade.deal_anyone" : "outcome.trade.no_deal_anyone");
      else
        say(e.deal ? `outcome.trade.deal.${e.terms}` : "outcome.trade.no_deal", {
          with: ref(e.with),
        });
      break;
    case "take": {
      if (e.got.length === 0) {
        if (e.from !== undefined) say("outcome.take.nothing_from", { from: ref(e.from) });
        else say("outcome.take.nothing");
      } else {
        const what = [...new Set(e.got.map((g) => good(g.good)))].join(" y ");
        if (e.from !== undefined) say("outcome.take.got_from", { what, from: ref(e.from) });
        else say("outcome.take.got", { what });
      }
      break;
    }
    case "eat":
      if (e.grams <= 0 || e.good === null) say("outcome.eat.nothing");
      else say(e.fromLarder ? "outcome.eat.larder" : "outcome.eat.own", { what: good(e.good) });
      break;
    case "store":
      if (e.got.length === 0) say("outcome.store.nothing");
      else
        say("outcome.store.done", {
          what: [...new Set(e.got.map((g) => good(g.good)))].join(" y "),
        });
      break;
    case "cook":
      if (e.grams <= 0 || e.good === null) say("outcome.cook.nothing");
      else say(`outcome.cook.${e.looks}`, { what: good(e.good) });
      break;
    case "drink":
      say(e.drank ? "outcome.drink.done" : "outcome.drink.none");
      break;
    case "tend":
      if (e.self) say(e.done ? "outcome.tend.self" : "outcome.tend.self_failed");
      else say(e.done ? "outcome.tend.other" : "outcome.tend.other_failed", { who: ref(e.target) });
      break;
  }
  const cue = o.cues[0];
  if (o.believed !== "success" && cue !== undefined) say(`cue.${cue}`);
}

function percept(
  p: PerceptView,
  say: Say,
  ref: (id: string | undefined) => string,
  book: TemplateBook,
): void {
  const who = ref(p.who);
  if (p.words !== undefined) say("percept.words", { who, words: p.words });
  else if (p.action !== undefined) {
    const id = `percept.action.${p.action}`;
    say(book.has(id) ? id : "percept.action.other", { who });
  } else if (p.detail === "vague") {
    say(p.channels.includes("sight") ? "percept.vague.sight" : "percept.vague.sound", { who });
  } else say("percept.presence", { who });
}
