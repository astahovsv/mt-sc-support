
const REQ_ID = 'a28q'
const RES_OK = 'ylh1'
const RES_REASON = 'gd3s'

const GPT_SCRIPT_NAME = 'com.persapps.support.freescout.check.gpt'
const GPT_SCRIPT_VERSION = '1.0.*'
const GPT_REQ_MESSAGE = 'n1jn'


// --- freescout config ---

const FREESCOUT_HOST = process.env.FREESCOUT_HOST
if (!FREESCOUT_HOST) throw new Error('Missing FREESCOUT_HOST')

const FREESCOUT_API_KEY = process.env.FREESCOUT_API_KEY
if (!FREESCOUT_API_KEY) throw new Error('Missing FREESCOUT_API_KEY')

async function fetchJson(url, options = {}) {
    const res = await fetch(url, options)
    const text = await res.text()
    return res.ok ? JSON.parse(text) : null
}

async function freescout(query) {
    const url = new URL(query, FREESCOUT_HOST)

    return await fetchJson(url.toString(), {
        method: 'GET',
        headers: {
            'X-FreeScout-API-Key': FREESCOUT_API_KEY,
            'Accept': 'application/json',
        },
    })
}


// --- operations ---

async function getFreescoutItem(id) {
    return await freescout(`/api/conversations/${id}`)
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

    return texts.join('\n')
}


// --- onRequest ---

export async function onRequest(req, ctx) {
    const id = req.getParam(REQ_ID)
    if (!id) throw new Error('ID parameter is required')

    const item = await getFreescoutItem(id)
    if (!item) throw new Error(`Freescout item with ID ${id} not found`)
    
    const theme = item.customFields?.find(f => f.id === 2)?.value
    const app = item.customFields?.find(f => f.id === 1)?.value

    if (theme && app) {
        ctx.close({ [RES_OK]: true, [RES_REASON]: 'Already handled' })
        return
    }

    const message = getMessage(item)
    if (!message) throw new Error('Message content is empty')

    ctx.pushRequest(GPT_SCRIPT_NAME, GPT_SCRIPT_VERSION, {
        [GPT_REQ_MESSAGE]: message
    })
}


// --- onResponse ---

export async function onResponse(responses, req, ctx) {

    ctx.close({
        [RES_OK]: true, [RES_REASON]: 'Handled',
        responses: responses,
    })
}