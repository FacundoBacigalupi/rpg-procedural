import { readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { defaultGameSetup, GAME_CONTENT_KINDS } from "../../game/index.ts";
import { LifeStore, openSqlite, type SqlDriver } from "../../persistence/index.ts";
import { openSession } from "../session.ts";
import type { SayResponse, WebState } from "./api.ts";
import { apiHandler } from "./server.ts";

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

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function serve(): Promise<string> {
  const db: SqlDriver = openSqlite(":memory:");
  closers.push(() => db.close());
  const session = await openSession(LifeStore.open(db), {
    seed: 5,
    setup: { game: defaultGameSetup("realistic") },
    content,
  });
  const api = apiHandler(session);
  const http: Server = createServer((req, res) => {
    void api(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  closers.push(() => http.close());
  return `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("API web", { timeout: 60_000 }, () => {
  it("da el estado y juega un turno con los paneles al día", async () => {
    const base = await serve();
    const state = (await (await fetch(`${base}/api/state`)).json()) as WebState;
    expect(state.opening).toContain("Empieza una vida");
    expect(state.character).toContain("Tenés");
    const res = await post(`${base}/api/say`, { line: "espero una hora" });
    const said = (await res.json()) as SayResponse;
    expect(res.status).toBe(200);
    expect(said.end).toBeNull();
    expect(said.text).toMatch(/Pasa/);
    expect(said.now).not.toBe(state.now);
    expect(said.journal.length).toBeGreaterThan(0);
  });

  it("un comando fuera del personaje no pasa el tiempo", async () => {
    const base = await serve();
    const before = (await (await fetch(`${base}/api/state`)).json()) as WebState;
    const said = (await (
      await post(`${base}/api/say`, { line: "inventario" })
    ).json()) as SayResponse;
    expect(said.now).toBe(before.now);
    expect(said.text).toContain("moneda");
  });

  it("rechaza lo inválido y lo que no existe", async () => {
    const base = await serve();
    expect((await post(`${base}/api/say`, "no es json")).status).toBe(400);
    expect((await post(`${base}/api/say`, { line: "  " })).status).toBe(400);
    expect((await fetch(`${base}/api/nada`)).status).toBe(404);
  });
});

describe("opciones sugeridas y entorno", { timeout: 60_000 }, () => {
  it("ofrece opciones y jugar una pasa el tiempo sin el parser", async () => {
    const base = await serve();
    const state = (await (await fetch(`${base}/api/state`)).json()) as WebState;
    expect(state.options.length).toBeGreaterThan(0);
    expect(state.options.length).toBeLessThanOrEqual(4);
    expect(state.environment.length).toBeGreaterThan(0);
    const wait = state.options.find((o) => o.id === "look") ?? state.options[0];
    const res = await post(`${base}/api/choose`, { id: wait?.id });
    const said = (await res.json()) as SayResponse;
    expect(res.status).toBe(200);
    expect(said.now).not.toBe(state.now);
  });

  it("una opción que ya no está no hace nada", async () => {
    const base = await serve();
    const said = (await (await post(`${base}/api/choose`, { id: "nope" })).json()) as SayResponse;
    expect(said.text).toContain("ya no está");
  });
});
