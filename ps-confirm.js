import mysql from 'mysql2/promise'

const REQ_DOC_TYPE = 'hn4a'
const REQ_SOURCE = 'aid4'
const REQ_SOURCE_URL = 'ez8b'
const REQ_ACTION = 'b8om'
const REQ_DESCRIPTION = 'e7kx'

const DOC_CATEGORY_SUPPORT = 'v5hx'

const DOC_TYPE_CONFIRM_RESPONSE = 'y2ut'
const DOC_TYPE_CONFIRM_CHECK = 'w7bg'

const DOC_DATA = [
    { type: DOC_TYPE_CONFIRM_RESPONSE, category: DOC_CATEGORY_SUPPORT, prefix: 'CR/SUPP', title: 'Request for confirmation response' },
    { type: DOC_TYPE_CONFIRM_CHECK, category: DOC_CATEGORY_SUPPORT, prefix: 'CR/CHEK', title: 'Request for confirmation of message parameters' },
]

const TG_SCRIPT_NAME = 'com.persapps.confirm.tg'
const TG_SCRIPT_VERSION = '1.0.*'
const TG_REQ_DOC_CATEGORY = 'c6rq'


// --- database config ---

const TABLE_DOCS = 'gc8e'
const TABLE_COUNTER = 'k8cf'

const COL_PERIOD = 'h7pk'
const COL_DATE = 'mts3'
const COL_CATEGORY = 'c6rq'
const COL_PREFIX = 'z6om'
const COL_NUMBER = 'cg2y'
const COL_TITLE = 'tob7'
const COL_SOURCE = 'aid4'
const COL_SOURCE_URL = 'ez8b'
const COL_DESCRIPTION = 'e7kx'
const COL_CALLBACK_ID = 'q4lz'
const COL_ACTION = 'b8om'

async function databaseBlock(block) {
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

function getCurrentPeriod() {
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    return `${year}${month}`
}

function getCurrentDateOnly() {
    return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

async function createDocument(contextId, docData, source, sourceUrl, action, description) {

    const period = getCurrentPeriod()
    const documentDate = getCurrentDateOnly()

    const documentNumber = await databaseBlock(async (db) => {

        // Блокируем строку счетчика, если она уже есть
        const [rows] = await db.execute(
            `SELECT ${COL_NUMBER} FROM ${TABLE_COUNTER} WHERE ${COL_PREFIX} = ? AND ${COL_PERIOD} = ? FOR UPDATE`,
            [docData.prefix, period]
        )

        let number
        if (rows.length === 0) {
            number = 1
            await db.execute(
                `INSERT INTO ${TABLE_COUNTER} (${COL_PREFIX}, ${COL_PERIOD}, ${COL_NUMBER}) VALUES (?, ?, ?)`,
                [docData.prefix, period, number]
            )
        } else {
            number = Number(rows[0][COL_NUMBER]) + 1
            await db.execute(
                `UPDATE ${TABLE_COUNTER} SET ${COL_NUMBER} = ? WHERE ${COL_PREFIX} = ? AND ${COL_PERIOD} = ?`,
                [number, docData.prefix, period]
            )
        }

        await db.execute(
            `
            INSERT INTO ${TABLE_DOCS} (${COL_DATE}, ${COL_CATEGORY}, ${COL_PREFIX}, ${COL_NUMBER}, ${COL_TITLE}, ${COL_SOURCE}, ${COL_SOURCE_URL}, ${COL_ACTION}, ${COL_DESCRIPTION}, ${COL_CALLBACK_ID})
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [documentDate, docData.category, docData.prefix, number, docData.title, source, sourceUrl, action, description, contextId]
        )
        
        return number
    })

    return `${docData.prefix}-${period}-${documentNumber}`
}


// --- onRequest ---

export async function onRequest(req, ctx) {
    const docType = req.getParam(REQ_DOC_TYPE)
    if (!docType) throw new Error('Document type parameter is required')
    const docData = DOC_DATA.find(t => t.type === docType)
    if (!docData) throw new Error('Invalid document type')

    const contextId = ctx.getContextID()
    const action = req.getParam(REQ_ACTION) ?? ''
    const source = req.getParam(REQ_SOURCE) ?? ''
    const sourceUrl = req.getParam(REQ_SOURCE_URL) ?? ''
    const description = req.getParam(REQ_DESCRIPTION) ?? ''

    await createDocument(contextId, docData, source, sourceUrl, action, description)

    ctx.pushRequest(TG_SCRIPT_NAME, TG_SCRIPT_VERSION, {
        [TG_REQ_DOC_CATEGORY]: docData.category,
    })
}

export async function onResponse(responses, req, ctx) {
    ctx.close(responses[0].result)
}