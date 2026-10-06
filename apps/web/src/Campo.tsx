/**
 * The schema-driven controls of the scenario panel (LILA-061), split out of `ScenarioPanel.tsx`:
 * `Campo` draws any field from its JSON Schema, with the special cases (durations, reserved
 * fields, per-shift capacity, calendar intervals and holidays, references, `run.start`) that the
 * schema alone cannot express. Every step of the Simulate panel builds on these.
 */
import { useEffect, useRef, useState } from 'react';

import { CampoCapacidadRecurso, esCapacidadRecurso } from './CampoCapacidadRecurso.js';
import { CampoFestivos, CampoIntervalos, esFestivosCalendario, esIntervalosCalendario } from './CamposCalendario.js';
import {
  borrar,
  esObjeto,
  esRegistro,
  escribir,
  esquemaEntrada,
  etiquetaVariante,
  indiceVariante,
  itemVacio,
  leer,
  rutaTexto,
  valorVacio,
  variantes,
  type Contexto,
  type EsquemaJson,
  type Ruta,
} from './escenarioModelo.js';
import {
  DESFASES,
  aSegundos,
  aUnidad,
  componerInstante,
  esTiempoEnSegundos,
  esUnidadTiempo,
  partesInstante,
  type UnidadTiempo,
} from './scenarioFields.js';
import { strings, useStrings } from './i18n';

export function Problemas({ ruta, ctx }: { ruta: Ruta; ctx: Contexto }): React.JSX.Element | null {
  const lista = ctx.problemas.get(rutaTexto(ruta));
  if (lista === undefined) return null;
  return (
    <>
      {lista.map((problema, i) => (
        <p
          key={i}
          role={problema.severidad === 'error' ? 'alert' : undefined}
          className={problema.severidad === 'error' ? 'error' : 'aviso'}
        >
          {problema.mensaje}
        </p>
      ))}
    </>
  );
}

/**
 * Entrada de número con buffer de texto: mientras se escribe, `"0."` o `"1e"` no son números y
 * un `input[type=number]` los reporta como cadena vacía, o sea borraría el campo a media tecla.
 * Se guarda el texto tal cual hasta el `blur`; lo que no es número finito se escribe como texto
 * y lo marca el validador (la escritura no se bloquea nunca).
 *
 * With `unidad` (#332) the field is a **duration**: it is shown and typed in `run.baseTimeUnit`
 * and written to the file in seconds, which is the only unit the format knows (R1, R2). The text
 * buffer is what keeps the conversion from fighting the keyboard: while typing, what is on screen
 * is what was typed, not the round trip through seconds.
 */
export function EntradaNumero({
  valor,
  ruta,
  ctx,
  id,
  unidad,
}: {
  valor: unknown;
  ruta: Ruta;
  ctx: Contexto;
  id: string;
  unidad?: UnidadTiempo | null;
}): React.JSX.Element {
  const [texto, setTexto] = useState<string | null>(null);
  const enPantalla = unidad != null && typeof valor === 'number' ? aUnidad(valor, unidad) : valor;
  const mostrado =
    texto ?? (enPantalla === undefined || enPantalla === null ? '' : String(enPantalla));
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={mostrado}
      onChange={(e) => {
        const bruto = e.target.value;
        setTexto(bruto);
        const limpio = bruto.trim();
        if (limpio === '') ctx.quitar(ruta);
        else {
          const numero = Number(limpio);
          if (!Number.isFinite(numero)) ctx.editar(ruta, limpio);
          else ctx.editar(ruta, unidad == null ? numero : aSegundos(numero, unidad));
        }
      }}
      onBlur={() => {
        setTexto(null);
      }}
    />
  );
}

/** `run.baseTimeUnit` del escenario resuelto, o `'s'`: la unidad en que se enseñan los tiempos. */
export function unidadBase(ctx: Contexto): UnidadTiempo {
  const run = ctx.resuelto['run'];
  const unidad = esObjeto(run) ? run['baseTimeUnit'] : undefined;
  return esUnidadTiempo(unidad) ? unidad : 's';
}

