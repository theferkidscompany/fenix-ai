const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let nodemailer = null;
let admin = null;

try {
    nodemailer = require('nodemailer');
} catch (e) {
    console.warn('Nodemailer no está instalado. El envío de correos de alerta quedará desactivado.');
}

try {
    admin = require('firebase-admin');
} catch (e) {
    console.warn('firebase-admin no está instalado. El guardado de alertas/feedback en Firestore del servidor quedará desactivado.');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ======================================================================
// CONFIGURACIÓN GENERAL
// ======================================================================
const PUERTO = process.env.PORT || 3000;
const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL || 'theferkidscompany@gmail.com';

const geminiKeysString = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
const LLAVES_GEMINI = geminiKeysString
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

let indiceLlaveGemini = 0;
const ESTADO_LLAVES_GEMINI = [];
const CACHE_RESPUESTAS = new Map();

const MODELOS_NVIDIA = [
    { id: 'qwen/qwen2.5-coder-32b-instruct', key: process.env.NVIDIA_QWEN_KEY },
    { id: 'deepseek-ai/deepseek-r1', key: process.env.NVIDIA_DEEPSEEK_KEY },
    { id: 'meta/llama-3.1-70b-instruct', key: process.env.NVIDIA_LLAMA_KEY }
];

// ======================================================================
// FIREBASE ADMIN (OPCIONAL, PARA MENSAJES_ALERTA / FEEDBACK / PANEL ADMIN)
// Requiere:
//   - npm i firebase-admin
//   - Variable FIREBASE_SERVICE_ACCOUNT_JSON con el JSON completo
// ======================================================================
let firestoreAdmin = null;

if (admin && !admin.apps.length && process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });

        firestoreAdmin = admin.firestore();
        console.log('✅ Firebase Admin inicializado correctamente.');
    } catch (error) {
        console.error('⚠️ No se pudo inicializar Firebase Admin:', error.message || error);
    }
}

// ======================================================================
// CORREO DE ALERTA (OPCIONAL)
// Requiere:
//   - npm i nodemailer
//   - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
// ======================================================================
let mailTransporter = null;

if (
    nodemailer &&
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
) {
    try {
        mailTransporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT),
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        console.log('✅ Transporte SMTP listo.');
    } catch (error) {
        console.error('⚠️ No se pudo crear el transporte SMTP:', error.message || error);
    }
}

// ======================================================================
// TÍTULO LOCAL DESDE EL PRIMER MENSAJE
// NO USA GEMINI. NO LEE PROMPTS. NO LEE INSTRUCCIONES.
// ======================================================================
function crearTituloDesdePrimerMensaje(texto) {
    const base = (texto || '').replace(/\s+/g, ' ').trim();

    if (!base) {
        return 'Nuevo Chat';
    }

    const limpio = base
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!limpio) {
        return 'Nuevo Chat';
    }

    const palabras = limpio
        .split(' ')
        .filter(Boolean)
        .slice(0, 4);

    const titulo = palabras.join(' ').trim();

    if (!titulo) {
        return 'Nuevo Chat';
    }

    return titulo.charAt(0).toUpperCase() + titulo.slice(1);
}

// ======================================================================
// UTILIDADES
// ======================================================================
function limpiarTexto(texto) {
    return (texto || '').replace(/\s+/g, ' ').trim();
}

