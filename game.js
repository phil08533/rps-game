// ── Config ────────────────────────────────────────────────────
const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? `http://${window.location.hostname}:3000` : 'https://rps-game-production-e012.up.railway.app';
const socket = io(BACKEND_URL, { autoConnect: true, reconnection: true, reconnectionAttempts: 5 });

// ── State ─────────────────────────────────────────────────────
let S = {
  playerData: null, shop: null, myIndex: 0, myHand: [], opponentName: '',
  myScore: 0, oppScore: 0, round: 1, maxRounds: 7, played: false,
  roomCode: null, tournamentCode: null, isTournament: false,
  tournamentMaxPlayers: 4, activeShopTab: 'passive-perks',
  oppCardCount: 0, activePerksRemaining: [], lbPeriod: 'alltime',
  searching: false, currentInviteId: null, opponentAvatar: null,
};

// ── Card/Perk meta ────────────────────────────────────────────
const CM = { rock: { e:'🪨', l:'Rock' }, paper: { e:'📄', l:'Paper' }, scissors: { e:'✂️', l:'Scissors' } };
const SM = {
  classic:{ic:'⬜',cl:''},neon:{ic:'💚',cl:'skin-neon'},fire:{ic:'🔥',cl:'skin-fire'},
  galaxy:{ic:'🌌',cl:'skin-galaxy'},gold:{ic:'✨',cl:'skin-gold'},ice:{ic:'❄️',cl:'skin-ice'},
  shadow:{ic:'🖤',cl:'skin-shadow'},rainbow:{ic:'🌈',cl:'skin-rainbow'},
};

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
    el.innerHTML = '';
    // Don't overwrite existing classes like arena-avatar
    el.classList.add('graphic-avatar');
    el.classList.remove('f-avatar');
    el.style.backgroundImage = `url("avatars/${avatarId}/sprite.png")`;
    el.textContent = '';
  } else {
    el.classList.remove('graphic-avatar');
    el.classList.add('f-avatar');
    el.style.backgroundImage = 'none';
    el.textContent = av(nameFallback);
  }
}
function updMenu() { 
  const p=S.playerData; if(!p)return; 
  $('menu-username').textContent=p.nickname || p.username; 
  $('menu-tag').textContent=`#${p.friendCode || '000000'}`;
  setAvatar('menu-avatar', p.equippedAvatar, p.username);
  $('menu-coins').textContent=p.coins; 
  $('menu-stats').textContent=`Wins: ${p.wins} · Losses: ${p.losses} · Games: ${p.gamesPlayed}`; 
  
  // Guests don't get friends
  const isGuest = p.username.startsWith('Guest_');
  const btnFriends = $('btn-friends');
  if (btnFriends) {
    if (isGuest) {
      btnFriends.style.opacity = '0.3';
      btnFriends.style.pointerEvents = 'none';
      btnFriends.style.filter = 'grayscale(1)';
    } else {
      btnFriends.style.opacity = '1';
      btnFriends.style.pointerEvents = 'auto';
      btnFriends.style.filter = 'none';
    }
  }
}
function applySkin(id) { const cls=Object.values(SM).map(m=>m.cl).filter(Boolean); document.body.classList.remove(...cls); if(SM[id]?.cl) document.body.classList.add(SM[id].cl); }

// ── Render perk bar ───────────────────────────────────────────
function renderPerkBar() {
  const bar = $('perk-bar'); bar.innerHTML = '';
  if (!S.activePerksRemaining || S.activePerksRemaining.length === 0) return;
  S.activePerksRemaining.forEach(id => {
    const p = S.shop?.perks?.[id];
    if (!p) return;
    const btn = document.createElement('button');
    btn.className = 'perk-btn';
    btn.dataset.perkId = id;
    btn.innerHTML = `<span class="perk-icon">${p.icon}</span>${p.name}`;
    btn.addEventListener('click', () => activatePerk(id));
    bar.appendChild(btn);
  });
}
function activatePerk(id) {
  if (S.played) return toast('Play a card first!');
  socket.emit('activate_perk', { perkId: id });
}

// ── Render cards ──────────────────────────────────────────────
function renderHand() {
  const area = $('player-hand-area'); area.innerHTML = '';
  if (S.myHand.length === 0 && !S.played) {
    area.innerHTML = '<div class="empty-hand-msg">😬 No cards! Opponent gets a free point.</div>';
    S.played = true; $('game-status').textContent = '💀 No cards — forfeiting…';
    socket.emit('play_card', { cardIndex: -1 }); return;
  }
  S.myHand.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'game-card' + (S.played ? ' played' : '');
    el.dataset.idx = i; el.draggable = !S.played;
    const m = CM[c] || { e:'❓', l:'?' };
    el.innerHTML = `<span class="card-emoji">${m.e}</span><span class="card-label">${m.l}</span>`;
    el.addEventListener('click', () => playCard(i));
    el.addEventListener('dragstart', e => { if(S.played) return e.preventDefault(); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',i); setTimeout(()=>el.classList.add('dragging'),0); _dSrc=i; });
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop-target'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('drop-target'); const from=parseInt(e.dataTransfer.getData('text/plain')); if(from!==i) swapCards(from,i); });
    el.addEventListener('dragend', () => document.querySelectorAll('.game-card').forEach(c=>c.classList.remove('dragging','drop-target')));
    area.appendChild(el);
  });
}
let _dSrc = -1;

