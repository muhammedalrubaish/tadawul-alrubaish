// دالة خادم Vercel — أخبار حقيقية مرتبطة بالأسهم (Yahoo Finance Search)
// مجاني · بلا مفتاح · يغطي السوقين السعودي (.SR) والأمريكي
const SA_SYMS = ['2222','1120','2010','7010','1180','2380','4013','2082','4263','1211','4190','2280'];
const US_SYMS = ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','NFLX','AVGO','AMD','LLY','V','XOM','KO','WMT','JPM'];

const YH_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; RasadBot/1.0)' };

// كلمات دالة لتقدير أثر الخبر (إيجابي/سلبي) — عربي وإنجليزي
const POS = ['beat','beats','surge','surges','jump','jumps','rise','rises','rally','soar','soars','record','profit','growth','grow','grows','upgrade','upgrades','raise','raises','raised','win','wins','won','approval','approve','approved','expand','expands','expansion','strong','boost','boosts','higher','deal','deals','partnership','gain','gains','dividend','buyback','outperform','top','tops','launch','launches','ترتفع','تقفز','صعود','أرباح','نمو','توسّع','توسع','يفوز','تفوز','موافقة','قياسي','توزيعات','اتفاقية','إطلاق','تطلق','ترفع','تعزز'];
const NEG = ['fall','falls','drop','drops','plunge','plunges','miss','misses','loss','losses','cut','cuts','decline','declines','probe','lawsuit','investigation','warn','warns','warning','downgrade','downgrades','recall','delay','delays','weak','weakness','lower','slump','halt','halts','layoff','layoffs','fraud','fine','fined','sink','sinks','slip','slips','تتراجع','هبوط','تهبط','خسارة','خسائر','تحقيق','تأجيل','يؤجل','تؤجل','خفض','تخفض','ضغط','يضغط','ضعف','دعوى','غرامة','تراجع'];

function impactOf(title) {
  const t = String(title || '').toLowerCase();
  let p = 0, n = 0;
  POS.forEach(w => { if (t.includes(w)) p++; });
  NEG.forEach(w => { if (t.includes(w)) n++; });
  if (p > n) return 'p';
  if (n > p) return 'n';
  return 'u';
}

function hhmm(unixSec) {
  const d = new Date((+unixSec || 0) * 1000);
  if (isNaN(d.getTime()) || !unixSec) return '';
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

// جلب أخبار رمز واحد من Yahoo Search
async function newsFor(ysym, baseSym) {
  let lastErr;
  for (const host of YH_HOSTS) {
    try {
      const r = await fetch(`https://${host}/v1/finance/search?q=${encodeURIComponent(ysym)}&newsCount=5&quotesCount=0&enableNavLinks=false&enableCb=false`, { headers: UA });
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status); continue; }
      const d = await r.json();
      return (d.news || []).map(it => ({
        id: it.uuid || it.link || it.title,
        t: hhmm(it.providerPublishTime),
        ts: +it.providerPublishTime || 0,
        txt: it.title,
        sym: baseSym,
        imp: impactOf(it.title),
        link: it.link || '',
        publisher: it.publisher || ''
      })).filter(x => x.txt);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('yahoo news failed');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const market = String((req.query && req.query.market) || 'sa').toLowerCase();
  if (market !== 'sa' && market !== 'us') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'market must be sa or us' });
  }
  try {
    const syms = market === 'sa' ? SA_SYMS : US_SYMS;
    const suffix = market === 'sa' ? '.SR' : '';
    const results = await Promise.allSettled(syms.map(sym => newsFor(sym + suffix, sym)));

    const seen = new Set();
    let news = [];
    results.forEach(r => {
      if (r.status === 'fulfilled') r.value.forEach(it => {
        const key = it.id || it.txt;
        if (seen.has(key)) return;
        seen.add(key);
        news.push(it);
      });
    });
    // الأحدث أولاً ثم الاكتفاء بأبرز 14 خبراً
    news.sort((a, b) => b.ts - a.ts);
    news = news.slice(0, 14).map(({ id, ts, ...rest }) => rest);

    if (!news.length) throw new Error('لم تصل أخبار');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    return res.status(200).json({ market, count: news.length, news });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
