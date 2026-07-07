// ويبهوك تيليجرام — واجهة الوكيل من الهاتف
// الأوامر: «فرص» فحص فوري · رمز سهم (2222 أو AAPL) بطاقة تحليل · أي سؤال آخر → المساعد الذكي
const { api, send, TOKEN, CHAT, SECRET } = require('./_telegram');
const { snapshot, fmtOpps, fmtSym, esc } = require('./_market');
const { ask, hasKey } = require('./_ai');

const HELP = `👋 أهلاً! أنا <b>وكيل رصد</b> — أراقب السوقين السعودي والأمريكي وأعمل عنك حتى والتطبيق مغلق.

الأوامر:
• <b>فرص</b> — فحص فوري لأفضل الفرص في السوقين
• <b>رمز سهم</b> — مثل <code>2222</code> أو <code>AAPL</code> — بطاقة تحليل فورية
• <b>أي سؤال حر</b> — أجيب بالذكاء الاصطناعي مع الأسعار الحية

وأرسل لك تلقائياً ملخص الفرص قبل افتتاح كل سوق يومياً 📬`;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  // ===== GET: الحالة والتهيئة =====
  if (req.method === 'GET') {
    const q = req.query || {};
    if (q.health) return res.status(200).json({ tg: !!TOKEN, chat: !!CHAT, ai: hasKey() });
    // تهيئة الويبهوك: /api/tg?setup=<TELEGRAM_TOKEN> — تتطلب معرفة التوكن نفسه
    if (q.setup) {
      if (!TOKEN) return res.status(503).json({ error: 'أضف TELEGRAM_TOKEN في إعدادات Vercel أولاً' });
      if (String(q.setup) !== TOKEN) return res.status(401).json({ error: 'التوكن غير مطابق' });
      const url = `https://${req.headers.host}/api/tg`;
      try {
        await api('setWebhook', { url, secret_token: SECRET, drop_pending_updates: true, allowed_updates: ['message'] });
        const me = await api('getMe', {});
        return res.status(200).json({ ok: true, webhook: url, bot: '@' + me.username, chatConfigured: !!CHAT, aiConfigured: hasKey() });
      } catch (e) { return res.status(502).json({ error: String(e.message || e) }); }
    }
    return res.status(200).json({ ok: true, hint: 'استخدم ?setup=<TOKEN> للتهيئة أو ?health=1 للحالة' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST فقط' });
  // تحقق أن التحديث قادم من تيليجرام فعلاً (السر المضبوط في setWebhook)
  if (!TOKEN || String(req.headers['x-telegram-bot-api-secret-token'] || '') !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const msg = (req.body || {}).message;
  // نرد 200 دائماً كي لا يعيد تيليجرام الإرسال
  const done = () => res.status(200).json({ ok: true });
  if (!msg || !msg.chat) return done();
  const chatId = msg.chat.id;
  const text = String(msg.text || '').trim();

  try {
    // أول تشغيل: ساعد المستخدم على معرفة معرّف محادثته
    if (!CHAT) {
      await send(chatId, `معرّف محادثتك هو: <code>${chatId}</code>\n\nأضفه كمتغير بيئة باسم <b>TELEGRAM_CHAT</b> في إعدادات مشروع Vercel ثم أعد النشر، وسيعمل الوكيل لك وحدك.`);
      return done();
    }
    // البوت خاص بصاحبه فقط
    if (String(chatId) !== CHAT) return done();

    if (!text || text === '/start' || /مساعدة|help/i.test(text)) {
      await send(chatId, HELP);
      return done();
    }

    // «فرص» — فحص فوري للسوقين
    if (/^\/?(فرص|الفرص|opps)$/i.test(text)) {
      await send(chatId, '🔍 أفحص السوقين الآن…');
      for (const m of ['sa', 'us']) {
        try { await send(chatId, fmtOpps(m, await snapshot(m))); }
        catch (e) { await send(chatId, `تعذّر فحص ${m === 'sa' ? 'السوق السعودي' : 'السوق الأمريكي'}: ${esc(e.message)}`); }
      }
      return done();
    }

    // رمز سهم صريح: 4 أرقام سعودي أو رمز أمريكي
    const symM = text.toUpperCase().match(/^([0-9]{4}|[A-Z][A-Z0-9.\-]{0,6})$/);
    if (symM) {
      const sym = symM[1];
      const market = /^[0-9]{4}$/.test(sym) ? 'sa' : 'us';
      const list = await snapshot(market);
      const s = list.find(x => x.sym === sym);
      if (s) { await send(chatId, fmtSym(s, market)); return done(); }
      // ليس في قائمتنا؟ جرّبه سؤالاً للمساعد إن كان مفعّلاً
    }

    // سؤال حر → المساعد الذكي
    if (!hasKey()) {
      await send(chatId, 'المساعد الذكي غير مفعّل بعد — أضف <b>ANTHROPIC_API_KEY</b> في إعدادات Vercel.\nما زال بإمكانك إرسال «فرص» أو رمز سهم.');
      return done();
    }
    const answer = await ask({ question: text });
    await send(chatId, esc(answer));
    return done();
  } catch (e) {
    try { await send(chatId, '⚠️ حدث خطأ: ' + esc(String((e && e.message) || e))); } catch (_) {}
    return done();
  }
};