function renderOpp(count) {
  S.oppCardCount = count;
  const area = $('opp-hand-area'); area.innerHTML = '';
  if (count === 0) { area.innerHTML = '<div class="empty-hand-msg">😬 Opponent has no cards!</div>'; }
  else { for(let i=0;i<count;i++){const el=document.createElement('div');el.className='opp-card';el.textContent='🃏';area.appendChild(el);} }
  $('opp-card-count').textContent = count > 0 ? '●'.repeat(Math.min(count,10)) : '—';
}
function updRound() {
  $('my-score-num').textContent=S.myScore; $('opp-score-num').textContent=S.oppScore;
  $('round-label').textContent=`Round ${S.round} / ${S.maxRounds}`;
  $('my-score-name').textContent=S.playerData?.username?.slice(0,8)||'You';
  $('opp-name').textContent=S.opponentName;
  setAvatar('opp-avatar', S.opponentAvatar, S.opponentName);
}

function swapCards(a, b) {
  [S.myHand[a], S.myHand[b]] = [S.myHand[b], S.myHand[a]];
  socket.emit('reorder_hand', { swap: [a, b] }); renderHand();
}

function playCard(i) {
  if (S.played || i < 0 || i >= S.myHand.length) return;
  S.played = true;
  document.querySelectorAll('.game-card').forEach((c, ci) => {
    if (ci === i) c.classList.add('selected'); else c.classList.add('played');
  });
  $('game-status').textContent = '⏳ Waiting for opponent…';
  socket.emit('play_card', { cardIndex: i });
}

// ── Round result (overlay, keeping it simple but with perk messages) ──
// ── Round result (Arena Clash System) ──
function showRound(d) {
  const arena = $('table-area');
  // Clear only temporary cards/rings, keep the stage and feed
  const tempCards = arena.querySelectorAll('.table-card, .impact-ring, .table-result');
  tempCards.forEach(c => c.remove());
  
  // 1. Create Clashing Cards (Generic Back)
  const myCard = document.createElement('div');
  myCard.className = 'table-card my-side face-down anim-slide-in-bottom';
  myCard.innerHTML = `<span class="card-emoji">❓</span><span class="card-label">Selecting...</span>`;
  
  const oppCard = document.createElement('div');
  oppCard.className = 'table-card opp-side face-down anim-slide-in-top';
  oppCard.innerHTML = `<span class="card-emoji">❓</span><span class="card-label">Opponent</span>`;
  
  arena.appendChild(myCard);
  arena.appendChild(oppCard);

  // 2. Reveal and Clash Sequence
  setTimeout(() => {
    // Inject REAL data exactly as they start to flip (around 200ms)
    setTimeout(() => {
      myCard.innerHTML = `<span class="card-emoji">${(CM[d.myCard]||{e:'❓'}).e}</span><span class="card-label">${(CM[d.myCard]||{e:'?'}).l}</span>`;
      const opM = d.opponentCard ? (CM[d.opponentCard]||{e:'❓'}) : d.opponentPhantom ? {e:'👻',l:'Hidden'} : {e:'❌',l:'None'};
      oppCard.innerHTML = `<span class="card-emoji">${opM.e}</span><span class="card-label">${opM.l}</span>`;
    }, 200);

    myCard.classList.remove('face-down'); myCard.classList.add('face-up', 'anim-flip');
    oppCard.classList.remove('face-down'); oppCard.classList.add('face-up', 'anim-flip');
    
    // Impact after flip
    setTimeout(() => {
      document.body.classList.add('screen-shake');
      setTimeout(() => document.body.classList.remove('screen-shake'), 300);
      
      const ring = document.createElement('div');
      ring.className = 'impact-ring';
      arena.appendChild(ring);
      
      // Determine Animations for CARDS and AVATARS
      const myAv = $('arena-my-avatar');
      const oppAv = $('arena-opp-avatar');

      if (d.result === 'win') {
        myCard.classList.add('anim-winner-slap');
        oppCard.classList.add('anim-loser-die');
        if (myAv) myAv.parentElement.classList.add('anim-winner-slap');
        if (oppAv) oppAv.className = 'arena-avatar emote-death';
      } else if (d.result === 'loss') {
        oppCard.classList.add('anim-winner-slap');
        myCard.classList.add('anim-loser-die');
        if (oppAv) oppAv.parentElement.classList.add('anim-winner-slap');
        if (myAv) myAv.className = 'arena-avatar emote-death';
      } else {
        myCard.style.transform = 'translateY(10px)';
        oppCard.style.transform = 'translateY(-10px)';
      }
      
      const res = document.createElement('div');
      res.className = `table-result ${d.result}`;
      res.textContent = d.result === 'win' ? 'VICTORY' : d.result === 'loss' ? 'DEFEAT' : 'TIE';
      arena.appendChild(res);

      // Final Cleanup
      setTimeout(() => {
        myCard.remove(); oppCard.remove(); res.remove();
        if(myAv) { myAv.className = 'arena-avatar'; myAv.parentElement.classList.remove('anim-winner-slap'); }
        if(oppAv) { oppAv.className = 'arena-avatar'; oppAv.parentElement.classList.remove('anim-winner-slap'); }
        
        S.myScore=d.myScore; S.oppScore=d.opponentScore; S.round=d.round;
        S.myHand=d.newHand; S.played=false; S.activePerksRemaining=d.activePerksRemaining||[];
        renderHand(); renderOpp(d.opponentCardCount); updRound(); renderPerkBar();
        $('game-status').textContent=S.myHand.length>0?'Tap a card · Hold to drag':'Out of cards…';
      }, 2000);
      
    }, 800);
    
  }, 1000);
}

