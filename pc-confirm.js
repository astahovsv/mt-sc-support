import mysql from 'mysql2/promise'

const dbConfig = {
    host: process.env.DB_HOST ?? 'localhost',
    port: process.env.DB_PORT ?? 3306,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
}

const DOC_PREFIX = 'CR/SP'

function getCurrentPeriod() {
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    return `${year}${month}`
}

function getCurrentDateOnly() {
    return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

export async function onRequest(req, ctx) {

    const title = req.getParam('tob7') ?? ''
    const source = req.getParam('aid4') ?? ''
    const description = req.getParam('e7kx') ?? ''
    const action = req.getParam('b8om') ?? ''

    const contextId = ctx.getContextID() // бинарное значение
    const period = getCurrentPeriod()
    const documentDate = getCurrentDateOnly()
    let documentNumber

    const db = await mysql.createConnection(dbConfig)

    try {

        await db.beginTransaction()

        // Блокируем строку счетчика, если она уже есть
        const [rows] = await db.execute(
            `SELECT cg2y FROM k8cf WHERE z6om = ? AND h7pk = ? FOR UPDATE`,
            [DOC_PREFIX, period]
        )

        if (rows.length === 0) {
            documentNumber = 1
            await db.execute(
                `INSERT INTO k8cf (z6om, h7pk, cg2y) VALUES (?, ?, ?)`,
                [DOC_PREFIX, period, documentNumber]
            )
        } else {
            documentNumber = Number(rows[0].cg2y) + 1
            await db.execute(
                `UPDATE k8cf SET cg2y = ? WHERE z6om = ? AND h7pk = ?`,
                [documentNumber, DOC_PREFIX, period]
            )
        }

        await db.execute(
            `
            INSERT INTO gc8e (q4lz, mts3, z6om, cg2y, tob7, aid4, e7kx, b8om)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                contextId, documentDate, DOC_PREFIX, documentNumber,
                title, source, description, action,
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

    ctx.pushRequest('com.persapps.confirm.tg', '1.0.*', {
        's1ra': 'v5hx',
    })

    ctx.close({
        ok: true,
        documentId: `${DOC_PREFIX}-${period}-${documentNumber}`,
    })
}