# Contratos y juramentos

> Estado: **borrador de diseño**. Un solo modelo para todo lo que alguien le debe a otro: deudas de plata, favores, matrimonios, maestro–discípulo, hermandades juradas, alianzas y tratados, encargos, pactos con espíritus y patrones, deudas de vida y de sangre. Un **compromiso** es un hecho del mundo (alguien se obligó, o una norma lo obliga, por un evento concreto) que cada uno **cree** de forma distinta, y que se cumple solo si algo lo hace cumplir: la conciencia, la reputación, el acreedor, una organización, un tribunal, el Cielo o una atadura en el alma.

Depende de: [causality.md](causality.md) (procedencia, presiones, conservación), [information.md](information.md) (creencias, testigos, documentos como medios, reputación por comunidad, secretos), [npc-psychology.md](npc-psychology.md) (relaciones, valores y disonancia, cara, utilidad, teoría de la mente, demonios internos), [heaven-karma.md](heaven-karma.md) (el libro del Cielo, `KarmicBond`, retribución), [economy.md](economy.md) (préstamos, letras, colateral, empeño, cadenas de deuda, garantías), [organizations.md](organizations.md) (representación, obligaciones de membresía, maestro y discípulo, tratados, normas y penas), [perception.md](perception.md) (ver una firma, detectar una falsificación, notar un incumplimiento), [metaphysics.md](metaphysics.md) (qué ataduras existen en cada familia de mundo), [cultivation.md](cultivation.md) (sellos en el alma, juramentos sobre el corazón del Dao), [spirits.md](spirits.md) (pactos con espíritus, almas atadas), [crafts.md](crafts.md) (encargos, talismanes de contrato). Lo usan: [economy.md](economy.md) (`Loan` es una vista de un compromiso), [organizations.md](organizations.md) (obligaciones de membresía, tratados), [schemes.md](schemes.md) (promesas falsas, chantaje, contratos trampa), [living-world.md](living-world.md) (contratos con bestias), [family-lineage.md](family-lineage.md) (matrimonios, esponsales, adopción, herencia de deudas), [social-structure.md](social-structure.md) (servidumbre por deudas, esclavitud, capacidad por estatus), y los futuros ley (tribunales, prueba, fraude), estado (vasallaje, impuestos como obligación), guerra (treguas, rescates, rehenes), adivinación (leer juramentos y deudas) y crónica (promesas que se recuerdan).

## Principios
1. **Un compromiso es un hecho con origen.** Existe porque pasó algo: un acuerdo con testigos, una ceremonia, un juramento, un rescate que crea una deuda de vida según la cultura, una conquista que impone un tributo. Tiene `originEventId` y partes concretas. Nadie le debe nada a nadie "porque sí".
2. **Lo acordado es verdad; lo que cada uno entiende es creencia.** Los términos que se dijeron (o escribieron) quedan en `WorldTruth`. Lo que cada parte cree que se acordó, cuánto cree que se pagó y si cree que el otro cumplió son creencias (information §1) que se deforman, se olvidan y se disputan.
3. **Nada se cumple solo.** Un compromiso no mueve bienes ni obliga a nadie por existir. Cumplir es una decisión del obligado, tomada con su utilidad: lo que cuesta cumplir contra lo que cree que le cuesta no cumplir. Lo que lo hace cumplir son **ejecutores** concretos, cada uno con lo que sabe y lo que puede.
4. **Los ejecutores leen creencias; solo la ley lee la verdad.** El acreedor, la aldea, la secta y el juez actúan sobre lo que creen que pasó. El Cielo (donde hay karma) y las ataduras metafísicas (sellos en el alma, pactos de sangre) leen la verdad, pero solo a través de su mecanismo y sin crear nada.
5. **Conservación.** Un compromiso es un derecho, no un bien: no crea valor. Cumplir mueve bienes reales de un tenedor a otro; incumplir no destruye ni crea nada (el colateral cambia de manos, el derecho pierde valor). Un crédito que se vende es un derecho que cambia de dueño.
6. **La misma estructura para todo.** Una deuda de arroz, un matrimonio, el juramento de una hermandad y un tratado entre sectas son el mismo objeto con partes, obligaciones, garantías y ejecutores distintos. Las diferencias salen del catálogo (`content/`) y de la cultura, no de código aparte.
7. **Determinista.** La decisión de cumplir usa `rng.fork("decision", agentId)`; la detección, el ruido de percepción; la retribución kármica, las herramientas del Cielo. Nada más es azar.

## 1. El modelo

