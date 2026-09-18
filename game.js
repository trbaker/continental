/* =====================================================================
   CONTINENTAL — a Risk-style geography game for classrooms
   Map data: ArcGIS Online REST services (Esri basemap tiles +
   World Countries Generalized FeatureServer, Esri Living Atlas)
   Multiplayer sync: Supabase (PostgREST) — see setup notes below
   ===================================================================== */
'use strict';

const PLAYER_COLORS = ['#E5484D','#3E9BFF','#2FB36B','#9A6BFF'];
const PLAYER_LABELS = ['Crimson','Azure','Emerald','Violet'];
const WIN_AT = 28;               // territories needed to win
const MAX_LOG = 12;
const POLL_MS = 2600;

/* ---------------- ArcGIS REST endpoints ---------------- */
const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABEL_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
const COUNTRIES_FS = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Countries_Generalized/FeatureServer/0/query';

/* ---------------- App state ---------------- */
let map = null, tLayers = {}, badges = {}, geomReady = false;
let session = { mode:null, code:null, playerId:null };   // mode: 'online' | 'hotseat'
let G = null;                 // full game object (players + state)
let localVersion = -1;
let sel = null;               // selected territory id
let fortifyPair = null;       // {from,to} locked pair this turn (local mirror of state)
let pollTimer = null, waitTimer = null;

/* ---------------- Tiny helpers ---------------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('on'), 2600); }
function roll(){ return 1 + Math.floor(Math.random()*6); }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function randCode(){ const A='ABCDEFGHJKMNPQRSTUVWXYZ'; let s=''; for(let i=0;i<4;i++) s+=A[Math.floor(Math.random()*A.length)]; return s; }


/* =====================================================================
   GAME ENGINE (pure functions over the game object)
   ===================================================================== */
function newGame(code, players){
  return {
    code, status:'lobby', players,   // players: [{id,name}]
    state:null, version:1, updatedAt:Date.now()
  };
}
function startState(nPlayers){
  const ids = shuffle(TERRITORIES.map(t=>t.id));
  const owners = {}, armies = {};
  ids.forEach((tid,i)=>{ owners[tid] = i % nPlayers; armies[tid] = 1; });
  const perPlayer = 50 - 5*nPlayers;             // 40 / 35 / 30
  for(let p=0;p<nPlayers;p++){
    const mine = ids.filter(t=>owners[t]===p);
    let extra = perPlayer - mine.length;
    while(extra-- > 0) armies[mine[Math.floor(Math.random()*mine.length)]]++;
  }
  const st = { owners, armies, turn:0, phase:'reinforce', reinf:0,
    fortified:false, eliminated:Array(nPlayers).fill(false), winner:null, log:[] };
  st.reinf = calcReinforcements(st, 0);
  return st;
}
function calcReinforcements(st, p){
  const mine = TERRITORIES.filter(t => st.owners[t.id] === p);
  let n = Math.max(3, Math.floor(mine.length/3));
  for(const [ck,c] of Object.entries(CONTINENTS)){
    const all = TERRITORIES.filter(t=>t.cont===ck);
    if(all.length && all.every(t => st.owners[t.id]===p)) n += c.bonus;
  }
  return n;
}
function territoryCount(st, p){ return TERRITORIES.reduce((n,t)=> n + (st.owners[t.id]===p?1:0), 0); }
function armyCount(st, p){ return TERRITORIES.reduce((n,t)=> n + (st.owners[t.id]===p?st.armies[t.id]:0), 0); }
function addLog(st, html){ st.log.unshift(html); if(st.log.length>MAX_LOG) st.log.length = MAX_LOG; }
function pName(i){ return G && G.players[i] ? esc(G.players[i].name) : '?'; }
function pTag(i){ return `<b style="color:${PLAYER_COLORS[i]}">${pName(i)}</b>`; }