// ── Game over ─────────────────────────────────────────────────
function showGO(d) {
  hideOv('overlay-round');
  const w=d.winner===d.playerData?.username, t=d.winner===null;
  $('go-emoji').textContent=w?'🏆':t?'🤝':'💀';
  $('go-title').textContent=w?'Victory!':t?'Draw!':'Defeated!';
  $('go-subtitle').textContent=d.reason==='disconnect'?'Opponent fled!':w?'Gladiator rises.':t?'Evenly matched.':'Fight again!';
  $('go-my-score').textContent=d.myScore; $('go-opp-score').textContent=d.opponentScore;
  $('go-my-name').textContent=d.playerData?.username||'You';
  $('go-coins').textContent=`+${d.coinsEarned} 🪙`;
  
  // Re-show double reward button if coins were earned
  const dbtn = $('btn-double-reward');
  if (dbtn) dbtn.style.display = d.coinsEarned > 0 ? 'block' : 'none';

  if(d.playerData){S.playerData=d.playerData;updMenu();}
  show('screen-gameover');
}

// ── Shop ──────────────────────────────────────────────────────
function renderShop() {
  const p=S.playerData,sh=S.shop; if(!p||!sh) return;
  $('shop-coins').textContent=p.coins;
  const c=$('shop-content'); c.innerHTML='';
  const tab=S.activeShopTab;

  if(tab==='passive-perks'||tab==='active-perks') {
    const type=tab==='passive-perks'?'passive':'active';
    Object.values(sh.perks).filter(pk=>pk.type===type).forEach(item => {
      const owned=p.unlockedPerks.includes(item.id), equipped=p.equippedPerks.includes(item.id);
      const el=document.createElement('div'); el.className='shop-item';
      el.innerHTML=`<div class="si-icon">${item.icon}</div><div class="si-info"><div class="si-name">${item.name}</div><div class="si-desc">${item.description}</div></div><div class="si-action">${
        equipped?`<button class="btn-buy" data-id="${item.id}" data-type="unequip">Unequip</button>`
        :owned?`<button class="btn-buy" data-id="${item.id}" data-type="equip">Equip</button>`
        :`<button class="btn-buy" data-id="${item.id}" data-type="buy-perk" ${p.coins<item.cost?'disabled':''}>${item.cost} 🪙</button>`
      }</div>`;
      c.appendChild(el);
    });
  } else if(tab==='skins') {
    [{id:'classic',name:'Classic',cost:0,description:'Default'},...Object.values(sh.skins)].forEach(item=>{
      const owned=p.unlockedSkins.includes(item.id),equipped=p.equippedSkin===item.id;
      const meta=SM[item.id]||{};
      const el=document.createElement('div'); el.className='shop-item';
      el.innerHTML=`<div class="si-icon">${meta.ic||'🎨'}</div><div class="si-info"><div class="si-name">${item.name}</div><div class="si-desc">${item.description}</div></div><div class="si-action">${
        equipped?'<span class="badge-equipped">Equipped</span>'
        :owned?`<button class="btn-buy" data-id="${item.id}" data-type="equip-skin">Equip</button>`
        :item.cost===0?'<span class="badge-owned">Free</span>'
        :`<button class="btn-buy" data-id="${item.id}" data-type="buy-skin" ${p.coins<item.cost?'disabled':''}>${item.cost} 🪙</button>`
      }</div>`;
      c.appendChild(el);
    });
  } else if(tab==='slots') {
    const next=p.perkSlots+1;
    const el=document.createElement('div'); el.className='slot-upgrade-card';
    if(next>5) {
      el.innerHTML=`<h4>🛡️ Max Perk Slots</h4><p>You have all 5 slots unlocked!</p><p style="font-size:2rem;margin:.5rem 0">⚔️</p>`;
    } else {
      const cost=sh.slotCosts[next];
      el.innerHTML=`<h4>🛡️ Perk Slots: ${p.perkSlots} / 5</h4><p>Equip more perks at once. Slot ${next} costs <strong>${cost} 🪙</strong></p><button class="btn btn-primary" id="btn-buy-slot" ${p.coins<cost?'disabled':''}>Upgrade to ${next} Slots — ${cost} 🪙</button>`;
    }
    c.appendChild(el);
    if(p.equippedPerks.length>0){
      const h=document.createElement('h4');h.className='section-title';h.style.marginTop='1rem';h.textContent='Equipped Perks';c.appendChild(h);
      p.equippedPerks.forEach(id=>{const pk=sh.perks[id];if(!pk)return;const d=document.createElement('div');d.className='shop-item';d.innerHTML=`<div class="si-icon">${pk.icon}</div><div class="si-info"><div class="si-name">${pk.name}</div><div class="si-desc">${pk.type}</div></div><div class="si-action"><button class="btn-buy" data-id="${id}" data-type="unequip">Remove</button></div>`;c.appendChild(d);});
    }
  } else if(tab==='avatars') {
    for (let i = 6; i <= 18; i++) {
      const avatarId = `Char ${i}`;
      const owned = p.unlockedAvatars.includes(avatarId);
      const equipped = p.equippedAvatar === avatarId;
      const cost = sh.avatarCosts[avatarId];
      const el = document.createElement('div'); el.className='shop-item';
      el.innerHTML=`<div class="si-icon"><div class="avatar-display" style="background-image:url('avatars/${avatarId}/sprite.png');transform:scale(0.8)"></div></div><div class="si-info"><div class="si-name">Gladiator ${i}</div></div><div class="si-action">${
        equipped?'<span class="badge-equipped">Equipped</span>'
        :owned?`<button class="btn-buy" data-id="${avatarId}" data-type="equip-avatar">Equip</button>`
        :`<button class="btn-buy" data-id="${avatarId}" data-type="buy-avatar" ${p.coins<cost?'disabled':''}>${cost} 🪙</button>`
      }</div>`;
      c.appendChild(el);
    }
  } else if(tab==='rewards') {
    const el=document.createElement('div'); el.className='reward-ad-card';
    el.innerHTML=`
      <div class="reward-sparkle">✨</div>
      <h4>Free Coins</h4>
      <p>Watch a short video to earn coins!</p>
      <button id="btn-start-reward-ad" class="btn btn-primary btn-full">Watch Video (+100 🪙)</button>
    `;
    c.appendChild(el);
    const rb = $('btn-start-reward-ad');
    if(rb) rb.onclick = () => showAd();
  }

  c.onclick = e => {
    const b=e.target.closest('[data-type]'); if(!b||b.disabled) return;
    const t=b.dataset.type, id=b.dataset.id;
    if(t==='buy-skin') socket.emit('purchase_skin',{skinId:id});
    if(t==='equip-skin') socket.emit('equip_skin',{skinId:id});
    if(t==='buy-perk') socket.emit('purchase_perk',{perkId:id});
    if(t==='buy-avatar') socket.emit('purchase_avatar',{avatarId:id});
    if(t==='equip-avatar') socket.emit('equip_avatar',{avatarId:id});
    if(t==='equip') socket.emit('equip_perk',{perkId:id});
    if(t==='unequip') socket.emit('unequip_perk',{perkId:id});
  };
  setTimeout(()=>{const sb=$('btn-buy-slot');if(sb)sb.onclick=()=>socket.emit('upgrade_perk_slots');},50);
}

