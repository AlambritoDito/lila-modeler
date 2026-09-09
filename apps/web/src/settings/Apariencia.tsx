/**
 * Ajustes → Apariencia (LILA-114): la lista de temas, el editor de los 40 tokens, la vista previa
 * y el importar/exportar del JSON de `docs/THEMES.md`.
 *
 * **La app entera es la vista previa.** Cada cambio válido llama a `onTemas`, y `App.tsx` aplica el
 * tema en caliente (`applyTheme` + `Modelador.repintar`, LILA-113): el lienzo, los paneles y el
 * propio diálogo se repintan mientras se arrastra el selector de color. El recuadro de muestras de
 * abajo no es la vista previa, es el atajo para no tener que mirar detrás del diálogo.
 *
 * **Los temas integrados no se editan.** La primera edición sobre Eva-01 o Papel crea «Eva-01
 * (copia)» y sigue sobre ella. Se decidió así en vez de un aviso «duplica primero» porque la acción
 * que el usuario pidió (cambiar ese color) ocurre igual, y el nombre del tema —que cambia delante
 * de sus ojos, con su campo de texto al lado— ya dice lo que ha pasado.
 *
 * **Único camino de vuelta: `onTemas(lista, seleccion)`.** El componente no aplica ni persiste
 * nada; construye la lista nueva y dice cuál queda activo. Así solo hay un sitio en toda la app que
 * llama a `applyTheme` y no hay dos fuentes de verdad del tema vivo.
 */
import { useRef, useState } from 'react';
import { es as S } from '../strings.es';
import { DENSIDAD_IDS } from '../ids';
import type { Theme } from '../theme/applyTheme';
import type { TokenName } from '../theme/tokens';
import { duplicar, esColor, GRUPOS, temaDe, validarTema, valorValido, type TemaGuardado } from '../theme/temas';

export interface AparienciaProps {
  /** Id del tema aplicado: `eva-01`, `papel` o `u:<n>`. */
  readonly temaId: string;
  /** El tema aplicado ahora mismo; `null` si ninguno llegó a cargar. */
  readonly tema: Theme | null;
  /** Temas del usuario, en el orden en que se crearon. */
  readonly temas: readonly TemaGuardado[];
  readonly densidad: string;
  readonly onDensidad: (densidad: string) => void;
  /** Guarda la lista y aplica `seleccion` (por defecto, el tema activo). */
  readonly onTemas: (temas: readonly TemaGuardado[], seleccion?: string) => void;
  /** Selecciona otro tema; los integrados los carga `App.tsx` por `fetch`. */
  readonly onSeleccionar: (id: string) => void;
}

/** Nombre de archivo del tema exportado: `Eva-01 (copia)` → `eva-01-copia.json`. */
function archivoDe(nombre: string): string {
  const limpio = nombre.normalize('NFD').replaceAll(/[\u0300-\u036f]/gu, '').replaceAll(/[^a-zA-Z0-9]+/gu, '-');
  return `${limpio.replaceAll(/^-|-$/gu, '').toLowerCase() || 'tema'}.json`;
}

/**
 * Los tres editores de token. Están fuera de `Apariencia` a propósito: definidos dentro serían un
 * tipo de componente nuevo en cada render, React desmontaría el `<input>` en cada tecla y el campo
 * de texto perdería el foco a la primera letra.
 */
interface EditorProps {
  readonly token: TokenName;
  readonly valor: string;
  readonly editar: (token: TokenName, valor: string) => void;
}

/**
 * Un token de color: selector nativo y hex a la par, editables los dos.
 *
 * **Lo tecleado a medias no sale del control.** Escribir un hex pasa por `#`, `#1`, `#12`… y
 * ninguno de esos es un color: aplicarlos pintaría la app de nada y persistirlos dejaba en disco un
 * tema que al releerlo había que reparar (QA de #277). El borrador vive aquí, el campo lo enseña
 * marcado como inválido, y solo el valor bueno llama a `editar`. **Al salir del campo el borrador
 * se descarta** y vuelve el último valor bueno (QA ronda 2): si no, seguía en pantalla después de
 * cambiar de tema o de «Restablecer», enseñando en rojo un valor que el tema activo no tiene.
 */
