// منطق التداول الآلي — السوق الأمريكي فقط، ضمن حدود صارمة مضبوطة بمتغيرات بيئة
// مبدأ الأمان: كل حد أقصى يُقرأ من البيئة بقيمة افتراضية متحفظة، والمفتاح الرئيسي (AUTOTRADE_ENABLED)
// يجب ضبطه صراحة إلى "true" وإلا فالتداول متوقف تماماً. الوقف والهدف يُنفَّذان من الوسيط نفسه (bracket order).
const broker = require('./_broker');
const { plan, esc } = require('./_market');

const num = (v, d) => { const n = +v; return Number.isFinite(n) && n > 0 ? n : d; };
const cfg = () => ({
  enabled: String(process.env.AUTOTRADE_ENABLED || '').trim().toLowerCase() === 'true',
  maxPositionUsd: num(process.env.AUTOTRADE_MAX_POSITION_USD, 200),
  maxOpenPositions: num(process.env.AUTOTRADE_MAX_OPEN_POSITIONS, 5),
  maxDailyTrades: num(process.env.AUTOTRADE_MAX_DAILY_TRADES, 3),
  dailyLossLimitUsd: num(process.env.AUTOTRADE_DAILY_LOSS_LIMIT_USD, 100),
  minScore: num(process.env.AUTOTRADE_MIN_SCORE, 72)
});

// دورة تداول واحدة: تُستدعى من الكرون اليومي للسوق الأمريكي بعد جلب لقطة الأسعار
// list: لقطة السوق الأمريكي (نفس المستخدمة في الملخص اليومي) — لا نداء شبكي إضافي
async function runCycle(list) {
  const c = cfg();
  if (!c.enabled) return { skipped: 'AUTOTRADE_ENABLED ليس true — التداول الآلي متوقف' };
  if (!broker.hasKeys()) return { skipped: 'ALPACA_KEY/ALPACA_SECRET غير مضبوطين' };

  const account = await broker.getAccount();
  if (account.trading_blocked || account.account_blocked) {
    return { skipped: 'الحساب موقوف لدى الوسيط (trading_blocked/account_blocked)' };
  }

  // قاطع الدائرة: خسارة اليوم (تغيّر حقوق الملكية منذ إغلاق الأمس) تتجاوز الحد المسموح
  const dailyPL = +account.equity - +account.last_equity;
  if (dailyPL <= -c.dailyLossLimitUsd) {
    return { stopped: 'daily_loss_limit', dailyPL: +dailyPL.toFixed(2), limit: c.dailyLossLimitUsd, notify: true };
  }

  const positions = await broker.getPositions();
  if (positions.length >= c.maxOpenPositions) {
    return { skipped: 'max_open_positions', count: positions.length, limit: c.maxOpenPositions };
  }

  const todayBuys = await broker.getTodayFilledBuyOrders();
  if (todayBuys.length >= c.maxDailyTrades) {
    return { skipped: 'max_daily_trades', count: todayBuys.length, limit: c.maxDailyTrades };
  }

  const held = new Set(positions.map(p => p.symbol));
  const budget = Math.min(c.maxOpenPositions - positions.length, c.maxDailyTrades - todayBuys.length);
  const candidates = list.filter(s => s.score >= c.minScore && !held.has(s.sym)).slice(0, Math.max(0, budget));

  const executed = [], failed = [];
  for (const s of candidates) {
    const p = plan(s.price);
    const qty = Math.floor(c.maxPositionUsd / s.price);
    if (qty < 1) { failed.push({ sym: s.sym, error: 'سعر السهم أعلى من الحد الأقصى للصفقة (AUTOTRADE_MAX_POSITION_USD)' }); continue; }
    try {
      const order = await broker.submitBracketOrder({ symbol: s.sym, qty, tp: p.tp1, sl: p.sl });
      executed.push({ sym: s.sym, name: s.name, qty, price: s.price, tp: p.tp1, sl: p.sl, score: s.score, orderId: order.id });
    } catch (e) {
      failed.push({ sym: s.sym, error: e.message });
    }
  }
  return { ok: true, paper: broker.PAPER, executed, failed, dailyPL: +dailyPL.toFixed(2) };
}

// نص إشعار تيليجرام لنتيجة الدورة
function fmtCycle(r) {
  if (r.skipped) return `🤖 التداول الآلي: تخطّي هذه الدورة — ${esc(String(r.skipped))}`;
  if (r.stopped === 'daily_loss_limit') return `🛑 <b>توقف تلقائي</b>: خسارة اليوم ${r.dailyPL}$ تجاوزت الحد ${r.limit}$ — لن تُفتح صفقات جديدة اليوم.`;
  const mode = r.paper ? '(حساب تجريبي 🧪)' : '(حساب حقيقي 💰)';
  const lines = [`🤖 <b>دورة التداول الآلي</b> ${mode}`];
  if (r.executed.length) {
    lines.push(...r.executed.map(e => `🟢 دخول: <b>${esc(e.name)}</b> <code>${e.sym}</code> — ${e.qty} سهماً بسعر ~${e.price} · هدف ${e.tp.toFixed(2)} · وقف ${e.sl.toFixed(2)} · درجة ${e.score}`));
  } else lines.push('لا صفقات جديدة تستوفي الشروط اليوم.');
  if (r.failed && r.failed.length) lines.push(...r.failed.map(f => `⚠️ فشل ${f.sym}: ${esc(f.error)}`));
  lines.push(`ربح/خسارة اليوم: ${r.dailyPL >= 0 ? '+' : ''}${r.dailyPL}$`);
  return lines.join('\n');
}

module.exports = { runCycle, fmtCycle, cfg };