// ── Profile ───────────────────────────────────────────────────
function renderProfile() {
  const p=S.playerData; if(!p) return;
  setAvatar('prof-avatar-big', p.equippedAvatar, p.username);
  $('prof-avatar-big').style.transform = 'scale(1.5)';
  $('prof-username').textContent=p.nickname || p.username;
  $('prof-tag').textContent=`#${p.friendCode || '000000'}`;
  $('prof-coins').textContent=p.coins; $('prof-wins').textContent=p.wins;
  $('prof-losses').textContent=p.losses;
  $('prof-games').textContent=p.gamesPlayed;
  $('prof-slot-count').textContent=p.perkSlots;
  const epl=$('prof-equipped-perks'); epl.innerHTML='';
  if(p.equippedPerks.length===0) epl.innerHTML='<div class="equipped-perk-item" style="color:var(--muted)">No perks equipped</div>';
  else p.equippedPerks.forEach(id=>{const pk=S.shop?.perks?.[id];if(!pk)return;const d=document.createElement('div');d.className='equipped-perk-item';d.innerHTML=`<span class="epi-icon">${pk.icon}</span><span class="epi-name">${pk.name}</span><span class="epi-type">${pk.type}</span>`;epl.appendChild(d);});
  const sr=$('prof-skin-preview'); sr.innerHTML='';
  Object.entries(SM).forEach(([id,m])=>{const d=document.createElement('div');d.className='skin-dot';d.textContent=m.ic;d.style.border=p.equippedSkin===id?'2px solid var(--accent)':'2px solid transparent';d.style.opacity=p.unlockedSkins.includes(id)||id==='classic'?'1':'0.3';sr.appendChild(d);});

  const ar=$('prof-avatar-preview'); ar.innerHTML='';
  ['Char 1','Char 2','Char 3','Char 4','Char 5'].forEach(vid=>{
    const d=document.createElement('div'); d.className='avatar-thumb ' + (p.equippedAvatar===vid?'owned':'locked');
    d.style.backgroundImage=`url("avatars/${vid}/sprite.png")`;
    if(p.equippedAvatar===vid) d.style.borderColor='var(--accent)';
    d.onclick = () => socket.emit('equip_avatar',{avatarId:vid});
    ar.appendChild(d);
  });
}

