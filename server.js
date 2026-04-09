const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(express.static(path.join(__dirname, 'docs')));
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
  fs.writeFileSync(DB_FILE, JSON.stringify({ players, friends, dailyWins, monthlyWins }), 'utf8');
}
loadDB();
setInterval(saveDB, 15000); // Save every 15 seconds

const rooms       = {};
const tournaments = {};
const matchQueue  = [];   // [{ socketId, username, wins }]
const pendingInvites = {}; // inviteId → { from, to, roomCode }

// ── Constants ─────────────────────────────────────────────────
const CARDS = ['rock', 'paper', 'scissors'];

// ── Perk Definitions ──────────────────────────────────────────
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
function uniqueRoom()       { let c; do { c = genCode(4);     } while (rooms[c]);       return c; }
function uniqueTournament() { let c; do { c = 'T'+genCode(4); } while (tournaments[c]); return c; }

function getPlayer(username) {
  if (!players[username]) {
    players[username] = {
      username, coins: 50,
      unlockedSkins: ['classic'], equippedSkin: 'classic',
      unlockedPerks: [], equippedPerks: [],
      perkSlots: 1,
      unlockedAvatars: ['Char 1', 'Char 2', 'Char 3', 'Char 4', 'Char 5'],
      equippedAvatar: 'Char 1',
      wins: 0, losses: 0, ties: 0, gamesPlayed: 0,
      friendCode: Math.floor(100000 + Math.random() * 900000).toString(),
      nickname: username.slice(0, 15),
    };
  }
  // Data migration for old accounts
  if (!players[username].unlockedAvatars) {
    players[username].unlockedAvatars = ['Char 1', 'Char 2', 'Char 3', 'Char 4', 'Char 5'];
    players[username].equippedAvatar = 'Char 1';
  }
  if (!players[username].friendCode || players[username].friendCode.length < 6) {
    players[username].friendCode = Math.floor(100000 + Math.random() * 900000).toString();
    players[username].nickname = username.slice(0, 15);
  }
  return players[username];
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
    return all.filter(p => dailyWins[p.username]?.date === today)
      .map(p => ({ username: p.username, value: dailyWins[p.username].count }))
      .sort((a,b) => b.value - a.value).slice(0, 50);
  }
  if (period === 'monthly') {
    const month = new Date().toISOString().slice(0,7);
    return all.filter(p => monthlyWins[p.username]?.month === month)
      .map(p => ({ username: p.username, value: monthlyWins[p.username].count }))
      .sort((a,b) => b.value - a.value).slice(0, 50);
  }
  // alltime
  return all.map(p => ({ username: p.username, value: p.wins }))
    .sort((a,b) => b.value - a.value).slice(0, 50);
}

function hasPerk(username, perkId) {
  return getPlayer(username).equippedPerks.includes(perkId);
}
function hasPassive(username, perkId) {
  const p = getPlayer(username);
  return p.equippedPerks.includes(perkId) && PERKS[perkId]?.type === 'passive';
}

function randCard() { return CARDS[Math.floor(Math.random() * CARDS.length)]; }
function dealHand(username) {
  const n = hasPassive(username, 'hoarder') ? 5 : 3;
  return Array.from({ length: n }, randCard);
}

function rollTicker(username, sabotaged) {
  if (sabotaged) return 0;
  if (hasPassive(username, 'lucky_draw')) return Math.floor(Math.random() * 2) + 1;
  if (hasPassive(username, 'big_hand'))   return Math.floor(Math.random() * 5);
  return Math.floor(Math.random() * 3);
}

function resolveCards(c1, c2) {
  if (!c1 && !c2) return 'tie';
  if (!c1) return 'p2';
  if (!c2) return 'p1';
  if (c1 === c2) return 'tie';
  if ((c1==='rock'&&c2==='scissors')||(c1==='paper'&&c2==='rock')||(c1==='scissors'&&c2==='paper')) return 'p1';
  return 'p2';
}

function awardCoins(username, base, isLoss) {
  const p = getPlayer(username);
  let amount = base;
  if (hasPassive(username, 'coin_boost')) amount = Math.floor(amount * 1.5);
  if (isLoss && hasPassive(username, 'scavenger')) amount = Math.floor(amount * 2);
  p.coins += amount;
  return amount;
}

const AVATAR_COSTS = {};
for (let i = 6; i <= 18; i++) AVATAR_COSTS[`Char ${i}`] = 500 + (Math.floor(i / 3) * 200);

