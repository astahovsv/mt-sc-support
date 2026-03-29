import mysql from 'mysql2/promise'

const REQ_DOC_ID = 'bj3a' // Идентификатор заявки
const RES_SUCCESS = 'su2c'
const RES_ANSWER = 'h8vg'

const ANSWER_ACCEPTED = 'j7cf'
const ANSWER_REJECTED = 'co9g'

const VAL_DATA_CONFIDENCE = 'x0dk'

// --- database config ---

const TABLE_REQ = 'o4ju'
const COL_TYPE = 's5ud'
const COL_DATA = 'c2w1'

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

async function getDocument(docId) {
    const date = new Date()
    return await database(async (db) => {
        const [rows] = await db.execute(
            `SELECT * FROM ${TABLE_REQ} WHERE id = ?`, [docId]
        )
        return (rows.length > 0) ? rows[0] : null
    })
}


// --- onRequest ---

export async function onRequest(req, ctx) {

    const docId = req.getParam(REQ_DOC_ID)
    if (!docId) throw new Error(`Missing ${REQ_DOC_ID} request parameter`)

    const doc = await getDocument(docId)
    if (doc[COL_TYPE] === 'w7bg') {
        
        const dataString = doc[COL_DATA]
        if (!dataString) {
            ctx.close({ [RES_SUCCESS]: false })
            return
        }

        const data = JSON.parse(dataString)

        if (data[VAL_DATA_CONFIDENCE] < 0.65) {
            ctx.close({ [RES_SUCCESS]: false })
            return
        }

        ctx.close({
            [RES_SUCCESS]: true,
            [RES_ANSWER]: ANSWER_ACCEPTED
        })
    }
    else {
        ctx.close({ [RES_SUCCESS]: false })
    }
}