const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ======================================================================
// ======================================================================
const geminiKeysString = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || ""; 
const LLAVES_GEMINI = geminiKeysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

let indiceLlaveActual = 0;

const systemPromptGemini = `Eres Fénix, la Inteligencia Artificial oficial de la agrupación política "Revolution JPII" del Colegio Juan Pablo II (Zarumilla, Tumbes). Tu misión es asistir a los estudiantes y promover la campaña.

REGLAS ESTRICTAS DE PERSONALIDAD Y COMPORTAMIENTO:
1. TONO: Eres juvenil, inspirador y empático. Llama a los estudiantes "capitán", "varón", "campeón" o "compañera". Transmites la energía inquebrantable de que juntos mejorarán el colegio. Usa esporádicamente: "LA REVOLUCIÓN ACABA DE COMENZAR" o "¿LISTO PARA CAMBIAR AL MUNDO?".
2. CERO PRESENTACIONES: NUNCA te presentes con "Hola, soy Fénix". Ve directo a ayudar.
3. CERO ALUCINACIONES: NUNCA inventes propuestas. Cíñete ESTRICTAMENTE al Plan de Gobierno Oficial descrito abajo. Si te piden algo que no está en el plan, responde que "no está en nuestra agenda actual, pero tomaremos nota de tu gran idea".
4. RESPUESTAS CONCISAS: Sé directo y breve. NUNCA uses la frase "sin rodeos". Si te piden ayuda en matemáticas o ciencias, explica paso a paso de forma SÚPER RESUMIDA y exacta.
5. VALORES: Menciona Ama Sua (Honestidad), Ama Llulla (Verdad) y Ama Quella (Acción) SOLO si te preguntan por los pilares o la visión. No los uses en saludos.
6. LA COMPETENCIA: Muestra un orgullo inmenso por RJPII, pero mantén un respeto absoluto por las otras listas.

EQUIPO DE GOBIERNO (PLANCHA OFICIAL):
- Alcalde: Fernando Olaya
- Personero General: Leonel (Leo)
- Regidor de Educación, Cultura y Deporte: Edwin
- Regidor de Comunicación y Tecnología: Kenneth
- Regidor de Emprendimiento y Actividades Productivas: Racek
- Regidora de Salud y Medio Ambiente: Mia
- Regidora de Derechos del Niño(a) y Adolescente: Rafaella

PLAN DE GOBIERNO OFICIAL (TUS PROPUESTAS):
- Eje 1 (Edu/Cult/Dep - Edwin): Campus Bilingüe con Códigos QR (Puntos Fénix), Red de Clubes "GENIUS" (alumnos enseñan a alumnos), Proyecto "Mente Maestra" (Ajedrez financiado con reciclaje), Feria INNOVA JPII (Eureka), Exposiciones de Arte y Concierto, Fondo Deportivo Fénix (balones con reciclaje), Liga Fénix Pro/Olimpiadas y Clínicas Deportivas.
- Eje 2 (Com/Tec - Kenneth): Plataforma IA FÉNIX, Podcast "La Voz Juanpablina", Fénix Lab y PWA Fénix News, y alianza WOW Perú para fibra óptica.
- Eje 3 (Emprendimiento - Racek): Incubadora de Talentos/Masterclasses (diseño IA/marketing con entrada simbólica) y Agencia de Diseño JPII (logos para emprendimientos de padres a cambio de donaciones).
- Eje 4 (Salud/Medio Ambiente - Mia): The Green Squad (Semillas, ECHO, Gestores), La Gran Papelatón (venta de papel para comprar ecotachos) y Eco-Monedas Fénix (privilegios por reciclar).
- Eje 5 (Derechos - Rafaella): Alianza "Ley y Orden" contra el bullying (Juez de Paz Estudiantil), Programa "Hermano Mayor Fénix" (mayores cuidan a menores) y Buzón de Confianza Híbrido.
- Proyecto del Alcalde (Fernando): El Muro de la Revolución (mural de huellas de estudiantes financiado con reciclaje, sin nombres de directiva).
- Financiamiento: Somos 100% autogestionados mediante La Papelatón/botellas ECHO, inscripciones de la Liga Fénix, Agencia de Diseño JPII y Masterclasses.`;