function getShopData() {
  return { skins: SKINS, perks: PERKS, slotCosts: SLOT_COSTS, avatarCosts: AVATAR_COSTS };
}

// ── Room ──────────────────────────────────────────────────────
function makeRoom(hostId, hostName) {
  const code = uniqueRoom();
  rooms[code] = {
    code, state: 'waiting',
    players: [{
      socketId: hostId, username: hostName,
      hand: dealHand(hostName), score: 0,
      playedCard: null, playedIndex: -1,
      activePerkThisRound: null,
      activePerksUsedThisGame: [],
      winStreak: 0,
    }],
    round: 1, maxRounds: 7, history: [],
    tournamentCode: null, tournamentMatchIdx: null,
    encorePending: null,
  };
  return rooms[code];
}

// ── Round Processing ──────────────────────────────────────────
function processRound(room) {
  const [p1, p2] = room.players;
  let c1 = p1.playedCard, c2 = p2.playedCard;
  const a1 = p1.activePerkThisRound, a2 = p2.activePerkThisRound;
  let perkMessages = [];

  // ── Active perk effects (pre-resolve) ──

  // WILDCARD: card beats anything
  let p1Wildcard = false, p2Wildcard = false;
  if (a1 === 'wildcard' && c1) { p1Wildcard = true; perkMessages.push({ player: 1, msg: '🌟 Wildcard! Unbeatable card!' }); }
  if (a2 === 'wildcard' && c2) { p2Wildcard = true; perkMessages.push({ player: 2, msg: '🌟 Wildcard! Unbeatable card!' }); }

  // SHIELD: auto-win
  let p1Shield = false, p2Shield = false;
  if (a1 === 'shield') { p1Shield = true; perkMessages.push({ player: 1, msg: '🛡️ Shield activated!' }); }
  if (a2 === 'shield') { p2Shield = true; perkMessages.push({ player: 2, msg: '🛡️ Shield activated!' }); }

  // MIRROR: force tie
  let forceTie = false;
  if (a1 === 'mirror' || a2 === 'mirror') {
    forceTie = true;
    perkMessages.push({ player: a1 === 'mirror' ? 1 : 2, msg: '🪞 Mirror — forced tie!' });
  }

  // FREEZE: opponent must play leftmost card
  // (handled during play_card phase)

  // Resolve
  let result;
  if (forceTie && c1 && c2) {
    result = 'tie';
  } else if (p1Shield && !p2Shield) {
    result = c1 ? 'p1' : (c2 ? 'p2' : 'tie');
  } else if (p2Shield && !p1Shield) {
    result = c2 ? 'p2' : (c1 ? 'p1' : 'tie');
  } else if (p1Shield && p2Shield) {
    result = 'tie'; // Both shield = tie
  } else if (p1Wildcard && !p2Wildcard) {
    result = 'p1';
  } else if (p2Wildcard && !p1Wildcard) {
    result = 'p2';
  } else if (p1Wildcard && p2Wildcard) {
    result = 'tie';
  } else {
    result = resolveCards(c1, c2);
  }

  // STEAL: if you lose, steal the win
  if (result === 'p2' && a1 === 'steal') {
    result = 'p1';
    perkMessages.push({ player: 1, msg: '🥷 Steal! Snatched the win!' });
  } else if (result === 'p1' && a2 === 'steal') {
    result = 'p2';
    perkMessages.push({ player: 2, msg: '🥷 Steal! Snatched the win!' });
  }

  // ENCORE: if you lose, replay the round (once per game)
  if (result === 'p2' && a1 === 'encore') {
    perkMessages.push({ player: 1, msg: '🔁 Encore! Replaying the round!' });
    // Return cards and replay
    if (c1) p1.hand.splice(p1.playedIndex, 0, c1);
    if (c2) p2.hand.splice(p2.playedIndex, 0, c2);
    p1.playedCard = null; p1.playedIndex = -1; p1.activePerkThisRound = null;
    p2.playedCard = null; p2.playedIndex = -1; p2.activePerkThisRound = null;
    broadcastEncoreReplay(room, perkMessages);
    return;
  } else if (result === 'p1' && a2 === 'encore') {
    perkMessages.push({ player: 2, msg: '🔁 Encore! Replaying the round!' });
    if (c1) p1.hand.splice(p1.playedIndex, 0, c1);
    if (c2) p2.hand.splice(p2.playedIndex, 0, c2);
    p1.playedCard = null; p1.playedIndex = -1; p1.activePerkThisRound = null;
    p2.playedCard = null; p2.playedIndex = -1; p2.activePerkThisRound = null;
    broadcastEncoreReplay(room, perkMessages);
    return;
  }

  // Score
  let p1Points = 0, p2Points = 0;
  if (result === 'p1') {
    p1Points = (a1 === 'double_down') ? 2 : 1;
    if (a1 === 'double_down') perkMessages.push({ player: 1, msg: '⚡ Double Down! +2 points!' });
    p1.score += p1Points;
  } else if (result === 'p2') {
    p2Points = (a2 === 'double_down') ? 2 : 1;
    if (a2 === 'double_down') perkMessages.push({ player: 2, msg: '⚡ Double Down! +2 points!' });
    p2.score += p2Points;
  }

  // TIE: cards return to same slot
  if (result === 'tie' && c1 && c2) {
    p1.hand.splice(p1.playedIndex, 0, c1);
    p2.hand.splice(p2.playedIndex, 0, c2);
  }

  // CARD THIEF: winner steals a random card from loser
  let stolenCard = null;
  if (result === 'p1' && a1 === 'card_thief' && p2.hand.length > 0) {
    const si = Math.floor(Math.random() * p2.hand.length);
    stolenCard = p2.hand.splice(si, 1)[0];
    p1.hand.push(stolenCard);
    perkMessages.push({ player: 1, msg: `🃏 Stole ${stolenCard} from opponent!` });
  } else if (result === 'p2' && a2 === 'card_thief' && p1.hand.length > 0) {
    const si = Math.floor(Math.random() * p1.hand.length);
    stolenCard = p1.hand.splice(si, 1)[0];
    p2.hand.push(stolenCard);
    perkMessages.push({ player: 2, msg: `🃏 Stole ${stolenCard} from opponent!` });
  }

  // RECYCLER: losing card 40% chance of returning
  if (result === 'p2' && c1 && hasPassive(p1.username, 'recycler') && Math.random() < 0.4) {
    p1.hand.push(c1);
    perkMessages.push({ player: 1, msg: '♻️ Recycler saved your card!' });
  }
  if (result === 'p1' && c2 && hasPassive(p2.username, 'recycler') && Math.random() < 0.4) {
    p2.hand.push(c2);
    perkMessages.push({ player: 2, msg: '♻️ Recycler saved your card!' });
  }

  // Win streak tracking for momentum
  if (result === 'p1') { p1.winStreak++; p2.winStreak = 0; }
  else if (result === 'p2') { p2.winStreak++; p1.winStreak = 0; }
  else { /* tie keeps streaks */ }

  // THICK SKIN: tie = +1 extra card
  if (result === 'tie') {
    if (hasPassive(p1.username, 'thick_skin')) { p1.hand.push(randCard()); }
    if (hasPassive(p2.username, 'thick_skin')) { p2.hand.push(randCard()); }
  }

  const roundWinner = result === 'p1' ? p1.username : result === 'p2' ? p2.username : null;
  room.history.push({ round: room.round, c1, c2, result, roundWinner });

  // Ticker draw
  const sab1 = a2 === 'sabotage';
  const sab2 = a1 === 'sabotage';
  if (sab1) perkMessages.push({ player: 2, msg: '💣 Sabotage! Opponent gets 0 ticker cards!' });
  if (sab2) perkMessages.push({ player: 1, msg: '💣 Sabotage! Opponent gets 0 ticker cards!' });

  let draw1 = rollTicker(p1.username, sab1);
  let draw2 = rollTicker(p2.username, sab2);

  // MOMENTUM: +1 card per win streak
  if (hasPassive(p1.username, 'momentum') && p1.winStreak > 1) draw1 += Math.min(p1.winStreak - 1, 3);
  if (hasPassive(p2.username, 'momentum') && p2.winStreak > 1) draw2 += Math.min(p2.winStreak - 1, 3);

  for (let i = 0; i < draw1; i++) p1.hand.push(randCard());
  for (let i = 0; i < draw2; i++) p2.hand.push(randCard());

  p1.playedCard = null; p1.playedIndex = -1; p1.activePerkThisRound = null;
  p2.playedCard = null; p2.playedIndex = -1; p2.activePerkThisRound = null;

  // PHANTOM: hide card from opponent in reveal
  const p1Phantom = a1 === 'phantom';
  const p2Phantom = a2 === 'phantom';
  if (p1Phantom) perkMessages.push({ player: 1, msg: '👻 Phantom! Your card is hidden!' });
  if (p2Phantom) perkMessages.push({ player: 2, msg: '👻 Phantom! Your card is hidden!' });

  const maxWins  = Math.ceil(room.maxRounds / 2);
  const gameOver = p1.score >= maxWins || p2.score >= maxWins || room.round >= room.maxRounds;

  if (gameOver) { finishGame(room, draw1, draw2, null, perkMessages, p1Phantom, p2Phantom); return; }

  room.round++;

  [p1, p2].forEach((p, idx) => {
    const opp = idx === 0 ? p2 : p1;
    const myDraw = idx === 0 ? draw1 : draw2;
    const myCard = idx === 0 ? c1 : c2;
    const opCard = idx === 0 ? c2 : c1;
    const isPhantom = idx === 0 ? p2Phantom : p1Phantom;
    const myResult = result === 'tie' ? 'tie' : result === `p${idx+1}` ? 'win' : 'loss';
    const myPerks = perkMessages.filter(m => m.player === idx+1).map(m => m.msg);
    const oppPerks = perkMessages.filter(m => m.player === (idx===0?2:1)).map(m => m.msg);
    io.to(p.socketId).emit('round_result', {
      myCard, opponentCard: isPhantom ? null : opCard, result: myResult, roundWinner,
      myScore: p.score, opponentScore: opp.score,
      myDraw, newHand: [...p.hand], opponentCardCount: opp.hand.length,
      round: room.round, maxRounds: room.maxRounds,
      tiedReturnedCard: result === 'tie' && myCard ? true : false,
      myPerkMessages: myPerks, oppPerkMessages: oppPerks,
      opponentPhantom: isPhantom,
      activePerksRemaining: getActivePerksRemaining(p),
    });
  });
}

