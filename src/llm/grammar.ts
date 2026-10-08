// El parser sin red (narration §11, actions §9): una gramática de comandos en español que da el
// mismo `IntentDraft` que el LLM para lo más común ("voy al bosque", "busco a mi padre", "junto
// hierbas hasta que oscurezca", "le digo a Wu: «...»"). Es lo que se usa cuando el modelo no está
// o no da un borrador válido; lo que no entiende devuelve `null` y el turno pide que se reformule.
//
// Cubre: un paso o una secuencia ("y", "después", "luego", comas), los verbos del catálogo de la
// Fase 1 con sus formas en primera persona e infinitivo, los modos (con cuidado, rápido, a
// escondidas), duraciones ("dos horas", "media hora"), "hasta que anochezca / amanezca / hasta
// encontrar", habla entre comillas o con "que"/"si", "mi padre" como relación, metas, preguntas
// fuera del personaje y comandos. Lo que el jugador escribe como resultado ("y me la da",
// "encuentro...") va a `stripped`, como en el parser con LLM.

import type {
  ActionCatalog,
  DraftArg,
  DraftCondition,
  DraftDuration,
  DraftPlanNode,
  IntentDraft,
  RefDescription,
  SpeechDraft,
} from "../sim/index.ts";

const STOP = new Set([
  "a",
  "al",
  "con",
  "de",
  "del",
  "el",
  "en",
  "la",
  "las",
  "lo",
  "los",
  "mi",
  "mis",
  "que",
  "su",
  "tu",
  "un",
  "una",
  "unos",
  "unas",
  "y",
]);

const NUMBERS: Readonly<Record<string, number>> = {
  un: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  quince: 15,
  veinte: 20,
  treinta: 30,
};

const UNITS: Readonly<Record<string, DraftDuration["unit"]>> = {
  segundo: "second",
  minuto: "minute",
  hora: "hour",
  dia: "day",
  día: "day",
  semana: "week",
  mes: "month",
  año: "year",
};

const DURATION =
  /\b(media|\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta)\s+(segundos?|minutos?|horas?|d[ií]as?|semanas?|mes(?:es)?|años?)\b/i;

function duration(text: string): { duration: DraftDuration; rest: string } | null {
  const m = DURATION.exec(text);
  if (!m) return null;
  const word = (m[1] as string).toLowerCase();
  const unitWord = (m[2] as string).toLowerCase().replace(/es$/, "").replace(/s$/, "");
  const unit = UNITS[unitWord] ?? UNITS[unitWord.replace(/e$/, "")];
  if (unit === undefined) return null;
  let d: DraftDuration;
  if (word === "media") {
    d =
      unit === "hour"
        ? { amount: 30, unit: "minute" }
        : unit === "day"
          ? { amount: 12, unit: "hour" }
          : { amount: 0.5, unit };
  } else {
    d = { amount: /^\d+$/.test(word) ? Number(word) : (NUMBERS[word] ?? 1), unit };
  }
  return { duration: d, rest: text.replace(m[0], " ") };
}

const UNTIL: readonly { re: RegExp; cond: (text: string) => DraftCondition }[] = [
  {
    re: /\bhasta que (?:anochezca|oscurezca|se haga de noche|caiga la noche)\b/i,
    cond: (text) => ({ kind: "time", text, is: { kind: "dark" } }),
  },
  {
    re: /\bhasta que (?:amanezca|aclare|salga el sol|se haga de d[ií]a)\b/i,
    cond: (text) => ({ kind: "time", text, is: { kind: "light" } }),
  },
  {
    re: /\bhasta (?:encontrar(?: algo)?|que (?:encuentre|consiga) algo|que me salga)\b/i,
    cond: (text) => ({ kind: "self", text, is: { kind: "succeeded" } }),
  },
];

/** Los modos por palabras; solo se ponen los que el verbo admite en el catálogo. */
const MANNERS: readonly { re: RegExp; manner: string }[] = [
  {
    re: /\b(?:despacito|a escondidas|sin que (?:me|nos) vea[n]?|escondid[oa]s?|sigilosamente|en silencio)\b/i,
    manner: "covert",
  },
  {
    re: /\b(?:con (?:mucho )?cuidado|con (?:mucha )?atenci[oó]n|despacio|atentamente)\b/i,
    manner: "careful",
  },
  { re: /\b(?:corro|corriendo|r[aá]pido|a las corridas|apurad[oa])\b/i, manner: "fast" },
];
const MANNER_WORDS =
  /\b(?:despacito|a escondidas|sin que (?:me|nos) vea[n]?|escondid[oa]s?|sigilosamente|en silencio|con (?:mucho )?cuidado|con (?:mucha )?atenci[oó]n|despacio|atentamente|corriendo|r[aá]pido|a las corridas|apurad[oa]|bien)\b/gi;

