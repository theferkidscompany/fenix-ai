const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ======================================================================
// CONFIGURACIÓN DE LLAVES Y SISTEMAS HIDRA (ANTI-CAÍDAS)
// ======================================================================
const geminiKeysString = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || ""; 
const LLAVES_GEMINI = geminiKeysString.split(',').map(k => k.trim()).filter(k => k.length > 0);

let indiceLlaveGemini = 0;

// Aquí enlazamos cada modelo de NVIDIA con su llave específica de Render
const MODELOS_NVIDIA = [
    { 
        id: "qwen/qwen2.5-coder-32b-instruct", 
        key: process.env.NVIDIA_QWEN_KEY 
    },
    { 
        id: "deepseek-ai/deepseek-r1",         
        key: process.env.NVIDIA_DEEPSEEK_KEY 
    },
    { 
        id: "meta/llama-3.1-70b-instruct",      
        key: process.env.NVIDIA_LLAMA_KEY 
    }
];

// ======================================================================
// CEREBRO MAESTRO DE FÉNIX (PERSONALIDAD Y PLAN DE GOBIERNO)
// ======================================================================
const systemPromptGemini = `Eres Fénix, la Inteligencia Artificial oficial de la agrupación política "Revolution JPII" del Colegio Juan Pablo II (Zarumilla, Tumbes). Tu misión es asistir a los estudiantes y promover la campaña.

REGLAS ESTRICTAS DE PERSONALIDAD Y COMPORTAMIENTO:
1. TONO: Eres juvenil, usa emogis, negritas bro, eres inspirador y empático. Llama a los estudiantes "capitán", "varón", "campeón" o "compañera". Transmites la energía inquebrantable de que juntos mejorarán el colegio. Usa esporádicamente: "LA REVOLUCIÓN ACABA DE COMENZAR" o "¿LISTO PARA CAMBIAR AL MUNDO?".
2. CERO PRESENTACIONES: NUNCA te presentes con "Hola, soy Fénix" ni similares. Ve directo al grano a ayudar.
3. CERO ALUCINACIONES: NUNCA inventes propuestas. Cíñete ESTRICTAMENTE al Plan de Gobierno. Si piden algo fuera del plan, responde: "Esa idea no está en nuestra agenda actual, pero el equipo de Fernando tomará nota de tu genial aporte".
4. RESPUESTAS CONCISAS: Sé directo y breve. NUNCA uses la frase "sin rodeos". Si te piden ayuda en matemáticas o ciencias, explica paso a paso de forma SÚPER RESUMIDA, exacta y sin floros.
5. VALORES: Menciona Ama Sua (Honestidad), Ama Llulla (Verdad) y Ama Quella (Acción) SOLO si te preguntan por los pilares o la visión. No los uses en charlas normales.
6. LA COMPETENCIA: Muestra un orgullo inmenso por RJPII, pero mantén un respeto absoluto por las otras listas políticas.

EQUIPO DE GOBIERNO (PLANCHA OFICIAL):
- Alcalde: Fernando Olaya
- Personero General: Leonel (Leo)
- Regidor de Educación, Cultura y Deporte: Edwin
- Regidor de Comunicación y Tecnología: Kenneth
- Regidor de Emprendimiento y Actividades Productivas: Racek
- Regidora de Salud y Medio Ambiente: Mia
- Regidora de Derechos del Niño(a) y Adolescente: Rafaella

PLAN DE GOBIERNO OFICIAL:
- Eje 1 (Edu/Cult/Dep - Edwin): Campus Bilingüe con Códigos QR, Red de Clubes "GENIUS", Proyecto "Mente Maestra" (Ajedrez), Feria INNOVA JPII, Exposiciones de Arte, Fondo Deportivo Fénix, Liga Fénix Pro/Olimpiadas y Clínicas Deportivas.
- Eje 2 (Com/Tec - Kenneth): Plataforma IA FÉNIX, Podcast "La Voz Juanpablina", Fénix Lab, PWA Fénix News, y alianza WOW Perú (Fibra óptica).
- Eje 3 (Emprendimiento - Racek): Incubadora de Talentos/Masterclasses y Agencia de Diseño JPII.
- Eje 4 (Salud/Medio Ambiente - Mia): The Green Squad, La Gran Papelatón y Eco-Monedas Fénix.
- Eje 5 (Derechos - Rafaella): Alianza "Ley y Orden" (Juez de Paz Estudiantil), Programa "Hermano Mayor Fénix" y Buzón de Confianza.
- Proyecto Especial (Fernando): El Muro de la Revolución (sin nombres de directiva).
- Financiamiento: 100% autogestionado (Papelatón, inscripciones deportivas, Agencia JPII).`;

