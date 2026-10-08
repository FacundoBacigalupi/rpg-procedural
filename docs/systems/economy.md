# Economía

> Estado: **borrador de diseño**. Cómo se producen, se mueven, se valoran y se consumen las cosas: bienes con procedencia, dinero que existe físicamente (metal acuñado, piedras espirituales), mercados por asentamiento donde el precio sale de agentes que **creen** saber lo que valen las cosas, comercio entre lugares, crédito y usura, subastas, gremios y monopolios, y las crisis que todo eso produce. Es la capa 3 de [causality.md](causality.md): **la escasez es el motor más grande de causalidad**.

Depende de: [causality.md](causality.md) (conservación, presiones, procedencia), [planet-gen.md](planet-gen.md) (suelos, minerales, vetas, piedras espirituales, qi), [living-world.md](living-world.md) (rutas, culturas, el conocimiento es físico), [information.md](information.md) (creencias `price`, frentes de noticias, la información como bien, secretos), [perception.md](perception.md) (ver calidad, detectar falsificaciones, ver quién compra), [npc-psychology.md](npc-psychology.md) (necesidades, utilidad, temperamento, teoría de la mente, deudas en relaciones), [body-health.md](body-health.md) (comida, nutrición, sustancias, medicina con precio), [cultivation.md](cultivation.md) (piedras, píldoras y tesoros como insumos del cultivo; cultivar quema dinero), [discovery.md](discovery.md) (recetas y técnicas como saber; obras con intención). Lo usan: [schemes.md](schemes.md) (sobornos, ruina económica de un rival, robo después de una subasta), [heaven-karma.md](heaven-karma.md) (usura y estafa como karma), [organizations.md](organizations.md), [contracts.md](contracts.md), [family-lineage.md](family-lineage.md) (hogar, dote, herencia), [social-structure.md](social-structure.md) (trabajo no libre, movilidad por deuda y riqueza), [crafts.md](crafts.md), [law.md](law.md), [state.md](state.md), [war.md](war.md) y [technology.md](technology.md).

## Principios
1. **Todo lo que tiene valor es una cosa (o un derecho sobre una cosa).** Bienes, monedas y piedras están en el ledger de conservación: se producen desde insumos concretos, se mueven y se consumen. Nadie gana dinero sin que alguien lo pague, y nadie crea dinero salvo acuñando metal que existe o extrayendo piedras que se formaron.
2. **No hay dinero infinito.** Todo agente (el jugador, cada NPC, cada tienda, cada secta) tiene lo que tiene y nada más: comprar es perder lo que pagás, vender es perder lo que entregás. Un comerciante no compra si no le queda plata, una tienda no repone sin comprarle a alguien, y la plata total de una región solo cambia por fuentes y sumideros físicos (§2b). Ningún ciclo de acciones puede generar riqueza sin que salga de algún lado.
3. **El precio no es una propiedad del mundo.** Es el resultado de acuerdos entre agentes que deciden según lo que **creen** (Ley 4). La verdad es solo el registro de transacciones que ocurrieron; ningún agente lo consulta. Lo que cada uno tiene son creencias `price` (information §1) con fecha y fuente.
4. **El valor es subjetivo; la conservación es física.** El valor de un bien para alguien sale de su utilidad (hambre, objetivos, miedo, prestigio). El valor no se conserva (una cosecha mala sube el precio del arroz sin crear arroz); las cantidades sí.
5. **Oferta y demanda emergen.** No hay curvas escritas: la oferta es lo que alguien produjo y está dispuesto a vender, y la demanda son agentes con necesidades y dinero. Las curvas son lo que el inspector **mide**, no lo que la sim usa.
6. **La información es ventaja económica.** El comerciante gana porque sabe precios que el otro no sabe, y pierde cuando su creencia está vieja. La asimetría de información (de precios, de calidad, de lo que viene) es la fuente principal de ganancia, de estafa y de crisis.
7. **Sin tablas de eventos económicos.** No hay "crisis aleatorias": una inflación tiene una mina detrás, una hambruna tiene una sequía, un acaparador o una guerra detrás, y una corrida bancaria tiene un rumor detrás.
8. **Determinista.** `rng.fork("market", marketId, day)` para el emparejamiento y los empates; `rng.fork("bargain", buyerId, sellerId, eventId)` para el regateo; `rng.fork("trade", merchantId, eventId)` para las decisiones de rutas.

## 1. Bienes
Un bien es un **tipo** (en `content/`) y existe en el mundo como **lotes** (fungibles) o **ítems** (únicos).

```ts
interface GoodKind {
  id: GoodId;                         // "rice", "iron_ingot", "spirit_stone_low", "qi_gathering_pill"
  category: GoodCategory;             // food | raw | material | tool | weapon | textile | medicine | pill | herb
                                      // | spirit_material | stone | luxury | text | artwork | animal | land | service
  unit: Unit;                         // kg, pieza, dosis, cabeza, mu (tierra)
  perishability?: DecayCurve;         // el arroz dura años si está seco, el pescado días; las hierbas espirituales pierden potencia
  qualityAxes: QualityAxis[];         // pureza, edad (hierbas), filo, ley del metal, grado de la píldora…
  fungible: boolean;                  // el arroz sí; una espada con nombre no
  bulk: number;                       // peso y volumen por unidad: decide cuánto cuesta transportarlo
  essence?: number;                   // qi contenido (piedras, hierbas, píldoras): entra al ledger de qi
  legality?: LegalityRef;             // prohibido, monopolio, gravado (law.md, state.md)
}

interface Lot {
  id: LotId;
  kind: GoodId;
  qty: number;
  quality: QualityVector;             // la verdad; cada observador percibe su versión (§6)
  holder: HolderRef;                  // agente, hogar, organización, lugar (un granero, una ruina)
  location: PlaceRef;
  originEventId: EventId;             // la cosecha, la fundición, la refinación, la extracción
  provenance: EventId[];              // por dónde pasó (resumido según tier, §16)
  marks?: MarkId[];                   // sellos, firmas, marcas de gremio, de ceca o de secta
}
```

