const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'league.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_KEY = process.env.ADMIN_KEY || 'commissioner123';
const REFRESH_MS = 1000 * 60 * 60 * 6;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultLeague = {
  poolName: '2026 MLB Home Run Pool',
  lastUpdated: null,
  previousStandings: [],
  teams: [
    {
      id: 'team-1',
      name: 'Sample Team',
      players: Array.from({ length: 10 }, (_, i) => ({ id: '', name: i === 0 ? 'Aaron Judge' : '', hr: 0 }))
    }
  ]
};

function readLeague() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultLeague, null, 2));
    return JSON.parse(JSON.stringify(defaultLeague));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeLeague(league) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(league, null, 2));
}

function send(res, status, body, contentType='application/json') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function serveFile(res, filepath) {
  const ext = path.extname(filepath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };
  fs.readFile(filepath, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    send(res, 200, data, types[ext] || 'application/octet-stream');
  });
}

function getStatsForTeam(team) {
  const players = (team.players || []).map((p, idx) => ({ ...p, hr: Number(p.hr || 0), idx }));
  const sorted = [...players].sort((a, b) => b.hr - a.hr);
  const counting = sorted.slice(0, 9);
  const dropped = sorted[9] || null;
  const officialTotal = counting.reduce((s, p) => s + p.hr, 0);
  const fullTotal = sorted.reduce((s, p) => s + p.hr, 0);
  const topGuy = sorted[0] || null;
  return { ...team, players, officialTotal, fullTotal, topGuy, dropped };
}

function buildStandings(league) {
  const enriched = league.teams.map(getStatsForTeam).sort((a, b) => b.officialTotal - a.officialTotal || b.fullTotal - a.fullTotal || a.name.localeCompare(b.name));
  const prevMap = new Map((league.previousStandings || []).map((t, idx) => [t.id, idx + 1]));
  return enriched.map((team, idx) => {
    const rank = idx + 1;
    const prevRank = prevMap.get(team.id);
    let movement = 'same';
    let movementValue = 0;
    if (prevRank != null) {
      movementValue = prevRank - rank;
      movement = movementValue > 0 ? 'up' : movementValue < 0 ? 'down' : 'same';
    }
    return { ...team, rank, movement, movementValue };
  });
}

function saveSnapshot(league) {
  const standings = buildStandings(league).map(t => ({ id: t.id, officialTotal: t.officialTotal }));
  league.previousStandings = standings;
  writeLeague(league);
}

async function searchPlayers(query) {
  const endpoint = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(query)}`;
  const r = await fetch(endpoint);
  const data = await r.json();
  return (data.people || []).filter(p => p.mlbDebutDate || p.primaryNumber).slice(0, 12).map(p => ({ id: p.id, name: p.fullName, team: p.currentTeam?.name || '' }));
}

async function fetchPlayerHr(playerId) {
  const season = 2026;
  const endpoint = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=hitting&season=${season}`;
  const r = await fetch(endpoint);
  const data = await r.json();
  const splits = data.stats?.[0]?.splits || [];
  const stat = splits[0]?.stat || {};
  return Number(stat.homeRuns || 0);
}

async function refreshStats() {
  const league = readLeague();
  saveSnapshot(league);
  for (const team of league.teams) {
    for (const player of team.players || []) {
      if (player.id) {
        try {
          player.hr = await fetchPlayerHr(player.id);
        } catch (e) {
          // keep existing value if fetch fails
        }
      }
    }
  }
  league.lastUpdated = new Date().toISOString();
  writeLeague(league);
}

setInterval(() => {
  refreshStats().catch(() => {});
}, REFRESH_MS);

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname === '/api/league' && req.method === 'GET') {
    const league = readLeague();
    return send(res, 200, JSON.stringify({
      poolName: league.poolName,
      lastUpdated: league.lastUpdated,
      standings: buildStandings(league)
    }));
  }

  if (pathname === '/api/search' && req.method === 'GET') {
    try {
      const q = String(parsed.query.q || '').trim();
      if (!q) return send(res, 200, JSON.stringify([]));
      const results = await searchPlayers(q);
      return send(res, 200, JSON.stringify(results));
    } catch (e) {
      return send(res, 500, JSON.stringify({ error: 'Search failed' }));
    }
  }

  if (pathname === '/api/refresh' && req.method === 'POST') {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', async () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        if (body.key !== ADMIN_KEY) return send(res, 403, JSON.stringify({ error: 'Forbidden' }));
        await refreshStats();
        send(res, 200, JSON.stringify({ ok: true }));
      } catch (e) {
        send(res, 500, JSON.stringify({ error: 'Refresh failed' }));
      }
    });
    return;
  }

  if (pathname === '/api/admin/save' && req.method === 'POST') {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        if (body.key !== ADMIN_KEY) return send(res, 403, JSON.stringify({ error: 'Forbidden' }));
        const league = readLeague();
        league.poolName = body.poolName || league.poolName;
        league.teams = Array.isArray(body.teams) ? body.teams : league.teams;
        writeLeague(league);
        send(res, 200, JSON.stringify({ ok: true }));
      } catch (e) {
        send(res, 400, JSON.stringify({ error: 'Bad request' }));
      }
    });
    return;
  }

  if (pathname === '/api/admin/league' && req.method === 'GET') {
    if (parsed.query.key !== ADMIN_KEY) return send(res, 403, JSON.stringify({ error: 'Forbidden' }));
    const league = readLeague();
    return send(res, 200, JSON.stringify(league));
  }

  if (pathname === '/' || pathname === '/admin') {
    return serveFile(res, path.join(PUBLIC_DIR, pathname === '/admin' ? 'admin.html' : 'index.html'));
  }

  const filepath = path.join(PUBLIC_DIR, pathname.replace(/^\//, ''));
  if (filepath.startsWith(PUBLIC_DIR)) {
    return serveFile(res, filepath);
  }
  send(res, 404, 'Not found', 'text/plain; charset=utf-8');
});

server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Public URL: /`);
  console.log(`Commissioner URL: /admin?key=${ADMIN_KEY}`);
  try {
    await refreshStats();
  } catch (e) {}
});
