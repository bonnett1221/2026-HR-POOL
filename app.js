const commissionerToken = new URLSearchParams(window.location.search).get('commissioner') || '';
let state = null;
let latestStats = new Map();
let selectedEntryId = null;
let isCommissioner = false;

const heroTitle = document.getElementById('heroTitle');
const seasonInput = document.getElementById('seasonInput');
const poolNameInput = document.getElementById('poolNameInput');
const pointsPerHrInput = document.getElementById('pointsPerHrInput');
const refreshBtn = document.getElementById('refreshBtn');
const saveLeagueBtn = document.getElementById('saveLeagueBtn');
const entriesContainer = document.getElementById('entriesContainer');
const leaderboardBody = document.querySelector('#leaderboardTable tbody');
const fullLeaderboardBody = document.querySelector('#fullLeaderboardTable tbody');
const lastUpdated = document.getElementById('lastUpdated');
const modeLabel = document.getElementById('modeLabel');
const modeSubtext = document.getElementById('modeSubtext');
const linkBox = document.getElementById('linkBox');
const publicLinkInput = document.getElementById('publicLinkInput');
const commissionerLinkInput = document.getElementById('commissionerLinkInput');
const commissionerCard = document.getElementById('commissionerCard');
const teamDetail = document.getElementById('teamDetail');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDateTime(value) {
  if (!value) return 'Not updated yet';
  return `Updated ${new Date(value).toLocaleString()}`;
}

function emptyLeague() {
  return {
    poolName: '2026 MLB Home Run Pool',
    season: 2026,
    pointsPerHr: 1,
    playersPerTeam: 10,
    countTopPlayers: 9,
    entries: []
  };
}

