// دالة خادم Vercel — عينة الفحص الأمريكية (حتى ~2000 سهم من الأنشط والأوسع تداولاً)
// المصدر: عدة فاحصات Yahoo الجاهزة (كل واحد 250 × صفحات) · احتياطي: قائمة مضمّنة
const FALLBACK = require('./_us_fallback');

const YH_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; RasadBot/1.0)' };
const OK = /^[A-Z][A-Z0-9.\-]{0,7}$/;

// فاحصات جاهزة متنوعة لتوسيع العينة عبر شرائح السوق المختلفة
const SCREENERS = ['most_actives', 'day_gainers', 'day_losers', 'growth_technology_stocks', 'undervalued_large_caps', 'undervalued_growth_stocks', 'aggressive_small_caps', 'small_cap_gainers', 'most_shorted_stocks'];

async function pageOf(host, scr, offset) {
  const r = await fetch(`https://${host}/v1/finance/screener/predefined/saved?scrIds=${scr}&count=250&offset=${offset}`, { headers: UA });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const qs = d && d.finance && d.finance.result && d.finance.result[0] && d.finance.result[0].quotes;
  if (!Array.isArray(qs)) throw new Error('bad page');
  return qs.map(q => String(q.symbol || '').toUpperCase()).filter(s => OK.test(s));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const want = Math.min(2000, Math.max(100, +((req.query && req.query.count)) || 2000));
  const set = new Set();
  let source = 'yahoo_screeners';

  for (const host of YH_HOSTS) {
    try {
      for (const scr of SCREENERS) {
        if (set.size >= want) break;
        // حتى صفحتين لكل فاحص (500 نتيجة كحد)
        for (const off of [0, 250]) {
          if (set.size >= want) break;
          try { (await pageOf(host, scr, off)).forEach(s => set.add(s)); }
          catch (e) { break; } // انتقل للفاحص التالي عند فشل صفحة
        }
      }
      if (set.size >= 300) break; // نجح هذا المضيف
    } catch (e) { /* جرّب المضيف التالي */ }
  }

  let syms = [...set];
  // دمج القائمة الاحتياطية لضمان أرضية صلبة وتغطية أوسع
  FALLBACK.forEach(s => { if (syms.length < want && !set.has(s)) { set.add(s); syms.push(s); } });
  if (syms.length < 100) { syms = FALLBACK.slice(0, want); source = 'fallback'; }
  syms = syms.slice(0, want);

  // العينة تتغير ببطء — تخزين نصف يوم
  res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400');
  return res.status(200).json({ market: 'us', source, count: syms.length, symbols: syms });
};
