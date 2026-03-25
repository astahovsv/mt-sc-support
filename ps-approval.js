import mysql from 'mysql2/promise'

const REQ_TYPE = 'hn4a' // тип запроса
const REQ_ACTION = 'b8om' // выполняемое действие
const REQ_REASON = 'e7kx' // причина, объяснение
const REQ_DATA = 'bk3f' // данные для выполнения
const REQ_SOURCES = 'r3jv' // ресурсы на основе которых или с которыми будут эти действия выполняться

const TG_SCRIPT_NAME = 'com.persapps.approval.tg'
const TG_SCRIPT_VERSION = '1.0.*'
const TG_REQ_DOC_ID = 'bj3a' // Идентификатор заявки
const TG_REQ_CALLBACK_ID = 'y2eb' // Идентификатор контекста для возврата ответа
const TG_RES_ANSWER = 'h8vg'
const TG_RES_COMMENT = 'uj8m'


// --- database config ---

const TABLE_REQ = 'o4ju'
const COL_DATE = 'pe2g'
const COL_SENDER = 'e7pu'
const COL_TYPE = 's5ud'
const COL_ACTION = 'lm6t'
const COL_REASON = 'v0pf'
const COL_DATA = 'c2w1'
const COL_SOURCES = 'h5uy'
const COL_DECISION_ANSWER = 'ni0c'
const COL_DECISION_COMMENT = 'g6fr'

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

const VAL_DOC_ID = 'nq1r'

async function createDocument(sender, type, action, reason, data, sources) {
    const date = new Date()
    return await database(async (db) => {
        const [result] = await db.execute(
            `
            INSERT INTO ${TABLE_REQ} (${COL_DATE}, ${COL_SENDER}, ${COL_TYPE}, ${COL_ACTION}, ${COL_REASON}, ${COL_DATA}, ${COL_SOURCES})
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [date, sender, type, action, reason, JSON.stringify(data), JSON.stringify(sources)]
        )
        return result.insertId
    })
}

async function updateAnswer(docId, answer, comment) {
    await database(async (db) => {
        await db.execute(
            `UPDATE ${TABLE_REQ} SET ${COL_DECISION_ANSWER} = ?, ${COL_DECISION_COMMENT} = ? WHERE id = ?`,
            [answer, (comment ? comment : 'NULL'), docId]
        )
    })
}


// --- onRequest ---

export async function onRequest(req, ctx) {

    const type = req.getParam(REQ_TYPE)
    if (!type) throw new Error(`Missing ${REQ_TYPE} request parameter`)
    const action = req.getParam(REQ_ACTION)
    if (!action) throw new Error(`Missing '${REQ_ACTION}' request parameter`)
    const reason = req.getParam(REQ_REASON)
    if (!reason) throw new Error(`Missing '${REQ_REASON}' request parameter`)
    const data = req.getParam(REQ_DATA) || {}
    const sources = req.getParam(REQ_SOURCES) || []

    const sender = 'com.persapps.support.freescout.check:1.0.0'

    const docId = await createDocument(sender, type, action, reason, data, sources)
    ctx.setValue(VAL_DOC_ID, docId)

    ctx.pushRequest(TG_SCRIPT_NAME, TG_SCRIPT_VERSION, {
        [TG_REQ_DOC_ID]: docId,
        [TG_REQ_CALLBACK_ID]: ctx.getContextID()
    })
}

export async function onResponse(responses, req, ctx) {
    const resultString = responses[0]?.result
    if (!resultString) throw new Error('No response result')
    const result = JSON.parse(resultString)

    const answer = result[TG_RES_ANSWER]
    if (!answer) throw new Error(`Missing '${TG_RES_ANSWER}' response parameter`)
    const comment = result[TG_RES_COMMENT]

    const docId = ctx.getValue(VAL_DOC_ID)
    await updateAnswer(docId, answer, comment)

    ctx.close(result)
}