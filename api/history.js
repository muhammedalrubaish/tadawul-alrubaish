// دالة خادم Vercel — التاريخ السعري للعملات الرقمية (محاكي السنوات)
// المصدر: Binance Public Market Data (شموع أسبوعية، بيانات حقيقية متعددة السنوات، بلا مفتاح)
const clean = v => String(v || '').trim().replace(/^["']+|["']+$/g, '');

// مُعرّف CoinGecko ↔ رمز Binance (مقابل USDT)
const SYMBOLS = {
  'bitcoin':'BTCUSDT', 'ethereum':'ETHUSDT', 'binancecoin':'BNBUSDT',
  'solana':'SOLUSDT', 'ripple':'XRPUSDT', 'cardano':'ADAUSDT',
  'dogecoin':'DOGEUSDT', 'tron':'TRXUSDT', 'avalanche-2':'AVAXUSDT',
  'chainlink':'LINKUSDT', 'polkadot':'DOTUSDT', 'litecoin':'LTCUSDT'
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const coin = clean((req.query && req.query.coin) || '').toLowerCase();
  const symbol = SYMBOLS[coin];
  if (!symbol) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'عملة غير مدعومة' });
  }
  try {
    // شموع أسبوعية حتى ~11.5 سنة (data-api.binance.vision غير محجوب جغرافياً)
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1w&limit=600`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Binance HTTP ' + r.status);
    const d = await r.json();
    if (!Array.isArray(d) || !d.length) throw new Error('Binance: استجابة غير متوقعة');
    // [openTime, open, high, low, close, ...] → [[ts, close], ...]
    const prices = d.map(k => [k[0], +k[4]]).filter(p => p[1] > 0);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
    return res.status(200).json({ coin, symbol, prices });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
