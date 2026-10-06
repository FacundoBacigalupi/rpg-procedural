# Lenguas y escritura

> Principio: **las lenguas del mundo se generan de verdad y cambian con la historia.** Cada palabra tiene una forma, un significado y una historia: de qué raíz salió, qué cambios fonéticos sufrió, de qué lengua se prestó y cuándo. Los nombres de personas y lugares salen de ese léxico y significan algo, aunque nadie recuerde qué. El LLM nunca inventa una palabra: cita las del léxico o las traduce.

> Estado: **borrador** (2026-10-06).

Depende de: [living-world.md](living-world.md) §3 (la geografía hace a las culturas y sus lenguas), [deep-history.md](deep-history.md) §5 (topónimos en capas, etimologías populares), [culture.md](culture.md) (comunidades, contacto, identidad), [skills.md](skills.md) (las lenguas y escrituras como habilidades con facetas), [perception.md](perception.md) §7 (la voz y el acento como firma), [information.md](information.md) §6 (alfabetización, autenticidad, cifrados), [npc-psychology.md](npc-psychology.md) §10 (períodos sensibles), [simulation.md](simulation.md) (LOD y modo agregado), [technology.md](technology.md) (soportes de escritura, imprenta).
Lo usan: [dialogue.md](dialogue.md) §3, §13 (entender, intérpretes, malentendidos), [narration.md](narration.md) §4, §9 (léxico generado, validador con lista blanca), [deep-history.md](deep-history.md) §5 (topónimos, reconstrucción), [settlements.md](settlements.md) (nombres en capas), [organizations.md](organizations.md) (nombres de sectas y cargos), [family-lineage.md](family-lineage.md) (apellidos, nombres de generación), [social-structure.md](social-structure.md) (registros, tratamientos), [state.md](state.md) (lengua de la administración, exámenes), [law.md](law.md) (lengua del tribunal), [economy.md](economy.md) (lenguas francas en los mercados), [travel.md](travel.md) (orientarse entre lenguas), [discovery.md](discovery.md) (descifrar, nombrar lo nuevo), [chronicle.md](chronicle.md) (crónicas en lenguas que cambian), [religion.md](religion.md) (lenguas sagradas).

---

## Principios

- **Generadas, no decoradas.** Una lengua es un objeto del mundo con fonología, léxico, morfología e historia. No es un generador de nombres "que suenan" a algo: cada nombre se arma con raíces que significan algo en esa lengua.
- **Cambian con reglas.** Los sonidos cambian de forma regular a lo largo de los siglos. Por eso las lenguas hermanas se parecen de forma sistemática y un erudito puede reconstruir la forma vieja de una palabra.
- **Todo tiene historia.** Cada palabra registra de dónde salió (raíz heredada, compuesto, préstamo, invento, calco) y el evento que la trajo (`originEventId`). Un préstamo es evidencia de contacto.
- **Hablar es una habilidad.** Entender, hablar, acento, leer y escribir son facetas de una habilidad del modelo de [skills.md](skills.md). Este doc define qué se aprende; skills define cómo.
- **La lengua es la puerta de la información.** Lo que no se entiende no entra como proposición (dialogue §3). Quien no lee depende de quien le lee.
- **El LLM solo cita.** Todas las formas que el narrador puede usar están en el léxico generado y en la vista del jugador. El validador las tiene en la lista blanca (narration §9).
- **El jugador tiene la misma libertad que cualquiera:** aprender cualquier lengua, hablar mal, fingir un acento, inventar un nombre o una palabra. Lo que inventa entra al léxico por la sim, no por el LLM (§13).

---

## 1. El modelo

