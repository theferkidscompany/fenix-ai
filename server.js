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
                model: "gemini-1.5-flash",
                generationConfig: {
                    maxOutputTokens: 250, // LÍMITE DE TOKENS para ahorrar
                    temperature: 0.7
                }
            });

            // Aquí puedes cambiar las instrucciones de Gemini luego
            const systemPromptGemini = `Eres Fénix, la IA de la agrupación escolar Revolution JPII. Eres amigable, motivador y directo. El usuario dice: ${mensaje}`;

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