// ── Leaderboard ───────────────────────────────────────────────
function renderLB(entries) {
  const list=$('lb-list'); list.innerHTML='';
  if(!entries||entries.length===0){list.innerHTML='<p style="text-align:center;color:var(--muted);padding:2rem">No data yet. Play some games!</p>';return;}
  entries.forEach((e,i)=>{
    const el=document.createElement('div');
    el.className='lb-entry'+(e.username===S.playerData?.username?' me':'');
    const rc=i===0?'gold':i===1?'silver':i===2?'bronze':'';
    el.innerHTML=`<span class="lb-rank ${rc}">${i+1}</span><span class="lb-name">${e.username}</span><span class="lb-val">${e.value} W</span>`;
    list.appendChild(el);
  });
}

// ── Friends ───────────────────────────────────────────────────
function renderFriends(list) {
  const fl=$('friends-list'); fl.innerHTML='';
  const emp=$('friends-empty');
  if(!list||list.length===0){emp.style.display='';return;}
  emp.style.display='none';
  list.forEach(f=>{
    const el=document.createElement('div'); el.className='friend-item';
    el.innerHTML=`<div class="f-avatar">${av(f.username)}</div><span class="f-name">${f.username}</span><span style="color:${f.online?'var(--green)':'var(--muted)'}; font-size:.8rem">${f.online?'Online':'Offline'}</span>${f.online?`<button class="btn-buy btn-sm" data-invite="${f.username}" style="margin-left:.5rem">⚔️ Invite</button>`:''}<button class="btn-buy btn-sm" data-rm="${f.username}" style="margin-left:.25rem">✕</button>`;
    fl.appendChild(el);
  });
  fl.onclick=e=>{
    const rm=e.target.closest('[data-rm]');
    if(rm) return socket.emit('remove_friend',{friendName:rm.dataset.rm});
    const inv=e.target.closest('[data-invite]');
    if(inv) { socket.emit('invite_friend',{friendName:inv.dataset.invite}); toast(`⚔️ Invited ${inv.dataset.invite}!`); }
  };
}

// ── Tournament lobby ──────────────────────────────────────────
function renderTL(t) {
  $('tourn-lobby-name').textContent=t.name||'Tournament';
  $('tourn-lobby-code').textContent=t.code;
  $('tourn-prize').textContent=`${t.prizePool} 🪙`;
  const list=$('tourn-player-list'); list.innerHTML='';
  t.players.forEach(p=>{const el=document.createElement('div');el.className='player-list-item';el.innerHTML=`<span class="pl-dot"></span><span>${p.username}</span>`;list.appendChild(el);});
  $('tourn-lobby-status').textContent=`${t.players.length} / ${t.maxPlayers} players joined`;
  const isHost=t.players[0]?.username===S.playerData?.username;
  const sb=$('btn-start-tourn'); if(isHost&&t.players.length>=2) sb.classList.remove('hidden'); else sb.classList.add('hidden');
}

// ── Socket Events ─────────────────────────────────────────────
socket.on('connect', () => { const s=localStorage.getItem('rps_username'); if(s) socket.emit('register',{username:s}); });
socket.on('registered', ({playerData,shop}) => { S.playerData=playerData; S.shop=shop; localStorage.setItem('rps_username',playerData.username); applySkin(playerData.equippedSkin); updMenu(); show('screen-menu'); });
socket.on('error', ({message}) => toast('⚠️ '+message));

socket.on('room_created', ({code, inviteSent}) => {
  S.roomCode=code; $('lobby-code').textContent=code;
  if(inviteSent) $('lobby-status').textContent=`Invited ${inviteSent} — waiting…`;
  // Update URL
  history.replaceState(null, '', '?room=' + code);
  show('screen-lobby');
});

// Matchmaking
socket.on('match_searching', () => {
  S.searching=true;
  $('btn-find-match').classList.add('hidden');
  $('matchmaking-status').classList.remove('hidden');
});
socket.on('match_cancelled', () => {
  S.searching=false;
  $('btn-find-match').classList.remove('hidden');
  $('matchmaking-status').classList.add('hidden');
});

// Invites
socket.on('game_invite', ({inviteId, from}) => {
  S.currentInviteId=inviteId;
  $('invite-from-text').textContent=`${from} wants to battle you!`;
  showOv('overlay-invite');
});
socket.on('invite_declined', ({by}) => { toast(`${by} declined your invite.`); });

socket.on('game_start', d => {
  S.myIndex=d.myIndex; S.myHand=d.myHand; S.opponentName=d.opponentName; S.opponentAvatar=d.opponentAvatar;
  S.myScore=0; S.oppScore=0; S.round=1; S.maxRounds=d.maxRounds; S.played=false;
  S.roomCode=d.room; S.isTournament=d.isTournament||false; S.tournamentCode=d.tournamentCode||null;
  S.activePerksRemaining=d.activePerksRemaining||[]; S.searching=false;
  // Reset matchmaking UI
  $('btn-find-match').classList.remove('hidden');
  if ($('btn-play-bot')) $('btn-play-bot').classList.remove('hidden');
  $('matchmaking-status').classList.add('hidden');
  hideOv('overlay-invite'); hideOv('overlay-round'); show('screen-game');
  
  // Arena Setup
  $('arena-my-name').textContent = S.playerData.nickname || S.playerData.username;
  $('arena-opp-name').textContent = S.opponentName;
  setAvatar('arena-my-avatar', S.playerData.equippedAvatar, S.playerData.username);
  setAvatar('arena-opp-avatar', S.opponentAvatar, S.opponentName);
  
  renderHand(); renderOpp(d.opponentCardCount); updRound(); renderPerkBar();
  $('game-status').textContent='Tap a card · Hold to drag';
});