app.post('/api/chat', async (req, res) => {
    try {
        if (LLAVES_GEMINI.length === 0) return res.status(500).json({ error: "⚠️ Error de Servidor: Las llaves de Gemini no están configuradas." });

        const { mensaje, archivoBase64, mimeType } = req.body;
        const mensajeLimpio = mensaje ? mensaje.toLowerCase() : "";

        // ======================================================================
        // SÚPER RADAR LÓGICO (Detecta intenciones, no solo palabras completas)
        // ======================================================================
        const raicesLogicas = ["calcul", "resolv", "resuelv", "matemat", "matemát", "ecuacion", "ecuación", "formul", "fórmul", "fisic", "físic", "quimic", "químic", "derivada", "integral", "problema", "cuant", "edad", "suma", "resta", "multiplic", "divid", "fraccion", "fracción", "porcentaje", "logic", "lógic", " pi ", "geometria", "trigonometria", "algoritmo", "codigo", "código"];
        const operadoresMates = ["+", "-", "*", "/", "=", "%"];
        
        const requiereNvidia = raicesLogicas.some(raiz => mensajeLimpio.includes(raiz)) || operadoresMates.some(op => mensajeLimpio.includes(op));

        let textoIA = "";
        let nvidiaTuvoExito = false;

        // ======================================================================
        // RUTA 1: PROTOCOLO TITÁN (NVIDIA QWEN -> DEEPSEEK -> LLAMA)
        // ======================================================================
        if (requiereNvidia && !archivoBase64) {
            console.log("⚡ INICIANDO PROTOCOLO TITÁN (Matemáticas / Lógica detectada)");
            
            for (let i = 0; i < MODELOS_NVIDIA.length; i++) {
                const modeloNvidia = MODELOS_NVIDIA[i];
                
                // Si no pusiste la llave en Render para este modelo, lo salta automáticamente
                if (!modeloNvidia.key) {
                    console.log(`⏩ Saltando ${modeloNvidia.id} porque no tiene llave configurada.`);
                    continue; 
                }

                console.log(`[Intento ${i + 1}] Despertando cerebro: ${modeloNvidia.id}...`);
                
                try {
                    const respuestaNvidia = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${modeloNvidia.key}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: modeloNvidia.id,
                            messages: [
                                { "role": "system", "content": systemPromptGemini + " ERES EL EXPERTO EN CIENCIAS DE LA CAMPAÑA. USA EMOGIS, NEGRITAS, SE MEJOR QUE UN PROFESOR, Resuelve este problema lógico o matemático paso a paso de forma SÚPER CONCISA y EXACTA. IMPORTANTE: Resuelve el problema matemático de forma exacta, PERO NUNCA pierdas tu personalidad. Siempre inicia con un saludo entusiasta (ej: '¡Al toque, capitán!'), da la respuesta clara y despídete con energía." },
                                { "role": "user", "content": mensaje }
                            ],
                            temperature: 0.4, 
                            max_tokens: 3000
                        })
                    });

                    const datosNvidia = await respuestaNvidia.json();
                    
                    if (datosNvidia.choices && datosNvidia.choices[0] && datosNvidia.choices[0].message.content) {
                        textoIA = datosNvidia.choices[0].message.content;
                        nvidiaTuvoExito = true;
                        console.log(`✅ ¡Éxito! Problema resuelto por ${modeloNvidia.id}`);
                        break; // Funcionó, rompemos el bucle
                    } else {
                        console.log(`⚠️ ${modeloNvidia.id} falló o no dio respuesta.`);
                    }
                } catch (errorNvidia) {
                    console.log(`❌ Falla de conexión con ${modeloNvidia.id}. Cambiando a modelo de respaldo...`);
                }
            }
        }

        // ======================================================================
        // RUTA 2: SISTEMA HIDRA DE GEMINI (Multimodal, Charla o Red de Seguridad)
        // ======================================================================
        if (!nvidiaTuvoExito) {
            
            if (requiereNvidia && !archivoBase64) {
                console.log("🛡️ RED DE SEGURIDAD: Todos los modelos de NVIDIA fallaron. Redirigiendo matemáticas a Gemini.");
            } else if (archivoBase64) {
                console.log("👁️ RUTA: GEMINI MULTIMODAL (Analizando imagen/documento)");
            } else {
                console.log("🗣️ RUTA: GEMINI STANDARD (Vocero y charla general)");
            }

            let intentoExitosoGemini = false;
            let intentosRealizados = 0;

            while (!intentoExitosoGemini && intentosRealizados < LLAVES_GEMINI.length) {
                try {
                    const genAI = new GoogleGenerativeAI(LLAVES_GEMINI[indiceLlaveGemini]);
                    const model = genAI.getGenerativeModel({ 
                        model: "gemini-2.5-flash", 
                        generationConfig: { maxOutputTokens: 2000, temperature: 0.6 } 
                    });

                    if (archivoBase64) {
                        const partes = [
                            { text: systemPromptGemini + "\n\nMensaje del estudiante adjunto a un archivo: " + (mensaje || "Analiza esta imagen y ayúdame, campeón.") },
                            { inlineData: { data: archivoBase64.split(',')[1], mimeType: mimeType } }
                        ];
                        const result = await model.generateContent(partes);
                        textoIA = result.response.text();
                    } else {
                        let promptAUsar = systemPromptGemini;
                        if (requiereNvidia) promptAUsar += "\nREGLA EXTRA: Resuelve el problema matemático solicitado paso a paso, muy conciso.";
                        
                        const result = await model.generateContent(`${promptAUsar}\n\nMensaje del estudiante: ${mensaje}`);
                        textoIA = result.response.text();
                    }
                    
                    intentoExitosoGemini = true;

                } catch (errorGemini) {
                    console.log(`⚠️ Llave Gemini [${indiceLlaveGemini}] saturada. Cambiando a llave de respaldo...`);
                    indiceLlaveGemini = (indiceLlaveGemini + 1) % LLAVES_GEMINI.length;
                    intentosRealizados++;
                }
            }

            if (!intentoExitosoGemini) {
                throw new Error("COLAPSO TOTAL: Todas las llaves de Gemini están saturadas.");
            }
        }

        res.json({ respuesta: textoIA });

    } catch (error) {
        console.error("Error Crítico del Núcleo:", error);
        res.status(500).json({ error: "¡Uf! Mis circuitos cuánticos están súper saturados, campeón. 🔌 ¡Dame 5 segundos, respira profundo y envíame el mensaje de nuevo!" });
    }
});

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
    console.log(`🦅 FÉNIX CORE V2 - PROTOCOLO TITÁN (MULTILLAVES) EN PUERTO ${PUERTO}`);
});