- **Lotes que se parten y se juntan.** Vender la mitad de un saco parte el lote (los dos heredan el origen); mezclar arroz de dos campos crea un lote con los dos orígenes. Mezclar es una forma de estafa (arroz con piedras, píldoras buenas con malas).
- **Perecer es un proceso.** Lo perecible se degrada según la curva, el clima (planet-gen) y cómo se guarda (granero seco, bodega fría, caja de jade, anillo de almacenamiento si el mundo lo permite). Lo que se pudre no desaparece del ledger: pasa a desecho (abono, fuente de plagas en body-health §8).
- **Los ítems únicos** (una espada con nombre, una obra con intención, un anillo de un anciano muerto) son entidades con identidad: se reconocen, tienen historia y pueden llevar karma (heaven-karma) o una reputación propia ("la espada que mató al Carnicero").
- **La tierra es un bien.** Parcelas con suelo, agua y qi (planet-gen); se compran, se heredan, se arriendan, se pierden por deudas, se confiscan. No se mueve ni se produce: solo cambia de dueño o de calidad (suelos que se agotan y se recuperan: [planet-gen.md](planet-gen.md) §9).
- **Los servicios** (curar, enseñar, escoltar, refinar una píldora por encargo) no son lotes: son contratos de trabajo con un resultado ([contracts.md](contracts.md)). Su precio se forma igual.

## 2. Dinero
Cada cultura tiene uno o más **sistemas monetarios**, que salen de su historia (deep-history): qué metal tenía, quién acuñó primero, si hay un estado que garantice.

```ts
interface MonetarySystem {
  id: MonetarySystemId;
  culture: CultureId;
  issuer?: OrgId;                      // estado, secta, gremio, casa de cambio; sin emisor: trueque o metal a peso
  units: CurrencyUnit[];               // "wen" de cobre, "liang" de plata, lingote de oro, piedra espiritual de grado bajo…
  originEventId: EventId;
}

interface CurrencyUnit {
  id: CurrencyId;
  form: "barter" | "metal_by_weight" | "coin" | "note" | "spirit_stone" | "commodity";  // commodity: sal, seda, té, arroz
  material?: GoodId;                   // de qué está hecha: el cobre de la moneda está en el ledger de metal
  nominalContent?: number;             // cuánto metal o qi dice tener
  // el contenido real está en cada lote de monedas (quality: ley, peso, recorte)
}
```

### Trueque y bienes-moneda
En aldeas aisladas y culturas sin metal se comercia con trueque o con un bien que todos aceptan (sal, telas, arroz, ganado). El trueque necesita que cada uno quiera lo que el otro tiene, así que es lento: la moneda aparece cuando el comercio crece lo suficiente y hay alguien que la garantice o un metal que todos acepten (evento con causa en la historia).

### Moneda de metal
- **Acuñar** es convertir metal del ledger en monedas en una ceca (estado, secta, a veces un gremio o un falsificador). No crea valor: crea un formato confiable. El emisor cobra el **señoreaje** (la diferencia entre el valor nominal y el metal).
- **Ley y peso.** Cada lote de monedas tiene su ley (pureza) y su peso reales. El emisor en apuros **rebaja la ley** (más monedas con el mismo metal): es inflación con causa, y quien la descubre (pesando, mordiendo, con un ensayador) atesora las buenas y paga con las malas (las malas desplazan a las buenas).
- **Recortar y limar** monedas es un delito con huella; **falsificar** también. Detectarlas es percepción + habilidad (perception §5): un cambista lo ve, un campesino no.
- **Metal escaso.** El metal de las monedas compite con el de las herramientas y las armas (§11). Una guerra que pide hierro y bronce deja sin cambio a los mercados.

### Billetes y letras de cambio
- Una **letra** es un derecho: "la casa X paga N liang a quien presente esto en su sucursal de Y". Permite mover valor sin mover metal (menos riesgo en los caminos). El metal no se mueve hasta que alguien cobra.
- Un **billete** de un estado o de una casa grande circula como dinero mientras la gente **crea** que se puede cambiar. Es una creencia colectiva (information §9) con un emisor detrás. El crédito crea derechos, no metal: si el emisor emite más de lo que tiene, el ledger de metal no cambia, pero los derechos superan las reservas, y eso es una presión (§13).
- Toda letra y billete es un objeto con `originEventId`, sellos y firmas: se puede perder, robar, falsificar o volver papel mojado si quiebra el emisor.

### Piedras espirituales
Ver §12. Son la moneda del mundo de los cultivadores y, a diferencia del metal, **tienen un uso real**: se queman para cultivar, alimentar formaciones y refinar. Su valor no depende de que nadie las garantice.

### Tipos de cambio
Entre sistemas monetarios (cobre por plata, plata del reino A por plata del reino B, plata por piedras) el cambio es un precio más, que se forma igual (§5) en las casas de cambio y en los puertos. El cambio entre plata y piedras es el **abismo entre los dos mundos** hecho número: para un campesino, una piedra de grado bajo es un año de trabajo; para un discípulo interno, es una tarde.

## 2b. Nadie tiene infinito: tenencia, fuentes y sumideros
Todo lo que vale está **en manos de alguien o en algún lugar**: en el bolsillo del jugador, en el cofre del comerciante, en el granero del clan, en el tesoro de la secta, enterrado bajo el piso, en un anillo perdido en una ruina, en la veta todavía sin sacar. No existe un "dinero del mundo" abstracto ni una tienda con fondos sin fondo.

```ts
interface Holdings {
  holder: HolderRef;                   // agente, hogar, organización o lugar
  lots: LotId[];                       // bienes, monedas, piedras, letras: todo es un lote (§1)
  claims: ClaimId[];                   // lo que le deben (préstamos, letras a cobrar): derechos, no cosas (§2, §8)
  liabilities: ClaimId[];              // lo que debe
}
```

