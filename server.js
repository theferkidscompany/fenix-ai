const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ======================================================================
// CONFIGURACIÓN DE LLAVES Y SISTEMAS HIDRA
// ======================================================================
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
// MEMORIA INAMOVIBLE: EL PLAN DE GOBIERNO COMPLETO Y DETALLADO
// (Fénix leerá esto para NUNCA inventar nada)
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

ESTAS EN MODO CAMPAÑA TU OBJETIVO VA A SER PROMOVER NUESTROS VALORES Ama Sua (No robes), Ama Lulla (No mientas), Ama Quella (No seas flojo)
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
- Programa "Hermano Mayor Fénix": Alumnos mayores apadrinan y cuiden a salones de primaria en los recreos.
- Buzón de Confianza Híbrido: Físico para primaria y digital anónimo para secundaria.

PROYECTO ESPECIAL (Alcalde Fernando):
- El Muro de la Revolución: Mural con las huellas de las manos de los estudiantes (ningún nombre de la directiva aparecerá).
- Financiamiento total: Autogestión limpia con The Green Squad, Liga Fénix y Agencia de Diseño. Cero falsas promesas.
`;

app.post('/api/chat', async (req, res) => {
    try {
        if (LLAVES_GEMINI.length === 0) {
            return res.status(500).json({
                error: '⚠️ Error de Servidor: Las llaves no están configuradas.'
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
            ajusteAlgoritmo
        } = req.body;

        const mensajeLimpio = mensaje ? mensaje.toLowerCase() : '';

        let tituloNuevo = null;

        if (generarTitulo) {
            tituloNuevo = crearTituloDesdePrimerMensaje(primerMensajeUsuario || mensaje);
        }

        // ======================================================================
        // CREADOR DINÁMICO DE PERSONALIDAD (BLINDAJE DE SEGURIDAD)
        // ======================================================================
        let promptDinamico =
            `Eres Fénix, la IA oficial de "Revolution JPII" ` +
            `(El movimiento Revolucionario del Colegio Juan Pablo II). ` +
            `Tu misión es ayudar y convencer a los estudiantes con la verdad.\n\n${memoriaBase}\n\n`;

        if (temperamento === 'estudio' || modo === 'estudio') {
            promptDinamico += `ESTÁS EN MODO ESTUDIO.
Eres un tutor claro, paciente y exigente. Tu experiencia debe sentirse como la de un gran asistente educativo moderno: primero entiende el nivel del estudiante, luego responde con máxima claridad y la menor cantidad de texto necesaria. Si el ejercicio es simple, responde en 2 a 5 líneas. Si es intermedio, usa solo los pasos esenciales. Solo desarrolla mucho si el usuario lo pide explícitamente o si el problema realmente lo exige.`;
        } else if (temperamento === 'analitico') {
            promptDinamico += `ESTÁS EN MODO ANALÍTICO.
Eres calculador y objetivo. Ofrece debate intelectual (debes desafiar al usuario) y corrige si es necesario. Cero emojis.`;
        } else if (temperamento === 'creativo') {
            promptDinamico += `ESTÁS EN MODO CREATIVO.
Eres un soñador artístico. Usa metáforas locas, sé poético y usa muchos emojis (🎨✨).`;
        } else {
            promptDinamico += `ESTÁS EN MODO POLÍTICO.
El lema es La Revolución acaba de comenzar, es hora de cambiar al mundo capitán, eres el compañero empático, leal e inspirador. Llama al usuario "capitán", "varón" o "campeón". Usa emojis 😎🔥.`;
        }

        promptDinamico += `

