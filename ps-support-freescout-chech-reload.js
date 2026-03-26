import mysql from 'mysql2/promise'

const REQ_LIMIT = 'jv6n'

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


// --- database config ---

const TABLE_KVMAP = 'e3kt'
const COL_KEY = 'name'
const COL_VALUE = 'value'
const VAL_LAST_ID = 'd1hu'

async function database(block) {
    const db = await mysql.createConnection(process.env.DB_CONNECTION)

    try {
        await db.beginTransaction()
        const result = await block(db)
        await db.commit()
        return result
    } catch (error) {
        try {
            await db.rollback()
        } catch (_) {}
        throw error
    } finally {
        await db.end()
    }
}


// --- operations ---

const VAL_HANDLED = 'handled'

async function getFreescoutItem(id) {
    return await freescout(`/api/conversations/${id}`)
}

function getNextId() {
    return database(async (db) => {
        const [rows] = await db.execute(
            `SELECT ${COL_VALUE} FROM ${TABLE_KVMAP} WHERE ${COL_KEY} = ?`,
            [VAL_LAST_ID]
        )

        let number
        if (rows.length === 0) {
            number = 1
            await db.execute(
                `INSERT INTO ${TABLE_KVMAP} (${COL_KEY}, ${COL_VALUE}) VALUES (?, ?)`,
                [VAL_LAST_ID, number]
            )
        } else {
            number = Number(rows[0][COL_VALUE]) + 1
            await db.execute(
                `UPDATE ${TABLE_KVMAP} SET ${COL_VALUE} = ? WHERE ${COL_KEY} = ?`,
                [number, VAL_LAST_ID]
            )
        }

        return number
    })
}

async function sendNextItem(req, ctx) {

    const limit = Number(req.getParam(REQ_LIMIT)) || 1
    const handled = Number(ctx.getValue(VAL_HANDLED)) || 0

    if (handled >= limit) {
        ctx.closeWithoutAnswer({ status: 'Close by limit', limit })
        return
    }

    while (true) {

        const id = await getNextId()
        const item = await getFreescoutItem(id)
        if (!item) continue // not found, next

        const theme = item.customFields?.find(f => f.id === 2)?.value
        const app = item.customFields?.find(f => f.id === 1)?.value
        if (theme && app) continue // already handled

        ctx.pushRequest(CHECK_SCRIPT_NAME, CHECK_SCRIPT_VERSION, {
            [CHECK_REQ_ID]: id
        })
        ctx.setValue(VAL_HANDLED, handled + 1)
        break
    }
}


// --- onRequest ---

export async function onRequest(req, ctx) {
    await sendNextItem(req, ctx)
}


// --- onResponse ---

export async function onResponse(responses, req, ctx) {
    let error = responses[0]?.error
    if (responses[0]?.error) {
        ctx.closeWithoutAnswer({ status: 'Finish by error', error })
        return
    }

    await sendNextItem(req, ctx)
}