```ts
interface Commitment {
  id: CommitmentId;
  kind: CommitmentKind;                  // catálogo en content/ (§11): loan, marriage, master_disciple, sworn_brotherhood, treaty, commission…
  basis: "agreement" | "norm" | "imposed";   // §2: se acordó, lo impone una norma cultural, lo impuso la fuerza o una sentencia
  parties: Party[];                      // dos o más; personas, organizaciones, espíritus, bestias, un patrón
  obligations: Obligation[];             // qué debe cada uno (en las dos direcciones; casi todo compromiso es recíproco)
  guarantees: Guarantee[];               // §5: colateral, fiadores, rehenes, prendas, depósitos
  enforcers: EnforcerRef[];              // §6: quiénes lo hacen cumplir y con qué
  form: Formality;                       // §3: palabra, testigos, escrito con sello, sangre, ante los ancestros, ante el Cielo
  records: RecordRef[];                  // documentos, tallas partidas, registros de gremio, sellos en el alma: dónde quedó constancia
  witnesses: AgentId[];
  consent: ConsentQuality[];             // por parte: informado, engañado, coaccionado, desesperado (§3)
  sincerity: Record<AgentId, number>;    // verdad oculta: cuánto pensaba cumplir cada uno al obligarse
  status: CommitmentStatus;              // §10
  term?: { start: Time; end?: Time | "death" | "condition"; renewal?: RenewalRule };
  heirs?: InheritanceRule;               // §10: si pasa a los herederos, de qué lado, según la cultura
  parent?: CommitmentId;                 // renegociación, cesión, compromiso derivado (el fiador que paga queda como acreedor)
  originEventId: EventId;                // el acuerdo, la ceremonia, el rescate, la conquista, la sentencia
  history: EventId[];                    // cumplimientos, pagos, reclamos, prórrogas, incumplimientos
}

interface Party {
  ref: AgentId | OrgId;
  role: RoleKey;                         // lender/borrower, master/disciple, spouse, vassal/suzerain, patron/client, sworn_sibling…
  signedBy?: AgentId;                    // quién se obligó en nombre de una organización o de un menor (§3, §12)
}

interface Obligation {
  id: ObligationId;
  debtor: PartyRef; creditor: PartyRef;  // quién debe a quién (el creditor puede ser un tercero: "cuidá a mi hija")
  duty: Duty;                            // qué (abajo)
  due: DueRule;                          // una fecha, cada período, a pedido, al cumplirse una condición, de por vida
  condition?: TriggerPattern;            // "si me matan", "si la secta es atacada", "si la cosecha falla"
  measure: Measure;                      // cómo se juzga que se cumplió (§4): exacto, por estándar, a criterio del acreedor
  precision: number;                     // 0 = vago ("protegerlo"), 1 = exacto ("tres taeles el día de la luna llena")
  state: ObligationState;                // pendiente, cumplida, parcial, vencida, incumplida, dispensada, imposible
  performed: EventId[];                  // los eventos que la cumplieron (o la cumplieron en parte)
}

type Duty =
  | { kind: "deliver"; goods: Array<{ good: GoodId | LotId; qty: number }> }          // plata, arroz, una píldora, una espada
  | { kind: "perform"; action: ActionPattern; qty?: number }                          // trabajar, escoltar, enseñar una técnica, refinar
  | { kind: "refrain"; action: ActionPattern }                                        // no revelar, no atacar, no competir, no casarse fuera
  | { kind: "obey"; scope: CommandScope }                                             // obedecer órdenes de cierto tipo
  | { kind: "support"; needs: NeedKey[] }                                             // mantener: comida, techo, cuidado en la vejez
  | { kind: "protect"; target: EntityRef; against?: ThreatPattern }
  | { kind: "avenge"; victim: AgentId }                                               // vengar si lo matan
  | { kind: "status"; bond: BondLabel };                                              // ser esposo, hermano jurado, vasallo: un vínculo con normas propias
```

- **Casi todo compromiso es recíproco.** El maestro enseña y protege; el discípulo obedece y sirve. El prestamista ya entregó (su obligación quedó cumplida en el acto) y el deudor debe devolver. Un tratado obliga a los dos lados. Que uno deje de cumplir le da al otro motivos (y a veces derecho, según la cultura) para dejar de cumplir.
- **`status` es una obligación compuesta.** Ser esposa, hermano jurado o vasallo trae un paquete de deberes que no se escribe: lo define la **norma cultural** del vínculo (`content/`: qué debe un esposo en esta cultura). Cada uno cree ese paquete a su manera, y ahí nacen muchos conflictos ("un buen hijo no haría eso").
- **El compromiso no es la relación.** La relación (npc-psychology §6) es lo que cada uno siente; el compromiso es lo que se debe. Pueden contradecirse: el discípulo que odia al maestro y lo sigue sirviendo, el esposo que ama y no cumple.

## 2. Bases: por qué alguien debe algo

| Base | Cómo nace | Ejemplos | Quién lo reconoce |
|---|---|---|---|
| **Acuerdo** (`agreement`) | Partes que consienten (aunque sea mal: §3) | Préstamo, venta a crédito, encargo, matrimonio arreglado, hermandad jurada, tratado, apuesta, pacto de vida o muerte (生死状) | Las partes y quien sepa del acuerdo |
| **Norma** (`norm`) | Un evento que la cultura lee como generador de deuda | Deuda de vida al que te salvó, deber filial, vengar al padre, hospitalidad debida al huésped, gratitud por una enseñanza, la deuda de sangre con la familia de la víctima | La cultura que tiene la norma; otra cultura puede no verla |
| **Imposición** (`imposed`) | La fuerza o una autoridad | Tributo de un vencido, rescate, sentencia de un tribunal o de una secta (multa, servicio), servidumbre por deudas, sello de esclavo | El que impone, y los que reconocen su autoridad |

- **Las normas son creencias culturales, no leyes del mundo.** "Quien te salva la vida es tu acreedor" está en la cultura (living-world: culturas, `content/`). Si el salvado viene de otra cultura, puede no sentir la deuda; la cultura del salvador sí la ve, y lo juzga. El Cielo tiene su propia contabilidad (§9), que no coincide con ninguna cultura.
- **Una norma genera el compromiso con un evento, como todo.** El rescate es el `originEventId`; la regla cultural que lo convierte en deuda queda en `causes`. Si nadie (ni el salvado) sabe que hubo rescate, la norma no actúa en nadie; el Cielo, si existe, lo registra igual.
- **Lo impuesto se cumple por miedo o por legitimidad.** Un tributo impuesto por una secta fuerte se paga mientras se cree que la secta es fuerte (organizations §10). Cuando la creencia cambia, deja de pagarse, aunque la secta siga siendo fuerte.

## 3. Formación

### Negociar
- **Es diálogo con actos de habla** (npc-psychology §8): proponer términos, contraofertar, pedir garantías, aceptar, rechazar. La sim elige qué ofrecer por utilidad y por lo que cree del otro (teoría de la mente); el LLM solo verbaliza. Lo que importa queda en términos estructurados (`Obligation`, `Guarantee`).
- **El poder de negociación** sale de las alternativas que cada uno cree tener (el desesperado acepta cualquier interés: economy §8), de la fuerza, del rango y de la cara en juego. El regateo de economy §6 es el caso particular de un intercambio inmediato.
- **Mentir al obligarse.** Prometer sin intención de cumplir es posible: queda en `sincerity` (verdad oculta). Es la base de muchas intrigas (schemes: el cebo, la alianza falsa). Una persona con buena lectura de la gente (perception §6: percepción social) puede sospechar.

