import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, loadContent, makeId, z } from "../core/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  PARSER_EXAMPLES,
  PLANS,
  planFromDraft,
  SKILLS,
  TRAITS,
} from "../sim/index.ts";
import {
  DEFAULT_NARRATION,
  type Fetch,
  type JobLogEntry,
  jsonPayload,
  LLM_JOBS,
  LlmConfig,
  LlmError,
  LlmJobs,
  type LlmProvider,
  localLlmConfig,
  MockLLM,
  narratorSystem,
  OpenAiCompatibleClient,
  offlineLlmConfig,
  openAiClientFactory,
  PARSER_RULES,
  parseIntent,
  parserSetup,
  styleOf,
  verbalize,
} from "./index.ts";

const local = (model: string, grammar = true): LlmProvider => ({
  kind: "local",
  runtime: "ollama",
  model,
  grammar,
});

function config(chain: LlmProvider[]): LlmConfig {
  return LlmConfig.parse({
    jobs: Object.fromEntries(LLM_JOBS.map((j) => [j, [...chain, { kind: "templates" }]])),
    promptLanguage: "en",
    outputLanguage: "es",
  });
}

function jobsWith(clients: Record<string, MockLLM>, chain: LlmProvider[], log?: JobLogEntry[]) {
  return new LlmJobs({
    config: config(chain),
    clientFor: (p) => (p.kind === "local" ? clients[p.model] : undefined),
    log: log ? (e) => log.push(e) : undefined,
  });
}

const Pair = z.strictObject({ a: z.number(), b: z.string() });
const PAIR_SCHEMA = { name: "Pair", schema: z.toJSONSchema(Pair) as Record<string, unknown> };
const ask = { messages: [{ role: "user" as const, content: "dame un par" }] };

describe("LlmConfig", () => {
  it("las configuraciones de siempre son válidas y terminan en plantillas", () => {
    for (const c of [offlineLlmConfig(), localLlmConfig("ollama", "qwen3:14b")]) {
      for (const j of LLM_JOBS) expect(c.jobs[j].at(-1)).toEqual({ kind: "templates" });
    }
  });

  it("rechaza cadenas sin plantillas al final y trabajos que faltan", () => {
    const jobs = Object.fromEntries(LLM_JOBS.map((j) => [j, [{ kind: "templates" }]]));
    const base = { jobs, promptLanguage: "en", outputLanguage: "es" };
    expect(() => LlmConfig.parse({ ...base, jobs: { ...jobs, narrator: [local("m")] } })).toThrow(
      /templates/,
    );
    const { parser: _, ...missing } = jobs;
    expect(LlmConfig.safeParse({ ...base, jobs: missing }).success).toBe(false);
  });
});

