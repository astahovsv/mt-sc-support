import OpenAI from "openai"

const REQ_MESSAGE = 'n1jn'
const REQ_SOURCE_URL = 'fa0x'
const RES_SUCCESS = 'su2c'
const RES_REASON = 'gd3s'
const RES_THEME_INDEX = 'b3m4'
const RES_APP_INDEX = 'a9k2'

const RES_DATA_TYPE = 'cf5d'
const RES_DATA_APP = 'cj0z'
const RES_DATA_CONFIDENCE = 'x0dk'

const APR_SCRIPT_NAME = 'com.persapps.approval'
const APR_SCRIPT_VERSION = '1.0.*'
const APR_REQ_TYPE = 'hn4a' // тип запроса
const APR_REQ_ACTION = 'b8om' // выполняемое действие
const APR_REQ_REASON = 'e7kx' // причина, объяснение
const APR_REQ_SOURCES = 'r3jv' // ресурсы на основе которых или с которыми будут эти действия выполняться
const APR_REQ_DATA = 'bk3f' // данные для выполнения
const APR_RES_ANSWER = 'h8vg'
const APR_RES_COMMENT = 'uj8m'

const APR_ANSWER_ACCEPTED = 'j7cf'
const APR_ANSWER_REJECTED = 'co9g'
const APR_ANSWER_COMMENT = 'l5jo'
const APR_ANSWER_REVISE = 'ko3x'


// --- freescout ---

async function fetchJson(url, options = {}) {
    const res = await fetch(url, options)
    if (!res.ok) return null
    const text = await res.text()
    return (text) ? JSON.parse(text) : null
}

async function freescout(query, method = 'GET', body = undefined) {
    const bodyString = (body) ? JSON.stringify(body) : undefined

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

const VAL_FIELDS = 'fields'
const VAL_THEME = 'theme'
const VAL_APP = 'app'

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
    return `You are a classification engine for customer support messages.

Your task is to analyze the provided customer message and determine:
- theme
- app

Available theme values (you MUST return one of these exact strings):
${fields[VAL_THEME].map(t => `- '${t.name}'`).join('\n')}

Available app values (you MUST return one of these exact strings):
${fields[VAL_APP].map(a => `- '${a.name}'`).join('\n')}

Rules:
- Return exactly one theme and one app.
- Values MUST be exact matches from the lists above (no variations, no synonyms).
- If the theme or app cannot be determined confidently, choose the most appropriate option from the list.
- If the message contains only general feedback without a clear question, bug report, or feature suggestion, classify it as 'Other'.
- Do not answer the customer.
- Do not suggest actions.
- Do not ask follow-up questions.
- Description must explain the classification decision in Russian.
- Confidence must be your subjective confidence that the classification is correct, from 0.0 to 1.0.
- Return ONLY valid JSON with no extra text.

Response format:
{
  "theme": "<exact theme string>",
  "app": "<exact app string>",
  "description": "<Russian explanation>",
  "confidence": <number from 0.0 to 1.0>
}`
}