### Consentimiento
```ts
type ConsentQuality =
  | { party: AgentId; kind: "informed" }
  | { party: AgentId; kind: "deceived"; about: Proposition[]; by: AgentId }   // firmó creyendo algo falso
  | { party: AgentId; kind: "coerced"; threat: EventId | BeliefRef }          // con un cuchillo, o con una amenaza creída
  | { party: AgentId; kind: "desperate"; pressure: PressureRef }              // hambre, una deuda anterior, un hijo enfermo
  | { party: AgentId; kind: "incapable"; why: "minor" | "drunk" | "mad" | "spell" };
```
- El consentimiento real es verdad; lo que los demás creen del consentimiento es creencia. Un tribunal (law, futuro) o la opinión de la aldea anulan o no un contrato según lo que **creen** (y según su cultura: algunas no anulan nada).
- **El Cielo pesa el consentimiento real** (§9): romper un contrato arrancado por engaño pesa mucho menos que romper uno libre; arrancar un contrato con engaño pesa en el que engañó.

### Capacidad y representación
- **Quién puede obligarse** sale de la cultura y de la estratificación social ([social-structure.md](social-structure.md) §2, `capacity`): menores, esclavos, mujeres en ciertas culturas, discípulos sin permiso del maestro. Un compromiso firmado por quien no puede es **disputable**, no nulo: vale lo que los demás estén dispuestos a reconocer.
- **Obligarse por otro:** el padre que casa a la hija, el jefe del clan que empeña la tierra común, el emisario que firma un tratado. Necesita un poder `represent` (organizations §3) o una norma (el padre sobre los hijos). Si el representante se excede, la organización puede repudiar el compromiso, con costo de cara y de confianza (§12).

### Formalidades y constancia
```ts
interface Formality {
  spoken: boolean;
  witnesses: AgentId[];                  // quién lo vio: memoria con salience y distorsión (npc-psychology §5)
  written?: DocumentRef[];               // contrato escrito: un objeto (§3, abajo)
  seal?: SealKind[];                     // sello personal, huella del pulgar, sello del clan o del gremio
  ritual?: RitualKind;                   // beber sangre mezclada, quemar papel ante los ancestros, té ante el maestro, incienso ante el Cielo
  registry?: RegistryRef;                // libro del gremio, registro del templo, archivo del magistrado, árbol del linaje
  bindings?: BindingRef[];               // §8: ataduras metafísicas (sello en el alma, contrato de sangre)
}
```
- **La forma decide quién puede hacerlo cumplir.** Una promesa de palabra sin testigos solo la sostienen la conciencia, la relación y, si hay, el Cielo. Con testigos, la reputación. Con un escrito sellado, el tribunal. Con el registro del gremio, el gremio. Con un rito ante el Cielo, el karma pesa más.
- **La forma cuesta.** Un escriba cobra, un registro paga tasa, un rito necesita un lugar y un oficiante, un sello en el alma necesita un cultivador que lo ponga. Por eso las promesas chicas son de palabra.
- **Los documentos son objetos.** Un contrato escrito es un lote con autor, fecha, insumos (papel, tinta) y `originEventId` (economy §1, information §6). Se pierde, se quema, se roba, se copia con errores, se **falsifica** (crafts: escritura y copia; perception: detectar falsificaciones). La talla de madera partida en dos (una mitad para cada parte) es la prueba de deuda de los que no saben leer. Quien tiene el documento tiene la prueba; quien lo destruye borra la deuda para todos los que solo la conocían por él (pero no para el Cielo, ni para la memoria de los testigos).

## 4. Cumplir

- **Cumplir es actuar.** Pagar es un evento de transferencia (economy), enseñar es una sesión de enseñanza (cultivation), escoltar es viajar con alguien. Cada evento que cumple queda en `performed` y en `history`. No hay "cumplimiento" abstracto.
- **La medida.** `exact`: tres taeles de plata, ni uno menos (verificable si el acreedor sabe pesar y la plata no está rebajada: economy §2). `standard`: una espada "de buena calidad" según el uso del gremio (verificable por tasación, con error). `discretion`: "hasta que el maestro esté satisfecho" (a criterio de alguien). La medida decide cuánto se puede disputar.
- **La vaguedad es una fuente de conflictos.** Con `precision` baja, cada parte cree que se debe otra cosa: el clan que prometió "apoyo" en una guerra manda diez hombres y el aliado esperaba cien. Las dos creencias se forman con los esquemas de cada uno (el desconfiado espera menos y cree que le deben más).
- **Cumplimiento parcial y tardío.** Se paga la mitad, se escolta hasta la mitad del camino. El acreedor decide si acepta, reclama o lo toma como incumplimiento; la cultura dice qué se espera (prórroga, interés de mora, pérdida del colateral).
- **Imposibilidad.** Si cumplir dejó de ser posible (la espada encargada no se puede hacer porque el metal se perdió, el discípulo murió, la aldea protegida fue arrasada por un terremoto), la obligación queda `imposible`. Qué pasa después depende de la cultura y de lo que creen las partes: devolver lo cobrado, compensar o nada. Que la imposibilidad sea real es verdad; que el acreedor la crea, creencia ("dice que lo asaltaron en el camino").
- **Dispensa.** El acreedor puede perdonar la deuda (un evento: gracia, que en el Cielo resuelve el vínculo y en la relación suma `gratitude`) o el maestro liberar al discípulo.

## 5. Garantías