```ts
interface Language {
  id: LanguageId;
  parent?: LanguageId;                       // la lengua de la que desciende (undefined: protolengua)
  splitEvent?: EventId;                      // separación, migración, conquista que la hizo distinta
  communities: CommunityId[];                // quiénes la hablan hoy (culture §1)
  phonology: Phonology;                      // §2
  morphology: Morphology;                    // §3
  lexicon: LexemeId[];                       // §3
  soundChangeHistory: SoundChangeId[];       // en orden, desde el padre (§4)
  dialects: DialectId[];                     // §5
  registers: RegisterId[];                   // §7
  scripts: ScriptId[];                       // escrituras que la escriben (§10)
  status: 'living' | 'liturgical' | 'learned' | 'dead';   // §11
  prestige: Record<CommunityId, number>;     // cuánto vale hablarla, según quién (§6)
  originEventId: EventId;
}

interface Lexeme {
  id: LexemeId;
  language: LanguageId;
  form: PhonemicForm;                        // la forma en fonemas de esta lengua
  gloss: Gloss;                              // significado en el espacio de conceptos del mundo (§3)
  pos: 'noun' | 'verb' | 'adj' | 'particle' | 'name-element' | 'classifier';
  origin:
    | { kind: 'inherited'; from: LexemeId; changes: SoundChangeId[] }
    | { kind: 'compound'; parts: LexemeId[]; rule: MorphRuleId }
    | { kind: 'derived'; base: LexemeId; affix: MorphRuleId }
    | { kind: 'loan'; from: LexemeId; via?: LanguageId; contact: EventId }
    | { kind: 'calque'; model: LexemeId; parts: LexemeId[] }   // traducción pieza por pieza de una palabra ajena
    | { kind: 'coined'; by: AgentId | OrgId; event: EventId }  // §13
    | { kind: 'root' };                                        // raíz de una protolengua
  semanticShift?: Array<{ from: Gloss; to: Gloss; when: Tick; cause?: EventId }>;
  taboo?: TabooId;                           // §7
  frequency: number;                         // las palabras frecuentes cambian distinto y se prestan menos
  firstAttested: Tick;
  lastUsed?: Tick;                           // si ya nadie la dice, queda solo en textos y topónimos
}
```

- **`Gloss` es un concepto, no una palabra en español.** El mundo tiene un espacio de conceptos (agua, claro, montaña, maestro, espada, tribulación, la bestia X, la secta Y). Cada lengua cubre ese espacio a su manera: una puede tener una sola palabra para "azul" y "verde", otra tres para "nieve". La traducción al español del narrador sale de una tabla de glosas, no del LLM.
- **Las lenguas no cubren todo.** Si un pueblo nunca vio el mar, no tiene palabra para "ola": la presta, la compone ("agua que camina") o la describe. Eso es una pista para el jugador y para el arqueólogo.

## 2. Fonología

```ts
interface Phonology {
  consonants: Phoneme[];                     // inventario con rasgos (lugar, modo, sonoridad, aspiración)
  vowels: Phoneme[];
  tones?: Tone[];                            // lenguas tonales: el tono distingue palabras
  syllable: SyllableTemplate;                // (C)(C)V(C), CV, CVN…
  phonotactics: Constraint[];                // qué grupos se permiten, qué no puede ir al final
  stress?: 'initial' | 'final' | 'penultimate' | 'lexical';
  romanization: RomanizationTable;           // cómo se escribe en el alfabeto del jugador (§14)
}
```

- **Inventarios con forma realista:** se eligen desde una tipología (inventarios frecuentes con mayor probabilidad, sistemas de vocales simétricos, rasgos que van juntos), con `rng.fork('lang', languageId, 'phonology')`. No salen sonidos al azar uno por uno.
- **Familias de mundo:** el contenido de cada familia (xianxia, etc.) sesga la tipología para que la región principal suene a lo que el mundo imita (sílabas cerradas en nasal y tonos para un mundo de corte chino), sin forzarlo en los pueblos lejanos.
- **La romanización es parte del contenido:** cada lengua tiene una tabla fija de cómo se escribe cada fonema con letras del jugador. Es estable: un nombre se escribe siempre igual.

## 3. Léxico y morfología

```ts
interface Morphology {
  type: 'isolating' | 'agglutinative' | 'fusional';   // tendencia, no absoluta
  wordOrder: 'SOV' | 'SVO' | 'VSO' | 'VOS' | 'OVS' | 'OSV';
  compounding: { headFirst: boolean; linker?: PhonemicForm };
  affixes: MorphRule[];                      // plural, diminutivo, agente ("el que hace X"), lugar ("donde hay X"), abstracto
  classifiers?: LexemeId[];                  // contadores ("tres CABEZA de ganado")
  honorifics?: MorphRule[];                  // §7
  nameRules: NameRule[];                     // §8, §9
}
```