function quitarTildes(texto) {
    return (texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function textoIncluyeAlguno(texto, lista) {
    const base = quitarTildes((texto || '').toLowerCase());
    return lista.some((item) => base.includes(quitarTildes(item.toLowerCase())));
}

function contarPalabras(texto) {
    return limpiarTexto(texto).split(' ').filter(Boolean).length;
}

function llaveGeminiDisponible(indice) {
    const estado = ESTADO_LLAVES_GEMINI[indice];
    return !estado || !estado.bloqueadaHasta || Date.now() > estado.bloqueadaHasta;
}

function bloquearLlaveGemini(indice, ms, motivo) {
    ESTADO_LLAVES_GEMINI[indice] = {
        bloqueadaHasta: Date.now() + ms,
        motivo: motivo || 'bloqueo temporal'
    };
}

function extraerRetryMs(error) {
    const texto = (error?.message || error || '').toString();
    const m = texto.match(/retry in\s+(\d+(?:\.\d+)?)s/i) || texto.match(/retryDelay":"(\d+)s/i);
    if (!m) return 0;
    return Math.ceil(parseFloat(m[1]) * 1000);
}

function esCuotaDiariaGemini(error) {
    const texto = (error?.message || error || '').toString();
    return /perday|per day|rpd|GenerateRequestsPerDayPerModel|GenerateRequestsPerDayPerProjectPerModel/i.test(texto);
}

function msHastaMedianochePeru() {
    const ahora = new Date();
    const lima = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Lima' }));
    const siguiente = new Date(lima);
    siguiente.setHours(24, 0, 0, 0);
    return Math.max(60 * 1000, siguiente.getTime() - lima.getTime() + 60 * 1000);
}

function crearClaveCache(datos) {
    const partes = [
        limpiarTexto(datos?.mensaje || '').toLowerCase(),
        datos?.modoAplicado || '',
        datos?.algoritmo || '',
        datos?.perfil || '',
        datos?.archivo ? 'archivo' : 'texto'
    ];
    return partes.join('||');
}

function obtenerCache(clave) {
    const item = CACHE_RESPUESTAS.get(clave);
    if (!item) return null;
    if (Date.now() > item.expira) {
        CACHE_RESPUESTAS.delete(clave);
        return null;
    }
    return item.valor;
}

function guardarCache(clave, valor, ttlMs = 8 * 60 * 1000) {
    CACHE_RESPUESTAS.set(clave, {
        valor,
        expira: Date.now() + ttlMs
    });
}

function obtenerFechaHoraPeru() {
    const ahora = new Date();
    return new Intl.DateTimeFormat('es-PE', {
        timeZone: 'America/Lima',
        dateStyle: 'full',
        timeStyle: 'short'
    }).format(ahora);
}

function necesitaMemoriaCompleta(mensajeLimpio) {
    return textoIncluyeAlguno(mensajeLimpio, [
        'detall',
        'detalle',
        'eje por eje',
        'completo',
        'desarrolla',
        'desarróll',
        'guion',
        'discurso',
        'propuesta',
        'regidor',
        'regidora',
        'campus bilingue',
        'campus bilingüe',
        'green squad',
        'liga fenix',
        'liga fénix',
        'fenix lab',
        'fénix lab',
        'ley y orden',
        'muro de la revolucion',
        'muro de la revolución'
    ]);
}

function esConsultaDeActualidad(mensajeLimpio) {
    return textoIncluyeAlguno(mensajeLimpio, [
        'hoy',
        'ayer',
        'ahorita',
        'actual',
        'actualidad',
        'reciente',
        'recientes',
        'ultima',
        'última',
        'ultimo',
        'último',
        'quien gano',
        'quién ganó',
        'resultado',
        'partido de hoy',
        'presidente actual'
    ]);
}

function construirEtiquetaPerfil(perfilAcademico) {
    if (!perfilAcademico || !perfilAcademico.rol) {
        return 'secundaria';
    }

    if (perfilAcademico.rol === 'docente') {
        return perfilAcademico.grado
            ? `docente - ${perfilAcademico.grado}`
            : 'docente';
    }

    if (perfilAcademico.rol === 'primaria') {
        return perfilAcademico.grado
            ? `primaria - ${perfilAcademico.grado}`
            : 'primaria';
    }

    if (perfilAcademico.rol === 'otro') {
        return perfilAcademico.grado
            ? `general - ${perfilAcademico.grado}`
            : 'general';
    }

    return perfilAcademico.grado
        ? `secundaria - ${perfilAcademico.grado}`
        : 'secundaria';
}

function inferirModoAutomatico(mensajeLimpio, modoSolicitado, perfilAcademico, ajusteAlgoritmo, modoManual = false) {
    const base = quitarTildes(mensajeLimpio);

    const pistasEstudio = [
        'tarea',
        'ejercicio',
        'explicame',
        'explica',
        'resuelve',
        'resolv',
        'matemat',
        'biologia',
        'fisica',
        'quimica',
        'ingles',
        'exposicion',
        'oral',
        'practica',
        'simulacro',
        'onem',
        'repaso',
        'ensename',
        'para copiar',
        'resumido'
    ];

    const pistasCreativo = [
        'cuento',
        'poema',
        'cancion',
        'letra',
        'guion',
        'historia',
        'cartel',
        'poster',
        'eslogan',
        'logo',
        'idea creativa',
        'portada'
    ];

    const pistasAnalitico = [
        'analiza',
        'analisis',
        'argumenta',
        'opina',
        'debate',
        'compara',
        'ventajas y desventajas',
        'pros y contras',
        'critica',
        'reflexiona'
    ];

    const pistasPolitico = [
        'revolution',
        'jpii',
        'municipio escolar',
        'personero',
        'regidor',
        'campana escolar',
        'campaña escolar',
        'plan de gobierno',
        'fernando olaya',
        'partido'
    ];

    if (modoSolicitado && ['politico', 'analitico', 'creativo', 'estudio'].includes(modoSolicitado)) {
        if (modoManual) {
            return modoSolicitado;
        }
        if (modoSolicitado !== 'politico') {
            return modoSolicitado;
        }

        if (textoIncluyeAlguno(base, pistasEstudio)) return 'estudio';
        if (textoIncluyeAlguno(base, pistasCreativo)) return 'creativo';
        if (textoIncluyeAlguno(base, pistasAnalitico)) return 'analitico';
        return 'politico';
    }

    if (ajusteAlgoritmo === 'profesor') return 'estudio';
    if (perfilAcademico?.rol === 'docente' && textoIncluyeAlguno(base, pistasEstudio)) return 'estudio';
    if (textoIncluyeAlguno(base, pistasPolitico)) return 'politico';
    if (textoIncluyeAlguno(base, pistasEstudio)) return 'estudio';
    if (textoIncluyeAlguno(base, pistasCreativo)) return 'creativo';
    if (textoIncluyeAlguno(base, pistasAnalitico)) return 'analitico';

    return 'politico';
}

function detectarNecesitaGoogle(mensajeLimpio, ajusteAlgoritmo) {
    const pistas = [
        'busca',
        'buscar',
        'google',
        'internet',
        'web',
        'investiga',
        'noticia',
        'noticias',
        'actual',
        'actuales',
        'actualidad',
        'hoy',
        'reciente',
        'recientes',
        'ultima',
        'última',
        'ultimas',
        'último',
        'ultimo',
        'fuente',
        'fuentes',
        'wikipedia',
        'fecha',
        'quien es',
        'quién es',
        'cuando paso',
        'cuándo pasó',
        'cuanto cuesta',
        'cuánto cuesta',
        'presidente actual',
        'resultado'
    ];

    return textoIncluyeAlguno(mensajeLimpio, pistas) || ajusteAlgoritmo === 'investigador';
}

function detectarPeticionCorta(mensajeLimpio) {
    return textoIncluyeAlguno(mensajeLimpio, [
        'resumido',
        'resumen',
        'corto',
        'cortito',
        'corta',
        'breve',
        'rapido',
        'rápido',
        'al grano',
        'solo la respuesta',
        'solo respuesta',
        'sin mucho texto',
        'maximo 3 lineas',
        'máximo 3 líneas',
        'para copiar',
        'simple'
    ]);
}

function detectarTemaMatematico(mensajeLimpio) {
    const raicesLogicas = [
        'calcul',
        'resolv',
        'resuelv',
        'matemat',
        'ecuacion',
        'fisic',
        'quimic',
        'derivada',
        'integral',
        'problema',
        'cuant',
        'edad',
        'suma',
        'resta',
        'multiplic',
        'divid',
        'fraccion',
        'porcentaje',
        'logic',
        ' pi ',
        'geometria',
        'trigonometria',
        'algoritmo',
        'codigo'
    ];

    const operadoresMates = ['+', '-', '*', '/', '=', '%'];

    return (
        raicesLogicas.some((raiz) => quitarTildes(mensajeLimpio).includes(quitarTildes(raiz))) ||
        operadoresMates.some((op) => (mensajeLimpio || '').includes(op))
    );
}

function detectarRiesgoPsicosocial(mensaje) {
    const texto = quitarTildes((mensaje || '').toLowerCase());

    const patrones = {
        suicidio: [
            'quiero morirme',
            'me quiero morir',
            'no quiero vivir',
            'quitarme la vida',
            'suicid',
            'matarme'
        ],
        autolesion: [
            'hacerme dano',
            'hacerme daño',
            'lastimarme',
            'cortarme',
            'autolesion',
            'autolesionarme'
        ],
        violencia: [
            'pelear',
            'golpear',
            'agredir',
            'amenazar',
            'matar a',
            'romperle la cara'
        ],
        bullying: [
            'bullying',
            'me molestan',
            'me humillan',
            'me acosan',
            'me insultan',
            'se burlan de mi',
            'se burlan de mí'
        ],
        sexual_inapropiado: [
            'desnuda',
            'desnudo',
            'sexo',
            'porno',
            'pack',
            'nudes',
            'tocarme',
            'tocarlo'
        ]
    };

    for (const [categoria, lista] of Object.entries(patrones)) {
        if (lista.some((patron) => texto.includes(quitarTildes(patron)))) {
            return { activar: true, categoria };
        }
    }

    return { activar: false, categoria: null };
}

function construirRespuestaSeguraAlerta(categoria) {
    if (categoria === 'bullying') {
        return 'Capitán, eso suena serio. You are not alone. Si esto está pasando de verdad, busca ahora mismo a un adulto de confianza, tutoría o psicología del colegio. Voy a marcar este caso como alerta para que reciba atención. ¿Estás en un lugar seguro ahora?';
    }

    if (categoria === 'violencia') {
        return 'Capitán, esto requiere atención inmediata. Please stay safe. Si hay riesgo real o alguien puede salir herido, busca ahora mismo a un adulto responsable, tutoría, coordinación o psicología. Voy a marcar este mensaje como alerta para derivación. ¿Hay un adulto cerca contigo?';
    }

    if (categoria === 'sexual_inapropiado') {
        return 'Capitán, ese tema necesita manejo responsable y apoyo de un adulto o del área correspondiente del colegio. Voy a marcarlo como alerta para revisión segura. Si esto te involucra o te incomoda, busca apoyo con un adulto de confianza, tutoría o psicología. ¿Quieres explicarlo de forma más segura y breve?';
    }

    return 'Capitán, lo que escribiste me preocupa. We are with you. No estás solo. Voy a marcar este mensaje como alerta para derivación al área correspondiente del colegio. Busca ahora mismo a un adulto de confianza, tutoría o psicología. ¿Estás acompañado en este momento?';
}

async function guardarMensajeAlerta(datos) {
    if (!firestoreAdmin) return false;

    try {
        await firestoreAdmin.collection('mensajes_alerta').add({
            ...datos,
            timestampServidor: admin.firestore.FieldValue.serverTimestamp()
        });
        return true;
    } catch (error) {
        console.error('Error guardando mensaje de alerta:', error.message || error);
        return false;
    }
}

async function enviarCorreoAlerta(datos) {
    if (!mailTransporter) return false;

    try {
        const html = `
            <h2>🚨 Alerta Fénix</h2>
            <p><strong>Categoría:</strong> ${datos.categoria}</p>
            <p><strong>Nombre:</strong> ${datos.nombre || 'Sin nombre'}</p>
            <p><strong>Email:</strong> ${datos.email || 'Sin email'}</p>
            <p><strong>Perfil:</strong> ${datos.perfil || 'Sin perfil'}</p>
            <p><strong>Modo aplicado:</strong> ${datos.modoAplicado || 'No definido'}</p>
            <p><strong>Mensaje:</strong></p>
            <blockquote>${(datos.mensaje || '').replace(/</g, '&lt;')}</blockquote>
        `;

        await mailTransporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: ADMIN_ALERT_EMAIL,
            subject: `🚨 Fénix alerta: ${datos.categoria}`,
            html
        });

        return true;
    } catch (error) {
        console.error('Error enviando correo de alerta:', error.message || error);
        return false;
    }
}

