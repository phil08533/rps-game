const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(express.static(__dirname));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── Stores ────────────────────────────────────────────────────
const fs = require('fs');

const DB_FILE = path.join(__dirname, 'database.json');
let players     = {};
let monthlyWins = {};   // username → { count, month }
let friends     = {};   // username → Set/Array of friend usernames

const BLACKLIST = ['admin', 'moderator', 'server', 'system', 'root', 'staff', 'owner', 'official'];
// You can add more offensive words here

function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      players = data.players || {};
      friends = data.friends || {};
      dailyWins = data.dailyWins || {};
      monthlyWins = data.monthlyWins || {};
    } catch (e) {
      console.error('Error loading DB', e);
    }
  }
}
function saveDB() {
  // Don't save data for guests
  const persistentPlayers = {};
  for (const [uname, data] of Object.entries(players)) {
    if (!uname.startsWith('Guest_')) {
      persistentPlayers[uname] = data;
    }
  }
  fs.writeFileSync(DB_FILE, JSON.stringify({ players: persistentPlayers, friends, dailyWins, monthlyWins }), 'utf8');
}
loadDB();
setInterval(saveDB, 15000); // Save every 15 seconds

const rooms       = {};
const tournaments = {};
const matchQueue  = [];   // [{ socketId, username, wins }]
const pendingInvites = {}; // inviteId → { from, to, roomCode }
const disconnectTimeouts = new Map(); // username → setTimeout ID

const CONFIG = require('./shared_config.js');

// ── Constants ─────────────────────────────────────────────────
const CARDS = Object.keys(CONFIG.BASE_CARDS);
const PERKS = {
  // ── PASSIVE (always active while equipped) ──
  lucky_draw:  { id:'lucky_draw',  name:'Lucky Draw',   type:'passive', cost:150,  description:'Ticker always gives 1–2 cards (never 0)', icon:'🍀' },
  coin_boost:  { id:'coin_boost',  name:'Coin Boost',   type:'passive', cost:200,  description:'Earn 50% more coins per game', icon:'💰' },
  big_hand:    { id:'big_hand',    name:'Big Hand',      type:'passive', cost:300,  description:'Ticker can give up to 4 cards', icon:'🖐️' },
  thick_skin:  { id:'thick_skin',  name:'Thick Skin',   type:'passive', cost:250,  description:'On tie rounds, draw 1 extra card', icon:'🛡️' },
  scavenger:   { id:'scavenger',   name:'Scavenger',    type:'passive', cost:200,  description:'Double coins earned from losses', icon:'🦝' },
  momentum:    { id:'momentum',    name:'Momentum',     type:'passive', cost:350,  description:'Each consecutive win gives +1 ticker card', icon:'🔥' },
  recycler:    { id:'recycler',    name:'Recycler',     type:'passive', cost:280,  description:'Losing cards have 40% chance of returning to hand', icon:'♻️' },
  hoarder:     { id:'hoarder',     name:'Hoarder',      type:'passive', cost:320,  description:'Start each game with 5 cards instead of 3', icon:'📦' },

  // ── ACTIVE (use once per game, consumed on use) ──
  steal:       { id:'steal',       name:'Steal Round',  type:'active',  cost:400,  description:'If you lose this round, steal the win instead', icon:'🥷' },
  shield:      { id:'shield',      name:'Shield',       type:'active',  cost:500,  description:'Block opponent\'s card — auto-win the round', icon:'🛡️' },
  double_down: { id:'double_down', name:'Double Down',  type:'active',  cost:350,  description:'Win this round = +2 points instead of 1', icon:'⚡' },
  peek:        { id:'peek',        name:'Peek',         type:'active',  cost:300,  description:'See opponent\'s hand before playing this round', icon:'👁️' },
  card_thief:  { id:'card_thief',  name:'Card Thief',   type:'active',  cost:400,  description:'Win this round = steal a random card from opponent', icon:'🃏' },
  mirror:      { id:'mirror',      name:'Mirror',       type:'active',  cost:250,  description:'Force a tie — both cards return to hand', icon:'🪞' },
  sabotage:    { id:'sabotage',    name:'Sabotage',     type:'active',  cost:300,  description:'Opponent gets 0 cards from ticker this round', icon:'💣' },
  wildcard:    { id:'wildcard',    name:'Wildcard',     type:'active',  cost:600,  description:'Your card beats anything this round', icon:'🌟' },
  reroll:      { id:'reroll',      name:'Reroll',       type:'active',  cost:200,  description:'Discard your hand and draw 3 fresh cards', icon:'🎲' },
  freeze:      { id:'freeze',      name:'Freeze',       type:'active',  cost:350,  description:'Opponent must play their leftmost card this round', icon:'🧊' },
  encore:      { id:'encore',      name:'Encore',       type:'active',  cost:450,  description:'Play the round again with the same cards if you lose', icon:'🔁' },
  phantom:     { id:'phantom',     name:'Phantom',      type:'active',  cost:500,  description:'Your card is hidden from the round result reveal', icon:'👻' },
};

const SKINS = {
  neon:   { id:'neon',   name:'Neon',   cost:200, description:'Electric neon glow' },
  fire:   { id:'fire',   name:'Fire',   cost:300, description:'Blazing flame style' },
  galaxy: { id:'galaxy', name:'Galaxy', cost:400, description:'Deep space theme' },
  gold:   { id:'gold',   name:'Gold',   cost:500, description:'Luxury golden finish' },
  ice:    { id:'ice',    name:'Ice',    cost:350, description:'Frozen crystal cards' },
  shadow: { id:'shadow', name:'Shadow', cost:450, description:'Dark void aesthetic' },
  rainbow:{ id:'rainbow',name:'Rainbow',cost:600, description:'Prismatic shifting colors' },
};

// Slot upgrade costs: slot 2, 3, 4, 5
const SLOT_COSTS = [0, 0, 500, 1500, 5000, 15000];
// Index 0,1 = free (everyone starts with 1 slot, index 0 unused), slot 2 = 500, etc.

