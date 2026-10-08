// El servidor web local (ARCHITECTURE §7.8): una sola vida en memoria sobre la sesión compartida con
// la CLI, una API JSON mínima y, en el mismo puerto, el cliente servido por Vite. Solo escucha en
// 127.0.0.1: es un juego personal, sin cuentas ni red.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { characterPanel, inventoryPanel } from "../../game/index.ts";
import {
  renderCharacter,
  renderEnvironment,
  renderInventory,
  renderJournal,
  renderStatus,
  renderSuggestion,
} from "../render.ts";
import { JOURNAL_SHOWN, type Session } from "../session.ts";
import type { Panels, SayResponse, WebState } from "./api.ts";

/** Los paneles del personaje con el texto de la CLI, sin números de la verdad (player-loop §9). */
export function panelsOf(session: Session): Panels {
  const w = session.life.world;
  return {
    now: renderStatus(session.life.now),
    character: renderCharacter(characterPanel(w)),
    inventory: renderInventory(inventoryPanel(w)),
    journal: renderJournal(session.store.narrations(JOURNAL_SHOWN)),
    environment: renderEnvironment(session.environment()),
    options: session.suggested().map((o) => ({ id: o.id, label: renderSuggestion(o) })),
  };
}

const MAX_BODY = 64 * 1024;

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body demasiado grande");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/**
 * El manejador de la API. Devuelve `false` si la ruta no es de la API (la atiende Vite). Los turnos
 * se serializan: una línea a la vez, porque cada uno cambia la vida.
 */
export function apiHandler(session: Session) {
  let queue: Promise<unknown> = Promise.resolve();
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/api/state" && req.method === "GET") {
      const state: WebState = { opening: session.opening, ...panelsOf(session) };
      send(res, 200, state);
      return true;
    }
    const turnRoutes = { "/api/say": "line", "/api/choose": "id" } as const;
    const field = path === undefined ? undefined : turnRoutes[path as keyof typeof turnRoutes];
    if (field !== undefined && req.method === "POST") {
      let value: unknown;
      try {
        value = (JSON.parse(await readBody(req)) as Record<string, unknown>)[field];
      } catch {
        send(res, 400, { error: "cuerpo inválido" });
        return true;
      }
      if (typeof value !== "string" || value.trim() === "") {
        send(res, 400, { error: `falta ${field}` });
        return true;
      }
      const text = value;
      const run = queue.then(() => (field === "line" ? session.say(text) : session.choose(text)));
      queue = run.catch(() => undefined);
      try {
        const reply = await run;
        const body: SayResponse = {
          text: reply.text,
          end: reply.end ?? null,
          ...panelsOf(session),
        };
        send(res, 200, body);
      } catch (e) {
        send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
      return true;
    }
    if (path?.startsWith("/api/")) {
      send(res, 404, { error: "no existe" });
      return true;
    }
    return false;
  };
}

/** Levanta el servidor con el cliente de `clientRoot` servido por Vite; devuelve el puerto real. */
export async function startWeb(
  session: Session,
  options: { readonly port: number; readonly clientRoot: string },
): Promise<{ port: number; close(): Promise<void> }> {
  const { createServer: createVite } = await import("vite");
  const react = (await import("@vitejs/plugin-react")).default;
  const vite = await createVite({
    root: options.clientRoot,
    plugins: [react()],
    appType: "spa",
    server: { middlewareMode: true },
  });
  const api = apiHandler(session);
  const http = createServer((req, res) => {
    api(req, res)
      .then((handled) => {
        if (!handled) vite.middlewares(req, res);
      })
      .catch((e: unknown) => send(res, 500, { error: String(e) }));
  });
  await new Promise<void>((ok) => http.listen(options.port, "127.0.0.1", ok));
  return {
    port: (http.address() as AddressInfo).port,
    close: async () => {
      await vite.close();
      await new Promise<void>((ok) => http.close(() => ok()));
    },
  };
}