function tidy(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,.;]+$/g, "")
    .trim();
}

/** "al bosque" → "el bosque"; "a la herrería" → "la herrería"; "a Wu" → "Wu". */
function dropPreposition(s: string): string {
  return tidy(s)
    .replace(/^(?:hasta|hacia|para|por)\s+/i, "")
    .replace(/^al\s+/i, "el ")
    .replace(/^del\s+/i, "el ")
    .replace(/^(?:a|con|de)\s+/i, "");
}

/** Corta una frase nominal antes de lo que ya no es parte de ella. */
function nounPhrase(s: string): string {
  const cut = s.search(
    /\s(?:que|si|sin|para|con cuidado|buscando|y|cambiarle|cambiar|venderle|comprarle|por)\s|,|\s\w+(?:arle|erle|irle|arla|arlo)\b/i,
  );
  return tidy(cut >= 0 ? s.slice(0, cut) : s);
}

function ref(text: string, kind: RefDescription["kind"]): RefDescription {
  const t = tidy(text);
  const rel = /^(?:mi|mis)\s+(\p{L}+)$/iu.exec(t);
  if (rel) {
    return { text: t, kind, features: [], relation: { to: "self", rel: rel[1] as string } };
  }
  const features = t.split(/\s+/).filter((w) => !STOP.has(w.toLowerCase()));
  return { text: t, kind, features };
}