describe("LlmJobs", () => {
  it("devuelve la salida estructurada válida del primer proveedor", async () => {
    const m = new MockLLM(['{"a":1,"b":"x"}']);
    const r = await jobsWith({ m }, [local("m")]).structured("parser", Pair, PAIR_SCHEMA, ask);
    expect(r).toEqual({ ok: true, value: { a: 1, b: "x" }, provider: "mock", attempts: 1 });
    expect(m.calls[0]?.schema).toEqual(PAIR_SCHEMA);
  });

  it("regenera una vez con el error explicado", async () => {
    const m = new MockLLM(['{"a":"uno"}', '{"a":1,"b":"x"}']);
    const log: JobLogEntry[] = [];
    const r = await jobsWith({ m }, [local("m")], log).structured("parser", Pair, PAIR_SCHEMA, ask);
    expect(r.ok && r.attempts).toBe(2);
    const retry = m.calls[1]?.messages ?? [];
    expect(retry.at(-2)).toEqual({ role: "assistant", content: '{"a":"uno"}' });
    expect(retry.at(-1)?.content).toMatch(/rejected:\n- a: .*\n- b: /);
    expect(log.map((e) => e.outcome)).toEqual(["invalid", "ok"]);
  });

  it("dos salidas malas pasan al siguiente proveedor; sin ninguno, a las plantillas", async () => {
    const bad = new MockLLM(["no es json", "{}"], "bad");
    const good = new MockLLM(['{"a":2,"b":"y"}'], "good");
    const r = await jobsWith({ bad, good }, [local("bad"), local("good")]).structured(
      "parser",
      Pair,
      PAIR_SCHEMA,
      ask,
    );
    expect(r).toMatchObject({ ok: true, provider: "good", value: { a: 2, b: "y" } });

    const worse = new MockLLM(["[]", "[]"], "worse");
    const none = await jobsWith({ worse }, [local("worse")]).structured(
      "parser",
      Pair,
      PAIR_SCHEMA,
      ask,
    );
    expect(none.ok).toBe(false);
    expect(!none.ok && none.fallback).toBe("templates");
    expect(!none.ok && none.problems.join("\n")).toMatch(/worse: .*expected object/);
  });

  it("un proveedor caído no se reintenta: pasa al siguiente", async () => {
    const down = new MockLLM([new LlmError("network", "ECONNREFUSED")], "down");
    const up = new MockLLM(["hola"], "up");
    const r = await jobsWith({ down, up }, [local("down"), local("up")]).text("narrator", ask);
    expect(r).toMatchObject({ ok: true, value: "hola", provider: "up" });
    expect(down.calls).toHaveLength(1);
  });

  it("un error que no es del proveedor es un bug y sube", async () => {
    const broken = new MockLLM([new TypeError("bug")]);
    await expect(jobsWith({ broken }, [local("broken")]).text("narrator", ask)).rejects.toThrow(
      "bug",
    );
  });

  it("sin red no llama a nadie", async () => {
    let called = false;
    const jobs = new LlmJobs({
      config: offlineLlmConfig(),
      clientFor: () => {
        called = true;
        return undefined;
      },
    });
    expect(await jobs.text("narrator", ask)).toEqual({
      ok: false,
      fallback: "templates",
      problems: [],
    });
    expect(called).toBe(false);
  });

  it("sin gramática no manda el esquema, pero valida igual", async () => {
    const m = new MockLLM(['{"a":1,"b":"x"}']);
    await jobsWith({ m }, [local("m", false)]).structured("parser", Pair, PAIR_SCHEMA, ask);
    expect(m.calls[0]?.schema).toBeUndefined();
  });

  it("el validador del trabajo rechaza y se regenera", async () => {
    const m = new MockLLM(["Ves a Lin Feng.", "Ves a un viejo."]);
    const r = await jobsWith({ m }, [local("m")]).text("narrator", ask, (t) =>
      t.includes("Lin Feng") ? ["nombre que no está en el pedido: Lin Feng"] : [],
    );
    expect(r).toMatchObject({ ok: true, value: "Ves a un viejo.", attempts: 2 });
  });
});

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [ACTIONS, PLANS, SKILLS, TRAITS, PARSER_EXAMPLES],
  [
    ["actions", "content/actions/core.json"],
    ["plans", "content/plans/steal.json"],
    ["skills", "content/skills/core.json"],
    ["traits", "content/traits/human.json"],
    ["llm/parser-examples", "content/llm/parser-examples/core.json"],
  ].map(([kind, file]) => ({
    kind: kind as string,
    file: file as string,
    data: json(file as string),
  })),
);
const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));
const examples = content.all(PARSER_EXAMPLES);
const setup = parserSetup(catalog, examples);