/* ------------------------------------------------------------------ *
 * Campos reservados (§ 4): priority, preempt, batch, timezone (`holidays` is implemented since
 * #82). `conditions` dejó de
 * serlo en un flujo que sale de una XOR divergente (ADR-028); en cualquier otro elemento sigue
 * cayendo aquí, y lo hace por `esCondicionesReservadas`, no por tener esquema vacío.
 * ------------------------------------------------------------------ */

type EstadoReservado = 'ausente' | 'heredado' | 'propio' | 'eliminado';

/**
 * `heredado`: el padre lo define y el hijo no lo toca. `propio`: el hijo trae su propio valor
 * (incluida una `null` explícita heredada de más arriba en la cadena, que ya no se distingue del
 * padre inmediato). `eliminado`: el hijo escribió `null` para borrar lo que el padre define.
 * `ausente`: no hay valor en ningún lado, nada que enseñar.
 */
function estadoReservado(ctx: Contexto, ruta: Ruta): EstadoReservado {
  const enDelta = ctx.delta === undefined ? undefined : leer(ctx.delta, ruta);
  if (enDelta === null) return 'eliminado';
  if (enDelta !== undefined) return 'propio';
  const enPadre = ctx.padre == null ? undefined : leer(ctx.padre, ruta);
  return enPadre === undefined ? 'ausente' : 'heredado';
}

/**
 * El reservado (§ 4): sin editor —el motor lo rechaza con error en v1, así que el panel no ofrece
 * forma de crearlo— pero con el estado heredado/propio/eliminado y el botón para borrarlo, que es
 * lo único que LILA-061/§ 6 pide de un campo que solo puede venir del padre.
 */
