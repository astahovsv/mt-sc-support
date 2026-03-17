const token = process.env.TELEGRAM_BOT_TOKEN
const chatId = process.env.TELEGRAM_CHAT_ID

if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN')
if (!chatId) throw new Error('Missing TELEGRAM_CHAT_ID')

export async function onRequest(req, ctx) {
	const text = req.getParam('text')
	if (!text) throw new Error('Missing text')

	const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
	    method: 'POST',
	    headers: { 'content-type': 'application/json' },
	    body: JSON.stringify({
	      chat_id: chatId,
	      text,
	      reply_markup: {
	        inline_keyboard: [
	          [
	            { text: "Ok", callback_data: "ok" },
	            { text: "Cancel", callback_data: "cancel" }
	          ]
	        ]
	      }
	    })
	})

	const body = await response.json()
	ctx.setResult({ ok: body.ok, sent: text })
}

export async function onWebhook(req, ctx) {
	const token = process.env.TELEGRAM_BOT_TOKEN

	const body = req.getParam('body')
	const update = JSON.parse(body)

	const text = update.message?.text
	const action = update.callback_query?.data

	if (action) {
	    const messageId = update.callback_query.message.message_id
	    const chatId = update.callback_query.message.chat.id

	    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
	        method: 'POST',
	        headers: { 'content-type': 'application/json' },
	        body: JSON.stringify({
	            callback_query_id: update.callback_query.id
	        }),
	    })

	    await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
	        method: 'POST',
	        headers: { 'content-type': 'application/json' },
	        body: JSON.stringify({
	            chat_id: chatId,
	            message_id: messageId
	        }),
	    })

	    ctx.setResult({ answer: action, body: update })
	} else {
	    ctx.setResult({ answer: text, body: update })
	}
}