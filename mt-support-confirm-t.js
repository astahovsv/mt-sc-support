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

export async function onRequest(req, ctx) {
	const text = req.getParam('text')
	if (!text) throw new Error('Missing text')

	const message = await telegram('sendMessage', {
		chat_id: defaultChatId,
		text,
		reply_markup: {
			inline_keyboard: [
				[
					{ text: 'Ok', callback_data: 'ok' },
					{ text: 'Cancel', callback_data: 'cancel' },
					{ text: 'Reply', callback_data: 'reply' },
				],
			],
		},
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
		const chatId = update.callback_query.message.chat.id
		const questionMessage = update.callback_query.message

		await telegram('answerCallbackQuery', {
			callback_query_id: callbackId,
		})

		if (action === 'reply') {
			const replyMessage = await telegram('sendMessage', {
				chat_id: chatId,
				text: 'Your comment:',
				reply_markup: {
					force_reply: true,
				},
				reply_to_message_id: questionMessage.message_id,
			})

			ctx.setResult({
				action: 'reply',
    			body: update,
			})
		} else {
            ctx.setResult({
                action: action,
    			body: update,
            })
        }
	} 
	// Текстовый ответ пользователя
    else if (update.message?.text) {
		const text = update.message.text
		const replyToMessage = update.message.reply_to_message

		ctx.setResult({
			reply: text,
			body: update,
		})
	}
    else {
        ctx.setResult({ 
            action: 'unknown',
            body: update,
        })
    }
}