// ── Helpers ───────────────────────────────────────────────────
function genCode(len = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
const AVATAR_COSTS = {};
for (let i = 6; i <= 18; i++) AVATAR_COSTS[`Char ${i}`] = 500 + (Math.floor(i / 3) * 200);

function getShopData() {
  return { 
    runes: CONFIG.RUNES, 
    cardPackCost: 200, 
    avatarCosts: AVATAR_COSTS 
  };
}
function uniqueRoom()       { let c; do { c = genCode(4);     } while (rooms[c]);       return c; }
function uniqueTournament() { let c; do { c = 'T'+genCode(4); } while (tournaments[c]); return c; }

function generateId() { return Math.random().toString(36).substr(2, 9); }

function getPlayer(username) {
  if (!players[username]) {
    const defaultDeckIds = [generateId(), generateId(), generateId(), generateId()];
    players[username] = {
      username, coins: 50,
      unlockedSkins: ['classic'], equippedSkin: 'classic',
      unlockedPerks: [], equippedPerks: [], perkSlots: 1,
      unlockedAvatars: ['Char 1', 'Char 2', 'Char 3', 'Char 4', 'Char 5'],
      equippedAvatar: 'Char 1',
      wins: 0, losses: 0, ties: 0, gamesPlayed: 0,
      friendCode: Math.floor(100000 + Math.random() * 900000).toString(),
      nickname: username.slice(0, 15),
      lastDailyRewardDate: '',
      // RPG properties
      level: 1, xp: 0, maxHp: 100, maxStamina: 30,
      campaignProgress: 1,
      collection: {
        [defaultDeckIds[0]]: { cardId: 'water_splash', xp: 0, level: 1, runes: [] },
        [defaultDeckIds[1]]: { cardId: 'fire_punch', xp: 0, level: 1, runes: [] },
        [defaultDeckIds[2]]: { cardId: 'rock_throw', xp: 0, level: 1, runes: [] },
        [defaultDeckIds[3]]: { cardId: 'wind_slash', xp: 0, level: 1, runes: [] },
      },
      deck: defaultDeckIds,
      spellBook: []
    };
  }
  // Data migration for old accounts
  let p = players[username];
  if (!p.unlockedAvatars) { p.unlockedAvatars = ['Char 1', 'Char 2', 'Char 3', 'Char 4', 'Char 5']; p.equippedAvatar = 'Char 1'; }
  if (!p.friendCode || p.friendCode.length < 6) { p.friendCode = Math.floor(100000 + Math.random() * 900000).toString(); p.nickname = username.slice(0, 15); }
  if (p.lastDailyRewardDate === undefined) p.lastDailyRewardDate = '';
  
  if (p.level === undefined) {
    const defaultDeckIds = [generateId(), generateId(), generateId(), generateId()];
    p.level = 1; p.xp = 0; p.maxHp = 100; p.maxStamina = 30; p.campaignProgress = 1;
    p.collection = {
      [defaultDeckIds[0]]: { cardId: 'water_splash', xp: 0, level: 1, runes: [] },
      [defaultDeckIds[1]]: { cardId: 'fire_punch', xp: 0, level: 1, runes: [] },
      [defaultDeckIds[2]]: { cardId: 'rock_throw', xp: 0, level: 1, runes: [] },
      [defaultDeckIds[3]]: { cardId: 'wind_slash', xp: 0, level: 1, runes: [] }
    };
    p.deck = defaultDeckIds; p.spellBook = [];
  }
  return p;
}

function trackWin(username) {
  const today = new Date().toISOString().slice(0,10);
  const month = new Date().toISOString().slice(0,7);
  if (!dailyWins[username] || dailyWins[username].date !== today) dailyWins[username] = { count: 0, date: today };
  dailyWins[username].count++;
  if (!monthlyWins[username] || monthlyWins[username].month !== month) monthlyWins[username] = { count: 0, month };
  monthlyWins[username].count++;
}

function getLeaderboard(period) {
  const all = Object.values(players);
  if (period === 'daily') {
    const today = new Date().toISOString().slice(0,10);
    return all.filter(p => dailyWins[p.username]?.date === today && dailyWins[p.username]?.count > 0)
      .map(p => ({ username: p.username, value: dailyWins[p.username].count }))
      .sort((a,b) => b.value - a.value).slice(0, 50);
  }
  if (period === 'monthly') {
    const month = new Date().toISOString().slice(0,7);
    return all.filter(p => monthlyWins[p.username]?.month === month && monthlyWins[p.username]?.count > 0)
      .map(p => ({ username: p.username, value: monthlyWins[p.username].count }))
      .sort((a,b) => b.value - a.value).slice(0, 50);
  }
  // alltime
  return all.filter(p => p.wins > 0)
    .map(p => ({ username: p.username, value: p.wins }))
    .sort((a,b) => b.value - a.value).slice(0, 50);
}

function hasPerk(username, perkId) {
  return getPlayer(username).equippedPerks.includes(perkId);
}
function hasPassive(username, perkId) {
  const p = getPlayer(username);
  return p.equippedPerks.includes(perkId) && PERKS[perkId]?.type === 'passive';
}

// ── Helper Battle Setup ──
function dealHand(username) {
  const p = getPlayer(username);
  const hand = [];
  const deckSize = p.deck?.length || 0;
  for (let i = 0; i < 5; i++) {
    if (deckSize > 0) {
      const uuid = p.deck[Math.floor(Math.random() * deckSize)];
      const cardData = p.collection[uuid];
      hand.push({ uuid, cardId: cardData.cardId });
    } else {
      hand.push({ uuid: 'starter_' + i, cardId: 'water_splash' }); // Fallback
    }
  }
  return hand;
}

// ── Room ──────────────────────────────────────────────────────
function makeRoom(hostId, hostName) {
  const code = uniqueRoom();
  const hp1 = getPlayer(hostName).maxHp || 100;
  const stam1 = getPlayer(hostName).maxStamina || 30;
  rooms[code] = {
    code, state: 'waiting',
    players: [{
      socketId: hostId, username: hostName,
      hand: dealHand(hostName), 
      hp: hp1, maxHp: hp1,
      stamina: stam1, maxStamina: stam1,
      playedCard: null, playedIndex: -1,
      winStreak: 0,
    }],
    round: 1, history: [],
    tournamentCode: null, tournamentMatchIdx: null,
  };
  return rooms[code];
}

// ── Round Processing ──────────────────────────────────────────
function processRound(room) {
  const [p1, p2] = room.players;
  let c1 = p1.playedCard, c2 = p2.playedCard;
  let msg1 = [], msg2 = [];

  // Parse cards
  const id1 = c1?.cardId || c1; // handle legacy or object
  const id2 = c2?.cardId || c2;
  const card1 = id1 ? CONFIG.BASE_CARDS[id1] : null;
  const card2 = id2 ? CONFIG.BASE_CARDS[id2] : null;

  // Consume stamina
  if (card1) p1.stamina = Math.max(0, p1.stamina - card1.cost);
  if (card2) p2.stamina = Math.max(0, p2.stamina - card2.cost);

  let dmg1 = card1 ? card1.baseDmg : 0;
  let blk1 = card1 ? card1.baseBlock : 0;
  let dmg2 = card2 ? card2.baseDmg : 0;
  let blk2 = card2 ? card2.baseBlock : 0;

  // Elemental Multipliers
  let mult1 = 1.0, mult2 = 1.0;
  if (card1 && card2) {
    const el1 = CONFIG.ELEMENTS[card1.type];
    const el2 = CONFIG.ELEMENTS[card2.type];
    if (el1.strongAgainst.includes(card2.type)) mult1 += 0.5;
    if (el1.weakAgainst.includes(card2.type)) mult1 -= 0.5;
    if (el2.strongAgainst.includes(card1.type)) mult2 += 0.5;
    if (el2.weakAgainst.includes(card1.type)) mult2 -= 0.5;
  }

  // Calculate actual damage
  let finalDmg1 = Math.max(0, Math.floor(dmg1 * mult1) - blk2);
  let finalDmg2 = Math.max(0, Math.floor(dmg2 * mult2) - blk1);

  // Apply damage
  p2.hp = Math.max(0, p2.hp - finalDmg1);
  p1.hp = Math.max(0, p1.hp - finalDmg2);

  // Special effects (Healing, etc)
  if (card1 && card1.effect === 'heal') { p1.hp = Math.min(p1.maxHp, p1.hp + card1.effectValue); msg1.push(`Healed for ${card1.effectValue} HP!`); }
  if (card2 && card2.effect === 'heal') { p2.hp = Math.min(p2.maxHp, p2.hp + card2.effectValue); msg2.push(`Healed for ${card2.effectValue} HP!`); }

  if (card1 && card1.effect === 'drain_stamina') { p2.stamina = Math.max(0, p2.stamina - card1.effectValue); msg1.push(`Drained ${card1.effectValue} Stamina!`); }
  if (card2 && card2.effect === 'drain_stamina') { p1.stamina = Math.max(0, p1.stamina - card2.effectValue); msg2.push(`Drained ${card2.effectValue} Stamina!`); }

  // Restock 1 card to maintain hand, regen stamina
  if (c1) p1.hand.push(dealHand(p1.username)[0]);
  if (c2) p2.hand.push(dealHand(p2.username)[0]);

  p1.stamina = Math.min(p1.maxStamina, p1.stamina + 10); // passive regen
  p2.stamina = Math.min(p2.maxStamina, p2.stamina + 10);

  // Reset play state
  p1.playedCard = null; p1.playedIndex = -1;
  p2.playedCard = null; p2.playedIndex = -1;

  // Determine game over
  const gameOver = p1.hp <= 0 || p2.hp <= 0;
  
  if (gameOver) {
    finishGame(room, 0, 0, null, [], false, false);
    return;
  }

  room.round++;

  // Emit Result
  [p1, p2].forEach((p, idx) => {
    const opp = idx === 0 ? p2 : p1;
    const myCard = idx === 0 ? c1 : c2;
    const opCard = idx === 0 ? c2 : c1;
    const myMsg = idx === 0 ? msg1 : msg2;
    const oppMsg = idx === 0 ? msg2 : msg1;
    const myDmg = idx === 0 ? finalDmg1 : finalDmg2;

    io.to(p.socketId).emit('round_result', {
      myCard: (idx === 0 ? c1 : c2)?.cardId || (idx === 0 ? c1 : c2), 
      opponentCard: (idx === 0 ? c2 : c1)?.cardId || (idx === 0 ? c2 : c1), 
      result: 'resolved', 
      myScore: p.hp, opponentScore: opp.hp, // sending hp in score fields for legacy compat
      myHp: p.hp, myMaxHp: p.maxHp, myStamina: p.stamina, myMaxStamina: p.maxStamina,
      oppHp: opp.hp, oppMaxHp: opp.maxHp, oppStamina: opp.stamina, oppMaxStamina: opp.maxStamina,
      myDraw: 1, newHand: [...p.hand], opponentCardCount: opp.hand.length,
      round: room.round, maxRounds: '∞',
      myPerkMessages: myMsg, oppPerkMessages: oppMsg,
      damageDealt: myDmg
    });
  });
}

function getFormattedPlayerData(pd) {
  // We can format if needed, but returning pd entirely is fine right now
  return pd;
}

function finishGame(room, draw1, draw2, reason, perkMessages, p1Phantom, p2Phantom) {
  room.state = 'finished';
  const [p1, p2] = room.players;
  let winner = null;
  if (p1.hp > 0 && p2.hp <= 0) winner = p1.username;
  else if (p2.hp > 0 && p1.hp <= 0) winner = p2.username;

  if (room.tournamentCode) {} // Ignore tournaments for now

  [p1, p2].forEach((p, idx) => {
    const opp   = idx === 0 ? p2 : p1;
    const isWin = winner === p.username, isTie = winner === null;
    const isLoss = !isWin && !isTie;
    let baseCoins  = reason === 'disconnect' ? 50 : isWin ? 100 : isTie ? 50 : 25;
    let baseXP = isWin ? 50 : 15;
    if (room.isBot) { baseCoins = isWin ? 50 : 10; baseXP = isWin ? 25 : 5; } // Bot matches reward less
    
    // XP and Coins
    const pd = getPlayer(p.username);
    pd.coins += baseCoins;
    
    if (p.socketId !== 'BOT') {
      pd.xp += baseXP;
      if (pd.xp >= pd.level * 100) {
        pd.level++;
        pd.xp = 0;
        pd.maxHp += 10;
        pd.maxStamina += 5;
      }
      if (isWin) { pd.wins++; trackWin(p.username); } else if (isLoss) pd.losses++; else pd.ties++;

      // Award XP to cards in the final hand + played cards
      // Simplified: give XP to everything in the active deck
      pd.deck.forEach(uuid => {
        const card = pd.collection[uuid];
        if (card) {
          card.xp += isWin ? 20 : 5;
          if (card.xp >= card.level * 100) {
            card.level++;
            card.xp = 0;
          }
        }
      });
    }
    pd.gamesPlayed++;
    const s = Array.from(io.sockets.sockets.values()).find(so => so.socketId === p.socketId);
    if (s) s.lastMatchCoins = baseCoins;

    // Campaign Progression
    if (room.isCampaign && isWin) {
      if (pd.campaignProgress === room.campaignStageIndex + 1) {
        pd.campaignProgress++;
      }
    }

    io.to(p.socketId).emit('game_over', {
      winner, reason: reason || null,
      myScore: p.hp, opponentScore: opp.hp,
      coinsEarned: baseCoins,
      xpEarned: baseXP,
      playerData: getFormattedPlayerData(pd),
      myPerkMessages: [],
    });
  });
  setTimeout(() => { delete rooms[room.code]; }, 60000);
}

// ── Tournament ────────────────────────────────────────────────
function onTournamentMatchEnd(room, winnerUsername) {
  const t = tournaments[room.tournamentCode];
  if (!t) return;
  const match = t.bracket[t.currentRound]?.[room.tournamentMatchIdx];
  if (!match) return;
  match.winner = winnerUsername; match.done = true;
  const currentRound = t.bracket[t.currentRound];
  if (!currentRound.every(m => m.done)) return;
  const winners = currentRound.map(m => m.winner).filter(Boolean);
  if (winners.length <= 1) { endTournament(t, winners[0] || currentRound[0].winner); return; }
  const nextRound = [];
  for (let i = 0; i < winners.length; i += 2) {
    if (winners[i+1]) nextRound.push({ p1: winners[i], p2: winners[i+1], winner: null, done: false, roomCode: null });
    else nextRound.push({ p1: winners[i], p2: null, winner: winners[i], done: true, roomCode: null });
  }
  t.bracket.push(nextRound);
  t.currentRound++;
  startTournamentRound(t);
}

function startTournamentRound(t) {
  t.bracket[t.currentRound].forEach((match, idx) => {
    if (match.done) return;
    const p1E = t.players.find(p => p.username === match.p1);
    const p2E = t.players.find(p => p.username === match.p2);
    if (!p1E || !p2E) return;
    const s1 = io.sockets.sockets.get(p1E.socketId);
    const s2 = io.sockets.sockets.get(p2E.socketId);
    if (!s1 || !s2) return;
    const room = makeRoom(p1E.socketId, match.p1);
    room.players.push({
      socketId: p2E.socketId, username: match.p2,
      hand: dealHand(match.p2), score: 0, playedCard: null, playedIndex: -1,
      activePerkThisRound: null, activePerksUsedThisGame: [], winStreak: 0,
    });
    room.state = 'playing'; room.tournamentCode = t.code; room.tournamentMatchIdx = idx;
    match.roomCode = room.code;
    s1.join(room.code); s2.join(room.code);
    s1.currentRoom = room.code; s2.currentRoom = room.code;
    [p1E, p2E].forEach((pe, pIdx) => {
      const sock = io.sockets.sockets.get(pe.socketId);
      const opp = pIdx === 0 ? p2E : p1E;
      if (sock) sock.emit('game_start', {
        room: room.code, myIndex: pIdx, myHand: room.players[pIdx].hand,
        opponentName: opp.username, opponentCardCount: room.players[pIdx===0?1:0].hand.length,
        round: 1, maxRounds: 7, isTournament: true, tournamentCode: t.code,
        activePerksRemaining: getActivePerksRemaining(room.players[pIdx]),
      });
    });
  });
  io.to(t.code).emit('tournament_round_start', { round: t.currentRound + 1, bracket: t.bracket });
}

function endTournament(t, champion) {
  t.state = 'complete'; t.champion = champion;
  const pool = t.prizePool;
  const finalMatch = t.bracket[t.bracket.length - 1][0];
  const runnerUp = finalMatch.p1 === champion ? finalMatch.p2 : finalMatch.p1;
  const firstPrize = Math.floor(pool * 0.70), secondPrize = Math.floor(pool * 0.30);
  if (champion) { getPlayer(champion).coins += firstPrize; const cs = t.players.find(p => p.username === champion); if (cs) io.to(cs.socketId).emit('tournament_over', { champion, tournamentCoinsEarned: firstPrize, placement: 1, bracket: t.bracket }); }
  if (runnerUp) { getPlayer(runnerUp).coins += secondPrize; const rs = t.players.find(p => p.username === runnerUp); if (rs) io.to(rs.socketId).emit('tournament_over', { champion, tournamentCoinsEarned: secondPrize, placement: 2, bracket: t.bracket }); }
  t.players.filter(p => p.username !== champion && p.username !== runnerUp).forEach(pe => { io.to(pe.socketId).emit('tournament_over', { champion, tournamentCoinsEarned: 0, placement: null, bracket: t.bracket }); });
  setTimeout(() => { delete tournaments[t.code]; }, 300000);
}

function kickOffTournament(t) {
  t.state = 'active';
  const shuffled = [...t.players].sort(() => Math.random() - 0.5);
  const round0 = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    if (shuffled[i+1]) round0.push({ p1: shuffled[i].username, p2: shuffled[i+1].username, winner: null, done: false, roomCode: null });
    else round0.push({ p1: shuffled[i].username, p2: null, winner: shuffled[i].username, done: true, roomCode: null });
  }
  t.bracket.push(round0); t.currentRound = 0;
  io.to(t.code).emit('tournament_started', { tournament: t });
  startTournamentRound(t);
}

