import OpenAI from "openai"

const REQ_MESSAGE = 'n1jn'
const REQ_SOURCE_URL = 'fa0x'
const RES_SUCCESS = 'su2c'
const RES_REASON = 'gd3s'
const RES_THEME_INDEX = 'b3m4'
const RES_APP_INDEX = 'a9k2'

const CNF_SCRIPT_NAME = 'com.persapps.confirm'
const CNF_SCRIPT_VERSION = '1.0.*'
const CNF_REQ_DOC_TYPE = 'hn4a'
const CNF_REQ_SOURCE = 'aid4'
const CNF_REQ_SOURCE_URL = 'ez8b'
const CNF_REQ_ACTION = 'b8om'
const CNF_REQ_DESCRIPTION = 'e7kx'

const CNF_RES_AGREE = 'me6w'
const CNF_RES_MESSAGE = 'n8q7'


// --- freescout ---

async function fetchJson(url, options = {}) {
    const res = await fetch(url, options)
    if (!res.ok) return null
    const text = await res.text()
    return (text) ? JSON.parse(text) : null
}

async function freescout(query, method = 'GET', body = undefined) {
    const bodyString = (body) ? JSON.stringify(body) : undefined
    console.log(`freescout => ${method} ${query}, ${bodyString}`)

    const url = new URL(query, process.env.FREESCOUT_HOST)
    return await fetchJson(url.toString(), {
        method,
        headers: {
            'X-FreeScout-API-Key': process.env.FREESCOUT_API_KEY,
            "Content-Type": "application/json",
            'Accept': 'application/json',
        },
        body: bodyString
    })
}

const FREESCOUT_THEME_INDEX = 2
const FREESCOUT_APP_INDEX = 1

// --- openai ---

const GPT_MODEL = 'gpt-5-nano'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})


// --- operations ---

const VAL_RESPONSE_ID = 'response_id'
const VAL_FIELDS = 'fields'
const VAL_THEME = 'theme'
const VAL_APP = 'app'
const VAL_LAST_ANSWER = 'last_answer'

async function getFreescoutFields(id) {
    const data = await freescout(`/api/mailboxes/1/custom_fields`)
    if (!data) throw new Error('Invalid response from FreeScout API')
    
    let fields = {}
    for (const item of data._embedded?.custom_fields || []) {
        let values = []
        for (const key in item.options) {
            values.push({ id: key, name: item.options[key] })
        }
        if (item.id === FREESCOUT_THEME_INDEX) { // Type of request
            fields[VAL_THEME] = values
        } else if (item.id === FREESCOUT_APP_INDEX) { // Application
            fields[VAL_APP] = values
        }
    }

    if (!fields[VAL_THEME] || !fields[VAL_APP]) {
        throw new Error('Required parameters not found in FreeScout response')
    }
    
    return fields
}

function createPrompt(fields) {
    return `Ты — агент службы поддержки и первый, кто обрабатывает входящие сообщения от пользователей.
Твоя задача — проанализировать текст сообщения и определить:
- Тип запроса (theme)
- Приложение, к которому он относится (app)
Возможные значения theme:
${fields[VAL_THEME].map(t => `- ${t.id}: '${t.name}'`).join('\n')}
Возможные значения app:
${fields[VAL_APP].map(a => `- ${a.id}: '${a.name}'`).join('\n')}
Правила:
Выбирай одно значение из списка либо 0, если не можешь определить точно.
Если сообщение не относится к службе поддержки то выбирай тему - 'Other'.
Не добавляй пояснений или лишнего текста.
Ответ должен быть строго в JSON формате.
Формат ответа:
{
  "theme": <индекст выбранного значения>,
  "app": <индекст выбранного значения>,
  "description": "<объяснение на русском языке, почему ты выбрал эти значения>",
  "probability": <оценка от 0.0 до 1.0, насколько ты уверен в своем выборе>
}`
}

function parseNumber(value, fieldName) {

    if (typeof value === 'number') {
        if (!Number.isInteger(value)) {
            throw new Error(`Field "${fieldName}" must be integer`)
        }
        return value
    }

    if (typeof value === 'string') {
        if (!/^\d+$/.test(value)) {
            throw new Error(`Field "${fieldName}" must be numeric string`)
        }
        return Number(value)
    }

    throw new Error(`Field "${fieldName}" must be number`)
}


