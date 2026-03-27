import mysql from 'mysql2/promise'

const REQ_DOC_ID = 'bj3a' // Идентификатор заявки
const REQ_CALLBACK_ID = 'y2eb' // Идентификатор контекста для возврата ответа
const RES_ANSWER = 'h8vg'
const RES_COMMENT = 'uj8m'

const ANSWER_ACCEPTED = 'j7cf'
const ANSWER_REJECTED = 'co9g'
const ANSWER_COMMENT = 'l5jo'
const ANSWER_REVISE = 'ko3x'


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

const ACTION_ACCEPT = 't3oz'
const ACTION_REJECT = 'ht8n'
const ACTION_REVISE = 'z8iq'
const ACTION_CANCEL = 'c8s9'

const acceptButtons = { text: 'Accept', callback_data: ACTION_ACCEPT }
const rejectButtons = { text: 'Reject', callback_data: ACTION_REJECT }
const reviseButtons = { text: 'Revise', callback_data: ACTION_REVISE }


// --- database config ---

const TABLE_REQ = 'o4ju'
const COL_TYPE = 's5ud'
const COL_ACTION = 'lm6t'
const COL_REASON = 'v0pf'
const COL_SOURCES = 'h5uy'

const TABLE_PROCESS = 'b4od'
const COL_DOC_ID = 'qc7f'
const COL_CALLBACK_ID = 'd9gu'
const COL_PROCESSED = 'v1ab'
const COL_CHAT_ID = 'wx3r'
const COL_MESSAGE_ID = 'xu9t'

const PROCESSED_PENDING = 0
const PROCESSED_ACTIVE = 1
const PROCESSED_CLOSED = 2

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

const WAKE_UP_ANSWER_INTERVAL = 60 * 60 // 1 hour
const WAKE_UP_ANSWER_TAG = 's9jr'

async function getProcessByDoc(docId) {
    return await database(async (db) => {
        const [rows] = await db.execute(
            `SELECT * FROM ${TABLE_PROCESS} WHERE ${COL_DOC_ID} = ?`, [docId]
        )
        return (rows.length > 0) ? rows[0] : null
    })
}

async function getProcessByChat(chanId, messageId) {
    return await database(async (db) => {
        const [rows] = await db.execute(
            `SELECT * FROM ${TABLE_PROCESS} WHERE ${COL_CHAT_ID} = ? AND ${COL_MESSAGE_ID} = ?`, 
            [chanId, messageId]
        )
        return (rows.length > 0) ? rows[0] : null
    })
}

async function updateProcess(docId, processed, chanId = null, messageId = null) {
    await database(async (db) => {
        await db.execute(
            `UPDATE ${TABLE_PROCESS} SET ${COL_PROCESSED} = ?, ${COL_CHAT_ID} = ?, ${COL_MESSAGE_ID} = ? WHERE ${COL_DOC_ID} = ?`,
            [processed, (chanId || ''), (messageId || ''), docId]
        )
    })
}