/** Lo dicho, como lo diría el personaje: mayúscula y cierre. */
function utterance(s: string, question = false): string {
  let t = tidy(s.replace(/^["«“]|["»”]$/g, ""));
  if (question && !t.startsWith("¿")) t = `¿${t.replace(/\?$/, "")}?`;
  const at = /^[¡¿]/.test(t) ? 1 : 0;
  t = t.slice(0, at) + t.charAt(at).toUpperCase() + t.slice(at + 1);
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

const PERSON_ARTICLE = /\b(?:al|a la|a los|a las|a)\s+((?:mi\s+|tu\s+)?[\p{L}][\p{L}\s]*)/iu;

/** Una persona nombrada con "a/al/a la …" en el resto de la frase. */
function personAfterA(rest: string): { ref: RefDescription; before: string } | null {
  const m = PERSON_ARTICLE.exec(rest);
  if (!m) return null;
  const phrase = nounPhrase(dropPreposition(m[0]));
  if (phrase.length === 0) return null;
  return { ref: ref(phrase, "person"), before: tidy(rest.slice(0, m.index)) };
}

interface Clause {
  readonly node?: DraftPlanNode;
  readonly speech?: SpeechDraft;
  readonly stripped?: string;
  readonly unmapped?: string;
}

type Ctx = { lastPlace?: RefDescription };

const INFINITIVE_LEAD =
  /^(?:me\s+)?(?:siento|pongo|voy|vuelvo|quedo|tiro|echo|acuesto)\s+a\s+(?=\p{L}+(?:ar|er|ir)\b)/iu;

const SPEAK =
  /^(?:le|les)\s+(?:digo|pregunto|pido|cuento|hablo|explico|grito)\b|^(?:hablo|charlo|converso)\s+con\b/i;

function speakClause(raw: string, ctx: Ctx): Clause | null {
  const t = tidy(raw);
  // Habla entre comillas: le digo a Wu: "…" / grito "…".
  const q =
    /^(?:le\s+)?(?:digo|grito|susurro|pregunto|contesto|respondo|exclamo)\b\s*(.*?)\s*:?\s*["«“](.+?)["»”]$/i.exec(
      t,
    );
  if (q) {
    const who = tidy(q[1] as string);
    const to = who.length > 0 ? ref(dropPreposition(who), "person") : undefined;
    return { speech: { text: utterance(q[2] as string), ...(to ? { to } : {}) } };
  }
  if (!SPEAK.test(t)) return null;
  const pide = /^le\s+pido\b/i.test(t);
  const asks = /^le\s+pregunto\b/i.test(t);
  // "hablo con X": el "con" se queda para que se lea a quién.
  let rest = t.replace(SPEAK, (m) => (/\bcon$/i.test(m) ? "con" : "")).trim();
  // A quién: "al herrero", "a la vendedora", "con Wu".
  let to: RefDescription | undefined;
  const addressee = /^(?:al|a la|a los|a las|a|con)\s+/i.exec(rest);
  if (addressee) {
    const after = rest.slice(addressee[0].length);
    const cut = after.search(
      /\s(?:que|si|cu[aá]nto|cu[aá]ndo|d[oó]nde|qu[eé]|qui[eé]n|c[oó]mo|por qu[eé])\s/i,
    );
    const phrase = tidy(cut >= 0 ? after.slice(0, cut) : after);
    to = ref(dropPreposition(addressee[0] + phrase), "person");
    rest = cut >= 0 ? after.slice(cut) : "";
  } else if (pide && !/^que\b/i.test(rest)) {
    // "le pido plata al mercader": lo pedido primero, la persona al final.
    const p = personAfterA(rest);
    if (p) {
      to = p.ref;
      rest = p.before;
    }
  }
  if (!to && ctx.lastPlace) {
    // "voy a la casa de mi tío Bo y le pido…": el "le" es el dueño del lugar.
    const de = /\bde\s+(.+)$/i.exec(ctx.lastPlace.text);
    if (de) to = ref(de[1] as string, "person");
  }
  rest = tidy(rest.replace(/^que\s+/i, "").replace(/^si\s+/i, ""));
  const content =
    rest.length === 0
      ? undefined
      : pide && !/^que\b/i.test(t)
        ? `¿Me das ${rest}?`
        : utterance(rest, asks);
  return {
    speech: { text: content ?? "…", ...(to ? { to } : {}) },
  };
}

function act(verb: string, args: DraftArg[], manner: string[] = []): DraftPlanNode {
  return { kind: "do", verb, args, ...(manner.length > 0 ? { manner } : {}) };
}

const VERBS: readonly {
  re: RegExp;
  build: (rest: string, ctx: Ctx, all: string) => Clause | null;
}[] = [
  {
    // Moverse: voy, camino, corro, vuelo (sin vuelo en la Fase 1: queda sin verbo).
    re: /^(?:me\s+)?(?:voy|vamos|ir|camino|caminar|corro|correr|vuelvo|volver|entro|entrar|subo|bajo|cruzo|vuelo|volar)\b/i,
    build: (rest, ctx, all) => {
      const place = nounPhrase(dropPreposition(rest.replace(MANNER_WORDS, " ")));
      if (place.length === 0) return null;
      const r = ref(place, "place");
      ctx.lastPlace = r;
      const unmapped = /^(?:vuelo|volar)\b/i.test(all) ? "volando" : undefined;
      return {
        node: act("move", [{ role: "to", ref: r }]),
        ...(unmapped ? { unmapped } : {}),
      };
    },
  },
  {
    re: /^(?:miro|mirar|observo|observar|echo un vistazo|vigilo)\b/i,
    build: () => ({ node: act("look", []) }),
  },
  {
    re: /^(?:sigo\s+buscando|busco|buscar|rastreo)\b/i,
    build: (rest) => {
      const r = rest.trim();
      const person = /^(?:a|al|a la)\s+/i.exec(r);
      if (person) {
        return {
          node: act("search", [
            { role: "target", ref: ref(nounPhrase(dropPreposition(r)), "person") },
          ]),
        };
      }
      const what = nounPhrase(r.replace(MANNER_WORDS, " "));
      return { node: act("gather", what ? [{ role: "what", text: what }] : []) };
    },
  },
  {
    re: /^(?:junto|juntar|recolecto|recolectar|recojo|recoger|cosecho|cosechar|recolecto)\b/i,
    build: (rest) => {
      const what = nounPhrase(rest.replace(MANNER_WORDS, " "));
      return { node: act("gather", what ? [{ role: "what", text: what }] : []) };
    },
  },
  {
    // "encuentro la hierba": el resultado se descarta, queda el intento de juntarla.
    re: /^(?:encuentro|consigo|hallo)\b/i,
    build: (rest, _ctx, all) => {
      const what = nounPhrase(rest);
      return {
        node: act("gather", what ? [{ role: "what", text: what }] : []),
        stripped: tidy(all),
      };
    },
  },
  {
    re: /^(?:trabajo|trabajar|laburo|laburar|carpo|carpir|aro|arar)\b/i,
    build: (rest) => {
      const d = duration(rest);
      return { node: act("work", d ? [{ role: "for", duration: d.duration }] : []) };
    },
  },
  {
    re: /^(?:descanso|descansar|duermo|dormir|reposo|me acuesto|medito|meditar)\b/i,
    build: (rest, _ctx, all) => {
      const d = duration(rest);
      const unmapped = /^(?:medito|meditar)\b/i.test(all) ? tidy(all) : undefined;
      return {
        node: act("rest", d ? [{ role: "for", duration: d.duration }] : []),
        ...(unmapped ? { unmapped } : {}),
      };
    },
  },
  {
    re: /^(?:espero|esperar|aguardo|aguardar|me quedo(?:\s+\p{L}+)?\s+esperando)/iu,
    build: (rest) => {
      const d = duration(rest);
      return { node: act("wait", d ? [{ role: "for", duration: d.duration }] : []) };
    },
  },
  {
    re: /^(?:como|comer|almuerzo|almorzar|ceno|cenar|desayuno|desayunar|me como)\b/i,
    build: (rest) => {
      const what = nounPhrase(rest.replace(MANNER_WORDS, " ").replace(/^algo\b/i, ""));
      return { node: act("eat", what ? [{ role: "what", text: what }] : []) };
    },
  },
  {
    // "tomo agua" es beber; "tomo la jarra" sigue siendo agarrar (más abajo).
    re: /^(?:bebo|beber|tomo\s+(?:un\s+(?:poco\s+de\s+)?|algo\s+de\s+)?agua|tomar\s+agua|me\s+tomo\s+(?:un\s+)?(?:trago|vaso)(?:\s+de\s+agua)?)\b/i,
    build: () => ({ node: act("drink", []) }),
  },
  {
    // Curar(se), vendar(se), limpiar la herida: el verbo `tend`.
    re: /^(?:me\s+curo|me\s+vendo|curo|curar(?:me)?|vendo\s+(?:la|las|mi|mis|su|sus)\s+herida|vendar(?:me)?|limpio\s+(?:la|las|mi|mis|su|sus)\s+herida|atiendo|atender)/i,
    build: (rest) => {
      const p = personAfterA(rest.replace(MANNER_WORDS, " "));
      return { node: act("tend", p ? [{ role: "target", ref: p.ref }] : []) };
    },
  },
  {
    // Dar y devolver: "le devuelvo el grano a mi tío", "le pago lo que le debo". "Le doy un golpe"
    // sigue siendo pegar (más abajo).
    re: /^(?:le\s+)?(?:devuelvo|devolver|pago|pagar|doy|dar|entrego|entregar|regalo|regalar)\b(?!\s+(?:un|una)\s+(?:golpe|trompada|pi[ñn]a|cachetada|bofetada|patada|paliza|pu[ñn]etazo|palo|empuj[oó]n|sopapo))/i,
    build: (rest) => {
      const clean = rest.replace(MANNER_WORDS, " ");
      const p = personAfterA(clean);
      const what = nounPhrase(
        (p ? p.before : clean).replace(/^\s*(?:todo\s+)?lo\s+que\s+(?:le\s+)?debo\b.*$/i, ""),
      );
      const args: DraftArg[] = [];
      if (p) args.push({ role: "to", ref: p.ref });
      if (what) args.push({ role: "what", text: what });
      return { node: act("give", args) };
    },
  },
  {
    re: /^(?:le|la|lo)?\s*(?:pego|ataco|atacar|golpeo|golpear|le doy|le tiro|pegarle)\b/i,
    build: (rest) => {
      const p = personAfterA(rest.replace(MANNER_WORDS, " "));
      return { node: act("strike", p ? [{ role: "target", ref: p.ref }] : []) };
    },
  },
  {
    re: /^(?:le\s+)?(?:ofrezco|comercio|negocio|cambio|regateo|vendo|compro)\b/i,
    build: (rest) => {
      const clean = rest.replace(MANNER_WORDS, " ");
      const p = personAfterA(clean.replace(/^\s*con\s+/i, " a ").replace(/\scon\s/i, " a "));
      // Lo que se trata es lo que viene antes de la persona: "2 kilos de grano a Wu".
      const goods = tidy((p ? p.before : clean).replace(/^(?:un\s+poco\s+de|algo\s+de)\s+/i, ""));
      const what = /^\s*(?:con|al|a la|a)\s/i.test(goods) ? "" : goods;
      const args: DraftArg[] = [];
      if (p) args.push({ role: "with", ref: p.ref });
      if (what) args.push({ role: "what", text: what });
      return { node: act("trade", args) };
    },
  },
  {
    re: /^(?:le\s+)?(?:robo|robar)\b/i,
    build: (rest) => {
      const p = personAfterA(rest.replace(MANNER_WORDS, " "));
      if (p) {
        return {
          node: {
            kind: "template",
            template: "steal",
            params: { victim: { role: "victim", ref: p.ref } },
          },
        };
      }
      const what = nounPhrase(rest.replace(MANNER_WORDS, " "));
      return { node: act("take", what ? [{ role: "what", text: what }] : [], ["covert"]) };
    },
  },
  {
    re: /^(?:le\s+)?(?:agarro|agarrar|tomo|tomar|saco|sacar|me llevo|levanto)\b/i,
    build: (rest) => {
      const clean = rest.replace(MANNER_WORDS, " ");
      const p = personAfterA(clean);
      const what = nounPhrase(p ? p.before : clean);
      const args: DraftArg[] = [];
      if (p) args.push({ role: "from", ref: p.ref });
      if (what) args.push({ role: "what", text: what });
      return { node: act("take", args) };
    },
  },
  {
    // Guardar lo que lleva en la despensa de la casa: "guardo el grano", "dejo todo en la despensa".
    re: /^(?:guardo|guardar|almaceno|almacenar|dejo\s+(?=.*\b(?:despensa|alacena|granero)\b))/i,
    build: (rest) => {
      const what = nounPhrase(
        rest
          .replace(MANNER_WORDS, " ")
          .replace(/\s+(?:en|a)\s+(?:la\s+)?(?:despensa|alacena|casa|granero)\b.*$/i, "")
          .replace(/^\s*(?:todo|todo lo que llevo)\s*$/i, ""),
      );
      return { node: act("store", what ? [{ role: "what", text: what }] : []) };
    },
  },
  {
    // Cocinar: "cocino pan", "horneo pan plano", "me pongo a cocinar".
    re: /^(?:cocino|cocinar|horneo|hornear|amaso|amasar|me pongo a (?:cocinar|hornear))\b/i,
    build: (rest) => {
      const what = nounPhrase(
        rest.replace(MANNER_WORDS, " ").replace(/^\s*(?:algo|la comida)\s*$/i, ""),
      );
      return { node: act("cook", what ? [{ role: "what", text: what }] : []) };
    },
  },
];

function mannersOf(text: string, verb: string, catalog: ActionCatalog | undefined): string[] {
  const allowed = catalog?.verb(verb)?.manners.map((m) => m.id);
  const out: string[] = [];
  for (const { re, manner } of MANNERS) {
    if (!re.test(text) || out.includes(manner)) continue;
    if (allowed && !allowed.includes(manner)) continue;
    // Despacito y escondido mandan sobre "con cuidado" cuando el verbo admite los dos.
    out.push(manner);
  }
  return out;
}

function clause(raw: string, ctx: Ctx, catalog: ActionCatalog | undefined): Clause | null {
  let text = tidy(raw);
  const speech = speakClause(text, ctx);
  if (speech) return speech;

  let until: DraftCondition | undefined;
  for (const u of UNTIL) {
    const m = u.re.exec(text);
    if (m) {
      until = u.cond(m[0].toLowerCase());
      text = tidy(text.replace(m[0], " "));
      break;
    }
  }
  const lead = INFINITIVE_LEAD.exec(text);
  const core = lead ? text.slice(lead[0].length) : text;
  for (const v of VERBS) {
    const m = v.re.exec(core);
    if (!m) continue;
    const c = v.build(core.slice(m[0].length), ctx, core);
    if (!c?.node) return c;
    let node = c.node;
    if (node.kind === "do") {
      const manner = [...new Set([...(node.manner ?? []), ...mannersOf(text, node.verb, catalog)])];
      if (/^(?:corro|correr)\b/i.test(core) && !manner.includes("fast")) manner.push("fast");
      node = act(node.verb, [...node.args], manner);
    }
    if (until) node = { kind: "until", body: node, cond: until };
    return { ...c, node };
  }
  // "y me la da", "y me cuenta todo", "lo convenzo": un resultado escrito, no un intento.
  if (/^(?:me|nos)\s+\p{L}+/iu.test(text) || /^(?:lo|la)\s+convenzo\b/i.test(text)) {
    return { stripped: text };
  }
  return null;
}

/** Corta en pasos, con lo que separa a cada pedazo del anterior. */
function pieces(text: string): { sep: string; text: string }[] {
  const parts = text.split(
    /(\s*,\s*(?:y\s+)?(?:despu[eé]s\s+|luego\s+)?|\s+y\s+(?:despu[eé]s\s+|luego\s+)?|\s+(?:despu[eé]s|luego)\s+)/i,
  );
  const out: { sep: string; text: string }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const t = tidy(parts[i] as string);
    if (t.length > 0) out.push({ sep: parts[i - 1] ?? "", text: t });
  }
  return out;
}

