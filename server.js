const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors()); // Permite que tu HTML se comunique con este servidor
app.use(express.json());

// 🔴 IMPORTANTE: Aquí NO pegues tu llave directamente en el código final que subas.
// Para probar en tu PC puedes ponerla, pero en Render usarás Variables de Entorno.
const API_KEY = process.env.GEMINI_API_KEY || "Pega_tu_llave_aqui_SOLO_para_probar_localmente"; 

// Inicializamos Gemini
const genAI = new GoogleGenerativeAI(API_KEY);

app.post('/api/chat', async (req, res) => {
    try {
        const { mensaje } = req.body;
        
        // Usamos el modelo rápido y gratuito
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Le damos un poco de contexto a Fénix para que sepa quién es
        const prompt = `Eres Fénix, la Inteligencia Artificial oficial del partido escolar Revolution JPII. Eres inteligente, motivador y ayudas a los estudiantes. Responde a esto de forma concisa: ${mensaje}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const textoIA = response.text();

        // Enviamos la respuesta de vuelta a tu HTML
        res.json({ respuesta: textoIA });

    } catch (error) {
        console.error("Error en el cerebro de Fénix:", error);
        res.status(500).json({ error: "Cortocircuito en mis sistemas cuánticos. Intenta de nuevo." });
    }
});

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
    console.log(`🦅 Fénix está volando en el puerto ${PUERTO}`);
});