function broadcastEncoreReplay(room, perkMessages) {
  const [p1, p2] = room.players;
  [p1, p2].forEach((p, idx) => {
    const opp = idx === 0 ? p2 : p1;
    const myPerks = perkMessages.filter(m => m.player === idx+1).map(m => m.msg);
    const oppPerks = perkMessages.filter(m => m.player === (idx===0?2:1)).map(m => m.msg);
    io.to(p.socketId).emit('encore_replay', {
      newHand: [...p.hand], opponentCardCount: opp.hand.length,
      myPerkMessages: myPerks, oppPerkMessages: oppPerks,
      activePerksRemaining: getActivePerksRemaining(p),
    });
  });
}

function getActivePerksRemaining(roomPlayer) {
  const pd = getPlayer(roomPlayer.username);
  const equipped = pd.equippedPerks.filter(id => PERKS[id]?.type === 'active');
  return equipped.filter(id => !roomPlayer.activePerksUsedThisGame.includes(id));
}

function finishGame(room, draw1, draw2, reason, perkMessages, p1Phantom, p2Phantom) {
  room.state = 'finished';
  const [p1, p2] = room.players;
  let winner = null;
  if (p1.score > p2.score) winner = p1.username;
  else if (p2.score > p1.score) winner = p2.username;

  if (room.tournamentCode) onTournamentMatchEnd(room, winner);

  [p1, p2].forEach((p, idx) => {
    const opp   = idx === 0 ? p2 : p1;
    const myDraw = idx === 0 ? (draw1||0) : (draw2||0);
    const isWin = winner === p.username, isTie = winner === null;
    const isLoss = !isWin && !isTie;
    let base  = reason === 'disconnect' ? 15 : isWin ? 25 : isTie ? 10 : 5;
    if (room.isBot) base = isWin ? 10 : 0; // Bot matches reward less
    const coinsEarned = awardCoins(p.username, base, isLoss);
    const pd = getPlayer(p.username);
    if (p.socketId !== 'BOT') {
      if (isWin) { pd.wins++; trackWin(p.username); } else if (isLoss) pd.losses++; else pd.ties++;
    }
    pd.gamesPlayed++;
    const myPerks = (perkMessages||[]).filter(m => m.player === idx+1).map(m => m.msg);
    io.to(p.socketId).emit('game_over', {
      winner, reason: reason || null,
      myScore: p.score, opponentScore: opp.score,
      myDraw, finalHand: [...p.hand],
      coinsEarned, playerData: { ...pd },
      myPerkMessages: myPerks,
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

  socket.on('register', ({ username }) => {
    if (!username || username.length < 2 || username.length > 20) return socket.emit('error', { message: 'Username must be 2–20 characters' });
    const u = username.trim().toLowerCase();
    if (BLACKLIST.some(b => u.includes(b))) return socket.emit('error', { message: 'That username is restricted.' });
    
    const pd = getPlayer(username.trim());
    socket.username = pd.username;
    socket.emit('registered', { playerData: pd, shop: getShopData() });
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
      hand: dealHand('BOT'), score: 0,
      playedCard: null, playedIndex: -1,
      activePerkThisRound: null, activePerksUsedThisGame: [], winStreak: 0,
    });
    room.state = 'playing';
    socket.join(room.code); socket.currentRoom = room.code;
    
    // Start game right away
    io.to(socket.id).emit('game_start', {
      room: room.code, myIndex: 0, myHand: [...room.players[0].hand],
      opponentName: room.players[1].username, opponentCardCount: room.players[1].hand.length,
      opponentAvatar: room.players[1].avatar,
      round: 1, maxRounds: 7, isTournament: false,
      activePerksRemaining: getActivePerksRemaining(room.players[0]),
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
        const oppNick = getPlayer(opp.username).nickname;
        io.to(p.socketId).emit('game_start', {
          room: room.code, myIndex: idx, myHand: [...p.hand],
          opponentName: oppNick, opponentUsername: opp.username, opponentCardCount: opp.hand.length,
          opponentAvatar: opp.avatar,
          round: 1, maxRounds: 7, isTournament: false,
          activePerksRemaining: getActivePerksRemaining(p),
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
    room.players.push({
      socketId: socket.id, username: socket.username,
      hand: dealHand(socket.username), score: 0,
      playedCard: null, playedIndex: -1,
      activePerkThisRound: null, activePerksUsedThisGame: [], winStreak: 0,
    });
    socket.join(inv.roomCode); socket.currentRoom = inv.roomCode;
    room.state = 'playing';
    room.players.forEach((p, idx) => {
      const opp = room.players[idx === 0 ? 1 : 0];
      io.to(p.socketId).emit('game_start', {
        room: inv.roomCode, myIndex: idx, myHand: [...p.hand],
        opponentName: opp.username, opponentCardCount: opp.hand.length,
        opponentAvatar: opp.avatar,
        round: 1, maxRounds: 7, isTournament: false,
        activePerksRemaining: getActivePerksRemaining(p),
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
    room.players.push({
      socketId: socket.id, username: socket.username,
      hand: dealHand(socket.username), score: 0,
      playedCard: null, playedIndex: -1,
      activePerkThisRound: null, activePerksUsedThisGame: [], winStreak: 0,
    });
    socket.join(code); socket.currentRoom = code;
    room.state = 'playing';
    room.players.forEach((p, idx) => {
      const opp = room.players[idx === 0 ? 1 : 0];
      const oppNick = getPlayer(opp.username).nickname;
      io.to(p.socketId).emit('game_start', {
        room: code, myIndex: idx, myHand: [...p.hand],
        opponentName: oppNick, opponentUsername: opp.username, opponentCardCount: opp.hand.length,
        opponentAvatar: opp.avatar,
        round: 1, maxRounds: 7, isTournament: false,
        activePerksRemaining: getActivePerksRemaining(p),
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

  // ── Activate Perk ──
  socket.on('activate_perk', ({ perkId }) => {
    const room = rooms[socket.currentRoom];
    if (!room || room.state !== 'playing') return;
    const p = room.players.find(p => p.socketId === socket.id);
    const opp = room.players.find(p => p.socketId !== socket.id);
    if (!p) return;
    const perk = PERKS[perkId];
    if (!perk || perk.type !== 'active') return socket.emit('error', { message: 'Not an active perk' });
    const pd = getPlayer(p.username);
    if (!pd.equippedPerks.includes(perkId)) return socket.emit('error', { message: 'Perk not equipped' });
    if (p.activePerksUsedThisGame.includes(perkId)) return socket.emit('error', { message: 'Already used this game' });
    if (p.activePerkThisRound) return socket.emit('error', { message: 'Already activated a perk this round' });

    p.activePerkThisRound = perkId;
    p.activePerksUsedThisGame.push(perkId);

    socket.emit('perk_activated', { perkId, activePerksRemaining: getActivePerksRemaining(p) });
    io.to(opp.socketId).emit('opponent_used_perk', { perkIcon: perk.icon });

    // PEEK: send opponent's hand
    if (perkId === 'peek') {
      socket.emit('peek_reveal', { opponentHand: [...opp.hand] });
    }
    // REROLL: discard hand, draw 3
    if (perkId === 'reroll') {
      p.hand = dealHand(p.username);
      socket.emit('reroll_result', { newHand: [...p.hand] });
    }
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

  // ── Shop ──
  socket.on('purchase_skin', ({ skinId }) => {
    const pd = getPlayer(socket.username);
    if (!SKINS[skinId]) return socket.emit('error', { message: 'Unknown skin' });
    if (pd.unlockedSkins.includes(skinId)) return socket.emit('error', { message: 'Already owned' });
    if (pd.coins < SKINS[skinId].cost) return socket.emit('error', { message: 'Not enough coins' });
    pd.coins -= SKINS[skinId].cost; pd.unlockedSkins.push(skinId);
    socket.emit('purchase_success', { playerData: { ...pd } });
    saveDB();
  });
  socket.on('equip_skin', ({ skinId }) => {
    const pd = getPlayer(socket.username);
    if (!pd.unlockedSkins.includes(skinId) && skinId !== 'classic') return socket.emit('error', { message: 'Not unlocked' });
    pd.equippedSkin = skinId;
    socket.emit('purchase_success', { playerData: { ...pd } });
    saveDB();
  });
  socket.on('purchase_perk', ({ perkId }) => {
    const pd = getPlayer(socket.username);
    if (!PERKS[perkId]) return socket.emit('error', { message: 'Unknown perk' });
    if (pd.unlockedPerks.includes(perkId)) return socket.emit('error', { message: 'Already owned' });
    if (pd.coins < PERKS[perkId].cost) return socket.emit('error', { message: 'Not enough coins' });
    pd.coins -= PERKS[perkId].cost; pd.unlockedPerks.push(perkId);
    socket.emit('purchase_success', { playerData: { ...pd } });
    saveDB();
  });

  socket.on('purchase_avatar', ({ avatarId }) => {
    const pd = getPlayer(socket.username);
    const cost = AVATAR_COSTS[avatarId];
    if (!cost) return socket.emit('error', { message: 'Unknown avatar' });
    if (pd.unlockedAvatars.includes(avatarId)) return socket.emit('error', { message: 'Already owned' });
    if (pd.coins < cost) return socket.emit('error', { message: 'Not enough coins' });
    pd.coins -= cost; pd.unlockedAvatars.push(avatarId);
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
  socket.on('equip_perk', ({ perkId }) => {
    const pd = getPlayer(socket.username);
    if (!pd.unlockedPerks.includes(perkId)) return socket.emit('error', { message: 'Not unlocked' });
    if (pd.equippedPerks.includes(perkId)) return socket.emit('error', { message: 'Already equipped' });
    if (pd.equippedPerks.length >= pd.perkSlots) return socket.emit('error', { message: `All ${pd.perkSlots} perk slot(s) full. Unequip one first or buy more slots.` });
    pd.equippedPerks.push(perkId);
    socket.emit('purchase_success', { playerData: { ...pd } });
  });
  socket.on('unequip_perk', ({ perkId }) => {
    const pd = getPlayer(socket.username);
    pd.equippedPerks = pd.equippedPerks.filter(id => id !== perkId);
    socket.emit('purchase_success', { playerData: { ...pd } });
  });
  socket.on('upgrade_perk_slots', () => {
    const pd = getPlayer(socket.username);
    const nextSlot = pd.perkSlots + 1;
    if (nextSlot > 5) return socket.emit('error', { message: 'Max slots reached' });
    const cost = SLOT_COSTS[nextSlot];
    if (pd.coins < cost) return socket.emit('error', { message: `Need ${cost} coins for slot ${nextSlot}` });
    pd.coins -= cost; pd.perkSlots = nextSlot;
    socket.emit('purchase_success', { playerData: { ...pd } });
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
        if (remaining) finishGame(room, 0, 0, 'disconnect');
        else delete rooms[roomCode];
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 RPS server on port ${PORT}`));