### Comprar es perder, vender es perder
- Toda transacción es un **intercambio de lotes** entre dos tenencias (§5, `Transaction`): el comprador entrega monedas y recibe el bien; el vendedor al revés. Nada se suma sin restarse de otro lado.
- **Cada NPC tiene su límite.** El panadero tiene la plata de lo que vendió esta semana menos lo que gastó; el buhonero, lo que trae en el carro y en la bolsa. Si el jugador quiere venderle diez espadas a un herrero de aldea que tiene plata para dos, le compra dos (o ninguna, si no las necesita), o le ofrece trueque, o le paga con una letra contra alguien de la ciudad. Una aldea pobre **no puede pagar** un tesoro: para venderlo hay que ir a donde está la plata.
- **El que compra mucho de algo paga cada vez menos**, porque su reserva cae a medida que se llena de stock y se vacía de plata (§4). Vender lo mismo una y otra vez en el mismo lugar rinde cada vez menos.
- **Las tiendas no reponen de la nada.** El stock de una tienda es lo que compró a productores, comerciantes o al jugador. Si nadie le trae hierbas, no hay hierbas. Si el jugador compra todo el arroz, el arroz se acabó hasta la próxima cosecha o el próximo comerciante.
- **Los precios responden a lo que hace el jugador** igual que a lo que hace cualquiera: comprar mucho sube el precio para él y para todos; vender mucho lo baja. El arbitraje del jugador cierra la diferencia que explota.

### Fuentes y sumideros
La cantidad total de cada cosa solo cambia por estas vías, todas eventos con causa y todas en el ledger:

| Entra al mundo (fuente) | Sale del mundo (sumidero) |
|---|---|
| **Extracción:** metal de una veta, piedras de una mina, sal de una salina, madera, caza, pesca, hierbas (sale de un stock natural finito: planet-gen, ecología) | **Consumo:** comida que se come, medicina que se usa, leña que se quema |
| **Producción:** cosechas, crías, artesanía (lo nuevo sale de insumos + trabajo + tierra + qi) | **Combustible del cultivo:** piedras, píldoras y tesoros absorbidos (su qi pasa al cultivador y el resto vuelve al ambiente: cultivation §5) |
| **Formación natural:** tesoros y materiales espirituales que se forman con el tiempo (planet-gen §5) | **Insumo de otra cosa:** el material que se usa en una forja, una formación o una píldora deja de existir como material y pasa a ser parte del producto |
| **Acuñación:** convierte metal ya extraído en monedas (no agrega metal, cambia el formato) | **Deterioro:** se pudre, se oxida, se rompe, se gasta, pierde qi (§12) |
| | **Pérdida:** hundido, enterrado con un muerto, olvidado en una ruina (sigue existiendo, pero fuera de la economía hasta que alguien lo encuentre) |
| | **Destrucción y ofrenda:** quemado en un incendio, en una guerra o en un altar |

- **La plata que circula en una región** es la que se acuñó o llegó, menos la que se fue (comercio, tributos, saqueo), se fundió o se enterró. Una región que importa más de lo que exporta se queda sin plata y pasa al trueque o al crédito.
- **Una mina nueva es la única forma de "imprimir" piedras**, y es lenta, finita, se pelea y se nota en los precios (§12). Una piedra quemada para cultivar sale del mercado para siempre.
- **El trabajo agrega valor, no dinero.** Convertir hierbas en una píldora vale más que las hierbas, y quien lo hace puede cobrar más. Pero para cobrarlo alguien tiene que tener la plata y querer pagarla: la ganancia del alquimista es plata que sale del bolsillo de otro.
- **Prestar no crea plata** (§8): crea un derecho. Si el deudor no paga, el derecho se pierde y la plata no aparece.

### Trucos que no funcionan
El diseño cierra los bucles clásicos de dinero infinito porque no hay ninguna fuente fuera de la tabla de arriba:
- **Comprar barato y vender caro en el mismo lugar, una y otra vez:** el vendedor sube su precio a medida que se vacía, el comprador baja el suyo a medida que se llena y se queda sin plata.
- **Fabricar y vender sin parar:** los insumos se agotan o suben de precio, la demanda se satura y los compradores se quedan sin plata.
- **Vender botín infinito:** el botín existe solo si alguien lo tenía (Ley 1); los bandidos que matás tienen lo que robaron, no una tabla de botín.
- **Esperar que la tienda vuelva a tener plata:** solo la tiene si vendió algo a alguien que tenía plata.
- **Duplicar con letras o billetes:** una letra falsa o duplicada es un fraude que se descubre al cobrarla contra las reservas del emisor.

Hacerse rico es posible, pero **la riqueza siempre sale de algún lado**: de una veta, de una cosecha, del trabajo de otros, de quien perdió, de quien te pagó. Eso es lo que la vuelve una presión causal (envidia, robo, tributos, intrigas) y no un número.

## 3. Producción
Producir es una **acción** (del mismo catálogo del jugador) o un proceso de un hogar, taller u organización que convierte insumos en productos con trabajo, herramientas, saber y tiempo.

```ts
interface ProductionProcess {
  id: TechProcessId;                   // "cultivar arroz", "fundir hierro", "refinar píldora de reunir qi"
  inputs: Array<{ good: GoodId; qty: number; qualityReq?: QualityReq }>;
  labor: { skill: SkillId; hours: number; minLevel: number };
  tools?: GoodId[];                    // se gastan (desgaste: el ledger los degrada)
  site?: SiteRequirement;              // campo con suelo y agua, mina, fragua, horno alquímico, cueva con qi
  knowledge?: RecipeId | TechniqueId;  // saber cómo (discovery §8): sin receta no hay proceso
  essence?: number;                    // qi consumido (conservación: sale de la celda o de piedras)
  outputs: OutputFn;                   // cantidad y calidad = f(insumos, habilidad, herramienta, sitio, clima, rng)
  byproducts?: GoodId[];               // escoria, desechos, toxinas residuales (crafts.md)
}
```

- **Agricultura:** el rendimiento sale del suelo, el agua, el clima del año (planet-gen), la técnica ([technology.md](technology.md)), el trabajo y las plagas. Una helada temprana es una mala cosecha con causa.
- **Extracción:** minas, canteras, bosques, pesca, caza y recolección **sacan de un stock** (veta, población de peces, de bestias, de hierbas: ecología, [living-world.md](living-world.md) §8). Sobreexplotar agota el stock: suben los precios y bajan los rendimientos, sin que nadie lo decida.
- **Oficios:** artesanos, herreros, tejedores, alquimistas, forjadores de formaciones. Cómo se hace cada cosa (sesiones por pasos, recetas, habilidad) va en [crafts.md](crafts.md); acá solo importa que convierten insumos con precio en productos con precio.
- **El saber es un factor de producción.** La receta de una píldora o el secreto del acero templado valen porque pocos los tienen (information §8). Un gremio protege recetas; un espía las roba; una receta que se difunde baja los precios del producto.
- **Calidad con variación.** La habilidad, la herramienta y la suerte dan calidad distinta: hay buenos y malos herreros, y se nota (para quien sabe mirar).

