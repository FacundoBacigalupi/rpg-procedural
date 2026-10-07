# Propiedad y tenencia de la tierra

> Principio: **ser dueño es que otros lo crean y que alguien lo haga cumplir.** La propiedad tiene tres capas que casi nunca coinciden: quién tiene la cosa de hecho (posesión), quién cree cada uno que es el dueño (creencia) y qué dicen los papeles, las piedras y las marcas (registro). Ninguna manda sola. Un título sin nadie que lo defienda es un papel, y una posesión que nadie reconoce es un robo que todavía no se castigó.

> Estado: **borrador** (2026-10-06).

Depende de: [economy.md](economy.md) §1, §2b, §8 (la tierra como bien, tenencias, crédito y colateral), [contracts.md](contracts.md) (compromisos, formalidades, ejecutores, disputas, herencia), [family-lineage.md](family-lineage.md) §8 (herencia y partición), [state.md](state.md) §3, §4 (catastros, impuestos), [law.md](law.md) (robo, usurpación, tribunales, prueba), [social-structure.md](social-structure.md) §7 (servidumbre de la tierra; nunca personas como bienes), [information.md](information.md) §1, §4, §7 (creencias, documentos, secretos), [settlements.md](settlements.md) (terrenos y edificios), [planet-gen.md](planet-gen.md) §9 (suelos), [cultivation.md](cultivation.md) (venas de qi, cuevas), [spirits.md](spirits.md) §11 (tierras de culto), [heaven-karma.md](heaven-karma.md) §2 (karma por daño y compromisos rotos), [causality.md](causality.md) (presiones).
Lo usan: economy (renta, venta de tierra, ejecución de colateral), state (impuestos sobre el catastro, reformas agrarias), law (casos de tierras y robos), war (confiscación, botín, colonos), organizations (patrimonio de clanes y sectas), settlements (quién construye dónde), [travel.md](travel.md) (peajes y derechos de paso), [culture.md](culture.md) (normas de propiedad), chronicle (la tierra que una familia ganó o perdió).

---

## Principios

1. **Tres capas:** posesión (verdad física: quién ocupa, quién tiene la cosa en la mano), creencias (cada agente cree a quién pertenece) y registro (escrituras, catastros, mojones, sellos, marcas). La sim guarda las tres por separado y las deja divergir.
2. **Un derecho es un haz.** Usar, sacar frutos, excluir, vender, heredar, empeñar, construir, extraer, pasar: se separan. El que cultiva y el que cobra pueden ser dueños de cosas distintas sobre el mismo campo.
3. **Los derechos valen lo que sus ejecutores.** La comunidad, el clan, el tribunal, la secta, la propia fuerza (contracts §6). Donde no llega nadie, manda el que está.
4. **Las normas son culturales** y viven en `content/`: qué se puede tener, cómo se adquiere, qué se hereda, cuánto tiempo de uso da derecho. Dos culturas sobre la misma tierra producen dos dueños.
5. **Conservación.** La tierra no se crea ni se mueve (economy §1): cambia de manos por eventos con causa. Lo que gana uno lo pierde otro, y queda en el grafo.
6. **La propiedad produce presiones.** La tierra se concentra por deudas y malas cosechas; los sin tierra migran, se hacen bandidos, entran a sectas o se rebelan; los estados reforman o caen.
7. **Nunca una persona es una cosa** (social-structure §7): sobre personas solo hay compromisos.

---

## 1. El modelo