describe("parseIntent", () => {
  it("el prefijo fijo lleva las reglas, los verbos del catálogo y los ejemplos resueltos", () => {
    expect(setup.system.startsWith(PARSER_RULES)).toBe(true);
    expect(setup.system).toMatch(/- move \("moverse"\): to: ref \(a place/);
    expect(setup.system).toMatch(/Manners: careful, fast, covert\./);
    expect(setup.system).toMatch(/- look \("observar"\): no arguments\./);
    expect(setup.system).toMatch(/- steal \("robar"\): params victim: ref \(a person/);
    const shots = examples.filter((e) => e.shot);
    expect(shots.length).toBeGreaterThan(3);
    expect(setup.shots).toHaveLength(shots.length * 2);
    expect(setup.shots[1]?.content).toBe(JSON.stringify(shots[0]?.expect));
  });

  it("restringe la salida al catálogo: verbos y roles como literales", () => {
    const schema = JSON.stringify(setup.jsonSchema.schema);
    for (const v of catalog.verbs) expect(schema).toContain(`{"type":"string","const":"${v.id}"}`);
    expect(schema).toContain('"const":"steal"');
    expect(schema).not.toContain('"repeat"');
    expect(schema).not.toContain('"onEvent"');
  });

  it("manda el prefijo, lo de este turno al final, y devuelve el borrador validado", async () => {
    const draft = {
      kind: "act",
      speech: {
        text: "¿Vio a mi hermana?",
        to: { text: "el viejo", kind: "person", features: ["viejo"] },
      },
      stripped: ["me cuenta todo"],
    };
    const m = new MockLLM([JSON.stringify(draft)]);
    const r = await parseIntent(jobsWith({ m }, [local("m")]), setup, {
      text: "le pregunto al viejo si vio a mi hermana y me cuenta todo",
      scene: "Un viejo junto a un puesto de té.",
      recent: ["ir a la plaza"],
    });
    expect(r).toMatchObject({ ok: true, value: draft });
    const call = m.calls[0];
    expect(call?.schema?.name).toBe("IntentDraft");
    expect(call?.temperature).toBe(0);
    expect(call?.messages[0]).toEqual({ role: "system", content: setup.system });
    expect(call?.messages.slice(1, -1)).toEqual(setup.shots);
    expect(call?.messages.at(-1)?.content).toBe(
      "What the character perceives:\nUn viejo junto a un puesto de té.\n\nRecent intents:\n- ir a la plaza\n\nPlayer: le pregunto al viejo si vio a mi hermana y me cuenta todo",
    );
  });

  it("un verbo o un rol fuera del catálogo vuelve al modelo con el error explicado", async () => {
    const bad = { kind: "act", plan: { kind: "do", verb: "fly", args: [] } };
    const badRole = {
      kind: "act",
      plan: { kind: "do", verb: "move", args: [{ role: "where", text: "al bosque" }] },
    };
    const good = {
      kind: "act",
      plan: {
        kind: "do",
        verb: "move",
        args: [{ role: "to", ref: { text: "el bosque", kind: "place", features: ["bosque"] } }],
      },
    };
    const m = new MockLLM([JSON.stringify(bad), JSON.stringify(badRole)]);
    const r = await parseIntent(jobsWith({ m }, [local("m")]), setup, { text: "vuelo al bosque" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems.join("\n")).toMatch(/unknown verb "fly"/);
      expect(r.problems.join("\n")).toMatch(/move has no role "where" \(roles: to\)/);
    }
    expect(m.calls[1]?.messages.at(-1)?.content).toMatch(/unknown verb "fly"/);

    const ok = new MockLLM([
      `<think>es moverse</think>\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\``,
    ]);
    const r2 = await parseIntent(jobsWith({ ok }, [local("ok")]), setup, { text: "voy al bosque" });
    expect(r2).toMatchObject({ ok: true, value: good });
  });

  it("un borrador que declara resultados o inventa campos no pasa", async () => {
    const m = new MockLLM(['{"kind":"act","outcome":"lo convencés"}', '{"kind":"act"}']);
    const r = await parseIntent(jobsWith({ m }, [local("m")]), setup, { text: "lo convenzo" });
    expect(r.ok).toBe(false);
  });

  it("del texto al plan validado: parser, después referencias contra lo conocido", async () => {
    const draft = examples.find((e) => e.id === "shot-gather-until")?.expect;
    const m = new MockLLM([JSON.stringify(draft)]);
    const r = await parseIntent(jobsWith({ m }, [local("m")]), setup, {
      text: "voy al bosque y junto hierbas hasta que oscurezca",
    });
    if (!r.ok) throw new Error(r.problems.join("\n"));
    const me = makeId("agent", 1);
    const forest = makeId("place", 1);
    const plan = planFromDraft(r.value, {
      actor: me,
      source: "player",
      catalog,
      known: [
        {
          ref: forest,
          kind: "place",
          names: ["el bosque"],
          features: ["pinos"],
          relations: [],
          present: false,
          via: [],
        },
      ],
      clock: EARTHLIKE_CLOCK,
      causes: [],
    });
    expect(plan.kind).toBe("plan");
    if (plan.kind === "plan") {
      expect(plan.plan.root).toMatchObject({
        kind: "seq",
        steps: [
          { kind: "do", verb: "move", args: [{ role: "to", entity: forest }] },
          { kind: "until", body: { kind: "do", verb: "gather" }, cond: { kind: "dark" } },
        ],
      });
    }
  });
});

describe("jsonPayload", () => {
  it("saca el razonamiento y el cerco de Markdown", () => {
    expect(jsonPayload('<think>\nhmm\n</think>\n{"a":1}')).toBe('{"a":1}');
    expect(jsonPayload('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(jsonPayload(' {"a":1} ')).toBe('{"a":1}');
  });
});

describe("narrador y verbalizador", () => {
  it("el prompt fijo lleva persona, tiempo y voseo", () => {
    const s = narratorSystem(styleOf(DEFAULT_NARRATION, "es"));
    expect(s).toMatch(/Rioplatense Spanish, second person, present tense, with voseo/);
    expect(narratorSystem(styleOf({ ...DEFAULT_NARRATION, voseo: true }, "en"))).not.toMatch(
      /voseo/,
    );
  });

  it("verbalizar pasa por su trabajo", async () => {
    const m = new MockLLM(["—No la vi, muchacho."]);
    const jobs = jobsWith({ m }, [local("m")]);
    const v = await verbalize(jobs, {
      speaker: "el viejo",
      content: "deny(seen sister)",
      language: "es",
    });
    expect(v).toMatchObject({ ok: true, value: "—No la vi, muchacho." });
    expect(m.calls[0]?.messages[1]?.content).toBe("Speaker: el viejo\nContent: deny(seen sister)");
  });
});

describe("OpenAiCompatibleClient", () => {
  function fake(reply: () => Response | Promise<Response>) {
    const seen: { url: string; init: RequestInit }[] = [];
    const f: Fetch = async (url, init) => {
      seen.push({ url, init });
      return reply();
    };
    return { f, seen };
  }
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("habla /v1/chat/completions con response_format y lee texto y uso", async () => {
    const { f, seen } = fake(() =>
      ok({
        model: "qwen3:14b",
        choices: [{ message: { content: '{"a":1}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      }),
    );
    const c = new OpenAiCompatibleClient("ollama:qwen3:14b", {
      baseUrl: "http://localhost:11434/",
      model: "qwen3:14b",
      apiKey: "k",
      fetch: f,
    });
    const r = await c.complete({ ...ask, schema: PAIR_SCHEMA, seed: 7, temperature: 0 });
    expect(r).toEqual({
      text: '{"a":1}',
      model: "qwen3:14b",
      usage: { promptTokens: 10, completionTokens: 3 },
    });
    expect(seen[0]?.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(seen[0]?.init.headers).toMatchObject({ authorization: "Bearer k" });
    const body = JSON.parse(String(seen[0]?.init.body));
    expect(body).toMatchObject({
      model: "qwen3:14b",
      stream: false,
      seed: 7,
      temperature: 0,
      response_format: { type: "json_schema", json_schema: { name: "Pair", strict: true } },
    });
    expect(body.max_tokens).toBeUndefined();
  });

  it("los errores salen con su tipo", async () => {
    const http = new OpenAiCompatibleClient("x", {
      baseUrl: "http://h",
      model: "m",
      fetch: fake(() => new Response("modelo no encontrado", { status: 404 })).f,
    });
    await expect(http.complete(ask)).rejects.toMatchObject({ kind: "http", status: 404 });

    const net = new OpenAiCompatibleClient("x", {
      baseUrl: "http://h",
      model: "m",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(net.complete(ask)).rejects.toMatchObject({ kind: "network" });

    const slow = new OpenAiCompatibleClient("x", {
      baseUrl: "http://h",
      model: "m",
      timeoutMs: 5,
      fetch: (_, init) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
        ),
    });
    await expect(slow.complete(ask)).rejects.toMatchObject({ kind: "timeout" });

    const odd = new OpenAiCompatibleClient("x", {
      baseUrl: "http://h",
      model: "m",
      fetch: fake(() => ok({ choices: [] })).f,
    });
    await expect(odd.complete(ask)).rejects.toMatchObject({ kind: "format" });
  });
});

describe("openAiClientFactory", () => {
  it("arma clientes locales con su puerto y saltea APIs sin clave", () => {
    const make = openAiClientFactory({ apiKey: (v) => (v === "acme" ? "k" : undefined) });
    expect(make({ kind: "templates" })).toBeUndefined();
    const a = make(local("qwen3:14b"));
    expect(a?.name).toBe("ollama:qwen3:14b");
    expect(make(local("qwen3:14b"))).toBe(a);
    expect(
      make({ kind: "api", vendor: "other", model: "m", baseUrl: "https://api.example.com" }),
    ).toBeUndefined();
    expect(
      make({ kind: "api", vendor: "acme", model: "m", baseUrl: "https://api.example.com" })?.name,
    ).toBe("acme:m");
  });
});
