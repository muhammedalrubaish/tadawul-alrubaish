// دالة خادم Vercel — وسيط آمن لجلب الأسعار الحقيقية
// السوق السعودي: سهمك SAHMK · السوق الأمريكي: Twelve Data
// المفاتيح من متغيرات البيئة في إعدادات مشروع Vercel (تُقبل عدة صيغ للاسم)
const env = process.env;
// تنظيف القيمة من المسافات وعلامات الاقتباس
const clean = v => String(v || '').trim().replace(/^["']+|["']+$/g, '');
let _sahmk = clean(env.SAHMK_API_KEY || env.SAHMK_KEY || env.SAHMK);
let _twelve = clean(env.TWELVEDATA_API_KEY || env.TWELVE_DATA_API_KEY || env.TWELVEDATA_KEY || env.TWELVE_API_KEY);
// تصحيح تلقائي إن وُضع المفتاحان في الخانتين المعاكستين
if (!_sahmk.startsWith('shmk_') && _twelve.startsWith('shmk_')) { const t = _sahmk; _sahmk = _twelve; _twelve = t; }
const SAHMK_KEY = _sahmk;
const TWELVE_KEY = _twelve;
// تشخيص عند الخطأ: أسماء المتغيرات المتاحة وطول كل قيمة وبدايتها فقط (بلا كشف المفاتيح)
const envHint = () => ({
  keys: Object.keys(env).filter(k => /sahmk|shmk|twelve/i.test(k)).join(',') || 'none',
  sahmk: SAHMK_KEY ? SAHMK_KEY.slice(0, 5) + '… (' + SAHMK_KEY.length + ' حرفاً)' : 'فارغ',
  twelve: TWELVE_KEY ? TWELVE_KEY.slice(0, 4) + '… (' + TWELVE_KEY.length + ' حرفاً)' : 'فارغ'
});

const SA_SYMS = ['2222','1120','2010','7010','1180','2380','4013','2082','4263','1211','4190','2280'];
const US_SYMS = ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','NFLX','AVGO','AMD','LLY','V','XOM','KO','WMT','JPM'];

async function fetchSaudi() {
  const headers = { 'X-API-Key': SAHMK_KEY, 'Accept': 'application/json' };
  const quotes = {};
  // نقطة الدفعات (تتطلب خطة Starter فأعلى)
  const r = await fetch(`https://app.sahmk.sa/api/v1/quotes/?identifiers=${SA_SYMS.join(',')}`, { headers });
  if (r.ok) {
    const d = await r.json();
    (d.quotes || []).forEach(q => {
      const price = +q.price, change = +q.change || 0;
      if (price > 0) quotes[q.symbol] = { price, open: price - change, volRatio: 0 };
    });
  }
  // ما لم يصل عبر الدفعات يُجلب بطلبات فردية
  const missing = SA_SYMS.filter(sym => !quotes[sym]);
  if (missing.length) {
    const results = await Promise.allSettled(missing.map(async sym => {
      const rq = await fetch(`https://app.sahmk.sa/api/v1/quote/${sym}/`, { headers });
      if (!rq.ok) throw new Error('HTTP ' + rq.status);
      return rq.json();
    }));
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        const q = res.value.quote || res.value;
        const price = +q.price, change = +q.change || 0;
        if (price > 0) quotes[q.symbol || missing[i]] = { price, open: price - change, volRatio: 0 };
      }
    });
  }
  if (!Object.keys(quotes).length) throw new Error('SAHMK: لم تصل أسعار — تحقق من المفتاح أو الخطة');
  return quotes;
}

async function fetchUS() {
  // الخطة المجانية في Twelve Data تسمح بـ 8 رموز في الدقيقة،
  // لذلك تُجلب الرموز الـ 16 على مجموعتين بالتناوب كل 5 دقائق (مع التخزين المؤقت)
  const groups = [US_SYMS.slice(0, 8), US_SYMS.slice(8)];
  const grp = groups[Math.floor(Date.now() / 300000) % 2];
  const r = await fetch(`https://api.twelvedata.com/quote?symbol=${grp.join(',')}&apikey=${TWELVE_KEY}`);
  if (!r.ok) throw new Error('Twelve Data HTTP ' + r.status);
  const d = await r.json();
  if (d.status === 'error') throw new Error('Twelve Data: ' + d.message);
  const quotes = {};
  grp.forEach(sym => {
    const q = grp.length === 1 ? d : d[sym];
    if (q && q.close) {
      const price = parseFloat(q.close);
      if (price > 0) quotes[sym] = {
        price,
        open: parseFloat(q.previous_close) || 0,
        volRatio: (q.volume && q.average_volume && +q.average_volume > 0) ? +q.volume / +q.average_volume : 0
      };
    }
  });
  if (!Object.keys(quotes).length) throw new Error('Twelve Data: لم تصل أسعار');
  return quotes;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const market = String((req.query && req.query.market) || 'sa').toLowerCase();
  try {
    if (market === 'sa') {
      const quotes = await fetchSaudi();
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
      return res.status(200).json({ market, quotes });
    }
    if (market === 'us') {
      const quotes = await fetchUS();
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ market, quotes });
    }
    return res.status(400).json({ error: 'market must be sa or us' });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: String((e && e.message) || e), envKeys: envHint() });
  }
};