```ts
interface PropertyObject {                   // sobre qué puede haber derechos
  kind: "parcel" | "building" | "water" | "subsurface" | "vein" | "cave" | "trees" | "pasture"
      | "fishery" | "lot" | "item" | "animal" | "route" | "territory" | "grave" | "market_stall" | ObjectKindId;
  ref: ParcelId | BuildingId | WorkId | DepositRef | VeinRef | LotId | ItemId | AnimalId | CellId[] | SpaceRef;
}

interface Right {
  id: RightId;
  object: PropertyObject;
  holder: HolderRef;                         // agente, hogar, linaje, organización, comunidad, estado, espíritu, nadie
  incidents: Incident[];                     // qué partes del haz tiene (abajo)
  share?: number;                            // copropiedad: hermanos indivisos, socios
  basis: AcquisitionBasis;                   // §5: cómo se obtuvo
  norm: NormRef;                             // bajo qué norma cultural existe (otra cultura puede no reconocerlo)
  term?: { until?: Time | "death" | "redemption" | "condition"; renewable?: boolean };
  encumbrances: Encumbrance[];               // §1.2: lo que pesa sobre el derecho
  commitment?: CommitmentId;                 // si nace de un compromiso: arriendo, feudo, prenda, aparcería
  records: RecordRef[];                      // §9: dónde quedó constancia (puede no haber ninguna)
  originEventId: EventId;
}

type Incident =
  | "possess" | "use" | "fruits" | "exclude" | "alienate" | "bequeath" | "pledge"
  | "build" | "extract" | "draw_water" | "graze" | "gather" | "glean" | "pass" | "bury"
  | "cultivate_qi" | "tax" | "rent" | "manage";
```

### 1.1 Posesión, creencia y registro
- **Posesión** es verdad física: quién vive en la casa, quién ara el campo, quién tiene el anillo en el dedo. La sim la sabe siempre.
- **Los derechos** (`Right`) también son verdad, pero verdad *normativa*: existen bajo una norma de una cultura. Que exista un derecho no hace que nadie lo respete.
- **La creencia** sobre a quién pertenece algo es una creencia como cualquier otra (information §1): con fuente, confianza y errores. El vecino cree que el campo es de la viuda; el prestamista cree que es suyo por la prenda; el magistrado cree lo que dice el catastro.
- **El registro** es un objeto: un documento, una piedra, una marca (§9). Se copia, se falsifica, se pierde.
- **Las tres capas divergen** sin que nadie lo haga a propósito (la escritura se quemó, el mojón se movió con la crecida) o a propósito (fraude, usurpación, ocultar al fisco).

### 1.2 Cargas
```ts
type Encumbrance =
  | { kind: "rent"; to: HolderRef; commitment: CommitmentId }            // renta al dueño eminente
  | { kind: "tax"; to: StateId; register: RegisterId }                   // impuesto sobre lo registrado (state §4)
  | { kind: "labor"; to: HolderRef }                                     // corvea, días de trabajo al señor
  | { kind: "pledge"; to: HolderRef; commitment: CommitmentId }          // prenda o hipoteca (economy §8)
  | { kind: "easement"; for: HolderRef | "public"; incident: Incident }  // servidumbre de paso, de agua, de pastoreo
  | { kind: "inalienable"; norm: NormRef }                               // tierras de culto, de linaje, del templo
  | { kind: "redemption"; by: HolderRef; price: Price; until?: Time }    // venta con derecho a recompra (§5)
  | { kind: "tithe"; to: OrgId };                                        // diezmo al templo o tributo a la secta
```

## 2. Qué se puede tener

| Objeto | Detalle | Notas |
|---|---|---|
| **Parcelas** | §3 | Suelo, agua y qi reales (planet-gen); el valor sale de lo que cada uno cree que rinde |
| **Edificios** | settlements §5 | Pueden ser de alguien distinto del dueño del suelo (la casa del arrendatario sobre tierra ajena) |
| **Agua** | settlements §8 | Turnos de riego, derechos sobre un manantial, sobre un tramo de río para el molino; los pleitos de agua son los más violentos en sequía |
| **Subsuelo** | economy §2b | Minas y canteras; en muchas culturas son del soberano aunque el campo sea de otro |
| **Venas y cuevas** | cultivation | El bien más disputado entre cultivadores (§13) |
| **Árboles** | — | Árboles frutales o de madera con dueño propio, distinto del suelo |
| **Pastos, bosques, pesquerías** | §7 | Casi siempre comunales o con derechos de uso por temporada |
| **Muebles** | §12 | Lotes e ítems de economy |
| **Animales** | living-world §13 | Ganado con marca; bestias vinculadas por contrato (que tienen su propia voluntad) |
| **Puestos de mercado, rutas, peajes** | economy §5, [travel.md](travel.md) §1 | El derecho a cobrar en un puente o vender en una esquina |
| **Tumbas** | spirits | Inviolables por norma casi en todos lados; profanarlas es crimen (law) y ofensa a los ancestros |
| **Territorio** | state, organizations | Reclamo de soberanía o de dominio de secta, que no es propiedad de la tierra pero la cubre |

