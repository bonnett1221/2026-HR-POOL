const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'league.json');

const PUBLIC_DIR = path.join(__dirname, 'public');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ players: [] }, null, 2));
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/league') {
    const data = fs.readFileSync(DATA_FILE);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(data);
    return;
  }

  if (pathname === '/api/add-player' && req.method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      const json = JSON.parse(body);
      const league = JSON.parse(fs.readFileSync(DATA_FILE));

      league.players.push(json);

      fs.writeFileSync(DATA_FILE, JSON.stringify(league, null, 2));

      res.writeHead(200);
      res.end('OK');
    });

    return;
  }

  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  const ext = path.extname(filePath);

  const map = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css'
  };

  const contentType = map[ext] || 'text/plain';

  serveFile(res, filePath, contentType);
});

server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
