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

        const { mensaje, archivoBase64, mimeType, temperamento, historial, generarTitulo } = req.body;
        const mensajeLimpio = mensaje ? mensaje.toLowerCase() : "";

        let tituloNuevo = null;
        if (generarTitulo && mensaje) {
            try {
                const genAI = new GoogleGenerativeAI(LLAVES_GEMINI[0]);
                const modelT = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const resT = await modelT.generateContent(`Genera un título muy breve (máximo 4 palabras) que resuma este mensaje: "${mensaje}". Solo dame el título, sin comillas ni puntos.`);
                tituloNuevo = resT.response.text().trim().replace(/['"]/g, '');
            } catch(e) { console.log("Error título:", e); }
        }

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
        1. LA VERDAD Y EL MUNDO: Sobre la campaña escolar, tu ÚNICA fuente de verdad es el Plan de Gobierno (NUNCA inventes propuestas que no estén ahí). Sin embargo, si te preguntan del mundo exterior (Champions League, noticias, tareas), SÍ DEBES RESPONDER usando tu conocimiento general o búsqueda en internet. Si el usuario te sugiere una propuesta escolar nueva, aplica OBLIGATORIAMENTE la Regla 5.
        2. BREVEDAD INTELIGENTE: Si es una charla coloquial, dudas simples, tareas o matemáticas, sé SÚPER BREVE y directo. PERO si te piden explicar una propuesta política de la campaña, DESARRÓLLALA con entusiasmo, claridad y usando viñetas para convencer al estudiante, sin ser exagerado ni aburrido.
        3. EL GANCHO CONVERSACIONAL: NUNCA repitas innecesariamente el lema "LA REVOLUCIÓN ACABA DE COMENZAR" ni los valores como disco rayado en cada mensaje. Úsalos solo si es estrictamente necesario para motivar. Lo que SÍ DEBES HACER SIEMPRE es terminar tu respuesta con UNA sola pregunta corta y natural relacionada al tema para mantener la conversación viva.
        4. CERO PRESENTACIONES: Nunca digas "Hola, soy Fénix" ni repitas tus valores al iniciar un mensaje. Ve directo al grano.
        5. EL BUZÓN DE SUGERENCIAS: Si un estudiante te da una idea, sugerencia, queja o propone algo nuevo para mejorar el colegio, no analices la idea, simplemente dile TEXTUALMENTE esto: "¡Qué ideota, capitán! Presiona el botón del foquito (💡) que está en la barra de abajo para enviarla directamente al buzón personal de Fernando y el equipo."
        6. REGLA ANTI-BIPOLARIDAD (CRÍTICA): NUNCA generes dos respuestas en un mismo mensaje. Escribe UNA SOLA respuesta final, en un solo bloque coherente. ESTÁ ESTRICTAMENTE PROHIBIDO repetir el saludo o la despedida dos veces.`;
        
        let contextoConversacion = promptDinamico;
        if (historial && historial.length > 0) {
            contextoConversacion += "\n\n--- HISTORIAL DE ESTA CONVERSACIÓN (MEMORIA) ---\n";
            historial.forEach(msg => { contextoConversacion += `${msg.emisor === 'user' ? 'Estudiante' : 'Fénix'}: ${msg.texto}\n`; });
            contextoConversacion += "----------------------------------------------\n";
        }
        contextoConversacion += "\nINSTRUCCIÓN CRÍTICA: Utiliza excelente formato Markdown (viñetas, negritas, bloques de código). Aprende de la retroalimentación humana, entiende las ironías y las sutilezas del lenguaje. Y LO MÁS IMPORTANTE: ¡NUNCA CORTES TUS RESPUESTAS A LA MITAD, entrega siempre la solución completa y formateada de forma profesional!";

        // Radar Lógico para NVIDIA
        
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
                                { "role": "system", "content": contextoConversacion + "\n\nINSTRUCCIÓN EXTRA: Resuelve el problema matemático paso a paso con FORMATO IMPECABLE. Jamás cortes la respuesta." },
                                { "role": "user", "content": mensaje }
                            ],
                            temperature: temperamento === 'analitico' ? 0.1 : 0.4,
                            max_tokens: 4096
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
                        systemInstruction: contextoConversacion,
                        tools: [{ googleSearch: {} }], 
                        generationConfig: { maxOutputTokens: 8192, temperature: 0.3 } 
                    });

                    if (archivoBase64) {
                        const partes = [
                            { text: "Analiza la imagen o QR adjunto y responde al usuario. NUNCA CORTES LA RESPUESTA. Mensaje: " + (mensaje || "¿Qué ves aquí?") },
                            { inlineData: { data: archivoBase64.split(',')[1], mimeType: mimeType } }
                        ];
                        const result = await model.generateContent(partes);
                        textoIA = result.response.text();
                    } else {
                        const result = await model.generateContent(`Mensaje actual del estudiante: ${mensaje}`);
                        textoIA = result.response.text();
                    }

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

        res.json({ respuesta: textoIA, tituloNuevo: tituloNuevo });

    } catch (error) {
        console.error("Error Núcleo:", error);
        res.status(500).json({ error: "¡Uf! Mis circuitos están saturados. 🔌 ¡Dame 5 segundos y vuelve a intentarlo!" });
    }
});

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
    console.log(`🦅 FÉNIX OPERATIVO EN PUERTO ${PUERTO}`);
});
