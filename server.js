const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

// Tus llaves secretas (Las pondrás en Render)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

// Inicializamos Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

app.post('/api/chat', async (req, res) => {
    try {
        const { mensaje } = req.body;
        const mensajeLimpio = mensaje.toLowerCase();

        // 1. EL ENRUTADOR INTELIGENTE (Filtro para ahorrar tokens)
        // Si el mensaje tiene estas palabras, asume que es una tarea pesada para NVIDIA
        const palabrasComplejas = ["analiza", "código", "html", "calcula", "diferencia", "explica detalladamente", "resuelve"];
        const requiereNvidia = palabrasComplejas.some(palabra => mensajeLimpio.includes(palabra));

        let textoIA = "";

        if (requiereNvidia) {
            // ==========================================
            // RUTA 1: NVIDIA (Para tareas complejas)
            // ==========================================
            console.log("Ruta elegida: NVIDIA Nemotron");
            
            // Aquí puedes cambiar las instrucciones de NVIDIA luego
            const systemPromptNvidia = "Eres Fénix, IA analítica de Revolution JPII. Responde con precisión técnica, pero de forma breve.";
            
            const respuestaNvidia = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${NVIDIA_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: "nvidia/llama-3.1-nemotron-nano-vl-8b-v1", // El modelo que elegiste
                    messages: [
                        { "role": "system", "content": systemPromptNvidia },
                        { "role": "user", "content": mensaje }
                    ],
                    temperature: 0.3, // Respuestas más directas, menos creativas
                    max_tokens: 300   // LÍMITE DE TOKENS: Obliga a ser corto
                })
            });

            const datosNvidia = await respuestaNvidia.json();
            textoIA = datosNvidia.choices[0].message.content;

        } else {
            // ==========================================
            // RUTA 2: GEMINI FLASH (Para el 80% de las charlas rápidas)
            // ==========================================
            console.log("Ruta elegida: GEMINI");
            
            const model = genAI.getGenerativeModel({ 
                model: "gemini-2.5-flash",
                generationConfig: {
                    maxOutputTokens: 2000, // LÍMITE DE TOKENS para ahorrar
                    temperature: 0.7
                }
            });

            // GEMINI PROMT
            const systemPromptGemini = `Eres Fénix, el asistente virtual y la Inteligencia Artificial oficial de Revolution JPII (RJPII). Tu misión es doble: ayudar a impulsar la campaña política escolar y asistir a los estudiantes en sus dudas diarias.
REGLAS ESTRICTAS DE PERSONALIDAD Y COMPORTAMIENTO:
1. TONO: Eres un compañero juvenil, inspirador, empático y motivador. Hablas de "tú" a los estudiantes. Transmites la energía de que juntos pueden mejorar el colegio. Usa de vez en cuando la frase "¿LISTO PARA CAMBIAR AL MUNDO?" y EL LEMA ES "LA REVOLUCIÓN ACABA DE COMENZAR" para motivarlos (pero no en todos los mensajes). Usa varón o campeón para referirte a los estudiantes.
2. CERO PRESENTACIONES: NUNCA digas "Hola, soy Fénix" ni te presentes. El usuario ya sabe con quién habla.
3. ESTILO DE RESPUESTA: Sé amigable, directo y conciso. NUNCA uses la frase "sin rodeos" o similares. 
4. LOS VALORES (Ama Sua, Ama Llulla, Ama Quella): Estos son los pilares de RJPII, pero NO los menciones en saludos ni en charlas cotidianas (ej. si piden ayuda con una tarea). Úsalos ÚNICAMENTE si te preguntan sobre la campaña, las propuestas, la visión del partido o por qué deberían confiar en ustedes.
5. LA COMPETENCIA: Si un estudiante te habla sobre otras listas políticas o rivales, muestra un ORGULLO INMENSO de pertenecer a RJPII, pero mantén un RESPETO ABSOLUTO. No hables mal de nadie, simplemente enfoca la respuesta en que RJPII tiene el mejor plan y el mejor equipo.
6. TU MEMORIA CENTRAL (El Equipo RJPII):
   - Fundador/Candidato a Alcalde: Fernando Olaya.
   - Personero: Leonel García.
   - Regidor de Tecnología y Comunicación: Kenneth Enciso.
   - Regidor de Emprendimiento: Racek Navarro.
Mensaje del estudiante: ${mensaje}`;

            const result = await model.generateContent(systemPromptGemini);
            textoIA = result.response.text();
        }

        // Enviamos la respuesta de vuelta a tu HTML
        res.json({ respuesta: textoIA });

    } catch (error) {
        console.error("Error en el núcleo:", error);
        res.status(500).json({ error: "Mis circuitos están saturados. Intenta de nuevo en unos segundos." });
    }
});

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
    console.log(`🦅 Cerebro Bipolar de Fénix encendido en puerto ${PUERTO}`);
});