async function getAnyRequestDoc() {
    return await database(async (db) => {
        const [prsRows] = await db.execute(
            `SELECT * FROM ${TABLE_PROCESS} WHERE ${COL_PROCESSED} = ? LIMIT 1`,
            [PROCESSED_PENDING]
        )
        if (prsRows.length === 0) return null
        const docId = prsRows[0][COL_DOC_ID]
        const [docRows] = await db.execute(
            `SELECT * FROM ${TABLE_REQ} WHERE id = ?`, [docId]
        )
        return (docRows.length > 0) ? docRows[0] : null
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

const TYPE_DATA = [
    { type: 'w7bg', title: 'Запрос на подтверждение установки параметров для входящего сообщения' },
]

async function presentRequestDoc(chatId, doc) {

    const type = doc[COL_TYPE]
    const title = TYPE_DATA.find(t => t.type === type)?.title || `Запрос ${type}`

    const text = 
`
${title}
<b>========== Action ============</b>
${escapeHtml(doc[COL_ACTION])}
<b>========== Reason ============</b>
${escapeHtml(doc[COL_REASON])}
<b>========== Source ============</b>
${escapeHtml(JSON.parse(doc[COL_SOURCES]).join('\n'))}
`

    const res = await telegram('sendMessage', {
        chat_id: chatId, text: text, parse_mode: 'HTML', reply_markup: {
            inline_keyboard: [[ acceptButtons, rejectButtons, reviseButtons ]],
        }
    })

    return res.message_id
}

async function removeButtons(chatId, messageId) {
    try {
        await telegram('editMessageReplyMarkup', {
            chat_id: chatId, message_id: messageId,
            reply_markup: { inline_keyboard: [] },
        })
    } catch (_) { }
}

async function removeMessage(chatId, messageId) {
    await telegram('deleteMessage', {
        chat_id: chatId, message_id: messageId,
    })
}

function sendResponse(ctx, process, answer, comment) {
    ctx.pushResponse(process[COL_CALLBACK_ID], null, {
        [RES_ANSWER]: answer,
        [RES_COMMENT]: comment,
    })
}


// --- onRequest ---

export async function onRequest(req, ctx) {
    const docId = req.getParam(REQ_DOC_ID)
    if (!docId) throw new Error(`Missing ${REQ_DOC_ID} request parameter`)
    const callbackId = req.getParam(REQ_CALLBACK_ID)
    if (!callbackId) throw new Error(`Missing ${REQ_CALLBACK_ID} request parameter`)

    await database(async (db) => {
        await db.execute(
            `INSERT INTO ${TABLE_PROCESS} (${COL_DOC_ID}, ${COL_CALLBACK_ID}) 
            VALUES (?, ?)`,
            [docId, callbackId]
        )
    })

    await presentMessageForAll('New document in /request')

    // Ответ будет отправлять другой контекст
    ctx.closeWithoutAnswer({ result: 'Ok' })
}


// --- onWakeUp ---

export async function onWakeUp(tag, req, ctx) { 
    if (!tag) throw new Error('Wake-up tag is missing')

    const [wakeUpTag, docId] = tag.split(':')
    if (wakeUpTag === WAKE_UP_ANSWER_TAG) {

        const process = await getProcessByDoc(docId)
        if (!process) throw new Error(`Document with id ${docId} not found!`)

        const chatId = process[COL_CHAT_ID]
        const messageId = process[COL_MESSAGE_ID]
        if (!chatId || !messageId) {
            ctx.closeWithoutAnswer({ status: `ok` })
            return
        } 

        await updateProcess(docId, PROCESSED_PENDING)
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

        const process = await getProcessByChat(chatId, messageId)
        if (!process) {
            await presentMessage(chatId, 'Document not found or already processed.')
            ctx.closeWithoutAnswer({ status: `Document not found for token ${chatId}:${messageId}`, body: update })
            return
        }

        if (action === ACTION_ACCEPT) {
            await updateProcess(process[COL_DOC_ID], PROCESSED_CLOSED)
            await presentMessage(chatId, `Answer accepted: 'Accept'.`)
            sendResponse(ctx, process, ANSWER_ACCEPTED)
            ctx.closeWithoutAnswer({ status: `action: 'Accept'`, body: update})
        }
        else if (action === ACTION_REJECT) {
            await updateProcess(process[COL_DOC_ID], PROCESSED_CLOSED)
            await presentMessage(chatId, `Answer accepted: 'Reject'.`)
            sendResponse(ctx, process, ANSWER_REJECTED)
            ctx.closeWithoutAnswer({ status: `action: 'Reject'`, body: update})
        }
        else if (action === ACTION_REVISE) {
            await updateProcess(process[COL_DOC_ID], PROCESSED_CLOSED)
            await presentMessage(chatId, `Answer accepted: 'Revise'.`)
            sendResponse(ctx, process, ANSWER_REVISE)
            ctx.closeWithoutAnswer({ status: `action: 'Revise'`, body: update})
        }
        else if (action === ACTION_CANCEL) {
            await updateProcess(process[COL_DOC_ID], PROCESSED_CLOSED)
            await removeMessage(chatId, messageId)
            ctx.closeWithoutAnswer({ status: `action: 'Cancel'`, body: update})
        }
        else {
            ctx.closeWithoutAnswer({ status: `Unknown action: ${action}`, body: update })
        }
    }

    // Текстовый ответ пользователя
    else if (update.message?.text) {

        const comment = update.message.text
        const replyTo = update.message.reply_to_message

        // Ответ на force_reply
        if (replyTo) {
            const messageId = replyTo.message_id

            const process = await getProcessByChat(chatId, messageId)
            if (!process) {
                await presentMessage(chatId, 'Document not found or already processed.')
                ctx.closeWithoutAnswer({ status: `Document not found for token ${chatId}:${messageId}`, body: update })
                return
            }

            await removeButtons(chatId, messageId)
            await updateProcess(process[COL_DOC_ID], PROCESSED_CLOSED)
            await presentMessage(chatId, `Answer accepted: 'Comment'.`)
            sendResponse(ctx, process, ANSWER_COMMENT, comment)
            ctx.closeWithoutAnswer({ status: `action: 'Comment'`, body: update })
        }

        // Нажатие на команду /request
        else if (comment === '/request') {

            const doc = await getAnyRequestDoc()
            if (doc) {
                const messageId = await presentRequestDoc(chatId, doc)
                await updateProcess(doc.id, PROCESSED_ACTIVE, chatId, messageId)
                ctx.setWakeUpInterval(WAKE_UP_ANSWER_INTERVAL, `${WAKE_UP_ANSWER_TAG}:${doc.id}`)
                // Контекст будет закрыт в onWakeUp
                // ctx.closeWithoutAnswer()
            } 
            else {
                await presentMessage(chatId, 'No documents for decision.')
                ctx.closeWithoutAnswer({ status: comment, body: update })
            }
        }

        // Другие дествия, не поддерживаемые в данный момент
        else {
            ctx.closeWithoutAnswer({ status: `Unknown command`, body: update })
        }
    }
}
