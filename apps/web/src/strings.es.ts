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

export const es: Strings = {
  /* ------------------------------------------------------------------ *
   * Shell de la app (`App.tsx`)
   * ------------------------------------------------------------------ */
  app: {
    /** Rótulo de cada modo de la barra superior; el id lo fija `ids.ts` (`MODO_IDS`). */
    modos: {
      modelar: 'Modelar',
      simular: 'Simular',
      resultados: 'Resultados',
      comparar: 'Comparar',
      animar: 'Animar',
      rutas: 'Validar rutas',
    },
    /** Rótulo de cada pestaña del panel derecho; el id lo fija `ids.ts` (`PESTANA_IDS`). */
    pestanas: {
      propiedades: 'Propiedades',
      documentacion: 'Documentación',
      simulacion: 'Simulación',
    },

    /** Nombre visible de cada tema integrado (`src/theme/themes/*.json`). */
    temas: { 'eva-01': 'Eva-01', papel: 'Papel' },
    /** Nombre visible de cada densidad; el id (`ids.ts`) es lo que se guarda en `localStorage`. */
    densidades: { compacta: 'Compacta', normal: 'Normal', comoda: 'Cómoda' },
    /** El mismo nombre en minúscula, para la barra de estado («Densidad cómoda»). */
    densidadNombre: (id: string): string => (id === 'comoda' ? 'cómoda' : id),

    /** Atajo entre paréntesis detrás del tooltip: `⌘S` en Mac, `Ctrl+S` en el resto. */
    atajo: (letra: string, shift: boolean, mac: boolean): string =>
      mac ? ` (${shift ? '⇧' : ''}⌘${letra})` : ` (Ctrl+${shift ? 'Shift+' : ''}${letra})`,

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
    abrirBpmn: 'Abrir .bpmn',
    exportarBpmn: 'Exportar .bpmn',
    tituloNuevo: 'Nuevo proyecto',
    tituloAbrir: 'Abrir proyecto',
    tituloGuardar: 'Guardar proyecto',
    tituloGuardarComo: 'Guardar como',

    /** Buscador inerte de la barra (la paleta de comandos es otro ticket). */
    buscar: 'Buscar actividad',
    buscarPista: 'Buscar actividad…',
    buscarPendiente: 'La búsqueda y la paleta de comandos llegan en LILA-066',

    deshacer: 'Deshacer',
    rehacer: 'Rehacer',
    ajustes: 'Ajustes',
    cancelar: 'Cancelar',

    /** Acción primaria y su progreso. */
    ejecutar: 'Ejecutar simulación',
    preparando: 'Preparando…',
    replicacion: (actual: number, total: number): string => `Replicación ${actual} de ${total}`,
    porCiento: (n: number): string => `${n} %`,

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

    /** Chips de validación sobre el lienzo y contadores de la barra de estado. */
    irAlPrimerProblema: 'Ir al primer elemento con problemas',
    errores: (n: number): string => `${n} ${n === 1 ? 'error' : 'errores'}`,
    avisos: (n: number): string => `${n} ${n === 1 ? 'aviso' : 'avisos'}`,

    /** Modo Resultados y modo Comparar sin nada que enseñar todavía. */
    sinResultados: 'Simula la revisión actual para ver resultados.',
    sinCorridaActual: 'No hay corrida actual para el escenario seleccionado.',
    escenarioBase: 'Escenario base',
    sinComparacion:
      'Simula el escenario base y al menos otro escenario de la revisión actual para comparar.',
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
    verCuellos: 'Cuellos de botella',
    cuellosSinCorrida: 'Simula para ver los cuellos de botella sobre el diagrama.',
    cuellosSinEspera: 'Ningún elemento esperó por un recurso en esta corrida.',
    /** Nombre del cuello principal: el id solo se añade cuando aporta algo (#226). */
    nombreDeCuello: (nombre: string, id: string): string => `${nombre} (${id})`,

    /** Pestañas de diagrama, abajo a la izquierda. */
    cerrarDiagrama: 'Cerrar diagrama',
    cerrarArchivo: (archivo: string): string => `Cerrar ${archivo}`,
    nuevoDiagrama: 'Nuevo diagrama',

    /** Barra de estado. */
    semilla: (valor: string): string => `Semilla ${valor}`,
    /** Semilla desconocida: el escenario no resuelve o no la declara. */
    sinValor: '—',
    densidadEstado: (nombre: string): string => `Densidad ${nombre}`,
    zoom: (porCiento: number): string => `Zoom ${porCiento} % · ajustar`,
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
    errorProyectoCambio:
      'El proyecto cambió mientras se abría el archivo. Conservamos tus cambios; vuelve a abrirlo.',
    errorRecienteAusente: 'Ese proyecto ya no está en su carpeta; se quitó de recientes.',
    errorAbrirOcupado: (archivo: string): string =>
      `No se abrió "${archivo}": hay otra operación en curso. Vuelve a abrirlo cuando termine.`,
    errorEscenarioDesconocido: (ruta: string): string => `escenario desconocido: ${ruta}`,
    problemaDeArchivo: (archivo: string, mensaje: string): string => `${archivo}: ${mensaje}`,
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
    grupos: {
      eventos: 'Eventos',
      actividades: 'Actividades',
      compuertas: 'Compuertas',
      datos: 'Datos',
      artefactos: 'Artefactos',
      poolsYCarriles: 'Pools y carriles',
    },
    figuras: {
      inicio: 'Inicio',
      intermedio: 'Intermedio',
      fin: 'Fin',
      mensaje: 'Mensaje',
      temporizador: 'Temporizador',
      tarea: 'Tarea',
      tareaUsuario: 'Tarea de usuario',
      tareaServicio: 'Tarea de servicio',
      subproceso: 'Subproceso',
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
    },
  },

  /* ------------------------------------------------------------------ *
   * Panel de propiedades y documentación (`PropertiesPanel.tsx`)
   * ------------------------------------------------------------------ */
  propiedades: {
    sinSeleccion: 'Selecciona un elemento del lienzo para ver sus propiedades.',
    variosSeleccionados: (n: number): string =>
      `${n} elementos seleccionados: las acciones sobre varios a la vez todavía no están. ` +
      'Selecciona uno solo para editarlo.',

    textoAnotacion: 'Texto de la anotación',
    nombre: 'Nombre',
    sinNombre: 'Sin nombre',
    tipoSinNombre: 'Este tipo no tiene nombre',
    nombreProceso: 'Nombre del proceso',
    tipo: 'Tipo',
    id: 'Id',
    copiar: 'Copiar',
    copiado: 'Copiado',

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
   * Panel de escenario (`ScenarioPanel.tsx`)
   * ------------------------------------------------------------------ */
  escenario: {
    guardar: 'Guardar',
    duplicar: 'Duplicar',
    /** Cabecera: errores y avisos del escenario en edición. */
    conteo: (errores: number, avisos: number): string =>
      `${errores} ${errores === 1 ? 'error' : 'errores'} · ${avisos} ${
        avisos === 1 ? 'aviso' : 'avisos'
      }`,
    hereda: (padre: string): string =>
      `Hereda de ${padre}: se muestran los valores resueltos y se edita solo el delta.`,

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
    claveRepetida: (clave: string): string => `${clave} ya existe; edítalo abajo o usa otro id.`,
    itemNumerado: (etiqueta: string, i: number): string => `${etiqueta} ${i}`,
    eliminadoNull: 'eliminado (null)',
    estadoReservado: (estado: string, valor: string): string => `${estado}: ${valor}`,
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

    /** `resources[pool].capacity` (LILA-164): fija o por turnos. */
    capacidadFija: 'Fija',
    capacidadPorTurno: 'Por turno',
    tramo: (i: number): string => `tramo ${i}`,
    quitarTramo: (i: number): string => `quitar tramo ${i}`,
    anadirTramo: 'Añadir tramo',

    /** `calendars[clave].intervals` (LILA-203): rejilla semanal o lista genérica. */
    editarComoLista: 'Editar como lista',
    editarComoRejilla: 'Editar como rejilla',
    calendarioConMinutos: 'este calendario tiene franjas de minutos; edítalo como lista',

    /** «Asignar carril a pool» (LILA-334): una edición en bloque de `elements[task].resources`. */
    carrilCarril: 'Carril',
    carrilPool: 'Pool',
    carrilAsignar: 'Asignar carril',
    carrilAyuda: (tareas: number): string =>
      `Rellena resources en cada tarea del carril (${tareas}); el carril no se guarda en ninguna parte.`,
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
    celda: (dia: (typeof DIAS_SEMANA)[number], hhmm: string): string => `${dia} ${hhmm}`,
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
    cuelloDetalle: (espera: string, unidad: string, utilizacion: string): string =>
      ` — espera total ${espera} ${unidad}, utilización ${utilizacion}%`,

    avisos: 'Avisos',
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
    avisoSemillas: (semillas: readonly number[]): string =>
      `Semillas distintas entre corridas (${semillas.join(' vs ')}): las corridas no comparten ` +
      'la misma secuencia aleatoria.',
    avisoReplicas: (replicas: readonly number[]): string =>
      `Número de réplicas distinto entre corridas (${replicas.join(' vs ')}).`,
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

    /** Etiqueta flotante del overlay de cuellos (#226): corta arriba, completa en el `title`. */
    cuelloEtiqueta: (espera: string, utilizacion: number): string => `${espera} · ${utilizacion}%`,
    cuelloTitulo: (espera: string, unidad: string, utilizacion: string): string =>
      `espera media ${espera} ${unidad} · utilización ${utilizacion}%`,
    /** Abreviatura de la unidad en la etiqueta; el `title` usa el código del escenario. */
    unidadesCortas: { day: 'd', h: 'h', min: 'min', s: 's' },

    /** Marcador de validación: el disco y su tooltip nativo. */
    marcadorSimbolo: '!',
    marcadorAcciones: 'F2 renombrar · ⇥ propiedades',
    marcadorTitulo: (mensajes: readonly string[], acciones: string): string =>
      `${mensajes.join('\n')}\n${acciones}`,
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

  almacen: {
    errorSinBridge: 'DesktopStore requiere `window.lila`: ¿se está instanciando fuera de Electron?',
    errorProyectoDistinto:
      'E-PROYECTO-DISTINTO: el documento a guardar no es el proyecto activo; usa "Guardar como" ' +
      'para escribirlo en una carpeta nueva.',
    /** «Guardar como» de un diagrama suelto sobre la carpeta que ya es su proyecto (LILA-208). */
    errorMismaCarpeta:
      'Esta carpeta ya tiene su model.bpmn; para convertir el diagrama suelto en proyecto elige otra carpeta.',
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
   * Páginas de demostración de desarrollo (`*-demo.tsx`, fuera del bundle)
   * ------------------------------------------------------------------ */
  demos: {
    cargando: 'Cargando examples/pedido…',
    tituloResultados: 'Lila Modeler · Resultados (demo LILA-062)',
    tituloComparar: 'Lila Modeler · Comparar (demo LILA-063)',
  },
};
