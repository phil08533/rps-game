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
  tournamentMaxPlayers: 4, activeShopTab: 'cards',
  oppCardCount: 0, activePerksRemaining: [], lbPeriod: 'alltime',
  searching: false, currentInviteId: null, opponentAvatar: null,
};

// ── Card/Perk meta ────────────────────────────────────────────
// ── Card/Perk meta ────────────────────────────────────────────
const CM = {};
if (typeof CONFIG !== 'undefined') {
  for (const [id, c] of Object.entries(CONFIG.BASE_CARDS)) {
    CM[id] = { e: CONFIG.ELEMENTS[c.type].icon, l: c.name, bg: CONFIG.ELEMENTS[c.type].color, c };
  }
}
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
    const metaId = c.cardId || c;
    const m = CM[metaId] || { e: '❓', l: '?' };
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
  // S.myScore/oppScore are now their HP for backwards compat, but we have S.myHp, S.myMaxHp etc.
  if ($('my-hp-text') && S.myHp !== undefined) {
    $('my-hp-text').textContent = `${S.myHp} / ${S.myMaxHp} HP`;
    $('my-hp-bar').style.width = Math.max(0, (S.myHp / S.myMaxHp) * 100) + '%';
    $('my-stam-text').textContent = `${S.myStamina} / ${S.myMaxStamina} STAM`;
    $('my-stam-bar').style.width = Math.max(0, (S.myStamina / S.myMaxStamina) * 100) + '%';
  }
  if ($('opp-hp-text') && S.oppHp !== undefined) {
    $('opp-hp-text').textContent = `${S.oppHp} / ${S.oppMaxHp} HP`;
    $('opp-hp-bar').style.width = Math.max(0, (S.oppHp / S.oppMaxHp) * 100) + '%';
    $('opp-stam-text').textContent = `${S.oppStamina} / ${S.oppMaxStamina} STAM`;
    $('opp-stam-bar').style.width = Math.max(0, (S.oppStamina / S.oppMaxStamina) * 100) + '%';
  }
  // Old score fallback just in case
  if ($('my-score-num')) $('my-score-num').textContent=S.myHp || S.myScore; 
  if ($('opp-score-num')) $('opp-score-num').textContent=S.oppHp || S.oppScore;
  
  if ($('round-label')) $('round-label').textContent=`Round ${S.round} / ${S.maxRounds}`;
  if ($('my-score-name')) $('my-score-name').textContent=S.playerData?.username?.slice(0,8)||'You';
  if ($('opp-name')) $('opp-name').textContent=S.opponentName;
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
      const myId = d.myCard?.cardId || d.myCard;
      const opId = d.opponentCard?.cardId || d.opponentCard;
      myCard.innerHTML = `<span class="card-emoji">${(CM[myId] || { e: '❓' }).e}</span><span class="card-label">${(CM[myId] || { e: '?' }).l}</span>`;
      const opM = opId ? (CM[opId] || { e: '❓' }) : d.opponentPhantom ? { e: '👻', l: 'Hidden' } : { e: '❌', l: 'None' };
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
        S.myHp=d.myHp; S.myMaxHp=d.myMaxHp; S.myStamina=d.myStamina; S.myMaxStamina=d.myMaxStamina;
        S.oppHp=d.oppHp; S.oppMaxHp=d.oppMaxHp; S.oppStamina=d.oppStamina; S.oppMaxStamina=d.oppMaxStamina;
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
  
  // Show Card XP award
  if (d.playerData) {
    toast('⚔️ Your Cards gained XP!');
  }
  // Re-show double reward button if coins were earned
  const dbtn = $('btn-double-reward');
  if (dbtn) dbtn.style.display = d.coinsEarned > 0 ? 'block' : 'none';

  if(d.playerData){S.playerData=d.playerData;updMenu();}
  show('screen-gameover');
}

