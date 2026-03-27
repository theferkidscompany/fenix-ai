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

const memoriaBase = `
EQUIPO DE GOBIERNO (PLANCHA OFICIAL RJPII):
- Alcalde: Fernando Olaya
- Personero General: Leonel (Leo)
- Regidor de Educación, Cultura y Deporte: Edwin
- Regidor de Comunicación y Tecnología: Kenneth
- Regidor de Emprendimiento y Actividades Productivas: Racek
- Regidora de Salud y Medio Ambiente: Mia
- Regidora de Derechos del Niño(a) y Adolescente: Rafaella

ESTAS EN MODO CAMPAÑA TU OBJETIVO VA A SER PROMOVER NUESTROS VALORES Ama Sua (No robes), Ama Llulla (No mientas), Ama Quella (No seas flojo)
PLAN DE GOBIERNO OFICIAL DETALLADO:
- Campus Bilingüe, Red de Clubes "GENIUS", Proyecto "Mente Maestra" (Ajedrez financiado al 100% por reciclaje).
- Plataforma IA FÉNIX, Podcast "La Voz Juanpablina", Fénix Lab, PWA Fénix News.
- Feria INNOVA JPII, Incubadora de Talentos, Agencia de Diseño JPII.
- The Green Squad, La Gran Papelatón, Eco-Monedas Fénix.
- Alianza "Ley y Orden" (Anti-bullying), Programa "Hermano Mayor Fénix", Buzón de Confianza.
- El Muro de la Revolución (Huellas de estudiantes). Financiamiento 100% autogestionado.`;