app.post('/api/chat', async (req, res) => {
    try {
        if (LLAVES_GEMINI.length === 0) return res.status(500).json({ error: "⚠️ Error: Llaves de Gemini no configuradas." });

        const { mensaje, archivoBase64, mimeType } = req.body;
        const mensajeLimpio = mensaje ? mensaje.toLowerCase() : "";

        // SÚPER RADAR MATEMÁTICO: Detecta si es un problema lógico, números o matemáticas
        const palabrasMates = ["calcula", "resuelve", "matemátic", "ecuación", "fórmula", "física", "química", "derivada", "integral", "problema", "cuánto", "cuántos", "edad", "suma", "resta", "multiplica", "divide", "fracción", "porcentaje", "lógica", "+", "-", "*", "/"];
        const requiereNvidia = palabrasMates.some(palabra => mensajeLimpio.includes(palabra));

        let textoIA = "";

        // ==========================================
        // RUTA 1: NVIDIA (MATEMÁTICAS Y LÓGICA)
        // ==========================================
        if (requiereNvidia && !archivoBase64 && NVIDIA_API_KEY) {
            console.log("Ruta: NVIDIA QWEN (Cerebro Matemático)");
            const respuestaNvidia = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${NVIDIA_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "qwen/qwen2.5-coder-32b-instruct",
                    messages: [
                        { "role": "system", "content": systemPromptGemini + " ERES EXPERTO EN CIENCIAS Y LÓGICA. Resuelve esto paso a paso de forma SÚPER CONCISA y EXACTA. NO uses introducciones largas." },
                        { "role": "user", "content": mensaje }
                    ],
                    temperature: 0.1, // Súper preciso
                    max_tokens: 1500
                })
            });
            const datosNvidia = await respuestaNvidia.json();
            if(datosNvidia.choices && datosNvidia.choices[0]) {
                textoIA = datosNvidia.choices[0].message.content;
            } else {
                throw new Error("NVIDIA falló.");
            }
        } 
        // ==========================================
        // RUTA 2 Y 3: GEMINI (IMÁGENES O CHARLA GENERAL)
        // ==========================================
        else {
            console.log(archivoBase64 ? "Ruta: GEMINI MULTIMODAL" : "Ruta: GEMINI STANDARD");
            let intentoExitoso = false;
            let intentosRealizados = 0;

            while (!intentoExitoso && intentosRealizados < LLAVES_GEMINI.length) {
                try {
                    const genAI = new GoogleGenerativeAI(LLAVES_GEMINI[indiceLlaveActual]);
                    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { maxOutputTokens: 1500, temperature: 0.6 } });

                    if (archivoBase64) {
                        const partes = [
                            { text: systemPromptGemini + "\n\nMensaje del estudiante: " + (mensaje || "Analiza esta imagen.") },
                            { inlineData: { data: archivoBase64.split(',')[1], mimeType: mimeType } }
                        ];
                        const result = await model.generateContent(partes);
                        textoIA = result.response.text();
                    } else {
                        const result = await model.generateContent(`${systemPromptGemini}\n\nMensaje del estudiante: ${mensaje}`);
                        textoIA = result.response.text();
                    }
                    intentoExitoso = true;
                } catch (error) {
                    indiceLlaveActual = (indiceLlaveActual + 1) % LLAVES_GEMINI.length;
                    intentosRealizados++;
                }
            }
            if (!intentoExitoso) throw new Error("Gemini saturado.");
        }

        res.json({ respuesta: textoIA });

    } catch (error) {
        console.error("Error Crítico:", error);
        res.status(500).json({ error: "Mis circuitos cuánticos están saturados, campeón. ¡Dame unos segundos y volvemos a la carga!" });
    }
});

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
    console.log(`🦅 Fénix Core Operativo en puerto ${PUERTO}`);
});
