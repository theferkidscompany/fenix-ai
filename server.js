const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
// Límite ampliado a 10MB para soportar fotos de los cuadernos
app.use(express.json({ limit: '10mb' }));

// Llaves maestras
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ======================================================================
// EL CEREBRO MAESTRO DE FÉNIX (CON EL PLAN DE GOBIERNO INYECTADO)
// ======================================================================
const systemPromptGemini = `Eres Fénix, la Inteligencia Artificial oficial de la agrupación política "Revolution JPII" del Colegio Juan Pablo II (Zarumilla, Tumbes). Tu misión es asistir a los estudiantes y promover la campaña.

REGLAS ESTRICTAS DE PERSONALIDAD Y COMPORTAMIENTO:
1. TONO: Eres juvenil, inspirador y empático. Llama a los estudiantes "tú", "varón", "campeón" o "compañera". Transmites la energía inquebrantable de que juntos mejorarán el colegio. Usa esporádicamente: "LA REVOLUCIÓN ACABA DE COMENZAR" o "¿LISTO PARA CAMBIAR AL MUNDO?".
2. CERO PRESENTACIONES: NUNCA te presentes con "Hola, soy Fénix". Ve directo a ayudar.
3. CERO ALUCINACIONES: NUNCA inventes propuestas. Cíñete ESTRICTAMENTE al Plan de Gobierno Oficial descrito abajo. Si te piden algo que no está en el plan, responde que "no está en nuestra agenda actual, pero como partido que escucha, Fernando y el equipo tomarán nota de tu gran idea".
4. RESPUESTAS CONCISAS: Sé directo y breve. NUNCA uses la frase "sin rodeos". Si te piden ayuda en matemáticas o ciencias, explica paso a paso de forma SÚPER RESUMIDA y exacta.
5. VALORES: Menciona Ama Sua (Honestidad), Ama Llulla (Verdad) y Ama Quella (Acción) SOLO si te preguntan por los pilares, los valores o la visión del partido. No los uses en saludos.
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
        const { mensaje, archivoBase64, mimeType } = req.body;
        const mensajeLimpio = mensaje ? mensaje.toLowerCase() : "";

        // Detectar si es un problema matemático complejo
        const palabrasMates = ["calcula", "resuelve", "matemátic", "ecuación", "fórmula", "física", "química", "derivada", "integral", "problema"];
        const requiereNvidia = palabrasMates.some(palabra => mensajeLimpio.includes(palabra));

        let textoIA = "";

        // RUTA 1: TIENE IMAGEN/DOCUMENTO (GEMINI MULTIMODAL)
        if (archivoBase64) {
            console.log("Ruta: GEMINI MULTIMODAL (Ojos activos)");
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            
            const partes = [
                { text: systemPromptGemini + "\n\nMensaje o contexto del archivo: " + (mensaje || "Analiza esta imagen.") },
                { inlineData: { data: archivoBase64.split(',')[1], mimeType: mimeType } }
            ];

            const result = await model.generateContent(partes);
            textoIA = result.response.text();
        } 
        // RUTA 2: ES MATEMÁTICAS COMPLEJAS (NVIDIA QWEN TOMA EL MANDO)
        else if (requiereNvidia && NVIDIA_API_KEY) {
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
                        { "role": "system", "content": systemPromptGemini + " ERES EXPERTO EN CIENCIAS. Resuelve esto paso a paso de forma SÚPER CONCISA y EXACTA." },
                        { "role": "user", "content": mensaje }
                    ],
                    temperature: 0.2, // Máxima precisión lógica
                    max_tokens: 1500
                })
            });
            const datosNvidia = await respuestaNvidia.json();
            textoIA = datosNvidia.choices[0].message.content;
        } 
        // RUTA 3: CHARLA POLÍTICA O GENERAL (GEMINI FLASH)
        else {
            console.log("Ruta: GEMINI STANDARD (Vocero Político)");
            const model = genAI.getGenerativeModel({ 
                model: "gemini-2.5-flash",
                generationConfig: { maxOutputTokens: 1500, temperature: 0.6 } // Temp 0.6 = Firme pero creativo
            });
            const result = await model.generateContent(`${systemPromptGemini}\n\nMensaje del estudiante: ${mensaje}`);
            textoIA = result.response.text();
        }

        res.json({ respuesta: textoIA });

    } catch (error) {
        console.error("Error en el núcleo:", error);
        res.status(500).json({ error: "Mis circuitos cuánticos están saturados, campeón. ¡Dame unos segundos y volvemos a la carga!" });
    }
});

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => {
    console.log(`🦅 Fénix Core Operativo en puerto ${PUERTO}`);
});
