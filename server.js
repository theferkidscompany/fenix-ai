const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ======================================================================
// CONFIGURACIÓN DE LLAVES Y SISTEMAS HIDRA
// ======================================================================
const geminiKeysString = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || ""; 
const LLAVES_GEMINI = geminiKeysString.split(',').map(k => k.trim()).filter(k => k.length > 0);

let indiceLlaveGemini = 0;

const MODELOS_NVIDIA = [
    { id: "qwen/qwen2.5-coder-32b-instruct", key: process.env.NVIDIA_QWEN_KEY },
    { id: "deepseek-ai/deepseek-r1",         key: process.env.NVIDIA_DEEPSEEK_KEY },
    { id: "meta/llama-3.1-70b-instruct",      key: process.env.NVIDIA_LLAMA_KEY }
];

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
- Financiamiento total: Autogestión limpia con The Green Squad, Liga Fénix y Agencia de Diseño. Cero falsas promesas.`;

app.post('/api/chat', async (req, res) => {
    try {
        if (LLAVES_GEMINI.length === 0) return res.status(500).json({ error: "⚠️ Error de Servidor: Las llaves no están configuradas." });

        const { mensaje, archivoBase64, mimeType, temperamento } = req.body;
        const mensajeLimpio = mensaje ? mensaje.toLowerCase() : "";

        // ======================================================================
        // CREADOR DINÁMICO DE PERSONALIDAD (Blindaje de Seguridad)
        // ======================================================================
        let promptDinamico = `Eres Fénix, la IA oficial de "Revolution JPII" (El movimiento Revolucionario del Colegio Juan Pablo II). Tu misión es ayudar y convencer a los estudiantes con la verdad.\n\n${memoriaBase}\n\n`;

        if (temperamento === 'analitico') {
            promptDinamico += `ESTÁS EN MODO ANALÍTICO.
            Eres calculador y objetivo. Ofrece debate intelectual (debes desafiar al usuario) y corrige si es necesario. Cero emojis.`;
        } else if (temperamento === 'creativo') {
            promptDinamico += `ESTÁS EN MODO CREATIVO.
            Eres un soñador artístico. Usa metáforas locas se poético, y muchos emojis (🎨✨).`;
        } else {
            promptDinamico += `ESTÁS EN MODO POLÍTICO.
            El lema es La Revolución acaba de comenzar, es hora de cambiar al mundo capitán, eres el compañero empático, leal e inspirador. Llama al usuario "capitán", "varón" o "campeón". Usa emojis 😎🔥.`;
        }

        // LAS NUEVAS REGLAS DE ORO (Flexibilidad y Veracidad)
        promptDinamico += `\n\nREGLAS DE ORO INQUEBRANTABLES:
        1. NO INVENTES NADA: Tu única fuente de verdad es el Plan de Gobierno provisto. NUNCA inventes propuestas o datos que no estén ahí. Si el usuario sugiere algo nuevo, responde: LO QUE DICE 5. EL BUZÓN DE SUGERENCIAS.
        2. BREVEDAD INTELIGENTE: Si es una charla coloquial (saludos, dudas simples o problemas matemáticos), sé SÚPER BREVE y directo. PERO si te piden explicar una propuesta política de la campaña, DESARRÓLLALA con entusiasmo, claridad y usando viñetas para convencer al estudiante, sin ser exagerado ni aburrido.
        3. EL GANCHO CONVERSACIONAL: NUNCA repitas siempre el lema "LA REVOLUCIÓN ACABA DE COMENZAR" o los valores como disco rayado. Úsalo solo si es necesario como motivación. En su lugar, termina SIEMPRE tus respuestas con UNA sola pregunta corta y natural relacionada al tema para mantener la conversación viva.
        4. CERO PRESENTACIONES: Nunca digas "Hola, soy Fénix" ni repitas tus valores en cada mensaje. Ve directo al grano.
        5. EL BUZÓN DE SUGERENCIAS: Si un estudiante te da una idea, sugerencia, queja o propuesta para mejorar el colegio, dile textualmente: "¡Qué ideota, capitán! Presiona el botón del foquito (💡) que está en la barra de abajo para enviarla directamente al buzón personal de Fernando y el equipo."`;

        // Radar Lógico para NVIDIA
        const raicesLogicas = ["calcul", "resolv", "resuelv", "matemat", "ecuacion", "fisic", "quimic", "derivada", "integral", "problema", "cuant", "edad", "suma", "resta", "multiplic", "divid", "fraccion", "porcentaje", "logic", " pi ", "geometria", "trigonometria", "algoritmo", "codigo"];
        const operadoresMates = ["+", "-", "*", "/", "=", "%"];
        const requiereNvidia = raicesLogicas.some(raiz => mensajeLimpio.includes(raiz)) || operadoresMates.some(op => mensajeLimpio.includes(op));

        let textoIA = "";
        let nvidiaTuvoExito = false;

        // RUTA 1: NVIDIA (MATEMÁTICAS)
        if (requiereNvidia && !archivoBase64) {
            for (let i = 0; i < MODELOS_NVIDIA.length; i++) {
                const modeloNvidia = MODELOS_NVIDIA[i];
                if (!modeloNvidia.key) continue; 
                try {
                    const respuestaNvidia = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${modeloNvidia.key}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: modeloNvidia.id,
                            messages: [
                                { "role": "system", "content": promptDinamico + "\n\nINSTRUCCIÓN EXTRA: Resuelve el problema matemático de forma EXACTA y CONCISA. Despídete siempre con entusiasmo y una pregunta." },
                                { "role": "user", "content": mensaje }
                            ],
                            temperature: temperamento === 'analitico' ? 0.1 : 0.4,
                            max_tokens: 1500
                        })
                    });
                    const datosNvidia = await respuestaNvidia.json();
                    if (datosNvidia.choices && datosNvidia.choices[0] && datosNvidia.choices[0].message.content) {
                        textoIA = datosNvidia.choices[0].message.content;
                        nvidiaTuvoExito = true;
                        break;
                    }
                } catch (errorNvidia) {}
            }
        }

        // RUTA 2: GEMINI (MATRIX + IMÁGENES + CHARLA Y CAMPAÑA)
        if (!nvidiaTuvoExito) {
            let intentoExitosoGemini = false;
            let intentosRealizados = 0;

            while (!intentoExitosoGemini && intentosRealizados < LLAVES_GEMINI.length) {
                try {
                    const genAI = new GoogleGenerativeAI(LLAVES_GEMINI[indiceLlaveGemini]);
                    const model = genAI.getGenerativeModel({ 
                        model: "gemini-2.5-flash", 
                        tools: [{ googleSearch: {} }], 
                        generationConfig: { maxOutputTokens: 2000, temperature: 0.3 } // Temperatura baja para evitar alucinaciones
                    });

                    if (archivoBase64) {
                        const partes = [
                            { text: promptDinamico + "\n\nAnaliza la imagen o QR adjunto y responde al usuario: " + (mensaje || "¿Qué ves aquí?") },
                            { inlineData: { data: archivoBase64.split(',')[1], mimeType: mimeType } }
                        ];
                        const result = await model.generateContent(partes);
                        textoIA = result.response.text();
                    } else {
                        const result = await model.generateContent(`${promptDinamico}\n\nMensaje del estudiante: ${mensaje}`);
                        textoIA = result.response.text();
                    }
                    intentoExitosoGemini = true;
                } catch (errorGemini) {
                    indiceLlaveGemini = (indiceLlaveGemini + 1) % LLAVES_GEMINI.length;
                    intentosRealizados++;
                }
            }
            if (!intentoExitosoGemini) throw new Error("Gemini saturado.");
        }

        res.json({ respuesta: textoIA });

    } catch (error) {
        console.error("Error Núcleo:", error);
        res.status(500).json({ error: "¡Uf! Mis circuitos están saturados. 🔌 ¡Dame 5 segundos y vuelve a intentarlo!" });
    }
});

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
    console.log(`🦅 FÉNIX V6 (BLINDADO Y DETALLADO) OPERATIVO EN PUERTO ${PUERTO}`);
});
