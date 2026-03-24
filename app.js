async function getLeague(){const r=await fetch('/api/league');return r.json();}
function fmtDate(iso){if(!iso)return 'Waiting for first stat refresh';return new Date(iso).toLocaleString();}
function movement(team){if(team.movement==='up')return `<span class="movement up">↑${team.movementValue}</span>`;if(team.movement==='down')return `<span class="movement down">↓${Math.abs(team.movementValue)}</span>`;return `<span class="movement same">—</span>`}
function rankCls(rank){return rank===1?'r1':rank===2?'r2':rank===3?'r3':''}
function render(){getLeague().then(data=>{
  document.getElementById('poolName').textContent=data.poolName;
  document.getElementById('lastUpdated').textContent='Last updated: '+fmtDate(data.lastUpdated);
  const standings=data.standings||[];
  const tbody=document.getElementById('leaderboard');
  tbody.innerHTML=standings.map(team=>`<tr>
    <td><span class="rank-badge ${rankCls(team.rank)}">${team.rank}</span></td>
    <td><a href="#" class="team-link" data-id="${team.id}">${team.name}</a></td>
    <td>${team.officialTotal}</td>
    <td>${team.fullTotal}</td>
    <td>${movement(team)}</td>
  </tr>`).join('');
  const details=document.getElementById('details');
  if(standings[0]) showTeam(standings[0].id, standings, details);
  tbody.querySelectorAll('.team-link').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();showTeam(a.dataset.id, standings, details)}));
  const full=document.getElementById('fullboard');
  full.innerHTML=standings.slice().sort((a,b)=>b.fullTotal-a.fullTotal||a.name.localeCompare(b.name)).map((team,idx)=>`<tr><td>${idx+1}</td><td>${team.name}</td><td>${team.fullTotal}</td></tr>`).join('');
});}
function showTeam(id, standings, details){const team=standings.find(t=>t.id===id);if(!team)return;details.innerHTML=`<h3 class="section-title">${team.name}</h3>
<div class="summary"><div class="box"><div class="label">Official Total</div><div class="value">${team.officialTotal}</div></div><div class="box"><div class="label">Full Total</div><div class="value">${team.fullTotal}</div></div><div class="box"><div class="label">Dropped Player</div><div class="value" style="font-size:18px">${team.dropped?team.dropped.name+' — '+team.dropped.hr:'—'}</div></div></div>
<div class="top-space detail-list">${team.players.slice().sort((a,b)=>b.hr-a.hr).map((p,idx)=>`<div class="player-row ${idx===9?'dropped':''}"><div><strong>${p.name||'Open Spot'}</strong>${idx===9?` <span class="pill red">Not Counting</span>`:''}</div><div>${p.hr} HR</div></div>`).join('')}</div>`}
render();
