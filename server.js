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

function inferirModoAutomatico(mensajeLimpio, modoSolicitado, perfilAcademico, ajusteAlgoritmo) {
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

    if (!texto) {
        return texto;
    }

    const quiereBreve = detectarPeticionCorta(mensajeLimpio) || ajusteAlgoritmo === 'breve';

    texto = texto
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+\n/g, '\n')
        .trim();

    if (quiereBreve && contarPalabras(texto) > 90) {
        const lineas = texto
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 4);

        texto = lineas.join('\n');
    } else if (!quiereBreve && modoAplicado !== 'creativo' && contarPalabras(texto) > 220) {
        const lineas = texto
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 8);

        texto = lineas.join('\n');
    }

    if (modoAplicado !== 'creativo') {
        texto = texto.replace(/([A-Za-z])\/n\/([A-Za-z])/g, '$1 $2');
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
- Idea central: mejorar el colegio con tecnología, reciclaje, clubes, deporte, emprendimiento y bienestar estudiantil.
- Fénix IA forma parte del eje de Comunicación y Tecnología.
- Si preguntan por el plan, por defecto responde con ejes e ideas principales. Solo entra en detalle si el usuario pide "detállalo", "eje por eje", "completo", "para exponer" o algo similar.
`;

const diccionarioLocalCompacto = `
LENGUAJE Y ESTILO:
- Entiende jerga escolar/local y errores comunes sin pedir aclaración innecesaria.
- Si el usuario pide corto, simple, para copiar o al grano, responde así.
- Colegio bilingüe: usa toques cortos de inglés solo cuando encaje natural.
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

function obtenerMaxTokensSalida({ archivoBase64, peticionCorta, detallado, requiereGoogle }) {
    if (archivoBase64) return 260;
    if (peticionCorta) return requiereGoogle ? 320 : 220;
    if (detallado) return requiereGoogle ? 820 : 680;
    return requiereGoogle ? 520 : 420;
}

// ======================================================================
// ENDPOINT PRINCIPAL DE CHAT
// ======================================================================
app.post('/api/chat', async (req, res) => {
    try {
        if (LLAVES_GEMINI.length === 0) {
            return res.status(500).json({
                error: '⚠️ Error de Servidor: Las llaves Gemini no están configuradas.'
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
            busquedaProfunda
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
            ajusteAlgoritmo
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

        let textoIA = '';
        let nvidiaTuvoExito = false;

        const requiereRutaNvidia =
            requiereNvidia &&
            !archivoBase64 &&
            !requiereGoogle;

        // ======================================================================
        // RUTA 1: NVIDIA (MATEMÁTICAS + ESTUDIO)
        // ======================================================================
        if (requiereRutaNvidia) {
            const modelosOrdenados =
                modoAplicado === 'estudio'
                    ? [
                          MODELOS_NVIDIA.find((m) => m.id === 'deepseek-ai/deepseek-r1'),
                          MODELOS_NVIDIA.find((m) => m.id === 'meta/llama-3.1-70b-instruct'),
                          MODELOS_NVIDIA.find((m) => m.id === 'qwen/qwen2.5-coder-32b-instruct')
                      ].filter(Boolean)
                    : MODELOS_NVIDIA;

            for (let i = 0; i < modelosOrdenados.length; i++) {
                const modeloNvidia = modelosOrdenados[i];

                if (!modeloNvidia?.key) {
                    continue;
                }

                try {
                    const instruccionExtra =
                        modoAplicado === 'estudio'
                            ? 'Explica como tutor experto, pero con máxima economía de palabras. Si el ejercicio es simple, da solo respuesta y explicación breve. Si es complejo, usa únicamente pasos esenciales. No agregues ejemplo extra ni mini práctica final salvo que el usuario lo pida.'
                            : 'Resuelve de forma clara y breve. Si el problema es simple, da resultado y pasos mínimos. Si es complejo, explica solo lo necesario.';

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
                                        content: mensajeSeguro
                                    }
                                ],
                                temperature:
                                    modoAplicado === 'analitico' || modoAplicado === 'estudio'
                                        ? 0.2
                                        : 0.4,
                                max_tokens: obtenerMaxTokensSalida({ archivoBase64, peticionCorta, detallado: peticionDetallada, requiereGoogle })
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
                        break;
                    }
                } catch (errorNvidia) {
                    console.warn('NVIDIA falló con', modeloNvidia.id, errorNvidia?.message || errorNvidia);
                }
            }
        }

        // ======================================================================
        // RUTA 2: GEMINI (CHARLA, CAMPAÑA, WEB, IMÁGENES, RESPALDO GENERAL)
        // ======================================================================
        if (!nvidiaTuvoExito) {
            let intentoExitosoGemini = false;
            let intentosRealizados = 0;
            let ultimoErrorGemini = null;

            while (!intentoExitosoGemini && intentosRealizados < LLAVES_GEMINI.length) {
                const llaveActual = LLAVES_GEMINI[indiceLlaveGemini];

                try {
                    const genAI = new GoogleGenerativeAI(llaveActual);

                    const modelConfig = {
                        model: 'gemini-2.5-flash',
                        systemInstruction: contextoConversacion,
                        generationConfig: {
                            maxOutputTokens: obtenerMaxTokensSalida({ archivoBase64, peticionCorta, detallado: peticionDetallada, requiereGoogle }),
                            temperature: ajusteAlgoritmo === 'breve' ? 0.2 : 0.3
                        }
                    };

                    if (requiereGoogle && !archivoBase64) {
                        modelConfig.tools = [{ googleSearch: {} }];
                    }

                    const model = genAI.getGenerativeModel(modelConfig);

                    let result;

                    if (archivoBase64) {
                        const partes = [
                            {
                                text:
                                    'Analiza la imagen o QR adjunto y responde de forma clara y breve. Mensaje: ' +
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
                    } else {
                        result = await model.generateContent(`Fecha actual en Perú: ${fechaHoraPeru}. Mensaje del estudiante: ${mensajeSeguro}`);
                    }

                    textoIA = result.response.text();
                    intentoExitosoGemini = true;
                } catch (errorGemini) {
                    ultimoErrorGemini = errorGemini;

                    console.error(
                        `Gemini falló con la llave #${indiceLlaveGemini + 1}:`,
                        errorGemini?.message || errorGemini
                    );

                    indiceLlaveGemini = (indiceLlaveGemini + 1) % LLAVES_GEMINI.length;
                    intentosRealizados++;
                }
            }

            if (!intentoExitosoGemini) {
                throw new Error(
                    `Fallaron todas las llaves Gemini. Último error: ${ultimoErrorGemini?.message || ultimoErrorGemini}`
                );
            }
        }

        textoIA = postProcesarRespuesta(textoIA, mensajeLimpio, ajusteAlgoritmo, modoAplicado);

        return res.json({
            respuesta: textoIA,
            tituloNuevo,
            modoAplicado,
            requiereGoogle,
            alerta: {
                activada: false
            }
        });
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
