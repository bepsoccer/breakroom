// backend/server.js
import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import cors from 'cors';
import { DateTime } from 'luxon';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const VERKADA_API_KEY = process.env.VERKADA_API_KEY;
//const ORG_ID = process.env.ORG_ID;
const SITE_ID = process.env.SITE_ID;

if (!VERKADA_API_KEY) {
  console.error('❌ Missing VERKADA_API_KEY or ORG_ID in .env');
  process.exit(1);
}

// -------------------------------
// Token cache helpers
// -------------------------------
let apiTokenCache = { token: null, expiresAt: 0 };
const getBearerToken = async () => {
  const now = Math.floor(Date.now() / 1000);
  if (apiTokenCache.token && apiTokenCache.expiresAt > now) {
    return apiTokenCache.token;
  }
  const res = await fetch('https://api.verkada.com/token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'x-api-key': VERKADA_API_KEY,
    },
  });
  if (!res.ok) throw new Error(`Failed to get API Token: ${res.status}`);
  const { token } = await res.json();
  apiTokenCache = { token, expiresAt: now + 300 }; // 5 minutes
  return token;
};

// -------------------------------
// Utility helpers
// -------------------------------

// Map API direction strings to normalized labels + display label
const normalizeDirection = (raw) => {
  if (!raw) return { norm: 'unknown', label: 'Unknown' };
  const r = String(raw).toLowerCase();
  // Common variants seen in practice
  if (['in', 'entry', 'entrance'].includes(r)) return { norm: 'in', label: 'Inbound' };
  if (['out', 'exit', 'egress'].includes(r)) return { norm: 'out', label: 'Outbound' };
  return { norm: r, label: r.charAt(0).toUpperCase() + r.slice(1) };
};

const toUnix = (dt) => Math.floor(dt.toSeconds()); // luxon DateTime -> unix (seconds)

const msToHMM = (ms) => {
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

// Formatters for UI (local to door timezone)
const fmtDate = (dt) => dt.toFormat('yyyy-LL-dd');
const fmtTime = (dt) => dt.toFormat('HH:mm:ss');

// -------------------------------
// Doors: list & helpful shape
// -------------------------------
app.get('/api/doors', async (req, res) => {
  try {
    const apiToken = await getBearerToken();
    const doorsUrl = new URL('https://api.verkada.com/access/v1/doors');
    doorsUrl.searchParams.set('site_ids', SITE_ID);
    const r = await fetch(doorsUrl.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', 'x-verkada-auth': apiToken },
    });
    if (!r.ok) throw new Error(`Failed to fetch doors: ${r.status}`);
    const data = await r.json();

    const doors = (data?.doors || []).map((d) => ({
      door_id: d.door_id,
      name: d.name,
      site_name: d.site?.name || 'Unknown Site',
      site_id: d.site?.site_id || null,
      timezone: d.timezone || 'UTC',
      camera_info: d.camera_info || {},
    }));

    // Sort: names containing "break" first (case-insensitive), then alphabetical
    const containsBreak = (s) => (s || '').toLowerCase().includes('break');
    doors.sort((a, b) => {
      const aBreak = containsBreak(a.name) ? 0 : 1;
      const bBreak = containsBreak(b.name) ? 0 : 1;
      if (aBreak !== bBreak) return aBreak - bBreak;
      return a.name.localeCompare(b.name);
    });

    res.json({ doors });
  } catch (err) {
    console.error('❌ /api/doors error', err);
    res.status(500).json({ error: 'Failed to fetch doors' });
  }
});

