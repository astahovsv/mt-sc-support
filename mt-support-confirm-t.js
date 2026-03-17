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

	return body
}

export async function onRequest(req, ctx) {
	const text = req.getParam('text')
	if (!text) throw new Error('Missing text')

	await telegram('sendMessage', {
		chat_id: defaultChatId,
		text,
		reply_markup: {
			inline_keyboard: [
				[
					{ text: 'Ok', callback_data: 'ok' },
					{ text: 'Cancel', callback_data: 'cancel' },
				],
			],
		},
	})

	ctx.setResult({ ok: true, sent: text })
}

export async function onWebhook(req, ctx) {
	const body = req.getParam('body')
	const update = JSON.parse(body)

	const text = update.message?.text
	const action = update.callback_query?.data

	if (action) {
		const messageId = update.callback_query.message.message_id
		const chatId = update.callback_query.message.chat.id
		const callbackQueryId = update.callback_query.id

		await telegram('answerCallbackQuery', {
			callback_query_id: callbackQueryId,
		})

		await telegram('deleteMessage', {
			chat_id: chatId,
			message_id: messageId,
		})

		ctx.setResult({ answer: action, body: update })
	} else {
		ctx.setResult({ answer: text, body: update })
	}
}