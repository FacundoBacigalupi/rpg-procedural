// La pantalla del juego: el chat con la narración a la izquierda y, a la derecha, los paneles del
// personaje, el inventario y la bitácora. Todo el texto lo arma el servidor desde la `PlayerView`;
// acá no se interpreta nada del mundo.

import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { History, Panels, SayResponse, WebState } from "../api.ts";

interface Line {
  readonly who: "you" | "world";
  readonly text: string;
  /** De la narración guardada: cuándo fue y su lugar en la bitácora. */
  readonly when?: string;
  readonly seq?: number;
}

const fromHistory = (h: History): Line[] =>
  h.entries.map((e) => ({ who: "world", text: e.text, when: e.when, seq: e.seq }));

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
  const [more, setMore] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Al subir se piden entradas más viejas: se recuerda la altura para que la vista no salte.
  const prepended = useRef<number | null>(null);
  const loading = useRef(false);

  useEffect(() => {
    call<WebState>("/api/state")
      .then((s) => {
        const past = fromHistory(s.history);
        setLines(past.length > 0 ? past : [{ who: "world", text: s.opening }]);
        setMore(s.history.more);
        setPanels(s);
      })
      .catch((e: unknown) => setLines([{ who: "world", text: `No se pudo abrir la vida: ${e}` }]));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reacciona a las líneas, no a las refs
  useLayoutEffect(() => {
    const el = box.current;
    if (prepended.current !== null && el) {
      el.scrollTop = el.scrollHeight - prepended.current;
      prepended.current = null;
    } else {
      bottom.current?.scrollIntoView({ block: "end" });
    }
  }, [lines]);

  async function loadOlder() {
    const el = box.current;
    const oldest = lines.find((l) => l.seq !== undefined)?.seq;
    if (!el || !more || loading.current || oldest === undefined) return;
    loading.current = true;
    try {
      const h = await call<History>(`/api/history?before=${oldest}`);
      prepended.current = el.scrollHeight;
      setLines((l) => [...fromHistory(h), ...l]);
      setMore(h.more);
    } catch {
      // sin red local no hay más historia: se reintenta al volver a subir
    } finally {
      loading.current = false;
    }
  }

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
        <div
          className="lines"
          ref={box}
          onScroll={(e) => {
            if (e.currentTarget.scrollTop < 80) void loadOlder();
          }}
        >
          {more && <p className="older">…</p>}
          {lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: las líneas nuevas van al final y las viejas al principio, sin reordenar
            <p key={l.seq ?? `n${i}`} className={l.who}>
              {l.when && <span className="when">{`— ${l.when}\n`}</span>}
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
                className={`tone-${o.tone}`}
                title={o.toneLabel}
                aria-label={`${o.label} (${o.toneLabel})`}
                onClick={() => {
                  if (
                    o.confirm &&
                    !window.confirm(`${o.label}
(${o.toneLabel}). ¿Seguro?`)
                  )
                    return;
                  play("/api/choose", { id: o.id }, o.label);
                }}
              >
                <span className={`icon icon-${o.icon}`} aria-hidden="true" />
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
