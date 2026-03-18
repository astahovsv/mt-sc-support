const token = process.env.TELEGRAM_BOT_TOKEN
const defaultChatId = process.env.TELEGRAM_CHAT_ID

if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN')
if (!defaultChatId) throw new Error('Missing TELEGRAM_CHAT_ID')

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

export async function onRequest(req, ctx) {
	const text = req.getParam('text')
	if (!text) throw new Error('Missing text')

	const message = await telegram('sendMessage', {
		chat_id: defaultChatId,
		text,
		reply_markup: {
            inline_keyboard: [[ confirmButtons, rejectButtons, replyButtons ]],
        }
	})

	ctx.setResult({
		request: text,
        message: message,
	})
}

export async function onWebhook(req, ctx) {
	const body = req.getParam('body')
	const update = JSON.parse(body)

	// Нажатие на inline-кнопку
	if (update.callback_query) {
		const callbackId = update.callback_query.id
		const action = update.callback_query.data
		const questionMessage = update.callback_query.message
		const chatId = questionMessage.chat.id
		const messageId = questionMessage.message_id

		await telegram('answerCallbackQuery', {
			callback_query_id: callbackId,
		})

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

        ctx.setResult({
            action: action,
            body: update,
        })
	}
	// Текстовый ответ пользователя
	else if (update.message?.text) {
		const text = update.message.text

		ctx.setResult({
            reply: text,
			body: update,
		})
	}
}