function Color({ token, valor, editar }: EditorProps): React.JSX.Element {
  const [borrador, setBorrador] = useState<string | null>(null);
  return (
    <label className="token">
      <code>{token}</code>
      {/* `type="color"` solo entiende `#rrggbb`: se le pasa el color sin alfa y al elegir se le
          vuelve a pegar el alfa que el token tuviera (`shadow` es `#rrggbbaa`). */}
      <input
        type="color"
        aria-label={S.apariencia.color(token)}
        value={valor.slice(0, 7)}
        onChange={(e) => { setBorrador(null); editar(token, e.target.value + valor.slice(7)); }}
      />
      <input
        type="text"
        aria-label={S.apariencia.hex(token)}
        value={borrador ?? valor}
        aria-invalid={borrador !== null}
        className={borrador === null ? undefined : 'invalido'}
        spellCheck={false}
        onChange={(e) => {
          const nuevo = e.target.value;
          if (valorValido(token, nuevo)) { setBorrador(null); editar(token, nuevo); }
          else setBorrador(nuevo);
        }}
        onBlur={() => setBorrador(null)}
      />
    </label>
  );
}

function Fuente({ token, valor, editar }: EditorProps): React.JSX.Element {
  // Un tema importado puede traer una familia que no está en la lista: se añade como opción en vez
  // de enseñar otra cosa (o vaciar el select y perderla al primer cambio).
  const opciones = S.apariencia.fuentes.some((f) => f.valor === valor)
    ? S.apariencia.fuentes
    : [...S.apariencia.fuentes, { nombre: valor, valor }];
  return (
    <label className="token">
      <code>{token}</code>
      <select value={valor} onChange={(e) => editar(token, e.target.value)}>
        {opciones.map((f) => <option key={f.valor} value={f.valor}>{f.nombre}</option>)}
      </select>
    </label>
  );
}

/**
 * `font.size.base` en píxeles; el token guarda la longitud CSS completa (`13px`). Vaciar el campo
 * dejaba el token en `"px"`, que no es una longitud: como en `Color`, ese estado se queda aquí.
 */
function Tamano({ token, valor, editar }: EditorProps): React.JSX.Element {
  const [borrador, setBorrador] = useState<string | null>(null);
  return (
    <label className="token">
      <code>{token}</code>
      <input
        type="number"
        min={9}
        max={32}
        aria-label={S.apariencia.tamanoBase}
        aria-invalid={borrador !== null}
        className={borrador === null ? undefined : 'invalido'}
        value={borrador ?? Number.parseFloat(valor === '' ? '13' : valor)}
        onChange={(e) => {
          const nuevo = e.target.value;
          // El rango del control es el que vale: `-5px` o `0px` son longitudes que CSS descarta en
          // silencio, y `min`/`max` no impiden teclearlas (QA ronda 2 de #277).
          const n = Number(nuevo);
          if (nuevo !== '' && Number.isFinite(n) && n >= 9 && n <= 32) { setBorrador(null); editar(token, `${nuevo}px`); }
          else setBorrador(nuevo);
        }}
        onBlur={() => setBorrador(null)}
      />
    </label>
  );
}