### El hogar como unidad
La unidad económica básica es el **hogar** (familia y dependientes): junta ingresos, comparte comida, tiene un presupuesto, ahorra, se endeuda y hereda ([family-lineage.md](family-lineage.md)). Los NPCs deciden dentro del presupuesto del hogar: el hijo que se va a la secta es una boca menos y un ingreso menos.

### Trabajo
- **Formas:** trabajo propio (campesino con su tierra), arrendamiento (paga renta en especie o en plata), jornal, servidumbre, esclavitud ([social-structure.md](social-structure.md) §7), aprendizaje (el aprendiz trabaja por casa, comida y saber).
- **Salarios** son precios del trabajo: suben cuando faltan brazos (después de una plaga, una guerra o una leva) y bajan cuando sobran (migraciones, hambrunas).
- **Los cultivadores trabajan distinto:** misiones de secta pagadas en puntos de contribución o en piedras, escoltas, cacería de bestias, refinación por encargo. Su trabajo vale órdenes de magnitud más que el de un mortal.

## 4. Consumo y demanda
- **Necesidades** (npc-psychology §7, body-health): comida, agua, abrigo, calor, medicina, y para los cultivadores, qi y recursos. Generan demanda **urgente**, que paga lo que haga falta.
- **Objetivos:** herramientas para trabajar, una dote, el ingreso a una secta, armas para la venganza, píldoras para una ruptura. Generan demanda **planificada**.
- **Prestigio y gusto:** seda, jade, obras de arte, banquetes, una espada famosa. Generan demanda **social**, que crece con la riqueza y con los valores (`status`, `beauty`) y los gustos personales ([npc-psychology.md](npc-psychology.md) §16).
- **Sustancias:** la adicción (body-health §10) genera una demanda que no baja con el precio. Quien controla el suministro tiene poder.
- **El valor de reserva** de un agente para un bien es lo máximo que pagaría (o lo mínimo que aceptaría por vender) según su utilidad, su presupuesto y lo que cree que cuesta conseguirlo en otro lado:
  ```
  reserva_compra(a, g) = min( valor_utilidad(a, g), presupuesto_disponible(a), precio_creído_alternativo(a, g) + costo_de_buscarlo(a) )
  ```
  La elasticidad de la demanda no se escribe: sale de cuántos agentes tienen reservas por encima de cada precio.

## 5. Mercados
Cada asentamiento (y algunos lugares: puertos, pasos, ferias de secta) tiene un **mercado**: el conjunto de lugares y momentos donde se encuentran compradores y vendedores.

```ts
interface Market {
  id: MarketId;
  place: PlaceRef;
  venues: Venue[];                    // plaza de feria, tiendas, casa de cambio, casa de subastas, muelle, mercado negro
  schedule: MarketSchedule;           // feria cada 5 días, mercado diario, feria anual de la secta
  monetary: MonetarySystemId[];       // qué monedas se aceptan (y a qué descuento las de afuera)
  rules: MarketRule[];                // impuestos, licencias de gremio, precios fijados, bienes prohibidos
  tape: Transaction[];                // la verdad: transacciones ocurridas (compactadas según tier)
  originEventId: EventId;
}

interface Transaction {
  id: EventId;                        // toda transacción es un evento
  time: Time;
  buyer: AgentId; seller: AgentId;
  lot: LotId; qty: number;
  paid: Array<{ lot: LotId; qty: number }>;   // monedas, piedras o bienes (trueque)
  perceivedBy: PerceptRef[];          // quién la vio: así nacen las creencias de precio
  causes: CauseRef[];
}
```

### Cómo se forma el precio (modo individual)
Cerca del jugador no hay un "precio del mercado": hay vendedores con mercadería y compradores con necesidades, y cada uno decide.
1. **Cada vendedor fija un precio pedido** según lo que cree que vale (sus creencias `price`), lo que le costó, cuánto stock tiene, cuánto tarda en pudrirse y cuánto necesita la plata. Un vendedor con arroz que se moja vende barato; uno con el único sanador del pueblo cobra caro.
2. **Cada comprador** busca entre los vendedores que conoce o que ve (perception: puestos, pregones), compara contra su reserva y elige, o regatea (§6).
3. **Después de cada día de mercado**, cada vendedor actualiza su creencia con lo que pasó: si vendió todo rápido, pide más; si no vendió, baja o espera. Los compradores que pagaron o no pudieron pagar actualizan las suyas.
4. **El precio del día** que ve el inspector es la mediana de las transacciones (`tape`). Nadie en el mundo lo ve: lo que se sabe en el pueblo es lo que cada uno vio, pagó o escuchó.

### Cómo se forma el precio (modo agregado)
Lejos del jugador, en tier 0-1, cada mercado tiene un **precio de referencia** por bien y un stock agregado. Por período:
```
exceso = (demanda_agregada(p) − oferta_agregada(p)) / max(oferta, ε)
p' = p × (1 + k_bien × clamp(exceso, −c, c))
```
con `k_bien` según qué tan rápido reacciona ese bien (la comida reacciona rápido, la tierra lento) y el stock de comerciantes y graneros como amortiguador. Las reglas agregadas se calibran contra el modo individual (causality §5.1): el precio de referencia debe ser, en promedio, la mediana que darían los agentes. Al materializar el mercado, los vendedores reciben creencias de precio muestreadas alrededor de la referencia, con la dispersión que da la asimetría de información del lugar.

### Las creencias de precio
- Se forman al **ver** transacciones, al **pagar** o **cobrar**, al **preguntar** ("¿cuánto la libra?") y al **escuchar** ("en Yunshan el hierro está por las nubes"). Tienen `asOf` y envejecen (information §1).
- **La dispersión de precios es información.** En un pueblo chico casi todos saben lo que vale el arroz; nadie sabe lo que vale una hierba de mil años. Cuanto más raro el bien y menos transacciones, más dispersas las creencias y más gana el que sabe.
- **Los precios viajan como noticias** (frentes de information §4), con el retraso de las rutas. Un comerciante que llega primero con la noticia de una mala cosecha compra antes de que suba.

