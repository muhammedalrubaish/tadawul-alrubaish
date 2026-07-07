// عقل الوكيل — استدعاء Claude عبر مكتبة Anthropic الرسمية مع حقن بيانات السوق الحية
const Anthropic = require('@anthropic-ai/sdk');
const { snapshot, NAMES } = require('./_market');

const MODEL = String(process.env.AI_MODEL || 'claude-opus-4-8').trim();
const hasKey = () => !!String(process.env.ANTHROPIC_API_KEY || '').trim();

const SYSTEM = `أنت «مساعد رصد» — وكيل مساعدة على قرار التداول داخل تطبيق رصد لمتداول فرد في السوقين السعودي (تداول) والأمريكي.

قواعدك الصارمة:
- أجب بالعربية الفصحى المبسطة وباختصار عملي. بلا Markdown ولا جداول — نص عادي وأسطر قصيرة، ويمكنك استخدام الرموز التعبيرية باعتدال.
- اعتمد حصراً على بيانات السوق الحية المرفقة في الرسالة. لا تختلق سعراً أو رقماً أبداً؛ إن لم يكن السهم في البيانات فقل ذلك صراحة واقترح البحث عنه في التطبيق.
- كن صارماً في إدارة المخاطر: اذكر دائماً وقف الخسارة قبل الهدف، وحذّر من المخاطرة بأكثر من 1-2٪ من المحفظة في الصفقة الواحدة، وانصح بعدم مطاردة الأسهم بعد ارتفاع حاد.
- درجة الفرصة (0-100) المرفقة تجمع الزخم والسيولة وموقع RSI: ‏72+ إشارة شراء، 50-71 مراقبة، أقل من 50 تجنُّب.
- لا تَعِد بأرباح ولا تستخدم لغة الجزم. اختم أي رأي بجملة قصيرة أن هذا ليس توصية استثمارية وأن القرار قرار المستخدم.
- إن أرفق المستخدم صفقاته المفتوحة فحلّلها مقابل الأسعار الحية: هل اقترب الوقف أو الهدف؟ وهل حجم المركز معقول؟`;

// اختيار مقتضب من اللقطة: أفضل 20 بالدرجة + أقوى 10 حركةً + أي سهم ذُكر في السؤال
function pickContext(list, question) {
  const q = String(question || '');
  const picked = new Map();
  const add = s => { if (s && !picked.has(s.sym)) picked.set(s.sym, s); };
  list.forEach(s => {
    if (q.includes(s.sym) || (s.name && q.includes(s.name))) add(s);
  });
  list.slice(0, 20).forEach(add);
  [...list].sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg)).slice(0, 10).forEach(add);
  return [...picked.values()];
}

const row = s => `${s.sym} ${s.name}: سعر ${s.price} تغير ${s.chg}% RSI ${s.rsi} سيولة ×${s.vol} درجة ${s.score}`;

// بناء كتلة البيانات الحية للسوقين (يتحمل فشل أحدهما)
async function liveContext(question) {
  const parts = [];
  for (const m of ['sa', 'us']) {
    try {
      const list = await snapshot(m);
      const sel = pickContext(list, question);
      parts.push(`[${m === 'sa' ? 'السوق السعودي' : 'السوق الأمريكي'} — ${list.length} سهماً مفحوصاً، مختارات:]\n` + sel.map(row).join('\n'));
    } catch (e) {
      parts.push(`[تعذّر جلب أسعار ${m === 'sa' ? 'السوق السعودي' : 'السوق الأمريكي'}: ${e.message}]`);
    }
  }
  return parts.join('\n\n');
}

// سؤال المساعد: يعيد نص الإجابة
async function ask({ question, history = [], portfolio = [] }) {
  if (!hasKey()) throw Object.assign(new Error('ANTHROPIC_API_KEY غير مضبوط في إعدادات Vercel'), { code: 'NO_KEY' });
  const client = new Anthropic();

  const ctx = await liveContext(question);
  let userMsg = `بيانات السوق الحية الآن (${new Date().toISOString().slice(0, 16)} UTC):\n${ctx}`;
  if (Array.isArray(portfolio) && portfolio.length) {
    const pf = portfolio.slice(0, 20).map(t =>
      `${t.sym} ${NAMES[t.sym] || ''}: كمية ${t.qty} دخول ${t.entry}${t.sl ? ' وقف ' + t.sl : ''}${t.tp ? ' هدف ' + t.tp : ''}`).join('\n');
    userMsg += `\n\n[صفقات المستخدم المفتوحة:]\n${pf}`;
  }
  userMsg += `\n\nسؤال المستخدم: ${question}`;

  // آخر جولات المحادثة (مُتحقق من أدوارها) ثم الرسالة الحاملة للبيانات
  const msgs = (Array.isArray(history) ? history : [])
    .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim())
    .slice(-6)
    .map(h => ({ role: h.role, content: h.content.slice(0, 2000) }));
  msgs.push({ role: 'user', content: userMsg });

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1400,
    thinking: { type: 'adaptive' },
    // «low» يوازن سرعة الرد مع جودة تناسب المحادثة؛ يُرفع بمتغير AI_EFFORT (medium/high) عند الحاجة
    output_config: { effort: String(process.env.AI_EFFORT || 'low').trim() },
    system: SYSTEM,
    messages: msgs
  });

  if (resp.stop_reason === 'refusal') throw new Error('اعتذر المساعد عن هذا الطلب');
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) throw new Error('وصلت إجابة فارغة');
  return text;
}

module.exports = { ask, hasKey, MODEL };
