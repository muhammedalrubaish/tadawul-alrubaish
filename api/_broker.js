// عميل وسيط Alpaca (تداول أمريكي فقط) — أوامر تعليقية (bracket) بوقف وهدف مُنفَّذين من الوسيط نفسه
// أمان افتراضي: حساب تجريبي (paper) ما لم يُضبط ALPACA_PAPER=false صراحة
const KEY = String(process.env.ALPACA_KEY || '').trim();
const SECRET = String(process.env.ALPACA_SECRET || '').trim();
const PAPER = String(process.env.ALPACA_PAPER || 'true').trim().toLowerCase() !== 'false';
const BASE = PAPER ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';

function hdrs() {
  if (!KEY || !SECRET) throw new Error('ALPACA_KEY أو ALPACA_SECRET غير مضبوطين');
  return { 'APCA-API-KEY-ID': KEY, 'APCA-API-SECRET-KEY': SECRET, 'Content-Type': 'application/json' };
}

async function api(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: hdrs(), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  if (!r.ok) throw new Error(`Alpaca ${method} ${path}: ${data.message || ('HTTP ' + r.status)}`);
  return data;
}

const getAccount = () => api('GET', '/v2/account');
const getPositions = () => api('GET', '/v2/positions');

// أوامر الشراء المنفَّذة اليوم (لعدّ صفقات اليوم دون أي تخزين خاص بنا — الحساب لدى الوسيط هو مصدر الحقيقة)
async function getTodayFilledBuyOrders() {
  const today = new Date().toISOString().slice(0, 10);
  const orders = await api('GET', `/v2/orders?status=closed&after=${today}T00:00:00Z&direction=asc&limit=200`);
  return (orders || []).filter(o => o.side === 'buy' && o.filled_at);
}

// أمر تعليقي (bracket): دخول بسعر السوق + وقف خسارة وهدف ربح — يُنفَّذان من الوسيط تلقائياً حتى لو لم تُستدعَ الدالة مرة أخرى
async function submitBracketOrder({ symbol, qty, tp, sl }) {
  return api('POST', '/v2/orders', {
    symbol, qty, side: 'buy', type: 'market', time_in_force: 'day',
    order_class: 'bracket',
    take_profit: { limit_price: +(+tp).toFixed(2) },
    stop_loss: { stop_price: +(+sl).toFixed(2) }
  });
}

const closePosition = symbol => api('DELETE', `/v2/positions/${encodeURIComponent(symbol)}`);
const closeAllPositions = () => api('DELETE', `/v2/positions?cancel_orders=true`);
const cancelAllOrders = () => api('DELETE', '/v2/orders');
const hasKeys = () => !!(KEY && SECRET);

module.exports = { getAccount, getPositions, getTodayFilledBuyOrders, submitBracketOrder, closePosition, closeAllPositions, cancelAllOrders, hasKeys, PAPER };