- **Lo que no se puede tener** también es cultural: en una cultura la tierra es del soberano y los campesinos solo la usan; en otra, del linaje y nadie la vende; en otra, de los dioses.
- **El saber** (técnicas, recetas, mapas) no es propiedad: es un secreto (information §7) protegido con juramentos (contracts §8) y monopolios (technology). Una técnica robada no "vuelve" con un tribunal.

## 3. Parcelas y límites

```ts
interface Parcel {
  id: ParcelId;
  cell: CellId;                              // la celda hex que la contiene (o varias, si es grande)
  geometry: PolygonRef;                      // solo en local y escena (§16); en lo demás, superficie
  area: number;                              // en la unidad de la cultura (mu, acre, jornada de arado)
  landUse: "field" | "paddy" | "garden" | "orchard" | "pasture" | "woodland" | "waste" | "house_plot" | "spirit_field" | LandUseId;
  soil: SoilRef;                             // planet-gen §9: fertilidad real, que se agota y se recupera
  water: WaterAccessRef[];                   // qué canal, qué pozo, qué turno
  qi?: number;                               // densidad del campo de qi (planet-gen, elements)
  boundaries: Boundary[];
  rights: RightId[];                         // todos los derechos que hay sobre ella, de distintos titulares
  originEventId: EventId;                    // desmonte, partición, drenaje, conquista, reparto
}

interface Boundary {
  with: ParcelId | "road" | "river" | "waste" | "commons";
  markers: MarkerRef[];                      // mojones, zanjas, setos, árboles, nada (solo memoria)
  truthLine: GeometryRef;                    // dónde está de verdad el límite que se acordó
  disputed?: DisputeId;
}
```

- **Los límites son memoria y objetos.** Un mojón se mueve de noche (un campo crece tres surcos por año), una crecida borra la zanja, el árbol del límite se tala. El límite "verdadero" es el último acordado; lo que cada vecino cree puede diferir.
- **Medir es un oficio** (technology: agrimensura). Una cultura sin agrimensores mide por días de arado y semillas sembradas, con errores que favorecen al que mide.
- **Las parcelas se parten y se juntan:** por herencia (§8), por venta parcial, por acumulación. Cada partición es un evento.
- **Desmontar, drenar y aterrazar** crea tierra utilizable donde no la había: no crea tierra, cambia su uso, consume trabajo y puede dañar otra cosa (el bosque, el humedal río abajo: living-world).

## 4. Formas de tenencia

Catálogo en `content/tenure/`, por cultura; todas las formas de la tabla entran desde el principio como contenido opcional por cultura, incluida la de dos dueños en un campo (aprobado 2026-10-06). Cada forma es una combinación de incidentes, cargas, normas de herencia y ejecutores.

| Forma | Quién tiene qué | Presiones típicas |
|---|---|---|
| **Propiedad plena** | El titular tiene casi todo el haz; paga impuesto | Concentración por compra y ejecución de deudas |
| **Tierra comunal** | La aldea regula uso de pastos, bosques, agua; nadie vende | Sobreuso, cercamiento por los fuertes (§7) |
| **Tierra de linaje o clan** | El clan es dueño; las ramas usan; vender pide consenso | Peleas entre ramas, ventas a escondidas |
| **Tierras de culto** (祭田) | Inalienables; la renta paga los ritos (spirits §11) | Ramas que se apropian la renta, ancestros sin ofrendas |
| **Tierras de templo y monasterio** | La organización; trabajada por arrendatarios o siervos | Riqueza que atrae saqueo y confiscación del estado |
| **Dominio de secta** | La secta reclama montañas, venas y valles; cobra tributo a los pueblos | Choques con el estado y con otras sectas (§13) |
| **Feudo o beneficio** | Concedido por servicio; revocable o hereditario según la norma | Feudos que se vuelven hereditarios de hecho; señores que se independizan |
| **Tierra del estado repartida** | El estado asigna por hogar y la recupera al morir (reparto igualitario) | Funciona mientras el registro se actualiza; se degrada en concentración |
| **Arrendamiento** | El dueño cobra renta fija; el arrendatario usa (§6) | Rentas altas, desalojos |
| **Aparcería** | Se reparte la cosecha; quién pone semilla, bueyes y herramientas decide la proporción (§6) | Deudas del aparcero con el dueño |
| **Dos dueños en un campo** (田骨/田皮) | Uno tiene el "fondo" (cobrar renta, pagar impuesto); otro la "superficie" (cultivar, vender ese derecho) | Cada derecho se vende por separado: el dueño del fondo no puede echar al de la superficie |
| **Tierra de siervos** | El siervo usa una parcela atada a él; debe trabajo al señor (social-structure §7) | Fugas, revueltas |
| **Venta con derecho a recompra** (典) | El comprador usa la tierra; el vendedor puede recomprar al mismo precio | Recompras que nunca llegan; disputas generaciones después |
| **Ocupación** | Alguien usa tierra ajena, del estado o baldía sin derecho reconocido | Desalojos, prescripción (§5) |
| **Pastoreo estacional** | Derecho a pasar y pastar en temporada, sobre tierra que otros cultivan el resto del año | Choques entre agricultores y nómadas (living-world §11) |