socket.on('opponent_played', () => { if(!S.played) $('game-status').textContent='⚡ Opponent played!'; });
socket.on('opponent_reordered', ({cardCount}) => { renderOpp(cardCount); toast('👀 Opponent rearranged'); });
socket.on('round_result', d => showRound(d));
socket.on('game_over', d => showGO(d));

// Perk events
socket.on('perk_activated', ({perkId, activePerksRemaining}) => {
  S.activePerksRemaining=activePerksRemaining;
  const btns=document.querySelectorAll('.perk-btn');
  btns.forEach(b=>{if(b.dataset.perkId===perkId){b.classList.add('active-now');b.classList.add('used');}});
  toast('✅ Perk activated!');
});
socket.on('opponent_used_perk', ({perkIcon}) => toast(`⚠️ Opponent used ${perkIcon}!`));
socket.on('peek_reveal', ({opponentHand}) => {
  const ph=$('peek-hand'); ph.innerHTML='';
  opponentHand.forEach(c=>{const m=CM[c]||{e:'?',l:'?'};const el=document.createElement('div');el.className='peek-card';el.innerHTML=`<span>${m.e}</span><span>${m.l}</span>`;ph.appendChild(el);});
  showOv('overlay-peek');
});
socket.on('reroll_result', ({newHand}) => { S.myHand=newHand; renderHand(); toast('🎲 Hand rerolled!'); });
socket.on('encore_replay', d => {
  S.myHand=d.newHand; S.played=false; S.activePerksRemaining=d.activePerksRemaining||[];
  renderHand(); renderOpp(d.opponentCardCount); renderPerkBar();
  $('game-status').textContent='🔁 Encore! Play again!';
  toast('🔁 Round replayed!');
});

// Shop
socket.on('purchase_success', ({playerData}) => { S.playerData=playerData; applySkin(playerData.equippedSkin); updMenu(); renderShop(); renderProfile(); toast('✅ Done!'); });

// Emotes
socket.on('play_emote', ({username, emoteName}) => {
  const feed = $('emote-feed');
  const bubble = document.createElement('div');
  bubble.className = 'emote-bubble';
  const displayNick = (username === S.playerData?.username) ? 'You' : (username === S.opponentName ? 'Opponent' : username);
  bubble.textContent = `${displayNick}: ${emoteName.replace('_', ' ')}`;
  feed.appendChild(bubble);
  
  // Also push to character if they exist
  let targetNode = null;
  if(username === S.opponentName) targetNode = $('arena-opp-avatar');
  else if(username === S.playerData?.username) targetNode = $('arena-my-avatar');
  
  if (targetNode && targetNode.classList.contains('graphic-avatar')) {
    targetNode.style.animation = 'none';
    void targetNode.offsetWidth;
    // Don't overwrite className, use classList
    const emoteCls = `emote-${emoteName}`;
    targetNode.classList.add(emoteCls);
    setTimeout(() => {
      targetNode.classList.remove(emoteCls);
      targetNode.style.animation = '';
    }, 1200);
  }
});

// Tournament
socket.on('tournament_created', ({tournament,playerData}) => { S.playerData=playerData; S.tournamentCode=tournament.code; updMenu(); renderTL(tournament); show('screen-tourn-lobby'); toast('Tournament created!'); });
socket.on('joined_tournament', ({tournament,playerData}) => { S.playerData=playerData; S.tournamentCode=tournament.code; updMenu(); renderTL(tournament); show('screen-tourn-lobby'); });
socket.on('tournament_update', ({tournament}) => renderTL(tournament));
socket.on('tournament_started', () => { $('tourn-lobby-status').textContent='⚡ Preparing your match…'; $('btn-start-tourn').classList.add('hidden'); });
socket.on('tournament_round_start', ({round}) => toast(`🏆 Round ${round}!`));
socket.on('tournament_over', ({champion,tournamentCoinsEarned,placement}) => {
  hideOv('overlay-round');
  $('to-emoji').textContent=placement===1?'🏆':placement===2?'🥈':'🎮';
  $('to-title').textContent=placement===1?'Champion!':placement===2?'Runner-Up!':'Tournament Over';
  $('to-champion').textContent=`Champion: ${champion}`;
  $('to-coins').textContent=tournamentCoinsEarned>0?`+${tournamentCoinsEarned} 🪙`:'Better luck next time!';
  showOv('overlay-tourn-over');
  if(S.playerData?.username) socket.emit('register',{username:S.playerData.username});
});
socket.on('public_tournaments', ({tournaments}) => {
  const list=$('public-tourn-list'); list.innerHTML='';
  if(tournaments.length===0){list.innerHTML='<p style="text-align:center;color:var(--muted);font-size:.9rem">No public tournaments right now.</p>';return;}
  tournaments.forEach(t=>{const el=document.createElement('div');el.className='pub-tourn-item';el.innerHTML=`<div class="pub-tourn-info"><span>${t.name}</span><span>${t.players}/${t.maxPlayers} · Entry: ${t.entryFee} 🪙 · Pool: ${t.prizePool} 🪙</span></div><button class="btn btn-secondary btn-sm" data-join-t="${t.code}">Join</button>`;list.appendChild(el);});
  list.onclick=e=>{const b=e.target.closest('[data-join-t]');if(b) socket.emit('join_tournament',{code:b.dataset.joinT});};
});

