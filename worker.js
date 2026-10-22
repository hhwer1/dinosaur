const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const allowedStudios = new Set(['实景棚无影棚', '1806无影棚', '1801无影棚']);

function publicRow(row) {
  return { ...row, slots: JSON.parse(row.slots), assistant: !!row.assistant, owner_token: undefined };
}

function validPayload(body) {
  return allowedStudios.has(body.studio) && /^\d{4}-\d{2}-\d{2}$/.test(body.booking_date) &&
    Array.isArray(body.slots) && body.slots.length > 0 && body.slots.length <= 6 &&
    body.slots.every(x => Number.isInteger(x) && x >= 0 && x <= 11) && String(body.applicant || '').trim().length > 0 &&
    (!body.assistant || String(body.reason || '').trim());
}

async function hasConflict(env, body, exceptId = '') {
  const rows = await env.DB.prepare("SELECT id, slots FROM bookings WHERE studio=? AND booking_date=? AND status='active' AND id<>?")
    .bind(body.studio, body.booking_date, exceptId).all();
  const wanted = new Set(body.slots);
  return rows.results.some(r => JSON.parse(r.slots).some(s => wanted.has(s)));
}

function canManage(request, env, row, token) {
  return request.headers.get('x-staff-password') === env.STAFF_PASSWORD || (token && token === row.owner_token);
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
      if (url.pathname === '/api/staff/login' && request.method === 'POST') {
        const { password } = await request.json();
        return password === env.STAFF_PASSWORD ? json({ ok: true }) : json({ error: '密码错误' }, 401);
      }
      if (url.pathname === '/api/bookings' && request.method === 'POST') {
        const body = await request.json();
        if (!validPayload(body)) return json({ error: '预约信息不完整或不合法' }, 400);
        if (await hasConflict(env, body)) return json({ error: '所选时间段刚刚已被预约，请刷新后重选' }, 409);
        const id = crypto.randomUUID(), ownerToken = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO bookings (id,studio,booking_date,slots,applicant,assistant,reason,note,owner_token) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(id, body.studio, body.booking_date, JSON.stringify([...new Set(body.slots)].sort((a,b)=>a-b)), String(body.applicant).trim(), body.assistant ? 1 : 0, body.reason || '', body.note || '', ownerToken).run();
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
        if (await hasConflict(env, body, row.id)) return json({ error: '所选时间段已被预约，请重选' }, 409);
        await env.DB.prepare("UPDATE bookings SET studio=?,booking_date=?,slots=?,applicant=?,assistant=?,reason=?,note=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(body.studio, body.booking_date, JSON.stringify([...new Set(body.slots)].sort((a,b)=>a-b)), String(body.applicant).trim(), body.assistant?1:0, body.reason||'', body.note||'', row.id).run();
        return json({ ok: true });
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      return json({ error: error.message || '服务器错误' }, 500);
    }
  }
};
