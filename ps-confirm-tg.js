import mysql from 'mysql2/promise'

const dbConfig = {
    host: process.env.DB_HOST ?? 'localhost',
    port: process.env.DB_PORT ?? 3306,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
}

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

// --- operations ---

async function sendNotification(text) {
    for (const chatId of supportedChatIds) {
        await telegram('sendMessage', {
            chat_id: chatId, text: text
        })
    }
}

async function sendDocument(chatId, text) {
    await telegram('sendMessage', {
        chat_id: chatId, text: text, reply_markup: {
            inline_keyboard: [[ confirmButtons, rejectButtons, replyButtons ]],
        }
    })
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
	const msgType = req.getParam('s1ra')
	if (!msgType) throw new Error('Missing s1ra parameter')

    switch (msgType) {
        case 'v5hx': {
            await sendNotification('New document created.')
            break
        }
        default:
            throw new Error(`Unsupported s1ra value: ${msgType}`)
    }

	ctx.close({ result: 'Ok' })
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
            await sendDocument(chatId, 'Please confirm or reject the document.')
        }

		ctx.close({
            reply: text,
			body: update,
		})
	}
}
