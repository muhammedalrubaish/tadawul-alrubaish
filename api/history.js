// دالة خادم Vercel — التاريخ السعري للعملات الرقمية (محاكي السنوات)
// المصدر: CoinGecko (بيانات يومية حقيقية)
const env = process.env;
const clean = v => String(v || '').trim().replace(/^["']+|["']+$/g, '');
const CG_KEY = clean(env.COINGECKO_API_KEY || env.COINGECKO_KEY || '');
const cgHeaders = CG_KEY ? { 'x-cg-demo-api-key': CG_KEY } : {};

// قائمة المعرّفات المسموح بها (نفس عملات السوق)
const ALLOWED = new Set([
  'bitcoin','ethereum','binancecoin','solana','ripple','cardano',
  'dogecoin','tron','avalanche-2','chainlink','polkadot','matic-network'
]);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const coin = clean((req.query && req.query.coin) || '').toLowerCase();
  if (!ALLOWED.has(coin)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'عملة غير مدعومة' });
  }
  try {
    // أقصى مدى تاريخي متاح، بيانات يومية
    const url = `https://api.coingecko.com/api/v3/coins/${coin}/market_chart?vs_currency=usd&days=max`;
    const r = await fetch(url, { headers: cgHeaders });
    if (!r.ok) throw new Error('CoinGecko HTTP ' + r.status);
    const d = await r.json();
    if (!d || !Array.isArray(d.prices)) throw new Error('CoinGecko: استجابة غير متوقعة');
    // [[ts, price], ...] — نُبقي نقطة لكل يوم لتخفيف الحجم
    const prices = d.prices.map(p => [p[0], +p[1]]).filter(p => p[1] > 0);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
    return res.status(200).json({ coin, prices });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