// Leaderboard
socket.on('leaderboard_data', ({period,entries}) => { S.lbPeriod=period; renderLB(entries); });
// Friends
socket.on('friends_list', ({friends}) => renderFriends(friends));

// ── UI Bindings ───────────────────────────────────────────────
$('btn-login').addEventListener('click', () => {
  let n = $('username-input').value.trim();
  if (n.length < 2) return toast('2+ characters');
  // Ensure Guest_ prefix for guest accounts
  if (!n.startsWith('Guest_')) n = 'Guest_' + n;
  socket.emit('register', { username: n });
});
$('username-input').addEventListener('keydown', e => { if(e.key==='Enter') $('btn-login').click(); });
document.querySelectorAll('.btn-back').forEach(b => b.addEventListener('click', () => { if(b.dataset.target) show(b.dataset.target); }));

$('btn-quickplay').addEventListener('click', () => show('screen-quickplay'));
$('btn-tournament-menu').addEventListener('click', () => show('screen-tournament'));
$('btn-shop').addEventListener('click', () => { renderShop(); show('screen-shop'); });
$('btn-profile').addEventListener('click', () => { renderProfile(); show('screen-profile'); });
$('btn-leaderboard').addEventListener('click', () => { socket.emit('get_leaderboard',{period:S.lbPeriod}); show('screen-leaderboard'); });
$('btn-friends').addEventListener('click', () => { socket.emit('get_friends'); show('screen-friends'); });

$('btn-create').addEventListener('click', () => socket.emit('create_room'));
$('btn-find-match').addEventListener('click', () => { 
  $('btn-find-match').classList.add('hidden');
  if ($('btn-play-bot')) $('btn-play-bot').classList.add('hidden');
  $('matchmaking-status').classList.remove('hidden');
  socket.emit('find_match'); 
});
$('btn-cancel-match').addEventListener('click', () => { 
  $('matchmaking-status').classList.add('hidden');
  if ($('btn-play-bot')) $('btn-play-bot').classList.remove('hidden');
  $('btn-find-match').classList.remove('hidden');
  socket.emit('cancel_match'); 
});
if ($('btn-play-bot')) $('btn-play-bot').addEventListener('click', () => socket.emit('play_vs_bot'));
$('btn-join').addEventListener('click', () => { const c=$('join-code-input').value.trim().toUpperCase(); if(c.length!==4) return toast('Enter 4-letter code'); socket.emit('join_room',{code:c}); });
$('join-code-input').addEventListener('keydown', e => { if(e.key==='Enter') $('btn-join').click(); });
$('btn-copy-code').addEventListener('click', () => { navigator.clipboard.writeText(S.roomCode||$('lobby-code').textContent).then(()=>toast('📋 Copied!')).catch(()=>toast($('lobby-code').textContent)); });
$('btn-play-again').addEventListener('click', () => show('screen-quickplay'));
$('btn-double-reward').addEventListener('click', () => {
  $('btn-double-reward').style.display = 'none';
  showAd('double');
});
$('btn-forfeit').addEventListener('click', () => {
  if (confirm('Concede match? You will lose coins.')) {
    socket.emit('forfeit');
  }
});
$('btn-go-menu').addEventListener('click', () => {
  history.replaceState(null, '', '/');
  show('screen-menu');
});

// Shop tabs
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.tab-btn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); S.activeShopTab=b.dataset.tab; renderShop(); }));
$('btn-logout').addEventListener('click', () => { localStorage.removeItem('rps_username'); show('screen-login'); $('username-input').value=''; });

// Tournament
$('btn-create-tourn').addEventListener('click', () => showOv('overlay-create-tourn'));
$('btn-cancel-create-tourn').addEventListener('click', () => hideOv('overlay-create-tourn'));
document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.seg-btn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); S.tournamentMaxPlayers=parseInt(b.dataset.val); }));
$('btn-confirm-create-tourn').addEventListener('click', () => {
  const name=$('tourn-name-input').value.trim()||'Grand Clash';
  const fee=parseInt($('tourn-fee-input').value)||0;
  const pub=$('tourn-public-check').checked;
  socket.emit('create_tournament',{name,entryFee:fee,maxPlayers:S.tournamentMaxPlayers||4,isPublic:pub});
  hideOv('overlay-create-tourn');
});
$('btn-join-tourn').addEventListener('click', () => { const c=$('tourn-code-input').value.trim().toUpperCase(); if(!c) return toast('Enter code'); socket.emit('join_tournament',{code:c}); });
$('tourn-code-input').addEventListener('keydown', e => { if(e.key==='Enter') $('btn-join-tourn').click(); });
$('btn-copy-tourn-code').addEventListener('click', () => { navigator.clipboard.writeText(S.tournamentCode||$('tourn-lobby-code').textContent).then(()=>toast('📋 Copied!')).catch(()=>toast($('tourn-lobby-code').textContent)); });
$('btn-start-tourn').addEventListener('click', () => socket.emit('start_tournament',{code:S.tournamentCode}));
$('btn-tourn-menu').addEventListener('click', () => { hideOv('overlay-tourn-over'); show('screen-menu'); });
$('btn-refresh-public').addEventListener('click', () => socket.emit('list_public_tournaments'));