### Mercado negro
Bienes prohibidos (venenos, técnicas demoníacas, objetos robados, personas), bienes de monopolio fuera del canal oficial (sal de contrabando) y todo lo que evita impuestos. Tiene sus propios lugares (el patio de atrás de la posada, la feria de medianoche), su propia red de confianza (hay que conocer a alguien) y precios con prima de riesgo. Detalle en [law.md](law.md) §12.

## 6. Regateo, calidad y estafa
### Regateo
El regateo es un diálogo con actos de habla (npc-psychology §8): ofrecer, contraofertar, mostrar desinterés, invocar una relación, mentir sobre otras ofertas, amenazar, irse.
- Cada parte tiene su reserva (§4) y una **creencia sobre la reserva del otro** (teoría de la mente): si el vendedor cree que el comprador está desesperado (lo vio herido, sabe que su hijo está enfermo), pide más.
- **Señales que se filtran:** la urgencia, la riqueza (ropa, anillos, aura), el interés (mirar demasiado un objeto) se perciben (perception) y entran en la creencia del otro. Un cultivador que oculta su aura paga precio de mortal; uno que la muestra, precio de cultivador.
- **Temperamento y relación:** el impaciente cede rápido; el orgulloso no regatea con un inferior; el amigo hace precio; el que tiene miedo regala.
- El resultado es un acuerdo dentro de la zona entre reservas (si existe) o la ruptura. El punto exacto lo deciden las creencias, el poder de negociación (alternativas creídas) y `rng.fork("bargain", …)` para los empates.
- **El jugador regatea en texto libre:** el parser traduce lo que dice a actos de habla; la sim decide cómo reacciona el NPC. El narrador verbaliza; nunca fija el precio.

### Calidad incierta
- El comprador no ve la calidad real del lote: **percibe** una versión según su habilidad de tasación (appraisal) y sus sentidos (perception §5). Un herbolario ve la edad de una raíz; un campesino ve una raíz.
- **El mercado de limones.** Donde la calidad no se puede verificar, los compradores pagan como si fuera mediocre, los que tienen lo bueno no venden, y queda lo malo. Contra eso aparecen **marcas y sellos** (de gremio, de secta, de alquimista famoso), **tasadores** que cobran por mirar, **garantías** (contratos) y **reputación** del vendedor (information §9). Todo eso emerge porque resuelve un problema real.
- **Falsificar una marca** es una estafa de alto rendimiento hasta que alguien la detecta, y entonces cae la reputación de la marca real también.

### Estafa
Vender arroz mojado por seco, píldoras de grado bajo por medio, una hierba de diez años por una de cien, un mapa falso (information §5), una técnica incompleta o con defectos a propósito. Es una mentira con un objeto: deja huella (el objeto existe, el estafado puede descubrirlo después), genera resentimiento y reputación, y en algunos mundos karma (heaven-karma: engañar a quien confía).

## 7. Comercio entre asentamientos
- **Los comerciantes son agentes** que hacen arbitraje con sus creencias: compran donde creen que algo es barato y lo llevan donde creen que es caro, si la diferencia paga el viaje.
  ```
  ganancia_esperada = Σ (precio_creído_destino − precio_creído_origen) × qty
                     − costo_ruta(peso, distancia, terreno, peajes)
                     − pérdida_esperada(perecibilidad, bandidos, clima)
                     − costo_de_oportunidad(tiempo)
  ```
- **Costo de la ruta:** sale de las rutas de living-world §6 (pendiente, ríos navegables, pasos) y del medio (cargador, mula, carro, barco, anillo espacial para quien tiene uno). Lo pesado y barato (grano, piedra) viaja poco; lo liviano y caro (seda, píldoras, sal) viaja lejos.
- **Gradientes de precio por distancia** salen solos: la sal es barata en la costa y cara en la montaña, y el precio sube con cada paso.
- **Errores colectivos.** Si cinco comerciantes oyen la misma noticia vieja ("el arroz está carísimo en Qingshui") y llegan todos juntos, inundan el mercado y pierden. La sobrerreacción tiene causa: la misma creencia en muchas cabezas.
- **Caravanas** juntan comerciantes para repartir riesgo y contratar escolta. Llevan bienes, noticias, enfermedades, técnicas y espías (information §4, body-health §8).
- **Peajes y aduanas** en puentes, pasos y puertos: quien controla un cuello de botella cobra (living-world §6). Evitar el peaje es contrabando.
- **Comercio a distancia con letras** (§2): un comerciante vende en el sur, cobra con una letra y la cambia en el norte. Las casas de cambio con sucursales son organizaciones con un capital de confianza.

## 8. Crédito, usura y quiebra
Prestar es dar algo hoy a cambio de una promesa. El **modelo de compromiso** (quién debe qué, con qué garantía, qué pasa si no cumple, quién lo hace cumplir) es el de [contracts.md](contracts.md), que unifica deudas, vínculos y lazos kármicos: un `Loan` es la vista económica de un `Commitment` de tipo préstamo (contracts §13). Acá va su lado económico.

```ts
interface Loan {
  id: LoanId;
  lender: HolderRef; borrower: HolderRef;
  principal: Array<{ good: GoodId; qty: number }>;   // plata, piedras, semilla, arroz para llegar a la cosecha
  interest: InterestTerms;              // simple o compuesto, por período; en especie o en moneda
  term: Time;                           // a la cosecha, a un año, a la vuelta del barco
  collateral?: Array<LotId | LandId | HolderRef>;   // tierra, joyas, un hijo como sirviente, el propio trabajo
  guarantors?: AgentId[];               // fiadores: responden si el deudor no paga
  enforcement: Enforcement[];           // social (reputación), legal (tribunal), de organización (clan, secta), kármico (juramento)
  originEventId: EventId;
}
```