- **Raíces de la protolengua:** una lista básica de conceptos (cuerpo, naturaleza, parentesco, números, verbos básicos) se genera para cada protolengua desde `content/language/concepts`. El resto del léxico se arma con compuestos y derivados, como en una lengua real.
- **Compuestos con significado:** "qing" (claro) + "shui" (agua) = "Qingshui", con la regla de compuesto de esa lengua. Las palabras nuevas que necesita la sim (una técnica, una secta, una planta recién descubierta) se forman igual (§13).
- **Cambio de significado:** las palabras se corren con el uso (la palabra para "señor" termina en "usted"; la de "bestia" se vuelve un insulto). Se registran con causa cuando la hay: una conquista vuelve despectiva la palabra del vencido.
- **La gramática se simula en forma gruesa** (aprobado 2026-10-06). Orden de palabras, clasificadores y honoríficos alcanzan para la morfología de los nombres, para el sabor de las frases citadas y para los errores de quien la habla mal. No se generan textos completos en la lengua: solo nombres, palabras sueltas y frases cortas citadas. El contenido de lo que se dice es estructurado (dialogue §2) y el narrador lo da en español.

## 4. Cambio fonético y lenguas hermanas

```ts
interface SoundChange {
  id: SoundChangeId;
  language: LanguageId;                      // la rama donde ocurre
  rule: { target: PhonemeClass; becomes: PhonemeClass | null; env: Environment };  // "k > h antes de vocal anterior"
  century: number;                           // cuándo se completa
  spreadFrom?: CommunityId;                  // innovación que nace en un lugar y se expande
  exceptions: LexemeId[];                    // préstamos tardíos, palabras tabú, frecuentes
  cause?: EventId;                           // contacto, sustrato de un pueblo conquistado
}
```

- **Regulares:** un cambio afecta a todas las palabras que cumplen la condición. Eso hace que las correspondencias entre hermanas sean sistemáticas (la *k* de una es la *h* de la otra) y que el método comparativo funcione (§12).
- **Catálogo de cambios plausibles** en `content/language/sound-changes` (lenición, palatalización, pérdida de finales, tonogénesis, fusión de vocales, metátesis). La sim elige entre los que la fonología actual permite, con un ritmo calibrado por siglo. No es una tabla de sorpresas: el azar solo elige entre los cambios posibles.
- **La separación hace las ramas:** cuando una comunidad pierde contacto con el resto (montañas, mares, migración, frontera política; living-world §3, culture §6), su lengua sigue su propio camino desde ese evento. Con siglos, dialectos; con milenios, lenguas distintas que no se entienden.
- **Sustrato:** cuando un pueblo adopta la lengua de otro (conquista, asimilación), se lleva sus sonidos y palabras. La nueva lengua sale con acento y préstamos del sustrato, y eso queda como pista.
- **Excepciones con causa:** los préstamos que llegan después de un cambio no lo sufren; las palabras tabú se deforman a propósito; las muy frecuentes se gastan más rápido. Las excepciones también son evidencia.

## 5. Dialectos y continuos

- **Un dialecto es una lengua que todavía no se separó.** Cada comunidad tiene su variante. Las vecinas se entienden bien; las de los extremos, mal. Entre dos lenguas puede no haber frontera, sino una cadena de pueblos que se entienden con los de al lado.
- **La inteligibilidad se calcula** desde la distancia real (cuántos cambios y cuánto léxico distinto separan las dos variantes), no se declara. Dos dialectos con nombres políticos distintos pueden entenderse mejor que dos que el estado llama "la misma lengua".
- **El acento delata el origen** (dialogue §13, perception §7): quien tiene oído para eso reconoce de qué valle, de qué clase o de qué secta es el que habla. Sirve para identificar y para prejuzgar (culture §8).
- **Lengua estándar:** un estado o una corte puede elegir un dialecto como norma (la lengua de la capital, la de los exámenes). Los que lo hablan ganan estatus; los demás aprenden a cambiar de registro o quedan afuera (state, social-structure).