```ts
type Guarantee =
  | { kind: "collateral"; what: Array<LotId | LandId | HolderRef>; held: "creditor" | "debtor" | "third"; holder?: AgentId }
  | { kind: "pawn"; lot: LotId; redeemBy: Time }                         // empeño: la casa tiene el objeto
  | { kind: "guarantor"; agent: AgentId | OrgId; commitment: CommitmentId }  // fiador: su propia obligación condicional
  | { kind: "hostage"; person: AgentId; keeper: AgentId | OrgId }       // rehén: un hijo en la corte del aliado
  | { kind: "deposit"; lots: LotId[]; keeper: AgentId | OrgId }         // en manos de un tercero de confianza (casa de cambio, templo)
  | { kind: "pledge"; stake: "face" | "name" | "life" | "cultivation" } // "si no cumplo, que me quiten el cultivo": prenda sobre uno mismo
  | { kind: "kin"; persons: AgentId[] };                                // la familia responde (culturas de responsabilidad colectiva)
```
- **Las garantías hacen cumplir sin juez.** El colateral en manos del acreedor se ejecuta solo; el rehén hace cumplir por miedo. Cuanto más débiles los demás ejecutores (sin tribunal, sin reputación compartida), más pesadas las garantías: entre sectas rivales hay rehenes, entre vecinos alcanza la palabra.
- **El fiador** queda con una obligación condicional (si el deudor no paga, paga él) y, cuando paga, con un crédito contra el deudor (`parent`). Ser fiador es una forma de capital social y una de las formas más comunes de arruinarse.
- **Los rehenes son personas.** Tienen su vida, sus relaciones y sus planes: el rehén que se encariña con la familia que lo custodia, el que vuelve espía, el que escapa, el que es ejecutado cuando el tratado se rompe (con el karma y la vendetta que eso trae).
- **La prenda sobre uno mismo** ("pongo mi cultivo en garantía") solo vale si algo puede cobrarla: un sello (§8), una organización con fuerza, o la propia conciencia y la cara.
- **Conservación:** el colateral ejecutado es una transferencia con causa (el incumplimiento); nada se crea.

## 6. Quién hace cumplir (ejecutores)

```ts
interface EnforcerRef {
  kind: "conscience" | "counterparty" | "social" | "organization" | "court" | "guarantee" | "karmic" | "binding" | "patron";
  who?: AgentId | OrgId | CommunityRef;  // quién: la aldea, el gremio, el magistrado, el patrón
  reads: "belief" | "truth";             // qué sabe para actuar (solo karmic, binding y a veces patron leen la verdad)
  sanctions: SanctionPattern[];          // qué puede hacer
}
```

| Ejecutor | Qué lee | Qué hace | Costo y límites |
|---|---|---|---|
| **Conciencia** | Lo que el obligado sabe que hizo | Culpa y disonancia con sus valores (honestidad, lealtad, piedad filial), esquemas que se mueven, raíz de un demonio interno (npc-psychology §7, §9) | Nulo en quien no tiene esos valores; enorme en el honesto |
| **La otra parte** | Sus creencias | Reclamar, cortar la relación, dejar de cumplir lo suyo, cobrarse por mano propia (tomar bienes, golpear, matar), vendetta | Lo que cuesta y arriesga; depende de su fuerza relativa |
| **Social (reputación)** | Creencias de una comunidad (information §9) | Fama de tramposo: nadie le presta, le vende fiado ni le da una hija; pérdida de cara | Solo donde la noticia llega; la reputación es por comunidad. Mudarse la reinicia (a veces) |
| **Organización** | Creencias de sus decisores | Las penas de sus normas (organizations §8): multa, expulsión, muerte; arbitraje entre miembros | Solo sobre miembros o sobre quien le teme; decide por asuntos y facciones (organizations §4) |
| **Tribunal** | Prueba: documentos, testigos, huellas (law, futuro) | Sentencia: pagar, servir, prisión, castigo; ejecutada por la fuerza del estado | Cuesta, tarda, se compra; no alcanza a quien está por encima de la ley |
| **Garantía** | Nada: se ejecuta por estar en manos de alguien | Colateral, empeño, rehén, fiador | Solo lo que se dejó en garantía |
| **Kármico** | La verdad (el libro del Cielo) | Retribución con las herramientas del Cielo (heaven-karma §1): suerte, tribulaciones más duras, demonios internos | Solo en mundos con karma; la atención del Cielo es finita (ítem 20 del backlog); no actúa en el momento |
| **Atadura** | Lo que el mecanismo puede ver (§8) | Dolor, sello del cultivo, muerte, pérdida del poder prestado | Existe solo donde la ley la permite; cuesta esencia; se rompe con poder suficiente |
| **Patrón** | Lo que el patrón percibe o sabe por su naturaleza | Retira el poder, cobra, castiga (otras familias de mundo) | El patrón es un agente con sus propios intereses (metaphysics) |

- **Un compromiso tiene varios ejecutores a la vez,** y el obligado los pesa todos con lo que **cree** de cada uno. El que cree que el karma no existe ignora al Cielo (y lo paga igual, si existe). El que cree que el acreedor no se va a enterar no teme a la reputación.
- **Hacer cumplir cuesta.** Reclamar, juntar testigos, ir al magistrado, convencer a la secta de que actúe: cada paso es una acción con costo y riesgo. Muchos acreedores no cobran porque no les conviene, y eso también se sabe.
- **Quién elige los ejecutores:** las partes al obligarse (la forma de §3), la cultura (qué ejecutores existen y para qué tipos) y el mundo (sin karma no hay ejecutor kármico, aunque la gente crea que sí).

## 7. Incumplir

### La decisión del obligado
Cumplir es una acción del catálogo, decidida con la utilidad de npc-psychology §7:
```
U(cumplir)   = − costo(cumplir) + valor(relación, cara, reputación) + coherencia con valores
U(incumplir) = + lo que se ahorra − Σ_ejecutores P_creída(detecta) × sanción_creída × aversión
               − culpa(valores, esquemas) − miedo al karma (si lo cree)
```
- **Incumplir conviene a veces, y la gente lo sabe.** El campesino con dos malas cosechas no puede pagar; el mercader que encuentra un comprador mejor rompe el trato; la secta que firmó una alianza la abandona cuando el aliado se debilita. Todo sale de la utilidad, con causas.
- **Alternativas al incumplimiento abierto:** pedir prórroga, renegociar, pagar en especie o con algo peor (plata rebajada, arroz húmedo), esconderse, huir, alegar imposibilidad (cierta o falsa), culpar a otro, falsificar el recibo, matar al acreedor o a los testigos, destruir el documento. Cada una con su costo y sus huellas.
- **Desde el otro lado:** el acreedor decide cuánto vigilar, cuándo reclamar y si conviene ejecutar. Un prestamista con muchos deudores tiene cobradores (personas, con su propia relación con los deudores y sus propias tentaciones).

