// La barra de arriba: lo básico de un vistazo (hora, cielo, aire, lugar, gente, cuerpo, monedas).
// Todo viene en bandas desde `Hud`; acá solo se elige ícono y palabra. Cada chip lleva texto además
// del ícono, y lo grave se marca con borde, no solo con color.

import type { Hud } from "../api.ts";

const PHASE: Record<Hud["phase"], [string, string]> = {
  night: ["🌙", "noche"],
  dawn: ["🌅", "amanecer"],
  day: ["☀️", "día"],
  dusk: ["🌇", "atardecer"],
};

const SKY: Record<Hud["sky"], [string, string] | null> = {
  clear: ["✨", "despejado"],
  cloudy: ["⛅", "algunas nubes"],
  overcast: ["☁️", "nublado"],
  rain: ["🌧️", "llueve"],
  snow: ["❄️", "nieva"],
  unknown: null,
};

const AIR: Record<Hud["air"], string> = {
  bitter: "frío que corta",
  cold: "frío",
  cool: "fresco",
  mild: "templado",
  warm: "cálido",
  hot: "calor",
};

const SEASON: Record<Hud["season"], [string, string]> = {
  spring: ["🌱", "primavera"],
  summer: ["🌾", "verano"],
  autumn: ["🍂", "otoño"],
  winter: ["🌨️", "invierno"],
};

const PLACE: Record<string, string> = {
  village: "aldea",
  fields: "campos",
  forest: "bosque",
  water: "agua",
  grave: "tumbas",
};

const SPACE: Record<string, string> = {
  room: "adentro",
  yard: "patio",
  street: "calle",
  square: "plaza",
  open: "a campo abierto",
};

function placeText(p: Hud["place"]): [string, string] {
  if (p.home) return ["🏠", "en tu casa"];
  const kinds = p.kinds.map((k) => PLACE[k] ?? k);
  const icon = p.indoor
    ? "🚪"
    : p.kinds.includes("forest")
      ? "🌲"
      : p.kinds.includes("village")
        ? "🏘️"
        : "🌄";
  return [icon, [SPACE[p.space] ?? p.space, ...kinds].join(" · ")];
}

const LEVEL = ["", "", "mucha", "grave"] as const;

interface Chip {
  readonly icon: string;
  readonly text: string;
  readonly title: string;
  /** 0 normal, 1 se nota, 2 fuerte, 3 grave. */
  readonly alert?: number;
}

function bodyChips(b: Hud["body"]): Chip[] {
  const out: Chip[] = [];
  const level = (n: number, icon: string, word: string, title: string) => {
    if (n > 0) out.push({ icon, text: n >= 2 ? `${LEVEL[n]} ${word}` : word, title, alert: n });
  };
  level(b.hunger, "🍞", "hambre", "Hambre");
  level(b.thirst, "💧", "sed", "Sed");
  level(b.fatigue, "🥱", "cansancio", "Cansancio");
  if (b.sleepy) out.push({ icon: "😴", text: "sueño", title: "Sueño", alert: 1 });
  if (b.pain) out.push({ icon: "🤕", text: "dolor", title: "Te duele algo", alert: 2 });
  level(b.bleeding, "🩸", "sangrás", "Sangrado");
  if (b.fever) out.push({ icon: "🌡️", text: "fiebre", title: "Fiebre", alert: 2 });
  if (b.hurt) out.push({ icon: "🦴", text: "herido", title: "Algo roto o rengueás", alert: 2 });
  if (out.length === 0) out.push({ icon: "💚", text: "bien", title: "Te sentís bien" });
  return out;
}

export function TopBar({ hud, now }: { hud: Hud | undefined; now: string }) {
  if (!hud) return <header className="topbar">{now}</header>;
  const clock = now.replace(/^—\s*/, "");
  const [phaseIcon, phaseText] = PHASE[hud.phase];
  const sky = SKY[hud.sky];
  const [seasonIcon, seasonText] = SEASON[hud.season];
  const [placeIcon, place] = placeText(hud.place);
  const people =
    hud.people.around === 0
      ? "nadie a la vista"
      : `${hud.people.around}${hud.people.more ? "+" : ""} cerca${hud.people.known > 0 ? ` · ${hud.people.known} conocidos` : ""}`;
  const chips: Chip[] = [
    { icon: phaseIcon, text: clock, title: phaseText },
    ...(sky ? [{ icon: sky[0], text: sky[1], title: "El cielo" }] : []),
    ...(hud.windy ? [{ icon: "🌬️", text: "viento", title: "Viento fuerte" }] : []),
    { icon: "🌡️", text: AIR[hud.air], title: "Cómo sentís el aire afuera" },
    { icon: seasonIcon, text: seasonText, title: "Estación" },
    { icon: placeIcon, text: place, title: "Dónde estás" },
    { icon: "👥", text: people, title: "Gente que ves o notás" },
    { icon: "🪙", text: String(hud.coins), title: "Monedas de cobre" },
  ];
  return (
    <header className="topbar">
      <div className="chips">
        {chips.map((c) => (
          <span key={c.title} className="chip" title={c.title}>
            <span aria-hidden="true">{c.icon}</span>
            {c.text}
          </span>
        ))}
      </div>
      <div className="chips body">
        {bodyChips(hud.body).map((c) => (
          <span key={c.title} className={`chip alert-${c.alert ?? 0}`} title={c.title}>
            <span aria-hidden="true">{c.icon}</span>
            {c.text}
          </span>
        ))}
      </div>
    </header>
  );
}