## 6. Contacto: préstamos, lenguas francas, pidgins y criollas

- **Préstamos con vector:** las palabras viajan con las cosas y la gente. Un préstamo registra el contacto que lo trajo (comercio, conquista, una secta que enseña, una especie que llegó por un puerto; living-world §10). Se adapta a la fonología de quien lo toma ("Qingshui" en una lengua sin *q* ni tonos se vuelve "Kinsui").
- **Qué se presta:** lo nuevo (objetos, técnicas, plantas), lo prestigioso (palabras de la corte, de la secta, de la escritura sagrada) y lo que hace falta para comerciar. Lo básico (cuerpo, números chicos, parentesco) se presta poco: si se presta, hubo un contacto muy fuerte.
- **Prestigio:** cada lengua vale distinto para cada comunidad (`Language.prestige`). La gente adopta palabras y hasta la lengua entera de quien tiene poder, riqueza o santidad. Una lengua sin prestigio pierde hablantes (§11).
- **Lenguas francas:** en puertos, mercados y caminos largos una lengua sirve de puente para gente que no comparte la propia. Puede ser la de un imperio, la de los comerciantes o la de una secta grande. Aprenderla abre rutas y mercados (economy, travel).
- **Pidgins:** cuando grupos sin lengua común tienen que tratar seguido (un puerto, una plantación, un campamento de mineros), surge una lengua reducida con léxico de la dominante y gramática mínima. La sim la crea como una `Language` nueva con `origin` en ese contacto.
- **Criollas:** si los hijos crecen hablando el pidgin, se vuelve lengua materna y se completa en una generación (período sensible, npc-psychology §10).
- **Bilingüismo y cambio de lengua:** la gente que vive entre dos lenguas cambia de una a otra según con quién habla y de qué. En pocas generaciones una comunidad puede pasarse entera a la lengua de prestigio. Los abuelos la hablan, los padres la entienden y los nietos no.

## 7. Registros, tratamientos y tabúes

- **Registros:** la misma lengua tiene formas distintas para la corte, el templo, la secta, el mercado y la casa. Hablar en el registro equivocado es una falta de etiqueta (dialogue §10, social-structure).
- **Tratamientos y honoríficos:** cómo se nombra a un superior, a un anciano o a un maestro (formas de "usted", títulos, autodesprecio cortés). Son contenido de la cultura con forma en la lengua.
- **Jergas:** sectas, gremios, ladrones y soldados tienen vocabulario propio. Es marca de pertenencia y a veces un código: quien no la conoce no entiende y queda marcado como de afuera. La jerga de los bajos fondos sirve para hablar delante de la guardia.
- **Tabúes de palabra:** el nombre de un muerto, de un emperador (避讳), de una bestia temida o de un dios no se dice. Se reemplaza por un rodeo ("el de la montaña") que con el tiempo se vuelve la palabra normal, y la vieja se pierde. Decir la palabra prohibida tiene consecuencias sociales y, si la ley del mundo lo permite, metafísicas (heaven-karma, spirits).
- **Nombres verdaderos y palabras prohibidas con poder** (aprobado 2026-10-06): solo si la ley del mundo lo dice (metaphysics). Es una regla de la ley, no de la lengua; la lengua solo da la forma. En la familia xianxia el poder es acotado: un nombre puede servir como parte de una firma del alma, de un juramento (contracts) o de un talismán dirigido a alguien (crafts), pero saber el nombre de alguien no da poder para dominarlo.

## 8. Nombres de personas

```ts
interface PersonName {
  holder: AgentId;
  parts: Array<{
    kind: 'family' | 'generation' | 'given' | 'courtesy' | 'art' | 'dharma' | 'milk' | 'title' | 'epithet' | 'alias';
    lexemes: LexemeId[];                     // de qué raíces está hecho
    form: string;                            // romanizado
    meaning: Gloss[];
    givenBy: AgentId | OrgId;
    event: EventId;                          // nacimiento, mayoría de edad, ingreso a una secta, una hazaña
    usedBy: 'all' | 'family' | 'intimates' | 'superiors' | 'sect' | 'self';
  }>;
}
```

