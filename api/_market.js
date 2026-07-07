// وحدة مشتركة للوكيل: لقطة السوق الحية + درجة الفرصة (استراتيجية «المتوازنة» نفسها في الواجهة)
const NAMES = require('./_names');
const { getQuotes } = require('./quotes');

// درجة الفرصة 0-100: زخم السعر + السيولة + موقع RSI من النطاق المثالي (45-68)
function score(q) {
  const chg = q.open > 0 ? ((q.price - q.open) / q.open) * 100 : 0;
  const ms = Math.max(0, Math.min(100, 50 + chg * 9));
  const vs = Math.max(0, Math.min(100, (q.volRatio || 0) * 37));
  const mid = 56.5, half = 11.5;
  const rs = Math.max(0, Math.min(100, 100 - Math.abs((q.rsi || 50) - mid) / half * 55));
  return Math.max(0, Math.min(100, Math.round(ms * .40 + vs * .30 + rs * .30)));
}

// لقطة سوق كاملة — نداء مباشر لمنطق /api/quotes داخل نفس العملية (بلا طلب HTTP ذاتي)
async function snapshot(market) {
  const { quotes } = await getQuotes(market);
  const list = [];
  for (const [sym, q] of Object.entries(quotes || {})) {
    if (!(q.price > 0)) continue;
    const chg = q.open > 0 ? ((q.price - q.open) / q.open) * 100 : 0;
    list.push({
      sym,
      name: NAMES[sym] || sym,
      price: +q.price,
      chg: +chg.toFixed(2),
      rsi: q.rsi || 0,
      vol: +(q.volRatio || 0).toFixed(2),
      score: score(q)
    });
  }
  list.sort((a, b) => b.score - a.score);
  return list;
}

const fmtN = (n, d = 2) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const mktLabel = m => m === 'sa' ? '🇸🇦 السوق السعودي' : '🇺🇸 السوق الأمريكي';

// خطة استراتيجية «المتوازنة»: وقف −3.5٪ · هدف أول +6.5٪ · هدف ثانٍ +12٪
function plan(price) {
  return { sl: price * .965, tp1: price * 1.065, tp2: price * 1.12 };
}

// رسالة تيليجرام (HTML) بأفضل الفرص — سطر لكل سهم
function fmtOpps(market, list, n = 8) {
  const top = list.slice(0, n);
  const lines = top.map((s, i) => {
    const p = plan(s.price);
    const sig = s.score >= 72 ? '🟢' : s.score >= 50 ? '🟡' : '⚪';
    return `${sig} <b>${esc(s.name)}</b> <code>${s.sym}</code>\n` +
      `   السعر ${fmtN(s.price)} (${s.chg >= 0 ? '+' : ''}${fmtN(s.chg)}%) · RSI ${s.rsi} · سيولة ×${fmtN(s.vol, 1)} · درجة <b>${s.score}</b>/100\n` +
      `   وقف ${fmtN(p.sl)} · هدف١ ${fmtN(p.tp1)} · هدف٢ ${fmtN(p.tp2)}`;
  });
  const buys = list.filter(s => s.score >= 72).length;
  return `<b>${mktLabel(market)} — رادار رصد</b>\n` +
    `${list.length} سهماً مفحوصاً · ${buys} إشارة شراء (72+)\n\n` +
    lines.join('\n\n') +
    `\n\n⚠️ أداة مساعدة على القرار وليست توصية استثمارية — القرار قرارك.`;
}

// بطاقة سهم واحد
function fmtSym(s, market) {
  const p = plan(s.price);
  const sig = s.score >= 72 ? '🟢 اقتنِص' : s.score >= 50 ? '🟡 راقِب' : '⚪ تجنَّب';
  return `<b>${esc(s.name)}</b> <code>${s.sym}</code> — ${mktLabel(market)}\n` +
    `السعر <b>${fmtN(s.price)}</b> (${s.chg >= 0 ? '+' : ''}${fmtN(s.chg)}%)\n` +
    `RSI ${s.rsi} · سيولة ×${fmtN(s.vol, 1)} · درجة الفرصة <b>${s.score}</b>/100 → ${sig}\n` +
    `وقف مقترح ${fmtN(p.sl)} · هدف أول ${fmtN(p.tp1)} · هدف ثانٍ ${fmtN(p.tp2)}\n\n` +
    `⚠️ ليست توصية استثمارية.`;
}

function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

module.exports = { snapshot, score, plan, fmtOpps, fmtSym, mktLabel, esc, NAMES };