function prepareComment(comment) {
    return `REVIEW COMMENT:
\`\`\`
${comment}
\`\`\`

Re-evaluate the classification from scratch.

Priority rules:
- The review comment MUST be taken into account when performing classification.
- Returned values MUST exactly match one of the allowed options (no free text).
- Do not answer the customer.
- Do not continue the conversation.
- Produce only the final classification result.

Return ONLY valid JSON in the required format.`
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

function parseAIAnswer(ctx, output) {

    const answer = JSON.parse(output)
    if (typeof answer !== 'object' || answer === null) {
        throw new Error('Invalid response: ' + output)
    }

    const fields = ctx.getValue(VAL_FIELDS)

    const themeValue = answer.theme
    if (!themeValue) throw new Error('Missed theme in response: ' + output)
    const theme = fields[VAL_THEME].find(t => t.name.toLowerCase() === themeValue.toLowerCase())
    if (!theme) throw new Error('Invalid response: ' + output)

    const appValue = answer.app
    if (!appValue) throw new Error('Missed app in response: ' + output)
    const app = fields[VAL_APP].find(a => a.name.toLowerCase() === appValue.toLowerCase())
    if (!app) throw new Error('Invalid response:  ' + output)

    if (!answer.description) {
        throw new Error('Missed description in response:  ' + output)
    }

    return { 
        theme: theme, 
        app: app, 
        confidence: Number(answer.confidence) || 0, 
        description: answer.description
    }
}

const VAL_LAST_OUTPUT = 'last_output'
const VAL_LAST_RESPONSE_ID = 'last_response_id'

async function performAIRequest(ctx, message) {
    let response = null

    const previous_response_id = ctx.getValue(VAL_LAST_RESPONSE_ID)
    if (previous_response_id) {
         // Продолжение беседы
        response = await client.responses.create({
            model: GPT_MODEL,
            input: message,
            previous_response_id,
        })
    } else {
         // Новая беседа
        const fields = ctx.getValue(VAL_FIELDS)
        const prompt = createPrompt(fields)
        response = await client.responses.create({
            model: GPT_MODEL,
            instructions: prompt,
            input: message
        })
    }

    // Для продолжения беседы
    ctx.setValue(VAL_LAST_RESPONSE_ID, response.id)
    // Для аналитики
    ctx.setValue(VAL_LAST_OUTPUT, response.output_text)

    return response.output_text
}

function sendConfirmRequest(req, ctx, answer) {

    // Пригодится при получении ответов
    ctx.setValue(VAL_THEME, answer.theme.id)
    ctx.setValue(VAL_APP, answer.app.id)

    ctx.pushRequest(APR_SCRIPT_NAME, APR_SCRIPT_VERSION, {
        [APR_REQ_TYPE]: 'w7bg',
        [APR_REQ_ACTION]: `New properties:\nTheme => ${answer.theme.name}\nApp => ${answer.app.name}`,
        [APR_REQ_REASON]: `Уверенность: ${answer.confidence}\n${answer.description}`,
        [APR_REQ_SOURCES]: [
            req.getParam(REQ_SOURCE_URL),
            req.getParam(REQ_MESSAGE),
        ],
        [APR_REQ_DATA]: {
            [RES_DATA_CONFIDENCE]: answer.confidence,
            [RES_DATA_TYPE]: answer.theme.id,
            [RES_DATA_APP]: answer.app.id,
        }
    })
}


// --- onRequest ---

export async function onRequest(req, ctx) {
    console.log(`onRequest:1: start`)
    const message = req.getParam(REQ_MESSAGE)
    if (!message) throw new Error('Message parameter is required')

    console.log(`onRequest:2: getFreescoutFields()`)
    const fields = await getFreescoutFields()
    ctx.setValue(VAL_FIELDS, fields)

    let answer = null
    try {
        console.log(`onRequest:3: performAIRequest()`)
        const output = await performAIRequest(ctx, message)
        answer = parseAIAnswer(ctx, output)
    } catch {
        // Попробуем ещё раз
        console.log(`onRequest:4: performAIRequest()`)
        ctx.setValue(VAL_LAST_RESPONSE_ID, null)
        const output = await performAIRequest(ctx, message)
        answer = parseAIAnswer(ctx, output)
    }

    console.log(`onRequest:5: sendConfirmRequest()`)
    sendConfirmRequest(req, ctx, answer)
    console.log(`onRequest:6: finish`)
}


// --- onResponse ---

export async function onResponse(responses, req, ctx) {
    console.log(`onResponse:1: start`)
    const resultString = responses[0]?.result
    if (!resultString) throw new Error('No response received from confirmation script')
    const result = JSON.parse(resultString)

    const cnfAnswer = result[APR_RES_ANSWER]
    if (cnfAnswer === APR_ANSWER_ACCEPTED) {
        // Получено согласие
        console.log(`onResponse:2: close()`)
        ctx.close({
            [RES_SUCCESS]: true,
            [RES_THEME_INDEX]: ctx.getValue(VAL_THEME),
            [RES_APP_INDEX]: ctx.getValue(VAL_APP),
        })
    } 
    else if (cnfAnswer === APR_ANSWER_COMMENT) {
        // Получен комментарий

        const comment = result[APR_RES_COMMENT]?.trim()
        if (!comment) {
            console.log(`onResponse:3: close()`)
            ctx.close({
                [RES_SUCCESS]: false,
                [RES_REASON]: 'Not confirmed.',
            })
            return
        }

        let answer = null
        try {
            console.log(`onResponse:4: performAIRequest()`)
            const message = prepareComment(comment)
            const output = await performAIRequest(ctx, message)
            answer = parseAIAnswer(ctx, output)
        } catch {
            // Попробуем ещё раз
            console.log(`onResponse:5: performAIRequest()`)
            ctx.setValue(VAL_LAST_RESPONSE_ID, null)
            const message = `${req.getParam(REQ_MESSAGE)}\n\n${comment}`
            const output = await performAIRequest(ctx, message)
            answer = parseAIAnswer(ctx, output)
        }

        console.log(`onResponse:6: sendConfirmRequest()`)
        sendConfirmRequest(req, ctx, answer)
    } 
    else if (cnfAnswer === APR_ANSWER_REVISE) {
        // Получен запрос на доработку

        ctx.setValue(VAL_LAST_RESPONSE_ID, null)
        console.log(`onResponse:7: performAIRequest()`)
        const output = await performAIRequest(ctx, req.getParam(REQ_MESSAGE))
        const answer = parseAIAnswer(ctx, output)
        
        if (!answer.theme || !answer.app) {
            console.log(`onResponse:8: close()`)
            ctx.close({
                [RES_SUCCESS]: false,
                [RES_REASON]: 'Theme and applications are not defined, content: ' + ctx.getValue(VAL_LAST_OUTPUT)
            })
            return
        }

        console.log(`onResponse:9: sendConfirmRequest()`)
        sendConfirmRequest(req, ctx, answer)
    }
    else if (cnfAnswer === APR_ANSWER_REJECTED) {
        // Получен отказ
        console.log(`onResponse:10: close()`)
        ctx.close({
            [RES_SUCCESS]: false,
            [RES_REASON]: 'Reject.',
        })
    }
    else {
        throw new Error(`Unsupported answer: ${cnfAnswer}`)
    }
    console.log(`onResponse:11: finish`)
}