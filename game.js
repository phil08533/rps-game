// ── Config ────────────────────────────────────────────────────
const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? `http://${window.location.hostname}:3000` : 'https://rps-game-production-e012.up.railway.app';
const socket = io(BACKEND_URL, { autoConnect: true, reconnection: true, reconnectionAttempts: 5 });

// ── State ─────────────────────────────────────────────────────
let S = {
  playerData: null, shop: null, myIndex: 0, myHand: [], opponentName: '',
  myScore: 0, oppScore: 0, round: 1, maxRounds: 7, played: false,
  myHp: 100, myMaxHp: 100, myStamina: 30, myMaxStamina: 30,
  oppHp: 100, oppMaxHp: 100, oppStamina: 30, oppMaxStamina: 30,
  roomCode: null, tournamentCode: null, isTournament: false,
  activeShopTab: 'cards',
  oppCardCount: 0, activePerksRemaining: [], lbPeriod: 'alltime',
  searching: false, currentInviteId: null, opponentAvatar: null,
  musicEnabled: false, currentTrack: 0,
};

const MUSIC_TRACKS = ['Hobbit City .mp3', 'Hobbit City  (1).mp3'];

// ── Card meta lookup ──────────────────────────────────────────
const CM = {};
function initCM() {
  if (typeof CONFIG !== 'undefined') {
    for (const [id, c] of Object.entries(CONFIG.BASE_CARDS)) {
      CM[id] = { e: CONFIG.ELEMENTS[c.type].icon, l: c.name, bg: CONFIG.ELEMENTS[c.type].color, c };
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); $(id).classList.add('active'); }
function showOv(id) { $(id).classList.remove('hidden'); }
function hideOv(id) { $(id).classList.add('hidden'); }
let _tt; function toast(m, d=2500) { const e=$('toast'); e.textContent=m; e.classList.add('show'); clearTimeout(_tt); _tt=setTimeout(()=>e.classList.remove('show'),d); }
function av(n) { return (n||'?')[0].toUpperCase(); }

function setAvatar(elId, avatarId, nameFallback) {
  const el = $(elId); if (!el) return;
  if (avatarId && avatarId.startsWith('Char')) {
    el.innerHTML = ''; el.classList.add('graphic-avatar'); el.style.backgroundImage = `url("avatars/${avatarId}/sprite.png")`;
  } else {
    el.classList.remove('graphic-avatar'); el.style.backgroundImage = 'none'; el.textContent = av(nameFallback);
  }
}

function updMenu() { 
  const p=S.playerData; if(!p)return; 
  $('menu-username').textContent=p.nickname || p.username; 
  $('menu-tag').textContent=`#${p.friendCode || '000000'}`;
  setAvatar('menu-avatar', p.equippedAvatar, p.username);
  $('menu-coins').textContent=p.coins; 
  $('menu-stats').textContent=`Wins: ${p.wins} · Games: ${p.gamesPlayed}`; 
}

// ── Render Hand ───────────────────────────────────────────────
function renderHand() {
  const area = $('player-hand-area'); area.innerHTML = '';
  if (S.myHand.length === 0 && !S.played) {
    area.innerHTML = '<div class="empty-hand-msg">😬 No cards!</div>';
    S.played = true; socket.emit('play_card', { cardIndex: -1 }); return;
  }
  S.myHand.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'game-card' + (S.played ? ' played' : '');
    const metaId = c.cardId || c;
    const m = CM[metaId] || { e: '❓', l: '?' };
    el.innerHTML = `<span class="card-emoji">${m.e}</span><span class="card-label">${m.l}</span>`;
    el.onclick = () => playCard(i);
    area.appendChild(el);
  });
}

function renderOpp(count) {
  S.oppCardCount = count;
  const area = $('opp-hand-area'); area.innerHTML = '';
  for(let i=0;i<count;i++){const el=document.createElement('div'); el.className='opp-card'; el.textContent='🃏'; area.appendChild(el);}
  $('opp-card-count').textContent = count > 0 ? '●'.repeat(Math.min(count,10)) : '—';
}

