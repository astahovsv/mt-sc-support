
const REQ_START = 'm5cr'
const REQ_LIMIT = 'jv6n'
const RES_SUCCESS = 'su2c'

const CHECK_SCRIPT_NAME = 'com.persapps.support.freescout.check'
const CHECK_SCRIPT_VERSION = '1.0.*'
const CHECK_REQ_ID = 'a28q'


// --- freescout config ---

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


// --- operations ---

const VAL_INDEX = 'index'
const VAL_HANDLED = 'handled'

async function getFreescoutItem(id) {
    return await freescout(`/api/conversations/${id}`)
}

async function next(req, ctx) {
    const limit = Number(req.getParam(REQ_LIMIT)) || 1
    while (true) {

        const handled = Number(ctx.getValue(VAL_HANDLED)) || 0
        if (handled >= limit) {
            ctx.close({ [RES_SUCCESS]: true, status: 'Close by limit', limit })
            return
        }

        const nextIndex = (Number(ctx.getValue(VAL_INDEX)) || 0)
        const item = await getFreescoutItem(nextIndex)
        if (!item) {
            ctx.close({ [RES_SUCCESS]: false, status: 'Close by error', error: `Item with id ${nextIndex} not found` })
            return
        }

        ctx.setValue(VAL_HANDLED, handled + 1)
        ctx.setValue(VAL_INDEX, nextIndex + 1)

        const fields = item.customFields ?? []
        const filled = fields.filter(f => f.value)
        
        if (filled.length < fields.length) {
            ctx.pushRequest(CHECK_SCRIPT_NAME, CHECK_SCRIPT_VERSION, {
                [CHECK_REQ_ID]: nextIndex
            })
            break
        }
    }
}


// --- onRequest ---

export async function onRequest(req, ctx) {
    const start = req.getParam(REQ_START)
    if (!start) throw new Error(`${REQ_START} parameter is required`)

    ctx.setValue(VAL_INDEX, Number(start))

    await next(req, ctx)
}


// --- onResponse ---

export async function onResponse(responses, req, ctx) {
    const error = responses[0]?.error
    if (error) {
        ctx.close({ [RES_SUCCESS]: false, status: 'Close by error', error })
        return
    }

    await next(req, ctx)
}