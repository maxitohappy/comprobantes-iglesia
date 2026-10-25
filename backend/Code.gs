/**
 * Backend de "Comprobantes Iglesia" — Iglesia Pentecostal Unida del Nombre de Jesús
 * (Google Apps Script, cuenta dueña de la carpeta en Drive).
 *
 * - Lee comprobantes de ingreso y egreso (JPG, PNG o PDF) con Claude (API de Anthropic). La clave queda
 *   oculta en las Propiedades del script; nunca llega al navegador ni a GitHub.
 * - Guarda los datos en la planilla "Comprobantes" (pestaña Registros, ordenada por fecha del comprobante),
 *   mantiene la pestaña Balance con KPI y guarda una copia del archivo en la subcarpeta "Archivos".
 *
 * Propiedades del script (Configuración del proyecto > Propiedades del script):
 *   ANTHROPIC_API_KEY  (obligatoria)
 *   MODELO             (opcional, por defecto claude-haiku-5-5)
 *   LIMITE_DIARIO      (opcional, por defecto 100 lecturas por día)
 *   CARPETA_ID, ARCHIVOS_ID, SHEET_ID  (se crean solas al ejecutar `inicializar`)
 */

const NOMBRE_CARPETA = 'Tesorería IPUNJ - Comprobantes';
const NOMBRE_PLANILLA = 'Comprobantes';
const HOJA_REGISTROS = 'Registros';
const HOJA_BALANCE = 'Balance';
const COLUMNAS = ['Fecha registro', 'Fecha comprobante', 'Movimiento', 'Nombre', 'Tipo', 'Subtipo', 'Monto', 'Link archivo',
  'Notas', 'ID', 'ID archivo'];
// Posiciones (base 0) de las columnas que se usan en el código.
const C = {registro: 0, fecha: 1, movimiento: 2, nombre: 3, tipo: 4, subtipo: 5, monto: 6, link: 7, notas: 8, id: 9, idArchivo: 10};
// Letra de columna en la planilla para una posición de C (A = 0).
const letra_ = i => String.fromCharCode(65 + i);
// Sube este número cuando cambien las columnas o la pestaña Balance: la planilla se migra sola en la siguiente llamada.
const VERSION_PLANILLA = '4';
// Encabezados antiguos que cambiaron de nombre (para migrar datos ya guardados).
const RENOMBRES = {'Total': 'Monto', 'Advertencias': 'Notas'};
const MODELO_POR_DEFECTO = 'claude-haiku-5-5';
const LIMITE_POR_DEFECTO = 100;
const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Catálogo de tipos y subtipos. Es la única fuente: el frontend lo recibe en `ping`. */
const CATEGORIAS = {
  Ingreso: {
    'Ingreso N°1 - Ingresos locales': ['Ofrendas Culto', 'Obra Social', 'Actividad Pro-Templo', 'Votos Pro-Templo',
      'Votos Familia Pastoral', 'Otros Votos', 'Donaciones', 'Saldo Anterior', 'Préstamo'],
    'Ingreso N°2 - Dineros Pastor': ['Diezmos', 'Primicias'],
    'Ingreso N°3 - Dineros Nacionales': ['Ofrenda Misionera', 'Ofrenda Gavillas para Cristo', 'Ofrenda Rayos de Luz',
      'Ofrenda Semestral', 'Obra Social Nacional'],
  },
  Egreso: {
    'Egreso N°1 - Egresos locales': ['Arriendo', 'Servicios', 'E. Dominical - Oficina', 'Insumos Aseo', 'Viáticos',
      'Inversión Actividad Pro-Templo', 'Obra Social Local', 'Construcción', 'Pago Préstamo'],
    'Egreso N°2 - Dineros Pastor': ['Entrega Diezmo a Pastor', 'Adelanto Pastor', 'Diezmo de Diezmo', 'FOSP', 'Primicias',
      'AFP y Fonasa', 'Otras Donaciones'],
    'Egreso N°3 - Dineros Nacionales': ['Ofrenda Misionera', 'Ofrenda Gavillas para Cristo', 'Ofrenda Rayos de Luz',
      'Ofrenda Semestral', 'Obra Social Nacional', 'Otros Envíos'],
  },
};

/**
 * Regla de negocio de palabras clave: si la glosa contiene alguna de estas palabras (sin importar mayúsculas, tildes
 * ni plural), el comprobante se clasifica en ese subtipo, por sobre lo que proponga Claude. Si coinciden varias, gana
 * la palabra clave más larga (así "diezmo de diezmo" gana a "diezmo" y "obra social nacional" a "obra social").
 * Se escriben en minúsculas y sin tildes; se comparan como inicio de palabra ("misioner" sirve para misionera/o).
 */