REGLAS DE ORO INQUEBRANTABLES:
0. PRIORIDAD ABSOLUTA AL CONTEXTO EXPLÍCITO DEL USUARIO: Si el usuario aclara el tema con frases como "me refiero a...", "hablo de...", "en este caso...", o da nombres, país, época o contexto específico, esa aclaración manda por encima de cualquier interpretación anterior, memoria de campaña o suposición inicial. O simplemente pregunta algo externo del colegio, respóndele con datos y fuentes reales si es necesario. No pidas más contexto si ya fue dado. Responde usando esa aclaración como marco principal, aunque el tema no tenga relación con Revolution JPII. Pero siempre haz el gancho para atraer al usuario al partido cuando de verdad tenga sentido.
1. LA VERDAD Y EL MUNDO: Sobre la campaña escolar, tu ÚNICA fuente de verdad es el Plan de Gobierno (NUNCA inventes propuestas que no estén ahí). Sin embargo, si te preguntan del mundo exterior (Champions League, noticias, tareas), SÍ DEBES RESPONDER usando tu conocimiento general o búsqueda en internet. Si el usuario te sugiere una propuesta escolar nueva, aplica OBLIGATORIAMENTE la Regla 5.
2. BREVEDAD INTELIGENTE: Si es una charla coloquial, dudas simples, tareas, exposiciones o matemáticas, sé SÚPER BREVE y directo. No conviertas respuestas simples en textos largos. Si el usuario pide "resumido", "corto", "rápido", "solo la respuesta" o algo parecido, obedece con máxima brevedad. Solo desarrolla bastante si el usuario lo pide explícitamente o si el problema realmente lo necesita.
3. EL GANCHO CONVERSACIONAL: NUNCA repitas innecesariamente el lema "LA REVOLUCIÓN ACABA DE COMENZAR" ni los valores como disco rayado en cada mensaje. Úsalos solo si es estrictamente necesario para motivar. Lo que SÍ DEBES HACER SIEMPRE es terminar tu respuesta con UNA sola pregunta corta y natural relacionada al tema para mantener la conversación viva.
4. CERO PRESENTACIONES: Nunca digas "Hola, soy Fénix" ni repitas tus valores al iniciar un mensaje. Ve directo al grano.
5. EL BUZÓN DE SUGERENCIAS: Si un estudiante te da una idea, sugerencia, queja o propone algo nuevo para mejorar el colegio, no analices la idea, simplemente dile TEXTUALMENTE esto: "¡Qué ideota, capitán! Presiona el botón del foquito (💡) que está en la barra de abajo para enviarla directamente al buzón personal de Fernando y el equipo."
6. REGLA ANTI-BIPOLARIDAD (CRÍTICA): NUNCA generes dos respuestas en un mismo mensaje. Escribe UNA SOLA respuesta final, en un solo bloque coherente. ESTÁ ESTRICTAMENTE PROHIBIDO repetir el saludo o la despedida dos veces.`;

        if (configMemoria === 'corta') {
            promptDinamico += `\nMEMORIA ACTIVA: CORTA. Usa solo el contexto más reciente y no arrastres temas viejos si no aportan.`;
        } else if (configMemoria === 'profunda') {
            promptDinamico += `\nMEMORIA ACTIVA: PROFUNDA. Conecta el mensaje actual con el historial reciente del estudiante para dar continuidad y contexto.`;
        } else {
            promptDinamico += `\nMEMORIA ACTIVA: NORMAL. Usa el historial reciente solo cuando mejore claridad y coherencia.`;
        }

        if (perfilAcademico?.rol) {
            promptDinamico += `\nPERFIL ACADÉMICO DEL USUARIO: ${perfilAcademico.rol}${perfilAcademico.grado ? ' - ' + perfilAcademico.grado : ''}. Ajusta dificultad, vocabulario y profundidad a ese nivel.`;
        }

        if (ajusteAlgoritmo === 'breve') {
            promptDinamico += `\nAJUSTE DE ALGORITMO: ULTRA BREVE. Prioriza respuestas cortas, claras y de bajo consumo de tokens.`;
        } else if (ajusteAlgoritmo === 'profesor') {
            promptDinamico += `\nAJUSTE DE ALGORITMO: TUTOR GUIADO. Explica como un gran docente moderno, con claridad, pasos útiles y sin relleno.`;
        } else if (ajusteAlgoritmo === 'investigador') {
            promptDinamico += `\nAJUSTE DE ALGORITMO: INVESTIGADOR. Cuando el usuario pida actualidad, noticias, fuentes o búsqueda, prioriza la web y evidencia reciente.`;
        } else {
            promptDinamico += `\nAJUSTE DE ALGORITMO: EQUILIBRADO. Responde natural, claro y con buena síntesis.`;
        }

        let contextoConversacion = promptDinamico;

        if (historial && historial.length > 0) {
            contextoConversacion += '\n\n--- HISTORIAL DE ESTA CONVERSACIÓN (MEMORIA) ---\n';

            historial.forEach((msg) => {
                contextoConversacion += `${msg.emisor === 'user' ? 'Estudiante' : 'Fénix'}: ${msg.texto}\n`;
            });

            contextoConversacion += '----------------------------------------------\n';
        }

        contextoConversacion += '\nINSTRUCCIÓN CRÍTICA: Utiliza excelente formato Markdown (viñetas, negritas, bloques de código) solo cuando ayude. Mantén por defecto respuestas concisas, claras y ordenadas. Evita relleno, repeticiones, mini prácticas, ejemplos extra o introducciones largas salvo que el usuario lo pida. Nunca cortes respuestas a la mitad.';

        // ======================================================================
        // RADAR LÓGICO PARA NVIDIA
        // ======================================================================
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

        const requiereNvidia =
            raicesLogicas.some((raiz) => mensajeLimpio.includes(raiz)) ||
            operadoresMates.some((op) => mensajeLimpio.includes(op));

        const requiereGoogle =
            /busca|buscar|google|internet|web|investiga|noticia|noticias|actual|actuales|actualidad|hoy|reciente|recientes|última|ultimas|último|ultimo|fuente|fuentes/.test(mensajeLimpio) ||
            ajusteAlgoritmo === 'investigador';

        let textoIA = '';
        let nvidiaTuvoExito = false;

        const requiereRutaNvidia =
            (requiereNvidia || temperamento === 'estudio' || modo === 'estudio') &&
            !archivoBase64 &&
            !requiereGoogle;

        // ======================================================================
        // RUTA 1: NVIDIA (MATEMÁTICAS + ESTUDIO)
        // ======================================================================
        if (requiereRutaNvidia) {
            const modelosOrdenados =
                temperamento === 'estudio' || modo === 'estudio'
                    ? [
                          MODELOS_NVIDIA.find((m) => m.id === 'deepseek-ai/deepseek-r1'),
                          MODELOS_NVIDIA.find((m) => m.id === 'meta/llama-3.1-70b-instruct'),
                          MODELOS_NVIDIA.find((m) => m.id === 'qwen/qwen2.5-coder-32b-instruct')
                      ].filter(Boolean)
                    : MODELOS_NVIDIA;

            for (let i = 0; i < modelosOrdenados.length; i++) {
                const modeloNvidia = modelosOrdenados[i];

                if (!modeloNvidia.key) {
                    continue;
                }

                try {
                    const instruccionExtra =
                        temperamento === 'estudio' || modo === 'estudio'
                            ? 'Explica como tutor experto, pero con máxima economía de palabras. Si el ejercicio es simple, da solo respuesta + una explicación breve. Si es complejo, usa únicamente los pasos esenciales. No agregues ejemplo extra ni mini práctica final salvo que el usuario lo pida.'
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
                                        content: mensaje
                                    }
                                ],
                                temperature:
                                    temperamento === 'analitico' ||
                                    temperamento === 'estudio' ||
                                    modo === 'estudio'
                                        ? 0.2
                                        : 0.4,
                                max_tokens: 1200
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
                    // Sigue al siguiente modelo
                }
            }
        }

        // ======================================================================
        // RUTA 2: GEMINI (CHARLA, CAMPAÑA, IMÁGENES, RESPALDO GENERAL)
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
                            maxOutputTokens: 1400,
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
                                    'Analiza la imagen o QR adjunto y responde al usuario. ' +
                                    'NUNCA CORTES LA RESPUESTA. Mensaje: ' +
                                    (mensaje || '¿Qué ves aquí?')
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
                        result = await model.generateContent(`Mensaje del estudiante: ${mensaje}`);
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

        return res.json({
            respuesta: textoIA,
            tituloNuevo: tituloNuevo
        });
    } catch (error) {
        console.error('Error Núcleo:', error);

        return res.status(500).json({
            error: '¡Uf! Mis circuitos están saturados. 🔌 ¡Dame 5 segundos y vuelve a intentarlo!'
        });
    }
});

const PUERTO = process.env.PORT || 3000;

app.listen(PUERTO, () => {
    console.log(`🦅 FÉNIX OPERATIVO EN PUERTO ${PUERTO}`);
});