async function guardarFeedback(datos) {
    if (!firestoreAdmin) return false;

    try {
        await firestoreAdmin.collection('feedback_fenix').add({
            ...datos,
            timestampServidor: admin.firestore.FieldValue.serverTimestamp()
        });
        return true;
    } catch (error) {
        console.error('Error guardando feedback:', error.message || error);
        return false;
    }
}

function postProcesarRespuesta(textoIA, mensajeLimpio, ajusteAlgoritmo, modoAplicado) {
    let texto = (textoIA || '').trim();
    if (!texto) return texto;

    const quiereBreve = detectarPeticionCorta(mensajeLimpio) || ajusteAlgoritmo === 'breve';
    const creativo = modoAplicado === 'creativo' || esTareaCreativa(mensajeLimpio);

    texto = texto
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/([A-Za-z])\/n\/([A-Za-z])/g, '$1 $2')
        .trim();

    const tomarHastaPuntuacion = (base, maxPalabras) => {
        const palabras = limpiarTexto(base).split(' ').filter(Boolean);
        if (palabras.length <= maxPalabras) return base.trim();

        const recorte = palabras.slice(0, maxPalabras + 15).join(' ');
        const idx = Math.max(
            recorte.lastIndexOf('. '),
            recorte.lastIndexOf('! '),
            recorte.lastIndexOf('? '),
            recorte.lastIndexOf(': ')
        );

        if (idx > 40) {
            return recorte.slice(0, idx + 1).trim();
        }

        return palabras.slice(0, maxPalabras).join(' ').trim();
    };

    if (quiereBreve) {
        texto = tomarHastaPuntuacion(texto, 85);
    } else if (!creativo && contarPalabras(texto) > 210) {
        texto = tomarHastaPuntuacion(texto, 180);
    }

    if (!/[.!?…:]$/.test(texto) && contarPalabras(texto) > 12) {
        const idx = Math.max(
            texto.lastIndexOf('.'),
            texto.lastIndexOf('!'),
            texto.lastIndexOf('?'),
            texto.lastIndexOf(':')
        );
        if (idx > 40) {
            texto = texto.slice(0, idx + 1).trim();
        }
    }

    return texto;
}

