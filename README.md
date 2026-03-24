# 2026 MLB Home Run Pool

This version supports a commissioner link and a public viewer link.

## What it does
- Commissioner-only editing through a secret URL
- Public link for anybody in the league to follow standings
- Official leaderboard counts the top 9 of 10 hitters
- Full leaderboard shows all 10 of 10 hitters
- Click any team name to view all hitters and see which hitter is dropped
- Live player search and current home run totals through MLB Stats API
- League data is saved on the server in `league-store.json`

## Run locally
1. Open the folder in terminal
2. Run `node server.js`
3. Open `http://localhost:3000`
4. The terminal will also print your commissioner link

## Important hosting note
Because the league data is saved to a file on the server, use a host that supports persistent disk storage.
Good fits:
- Render web service with persistent disk
- Railway with volume
- A VPS
- A home server / always-on computer

Pure static hosting like basic Netlify or basic Vercel will not keep league edits permanently unless you swap the storage layer.