// ── Socket ────────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('register', ({ username, rejoinRoom }) => {
    if (!username || username.length < 2 || username.length > 20) return socket.emit('error', { message: 'Username must be 2–20 characters' });
    const u = username.trim().toLowerCase();
    if (BLACKLIST.some(b => u.includes(b))) return socket.emit('error', { message: 'That username is restricted.' });
    
    const pd = getPlayer(username.trim());
    socket.username = pd.username;

    // Handle re-joining
    if (rejoinRoom && rooms[rejoinRoom]) {
      const room = rooms[rejoinRoom];
      const playerIdx = room.players.findIndex(p => p.username === socket.username);
      if (playerIdx !== -1) {
        // Cancel disconnect timeout if any
        if (disconnectTimeouts.has(socket.username)) {
          clearTimeout(disconnectTimeouts.get(socket.username));
          disconnectTimeouts.delete(socket.username);
        }
        
        // Update socket mapping
        room.players[playerIdx].socketId = socket.id;
        socket.currentRoom = rejoinRoom;
        socket.join(rejoinRoom);
        
        // Sync state back to client
        const opp = room.players[1 - playerIdx];
        socket.emit('game_start', {
          room: room.code, myIndex: playerIdx, myHand: [...room.players[playerIdx].hand],
          opponentName: opp.username, opponentCardCount: opp.hand.length,
          opponentAvatar: opp.avatar,
          myScore: room.players[playerIdx].score, opponentScore: opp.score,
          round: room.round, played: room.players[playerIdx].playedCard !== null
        });
        
        console.log(`📡 Player ${socket.username} re-joined room ${rejoinRoom}`);
      }
    }

    emitPlayerData(socket);
  });

    socket.on('send_emote', ({ emoteName }) => {
    const roomCode = socket.currentRoom;
    if (roomCode && rooms[roomCode]) {
      const room = rooms[roomCode];
      io.to(roomCode).emit('play_emote', { username: socket.username, emoteName });
    }
  });

  // ── Quick Play / Bot ──
  socket.on('create_room', () => {
    if (!socket.username) return socket.emit('error', { message: 'Not registered' });
    const room = makeRoom(socket.id, socket.username);
    socket.join(room.code); socket.currentRoom = room.code;
    socket.emit('room_created', { code: room.code });
  });

  socket.on('play_vs_bot', () => {
    if (!socket.username) return socket.emit('error', { message: 'Not registered' });
    const room = makeRoom(socket.id, socket.username);
    room.isBot = true;
    room.players.push({
      socketId: 'BOT', username: 'Gladiator Bot', avatar: `Char ${Math.floor(Math.random() * 18) + 1}`,
      hand: dealHand('BOT'), score: 0, hp: 80, maxHp: 80, stamina: 30, maxStamina: 30,
      playedCard: null, playedIndex: -1, winStreak: 0,
    });
    room.state = 'playing';
    socket.join(room.code); socket.currentRoom = room.code;
    
    // Start game right away
    const p0 = room.players[0];
    io.to(socket.id).emit('game_start', {
      room: room.code, myIndex: 0, myHand: [...p0.hand],
      opponentName: room.players[1].username, opponentCardCount: room.players[1].hand.length,
      opponentAvatar: room.players[1].avatar,
      round: 1, maxRounds: '∞', isTournament: false,
      myHp: p0.hp, myMaxHp: p0.maxHp, myStamina: p0.stamina, myMaxStamina: p0.maxStamina,
      oppHp: room.players[1].hp, oppMaxHp: room.players[1].maxHp,
      activePerksRemaining: [],
    });
  });

  socket.on('play_campaign_stage', ({ stageIndex }) => {
    if (!socket.username) return socket.emit('error', { message: 'Not registered' });
    const stage = CONFIG.CAMPAIGN_STAGES[stageIndex];
    if (!stage) return socket.emit('error', { message: 'Invalid stage' });
    const p = getPlayer(socket.username);
    if ((p.campaignProgress || 1) < stageIndex + 1) return socket.emit('error', { message: 'Stage locked' });
    const room = makeRoom(socket.id, socket.username);
    room.isBot = true; room.isCampaign = true; room.campaignStageIndex = stageIndex;
    room.players.push({
      socketId: 'BOT', username: stage.enemy, avatar: `Char ${6 + stageIndex}`,
      hand: stage.deck, score: 0, hp: stage.hp, maxHp: stage.hp, stamina: stage.stamina, maxStamina: stage.stamina,
      playedCard: null, playedIndex: -1, winStreak: 0,
    });
    room.state = 'playing';
    socket.join(room.code); socket.currentRoom = room.code;
    const p0 = room.players[0];
    io.to(socket.id).emit('game_start', {
      room: room.code, myIndex: 0, myHand: [...p0.hand],
      opponentName: stage.enemy, opponentCardCount: room.players[1].hand.length,
      opponentAvatar: room.players[1].avatar,
      round: 1, maxRounds: '∞', isTournament: false, isCampaign: true,
      myHp: p0.hp, myMaxHp: p0.maxHp, myStamina: p0.stamina, myMaxStamina: p0.maxStamina,
      oppHp: room.players[1].hp, oppMaxHp: room.players[1].maxHp,
      activePerksRemaining: [],
    });
  });

  // ── Matchmaking ──
  socket.on('find_match', () => {
    if (!socket.username) return socket.emit('error', { message: 'Not registered' });
    // Don't double-queue
    if (matchQueue.find(q => q.socketId === socket.id)) return socket.emit('error', { message: 'Already searching' });
    const pd = getPlayer(socket.username);
    const entry = { socketId: socket.id, username: socket.username, wins: pd.wins };

    // Try to find a match with similar skill
    let bestIdx = -1, bestDiff = Infinity;
    for (let i = 0; i < matchQueue.length; i++) {
      if (matchQueue[i].username === socket.username) continue;
      const diff = Math.abs(matchQueue[i].wins - pd.wins);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }

    // Accept match if diff is within 20 wins, or if the other player has waited (any match)
    if (bestIdx >= 0) {
      const opponent = matchQueue.splice(bestIdx, 1)[0];
      const oppSock = io.sockets.sockets.get(opponent.socketId);
      if (!oppSock) { matchQueue.push(entry); socket.emit('match_searching'); return; }

      // Create room and start game
      const room = makeRoom(socket.id, socket.username);
      room.players.push({
        socketId: opponent.socketId, username: opponent.username, avatar: getPlayer(opponent.username).equippedAvatar,
        hand: dealHand(opponent.username), score: 0,
        playedCard: null, playedIndex: -1,
        activePerkThisRound: null, activePerksUsedThisGame: [], winStreak: 0,
      });
      room.state = 'playing';
      socket.join(room.code); oppSock.join(room.code);
      socket.currentRoom = room.code; oppSock.currentRoom = room.code;
      room.players.forEach((p, idx) => {
        const opp = room.players[idx === 0 ? 1 : 0];
        const oppNick = getPlayer(opp.username).nickname || opp.username;
        io.to(p.socketId).emit('game_start', {
          room: room.code, myIndex: idx, myHand: [...p.hand],
          opponentName: oppNick, opponentUsername: opp.username, opponentCardCount: opp.hand.length,
          opponentAvatar: opp.avatar,
          round: 1, maxRounds: '∞', isTournament: false,
          myHp: p.hp, myMaxHp: p.maxHp, myStamina: p.stamina, myMaxStamina: p.maxStamina,
          oppHp: opp.hp, oppMaxHp: opp.maxHp,
          activePerksRemaining: [],
        });
      });
    } else {
      matchQueue.push(entry);
      socket.emit('match_searching');
    }
  });

  socket.on('cancel_match', () => {
    const idx = matchQueue.findIndex(q => q.socketId === socket.id);
    if (idx >= 0) matchQueue.splice(idx, 1);
    socket.emit('match_cancelled');
  });

  // ── Friend Invites ──
  socket.on('invite_friend', ({ friendName }) => {
    if (!socket.username) return socket.emit('error', { message: 'Not registered' });
    if (friendName === socket.username) return socket.emit('error', { message: 'Cannot invite yourself' });
    // Find their socket
    let targetSock = null;
    for (const [, s] of io.sockets.sockets) {
      if (s.username === friendName) { targetSock = s; break; }
    }
    if (!targetSock) return socket.emit('error', { message: `${friendName} is not online` });

    // Create room and wait
    const room = makeRoom(socket.id, socket.username);
    socket.join(room.code); socket.currentRoom = room.code;

    const inviteId = 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    pendingInvites[inviteId] = { from: socket.username, fromNick: getPlayer(socket.username).nickname, to: friendName, roomCode: room.code, fromSocketId: socket.id };

    targetSock.emit('game_invite', { inviteId, from: pendingInvites[inviteId].fromNick });
    socket.emit('room_created', { code: room.code, inviteSent: friendName });

    // Expire after 60s
    setTimeout(() => { delete pendingInvites[inviteId]; }, 60000);
  });

  // ── Social / Friends Management ──
  socket.on('update_nickname', ({ nickname }) => {
    if (!socket.username) return;
    const nick = nickname.trim();
    if (nick.length < 2) return socket.emit('error', { message: 'Nickname too short' });
    if (BLACKLIST.some(b => nick.toLowerCase().includes(b))) return socket.emit('error', { message: 'That nickname is restricted.' });
    
    const pd = getPlayer(socket.username);
    pd.nickname = nick.slice(0, 15);
    socket.emit('registered', { playerData: pd, shop: getShopData() });
    saveDB();
  });

  socket.on('add_friend_by_code', ({ tag }) => {
    if (!socket.username) return;
    // tag format: Name#1234
    const [nick, code] = tag.split('#');
    if (!nick || !code) return socket.emit('error', { message: 'Use Format: Name#1234' });
    const target = Object.values(players).find(p => p.nickname.toLowerCase() === nick.toLowerCase() && p.friendCode === code);
    if (!target) return socket.emit('error', { message: 'Player not found' });
    if (target.username === socket.username) return socket.emit('error', { message: 'Cannot add yourself' });
    
    if (!friends[socket.username]) friends[socket.username] = [];
    if (!friends[socket.username].includes(target.username)) {
      friends[socket.username].push(target.username);
      saveDB();
    }
    socket.emit('friends_list', { friends: getFriendsList(socket.username) });
    socket.emit('toast', { message: `Added ${target.nickname} to friends!` });
  });

  socket.on('add_friend_by_username', ({ username }) => {
    if (!socket.username || !players[username]) return;
    if (username === socket.username) return;
    if (!friends[socket.username]) friends[socket.username] = [];
    if (!friends[socket.username].includes(username)) {
      friends[socket.username].push(username);
      saveDB();
    }
    socket.emit('friends_list', { friends: getFriendsList(socket.username) });
    socket.emit('toast', { message: `Friend added!` });
  });

  socket.on('remove_friend', ({ username }) => {
    if (!socket.username || !friends[socket.username]) return;
    friends[socket.username] = friends[socket.username].filter(u => u !== username);
    saveDB();
    socket.emit('friends_list', { friends: getFriendsList(socket.username) });
  });

  socket.on('accept_invite', ({ inviteId }) => {
    const inv = pendingInvites[inviteId];
    if (!inv) return socket.emit('error', { message: 'Invite expired' });
    if (inv.to !== socket.username) return socket.emit('error', { message: 'Not your invite' });
    delete pendingInvites[inviteId];
    // Join the room
    const room = rooms[inv.roomCode];
    if (!room || room.state !== 'waiting') return socket.emit('error', { message: 'Room no longer available' });
    const pd2 = getPlayer(socket.username);
    const hp2 = pd2.maxHp || 100; const stam2 = pd2.maxStamina || 30;
    room.players.push({
      socketId: socket.id, username: socket.username,
      hand: dealHand(socket.username), score: 0,
      hp: hp2, maxHp: hp2, stamina: stam2, maxStamina: stam2,
      playedCard: null, playedIndex: -1, winStreak: 0,
    });
    socket.join(inv.roomCode); socket.currentRoom = inv.roomCode;
    room.state = 'playing';
    room.players.forEach((p, idx) => {
      const opp = room.players[idx === 0 ? 1 : 0];
      const oppNick = getPlayer(opp.username).nickname || opp.username;
      io.to(p.socketId).emit('game_start', {
        room: inv.roomCode, myIndex: idx, myHand: [...p.hand],
        opponentName: oppNick, opponentCardCount: opp.hand.length,
        opponentAvatar: opp.avatar,
        round: 1, maxRounds: '∞', isTournament: false,
        myHp: p.hp, myMaxHp: p.maxHp, myStamina: p.stamina, myMaxStamina: p.maxStamina,
        oppHp: opp.hp, oppMaxHp: opp.maxHp,
        activePerksRemaining: [],
      });
    });
  });

  socket.on('decline_invite', ({ inviteId }) => {
    const inv = pendingInvites[inviteId];
    if (!inv) return;
    delete pendingInvites[inviteId];
    const fromSock = io.sockets.sockets.get(inv.fromSocketId);
    if (fromSock) fromSock.emit('invite_declined', { by: socket.username });
  });

  socket.on('join_room', ({ code }) => {
    const room = rooms[code?.toUpperCase()];
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (room.state !== 'waiting') return socket.emit('error', { message: 'Game already in progress' });
    if (room.players.length >= 2) return socket.emit('error', { message: 'Room is full' });
    if (room.players[0].username === socket.username) return socket.emit('error', { message: 'Cannot join your own room' });
    const pd3 = getPlayer(socket.username);
    const hp3 = pd3.maxHp || 100; const stam3 = pd3.maxStamina || 30;
    room.players.push({
      socketId: socket.id, username: socket.username,
      hand: dealHand(socket.username), score: 0,
      hp: hp3, maxHp: hp3, stamina: stam3, maxStamina: stam3,
      playedCard: null, playedIndex: -1, winStreak: 0,
    });
    socket.join(code); socket.currentRoom = code;
    room.state = 'playing';
    room.players.forEach((p, idx) => {
      const opp = room.players[idx === 0 ? 1 : 0];
      const oppNick = getPlayer(opp.username).nickname || opp.username;
      io.to(p.socketId).emit('game_start', {
        room: code, myIndex: idx, myHand: [...p.hand],
        opponentName: oppNick, opponentUsername: opp.username, opponentCardCount: opp.hand.length,
        opponentAvatar: opp.avatar,
        round: 1, maxRounds: '∞', isTournament: false,
        myHp: p.hp, myMaxHp: p.maxHp, myStamina: p.stamina, myMaxStamina: p.maxStamina,
        oppHp: opp.hp, oppMaxHp: opp.maxHp,
        activePerksRemaining: [],
      });
    });
  });

  // ── Play Card ──
  socket.on('play_card', ({ cardIndex }) => {
    const room = rooms[socket.currentRoom];
    if (!room || room.state !== 'playing') return;
    const p = room.players.find(p => p.socketId === socket.id);
    const opp = room.players.find(p => p.socketId !== socket.id);
    if (!p || p.playedCard !== null) return;

    // Check if opponent used FREEZE on us
    if (opp.activePerkThisRound === 'freeze' && p.hand.length > 0) {
      cardIndex = 0; // forced to leftmost
    }

    if (p.hand.length === 0) {
      p.playedCard = null; p.playedIndex = -1;
    } else if (cardIndex >= 0 && cardIndex < p.hand.length) {
      p.playedIndex = cardIndex;
      p.playedCard = p.hand.splice(cardIndex, 1)[0];
    } else {
      return;
    }
    io.to(opp.socketId).emit('opponent_played');

    // BOT LOGIC
    if (room.isBot && opp.socketId === 'BOT' && opp.playedCard === null) {
      if (opp.hand.length === 0) opp.hand = dealHand('BOT');
      const randIdx = Math.floor(Math.random() * opp.hand.length);
      opp.playedIndex = randIdx;
      opp.playedCard = opp.hand.splice(randIdx, 1)[0];
    }

    const p1Done = room.players[0].playedCard !== null || room.players[0].hand.length === 0;
    const p2Done = room.players[1].playedCard !== null || room.players[1].hand.length === 0;
    if (p1Done && p2Done) processRound(room);
  });

