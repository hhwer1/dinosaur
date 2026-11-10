const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const allowedStudios = new Set(['实景棚无影棚', '1806无影棚', '1801无影棚']);
const slots = Array.from({ length: 27 }, (_, i) => {
  const start = 510 + i * 30, end = start + 30;
  const time = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  return `${time(start)}—${time(end)}`;
});

function slotIndexes(values) {
  if (values.every(value => Number.isInteger(value))) {
    return [...new Set(values.flatMap(value => value >= 0 && value <= 11 ? [1 + value * 2, 2 + value * 2] : []))];
  }
  return values.map(value => slots.indexOf(value));
}

function publicRow(row) {
  const stored = JSON.parse(row.slots);
  const indexes = slotIndexes(stored);
  return { ...row, slots: indexes.map(index => slots[index]).filter(Boolean), assistant: !!row.assistant, owner_token: undefined };
}

function validPayload(body) {
  return allowedStudios.has(body.studio) && /^\d{4}-\d{2}-\d{2}$/.test(body.booking_date) &&
    Array.isArray(body.slots) && body.slots.length > 0 && body.slots.length <= 8 &&
    body.slots.every(x => typeof x === 'string' && slots.includes(x)) && new Set(body.slots).size === body.slots.length && String(body.applicant || '').trim().length > 0 &&
    (!body.assistant || String(body.reason || '').trim());
}

function bookingWindowError(bookingDate, bookingSlots) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const values = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const today = `${values.year}-${values.month}-${values.day}`;
  const [year, month, day] = bookingDate.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekday === 0 || weekday === 6) return '无影棚仅限周一至周五预约';
  if (bookingDate !== today) return '只能预约当天的无影棚，其他日期可查看';
  const hour = Number(values.hour), minute = Number(values.minute);
  if (hour < 8 || (hour === 8 && minute < 30)) return '每天08:30开放预约';
  if (hour >= 22) return '每天22:00停止预约';
  if (bookingSlots.some(slot => slots.indexOf(slot) < 0)) return '预约时间段无效';
  return '';
}

async function bookingError(env, body, exceptId = '') {
  const wanted = new Set(slotIndexes(body.slots));
  const adminSlots = new Set([17, 18, 19, 20]);
  if (body.studio === '1806无影棚' && [...wanted].some(slot => adminSlots.has(slot))) return '1806无影棚每天17:00—19:00由管理员占用';
  const rows = await env.DB.prepare("SELECT id, slots FROM bookings WHERE studio=? AND booking_date=? AND status='active' AND id<>?")
    .bind(body.studio, body.booking_date, exceptId).all();
  if (rows.results.some(row => slotIndexes(JSON.parse(row.slots)).some(slot => wanted.has(slot)))) return '所选时间段刚刚已被预约，请刷新后重选';
  const applicantBookings = await env.DB.prepare("SELECT slots FROM bookings WHERE studio=? AND booking_date=? AND applicant=? AND status='active' AND id<>?")
    .bind(body.studio, body.booking_date, String(body.applicant).trim(), exceptId).all();
  const used = applicantBookings.results.reduce((total, row) => total + slotIndexes(JSON.parse(row.slots)).length, 0);
  if (used + wanted.size > 8) return '每人每天在同一影棚最多预约4小时，超出部分请改约其他影棚';
  return '';
}

function canManage(request, env, row, token) {
  return Boolean(token) && token === row.owner_token;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.pathname === '/api/bookings' && request.method === 'GET') {
        const rows = await env.DB.prepare('SELECT * FROM bookings ORDER BY created_at').all();
        return json(rows.results.map(publicRow));
      }
      if (url.pathname === '/api/bookings' && request.method === 'POST') {
        const body = await request.json();
        if (!validPayload(body)) return json({ error: '预约信息不完整或不合法' }, 400);
        const windowError = bookingWindowError(body.booking_date, body.slots);
        if (windowError) return json({ error: windowError }, 400);
        const error = await bookingError(env, body);
        if (error) return json({ error }, 409);
        const id = crypto.randomUUID(), ownerToken = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO bookings (id,studio,booking_date,slots,applicant,assistant,reason,note,owner_token) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(id, body.studio, body.booking_date, JSON.stringify([...body.slots].sort()), String(body.applicant).trim(), body.assistant ? 1 : 0, body.reason || '', body.note || '', ownerToken).run();
        return json({ id, ownerToken }, 201);
      }
      const match = url.pathname.match(/^\/api\/bookings\/([^/]+)$/);
      if (match && ['PUT', 'DELETE'].includes(request.method)) {
        const row = await env.DB.prepare('SELECT * FROM bookings WHERE id=?').bind(match[1]).first();
        if (!row) return json({ error: '预约不存在' }, 404);
        const token = request.headers.get('x-owner-token');
        if (!canManage(request, env, row, token)) return json({ error: '没有权限修改此预约' }, 403);
        if (request.method === 'DELETE') {
          await env.DB.prepare("UPDATE bookings SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id).run();
          return json({ ok: true });
        }
        const body = await request.json();
        if (!validPayload(body)) return json({ error: '预约信息不完整或不合法' }, 400);
        const windowError = bookingWindowError(body.booking_date, body.slots);
        if (windowError) return json({ error: windowError }, 400);
        const error = await bookingError(env, body, row.id);
        if (error) return json({ error }, 409);
        await env.DB.prepare("UPDATE bookings SET studio=?,booking_date=?,slots=?,applicant=?,assistant=?,reason=?,note=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(body.studio, body.booking_date, JSON.stringify([...body.slots].sort()), String(body.applicant).trim(), body.assistant?1:0, body.reason||'', body.note||'', row.id).run();
        return json({ ok: true });
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      return json({ error: error.message || '服务器错误' }, 500);
    }
  }
};
