(function () {
  'use strict';

  window.MUSICALA_PROJECT_KNOWLEDGE = {
    organization: {
      name: 'Musicala',
      motto: 'vida, alma y arte',
      type: 'escuela de formacion artistica',
      areas: ['musica', 'danza', 'artes plasticas', 'teatro'],
      audiences: [
        'estudiantes', 'familias', 'acudientes', 'docentes', 'asistentes',
        'empresas', 'aliados', 'fondos de empleados', 'colegios', 'jardines',
        'FSA', 'adultos', 'ninos', 'jovenes'
      ],
      modalities: [
        'sede', 'hogar', 'virtual', 'mixtas', 'vacacionales', 'talleres',
        'eventos', 'Musicala Spaces'
      ]
    },
    tone: [
      'calido', 'humano', 'claro', 'cercano', 'respetuoso', 'artistico',
      'no robotico', 'no excesivamente meloso'
    ],
    responseRules: [
      'responder con claridad',
      'cuidar el tono segun el caso',
      'no prometer cosas no confirmadas',
      'no inventar valores, horarios, disponibilidad ni politicas',
      'sugerir revisar con coordinacion cuando el caso sea delicado',
      'priorizar mensajes ya existentes en la base',
      'dejar placeholders cuando falten datos'
    ],
    intents: [
      { id: 'ventas', label: 'Ventas / informacion comercial', keywords: ['ventas', 'informacion comercial', 'cliente', 'interesado', 'cotizacion', 'planes', 'precio', 'curso'], priorityFields: ['ventas', 'informacion', 'interesado', 'planes'] },
      { id: 'inscripcion-matricula', label: 'Inscripcion / matricula', keywords: ['inscripcion', 'matricula', 'registro', 'formulario', 'cupo', 'documentos'], priorityFields: ['inscripcion', 'matricula', 'registro'] },
      { id: 'pagos-cartera', label: 'Pagos / cartera / facturacion', keywords: ['pagos', 'cartera', 'facturacion', 'cuenta de cobro', 'mora', 'mensualidad', 'recibo', 'valor'], priorityFields: ['pago', 'cartera', 'facturacion', 'mora'] },
      { id: 'confirmacion-clase', label: 'Confirmacion de clase', keywords: ['confirmacion de clase', 'confirmar clase', 'recordatorio', 'asistencia', 'agenda'], priorityFields: ['confirmacion', 'clase', 'agenda'] },
      { id: 'cancelacion-reprogramacion', label: 'Cancelacion / reprogramacion / recuperacion', keywords: ['cancelacion', 'cancelar', 'reprogramacion', 'reprogramar', 'recuperacion', 'aplazar', 'cambiar clase'], priorityFields: ['cancelacion', 'reprogramacion', 'recuperacion'] },
      { id: 'novedad-docente', label: 'Novedad docente / reemplazo', keywords: ['docente llego tarde', 'docente enfermo', 'ausencia docente', 'reemplazo', 'profesor tarde', 'incapacidad'], priorityFields: ['docente', 'reemplazo', 'ausencia', 'tarde'] },
      { id: 'modalidades', label: 'Modalidades de clase', keywords: ['clase en sede', 'clase a hogar', 'clase virtual', 'modalidad sede', 'modalidad hogar', 'virtual'], priorityFields: ['sede', 'hogar', 'virtual', 'modalidad'] },
      { id: 'vacacionales-spaces', label: 'Vacacionales / Musicala Spaces', keywords: ['vacacionales', 'talleres', 'eventos', 'musicala spaces', 'spaces'], priorityFields: ['vacacionales', 'spaces', 'taller'] },
      { id: 'fsa-aliados', label: 'FSA / empresas / aliados', keywords: ['FSA', 'fondo de empleados', 'empresa', 'aliado', 'colegio', 'jardin'], priorityFields: ['fsa', 'empresa', 'aliado'] },
      { id: 'contratacion-vacantes', label: 'Contratacion / vacantes', keywords: ['contratacion', 'vacante', 'hoja de vida', 'entrevista', 'docente nuevo'], priorityFields: ['contratacion', 'vacante'] },
      { id: 'quejas-reclamos', label: 'Quejas / reclamos / inconformidades', keywords: ['queja', 'reclamo', 'inconformidad', 'molestia', 'malestar', 'delicado'], priorityFields: ['queja', 'reclamo', 'inconformidad'] },
      { id: 'reportes-internos', label: 'Reportes internos / bitacoras / diagnosticos', keywords: ['reporte interno', 'bitacora', 'diagnostico', 'muestra', 'proyecto', 'asistencia', 'protocolo interno'], priorityFields: ['bitacora', 'diagnostico', 'asistencia'] }
    ],
    synonymGroups: [
      ['ventas', 'comercial', 'informacion comercial', 'cotizacion', 'interesado', 'cliente'],
      ['inscripcion', 'matricula', 'registro', 'cupo'],
      ['pagos', 'pago', 'pendiente', 'recordar', 'recordatorio', 'cartera', 'cobro', 'cobranza', 'facturacion', 'cuenta de cobro', 'mora', 'mensualidad', 'valor'],
      ['cancelacion', 'cancelar', 'reprogramacion', 'reprogramar', 'recuperacion', 'aplazar'],
      ['docente', 'docentes', 'profe', 'profesor', 'profesora', 'maestro', 'maestra'],
      ['sede', 'modalidad sede', 'presencial'],
      ['hogar', 'domicilio', 'casa', 'a domicilio'],
      ['virtual', 'online', 'remoto'],
      ['familia', 'familias', 'acudiente', 'padres', 'mama', 'papa'],
      ['empresa', 'aliado', 'fsa', 'fondo de empleados', 'colegio', 'jardin']
    ],
    categoryAliases: {
      'Docente': ['Docentes', 'docentes', 'profe', 'profesor', 'profesora'],
      'Docentes': ['Docente', 'docentes', 'profe', 'profesor', 'profesora'],
      'Academico': ['Academico', 'Academico', 'Acadmico', 'Academica'],
      'Academico normalizado': ['Academico', 'Academico', 'Acadmico'],
      'Ventas': ['ventas', 'Comercial', 'Informacion comercial', 'Guion de venta', 'Guion de ventas'],
      'Guion de venta': ['Guion de ventas', 'Ventas', 'ventas'],
      'Modalidad Sede': ['Modalidades Sede', 'Sede', 'clase en sede', 'presencial'],
      'Musicala Spaces': ['Musicala spaces', 'spaces', 'eventos', 'talleres'],
      'Emergencia': ['Emergencias', 'urgente', 'novedad', 'prioritario'],
      'Pagos': ['Pago', 'Cartera', 'Cobranza', 'Facturacion'],
      'FSA': ['fsa', 'aliados', 'fondo de empleados', 'empresas']
    },
    quickSearches: [
      { label: 'Favoritos', query: '__favorites__' },
      { label: 'Recientes', query: '__recent__' },
      { label: 'Ventas', query: 'ventas informacion comercial interesado' },
      { label: 'Pagos', query: 'recordar pago pendiente cartera' },
      { label: 'Reprogramacion', query: 'cancelar reprogramar recuperar clase' },
      { label: 'Docentes', query: 'docente profe reemplazo tarde enfermo' },
      { label: 'FSA', query: 'FSA empresa aliado fondo empleados' },
      { label: 'Vacacionales', query: 'vacacionales talleres informacion' }
    ]
  };
})();