- **Quién presta:** usureros, casas de empeño, comerciantes ricos, clanes, templos, sectas (a sus discípulos y a las aldeas que protegen), casas de cambio. Cada uno con sus garantías y sus formas de cobrar.
- **La tasa de interés** sale del riesgo que cree el prestamista (reputación del deudor, colateral, si lo puede cobrar), de lo escaso que es el dinero, del poder de negociación (el desesperado acepta cualquier tasa) y de la ley y la religión (prohibiciones de usura, que empujan a disfrazar el interés).
- **El crédito agrícola** es el más común y el más cruel: semilla en primavera, pago con la cosecha. Una mala cosecha deja deudas que se acumulan; dos seguidas hacen perder la tierra.
- **Incumplir** dispara lo que diga el préstamo: se ejecuta el colateral (la tierra pasa al prestamista, el hijo pasa a servir), se cobra a los fiadores, el deudor pierde reputación, huye o termina en **servidumbre por deudas** ([social-structure.md](social-structure.md) §7). También puede matar al acreedor: las deudas son una presión de causality §1.
- **Cadenas de deuda.** El que debe a uno y le prestan otros: cuando cae uno, caen los que dependían de que pagara. Las quiebras se contagian por el grafo de deudas.
- **Empeño.** Dejar un objeto a cambio de dinero, con plazo para recuperarlo. La casa de empeño acumula objetos con historia (y a veces robados): es un lugar donde aparecen cosas.
- **Deudas que no son plata** (favores, vida, karma) viven en relaciones (npc-psychology §6) y en heaven-karma; [contracts.md](contracts.md) las une con las de plata.

## 9. Subastas
Las casas de subastas son instituciones centrales del mundo de los cultivadores: ahí aparecen los tesoros, las píldoras raras y las técnicas, y ahí se cruzan los que no deberían cruzarse.

```ts
interface Auction {
  id: AuctionId;
  house: OrgId;                         // la casa: su reputación de discreción y garantía es su capital
  lots: Array<{ lot: LotId; consignor: HolderRef; reserve?: number; appraisal: AppraisalRef }>;
  format: "ascending" | "descending" | "sealed_first" | "sealed_second";
  anonymity: AnonymityLevel;            // palcos privados, máscaras, formaciones que ocultan el aura
  fee: number;                          // comisión de la casa
  originEventId: EventId;
}
```

- **Las pujas se deciden por utilidad** con la reserva de cada uno (§4) y lo que cree de los demás postores. La puja ascendente revela información: quién sube, cuánto, con qué voz.
- **Pujar revela.** Pagar una fortuna por una hierba que solo sirve para romper un umbral de fuego le dice a quien mire (perception, teoría de la mente) que alguien con raíz de fuego está por romper. El anonimato de la casa es protección y es mercancía, y se puede comprar o romper (sobornar a un empleado, sentido espiritual).
- **El robo después de la subasta** (el clásico) no es un guion: sale de agentes que creen que alguien salió con algo valioso, creen que pueden con él y tienen los valores que lo permiten. La casa ofrece escolta o salida secreta por un precio.
- **Postores falsos** (la casa o el consignante suben el precio con un cómplice) son una intriga (schemes) con riesgo de ser descubiertos.
- **Tasación de la casa:** la casa describe los lotes según **su** tasación, que puede equivocarse (o mentir). Una ganga es un error de tasación que alguien vio.

## 10. Gremios, monopolios y cárteles
- **Gremios:** organizaciones de un oficio (herreros, alquimistas, comerciantes de sal) que controlan quién puede ejercer (licencias, aprendizaje), fijan calidad y precios, protegen recetas y negocian con el poder. Su estructura interna va en [organizations.md](organizations.md) §13; acá importa su efecto: precios más altos y estables, barreras de entrada, calidad mínima, y la tentación de cada miembro de romper el acuerdo.
- **Monopolios de estado o de secta:** sal, hierro, piedras espirituales, ciertas hierbas. Quien tiene la mina o el valle fija el precio dentro de lo que la demanda y el contrabando le permiten.
- **Cárteles** (comerciantes que acuerdan no competir) son estables mientras a cada uno le convenga más cumplir que traicionar. Lo decide la utilidad de cada miembro: el que necesita plata rompe el acuerdo, y el resto lo castiga o se desarma.
- **Precios fijados por la autoridad** (un magistrado que topa el precio del arroz en una hambruna) producen lo que tienen que producir: los vendedores esconden el grano, aparece el mercado negro, y el arroz desaparece del mercado oficial.
- **Acaparar:** comprar todo un bien para subirle el precio. Funciona si el acaparador cree (bien) que la oferta no va a llegar. Es una intriga económica (schemes) y en una hambruna, un crimen que se paga con la vida si la gente se entera.

## 11. Metal escaso
El metal es el cuello de botella de la tecnología y de la moneda.
- **Viene de vetas concretas** (planet-gen §6) que se agotan. La cantidad total de cada metal en el mundo es la que se extrajo menos la que se perdió (oxidada, hundida, enterrada con un muerto).
- **Se recicla:** armas fundidas para hacer monedas, monedas fundidas para hacer campanas, campanas fundidas para la guerra. Cada conversión es un evento y el ledger lo sigue.
- **Compite entre usos:** herramientas (productividad agrícola), armas (guerra), moneda (comercio), objetos rituales y de prestigio. Una guerra larga deja a los campesinos sin azadas y a los mercados sin cambio.
- **Metales espirituales** (hierro estelar, oro yin, cobre de fuego) se forman donde el qi transformó la roca (planet-gen §5): son raros, no se pueden fundir con un fuego mortal y valen como tesoros. Cómo se trabajan: [crafts.md](crafts.md) §5.
- **La edad del metal de cada cultura** (bronce, hierro, acero) sale de lo que tiene cerca y de lo que descubrió ([technology.md](technology.md); discovery). Una cultura sin estaño no tiene bronce.

