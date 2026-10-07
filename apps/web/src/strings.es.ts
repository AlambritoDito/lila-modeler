/**
 * Traducción al español del catálogo base (`strings.en.ts`, LILA-210).
 *
 * Aquí no se decide qué textos hay: eso lo fija `strings.en.ts`, que es la lengua base, y el tipo
 * `Strings` (`strings.types.ts`) obliga a que esta traducción tenga **exactamente** sus claves,
 * con la misma forma —lo que allí es una función con dos parámetros, aquí también—. Olvidar una
 * clave, inventarse otra o cambiar una función por un texto no compila; `strings.test.ts` lo
 * vuelve a comprobar en tiempo de ejecución, clave por clave, para los mapas que `tsc` no puede
 * comparar (`Record<string, string>`).
 *
 * Las claves siguen en español (`app.guardar`, `escenario.seccionCorrida`): son identificadores,
 * no texto que nadie lea, y renombrar ~380 de ellas tocaría todos los componentes sin que nadie
 * lo notara en pantalla.
 *
 * Lo que decide **este** archivo y no el base: el plural, el género y la morfología del español
 * (`errores(n)`, `densidadNombre('comoda') === 'cómoda'`), y `tokenSim.traducciones`, que es el
 * inventario de cadenas que `bpmn-js-token-simulation` escribe en inglés dentro del lienzo y que
 * en la lengua base está vacío por serlo ya.
 *
 * Lo que **no** está aquí, a propósito (igual que en el base): los mensajes del motor
 * (`packages/engine`, § 17 de `docs/SEMANTICS.md`), los nombres de columna que fija Bizagi
 * (`S.resultados.columnas`, `docs/BIZAGI_PARITY.md`) y las claves del JSON Schema del escenario
 * (`docs/SCENARIO_FORMAT.md`): esos tres no se traducen.
 */

import type { Strings } from './strings.types';

/** Días de la semana del formato de calendarios, en el orden canónico (`CalendarEditor.DIAS`). */
const DIAS_SEMANA = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export const startupEs: Strings['startup'] = { loading: 'Preparando tu espacio de trabajo…', error: 'Lila Modeler no pudo terminar de iniciar. Recarga para intentarlo de nuevo.', reload: 'Recargar' };

