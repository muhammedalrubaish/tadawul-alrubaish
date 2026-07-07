// وحدة تيليجرام المشتركة — إرسال الرسائل ونداء الـBot API
const TOKEN = String(process.env.TELEGRAM_TOKEN || '').trim();
const CHAT = String(process.env.TELEGRAM_CHAT || '').trim();

// سر التحقق من الويبهوك: مشتق حتمياً من التوكن (تيليجرام يعيده مع كل تحديث)
const SECRET = TOKEN.replace(/[^A-Za-z0-9]/g, '').slice(-32);

async function api(method, payload) {
  if (!TOKEN) throw new Error('TELEGRAM_TOKEN غير مضبوط');
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const d = await r.json();
  if (!d.ok) throw new Error(`Telegram ${method}: ${d.description || r.status}`);
  return d.result;
}

// إرسال نص (HTML) مع تقسيم تلقائي عند تجاوز حد تيليجرام 4096 حرفاً
async function send(chatId, text) {
  const chunks = [];
  let t = String(text);
  while (t.length > 4000) {
    let cut = t.lastIndexOf('\n\n', 4000);
    if (cut < 1000) cut = 4000;
    chunks.push(t.slice(0, cut));
    t = t.slice(cut);
  }
  chunks.push(t);
  for (const c of chunks) {
    await api('sendMessage', { chat_id: chatId, text: c, parse_mode: 'HTML', disable_web_page_preview: true });
  }
}

module.exports = { api, send, TOKEN, CHAT, SECRET };