### Detectar
- Un incumplimiento es un hecho; saberlo es percepción e inferencia. El acreedor nota que no llegó el pago (obvio), que el escolta lo abandonó (obvio), que el socio le vendió a otro (si se entera), que el hermano jurado reveló el secreto (si lo rastrea). Las obligaciones de **no hacer** son las más difíciles de vigilar.
- **Falsos incumplimientos:** el acreedor cree que no le pagaron (el pago se perdió en el camino, el cobrador se lo quedó, el recuerdo se deformó). La disputa es real aunque el incumplimiento no lo sea.

### Disputar
Cuando las partes creen cosas distintas (sobre los términos, lo pagado o si hubo incumplimiento), hay una **disputa**, que se resuelve con alguna de estas vías según la cultura, la fuerza y la relación:
- **Negociación directa:** cada uno con su versión; gana el que tiene más poder o más paciencia.
- **Mediación:** un anciano de la aldea, el maestro de los dos, el gremio, el templo. El mediador decide con sus creencias, sus sesgos y sus favoritos (organizations §8: penas con sesgo).
- **Tribunal:** prueba, testigos, sobornos, demoras (law, futuro).
- **Duelo o prueba de fuerza:** en culturas de cultivadores, el más fuerte tiene razón; el pacto de vida o muerte (生死状) firmado ante testigos libera de la venganza.
- **Juicio del Cielo:** jurar ante el Cielo que uno dice la verdad. No resuelve nada en el momento (el Cielo no habla), pero el que miente se carga karma y la gente que cree lo toma en serio.
- **Vendetta:** la parte ofendida se cobra por su cuenta y la disputa se convierte en otra cosa.

### Consecuencias
Cada ejecutor aplica sus sanciones como eventos con causas: el colateral pasa de manos, la reputación cambia en las comunidades que se enteran, la secta expulsa, el tribunal sentencia, el Cielo anota. Los incumplimientos son **presiones** (causality §1): resentimiento, deseo de venganza, pérdida de confianza en todo un tipo de trato (después de una quiebra grande, nadie presta en la ciudad por un tiempo).

## 8. Juramentos y ataduras

Un **juramento** es un compromiso con forma solemne que pone en juego algo que el que jura valora (su nombre, su vida, su cultivo, su alma) ante un testigo que considera capaz de cobrarlo (el Cielo, los ancestros, un dios, su propio corazón). Qué pasa de verdad al romperlo depende de la ley del mundo; qué cree la gente que pasa, de su cultura.

```ts
interface Binding {
  id: BindingId;
  commitment: CommitmentId;
  kind: BindingKind;                     // ver tabla
  bearer: AgentId;                       // en quién está la atadura
  holder?: AgentId;                      // quién la puso o la controla (el amo del sello)
  trigger: TriggerPattern;               // qué la activa: SOLO acciones o estados del propio portador (abajo)
  effect: BindingEffect;                 // dolor, bloqueo de meridianos, pérdida de cultivo, muerte, aviso al holder
  strength: number;                      // esencia invertida y habilidad de quien la puso
  integrity: number;                     // se desgasta, se resiste, se rompe
  essence: ElementVector;                // conservación: la esencia que la sostiene salió de alguien
  originEventId: EventId;
}
```

| Atadura | En qué mundos | Mecanismo | Qué puede ver |
|---|---|---|---|
| **Juramento ante el Cielo** (对天发誓) | Con ley que lleva karma | Crea un `KarmicBond` de juramento con peso alto (§9); romperlo crea uno de traición | La verdad, vía el libro del Cielo |
| **Juramento sobre el corazón del Dao** (心魔誓) | Xianxia | El juramento queda como raíz potencial de un demonio interno: romperlo lo alimenta con la culpa del que juró **y** con el karma de la traición (npc-psychology §9). Muerde en la próxima ruptura | Lo que el propio portador sabe que hizo |
| **Sello en el alma** (restricción, sello de esclavo) | Donde hay alma y cultivo del alma | Una técnica pone una estructura de esencia en el alma del portador que reacciona a sus propias acciones | Solo las acciones e intenciones del portador (decir el secreto, atacar al amo, alejarse más de N días) |
| **Contrato de sangre / de alma** | Varios (pactos con espíritus, bestias, demonios) | Ata dos almas: el daño o la muerte de una alcanza a la otra; la obediencia se siente como dolor | El estado de las dos almas |
| **Talismán de contrato** | Donde hay talismanes (crafts) | Un talismán guarda los términos y se quema o avisa al romperse un deber verificable | Lo que el talismán puede percibir (proximidad, la muerte de una parte) |
| **Pacto con un patrón** | Fantasía oscura, mitológica (metaphysics) | El poder prestado depende del pacto; el patrón cobra él mismo | Lo que el patrón percibe (los dioses ven a sus fieles; un demonio ve a quien marcó) |

- **Una atadura solo ve lo que su mecanismo puede ver.** Un sello en el alma no sabe si el secreto se filtró por otro: sabe si **el portador** lo dijo con intención. Por eso los triggers se arman con un catálogo cerrado de predicados sobre el propio portador. Nada es omnisciente salvo el libro del Cielo, y el Cielo no castiga en el momento.
- **Conservación y costo.** Poner un sello cuesta esencia y habilidad (cultivation: técnicas del alma); sostenerlo puede consumir esencia del portador o del amo. Un sello más débil que el alma que lo lleva se puede resistir (con dolor) o romper (con daño a los meridianos o al alma, body-health §12). La muerte del amo puede liberar el sello o dejarlo suelto (según cómo se hizo).
- **Las ataduras son técnicas, no magia de guion.** Existen porque alguien las inventó (discovery §10), se enseñan, tienen defectos (un sello con un trigger mal formulado deja huecos) y se roban.
- **Creer en la atadura también ata.** Un mortal que juró ante los ancestros en un mundo donde los ancestros no hacen nada puede no romperlo nunca por miedo. Un charlatán vende "sellos de lealtad" falsos que funcionan mientras el sellado crea en ellos (la creencia entra en su utilidad como sanción creída).