// ── Shop (RPG Armory) ──────────────────────────────────────────
function renderShop() {
  const p=S.playerData,sh=S.shop; if(!p||!sh) return;
  $('shop-coins').textContent=p.coins;
  const c=$('shop-content'); c.innerHTML='';
  const tab=S.activeShopTab;

  if (tab==='cards') {
    // Card Pack
    const packEl = document.createElement('div'); packEl.className='slot-upgrade-card';
    packEl.innerHTML=`
      <div style="font-size:3rem">🃏</div>
      <h4>Card Pack</h4>
      <p>Open a random spell card to add to your Spell Book.</p>
      <button class="btn btn-primary" data-type="buy-pack" ${p.coins<200?'disabled':''}>Open Pack — 200 🪙</button>
    `;
    c.appendChild(packEl);
    // Show all card types
    const header = document.createElement('h4'); header.className='section-title'; header.style.marginTop='1.5rem'; header.textContent='All Spell Types'; c.appendChild(header);
    if (typeof CONFIG !== 'undefined') {
      Object.entries(CONFIG.BASE_CARDS).forEach(([id, card]) => {
        const elem = CONFIG.ELEMENTS[card.type] || {};
        const el = document.createElement('div'); el.className='shop-item';
        el.innerHTML=`<div class="si-icon" style="background:${elem.color||'#333'};border-radius:8px;padding:4px">${elem.icon||'❓'}</div><div class="si-info"><div class="si-name">${card.name}</div><div class="si-desc">${elem.name||card.type} · ${card.effect||'No special effect'}</div></div><div class="si-action"><span style="font-size:0.75rem;color:var(--muted)">DMG ${card.damage}</span></div>`;
        c.appendChild(el);
      });
    }
  } else if (tab==='runes') {
    if (typeof CONFIG !== 'undefined' && CONFIG.RUNES) {
      Object.entries(CONFIG.RUNES).forEach(([id, rune]) => {
        const el = document.createElement('div'); el.className='shop-item';
        el.innerHTML=`<div class="si-icon">${rune.icon||'💎'}</div><div class="si-info"><div class="si-name">${rune.name}</div><div class="si-desc">${rune.description||''}</div></div><div class="si-action"><button class="btn-buy" data-id="${id}" data-type="buy-rune" ${p.coins<rune.cost?'disabled':''}>${rune.cost} 🪙</button></div>`;
        c.appendChild(el);
      });
    } else {
      c.innerHTML='<p style="color:var(--muted);text-align:center;padding:2rem">Runes coming soon!</p>';
    }
  } else if(tab==='avatars') {
    for (let i = 6; i <= 18; i++) {
      const avatarId = `Char ${i}`;
      const owned = p.unlockedAvatars.includes(avatarId);
      const equipped = p.equippedAvatar === avatarId;
      const cost = sh.avatarCosts?.[avatarId] || 500;
      const el = document.createElement('div'); el.className='shop-item';
      el.innerHTML=`<div class="si-icon"><div class="avatar-display" style="background-image:url('avatars/${avatarId}/sprite.png');transform:scale(0.8)"></div></div><div class="si-info"><div class="si-name">Gladiator ${i}</div></div><div class="si-action">${
        equipped?'<span class="badge-equipped">Equipped</span>'
        :owned?`<button class="btn-buy" data-id="${avatarId}" data-type="equip-avatar">Equip</button>`
        :`<button class="btn-buy" data-id="${avatarId}" data-type="buy-avatar" ${p.coins<cost?'disabled':''}>${cost} 🪙</button>`
      }</div>`;
      c.appendChild(el);
    }
  } else if(tab==='passive-perks'||tab==='active-perks') {
    c.innerHTML='<p style="color:var(--muted);text-align:center;padding:2rem">Perks have been replaced by Runes! Check the Runes tab.</p>';
  }

  c.onclick = e => {
    const b = e.target.closest('[data-type]');
    if (!b || b.disabled) return;
    const t = b.dataset.type, id = b.dataset.id;
    if (t === 'buy-pack') socket.emit('purchase_card_pack');
    if (t === 'buy-rune') socket.emit('purchase_rune', { runeId: id });
    if (t === 'buy-avatar') socket.emit('purchase_avatar', { avatarId: id });
    if (t === 'equip-avatar') socket.emit('equip_avatar', { avatarId: id });
  };
}
// ── Grimoire (Deck Builder & Profile) ──────────────────────────────────
function renderGrimoire() {
  const p = S.playerData; if(!p) return;
  
  // Render Deck
  const dq = $('grim-deck-grid'); dq.innerHTML = '';
  p.deck.forEach((uuid, i) => {
    const cardData = p.collection[uuid];
    if (!cardData) return;
    const base = CONFIG.BASE_CARDS[cardData.cardId] || { name:'Unknown', type:'physical' };
    const meta = CM[cardData.cardId] || { e:'❓', l:'?' };
    const el = document.createElement('div');
    el.className = 'game-card';
    el.innerHTML = `
      <div style="position:absolute; top:4px; right:6px; font-size:0.6rem; color:var(--accent)">Lv.${cardData.level}</div>
      <span class="card-emoji">${meta.e}</span>
      <span class="card-label">${meta.l}</span>
      <div class="card-actions-overlay">
        <button class="btn btn-xs btn-secondary" onclick="socket.emit('move_to_spellbook', { uuid: '${uuid}' })">Unequip</button>
      </div>
      <div style="font-size:0.6rem; color:var(--muted)">XP: ${cardData.xp}/${cardData.level*100}</div>
    `;
    dq.appendChild(el);
  });

  // Render Spell Book
  const sq = $('grim-sb-grid'); sq.innerHTML = '';
  p.spellBook.forEach((uuid) => {
    const cardData = p.collection[uuid];
    if (!cardData) return;
    const meta = CM[cardData.cardId] || { e:'❓', l:'?' };
    const el = document.createElement('div');
    el.className = 'game-card';
    el.innerHTML = `
      <div style="position:absolute; top:4px; right:6px; font-size:0.6rem; color:var(--accent)">Lv.${cardData.level}</div>
      <span class="card-emoji">${meta.e}</span>
      <span class="card-label">${meta.l}</span>
      <div class="card-actions-overlay">
        <button class="btn btn-xs btn-primary" onclick="socket.emit('move_to_deck', { uuid: '${uuid}' })">Equip</button>
      </div>
    `;
    sq.appendChild(el);
  });

  // Render Collection
  const cq = $('grim-col-grid'); cq.innerHTML = '';
  Object.keys(p.collection).forEach((uuid) => {
    if (p.deck.includes(uuid) || p.spellBook.includes(uuid)) return;
    const cardData = p.collection[uuid];
    const meta = CM[cardData.cardId] || { e:'❓', l:'?' };
    const el = document.createElement('div');
    el.className = 'game-card'; el.style.opacity = '0.7';
    el.innerHTML = `
      <div style="position:absolute; top:4px; right:6px; font-size:0.6rem; color:var(--accent)">Lv.${cardData.level}</div>
      <span class="card-emoji">${meta.e}</span>
      <span class="card-label">${meta.l}</span>
      <div class="card-actions-overlay">
        <button class="btn btn-xs btn-primary" onclick="socket.emit('move_to_spellbook', { uuid: '${uuid}' })">Take</button>
      </div>
    `;
    cq.appendChild(el);
  });

  // Render Profile Tab
  setAvatar('prof-avatar-big', p.equippedAvatar, p.username);
  $('prof-avatar-big').style.transform = 'scale(1.5)';
  $('prof-username').textContent=p.nickname || p.username;
  $('prof-tag').textContent=`#${p.friendCode || '000000'}`;
  $('prof-coins').textContent=p.coins; $('prof-wins').textContent=p.wins;
  $('prof-losses').textContent=p.losses;
  $('prof-games').textContent=p.gamesPlayed;
  $('prof-hp').textContent=p.maxHp;
  $('prof-stam').textContent=p.maxStamina;

  const ar=$('prof-avatar-preview'); ar.innerHTML='';
  for (let i = 6; i <= 18; i++) {
    const vid = `Char ${i}`;
    if (!p.unlockedAvatars.includes(vid)) continue;
    const d=document.createElement('div'); d.className='avatar-thumb ' + (p.equippedAvatar===vid?'owned':'locked');
    d.style.backgroundImage=`url("avatars/${vid}/sprite.png")`;
    if(p.equippedAvatar===vid) d.style.borderColor='var(--accent)';
    d.onclick = () => socket.emit('equip_avatar',{avatarId:vid});
    ar.appendChild(d);
  }
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
  // Initialize HP/Stamina
  S.myHp=d.myHp||100; S.myMaxHp=d.myMaxHp||100;
  S.myStamina=d.myStamina||30; S.myMaxStamina=d.myMaxStamina||30;
  S.oppHp=d.oppHp||100; S.oppMaxHp=d.oppMaxHp||100;
  S.oppStamina=d.oppStamina||30; S.oppMaxStamina=d.oppMaxStamina||30;
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
  $('game-status').textContent='Tap a card to play';
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
socket.on('purchase_success', ({playerData}) => { S.playerData=playerData; updMenu(); renderShop(); renderGrimoire(); toast('✅ Done!'); });
socket.on('hand_updated', ({newHand}) => { S.myHand = newHand; renderHand(); });

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
if($('btn-tournament-menu')) $('btn-tournament-menu').addEventListener('click', () => show('screen-tournament'));
$('btn-shop').addEventListener('click', () => { S.activeShopTab='cards'; renderShop(); show('screen-shop'); });
$('btn-grimoire').addEventListener('click', () => { renderGrimoire(); show('screen-grimoire'); });
$('btn-campaign').addEventListener('click', () => { renderCampaign(); show('screen-campaign'); });
$('btn-leaderboard').addEventListener('click', () => { socket.emit('get_leaderboard',{period:S.lbPeriod}); show('screen-leaderboard'); });

// Campaign Stage Renderer
function renderCampaign() {
  const p = S.playerData; if(!p) return;
  const stages = (typeof CONFIG !== 'undefined') ? CONFIG.CAMPAIGN_STAGES : [];
  const list = $('campaign-stages'); if(!list) return;
  list.innerHTML = '';
  const progress = p.campaignProgress || 1;
  stages.forEach((stage, i) => {
    const stageNum = i + 1;
    const isUnlocked = stageNum <= progress;
    const isCurrent = stageNum === progress;
    const isComplete = stageNum < progress;
    const el = document.createElement('div');
    el.style.cssText = `display:flex; align-items:center; gap:1rem; padding:1rem; background:${isUnlocked?'rgba(230,59,26,0.1)':'rgba(255,255,255,0.03)'}; border:1px solid ${isCurrent?'var(--primary)':'rgba(255,255,255,0.1)'}; border-radius:12px; opacity:${isUnlocked?'1':'0.5'}`;
    el.innerHTML = `
      <div style="font-size:2rem">${isComplete?'✅':isCurrent?'⚔️':'🔒'}</div>
      <div style="flex:1; text-align:left">
        <div style="font-weight:700">${stage.name}</div>
        <div style="font-size:0.8rem; color:var(--muted)">${stage.description||''}</div>
      </div>
      <div style="font-size:0.8rem; color:var(--accent)">HP: ${stage.opponentHp||80}</div>
    `;
    list.appendChild(el);
  });
  const currentStage = stages[progress - 1];
  const playBtn = $('btn-campaign-play');
  if (playBtn && currentStage) {
    playBtn.textContent = `⚔️ Fight: ${currentStage.name}`;
    playBtn.onclick = () => socket.emit('play_campaign_stage', { stageIndex: progress - 1 });
  }
}

// Grimoire Tabs Logic
document.querySelectorAll('#screen-grimoire .tab-btn').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#screen-grimoire .tab-btn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    $('grim-deck-view').style.display = 'none';
    $('grim-sb-view').style.display = 'none';
    $('grim-prof-view').style.display = 'none';
    if(b.dataset.tab === 'deck') $('grim-deck-view').style.display = 'block';
    if(b.dataset.tab === 'spellbook') $('grim-sb-view').style.display = 'block';
    if(b.dataset.tab === 'my-profile') $('grim-prof-view').style.display = 'block';
  });
});
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