// ── Swap Spell From SpellBook ──
  socket.on('swap_spell_card', ({ handIndex, spellBookIndex }) => {
    const room = rooms[socket.currentRoom];
    if (!room || room.state !== 'playing') return;
    const p = room.players.find(p => p.socketId === socket.id);
    const pd = getPlayer(p.username);

    if (!p) return;
    if (handIndex < 0 || handIndex >= p.hand.length) return socket.emit('error', { message: 'Invalid hand target' });
    if (spellBookIndex < 0 || spellBookIndex >= pd.spellBook.length) return socket.emit('error', { message: 'Invalid spellbook target' });

    // Swap
    const uuidFromSpellBook = pd.spellBook[spellBookIndex];
    const uuidFromHand = p.deck.find(u => pd.collection[u].cardId === p.hand[handIndex]); 
    // Wait, p.deck might not directly map if there are duplicates, but for now we simply swap cardIds visually
    const cardIdFromSpellBook = pd.collection[uuidFromSpellBook].cardId;
    
    // Add the hand card to spellbook, put spellbook card into hand
    // Realistically, the user just replaces the card in their hand for this match
    p.hand[handIndex] = cardIdFromSpellBook;

    socket.emit('toast', { message: 'Spell swapped!' });
    socket.emit('hand_updated', { newHand: [...p.hand] });
  });

  // ── Reorder hand ──
  socket.on('reorder_hand', ({ swap }) => {
    const room = rooms[socket.currentRoom];
    if (!room || room.state !== 'playing') return;
    const p = room.players.find(p => p.socketId === socket.id);
    const opp = room.players.find(p => p.socketId !== socket.id);
    if (!p || !Array.isArray(swap) || swap.length !== 2) return;
    const [a, b] = swap;
    if (a < 0 || a >= p.hand.length || b < 0 || b >= p.hand.length) return;
    const temp = p.hand[a]; p.hand[a] = p.hand[b]; p.hand[b] = temp;
    io.to(opp.socketId).emit('opponent_reordered', { cardCount: p.hand.length });
  });

  // ── Shop (Updated for RPG) ──
  socket.on('purchase_rune', ({ runeId }) => {
    const pd = getPlayer(socket.username);
    if (!CONFIG.RUNES[runeId]) return socket.emit('error', { message: 'Unknown rune' });
    const rune = CONFIG.RUNES[runeId];
    if (pd.coins < rune.cost) return socket.emit('error', { message: 'Not enough coins' });
    pd.coins -= rune.cost;
    // For now, apply global stat boosts instead of socketing onto cards directly to simplify Phase 1
    if (rune.type === 'hp_up') pd.maxHp += rune.value;
    if (rune.type === 'stamina_up') pd.maxStamina += rune.value;
    
    socket.emit('toast', { message: `Purchased ${rune.name}!` });
    socket.emit('purchase_success', { playerData: { ...pd } });
    saveDB();
  });
  
  socket.on('purchase_card_pack', () => {
    const pd = getPlayer(socket.username);
    const cost = 200; // Pack cost
    if (pd.coins < cost) return socket.emit('error', { message: 'Not enough coins' });
    pd.coins -= cost;
    
    // Random card
    const cardIds = Object.keys(CONFIG.BASE_CARDS);
    const randomCardId = cardIds[Math.floor(Math.random() * cardIds.length)];
    const newId = generateId();
    pd.collection[newId] = { cardId: randomCardId, xp: 0, level: 1, runes: [] };
    pd.spellBook.push(newId); // add to spellbook

    socket.emit('toast', { message: `Pack opened: ${CONFIG.BASE_CARDS[randomCardId].name}!` });
    socket.emit('purchase_success', { playerData: { ...pd } });
    saveDB();
  });

  socket.on('purchase_avatar', ({ avatarId }) => {
    const pd = getPlayer(socket.username);
    const cost = 500; // simplified AVATAR_COSTS
    if (pd.unlockedAvatars.includes(avatarId)) return socket.emit('error', { message: 'Already owned' });
    if (pd.coins < cost) return socket.emit('error', { message: 'Not enough coins' });
    pd.coins -= cost; pd.unlockedAvatars.push(avatarId);
    socket.emit('purchase_success', { playerData: { ...pd } });
    saveDB();
  });

  socket.on('move_to_deck', ({ uuid }) => {
    const pd = getPlayer(socket.username);
    if (!pd.collection[uuid]) return;
    if (pd.deck.includes(uuid)) return;
    if (pd.deck.length >= 8) return socket.emit('error', { message: 'Deck full (Max 8)' });
    pd.spellBook = pd.spellBook.filter(id => id !== uuid);
    pd.deck.push(uuid);
    socket.emit('purchase_success', { playerData: { ...pd } });
    saveDB();
  });

  socket.on('move_to_spellbook', ({ uuid }) => {
    const pd = getPlayer(socket.username);
    if (!pd.collection[uuid]) return;
    if (pd.spellBook.includes(uuid)) return;
    pd.deck = pd.deck.filter(id => id !== uuid);
    pd.spellBook.push(uuid);
    socket.emit('purchase_success', { playerData: { ...pd } });
    saveDB();
  });

  socket.on('equip_avatar', ({ avatarId }) => {
    const pd = getPlayer(socket.username);
    if (!pd.unlockedAvatars.includes(avatarId)) return socket.emit('error', { message: 'Not unlocked' });
    pd.equippedAvatar = avatarId;
    socket.emit('purchase_success', { playerData: { ...pd } });
    saveDB();
  });

  // ── Tournament ──
  socket.on('create_tournament', ({ name, entryFee, maxPlayers, isPublic }) => {
    if (!socket.username) return socket.emit('error', { message: 'Not registered' });
    const pd = getPlayer(socket.username);
    const fee = Math.max(0, Number(entryFee) || 0);
    const max = [4, 8].includes(Number(maxPlayers)) ? Number(maxPlayers) : 4;
    if (pd.coins < fee) return socket.emit('error', { message: 'Not enough coins' });
    pd.coins -= fee;
    const code = uniqueTournament();
    tournaments[code] = {
      code, name: (name || 'Tournament').slice(0, 30),
      entryFee: fee, maxPlayers: max, prizePool: fee,
      state: 'waiting', currentRound: 0, isPublic: !!isPublic,
      players: [{ username: socket.username, socketId: socket.id }],
      bracket: [],
    };
    socket.join(code); socket.currentTournament = code;
    socket.emit('tournament_created', { tournament: tournaments[code], playerData: { ...pd } });
  });

  socket.on('join_tournament', ({ code }) => {
    const t = tournaments[code?.toUpperCase()];
    if (!t) return socket.emit('error', { message: 'Tournament not found' });
    if (t.state !== 'waiting') return socket.emit('error', { message: 'Already started' });
    if (t.players.length >= t.maxPlayers) return socket.emit('error', { message: 'Full' });
    if (t.players.find(p => p.username === socket.username)) return socket.emit('error', { message: 'Already joined' });
    const pd = getPlayer(socket.username);
    if (pd.coins < t.entryFee) return socket.emit('error', { message: 'Not enough coins' });
    pd.coins -= t.entryFee; t.prizePool += t.entryFee;
    t.players.push({ username: socket.username, socketId: socket.id });
    socket.join(code); socket.currentTournament = code;
    io.to(code).emit('tournament_update', { tournament: t });
    socket.emit('joined_tournament', { tournament: t, playerData: { ...pd } });
    if (t.players.length >= t.maxPlayers) setTimeout(() => kickOffTournament(t), 2000);
  });

  socket.on('start_tournament', ({ code }) => {
    const t = tournaments[code?.toUpperCase()];
    if (!t || t.state !== 'waiting') return socket.emit('error', { message: 'Cannot start' });
    if (t.players[0]?.username !== socket.username) return socket.emit('error', { message: 'Only host can start' });
    if (t.players.length < 2) return socket.emit('error', { message: 'Need 2+ players' });
    kickOffTournament(t);
  });

  socket.on('list_public_tournaments', () => {
    const list = Object.values(tournaments)
      .filter(t => t.isPublic && t.state === 'waiting')
      .map(t => ({ code: t.code, name: t.name, entryFee: t.entryFee, players: t.players.length, maxPlayers: t.maxPlayers, prizePool: t.prizePool }));
    socket.emit('public_tournaments', { tournaments: list });
  });

  // ── Leaderboard ──
  socket.on('get_leaderboard', ({ period }) => {
    const lb = getLeaderboard(period || 'alltime');
    socket.emit('leaderboard_data', { period: period || 'alltime', entries: lb });
  });

  // ── Friends ──
  socket.on('add_friend', ({ friendName }) => {
    if (!socket.username) return socket.emit('error', { message: 'Not registered' });
    const fn = friendName?.trim();
    if (!fn || fn === socket.username) return socket.emit('error', { message: 'Invalid friend name' });
    if (!friends[socket.username]) friends[socket.username] = [];
    if (friends[socket.username].includes(fn)) return socket.emit('error', { message: 'Already friends' });
    friends[socket.username].push(fn);
    // Bi-directional
    if (!friends[fn]) friends[fn] = [];
    if (!friends[fn].includes(socket.username)) friends[fn].push(socket.username);
    saveDB();
    socket.emit('friends_list', { friends: getFriendsList(socket.username) });
  });

  socket.on('remove_friend', ({ friendName }) => {
    if (!socket.username) return;
    if (friends[socket.username]) friends[socket.username] = friends[socket.username].filter(n => n !== friendName);
    if (friends[friendName]) friends[friendName] = friends[friendName].filter(n => n !== socket.username);
    saveDB();
    socket.emit('friends_list', { friends: getFriendsList(socket.username) });
  });

  socket.on('get_friends', () => {
    if (!socket.username) return;
    socket.emit('friends_list', { friends: getFriendsList(socket.username) });
  });

  socket.on('claim_daily_reward', () => {
    if (!socket.username) return;
    const p = getPlayer(socket.username);
    const today = new Date().toISOString().slice(0,10);
    if (p.lastDailyRewardDate !== today && !p.username.startsWith('Guest_')) {
      p.coins += 100;
      p.lastDailyRewardDate = today;
      emitPlayerData(socket);
    }
  });

  const adCooldowns = new Map();
  socket.on('claim_ad_reward', () => {
    if (!socket.username) return;
    const now = Date.now();
    const last = adCooldowns.get(socket.username) || 0;
    if (now - last < 5000) return; // 5s cooldown

    const p = getPlayer(socket.username);
    p.coins += 100;
    adCooldowns.set(socket.username, now);
    emitPlayerData(socket);
  });

  socket.on('double_reward_ad', () => {
    if (!socket.username || !socket.lastMatchCoins) return;
    const p = getPlayer(socket.username);
    p.coins += socket.lastMatchCoins; // Add the same amount again to double it
    socket.lastMatchCoins = 0; // Prevent multiple doubling
    emitPlayerData(socket);
  });

  socket.on('forfeit', () => {
    if (!socket.username || !socket.currentRoom) return;
    const room = rooms[socket.currentRoom];
    if (!room || room.state !== 'playing') return;
    
    const playerIdx = room.players.findIndex(p => p.username === socket.username);
    const winners = [room.players[1 - playerIdx].username];
    finishGame(room, 0, 0, 'forfeit');
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    // Remove from matchmaking queue
    const qi = matchQueue.findIndex(q => q.socketId === socket.id);
    if (qi >= 0) matchQueue.splice(qi, 1);

    const roomCode = socket.currentRoom;
    if (roomCode && rooms[roomCode]) {
      const room = rooms[roomCode];
      if (room.state === 'playing') {
        const remaining = room.players.find(p => p.socketId !== socket.id);
        if (remaining) {
          // Grace period instead of immediate win
          console.log(`⌛ Grace period started for ${socket.username}`);
          const timeout = setTimeout(() => {
            if (rooms[roomCode] && room.state === 'playing') {
              finishGame(room, 0, 0, 'disconnect');
              disconnectTimeouts.delete(socket.username);
            }
          }, 30000); // 30 seconds
          disconnectTimeouts.set(socket.username, timeout);
        } else {
          delete rooms[roomCode];
        }
      }
    }
  });
});

function getFriendsList(username) {
  const list = friends[username];
  if (!list) return [];
  return list.map(fn => {
    const p = players[fn];
    return { 
      username: fn, 
      nickname: p?.nickname || fn, 
      friendCode: p?.friendCode || '0000',
      wins: p?.wins || 0, 
      gamesPlayed: p?.gamesPlayed || 0, 
      online: isOnline(fn) 
    };
  });
}

function isOnline(username) {
  for (const [, s] of io.sockets.sockets) {
    if (s.username === username) return true;
  }
  return false;
}

function getFormattedPlayerData(p) {
  const today = new Date().toISOString().slice(0,10);
  return {
    ...p,
    hasDailyReward: p.lastDailyRewardDate !== today && !p.username.startsWith('Guest_')
  };
}

function emitPlayerData(socket) {
  if (!socket.username) return;
  const p = getPlayer(socket.username);
  const data = getFormattedPlayerData(p);
  socket.emit('player_data', data);
  // Also send registered for legacy compatibility
  socket.emit('registered', { playerData: p, shop: getShopData() });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 RPS server on port ${PORT}`));