## 9. Karma: cómo leen los compromisos en el libro del Cielo
El Cielo no lee contratos: lee eventos (heaven-karma §2). Los compromisos le dan forma a lo que lee:
- **Obligarse solemnemente** (juramento ante el Cielo, ceremonia de maestro–discípulo, hermandad jurada, matrimonio con rito) crea un `KarmicBond` con `kind` del compromiso (`oath`, `master_disciple`, `kinship`) y peso según la solemnidad, lo que está en juego y la sinceridad real.
- **Cumplir** resuelve o aliviana el vínculo; **romper** crea un `KarmicBond` de `betrayal` con peso `f(solemnidad, daño real a la otra parte, consentimiento real, sinceridad al obligarse)`. Romper un contrato arrancado con engaño pesa poco; engañar para arrancarlo pesa en el engañador.
- **Las deudas por norma** (vida, gracia, sangre) ya están en el libro como vínculos de heaven-karma, creados por el evento (rescate, enseñanza, muerte) sin que haga falta ninguna cultura. El `Commitment` con `basis: "norm"` es lo que la **cultura** ve de esa deuda; el `KarmicBond` es lo que el **Cielo** ve. Pueden no coincidir: la cultura que no reconoce la deuda de vida con un extranjero no la cobra; el Cielo sí.
- **Promesas triviales** no llegan al libro: hay un umbral de peso por debajo del cual el Cielo no anota (calibrable; también por costo de cómputo). Una promesa chica rota pesa en la conciencia y en la reputación, no en el Cielo.
- **En mundos sin karma** no se crea ningún `KarmicBond`; los juramentos valen lo que valen sus otros ejecutores y lo que la gente cree.

## 10. Ciclo de vida
```ts
type CommitmentStatus =
  | "proposed" | "active" | "fulfilled" | "breached" | "disputed"
  | "released" | "renegotiated" | "transferred" | "impossible" | "expired" | "void_claimed" | "forgotten";
```
- **Renegociación:** un compromiso nuevo con `parent` en el viejo (prórroga a cambio de más interés, alianza revisada después de una guerra). La renegociación se decide con poder de negociación nuevo.
- **Cesión y venta de créditos.** Un derecho a cobrar es un bien (economy: `HolderRef` de derechos): se vende con descuento a un cobrador más duro, se usa como pago, se hereda. Requiere que el deudor se entere (o no: el nuevo acreedor aparece con el documento). Un mercado de deudas de campesinos concentra tierra en pocas manos.
- **Herencia.** La cultura define qué pasa al morir una parte (`heirs`): las deudas del padre pasan a los hijos (o solo hasta lo que heredan), la deuda de sangre pasa al linaje, el maestro muerto deja al discípulo obligado con la secta, el tratado firmado por un líder obliga a su sucesor (que puede repudiarlo: §12). El Cielo hereda según sus reglas (heaven-karma: las deudas enormes pasan al linaje).
- **Prescripción y olvido.** Las culturas con tribunales tienen plazos; sin ellos, una deuda vive mientras alguien la recuerde o tenga el papel. Cuando todos los que lo sabían murieron y no queda constancia, el compromiso queda `forgotten`: sigue en la verdad (y en el libro del Cielo, si pesa), pero ya no lo hace cumplir nadie. Un documento que reaparece en una ruina lo despierta (deep-history).
- **Nulidad alegada.** "Me obligaste con engaño", "mi hijo era menor", "el emisario no tenía poder": las partes pueden alegar que el compromiso no vale (`void_claimed`). Que lo logren es una disputa (§7).

## 11. Catálogo de tipos (`content/`)
Cada tipo define las obligaciones típicas, las garantías y ejecutores habituales, la forma esperada y las reglas de herencia, **por cultura**. Es costumbre, no molde: cualquier compromiso concreto puede apartarse.

| Tipo | Partes | Obligaciones típicas | Ejecutores habituales | Detalle en |
|---|---|---|---|---|
| Préstamo, fiado, crédito agrícola | Prestamista, deudor, fiadores | Devolver con interés en un plazo | Garantía, social, tribunal, organización | economy §8 (`Loan`) |
| Empeño | Casa, dueño | Devolver lo prestado para recuperar el objeto | Garantía | economy §8 |
| Letra de cambio | Casa emisora, portador | Pagar al portador en otra plaza | Organización, social | economy §2 |
| Venta a plazo, suministro | Vendedor, comprador | Entregar, pagar | Social, gremio, tribunal | economy |
| Trabajo, jornal, servicio doméstico | Patrón, trabajador | Trabajar; pagar y alimentar | Social, la otra parte | economy §3 |
| Encargo | Cliente, artesano | Hacer la obra; entregar materiales y pagar; quién se queda con lo que sobra | Social, gremio, tribunal | crafts §10 |
| Escolta, mercenarios | Contratante, escolta | Proteger en el camino; pagar | La otra parte, social | economy §7 |
| Aprendizaje | Maestro artesano, aprendiz | Enseñar y alimentar; trabajar sin paga N años | Gremio, social | crafts, organizations §9 |
| Maestro–discípulo | Maestro, discípulo | Enseñar, proteger, proveer; obedecer, servir, cuidar en la vejez, vengar | Conciencia, organización, kármico | organizations §9 |
| Membresía | Organización, miembro | Servicio, aportes, silencio; sueldo, protección, acceso | Organización | organizations §2 (`obligations`) |
| Esponsales y matrimonio | Cónyuges y sus familias | `status: spouse` (paquete cultural), dote, alianza entre familias | Social, familia, kármico (con rito) | [family-lineage.md](family-lineage.md) |
| Adopción | Adoptante, adoptado, familia de origen | `status: child` | Social, familia | [family-lineage.md](family-lineage.md) |
| Hermandad jurada (结义) | Hermanos jurados | Ayuda mutua, vengarse unos a otros, compartir | Conciencia, kármico, social | organizations §2 |
| Juramento de secreto | Quien guarda, a quien protege | `refrain: revelar` | Atadura, organización, kármico | information §7 |
| Apuesta, duelo pactado, pacto de vida o muerte | Las partes, testigos | Pagar; aceptar el resultado; no vengar | Social, testigos, kármico | — |
| Deuda de vida, gracia | Salvado, salvador | Devolver el favor | Conciencia, social, kármico | heaven-karma §2 |
| Deber de venganza | Deudos, linaje | `avenge` | Conciencia, social (cara), kármico | heaven-karma, organizations §8 |
| Hospitalidad | Anfitrión, huésped | Proteger y alimentar; no dañar la casa | Social, conciencia | — |
| Protección y tributo | Protector, protegidos | Proteger; pagar tributo | La otra parte, garantía (fuerza) | organizations §10 |
| Tratado: alianza, no agresión, tregua, vasallaje | Organizaciones | Según términos; rehenes e intercambios | Garantía, social, kármico (con rito) | organizations §10, war (futuro) |
| Rescate | Captor, familia | Pagar; liberar | Garantía (el cautivo) | war (futuro) |
| Servidumbre por deudas | Acreedor, siervo | Servir hasta pagar (que casi nunca llega) | Tribunal, fuerza, atadura | [social-structure.md](social-structure.md) §7 |
| Pacto con espíritu o bestia | Persona, espíritu o bestia | Ofrendas, servicio, ayuda en combate | Atadura (contrato de alma), la otra parte | spirits, living-world |
| Pacto con patrón | Persona, patrón | Servicio, fe, sacrificios; poder | Patrón | metaphysics (otras familias) |

