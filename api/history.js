// دالة خادم Vercel — التاريخ الكامل لسهم (من أول تداول حتى الأحدث) لمحاكي الاستثمار
// المصدر: Yahoo Finance (مجاني · بلا مفتاح) — إغلاقات شهرية لتصغير الحمولة
const SA_SYMS = ['2222','1120','2010','7010','1180','2380','4013','2082','4263','1211','4190','2280'];
const US_SYMS = ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','NFLX','AVGO','AMD','LLY','V','XOM','KO','WMT','JPM'];

const YH_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; RasadBot/1.0)' };

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = req.query || {};
  const sym = String(q.sym || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const market = SA_SYMS.includes(sym) ? 'sa' : US_SYMS.includes(sym) ? 'us' : null;
  if (!market) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'رمز غير مدعوم' });
  }
  const ysym = market === 'sa' ? sym + '.SR' : sym;
  // res=d: بيانات يومية (10 سنوات) بإغلاق/أعلى/أدنى/حجم — للباك-تيست والدعم/المقاومة
  const daily = String(q.res || '').toLowerCase() === 'd';
  const params = daily ? 'interval=1d&range=10y' : 'interval=1mo&range=max';
  let lastErr;
  for (const host of YH_HOSTS) {
    try {
      const r = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(ysym)}?${params}`, { headers: UA });
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status); continue; }
      const d = await r.json();
      const res0 = d && d.chart && d.chart.result && d.chart.result[0];
      const ts = (res0 && res0.timestamp) || [];
      const qd = (res0 && res0.indicators && res0.indicators.quote && res0.indicators.quote[0]) || {};
      const cl = qd.close || [], hi = qd.high || [], lo = qd.low || [], vo = qd.volume || [];
      const pts = [];
      for (let i = 0; i < ts.length; i++) {
        if (!(cl[i] > 0)) continue;
        pts.push(daily
          ? [ts[i], +cl[i].toFixed(4), +(hi[i] || cl[i]).toFixed(4), +(lo[i] || cl[i]).toFixed(4), +(vo[i] || 0)]
          : [ts[i], +cl[i].toFixed(4)]);
      }
      // السعر اللحظي كنقطة أخيرة إن كان أحدث
      const m = res0 && res0.meta;
      if (!daily && m && m.regularMarketPrice > 0 && pts.length && m.regularMarketTime > pts[pts.length - 1][0]) {
        pts.push([m.regularMarketTime, +(+m.regularMarketPrice).toFixed(4)]);
      }
      if (pts.length < 12) throw new Error('تاريخ غير كافٍ');
      // التاريخ يتغير مرة يومياً على الأكثر — تخزين طويل
      res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400');
      return res.status(200).json({ sym, market, res: daily ? 'd' : 'mo', count: pts.length, points: pts });
    } catch (e) { lastErr = e; }
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(502).json({ error: String((lastErr && lastErr.message) || lastErr || 'فشل الجلب') });
};