const PALABRAS_CLAVE = {
  Ingreso: {
    'Ofrendas Culto': ['ofrenda culto', 'ofrendas culto', 'ofrenda de culto', 'culto'],
    'Obra Social': ['obra social'],
    'Actividad Pro-Templo': ['actividad'],
    'Votos Pro-Templo': ['voto pro templo', 'votos pro templo', 'voto protemplo', 'votos protemplo'],
    'Votos Familia Pastoral': ['familia pastoral'],
    'Otros Votos': ['voto'],
    'Donaciones': ['donacion'],
    'Saldo Anterior': ['saldo anterior'],
    'Préstamo': ['prestamo'],
    'Diezmos': ['diezmo'],
    'Primicias': ['primicia'],
    'Ofrenda Misionera': ['misioner'],
    'Ofrenda Gavillas para Cristo': ['gavilla'],
    'Ofrenda Rayos de Luz': ['rayos de luz', 'rayo de luz'],
    'Ofrenda Semestral': ['semestral'],
    'Obra Social Nacional': ['obra social nacional'],
  },
  Egreso: {
    'Arriendo': ['arriendo'],
    'Servicios': ['servicio', 'cuenta de luz', 'cuenta de agua', 'cuenta de gas', 'electricidad', 'internet'],
    'E. Dominical - Oficina': ['dominical', 'oficina'],
    'Insumos Aseo': ['aseo', 'limpieza'],
    'Viáticos': ['viatico'],
    'Inversión Actividad Pro-Templo': ['actividad'],
    'Obra Social Local': ['obra social'],
    'Construcción': ['construccion'],
    'Pago Préstamo': ['prestamo'],
    'Entrega Diezmo a Pastor': ['diezmo'],
    'Adelanto Pastor': ['adelanto'],
    'Diezmo de Diezmo': ['diezmo de diezmo'],
    'FOSP': ['fosp'],
    'Primicias': ['primicia'],
    'AFP y Fonasa': ['afp', 'fonasa', 'imposicion'],
    'Otras Donaciones': ['donacion'],
    'Ofrenda Misionera': ['misioner'],
    'Ofrenda Gavillas para Cristo': ['gavilla'],
    'Ofrenda Rayos de Luz': ['rayos de luz', 'rayo de luz'],
    'Ofrenda Semestral': ['semestral'],
    'Obra Social Nacional': ['obra social nacional'],
    'Otros Envíos': ['envio'],
  },
};

/** Ejecutar desde el editor: autoriza permisos, crea carpeta y planilla, y (re)construye la pestaña Balance. */
function inicializar() {
  const d = destino_();
  crearBalance_(d.libro);
  Logger.log('Carpeta: ' + d.carpeta.getUrl());
  Logger.log('Planilla: ' + d.libro.getUrl());
  Logger.log('Clave de Anthropic configurada: ' + (prop_('ANTHROPIC_API_KEY') ? 'sí' : 'NO (agrega ANTHROPIC_API_KEY)'));
}

function prop_(nombre) {
  return PropertiesService.getScriptProperties().getProperty(nombre);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    switch (p.accion) {
      // Al abrir la app: estado y últimos comprobantes en una sola llamada.
      case 'inicio': return json_({ok: true, datos: {estado: estado_(), ultimas: ultimas_(10)}});
      case 'ping': return json_({ok: true, datos: estado_()});
      case 'ultimas': return json_({ok: true, datos: ultimas_(10)});
      // Control de que las fórmulas del Balance calculan: resumen tal como se ve en la planilla.
      case 'balance': return json_({ok: true, datos: destino_().libro.getSheetByName(HOJA_BALANCE).getRange('A2:D10').getDisplayValues()});
      default: return json_({ok: false, error: 'acción desconocida: ' + p.accion});
    }
  } catch (err) {
    return json_({ok: false, error: String(err && err.message || err)});
  }
}

function doPost(e) {
  try {
    const cuerpo = JSON.parse(e.postData.contents);
    switch (cuerpo.accion) {
      case 'extraer': return json_({ok: true, datos: extraer_(cuerpo)});
      case 'guardar': return json_({ok: true, datos: guardar_(cuerpo)});
      case 'eliminar': return json_({ok: true, datos: eliminar_(cuerpo)});
      default: return json_({ok: false, error: 'acción desconocida: ' + cuerpo.accion});
    }
  } catch (err) {
    return json_({ok: false, error: String(err && err.message || err)});
  }
}

// ---------------------------------------------------------------- Drive

/** Carpeta, subcarpeta de archivos y planilla; las crea la primera vez (con bloqueo para no duplicar). */
function destino_() {
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let carpeta = porId_(props.getProperty('CARPETA_ID'), DriveApp.getFolderById);
    if (!carpeta) {
      carpeta = DriveApp.createFolder(NOMBRE_CARPETA);
      props.setProperty('CARPETA_ID', carpeta.getId());
    }
    let archivos = porId_(props.getProperty('ARCHIVOS_ID'), DriveApp.getFolderById);
    if (!archivos) {
      archivos = carpeta.createFolder('Archivos');
      props.setProperty('ARCHIVOS_ID', archivos.getId());
    }
    let libro = porId_(props.getProperty('SHEET_ID'), SpreadsheetApp.openById);
    if (!libro) {
      libro = SpreadsheetApp.create(NOMBRE_PLANILLA);
      DriveApp.getFileById(libro.getId()).moveTo(carpeta);
      // Montos con punto de miles y fechas chilenas.
      libro.setSpreadsheetLocale('es_CL');
      libro.getSheets()[0].setName(HOJA_REGISTROS);
      props.setProperty('SHEET_ID', libro.getId());
      props.deleteProperty('VERSION_PLANILLA');
    }
    if (props.getProperty('VERSION_PLANILLA') !== VERSION_PLANILLA) {
      migrarRegistros_(libro.getSheetByName(HOJA_REGISTROS));
      crearBalance_(libro);
      props.setProperty('VERSION_PLANILLA', VERSION_PLANILLA);
    }
    return {carpeta: carpeta, archivos: archivos, libro: libro, hoja: libro.getSheetByName(HOJA_REGISTROS)};
  } finally {
    lock.releaseLock();
  }
}