// -------------------------------
// Break report
// -------------------------------
// Query params:
//   door_id (required)
//   date (YYYY-MM-DD, defaults to "today" in door timezone)
//   min_minutes (number, defaults to 45)
// Response:
//   { door: {...}, users: [{ userId, userName, siteName, totalMs, totalLabel, pairs: [...] }], generatedRange: { start_unix, end_unix, tz } }
app.get('/api/break-report', async (req, res) => {
  const { door_id } = req.query;
  let { date, min_minutes } = req.query;

  if (!door_id) {
    return res.status(400).json({ error: 'Missing door_id' });
  }
  const minMinutes = Number.isFinite(Number(min_minutes)) ? Number(min_minutes) : 45;

  try {
    const apiToken = await getBearerToken();

    // 1) Fetch doors to find selected door metadata (timezone, name, site)
    const doorsResp = await fetch('https://api.verkada.com/access/v1/doors', {
      method: 'GET',
      headers: { accept: 'application/json', 'x-verkada-auth': apiToken },
    });
    if (!doorsResp.ok) throw new Error(`Failed to fetch doors: ${doorsResp.status}`);
    const { doors: allDoors = [] } = await doorsResp.json();

    const door = allDoors.find((d) => d.door_id === door_id);
    if (!door) {
      return res.status(404).json({ error: 'Door not found' });
    }

    const tz = door.timezone || 'UTC';
    const todayInTz = DateTime.now().setZone(tz);
    const targetDay = date
      ? DateTime.fromISO(date, { zone: tz, setZone: true })
      : todayInTz;

    if (!targetDay.isValid) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const startDT = targetDay.startOf('day');
    const endDT = targetDay.endOf('day'); // inclusive end
    const startUnix = toUnix(startDT);
    const endUnix = toUnix(endDT);

    // 2) Fetch access events for the day with pagination (page_size=100)
    // API sample shows start_time & end_time params; we’ll filter by door client-side.
    const fetchAllAccessEvents = async (startUnix, endUnix, apiToken) => {
    let all = [];
    let next = null;

    while (true) {
        const url = new URL('https://api.verkada.com/events/v1/access');
        url.searchParams.set('start_time', String(startUnix)); // seconds
        url.searchParams.set('end_time', String(endUnix));     // seconds (inclusive window OK)
        url.searchParams.set('page_size', '100');
        if (next) url.searchParams.set('page_token', next);

        const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: { accept: 'application/json', 'x-verkada-auth': apiToken },
        });

        if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(
            `Failed to fetch access events: ${resp.status} ${resp.statusText} :: ${text}`
        );
        }

        const json = await resp.json();
        const events = json?.events || [];
        all = all.concat(events);

        next = json?.next_page_token || null;
        if (!next) break;
    }
    return all;
    };

    const rawEvents = await fetchAllAccessEvents(startUnix, endUnix, apiToken);


    // 3) Filter to this door & normalize shape
    const filtered = rawEvents
    .filter((e) => {
        const info = e?.event_info || {};
        const eventDoorId = info.doorId || e.device_id || null;
        return eventDoorId === door_id;
    })
    .map((e) => {
        const info = e.event_info || {};
        const { norm, label } = normalizeDirection(info.direction);
        return {
        event_id: e.event_id,
        event_type: e.event_type || '',                 // <-- include
        violationMessage: info.message || null,         // <-- include
        timestampISO: e.timestamp,
        ts: DateTime.fromISO(e.timestamp, { zone: 'utc' }).setZone(tz),
        userId: info.userId || info.userInfo?.userId || 'unknown',
        userName: info.userName || info.userInfo?.name || 'Unknown User',
        siteName: info.siteName || door.site?.name || 'Unknown Site',
        direction: norm, // 'in' | 'out' | other
        directionLabel: label,
        doorName: info.doorInfo?.name || door.name || 'Door',
        };
    })
    .filter((e) => e.direction === 'in' || e.direction === 'out' || (e.event_type || '').startsWith('DOOR_APB_'))
    .sort((a, b) => a.ts.toMillis() - b.ts.toMillis());

    // 4) Group by user, then pair strictly (in => out). Collect APB violations separately.
    const byUser = new Map();
    for (const ev of filtered) {
    if (!byUser.has(ev.userId)) byUser.set(ev.userId, []);
    byUser.get(ev.userId).push(ev);
    }

    const results = [];
    for (const [userId, evs] of byUser.entries()) {
    let lastInbound = null;             // holds the last unmatched IN
    const pairs = [];                   // only proper (in => out) pairs
    const violations = [];              // APB / area rule violations to display

    for (const ev of evs) {
        const isAPB = (ev.event_type || '').startsWith('DOOR_APB_');
        if (isAPB) {
        violations.push({
            date: ev.ts.toFormat('yyyy-LL-dd'),
            time: ev.ts.toFormat('HH:mm:ss'),
            message: ev.violationMessage || ev.event_type.replace('DOOR_APB_', '').replace(/_/g, ' '),
            event_type: ev.event_type,
        });
        // Note: APB entries are NOT paired; they stand alone for review.
        }

        if (ev.direction === 'in') {
        // If we already had an unmatched IN and we see another IN,
        // don't create a pair. Keep the most recent IN as the candidate.
        // (APB for double-entry will be shown via the APB event above.)
        lastInbound = ev;
        } else if (ev.direction === 'out') {
        if (lastInbound) {
            // Proper pair: last IN → this OUT
            const first = lastInbound;
            const second = ev;
            const durationMs = Math.max(0, second.ts.toMillis() - first.ts.toMillis());
            pairs.push({
            userId,
            userName: first.userName || second.userName,
            siteName: first.siteName || second.siteName,
            area: 'Break Room',
            in: {
                date: first.ts.toFormat('yyyy-LL-dd'),
                time: first.ts.toFormat('HH:mm:ss'),
                atLocation: `${first.doorName} ${first.directionLabel}`, // Inbound
            },
            out: {
                date: second.ts.toFormat('yyyy-LL-dd'),
                time: second.ts.toFormat('HH:mm:ss'),
                atLocation: `${second.doorName} ${second.directionLabel}`, // Outbound
            },
            totalMs: durationMs,
            totalLabel: msToHMM(durationMs),
            });
            lastInbound = null; // consumed
        } else {
            // OUT with no matching IN — ignore for pairing (but APB above still shows if present)
        }
        }
    }

    const totalMs = pairs.reduce((sum, p) => sum + p.totalMs, 0);

    // Include this user if:
    //  - total paired time meets/exceeds threshold, OR
    //  - they have any violations (APB), even if total < threshold or 0
    if (totalMs >= minMinutes * 60 * 1000 || violations.length > 0) {
        results.push({
        userId,
        userName: pairs[0]?.userName || evs[0]?.userName || 'Unknown User',
        siteName: pairs[0]?.siteName || evs[0]?.siteName || 'Unknown Site',
        totalMs,
        totalLabel: msToHMM(totalMs),
        pairs,         // strictly in=>out rows only
        violations,    // APB/area violations to investigate
        });
    }
    }

    // Sort users by largest total first; if totals tie, put violators first.
    results.sort((a, b) => {
    if (b.totalMs !== a.totalMs) return b.totalMs - a.totalMs;
    return (b.violations?.length || 0) - (a.violations?.length || 0);
    });

    res.json({
    door: {
        door_id: door.door_id,
        name: door.name,
        site_name: door.site?.name || 'Unknown Site',
        timezone: tz,
    },
    generatedRange: {
        start_unix: startUnix,
        end_unix: endUnix,
        tz,
    },
    min_minutes: minMinutes,
    users: results,
    });

  } catch (err) {
    console.error('❌ /api/break-report error', err);
    res.status(500).json({ error: 'Failed to generate break report' });
  }
});

// -------------------------------
// (Optional) simple health route
// -------------------------------
app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);
});
