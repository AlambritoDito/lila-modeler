/**
 * Charts of Results and Compare (#460): inline SVG, no charting library. Two forms cover every
 * chart: horizontal bars (one or several series, one axis from zero) and a histogram.
 *
 * The same components draw on screen and on paper: `Paleta` says whether the colors are the
 * theme's CSS variables (`PALETA_PANTALLA`) or fixed hex for the process document
 * (`PALETA_PAPEL`), which rasterises the SVG like the diagram and so cannot resolve variables.
 *
 * Every chart is an `<svg role="img">` with a `<title>` and a `<desc>` that lists every value, and
 * every bar carries its value as text; the table stays the source and sits next to the chart.
 * Text wears the ink tokens, never a series color.
 */
import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { escala, histograma, SERIES_CLARO, type Clase } from './graficas';
import { formatDisplay } from './formatDisplay';
import { useStrings } from './i18n';
import './graficas.css';

export interface Paleta {
  series: readonly string[];
  tinta: string;
  tenue: string;
  reja: string;
  fuente: string;
  /** Painted behind the chart; on screen the section's surface shows through instead. */
  fondo?: string;
}

export const PALETA_PANTALLA: Paleta = {
  series: SERIES_CLARO.map((_, i) => `var(--serie-${i + 1})`),
  tinta: 'var(--fg-primary)',
  tenue: 'var(--fg-muted)',
  reja: 'var(--border)',
  fuente: 'var(--font-ui)',
};

/** The paper of `toHtml` in `process-document.ts`: its ink and border colors. */
export const PALETA_PAPEL: Paleta = {
  series: SERIES_CLARO,
  tinta: '#280838',
  tenue: '#5c4470',
  reja: '#c8c0d0',
  fuente: 'Archivo, Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  fondo: '#ffffff',
};

/** Width the chart gets when nothing measured it (server render, the document). */
export const ANCHO_POR_DEFECTO = 640;

/** Width of the element, followed with `ResizeObserver`; the chart redraws to it, text unscaled. */
export function useAncho(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ancho, setAncho] = useState(ANCHO_POR_DEFECTO);
  useLayoutEffect(() => {
    const el = ref.current;
    // The observer of the element's own window: one from the main window never fires for an
    // element portalled into the detached Results window (#395).
    const Observador = el?.ownerDocument.defaultView?.ResizeObserver;
    if (el === null || Observador === undefined) return undefined;
    const medir = (): void => {
      const w = Math.floor(el.clientWidth);
      if (w > 0) setAncho(w);
    };
    medir();
    const observador = new Observador(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, []);
  return [ref, ancho];
}

/* ------------------------------------------------------------------ *
 * Geometry shared by both forms
 * ------------------------------------------------------------------ */

const PAD = 8;
// Advance of a 12 px character of the UI font, for fitting labels: measured in Chrome at 6.3–6.4 on
// average and 7.1 for the widest real labels, so 7 errs on the side of room.
const CAR = 7;
const BARRA = 14;
const ENTRE_BARRAS = 2;
const ENTRE_GRUPOS = 10;
const RADIO = 4;

const anchoTexto = (texto: string, tam = 12): number => (texto.length * CAR * tam) / 12;

function recortar(texto: string, ancho: number): string {
  const cabe = Math.floor(ancho / CAR);
  return texto.length <= cabe ? texto : `${texto.slice(0, Math.max(1, cabe - 1))}…`;
}

const ALTO_FILA_LEYENDA = 18;

/** Where each legend entry goes: entries flow left to right and wrap, none past `ancho`. */
export function filasLeyenda(nombres: readonly string[], ancho: number): { texto: string; x: number; fila: number }[] {
  const disponible = ancho - 2 * PAD - 14;
  let x = PAD;
  let fila = 0;
  return nombres.map((nombre) => {
    const texto = recortar(nombre, Math.min(180, disponible));
    const w = 14 + anchoTexto(texto);
    if (x > PAD && x + w > ancho - PAD) {
      x = PAD;
      fila += 1;
    }
    const entrada = { texto, x, fila };
    x += w + 16;
    return entrada;
  });
}

/** Largest of `f` over `items`, at least `desde`; a loop, so no list is too long for it. */
function mayor<T>(items: readonly T[], f: (item: T) => number, desde: number): number {
  let m = desde;
  for (const item of items) m = Math.max(m, f(item));
  return m;
}

/** A bar grown from `x0` to the right: rounded data end, square at the baseline. */
function barraHorizontal(x0: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIO, w, h / 2);
  return `M${x0},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${r - w}z`;
}