function parseAnswer(output_text, fields) {

    const answer = JSON.parse(output_text)
    if (typeof answer !== 'object' || answer === null) {
        throw new Error('Invalid response: ' + output_text)
    }

    const themeIndex = parseNumber(answer.theme, 'theme')
    const appIndex = parseNumber(answer.app, 'app')

    let theme = null
    if (themeIndex > 0) {
        theme = fields[VAL_THEME].find(t => Number(t.id) === themeIndex)
        if (!theme) throw new Error('Invalid response: ' + output_text)
    }

    let app = null
    if (appIndex > 0) {
        app = fields[VAL_APP].find(a => Number(a.id) === appIndex)
        if (!app) throw new Error('Invalid response:  ' + output_text)
    }

    if (!answer.description) {
        throw new Error('Invalid response:  ' + output_text)
    }

    return { 
        theme: theme, 
        app: app, 
        probability: Number(answer.probability) || 0, 
        description: answer.description
    }
}

async function handleGPTResponse(req, ctx, response) {

    ctx.setValue(VAL_LAST_ANSWER, response.output_text)

    const fields = ctx.getValue(VAL_FIELDS)
    let answer = null

    try {
        answer = parseAnswer(response.output_text, fields)
    } catch {
        // Попробуем запросить корректный ответ
        const response2 = await client.responses.create({
            model: GPT_MODEL,
            input: 'Внимательно посмотри на формат ответа и попробуй ещё раз!',
            previous_response_id: response.id,
        })
        answer = parseAnswer(response2.output_text, fields)
    }

    if (!answer.theme || !answer.app) {
        ctx.close({
            [RES_SUCCESS]: false,
            [RES_REASON]: 'Theme and applications are not defined, content: ' + response.output_text
        })
        return
    }

    if (answer.probability >= 0.7) {
        // Доверяем выбору бота
        ctx.close({
            [RES_SUCCESS]: true,
            [RES_THEME_INDEX]: answer.theme?.id,
            [RES_APP_INDEX]: answer.app?.id,
        })
        return
    }

    ctx.setValue(VAL_RESPONSE_ID, response.id)
    ctx.setValue(VAL_THEME, answer.theme?.id)
    ctx.setValue(VAL_APP, answer.app?.id)

    ctx.pushRequest(CNF_SCRIPT_NAME, CNF_SCRIPT_VERSION, {
        [CNF_REQ_DOC_TYPE]: 'w7bg',
        [CNF_REQ_SOURCE]: req.getParam(REQ_MESSAGE),
        [CNF_REQ_SOURCE_URL]: req.getParam(REQ_SOURCE_URL),
        [CNF_REQ_ACTION]: `New properties:\nTheme => ${answer.theme?.name}\nApp => ${answer.app?.name}`,
        [CNF_REQ_DESCRIPTION]: `Probability: ${answer.probability}\n${answer.description}`,
    })
}

// --- onRequest ---

export async function onRequest(req, ctx) {
    const message = req.getParam(REQ_MESSAGE)
    if (!message) throw new Error('Message parameter is required')

    const fields = await getFreescoutFields()
    ctx.setValue(VAL_FIELDS, fields)

    const prompt = createPrompt(fields)

    const response = await client.responses.create({
        model: GPT_MODEL,
        instructions: prompt,
        input: message
    })

    handleGPTResponse(req, ctx, response)
}


// --- onResponse ---

export async function onResponse(responses, req, ctx) {
    const resultString = responses[0]?.result
    if (!resultString) throw new Error('No response received from confirmation script')
    const result = JSON.parse(resultString)

    const egree = result[CNF_RES_AGREE]
    if (egree) {
        ctx.close({
            [RES_SUCCESS]: true,
            [RES_THEME_INDEX]: ctx.getValue(VAL_THEME),
            [RES_APP_INDEX]: ctx.getValue(VAL_APP),
        })
        return
    }

    const comment = result[CNF_RES_MESSAGE]?.trim()
    if (!comment) {
        ctx.close({
            [RES_SUCCESS]: false,
            [RES_REASON]: 'Not confirmed.',
        })
        return
    }

    const responseId = ctx.getValue(VAL_RESPONSE_ID)
    const response = await client.responses.create({
        model: GPT_MODEL,
        input: comment,
        previous_response_id: responseId,
    })

    handleGPTResponse(req, ctx, response)
}