const META =
  /^(?:guardar|cargar|salir|abrir el inspector|inspector|god|ayuda|men[uú]|personaje|inventario|hip[oó]tesis|bit[aá]cora|pens[aá]r?|pienso|reflexion[oa]r?|¿?qu[eé] hago (?:con|sobre))(?![\p{L}])/iu;
const GOAL = /^(?:quiero|mi meta es|sueño con|alg[uú]n d[ií]a (?:voy a|quiero))\s+(.+)$/i;

/**
 * El borrador de un texto del jugador, o `null` si la gramática no lo entiende. Con el catálogo,
 * solo pone los modos que cada verbo admite.
 */
export function parseCommand(input: string, catalog?: ActionCatalog): IntentDraft | null {
  const text = tidy(input);
  if (text.length === 0) return null;
  if (META.test(text)) return { kind: "meta", text };
  if (/^¿/.test(text) || (/\?$/.test(text) && !SPEAK.test(text))) {
    return { kind: "question_ooc", text };
  }
  const goal = GOAL.exec(text);
  if (goal) return { kind: "goal", text: tidy(goal[1] as string) };

  // Un pedazo que no empieza un paso se pega al anterior ("despacio y con cuidado", "el cielo y la
  // tierra"); uno que todavía no se entiende espera al siguiente.
  const ctx: Ctx = {};
  const raws: string[] = [];
  const parsed: (Clause | null)[] = [];
  for (const p of pieces(text)) {
    const c = clause(p.text, ctx, catalog);
    const last = raws.length - 1;
    if (c && (last < 0 || parsed[last] !== null)) {
      raws.push(p.text);
      parsed.push(c);
    } else if (last >= 0) {
      raws[last] = `${raws[last]}${p.sep}${p.text}`;
      parsed[last] = clause(raws[last] as string, ctx, catalog);
    } else {
      raws.push(p.text);
      parsed.push(null);
    }
  }
  if (parsed.some((c) => c === null)) return null;
  const clauses = parsed as Clause[];
  const nodes = clauses.flatMap((c) => (c.node ? [c.node] : []));
  const speeches = clauses.flatMap((c) => (c.speech ? [c.speech] : []));
  const stripped = clauses.flatMap((c) => (c.stripped ? [c.stripped] : []));
  const unmapped = clauses.flatMap((c) => (c.unmapped ? [c.unmapped] : []));
  const extra = {
    ...(stripped.length > 0 ? { stripped } : {}),
    ...(unmapped.length > 0 ? { unmapped } : {}),
  };

  // Solo habla: va en `speech`. En una secuencia, hablar es el verbo `speak`.
  if (nodes.length === 0) {
    const s = speeches[0];
    return s && speeches.length === 1 ? { kind: "act", speech: s, ...extra } : null;
  }
  const steps: DraftPlanNode[] = [];
  for (const c of clauses) {
    if (c.node) steps.push(c.node);
    else if (c.speech) {
      const args: DraftArg[] = [];
      if (c.speech.to) args.push({ role: "to", ref: c.speech.to });
      if (c.speech.text !== "…") args.push({ role: "content", text: c.speech.text });
      steps.push(act("speak", args));
    }
  }
  const plan: DraftPlanNode =
    steps.length === 1 ? (steps[0] as DraftPlanNode) : { kind: "seq", steps };
  return { kind: plan.kind === "do" || plan.kind === "template" ? "act" : "plan", plan, ...extra };
}