## 5. Cómo se adquiere

```ts
type AcquisitionBasis =
  | "clearing"       // primer uso de tierra baldía, según la norma (desmontar da derecho en algunas culturas)
  | "purchase"       // contrato de venta (contracts)
  | "inheritance"    // family-lineage §8
  | "gift" | "dowry"
  | "grant"          // concesión del estado, el señor o la secta
  | "conquest" | "confiscation"
  | "foreclosure"    // ejecución de una prenda (economy §8)
  | "prescription"   // uso largo sin reclamo, si la norma lo reconoce
  | "finding"        // §12: lo hallado, según la norma del lugar
  | "production"     // lo que uno hace o cosecha es suyo (o de su señor)
  | "sentence"       // un tribunal lo asigna
  | "redistribution";// reforma agraria, reparto del estado
```

- **Vender tierra es un compromiso con formalidades** (contracts §3): escritura, testigos, un intermediario que garantiza (中人), a veces el permiso del clan (los parientes tienen derecho de preferencia), el impuesto de transferencia y el sello oficial. Muchos venden con escritura privada sin sello para no pagar: el registro del estado se atrasa.
- **El precio sale de creencias** (economy §5): lo que cada uno cree que rinde, la seguridad, la cercanía, el prestigio, la geomancia (settlements §4). En una hambruna la tierra se regala; en una paz larga se paga cara.
- **La prescripción** existe solo si la cultura la tiene, con los años como dato en `content/` (aprobado 2026-10-06): veinte años de arar sin que nadie reclame pueden hacer dueño al ocupante, y el heredero que vuelve del exilio encuentra su campo perdido por la ley.
- **Conquistar o confiscar** cambia la posesión de golpe y el registro después (o nunca). Los antiguos dueños siguen creyendo que la tierra es suya, y sus hijos también: una presión de restitución que puede durar generaciones.

## 6. Arriendo y aparcería

- **Son compromisos** (contracts) con obligaciones en las dos direcciones: renta (en plata, en especie, en trabajo) y a veces el deber del dueño de prestar semilla, mantener el canal o proteger.
- **La renta sale de la negociación** con las creencias de cada uno y la escasez de tierra: donde sobra gente, las rentas son altas y los contratos cortos.
- **En aparcería** la proporción depende de quién pone qué: tierra, semilla, bueyes, herramientas, trabajo. Un año malo deja al aparcero debiendo semilla, y la deuda lo ata (social-structure §7).
- **Desalojar** necesita un ejecutor: el clan del dueño, el alguacil, sus matones. El arrendatario de muchos años cree que tiene derecho a quedarse, y a veces la norma le da la razón.
- **Subarriendo:** el arrendatario arrienda a otro y cobra la diferencia. Las cadenas largas exprimen al de abajo.

## 7. Comunales y cercamientos

