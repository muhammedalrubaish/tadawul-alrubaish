// الوكيل المجدول — ملخص فرص يومي إلى تيليجرام قبل افتتاح كل سوق
// يعمل عبر Vercel Cron (مرتان يومياً): قبل افتتاح تداول ثم قبل افتتاح وول ستريت
const { send, TOKEN, CHAT } = require('./_telegram');
const { snapshot, fmtOpps } = require('./_market');
const { ask, hasKey } = require('./_ai');
const autotrade = require('./_autotrade');

// هل اليوم يوم تداول في السوق؟ (عطلة نهاية الأسبوع فقط — العطلات الرسمية نادرة والرسالة غير مضرة)
function tradingDay(market) {
  const tz = market === 'sa' ? 'Asia/Riyadh' : 'America/New_York';
  const wd = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(new Date());
  return market === 'sa' ? !(wd === 'Fri' || wd === 'Sat') : !(wd === 'Sat' || wd === 'Sun');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};

  // تفويض: نداء كرون Vercel، أو سر CRON_SECRET، أو تشغيل يدوي بمعرفة التوكن
  const ua = String(req.headers['user-agent'] || '');
  const auth = String(req.headers['authorization'] || '');
  const secret = String(process.env.CRON_SECRET || '').trim();
  const authorized =
    ua.startsWith('vercel-cron') ||
    (secret && (auth === `Bearer ${secret}` || String(q.key || '') === secret)) ||
    (TOKEN && String(q.key || '') === TOKEN);
  if (!authorized) return res.status(401).json({ error: 'unauthorized' });

  if (!TOKEN || !CHAT) return res.status(503).json({ error: 'أضف TELEGRAM_TOKEN و TELEGRAM_CHAT في إعدادات Vercel' });

  // السوق: صراحةً بالمعامل، وإلا حسب موعد الكرون (صباح UTC = تداول، ظهر UTC = أمريكا)
  const market = q.market === 'us' || q.market === 'sa' ? q.market : (new Date().getUTCHours() < 10 ? 'sa' : 'us');
  if (!q.force && !tradingDay(market)) return res.status(200).json({ skipped: 'عطلة نهاية الأسبوع', market });

  try {
    const list = await snapshot(market);
    let msgText = `📬 <b>ملخص وكيل رصد اليومي</b>\n\n` + fmtOpps(market, list);

    // تعليق ذكي مقتضب إن كان المفتاح مفعّلاً (اختياري — يتجاوز الفشل بصمت)
    if (hasKey()) {
      try {
        const top = list.slice(0, 8).map(s => `${s.sym} ${s.name} درجة ${s.score} تغير ${s.chg}%`).join('، ');
        const comment = await ask({
          question: `هذه أفضل فرص ${market === 'sa' ? 'السوق السعودي' : 'السوق الأمريكي'} اليوم حسب رادار رصد: ${top}. اكتب تعليقاً صباحياً صارماً في 3 جمل كحد أقصى: قراءة عامة للسوق من هذه الأرقام + تحذير مخاطرة واحد محدد.`
        });
        msgText += `\n\n🧠 <b>قراءة المساعد:</b>\n${comment.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}`;
      } catch (_) {}
    }

    await send(CHAT, msgText);

    // التداول الآلي: السوق الأمريكي فقط، ومتوقف تماماً ما لم يُفعَّل صراحةً (AUTOTRADE_ENABLED=true)
    let trade = null;
    if (market === 'us') {
      try {
        trade = await autotrade.runCycle(list);
        if (trade && (trade.ok || trade.stopped)) await send(CHAT, autotrade.fmtCycle(trade));
      } catch (e) {
        await send(CHAT, '⚠️ خطأ في دورة التداول الآلي: ' + String(e.message || e));
      }
    }

    return res.status(200).json({ ok: true, market, scanned: list.length, trade });
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