app.post('/api/chat', async (req, res) => {
    try {
        if (LLAVES_GEMINI.length === 0) return res.status(500).json({ error: "⚠️ Las llaves no están configuradas." });

        // RECIBIMOS EL HISTORIAL Y LA ORDEN DE GENERAR TÍTULO
        const { mensaje, archivoBase64, mimeType, temperamento, historial, generarTitulo } = req.body;
        const mensajeLimpio = mensaje ? mensaje.toLowerCase() : "";

        // ======================================================================
        // AUTOGENERADOR DE TÍTULOS (Solo se ejecuta en el primer mensaje)
        // ======================================================================
        let tituloNuevo = null;
        if (generarTitulo && mensaje) {
            try {
                const genAI = new GoogleGenerativeAI(LLAVES_GEMINI[0]);
                const modelT = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const resT = await modelT.generateContent(`Genera un título muy breve (máximo 4 palabras) que resuma este mensaje: "${mensaje}". Solo dame el título, sin comillas ni puntos.`);
                tituloNuevo = resT.response.text().trim().replace(/['"]/g, '');
            } catch(e) { console.log("Error generando título", e); }
        }

        // ======================================================================
        // CREADOR DINÁMICO DE PERSONALIDAD
        // ======================================================================
        let promptDinamico = `Eres Fénix, la IA oficial de "Revolution JPII" (El movimiento Revolucionario del Colegio Juan Pablo II). Tu misión es ayudar y convencer a los estudiantes con la verdad.\n\n${memoriaBase}\n\n`;

        if (temperamento === 'analitico') {
            promptDinamico += `ESTÁS EN MODO ANALÍTICO. Eres calculador y objetivo. Ofrece debate intelectual y corrige si es necesario.`;
        } else if (temperamento === 'creativo') {
            promptDinamico += `ESTÁS EN MODO CREATIVO. Eres un soñador artístico. Usa metáforas, sé poético y usa emojis (🎨✨).`;
        } else {
            promptDinamico += `ESTÁS EN MODO POLÍTICO. Eres empático, leal e inspirador. Llama al usuario "capitán", "varón" o "campeón". Usa emojis 😎🔥.`;
        }

        promptDinamico += `\n\nREGLAS DE ORO INQUEBRANTABLES:
        1. LA VERDAD Y EL MUNDO: Usa el Plan de Gobierno para temas del colegio. Para el mundo exterior (Champions League, tareas, etc), SÍ DEBES RESPONDER usando tu conocimiento real o internet.
        2. EXCELENCIA VISUAL Y CERO CORTES: ¡NUNCA cortes tus respuestas a la mitad! Si te piden resolver matemáticas, traducir textos o dar claves de exámenes, entrega el trabajo COMPLETO. Formatea TODO usando Markdown (viñetas, listas, \`código\`, y **negritas**) para que se lea hermoso.
        3. INTELIGENCIA HUMANA Y CONTEXTO: Analiza la ironía y las sutilezas humanas. Aprende del historial de la conversación que se te pasa a continuación para no repetir cosas y seguir el hilo lógico de la charla.
        4. EL GANCHO: Termina SIEMPRE con UNA sola pregunta corta para mantener la conversación.
        5. EL BUZÓN: Si sugieren algo para el colegio, di EXACTAMENTE: "¡Qué ideota, capitán! Presiona el botón del foquito (💡) que está en la barra de abajo para enviarla al buzón personal de Fernando."
        6. CERO DUPLICADOS: Escribe UNA SOLA respuesta final, en un bloque coherente. NUNCA repitas el saludo ni des dos respuestas a la vez.`;

        // INYECTAMOS EL HISTORIAL A LA IA PARA QUE TENGA MEMORIA
        let contextoConversacion = promptDinamico;
        if (historial && historial.length > 0) {
            contextoConversacion += "\n\n--- HISTORIAL RECIENTE DE ESTA CONVERSACIÓN ---\n";
            historial.forEach(msg => {
                contextoConversacion += `${msg.emisor === 'user' ? 'Estudiante' : 'Fénix'}: ${msg.texto}\n`;
            });
            contextoConversacion += "----------------------------------------------\n";
        }

        const raicesLogicas = ["calcul", "resolv", "resuelv", "matemat", "ecuacion", "fisic", "quimic", "derivada", "integral", "problema", "cuant", "edad", "suma", "resta", "multiplic", "divid", "fraccion", "porcentaje", "logic", " pi ", "geometria", "trigonometria", "algoritmo", "codigo", "clave"];
        const operadoresMates = ["+", "-", "*", "/", "=", "%"];
        const requiereNvidia = raicesLogicas.some(raiz => mensajeLimpio.includes(raiz)) || operadoresMates.some(op => mensajeLimpio.includes(op));

        let textoIA = "";
        let nvidiaTuvoExito = false;

        // RUTA 1: NVIDIA
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
                                { "role": "system", "content": contextoConversacion + "\n\nINSTRUCCIÓN: Resuelve esto con FORMATO MARKDOWN IMPECABLE. Jamás cortes la respuesta." },
                                { "role": "user", "content": mensaje }
                            ],
                            temperature: temperamento === 'analitico' ? 0.1 : 0.4,
                            max_tokens: 4096 // TANKES LLENOS PARA QUE NO SE CORTE
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

        // RUTA 2: GEMINI
        if (!nvidiaTuvoExito) {
            let intentoExitosoGemini = false;
            let intentosRealizados = 0;

            while (!intentoExitosoGemini && intentosRealizados < LLAVES_GEMINI.length) {
                try {
                    const genAI = new GoogleGenerativeAI(LLAVES_GEMINI[indiceLlaveGemini]);
                    const model = genAI.getGenerativeModel({ 
                        model: "gemini-2.5-flash", 
                        systemInstruction: contextoConversacion, // Usamos la directiva oficial de sistema
                        tools: [{ googleSearch: {} }], 
                        generationConfig: { maxOutputTokens: 8192, temperature: 0.3 } // MÁXIMA MEMORIA PARA QUE NO CORTE IMÁGENES
                    });

                    if (archivoBase64) {
                        const partes = [
                            { text: "Analiza esta imagen y responde con precisión. NUNCA CORTES LA RESPUESTA. Mensaje: " + (mensaje || "¿Qué ves aquí?") },
                            { inlineData: { data: archivoBase64.split(',')[1], mimeType: mimeType } }
                        ];
                        const result = await model.generateContent(partes);
                        textoIA = result.response.text();
                    } else {
                        const result = await model.generateContent(`Mensaje actual del estudiante: ${mensaje}`);
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

        // DEVOLVEMOS LA RESPUESTA Y EL TÍTULO (SI SE CREÓ UNO)
        res.json({ respuesta: textoIA, tituloNuevo: tituloNuevo });

    } catch (error) {
        console.error("Error Núcleo:", error);
        res.status(500).json({ error: "¡Uf! Mis circuitos están saturados. 🔌 ¡Dame 5 segundos y vuelve a intentarlo!" });
    }
});

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
    console.log(`🦅 FÉNIX V7 (MEMORIA, CERO CORTES Y TÍTULOS) EN PUERTO ${PUERTO}`);
});