export function Apariencia(props: AparienciaProps): React.JSX.Element {
  const { densidad, tema, temaId, temas } = props;
  const [error, setError] = useState<string | null>(null);
  /** Nombre tecleado que todavía no vale (vacío o en blanco): no se persiste, se queda el anterior. */
  const [borradorNombre, setBorradorNombre] = useState<string | null>(null);
  // El `<input type="file">` no se resetea solo: sin esto, importar dos veces el mismo archivo
  // (tras corregirlo) no dispara `change` porque el valor no ha cambiado.
  const archivo = useRef<HTMLInputElement>(null);
  /** El tema activo, si es del usuario; `undefined` cuando el activo es integrado. */
  const activo = temaDe(temaId, temas);
  const tokens: Partial<Record<TokenName, string>> = tema?.tokens ?? {};

  /** Escribe un token del tema activo, duplicando antes el integrado si hace falta. */
  function editar(token: TokenName, valor: string): void {
    if (tema === null) return;
    const base = activo ?? duplicar(tema, temas);
    const editado: TemaGuardado = { ...base, tema: { ...base.tema, tokens: { ...base.tema.tokens, [token]: valor } } };
    props.onTemas(activo === undefined ? [...temas, editado] : temas.map((t) => (t.id === editado.id ? editado : t)), editado.id);
  }

  function renombrar(name: string): void {
    if (activo === undefined) return;
    props.onTemas(temas.map((t) => (t.id === activo.id ? { ...t, tema: { ...t.tema, name } } : t)), activo.id);
  }

  /** Vuelve a los tokens de origen; sobre un integrado, a su JSON (`App.tsx` lo relee). */
  function restablecer(): void {
    if (activo === undefined) props.onSeleccionar(temaId);
    else props.onTemas(temas.map((t) => (t.id === activo.id ? { ...t, tema: { ...t.tema, tokens: t.origen } } : t)), activo.id);
    setError(null);
  }

  function exportar(): void {
    if (tema === null) return;
    // Exactamente `{ name, tokens }` y nada más: es el formato de `docs/THEMES.md`, y lo que
    // vuelve a entrar por «Importar» reproduce este mismo archivo.
    const json = `${JSON.stringify({ name: tema.name, tokens: tema.tokens }, null, 2)}\n`;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    try {
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = archivoDe(tema.name);
      enlace.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function importar(fichero: File): Promise<void> {
    let dato: unknown;
    try {
      dato = JSON.parse(await fichero.text());
    } catch {
      setError(S.apariencia.errorImportar(S.apariencia.errorJson));
      return;
    }
    let importado: Theme;
    try {
      importado = validarTema(dato);
    } catch (e: unknown) {
      // Nada se aplica: el tema de ahora se queda como está y el mensaje dice qué token falla.
      setError(S.apariencia.errorImportar(e instanceof Error ? e.message : String(e)));
      return;
    }
    const nuevo = duplicar(importado, temas, importado.name);
    setError(null);
    props.onTemas([...temas, nuevo], nuevo.id);
  }

  return (
    <>
      <label className="campo">
        {S.app.tema}
        <select value={temaId} onChange={(e) => { setError(null); props.onSeleccionar(e.target.value); }}>
          <optgroup label={S.apariencia.integrado}>
            {Object.entries(S.app.temas).map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
          </optgroup>
          {temas.length > 0 && (
            <optgroup label={S.apariencia.delUsuario}>
              {temas.map((t) => <option key={t.id} value={t.id}>{t.tema.name}</option>)}
            </optgroup>
          )}
        </select>
      </label>

      {activo !== undefined && (
        <label className="campo">
          {S.apariencia.nombre}
          <input
            type="text"
            value={borradorNombre ?? activo.tema.name}
            aria-invalid={borradorNombre !== null}
            className={borradorNombre === null ? undefined : 'invalido'}
            onChange={(e) => {
              const nuevo = e.target.value;
              // Un tema sin rótulo no se puede elegir en la lista: mientras el campo esté vacío se
              // conserva el nombre anterior y no se guarda nada.
              if (nuevo.trim() === '') setBorradorNombre(nuevo);
              else { setBorradorNombre(null); renombrar(nuevo); }
            }}
            onBlur={() => setBorradorNombre(null)}
          />
        </label>
      )}

      <div className="acciones temas">
        <button type="button" className="boton" disabled={tema === null} onClick={() => { if (tema !== null) { const n = duplicar(tema, temas); props.onTemas([...temas, n], n.id); } }}>{S.apariencia.duplicar}</button>
        <button type="button" className="boton" onClick={restablecer}>{S.apariencia.restablecer}</button>
        <button type="button" className="boton" disabled={tema === null} onClick={exportar}>{S.apariencia.exportar}</button>
        {/* Sin diálogo propio ni librería: el `<label>` es el botón del `<input type="file">`. */}
        <label className="boton">
          {S.apariencia.importar}
          <input
            ref={archivo}
            type="file"
            accept="application/json,.json"
            onChange={(e) => { const f = e.target.files?.[0]; if (f !== undefined) void importar(f).finally(() => { if (archivo.current !== null) archivo.current.value = ''; }); }}
          />
        </label>
        {activo !== undefined && (
          <button type="button" className="boton" onClick={() => props.onTemas(temas.filter((t) => t.id !== activo.id), 'eva-01')}>{S.apariencia.eliminar}</button>
        )}
      </div>

      {error !== null && <p role="alert" className="error">{error}</p>}

      <label className="campo">
        {S.app.densidad}
        {/* La densidad sigue siendo una preferencia, no una edición del tema (LILA-113): se aplica
            encima de cualquier tema y por eso no toca el token `density` del que se está editando. */}
        <select value={densidad} onChange={(e) => props.onDensidad(e.target.value)}>
          {DENSIDAD_IDS.map((d) => <option key={d} value={d}>{S.app.densidades[d]}</option>)}
        </select>
      </label>

      <div className="muestras">
        <span>{S.apariencia.muestraTexto}</span>
        <span className="apagado">{S.apariencia.muestraSecundario}</span>
        <span className="acento">{S.apariencia.muestraBoton}</span>
      </div>

      {GRUPOS.map((grupo, i) => (
        <details key={grupo.titulo} className="grupo" open={i === 0}>
          <summary>{grupo.titulo}</summary>
          {grupo.tokens.map((token) => {
            const campo = { token, valor: tokens[token] ?? '', editar };
            if (esColor(token)) return <Color key={token} {...campo} />;
            if (token === 'font.size.base') return <Tamano key={token} {...campo} />;
            // ponytail: `density` no se edita aquí, se edita arriba como preferencia; el token
            // sigue en el JSON y viaja en el exportado tal cual venga.
            if (token === 'density') return null;
            return <Fuente key={token} {...campo} />;
          })}
        </details>
      ))}
    </>
  );
}
