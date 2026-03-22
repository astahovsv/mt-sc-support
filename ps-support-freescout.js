import mysql from 'mysql2/promise'


// --- freescout config ---

const FREESCOUT_HOST = process.env.FREESCOUT_HOST
if (!FREESCOUT_HOST) throw new Error('Missing FREESCOUT_HOST')

const FREESCOUT_API_KEY = process.env.FREESCOUT_API_KEY
if (!FREESCOUT_API_KEY) throw new Error('Missing FREESCOUT_API_KEY')

async function fetchJson(url, options = {}) {
    const res = await fetch(url, options)
    const text = await res.text()

    let data = null
    try {
        data = text ? JSON.parse(text) : null
    } catch {
        data = text
    }

    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}\nResponse: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
    }

    return data
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


// --- database config ---

const TABLE_HANDLED_ID = 'a2qf'

const dbConfig = {
    host: process.env.DB_HOST ?? 'localhost',
    port: process.env.DB_PORT ?? 3306,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
}

async function database(block) {
    const db = await mysql.createConnection(dbConfig)

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

async function getFreescoutActiveIds() {
    const data = await freescout('/api/conversations?status=active&page=1&pageSize=100')
    const items = data?._embedded?.conversations ?? []

    return items
        .map(item => item?.id)
        .filter(id => id !== undefined && id !== null)
}

async function getFreescoutItem(id) {
    return await freescout(`/api/conversations/${id}`)
}

async function tryRegisterId(id) {
    return await database(async (db) => {
        const [result] = await db.execute(
            `INSERT IGNORE INTO ${TABLE_HANDLED_ID} (id) VALUES (?)`,
            [id]
        )

        return result.affectedRows === 1
    })
}

async function unregisterId(id) {
    await database(async (db) => {
        await db.execute(
            `DELETE FROM ${TABLE_HANDLED_ID} WHERE id = ?`,
            [id]
        )
    })
}


// --- onRequest ---

export async function onRequest(req, ctx) {
    const ids = await getFreescoutActiveIds()

    if (ids.length === 0) {
        ctx.closeWithoutAnswer({ status: 'No active items found' })
        return
    }

    for (const id of ids) {
        const registered = await tryRegisterId(id)
        if (!registered) continue

        try {
            const item = await getFreescoutItem(id)
            ctx.closeWithoutAnswer({ status: 'New item', body: item })
            return
        } catch (error) {
            try {
                await unregisterId(id)
            } catch (_) {}

            throw error
        }
    }

    ctx.closeWithoutAnswer({ status: 'No new items' })
}