/** Deja la pestaña Registros con las columnas actuales, conservando los datos por nombre de encabezado. */
function migrarRegistros_(hoja) {
  let filas = [];
  if (hoja.getLastRow() > 1) {
    const encab = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0].map(h => RENOMBRES[h] || h);
    const pos = COLUMNAS.map(c => encab.indexOf(c));
    filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, encab.length).getValues()
      .map(f => pos.map(i => i < 0 ? '' : f[i]));
  }
  hoja.clear();
  hoja.showColumns(1, hoja.getMaxColumns());
  hoja.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS]).setNumberFormat('@')
    .setFontWeight('bold').setBackground('#dbe7f6');
  hoja.setFrozenRows(1);
  hoja.getRange('A2:A').setNumberFormat('dd-mm-yyyy hh:mm');
  hoja.getRange('B2:B').setNumberFormat('dd-mm-yyyy');
  hoja.getRange(letra_(C.monto) + '2:' + letra_(C.monto)).setNumberFormat('$#,##0');
  if (filas.length) hoja.getRange(2, 1, filas.length, COLUMNAS.length).setValues(filas);
  hoja.hideColumns(C.id + 1, 2);
}

/**
 * Camino rápido para lecturas: si la planilla ya existe y está al día, usa los IDs guardados sin abrir Drive
 * ni tomar el bloqueo (destino_ tarda varios segundos). Si falta algo, recurre a destino_ para crearlo.
 */
function ids_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHEET_ID') || !props.getProperty('CARPETA_ID') ||
      props.getProperty('VERSION_PLANILLA') !== VERSION_PLANILLA) {
    destino_();
  }
  return {planilla: props.getProperty('SHEET_ID'), carpeta: props.getProperty('CARPETA_ID')};
}

function hojaRegistros_() {
  try {
    const hoja = SpreadsheetApp.openById(ids_().planilla).getSheetByName(HOJA_REGISTROS);
    if (hoja) return hoja;
  } catch (err) {
    /* la planilla se borró: destino_ la vuelve a crear */
  }
  return destino_().hoja;
}

function porId_(id, abrir) {
  if (!id) return null;
  try {
    const obj = abrir(id);
    return obj.isTrashed && obj.isTrashed() ? null : obj;
  } catch (err) {
    return null;
  }
}

function estado_() {
  const ids = ids_();
  return {
    carpeta_url: 'https://drive.google.com/drive/folders/' + ids.carpeta,
    planilla_url: 'https://docs.google.com/spreadsheets/d/' + ids.planilla + '/edit',
    ia: !!prop_('ANTHROPIC_API_KEY'),
    uso_hoy: usoHoy_(),
    limite_diario: limite_(),
    categorias: CATEGORIAS,
  };
}

/** Los últimos n comprobantes según la fecha en que se registraron (la hoja está ordenada por fecha del comprobante). */
function ultimas_(n) {
  const hoja = hojaRegistros_();
  if (hoja.getLastRow() < 2) return [];
  const filas = hoja.getRange(2, 1, hoja.getLastRow() - 1, COLUMNAS.length).getValues()
    .filter(f => f[C.id])
    .sort((a, b) => new Date(b[C.registro]) - new Date(a[C.registro]))
    .slice(0, n);
  return filas.map(f => ({
    id: f[C.id],
    fecha: f[C.fecha] instanceof Date ? Utilities.formatDate(f[C.fecha], 'America/Santiago', 'dd-MM-yyyy') : String(f[C.fecha]),
    movimiento: f[C.movimiento], nombre: f[C.nombre], tipo: f[C.tipo], subtipo: f[C.subtipo], monto: f[C.monto], link: f[C.link],
  }));
}

// ---------------------------------------------------------------- Lectura con Claude

function limite_() {
  return Number(prop_('LIMITE_DIARIO')) || LIMITE_POR_DEFECTO;
}

function claveUso_() {
  return 'USO_' + Utilities.formatDate(new Date(), 'America/Santiago', 'yyyy-MM-dd');
}

function usoHoy_() {
  return Number(prop_(claveUso_())) || 0;
}

/** Suma una lectura al contador del día; falla si se superó el tope. */
function consumirCupo_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const usadas = usoHoy_();
    if (usadas >= limite_()) {
      throw new Error('Se alcanzó el tope de ' + limite_() + ' lecturas por hoy. Intenta mañana.');
    }
    PropertiesService.getScriptProperties().setProperty(claveUso_(), String(usadas + 1));
  } finally {
    lock.releaseLock();
  }
}

/** Las llamadas que la API rechaza (sin saldo, clave inválida) no cuentan para el tope. */
function devolverCupo_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    PropertiesService.getScriptProperties().setProperty(claveUso_(), String(Math.max(0, usoHoy_() - 1)));
  } finally {
    lock.releaseLock();
  }
}

