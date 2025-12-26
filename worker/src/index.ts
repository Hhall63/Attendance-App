import { appendAttendance, ensureTables, getConfig, getRoster, listAttendanceByDate, listDailySummary, addSummaryRows, updateSummaryRow } from './graph';
import { AttendanceLogRow, ClassConfig, DailySummaryRow, Env, SessionMeta } from './types';

function jsonResponse(status: number, data: any) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function nyDateNow() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return now;
}

function formatDateNY(date: Date) {
  return date.toISOString().split('T')[0];
}

async function hashIP(ip: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+/g, '');
}

async function requireAdmin(request: Request, env: Env): Promise<Response | null> {
  const key = request.headers.get('X-Admin-Key');
  if (!key || key !== env.ADMIN_KEY) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }
  return null;
}

async function rateLimit(env: Env, ip: string): Promise<boolean> {
  const key = `rl:${ip}`;
  const current = Number((await env.KV_SESSIONS.get(key)) || '0');
  if (current >= 20) return false;
  await env.KV_SESSIONS.put(key, String(current + 1), { expirationTtl: 60 });
  return true;
}

async function dedupe(env: Env, classDate: string, studentKey: string, action: string): Promise<boolean> {
  const key = `dupe:${classDate}:${studentKey}:${action}`;
  const exists = await env.KV_SESSIONS.get(key);
  if (exists) return false;
  await env.KV_SESSIONS.put(key, '1', { expirationTtl: 120 });
  return true;
}

function parseBody(request: Request): Promise<any> {
  return request.json().catch(() => ({}));
}

function dateInZone(classDate: string, hhmm: string, tz: string) {
  const [h, m] = hhmm.split(':').map((v) => Number(v));
  const base = new Date(Date.UTC(Number(classDate.split('-')[0]), Number(classDate.split('-')[1]) - 1, Number(classDate.split('-')[2]), h, m));
  const parts = base.toLocaleString('en-US', { timeZone: tz });
  return new Date(parts);
}

async function computeSummary(env: Env, classDate: string, roster: any[], config: ClassConfig) {
  const attendance = await listAttendanceByDate(env, classDate);
  const { rows: summaries, raw } = await listDailySummary(env);
  const existingMap = new Map<string, { row: DailySummaryRow; raw: any }>();
  raw.forEach((r: any, idx: number) => {
    const val = r.values?.[0];
    const key = `${val?.[0]}|${val?.[1]}`;
    existingMap.set(key, { row: summaries[idx], raw: r });
  });

  const startDate = dateInZone(classDate, config.classStartTime, config.timezone);
  const endDate = dateInZone(classDate, config.classEndTime, config.timezone);
  const tardyStart = new Date(startDate.getTime() + config.tardyMinutesLate * 60000);
  const earlyLeaveCut = new Date(endDate.getTime() - config.earlyLeaveMinutes * 60000);

  const grouped = new Map<string, AttendanceLogRow[]>();
  attendance.forEach((a) => {
    const arr = grouped.get(a.studentKey) || [];
    arr.push(a);
    grouped.set(a.studentKey, arr);
  });

  const toAdd: DailySummaryRow[] = [];
  const toUpdate: { id: string; row: DailySummaryRow }[] = [];

  for (const student of roster) {
    const events = (grouped.get(student.studentKey) || []).sort((a, b) => a.serverTimestampISO.localeCompare(b.serverTimestampISO));
    const firstCheckIn = events.find((e) => e.action === 'Check-In');
    const lastCheckOut = [...events].reverse().find((e) => e.action === 'Check-Out');

    const firstTime = firstCheckIn ? new Date(firstCheckIn.serverTimestampISO) : null;
    const lastTime = lastCheckOut ? new Date(lastCheckOut.serverTimestampISO) : null;

    let computedStatus = 'Absent';
    if (firstTime) {
      const late = firstTime > tardyStart;
      const early = lastTime ? lastTime < earlyLeaveCut : false;
      computedStatus = late || early ? 'Tardy' : 'Present';
    }

    const key = `${classDate}|${student.studentKey}`;
    const existing = existingMap.get(key);
    const baseRow: DailySummaryRow = {
      classDate,
      studentKey: student.studentKey,
      displayName: student.displayName,
      firstCheckInISO: firstTime ? firstTime.toISOString() : '',
      lastCheckOutISO: lastTime ? lastTime.toISOString() : '',
      computedStatus,
      overrideStatus: existing?.row.overrideStatus || '',
      finalStatus: existing?.row.overrideStatus || computedStatus,
      notes: existing?.row.notes || '',
    };

    if (existing) {
      toUpdate.push({ id: existing.raw.id ?? existing.raw.index ?? existing.raw.position, row: baseRow });
    } else {
      toAdd.push(baseRow);
    }
  }

  if (toAdd.length) {
    await addSummaryRows(env, toAdd);
  }
  for (const item of toUpdate) {
    await updateSummaryRow(env, String(item.id), item.row);
  }

  const counts = { Present: 0, Tardy: 0, Absent: 0 } as Record<string, number>;
  [...toAdd, ...toUpdate.map((u) => u.row)].forEach((r) => {
    counts[r.finalStatus] = (counts[r.finalStatus] || 0) + 1;
  });
  return counts;
}