// ======================================================================
// CONTEXTO DE MARCA, IDIOMA Y SUTILEZAS
// ======================================================================
const diccionarioLocal = `
CONTEXTO DE LENGUAJE Y CULTURA:
- Entiende jerga escolar y local sin exagerar: "profe", "auxi", "kiosko", "recreo", "al toque", "chévere", "piola", "palteado", "me fui en blanco", "hazlo cortito".
- Si el estudiante escribe rápido, con errores o frases incompletas, intenta entender la intención antes de pedir aclaración.
- Si detectas sarcasmo, ironía suave o broma, responde con inteligencia y tacto. No tomes todo literal.
- Si el estudiante pide "para exponer", da un formato oral breve y claro.
- Si pide "para copiar", entrega una versión limpia y lista para usar.
- Colegio bilingüe: cuando encaje de forma natural, puedes insertar 1 o 2 palabras cortas en inglés para reforzar el ambiente bilingual, sin volver la respuesta Spanglish exagerado.
`;

const frasesImpacto = [
    'Es hora de cambiar al mundo.',
    'La Revolución acaba de comenzar.',
    'Ser joven y no ser revolucionario es una contradicción hasta biológica.',
    'Bienvenido al futuro del JPII.',
    'Todo imperio inició con un primer paso.',
    'La grandeza no se arrebata, se conquista.'
];

// ======================================================================
// MEMORIA INAMOVIBLE: EL PLAN DE GOBIERNO COMPLETO Y DETALLADO
// ======================================================================
const memoriaBase = `
EQUIPO DE GOBIERNO (PLANCHA OFICIAL RJPII):
- Alcalde: Fernando Olaya
- Personero General: Leonel (Leo)
- Regidor de Educación, Cultura y Deporte: Edwin
- Regidor de Comunicación y Tecnología: Kenneth
- Regidor de Emprendimiento y Actividades Productivas: Racek
- Regidora de Salud y Medio Ambiente: Mia
- Regidora de Derechos del Niño(a) y Adolescente: Rafaella

ESTÁS EN MODO CAMPAÑA Y TU OBJETIVO ES PROMOVER NUESTROS VALORES:
Ama Sua (No robes), Ama Lulla (No mientas), Ama Quella (No seas flojo)

PLAN DE GOBIERNO OFICIAL DETALLADO:
EJE 1 (Educación, Cultura y Deporte - Regidor Edwin):
- Campus Bilingüe Interactivo: Códigos QR en el colegio para resolver acertijos en inglés; los alumnos ganan "Puntos Fénix".
- Red de Clubes "GENIUS": Alumnos destacados enseñan a sus compañeros (ajedrez, oratoria, programación) usando recursos del colegio.
- Proyecto "Mente Maestra": Centro oficial de Ajedrez financiado al 100% por The Green Squad (reciclaje), costo cero para Dirección.
- Reforma del Aniversario y Cultura: El Municipio co-organizará las fiestas. Habrá Exposiciones de Arte y un Gran Concierto de Gala.
- Deporte: Fondo Deportivo Fénix (compra de balones con dinero del reciclaje), Liga Fénix Pro (torneos largos), Juegos Olímpicos JPII (uso de piscina y gimnasio) y Clínicas Deportivas con entrenadores invitados.

EJE 2 (Comunicación y Tecnología - Regidor Kenneth):
- Plataforma IA FÉNIX: Asistente virtual institucional.
- La Voz Juanpablina: Radio escolar en formato podcast/streaming.
- Fénix Lab y PWA: Aplicación web "Fénix News" para mantener informados a todos.
- Alianza WOW Perú: Gestión para mejorar la fibra óptica del colegio.

EJE 3 (Emprendimiento - Regidor Racek):
- Feria INNOVA JPII (Formato Eureka): Presentación de proyectos y apps en el auditorio.
- Incubadora de Talentos: Masterclasses de IA y marketing con entrada simbólica.
- Agencia de Diseño JPII: Creación de logos para padres de familia a cambio de donaciones para el partido.

EJE 4 (Salud y Medio Ambiente - Regidora Mia):
- The Green Squad: Inicial cuida plantas, Primaria llena la botella ECHO gigante, Secundaria gestiona la logística de reciclaje.
- La Gran Papelatón: Venta de cuadernos viejos para comprar Ecotachos estéticos para el colegio.
- Eco-Monedas Fénix: Salones que más reciclan ganan privilegios (ej. elegir música en los recreos).

EJE 5 (Derechos del Niño - Regidora Rafaella):
- Alianza "Ley y Orden": Charlas anti-bullying con el Juez de Paz Estudiantil.
- Programa "Hermano Mayor Fénix": Alumnos mayores apadrinan y cuidan a salones de primaria en los recreos.
- Buzón de Confianza Híbrido: Físico para primaria y digital anónimo para secundaria.

PROYECTO ESPECIAL (Alcalde Fernando):
- El Muro de la Revolución: Mural con las huellas de las manos de los estudiantes (ningún nombre de la directiva aparecerá).
- Financiamiento total: Autogestión limpia con The Green Squad, Liga Fénix y Agencia de Diseño. Cero falsas promesas.
`;


const memoriaBaseCompacta = `
PLAN REVOLUTION JPII EN RESUMEN:
- 5 ejes: Educación/Cultura/Deporte, Comunicación/Tecnología, Emprendimiento, Salud/Medio Ambiente y Derechos del Niño.
- Por defecto responde con ejes e ideas principales. Solo entra en detalle si el usuario lo pide.
`;

const diccionarioLocalCompacto = `
LENGUAJE Y ESTILO:
- Entiende jerga escolar/local y errores comunes.
- Si piden corto, simple o para copiar, responde así.
- Usa inglés breve solo si encaja natural.
`;

function detectarPeticionDetallada(mensajeLimpio) {
    return textoIncluyeAlguno(mensajeLimpio, [
        'detall',
        'detalle',
        'eje por eje',
        'explica completo',
        'completo',
        'desarrolla',
        'desarróll',
        'para exponer',
        'guion',
        'discurso'
    ]);
}