export const es: Strings = {
  startup: startupEs,
  /* ------------------------------------------------------------------ *
   * Shell de la app (`App.tsx`)
   * ------------------------------------------------------------------ */
  app: {
    /** Nombre del producto en la marca de la barra superior (`.identidad`, diseño 2d); no se
     * pinta en Electron, donde ya lo lleva la barra de título del sistema. */
    marca: 'Lila Modeler',
    /** Rótulo de cada modo de la barra superior; el id lo fija `ids.ts` (`MODO_IDS`). */
    modos: {
      modelar: 'Modelar',
      simular: 'Simular',
      resultados: 'Resultados',
    },
    /** Rótulo de cada pestaña del panel derecho; el id lo fija `ids.ts` (`PESTANA_IDS`). */
    pestanas: {
      propiedades: 'Propiedades',
      documentacion: 'Documentación',
      simulacion: 'Simulación',
    },

    /** Nombre visible de cada tema integrado (`src/theme/themes/*.json`). */
    temas: { 'lila-light': 'Lila claro', 'lila-dark': 'Lila oscuro', 'eva-01': 'Eva-01', papel: 'Papel', tieso: 'Tieso', akira: 'Akira', montana: 'Montana' },
    /** Nombre visible de cada densidad; el id (`ids.ts`) es lo que se guarda en `localStorage`. */
    densidades: { compacta: 'Compacta', normal: 'Normal', comoda: 'Cómoda' },
    /** El mismo nombre en minúscula, para la barra de estado («Densidad cómoda»). */
    densidadNombre: (id: string): string => (id === 'comoda' ? 'cómoda' : id),

    /** Nombre por defecto de un proyecto nuevo y del que la app trae de serie. */
    proyectoNuevo: 'Mi proyecto',
    proyectoDemo: 'Pedido de ejemplo',

    /** Barra superior: identidad del proyecto y estado de guardado. */
    sinGuardar: 'Sin guardar',
    guardado: 'Guardado',

    /** Menú «Archivo» del navegador (en Electron es el menú nativo). */
    menuArchivo: 'Archivo',
    nuevo: 'Nuevo',
    abrir: 'Abrir',
    guardar: 'Guardar',
    guardarComo: 'Guardar como',
    importarBpmn: 'Importar BPMN…',
    exportarBpmn: 'Exportar .bpmn',
    exportarSvg: 'Exportar diagrama como SVG',
    exportarPng: 'Exportar diagrama como PNG',
    exportarDocx: 'Exportar documento del proceso (Word)',
    exportarHtml: 'Exportar documento del proceso (HTML)',
    imprimirPdf: 'Imprimir / Guardar como PDF…',
    tituloNuevo: 'Nuevo proyecto',
    tituloAbrir: 'Abrir proyecto',
    tituloGuardar: 'Guardar proyecto',
    tituloGuardarComo: 'Guardar como',

    /** Menú «Archivo» de escritorio (#411): mismas palabras que el menú nativo
     * (`apps/desktop/src/strings/es.ts`), letra por letra. */
    menuEscritorio: {
      nuevoProyecto: 'Nuevo proyecto',
      abrirProyecto: 'Abrir proyecto…',
      abrirProyectoArchivo: 'Abrir archivo de proyecto (.lila)…',
      importarBpmn: 'Importar BPMN…',
      abrirReciente: 'Abrir reciente',
      // QA de #432 (N1): igual, letra por letra, al vacío del menú nativo
      // (`menu.ninguno` en `apps/desktop/src/strings/es.ts`), no una paráfrasis más larga.
      ninguno: 'Ninguno',
      guardarProyecto: 'Guardar proyecto',
      guardarComo: 'Guardar como…',
      guardarComoCarpeta: 'Guardar como carpeta…',
      exportarSvg: 'Exportar diagrama como SVG…',
      exportarPng: 'Exportar diagrama como PNG…',
      exportarPdf: 'Exportar diagrama como PDF…',
      exportarDocx: 'Exportar documento del proceso (Word)…',
      exportarHtml: 'Exportar documento del proceso (HTML)…',
      imprimir: 'Imprimir…',
    },

    /** Botón buscador de la barra: abre la paleta de comandos (#410). El texto de dentro
     * (`buscarPista`) es más corto que el rótulo accesible: a 1400 px con la barra en español el
     * campo apenas tiene sitio, y «Buscar actividad…» se recortaba a mitad de palabra, «Busı»
     * (QA de la ronda 2 de #392). */
    buscar: 'Buscar actividad',
    buscarPista: 'Buscar…',

    deshacer: 'Deshacer',
    rehacer: 'Rehacer',
    ajustes: 'Ajustes',
    cancelar: 'Cancelar',

    /** Acción primaria y su progreso. */
    ejecutar: 'Ejecutar simulación',
    preparando: 'Preparando…',
    replicacion: (actual: number, total: number): string => `Replicación ${actual} de ${total}`,
    porCiento: (n: number): string => `${n} %`,

    /** Ventana desacoplable del escenario (diseño 2c): el interruptor de la barra y lo que queda en el panel. */
    escenarioAcoplado: 'Escenario acoplado ↗',
    escenarioDesacoplado: 'En ventana aparte',
    acoplar: 'Acoplar',
    enVentanaAparte: 'Escenario en ventana aparte ↗',
    mostrarVentana: 'Mostrar',
    ventanaBloqueada: 'El navegador bloqueó la ventana del escenario. Permite ventanas emergentes para este sitio para desacoplarlo.',
    acercaBloqueada: 'Se bloqueó la ventana Acerca de; permite ventanas emergentes para este sitio.',
    tituloVentanaEscenario: (nombre: string): string => `Escenario ${nombre} — Lila Modeler`,
    /** Ventana de Resultados desacoplable (#395): mismo interruptor y sustituto que el escenario. */
    resultadosAcoplados: 'Resultados acoplados ↗',
    resultadosDesacoplados: 'Resultados en ventana aparte',
    resultadosEnVentana: 'Resultados en otra ventana ↗',
    resultadosBloqueada: 'El navegador bloqueó la ventana de Resultados. Permite ventanas emergentes para este sitio para desacoplarla.',
    tituloVentanaResultados: 'Resultados — Lila Modeler',

    /** Controles de zoom del lienzo. */
    acercar: 'Acercar',
    alejar: 'Alejar',
    ajustarPantalla: 'Ajustar a pantalla',

    /** Diálogo de cambios sin guardar. */
    reemplazoTitulo: 'Cambios sin guardar',
    reemplazoTexto: (proyecto: string): string =>
      `Guarda los cambios de ${proyecto} antes de continuar, o descártalos.`,
    guardarYContinuar: 'Guardar y continuar',
    descartar: 'Descartar',

    /** Diálogo de pérdida al exportar o guardar (LILA-192). */
    perdidaVerbo: { exportar: 'Exportar', guardar: 'Guardar' },
    perdidaTitulo: (n: number): string =>
      `${n === 1 ? 'Se perderá' : 'Se perderán'} ${n} ${
        n === 1
          ? 'referencia que el archivo original ya tenía rota'
          : 'referencias que el archivo original ya tenía rotas'
      }`,
    perdidaTexto: (guardando: boolean): string =>
      `El editor solo puede escribir lo que pudo leer, así que el .bpmn ${
        guardando ? 'guardado' : 'descargado'
      } no las llevará:`,
    perdidaConfirmar: (verbo: string): string => `${verbo} igualmente`,

    /** Diálogo de ajustes. El endónimo de cada idioma es el mismo en todos los catálogos. */
    idioma: 'Idioma',
    idiomaAuto: 'Predeterminado del sistema',
    idiomas: { en: 'English', es: 'Español' },
    apariencia: 'Apariencia',
    tema: 'Tema',
    densidad: 'Densidad',
    cerrar: 'Cerrar',
    /** Ajustes → Acerca de Lila Modeler (LILA-381): cierra Ajustes y abre el diálogo Acerca de. */
    acercaDe: 'Acerca de Lila Modeler',

    /** Chips de validación sobre el lienzo y contadores de la barra de estado. */
    irAlPrimerProblema: 'Ir al primer elemento con problemas',
    errores: (n: number): string => `${n} ${n === 1 ? 'error' : 'errores'}`,
    avisos: (n: number): string => `${n} ${n === 1 ? 'aviso' : 'avisos'}`,

    /** Modo Resultados y modo Comparar sin nada que enseñar todavía. */
    sinResultados: 'Simula la revisión actual para ver resultados.',
    sinCorridaActual: 'No hay corrida actual para el escenario seleccionado.',
    corridaResumen: (
      escenario: string,
      modelRevision: number,
      scenarioRevision: number,
      semilla: string,
      moneda: string,
    ): string =>
      `${escenario} · revisión ${modelRevision}/${scenarioRevision} · semilla ${semilla} · ${moneda}`,

    /** Pestaña «Simulación» del panel derecho. */
    escenario: 'Escenario',
    errorSimular: (mensaje: string): string => `No se pudo simular: ${mensaje}`,
    /** Nombre del cuello principal: el id solo se añade cuando aporta algo (#226). */
    nombreDeCuello: (nombre: string, id: string): string => `${nombre} (${id})`,

    /** Pestañas de diagrama, abajo a la izquierda. */
    cerrarDiagrama: 'Cerrar diagrama',
    cerrarArchivo: (archivo: string): string => `Cerrar ${archivo}`,
    /** Divisor entre el lienzo y el panel derecho (diseño 2a). */
    redimensionarPanel: 'Redimensionar el panel derecho',
    /** Divisor entre la columna izquierda y el lienzo (#406). */
    redimensionarIzquierda: 'Redimensionar la columna izquierda',
    /** Botones para mostrar u ocultar paneles, a la derecha de la barra (#412). */
    vista: 'Vista',
    /** Grupo de botones de alinear y distribuir sobre el lienzo, en Modelar (#453). */
    alinear: 'Alinear y distribuir',
    regiones: {
      izquierda: 'Columna izquierda',
      derecha: 'Panel derecho',
      diagramas: 'Pestañas de diagramas',
      estado: 'Barra de estado',
      dock: 'Tabla de resultados',
    },
    tituloRegiones: {
      izquierda: 'Mostrar u ocultar la columna izquierda',
      derecha: 'Mostrar u ocultar el panel derecho',
      diagramas: 'Mostrar u ocultar las pestañas de diagramas',
      estado: 'Mostrar u ocultar la barra de estado',
      dock: 'Mostrar u ocultar la tabla de resultados',
    },
    /** El botón de la barra de estado mientras un error la mantiene en pantalla (#412). */
    tituloEstadoForzado: 'Mostrar u ocultar la barra de estado — sigue mientras muestre un error',

    /** Barra de estado. */
    semilla: (valor: string): string => `Semilla ${valor}`,
    /** Semilla desconocida: el escenario no resuelve o no la declara. */
    sinValor: '—',
    densidadEstado: (nombre: string): string => `Densidad ${nombre}`,
    zoom: (porCiento: number): string => `Zoom ${porCiento} % · ajustar`,
    cambioExterno: 'El archivo cambió fuera de Lila',
    recargarCambioExterno: 'Recargar',
    mantenerMios: 'Conservar los míos',
    diagramaSuelto: 'Diagrama suelto: los escenarios y las corridas no se guardan hasta «Guardar como»',
    perdidaAlExportar: (n: number, lista: string): string =>
      `${n} ${n === 1 ? 'elemento o referencia' : 'elementos o referencias'} ${
        n === 1 ? 'se perderá' : 'se perderán'
      } al exportar: ${lista}`,
    avisosAlImportar: (n: number): string =>
      `${n} ${
        n === 1 ? 'aviso' : 'avisos'
      } al importar; revisa el diagnóstico antes de simular o exportar`,
    errorAbrirDiagrama: (mensaje: string): string => `No se pudo abrir el diagrama: ${mensaje}`,
    errorTema: (mensaje: string): string => `No se pudo cargar el tema: ${mensaje}`,

    /** Errores de E/S del shell. */
    errorTemaHttp: (estado: number): string => `el servidor respondió ${estado}`,
    errorModeladorNoListo: 'El modelador todavía no está listo.',
    errorModeloCambio:
      'El modelo cambió durante el guardado. Vuelve a guardar la revisión actual.',
    exportacionOcupada:
      'Todavía hay una exportación, un guardado o un cambio de proceso en curso. Vuelve a exportar cuando termine.',
    guardadoOcupado:
      'Todavía hay una exportación, un guardado o un cambio de proceso en curso. Vuelve a guardar cuando termine.',
    errorProyectoCambio:
      'El proyecto cambió mientras se abría el archivo. Conservamos tus cambios; vuelve a abrirlo.',
    errorRecienteAusente: 'Ese proyecto ya no está en su carpeta; se quitó de recientes.',
    errorAbrirOcupado: (archivo: string): string =>
      `No se abrió "${archivo}": hay otra operación en curso. Vuelve a abrirlo cuando termine.`,
    errorCopiaRecuperacion: (mensaje: string): string =>
      `No se pudo abrir la copia de recuperación de la última sesión y se descartó: ${mensaje}`,
    errorEscenarioDesconocido: (ruta: string): string => `escenario desconocido: ${ruta}`,
    problemaDeArchivo: (archivo: string, mensaje: string): string => `${archivo}: ${mensaje}`,
  },

  /* ------------------------------------------------------------------ *
   * Bienvenida de escritorio (`Bienvenida.tsx`, artboard 08)
   * ------------------------------------------------------------------ */
  bienvenida: {
    titulo: 'Bienvenida',
    nombre: 'Lila Modeler',
    subtitulo: (version: string): string => `v${version} · código abierto · BPMN 2.0`,
    empezar: 'Empezar',
    abrirLila: 'Abrir proyecto (.lila)…',
    abrirLilaPista: 'un archivo de proyecto con sus escenarios y corridas guardadas',
    abrirCarpeta: 'Abrir carpeta de proyecto',
    abrirCarpetaPista: 'una carpeta con model.bpmn',
    nuevo: 'Nuevo proceso',
    nuevoPista: 'crea un .bpmn vacío',
    ejemplosTitulo: 'Ejemplos',
    ejemplos: {
      pedido: { titulo: 'Pedido de restaurante', pista: 'Atención en mostrador con escenarios AS-IS / TO-BE' },
      // QA of #505, N5/M1: one short line each — a longer one forced `.bienvenida-izq` to its
      // min-content width through `white-space: nowrap` and crushed the right column.
      'bizagi-level-1': { titulo: 'Bizagi nivel 1', pista: 'Reconstrucción del tutorial de Bizagi: solo rutas' },
      'bizagi-level-2': { titulo: 'Bizagi nivel 2', pista: 'Reconstrucción del tutorial de Bizagi: añade tiempos de proceso' },
      'bizagi-level-3': { titulo: 'Bizagi nivel 3', pista: 'Reconstrucción del tutorial de Bizagi: añade tres enfermeras' },
      'bizagi-level-4': { titulo: 'Bizagi nivel 4', pista: 'Reconstrucción del tutorial de Bizagi: añade turnos' },
      'mm1-rho08': { titulo: 'Cola M/M/1 (ρ=0,8)', pista: 'Cola de un servidor validada contra Erlang C' },
      mm3: { titulo: 'Cola M/M/3 (ρ=0,8)', pista: 'Cola de tres servidores validada contra Erlang C' },
    },
    documentacion: 'Documentación',
    repositorio: 'Repositorio',
    recientes: 'Recientes',
    sinRecientes: 'Todavía no hay proyectos recientes. Abre uno o empieza por alguno de los ejemplos.',
    novedades: (version: string): string => `Novedades de ${version}`,
    notasVersion: 'Notas de la versión',
    tema: (tema: string, densidad: string): string => `Tema ${tema} · ${densidad}`,
    cambiarApariencia: 'cambiar en Ajustes → Apariencia',
  },

  /* ------------------------------------------------------------------ *
   * Ajustes → Apariencia (`settings/Apariencia.tsx`, LILA-114)
   * ------------------------------------------------------------------ */
  apariencia: {
    nombre: 'Nombre del tema',
    /** Un tema integrado no se edita: la primera edición cae sobre esta copia. */
    copia: (nombre: string): string => `${nombre} (copia)`,
    duplicar: 'Duplicar',
    restablecer: 'Restablecer',
    exportar: 'Exportar',
    importar: 'Importar',
    eliminar: 'Eliminar',
    integrado: 'Integrados',
    delUsuario: 'Míos',
    muestraTexto: 'Texto sobre superficie',
    muestraSecundario: 'Texto secundario',
    muestraBoton: 'Acento',
    /** Seguir el esquema claro/oscuro del sistema (#472). */
    seguirSistema: 'Seguir el tema del sistema',
    seguirSistemaAyuda: 'Cambia entre el tema claro y el oscuro de abajo cuando tu sistema cambia de modo.',
    temaClaro: 'Tema claro',
    temaOscuro: 'Tema oscuro',
    /** Aviso único la primera vez que el tema cambia solo (#472). */
    avisoTitulo: 'El tema cambió',
    avisoTexto: (tema: string, oscuro: boolean): string =>
      `El tema cambió a ${tema} porque tu sistema pasó a modo ${oscuro ? 'oscuro' : 'claro'}. ¿Mantener el cambio automático?`,
    mantener: 'Mantener',
    apagar: 'Apagar',

    /**
     * Rótulo de cada grupo del editor, por prefijo del token. Son los mismos grupos con los que
     * `theme/tokens.ts` lista los 40 tokens; el orden lo manda esa lista, no este objeto.
     */
    grupos: {
      bg: 'Base',
      border: 'Base',
      shadow: 'Base',
      fg: 'Texto',
      accent: 'Acentos',
      status: 'Estados',
      canvas: 'Lienzo y diagrama',
      diagram: 'Lienzo y diagrama',
      sim: 'Simulación',
      font: 'Tipografía',
      density: 'Tipografía',
    } as Record<string, string>,
    color: (token: string): string => `Color de ${token}`,
    hex: (token: string): string => `Hex de ${token}`,
    tamanoBase: 'Tamaño base (px)',
    /**
     * Familias que la app trae empaquetadas (`#238`), más «Sistema» para no depender de ninguna.
     * `valor` es el valor del token tal cual: una lista de familias CSS con su respaldo.
     * ponytail: no hay editor de fuentes ni carga de familias del sistema; techo: si hace falta,
     * un `<datalist>` con `queryLocalFonts()` donde el navegador lo permita.
     */
    fuentes: [
      { nombre: 'Archivo', valor: 'Archivo, Inter, system-ui, sans-serif' },
      { nombre: 'JetBrains Mono', valor: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" },
      { nombre: 'Sistema', valor: 'system-ui, sans-serif' },
    ],

    /** Errores de importar un JSON ajeno; se leen dentro del diálogo, sin aplicar nada. */
    errorImportar: (mensaje: string): string => `No se importó el tema. ${mensaje}`,
    errorJson: 'El archivo no es JSON válido.',
    errorForma: 'El archivo no es un tema de Lila Modeler: se esperaba { "name": …, "tokens": { … } }.',
    errorNombre: 'El tema no tiene nombre ("name").',
    errorToken: (token: string): string => `El token "${token}" no existe en Lila Modeler.`,
    errorValor: (token: string): string => `El token "${token}" no tiene un valor de texto.`,
    errorHex: (token: string, valor: string): string =>
      `El token "${token}" es un color y "${valor}" no es un hex (#rgb, #rrggbb o #rrggbbaa).`,
    errorDensidad: (valor: string): string =>
      `La densidad "${valor}" no existe: usa compacta, normal o comoda.`,
  },

  /* ------------------------------------------------------------------ *
   * Cascarón del diálogo de Ajustes (`settings/Ajustes.tsx`, artboard 09, #407)
   * ------------------------------------------------------------------ */
  ajustes: {
    /** Rótulos de la navegación, columna izquierda (`role="tablist"`). */
    secciones: {
      general: 'General',
      apariencia: 'Apariencia',
      atajos: 'Atajos',
    },
    /** Cabeceras de columna de la tabla de Atajos. */
    accion: 'Acción',
    tecla: 'Tecla',
    /** General → «Advanced» switch (#447) and the text beside it. */
    avanzado: 'Avanzado',
    avanzadoAyuda: 'Mostrar los ids BPMN de los elementos junto a sus nombres',
  },

  /* ------------------------------------------------------------------ *
   * Paleta de figuras (`Paleta.tsx`)
   * ------------------------------------------------------------------ */
  paleta: {
    filtrar: 'Filtrar figuras',
    modoCompacto: 'Modo compacto',
    entrarCompacto: 'Modo compacto (solo iconos)',
    salirCompacto: 'Salir del modo compacto',
    arrastrar: 'arrastrar',
    piePrefijo: 'Arrastra al lienzo o pulsa ',
    pieTecla: 'Enter',
    pieSufijo: ' para insertar',
    sinCoincidencias: (filtro: string): string => `Ninguna figura coincide con «${filtro}».`,
    requiereActividad: (figura: string): string => `${figura}: selecciona una tarea o un subproceso para adjuntarlo`,
    requiereContenedor: (figura: string): string => `${figura}: añade antes un pool`,
    eligePool: 'Haz clic en el pool o carril donde añadir el carril. Esc cancela.',
    comandos: {
      titulo: 'Paleta de comandos',
      pista: 'Busca elementos, escenarios, modos y acciones',
      sinResultados: (consulta: string): string => `Nada coincide con «${consulta}».`,
      grupos: { elementos: 'Elementos', escenarios: 'Escenarios', modos: 'Modos', acciones: 'Acciones' },
    },
    grupos: {
      eventosInicio: 'Eventos de inicio',
      eventosIntermedios: 'Eventos intermedios',
      eventosFin: 'Eventos de fin',
      eventosBorde: 'Eventos de borde',
      actividades: 'Actividades',
      compuertas: 'Compuertas',
      datos: 'Datos',
      artefactos: 'Artefactos',
      poolsYCarriles: 'Pools y carriles',
    },
    figuras: {
      inicio: 'Inicio',
      inicioMensaje: 'Inicio de mensaje',
      inicioTemporizador: 'Inicio de temporizador',
      inicioSenal: 'Inicio de señal',
      inicioCondicional: 'Inicio condicional',
      intermedio: 'Intermedio',
      capturaMensaje: 'Captura de mensaje',
      capturaTemporizador: 'Captura de temporizador',
      capturaSenal: 'Captura de señal',
      capturaEnlace: 'Captura de enlace',
      capturaCondicional: 'Captura condicional',
      lanzamientoMensaje: 'Lanzamiento de mensaje',
      lanzamientoSenal: 'Lanzamiento de señal',
      lanzamientoEnlace: 'Lanzamiento de enlace',
      lanzamientoEscalado: 'Lanzamiento de escalado',
      fin: 'Fin',
      finMensaje: 'Fin de mensaje',
      finTerminar: 'Fin terminal',
      finError: 'Fin de error',
      finSenal: 'Fin de señal',
      bordeMensaje: 'Borde de mensaje',
      bordeTemporizador: 'Borde de temporizador',
      bordeError: 'Borde de error',
      bordeSenal: 'Borde de señal',
      tarea: 'Tarea',
      tareaUsuario: 'Tarea de usuario',
      tareaServicio: 'Tarea de servicio',
      tareaManual: 'Tarea manual',
      tareaScript: 'Tarea de script',
      tareaEnvio: 'Tarea de envío',
      tareaRecepcion: 'Tarea de recepción',
      tareaReglaNegocio: 'Tarea de regla de negocio',
      subproceso: 'Subproceso',
      subprocesoPlegado: 'Subproceso plegado',
      subprocesoEvento: 'Subproceso de evento',
      transaccion: 'Transacción',
      actividadLlamada: 'Actividad de llamada',
      exclusiva: 'Exclusiva',
      paralela: 'Paralela',
      inclusiva: 'Inclusiva',
      basadaEnEventos: 'Basada en eventos',
      objetoDeDatos: 'Objeto de datos',
      almacenDeDatos: 'Almacén de datos',
      anotacion: 'Anotación',
      grupo: 'Grupo',
      pool: 'Pool',
      carril: 'Carril',
    },
  },

  /* ------------------------------------------------------------------ *
   * Textos propios de bpmn-js (`bpmnTranslate.ts`, #456): la clave es la plantilla inglesa de
   * bpmn-js tal cual; `{element}` lo rellena bpmn-js.
   * ------------------------------------------------------------------ */
  bpmnJs: {
    // Context pad (ContextPadProvider)
    'Delete': 'Eliminar',
    'Add lane above': 'Añadir carril arriba',
    'Divide into two lanes': 'Dividir en dos carriles',
    'Divide into three lanes': 'Dividir en tres carriles',
    'Add lane below': 'Añadir carril abajo',
    'Append task': 'Añadir tarea',
    'Append end event': 'Añadir evento de fin',
    'Append gateway': 'Añadir compuerta',
    'Append intermediate/boundary event': 'Añadir evento intermedio o de borde',
    'Append receive task': 'Añadir tarea de recepción',
    'Append message intermediate catch event': 'Añadir evento intermedio de captura de mensaje',
    'Append timer intermediate catch event': 'Añadir evento intermedio de captura de temporizador',
    'Append conditional intermediate catch event': 'Añadir evento intermedio de captura condicional',
    'Append signal intermediate catch event': 'Añadir evento intermedio de captura de señal',
    'Append compensation activity': 'Añadir actividad de compensación',
    'Change element': 'Cambiar elemento',
    'Add text annotation': 'Añadir anotación de texto',
    'Connect to other element': 'Conectar con otro elemento',
    'Connect using association': 'Conectar con una asociación',
    'Connect using data input association': 'Conectar con una asociación de entrada de datos',
    'Align elements': 'Alinear elementos',
    'Align elements left': 'Alinear a la izquierda',
    'Align elements center': 'Centrar en horizontal',
    'Align elements right': 'Alinear a la derecha',
    'Align elements top': 'Alinear arriba',
    'Align elements middle': 'Centrar en vertical',
    'Align elements bottom': 'Alinear abajo',
    'Distribute elements horizontally': 'Distribuir en horizontal',
    'Distribute elements vertically': 'Distribuir en vertical',
    'Open {element}': 'Abrir {element}',
    'Search in diagram': 'Buscar en el diagrama',
    'flow elements must be children of pools/participants': 'los elementos de flujo tienen que ir dentro de un pool',
    'Data object must be placed within a pool/participant.': 'El objeto de datos tiene que ir dentro de un pool.',
    // bpmn-js palette (hidden by the app, translated for completeness)
    'Activate hand tool': 'Activar la herramienta mano',
    'Activate lasso tool': 'Activar la herramienta lazo',
    'Activate create/remove space tool': 'Activar la herramienta de crear o quitar espacio',
    'Activate global connect tool': 'Activar la herramienta de conexión',
    'Create start event': 'Crear evento de inicio',
    'Create intermediate/boundary event': 'Crear evento intermedio o de borde',
    'Create end event': 'Crear evento de fin',
    'Create gateway': 'Crear compuerta',
    'Create task': 'Crear tarea',
    'Create data object reference': 'Crear objeto de datos',
    'Create data store reference': 'Crear almacén de datos',
    'Create expanded sub-process': 'Crear subproceso expandido',
    'Create pool/participant': 'Crear pool',
    'Create group': 'Crear grupo',
    // Replace menu: activities (PopupEntries, ReplaceOptions)
    'Task': 'Tarea',
    'User task': 'Tarea de usuario',
    'Service task': 'Tarea de servicio',
    'Send task': 'Tarea de envío',
    'Receive task': 'Tarea de recepción',
    'Manual task': 'Tarea manual',
    'Business rule task': 'Tarea de regla de negocio',
    'Script task': 'Tarea de script',
    'Call activity': 'Actividad de llamada',
    'Transaction': 'Transacción',
    'Event sub-process': 'Subproceso de evento',
    'Sub-process': 'Subproceso',
    'Sub-process (collapsed)': 'Subproceso (plegado)',
    'Sub-process (expanded)': 'Subproceso (expandido)',
    'Ad-hoc sub-process': 'Subproceso ad hoc',
    'Ad-hoc sub-process (collapsed)': 'Subproceso ad hoc (plegado)',
    'Ad-hoc sub-process (expanded)': 'Subproceso ad hoc (expandido)',
    // Replace menu: gateways, data, pools and flows
    'Exclusive gateway': 'Compuerta exclusiva',
    'Parallel gateway': 'Compuerta paralela',
    'Inclusive gateway': 'Compuerta inclusiva',
    'Complex gateway': 'Compuerta compleja',
    'Event-based gateway': 'Compuerta basada en eventos',
    'Event based instantiating Gateway': 'Compuerta basada en eventos que instancia',
    'Parallel Event based instantiating Gateway': 'Compuerta paralela basada en eventos que instancia',
    'Data store reference': 'Almacén de datos',
    'Data object reference': 'Objeto de datos',
    'Expanded pool/participant': 'Pool expandido',
    'Empty pool/participant': 'Pool vacío',
    'Empty pool/participant (removes content)': 'Pool vacío (elimina el contenido)',
    'Sequence flow': 'Flujo de secuencia',
    'Default flow': 'Flujo por defecto',
    'Conditional flow': 'Flujo condicional',
    // Replace menu: events
    'Start event': 'Evento de inicio',
    'Intermediate throw event': 'Evento intermedio de lanzamiento',
    'Boundary event': 'Evento de borde',
    'End event': 'Evento de fin',
    'Message start event': 'Evento de inicio de mensaje',
    'Timer start event': 'Evento de inicio de temporizador',
    'Conditional start event': 'Evento de inicio condicional',
    'Signal start event': 'Evento de inicio de señal',
    'Error start event': 'Evento de inicio de error',
    'Escalation start event': 'Evento de inicio de escalado',
    'Compensation start event': 'Evento de inicio de compensación',
    'Message start event (non-interrupting)': 'Evento de inicio de mensaje (sin interrupción)',
    'Timer start event (non-interrupting)': 'Evento de inicio de temporizador (sin interrupción)',
    'Conditional start event (non-interrupting)': 'Evento de inicio condicional (sin interrupción)',
    'Signal start event (non-interrupting)': 'Evento de inicio de señal (sin interrupción)',
    'Escalation start event (non-interrupting)': 'Evento de inicio de escalado (sin interrupción)',
    'Message intermediate catch event': 'Evento intermedio de captura de mensaje',
    'Message intermediate throw event': 'Evento intermedio de lanzamiento de mensaje',
    'Timer intermediate catch event': 'Evento intermedio de captura de temporizador',
    'Escalation intermediate throw event': 'Evento intermedio de lanzamiento de escalado',
    'Conditional intermediate catch event': 'Evento intermedio de captura condicional',
    'Link intermediate catch event': 'Evento intermedio de captura de enlace',
    'Link intermediate throw event': 'Evento intermedio de lanzamiento de enlace',
    'Compensation intermediate throw event': 'Evento intermedio de lanzamiento de compensación',
    'Signal intermediate catch event': 'Evento intermedio de captura de señal',
    'Signal intermediate throw event': 'Evento intermedio de lanzamiento de señal',
    'Message boundary event': 'Evento de borde de mensaje',
    'Timer boundary event': 'Evento de borde de temporizador',
    'Escalation boundary event': 'Evento de borde de escalado',
    'Conditional boundary event': 'Evento de borde condicional',
    'Error boundary event': 'Evento de borde de error',
    'Cancel boundary event': 'Evento de borde de cancelación',
    'Signal boundary event': 'Evento de borde de señal',
    'Compensation boundary event': 'Evento de borde de compensación',
    'Message boundary event (non-interrupting)': 'Evento de borde de mensaje (sin interrupción)',
    'Timer boundary event (non-interrupting)': 'Evento de borde de temporizador (sin interrupción)',
    'Escalation boundary event (non-interrupting)': 'Evento de borde de escalado (sin interrupción)',
    'Conditional boundary event (non-interrupting)': 'Evento de borde condicional (sin interrupción)',
    'Signal boundary event (non-interrupting)': 'Evento de borde de señal (sin interrupción)',
    'Message end event': 'Evento de fin de mensaje',
    'Escalation end event': 'Evento de fin de escalado',
    'Error end event': 'Evento de fin de error',
    'Cancel end event': 'Evento de fin de cancelación',
    'Compensation end event': 'Evento de fin de compensación',
    'Signal end event': 'Evento de fin de señal',
    'Terminate end event': 'Evento de fin terminal',
    // Replace menu: markers (ReplaceMenuProvider)
    'Parallel multi-instance': 'Multiinstancia paralela',
    'Sequential multi-instance': 'Multiinstancia secuencial',
    'Loop': 'Bucle',
    'Collection': 'Colección',
    'Participant multiplicity': 'Multiplicidad del participante',
    'Toggle non-interrupting': 'Alternar sin interrupción',
  },

  /* ------------------------------------------------------------------ *
   * Panel de propiedades y documentación (`PropertiesPanel.tsx`)
   * ------------------------------------------------------------------ */
  propiedades: {
    /* #396: «Vista rápida · simulación» bajo la cabecera del elemento elegido. */
    vistaRapida: 'Vista rápida · simulación',
    vistaTiempo: 'Tiempo',
    vistaRecurso: 'Recurso',
    vistaEsperaP95: 'Espera por recurso p95',
    vistaEsperaMedia: 'Espera por recurso (media)',
    vistaSinCorrida: 'sin corrida',
    editarEnTiempos: 'Editar en Tiempos',
    editarEnRecursos: 'Editar en Recursos',

    sinSeleccion: 'Selecciona un elemento del lienzo para ver sus propiedades.',
    variosSeleccionados: (n: number): string =>
      `${n} elementos seleccionados. El color se aplica a todos; ` +
      'selecciona uno solo para editar lo demás.',

    /* Cabecera del panel derecho sin nada seleccionado (diseño "Turno 2", bloque 2d). */
    nadaSeleccionado: 'Nada seleccionado',
    pistaSeleccion: 'Elige una figura para editarla, o empieza por el proceso.',
    proceso: 'Proceso',
    elementos: 'Elementos',
    // «Pools / carriles» (QA de la ronda 1 de #392): un ejemplo con pools pero sin carriles
    // internos leía «Carriles 0» con dos pools a la vista; esta fila cuenta los dos (ver `PanelVacio`).
    carriles: 'Pools / carriles',
    avisos: 'Avisos',
    atajos: 'Atajos',
    renombrar: 'Renombrar',

    textoAnotacion: 'Texto de la anotación',
    nombre: 'Nombre',
    sinNombre: 'Sin nombre',
    tipoSinNombre: 'Este tipo no tiene nombre',
    nombreProceso: 'Nombre del proceso',
    tipo: 'Tipo',
    id: 'Id',
    copiar: 'Copiar',
    copiado: 'Copiado',
    /** Ancho de la actividad (#563): el campo de Propiedades y por qué se rechaza un valor. */
    ancho: 'Ancho',
    anchoProblemas: {
      vacio: 'Escribe un ancho.',
      numero: 'El ancho debe ser un número, por ejemplo 120.',
      minimo: (minimo: number): string => `El ancho debe ser al menos ${minimo}.`,
      maximo: (maximo: number): string => `El ancho debe ser como mucho ${maximo}.`,
    },
    /** Colores por elemento (#452): la fila del panel, la entrada del context pad y los ocho colores. */
    color: 'Color',
    cambiarColor: 'Cambiar color',
    colores: {
      ninguno: 'Ninguno',
      azul: 'Azul',
      verde: 'Verde',
      amarillo: 'Amarillo',
      naranja: 'Naranja',
      rojo: 'Rojo',
      morado: 'Morado',
      turquesa: 'Turquesa',
      gris: 'Gris',
    },

    descripcion: 'Descripción',
    descripcionProceso: 'Descripción del proceso',
    descripcionPista: 'Para qué sirve este elemento',
    versionProceso: 'Versión del proceso',
    versionPista: '1.0.0',

    responsabilidades: 'Responsabilidades',
    anadirResponsabilidad: '+ Añadir responsabilidad',
    quitarResponsabilidad: 'Quitar responsabilidad',
    quitarResponsabilidadN: (i: number): string => `Quitar responsabilidad ${i}`,
    tipoResponsabilidad: (i: number): string => `Tipo de responsabilidad ${i}`,
    rol: (i: number): string => `Rol ${i}`,
    rolPista: 'id del rol',
    sinTipo: 'Sin tipo',
    noEsRaci: (tipo: string): string => `${tipo} · no es RACI`,
    /** Tipos RACI de `lila:responsibility` (`docs/BPMN_EXTENSION.md` § 2). */
    raci: [
      ['R', 'R · Responsable'],
      ['A', 'A · Aprueba'],
      ['C', 'C · Consultado'],
      ['I', 'I · Informado'],
    ],

    anadir: '+ Añadir',
    anadirA: (etiqueta: string): string => `Añadir a ${etiqueta}`,
    referenciaN: (etiqueta: string, i: number): string => `${etiqueta} ${i}`,
    quitarDe: (etiqueta: string): string => `Quitar de ${etiqueta.toLowerCase()}`,
    quitarDeN: (etiqueta: string, i: number): string => `Quitar de ${etiqueta.toLowerCase()} ${i}`,
    /** Símbolo del botón de quitar; no es texto que se traduzca. */
    cruz: '×',

    /** Los `lila:*Ref` sueltos: tipo moddle, rótulo del grupo y texto de ayuda del campo. */
    referencias: [
      ['lila:SystemRef', 'Sistemas', 'id del sistema'],
      ['lila:DocumentRef', 'Documentos', 'id del documento'],
      ['lila:RiskRef', 'Riesgos', 'id del riesgo'],
      ['lila:ControlRef', 'Controles', 'id del control'],
      ['lila:KpiRef', 'KPIs', 'id del indicador'],
      ['lila:Input', 'Entradas', 'id de la entrada'],
      ['lila:Output', 'Salidas', 'id de la salida'],
    ],

    /** Nombre legible del `$type` BPMN; lo que no está aquí sale sin el prefijo `bpmn:`. */
    tipos: {
      'bpmn:Task': 'Tarea',
      'bpmn:UserTask': 'Tarea de usuario',
      'bpmn:ManualTask': 'Tarea manual',
      'bpmn:ServiceTask': 'Tarea de servicio',
      'bpmn:ScriptTask': 'Tarea de script',
      'bpmn:SendTask': 'Tarea de envío',
      'bpmn:ReceiveTask': 'Tarea de recepción',
      'bpmn:BusinessRuleTask': 'Tarea de regla de negocio',
      'bpmn:CallActivity': 'Actividad de llamada',
      'bpmn:SubProcess': 'Subproceso',
      'bpmn:StartEvent': 'Evento de inicio',
      'bpmn:EndEvent': 'Evento de fin',
      'bpmn:IntermediateCatchEvent': 'Evento intermedio de captura',
      'bpmn:IntermediateThrowEvent': 'Evento intermedio de lanzamiento',
      'bpmn:BoundaryEvent': 'Evento de borde',
      'bpmn:ExclusiveGateway': 'Compuerta exclusiva (XOR)',
      'bpmn:ParallelGateway': 'Compuerta paralela (AND)',
      'bpmn:InclusiveGateway': 'Compuerta inclusiva (OR)',
      'bpmn:EventBasedGateway': 'Compuerta basada en eventos',
      'bpmn:ComplexGateway': 'Compuerta compleja',
      'bpmn:SequenceFlow': 'Flujo de secuencia',
      'bpmn:MessageFlow': 'Flujo de mensaje',
      'bpmn:Association': 'Asociación',
      'bpmn:DataObjectReference': 'Objeto de datos',
      'bpmn:DataStoreReference': 'Almacén de datos',
      'bpmn:TextAnnotation': 'Anotación de texto',
      'bpmn:Group': 'Grupo',
      'bpmn:Participant': 'Pool',
      'bpmn:Lane': 'Carril',
      'bpmn:Process': 'Proceso',
      'bpmn:Collaboration': 'Colaboración',
    } as Record<string, string>,
  },

  /* ------------------------------------------------------------------ *
   * Raíl de escenarios de Simular (`RailEscenarios.tsx`, diseño 2a)
   * ------------------------------------------------------------------ */
  rail: {
    /** La insignia BASE de «Escenario ▾» y de la cabecera del panel. */
    base: 'BASE',
  },

  /* ------------------------------------------------------------------ *
   * Panel de escenario (`ScenarioPanel.tsx`)
   * ------------------------------------------------------------------ */
  escenario: {
    guardar: 'Guardar',
    duplicar: 'Duplicar',
    /** Pie de la ventana desacoplada, junto a Duplicar y Guardar. */
    pieVentana: 'los cambios se ven en el lienzo al instante',
    /** Cabecera: errores y avisos del escenario en edición. */
    conteo: (errores: number, avisos: number): string =>
      `${errores} ${errores === 1 ? 'error' : 'errores'} · ${avisos} ${
        avisos === 1 ? 'aviso' : 'avisos'
      }`,
    titulo: (nombre: string): string => `Escenario ${nombre}`,
    /** Línea mono bajo la cabecera: el archivo y su padre `extends`, «—» si es base. */
    archivoHereda: (archivo: string, padre: string | null): string =>
      `${archivo} · hereda de ${padre ?? '—'}`,

    /**
     * #333/#396, Lote M — los seis pasos del panel de simulación, nombrados por lo que edita cada uno
     * (los rótulos del diseño). `docs/es/COMING-FROM-BIZAGI.md` los relaciona con los cuatro
     * niveles de Bizagi.
     */
    pasos: 'Pasos',
    paso: {
      arrivals: 'Llegadas',
      times: 'Tiempos',
      routes: 'Rutas',
      resources: 'Recursos',
      calendars: 'Calendarios',
      run: 'Ejecución',
    } as Record<string, string>,
    pasoAyuda: {
      arrivals: 'Cómo entran los casos: cada cuánto dispara cada evento de inicio y cuántos casos crea.',
      times: 'Cuánto tarda cada actividad y cuánto cuesta cada vez que se hace.',
      routes: 'Qué parte de los casos sigue cada camino al salir de una compuerta.',
      resources:
        'Quién hace el trabajo: pools, cuántas unidades, cuándo trabaja cada pool (su calendario y su capacidad por turno) y qué tarea toma cuál.',
      calendars: 'Cuándo se puede trabajar: calendarios y festivos, y qué calendario sigue cada elemento.',
      run: 'Cuánto dura la simulación, desde cuándo y cuántas réplicas.',
    } as Record<string, string>,
    /** Lote M: el «! n» de un paso, leído junto al nombre del paso. */
    pasoProblemas: (n: number): string => `${n} ${n === 1 ? 'problema' : 'problemas'}`,
    /** Lote M: una tarea sin `processingTime` en el escenario (el motor la correría en tiempo cero). */
    sinDuracion: (tarea: string): string => `${tarea}: sin duración, así que no tardaría nada.`,

    /** Listas de elementos de los pasos: qué está parametrizado y qué falta. */
    listaTiempos: 'Tiempos por elemento',
    listaRecursos: 'Recursos por elemento',
    listaLlegadas: 'Llegadas por evento de inicio',
    resumenLlegada: (cada: string, casos: number | null): string =>
      casos === null ? cada : `${cada} · ${casos} ${casos === 1 ? 'caso' : 'casos'}`,
    irARecursos: 'Ir a Recursos',
    /** #430: entradas de ids que el diagrama ya no tiene (se borró una forma configurada). */
    huerfanas: 'Entradas de elementos que ya no están en el diagrama',
    quitarHuerfanas: 'Quitar entradas huérfanas',
    sinResumen: '—',
    resumenAsignacion: (pool: string, cantidad: number): string => `${pool} ×${cantidad}`,

    seccionCorrida: 'Corrida',
    seccionCalendarios: 'Calendarios',
    seccionRecursos: 'Recursos',
    seccionElemento: 'Elemento seleccionado',
    seccionValidacion: (errores: number): string =>
      `Validación (${errores} ${errores === 1 ? 'error' : 'errores'})`,

    /** Elemento seleccionado: el id manda, el nombre BPMN va al lado como contexto. */
    nombreEntreParentesis: (nombre: string): string => ` (${nombre})`,

    /** Formulario generado desde el JSON Schema. */
    sinDefinir: '(sin definir)',
    quitar: 'Quitar',
    quitarHeredado: 'Quitar heredado',
    restaurarHeredado: 'Restaurar heredado',
    quitarClave: (clave: string): string => `quitar ${clave}`,
    quitarElemento: 'quitar',
    quitarItem: (etiqueta: string, i: number): string => `quitar ${etiqueta} ${i}`,
    anadir: 'Añadir',
    anadirEtiqueta: (etiqueta: string): string => `Añadir ${etiqueta}`,
    claveNueva: 'clave nueva',
    /** #579: el control para crear, arriba de Calendarios y de Recursos. */
    nuevoCalendario: 'Nuevo calendario',
    ejemploCalendario: 'turno-noche',
    crearCalendario: '+ En blanco',
    nuevoRecurso: 'Nuevo recurso',
    ejemploRecurso: 'analista',
    crearRecurso: '+ Crear recurso',
    claveRepetida: (clave: string): string => `${clave} ya existe; edítalo abajo o usa otro id.`,
    itemNumerado: (etiqueta: string, i: number): string => `${etiqueta} ${i}`,
    eliminadoNull: 'eliminado (null)',
    /** Etiqueta de `EstadoReservado` `'propio'`/`'heredado'`: nunca el id interno (#477). */
    estadoPropio: 'propio',
    estadoHeredado: 'heredado',
    estadoReservado: (etiquetaEstado: string, valor: string): string => `${etiquetaEstado}: ${valor}`,
    /** Etiqueta de una variante sin discriminador ni tipo conocido. */
    opcionN: (i: number): string => `opción ${i}`,
    /** Tipos JSON del esquema, en español, para el selector de variante. */
    tiposJson: {
      string: 'texto',
      number: 'número',
      integer: 'número entero',
      boolean: 'sí/no',
      object: 'objeto',
      array: 'lista',
    } as Record<string, string>,

    /**
     * Nombres de campo del JSON Schema que el panel rotula a mano (`docs/SCENARIO_FORMAT.md`):
     * son la ortografía del archivo, no una etiqueta traducible. Se leen desde aquí para que la
     * prueba de aceptación no tenga que llevar una lista blanca aparte.
     */
    claves: { capacity: 'capacity', calendar: 'calendar', intervals: 'intervals' },

    /**
     * #332 — el rótulo de cada campo del escenario. La clave es la ortografía de
     * `docs/SCENARIO_FORMAT.md`; una clave que no esté aquí se rotula con su propio nombre.
     */
    campos: {
      // run (§ 2.2)
      start: 'Inicio',
      duration: 'Duración',
      warmup: 'Calentamiento',
      replications: 'Réplicas',
      seed: 'Semilla',
      baseTimeUnit: 'Unidad de tiempo',
      currency: 'Moneda',
      serviceLevel: 'Nivel de servicio',
      // calendars (§ 2.3)
      intervals: 'Franjas',
      days: 'Días',
      from: 'Desde',
      to: 'Hasta',
      monthDays: 'Días del mes',
      monthWeekdays: 'Días de la semana del mes',
      dates: 'Fechas anuales',
      nth: 'Semana del mes',
      day: 'Día de la semana',
      // resources (§ 2.4)
      name: 'Nombre',
      type: 'Tipo',
      capacity: 'Capacidad',
      costPerHour: 'Coste por hora',
      // elements (§ 2.5)
      processingTime: 'Tiempo de proceso',
      resources: 'Recursos',
      selection: 'Selección de recursos',
      fixedCost: 'Coste fijo',
      interTriggerTimer: 'Tiempo entre llegadas',
      triggerCount: 'Llegadas máximas',
      calendar: 'Calendario',
      probability: 'Probabilidad',
      ref: 'Grupo',
      quantity: 'Cantidad',
      // parámetros de las distribuciones (§ 3)
      value: 'Valor',
      min: 'Mínimo',
      mode: 'Moda',
      max: 'Máximo',
      mean: 'Media',
      sd: 'Desviación típica',
      shape: 'Forma',
      scale: 'Escala',
      k: 'Fases (k)',
      alpha: 'Alfa',
      beta: 'Beta',
      n: 'Intentos (n)',
      p: 'Probabilidad de éxito (p)',
      points: 'Puntos',
      // ADR-028: conditions en un flujo que sale de un XOR divergente
      flowTaken: 'Flujo ya recorrido',
      // reservados (§ 4)
      priority: 'Prioridad',
      preempt: 'Expulsión',
      batch: 'Lote',
      conditions: 'Condiciones',
      holidays: 'Festivos',
      timezone: 'Zona horaria',
    } as Record<string, string>,

    /** Ayuda breve bajo un campo, solo donde la unidad o el valor por defecto no se ven. */
    ayudas: {
      start: 'Instante cero del reloj virtual; su desfase es la zona en que se leen los calendarios.',
      duration: 'Cuánto corre el reloj simulado.',
      warmup: 'Los casos empezados antes de esto no cuentan en las estadísticas.',
      serviceLevel: 'Tiempo de ciclo objetivo; solo para el informe, no cambia la simulación.',
      baseTimeUnit: 'Solo presentación: los tiempos se guardan siempre en segundos.',
      replications: 'Corridas independientes; lo habitual es recomendar 30.',
      processingTime: 'Duración del trabajo.',
      interTriggerTimer: 'Tiempo entre llegadas en este evento de inicio.',
      triggerCount: 'Número máximo de casos que genera este inicio.',
      probability: 'Entre 0 y 1. Sin ella la compuerta reparte por igual.',
      conditions: 'Solo en un flujo que sale de una compuerta exclusiva divergente: la probabilidad que se usa si el caso ya recorrió el flujo indicado. Gana la primera que coincide; sin ninguna, aplica la probability a secas.',
      flowTaken: 'Id de un sequence flow del diagrama, aguas arriba de esta compuerta.',
      'conditions.probability': 'Entre 0 y 1. El peso que toma este flujo cuando la condición encaja; sustituye a la probability suelta, no se suma a ella.',
      fixedCost: 'Coste por token completado en este elemento.',
      costPerHour: 'Coste por hora ocupada, no por hora disponible.',
      capacity: 'Unidades del grupo disponibles a la vez.',
      quantity: 'Unidades del grupo que toma esta tarea.',
      selection: 'and: espera a todos los grupos. or: toma el primero que quede libre.',
      calendar: 'Sin calendario el elemento está disponible 24×7.',
    } as Record<string, string>,

    /** Las 13 distribuciones de BPSim más la constante y la empírica (§ 3). */
    distribuciones: {
      constant: 'Constante',
      uniform: 'Uniforme',
      triangular: 'Triangular',
      exponential: 'Exponencial',
      normal: 'Normal',
      truncatedNormal: 'Normal truncada',
      lognormal: 'Lognormal',
      gamma: 'Gamma',
      erlang: 'Erlang',
      weibull: 'Weibull',
      beta: 'Beta',
      poisson: 'Poisson',
      binomial: 'Binomial',
      user: 'Empírica (puntos)',
    } as Record<string, string>,

    /** Unidad en que se teclean los tiempos del panel; se enseña junto a cada duración. */
    unidades: { s: 'seg', min: 'min', h: 'h', day: 'días' } as Record<string, string>,

    /** `run.start` (R8): fecha y hora más el desfase UTC, en vez de un ISO escrito a mano. */
    fechaHora: 'Fecha y hora',
    desfase: 'Desfase UTC',

    /** Paso Rutas (#332, Lote M C4): una compuerta sin salidas. */
    compuertaSinSalientes: 'Esta compuerta no tiene flujos salientes.',

    /** Vista avanzada: el delta crudo del archivo en edición (§ 6), para lo que el formulario no da. */
    seccionJson: 'Avanzado: JSON del escenario',
    aplicarJson: 'Aplicar',
    jsonInvalido: (mensaje: string): string => `No es JSON válido: ${mensaje}`,
    jsonNoEsObjeto: 'El escenario tiene que ser un objeto JSON.',

    /** #449: parámetros del escenario desde Excel/CSV, revisados antes de aplicarse. */
    importar: 'Importar Excel/CSV…',
    plantilla: 'Descargar plantilla',
    importarAyuda: 'Descarga la plantilla, rellénala en Excel e impórtala. Las celdas vacías no cambian nada y no se aplica nada hasta que confirmes.',
    importarSinModelo: 'Abre primero un diagrama: las filas se emparejan con sus elementos.',
    importarTitulo: (archivo: string): string => `Importar desde ${archivo}`,
    importarCambios: (n: number): string => (n === 1 ? '1 cambio por aplicar:' : `${n} cambios por aplicar:`),
    importarSinCambios: 'Nada que cambiar: el archivo dice lo que el escenario ya tiene.',
    importarNuevo: 'nuevo',
    importarNoEmparejadas: (n: number): string => `Filas sin aplicar: no coinciden con nada o son ambiguas (${n})`,
    importarErrores: (n: number): string => `Filas sin aplicar: valores inválidos (${n})`,
    importarAvisos: (n: number): string => `Notas (${n})`,
    importarAplicar: 'Aplicar',
    importarCancelar: 'Cancelar',
    importarAplicado: (n: number): string => (n === 1 ? 'Se importó 1 cambio.' : `Se importaron ${n} cambios.`),
    importarDeshacer: 'Deshacer importación',
    importarIlegible: 'El archivo no se pudo leer como hoja de cálculo: elige un libro .xlsx o un archivo CSV.',
    importarDemasiadoGrande: 'El libro es demasiado grande para importarlo (más de 50 MB de hojas descomprimidas).',
    importarFueraDeLimites: 'El libro tiene celdas más allá de la última fila o columna que admite Excel; parece dañado.',
    importarLint: (n: number): string => `Errores que tendría el escenario al aplicar (${n}): corrige el archivo e impórtalo de nuevo`,
    importarDesde: (hoja: string, fila: number): string => `${hoja}, fila ${fila}`,
    importarCaducado: 'El escenario cambió después de leer el archivo: impórtalo de nuevo para aplicarlo.',
    importarCaducadoDiagrama: 'El diagrama cambió después de leer el archivo: impórtalo de nuevo para aplicarlo.',

    /** `resources[pool].capacity` (LILA-164): fija o por turnos. */
    capacidadFija: 'Fija',
    capacidadPorTurno: 'Por turno',
    tramo: (i: number): string => `tramo ${i}`,
    quitarTramo: (i: number): string => `quitar tramo ${i}`,
    anadirTramo: 'Añadir tramo',

    /** `calendars[clave].intervals` (LILA-203): rejilla semanal o lista genérica. */
    editarComoLista: 'Editar como lista',
    editarComoRejilla: 'Editar como rejilla',
    calendarioConMinutos:
      'este calendario tiene franjas de minutos, que la rejilla no puede mostrar: usa las franjas o la lista',

    /** «Asignar carril a pool» (LILA-334): una edición en bloque de `elements[task].resources`. */
    carrilCarril: 'Carril',
    carrilPool: 'Recurso',
    carrilAsignar: 'Asignar carril → recurso',
    carrilAyuda: (tareas: number): string =>
      `Cada tarea del carril (${tareas}) pasa a usar este recurso; el carril no se guarda en ninguna parte.`,
    carrilYaAsignadas: (tareas: number): string =>
      `${tareas} ${tareas === 1 ? 'tarea ya tiene' : 'tareas ya tienen'} recursos; asignar los reemplaza:`,
    carrilSobrescribir: 'Sobrescribir',
    carrilCancelar: 'Cancelar',

    /** «Duplicar»: nombre y archivo de la copia (§ 6 de `docs/SCENARIO_FORMAT.md`). */
    sufijoCopia: ' (copia)',
    errorEscenarioDesconocido: (ruta: string): string => `escenario desconocido: ${ruta}`,
  },

  /* ------------------------------------------------------------------ *
   * Editor semanal de calendarios (`CalendarEditor.tsx`)
   * ------------------------------------------------------------------ */
  calendario: {
    rejilla: 'Horario semanal: días por horas',
    /** Nombre accesible de una celda: el día traducido (`diasLargos`) y la hora. */
    celda: (dia: string, hhmm: string): string => `${dia} ${hhmm}`,
    /** Selector de franjas encima de la rejilla (#448). */
    nuevaFranja: 'Nueva franja horaria',
    presets: { laborables: 'Lun–Vie', todos: 'Todos', finDeSemana: 'Fin de semana' },
    dias: { MON: 'Lun', TUE: 'Mar', WED: 'Mié', THU: 'Jue', FRI: 'Vie', SAT: 'Sáb', SUN: 'Dom' },
    diasLargos: {
      MON: 'lunes',
      TUE: 'martes',
      WED: 'miércoles',
      THU: 'jueves',
      FRI: 'viernes',
      SAT: 'sábado',
      SUN: 'domingo',
    } satisfies Record<(typeof DIAS_SEMANA)[number], string>,
    desde: 'Desde',
    hasta: 'Hasta',
    formatoHora: 'HH:MM',
    anadir: 'Añadir franja',
    lista: 'Franjas actuales',
    franja: (dias: string, from: string, to: string): string => `${dias} ${from}–${to}`,
    quitar: 'Quitar',
    quitarFranja: (franja: string): string => `Quitar ${franja}`,
    /** #82: cómo se repite la franja nueva: cada semana, cada mes o cada año (R-CAL-12, R-CAL-13). */
    repeticion: 'Se repite',
    repeticiones: {
      semanal: 'Cada semana',
      diaDelMes: 'Cada mes, un día',
      diaSemanaDelMes: 'Cada mes, un día de la semana',
      anual: 'Cada año, una fecha',
    },
    diaDelMes: 'Día del mes',
    ultimoDia: 'Último día',
    semanaDelMes: 'Semana del mes',
    ordinales: { '1': '1.º', '2': '2.º', '3': '3.º', '4': '4.º', '5': '5.º', '-1': 'Último' } as Record<string, string>,
    diaSemana: 'Día de la semana',
    mes: 'Mes',
    dia: 'Día',
    meses: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
    /** Fila de la lista de una franja mensual o anual. */
    diaN: (n: number): string => `día ${n}`,
    /** `n` contando desde el final del mes: 1 es el último, 2 el penúltimo… */
    desdeElFinal: (n: number, cosa: string): string =>
      n === 1 ? `último ${cosa}` : n === 2 ? `penúltimo ${cosa}` : n === 3 ? `antepenúltimo ${cosa}` : `${n}.º ${cosa} desde el final`,
    diaCosa: 'día',
    cadaMesDias: (dias: string): string => `${dias} de cada mes`,
    cadaMesSemana: (quien: string): string => `${quien} de cada mes`,
    cadaAno: (fechas: string): string => `Cada año el ${fechas}`,
    fecha: (dia: number, mes: string): string => `${dia} ${mes}`,
    /** #82: festivos, cerrado todo el día digan lo que digan las franjas (R-CAL-14). */
    festivos: 'Festivos',
    nuevoFestivo: 'Fecha del festivo',
    festivoCadaAno: 'Cada año',
    anadirFestivo: 'Añadir festivo',
    listaFestivos: 'Festivos actuales',
    festivoAnual: (mmdd: string): string => `${mmdd} (cada año)`,
    quitarFestivo: (festivo: string): string => `Quitar ${festivo}`,
    ayudaFestivos: 'Cerrado todo el día, digan lo que digan las franjas de arriba.',
  },
  /** Lote M (C3): el gestor de calendarios del paso Calendarios (`GestorCalendarios.tsx`). */
  gcal: {
    vacioTitulo: 'Aún no hay calendarios',
    vacioTexto: 'Sin calendario, los recursos trabajan las 24 h todos los días. Empieza con una plantilla:',
    desdePlantilla: 'O desde plantilla',
    plantillas: { laborable: 'L–V 9–18', continuo: '24/7', extendido: 'L–S 6–22' },
    nombreEnBlanco: 'calendario',
    enBlancoAviso: 'Un calendario en blanco no tiene horas hasta que las pintes en Semana.',
    lista: 'Calendarios del escenario',
    horasSemana: (horas: string): string => `${horas} h/sem`,
    horasPorSemana: (horas: string): string => `${horas} h por semana`,
    usadoPorN: (n: number): string => `Usado por ${n}`,
    sinUso: 'Sin uso',
    conProblemas: 'Tiene problemas',
    nombre: 'Nombre del calendario',
    nombreRepetido: (nombre: string): string => `Ya existe un calendario «${nombre}»`,
    nombreVacio: 'El nombre no puede quedar vacío',
    eliminar: 'Eliminar calendario',
    eliminarBloqueado: 'No se puede eliminar mientras alguien lo use (mira «Usado por»).',
    pestanasRotulo: 'Apartados del calendario',
    pestanas: { semana: 'Semana', festivos: 'Festivos', repeticiones: 'Repeticiones', uso: 'Usado por' },
    ayudaSemana: 'Arrastra para pintar las horas de trabajo; arrastra sobre una hora pintada para borrarla. Con teclado: flechas, Espacio y Mayús+flecha para pintar.',
    sinHoras: 'Este calendario no tiene horas: quien lo use nunca trabajará.',
    copiarLunes: 'Copiar lunes a L–V',
    vaciar: 'Vaciar',
    ayudaRepeticiones:
      'Horas que se añaden en fechas que se repiten: un día del mes (o el último), el n-ésimo día de la semana del mes o una fecha cada año.',
    nadieLoUsa: 'Nadie usa este calendario todavía.',
    tiposUso: { recurso: 'Recurso', turno: 'Turno', tarea: 'Tarea', llegada: 'Llegadas', elemento: 'Elemento' },
    turnoCapacidad: (n: number): string => `${n} en el turno`,
    irA: (nombre: string): string => `Ir a ${nombre} en Recursos`,
    asignarA: 'Asignar a un recurso',
    nombreEnDerivado: (nombre: string, archivo: string): string => `${archivo} ya tiene un calendario «${nombre}»`,
    usadoEnDerivados: (archivos: string): string => `También lo nombran escenarios que heredan de este: ${archivos}.`,
    ahoraUsa: (nombre: string, calendario: string): string => `${nombre} (ahora: ${calendario})`,
    asignar: 'Asignar',
    asignado: (nombre: string): string => `Asignado a ${nombre}.`,
    sinRecursos: 'Aún no hay recursos: créalos en Recursos.',
    todosAsignados: 'Todos los recursos ya lo usan o tienen capacidad por turnos (esos eligen calendario en cada turno, en Recursos).',
  },

  /* ------------------------------------------------------------------ *
   * Lote M, C2: el paso Recursos, maestro-detalle (`PasoRecursos.tsx`, `FichaRecurso.tsx`)
   * ------------------------------------------------------------------ */
  recursos: {
    nuevo: '+ Nuevo recurso',
    /** Prefijo de la clave de un recurso nuevo: `recurso-1`, `recurso-2`… */
    prefijoClave: 'recurso',
    vacioTitulo: 'Aún no hay recursos',
    vacioTexto:
      'Sin recursos, cada tarea empieza en cuanto llega un caso y nunca hay espera. Crea uno por cada rol o equipo.',
    lista: 'Recursos',
    colRecurso: 'Recurso · calendario',
    colCapacidad: 'Cap.',
    colCosto: (moneda: string): string => `${moneda}/h`,
    capacidadFija: (n: string): string => `×${n}`,
    turnos: (n: number): string => (n === 1 ? '1 turno' : `${n} turnos`),
    siempre: '24/7',
    porTurnos: 'por turnos',
    conErrores: (n: number): string => (n === 1 ? '1 error' : `${n} errores`),
    volver: '← Recursos',
    ficha: 'Recurso',
    nombre: 'Nombre',
    ejemploNombre: 'p. ej. Supervisor',
    /** Ajustes → «Avanzado» (#447): la clave del archivo de escenario, renombrada con sus referencias. */
    clave: 'Id en el escenario',
    claveMotivo: {
      vacia: 'El id no puede quedar vacío.',
      repetida: 'Otro recurso ya tiene este id.',
      heredada: 'Este recurso viene del escenario padre: su id se cambia allí.',
      enDerivado: 'Un escenario derivado de este ya tiene un recurso con este id.',
    } as Record<string, string>,
    apartados: 'Apartados del recurso',
    apartado: { cap: 'Capacidad', cost: 'Costos', uso: 'Calendario y uso' },
    capacidad: 'Capacidad',
    fija: 'Fija',
    porTurno: 'Por turnos',
    unidades: 'Unidades disponibles',
    capacidadCero: 'Capacidad 0: las tareas de este recurso nunca empezarán.',
    restar: 'Restar una unidad',
    sumar: 'Sumar una unidad',
    turnoN: (i: number): string => `Turno ${i}`,
    turnoCalendario: 'Calendario',
    turnoCapacidad: 'Unidades',
    quitarTurno: (i: number): string => `Quitar turno ${i}`,
    anadirTurno: '+ Turno',
    ayudaTurnos: 'Cada turno es un calendario con su propio número de unidades; sus horas se editan en Calendarios.',
    sinCalendarios: 'Aún no hay calendarios: crea uno en Calendarios para trabajar por turnos.',
    porHora: (moneda: string): string => `Por hora (${moneda})`,
    fijoPorUso: (moneda: string): string => `Fijo por uso (${moneda})`,
    costoEjemplo: (importe: string, moneda: string): string =>
      `Un uso de una hora con una unidad cuesta ${importe} ${moneda}.`,
    calendario: 'Calendario',
    calendarioSiempre: 'Siempre disponible (24/7)',
    calendarioPorTurnos: 'Por turnos: el calendario de cada turno dice cuándo trabaja.',
    horasSemana: (horas: string, resumen: string): string => (resumen === '' ? `${horas} h por semana` : `${horas} h por semana · ${resumen}`),
    sinCalendario: 'Sin calendario: trabaja las 24 h.',
    tipo: 'Tipo',
    tipos: { role: 'Persona o rol', equipment: 'Equipo' } as Record<string, string>,
    tareas: 'Tareas que realiza',
    ningunaTarea: 'Ninguna todavía.',
    cantidad: (n: number): string => `×${n}`,
    eliminar: 'Eliminar recurso',
    eliminarUsado: (tareas: number): string =>
      `${tareas} ${tareas === 1 ? 'tarea usa' : 'tareas usan'} este recurso: ${tareas === 1 ? 'quedará' : 'quedarán'} apuntando a nada.`,
    eliminarConfirmar: 'Eliminar igualmente',
    eliminarCancelar: 'Cancelar',
    eliminarBloqueado: (escenarios: string): string => `No se puede eliminar: lo usan los escenarios derivados ${escenarios}.`,
    descartarTurnos: (n: number): string =>
      `Fija conserva solo el turno 1; ${n === 1 ? 'se descarta el otro turno' : `se descartan los otros ${n} turnos`}.`,
    descartarConfirmar: 'Pasar a fija',
    descartarCancelar: 'Cancelar',
    carrilEntero: 'Asignar un carril entero',
    carrilEnteroAyuda: 'O haz clic en el nombre de un carril en el lienzo.',
    carrilTitulo: (carril: string, tareas: number): string =>
      `Carril «${carril}» · ${tareas} ${tareas === 1 ? 'tarea' : 'tareas'}`,
    carrilTituloAyuda: 'Asigna todas sus tareas a un mismo recurso.',
    carrilSinNombre: (n: number): string => `Carril sin nombre ${n}`,
    recurso: 'Recurso',
    asignar: 'Asignar',
    cerrarCarril: 'Cerrar',
    carrilHecho: (tareas: number, carril: string, recurso: string): string =>
      `${tareas} ${tareas === 1 ? 'tarea' : 'tareas'} de «${carril}» ${tareas === 1 ? 'usa' : 'usan'} ahora «${recurso}».`,
  },

  /* ------------------------------------------------------------------ *
   * Vista de resultados (`ResultsView.tsx`)
   * ------------------------------------------------------------------ */
  resultados: {
    /**
     * Nombres de columna que fija Bizagi (`docs/BIZAGI_PARITY.md`, RESULTS_FORMAT § 10, regla 4
     * de `BACKLOG.md`): se leen desde aquí, pero **no** se traducen — la CLI, los CSV y esta
     * vista tienen que llamar igual a la misma columna.
     */
    columnas: { id: 'Id', name: 'Name', type: 'Type', from: 'From', to: 'To', metric: 'Metric' },
    /** `columnLabel(...)` más la unidad del escenario entre paréntesis. */
    columnaConUnidad: (etiqueta: string, unidad: string): string => `${etiqueta} (${unidad})`,

    /** Rótulos de sección; `CompareView` los reutiliza para no inventar otros. */
    secciones: {
      elements: 'Elementos del proceso',
      flows: 'Flujos',
      process: 'Proceso',
      resources: 'Recursos',
    },

    exportarCsv: 'Exportar CSV',
    exportarXlsx: 'Exportar XLSX',
    cabecera: (
      escenario: string,
      semilla: number,
      replicaciones: number,
      unidad: string,
      moneda: string | undefined,
    ): string =>
      `Escenario ${escenario} · semilla ${semilla} · replicaciones ${replicaciones} · unidad de tiempo ${unidad}${
        moneda === undefined ? '' : ` · moneda ${moneda}`
      }`,

    /** Title of the per-outcome table (`process.byEndEvent`, #316). */
    desenlaces: 'Desenlaces',

    cuellos: 'Cuellos de botella',
    sinCuellos: 'Sin espera por recurso detectada.',
    /** `espera` lleva su unidad, como en las tablas (`3000.56 min`, `50.01 h (3000.56 min)`). */
    cuelloDetalle: (espera: string, utilizacion: string): string =>
      ` — espera total ${espera}, utilización ${utilizacion}%`,

    avisos: 'Avisos',

    /** Nota al pie de la pestaña Proceso (#358). */
    notaCostoPorCaso:
      'El costo por caso es el costo medio de los casos que terminaron, no el costo total ' +
      'dividido entre las instancias completadas: el costo de los casos en curso forma parte ' +
      'del costo total y no de esta media.',
    /** Nota al pie de la pestaña Recursos (#358). */
    notaCostoRecursos:
      'El costo unitario cobra solo las horas en que el pool estuvo realmente ocupado. El costo ' +
      'de nómina del libro exportado cobra en cambio la disponibilidad: capacidad × costo por ' +
      'hora × las horas abiertas de la corrida, ocupada u ociosa.',
    /** Nota bajo los avisos cuando algún pool reportó `W-RECURSO-SATURADO` (#357). */
    notaSaturacion:
      'El aviso salta cuando la demanda atribuida dividida entre lo que atendió el pool llega a ' +
      '1,1, o su ocupación llega al 90 %, y además la cola crece o queda trabajo pendiente: ' +
      'ningún número decide solo. La demanda atribuida cuenta solo las instancias que esperaron ' +
      'con el pool lleno, así que el número que muestra el aviso —esa razón, o la ocupación ' +
      'cuando salta por esa puerta— es observado sobre el horizonte simulado, no la carga de ' +
      'toda la demanda externa.',
    /**
     * #356/#385: los resultados guardados antes de 1.0.0-beta.1 no traen `n` y se calcularon con
     * la definición anterior de la media entre replicaciones — las replicaciones sin observación
     * contaban como cero (docs/RESULTS_FORMAT.md § 8). Nunca se recalculan, así que se avisa una
     * vez, junto a los avisos, en vez de dejar leer en silencio una media que significa algo
     * distinto de una corrida hecha después de esa versión. `CompareView` reutiliza la misma frase.
     */
    notaReplicacionesLegado:
      'Calculado antes de 1.0.0-beta.1: las replicaciones sin observaciones contaban como cero ' +
      'en las medias.',
    /** Nota bajo los avisos cuando la corrida reporta `W-REPLICACIONES-SIN-OBSERVACIONES` (#356). */
    notaReplicacionesSinObservaciones:
      'Algunas replicaciones no observaron el sujeto que nombra el aviso; sus estadísticas usan ' +
      'solo las replicaciones que sí lo hicieron (ver n en el archivo de resultados).',
    /** #431: every arrival fell inside the warm-up (the web's notice, not an engine `W-*`). */
    todoEnCalentamiento:
      'Todas las llegadas cayeron en el calentamiento, así que no se midió nada: alarga la duración o acorta el calentamiento.',
  },

  /* ------------------------------------------------------------------ *
   * Tabla de resultados bajo el mapa de Resultados (antes el dock de Simular, #394; `DockSimular.tsx`)
   * ------------------------------------------------------------------ */
  dock: {
    corridaTerminada: (casos: string): string => `Corrida terminada: ${casos} casos completados.`,
    vacio: 'Simula el escenario para ver aquí sus resultados por tarea y su registro.',
    ocurrencias: (n: number): string => `${n} ocurrencias`,
    sinLog: 'Esta corrida no tiene log en memoria (se reabrió de un archivo): córrela otra vez para verlo.',
    logTruncado: (n: number): string => `La muestra del log se detuvo en ${n} filas: los eventos posteriores no están.`,
    logMostrando: (mostradas: number, total: number): string => `Se muestran las primeras ${mostradas} de ${total} filas.`,
    log: {
      caso: 'Caso',
      elemento: 'Elemento',
      recurso: 'Recurso',
      habilitada: (unidad: string): string => `Habilitada (${unidad})`,
      inicio: (unidad: string): string => `Inicio (${unidad})`,
      fin: (unidad: string): string => `Fin (${unidad})`,
      espera: (unidad: string): string => `Espera (${unidad})`,
      costo: 'Costo',
    },
    sinAvisos: 'No hay avisos de esta corrida ni de este escenario.',
  },

  /* ------------------------------------------------------------------ *
   * Vista de comparación (`CompareView.tsx`, `compareWarnings.ts`)
   * ------------------------------------------------------------------ */
  comparar: {
    cabecera: (unidad: string): string => `Unidad de tiempo ${unidad} (escenario base) · Utilización en %`,
    base: (nombre: string): string => `${nombre} (base)`,
    etiquetaBase: 'base',
    mostrarTodos: 'Mostrar todos los KPI',
    avisos: 'Avisos',
    significancia: 'Significancia',
    marcaSignificativa: 'Diferencia significativa (IC95 disjuntos)',
    /** El asterisco de la marca; símbolo, no texto. */
    asterisco: '*',
    sinSignificancia:
      'Sin intervalos de confianza en esta comparación: hacen falta al menos 2 réplicas en cada ' +
      'corrida, así que ningún marcador de significancia se muestra abajo.',
    /** #356/#385: razón real cuando `mixedReplicationDefinitions` y no la falta de réplicas. */
    sinSignificanciaMixtas:
      'No se muestra la significancia: las corridas comparadas usan estadísticas de replicación ' +
      'distintas (una se calculó antes de 1.0.0-beta.1).',
    leyenda:
      ' diferencia significativa (IC95 sin solapamiento). Las celdas resaltadas son las que ' +
      'cambiaron contra la base.',
    /** Cabecera de columna: el nombre y, entre paréntesis, los metadatos que existan. */
    columnaConMeta: (nombre: string, etiquetas: readonly string[]): string =>
      etiquetas.length === 0 ? nombre : `${nombre} (${etiquetas.join(' · ')})`,
    metaSemilla: (semilla: number): string => `semilla ${semilla}`,
    metaReplicas: (n: number): string => `${n} réplicas`,
    metaUnidad: (unidad: string): string => `unidad ${unidad}`,
    /** Celda sin valor en la base (misma ortografía que `lila compare`). */
    sinValor: '-',
    noComparable: 'no comparable',
    celdaConDelta: (valor: string, delta: string): string => `${valor} (${delta})`,
    /** Utilización: porcentaje, igual que en la CLI. */
    porCiento: (valor: string): string => `${valor}%`,

    /* Avisos derivados de los metadatos de las corridas (`compareWarnings.ts`, OP-05). */
    sinMoneda: 'sin moneda',
    avisoMonedas: (monedas: readonly string[]): string =>
      `Costos en monedas distintas (${monedas.join(' vs ')}): no se comparan sin conversión.`,
    avisoUnidades: (unidades: readonly string[]): string =>
      `Unidades de tiempo distintas entre corridas (${unidades.join(' vs ')}): cada valor se ` +
      'muestra con la unidad de su propia corrida.',
    avisoSignificancia:
      'Sin intervalos de confianza: hacen falta ≥ 2 réplicas para hablar de significancia.',
    /** #356/#385: una corrida de antes de 1.0.0-beta.1 (sin `n`) frente a una nueva (con `n`). */
    avisoReplicacionesMixtas:
      'Las corridas comparadas usan estadísticas de replicación distintas (una se calculó antes ' +
      'de 1.0.0-beta.1); no se muestran las marcas de significancia.',
    avisoSemillas: (semillas: readonly number[]): string =>
      `Semillas distintas entre corridas (${semillas.join(' vs ')}): las corridas no comparten ` +
      'la misma secuencia aleatoria.',
    avisoReplicas: (replicas: readonly number[]): string =>
      `Número de réplicas distinto entre corridas (${replicas.join(' vs ')}).`,
  },

  /* ------------------------------------------------------------------ *
   * Gráficas de Resultados y Comparar (#460, `GraficasSvg.tsx`)
   * ------------------------------------------------------------------ */
  graficas: {
    valor: (etiqueta: string, texto: string): string => `${etiqueta}: ${texto}`,
    sinDatos: 'No hay datos que graficar.',
    utilizacion: 'Utilización por recurso (%)',
    instancias: 'Instancias iniciadas por tarea',
    percentiles: (unidad: string): string => `Percentiles de tiempo de ciclo y de espera (${unidad})`,
    ciclo: 'Tiempo de ciclo',
    espera: 'Tiempo de espera',
    sinCompletados: 'Ningún caso terminó, así que el tiempo de ciclo y el de espera no tienen valor que graficar.',
    histograma: (unidad: string): string => `Tiempo de ciclo por caso (${unidad})`,
    histogramaSub: (casos: number, replicas: number): string =>
      replicas > 1
        ? `${casos} casos terminados de la réplica 1 de ${replicas}`
        : `${casos} casos terminados`,
    histogramaSinLog: 'El histograma del tiempo de ciclo necesita los tiempos por caso de esta corrida, que solo viven en memoria: vuelve a correr el escenario para verlos.',
    sinVentana: 'Todas las llegadas cayeron dentro del calentamiento, así que no se midió nada que graficar.',
    error: 'Esta gráfica no se pudo dibujar. La tabla tiene los valores.',
    histogramaSinCasos: 'Ningún caso de la réplica 1 terminó: no hay tiempo de ciclo que repartir.',
    clase: (desde: string, hasta: string): string => `${desde} a ${hasta}`,
    casos: (n: number): string => (n === 1 ? '1 caso' : `${n} casos`),
    ejeCasos: 'Casos',
    verDatos: 'Datos del histograma',
    columnaClase: (unidad: string): string => `Tiempo de ciclo (${unidad})`,
    columnaCasos: 'Casos',
    comparar: 'Gráficas',
    compararCiclo: (unidad: string): string => `Tiempo de ciclo promedio por escenario (${unidad})`,
    compararCosto: 'Costo por caso por escenario',
    compararUtilizacion: 'Utilización por recurso y escenario (%)',
    compararCostoNoComparable: 'El costo por caso no se grafica: los escenarios usan monedas distintas.',
    compararDemasiados: (n: number): string => `Solo se grafican los primeros 8 de los ${n} escenarios visibles; las tablas los muestran todos.`,
  },

  /* ------------------------------------------------------------------ *
   * Lienzo: bpmn-js, overlay de cuellos y marcadores de validación
   * (`Modeler.tsx`, `BottleneckOverlay.ts`, `ValidationMarkers.ts`)
   * ------------------------------------------------------------------ */
  lienzo: {
    minimapa: 'Minimapa',
    plegarMinimapa: 'Plegar minimapa',
    desplegarMinimapa: 'Desplegar minimapa',
    errorSinBpmn: 'El modelador todavía no tiene un BPMN abierto.',
    moverCarrilArriba: 'Mover carril arriba',
    moverCarrilAbajo: 'Mover carril abajo',

    /** Etiqueta flotante del overlay de cuellos (#226): corta arriba, completa en el `title`. */
    cuelloEtiqueta: (espera: string, utilizacion: number): string => `${espera} · ${utilizacion}%`,
    /** `espera` lleva su unidad, como en las tablas. */
    cuelloTitulo: (espera: string, utilizacion: string): string =>
      `espera media ${espera} · utilización ${utilizacion}%`,
    /** Abreviatura de la unidad en la etiqueta; el `title` usa el código del escenario. */
    unidadesCortas: { day: 'd', h: 'h', min: 'min', s: 's' },

    /** Marcador de validación: el disco y su tooltip nativo. */
    marcadorSimbolo: '!',
    marcadorAcciones: (renombrar: string, panel: string): string => `${renombrar} renombrar · ${panel} propiedades`,
    marcadorTitulo: (mensajes: readonly string[], acciones: string): string =>
      `${mensajes.join('\n')}\n${acciones}`,
  },

  /* ------------------------------------------------------------------ *
   * Paso Rutas y campos de porcentaje del lienzo (Lote M, C4: `PasoRutas.tsx`,
   * `etiquetasPorcentaje.ts`, el bloque de compuerta del panel de propiedades)
   * ------------------------------------------------------------------ */
  rutas: {
    cajaTitulo: (flujo: string, destino: string): string => `${flujo} → ${destino}`,
    campoLienzo: (flujo: string, compuerta: string): string => `Porcentaje del flujo «${flujo}» de «${compuerta}»`,
    porciento: (n: number): string => `${n} %`,
    resto: (n: number): string => `resto ${n} %`,
    listaTitulo: 'Compuertas',
    listaVacia: 'Este proceso no tiene ninguna compuerta que reparta casos entre dos o más salidas. Añade una compuerta exclusiva o inclusiva en Modelar para darle porcentajes.',
    listaAyuda: 'Los porcentajes también se editan sobre el lienzo, en la etiqueta de cada flujo.',
    volver: '← Compuertas',
    flujosSalientes: 'Flujos salientes',
    tipoXor: 'Exclusiva: cada caso toma una sola salida',
    tipoOr: 'Inclusiva: cada salida se toma por su cuenta',
    barraAria: (reparto: string, suma: number): string => `Reparto: ${reparto}. Suma ${suma} %`,
    porcentajeDe: (flujo: string): string => `Porcentaje de «${flujo}»`,
    haciaDestino: (destino: string): string => `→ ${destino}`,
    porDefecto: 'Flujo por defecto: se lleva el resto',
    suma100: 'Suma 100 %',
    listo: 'Listo para simular.',
    sumaMal: (suma: number, diferencia: number): string =>
      `Suma ${suma} %: ${diferencia > 0 ? `faltan ${diferencia} puntos` : `sobran ${-diferencia} puntos`}`,
    sumaMalCuerpo: 'La simulación ajustará el reparto a 100 % y lo avisará.',
    sumaCero: 'Todas las salidas están en 0 %: ningún caso puede salir de esta compuerta.',
    arreglo: (flujo: string, porcentaje: number): string => `Poner «${flujo}» en ${porcentaje} %`,
    repartirIgual: 'Repartir a partes iguales',
    notaTeclas: '↑/↓ suma o resta 5 %. En una compuerta inclusiva cada salida tiene su propia probabilidad y no hace falta que sumen 100 %.',
    union: 'Compuerta de unión: junta caminos y no reparte casos. No necesita parámetros.',
    sumaPildora: (suma: number): string => `${suma} %`,
    propiedadesTitulo: 'Reparto de rutas',
    invalido: 'Escribe un número de 0 a 100.',
    editarReparto: 'Editar el reparto de rutas',
  },

  /* ------------------------------------------------------------------ *
   * Modo «Validar rutas» (`TokenSim.tsx`, LILA-065 y LILA-205 / #264)
   * ------------------------------------------------------------------ */
  tokenSim: {
    aviso:
      'Animación de tokens de bpmn-js: no es simulación de eventos discretos; no usa el ' +
      'escenario ni produce resultados.',
    /**
     * `bpmn-js-token-simulation@0.40.0` escribe su UI con cadenas literales en el HTML: no pasa
     * por el servicio `translate` de bpmn-js, así que traducirla es sustituir los textos en el
     * DOM del lienzo (`traducirSimulacion` en `TokenSim.tsx`). Este mapa es el inventario
     * completo de lo que el módulo llega a enseñar: rótulos, `title` de la paleta y del context
     * pad, y los avisos. Clave = cadena exacta del módulo, valor = su español.
     */
    traducciones: {
      'Token Simulation': 'Simulación de tokens',
      'Toggle Simulation Log': 'Registro de la simulación',
      'Simulation Log': 'Registro de la simulación',
      'No Entries': 'Sin entradas',
      'Play Simulation': 'Reproducir simulación',
      'Pause Simulation': 'Pausar simulación',
      'Play/Pause Simulation': 'Reproducir o pausar la simulación',
      'Reset Simulation': 'Reiniciar simulación',
      'Trigger Event': 'Disparar evento',
      'Set Sequence Flow': 'Elegir el flujo de salida',
      'Add pause point': 'Añadir punto de pausa',
      'Remove pause point': 'Quitar punto de pausa',
      'Found unsupported elements': 'Hay elementos que la animación no admite',
      'Not supported': 'No admitido',
      Finished: 'Terminada',
      Close: 'Cerrar',
      // Entradas que `Log.js` compone al vuelo: son la primera y la última de cada corrida, y
      // sin ellas el registro abre en inglés (QA de #271). Un subproceso **con nombre** compone
      // `<nombre> finished`, y ese se queda como está: la clave sería el nombre del modelo.
      'Process started': 'Proceso iniciado',
      'Process finished': 'Proceso terminado',
      'Process canceled': 'Proceso cancelado',
      'SubProcess started': 'Subproceso iniciado',
      'SubProcess finished': 'Subproceso terminado',
      'SubProcess canceled': 'Subproceso cancelado',
      Slow: 'Lenta',
      Normal: 'Normal',
      Fast: 'Rápida',
      'Start Event': 'Evento de inicio',
      'Intermediate Event': 'Evento intermedio',
      'Boundary Event': 'Evento de borde',
      'End Event': 'Evento de fin',
      'Exclusive Gateway': 'Compuerta exclusiva',
      'Parallel Gateway': 'Compuerta paralela',
      'Inclusive Gateway': 'Compuerta inclusiva',
      'User Task': 'Tarea de usuario',
      'Manual Task': 'Tarea manual',
      'Service Task': 'Tarea de servicio',
      'Script Task': 'Tarea de script',
      'Send Task': 'Tarea de envío',
      'Receive Task': 'Tarea de recepción',
      'Business Rule Task': 'Tarea de regla de negocio',
      'Call Activity': 'Actividad de llamada',
      Task: 'Tarea',
    } as Record<string, string>,
    /** `title="Set animation speed = Slow"`: el prefijo se traduce y la velocidad se busca arriba. */
    prefijoVelocidad: 'Set animation speed = ',
    velocidad: (nombre: string): string => `Velocidad de la animación: ${nombre}`,
    /** `title="Focus process instance <id>"`. */
    prefijoInstancia: 'Focus process instance ',
    instancia: (id: string): string => `Ir a la instancia ${id}`,
  },

  /* ------------------------------------------------------------------ *
   * Proyecto, almacenes y frontera de simulación
   * (`project.ts`, `store/*.ts`, `simulationGate.ts`, `simulationClient.ts`, `modelerXml.ts`)
   * ------------------------------------------------------------------ */
  proyecto: {
    /** Nombres del diagrama que crea «Nuevo» (se ven en el lienzo). */
    procesoNuevo: 'Mi proceso',
    inicio: 'Inicio',
    actividad: 'Actividad',
    fin: 'Fin',
    /** Nombres de los dos escenarios por defecto de un proyecto nuevo. */
    escenarioAsIs: 'AS-IS',
    escenarioToBe: 'TO-BE',

    errorDocumento: 'Documento de proyecto inválido o versión no soportada.',
    errorDiagnostico: 'Diagnóstico de proyecto inválido.',
    errorCorrida: 'Corrida guardada inválida.',
    errorEntradasCorrida: 'Las entradas de la corrida guardada son inválidas.',

    errorZip: 'Este archivo no es un .lila legible (no se pudo descomprimir).',
    errorSinManifiesto: 'Al archivo le falta "lila-project.json": no es un proyecto .lila.',
    errorManifiesto: 'El "lila-project.json" del archivo es inválido o de una versión no soportada.',
    errorSinModelo: 'Al archivo le falta "model.bpmn": no es un proyecto .lila.',
    errorEntrada: 'El archivo .lila tiene una entrada con una ruta que no es válida dentro de un proyecto.',
  },

  /** Los procesos de un repositorio (ADR-029, #498): las pestañas del lienzo y sus diálogos. */
  procesos: {
    nuevo: 'Nuevo proceso',
    tituloNuevo: 'Nuevo proceso en este proyecto',
    tituloRenombrar: 'Renombrar proceso',
    nombre: 'Nombre del proceso',
    /** Nombre propuesto para el proceso que crea el «+»: «Proceso 2», «Proceso 3»… */
    nombrePorDefecto: (n: number): string => `Proceso ${n}`,
    crear: 'Crear',
    renombrar: 'Renombrar',
    renombrarProceso: (nombre: string): string => `Renombrar el proceso ${nombre}`,
    borrar: 'Borrar',
    borrarProceso: (nombre: string): string => `Borrar el proceso ${nombre}`,
    tituloBorrar: 'Borrar proceso',
    confirmarBorrar: (nombre: string): string =>
      `¿Borrar «${nombre}» con sus escenarios y corridas? Los demás procesos del proyecto se quedan.`,
    /** Miga de pan de vuelta desde un proceso llamado (#461). */
    volverA: (nombre: string): string => `Volver a ${nombre}`,
    /** Doble clic en una actividad de llamada cuyo `calledElement` no es un proceso de aquí (#461). */
    llamadaSinResolver: (destino: string): string =>
      `La actividad de llamada llama a «${destino}», que no es un proceso de este proyecto.`,
    llamadaSinDestino: 'Esta actividad de llamada no indica a qué proceso llama.',
    llamadaMismoProceso: 'Esta actividad de llamada llama al mismo proceso en el que está.',
  },

  almacen: {
    errorSinBridge: 'DesktopStore requiere `window.lila`: ¿se está instanciando fuera de Electron?',
    errorProyectoDistinto:
      'E-PROYECTO-DISTINTO: el documento a guardar no es el proyecto activo; usa "Guardar como" ' +
      'para escribirlo en una carpeta nueva.',
    /** «Guardar como» de un diagrama suelto sobre la carpeta que ya es su proyecto (LILA-208). */
    errorMismaCarpeta:
      'Esta carpeta ya tiene su model.bpmn; para convertir el diagrama suelto en proyecto elige otra carpeta.',
    /** #539: falló releer el proyecto abierto tras un cambio externo; `codigo` es el código del disco. */
    errorRecarga: (ruta: string, codigo: string): string =>
      `${codigo}: ${ruta} cambió fuera de Lila pero no se pudo volver a leer; lo que hay en pantalla no cambió.`,
    /** `E-ARCHIVO-OCUPADO` del disco (#466): otro programa tiene el bloqueo del `.lila`. */
    errorArchivoOcupado: (ruta: string): string =>
      `E-ARCHIVO-OCUPADO: otro programa está guardando ${ruta} ahora mismo, así que no se guardó nada. ` +
      'Vuelve a intentarlo en un momento.',
    /** `E-CAMBIO-EXTERNO` del disco (#539): `nombre` cambió fuera de Lila desde la última lectura. */
    errorCambioExterno: (nombre: string): string =>
      `E-CAMBIO-EXTERNO: ${nombre} cambió fuera de Lila desde que se abrió, así que no se guardó nada. ` +
      'Recarga para traer la otra versión, o usa «Guardar como» para conservar la tuya en otro archivo.',
    /** `E-CARPETA-OCUPADA` del disco (#517): `ruta` tiene archivos de otro proyecto. */
    errorCarpetaOcupada: (ruta: string): string =>
      `E-CARPETA-OCUPADA: ${ruta} tiene archivos de otro proyecto o proceso, y guardar los ` +
      `sobrescribiría. Elige otro destino o mueve ${ruta} a otro sitio.`,
  },

  simulacion: {
    cancelada: 'La simulación se canceló.',
    errorEscenarioDesconocido: (ruta: string): string => `Escenario desconocido: ${ruta}`,
    errorFaltaModelORun: 'Falta model o run en el escenario resuelto.',
    errorModeloDistinto: (delEscenario: string, activo: string): string =>
      `El escenario apunta a ${delEscenario}, pero el modelo activo es ${activo}.`,
    errorExportacionBloqueada: (detalle: string): string =>
      `Exportación bloqueada por contenido perdido:\n${detalle}`,
  },

  /* ------------------------------------------------------------------ *
   * Animación del event log sobre el diagrama (#331)
   * ------------------------------------------------------------------ */
  animacion: {
    titulo: 'Animación',
    reproducirDesdeResultados: 'Reproducir',
    reproducir: 'Reproducir',
    pausar: 'Pausar',
    reiniciar: 'Reiniciar',
    velocidad: 'Velocidad',
    velocidades: {
      '1': '1x',
      '10': '10x',
      '60': '60x',
      '600': '600x',
      instantanea: 'Instantánea',
    },
    contador: (iniciados: number, completados: number, cola: number): string =>
      `${iniciados}/${completados}${cola > 0 ? ` (${cola})` : ''}`,
    contadorTitulo: (iniciados: number, completados: number, cola: number, activos: number): string =>
      `Iniciados ${iniciados} · completados ${completados} · en cola ${cola} · en curso ${activos}`,
    reloj: (fecha: string): string => `Tiempo simulado ${fecha}`,
    relojSinFecha: (dia: number, hora: string): string => `Día ${dia}, ${hora} de corrida`,
    recursos: 'Pools',
    columnaRecurso: 'Pool',
    columnaOcupados: 'Ocupados',
    columnaCapacidad: 'Capacidad',
    replicacion: (total: number): string =>
      `Replicación 1 de ${total}: los conteos del diagrama son solo de esta replicación.`,
    truncado: (filas: number): string =>
      `Solo se guardaron las primeras ${filas} filas del log, así que a la animación le falta el final de la replicación.`,
    sinCorrida: 'Simula el escenario elegido para poder animarlo.',
    sinLog: 'Esta corrida no tiene event log en memoria (viene de un archivo guardado): vuelve a simular para animarla.',
    fin: 'Fin de la replicación.',
    progreso: (porcentaje: number): string => `${porcentaje}% de la replicación`,
  },

  /* ------------------------------------------------------------------ *
   * Lote M, C1: el panel guiado de Simular — pasos numerados, «▶ Simular», el aviso del paso,
   * la cabecera de la selección y las etiquetas del paso en el lienzo (`etiquetasPaso.ts`).
   * ------------------------------------------------------------------ */
  pasosSim: {
    simular: 'Simular',
    insignia: (n: number): string => `${n} ${n === 1 ? 'problema' : 'problemas'} por resolver`,
    noSePuede: (n: number): string =>
      `No se puede simular: ${n} ${n === 1 ? 'problema' : 'problemas'} por resolver. Te llevo al primero.`,
    pasoDe: (n: number, total: number, escenario: string): string => `Paso ${n} de ${total} · ${escenario}`,
    titulos: {
      arrivals: 'Cuándo entran los casos',
      times: 'Cuánto dura cada tarea',
      routes: 'Qué parte sigue cada camino',
      resources: 'Quién hace cada tarea',
      calendars: 'Cuándo trabaja cada recurso',
      run: 'Horizonte y réplicas',
    } as Record<string, string>,
    tabTitulo: (titulo: string, tecla: string): string => `${titulo} (${tecla})`,
    sinProblemas: 'sin problemas',
    bannerUno: 'Un problema en este paso',
    bannerVarios: (n: number): string => `${n} problemas en este paso`,
    sinPaso: 'Problemas fuera de los pasos',
    ir: 'Ir',
    soloEstePaso: (tipo: string): string => `${tipo} · solo lo de este paso`,
    verTodo: 'Ver todo',
    verTodoTitulo: 'Quitar la selección (Esc)',
    nada: (tipo: string, paso: string): string => `${tipo} sin parámetros en ${paso}.`,
    consejos: {
      task: 'Una tarea se configura en Tiempos, Recursos y Calendarios.',
      start: 'El evento de inicio se configura en Llegadas.',
      gateway: 'Sus porcentajes se editan en Rutas.',
      flow: 'Un flujo se edita en Rutas, desde su compuerta.',
      end: 'Los eventos de fin no tienen parámetros: solo cuentan los casos que terminan.',
      otro: 'Aquí no hay nada que configurar.',
    } as Record<string, string>,
    irA: (paso: string): string => `Ir a ${paso}`,
    anterior: (paso: string): string => `← ${paso}`,
    siguiente: (paso: string): string => `${paso} →`,
    inicioDe: (nombre: string): string => `Evento de inicio · ${nombre}`,
    patron: 'Patrón de llegada',
    limites: 'Límites',
    tasaHora: (porHora: string): string => `≈ ${porHora} por hora · las 24 h`,
    tasaSemana: (porHora: string, porSemana: string, calendario: string): string =>
      `≈ ${porHora} por hora · ≈ ${porSemana} por semana dentro de «${calendario}»`,
    tasaSinMedia: 'Indica una media mayor que 0 para ver la tasa de llegada.',
    soloDentro: 'Solo llegan dentro de',
    siempre: 'Siempre (24/7)',
    limitesAyuda: 'Deja el máximo vacío para que lleguen casos durante todo el horizonte.',
    duracionMedia: 'Duración media',
    sinDuracion: 'Sin duración',
    faltaDuracion: 'Falta la duración: sin ella esta tarea no tarda nada.',
    horizonte: 'Horizonte',
    replicas: 'Réplicas',
    avanzado: 'Avanzado',
    calentamientoAyuda: 'Los casos del calentamiento no cuentan: así el proceso se mide ya en marcha.',
    replicasAyuda: '30 réplicas suelen bastar. Con la misma semilla, el mismo escenario da siempre el mismo resultado.',
    confianza: 'Los resultados dan un intervalo de confianza del 95 %.',
    etiquetas: {
      sinDuracion: 'Sin duración',
      sinRecurso: 'Sin recurso',
      siempre: '24 h',
      cada: (tiempo: string): string => `cada ${tiempo}`,
    },
    entradas: (n: number): string => `Entradas de este escenario (${n})`,
    masAcciones: 'Más',
  },

  /* ------------------------------------------------------------------ *
   * Mapa de atajos (`atajos.ts`, #413): un rótulo por id de entrada y un título por grupo.
   * ------------------------------------------------------------------ */
  atajos: {
    grupos: {
      archivo: 'Archivo',
      buscar: 'Buscar',
      modos: 'Modos',
      simulacion: 'Simulación',
      lienzo: 'Lienzo',
      paneles: 'Paneles',
    },
    nuevo: 'Nuevo proyecto',
    abrir: 'Abrir proyecto',
    guardar: 'Guardar proyecto',
    guardarComo: 'Guardar como',
    imprimir: 'Imprimir el diagrama',
    ajustes: 'Ajustes',
    paleta: 'Paleta de comandos',
    'modo:modelar': 'Modelar',
    'modo:simular': 'Simular',
    'modo:resultados': 'Resultados',
    ejecutar: 'Ejecutar la simulación',
    cancelar: 'Cancelar la corrida',
    'paso:arrivals': 'Paso 1: Llegadas',
    'paso:times': 'Paso 2: Tiempos',
    'paso:routes': 'Paso 3: Rutas',
    'paso:resources': 'Paso 4: Recursos',
    'paso:calendars': 'Paso 5: Calendarios',
    'paso:run': 'Paso 6: Ejecución',
    reproducir: 'Reproducir o pausar los tokens (Resultados)',
    zoomMas: 'Acercar',
    zoomMenos: 'Alejar',
    ajustarVista: 'Ajustar el diagrama',
    renombrar: 'Renombrar el elemento seleccionado',
    deshacer: 'Deshacer',
    rehacer: 'Rehacer',
    borrar: 'Borrar la selección',
    seleccionarTodo: 'Seleccionar todo',
    copiar: 'Copiar',
    pegar: 'Pegar',
    lazo: 'Herramienta lazo',
    mano: 'Herramienta mano',
    conectar: 'Herramienta conectar',
    editarEtiqueta: 'Editar la etiqueta',
    reemplazar: 'Reemplazar el elemento',
    alinearIzquierda: 'Alinear a la izquierda',
    alinearCentro: 'Centrar en horizontal',
    alinearDerecha: 'Alinear a la derecha',
    alinearArriba: 'Alinear arriba',
    alinearMedio: 'Centrar en vertical',
    alinearAbajo: 'Alinear abajo',
    distribuirHorizontal: 'Distribuir en horizontal',
    distribuirVertical: 'Distribuir en vertical',
    izquierda: 'Mostrar u ocultar la columna izquierda',
    derecha: 'Mostrar u ocultar el panel derecho',
    diagramas: 'Mostrar u ocultar las pestañas de diagramas',
    estado: 'Mostrar u ocultar la barra de estado',
    irModos: 'Llevar el foco a los modos',
    irPanel: 'Llevar el foco al panel derecho',
    dock: 'Mostrar u ocultar la tabla de resultados',
  },

  /* ------------------------------------------------------------------ *
   * Atributos extendidos (#509)
   * ------------------------------------------------------------------ */
  atributos: {
    titulo: 'Atributos extendidos',
    deProceso: 'Atributos del proceso',
    definir: 'Definir atributos…',
    ninguno: (tipo: string): string => `Todavía no hay atributos definidos para ${tipo}.`,
    categorias: {
      task: 'tareas',
      gateway: 'compuertas',
      event: 'eventos',
      subProcess: 'subprocesos',
      lane: 'pools y carriles',
      process: 'el proceso',
    },
    tipos: { text: 'Texto', number: 'Número', list: 'Lista', date: 'Fecha' },
    sinValor: '—',
    porDefecto: (valor: string): string => `Por defecto: ${valor}`,
    noEsOpcion: (valor: string): string => `${valor} (no es una opción)`,
    problemas: {
      number: 'No es un número. Usa cifras, con punto para los decimales (por ejemplo 4.5).',
      date: 'No es una fecha. Usa año-mes-día (por ejemplo 2026-09-28).',
      option: 'No es una de las opciones de la lista.',
    },
    huerfano: (ref: string): string => `${ref} (sin definición)`,
    quitarHuerfano: (ref: string): string => `Quitar el valor de ${ref}`,
    dialogo: 'Definir atributos extendidos',
    paraTipo: 'Tipo de elemento',
    nombre: (n: number): string => `Nombre ${n}`,
    tipo: (n: number): string => `Tipo ${n}`,
    opciones: (n: number): string => `Opciones ${n}`,
    valorPorDefecto: (n: number): string => `Por defecto ${n}`,
    quitar: (n: number): string => `Quitar el atributo ${n}`,
    anadir: 'Añadir atributo',
    guardar: 'Guardar',
    cancelar: 'Cancelar',
    volver: 'Volver',
    aplicar: 'Aplicar',
    errores: {
      nombre: 'Cada atributo necesita un nombre.',
      repetido: (nombre: string): string => `Hay dos atributos que se llaman ${nombre}.`,
      opciones: (nombre: string): string => `La lista ${nombre} necesita al menos una opción.`,
      porDefecto: (nombre: string): string => `El valor por defecto de ${nombre} no encaja con su tipo.`,
    },
    confirmarTitulo: 'Valores existentes',
    confirmarTexto: 'Estos cambios afectan a atributos que ya tienen valores en algunos elementos. Elige qué hacer con ellos.',
    renombrado: (antes: string, ahora: string): string => `${antes} pasa a llamarse ${ahora}.`,
    cambiaTipo: (antes: string, ahora: string): string => `Su tipo cambia de ${antes} a ${ahora}.`,
    opcionesQuitadas: (opciones: string): string => `Opciones quitadas: ${opciones}.`,
    conValores: (n: number, invalidos: number): string =>
      `${n} ${n === 1 ? 'elemento tiene' : 'elementos tienen'} valor` +
      (invalidos === 0 ? ', y todos siguen encajando.' : `; ${invalidos} ya no ${invalidos === 1 ? 'encaja' : 'encajan'}.`),
    limpiar: (n: number): string => `Vaciar ${n === 1 ? 'el valor que ya no encaja' : `los ${n} valores que ya no encajan`}`,
    repetidas: (n: number): string =>
      `Se ignora${n === 1 ? ' 1 definición repetida' : `n ${n} definiciones repetidas`} (el mismo atributo dos veces, por ejemplo tras pegar un pool). Guardar las definiciones deja una de cada.`,
    varios: (n: number, valores: string): string => `Este elemento tiene ${n} valores para este atributo (${valores}); el campo edita el primero.`,
    sinReferencia: 'Atributo sin referencia',
    atributoN: (n: number): string => `Atributo ${n}`,
    etiquetas: { nombre: 'Nombre', tipo: 'Tipo', opciones: 'Opciones, una por línea', porDefecto: 'Valor por defecto' },
    conservar: 'Conservar los valores',
    borrado: (nombre: string, n: number): string =>
      `${nombre} se borra junto con ${n === 1 ? 'su valor' : `sus ${n} valores`}.`,
  },

  /* ------------------------------------------------------------------ *
   * Páginas de demostración de desarrollo (`*-demo.tsx`, fuera del bundle)
   * ------------------------------------------------------------------ */
  demos: {
    cargando: 'Cargando examples/pedido…',
    tituloResultados: 'Lila Modeler · Resultados (demo LILA-062)',
    tituloComparar: 'Lila Modeler · Comparar (demo LILA-063)',
  },
  /* ------------------------------------------------------------------ *
   * Lote M, workstream C5: resultados sobre el mapa, comparar dentro de Resultados, el desplegable
   * de escenario que sustituye al raíl y la tabla de resultados que sustituye al dock.
   * ------------------------------------------------------------------ */
  c5: {
    escenario: {
      rotulo: 'Escenario',
      base: 'Base',
      titulo: 'Elegir, duplicar, renombrar o guardar el escenario',
      lista: 'Escenarios del proceso',
      simulado: 'Simulado',
      sinSimular: 'Sin simular',
      enVentana: 'En la ventana aparte',
      hereda: (padre: string): string => `Hereda de ${padre}`,
      heredaDe: 'Hereda de',
      ninguno: 'Nada (escenario base)',
      guardar: 'Guardar proyecto',
      duplicar: 'Duplicar',
      duplicarTitulo: 'Duplicar el escenario activo; la copia hereda de él y se puede renombrar al momento',
      renombrar: 'Renombrar',
      nombre: 'Nombre del escenario',
      nombreAyuda: 'Enter conserva el nombre, Esc lo deja como estaba',
      problemas: 'Problemas del escenario',
    },
    resultados: {
      barra: 'Barra de resultados',
      meta: (replicas: number, semilla: string, unidad: string): string => `${replicas} ${replicas === 1 ? 'réplica' : 'réplicas'} · semilla ${semilla} · unidad ${unidad}`,
      capas: 'Capas sobre el mapa',
      mapaCalor: 'Mapa de calor',
      tokens: 'Tokens',
      compararCon: 'Comparar con…',
      compararTitulo: 'Comparar este escenario con otro; uno sin resultados se simula al elegirlo',
      seSimulara: 'Sin simular · se simulará al elegirlo',
      sinOtros: 'No hay otro escenario: duplica este primero.',
      vacioKicker: 'Sin resultados',
      vacioTitulo: (nombre: string): string => `Aún no has simulado «${nombre}»`,
      vacioTexto: 'Pulsa Simular: el diagrama seguirá aquí y verás sobre él las esperas, los cuellos de botella y los casos moviéndose.',
      simularAhora: 'Simular ahora',
      corriendo: 'Simulando…',
      errorKicker: 'La simulación se detuvo',
      errorTitulo: (n: number): string => (n === 1 ? '1 problema por resolver' : `${n} problemas por resolver`),
      irAlPrimero: 'Ir al primero',
      reintentar: 'Reintentar',
      resumen: 'Resumen',
      kpis: {
        ciclo: 'Tiempo de ciclo',
        espera: 'Espera por caso',
        completados: 'Casos completados',
        costoCaso: 'Costo por caso',
        utilMax: 'Utilización máx.',
        enCurso: 'En curso al cierre',
      },
      kpiTitulos: {
        ciclo: 'Tiempo medio desde la llegada hasta el fin, sobre todas las réplicas',
        espera: 'Tiempo medio que un caso pasó esperando recursos',
        completados: 'Casos que llegaron a un evento de fin, media de las réplicas',
        costoCaso: 'Costo total dividido entre los casos completados',
        utilMax: 'Utilización del recurso más ocupado',
        enCurso: 'Casos que seguían en el proceso al terminar la corrida (en cola o en trabajo)',
      },
      ic95: (desde: string, hasta: string): string => `Intervalo de confianza del 95 % ${desde} – ${hasta}`,
      cuellos: 'Cuellos de botella',
      cuellosNota: 'El ranking del motor: espera total por recursos y, a igualdad, utilización.',
      tarea: 'Tarea seleccionada',
      sinSeleccion: 'Elige una tarea en el mapa o en la tabla para ver su detalle.',
      casos: 'Casos',
      proceso: 'Proceso medio',
      espera: 'Espera media',
      utilizacion: 'Utilización',
      consejoCuello: 'Está en el ranking de cuellos del motor: más capacidad para su recurso, o menos trabajo dirigido a él, acorta la espera.',
      consejoSinEspera: 'Apenas espera: su recurso no es lo que frena los casos.',
      enVentana: 'Los resultados están en otra ventana.',
    },
    tabla: {
      region: 'Tabla de resultados',
      vistas: 'Vistas de la tabla de resultados',
      titulo: 'Resultados por tarea',
      sub: (replicas: number): string => `media de ${replicas} ${replicas === 1 ? 'réplica' : 'réplicas'} · duraciones en horas (minutos)`,
      plegar: 'Plegar la tabla de resultados',
      desplegar: 'Desplegar la tabla de resultados',
      redimensionar: 'Cambiar el alto de la tabla de resultados',
      pestanas: { tareas: 'Tareas', detalle: 'Resultados completos', log: 'Registro de la corrida', avisos: 'Avisos' },
      columnas: {
        tarea: 'Tarea',
        recurso: 'Recurso',
        casos: 'Casos',
        proceso: 'Proceso medio',
        espera: 'Espera media',
        esperaP95: 'Espera p95',
        utilizacion: 'Utilización',
        costo: 'Costo total',
      },
      utilizacionTitulo: 'Utilización del recurso más ocupado que usa la tarea',
      costoTitulo: 'El costo fijo de la tarea en la corrida; el de los recursos está en Resultados completos → Recursos',
      p95Titulo: 'Percentil 95 de la espera por recurso, de la muestra del log de la corrida',
      total: 'Total',
      notaPercentiles: (filas: number): string => `Media: todas las réplicas. p95: réplica 1 de la muestra del log (${filas} filas), casos iniciados tras el calentamiento.`,
      muestraParcial: (filas: number): string => `La espera es la media de todas las réplicas. No hay p95: la muestra del log se detuvo en ${filas} filas y solo cubriría los primeros casos.`,
      notaSinLog: 'La espera es la media de todas las réplicas. No hay p95: esta corrida no tiene log en memoria (córrela otra vez para verlo).',
      nadie: 'Nadie',
      notaCosto: 'El costo total por tarea es el costo fijo de la propia tarea. Lo que cuestan los recursos está en Resultados completos → Recursos.',
      exportarCsv: 'CSV',
      exportarCsvTitulo: 'Descargar la tabla de elementos (elements.csv)',
      exportarXlsx: 'XLSX',
      exportarXlsxTitulo: 'Descargar el libro con todas las tablas',
    },
    tiempo: {
      barra: 'Reproducción de tokens',
      reproducir: 'Reproducir los tokens (Espacio)',
      pausar: 'Pausar los tokens (Espacio)',
      reiniciar: 'Volver al inicio',
      velocidad: 'Velocidad',
      posicion: 'Tiempo simulado',
      leyenda: 'Color: la espera frente al tiempo de proceso de la propia tarea',
      niveles: { low: 'poca espera', mid: 'comparable', high: 'espera más de lo que trabaja' },
      truncadoCorto: (filas: number): string => `Reproducción parcial: primeras ${filas} filas del log`,
      ocupacion: (recurso: string, ocupados: number, capacidad: number): string => `${recurso} ${ocupados}/${capacidad}`,
    },
    mapa: {
      espera: (t: string): string => `Espera ${t}`,
      esperaTitulo: (t: string): string => `Espera media por recurso ${t}`,
      cuello: 'CUELLO',
    },
    comparar: {
      comparando: 'Comparando',
      intercambiar: 'Intercambiar lados',
      elegir: 'Elegir escenario',
      leyenda: 'verde = mejora · rojo = empeora · ▲▼ sube o baja',
      cerrar: 'Cerrar comparación',
      referencia: 'Referencia',
      mapaDe: (nombre: string): string => `Mapa de ${nombre}`,
      mapaSub: 'calor por espera',
      mapaDeltaSub: 'diferencia de espera por tarea',
      valorRef: (nombre: string, valor: string): string => `${nombre}: ${valor}`,
      mejora: 'mejora',
      empeora: 'empeora',
      igual: 'sin cambio',
      deltaTitulo: (t: string): string => `Espera media ${t} frente a la referencia`,
      simulandoKicker: 'Simulando',
      simulando: (nombre: string): string => `Simulando «${nombre}»…`,
      simulandoTexto: 'Aún no tenía resultados; corre con su propia semilla y sus réplicas.',
      canceladaKicker: 'Cancelada',
      cancelada: (nombre: string): string => `Se canceló la corrida de «${nombre}»`,
      canceladaTexto: 'La comparación espera a que la vuelvas a correr.',
      errorKicker: 'No se pudo simular',
      errorTitulo: (nombre: string): string => `«${nombre}» tiene problemas`,
      corregir: 'Corregir en Simular',
      elegirOtro: 'Elegir otro escenario',
      vacioKicker: 'Comparar',
      vacioTitulo: 'Necesitas un segundo escenario',
      vacioTexto: 'Duplica este, cambia lo que quieras probar y compara los dos.',
      duplicarComo: (nombre: string): string => `Duplicar ${nombre}`,
      detalle: 'Tablas y gráficas de la comparación',
      sinMapa: 'Los mapas no se pudieron dibujar aquí. Las tablas de abajo tienen todas las cifras.',
    },
    validarRutas: 'Validar rutas',
    validarRutasTitulo: 'Recorrer las rutas con tokens (solo en Modelar; no es la simulación)',
    compararConEscenario: (nombre: string): string => `Comparar con ${nombre}`,
  },
};