- **Los comunales tienen reglas** (`content/`): quién puede usar, cuánto, cuándo (temporadas de corte de leña, cantidad de cabezas por hogar, turnos de agua), quién vigila y qué castigo hay. Las reglas son normas de la aldea, y las hace cumplir la aldea (contracts §6: ejecutor social).
- **Sobreuso:** si las reglas fallan (la aldea crece, un poderoso las ignora, llegan extranjeros), el bosque se raja y el pasto se pela (living-world: sucesión). Es un proceso, no una tragedia fija: muchas aldeas sostienen sus comunales por siglos.
- **Cercar** es apropiarse un comunal: un terrateniente, un monasterio o una secta pone cercas, guardias o una formación. Los que vivían de eso pierden leña, pasto o caza, y responden con quejas, pleitos, cercas rotas de noche o revuelta.
- **Espigar** (recoger lo que quedó después de la cosecha) es un derecho de los pobres en muchas culturas; quitarlo empuja a los más pobres al hambre o al robo.

## 8. Herencia y partición

- **Las reglas están en family-lineage §8** (`InheritanceRule`, por cultura y tipo de bien). Este doc define qué pasa con la tierra.
- **La partición igualitaria** achica las parcelas generación tras generación hasta que no alcanzan para un hogar: hermanos que venden su parte, que se van, que mandan hijos a la secta. Los campos se vuelven franjas y los límites se multiplican.
- **La primogenitura** concentra y deja segundones sin tierra: soldados, monjes, bandidos, discípulos.
- **Indivisión:** los hermanos que no parten trabajan juntos hasta que se pelean, y la partición tardía es una disputa (contracts §7).
- **Tierras sin heredero** pasan a quien diga la norma: el clan, el señor, el estado, el templo, o al primero que las ocupe.

## 9. Registros y pruebas

```ts
type RecordRef =
  | { kind: "deed"; document: DocumentId; sealed?: SealRef; tax_paid?: boolean } // escritura privada o con sello oficial
  | { kind: "register"; register: RegisterId; entry: number }                     // catastro del estado (state §3)
  | { kind: "clan_book"; document: DocumentId }                                   // libro del linaje, genealogía con tierras
  | { kind: "temple_book"; document: DocumentId }
  | { kind: "marker"; marker: MarkerRef }                                         // mojón con inscripción
  | { kind: "mark"; on: LotId | ItemId | AnimalId; mark: MarkId }                 // sello, marca de hierro, de gremio
  | { kind: "soul_bond"; bond: BondId }                                           // artefacto vinculado al alma (§12)
  | { kind: "witness_memory"; agents: AgentId[] };                                // "todos saben que es de los Wang"
```

- **Los documentos son objetos** (information §4): se guardan, se roban, se queman, se falsifican y se copian mal. Un incendio (settlements §9) puede dejar a media aldea sin escrituras.
- **Falsificar** es un oficio (caligrafía, sellos, papel envejecido) con huellas que otro con oficio puede ver (law §5).
- **Esconder tierra del fisco:** registrarla a nombre de un noble exento o de un templo (诡寄), dividirla en papeles, declararla baldía, sobornar al agrimensor (state §3). La brecha entre catastro y verdad es una presión fiscal.
- **La memoria de los testigos** es prueba en muchas culturas: los viejos de la aldea dicen dónde estaba el límite. Muere un viejo y se pierde una prueba.

## 10. Disputas y usurpación

- **De dónde salen:** límites que se movieron, ventas dobles (el mismo campo vendido a dos), escrituras falsas, herencias ambiguas, recompras no aceptadas, ocupantes con años de uso, dos culturas con normas distintas, el poderoso que toma.
- **Cómo se resuelven** (contracts §7, law): mediación de los ancianos o del clan, el tribunal (con su corrupción y su prueba), la fuerza (peleas entre aldeas por agua o límites, a veces con muertos), o un cultivador que decide.
- **Usurpación del poderoso** (豪强兼并): préstamos impagables, compras forzadas a precio vil, falsificación con el magistrado comprado, amenazas. Es la forma más común en que se concentra la tierra.
- **La decisión de un tribunal cambia el registro y a veces la posesión**, pero no las creencias de los perdedores: el rencor queda (npc-psychology: memoria y relaciones) y puede volver como venganza.

## 11. Concentración, reformas y presiones

