// دالة خادم Vercel — عينة الفحص الأمريكية (~1000 سهم من الأنشط تداولاً)
// المصدر: فاحص Yahoo الجاهز most_actives (4 صفحات × 250) · احتياطي: قائمة مضمّنة
const FALLBACK = require('./_us_fallback');

const YH_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; RasadBot/1.0)' };
const OK = /^[A-Z][A-Z0-9.\-]{0,7}$/;

async function pageOf(host, offset) {
  const r = await fetch(`https://${host}/v1/finance/screener/predefined/saved?scrIds=most_actives&count=250&offset=${offset}`, { headers: UA });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const qs = d && d.finance && d.finance.result && d.finance.result[0] && d.finance.result[0].quotes;
  if (!Array.isArray(qs) || !qs.length) throw new Error('empty page');
  return qs.map(q => String(q.symbol || '').toUpperCase()).filter(s => OK.test(s));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  let syms = [], source = 'yahoo_most_actives';
  for (const host of YH_HOSTS) {
    try {
      const pages = await Promise.all([0, 250, 500, 750].map(off => pageOf(host, off)));
      syms = [...new Set(pages.flat())];
      if (syms.length >= 300) break;
      syms = [];
    } catch (e) { syms = []; }
  }
  if (!syms.length) { syms = FALLBACK; source = 'fallback'; }
  // العينة تتغير ببطء — تخزين نصف يوم
  res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400');
  return res.status(200).json({ market: 'us', source, count: syms.length, symbols: syms });
};