function updRound() {
  if ($('my-hp-text')) {
    $('my-hp-text').textContent = `${S.myHp} / ${S.myMaxHp} HP`;
    $('my-hp-bar').style.width = Math.max(0, (S.myHp / S.myMaxHp) * 100) + '%';
    $('my-stam-text').textContent = `${S.myStamina} / ${S.myMaxStamina} STAM`;
    $('my-stam-bar').style.width = Math.max(0, (S.myStamina / S.myMaxStamina) * 100) + '%';
  }
  if ($('opp-hp-text')) {
    $('opp-hp-text').textContent = `${S.oppHp} / ${S.oppMaxHp} HP`;
    $('opp-hp-bar').style.width = Math.max(0, (S.oppHp / S.oppMaxHp) * 100) + '%';
    $('opp-stam-text').textContent = `${S.oppStamina} / ${S.oppMaxStamina} STAM`;
    $('opp-stam-bar').style.width = Math.max(0, (S.oppStamina / S.oppMaxStamina) * 100) + '%';
  }
  $('arena-opp-name').textContent = S.opponentName;
  setAvatar('arena-opp-avatar', S.opponentAvatar, S.opponentName);
}

function playCard(i) {
  if (S.played) return;
  S.played = true;
  $('game-status').textContent = '⏳ Waiting for opponent…';
  socket.emit('play_card', { cardIndex: i });
  renderHand();
}

// ── Clash Sequence ────────────────────────────────────────────
function showRound(d) {
  const arena = $('table-area');
  const temp = arena.querySelectorAll('.table-card, .impact-ring, .table-result');
  temp.forEach(c => c.remove());
  
  const myCard = document.createElement('div');
  myCard.className = 'table-card my-side face-down';
  myCard.innerHTML = `<span class="card-emoji">❓</span><span class="card-label">Playing...</span>`;
  
  const oppCard = document.createElement('div');
  oppCard.className = 'table-card opp-side face-down';
  oppCard.innerHTML = `<span class="card-emoji">❓</span><span class="card-label">Opponent</span>`;
  
  arena.appendChild(myCard); arena.appendChild(oppCard);

  // Play music if enabled and not already playing
  startMusic();

  setTimeout(() => {
    const myId = d.myCard?.cardId || d.myCard;
    const opId = d.opponentCard?.cardId || d.opponentCard;
    const mm = CM[myId] || { e: '❓', l: '?' };
    const om = opId ? (CM[opId] || { e: '❓', l: '?' }) : { e: '❌', l: 'None' };
    
    myCard.innerHTML = `<span class="card-emoji">${mm.e}</span><span class="card-label">${mm.l}</span>`;
    oppCard.innerHTML = `<span class="card-emoji">${om.e}</span><span class="card-label">${om.l}</span>`;
    
    myCard.classList.replace('face-down', 'face-up');
    oppCard.classList.replace('face-down', 'face-up');

    setTimeout(() => {
      document.body.classList.add('screen-shake');
      setTimeout(() => document.body.classList.remove('screen-shake'), 200);
      
      const res = document.createElement('div');
      res.className = 'table-result';
      res.textContent = `-${d.damageDealt || 0} HP`;
      arena.appendChild(res);

      setTimeout(() => {
        S.myHp=d.myHp; S.myMaxHp=d.myMaxHp; S.myStamina=d.myStamina; S.myMaxStamina=d.myMaxStamina;
        S.oppHp=d.oppHp; S.oppMaxHp=d.oppMaxHp; S.oppStamina=d.oppStamina; S.oppMaxStamina=d.oppMaxStamina;
        S.myHand=d.newHand; S.played=false;
        renderHand(); renderOpp(d.opponentCardCount); updRound();
        myCard.remove(); oppCard.remove(); res.remove();
      }, 1500);
    }, 500);
  }, 800);
}