function tipos_(movimiento) {
  return Object.keys(CATEGORIAS[movimiento] || {});
}

function todosLosTipos_() {
  return tipos_('Ingreso').concat(tipos_('Egreso'));
}

function todosLosSubtipos_() {
  const s = [];
  todosLosTipos_().forEach(t => subtipos_(t).forEach(x => { if (s.indexOf(x) < 0) s.push(x); }));
  return s;
}

function subtipos_(tipo) {
  for (const mov in CATEGORIAS) if (CATEGORIAS[mov][tipo]) return CATEGORIAS[mov][tipo];
  return [];
}

function catalogoTexto_() {
  return Object.keys(CATEGORIAS).map(mov => tipos_(mov).map(t => '- ' + t + ': ' + subtipos_(t).join(', ')).join('\n')).join('\n');
}

const ESQUEMA = {
  type: 'object',
  properties: {
    es_comprobante: {type: 'boolean'},
    movimiento: {type: 'string', enum: ['Ingreso', 'Egreso', ''],
      description: 'Según el título del documento: "Comprobante de ingreso" → Ingreso; "Comprobante de egreso" (o "engreso") → Egreso.'},
    fecha: {type: 'string', description: 'Fecha del comprobante (casillas Día, Mes, Año) en formato AAAA-MM-DD, o vacío. ' +
      'Un año de dos dígitos es del 2000: "26" = 2026.'},
    nombre: {type: 'string', description: 'Lo escrito en el campo "Nombre" del comprobante (persona o institución), o vacío.'},
    concepto: {type: 'string', description: 'Glosa o concepto del comprobante, tal como aparece escrito (todas sus líneas).'},
    tipo: {type: 'string', enum: todosLosTipos_().concat([''])},
    subtipo: {type: 'string', enum: todosLosSubtipos_().concat([''])},
    monto: {type: ['number', 'null']},
    observaciones: {type: 'string', description: 'Vacío, salvo que el monto o la fecha sean realmente ambiguos. ' +
      'Todos los comprobantes son manuscritos: no comentes la letra ni la legibilidad de la glosa o el nombre. ' +
      'Tampoco comentes la clasificación ni el título "engreso": eso lo resuelven reglas aparte.'},
  },
  required: ['es_comprobante', 'movimiento', 'fecha', 'nombre', 'concepto', 'tipo', 'subtipo', 'monto', 'observaciones'],
  additionalProperties: false,
};

const INSTRUCCIONES = 'Extrae los datos de este comprobante de ingreso o egreso de la tesorería de una iglesia evangélica chilena. ' +
  'El título del documento indica si es "Comprobante de ingreso" o "Comprobante de egreso". ' +
  // Regla de negocio: el formulario impreso de la iglesia trae el error de imprenta "engreso".
  'Algunos formularios impresos dicen "Comprobante de engreso" por un error de imprenta: eso es un comprobante de Egreso. ' +
  'Los montos están en pesos chilenos: el punto separa miles, así que "$12.990" es 12990. ' +
  'Entrega el monto total como número entero sin símbolos. ' +
  'Clasifica el tipo y subtipo según la glosa o concepto, usando este catálogo:\n' + catalogoTexto_() + '\n' +
  'El tipo debe ser del mismo movimiento (Ingreso N° para ingresos, Egreso N° para egresos) y el subtipo debe pertenecer a ese tipo. ' +
  'Si la glosa contiene una palabra del nombre de un subtipo, clasifícalo en ese subtipo aunque el sentido no calce ' +
  'exactamente (por ejemplo, "entrega plata préstamo" en un egreso es Pago Préstamo). ' +
  'Si la glosa no menciona ningún subtipo y no es clara, deja tipo y subtipo vacíos para que el tesorero lo indique. ' +
  'Si un dato no se ve, deja el texto vacío o null; no lo inventes. ' +
  'Si la imagen no es un comprobante, boleta ni factura, marca es_comprobante en false.';

function extraer_(cuerpo) {
  const clave = prop_('ANTHROPIC_API_KEY');
  if (!clave) throw new Error('Falta configurar ANTHROPIC_API_KEY en las Propiedades del script.');
  validarArchivo_(cuerpo);
  consumirCupo_();

  const bloque = cuerpo.tipo === 'application/pdf'
    ? {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: cuerpo.datos}}
    : {type: 'image', source: {type: 'base64', media_type: cuerpo.tipo, data: cuerpo.datos}};

  const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {'x-api-key': clave, 'anthropic-version': '2023-06-01'},
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model: prop_('MODELO') || MODELO_POR_DEFECTO,
      max_tokens: 4000,
      output_config: {effort: 'low', format: {type: 'json_schema', schema: ESQUEMA}},
      messages: [{role: 'user', content: [bloque, {type: 'text', text: INSTRUCCIONES}]}],
    }),
  });
  const codigo = resp.getResponseCode();
  const r = JSON.parse(resp.getContentText());
  if (codigo !== 200) {
    devolverCupo_();
    throw new Error('Error de la API de Anthropic (' + codigo + '): ' + (r.error && r.error.message || resp.getContentText()));
  }
  if (r.stop_reason === 'refusal') throw new Error('Claude no pudo procesar este documento.');
  const texto = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const datos = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));
  ajustarClasificacion_(datos);
  datos.advertencias = advertencias_(datos);
  datos.uso_hoy = usoHoy_();
  datos.limite_diario = limite_();
  return datos;
}