function resolveBattle(st, from, to){
  // one round of dice
  const aArm = st.armies[from], dArm = st.armies[to];
  const aDice = Math.min(3, aArm-1), dDice = Math.min(2, dArm);
  const A = Array.from({length:aDice}, roll).sort((x,y)=>y-x);
  const D = Array.from({length:dDice}, roll).sort((x,y)=>y-x);
  let aLoss=0, dLoss=0;
  for(let i=0;i<Math.min(A.length,D.length);i++){ if(A[i]>D[i]) dLoss++; else aLoss++; }
  st.armies[from]-=aLoss; st.armies[to]-=dLoss;
  let captured=false, eliminatedIdx=null;
  if(st.armies[to]<=0){
    captured = true;
    const loser = st.owners[to], attacker = st.owners[from];
    st.owners[to] = attacker;
    const move = st.armies[from]-1;              // all but one march in
    st.armies[to] = move; st.armies[from] = 1;
    addLog(st, `${pTag(attacker)} captured <b>${T_BY_ID[to].name}</b> from ${pTag(loser)}!`);
    if(territoryCount(st, loser)===0){ st.eliminated[loser]=true; eliminatedIdx=loser;
      addLog(st, `${pTag(loser)} has been eliminated.`); }
    const alive = st.eliminated.filter(e=>!e).length;
    if(territoryCount(st, attacker)>=WIN_AT || alive===1){
      st.winner = attacker;
      addLog(st, `${pTag(attacker)} controls the world. <b>Victory!</b>`);
    }
  }
  return {A, D, aLoss, dLoss, captured, eliminatedIdx};
}

/* =====================================================================
   MAP (Leaflet over ArcGIS Online REST services)
   ===================================================================== */
function initMap(){
  if(map) return;
  map = L.map('map', { worldCopyJump:true, minZoom:2, maxZoom:6, zoomControl:true })
         .setView([25, 15], 2);
  L.tileLayer(ESRI_TILES, { attribution:'Basemap: Esri — ArcGIS Online', maxZoom:16 }).addTo(map);
  L.tileLayer(ESRI_LABEL_TILES, { pane:'shadowPane', opacity:.85, maxZoom:16 }).addTo(map);
}

async function loadTerritoryGeometry(){
  $('hint').innerHTML = 'Loading country boundaries from ArcGIS…';
  const names = TERRITORIES.flatMap(t=>t.q);
  // two chunks keeps the URL comfortably short
  const chunks = [names.slice(0, Math.ceil(names.length/2)), names.slice(Math.ceil(names.length/2))];
  const found = {};
  for(const chunk of chunks){
    const where = `COUNTRY IN (${chunk.map(n=>`'${n.replace(/'/g,"''")}'`).join(',')})`;
    const url = COUNTRIES_FS + '?where=' + encodeURIComponent(where) +
      '&outFields=COUNTRY&returnGeometry=true&outSR=4326&geometryPrecision=2&maxAllowableOffset=0.4&f=geojson';
    try{
      const res = await fetch(url);
      const gj = await res.json();
      if(gj && gj.features) for(const f of gj.features){
        const tid = ALIAS[(f.properties.COUNTRY||'').toLowerCase()];
        if(tid && !found[tid]) found[tid] = f;
      }
    }catch(e){ /* fall through to circles */ }
  }
  for(const t of TERRITORIES){
    let layer;
    if(found[t.id]){
      layer = L.geoJSON(found[t.id], { style: baseStyle(t.id) });
    }else{
      layer = L.circle(t.ll, { radius:420000, ...baseStyle(t.id) });   // graceful fallback
    }
    layer.on('click', () => onTerritoryClick(t.id));
    layer.bindTooltip(t.name, {sticky:true, direction:'top', opacity:.9});
    layer.addTo(map);
    tLayers[t.id] = layer;

    const badge = L.marker(t.ll, {
      interactive:true, keyboard:false,
      icon: L.divIcon({ className:'badge-wrap', html:'', iconSize:[30,30], iconAnchor:[15,15] })
    });
    badge.on('click', () => onTerritoryClick(t.id));
    badge.addTo(map);
    badges[t.id] = badge;
  }
  geomReady = true;
}
function baseStyle(tid){
  return { color:'#FFFFFF', weight:1.4, fillColor:'#9AA9BA', fillOpacity:.55, opacity:.9 };
}
function setStyle(tid, opts){
  const l = tLayers[tid]; if(!l) return;
  if(l.setStyle) l.setStyle(opts);
}

