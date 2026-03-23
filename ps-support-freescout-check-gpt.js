import OpenAI from "openai";

const REQ_MESSAGE = 'n1jn'
const RES_THEME = 'b3m4'
const RES_APP = 'a9k2'

const THEMES = [
    { id: 1, name: 'Application error' },
    { id: 2, name: 'Question about the application' },
    { id: 3, name: 'Suggestion of new feature' },
    { id: 0, name: 'Other' }
]
const APPLICATIONS = [
    { id: 1, name: 'MultiTimer (iOS)' },
    { id: 2, name: 'MultiTimer (macOS)' },
    { id: 3, name: 'MultiTimer (Android)' },
    { id: 4, name: 'Reminder' },
    { id: 5, name: 'iSmartMMS' },
    { id: 0, name: 'Other' }
]

const CNF_SCRIPT_NAME = 'com.persapps.confirm'
const CNF_SCRIPT_VERSION = '1.0.*'
const CNF_REQ_DOC_TYPE = 'hn4a'
const CNF_REQ_SOURCE = 'aid4'
const CNF_REQ_ACTION = 'b8om'
const CNF_REQ_DESCRIPTION = 'e7kx'

const CNF_RES_AGREE = 'me6w'
const CNF_RES_MESSAGE = 'n8q7'


// --- openai config ---

const GPT_MODEL = 'gpt-5-nano'

const GPT_PROMPT = `Ты — агент службы поддержки и первый, кто обрабатывает входящие сообщения от пользователей.
Твоя задача — проанализировать текст сообщения и определить:
- Тип запроса (theme)
- Приложение, к которому он относится (app)
Возможные значения theme:
${THEMES.map(t => `- ${t.id}: '${t.name}'`).join('\n')}
Возможные значения app:
${APPLICATIONS.map(a => `- ${a.id}: '${a.name}'`).join('\n')}
Правила:
Выбирай только одно значение из каждого списка
Если невозможно точно определить — выбирай 'Other'
Не добавляй пояснений или лишнего текста
Ответ должен быть строго в JSON формате
Формат ответа:
{
  "theme": "<индекст выбранного значения>",
  "app": "<индекст выбранного значения>",
  "description": "<объяснение на русском языке, почему ты выбрал эти значения>",
  "probability": "<оценка от 0 до 10, насколько ты уверен в своем выборе>"
}`

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


// --- onRequest ---

const VAL_THEME = 'theme'
const VAL_APP = 'app'

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

    const answer = JSON.parse(response.output_text)
    const theme = THEMES.find(t => t.id.toString() === answer.theme)
    if (!theme) throw new Error('Invalid theme index in response: ' + response.output_text)
    const app = APPLICATIONS.find(a => a.id.toString() === answer.app)
    if (!app) throw new Error('Invalid app index in response: ' + response.output_text)
    const description = answer.description || ''
    const probability = Number(answer.probability) || 0

    ctx.setValue(VAL_THEME, theme.id)
    ctx.setValue(VAL_APP, app.id)

    ctx.pushRequest(CNF_SCRIPT_NAME, CNF_SCRIPT_VERSION, {
        [CNF_REQ_DOC_TYPE]: 'w7bg',
        [CNF_REQ_SOURCE]: message,
        [CNF_REQ_ACTION]: `Theme => ${theme.name}\nApp => ${app.name}\nProbability => ${probability}`,
        [CNF_REQ_DESCRIPTION]: description,
    })
}


// --- onResponse ---

export async function onResponse(responses, req, ctx) {
    const response = responses[0]
    if (!response) throw new Error('No response received from confirmation script')
    
    const result = JSON.parse(response.result)

    const egree = result[CNF_RES_AGREE]
    if (egree) {
        ctx.close({
            [RES_THEME]: ctx.getValue(VAL_THEME),
            [RES_APP]: ctx.getValue(VAL_APP),
        })
    } else {
        ctx.close({
            'message': result[CNF_RES_MESSAGE],
        })
    }    
}