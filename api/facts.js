// دالة خادم Vercel — حقائق أساسية للسهم: مكرر الربحية والقيمة السوقية ومدى 52 أسبوعاً
// المصدر الأساسي: Yahoo quoteSummary · احتياطي: بيانات chart (52 أسبوعاً فقط)
const { SA_SYMS, US_SYMS } = require('./_symbols');

const YH_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; RasadBot/1.0)' };
const num = v => (v && typeof v === 'object' ? +v.raw : +v) || null;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const sym = String((req.query && req.query.sym) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const market = SA_SYMS.includes(sym) ? 'sa' : US_SYMS.includes(sym) ? 'us' : null;
  if (!market) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'رمز غير مدعوم' });
  }
  const ysym = market === 'sa' ? sym + '.SR' : sym;
  const out = { sym, market, pe: null, fwdPe: null, mcap: null, divYield: null, high52: null, low52: null };

  // المحاولة الأولى: quoteSummary (قد يرفضه Yahoo أحياناً — نتجاوز بهدوء)
  for (const host of YH_HOSTS) {
    try {
      const r = await fetch(`https://${host}/v10/finance/quoteSummary/${encodeURIComponent(ysym)}?modules=summaryDetail,price`, { headers: UA });
      if (!r.ok) continue;
      const d = await r.json();
      const q = d && d.quoteSummary && d.quoteSummary.result && d.quoteSummary.result[0];
      if (!q) continue;
      const sd = q.summaryDetail || {}, pr = q.price || {};
      out.pe = num(sd.trailingPE);
      out.fwdPe = num(sd.forwardPE);
      out.mcap = num(pr.marketCap) || num(sd.marketCap);
      out.divYield = num(sd.dividendYield);
      out.high52 = num(sd.fiftyTwoWeekHigh);
      out.low52 = num(sd.fiftyTwoWeekLow);
      break;
    } catch (e) { /* جرّب المضيف التالي */ }
  }

  // احتياطي مدى 52 أسبوعاً من chart إن لم يتوفر
  if (!out.high52 || !out.low52) {
    for (const host of YH_HOSTS) {
      try {
        const r = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(ysym)}?interval=1d&range=1y`, { headers: UA });
        if (!r.ok) continue;
        const d = await r.json();
        const res0 = d && d.chart && d.chart.result && d.chart.result[0];
        const m = res0 && res0.meta;
        if (m) { out.high52 = out.high52 || +m.fiftyTwoWeekHigh || null; out.low52 = out.low52 || +m.fiftyTwoWeekLow || null; }
        if (!out.high52) {
          const cl = ((res0.indicators || {}).quote || [{}])[0].close || [];
          const vals = cl.filter(x => x > 0);
          if (vals.length > 20) { out.high52 = Math.max(...vals); out.low52 = Math.min(...vals); }
        }
        break;
      } catch (e) { /* جرّب المضيف التالي */ }
    }
  }

  if (!out.pe && !out.mcap && !out.high52) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'لم تتوفر بيانات أساسية' });
  }
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
  return res.status(200).json(out);
};
