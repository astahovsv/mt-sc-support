import mysql from 'mysql2/promise'

const REQ_DOC_CATEGORY = 'c6rq'

const CATEGORY_SUPPORT = 'v5hx'

const DOC_DATA = [
    { category: CATEGORY_SUPPORT, newMessage: 'New request in /support' },
]

const RES_DOC_ID = 'bk3s'
const RES_AGREE = 'me6w'
const RES_MESSAGE = 'n8q7'

const ACTION_CONFIRM = 't3oz'
const ACTION_REJECT = 'ht8n'
const ACTION_REPLY = 'pb0r'
const ACTION_CANCEL = 'c8s9'

const WAKE_UP_ANSWER_INTERVAL = 60 * 60 // 1 hour
const WAKE_UP_ANSWER_TAG = 's9jr'


// --- telegram config ---

const supportedChatIds = process.env.TELEGRAM_CHAT_IDS?.split(',').map(id => id.trim())

async function telegram(method, payload) {
    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
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

const confirmButtons = { text: 'Confirm', callback_data: ACTION_CONFIRM }
const rejectButtons = { text: 'Reject', callback_data: ACTION_REJECT }
const replyButtons = { text: 'Reply', callback_data: ACTION_REPLY }


// --- database config ---

const TABLE_DOCS = 'gc8e'

const COL_DATE = 'mts3'
const COL_TYPE = 'c6rq'
const COL_PREFIX = 'z6om'
const COL_NUMBER = 'cg2y'
const COL_TITLE = 'tob7'
const COL_SOURCE = 'aid4'
const COL_SOURCE_URL = 'ez8b'
const COL_ACTION = 'b8om'
const COL_DESCRIPTION = 'e7kx'
const COL_CALLBACK_ID = 'q4lz'
const COL_CALLBACK_TAG = 'm8gp'
const COL_PROCESSED = 'up8s'
const COL_ACTIVE_TOKEN = 'a6ng'

const PROCESSED_PENDING = 0
const PROCESSED_ACTIVE = 1
const PROCESSED_CLOSED = 2

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

async function getDocumentById(id) {
    return await databaseBlock(async (db) => {
        const [rows] = await db.execute(
            `SELECT * FROM ${TABLE_DOCS} WHERE id = ?`, [id]
        )
        return (rows.length > 0) ? rows[0] : null
    })
}

async function getDocumentByToken(token) {
    return await databaseBlock(async (db) => {
        const [rows] = await db.execute(
            `SELECT * FROM ${TABLE_DOCS} WHERE ${COL_ACTIVE_TOKEN} = ?`, [token]
        )
        return (rows.length > 0) ? rows[0] : null
    })
}

async function setDocumentProcessed(docId, processed, token) {
    await databaseBlock(async (db) => {
        await db.execute(
            `UPDATE ${TABLE_DOCS} SET ${COL_PROCESSED} = ?, ${COL_ACTIVE_TOKEN} = ? WHERE id = ?`,
            [processed, token, docId]
        )
    })
}

async function getAnyDocument(docType) {
    return await databaseBlock(async (db) => {
        const [rows] = await db.execute(
            `SELECT * FROM ${TABLE_DOCS} WHERE ${COL_TYPE} = ? AND ${COL_PROCESSED} = ? LIMIT 1`, 
            [docType, PROCESSED_PENDING]
        )
        return (rows.length > 0) ? rows[0] : null
    })
}

async function presentMessageForAll(text) {
    for (const chatId of supportedChatIds) {
        await telegram('sendMessage', {
            chat_id: chatId, text: text, parse_mode: 'HTML'
        })
    }
}

async function presentMessage(chatId, text) {
    await telegram('sendMessage', {
        chat_id: chatId, text: text, parse_mode: 'HTML'
    })
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

async function presentDocument(chatId, doc) {

    const docDate = new Date(doc[COL_DATE]).toLocaleString('en-US', {
        year: 'numeric', month: '2-digit', day: '2-digit'
    })

    let text = 
`
<b>========== Title =============</b>
${doc[COL_PREFIX]}-${doc[COL_NUMBER]} from ${docDate}
${doc[COL_TITLE]}
<b>========== Source ============</b>
${doc[COL_SOURCE_URL]}
${escapeHtml(doc[COL_SOURCE])}
<b>========== Action ============</b>
${escapeHtml(doc[COL_ACTION])}
<b>======== Description =========</b>
${escapeHtml(doc[COL_DESCRIPTION])}
`

    const res = await telegram('sendMessage', {
        chat_id: chatId, text: text, parse_mode: 'HTML', reply_markup: {
            inline_keyboard: [[ confirmButtons, rejectButtons, replyButtons ]],
        }
    })

    return res.message_id
}

async function presentReply(chatId, messageId) {
    const res = await telegram('sendMessage', {
        chat_id: chatId, text: 'Your reply:',
        reply_markup: { force_reply: true },
        reply_to_message_id: messageId,
    })
    return res.message_id
}

async function removeButtons(chatId, messageId) {
    await telegram('editMessageReplyMarkup', {
        chat_id: chatId, message_id: messageId,
        reply_markup: { inline_keyboard: [] },
    })
}

async function removeMessage(chatId, messageId) {
    await telegram('deleteMessage', {
        chat_id: chatId, message_id: messageId,
    })
}

function sendResponse(ctx, doc, agree, message = null) {
    ctx.pushResponse(doc[COL_CALLBACK_ID], doc[COL_CALLBACK_TAG], {
        [RES_DOC_ID]: doc.id,
        [RES_AGREE]: agree,
        [RES_MESSAGE]: message,
    })
}


// --- onRequest ---

export async function onRequest(req, ctx) {
    const docType = req.getParam(REQ_DOC_CATEGORY)
    if (!docType) throw new Error(`Missing ${REQ_DOC_CATEGORY} parameter`)
    const docData = DOC_DATA.find(t => t.category === docType)
    if (!docData) throw new Error(`Unsupported document category: ${docType}`)

    await presentMessageForAll(docData.newMessage)

    // Ответ будет отправлять другой контекст
    ctx.closeWithoutAnswer({ result: 'Ok' })
}


// --- onWakeUp ---

export async function onWakeUp(tag, req, ctx) { 
    if (!tag) throw new Error('Wake-up tag is missing')

    const [wakeUpTag, docId] = tag.split(':')
    if (wakeUpTag === WAKE_UP_ANSWER_TAG) {

        const doc = await getDocumentById(docId)
        if (!doc) throw new Error(`Document with id ${docId} not found for wake-up tag ${tag}`)

        const token = doc[COL_ACTIVE_TOKEN]
        if (!token) {
            ctx.closeWithoutAnswer({ status: `ok` })
            return
        } 
        
        const [chatId, messageId] = token.split(':')
        if (!messageId) {
            ctx.closeWithoutAnswer({ status: `ok` })
        }

        await setDocumentProcessed(doc.id, PROCESSED_PENDING, null)
        await removeMessage(chatId, messageId)
        ctx.closeWithoutAnswer({ status: `timeout` })
    } else {
        throw new Error(`Unsupported wake-up tag: ${wakeUpTag}`)
    }
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

        await telegram('answerCallbackQuery', { callback_query_id: callbackId})
        await removeButtons(chatId, messageId)

        const doc = await getDocumentByToken(`${chatId}:${messageId}`)
        if (!doc) {
            await presentMessage(chatId, 'Document not found or already processed.')
            ctx.closeWithoutAnswer({ status: `Document not found for token ${chatId}:${messageId}`, body: update })
            return
        }

        if (action === ACTION_CONFIRM) {
            await setDocumentProcessed(doc.id, PROCESSED_CLOSED, null)
            await presentMessage(chatId, `Answer accepted: 'Confirm'.`)
            sendResponse(ctx, doc, true)
            ctx.closeWithoutAnswer({ status: `action: 'Confirm'`, body: update})
        }
        else if (action === ACTION_REJECT) {
            await setDocumentProcessed(doc.id, PROCESSED_CLOSED, null)
            await presentMessage(chatId, `Answer accepted: 'Reject'.`)
            sendResponse(ctx, doc, false)
            ctx.closeWithoutAnswer({ status: `action: 'Reject'`, body: update})
        }
        else if (action === ACTION_REPLY) {
            const newMessageId = await presentReply(chatId, messageId)
            await setDocumentProcessed(doc.id, PROCESSED_ACTIVE, `${chatId}:${newMessageId}`)
            ctx.closeWithoutAnswer({ status: `action: 'Reply'`, body: update})
        }
        else if (action === ACTION_CANCEL) {
            await setDocumentProcessed(doc.id, PROCESSED_CLOSED, null)
            await removeMessage(chatId, messageId)
            ctx.closeWithoutAnswer({ status: `action: 'Cancel'`, body: update})
        }
        else {
            ctx.closeWithoutAnswer({ status: `Unknown action: ${action}`, body: update })
        }
    }

    // Текстовый ответ пользователя
    else if (update.message?.text) {

        const text = update.message.text
        const replyTo = update.message.reply_to_message

        // Ответ на force_reply
        if (replyTo) {
            const messageId = replyTo.message_id

            const doc = await getDocumentByToken(`${chatId}:${messageId}`)
            if (!doc) {
                await presentMessage(chatId, 'Document not found or already processed.')
                ctx.closeWithoutAnswer({ status: `Document not found for token ${chatId}:${messageId}`, body: update })
                return
            }

            await setDocumentProcessed(doc.id, PROCESSED_CLOSED, null)
            await presentMessage(chatId, `Answer accepted: 'Reply'.`)
            sendResponse(ctx, doc, false, text)
            ctx.closeWithoutAnswer({ status: `action: 'Reply'`, body: update })
        }

        // Нажатие на команду /support
        else if (text === '/support') {

            const doc = await getAnyDocument(CATEGORY_SUPPORT)
            if (doc) {
                const messageId = await presentDocument(chatId, doc)
                await setDocumentProcessed(doc.id, PROCESSED_ACTIVE, `${chatId}:${messageId}`)
                ctx.setWakeUpInterval(WAKE_UP_ANSWER_INTERVAL, `${WAKE_UP_ANSWER_TAG}:${doc.id}`)
                // Контекст будет закрыт в onWakeUp
                // ctx.closeWithoutAnswer()
            } 
            else {
                await presentMessage(chatId, 'No pending documents to confirm.')
                ctx.closeWithoutAnswer({ status: text, body: update })
            }
        }

        // Другие дествия, не поддерживаемые в данный момент
        else {
            ctx.closeWithoutAnswer({ status: `Unknown command`, body: update })
        }
    }
}