## 12. Organizaciones y compromisos
- **Una organización se obliga por personas.** El tratado lo firma quien tiene `represent` (organizations §3). Si el firmante no tenía poder (o se cree que no), la organización puede repudiarlo; repudiar cuesta cara (organizations §14) y confianza ante todas las demás.
- **La sucesión pone a prueba los compromisos.** Un líder nuevo hereda los tratados del anterior: los cumple si le convienen o si teme las consecuencias, los repudia si puede culpar al anterior. Las facciones (organizations §5) que se beneficiaban del tratado lo defienden.
- **Organizaciones como garantes.** Gremios, templos y casas de cambio venden confianza: registran contratos, guardan depósitos, arbitran disputas entre miembros. Su valor es su reputación de imparcialidad (que se compra, a veces).
- **Las obligaciones de membresía** (`Membership.obligations`) son obligaciones de un compromiso de membresía con la organización como contraparte; las penas por incumplir son las normas de organizations §8.
- **`OrgRelation.formal`** (alliance, vassal, truce…) es la vista resumida de los tratados activos entre dos organizaciones: un estado formal existe porque hay un compromiso que lo sostiene, con su `originEventId`.

## 13. Cómo unifica lo que ya había
| Antes | Ahora |
|---|---|
| `Relationship.debts: DebtRef[]` (npc-psychology §6) | `CommitmentRef[]`: las obligaciones activas entre las dos partes, de cualquier tipo. La relación guarda cómo se siente cada uno; el compromiso, lo que se debe |
| `Relationship.bonds: BondLabel[]` | Derivados: vínculos de parentesco (hechos de nacimiento, [family-lineage.md](family-lineage.md) §5) más los `status` de compromisos activos (spouse, master, disciple, sworn_sibling, vassal) |
| `KarmicBond` (heaven-karma §2) | Sigue siendo el libro del Cielo (verdad). Los compromisos solemnes y sus incumplimientos crean vínculos kármicos (§9); las deudas por norma son la vista cultural de vínculos kármicos que crean los eventos |
| `Loan` (economy §8) | La vista económica de un `Commitment` de tipo préstamo: `principal`, `interest` y `term` son su `Obligation`; `collateral` y `guarantors` sus `Guarantee`; `enforcement` sus `EnforcerRef` |
| `Membership.obligations` (organizations §2) | Obligaciones del compromiso de membresía |
| `OrgRelation.formal` (organizations §10) | Resumen de los tratados activos |
| Encargos (crafts §10) | Compromisos de tipo `commission` |

## 14. El jugador y el narrador
- **Prometer es una acción.** El jugador escribe "le digo que le devuelvo el doble en otoño" o "juro ante el Cielo que no voy a contar nada"; el parser lo traduce a una propuesta con términos estructurados y la forma (palabra, testigos, juramento). Si la frase es ambigua, el parser la mapea a términos con `precision` baja: la vaguedad que el jugador eligió queda en el mundo.
- **El jugador también puede mentir al prometer.** La sim no le pregunta si es sincero: lo infiere de lo que hace después (y en el libro del Cielo, del acto de cumplir o no). Su `sincerity` declarada no existe; existe la conducta.
- **El narrador solo sabe lo que el personaje cree.** Le pasan las creencias del personaje sobre sus compromisos (qué cree que debe y que le deben, qué cree que recuerda la otra parte), nunca los términos reales si el personaje los olvidó o los entendió mal. Si el jugador firmó un contrato sin leer la letra chica, el narrador no la conoce hasta que el personaje la lea o se la cobren.
- **Libro de deudas y promesas.** La UI muestra lo que el personaje cree: a quién le debe, quién le debe, qué juró. Con errores, si el personaje los tiene. El karma real no se muestra; se intuye por percepción kármica (si tiene la técnica) o por las consecuencias.
- **Leer un contrato es percibir.** Un analfabeto firma con el pulgar lo que le leen (y le pueden leer otra cosa). Detectar una falsificación o una cláusula trampa es percepción y saber (perception, crafts: escritura).