- **Los nombres se eligen, no se sortean:** quien nombra elige entre significados que valen en su cultura (virtudes, deseos para el chico, la estación, un ancestro, un augurio) y la lengua da la forma. Un padre que quería un hijo fuerte le pone un nombre que significa "roca"; un nombre feo puede ser a propósito para espantar a los malos espíritus (culture).
- **Partes por cultura** (`NameRule`): apellido de clan, nombre de generación compartido entre primos (family-lineage), nombre de leche de la infancia, nombre de cortesía al llegar a adulto, nombre de arte, nombre de dharma al entrar a un templo, nombre de secta, títulos y apodos que ganan los hechos ("la Espada Solitaria").
- **Quién usa qué nombre** es etiqueta: llamar a alguien por su nombre de leche en público es intimidad o insulto. El narrador usa el nombre que el personaje conoce y el que le corresponde usar (narration §3).
- **Apodos y epítetos salen de la reputación** (information §9): se forman con el léxico desde lo que la gente cree que hizo, no desde lo que hizo. Un epíteto puede ser falso.
- **Nombres falsos:** cualquiera puede presentarse con otro nombre. Un nombre de una lengua que no corresponde a su acento es una pista para quien sabe escuchar.

## 9. Nombres de lugares, cosas y organizaciones

- **Topónimos en capas** según [deep-history.md](deep-history.md) §5 (`PlaceName`): cada pueblo nombra con su léxico lo que ve o lo que pasó; los que vienen después heredan la forma, deformada por sus cambios fonéticos, agregan nombres redundantes e inventan etimologías populares.
- **Las organizaciones se nombran a sí mismas** con su registro de prestigio (secta del Loto Azul, Pabellón de las Nueve Nubes), y la gente les pone otros nombres (los "de la colina", los "comehierbas"). Los dos son `LexemeRef` (organizations).
- **Plantas, bestias, minerales y técnicas** tienen nombre local, nombre culto y nombres de otras lenguas. Uno mismo puede no saber que dos nombres son la misma hierba (information: creencias sobre identidad). Las especies importadas llegan con el nombre de su origen (living-world §10).
- **Exónimos:** cada pueblo llama a los demás a su manera, a veces con un nombre despectivo o con el de la primera tribu que conoció de ellos (culture §1, `names.exonyms`).

## 10. Escrituras

```ts
interface Script {
  id: ScriptId;
  kind: 'pictographic' | 'logographic' | 'logosyllabic' | 'syllabic' | 'abugida' | 'abjad' | 'alphabetic' | 'knotted' | 'tally';
  languages: LanguageId[];                   // qué lenguas escribe (y qué tan bien le quedan)
  signs: SignId[];                           // inventario, cada signo con forma, valor y origen
  origin:
    | { kind: 'invented'; by: AgentId | CommunityId; event: EventId; need: 'accounts' | 'ritual' | 'law' | 'divination' | 'memory' }
    | { kind: 'adapted'; from: ScriptId; event: EventId }     // una escritura ajena para otra lengua
    | { kind: 'evolved'; from: ScriptId };                     // la misma, cambiada por siglos de copia
  media: MaterialId[];                       // hueso, bronce, bambú, seda, papel, piedra, jade de memoria
  direction: 'ltr' | 'rtl' | 'ttb' | 'boustrophedon';
  styles: Array<{ name: LexemeRef; register: 'formal' | 'cursive' | 'seal' | 'secret' }>;
  esotericUse?: { talismans: boolean; formations: boolean };   // crafts: talismanes y formaciones con signos
  status: 'in-use' | 'restricted' | 'dead';
  originEventId: EventId;
}
```