- **El ciclo:** en tiempos buenos los campesinos tienen tierra; un año malo los endeuda (economy §8); el siguiente pierden la tierra con la prenda; los prestamistas y terratenientes acumulan; los sin tierra arriendan, migran o se van al monte. La concentración es una **presión** (causality) con umbral: hambre, bandidaje, sectas que reclutan, revuelta.
- **Reformas:** un estado puede rehacer el catastro, repartir tierras, limitar la propiedad, perdonar deudas o confiscar a los grandes. Cada reforma choca con los que pierden, que suelen ser los que mandan (state §3: "muchas reformas mueren ahí").
- **Guerra y colapso** redistribuyen: los dueños muertos o huidos, la tierra ocupada por soldados o colonos, los registros quemados.
- **Medir:** la sim headless reporta la distribución de la tierra por región (concentración, formas de tenencia, sin tierra) como métricas de calibración (tooling §6).

## 12. Muebles: marcas, robo, hallazgos y abandono

- **Lo que se lleva encima** es del que lo tiene, mientras nadie demuestre lo contrario. Las marcas (sellos, hierro en el ganado, marcas de gremio y de ceca) son registros pegados al objeto (economy §1: `marks`).
- **Robar** cambia la posesión, no el derecho ni la creencia del dueño (law). Lo robado conserva su origen y su historia: un reducidor lo "lava" vendiéndolo lejos, borrando marcas o fundiéndolo.
- **Reconocer lo propio:** el dueño que ve su espada en el cinto de otro la reconoce por percepción (perception: identificar) y puede reclamar, pelear o denunciar.
- **Hallazgos:** la norma decide si lo hallado es del que lo encuentra, del dueño del suelo, del soberano o del templo. Un tesoro enterrado (deep-history) tiene un dueño muerto y varios reclamantes vivos.
- **Abandono:** lo abandonado puede volverse de nadie según la norma; lo perdido no (el dueño sigue creyendo que es suyo). En ruinas y campos de batalla, todo es de quien llega primero, hasta que alguien con fuerza dice otra cosa.
- **Artefactos vinculados al alma** (crafts): el vínculo es verdad física, no norma; el objeto obedece a su dueño aunque cambie de manos. Romper el vínculo es un trabajo (family-lineage §8: lo sellado del cultivador).

## 13. Entre cultivadores

- **La norma de la fuerza:** entre cultivadores muchas culturas tienen una norma tácita de que el tesoro es de quien lo puede tomar y retener, y de que matar por un tesoro es normal (杀人夺宝). Es una norma, no una ley del mundo: hay sectas que la condenan y regiones donde un tratado entre sectas la limita. Su fuerza varía por mundo y por región (aprobado 2026-10-06): dura en zonas sin ley, atenuada donde hay tratados o un estado fuerte, así que cada seed da un mundo más duro o más civilizado.
- **Venas y cuevas:** las reclaman sectas, clanes y solitarios. El reclamo se sostiene con formaciones, guardias y reputación. Una vena sin dueño fuerte atrae disputas.
- **Dominios de secta y el estado:** la secta cobra tributo y el estado impuestos sobre la misma aldea; quién cobra de verdad depende del poder relativo (state: trono y sectas).
- **El Cielo no lee títulos.** El karma no sigue escrituras ni normas culturales: sigue el daño hecho y los compromisos rotos (heaven-karma §2). Quitarle la tierra a una viuda con un papel legal pesa igual que quitársela con una espada.

## 14. Bestias y espíritus

- **Territorio de bestias** (living-world): una bestia espiritual defiende su valle; para ella es suyo, y el que entra lo paga. Echarla es una cacería o una guerra.
- **Espíritus de lugar** (spirits): un espíritu de montaña o un dios local puede considerar la tierra suya y cobrar en ofrendas. Los que no ofrendan tienen malas cosechas o accidentes si el espíritu es real y tiene poder; si no, solo miedo.
- **Pactos de uso:** un clan que ofrenda al espíritu del río a cambio de pescar es un compromiso (contracts) con una parte no humana.

## 15. El jugador y el narrador