/** Descarta una clasificación incoherente con el catálogo para que el usuario la elija a mano. */
function ajustarClasificacion_(d) {
  const porClave = clasificarPorPalabraClave_(d.movimiento, d.concepto);
  if (porClave) {
    d.tipo = porClave.tipo;
    d.subtipo = porClave.subtipo;
  }
  if (d.tipo && tipos_(d.movimiento).indexOf(d.tipo) < 0) d.tipo = '';
  if (!d.tipo && d.subtipo) {
    // Si el subtipo solo existe en un tipo de ese movimiento, se deduce el tipo.
    const posibles = tipos_(d.movimiento).filter(t => subtipos_(t).indexOf(d.subtipo) >= 0);
    if (posibles.length === 1) d.tipo = posibles[0];
  }
  if (d.subtipo && subtipos_(d.tipo).indexOf(d.subtipo) < 0) d.subtipo = '';
}

function normalizar_(texto) {
  return ' ' + String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}

/** Aplica PALABRAS_CLAVE a la glosa. Devuelve {tipo, subtipo, palabra} o null si no hay una coincidencia única. */
function clasificarPorPalabraClave_(movimiento, glosa) {
  const claves = PALABRAS_CLAVE[movimiento];
  if (!claves || !glosa) return null;
  const texto = normalizar_(glosa);
  let mejor = null, empate = false;
  for (const subtipo in claves) {
    for (const palabra of claves[subtipo]) {
      if (texto.indexOf(' ' + palabra) < 0) continue;
      if (!mejor || palabra.length > mejor.palabra.length) {
        mejor = {subtipo: subtipo, palabra: palabra};
        empate = false;
      } else if (palabra.length === mejor.palabra.length && subtipo !== mejor.subtipo) {
        empate = true;
      }
    }
  }
  if (!mejor || empate) return null;
  const tipo = tipos_(movimiento).filter(t => subtipos_(t).indexOf(mejor.subtipo) >= 0)[0];
  return tipo ? {tipo: tipo, subtipo: mejor.subtipo, palabra: mejor.palabra} : null;
}

function validarArchivo_(cuerpo) {
  if (!cuerpo.datos) throw new Error('No llegó el archivo.');
  if (TIPOS_PERMITIDOS.indexOf(cuerpo.tipo) < 0) throw new Error('Formato no permitido: ' + cuerpo.tipo + '. Usa JPG, PNG o PDF.');
  if (cuerpo.datos.length > 14 * 1024 * 1024) throw new Error('El archivo es demasiado grande (máx. ~10 MB).');
}

/** Revisiones simples para que el usuario confirme antes de guardar. */
function advertencias_(d) {
  const a = [];
  if (d.es_comprobante === false) a.push('No parece un comprobante de ingreso o egreso.');
  if (!d.movimiento) a.push('No se pudo saber si es ingreso o egreso: indícalo manualmente.');
  if (!d.tipo || !d.subtipo) a.push('La glosa no especifica el tipo de ' + (d.movimiento || 'movimiento').toLowerCase() + ': indícalo manualmente.');
  if (!d.fecha) a.push('No se leyó la fecha.');
  if (!d.monto) a.push('No se leyó el monto.');
  if (d.observaciones) a.push(d.observaciones);
  return a;
}

// ---------------------------------------------------------------- Guardado y eliminación

function guardar_(cuerpo) {
  const c = cuerpo.campos || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.fecha || '') || !numero_(c.monto)) throw new Error('Fecha y monto son obligatorios.');
  if (!CATEGORIAS[c.movimiento]) throw new Error('Indica si es ingreso o egreso.');
  if (tipos_(c.movimiento).indexOf(c.tipo) < 0) throw new Error('Elige un tipo de ' + c.movimiento.toLowerCase() + ' válido.');
  if (subtipos_(c.tipo).indexOf(c.subtipo) < 0) throw new Error('Elige un subtipo válido para ' + c.tipo + '.');
  const d = destino_();

  let link = '', idArchivo = '';
  if (cuerpo.datos) {
    validarArchivo_(cuerpo);
    const ext = {'application/pdf': 'pdf', 'image/png': 'png', 'image/webp': 'webp'}[cuerpo.tipo] || 'jpg';
    const nombre = [c.fecha, c.movimiento, c.subtipo, c.nombre].filter(String).join('_')
      .replace(/[\\/:*?"<>|]/g, '').slice(0, 120) + '.' + ext;
    const archivo = d.archivos.createFile(Utilities.newBlob(Utilities.base64Decode(cuerpo.datos), cuerpo.tipo, nombre));
    link = archivo.getUrl();
    idArchivo = archivo.getId();
  }

  const [a, m, dia] = c.fecha.split('-').map(Number);
  const fila = [new Date(), new Date(a, m - 1, dia), c.movimiento, c.nombre || '', c.tipo, c.subtipo, numero_(c.monto), link,
    (cuerpo.advertencias || []).join(' | '), Utilities.getUuid(), idArchivo];

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    d.hoja.appendRow(fila);
    ordenar_(d.hoja);
  } finally {
    lock.releaseLock();
  }
  return {planilla_url: d.libro.getUrl(), link_archivo: link};
}