- **Se inventan pocas veces y por una necesidad:** contar tributos, registrar adivinaciones, fijar leyes, recordar linajes (technology). La mayoría de las culturas que escriben adaptaron la escritura de otra. Muchas no escriben, y les va bien (memoria oral, cantores, cuerdas anudadas).
- **Adaptar cuesta y deja marcas:** una escritura hecha para otra lengua le queda mal (signos de sobra, sonidos sin signo). Los escribas lo resuelven con parches que después son evidencia de la adaptación.
- **Evoluciona con la copia:** los signos se simplifican, se inclinan, se unen. Un texto de hace mil años en "la misma escritura" puede ser ilegible sin estudio (§11).
- **Soportes con efecto:** lo que se escribe en piedra dura y no viaja; en papel viaja y se pierde; en jade de memoria (si el mundo lo tiene) guarda más que palabras (deep-history §2, crafts).
- **Escritura y poder:** quien controla la escritura controla los registros, los contratos y los exámenes (state, contracts). Una escritura sagrada puede estar restringida a un clero o a una secta.
- **Escrituras esotéricas:** los talismanes y las formaciones usan signos (crafts). Si los signos tienen efecto por su forma o por la intención de quien los traza lo decide la ley del mundo (metaphysics); la lengua solo dice qué escritura usan y qué significan.
- **Leer es una habilidad por escritura y lengua** (skills: `reading:<scriptId>`, information §6): conocer los signos no sirve sin la lengua, y conocer la lengua no sirve sin los signos. Alfabetización con frecuencia por cultura, clase y época.

## 11. Lenguas muertas, sagradas y desciframiento

- **Una lengua muere** cuando su último hablante muere o cuando nadie se la enseña a sus hijos. Queda en textos, inscripciones, topónimos, préstamos en otras lenguas y a veces en rezos que se repiten sin entender.
- **Lenguas litúrgicas y cultas:** una lengua muerta puede seguir viva en el templo, la corte o la secta, aprendida de libros (status `liturgical` o `learned`). Se pronuncia como cree cada escuela, y esas pronunciaciones también divergen.
- **Desciframiento** es un proyecto de discovery: juntar textos, buscar bilingües, contar signos para saber si es alfabeto o logografía, comparar con lenguas hijas vivas, probar hipótesis. Cada lectura es una hipótesis con evidencia y puede estar mal, con consecuencias (un manual de cultivo mal leído; discovery, cultivation).
- **Reconstrucción comparativa:** quien conoce dos o más hermanas puede reconstruir la forma de la madre aplicando al revés las correspondencias regulares (§4). Así se lee un topónimo viejo o se entiende un texto de una lengua que nadie habla (deep-history §5).
- **Textos de cultivadores viejos:** buena parte del conocimiento valioso de un mundo xianxia está en lenguas y escrituras muertas (manuales, inscripciones de reinos secretos). Leerlos es poder, y leerlos mal es peligro.

## 12. Aprender y usar una lengua

- **Facetas** (skills §1, §2): entender, hablar, acento, leer y escribir, cada una con su nivel. Se puede entender mucho y hablar poco; leer una lengua muerta y no saber cómo sonaba.
- **Lengua materna:** se aprende en el período sensible de la infancia (npc-psychology §10) con acento nativo. Una lengua aprendida de adulto casi nunca pierde el acento.
- **Cómo se aprende:** inmersión (lo más rápido: vivir entre hablantes), maestro, libros con glosas, comercio de todos los días. La transferencia entre lenguas hermanas es alta (skills §8): quien habla una entiende algo de la otra desde el primer día, y confunde las palabras parecidas que significan otra cosa (falsos amigos).
- **Errores con forma:** quien habla mal se equivoca de registro, usa un tratamiento que ofende, elige la palabra prestada que en esta lengua es grosera, no distingue tonos. Los errores salen de la distancia entre lo que sabe y la lengua real, no de una tirada abstracta.
- **Entender con pérdidas** (dialogue §3): con poca habilidad se entienden palabras sueltas y se pierden las proposiciones complejas, los matices de cortesía y las ironías. El narrador cuenta lo que se entendió.
- **Intérpretes** (dialogue §13): el mensaje pasa por otra cabeza con su habilidad y su utilidad. Puede suavizar, traducir mal o mentir. El intérprete es un puesto con poder en cortes, mercados y fronteras.
- **Fingir y esconder:** se puede hablar con el acento de otro si se entrenó esa faceta, o hacerse el que no entiende para escuchar. Un error en un tono o una palabra local delata.
- **Oxidación:** una lengua que no se usa se oxida (skills §7). La materna resiste más; la aprendida tarde se pierde rápido.