/* ---------------- Rendering ---------------- */
function renderAll(){
  if(!G || !G.state || !geomReady) return;
  const st = G.state;
  const attackable = attackTargets();
  const fortTargets = fortifyTargets();
  for(const t of TERRITORIES){
    const owner = st.owners[t.id];
    const color = PLAYER_COLORS[owner];
    const isSel = sel === t.id;
    const isTarget = attackable.has(t.id) || fortTargets.has(t.id);
    setStyle(t.id, {
      fillColor: color, fillOpacity: isSel ? .92 : .72,
      color: isSel ? '#FFC93C' : (isTarget ? '#FFC93C' : '#FFFFFF'),
      weight: isSel ? 3 : (isTarget ? 2.6 : 1.2),
      dashArray: isTarget && !isSel ? '6 5' : null, opacity: 1
    });
    const el = badges[t.id].getElement();
    if(el){
      el.innerHTML = `<div class="army-badge ${isSel?'sel':''}" style="background:${color}">${st.armies[t.id]}</div>`;
    }
  }
  renderStrip(); renderPlayers(); renderActions(); renderLog();
}
function renderStrip(){
  const st = G.state;
  $('game-code-chip').textContent = session.mode==='online' ? 'CODE ' + G.code : 'PASS & PLAY';
  const cur = st.winner!=null ? st.winner : st.turn;
  $('turn-dot').style.background = PLAYER_COLORS[cur];
  $('turn-name').textContent = st.winner!=null ? pNamePlain(cur)+' wins!' :
      pNamePlain(st.turn) + (isMyTurn() ? ' (you)' : '');
  const phases = ['reinforce','attack','fortify'];
  phases.forEach((ph,i)=>{
    const el = $('step-'+i);
    el.className = 'step' + (st.winner!=null ? '' :
      ph===st.phase ? ' now' : (phases.indexOf(st.phase)>i ? ' done' : ''));
  });
  $('hint').innerHTML = hintText();
}
function pNamePlain(i){ return G.players[i] ? G.players[i].name : '?'; }
function hintText(){
  const st = G.state;
  if(st.winner!=null) return `<b>${esc(pNamePlain(st.winner))}</b> has conquered the world. Start a new game from the Exit menu.`;
  if(!isMyTurn()) return `Waiting on <b>${esc(pNamePlain(st.turn))}</b>… the map updates automatically.`;
  if(st.phase==='reinforce') return `<b>${st.reinf} armies to place.</b> Tap your territories to drop one at a time.`;
  if(st.phase==='attack') return sel
    ? `Attacking from <b>${T_BY_ID[sel].name}</b> — tap a dashed enemy neighbor, or tap another of your territories.`
    : `Tap one of your territories (2+ armies) to attack from, or end the attack phase.`;
  if(st.phase==='fortify') return sel
    ? `Tap a neighboring territory you own to move armies into it (1 per tap).`
    : (st.fortified ? `Fortify move used — end your turn.` : `Optional: tap a territory (2+ armies) to move armies from, or end your turn.`);
  return '';
}
function renderPlayers(){
  const st = G.state;
  $('player-list').innerHTML = G.players.map((p,i)=>{
    const out = st.eliminated[i];
    return `<div class="pl ${i===st.turn&&st.winner==null?'turn':''} ${out?'out':''}">
      <span class="dot" style="background:${PLAYER_COLORS[i]}"></span>
      <span>${esc(p.name)}</span>
      ${p.id===session.playerId?'<span class="you">YOU</span>':''}
      <span class="stats">${territoryCount(st,i)} terr · ${armyCount(st,i)} armies</span>
    </div>`;
  }).join('');
}
function renderLog(){
  $('log').innerHTML = (G.state.log||[]).map(l=>`<div>${l}</div>`).join('') ||
    '<div>Battle reports will appear here.</div>';
}
function renderActions(){
  const st = G.state, box = $('actions');
  let html = '';
  if(st.winner!=null){
    html = `<button class="btn" onclick="quitToLobby()">Back to lobby</button>`;
  }else if(!isMyTurn()){
    if(session.mode==='online' && isHost())
      html = `<button class="btn ghost" onclick="hostSkip()">Host: skip this turn</button>`;
  }else if(st.phase==='reinforce'){
    html = `<div style="font-size:.9rem;color:var(--muted)">Reinforcements left: <b style="color:var(--gold)">${st.reinf}</b></div>`;
  }else if(st.phase==='attack'){
    if(sel && lastTarget) html += `<button class="btn" onclick="doAttack(false)">Roll dice</button>
      <button class="btn ghost" onclick="doAttack(true)">Blitz ⚔ (auto-roll)</button>`;
    html += `<button class="btn ghost" onclick="endAttackPhase()">End attack phase →</button>`;
  }else if(st.phase==='fortify'){
    html += `<button class="btn" onclick="endTurn()">End turn ✓</button>`;
  }
  box.innerHTML = html;
  if(st.phase!=='attack'){ $('dice').classList.remove('on'); $('battle-note').textContent=''; }
}
function showDice(A,D,aLoss,dLoss){
  const d = $('dice');
  d.innerHTML = `<div class="dice-col">${A.map(v=>`<div class="die">${v}</div>`).join('')}</div>
    <span class="vs">VS</span>
    <div class="dice-col">${D.map(v=>`<div class="die def">${v}</div>`).join('')}</div>`;
  d.classList.add('on');
  $('battle-note').textContent = `Attacker loses ${aLoss} · Defender loses ${dLoss}`;
}