async function loadLeague() {
  const response = await fetch(`/api/league${commissionerToken ? `?commissioner=${encodeURIComponent(commissionerToken)}` : ''}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load league');
  state = data.league || emptyLeague();
  isCommissioner = !!data.isCommissioner;

  const origin = window.location.origin;
  publicLinkInput.value = `${origin}/`;
  commissionerLinkInput.value = data.commissionerLink ? `${origin}${data.commissionerLink}` : (commissionerToken ? `${origin}/?commissioner=${commissionerToken}` : '');

  modeLabel.textContent = isCommissioner ? 'Commissioner mode' : 'Viewer mode';
  modeSubtext.textContent = isCommissioner
    ? 'Only you can edit teams and players from this link. Send the public link to everybody else.'
    : 'This page is view-only. Click any team name to see all 10 hitters.';

  heroTitle.textContent = state.poolName || '2026 MLB Home Run Pool';
  document.title = state.poolName || '2026 MLB Home Run Pool';
  seasonInput.value = state.season;
  poolNameInput.value = state.poolName;
  pointsPerHrInput.value = state.pointsPerHr;

  if (isCommissioner) {
    linkBox.classList.remove('hidden');
    commissionerCard.classList.remove('hidden');
    commissionerCard.classList.remove('viewer-locked');
  } else {
    linkBox.classList.add('hidden');
    commissionerCard.classList.add('viewer-locked');
  }

  renderEntries();
  await refreshStats();
}

function getAllPlayers() {
  return state.entries.flatMap(entry => entry.players.map(player => ({ ...player, ownerName: entry.name || 'Unnamed team' })));
}

function computeRows() {
  const pointsPerHr = Number(state.pointsPerHr || 1);
  return state.entries.map(entry => {
    const players = entry.players.map(player => {
      const stat = latestStats.get(String(player.id)) || { homeRuns: 0, gamesPlayed: 0 };
      return { ...player, ...stat };
    }).sort((a, b) => b.homeRuns - a.homeRuns || a.fullName.localeCompare(b.fullName));

    const totalHr = players.reduce((sum, player) => sum + Number(player.homeRuns || 0), 0);
    const countingPlayers = players.slice(0, Number(state.countTopPlayers || 9));
    const droppedPlayers = players.slice(Number(state.countTopPlayers || 9));
    const countingHr = countingPlayers.reduce((sum, player) => sum + Number(player.homeRuns || 0), 0);
    const droppedHr = droppedPlayers.reduce((sum, player) => sum + Number(player.homeRuns || 0), 0);

    return {
      id: entry.id,
      name: entry.name || 'Unnamed team',
      players,
      countingPlayers,
      droppedPlayers,
      totalHr,
      countingHr,
      droppedHr,
      points: countingHr * pointsPerHr
    };
  });
}

function getOfficialRows() {
  return computeRows().sort((a, b) => b.points - a.points || b.countingHr - a.countingHr || b.totalHr - a.totalHr || a.name.localeCompare(b.name));
}

function getFullRows() {
  return computeRows().sort((a, b) => b.totalHr - a.totalHr || b.countingHr - a.countingHr || a.name.localeCompare(b.name));
}

function renderLeaderboard() {
  const official = getOfficialRows();
  const full = getFullRows();
  leaderboardBody.innerHTML = '';
  fullLeaderboardBody.innerHTML = '';

  if (!official.length) {
    leaderboardBody.innerHTML = `<tr><td colspan="5" class="muted">No teams added yet.</td></tr>`;
    fullLeaderboardBody.innerHTML = `<tr><td colspan="4" class="muted">No teams added yet.</td></tr>`;
    return;
  }

  official.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td><button class="team-link" data-entry-id="${escapeHtml(row.id)}">${escapeHtml(row.name)}</button></td>
      <td>${row.countingHr}</td>
      <td>${row.droppedHr}</td>
      <td><strong>${row.points}</strong></td>
    `;
    leaderboardBody.appendChild(tr);
  });

  full.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td><button class="team-link" data-entry-id="${escapeHtml(row.id)}">${escapeHtml(row.name)}</button></td>
      <td>${row.totalHr}</td>
      <td>${row.players.length}/10</td>
    `;
    fullLeaderboardBody.appendChild(tr);
  });

  document.querySelectorAll('.team-link').forEach(button => {
    button.addEventListener('click', () => {
      selectedEntryId = button.dataset.entryId;
      renderTeamDetail();
    });
  });
}

function renderTeamDetail() {
  const rows = computeRows();
  const row = rows.find(item => item.id === selectedEntryId) || rows[0];
  if (!row) {
    teamDetail.className = 'team-detail empty-state';
    teamDetail.textContent = 'Choose a team from either leaderboard to see all 10 hitters, the dropped hitter, and the totals.';
    return;
  }
  selectedEntryId = row.id;
  const playerRows = row.players.map((player, index) => {
    const dropped = index >= Number(state.countTopPlayers || 9);
    return `
      <div class="player-detail-row ${dropped ? 'dropped' : ''}">
        <div>
          <strong>${escapeHtml(player.fullName)}</strong><br />
          <span class="muted small">${escapeHtml(player.team || '')} ${escapeHtml(player.position || '')}</span>
        </div>
        <div>
          <span class="badge ${dropped ? 'dropped' : 'counting'}">${dropped ? 'Dropped' : 'Counting'}</span>
          <div style="text-align:right; margin-top:6px;"><strong>${player.homeRuns || 0} HR</strong></div>
        </div>
      </div>
    `;
  }).join('');

  teamDetail.className = 'team-detail';
  teamDetail.innerHTML = `
    <h3>${escapeHtml(row.name)}</h3>
    <div class="detail-stats">
      <div class="stat-box">Official total<strong>${row.countingHr}</strong><span class="muted small">Top 9 hitters</span></div>
      <div class="stat-box">Full total<strong>${row.totalHr}</strong><span class="muted small">All 10 hitters</span></div>
      <div class="stat-box">Dropped total<strong>${row.droppedHr}</strong><span class="muted small">Lowest hitter(s)</span></div>
    </div>
    <div>${playerRows || '<div class="muted">No hitters added yet.</div>'}</div>
  `;
}

function renderEntries() {
  const template = document.getElementById('entryTemplate');
  const playerChipTemplate = document.getElementById('playerChipTemplate');
  entriesContainer.innerHTML = '';

  state.entries.forEach(entry => {
    const fragment = template.content.cloneNode(true);
    const entryNameInput = fragment.querySelector('.entry-name');
    const removeEntryBtn = fragment.querySelector('.remove-entry-btn');
    const playersList = fragment.querySelector('.players-list');
    const searchInput = fragment.querySelector('.player-search-input');
    const searchBtn = fragment.querySelector('.player-search-btn');
    const searchResults = fragment.querySelector('.search-results');

    entryNameInput.value = entry.name || '';
    entryNameInput.disabled = !isCommissioner;
    searchInput.disabled = !isCommissioner;
    searchBtn.disabled = !isCommissioner;
    removeEntryBtn.disabled = !isCommissioner;

    entryNameInput.addEventListener('input', event => {
      entry.name = event.target.value;
      renderLeaderboard();
      renderTeamDetail();
    });

    removeEntryBtn.addEventListener('click', () => {
      state.entries = state.entries.filter(item => item.id !== entry.id);
      if (selectedEntryId === entry.id) selectedEntryId = null;
      renderEntries();
      renderLeaderboard();
      renderTeamDetail();
    });

    entry.players.forEach(player => {
      const chip = playerChipTemplate.content.cloneNode(true);
      chip.querySelector('.player-name').textContent = player.fullName;
      chip.querySelector('.player-meta').textContent = `${player.team || ''} ${player.position || ''}`.trim();
      const removeBtn = chip.querySelector('.remove-player-btn');
      removeBtn.disabled = !isCommissioner;
      removeBtn.addEventListener('click', () => {
        entry.players = entry.players.filter(item => String(item.id) !== String(player.id));
        renderEntries();
        renderLeaderboard();
        renderTeamDetail();
      });
      playersList.appendChild(chip);
    });

    async function doSearch() {
      const q = searchInput.value.trim();
      searchResults.innerHTML = '';
      if (!q || !isCommissioner) return;
      searchBtn.disabled = true;
      searchBtn.textContent = 'Searching...';
      try {
        const response = await fetch(`/api/search-players?q=${encodeURIComponent(q)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Search failed');
        if (!data.players.length) {
          searchResults.innerHTML = `<div class="muted">No players found.</div>`;
          return;
        }
        data.players.forEach(player => {
          const result = document.createElement('div');
          result.className = 'search-result';
          const alreadyAdded = entry.players.some(item => String(item.id) === String(player.id));
          const hasRoom = entry.players.length < 10;
          result.innerHTML = `
            <div>
              <strong>${escapeHtml(player.fullName)}</strong><br />
              <span class="muted small">${escapeHtml(player.team)} • ${escapeHtml(player.position || '')}</span>
            </div>
          `;
          const addBtn = document.createElement('button');
          addBtn.className = 'secondary-btn';
          addBtn.textContent = alreadyAdded ? 'Added' : (!hasRoom ? 'Full' : 'Add');
          addBtn.disabled = alreadyAdded || !hasRoom;
          addBtn.addEventListener('click', async () => {
            if (entry.players.length >= 10) return;
            entry.players.push(player);
            renderEntries();
            await refreshStats();
          });
          result.appendChild(addBtn);
          searchResults.appendChild(result);
        });
      } catch (error) {
        searchResults.innerHTML = `<div class="muted">${escapeHtml(error.message)}</div>`;
      } finally {
        searchBtn.disabled = !isCommissioner;
        searchBtn.textContent = 'Search';
      }
    }

    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        doSearch();
      }
    });

    entriesContainer.appendChild(fragment);
  });
}