## 13. El jugador y el narrador

- **El jugador escribe en español y el personaje habla su lengua.** El parser traduce la intención a contenido estructurado (dialogue §14). Si el personaje no sabe la lengua del otro, lo que dice sale con sus errores o como gestos; el jugador no puede hacerle decir algo que el personaje no sabe decir.
- **Lo que el personaje no entiende se narra como sonido** o con las palabras sueltas que sí entendió (narration §4), sin subtítulos (aprobado 2026-10-06). Una palabra extranjera que el personaje repite sin entender aparece citada, romanizada, sin glosa. Con la exposición, el personaje aprende palabras sueltas y empieza a adivinar su significado (§12), y las glosas que cree pueden estar mal.
- **Citar o traducir:** el pedido de narración trae cada nombre y término con su forma romanizada y su glosa en español, y la regla de cuándo usar cada una (los nombres propios se citan; las palabras comunes que el personaje entiende se traducen; las palabras de una cultura ajena que el personaje conoce sin traducción se citan). El narrador no inventa formas ni glosas.
- **Validador:** todas las formas del léxico generado que el personaje conoce están en la lista blanca (narration §9). Una forma generada que el personaje no conoce es una fuga de información y el validador la rechaza.
- **Libertad total:** el jugador puede aprender cualquier lengua que exista en el mundo, buscar un maestro, ir a vivir entre hablantes, estudiar una inscripción, inventar una escritura (con la habilidad y el tiempo que eso lleva), ponerle nombre a su hijo, a su espada o a un lugar que descubrió, o inventarse un apodo. **Cómo nombra** (aprobado 2026-10-06): el jugador escribe el nombre tal cual y la sim lo adapta a cómo lo pronuncia el personaje, o pide un significado ("ponele 'roca' en mi lengua") y la sim lo forma con las raíces de la lengua del personaje. Los dos entran como `coined`. Si el nombre se usa, se difunde por las mismas reglas que cualquier palabra; si no, muere con él.
- **Sin glosario del mundo:** el jugador ve las palabras que su personaje conoce y lo que cree que significan. Un comando fuera del personaje muestra ese vocabulario con las glosas creídas, sin corregirlas.

## 14. Generación

1. **Protolenguas** con los pueblos de la historia profunda (deep-history, living-world §3): fonología, raíces básicas y morfología con `rng.fork('lang', protoId)`.
2. **Ramas** en cada separación de comunidades: se aplican cambios fonéticos por siglo, cambios de significado y pérdida de palabras.
3. **Contacto** en cada evento de comercio, conquista o convivencia: préstamos con vector, sustratos, lenguas francas, pidgins.
4. **Nombres** cuando la historia los necesita: fundaciones, conquistas, personas que importan, sectas. Cada topónimo arrastra su cadena de derivación.
5. **Escrituras** donde la historia produce la necesidad y los soportes (technology), con su difusión y adaptación.
6. **Embudo de legados** (deep-history): de las épocas viejas solo se guarda lo que sobrevive (lenguas hijas, topónimos, préstamos, inscripciones). El resto se olvida y no ocupa memoria.

La generación es determinista: mismo seed y misma historia, mismas lenguas. Todo nombre se puede rastrear hasta sus raíces.

## 15. Escala (LOD)

| Resolución | Qué se simula |
|---|---|
| Escena | Entender frase a frase, errores de registro, acento percibido, intérprete con su utilidad |
| Local | Quién habla qué en la aldea, bilingüismo, jergas, nombres que se ponen y se usan |
| Regional | Dialectos de la región, lengua franca del mercado, préstamos por contacto, prestigio |
| Mundo | Lenguas por comunidad con su prestigio; cambio de lengua por generaciones |
| Historia | Protolenguas, ramas, cambios fonéticos por siglo, escrituras inventadas y adaptadas, lenguas que mueren |