## 12. Piedras espirituales
Qi cristalizado en la roca (planet-gen §5), la moneda de los cultivadores.
- **Se forman** donde el qi se acumula en la roca durante mucho tiempo (venas, cuencas, fallas). Una mina es un stock finito con una tasa de formación muy lenta: en la escala de una vida, se agota.
- **Grados por contenido de qi.** Cada grado (bajo, medio, alto, supremo; los nombres los pone cada cultura) tiene un contenido de esencia en el ledger de qi y una pureza. Las conversiones "cien de bajo por una de medio" son precios, no leyes: reflejan contenido, pureza, rareza y lo que cada una permite hacer (una formación grande necesita piedras de grado alto, no muchas de bajo).
- **Se consumen.** Cultivar, alimentar formaciones, refinar píldoras, cargar talismanes: el qi de la piedra pasa al cultivador o al artefacto, y el resto vuelve al ambiente (cultivation §5). Cultivar quema dinero: un cultivador fuerte es un sumidero de riqueza.
- **Pierden qi con el tiempo** si no se guardan bien (cajas de jade, formaciones de sellado): el qi vuelve a la celda. Atesorar piedras tiene costo, como guardar grano.
- **Inflación por minas.** Una mina nueva (un evento con causa: alguien la encontró) aumenta la oferta. El precio de las piedras en plata y en bienes cae primero cerca de la mina y después a medida que llegan las piedras y la noticia por las rutas. Quien se entera antes vende piedras y compra bienes; quien tiene ahorros en piedras pierde.
- **Deflación por consumo.** Una época de muchos cultivadores, o una guerra de sectas con formaciones encendidas, quema piedras más rápido de lo que se extraen. Suben de valor y los mortales que tienen alguna se vuelven ricos (o blanco de robo).
- **Mortales y piedras.** Un mortal no puede usar una piedra (y el qi denso le hace mal a la larga: planet-gen §5c), pero puede tenerla, venderla o pagar con ella. En la frontera entre los dos mundos (pueblos al pie de una secta) la piedra circula como oro.
- **Las sectas pagan en piedras** (sueldos, recompensas de misión, aportes de contribución) y cobran en piedras (acceso a cuevas, técnicas, píldoras). El control de las minas es la base económica de una secta, y la causa de sus guerras.

## 13. Crisis
Ninguna es aleatoria: cada una es la descarga de una presión que el estado ya acumulaba (causality Ley 3).

| Crisis | Presión que la causa | Cómo se propaga |
|---|---|---|
| **Hambruna** | Mala cosecha, guerra, plaga, acaparamiento, impuestos en especie | Precios de la comida suben más rápido que los salarios: hay hambre **con comida en el mercado** (la tiene quien puede pagarla). Venta de tierras, de hijos, migración, bandidaje, revueltas |
| **Inflación** | Mina nueva, rebaja de ley, emisión de billetes sin respaldo, saqueo de un tesoro | Por las rutas, con la noticia y con las monedas |
| **Corrida** | Rumor (verdadero o falso) de que una casa no puede pagar sus letras | Todos van a cobrar a la vez; si los derechos superan las reservas, la casa quiebra **aunque el rumor fuera falso**. Es un rumor que se cumple solo |
| **Quiebra en cadena** | Deudor grande que cae | Por el grafo de deudas (§8) |
| **Burbuja** | Un rumor sobre un bien ("la hierba X cura la vejez", "en el valle hay una mina") | Compras por la creencia, no por el uso; termina cuando la creencia cae (evidencia, una muerte, el desmentido de alguien creíble) |
| **Colapso de moneda** | Pérdida de confianza en el emisor (derrota, muerte del emperador, fraude descubierto) | Vuelta al metal a peso, al trueque o a la moneda de otro |
| **Escasez de metal** | Guerra, agotamiento de vetas, rutas cortadas | Sin herramientas ni cambio: cae la productividad y el comercio |

Las crisis son las que convierten la economía en historia: dejan memorias, odios (a los usureros, a los acaparadores, a la secta que subió los tributos), tabúes y mitos.

## 14. Rentas, tributos y transferencias
- **Renta de la tierra:** el arrendatario paga al dueño, en especie o en plata.
- **Tributo de protección:** las aldeas al pie de una secta le pagan en grano, trabajo o hijos con talento a cambio de protección contra bestias y bandidos. Cuando la protección falla, el tributo se discute (presión).
- **Impuestos:** del estado, con burocracia y corrupción ([state.md](state.md) §4); acá solo como flujo que sale de hogares y mercados.
- **Ofrendas** a templos, a ancestros ([spirits.md](spirits.md) §6, §11) y al Cielo: bienes que salen de la economía productiva (se queman, se entierran, se los come el templo).
- **Robo y saqueo:** también son transferencias (conservación: lo robado sigue existiendo y aparece en otro lado: en la casa de empeño, en el mercado negro, en la cueva del bandido).
- **Herencia:** la riqueza pasa con la muerte ([family-lineage.md](family-lineage.md)). Un cultivador que muere sin heredero deja un anillo lleno en algún lado: un tesoro con causa.

## 15. El jugador y el narrador
- **El jugador ve lo que su personaje cree:** precios con fecha y fuente ("el arroz estaba a 12 wen la semana pasada, según la panadera"), la calidad que percibe, lo que sabe de las deudas propias y ajenas. Nunca ve la mediana real ni la calidad real.
- **Comerciar es una acción del catálogo** (Fase 1: comerciar). Comprar, vender, regatear, pedir prestado, empeñar, pujar, contratar, tasar, cambiar moneda. Todo en texto libre, traducido a actos y resuelto por la sim.
- **El narrador** recibe la transacción como la percibió el personaje (lo que pagó, lo que recibió, cómo reaccionó el otro) y lo que el personaje sabe del mercado. No dice "te estafaron" si el personaje no lo sabe: describe la raíz que compró como la vio.
- **Inventario como ledger:** el inventario del jugador es una lista de lotes con su calidad **percibida** y su procedencia conocida ("comprado al buhonero en la feria del 3er mes").
- **Inspector god-mode:** `tape` de cada mercado, curvas medidas de oferta y demanda, flujos entre mercados, el grafo de deudas, la verdad de cada lote, la masa monetaria por sistema (metal acuñado, derechos emitidos, reservas), y el ledger de piedras (extraídas, quemadas, perdidas).

## 16. Escala (LOD)
- **Tier 4 (mercado del jugador y lo que tiene cerca):** vendedores y compradores individuales, regateo con actos de habla, transacciones como eventos completos, lotes con procedencia completa.
- **Tier 3:** comerciantes y prestamistas importantes como agentes; el resto del mercado como población de compradores con reservas muestreadas; transacciones compactadas por día y bien.
- **Tier 2:** el mercado es un precio de referencia por bien con stocks agregados y las reglas de §5 (modo agregado), con algunos agentes nombrados (el usurero, el mercader de sal).
- **Tier 0-1 (regiones lejanas y la historia):** flujos entre mercados por un modelo de gravedad sobre las rutas (`flujo ∝ diferencia_de_precio × capacidad_de_ruta / costo`), precios de referencia anuales, deudas como agregados por clase social, crisis como procesos de riesgo con presiones medibles (hambruna = déficit de comida × precio / ingreso de los pobres).
- **Compactación del ledger:** los lotes fungibles viejos pierden el detalle de procedencia (queda el origen y el último dueño); las transacciones se resumen en series de precios; los ítems únicos conservan su historia.
- **Materialización:** al bajar de tier, los hogares reciben riqueza, deudas y creencias de precio coherentes con los agregados y con su historia (la familia que perdió la tierra en la hambruna de hace 20 años es arrendataria y odia al usurero).

