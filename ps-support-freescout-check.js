
const REQ_ID = 'a28q'
const RES_SUCCESS = 'su2c'
const RES_REASON = 'gd3s'

const GPT_SCRIPT_NAME = 'com.persapps.support.freescout.check.gpt'
const GPT_SCRIPT_VERSION = '1.0.*'
const GPT_REQ_MESSAGE = 'n1jn'
const GTP_REQ_SOURCE_URL = 'fa0x'
const GTP_RES_SUCCESS = 'su2c'
const GTP_RES_REASON = 'gd3s'
const GTP_RES_THEME_INDEX = 'b3m4'
const GTP_RES_APP_INDEX = 'a9k2'


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


// --- operations ---

const VAL_CONVERSATION_ID = 'v0j7'

async function retry(fn, attempts = 0, delay = 0) {
    let lastError

    for (let i = 0; i <= attempts; i++) {
        try {
            return await fn()
        } catch (err) {
            lastError = err

            // если это последняя попытка — пробрасываем ошибку
            if (i === attempts) {
                throw lastError
            }

            // пауза перед следующей попыткой
            if (delay > 0) {
                await new Promise(res => setTimeout(res, delay))
            }
        }
    }
}

async function getFreescoutItem(id) {
    return await retry(async () => {
        const item = await freescout(`/api/conversations/${id}`)
        if (!item) throw new Error(`Freescout item with ID ${id} not found`)
        return item
    }, 2, 100) // + 2 попытки, 100 мсек между ними
}

function stripHtml(input) {
    return String(input)
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

function getCustomerName(customer) {
    if (!customer) return 'N/A'
    const firstName = customer.firstName ?? ''
    const lastName = customer.lastName ?? ''
    const fullName = `${firstName} ${lastName}`.trim()
    return fullName || 'N/A'
}

function getCustomerTitle(customer) {
    if (!customer) return 'N/A'
    const name = getCustomerName(customer)
    if (customer.type === 'user') {
        return `Support: ${name}`
    } else {
        return `Customer: ${name}`
    }
}

function getMessage(item) {

    const threads = item._embedded?.threads ?? []
    if (threads.length === 0) {
        return ''
    }

    let texts = []
    texts.push(getCustomerTitle(item.customer))
    texts.push(`Subject: ${item.subject ?? 'N/A'}`)

    for (const field of item.customFields ?? []) {
        if (field.value) {
            texts.push(`${field.name}: ${field.value}`)
        }
    }

    for (let i = threads.length - 1; i >= 0; i--) {
        const thread = threads[i]
        if (!thread.body) continue

        texts.push('')
        texts.push(`--- ${getCustomerTitle(thread.createdBy)} ---`)
        texts.push(stripHtml(thread.body))
    }

    const limit = 800;

    const fullText = texts.join('\n')
    if (fullText.length > limit) {
        return fullText.slice(0, limit) + '...'
    }

    return fullText
}

async function setFreescoutField(id, themeIndex, appIndex) {

    let customFields = []
    if (themeIndex) customFields.push({ id: FREESCOUT_THEME_INDEX, value: themeIndex })
    if (appIndex) customFields.push({ id: FREESCOUT_APP_INDEX, value: appIndex })

    await freescout(`/api/conversations/${id}/custom_fields`, 'PUT', { customFields })
}


// --- onRequest ---

export async function onRequest(req, ctx) {
    const id = req.getParam(REQ_ID)
    if (!id) throw new Error('ID parameter is required')

    const item = await getFreescoutItem(id)    
    const theme = item.customFields?.find(f => f.id === FREESCOUT_THEME_INDEX)?.value
    const app = item.customFields?.find(f => f.id === FREESCOUT_APP_INDEX)?.value

    if (theme && app) {
        ctx.close({ [RES_SUCCESS]: true, [RES_REASON]: 'Already handled' })
        return
    }

    const message = getMessage(item)
    if (!message) throw new Error('Message content is empty')

    ctx.setValue(VAL_CONVERSATION_ID, item.id)

    const sourceUrl = `${process.env.FREESCOUT_HOST}/conversation/${id}`
    ctx.pushRequest(GPT_SCRIPT_NAME, GPT_SCRIPT_VERSION, {
        [GPT_REQ_MESSAGE]: message,
        [GTP_REQ_SOURCE_URL]: sourceUrl,
    })
}


// --- onResponse ---

export async function onResponse(responses, req, ctx) {
    const resultString = responses[0]?.result
    if (!resultString) throw new Error('No response received from confirmation script')
    const result = JSON.parse(resultString)

    if (!result[GTP_RES_SUCCESS]) {
        ctx.close({
            [RES_SUCCESS]: false,
            [RES_REASON]: result[GTP_RES_REASON]
        })
        return
    }

    const id = ctx.getValue(VAL_CONVERSATION_ID)
    await setFreescoutField(id, result[GTP_RES_THEME_INDEX], result[GTP_RES_APP_INDEX])

    ctx.close({
        [RES_SUCCESS]: true,
    })
}