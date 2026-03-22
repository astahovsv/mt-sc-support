import OpenAI from "openai";

const REQ_MESSAGE = 'r1cb'

const CONFIRM_SCRIPT_NAME = 'com.persapps.confirm'
const CONFIRM_SCRIPT_VERSION = '1.0.*'
const CONFIRM_REQ_TITLE = 'tob7'
const CONFIRM_RES_SOURCE = 'aid4'
const CONFIRM_RES_DESCRIPTION = 'e7kx'
const CONFIRM_RES_ACTION = 'b8om'


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

    ctx.pushRequest(CONFIRM_SCRIPT_NAME, CONFIRM_SCRIPT_VERSION, {
        [CONFIRM_REQ_TITLE]: 'Request for confirmation',
        [CONFIRM_RES_SOURCE]: 'Support Agent',
        [CONFIRM_RES_DESCRIPTION]: message,
        [CONFIRM_RES_ACTION]: response.output_text
    })
}


// --- onResponse ---

export async function onResponse(responses, req, ctx) {

    ctx.close({
        ok: true,
        responses: responses,
    })
}