function compactarHistorialParaPrompt(historial, maxCharsPorMensaje = 180) {
    return (historial || []).map((msg) => ({
        emisor: msg.emisor,
        texto: limpiarTexto(msg.texto || '').slice(0, maxCharsPorMensaje)
    }));
}

function obtenerMaxTokensSalida({ archivoBase64, peticionCorta, detallado, modoAplicado, esCreativeTask }) {
    if (archivoBase64) return 360;
    if (peticionCorta) return 220;
    if (esCreativeTask || modoAplicado === 'creativo') return detallado ? 700 : 460;
    if (modoAplicado === 'estudio') return detallado ? 780 : 420;
    if (modoAplicado === 'analitico') return detallado ? 700 : 420;
    return detallado ? 620 : 360;
}

function esTareaCreativa(mensajeLimpio) {
    return textoIncluyeAlguno(mensajeLimpio, [
        'historia',
        'cuento',
        'poema',
        'guion',
        'parrafo',
        'párrafo',
        'titulo',
        'título',
        'eslogan',
        'cartel',
        'parodia',
        'cancion',
        'canción',
        'introduccion',
        'introducción'
    ]);
}

function seleccionarModelosNvidia(modoAplicado, mensajeLimpio) {
    const esCodigoOEstructura = textoIncluyeAlguno(mensajeLimpio, [
        'codigo', 'código', 'programa', 'script', 'json', 'html', 'css', 'flutter',
        'clase', 'sesion', 'sesión', 'rubrica', 'rúbrica', 'estructura', 'formato'
    ]);
    const esMateORazonamiento = detectarTemaMatematico(mensajeLimpio) || textoIncluyeAlguno(mensajeLimpio, [
        'razonamiento', 'geometria', 'geometría', 'algebra', 'álgebra', 'angulo', 'ángulo'
    ]);

    const porId = (id) => MODELOS_NVIDIA.find((m) => m.id === id);
    const deepseek = porId('deepseek-ai/deepseek-r1');
    const qwen = porId('qwen/qwen2.5-coder-32b-instruct');
    const llama = porId('meta/llama-3.1-70b-instruct');

    if (esMateORazonamiento || modoAplicado === 'estudio') {
        return [deepseek, qwen, llama].filter(Boolean);
    }

    if (esCodigoOEstructura || modoAplicado === 'analitico') {
        return [qwen, deepseek, llama].filter(Boolean);
    }

    if (modoAplicado === 'creativo' || modoAplicado === 'politico') {
        return [llama, qwen, deepseek].filter(Boolean);
    }

    return [llama, deepseek, qwen].filter(Boolean);
}

function construirInstruccionNvidia({ modoAplicado, peticionCorta, peticionDetallada, esCreativeTask, mensajeLimpio }) {
    const base = [];
    base.push('Responde en español claro y natural.');
    base.push('No cortes la respuesta a la mitad.');
    base.push('No inventes datos externos ni resultados en tiempo real.');
    base.push('Si el usuario pide algo de hoy, actual o con fuente y no tienes verificación web activa, dilo con honestidad.');

    if (peticionCorta) {
        base.push('El usuario pidió brevedad. Máximo enfoque, mínimo relleno.');
    }

    if (modoAplicado === 'estudio') {
        base.push('Actúa como tutor moderno: si es simple, respuesta + explicación breve; si es complejo, solo pasos esenciales.');
    } else if (modoAplicado === 'analitico') {
        base.push('Analiza con precisión, estructura y lógica.');
    } else if (modoAplicado === 'creativo') {
        base.push('Sé memorable y creativo, pero mantén claridad y no te extiendas de más.');
    } else {
        base.push('Mantén el gancho de Revolution JPII solo si encaja de forma natural.');
    }

    if (esCreativeTask) {
        base.push('Si el usuario pide historia, cuento, título o párrafos, entrega el texto completo en una sola respuesta, sin dejar frases inconclusas.');
    }

    if (mensajeLimpio.includes('plan de gobierno') && !peticionDetallada) {
        base.push('Si piden el plan de gobierno sin pedir detalle, da 5 ejes con 1 idea principal por eje.');
    }

    return base.join(' ');
}

