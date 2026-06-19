// دالة خادم Vercel — وسيط أسعار حقيقية
// المصدر الأساسي: Yahoo Finance (مجاني · فوري · بلا مفتاح · يغطي تداول السعودي .SR والأمريكي)
// احتياطي: سهمك SAHMK للسعودي · Twelve Data للأمريكي (من متغيرات البيئة)
const env = process.env;
const clean = v => String(v || '').trim().replace(/^["']+|["']+$/g, '');
let _sahmk = clean(env.SAHMK_API_KEY || env.SAHMK_KEY || env.SAHMK);
let _twelve = clean(env.TWELVEDATA_API_KEY || env.TWELVE_DATA_API_KEY || env.TWELVEDATA_KEY || env.TWELVE_API_KEY);
if (!_sahmk.startsWith('shmk_') && _twelve.startsWith('shmk_')) { const t = _sahmk; _sahmk = _twelve; _twelve = t; }
const SAHMK_KEY = _sahmk;
const TWELVE_KEY = _twelve;

const SA_SYMS = ['2222','1120','2010','7010','1180','2380','4013','2082','4263','1211','4190','2280'];
const US_SYMS = ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','NFLX','AVGO','AMD','LLY','V','XOM','KO','WMT','JPM'];

const YH_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; RasadBot/1.0)' };

// جلب سعر سهم واحد من Yahoo Finance (فوري)
async function yahooOne(ysym) {
  let lastErr;
  for (const host of YH_HOSTS) {
    try {
      const r = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(ysym)}?interval=1d&range=5d`, { headers: UA });
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status); continue; }
      const d = await r.json();
      const m = d && d.chart && d.chart.result && d.chart.result[0] && d.chart.result[0].meta;
      if (m && m.regularMarketPrice > 0) {
        return {
          price: +m.regularMarketPrice,
          open: +(m.chartPreviousClose || m.previousClose || 0),
          vol: +(m.regularMarketVolume || 0)
        };
      }
      lastErr = new Error('no price');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('yahoo failed');
}

// جلب مجموعة رموز من Yahoo (لاحقة اختيارية مثل .SR للسوق السعودي)
async function fetchYahoo(syms, suffix) {
  const results = await Promise.allSettled(syms.map(async sym => {
    const q = await yahooOne(sym + (suffix || ''));
    return [sym, { price: q.price, open: q.open, volRatio: 0 }];
  }));
  const quotes = {};
  results.forEach(res => { if (res.status === 'fulfilled') quotes[res.value[0]] = res.value[1]; });
  return quotes;
}

// احتياطي السوق السعودي — سهمك SAHMK
async function fetchSahmk() {
  if (!SAHMK_KEY) throw new Error('no SAHMK key');
  const headers = { 'X-API-Key': SAHMK_KEY, 'Accept': 'application/json' };
  const quotes = {};
  const r = await fetch(`https://app.sahmk.sa/api/v1/quotes/?identifiers=${SA_SYMS.join(',')}`, { headers });
  if (r.ok) {
    const d = await r.json();
    (d.quotes || []).forEach(q => {
      const price = +q.price, change = +q.change || 0;
      if (price > 0) quotes[q.symbol] = { price, open: price - change, volRatio: 0 };
    });
  }
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
  return quotes;
}

// احتياطي السوق الأمريكي — Twelve Data
async function fetchTwelve() {
  if (!TWELVE_KEY) throw new Error('no Twelve key');
  const grp = US_SYMS.slice(0, 8);
  const r = await fetch(`https://api.twelvedata.com/quote?symbol=${grp.join(',')}&apikey=${TWELVE_KEY}`);
  if (!r.ok) throw new Error('Twelve Data HTTP ' + r.status);
  const d = await r.json();
  if (d.status === 'error') throw new Error('Twelve Data: ' + d.message);
  const quotes = {};
  grp.forEach(sym => {
    const q = d[sym];
    if (q && q.close) {
      const price = parseFloat(q.close);
      if (price > 0) quotes[sym] = { price, open: parseFloat(q.previous_close) || 0, volRatio: 0 };
    }
  });
  return quotes;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const market = String((req.query && req.query.market) || 'sa').toLowerCase();
  if (market !== 'sa' && market !== 'us') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'market must be sa or us' });
  }
  try {
    let quotes = {}, source = 'yahoo';
    // المصدر الأساسي: Yahoo Finance
    try { quotes = await fetchYahoo(market === 'sa' ? SA_SYMS : US_SYMS, market === 'sa' ? '.SR' : ''); }
    catch (e) { quotes = {}; }
    // احتياطي عند فشل Yahoo كلياً
    if (!Object.keys(quotes).length) {
      source = market === 'sa' ? 'sahmk' : 'twelvedata';
      quotes = market === 'sa' ? await fetchSahmk() : await fetchTwelve();
    }
    if (!Object.keys(quotes).length) throw new Error('لم تصل أسعار من أي مصدر');
    // أسعار فورية مع تخزين مؤقت قصير
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
    return res.status(200).json({ market, source, count: Object.keys(quotes).length, quotes });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