function showGO(d) {
  const w = d.winner === S.playerData?.username;
  $('go-emoji').textContent = w ? '🏆' : '💀';
  $('go-title').textContent = w ? 'Victory!' : 'Defeated!';
  $('go-coins').textContent = `+${d.coinsEarned} 🪙`;
  if (d.playerData) { S.playerData = d.playerData; updMenu(); toast('⚔️ Cards gained XP!'); }
  show('screen-gameover');
}

// ── Screen Rendering ───────────────────────────────────────────
function renderShop() {
  const p=S.playerData, sh=S.shop; if(!p||!sh) return;
  $('shop-coins').textContent=p.coins;
  const c=$('shop-content'); c.innerHTML='';
  const tab=S.activeShopTab;

  if (tab==='cards') {
    const pack = document.createElement('div'); pack.className='slot-upgrade-card';
    pack.innerHTML=`<div style="font-size:3rem">🃏</div><h4>Card Pack</h4><p>Open for 1 random Spell</p><button class="btn btn-primary" onclick="socket.emit('purchase_card_pack')" ${p.coins<200?'disabled':''}>Buy (200 🪙)</button>`;
    c.appendChild(pack);
  } else if (tab==='runes') {
    Object.entries(sh.runes || {}).forEach(([id, rune]) => {
      const el = document.createElement('div'); el.className = 'shop-item';
      el.innerHTML = `<div class="si-icon">${rune.icon}</div><div class="si-info"><div class="si-name">${rune.name}</div><div class="si-desc">${rune.description}</div></div><div class="si-action"><button class="btn-buy" onclick="socket.emit('purchase_rune', {runeId:'${id}'})" ${p.coins<rune.cost?'disabled':''}>${rune.cost}</button></div>`;
      c.appendChild(el);
    });
  } else if (tab==='avatars') {
    Object.entries(sh.avatarCosts || {}).forEach(([id, cost]) => {
      const owned = p.unlockedAvatars.includes(id);
      const el = document.createElement('div'); el.className = 'shop-item';
      el.innerHTML = `<div class="si-icon">${id}</div><div class="si-info"><div class="si-name">${AVATAR_NAMES[id]||id}</div></div><div class="si-action">${owned?'Owned':`<button class="btn-buy" onclick="socket.emit('purchase_avatar',{avatarId:'${id}'})" ${p.coins<cost?'disabled':''}>${cost}</button>`}</div>`;
      c.appendChild(el);
    });
  }
}

function renderGrimoire() {
  const p = S.playerData; if(!p) return;
  const dq = $('grim-deck-grid'); dq.innerHTML = '';
  p.deck.forEach(uuid => {
    const card = p.collection[uuid]; if(!card) return;
    const m = CM[card.cardId] || {e:'?',l:'?'};
    const el = document.createElement('div'); el.className='game-card';
    el.innerHTML = `<span>${m.e}</span><span>${m.l}</span><div class="card-actions-overlay"><button onclick="socket.emit('move_to_spellbook',{uuid:'${uuid}'})">Unequip</button></div>`;
    dq.appendChild(el);
  });
  const sq = $('grim-sb-grid'); sq.innerHTML = '';
  p.spellBook.forEach(uuid => {
    const card = p.collection[uuid]; if(!card) return;
    const m = CM[card.cardId] || {e:'?',l:'?'};
    const el = document.createElement('div'); el.className='game-card';
    el.innerHTML = `<span>${m.e}</span><span>${m.l}</span><div class="card-actions-overlay"><button onclick="socket.emit('move_to_deck',{uuid:'${uuid}'})">Equip</button></div>`;
    sq.appendChild(el);
  });
}

