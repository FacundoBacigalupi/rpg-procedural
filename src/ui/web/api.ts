// El contrato JSON entre el servidor local y el cliente: solo tipos, sin imports.

/** La barra de arriba y el ambiente de la pantalla (`hudPanel`): bandas, sin números de la verdad. */
/** Un edificio a la vista (de `game/life/hud.ts`). */
export interface SeenBuilding {
  readonly type: string;
  readonly wall: string;
  readonly roof: string;
  readonly worn: 0 | 1 | 2;
  readonly ruin: boolean;
  readonly burning: boolean;
  readonly x: number;
  readonly d: number;
}

export interface Hud {
  readonly hour: number;
  readonly phase: "night" | "dawn" | "day" | "dusk";
  readonly light: "dark" | "dim" | "bright";
  readonly sky: "clear" | "cloudy" | "overcast" | "rain" | "snow" | "unknown";
  readonly windy: boolean;
  readonly air: "bitter" | "cold" | "cool" | "mild" | "warm" | "hot";
  readonly season: "spring" | "summer" | "autumn" | "winter";
  readonly place: {
    readonly indoor: boolean;
    readonly home: boolean;
    readonly space: string;
    readonly kinds: readonly string[];
    /** Sin definir: la vida no simula fuegos. */
    readonly fire?: boolean;
    /** Sin definir: la vida no tiene edificios (aldea de respaldo). */
    readonly buildings?: readonly SeenBuilding[];
    readonly building?: Omit<SeenBuilding, "x" | "d">;
  };
  readonly people: {
    readonly around: number;
    readonly known: number;
    readonly more: boolean;
    readonly figures: readonly {
      readonly age?: "child" | "youth" | "adult" | "elder";
      readonly sex?: "female" | "male";
      readonly attire?: string;
      readonly known: boolean;
    }[];
  };
  readonly body: {
    readonly hunger: 0 | 1 | 2 | 3;
    readonly thirst: 0 | 1 | 2 | 3;
    readonly fatigue: 0 | 1 | 2 | 3;
    readonly sleepy: boolean;
    readonly pain: boolean;
    readonly bleeding: 0 | 1 | 2 | 3;
    readonly fever: boolean;
    readonly hurt: boolean;
  };
  readonly coins: number;
  readonly mood: {
    readonly feeling:
      | "fear"
      | "anger"
      | "sadness"
      | "joy"
      | "shame"
      | "guilt"
      | "envy"
      | "love"
      | null;
    readonly strength: 0 | 1 | 2;
    readonly burden: {
      readonly kind: "trauma" | "guilt" | "grief" | "depression" | "addiction";
      readonly weight: "light" | "heavy" | "crushing";
    } | null;
  };
  readonly warmth: "freezing" | "cold" | "normal" | "hot" | "burning";
  readonly moon: {
    readonly phase:
      | "new"
      | "waxing_crescent"
      | "first_quarter"
      | "waxing_gibbous"
      | "full"
      | "waning_gibbous"
      | "last_quarter"
      | "waning_crescent";
    readonly high: boolean;
  } | null;
  readonly stars: "none" | "few" | "many";
  readonly danger: { readonly level: 0 | 1 | 2 | 3; readonly from: number };
  readonly load: 0 | 1 | 2 | 3;
}

export interface Panels {
  readonly now: string;
  readonly hud: Hud;
  readonly character: string;
  readonly inventory: string;
  /** El libro de deudas y promesas. */
  readonly book: string;
  /** La gente que conoce y lo que cree de cada una. */
  readonly people: string;
  /** Lo que piensa de cómo anda el mundo (el diario de hipótesis). */
  readonly hypotheses: string;
  /** Lo que siente del cielo y lo que cree que viene (creencia, sin datos del mundo). */
  readonly weather: string;
  /** Lo último que hacía y lo último que recuerda. */
  readonly recap: string;
  readonly journal: string;
  /** Lo que se nota del lugar, por canal. */
  readonly environment: string;
  /** La pista de frases y lo que se completa al escribir (`play-hint-verbs`). */
  readonly hint: { readonly line: string; readonly complete: readonly string[] };
  /** Las opciones sugeridas; `choose` manda el `id`. */
  readonly options: readonly {
    readonly id: string;
    readonly label: string;
    /** Tono (`SuggestionTone`), clave de ícono y etiqueta accesible: viajan aparte de la etiqueta. */
    readonly tone: string;
    readonly icon: string;
    readonly toneLabel: string;
    /** Las graves piden un segundo toque. */
    readonly confirm: boolean;
  }[];
}

/** Una entrada de la narración guardada: `seq` ordena y sirve para pedir las anteriores. */
export interface HistoryEntry {
  readonly seq: number;
  readonly when: string;
  readonly text: string;
}

/** Una página de la narración, en orden; `more`: hay entradas más viejas. */
export interface History {
  readonly entries: readonly HistoryEntry[];
  readonly more: boolean;
}

export interface WebState extends Panels {
  readonly opening: string;
  /** Las personas presentes que nombra la apertura: la web las pinta y deja hablarles. */
  readonly openingPeople: readonly string[];
  /** Lo último que se narró: al reabrir la página la charla sigue por acá. */
  readonly history: History;
}

export interface SayResponse extends Panels {
  readonly text: string;
  readonly end: "quit" | "dead" | null;
  /** Cómo nombra el texto a las personas que tiene delante. */
  readonly present: readonly string[];
}

/** Qué se puede elegir al empezar una vida (`GET /api/setup`); `started`: ya hay vida. */
export interface SetupInfo {
  readonly families: readonly string[];
  readonly modes: readonly ("realista" | "novela")[];
  readonly sexes: readonly string[];
  readonly familias: readonly string[];
  /** Lo que vino por argumentos, para dejarlo elegido. */
  readonly defaults: {
    readonly world: string;
    readonly mode: "realista" | "novela";
    readonly seed?: number;
  };
  readonly started?: boolean;
}

/** La elección de la pantalla de inicio (`POST /api/setup`); sin `seed`, uno al azar. */
export interface SetupChoice {
  readonly world: string;
  readonly mode: "realista" | "novela";
  readonly seed?: number;
  readonly sex?: "mujer" | "hombre";
  readonly familia?: "terrateniente" | "campesina" | "sirviente";
  readonly age?: number;
}
