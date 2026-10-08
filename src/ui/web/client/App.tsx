// La pantalla del juego: el chat con la narración a la izquierda y, a la derecha, los paneles del
// personaje, el inventario y la bitácora. Todo el texto lo arma el servidor desde la `PlayerView`;
// acá no se interpreta nada del mundo.

import { type FormEvent, useEffect, useRef, useState } from "react";
import type { Panels, SayResponse, WebState } from "../api.ts";

interface Line {
  readonly who: "you" | "world";
  readonly text: string;
}

const TABS = [
  ["character", "Personaje"],
  ["inventory", "Inventario"],
  ["environment", "Entorno"],
  ["journal", "Bitácora"],
] as const;

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json;
}

export function App() {
  const [lines, setLines] = useState<readonly Line[]>([]);
  const [panels, setPanels] = useState<Panels | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("character");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    call<WebState>("/api/state")
      .then((s) => {
        setLines([{ who: "world", text: s.opening }]);
        setPanels(s);
      })
      .catch((e: unknown) => setLines([{ who: "world", text: `No se pudo abrir la vida: ${e}` }]));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: baja al final cada vez que hay una línea nueva
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const line = input.trim();
    if (line === "") return;
    setInput("");
    await play("/api/say", { line }, line);
  }

  async function play(path: string, body: unknown, shown: string) {
    if (busy || over) return;
    setBusy(true);
    setLines((l) => [...l, { who: "you", text: shown }]);
    try {
      const r = await call<SayResponse>(path, body);
      setLines((l) => [...l, { who: "world", text: r.text }]);
      setPanels(r);
      if (r.end !== null) setOver(true);
    } catch (err) {
      setLines((l) => [...l, { who: "world", text: `Error: ${err}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="layout">
      <main className="chat">
        <header>{panels?.now ?? "…"}</header>
        <div className="lines">
          {lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: la lista solo crece al final
            <p key={i} className={l.who}>
              {l.text}
            </p>
          ))}
          <div ref={bottom} />
        </div>
        {!over && panels && panels.options.length > 0 && (
          <div className="options">
            {panels.options.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={busy}
                onClick={() => play("/api/choose", { id: o.id }, o.label)}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={submit}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={over ? "La vida terminó." : "¿Qué hace tu personaje? (ayuda)"}
            disabled={busy || over}
          />
          <button type="submit" disabled={busy || over || input.trim() === ""}>
            {busy ? "…" : "Enviar"}
          </button>
        </form>
      </main>
      <aside>
        <nav>
          {TABS.map(([id, name]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "on" : ""}
              onClick={() => setTab(id)}
            >
              {name}
            </button>
          ))}
        </nav>
        <pre>{panels ? panels[tab] : ""}</pre>
      </aside>
    </div>
  );
}