function getClientIP(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || '0.0.0.0';
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'POST' && path === '/api/admin/setup-workbook') {
      const auth = await requireAdmin(request, env);
      if (auth) return auth;
      await ensureTables(env);
      return jsonResponse(200, { ok: true });
    }

    if (request.method === 'POST' && path === '/api/admin/start-session') {
      const auth = await requireAdmin(request, env);
      if (auth) return auth;
      const body = await parseBody(request);
      const now = nyDateNow();
      const classDate = body.classDate || formatDateNY(now);
      const config = await getConfig(env);
      const token = randomToken();
      const expires = new Date(now.getTime() + 36 * 3600 * 1000);
      const meta: SessionMeta = {
        token,
        classDate,
        createdAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        startTime: config.classStartTime,
        endTime: config.classEndTime,
      };
      await env.KV_SESSIONS.put(`session:${token}`, JSON.stringify(meta), { expirationTtl: 36 * 3600 });
      return jsonResponse(200, {
        token,
        sessionUrl: `${url.origin}/t/${token}`,
        expiresAt: meta.expiresAt,
      });
    }

    if (request.method === 'GET' && path === '/api/session') {
      const token = url.searchParams.get('token');
      if (!token) return jsonResponse(400, { error: 'Missing token' });
      const data = await env.KV_SESSIONS.get(`session:${token}`);
      if (!data) return jsonResponse(404, { error: 'Invalid or expired session' });
      const meta = JSON.parse(data) as SessionMeta;
      const roster = await getRoster(env);
      const config = await getConfig(env);
      return jsonResponse(200, { meta, roster, config });
    }

    if (request.method === 'POST' && path === '/api/attendance') {
      const body = await parseBody(request);
      const { token, studentIdOrName, action } = body || {};
      if (!token || !studentIdOrName || !['Check-In', 'Check-Out'].includes(action)) {
        return jsonResponse(400, { error: 'Invalid payload' });
      }
      const sessionRaw = await env.KV_SESSIONS.get(`session:${token}`);
      if (!sessionRaw) return jsonResponse(404, { error: 'Session expired' });
      const meta = JSON.parse(sessionRaw) as SessionMeta;
      const roster = await getRoster(env);
      const student = roster.find((r) => r.studentKey === studentIdOrName || r.displayName === studentIdOrName);
      if (!student) return jsonResponse(400, { error: 'Student not in roster' });

      const ip = getClientIP(request);
      if (!(await rateLimit(env, ip))) return jsonResponse(429, { error: 'Too many requests' });
      if (!(await dedupe(env, meta.classDate, student.studentKey, action))) {
        return jsonResponse(200, { ok: true, message: 'Already recorded' });
      }

      const timestamp = nyDateNow().toISOString();
      const ipHash = await hashIP(ip, env.IP_HASH_SALT);
      const row: AttendanceLogRow = {
        serverTimestampISO: timestamp,
        classDate: meta.classDate,
        studentKey: student.studentKey,
        displayName: student.displayName,
        action,
        userAgent: request.headers.get('User-Agent') || '',
        ipHash,
      };
      await appendAttendance(env, row);
      return jsonResponse(200, { ok: true, at: timestamp, classDate: meta.classDate });
    }

    if (request.method === 'POST' && path === '/api/admin/close-session') {
      const auth = await requireAdmin(request, env);
      if (auth) return auth;
      const body = await parseBody(request);
      const classDate = body.classDate || formatDateNY(nyDateNow());
      const roster = await getRoster(env);
      const config = await getConfig(env);
      const counts = await computeSummary(env, classDate, roster, config);
      return jsonResponse(200, { classDate, counts });
    }

    return new Response('Not found', { status: 404 });
  },
};