async function refreshStats() {
  const ids = [...new Set(getAllPlayers().map(player => String(player.id)))];
  if (!ids.length) {
    latestStats = new Map();
    lastUpdated.textContent = 'No players added yet';
    renderLeaderboard();
    renderTeamDetail();
    return;
  }
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing...';
  try {
    const response = await fetch(`/api/player-stats?season=${encodeURIComponent(state.season)}&ids=${encodeURIComponent(ids.join(','))}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not refresh stats');
    latestStats = new Map(data.players.map(player => [String(player.playerId), player]));
    lastUpdated.textContent = formatDateTime(new Date().toISOString());
    renderLeaderboard();
    renderTeamDetail();
  } catch (error) {
    lastUpdated.textContent = `Refresh failed: ${error.message}`;
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh live stats';
  }
}

async function saveLeague() {
  if (!isCommissioner) return;
  state.poolName = poolNameInput.value.trim() || '2026 MLB Home Run Pool';
  state.season = Math.max(2010, Number(seasonInput.value) || 2026);
  state.pointsPerHr = Math.max(1, Number(pointsPerHrInput.value) || 1);
  const response = await fetch(`/api/league?commissioner=${encodeURIComponent(commissionerToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ league: state })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not save league');
  state = data.league;
  heroTitle.textContent = state.poolName;
  document.title = state.poolName;
  await refreshStats();
}

document.getElementById('addEntryBtn').addEventListener('click', () => {
  if (!isCommissioner) return;
  state.entries.push({ id: crypto.randomUUID(), name: '', players: [] });
  renderEntries();
  renderLeaderboard();
  renderTeamDetail();
});

saveLeagueBtn.addEventListener('click', async () => {
  try {
    saveLeagueBtn.disabled = true;
    saveLeagueBtn.textContent = 'Saving...';
    await saveLeague();
  } catch (error) {
    alert(error.message);
  } finally {
    saveLeagueBtn.disabled = false;
    saveLeagueBtn.textContent = 'Save league';
  }
});

refreshBtn.addEventListener('click', refreshStats);

loadLeague().catch(error => {
  teamDetail.className = 'team-detail empty-state';
  teamDetail.textContent = error.message;
});

setInterval(() => {
  if (state) refreshStats();
}, 15 * 60 * 1000);
