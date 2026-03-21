import mysql from 'mysql2/promise'


// --- telegram config ---

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN')

const supportedChatIds = process.env.TELEGRAM_CHAT_IDS?.split(',').map(id => id.trim())

async function telegram(method, payload) {
	const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
	})

	const body = await response.json()

	if (!body.ok) {
		throw new Error(`Telegram API error in ${method}: ${JSON.stringify(body)}`)
	}

	return body.result
}

const confirmButtons = { text: 'Confirm', callback_data: 'confirm' }
const rejectButtons = { text: 'Reject', callback_data: 'reject' }
const replyButtons = { text: 'Reply', callback_data: 'reply' }


// --- database config ---

const TABLE_DOCS = 'gc8e'

const COL_DATE = 'mts3'
const COL_TYPE = 'c6rq'
const COL_PREFIX = 'z6om'
const COL_NUMBER = 'cg2y'
const COL_TITLE = 'tob7'
const COL_SOURCE = 'aid4'
const COL_DESCRIPTION = 'e7kx'
const COL_ACTION = 'b8om'
const COL_CALLBACK_ID = 'q4lz'
const COL_CALLBACK_TAG = 'm8gp'
const COL_PROCESSED = 'up8s'
const COL_TG_MESSAGE_ID = 'a6ng'

const PROCESSED_NEW = 0
const PROCESSED_ACTIVE = 1
const PROCESSED_CLOSED = 2

const dbConfig = {
    host: process.env.DB_HOST ?? 'localhost',
    port: process.env.DB_PORT ?? 3306,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
}

async function databaseBlock(block) {
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

async function sendNotification(text) {
    for (const chatId of supportedChatIds) {
        await telegram('sendMessage', {
            chat_id: chatId, text: text
        })
    }
}

async function getAnyDocument(docType) {
    return await databaseBlock(async (db) => {
        const [rows] = await db.execute(
            `SELECT * FROM ${TABLE_DOCS} WHERE ${COL_TYPE} = ? AND ${COL_PROCESSED} = ? LIMIT 1`, 
            [docType, PROCESSED_NEW]
        )
        return (rows.length > 0) ? rows[0] : null
    })
}

async function getDocumentByMessageId(tgMessageId) {
    return await databaseBlock(async (db) => {
        const [rows] = await db.execute(
            `SELECT * FROM ${TABLE_DOCS} WHERE ${COL_TG_MESSAGE_ID} = ?`, [tgMessageId]
        )
        return (rows.length > 0) ? rows[0] : null
    })
}

async function setDocumentProcessed(docId, processed, tgMessageId) {
    await databaseBlock(async (db) => {
        await db.execute(
            `UPDATE ${TABLE_DOCS} SET ${COL_PROCESSED} = ?, ${COL_TG_MESSAGE_ID} = ? WHERE id = ?`,
            [processed, Number(tgMessageId), docId]
        )
    })
}

async function sendDocument(chatId, doc) {

    const docDate = new Date(doc[COL_DATE]).toLocaleString('en-US', {
        year: 'numeric', month: '2-digit', day: '2-digit'
    })

    let text = 
`
${doc[COL_PREFIX]}-${doc[COL_NUMBER]} from ${docDate}
Title: ${doc[COL_TITLE]}
Source: ${doc[COL_SOURCE]}
Description: ${doc[COL_DESCRIPTION]}
Action: ${doc[COL_ACTION]}
`

    const res = await telegram('sendMessage', {
        chat_id: chatId, text: text, reply_markup: {
            inline_keyboard: [[ confirmButtons, rejectButtons, replyButtons ]],
        }
    })

    return res.message_id
}

async function handleDocumentAction(chatId, messageId, action) {

    // Удаляем кнопки у исходного сообщения
    await telegram('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
            inline_keyboard: [],
        },
    })

    if (action === confirmButtons.callback_data || action === rejectButtons.callback_data) {
        await telegram('sendMessage', {
            chat_id: chatId,
            text: `Your answer: ${action}`,
        })
    }
    else if (action === replyButtons.callback_data) {
        await telegram('sendMessage', {
            chat_id: chatId,
            text: 'Your reply:',
            reply_markup: {
                force_reply: true,
            },
            reply_to_message_id: messageId,
        })
    }
}


// --- onRequest ---

export async function onRequest(req, ctx) {
	const docType = req.getParam('c6rq')
	if (!docType) throw new Error('Missing c6rq parameter')

    switch (docType) {
        case 'v5hx': {
            await sendNotification('New document created.')
            break
        }
        default:
            throw new Error(`Unsupported c6rq value: ${docType}`)
    }

    // Ответ будет отправлять другой контекст
	ctx.closeWithoutAnswer({ result: 'Ok' })
}


// --- onWebhook ---

export async function onWebhook(req, ctx) {
	const body = req.getParam('body')
	const update = JSON.parse(body)

    const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id
    if (!supportedChatIds.includes(String(chatId))) {
        throw new Error(`Received update from unsupported chat ID ${chatId}.`)
    }

	// Нажатие на inline-кнопку
	if (update.callback_query) {
		const callbackId = update.callback_query.id
		const action = update.callback_query.data
		const messageId = update.callback_query.message.message_id

		await telegram('answerCallbackQuery', {
			callback_query_id: callbackId,
		})

        await handleDocumentAction(chatId, messageId, action)

        const doc = await getDocumentByMessageId(messageId)
        if (doc) {
            await setDocumentProcessed(doc.id, PROCESSED_CLOSED, 0)
        }

        ctx.close({
            action: action,
            body: update,
        })
	}
	// Текстовый ответ пользователя
	else if (update.message?.text) {
		const text = update.message.text

        // Пользователь нажал на команду /support
        if (text === '/support') {
            const doc = await getAnyDocument('v5hx')
            if (doc) {
                const tgMessageId = await sendDocument(chatId, doc)
                await setDocumentProcessed(doc.id, PROCESSED_ACTIVE, tgMessageId)
            } else {
                await telegram('sendMessage', {
                    chat_id: chatId,
                    text: 'No pending documents to confirm.',
                })
            }
        }

        ctx.close({
            reply: text,
            body: update,
        })
    }
}