- Los cambios fonéticos se aplican por siglo, en modo agregado, sobre el léxico guardado; no por tick.
- **Léxico perezoso:** cada lengua guarda sus raíces, sus reglas y las palabras que ya se usaron. Una palabra nueva (un compuesto, un derivado) se genera la primera vez que hace falta, con una clave determinista (`rng.fork('lexeme', languageId, gloss)`), y queda fijada.

## 16. Implementación por fase

- **Fase 1:** una sola lengua de la aldea desde `content/` con léxico mínimo, romanización y nombres de personas con significado; la habilidad de lengua con sus facetas; el léxico generado en la lista blanca del validador.
- **Fase 2:** registros, tratamientos y tabúes de palabra en el diálogo; acento como firma; errores de quien habla mal.
- **Fase 5 (worldgen mínimo, aprobado 2026-10-06):** protolengua de la región inicial con una o dos hijas por cambio fonético, dialectos de la región, topónimos con derivación y etimologías populares; lengua franca del mercado; intérpretes; leer y escribir con una escritura.
- **Fase 7:** familias completas en la historia profunda, préstamos con vector, sustratos, pidgins y criollas, escrituras inventadas y adaptadas, lenguas muertas y litúrgicas, desciframiento y reconstrucción comparativa. Sin cambiar el formato de la Fase 5.
- **Fase 8:** todas las lenguas del mundo con LOD, lenguas estándar de los estados, cambio de lengua por prestigio a escala mundial.

## Tests

- **Determinismo:** mismo seed, mismas lenguas, mismo léxico y mismos nombres; las palabras perezosas dan la misma forma sin importar en qué orden se pidieron.
- **Regularidad:** un cambio fonético afecta a todas las palabras que cumplen su condición, salvo las excepciones registradas con causa.
- **Reconstrucción:** aplicar al revés las correspondencias de dos hermanas recupera la forma de la madre en un porcentaje alto de la lista básica.
- **Trazabilidad:** todo `Lexeme`, `PersonName`, `PlaceName` y `Script` tiene origen y evento; todo préstamo apunta a un contacto real.
- **Fonotáctica:** ninguna forma generada (incluidos préstamos adaptados) viola las restricciones de su lengua.
- **Inteligibilidad:** la inteligibilidad entre variantes sube con el contacto y baja con el tiempo de separación.
- **Sin palabras del LLM:** con un LLM falso que inventa nombres, el validador rechaza toda forma que no esté en el léxico conocido por el personaje.
- **Sin fuga:** un personaje que no conoce una palabra no la recibe en su `PlayerView`.

## Decisiones (aprobado 2026-10-06)
- **Sin textos completos en lenguas del mundo:** solo nombres, palabras sueltas y frases cortas citadas; el contenido se narra en español (§3).
- **Lo que no se entiende se narra como sonido,** con las palabras reconocidas citadas y aprendizaje por exposición; sin subtítulos (§13).
- **El jugador nombra escribiendo el nombre o pidiendo un significado;** los dos entran como `coined` y se difunden solo si se usan (§13).
- **Nombres verdaderos según la ley del mundo;** en xianxia, acotados a firmas del alma, juramentos y talismanes, sin dominación por saber un nombre (§7).

## Decisiones tomadas en este borrador (revisables)

- **Gramática gruesa:** orden de palabras, morfología de nombres, clasificadores y honoríficos; no se generan textos completos en lengua del mundo (§3).
- **Cambio fonético por siglo** en modo agregado con un catálogo de cambios plausibles (§4).
- **Léxico perezoso** con claves deterministas (§15).
- **Romanización fija por lengua** (§2).
- **Lo que el jugador nombra** se adapta a la fonología del personaje y entra como `coined` (§13).

## Preguntas abiertas

- Calibración: cambios fonéticos por siglo; cuántos siglos de separación hasta que dos variantes no se entienden; cuántas raíces por protolengua; frecuencia de préstamos según la intensidad del contacto; generaciones hasta que una comunidad cambia de lengua.