/* =====================================================================
   INTERACTION
   ===================================================================== */
let lastTarget = null;   // enemy territory picked while attacking

function myIndex(){
  if(!G) return -1;
  if(session.mode==='hotseat') return G.state ? G.state.turn : 0;
  return G.players.findIndex(p=>p.id===session.playerId);
}
function isMyTurn(){
  return G && G.state && G.state.winner==null && G.state.turn === myIndex() &&
         !G.state.eliminated[myIndex()];
}
function isHost(){ return G && G.players.length && G.players[0].id===session.playerId; }

function attackTargets(){
  const st = G && G.state;
  if(!st || !isMyTurn() || st.phase!=='attack' || !sel || st.armies[sel]<2) return new Set();
  const me = myIndex();
  return new Set([...NEIGHBORS[sel]].filter(n => st.owners[n]!==me));
}
function fortifyTargets(){
  const st = G && G.state;
  if(!st || !isMyTurn() || st.phase!=='fortify' || !sel || st.armies[sel]<2) return new Set();
  const me = myIndex();
  if(st.fortified && fortifyPair) return new Set(fortifyPair.to && sel===fortifyPair.from ? [fortifyPair.to] : []);
  return new Set([...NEIGHBORS[sel]].filter(n => st.owners[n]===me));
}

function onTerritoryClick(tid){
  if(!G || !G.state || G.state.winner!=null) return;
  if(!isMyTurn()){ toast(`It's ${pNamePlain(G.state.turn)}'s turn`); return; }
  const st = G.state, me = myIndex();

  if(st.phase==='reinforce'){
    if(st.owners[tid]!==me){ toast('Place armies on your own territories'); return; }
    if(st.reinf<=0) return;
    mutate(s=>{
      s.armies[tid]++; s.reinf--;
      if(s.reinf===0){ s.phase='attack'; addLog(s, `${pTag(me)} finished reinforcing.`); }
    });
    return;
  }

  if(st.phase==='attack'){
    if(st.owners[tid]===me){
      if(st.armies[tid]<2){ toast('Need at least 2 armies to attack from here'); return; }
      sel = tid; lastTarget = null; renderAll(); return;
    }
    if(sel && NEIGHBORS[sel].has(tid)){
      lastTarget = tid; doAttack(false);
    }else{
      toast('Pick one of your territories first, then a neighboring enemy');
    }
    return;
  }

  if(st.phase==='fortify'){
    if(st.owners[tid]!==me) { toast('You can only fortify your own territories'); return; }
    if(st.fortified && fortifyPair){
      // locked to the same pair for the rest of the turn
      if(tid===fortifyPair.to && sel===fortifyPair.from && st.armies[sel]>1){ moveOne(sel,tid); return; }
      if(tid===fortifyPair.from){ sel=tid; renderAll(); return; }
      toast('Only one fortify route per turn'); return;
    }
    if(sel && sel!==tid && NEIGHBORS[sel].has(tid) && st.armies[sel]>1){
      fortifyPair = {from:sel, to:tid};
      moveOne(sel, tid);
    }else{
      if(st.armies[tid]<2 && !sel){ toast('Pick a territory with 2+ armies to move from'); return; }
      sel = tid; renderAll();
    }
  }
}
function moveOne(from, to){
  mutate(s=>{
    if(s.armies[from]>1){ s.armies[from]--; s.armies[to]++; s.fortified=true; }
  });
}
function doAttack(blitz){
  if(!sel || !lastTarget) return;
  const from = sel, to = lastTarget;
  mutate(s=>{
    const me = myIndex();
    if(s.owners[from]!==me || s.owners[to]===me) return;
    let r = null, guard = 0;
    do{
      if(s.armies[from]<2) break;
      r = resolveBattle(s, from, to);
      showDice(r.A, r.D, r.aLoss, r.dLoss);
      guard++;
    }while(blitz && !r.captured && s.armies[from]>1 && s.winner==null && guard<60);
    if(r && r.captured){ sel = to; lastTarget = null; }
    else if(s.armies[from]<2){ addLog(s, `${pTag(me)}'s attack from <b>${T_BY_ID[from].name}</b> ran out of steam.`); sel=null; lastTarget=null; }
  });
}
function endAttackPhase(){
  sel=null; lastTarget=null;
  mutate(s=>{ s.phase='fortify'; });
}
function endTurn(){
  sel=null; lastTarget=null; fortifyPair=null;
  mutate(s=>{ advanceTurn(s); });
  if(session.mode==='hotseat' && G.state.winner==null)
    toast(`Pass the device to ${pNamePlain(G.state.turn)}`);
}
function advanceTurn(s){
  s.phase='reinforce'; s.fortified=false;
  let next = s.turn, guard=0;
  do{ next = (next+1) % G.players.length; guard++; }while(s.eliminated[next] && guard<8);
  s.turn = next;
  s.reinf = calcReinforcements(s, next);
  addLog(s, `${pTag(next)} begins their turn (+${s.reinf} armies).`);
}
function hostSkip(){
  if(!isHost()) return;
  mutate(s=>{ addLog(s, `Host skipped ${pTag(s.turn)}'s turn.`); advanceTurn(s); });
}