// ======================================================================
// ENDPOINT PRINCIPAL DE CHAT
// ======================================================================
app.post('/api/chat', async (req, res) => {
    try {
        if (!MODELOS_NVIDIA.some((m) => m.key) && LLAVES_GEMINI.length === 0) {
            return res.status(500).json({
                error: '⚠️ Error de Servidor: No hay motores IA configurados.'
            });
        }

        const {
            mensaje,
            archivoBase64,
            mimeType,
            temperamento,
            historial,
            generarTitulo,
            modo,
            configMemoria,
            primerMensajeUsuario,
            perfilAcademico,
            ajusteAlgoritmo,
            userMeta,
            preferenciasUsuario,
            busquedaProfunda,
            modoManual
        } = req.body;

        const mensajeSeguro = limpiarTexto(mensaje);
        const mensajeLimpio = mensajeSeguro.toLowerCase();

        let tituloNuevo = null;
        if (generarTitulo) {
            tituloNuevo = crearTituloDesdePrimerMensaje(primerMensajeUsuario || mensajeSeguro);
        }

        const riesgo = detectarRiesgoPsicosocial(mensajeSeguro);
        const modoAplicado = inferirModoAutomatico(
            mensajeLimpio,
            modo || temperamento,
            perfilAcademico,
            ajusteAlgoritmo,
            !!modoManual
        );

        const peticionCorta = detectarPeticionCorta(mensajeLimpio);
        const peticionDetallada = detectarPeticionDetallada(mensajeLimpio);

        if (riesgo.activar) {
            const perfilTexto = construirEtiquetaPerfil(perfilAcademico);
            const datosAlerta = {
                categoria: riesgo.categoria,
                mensaje: mensajeSeguro,
                nombre: userMeta?.nombre || userMeta?.displayName || '',
                email: userMeta?.email || '',
                perfil: perfilTexto,
                grado: perfilAcademico?.grado || '',
                rol: perfilAcademico?.rol || '',
                modoAplicado
            };

            const guardado = await guardarMensajeAlerta(datosAlerta);
            const correo = await enviarCorreoAlerta(datosAlerta);

            return res.json({
                respuesta: construirRespuestaSeguraAlerta(riesgo.categoria),
                tituloNuevo,
                modoAplicado: 'alerta',
                alerta: {
                    activada: true,
                    categoria: riesgo.categoria,
                    guardado,
                    correo
                }
            });
        }

        const usarMemoriaCompleta = necesitaMemoriaCompleta(mensajeLimpio) || peticionDetallada;
        const bloqueMemoriaBase = usarMemoriaCompleta ? memoriaBase : memoriaBaseCompacta;
        const bloqueDiccionario = usarMemoriaCompleta ? diccionarioLocal : diccionarioLocalCompacto;

        let promptDinamico =
            `Eres Fénix, la IA oficial de "Revolution JPII" ` +
            `(el movimiento revolucionario del Colegio Juan Pablo II). ` +
            `Tu misión es ayudar, orientar y convencer con inteligencia, utilidad real y contexto humano.\n\n` +
            `${bloqueMemoriaBase}\n\n` +
            `${bloqueDiccionario}\n\n`;

        if (modoAplicado === 'estudio') {
            promptDinamico += `ESTÁS EN MODO ESTUDIO.
Actúas como un excelente tutor moderno. Primero entiendes el nivel del estudiante y luego respondes con claridad y economía de palabras. Si el ejercicio es simple, responde en 2 a 5 líneas. Si es complejo, usa solo los pasos esenciales. Solo desarrolla mucho si el usuario lo pide.`;
        } else if (modoAplicado === 'analitico') {
            promptDinamico += `ESTÁS EN MODO ANALÍTICO.
Eres calculador, objetivo y estratégico. Analizas con precisión, comparas y argumentas bien. Cero emojis salvo que ayuden muchísimo.`;
        } else if (modoAplicado === 'creativo') {
            promptDinamico += `ESTÁS EN MODO CREATIVO.
Eres ingenioso, visual y memorable. Puedes usar metáforas, frases épicas y un toque artístico, pero sin perder claridad.`;
        } else {
            promptDinamico += `ESTÁS EN MODO POLÍTICO.
Eres un compañero empático, leal e inspirador. Debes sembrar interés por Revolution JPII de manera natural, sin sonar forzado. Puedes usar frases potentes como: ${frasesImpacto.join(' | ')}`;
        }

        promptDinamico += `

REGLAS DE ORO INQUEBRANTABLES:
0. Si el usuario aclara el contexto, esa aclaración manda.
1. Sobre la campaña escolar, usa solo el Plan de Gobierno. Sobre temas externos, usa conocimiento general y web cuando haga falta.
2. Sé breve por defecto. Si el usuario pide corto, resumido, simple o para copiar, responde con máxima síntesis.
3. Adáptate automáticamente al perfil, grado y tipo de mensaje.
4. Usa toques de inglés solo si encajan natural y ayudan.
5. Mantén el gancho político solo cuando encaje; nunca lo fuerces.
6. No repitas saludos ni cierres y da una sola respuesta coherente.`;

        if (configMemoria === 'corta') {
            promptDinamico += `\nMEMORIA ACTIVA: CORTA. Usa solo el contexto más reciente y no arrastres temas viejos si no aportan.`;
        } else if (configMemoria === 'profunda') {
            promptDinamico += `\nMEMORIA ACTIVA: PROFUNDA. Conecta el mensaje actual con el historial reciente del estudiante para dar continuidad y contexto.`;
        } else {
            promptDinamico += `\nMEMORIA ACTIVA: NORMAL. Usa el historial reciente solo cuando mejore claridad y coherencia.`;
        }

        const perfilTexto = construirEtiquetaPerfil(perfilAcademico);
        promptDinamico += `\nPERFIL ACADÉMICO DEL USUARIO: ${perfilTexto}. Ajusta dificultad, vocabulario y profundidad a ese nivel.`;

        if (ajusteAlgoritmo === 'breve') {
            promptDinamico += `\nAJUSTE DE ALGORITMO: ULTRA BREVE. Prioriza respuestas cortas, claras y de bajo consumo de tokens.`;
        } else if (ajusteAlgoritmo === 'profesor') {
            promptDinamico += `\nAJUSTE DE ALGORITMO: TUTOR GUIADO. Explica como un gran docente moderno, con claridad, pasos útiles y sin relleno.`;
        } else if (ajusteAlgoritmo === 'investigador') {
            promptDinamico += `\nAJUSTE DE ALGORITMO: INVESTIGADOR. Si el usuario pide actualidad, noticias, fuentes o búsqueda, prioriza la web y evidencia reciente.`;
        } else {
            promptDinamico += `\nAJUSTE DE ALGORITMO: EQUILIBRADO. Responde natural, claro y con buena síntesis.`;
        }

        if (peticionCorta) {
            promptDinamico += `\nPETICIÓN ESPECIAL: RESPUESTA CORTA. Máximo enfoque, mínimo relleno.`;
        }

        if (mensajeLimpio.includes('plan de gobierno') && !peticionDetallada) {
            promptDinamico += `\nSI EL USUARIO PIDE EL PLAN DE GOBIERNO Y NO PIDE DETALLE, responde con 5 ejes + 1 idea principal por eje. Máximo 120 palabras salvo que pida ampliar.`;
        }

        let contextoConversacion = promptDinamico;
        const historialCompacto = compactarHistorialParaPrompt(historial, configMemoria === 'profunda' ? 220 : 160);

        if (historialCompacto && historialCompacto.length > 0) {
            contextoConversacion += '\n\n--- HISTORIAL DE ESTA CONVERSACIÓN (MEMORIA) ---\n';
            historialCompacto.forEach((msg) => {
                contextoConversacion += `${msg.emisor === 'user' ? 'Estudiante' : 'Fénix'}: ${msg.texto}\n`;
            });
            contextoConversacion += '----------------------------------------------\n';
        }

        const fechaHoraPeru = obtenerFechaHoraPeru();
        contextoConversacion += `\nINSTRUCCIÓN FINAL: Markdown solo cuando ayude. Responde claro, corto y útil por defecto. Nunca cortes la respuesta a la mitad. Fecha y hora actual de referencia en Perú: ${fechaHoraPeru}. Si preguntan por algo "de hoy", "ayer", "actual" o "quién ganó", usa esta referencia temporal y prioriza búsqueda web.`;

        const requiereNvidia = detectarTemaMatematico(mensajeLimpio);
        const requiereGoogle =
            detectarNecesitaGoogle(mensajeLimpio, ajusteAlgoritmo) ||
            esConsultaDeActualidad(mensajeLimpio) ||
            !!busquedaProfunda;

        const esCreativeTask = esTareaCreativa(mensajeLimpio);
        const usarGeminiVisual = !!archivoBase64;
        let textoIA = '';
        let nvidiaTuvoExito = false;
        let motorUsado = 'nvidia';
        let ultimoErrorNvidia = null;

        const cacheKey = crearClaveCache({
            mensaje: mensajeSeguro,
            modoAplicado,
            algoritmo: ajusteAlgoritmo,
            perfil: perfilTexto,
            archivo: !!archivoBase64
        });

        if (!usarGeminiVisual && !requiereGoogle) {
            const cache = obtenerCache(cacheKey);
            if (cache) {
                return res.json({
                    ...cache,
                    cacheHit: true
                });
            }
        }

        // ======================================================================
        // RUTA 1: NVIDIA (TEXTO POR DEFECTO)
        // DeepSeek: estudio/razonamiento
        // Qwen: estructura/código/clases
        // Llama: conversación, creativo y político
        // ======================================================================
        if (!usarGeminiVisual) {
            const modelosOrdenados = seleccionarModelosNvidia(modoAplicado, mensajeLimpio);
            const instruccionExtra = construirInstruccionNvidia({
                modoAplicado,
                peticionCorta,
                peticionDetallada,
                esCreativeTask,
                mensajeLimpio
            });

            for (let i = 0; i < modelosOrdenados.length; i++) {
                const modeloNvidia = modelosOrdenados[i];

                if (!modeloNvidia?.key) {
                    continue;
                }

                try {
                    const respuestaNvidia = await fetch(
                        'https://integrate.api.nvidia.com/v1/chat/completions',
                        {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${modeloNvidia.key}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                model: modeloNvidia.id,
                                messages: [
                                    {
                                        role: 'system',
                                        content: contextoConversacion + '\n\nINSTRUCCIÓN EXTRA: ' + instruccionExtra
                                    },
                                    {
                                        role: 'user',
                                        content: esConsultaDeActualidad(mensajeLimpio) && !busquedaProfunda
                                            ? `Si no puedes verificar en vivo, dilo con honestidad. Fecha actual de referencia en Perú: ${fechaHoraPeru}. Mensaje: ${mensajeSeguro}`
                                            : mensajeSeguro
                                    }
                                ],
                                temperature:
                                    modoAplicado === 'analitico' || modoAplicado === 'estudio'
                                        ? 0.2
                                        : modoAplicado === 'creativo'
                                            ? 0.55
                                            : 0.35,
                                max_tokens: obtenerMaxTokensSalida({
                                    archivoBase64,
                                    peticionCorta,
                                    detallado: peticionDetallada,
                                    modoAplicado,
                                    esCreativeTask
                                })
                            })
                        }
                    );

                    const datosNvidia = await respuestaNvidia.json();

                    if (
                        datosNvidia.choices &&
                        datosNvidia.choices[0] &&
                        datosNvidia.choices[0].message &&
                        datosNvidia.choices[0].message.content
                    ) {
                        textoIA = datosNvidia.choices[0].message.content;
                        nvidiaTuvoExito = true;
                        const shortModel = modeloNvidia.id.split('/')[0];
                        motorUsado = `nvidia:${shortModel}`;
                        break;
                    }

                    ultimoErrorNvidia = datosNvidia?.error || 'NVIDIA sin contenido útil.';
                } catch (errorNvidia) {
                    ultimoErrorNvidia = errorNvidia;
                    console.warn('NVIDIA falló con', modeloNvidia.id, errorNvidia?.message || errorNvidia);
                }
            }
        }

        // ======================================================================
        // RUTA 2: GEMINI (SOLO IMÁGENES/ARCHIVOS y búsqueda profunda explícita)
        // ======================================================================
        if (!nvidiaTuvoExito && (usarGeminiVisual || !!busquedaProfunda)) {
            let intentoExitosoGemini = false;
            let intentosRealizados = 0;
            let ultimoErrorGemini = null;

            const inicioRotacion = indiceLlaveGemini;
            indiceLlaveGemini = (indiceLlaveGemini + 1) % Math.max(LLAVES_GEMINI.length, 1);

            while (!intentoExitosoGemini && intentosRealizados < LLAVES_GEMINI.length) {
                const indiceActual = (inicioRotacion + intentosRealizados) % LLAVES_GEMINI.length;

                if (!llaveGeminiDisponible(indiceActual)) {
                    intentosRealizados++;
                    continue;
                }

                const llaveActual = LLAVES_GEMINI[indiceActual];

                try {
                    const genAI = new GoogleGenerativeAI(llaveActual);

                    const modelConfig = {
                        model: 'gemini-2.5-flash',
                        systemInstruction: contextoConversacion,
                        generationConfig: {
                            maxOutputTokens: obtenerMaxTokensSalida({
                                archivoBase64,
                                peticionCorta,
                                detallado: peticionDetallada,
                                modoAplicado,
                                esCreativeTask
                            }),
                            temperature: ajusteAlgoritmo === 'breve' ? 0.2 : 0.3
                        }
                    };

                    if (!!busquedaProfunda && !archivoBase64) {
                        modelConfig.tools = [{ googleSearch: {} }];
                    }

                    const model = genAI.getGenerativeModel(modelConfig);

                    let result;

                    if (archivoBase64) {
                        const partes = [
                            {
                                text:
                                    'Analiza el archivo adjunto. Primero extrae el texto visible o el enunciado exacto. Si es una pregunta de matemáticas o razonamiento, resuélvela completa. Si el usuario pide solo la clave, solo da la alternativa. Si pide explicación breve, da respuesta + explicación breve. Mensaje actual: ' +
                                    (mensajeSeguro || '¿Qué ves aquí?')
                            },
                            {
                                inlineData: {
                                    data: archivoBase64.split(',')[1],
                                    mimeType: mimeType
                                }
                            }
                        ];

                        result = await model.generateContent(partes);
                        motorUsado = 'gemini:vision';
                    } else {
                        result = await model.generateContent(`Fecha actual en Perú: ${fechaHoraPeru}. Mensaje del estudiante: ${mensajeSeguro}`);
                        motorUsado = 'gemini:deep-search';
                    }

                    textoIA = result.response.text();
                    intentoExitosoGemini = true;
                } catch (errorGemini) {
                    ultimoErrorGemini = errorGemini;
                    const textoError = (errorGemini?.message || errorGemini || '').toString();
                    const retryMs = extraerRetryMs(errorGemini);
                    const esCuota = /429|quota exceeded|too many requests/i.test(textoError);

                    console.error(
                        `Gemini falló con la llave #${indiceActual + 1}:`,
                        errorGemini?.message || errorGemini
                    );

                    if (esCuota) {
                        if (esCuotaDiariaGemini(errorGemini)) {
                            bloquearLlaveGemini(indiceActual, msHastaMedianochePeru(), 'cuota diaria');
                        } else {
                            bloquearLlaveGemini(indiceActual, Math.max(retryMs, 20 * 60 * 1000), 'cuota temporal');
                        }
                    }

                    intentosRealizados++;
                }
            }

            if (!intentoExitosoGemini && !nvidiaTuvoExito) {
                if (usarGeminiVisual) {
                    throw new Error(
                        `No se pudo procesar el archivo con Gemini. Último error: ${ultimoErrorGemini?.message || ultimoErrorGemini}`
                    );
                }

                throw new Error(
                    `Fallaron NVIDIA y Gemini deep search. Último error Gemini: ${ultimoErrorGemini?.message || ultimoErrorGemini}`
                );
            }
        }

        if (!textoIA && !nvidiaTuvoExito) {
            const detalle = ultimoErrorNvidia?.message || ultimoErrorNvidia || '';
            throw new Error(`No hubo respuesta útil de NVIDIA. ${detalle}`);
        }

        textoIA = postProcesarRespuesta(textoIA, mensajeLimpio, ajusteAlgoritmo, modoAplicado);

        const respuestaPayload = {
            respuesta: textoIA,
            tituloNuevo,
            modoAplicado,
            requiereGoogle: !!busquedaProfunda,
            motor: motorUsado,
            alerta: {
                activada: false
            }
        };

        if (!usarGeminiVisual && !requiereGoogle) {
            guardarCache(cacheKey, respuestaPayload, esConsultaDeActualidad(mensajeLimpio) ? 60 * 1000 : 10 * 60 * 1000);
        }

        return res.json(respuestaPayload);
    } catch (error) {
        console.error('Error Núcleo:', error);

        return res.status(500).json({
            error: '¡Uf! Mis circuitos están saturados. 🔌 Dame unos segundos y vuelve a intentarlo.'
        });
    }
});

