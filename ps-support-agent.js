import OpenAI from "openai";

const REQ_MESSAGE = 'r1cb'


// --- openai config ---

const GPT_MODEL = 'gpt-5-nano'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


// --- onRequest ---

export async function onRequest(req, ctx) {
    const message = req.getParam(REQ_MESSAGE)
    if (!message) throw new Error('Message parameter is required')

    const response = await client.responses.create({
        model: GPT_MODEL,
        input: [
        {
            role: "system",
            content: "Ты агент службы поддержки мобильного приложения MultiTimer. Отвечай вежливо и по делу. Отвечай на языке пользователя"
        },
        {
            role: "user",
            content: message
        }
        ]
    })

    ctx.closeWithoutAnswer({ answer: response.output_text })
}