/* ---------------- Mutation + sync ---------------- */
function mutate(fn){
  if(!G || !G.state) return;
  fn(G.state);
  G.version++; G.updatedAt = Date.now();
  localVersion = G.version;
  renderAll();
  if(session.mode==='online') storeSet(G.code, G);   // fire and forget; poll reconciles
}
async function pollOnce(){
  if(session.mode!=='online' || !session.code) return;
  const remote = await storeGet(session.code);
  if(!remote) return;
  if(remote.version > localVersion){
    const wasTurn = isMyTurn();
    G = remote; localVersion = remote.version;
    if(G.status==='playing' && $('game').classList.contains('on')===false) enterGame();
    renderAll();
    if(!wasTurn && isMyTurn()) toast('Your turn!');
  }
}

/* =====================================================================
   LOBBY FLOW
   ===================================================================== */
function showLobbyErr(msg){ $('lobby-err').textContent = msg; }

$('btn-create').onclick = async () => {
  const name = $('host-name').value.trim();
  if(!name) return showLobbyErr('Enter your name first.');
  if(!supabaseConfigured()) return showLobbyErr('Online play isn\'t set up yet — the site owner needs to add the Supabase URL and key at the top of this file. Pass-and-play still works!');
  showLobbyErr('');
  let code, tries=0;
  do{ code = randCode(); tries++; }while(await storeGet(code) && tries<8);
  session = { mode:'online', code, playerId:'p'+Math.random().toString(36).slice(2,9) };
  G = newGame(code, [{id:session.playerId, name}]);
  localVersion = G.version;
  const ok = await storeSet(code, G);
  if(!ok) return showLobbyErr('Could not reach the game database. Check your connection (or the Supabase setup) and try again.');
  showWaitingRoom();
};

$('btn-join').onclick = async () => {
  const name = $('join-name').value.trim();
  const code = $('join-code').value.trim().toUpperCase();
  if(!name || code.length!==4) return showLobbyErr('Enter your name and the 4-letter code.');
  if(!supabaseConfigured()) return showLobbyErr('Online play isn\'t set up yet — the site owner needs to add the Supabase URL and key at the top of this file. Pass-and-play still works!');
  showLobbyErr('');
  const g = await storeGet(code);
  if(!g) return showLobbyErr(`No game found with code ${code}. Check the code with your host.`);
  // reconnect: same name rejoins their seat
  const existing = g.players.find(p=>p.name.toLowerCase()===name.toLowerCase());
  if(existing){
    session = { mode:'online', code, playerId:existing.id };
    G = g; localVersion = g.version;
    g.status==='playing' ? enterGame() : showWaitingRoom();
    return;
  }
  if(g.status!=='lobby') return showLobbyErr('That game already started. Ask the host for a new code, or rejoin with the exact name you used before.');
  if(g.players.length>=4) return showLobbyErr('That game is full (4 players max). Start a new one!');
  const fresh = await storeGet(code) || g;     // re-read just before writing
  if(fresh.players.length>=4 || fresh.status!=='lobby') return showLobbyErr('That game just filled up or started.');
  const pid = 'p'+Math.random().toString(36).slice(2,9);
  fresh.players.push({id:pid, name});
  fresh.version++; fresh.updatedAt=Date.now();
  await storeSet(code, fresh);
  session = { mode:'online', code, playerId:pid };
  G = fresh; localVersion = fresh.version;
  showWaitingRoom();
};

