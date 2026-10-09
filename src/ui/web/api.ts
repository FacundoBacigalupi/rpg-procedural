// El contrato JSON entre el servidor local y el cliente: solo tipos, sin imports.

export interface Panels {
  readonly now: string;
  readonly character: string;
  readonly inventory: string;
  /** El libro de deudas y promesas. */
  readonly book: string;
  readonly journal: string;
  /** Lo que se nota del lugar, por canal. */
  readonly environment: string;
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
  /** Lo último que se narró: al reabrir la página la charla sigue por acá. */
  readonly history: History;
}

export interface SayResponse extends Panels {
  readonly text: string;
  readonly end: "quit" | "dead" | null;
}