## Implementación
- **Fase 1:** lotes con origen, inventarios, una moneda (cobre) y trueque; la acción comerciar con precio fijo por vendedor y regateo simple; comida que se consume y se pudre.
  - *Hecho (Hito 1b):* `content/goods/` (cobre, grano, espigueo, forraje, mariscos con vida media) y `src/sim/economy/` (`price.ts`, `spoilage.ts`). El precio no es un estado del mundo: cada parte tiene una reserva según sus días de comida (nadie vende por debajo de 60 días, nadie compra por encima de 200) y `strike` cierra el trato con un margen de regateo. `trade` mueve bienes y cobre por el ledger; `work` rinde grano desde la fuente `ext:harvest`; la rutina cosecha en el campo; el proceso diario `life.spoilage` manda lo podrido al sumidero `ext:rotted`. Las despensas arrancan con lo justo para llegar a la próxima cosecha (`larderNeeded`, más un mes de margen) y 40 monedas por persona. Calibración (cosecha, precios, despensa) abierta para el Hito 1c.
  - *Hecho (Hito 1b, resto):* `store` (pasar lo que lleva a la despensa), cantidades y nombres en la lengua del jugador en `trade` (`unitNames`), y migración de ledgers viejos (`withDeclaredExternals`). Hallazgo abierto: con despensas llenas nadie compra ni vende, así que no hay trato entre vecinos hasta calibrar.
- **Fase 3:** hogares con presupuesto, producción agrícola y de oficios, mercado de la aldea con formación de precios individual, creencias `price`, salarios, préstamos simples (usurero, crédito de cosecha) con colateral, calidad percibida y estafa, hambruna con causa.
- **Fase 4:** piedras espirituales como moneda y combustible del cultivo, cambio plata–piedras, mercado de píldoras y hierbas espirituales, casa de subastas.
- **Fase 5:** varios mercados, comerciantes que arbitrajean por rutas, caravanas, peajes, precios que viajan como noticias, modo agregado y su calibración contra el individual.
- **Fase 6:** gremios, monopolios, cárteles, casas de cambio y letras, sueldos de secta, tributo de protección, mercado negro.
- **Fase 7:** sistemas monetarios que nacen en la historia, acuñación y rebaja de ley, minas que se descubren y agotan, crisis a escala de siglos (inflaciones, colapsos de moneda).
- **Fase 8:** economía de guerra (metal, levas, saqueo), billetes de estado, corridas.

## Tests
- **No hay dinero infinito:** un bot que repite durante miles de turnos los bucles de §2b (comprar y revender, fabricar y vender, vender a la misma tienda) no aumenta la suma de plata y bienes de su región: solo la redistribuye, y su ganancia tiende a cero a medida que se agotan la plata y la demanda de sus contrapartes.
- Ninguna tenencia baja de cero (las deudas son derechos, no lotes negativos); ninguna tienda repone sin una compra registrada.
- **Conservación:** en cualquier escenario, la suma de cada bien, de cada metal (en lingotes, monedas y objetos) y del qi de las piedras solo cambia por producción, consumo, deterioro y extracción registrados como eventos.
- Ninguna transacción sin evento; ningún lote sin `originEventId`; ninguna moneda acuñada sin el metal que la respalda.
- **Ningún agente lee el `tape`** ni la calidad real para decidir: precios y calidad salen de creencias y percepts.
- Determinismo: mismo seed y mismas acciones dan las mismas transacciones y los mismos precios.
- Escenario controlado: una mala cosecha en una aldea sube el precio de la comida ahí, y la suba llega a la aldea vecina recién cuando llega la noticia o el comerciante.
- Escenario controlado: una mina de piedras nueva baja el cambio piedras–plata primero cerca de la mina y después con el retraso de las rutas.
- Escenario controlado: un rumor falso de quiebra contra una casa con reservas fraccionarias produce una corrida; con reservas completas, no la quiebra.
- Precio topado en una escasez produce acaparamiento y mercado negro, no más comida.
- Agregado: el precio de referencia en tier 2 coincide en promedio con la mediana de transacciones de simular a los agentes individuales (dentro de una tolerancia).

## Decisiones tomadas en este borrador (revisables)
- Todo agente, tienda y organización tiene tenencias finitas; las únicas fuentes y sumideros de bienes, metal y piedras son los físicos de §2b. No hay fondos de tienda infinitos, reposición de la nada ni tablas de botín.
- El precio no existe como estado: es la mediana medida de transacciones entre agentes que deciden por creencias. Solo el modo agregado guarda un precio de referencia, calibrado contra el individual.
- Bienes como lotes fungibles con origen y calidad real, e ítems únicos con identidad; la tierra es un bien que no se mueve.
- El dinero es físico (metal, piedras) o un derecho con emisor (letras, billetes); el crédito crea derechos, no metal.
- Las piedras espirituales tienen uso real, pierden qi si se guardan mal, se forman lento y se agotan; su inflación y deflación vienen de minas y de consumo.
- El hogar es la unidad económica básica.
- El modelo de compromiso de los préstamos (garantías, cumplimiento) se delega en [contracts.md](contracts.md); acá queda su lado económico.
- Las estructuras internas de gremios y casas comerciales se delegan en [organizations.md](organizations.md).

## Preguntas abiertas
- Calibración: velocidad de ajuste de precios por categoría en el modo agregado (`k_bien`) y tolerancia aceptable contra el modo individual.
- Calibración: tasas de interés típicas por cultura y riesgo, y frecuencia de quiebras de hogares, para que el endeudamiento campesino sea una presión real pero no universal.
- Calibración: tasa de formación y fuga de piedras espirituales, y el cambio plata–piedras que da la sensación de "abismo entre los dos mundos".
- Calibración: frecuencia de hambrunas y crisis monetarias en la sim histórica.