// Profile / Nickname logic
$('btn-edit-nick').addEventListener('click', () => {
  const row = $('nick-edit-row');
  const visible = row.style.display === 'flex';
  row.style.display = visible ? 'none' : 'flex';
  if (!visible) {
    $('nick-input').value = S.playerData.nickname || '';
    $('nick-input').focus();
    $('nick-input').select();
  }
});
$('btn-save-nick').addEventListener('click', () => {
  const nick = $('nick-input').value.trim();
  if (nick) {
    socket.emit('update_nickname', { nickname: nick });
    $('nick-edit-row').style.display = 'none';
  }
});

// Leaderboard tabs
document.querySelectorAll('.lb-tab').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('.lb-tab').forEach(x=>x.classList.remove('active')); b.classList.add('active'); S.lbPeriod=b.dataset.period; socket.emit('get_leaderboard',{period:S.lbPeriod}); }));

// Friends
$('btn-add-friend-tag').addEventListener('click', () => { 
  const t=$('friend-tag-input').value.trim(); 
  if(!t.includes('#')) return toast('Format: Name#Tag'); 
  socket.emit('add_friend_by_code',{tag:t}); 
  $('friend-tag-input').value=''; 
});
$('friend-tag-input').addEventListener('keydown', e => { if(e.key==='Enter') $('btn-add-friend-tag').click(); });

// Peek close
$('btn-close-peek').addEventListener('click', () => hideOv('overlay-peek'));

// Invite accept/decline
$('btn-accept-invite').addEventListener('click', () => { if(S.currentInviteId) { socket.emit('accept_invite',{inviteId:S.currentInviteId}); hideOv('overlay-invite'); S.currentInviteId=null; } });
$('btn-decline-invite').addEventListener('click', () => { if(S.currentInviteId) { socket.emit('decline_invite',{inviteId:S.currentInviteId}); hideOv('overlay-invite'); S.currentInviteId=null; } });

// Emotes
$('btn-emote').addEventListener('click', () => showOv('overlay-emote'));
$('btn-close-emote').addEventListener('click', () => hideOv('overlay-emote'));
document.querySelectorAll('.emote-btn').forEach(b => {
  b.addEventListener('click', () => {
    socket.emit('send_emote', { emoteName: b.dataset.emote });
    hideOv('overlay-emote');
  });
});

// Google Login Handler
window.handleGoogleLogin = function(response) {
  if (response.credential) {
    const parts = response.credential.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(atob(parts[1]));
        const username = payload.name.slice(0, 20);
        socket.emit('register', { username });
      } catch (e) { toast('Error parsing Google Login'); }
    }
  }
};

// ── Monetization Logic ─────────────────────────────────────────
function showDailyRewardPopup() {
  showOv('modal-daily-reward');
  $('btn-claim-daily').onclick = () => {
    socket.emit('claim_daily_reward');
    hideOv('modal-daily-reward');
  };
}

function showAd(type = 'fixed') {
  // Open the Monetag Direct Link in a new tab
  window.open('https://omg10.com/4/10852230', '_blank');
  
  showOv('overlay-ad');
  let time = 15;
  const timerBig = $('ad-timer-big');
  const timerSmall = $('ad-timer');
  const btnClose = $('btn-ad-close');
  const waitMsg = $('ad-wait-msg');

  if(btnClose) btnClose.classList.add('hidden');
  if(waitMsg) waitMsg.classList.remove('hidden');

  const itv = setInterval(() => {
    time--;
    if (timerBig) timerBig.textContent = time;
    if (timerSmall) timerSmall.textContent = `${time}s`;
    if (time <= 0) {
      clearInterval(itv);
      if (btnClose) btnClose.classList.remove('hidden');
      if (waitMsg) waitMsg.classList.add('hidden');
    }
  }, 1000);

  const closeBtn = $('btn-ad-close');
  if(closeBtn) closeBtn.onclick = () => {
    if (type === 'double') socket.emit('double_reward_ad');
    else socket.emit('claim_ad_reward');
    hideOv('overlay-ad');
  };
}

socket.on('player_data', d => {
  const hadDaily = S.playerData && S.playerData.hasDailyReward;
  S.playerData = d;
  updMenu();
  if (d.hasDailyReward && !hadDaily) showDailyRewardPopup();
});

// ── Init ──────────────────────────────────────────────────────
(function(){ 
  const s=localStorage.getItem('rps_username'); 
  if(s) $('username-input').value=s; 
  
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  if (room && s) {
    // Attempt auto-rejoin
    socket.emit('register', { username: s, rejoinRoom: room });
  }

  show('screen-login'); 
})();