function CampoReservado({ ruta, etiqueta, ctx }: { ruta: Ruta; etiqueta: string; ctx: Contexto }): React.JSX.Element | null {
  const S = useStrings();
  const estado = estadoReservado(ctx, ruta);
  if (estado === 'ausente') return null;
  const definidoEnPadre = ctx.padre != null && leer(ctx.padre, ruta) !== undefined;
  const valorMostrado =
    estado === 'propio' ? leer(ctx.delta ?? {}, ruta) : leer(ctx.padre ?? {}, ruta);
  return (
    <div className="campo-schema campo-reservado">
      <span className="etiqueta">{etiqueta}</span>
      <span className={`estado estado-${estado}`}>
        {estado === 'eliminado'
          ? S.escenario.eliminadoNull
          : S.escenario.estadoReservado(
              // #477: la etiqueta traducida, nunca el id interno `'propio'`/`'heredado'`.
              estado === 'propio' ? S.escenario.estadoPropio : S.escenario.estadoHeredado,
              JSON.stringify(valorMostrado),
            )}
      </span>
      {estado === 'eliminado' ? (
        <button
          type="button"
          className="enlace"
          onClick={() => {
            ctx.restaurar?.(ruta);
          }}
        >
          {S.escenario.restaurarHeredado}
        </button>
      ) : (
        <button
          type="button"
          className="enlace"
          onClick={() => {
            ctx.quitar(ruta);
          }}
        >
          {definidoEnPadre ? S.escenario.quitarHeredado : S.escenario.quitar}
        </button>
      )}
      <Problemas ruta={ruta} ctx={ctx} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * #332: las referencias a otra sección del escenario, como selector
 * ------------------------------------------------------------------ */

/** `elements[id].resources[i].ref`: la clave tiene que existir en `resources` (R9). */
function esRefRecurso(ruta: Ruta): boolean {
  return ruta.length === 5 && ruta[0] === 'elements' && ruta[2] === 'resources' && ruta[4] === 'ref';
}

/** `elements[id].calendar` y `resources[pool].calendar`: la clave existe en `calendars` (R9). */
function esRefCalendario(ruta: Ruta): boolean {
  return (
    ruta.length === 3 &&
    (ruta[0] === 'elements' || ruta[0] === 'resources') &&
    ruta[2] === 'calendar'
  );
}

/**
 * Una referencia a una clave de otra sección, dibujada como selector de lo ya declarado.
 *
 * Escrita a mano —que es como estaba— cualquier errata sale del panel como un `E-REF-DESCONOCIDA`
 * a posteriori, y no hay forma de saber desde el campo qué grupos o calendarios existen. Un valor
 * que no está entre las claves se conserva como opción extra: si el escenario ya trae una
 * referencia rota hay que poder verla y borrarla, no que el control la cambie sola.
 */
function CampoClave({
  ruta,
  etiqueta,
  seccion,
  ctx,
}: {
  ruta: Ruta;
  etiqueta: string;
  seccion: 'resources' | 'calendars';
  ctx: Contexto;
}): React.JSX.Element {
  const S = useStrings();
  const id = `campo-${rutaTexto(ruta)}`;
  const valor = leer(ctx.resuelto, ruta);
  const declaradas = esObjeto(ctx.resuelto[seccion]) ? Object.keys(ctx.resuelto[seccion]) : [];
  const opciones =
    typeof valor === 'string' && valor !== '' && !declaradas.includes(valor)
      ? [valor, ...declaradas]
      : declaradas;
  return (
    <div className="campo-schema">
      <label htmlFor={id}>{etiqueta}</label>
      <select
        id={id}
        value={typeof valor === 'string' ? valor : ''}
        onChange={(e) => {
          if (e.target.value === '') ctx.quitar(ruta);
          else ctx.editar(ruta, e.target.value);
        }}
      >
        <option value="">{S.escenario.sinDefinir}</option>
        {opciones.map((clave) => (
          <option key={clave} value={clave}>
            {clave}
          </option>
        ))}
      </select>
      <Problemas ruta={ruta} ctx={ctx} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * #332: `run.start` (R8), con fecha y desfase en vez de un ISO a mano
 * ------------------------------------------------------------------ */

function esInstanteDeCorrida(ruta: Ruta): boolean {
  return ruta.length === 2 && ruta[0] === 'run' && ruta[1] === 'start';
}

/**
 * `YYYY-MM-DDTHH:MM:SS±HH:MM` compuesto por un `datetime-local` y el desfase UTC.
 *
 * El desfase no es decorativo: R8 lo exige y es lo que fija la zona en que se leen los calendarios
 * (§ 2.3). Se guarda aparte en estado local para que elegirlo **antes** de la fecha no se pierda;
 * sin fecha no hay nada que escribir, porque medio instante no pasa el esquema.
 *
 * Un valor que no encaja en ese molde no llega aquí: `Campo` cae a la entrada de texto, que es la
 * única forma de arreglar a mano un `start` escrito por otra herramienta.
 */
function CampoInstante({
  ruta,
  etiqueta,
  ctx,
}: {
  ruta: Ruta;
  etiqueta: string;
  ctx: Contexto;
}): React.JSX.Element {
  const S = useStrings();
  const valor = leer(ctx.resuelto, ruta);
  const partes = partesInstante(valor);
  const [desfaseLocal, setDesfaseLocal] = useState<string | null>(null);
  const desfase = partes?.desfase ?? desfaseLocal ?? '+00:00';
  const fechaHora = partes?.fechaHora ?? '';
  const id = `campo-${rutaTexto(ruta)}`;
  const idDesfase = `${id}-desfase`;
  return (
    <div className="campo-schema">
      <label htmlFor={id}>{etiqueta}</label>
      <input
        id={id}
        type="datetime-local"
        step="1"
        value={fechaHora}
        onChange={(e) => {
          if (e.target.value === '') ctx.quitar(ruta);
          else ctx.editar(ruta, componerInstante(e.target.value, desfase));
        }}
      />
      <label htmlFor={idDesfase}>{S.escenario.desfase}</label>
      <select
        id={idDesfase}
        value={desfase}
        onChange={(e) => {
          setDesfaseLocal(e.target.value);
          if (fechaHora !== '') ctx.editar(ruta, componerInstante(fechaHora, e.target.value));
        }}
      >
        {DESFASES.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <Problemas ruta={ruta} ctx={ctx} />
    </div>
  );
}

/**
 * Las propiedades de un objeto, saltándose los `const` (los enseña el selector de variante).
 *
 * `visibles` (#332) es la columna "Applies to" de § 2.5: con ella, una tarea deja de ofrecer
 * `interTriggerTimer` y un flujo deja de ofrecer `processingTime`. Lo que **ya está escrito** en
 * el escenario se enseña aunque no aplique, con su error del linter al lado: si no, un campo mal
 * puesto se volvería invisible y no habría forma de borrarlo desde el panel.
 *
 * El rótulo sale del catálogo (`S.escenario.campos`); una clave sin traducir se rotula con su
 * propio nombre, que es como estaba todo antes de este ticket.
 */
export function Propiedades({
  esquema,
  ruta,
  ctx,
  visibles,
  siDefinido,
}: {
  esquema: EsquemaJson;
  ruta: Ruta;
  ctx: Contexto;
  visibles?: readonly string[] | null;
  /**
   * Which of the already-written fields may still be drawn although `visibles` leaves them out.
   * Without it the escape hatch below would leak every parameterised field into every step of
   * #333: a task with `resources` would show them in the time step too. `undefined` means "all
   * of them", which is the behaviour of #332 and what the sections outside the steps keep.
   */
  siDefinido?: readonly string[] | null;
}): React.JSX.Element {
  const S = useStrings();
  const requeridos = new Set(esquema.required ?? []);
  return (
    <>
      {Object.entries(esquema.properties ?? {})
        .filter(([, sub]) => sub.const === undefined)
        .filter(
          ([clave]) =>
            visibles == null ||
            visibles.includes(clave) ||
            ((siDefinido == null || siDefinido.includes(clave)) &&
              leer(ctx.resuelto, [...ruta, clave]) !== undefined),
        )
        .map(([clave, sub]) => (
          // One box per field and its help, so the wide panel (design 2a) can lay them out in a grid.
          <div key={clave} className="propiedad">
            <Campo
              esquema={sub}
              ruta={[...ruta, clave]}
              etiqueta={S.escenario.campos[clave] ?? clave}
              requerido={requeridos.has(clave)}
              ctx={ctx}
            />
            {ayudaDe(S, ruta, clave) !== undefined && (
              <p className="ayuda">{ayudaDe(S, ruta, clave)}</p>
            )}
          </div>
        ))}
    </>
  );
}

/**
 * La ayuda de un campo. Va por clave, salvo dentro de una entrada de `conditions`, donde
 * `probability` significa otra cosa que la del flujo (ADR-028) y se busca antes como
 * `conditions.<clave>`.
 */
function ayudaDe(
  S: ReturnType<typeof useStrings>,
  ruta: Ruta,
  clave: string,
): string | undefined {
  if (ruta.at(-2) === 'conditions') {
    const propia = S.escenario.ayudas[`conditions.${clave}`];
    if (propia !== undefined) return propia;
  }
  return S.escenario.ayudas[clave];
}

/**
 * Añadir una clave a un registro (`calendars`, `resources`, `elements`).
 *
 * Una clave repetida se rechaza en vez de escribirse: `valorVacio` produce el objeto **mínimo**
 * del esquema, así que escribirlo encima del recurso que ya existe se llevaba por delante su
 * nombre, su coste y su calendario sin decir nada.
 */
function AnadirClave({
  onAnadir,
  existe,
  textos,
  id,
}: {
  onAnadir: (clave: string) => void;
  existe: (clave: string) => boolean;
  /**
   * #579: rótulo visible, ejemplo y botón propios del registro (`calendars`, `resources`). Sin
   * ellos el control conserva su forma genérica: una caja con nombre accesible y «Añadir».
   */
  textos?: { rotulo: string; placeholder: string; boton: string } | undefined;
  id: string;
}): React.JSX.Element {
  const S = useStrings();
  const [clave, setClave] = useState('');
  const repetida = clave.trim() !== '' && existe(clave.trim());
  const crear = (): void => {
    const limpia = clave.trim();
    if (limpia === '' || existe(limpia)) return;
    onAnadir(limpia);
    setClave('');
  };
  return (
    <div className="anadir">
      {textos !== undefined && (
        <label htmlFor={id} className="etiqueta">
          {textos.rotulo}
        </label>
      )}
      <input
        id={id}
        type="text"
        aria-label={textos === undefined ? S.escenario.claveNueva : undefined}
        placeholder={textos?.placeholder}
        aria-invalid={repetida ? true : undefined}
        value={clave}
        onChange={(e) => {
          setClave(e.target.value);
        }}
        onKeyDown={(e) => {
          // Enter crea, como el botón: teclear el id y confirmar sin ir a buscar el ratón.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            crear();
          }
        }}
      />
      <button type="button" className="boton" onClick={crear}>
        {textos?.boton ?? S.escenario.anadir}
      </button>
      {repetida && (
        <p role="alert" className="error">
          {S.escenario.claveRepetida(clave.trim())}
        </p>
      )}
    </div>
  );
}

/**
 * Un registro (`calendars`, `resources`, `elements`): una entrada por clave más el control para
 * crear otra. En Calendarios y Recursos (#579) ese control va arriba, con rótulo visible, y la
 * entrada recién creada recibe el foco: abajo, tras el editor de cada calendario, nadie lo
 * encontraba.
 */
function Registro({
  esquema,
  ruta,
  ctx,
}: {
  esquema: EsquemaJson;
  ruta: Ruta;
  ctx: Contexto;
}): React.JSX.Element {
  const S = useStrings();
  const valor = leer(ctx.resuelto, ruta);
  const entrada = esquemaEntrada(esquema);
  const claves = esObjeto(valor) ? Object.keys(valor) : [];
  const caja = useRef<HTMLDivElement>(null);
  const [recienCreada, setRecienCreada] = useState<string | null>(null);
  const textos =
    ruta.length === 1 && ruta[0] === 'calendars'
      ? {
          rotulo: S.escenario.nuevoCalendario,
          placeholder: S.escenario.ejemploCalendario,
          boton: S.escenario.crearCalendario,
        }
      : ruta.length === 1 && ruta[0] === 'resources'
        ? {
            rotulo: S.escenario.nuevoRecurso,
            placeholder: S.escenario.ejemploRecurso,
            boton: S.escenario.crearRecurso,
          }
        : undefined;

  // La entrada nueva aparece cuando el escenario vuelve del padre: hasta entonces no hay a quién
  // dar el foco.
  useEffect(() => {
    if (recienCreada === null || !claves.includes(recienCreada)) return;
    const fieldset = [...(caja.current?.querySelectorAll<HTMLFieldSetElement>(':scope > fieldset') ?? [])].find(
      (f) => f.dataset.clave === recienCreada,
    );
    setRecienCreada(null);
    if (fieldset === undefined) return;
    fieldset.scrollIntoView?.({ block: 'nearest' });
    const editor = fieldset.querySelector<HTMLElement>('input, select, textarea');
    (editor ?? fieldset).focus();
  });

  const anadir = (
    <AnadirClave
      id={`nueva-${rutaTexto(ruta)}`}
      textos={textos}
      existe={(clave) => claves.includes(clave)}
      onAnadir={(clave) => {
        ctx.editar([...ruta, clave], valorVacio(entrada));
        setRecienCreada(clave);
      }}
    />
  );
  return (
    <div className="campo-schema" ref={caja}>
      {textos !== undefined && anadir}
      {claves.map((clave) => (
        <fieldset key={clave} className="entrada" data-clave={clave} tabIndex={-1}>
          <legend>
            {clave}
            <button
              type="button"
              className="enlace"
              aria-label={S.escenario.quitarClave(clave)}
              onClick={() => {
                ctx.quitar([...ruta, clave]);
              }}
            >
              {S.escenario.quitarElemento}
            </button>
          </legend>
          <Propiedades esquema={entrada} ruta={[...ruta, clave]} ctx={ctx} />
          <Problemas ruta={[...ruta, clave]} ctx={ctx} />
        </fieldset>
      ))}
      {textos === undefined && anadir}
      <Problemas ruta={ruta} ctx={ctx} />
    </div>
  );
}

/**
 * Un campo del formulario, dibujado a partir de su sub-esquema. Es la única función que sabe
 * traducir JSON Schema a controles, y se llama a sí misma para objetos, arrays y registros.
 */
/**
 * `elements[id].conditions` en un elemento que **no** es un flujo saliente de una XOR divergente:
 * ahí el campo tiene esquema (ADR-028) pero el motor lo sigue rechazando —`E-RESERVADO` en un
 * nodo, `E-CAMPO-NO-APLICA` en otro flujo—, así que el editor de lista dejaría el escenario sin
 * forma de borrarlo y con la simulación bloqueada (OP-11). La condición es la misma que aplica
 * `validateScenario`: nodo origen `xor` con dos o más salientes.
 *
 * Sin IR no se puede decidir, y se deja pasar al editor: es lo que hacen las sondas de test.
 */
function esCondicionesReservadas(ruta: Ruta, ctx: Contexto): boolean {
  if (ruta.length !== 3 || ruta[0] !== 'elements' || ruta[2] !== 'conditions') return false;
  const ir = ctx.ir ?? null;
  if (ir === null) return false;
  const flujo = ir.flows[String(ruta[1])];
  if (flujo === undefined) return true;
  const origen = ir.nodes[flujo.from];
  return origen?.type !== 'xor' || origen.outgoing.length < 2;
}

export function Campo({
  esquema,
  ruta,
  etiqueta,
  requerido,
  ctx,
  sufijo = '',
}: {
  esquema: EsquemaJson;
  ruta: Ruta;
  etiqueta: string;
  requerido: boolean;
  ctx: Contexto;
  /**
   * Distingue dos controles que editan la **misma** ruta: el selector de variante de una unión
   * y, si la variante elegida es escalar, la entrada de su valor. Sin esto los dos tendrían el
   * mismo `id` y el `<label>` apuntaría al primero.
   */
  sufijo?: string;
}): React.JSX.Element | null {
  const S = useStrings();
  const valor = leer(ctx.resuelto, ruta);
  const id = `campo-${rutaTexto(ruta)}${sufijo}`;

  // `resources[pool].capacity` (LILA-164): antes de caer al selector genérico de uniones, porque
  // necesita conservar el id de la variante numérica y dibujar `calendar` como un select de los
  // calendarios ya declarados, no como el formulario genérico de un `{calendar, capacity}` suelto.
  if (esCapacidadRecurso(ruta, esquema)) {
    return <CampoCapacidadRecurso esquema={esquema} ruta={ruta} ctx={ctx} />;
  }

  // ADR-028: `conditions` solo se edita donde el motor la acepta; en el resto de elementos es un
  // reservado más y lo único que se puede hacer con ella es borrarla (OP-11).
  if (esCondicionesReservadas(ruta, ctx)) {
    return <CampoReservado ruta={ruta} etiqueta={etiqueta} ctx={ctx} />;
  }

  // `calendars[clave].intervals` (LILA-203): la rejilla semanal en vez de la lista genérica de
  // objetos. El `sufijo` corta la recursión: la vista de lista vuelve a entrar aquí ya marcada.
  if (sufijo === '' && esIntervalosCalendario(ruta)) {
    return <CampoIntervalos esquema={esquema} ruta={ruta} ctx={ctx} />;
  }
  if (esFestivosCalendario(ruta)) {
    return <CampoFestivos ruta={ruta} ctx={ctx} />;
  }

  // #332: las dos referencias del formato (R9) como selector de lo ya declarado, y `run.start`
  // (R8) como fecha + desfase. Un `start` que no encaje en el molde ISO cae a la entrada de texto
  // de más abajo, que es la única forma de arreglar a mano lo que escribió otra herramienta.
  if (esRefRecurso(ruta)) {
    return <CampoClave ruta={ruta} etiqueta={etiqueta} seccion="resources" ctx={ctx} />;
  }
  if (esRefCalendario(ruta)) {
    return <CampoClave ruta={ruta} etiqueta={etiqueta} seccion="calendars" ctx={ctx} />;
  }
  if (esInstanteDeCorrida(ruta) && (valor === undefined || partesInstante(valor) !== null)) {
    return <CampoInstante ruta={ruta} etiqueta={etiqueta} ctx={ctx} />;
  }

  // Unión: selector de variante + cuerpo de la elegida. Con esto las 14 distribuciones y la
  // `capacity` de LILA-164 salen del esquema sin una línea de código por caso.
  const vars = variantes(esquema);
  if (vars !== null) {
    const indice = indiceVariante(valor, vars);
    const elegida = indice >= 0 ? vars[indice] : undefined;
    return (
      <div className="campo-schema">
        <label htmlFor={id}>{etiqueta}</label>
        <select
          id={id}
          value={String(indice)}
          onChange={(e) => {
            const nuevo = Number(e.target.value);
            if (nuevo < 0) ctx.quitar(ruta);
            else ctx.editar(ruta, valorVacio(vars[nuevo]!));
          }}
        >
          <option value="-1">{S.escenario.sinDefinir}</option>
          {vars.map((variante, i) => (
            <option key={i} value={String(i)}>
              {etiquetaVariante(variante, i)}
            </option>
          ))}
        </select>
        <Problemas ruta={ruta} ctx={ctx} />
        {elegida !== undefined &&
          (elegida.type === 'object' ? (
            <div className="anidado">
              <Propiedades esquema={elegida} ruta={ruta} ctx={ctx} />
            </div>
          ) : (
            <div className="anidado">
              <Campo
                esquema={elegida}
                ruta={ruta}
                etiqueta={etiqueta}
                requerido
                ctx={ctx}
                sufijo="-valor"
              />
            </div>
          ))}
      </div>
    );
  }

  if (esquema.enum !== undefined) {
    return (
      <div className="campo-schema">
        <label htmlFor={id}>{etiqueta}</label>
        <select
          id={id}
          value={valor === undefined ? '' : String(valor)}
          onChange={(e) => {
            if (e.target.value === '') ctx.quitar(ruta);
            else ctx.editar(ruta, e.target.value);
          }}
        >
          <option value="">{S.escenario.sinDefinir}</option>
          {esquema.enum.map((opcion) => (
            <option key={String(opcion)} value={String(opcion)}>
              {String(opcion)}
            </option>
          ))}
        </select>
        <Problemas ruta={ruta} ctx={ctx} />
      </div>
    );
  }

  if (esRegistro(esquema)) {
    return <Registro esquema={esquema} ruta={ruta} ctx={ctx} />;
  }

  if (esquema.type === 'array') {
    const items = esquema.items ?? {};
    const lista = Array.isArray(valor) ? valor : [];
    return (
      <div className="campo-schema">
        <span className="etiqueta">{etiqueta}</span>
        {lista.map((_, i) => (
          <div key={i} className="anidado">
            {items.type === 'object' && items.properties !== undefined ? (
              <Propiedades esquema={items} ruta={[...ruta, i]} ctx={ctx} />
            ) : (
              <Campo
                esquema={items}
                ruta={[...ruta, i]}
                etiqueta={S.escenario.itemNumerado(etiqueta, i + 1)}
                requerido
                ctx={ctx}
              />
            )}
            <button
              type="button"
              className="enlace"
              aria-label={S.escenario.quitarItem(etiqueta, i + 1)}
              onClick={() => {
                ctx.quitar([...ruta, i]);
              }}
            >
              {S.escenario.quitarElemento}
            </button>
            <Problemas ruta={[...ruta, i]} ctx={ctx} />
          </div>
        ))}
        <button
          type="button"
          className="boton"
          onClick={() => {
            ctx.editar([...ruta, lista.length], itemVacio(items));
          }}
        >
          {S.escenario.anadirEtiqueta(etiqueta)}
        </button>
        <Problemas ruta={ruta} ctx={ctx} />
      </div>
    );
  }

  if (esquema.type === 'object') {
    return (
      <fieldset className="entrada">
        <legend>{etiqueta}</legend>
        <Propiedades esquema={esquema} ruta={ruta} ctx={ctx} />
        <Problemas ruta={ruta} ctx={ctx} />
      </fieldset>
    );
  }

  if (esquema.type === 'boolean') {
    return (
      <div className="campo-schema">
        <label htmlFor={id}>{etiqueta}</label>
        <input
          id={id}
          type="checkbox"
          checked={valor === true}
          onChange={(e) => {
            ctx.editar(ruta, e.target.checked);
          }}
        />
        <Problemas ruta={ruta} ctx={ctx} />
      </div>
    );
  }

  if (esquema.type === 'number' || esquema.type === 'integer') {
    // #332: una duración se teclea en `run.baseTimeUnit` y se guarda en segundos (R1, R2); la
    // unidad se enseña al lado, que es lo único que distingue «5» de «5 minutos» en pantalla.
    const unidad = esTiempoEnSegundos(ruta) ? unidadBase(ctx) : null;
    return (
      <div className="campo-schema">
        <label htmlFor={id}>{etiqueta}</label>
        <EntradaNumero valor={valor} ruta={ruta} ctx={ctx} id={id} unidad={unidad} />
        {unidad !== null && <span className="unidad">{S.escenario.unidades[unidad]}</span>}
        <Problemas ruta={ruta} ctx={ctx} />
      </div>
    );
  }

  if (esquema.type === 'string') {
    return (
      <div className="campo-schema">
        <label htmlFor={id}>{etiqueta}</label>
        <input
          id={id}
          type="text"
          value={valor === undefined || valor === null ? '' : String(valor)}
          onChange={(e) => {
            if (e.target.value === '') ctx.quitar(ruta);
            else ctx.editar(ruta, e.target.value);
          }}
        />
        <Problemas ruta={ruta} ctx={ctx} />
      </div>
    );
  }

  // Esquema vacío (`{}`): los campos reservados de § 4 (`priority`, `preempt`, `batch`,
  // `timezone`). `conditions` ya tiene esquema propio (ADR-028) y no llega hasta
  // aquí: cuando no aplica la desvía arriba `esCondicionesReservadas`. El motor los rechaza con
  // error, así que el panel no ofrece forma de crearlos, pero si llegan heredados o propios hace
  // falta poder borrarlos (OP-11): `CampoReservado` enseña el estado y el botón; el problema
  // sigue saliendo también en la cabecera vía `Problemas`.
  return <CampoReservado ruta={ruta} etiqueta={etiqueta} ctx={ctx} />;
}
