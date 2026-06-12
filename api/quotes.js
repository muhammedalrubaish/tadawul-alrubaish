// دالة خادم Vercel — وسيط آمن لجلب الأسعار الحقيقية
// السوق السعودي: سهمك SAHMK · السوق الأمريكي: Twelve Data
const SAHMK_KEY = process.env.SAHMK_API_KEY || 'shmk_live_915f6838f1473b78b7eb550737312fd4a190b3912af40a61';
const TWELVE_KEY = process.env.TWELVEDATA_API_KEY || 'f7d5bec171764520a87807fab2b273c6';

const SA_SYMS = ['2222','1120','2010','7010','1180','2380','4013','2082','4263','1211','4190','2280'];
const US_SYMS = ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','NFLX'];

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
  const r = await fetch(`https://api.twelvedata.com/quote?symbol=${US_SYMS.join(',')}&apikey=${TWELVE_KEY}`);
  if (!r.ok) throw new Error('Twelve Data HTTP ' + r.status);
  const d = await r.json();
  if (d.status === 'error') throw new Error('Twelve Data: ' + d.message);
  const quotes = {};
  US_SYMS.forEach(sym => {
    const q = US_SYMS.length === 1 ? d : d[sym];
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
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