## 15. Escala (LOD)
- **Tier 3-4 (el jugador y su entorno):** compromisos individuales con todas las piezas, decisión de cumplir por utilidad, detección, disputas y ejecutores actuando como agentes.
- **Tier 2:** compromisos individuales con decisión simplificada (cumplir o no por una utilidad resumida) y ejecutores resumidos (la reputación se actualiza por comunidad, sin conversaciones).
- **Tier 0-1:** stocks agregados por hogar, comunidad y organización: deuda total por tipo de acreedor, tasas de incumplimiento, tratados activos entre organizaciones. Los incumplimientos generan presiones agregadas (hambre por servidumbre, resentimiento contra los usureros). Calibrados contra el modo individual.
- **Materialización:** cuando un agente pasa a tier alto, sus compromisos se materializan coherentes con los agregados (si el hogar debía 30 taeles al usurero, hay un `Commitment` concreto con fecha y testigos plausibles, con `originEventId` en el evento agregado que lo creó).
- **Compresión:** las promesas chicas cumplidas se borran y dejan solo su efecto en la relación (como el gist de una memoria). Los compromisos con peso kármico, con documentos o con disputas abiertas se conservan.

## Implementación
- **Fase 1:** el fiado de la aldea como primer compromiso: deudas chicas de palabra entre vecinos, con la otra parte y la reputación como únicos ejecutores; pago como transferencia con causa.
- **Fase 2:** promesas en el diálogo (proponer, aceptar, prometer), creencias sobre compromisos con deformación, culpa por incumplir según valores, libro de deudas y promesas del jugador.
- **Fase 3:** préstamos y crédito agrícola sobre este modelo (economy §8), garantías (colateral, fiadores, empeño), deudas por norma (vida, hospitalidad), herencia de deudas, matrimonio y aprendizaje como compromisos de `status`, mediación del consejo de aldea, cadenas de incumplimiento, documentos y tallas como objetos.
- **Fase 4:** maestro–discípulo y membresía de secta como compromisos, juramentos ante el Cielo y sobre el corazón del Dao (karma y demonios internos), juramentos de secreto, sellos simples en el alma.
- **Fase 5:** contratos entre comerciantes por rutas, letras, escoltas, encargos con artesanos lejanos, venta de créditos, falsificación de documentos.
- **Fase 6:** tratados, vasallaje y tributo entre organizaciones, rehenes, repudio en sucesiones, gremios y templos como garantes y árbitros, contratos con bestias y espíritus, talismanes de contrato.
- **Fase 7:** tratados y vendettas heredados en la historia agregada; documentos que sobreviven en ruinas.
- **Fase 8:** tribunales del estado (law.md), servidumbre por deudas a escala, rescates y treguas en la guerra.

## Tests
- **Procedencia:** ningún `Commitment` sin `originEventId`; toda obligación cumplida tiene eventos en `performed`; ningún `KarmicBond` de juramento o traición sin el compromiso y el evento que lo crearon.
- **Conservación:** cumplir, incumplir, ejecutar colateral y ceder créditos no crea ni destruye bienes: la suma de tenencias se mantiene, solo cambian los tenedores.
- **Determinismo:** mismo seed y mismas acciones dan los mismos compromisos, decisiones de cumplir y sanciones.
- **Verdad vs creencia:** ningún ejecutor social, organizacional ni judicial actúa sobre un incumplimiento que no cree; el Cielo sí anota uno que nadie vio. El narrador nunca recibe términos que el personaje no conoce.
- **Ataduras:** un sello solo se dispara con predicados sobre su portador; la esencia que lo sostiene sale de alguien; un sello más débil que el alma del portador se puede romper.
- **Sin karma:** en un mundo de física indiferente no se crea ningún `KarmicBond`, y los juramentos siguen funcionando por creencia y por los otros ejecutores.
- **Escenario controlado:** con la misma deuda y el mismo apuro, un deudor de honestidad alta paga a costa de pasar hambre y uno de honestidad baja incumple si cree que el acreedor no puede cobrar.
- **Escenario controlado:** un contrato falsificado gana en el tribunal si el juez no percibe la falsificación, y pierde si un tasador la detecta.
- **Escenario controlado:** la quiebra de un deudor central se propaga por la cadena de deudas a sus acreedores con poca reserva.
- **Escenario controlado:** romper un juramento sobre el corazón del Dao sube la fuerza del demonio interno y dificulta la siguiente ruptura.
- **Agregado:** las tasas de incumplimiento por tipo y comunidad en tier 0 coinciden en promedio con las del modo individual.

## Decisiones tomadas en este borrador (revisables)
- Un solo `Commitment` para deudas, vínculos, tratados, pactos y juramentos; las diferencias van en el catálogo y en la cultura.
- Tres bases (acuerdo, norma, imposición). Las deudas por norma son creencias culturales; el Cielo lleva su propia contabilidad aparte.
- Cumplir es siempre una decisión del obligado; ningún compromiso se cumple automáticamente. Lo hacen cumplir ejecutores que leen creencias, salvo el Cielo y las ataduras, que leen la verdad por su mecanismo.
- `KarmicBond` sigue siendo el libro del Cielo; los compromisos solemnes y sus incumplimientos lo alimentan con peso que depende del consentimiento y la sinceridad reales.
- Las ataduras metafísicas solo ven acciones e intenciones de su portador (catálogo cerrado de predicados), cuestan esencia y se pueden romper.
- `Loan`, `Membership.obligations` y `OrgRelation.formal` pasan a ser vistas de compromisos.

## Decisiones (2026-10-05)
- **Las promesas triviales no llegan al libro del Cielo.** Hay un umbral de peso: una promesa chica rota pesa en la conciencia y en la reputación, no en el karma.
- **Romper un contrato arrancado con engaño casi no da karma;** el karma lo carga quien engañó. El Cielo pesa el consentimiento y la sinceridad reales, no la forma.

## Preguntas abiertas
- Calibración: umbral de peso para que una promesa llegue al libro del Cielo, y cuánto pesa una traición según solemnidad y daño (que romper un juramento importe sin que una promesa chica arruine una tribulación).
- Calibración: tasas de incumplimiento por tipo y cultura (incumplir común pero no universal; la reputación tiene que valer algo).
- Calibración: fuerza de los sellos en el alma frente al portador (que un esclavo sellado pueda, con mucho costo, liberarse si se vuelve bastante más fuerte que el que lo selló).
- Calibración: cuántas promesas chicas conserva un NPC de tier 2 antes de comprimirlas.