document.querySelectorAll('[data-hotseat]').forEach(b => b.onclick = () => {
  const n = +b.dataset.hotseat;
  session = { mode:'hotseat', code:null, playerId:null };
  G = newGame('LOCAL', Array.from({length:n},(_,i)=>({id:'local'+i, name:`${PLAYER_LABELS[i]} (P${i+1})`})));
  G.status='playing'; G.state = startState(n);
  addLog(G.state, `A ${n}-player campaign begins. ${pTag(0)} moves first.`);
  enterGame();
});

function showWaitingRoom(){
  $('lobby-home').style.display='none';
  $('lobby-wait').style.display='block';
  $('wait-code').textContent = session.code;
  renderSeats();
  clearInterval(waitTimer);
  waitTimer = setInterval(async ()=>{
    const g = await storeGet(session.code);
    if(!g) return;
    if(g.version>localVersion){ G=g; localVersion=g.version; }
    renderSeats();
    if(G.status==='playing'){ clearInterval(waitTimer); enterGame(); }
  }, 2000);
}
function renderSeats(){
  const seats = [];
  for(let i=0;i<4;i++){
    const p = G.players[i];
    seats.push(p
      ? `<div class="seat"><span class="dot" style="background:${PLAYER_COLORS[i]}"></span>${esc(p.name)}${p.id===session.playerId?' <span class="you" style="font-size:.7rem;background:var(--gold);color:var(--gold-ink);border-radius:5px;padding:1px 5px;font-weight:700;">YOU</span>':''}${i===0?' · host':''}</div>`
      : `<div class="seat empty"><span class="dot" style="background:#33455F"></span>Waiting for a player…</div>`);
  }
  $('seat-list').innerHTML = seats.join('');
  const canStart = isHost() && G.players.length>=2;
  $('btn-start').disabled = !canStart;
  $('btn-start').textContent = isHost()
    ? (G.players.length>=2 ? `Start game (${G.players.length} players)` : 'Need 2+ players')
    : 'Waiting for host to start…';
}
$('btn-start').onclick = async () => {
  if(!isHost() || G.players.length<2) return;
  const fresh = await storeGet(session.code);
  if(fresh && fresh.version>localVersion){ G=fresh; localVersion=fresh.version; }
  if(G.players.length<2) return;
  G.status='playing';
  G.state = startState(G.players.length);
  addLog(G.state, `The campaign begins! ${pTag(0)} moves first.`);
  G.version++; localVersion=G.version;
  await storeSet(session.code, G);
  clearInterval(waitTimer);
  enterGame();
};
$('btn-leave').onclick = () => { clearInterval(waitTimer); softReset(); };

function softReset(){
  clearInterval(waitTimer); clearInterval(pollTimer);
  session={mode:null,code:null,playerId:null}; G=null; localVersion=-1; sel=null; lastTarget=null; fortifyPair=null;
  $('game').classList.remove('on');
  $('lobby').style.display='flex';
  $('lobby-wait').style.display='none';
  $('lobby-home').style.display='block';
  showLobbyErr('');
}
function quitToLobby(){ softReset(); }

/* ---------------- Enter game ---------------- */
async function enterGame(){
  $('lobby').style.display='none';
  $('game').classList.add('on');
  initMap();
  setTimeout(()=>map.invalidateSize(), 60);
  if(!geomReady) await loadTerritoryGeometry();
  renderAll();
  if(session.mode==='online'){
    clearInterval(pollTimer);
    pollTimer = setInterval(pollOnce, POLL_MS);
  }
  if(session.mode==='hotseat') toast(`${pNamePlain(G.state.turn)} goes first — pass the device between turns`);
}

/* ---------------- Chrome ---------------- */
$('btn-help').onclick = () => $('modal-bg').classList.add('on');
$('btn-close-modal').onclick = () => $('modal-bg').classList.remove('on');
$('modal-bg').onclick = e => { if(e.target.id==='modal-bg') $('modal-bg').classList.remove('on'); };
$('btn-quit').onclick = () => { if(confirm('Leave this game? (Online games keep running — rejoin with the same name and code.)')) softReset(); };
$('rule-win').textContent = WIN_AT;
['host-name','join-name','join-code'].forEach(id => $(id).addEventListener('keydown', e=>{
  if(e.key==='Enter') (id==='host-name' ? $('btn-create') : $('btn-join')).click();
}));

// expose handlers used in inline onclick
window.doAttack=doAttack; window.endAttackPhase=endAttackPhase; window.endTurn=endTurn;
window.hostSkip=hostSkip; window.quitToLobby=quitToLobby;