// ======================================================================
// FEEDBACK HUMANO (LIKES / DISLIKES / MOTIVO / CORRECCIÓN)
// ======================================================================
app.post('/api/feedback', async (req, res) => {
    try {
        const {
            tipo,
            motivo,
            correccion,
            mensajeUsuario,
            respuestaIA,
            userMeta,
            perfilAcademico,
            modoAplicado,
            algoritmo
        } = req.body || {};

        const guardado = await guardarFeedback({
            tipo: tipo || 'sin_tipo',
            motivo: motivo || '',
            correccion: correccion || '',
            mensajeUsuario: mensajeUsuario || '',
            respuestaIA: respuestaIA || '',
            nombre: userMeta?.nombre || userMeta?.displayName || '',
            email: userMeta?.email || '',
            perfil: construirEtiquetaPerfil(perfilAcademico),
            modoAplicado: modoAplicado || '',
            algoritmo: algoritmo || ''
        });

        return res.json({
            ok: true,
            guardado
        });
    } catch (error) {
        console.error('Error feedback:', error);
        return res.status(500).json({
            ok: false,
            error: 'No se pudo guardar el feedback.'
        });
    }
});

// ======================================================================
// RESUMEN ADMIN SIMPLE (PANEL ADMIN FUTURO)
// ======================================================================
app.get('/api/admin/resumen', async (req, res) => {
    try {
        const adminEmailRecibido = (req.headers['x-admin-email'] || req.query.email || '').toString().toLowerCase();
        if (ADMIN_ALERT_EMAIL && adminEmailRecibido && adminEmailRecibido !== ADMIN_ALERT_EMAIL.toLowerCase()) {
            return res.status(403).json({ ok: false, mensaje: 'No autorizado.' });
        }

        if (!firestoreAdmin) {
            return res.json({
                ok: false,
                mensaje: 'Firebase Admin no configurado en el servidor.'
            });
        }

        const [alertasSnap, feedbackSnap] = await Promise.all([
            firestoreAdmin.collection('mensajes_alerta').orderBy('timestampServidor', 'desc').limit(20).get(),
            firestoreAdmin.collection('feedback_fenix').orderBy('timestampServidor', 'desc').limit(20).get()
        ]);

        const alertas = alertasSnap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data()
        }));

        const feedback = feedbackSnap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data()
        }));

        return res.json({
            ok: true,
            estado: 'Online',
            kpis: {
                alertas: alertas.length,
                feedback: feedback.length,
                chats: 0
            },
            logs: [
                ...alertas.slice(0, 6).map((a) => ({ titulo: 'Alerta', detalle: `${a.categoria || 'general'} · ${(a.nombre || a.email || 'Sin nombre')} · ${(a.mensaje || '').slice(0, 120)}` })),
                ...feedback.slice(0, 6).map((f) => ({ titulo: 'Feedback', detalle: `${f.tipo || 'sin tipo'} · ${f.motivo || 'sin motivo'}` }))
            ],
            alertas,
            feedback
        });
    } catch (error) {
        console.error('Error admin resumen:', error);
        return res.status(500).json({
            ok: false,
            error: 'No se pudo obtener el resumen admin.'
        });
    }
});

app.listen(PUERTO, () => {
    console.log(`🦅 FÉNIX OPERATIVO EN PUERTO ${PUERTO}`);
});