/** A column grown from `base` upwards: rounded top, square at the baseline. */
function columna(x: number, base: number, w: number, h: number): string {
  const r = Math.min(RADIO, h, w / 2);
  return `M${x},${base}v${r - h}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`;
}

function Cabecera({ titulo, sub, paleta, idTitulo }: { titulo: string; sub?: string | undefined; paleta: Paleta; idTitulo: string }): ReactNode {
  return (
    <>
      <text id={idTitulo} x={PAD} y={PAD + 12} fill={paleta.tinta} fontSize={13} fontWeight={600}>
        {titulo}
      </text>
      {sub !== undefined && (
        <text x={PAD} y={PAD + 30} fill={paleta.tenue} fontSize={11}>
          {sub}
        </text>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Horizontal bars
 * ------------------------------------------------------------------ */

export interface Grupo {
  id: string;
  etiqueta: string;
  /** One value per series, in the chart's unit; `null` is absent (no bar), never zero. */
  valores: readonly (number | null)[];
  /** The text each bar shows at its tip: the table's own cell text. */
  textos: readonly string[];
}

export interface GraficaBarrasProps {
  titulo: string;
  sub?: string | undefined;
  /** Names of the series; two or more get a legend. */
  series: readonly string[];
  /** Palette slot of each series (color follows the entity, not its position). Default 0, 1, 2… */
  colores?: readonly number[] | undefined;
  grupos: readonly Grupo[];
  /** Fixed top of the axis (100 for a percentage). */
  tope?: number | undefined;
  paleta?: Paleta | undefined;
  /** Fixed width; without it the chart follows its container. */
  ancho?: number | undefined;
}

export function GraficaBarras(props: GraficaBarrasProps): ReactNode {
  const [ref, medido] = useAncho();
  return (
    <div ref={ref} className="grafica">
      <SvgBarras {...props} ancho={props.ancho ?? medido} />
    </div>
  );
}

/** Below this plot width the two half-width compare charts go full width (QA of #512). */
export const PLOT_MINIMO = 150;

/**
 * Horizontal layout of a bar chart `W` wide. The value at the tip is the table's text and is never
 * cut: it takes the room it needs, the group labels give way first (cut with «…», whole in the
 * tooltip), and the plot keeps at least 40 px.
 */
export function geometriaBarras(grupos: readonly Grupo[], W: number): { x0: number; anchoEtiqueta: number; anchoPlot: number } {
  const valorNecesario = mayor(grupos, (g) => mayor(g.textos, (t) => anchoTexto(t, 11) + 8, 0), 24);
  const anchoEtiqueta = Math.min(W * 0.3, mayor(grupos, (g) => anchoTexto(g.etiqueta) + 8, 40), Math.max(40, W - 2 * PAD - 40 - valorNecesario));
  const anchoValor = Math.min(valorNecesario, W - 2 * PAD - anchoEtiqueta - 40);
  const x0 = PAD + anchoEtiqueta;
  return { x0, anchoEtiqueta, anchoPlot: Math.max(40, W - x0 - anchoValor - PAD) };
}

/**
 * The axis ticks whose labels fit side by side at `pxPorUnidad`: every k-th one, from 0, with at
 * least 8 px between labels (the histogram does the same for its edges).
 */
export function marcasQueCaben(marcas: readonly number[], pxPorUnidad: number): number[] {
  if (marcas.length < 2) return [...marcas];
  const paso = (marcas[1]! - marcas[0]!) * pxPorUnidad;
  const etiqueta = mayor(marcas, (m) => anchoTexto(formatDisplay(m), 11), 0) + 8;
  const cada = Math.max(1, Math.ceil(etiqueta / paso));
  return marcas.filter((_, i) => i % cada === 0);
}

export function SvgBarras({
  titulo,
  sub,
  series,
  colores,
  grupos,
  tope,
  paleta = PALETA_PANTALLA,
  ancho = ANCHO_POR_DEFECTO,
}: GraficaBarrasProps): ReactNode {
  const S = useStrings();
  const id = useId();
  const color = (serie: number): string => paleta.series[colores?.[serie] ?? serie] ?? paleta.series[0]!;
  const leyenda = series.length >= 2;

  const W = Math.max(280, ancho);
  const { x0, anchoEtiqueta, anchoPlot } = geometriaBarras(grupos, W);
  const maximo = mayor(grupos, (g) => mayor(g.valores, (v) => v ?? 0, 0), 0);
  const eje = escala(maximo, tope !== undefined && maximo <= tope ? tope : undefined);
  const x = (v: number): number => x0 + (v / eje.tope) * anchoPlot;
  const marcas = marcasQueCaben(eje.marcas, anchoPlot / eje.tope);

  const altoGrupo = series.length * BARRA + (series.length - 1) * ENTRE_BARRAS;
  const entradas = leyenda ? filasLeyenda(series, W) : [];
  const filas = entradas.length === 0 ? 0 : entradas.at(-1)!.fila + 1;
  const arriba = PAD + 20 + (sub === undefined ? 0 : 18) + filas * ALTO_FILA_LEYENDA + (leyenda ? 4 : 0) + 6;
  const abajo = arriba + grupos.length * altoGrupo + Math.max(0, grupos.length - 1) * ENTRE_GRUPOS;
  const H = abajo + 6 + 16 + PAD;

  const descripcion = grupos
    .map((g) =>
      series.length === 1
        ? S.graficas.valor(g.etiqueta, g.textos[0] ?? '')
        : `${g.etiqueta}: ${series.map((s, i) => S.graficas.valor(s, g.textos[i] ?? '')).join(', ')}`,
    )
    .join('; ');

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-d`}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      fontFamily={paleta.fuente}
    >
      <title>{titulo}</title>
      <desc id={`${id}-d`}>{descripcion}</desc>
      {paleta.fondo !== undefined && <rect width={W} height={H} fill={paleta.fondo} />}
      <Cabecera titulo={titulo} sub={sub} paleta={paleta} idTitulo={`${id}-t`} />
      {leyenda && (
        <g className="leyenda" transform={`translate(0 ${PAD + 20 + (sub === undefined ? 0 : 18) + 4})`}>
          {entradas.map(({ texto, x: x1, fila }, i) => (
            <g key={i}>
              <title>{series[i]}</title>
              <rect x={x1} y={2 + fila * ALTO_FILA_LEYENDA} width={10} height={10} rx={2} fill={color(i)} />
              <text x={x1 + 14} y={11 + fila * ALTO_FILA_LEYENDA} fill={paleta.tinta} fontSize={12}>
                {texto}
              </text>
            </g>
          ))}
        </g>
      )}
      {marcas.map((m) => (
        <g key={m}>
          <line x1={x(m)} x2={x(m)} y1={arriba - 4} y2={abajo + 4} stroke={paleta.reja} strokeWidth={1} />
          <text className="marca-eje" x={x(m)} y={abajo + 18} fill={paleta.tenue} fontSize={11} textAnchor="middle">
            {formatDisplay(m)}
          </text>
        </g>
      ))}
      {grupos.map((g, gi) => {
        const y = arriba + gi * (altoGrupo + ENTRE_GRUPOS);
        return (
          <g key={g.id} data-grupo={g.id}>
            <text x={x0 - 6} y={y + altoGrupo / 2 + 4} fill={paleta.tinta} fontSize={12} textAnchor="end">
              {recortar(g.etiqueta, anchoEtiqueta - 8)}
            </text>
            {series.map((nombre, si) => {
              const v = g.valores[si] ?? null;
              const yb = y + si * (BARRA + ENTRE_BARRAS);
              const w = v === null ? 0 : Math.max(0, x(v) - x0);
              const texto = g.textos[si] ?? '';
              return (
                <g key={si} className="marca" data-serie={si} data-valor={v ?? ''}>
                  <title>{series.length === 1 ? S.graficas.valor(g.etiqueta, texto) : `${g.etiqueta} · ${S.graficas.valor(nombre, texto)}`}</title>
                  <rect x={x0} y={yb - 1} width={W - x0 - PAD} height={BARRA + 2} fill="transparent" />
                  {w > 0 && <path className="barra" d={barraHorizontal(x0, yb, w, BARRA)} fill={color(si)} />}
                  <text className="valor" x={x0 + w + 4} y={yb + BARRA - 3} fill={paleta.tinta} fontSize={11}>
                    {texto}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
      <line x1={x0} x2={x0} y1={arriba - 4} y2={abajo + 4} stroke={paleta.tenue} strokeWidth={1} />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Histogram
 * ------------------------------------------------------------------ */

export interface HistogramaProps {
  titulo: string;
  sub?: string | undefined;
  /** Values already in the chart's unit. */
  valores: readonly number[];
  paleta?: Paleta | undefined;
  ancho?: number | undefined;
}

export function Histograma(props: HistogramaProps): ReactNode {
  const [ref, medido] = useAncho();
  return (
    <div ref={ref} className="grafica">
      <SvgHistograma {...props} ancho={props.ancho ?? medido} />
    </div>
  );
}

/** Text of a class, the same in the `<desc>`, the tooltip and the data table. */
export function textoClase(c: Clase): string {
  return c.desde === c.hasta ? formatDisplay(c.desde) : `${formatDisplay(c.desde)} – ${formatDisplay(c.hasta)}`;
}

export function SvgHistograma({ titulo, sub, valores, paleta = PALETA_PANTALLA, ancho = ANCHO_POR_DEFECTO }: HistogramaProps): ReactNode {
  const S = useStrings();
  const id = useId();
  const clases = histograma(valores);
  const W = Math.max(280, ancho);
  const eje = escala(mayor(clases, (c) => c.casos, 0));
  const anchoY = Math.max(24, anchoTexto(formatDisplay(eje.tope), 11) + 10);
  const x0 = PAD + anchoY;
  const anchoPlot = W - x0 - PAD;
  const arriba = PAD + 20 + (sub === undefined ? 0 : 18) + 26;
  const alto = 160;
  const base = arriba + alto;
  const H = base + 6 + 16 + PAD;
  const y = (v: number): number => base - (v / eje.tope) * alto;
  const anchoClase = clases.length === 0 ? 0 : anchoPlot / clases.length;
  const moda = clases.reduce((mejor, c, i) => (c.casos > (clases[mejor]?.casos ?? -1) ? i : mejor), 0);
  // At most about eight edge labels, so they never run into each other.
  const cadaCuantas = Math.max(1, Math.ceil((clases.length + 1) / Math.max(2, Math.floor(anchoPlot / 64))));
  const bordes = clases.length === 1 && clases[0]!.desde === clases[0]!.hasta ? [] : [...clases.map((c) => c.desde), clases.at(-1)?.hasta ?? 0];

  const descripcion = clases.map((c) => S.graficas.valor(textoClase(c), S.graficas.casos(c.casos))).join('; ');

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-labelledby={`${id}-t`}
      aria-describedby={`${id}-d`}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      fontFamily={paleta.fuente}
    >
      <title>{titulo}</title>
      <desc id={`${id}-d`}>{descripcion}</desc>
      {paleta.fondo !== undefined && <rect width={W} height={H} fill={paleta.fondo} />}
      <Cabecera titulo={titulo} sub={sub} paleta={paleta} idTitulo={`${id}-t`} />
      {eje.marcas.map((m) => (
        <g key={m}>
          <line x1={x0} x2={W - PAD} y1={y(m)} y2={y(m)} stroke={paleta.reja} strokeWidth={1} />
          <text x={x0 - 6} y={y(m) + 4} fill={paleta.tenue} fontSize={11} textAnchor="end">
            {formatDisplay(m)}
          </text>
        </g>
      ))}
      <text x={PAD} y={arriba - 14} fill={paleta.tenue} fontSize={11}>
        {S.graficas.ejeCasos}
      </text>
      {clases.map((c, i) => {
        const h = base - y(c.casos);
        const xc = x0 + i * anchoClase + 1;
        const w = Math.max(1, anchoClase - 2);
        return (
          <g key={i} className="marca" data-clase={textoClase(c)} data-valor={c.casos}>
            <title>{S.graficas.valor(textoClase(c), S.graficas.casos(c.casos))}</title>
            <rect x={xc} y={arriba} width={w} height={alto} fill="transparent" />
            {c.casos > 0 && <path className="barra" d={columna(xc, base, w, h)} fill={paleta.series[0]} />}
            {i === moda && c.casos > 0 && (
              <text x={xc + w / 2} y={y(c.casos) - 4} fill={paleta.tinta} fontSize={11} textAnchor="middle">
                {formatDisplay(c.casos)}
              </text>
            )}
          </g>
        );
      })}
      <line x1={x0} x2={W - PAD} y1={base} y2={base} stroke={paleta.tenue} strokeWidth={1} />
      {bordes.map((b, i) =>
        i % cadaCuantas === 0 ? (
          // The last edge ends at the plot's right edge instead of running past it.
          <text key={i} x={x0 + i * anchoClase} y={base + 16} fill={paleta.tenue} fontSize={11} textAnchor={i === bordes.length - 1 ? 'end' : 'middle'}>
            {formatDisplay(b)}
          </text>
        ) : null,
      )}
      {bordes.length === 0 && clases.length === 1 && (
        <text x={x0 + anchoPlot / 2} y={base + 16} fill={paleta.tenue} fontSize={11} textAnchor="middle">
          {textoClase(clases[0]!)}
        </text>
      )}
    </svg>
  );
}