- **"Mío" es lo que el personaje cree.** Los paneles muestran lo que el personaje cree tener y en qué se basa ("la escritura está en el cofre", "lo heredé de mi padre"). Si la escritura es falsa o la tierra se vendió dos veces, no lo sabe, y el panel no avisa (aprobado 2026-10-06): lo descubre como cualquier secreto.
- **Acciones:** comprar, vender, arrendar, prendar, desmontar baldío, poner mojones, mudar un mojón de noche, falsificar, denunciar, pleitear, ocupar, cercar, robar, reclamar lo robado. Todo con los verbos del catálogo (actions) y las sesiones de oficio y diálogo.
- **El narrador** nunca dice "esto es tuyo" por fuera de las creencias del personaje, y nombra las formas de tenencia con el léxico de su cultura.

## 16. Escala (LOD)

| Resolución | Qué hay |
|---|---|
| Escena | Parcelas con geometría, mojones, cercas y documentos como objetos |
| Local | Parcelas individuales con derechos y cargas; disputas activas |
| Regional | Por asentamiento: superficie por forma de tenencia y por clase de hogar; terratenientes grandes como individuos |
| Mundo | Por región: concentración de la tierra, formas de tenencia, fracción sin tierra, brecha de registro |
| Historia | Grandes cambios: conquistas, reformas, concentraciones y repartos, con su huella en las genealogías y los registros |

- **Materialización** (simulation §6): al entrar a una aldea, sus parcelas se sintetizan desde los agregados (cuántos dueños, cuántos arrendatarios, qué tan concentrada), respetando los hechos fijados (la familia que perdió su tierra en la hambruna sigue sin ella: economy §16).

## 17. Implementación por fase

- **Fase 1:** parcelas de la aldea con un dueño, una forma de tenencia y una escritura o testigos; posesión, creencia y registro separados; robo de muebles con reclamo.
- **Fase 3:** venta, arriendo y aparcería como compromisos; prendas que se ejecutan; herencia con partición; comunales con reglas; mojones y disputas de límites.
- **Fase 5:** catastros del estado y su brecha; concentración y sin tierra como presión; métricas en la sim headless; materialización desde agregados.
- **Fase 6:** tierras de clan, culto, templo y dominio de secta; feudos; cercamientos; usurpación del poderoso; venas y cuevas disputadas.
- **Fase 7:** reformas, conquistas y repartos en la historia; restituciones que duran generaciones.
- **Fase 8:** dos culturas con normas distintas sobre la misma tierra; nómadas y agricultores; territorios de bestias y espíritus.

## Tests

- **Conservación:** la superficie total de la tierra no cambia por transferencias; cada cambio de titular tiene un evento con causa.
- **Tres capas independientes:** robar cambia la posesión sin cambiar el derecho ni la creencia del dueño; quemar una escritura cambia el registro sin cambiar el derecho.
- **Normas:** la prescripción ocurre solo en culturas que la tienen; un derecho bajo una norma no es reconocido por agentes de otra cultura que no la tiene.
- **Concentración:** con malas cosechas seguidas y crédito agrícola, la tierra se concentra; con reforma, se reparte (calibración).
- **Determinismo:** misma seed → mismas particiones, ventas y disputas.
- **Narrador:** el `PlayerView` no incluye derechos que el personaje no cree.

## Decisiones (aprobado 2026-10-06)
- **Todas las formas de tenencia como contenido por cultura,** incluida la de dos dueños en un campo (§4).
- **Prescripción según la cultura,** con los años en `content/` (§5).
- **La norma de la fuerza entre cultivadores** varía por mundo y región (§13).
- **El panel muestra lo que el personaje cree tener** y en qué se basa, sin avisar errores (§15).

## Decisiones tomadas en este borrador (revisables)

- **Tres capas** (posesión, creencia, registro) guardadas por separado.
- **Derechos como haz de incidentes,** con varios titulares sobre el mismo objeto.
- **Formas de tenencia como contenido** por cultura, incluidas las de dos dueños y la venta con recompra.
- **Parcelas con geometría solo en local y escena;** agregados por forma de tenencia en lo demás.
- **El Cielo no lee títulos,** sino daño y compromisos rotos.

## Preguntas abiertas

- Calibración: velocidad de concentración por crédito y malas cosechas; años de prescripción por cultura; frecuencia de disputas de límites; brecha de registro por calidad del estado.