/** Deja los registros en orden cronológico según la fecha del comprobante (y la de registro para desempatar). */
function ordenar_(hoja) {
  const n = hoja.getLastRow() - 1;
  if (n > 1) {
    hoja.getRange(2, 1, n, COLUMNAS.length).sort([{column: C.fecha + 1, ascending: true}, {column: C.registro + 1, ascending: true}]);
  }
}

/** Borra la fila del comprobante y manda su archivo a la papelera de Drive. */
function eliminar_(cuerpo) {
  if (!cuerpo.id) throw new Error('Falta el identificador del comprobante.');
  const hoja = destino_().hoja;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (hoja.getLastRow() < 2) throw new Error('El comprobante ya no existe.');
    const ids = hoja.getRange(2, C.id + 1, hoja.getLastRow() - 1, 2).getValues();
    const i = ids.findIndex(f => f[0] === cuerpo.id);
    if (i < 0) throw new Error('El comprobante ya no existe en la planilla.');
    const archivo = porId_(ids[i][1], DriveApp.getFileById);
    if (archivo) archivo.setTrashed(true);
    hoja.deleteRow(i + 2);
  } finally {
    lock.releaseLock();
  }
  return {eliminado: cuerpo.id};
}

function numero_(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9,-]/g, '').replace(',', '.'));
  return isNaN(n) ? '' : n;
}

// ---------------------------------------------------------------- Pestaña Balance

/**
 * (Re)construye la pestaña Balance solo con fórmulas, para que se actualice sola con cada registro.
 * setFormula interpreta las fórmulas según la configuración regional de la planilla: en es_CL el separador es ";" y
 * las fórmulas en sintaxis inglesa quedan en #ERROR!. Por eso se escriben con la planilla en en_US y luego se
 * restaura es_CL (Sheets traduce las fórmulas guardadas al cambiar de configuración).
 */
function crearBalance_(libro) {
  libro.setSpreadsheetLocale('en_US');
  try {
    escribirBalance_(libro);
    SpreadsheetApp.flush();
  } finally {
    libro.setSpreadsheetLocale('es_CL');
  }
}

