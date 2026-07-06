// دالة خادم Vercel — فحص دفعة رموز على استراتيجية «تقاطع الفيواب الشهري بعد تشبع بيعي»
// الإشارة: إغلاق يخترق VWAP الشهري صعوداً + RSI اليومي لامس ≤30 خلال آخر 15 جلسة
const YH_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; RasadBot/1.0)' };
const OK = /^[A-Z][A-Z0-9.\-]{0,7}$/;

// سلسلة RSI(14) بطريقة Wilder
function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / period, al = l / period;
  out[period] = al === 0 ? 100 : Math.round(100 - 100 / (1 + ag / al));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = al === 0 ? 100 : Math.round(100 - 100 / (1 + ag / al));
  }
  return out;
}

// الفيواب الشهري: تراكمي (السعر النموذجي × الحجم) ÷ الحجم، يُصفَّر مع بداية كل شهر
function monthlyVWAP(bars) {
  const out = new Array(bars.length).fill(null);
  let pv = 0, vv = 0, mo = -1;
  for (let i = 0; i < bars.length; i++) {
    const [t, c, h, l, v] = bars[i];
    const m = new Date(t * 1000).getUTCFullYear() * 12 + new Date(t * 1000).getUTCMonth();
    if (m !== mo) { mo = m; pv = 0; vv = 0; }
    const tp = (h + l + c) / 3;
    pv += tp * (v || 0); vv += (v || 0);
    out[i] = vv > 0 ? pv / vv : null;
  }
  return out;
}

// كشف الإشارات ومحاكاة الصفقات بدخول/وقف/هدف يدويين (enPct = إزاحة الدخول ٪)
function evaluate(bars, slPct, tpPct, enPct, rsiTh) {
  enPct = +enPct || 0; rsiTh = +rsiTh || 30;
  const closes = bars.map(b => b[1]);
  const rsis = rsiSeries(closes);
  const vwap = monthlyVWAP(bars);
  const trades = [];
  let open = null, pending = null;
  const fill = (sig, px, fi) => ({ entry: px, sl: px * (1 - slPct / 100), tp: px * (1 + tpPct / 100), bars: 0, t: bars[fi][0] });
  for (let i = 16; i < bars.length; i++) {
    const [t, c, h, l, v] = bars[i];
    if (open) {
      open.bars++;
      if (l <= open.sl) { open.out = 'loss'; open.exit = open.sl; trades.push(open); open = null; }
      else if (h >= open.tp) { open.out = 'win'; open.exit = open.tp; trades.push(open); open = null; }
      else if (open.bars >= 60) { open.out = c > open.entry ? 'win' : 'loss'; open.exit = c; open.timeout = true; trades.push(open); open = null; }
      continue;
    }
    // أمر دخول معلّق بإزاحة يدوية: يُنفَّذ عند لمس السعر المستهدف خلال 5 شموع
    if (pending) {
      pending.wait++;
      const hit = enPct < 0 ? l <= pending.px : h >= pending.px;
      if (hit) { open = fill(pending, pending.px, i); pending = null; }
      else if (pending.wait >= 5) pending = null;
      continue;
    }
    if (vwap[i] == null || vwap[i - 1] == null || rsis[i] == null) continue;
    // الشرطان: تقاطع صاعد مع الفيواب + تشبع بيعي حديث
    if (bars[i - 1][1] > vwap[i - 1] || c <= vwap[i]) continue;
    let minR = 101;
    for (let j = Math.max(0, i - 15); j <= i; j++) if (rsis[j] != null && rsis[j] < minR) minR = rsis[j];
    if (minR > rsiTh) continue;
    if (enPct === 0) open = fill(null, c, i);              // دخول فوري عند التقاطع
    else pending = { px: c * (1 + enPct / 100), wait: 0 }; // انتظار بلوغ سعر الدخول اليدوي
  }
  if (open) { open.out = 'open'; trades.push(open); }
  return trades;
}

async function fetchDaily(sym) {
  let lastErr;
  for (const host of YH_HOSTS) {
    try {
      const r = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1y`, { headers: UA });
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status); continue; }
      const d = await r.json();
      const res0 = d && d.chart && d.chart.result && d.chart.result[0];
      const ts = (res0 && res0.timestamp) || [];
      const q = (res0 && res0.indicators && res0.indicators.quote && res0.indicators.quote[0]) || {};
      const bars = [];
      for (let i = 0; i < ts.length; i++) {
        if (q.close && q.close[i] > 0) bars.push([ts[i], +q.close[i], +(q.high[i] || q.close[i]), +(q.low[i] || q.close[i]), +(q.volume[i] || 0)]);
      }
      if (bars.length < 60) throw new Error('short history');
      return bars;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('fetch failed');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = req.query || {};
  const syms = String(q.syms || '').toUpperCase().split(',').map(s => s.trim()).filter(s => OK.test(s)).slice(0, 30);
  const sl = Math.min(30, Math.max(1, +q.sl || 5));
  const tp = Math.min(100, Math.max(1, +q.tp || 10));
  const en = Math.min(15, Math.max(-15, +q.en || 0));
  const rsiTh = Math.min(45, Math.max(15, +q.rsi || 30));
  if (!syms.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'syms مطلوبة (حتى 30 رمزاً)' });
  }
  const results = await Promise.allSettled(syms.map(async sym => {
    const bars = await fetchDaily(sym);
    const trades = evaluate(bars, sl, tp, en, rsiTh);
    const closed = trades.filter(t => t.out !== 'open');
    const winT = closed.filter(t => t.out === 'win');
    const lossT = closed.filter(t => t.out === 'loss');
    const pnl = t => (t.exit / t.entry - 1) * 100;
    // مجاميع الربح والخسارة الفعلية ٪ (تشمل خروج المهلة بقيمته الحقيقية)
    const sumW = +winT.reduce((a, t) => a + pnl(t), 0).toFixed(3);
    const sumL = +lossT.reduce((a, t) => a + pnl(t), 0).toFixed(3);
    return {
      sym,
      n: trades.length,
      wins: winT.length,
      losses: lossT.length,
      open: trades.length - closed.length,
      wr: closed.length ? Math.round(winT.length / closed.length * 100) : null,
      sumW, sumL,
      avgBars: closed.length ? Math.round(closed.reduce((a, t) => a + t.bars, 0) / closed.length) : null,
      lastSig: trades.length ? trades[trades.length - 1].t : null
    };
  }));
  const out = [], failed = [];
  results.forEach((r, i) => { if (r.status === 'fulfilled') out.push(r.value); else failed.push(syms[i]); });
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=43200');
  return res.status(200).json({ sl, tp, scanned: out.length, failed: failed.length, results: out });
};
