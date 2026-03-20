import mysql from 'mysql2/promise'

const TABLE_DOCS = 'gc8e'
const TABLE_COUNTER = 'k8cf'

const COL_PERIOD = 'h7pk'
const COL_CONTEXT = 'q4lz'
const COL_DATE = 'mts3'
const COL_PREFIX = 'z6om'
const COL_NUMBER = 'cg2y'
const COL_TYPE = 'c6rq'
const COL_TITLE = 'tob7'
const COL_SOURCE = 'aid4'
const COL_DESCRIPTION = 'e7kx'
const COL_ACTION = 'b8om'

const dbConfig = {
    host: process.env.DB_HOST ?? 'localhost',
    port: process.env.DB_PORT ?? 3306,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
}

const DOC_PREFIX = 'CR/SP'
const DOC_TYPE = 'v5hx'

function getCurrentPeriod() {
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    return `${year}${month}`
}

function getCurrentDateOnly() {
    return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

// --- operations ---

async function createDocument(contextId, title, source, description, action) {

    const period = getCurrentPeriod()
    const documentDate = getCurrentDateOnly()
    let documentNumber

    const db = await mysql.createConnection(dbConfig)

    try {

        await db.beginTransaction()

        // Блокируем строку счетчика, если она уже есть
        const [rows] = await db.execute(
            `SELECT ${COL_NUMBER} FROM ${TABLE_COUNTER} WHERE ${COL_PREFIX} = ? AND ${COL_PERIOD} = ? FOR UPDATE`,
            [DOC_PREFIX, period]
        )

        if (rows.length === 0) {
            documentNumber = 1
            await db.execute(
                `INSERT INTO ${TABLE_COUNTER} (${COL_PREFIX}, ${COL_PERIOD}, ${COL_NUMBER}) VALUES (?, ?, ?)`,
                [DOC_PREFIX, period, documentNumber]
            )
        } else {
            documentNumber = Number(rows[0][COL_NUMBER]) + 1
            await db.execute(
                `UPDATE ${TABLE_COUNTER} SET ${COL_NUMBER} = ? WHERE ${COL_PREFIX} = ? AND ${COL_PERIOD} = ?`,
                [documentNumber, DOC_PREFIX, period]
            )
        }

        await db.execute(
            `
            INSERT INTO ${TABLE_DOCS} (${COL_CONTEXT}, ${COL_DATE}, ${COL_PREFIX}, ${COL_NUMBER}, ${COL_TYPE}, ${COL_TITLE}, ${COL_SOURCE}, ${COL_DESCRIPTION}, ${COL_ACTION})
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                contextId, documentDate, DOC_PREFIX, documentNumber,
                DOC_TYPE, title, source, description, action,
            ]
        )

        await db.commit()
    } catch (error) {
        try {
            await db.rollback()
        } catch (_) {}
        throw error
    } finally {
        await db.end()
    }

    return `${DOC_PREFIX}-${period}-${documentNumber}`
}

// --- onRequest ---

export async function onRequest(req, ctx) {

    const contextId = ctx.getContextID()
    const title = req.getParam('tob7') ?? ''
    const source = req.getParam('aid4') ?? ''
    const description = req.getParam('e7kx') ?? ''
    const action = req.getParam('b8om') ?? ''

    const docId = await createDocument(contextId, title, source, description, action)

    ctx.pushRequest('com.persapps.confirm.tg', '1.0.*', {
        'c6rq': DOC_TYPE,
    })

    ctx.close({
        ok: true,
        docId: docId,
    })
}