function renderCampaign() {
  const p = S.playerData; if(!p) return;
  const stages = CONFIG.CAMPAIGN_STAGES || [];
  const list = $('campaign-stages'); list.innerHTML = '';
  stages.forEach((stage, i) => {
    const unlocked = (p.campaignProgress || 1) >= (i + 1);
    const el = document.createElement('div'); el.className = 'shop-item'; el.style.opacity = unlocked ? '1' : '0.3';
    el.innerHTML = `<span>${unlocked?'⚔️':'🔒'}</span><div class="si-info"><b>${stage.name}</b><br>${stage.enemy}</div><button class="btn btn-sm" onclick="socket.emit('play_campaign_stage', {stageIndex:${i}})" ${unlocked?'':'disabled'}>Battle</button>`;
    list.appendChild(el);
  });
}

// ── Socket Events ─────────────────────────────────────────────
socket.on('connect', () => { const u = localStorage.getItem('rps_username'); if(u) socket.emit('register', {username:u}); });
socket.on('registered', d => { S.playerData=d.playerData; S.shop=d.shop; initCM(); updMenu(); localStorage.setItem('rps_username', d.playerData.username); show('screen-menu'); });
socket.on('player_data', d => { S.playerData=d; updMenu(); });
socket.on('game_start', d => {
  S.myIndex=d.myIndex; S.myHand=d.myHand; S.opponentName=d.opponentName; S.opponentAvatar=d.opponentAvatar;
  S.myHp=d.myHp; S.myMaxHp=d.myMaxHp; S.oppHp=d.oppHp; S.oppMaxHp=d.oppMaxHp;
  S.myStamina=d.myStamina; S.oppStamina=d.oppStamina; S.played=false;
  show('screen-game'); updRound(); renderHand(); renderOpp(d.opponentCardCount);
});
socket.on('round_result', d => showRound(d));
socket.on('game_over', d => showGO(d));
socket.on('error', d => toast('⚠️ '+d.message));

// ── Bindings ──────────────────────────────────────────────────
function startMusic() {
  const audio = $('bg-music');
  if (S.musicEnabled && audio.paused) {
    // Randomize track if not set
    if (!audio.src || audio.src === '') {
      const track = MUSIC_TRACKS[Math.floor(Math.random() * MUSIC_TRACKS.length)];
      $('music-src').src = track;
      audio.load();
    }
    audio.play().catch(e => console.log("Music blocked:", e));
  }
}

function toggleMusic() {
  const audio = $('bg-music');
  const btn = $('btn-music-toggle');
  S.musicEnabled = !S.musicEnabled;
  
  if (S.musicEnabled) {
    btn.classList.remove('muted');
    startMusic();
    toast('🎵 Music On');
  } else {
    btn.classList.add('muted');
    audio.pause();
    toast('🔇 Music Muted');
  }
  localStorage.setItem('rps_music_enabled', S.musicEnabled);
}

// Initialize music pref
const savedMusic = localStorage.getItem('rps_music_enabled');
if (savedMusic === 'true') {
  S.musicEnabled = true;
  $('btn-music-toggle').classList.remove('muted');
} else {
  S.musicEnabled = false;
  $('btn-music-toggle').classList.add('muted');
}

$('btn-music-toggle').onclick = toggleMusic;

$('btn-login').onclick = () => { 
  const u = $('username-input').value.trim(); 
  if(u) {
    socket.emit('register', {username:u});
    startMusic(); // Start on first interaction
  }
};
$('btn-quickplay').onclick = () => socket.emit('find_match');
$('btn-play-bot').onclick = () => socket.emit('play_vs_bot');
$('btn-campaign').onclick = () => { renderCampaign(); show('screen-campaign'); };
$('btn-shop').onclick = () => { renderShop(); show('screen-shop'); };
$('btn-grimoire').onclick = () => { renderGrimoire(); show('screen-grimoire'); };
document.querySelectorAll('.tab-btn').forEach(btn => btn.onclick = () => { S.activeShopTab = btn.dataset.tab; renderShop(); });
document.querySelectorAll('.btn-back').forEach(btn => btn.onclick = () => show('screen-menu'));
