import OpenAI from "openai";

const REQ_MESSAGE = 'n1jn'

const CONFIRM_SCRIPT_NAME = 'com.persapps.confirm'
const CONFIRM_SCRIPT_VERSION = '1.0.*'
const CONFIRM_REQ_TITLE = 'tob7'
const CONFIRM_RES_SOURCE = 'aid4'
const CONFIRM_RES_ACTION = 'b8om'
const CONFIRM_RES_DESCRIPTION = 'e7kx'


// --- openai config ---

const GPT_MODEL = 'gpt-5-nano'

const GPT_PROMPT = `Ты — агент службы поддержки и первый, кто обрабатывает входящие сообщения от пользователей.
Твоя задача — проанализировать текст сообщения и определить:
- Тип запроса (theme)
- Приложение, к которому он относится (app)
Возможные значения theme:
- 1: 'Application error'
- 2: 'Question about the application'
- 3: 'Suggestion of new feature'
- 0: 'Other'
Возможные значения app:
- 1: 'MultiTimer (iOS)'
- 2: 'MultiTimer (macOS)'
- 3: 'MultiTimer (Android)'
- 4: 'Reminder'
- 5: 'iSmartMMS'
- 0: 'Other'
Правила:
Выбирай только одно значение из каждого списка
Если невозможно точно определить — выбирай 'Other'
Не добавляй пояснений или лишнего текста
Ответ должен быть строго в JSON формате
Формат ответа:
{
  "theme": "<индекст выбранного значения>",
  "app": "<индекст выбранного значения>",
  "decsription": "<объяснение на русском языке, почему ты выбрал эти значения>",
  "probability": "<оценка от 0 до 10, насколько ты уверен в своем выборе>"
}`

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
            { role: "system", content: GPT_PROMPT },
            { role: "user", content: message }
        ]
    })

    ctx.close({
        status: 'request',
        message: message,
        response: JSON.parse(response.output_text),
    })
}


// --- onResponse ---

export async function onResponse(responses, req, ctx) {

    ctx.close({
        status: 'response',
        responses: responses,
    })
}