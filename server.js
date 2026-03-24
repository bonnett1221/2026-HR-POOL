const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'league-store.json');
const MLB_BASE = 'https://statsapi.mlb.com';
const CACHE_MS = 10 * 60 * 1000;
const statsCache = new Map();

function createDefaultStore() {
  return {
    commissionerToken: crypto.randomBytes(16).toString('hex'),
    league: {
      poolName: '2026 MLB Home Run Pool',
      season: 2026,
      pointsPerHr: 1,
      playersPerTeam: 10,
      countTopPlayers: 9,
      updatedAt: new Date().toISOString(),
      entries: []
    }
  };
}

function readStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const store = createDefaultStore();
      fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
      return store;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.commissionerToken || !parsed.league) throw new Error('Invalid store');
    parsed.league.entries = Array.isArray(parsed.league.entries) ? parsed.league.entries : [];
    return parsed;
  } catch {
    const store = createDefaultStore();
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
    return store;
  }
}

function writeStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream'
    });
    res.end(content);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function fetchJson(targetUrl) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, {
      headers: {
        'User-Agent': 'MLB-HR-Pool/2.0',
        'Accept': 'application/json'
      }
    }, (response) => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Request failed (${response.statusCode}) for ${targetUrl}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`Invalid JSON from ${targetUrl}`));
        }
      });
    }).on('error', reject);
  });
}

async function searchPlayers(query) {
  const url = `${MLB_BASE}/api/v1/people/search?names=${encodeURIComponent(query)}&sportId=1`;
  const data = await fetchJson(url);
  const people = Array.isArray(data.people) ? data.people : [];
  return people.slice(0, 20).map(person => ({
    id: person.id,
    fullName: person.fullName,
    team: person.currentTeam?.name || 'Free Agent / N/A',
    position: person.primaryPosition?.abbreviation || person.primaryPosition?.name || '',
    active: person.active !== false
  }));
}

function extractHomeRuns(statResponse, playerId, season) {
  const splits = statResponse?.stats?.[0]?.splits;
  const stat = Array.isArray(splits) && splits[0]?.stat ? splits[0].stat : {};
  return {
    playerId,
    season,
    homeRuns: Number(stat.homeRuns || stat.homeRuns === 0 ? stat.homeRuns : 0),
    gamesPlayed: Number(stat.gamesPlayed || stat.games || 0),
    atBats: Number(stat.atBats || 0),
    plateAppearances: Number(stat.plateAppearances || 0),
    updatedAt: new Date().toISOString()
  };
}

async function getPlayerStats(playerId, season) {
  const cacheKey = `${playerId}-${season}`;
  const cached = statsCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_MS) return cached.value;
  const url = `${MLB_BASE}/api/v1/people/${encodeURIComponent(playerId)}/stats?stats=season&group=hitting&season=${encodeURIComponent(season)}`;
  const data = await fetchJson(url);
  const value = extractHomeRuns(data, Number(playerId), Number(season));
  statsCache.set(cacheKey, { timestamp: Date.now(), value });
  return value;
}

function sanitizeLeague(input) {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  return {
    poolName: String(input.poolName || '2026 MLB Home Run Pool').slice(0, 120),
    season: Math.max(2010, Math.min(2100, Number(input.season) || 2026)),
    pointsPerHr: Math.max(1, Math.min(100, Number(input.pointsPerHr) || 1)),
    playersPerTeam: 10,
    countTopPlayers: 9,
    updatedAt: new Date().toISOString(),
    entries: entries.map(entry => ({
      id: String(entry.id || crypto.randomUUID()),
      name: String(entry.name || '').slice(0, 80),
      players: Array.isArray(entry.players) ? entry.players.slice(0, 10).map(player => ({
        id: Number(player.id),
        fullName: String(player.fullName || '').slice(0, 120),
        team: String(player.team || '').slice(0, 80),
        position: String(player.position || '').slice(0, 30)
      })).filter(player => Number.isFinite(player.id) && player.fullName) : []
    }))
  };
}

async function handleApi(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (pathname === '/api/league' && req.method === 'GET') {
    const store = readStore();
    const token = (parsedUrl.searchParams.get('commissioner') || '').trim();
    sendJson(res, 200, {
      league: store.league,
      isCommissioner: token === store.commissionerToken,
      commissionerLink: token === store.commissionerToken ? `/?commissioner=${store.commissionerToken}` : null,
      publicLink: '/'
    });
    return;
  }

  if (pathname === '/api/league' && req.method === 'POST') {
    const token = (parsedUrl.searchParams.get('commissioner') || '').trim();
    const store = readStore();
    if (token !== store.commissionerToken) {
      sendJson(res, 403, { error: 'Not authorized' });
      return;
    }
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body || '{}');
      store.league = sanitizeLeague(parsed.league || {});
      writeStore(store);
      sendJson(res, 200, { ok: true, league: store.league });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Invalid request body' });
    }
    return;
  }

  if (pathname === '/api/search-players') {
    const q = (parsedUrl.searchParams.get('q') || '').trim();
    if (!q) return sendJson(res, 400, { error: 'Missing q parameter' });
    try {
      const players = await searchPlayers(q);
      sendJson(res, 200, { players });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (pathname === '/api/player-stats') {
    const ids = (parsedUrl.searchParams.get('ids') || '').split(',').map(v => v.trim()).filter(Boolean);
    const season = Number(parsedUrl.searchParams.get('season') || new Date().getFullYear());
    if (!ids.length) return sendJson(res, 400, { error: 'Missing ids parameter' });
    try {
      const uniqueIds = [...new Set(ids)];
      const results = await Promise.all(uniqueIds.map(id => getPlayerStats(id, season)));
      sendJson(res, 200, { season, players: results });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (pathname === '/api/health') {
    sendJson(res, 200, { ok: true, now: new Date().toISOString() });
    return;
  }

  sendJson(res, 404, { error: 'API route not found' });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

  if (parsedUrl.pathname.startsWith('/api/')) {
    await handleApi(req, res, parsedUrl);
    return;
  }

  let filePath = path.join(PUBLIC_DIR, parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    sendFile(res, filePath);
  });
});

server.listen(PORT, () => {
  const store = readStore();
  console.log(`2026 MLB Home Run Pool running at http://localhost:${PORT}`);
  console.log(`Commissioner link: http://localhost:${PORT}/?commissioner=${store.commissionerToken}`);
});