function escribirBalance_(libro) {
  let h = libro.getSheetByName(HOJA_BALANCE);
  if (h) {
    h.getCharts().forEach(g => h.removeChart(g));
    h.clear();
    h.clearConditionalFormatRules();
    h.getDataRange().clearDataValidations();
  } else {
    h = libro.insertSheet(HOJA_BALANCE);
  }

  const R = "Registros!";
  const rango = col => R + '$' + col + '$2:$' + col;
  const FECHA = rango(letra_(C.fecha)), MOV = rango(letra_(C.movimiento)), TIPO = rango(letra_(C.tipo)),
    SUB = rango(letra_(C.subtipo)), TOTAL = rango(letra_(C.monto));
  // Filtro por el período elegido: año en B2 y mes en D2 ("Todos" = sin filtro). Los meses están en Y2:Y13.
  const ANIO = '((($B$2="Todos")+(YEAR(' + FECHA + ')=IFERROR(VALUE($B$2),0)))>0)';
  const MES = '((($D$2="Todos")+(MONTH(' + FECHA + ')=IFERROR(MATCH($D$2,$Y$2:$Y$13,0),0)))>0)';
  const suma = cond => '=SUMPRODUCT(' + cond + '*' + ANIO + '*' + MES + '*' + TOTAL + ')';

  const titulo = (celda, texto) => h.getRange(celda).setValue(texto).setFontWeight('bold').setFontSize(12).setFontColor('#1d4f91');
  const encabezado = (fila, col, textos) => h.getRange(fila, col, 1, textos.length).setValues([textos])
    .setFontWeight('bold').setBackground('#dbe7f6');
  const PESOS = '$#,##0;-$#,##0';

  h.getRange('A1').setValue('Balance de Tesorería — Iglesia Pentecostal Unida del Nombre de Jesús')
    .setFontWeight('bold').setFontSize(15).setFontColor('#1d4f91');
  h.getRange('A2').setValue('Período — Año:').setFontWeight('bold').setHorizontalAlignment('right');
  h.getRange('B2').setValue('Todos').setBackground('#fff4cc').setFontWeight('bold');
  h.getRange('C2').setValue('Mes:').setFontWeight('bold').setHorizontalAlignment('right');
  h.getRange('D2').setValue('Todos').setBackground('#fff4cc').setFontWeight('bold');
  // Listas para los selectores en columnas ocultas: meses en Y, años con registros en Z.
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre',
    'Noviembre', 'Diciembre'];
  h.getRange(1, 25, 13, 1).setValues([['Todos']].concat(MESES.map(m => [m])));
  h.getRange('Z1').setValue('Todos');
  h.getRange('Z2').setFormula('=IFERROR(SORT(UNIQUE(FILTER(YEAR(' + FECHA + '),' + FECHA + '<>"")),1,FALSE),"")');
  h.getRange('B2').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(h.getRange('Z1:Z50'), true).build());
  h.getRange('D2').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(h.getRange('Y1:Y13'), true).build());
  h.hideColumns(25, 2);

  // --- Resumen (A4:C12)
  titulo('A4', 'Resumen');
  const resumen = [
    ['Total ingresos', suma('(' + MOV + '="Ingreso")')],
    ['Total egresos', suma('(' + MOV + '="Egreso")')],
    ['Saldo (ingresos − egresos)', '=B5-B6'],
    ['Estado', '=IF(B7<0,"Déficit",IF(B7>0,"Superávit","Equilibrio"))'],
    ['Egresos / ingresos', '=IFERROR(B6/B5,0)'],
    ['Falta para el punto de equilibrio', '=MAX(0,-B7)'],
    ['Mayor ingreso (concepto · % de ingresos)', '=IFERROR(INDEX(G6:G21,1),"—")'],
    ['Mayor egreso (concepto · % de egresos)', '=IFERROR(INDEX(G25:G46,1),"—")'],
  ];
  resumen.forEach((f, i) => {
    h.getRange(5 + i, 1).setValue(f[0]);
    h.getRange(5 + i, 2).setFormula(f[1]);
  });
  h.getRange('C11').setFormula('=IFERROR(INDEX(I6:I21,1),"")');
  h.getRange('C12').setFormula('=IFERROR(INDEX(I25:I46,1),"")');
  h.getRange('B5:B7').setNumberFormat(PESOS);
  h.getRange('B10').setNumberFormat(PESOS);
  h.getRange('B9').setNumberFormat('0.0%');
  h.getRange('C11:C12').setNumberFormat('0.0%');
  h.getRange('B5:B8').setFontWeight('bold');

  // --- Saldo por fondo (A14:E18)
  titulo('A14', 'Saldo por fondo');
  encabezado(15, 1, ['Fondo', 'Ingresos', 'Egresos', 'Saldo', 'Estado']);
  const ingresos = tipos_('Ingreso'), egresos = tipos_('Egreso');
  ['N°1 - Locales', 'N°2 - Dineros Pastor', 'N°3 - Dineros Nacionales'].forEach((nombre, i) => {
    const fila = 16 + i;
    h.getRange(fila, 1).setValue(nombre);
    h.getRange(fila, 2).setFormula(suma('(' + TIPO + '="' + ingresos[i] + '")'));
    h.getRange(fila, 3).setFormula(suma('(' + TIPO + '="' + egresos[i] + '")'));
    h.getRange(fila, 4).setFormula('=B' + fila + '-C' + fila);
    h.getRange(fila, 5).setFormula('=IF(D' + fila + '<0,"Déficit",IF(D' + fila + '>0,"Superávit","Equilibrio"))');
  });
  h.getRange('B16:D18').setNumberFormat(PESOS);

  // --- Detalle por concepto (catálogo completo) desde la fila 20
  const detalle = (filaTitulo, mov, total) => {
    titulo('A' + filaTitulo, (mov === 'Ingreso' ? 'Ingresos' : 'Egresos') + ' por concepto');
    encabezado(filaTitulo + 1, 1, ['Tipo', 'Subtipo', 'Monto', '% del total']);
    let fila = filaTitulo + 2;
    const desde = fila;
    tipos_(mov).forEach(t => subtipos_(t).forEach(s => {
      h.getRange(fila, 1, 1, 2).setValues([[t, s]]);
      h.getRange(fila, 3).setFormula(suma('(' + MOV + '="' + mov + '")*(' + TIPO + '="' + t + '")*(' + SUB + '="' + s + '")'));
      h.getRange(fila, 4).setFormula('=IFERROR(C' + fila + '/' + total + ',0)');
      fila++;
    }));
    h.getRange(desde, 3, fila - desde, 1).setNumberFormat(PESOS);
    h.getRange(desde, 4, fila - desde, 1).setNumberFormat('0.0%');
    return {desde: desde, hasta: fila - 1};
  };
  const di = detalle(20, 'Ingreso', '$B$5');
  const de = detalle(di.hasta + 2, 'Egreso', '$B$6');

  // --- Rankings y punto de equilibrio (columnas G:K)
  titulo('G4', 'Ranking de ingresos');
  encabezado(5, 7, ['Subtipo', 'Monto', '% de ingresos', 'Aumento necesario para cubrir el déficit']);
  h.getRange('G6').setFormula('=IFERROR(SORT(FILTER({B' + di.desde + ':B' + di.hasta + ',C' + di.desde + ':C' + di.hasta +
    '},C' + di.desde + ':C' + di.hasta + '>0),2,FALSE),"")');
  h.getRange('I6').setFormula('=ARRAYFORMULA(IF(H6:H21="","",H6:H21/$B$5))');
  h.getRange('J6').setFormula('=ARRAYFORMULA(IF((H6:H21="")+($B$10=0),"",$B$10/H6:H21))');
  h.getRange('H6:H21').setNumberFormat(PESOS);
  h.getRange('I6:J21').setNumberFormat('0.0%');

  titulo('G23', 'Ranking de egresos y punto de equilibrio');
  encabezado(24, 7, ['Subtipo', 'Monto', '% de egresos', 'Reducirlo cubre (% del déficit)', '% acumulado del déficit']);
  h.getRange('G25').setFormula('=IFERROR(SORT(FILTER({B' + de.desde + ':B' + de.hasta + ',C' + de.desde + ':C' + de.hasta +
    '},C' + de.desde + ':C' + de.hasta + '>0),2,FALSE),"")');
  h.getRange('I25').setFormula('=ARRAYFORMULA(IF(H25:H46="","",H25:H46/$B$6))');
  h.getRange('J25').setFormula('=ARRAYFORMULA(IF((H25:H46="")+($B$10=0),"",IF(H25:H46/$B$10>1,1,H25:H46/$B$10)))');
  h.getRange('K25').setFormula('=ARRAYFORMULA(IF((H25:H46="")+($B$10=0),"",IF(SUMIF(ROW(H25:H46),"<="&ROW(H25:H46),H25:H46)/$B$10>1,1,' +
    'SUMIF(ROW(H25:H46),"<="&ROW(H25:H46),H25:H46)/$B$10)))');
  h.getRange('H25:H46').setNumberFormat(PESOS);
  h.getRange('I25:K46').setNumberFormat('0.0%');
  h.getRange('G47').setValue('Con déficit, los primeros egresos del ranking son los que más acercan al punto de equilibrio; ' +
    'en ingresos, "Aumento necesario" indica cuánto debería crecer ese concepto para cubrir el déficit por sí solo.')
    .setFontStyle('italic').setFontColor('#5f6b7a');

  // --- Movimiento mensual (columnas M:Q)
  titulo('M4', 'Movimiento mensual');
  h.getRange('M5').setValue('Año:').setFontWeight('bold');
  h.getRange('N5').setFormula('=IF($B$2="Todos",IF(COUNT(' + FECHA + ')=0,YEAR(TODAY()),YEAR(MAX(' + FECHA + '))),VALUE($B$2))')
    .setFontWeight('bold');
  encabezado(6, 13, ['Mes', 'Ingresos', 'Egresos', 'Saldo', 'Saldo acumulado del año']);
  for (let m = 1; m <= 12; m++) {
    const fila = 6 + m;
    const mes = '(YEAR(' + FECHA + ')=$N$5)*(MONTH(' + FECHA + ')=' + m + ')';
    h.getRange(fila, 13).setFormula('=TEXT(DATE($N$5,' + m + ',1),"mmmm")');
    h.getRange(fila, 14).setFormula('=SUMPRODUCT((' + MOV + '="Ingreso")*' + mes + '*' + TOTAL + ')');
    h.getRange(fila, 15).setFormula('=SUMPRODUCT((' + MOV + '="Egreso")*' + mes + '*' + TOTAL + ')');
    h.getRange(fila, 16).setFormula('=N' + fila + '-O' + fila);
    h.getRange(fila, 17).setFormula(m === 1 ? '=P7' : '=Q' + (fila - 1) + '+P' + fila);
  }
  h.getRange('N7:Q18').setNumberFormat(PESOS);

  // --- Colores de estado
  const rojo = '#fdecec', rojoTexto = '#8a1c1c', verde = '#e6f6ec', verdeTexto = '#155d2e';
  const estados = [h.getRange('B8'), h.getRange('E16:E18')];
  const negativos = [h.getRange('B7'), h.getRange('D16:D18'), h.getRange('P7:Q18')];
  h.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Déficit').setBackground(rojo).setFontColor(rojoTexto).setRanges(estados).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Superávit').setBackground(verde).setFontColor(verdeTexto).setRanges(estados).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(rojoTexto).setRanges(negativos).build(),
  ]);

  // --- Gráficos (debajo de la tabla mensual)
  h.insertChart(h.newChart().setChartType(Charts.ChartType.PIE).addRange(h.getRange('G6:H21'))
    .setOption('title', 'Ingresos por concepto').setOption('pieHole', 0.4).setPosition(20, 13, 0, 0).build());
  h.insertChart(h.newChart().setChartType(Charts.ChartType.PIE).addRange(h.getRange('G25:H46'))
    .setOption('title', 'Egresos por concepto').setOption('pieHole', 0.4).setPosition(40, 13, 0, 0).build());
  h.insertChart(h.newChart().setChartType(Charts.ChartType.COLUMN).addRange(h.getRange('M6:O18'))
    .setNumHeaders(1).setOption('title', 'Ingresos y egresos por mes').setPosition(60, 13, 0, 0).build());

  h.setFrozenRows(2);
  h.setColumnWidth(1, 290);
  h.setColumnWidth(2, 210);
  [3, 4, 5].forEach(c => h.setColumnWidth(c, 110));
  h.setColumnWidth(6, 24);
  h.setColumnWidth(7, 210);
  [8, 9, 10, 11].forEach(c => h.setColumnWidth(c, 140));
  h.getRange('J5:K5').setWrap(true);
  h.getRange('J24:K24').setWrap(true);
  h.getRange('G47').setWrap(false);
  h.setColumnWidth(12, 24);
  [13, 14, 15, 16, 17].forEach(c => h.setColumnWidth(c, 120));
}
