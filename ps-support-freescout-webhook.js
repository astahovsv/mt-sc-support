import * as crypto from 'node:crypto'

const CHECK_SCRIPT_NAME = 'com.persapps.support.freescout.check'
const CHECK_SCRIPT_VERSION = '1.0.*'
const CHECK_REQ_ID = 'a28q'


// --- operations ---

const WEBHOOK_SECRET = process.env.FREESCOUT_WEBHOOK_SECRET

function verifySignature(req) {
    const headers = req.getParam('headers') || {}

    const signature = headers['x-freescout-signature']
    if (!signature) {
        throw new Error('Missing X-FreeScout-Signature')
    }

    const body = req.getParam('body')
    const expected = crypto
        .createHmac('sha1', WEBHOOK_SECRET)
        .update(body, 'utf8')
        .digest('base64')

    if (!crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
    )) {
        throw new Error('Invalid signature')
    }
}


// --- onWebhook ---

export async function onWebhook(req, ctx) {
    verifySignature(req)

    const body = req.getParam('body')
    const update = JSON.parse(body)

    const id = update.id
    if (!id) throw new Error(`Missed ID`)
    
    ctx.pushRequest(CHECK_SCRIPT_NAME, CHECK_SCRIPT_VERSION, {
        [CHECK_REQ_ID]: id
    })
}


// --- onResponse ---

export async function onResponse(responses, req, ctx) {

    ctx.close({
        ok: true,
        responses: responses,
    })
}
