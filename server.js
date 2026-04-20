const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(express.static(__dirname));
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── Stores ────────────────────────────────────────────────────
const DB_FILE = path.join(__dirname, 'database.json');
let players     = {};
let monthlyWins = {};   // username → { count, month }
let dailyWins   = {};
let friends     = {};   // username → Set/Array of friend usernames

const BLACKLIST = ['admin', 'moderator', 'server', 'system', 'root', 'staff', 'owner', 'official'];

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
  const persistentPlayers = {};
  for (const [uname, data] of Object.entries(players)) {
    if (!uname.startsWith('Guest_')) {
      persistentPlayers[uname] = data;
    }
  }
  fs.writeFileSync(DB_FILE, JSON.stringify({ players: persistentPlayers, friends, dailyWins, monthlyWins }), 'utf8');
}

loadDB();
setInterval(saveDB, 15000);

const rooms       = {};
const tournaments = {};
const matchQueue  = [];
const pendingInvites = {};
const disconnectTimeouts = new Map();

const CONFIG = require('./shared_config.js');

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
function generateId()       { return Math.random().toString(36).substr(2, 9); }

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
  if (p.level === undefined) {
    const dIds = [generateId(), generateId(), generateId(), generateId()];
    p.level = 1; p.xp = 0; p.maxHp = 100; p.maxStamina = 30; p.campaignProgress = 1;
    p.collection = {
      [dIds[0]]: { cardId: 'water_splash', xp: 0, level: 1, runes: [] },
      [dIds[1]]: { cardId: 'fire_punch', xp: 0, level: 1, runes: [] },
      [dIds[2]]: { cardId: 'rock_throw', xp: 0, level: 1, runes: [] },
      [dIds[3]]: { cardId: 'wind_slash', xp: 0, level: 1, runes: [] }
    };
    p.deck = dIds; p.spellBook = [];
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
  return all.filter(p => p.wins > 0).map(p => ({ username: p.username, value: p.wins })).sort((a,b) => b.value - a.value).slice(0, 50);
}

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
      hand.push({ uuid: 'starter_' + i, cardId: 'water_splash' });
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
      hp: hp1, maxHp: hp1, stamina: stam1, maxStamina: stam1,
      playedCard: null, playedIndex: -1, winStreak: 0,
    }],
    round: 1, history: [], tournamentCode: null, tournamentMatchIdx: null,
  };
  return rooms[code];
}

function processRound(room) {
  const [p1, p2] = room.players;
  let c1 = p1.playedCard, c2 = p2.playedCard;
  let msg1 = [], msg2 = [];

  const id1 = c1?.cardId || c1;
  const id2 = c2?.cardId || c2;
  const card1 = id1 ? CONFIG.BASE_CARDS[id1] : null;
  const card2 = id2 ? CONFIG.BASE_CARDS[id2] : null;

  if (card1) p1.stamina = Math.max(0, p1.stamina - card1.cost);
  if (card2) p2.stamina = Math.max(0, p2.stamina - card2.cost);

  let dmg1 = card1 ? card1.baseDmg : 0;
  let blk1 = card1 ? card1.baseBlock : 0;
  let dmg2 = card2 ? card2.baseDmg : 0;
  let blk2 = card2 ? card2.baseBlock : 0;

  let mult1 = 1.0, mult2 = 1.0;
  if (card1 && card2) {
    const el1 = CONFIG.ELEMENTS[card1.type];
    const el2 = CONFIG.ELEMENTS[card2.type];
    if (el1.strongAgainst.includes(card2.type)) mult1 += 0.5;
    if (el1.weakAgainst.includes(card2.type)) mult1 -= 0.5;
    if (el2.strongAgainst.includes(card1.type)) mult2 += 0.5;
    if (el2.weakAgainst.includes(card1.type)) mult2 -= 0.5;
  }

  let finalDmg1 = Math.max(0, Math.floor(dmg1 * mult1) - blk2);
  let finalDmg2 = Math.max(0, Math.floor(dmg2 * mult2) - blk1);

  p2.hp = Math.max(0, p2.hp - finalDmg1);
  p1.hp = Math.max(0, p1.hp - finalDmg2);

  if (card1 && card1.effect === 'heal') { p1.hp = Math.min(p1.maxHp, p1.hp + card1.effectValue); msg1.push(`Healed for ${card1.effectValue} HP!`); }
  if (card2 && card2.effect === 'heal') { p2.hp = Math.min(p2.maxHp, p2.hp + card2.effectValue); msg2.push(`Healed for ${card2.effectValue} HP!`); }
  if (card1 && card1.effect === 'drain_stamina') { p2.stamina = Math.max(0, p2.stamina - card1.effectValue); msg1.push(`Drained ${card1.effectValue} Stamina!`); }
  if (card2 && card2.effect === 'drain_stamina') { p1.stamina = Math.max(0, p1.stamina - card2.effectValue); msg2.push(`Drained ${card2.effectValue} Stamina!`); }

  if (c1) p1.hand.push(dealHand(p1.username)[0]);
  if (c2) p2.hand.push(dealHand(p2.username)[0]);

  p1.stamina = Math.min(p1.maxStamina, p1.stamina + 10);
  p2.stamina = Math.min(p2.maxStamina, p2.stamina + 10);

  p1.playedCard = null; p1.playedIndex = -1;
  p2.playedCard = null; p2.playedIndex = -1;

  if (p1.hp <= 0 || p2.hp <= 0) {
    finishGame(room, 0, 0, null);
    return;
  }

  room.round++;
  [p1, p2].forEach((p, idx) => {
    const opp = idx === 0 ? p2 : p1;
    const myMsg = idx === 0 ? msg1 : msg2;
    const oppMsg = idx === 0 ? msg2 : msg1;
    const myDmg = idx === 0 ? finalDmg1 : finalDmg2;

    io.to(p.socketId).emit('round_result', {
      myCard: (idx === 0 ? c1 : c2)?.cardId || (idx === 0 ? c1 : c2), 
      opponentCard: (idx === 0 ? c2 : c1)?.cardId || (idx === 0 ? c2 : c1), 
      result: 'resolved', 
      myHp: p.hp, myMaxHp: p.maxHp, myStamina: p.stamina, myMaxStamina: p.maxStamina,
      oppHp: opp.hp, oppMaxHp: opp.maxHp, oppStamina: opp.stamina, oppMaxStamina: opp.maxStamina,
      myDraw: 1, newHand: [...p.hand], opponentCardCount: opp.hand.length,
      round: room.round, myPerkMessages: myMsg, oppPerkMessages: oppMsg,
      damageDealt: myDmg
    });
  });
}

function finishGame(room, draw1, draw2, reason) {
  room.state = 'finished';
  const [p1, p2] = room.players;
  let winner = null;
  if (p1.hp > 0 && p2.hp <= 0) winner = p1.username;
  else if (p2.hp > 0 && p1.hp <= 0) winner = p2.username;

  [p1, p2].forEach((p, idx) => {
    const opp   = idx === 0 ? p2 : p1;
    const isWin = winner === p.username, isTie = winner === null;
    const isLoss = !isWin && !isTie;
    let baseCoins  = reason === 'disconnect' ? 50 : isWin ? 100 : isTie ? 50 : 25;
    let baseXP = isWin ? 50 : 15;
    if (room.isBot) { baseCoins = isWin ? 50 : 10; baseXP = isWin ? 25 : 5; }
    
    const pd = getPlayer(p.username);
    pd.coins += baseCoins;
    
    if (p.socketId !== 'BOT') {
      pd.xp += baseXP;
      if (pd.xp >= pd.level * 100) { pd.level++; pd.xp = 0; pd.maxHp += 10; pd.maxStamina += 5; }
      if (isWin) { pd.wins++; trackWin(p.username); } else if (isLoss) pd.losses++; else pd.ties++;
      pd.deck.forEach(uuid => {
        const card = pd.collection[uuid];
        if (card) {
          card.xp += isWin ? 20 : 5;
          if (card.xp >= card.level * 100) { card.level++; card.xp = 0; }
        }
      });
    }
    pd.gamesPlayed++;
    const s = Array.from(io.sockets.sockets.values()).find(so => so.socketId === p.socketId);
    if (s) s.lastMatchCoins = baseCoins;

    if (room.isCampaign && isWin) {
      if (pd.campaignProgress === room.campaignStageIndex + 1) pd.campaignProgress++;
    }

    io.to(p.socketId).emit('game_over', {
      winner, reason: reason || null,
      myScore: p.hp, opponentScore: opp.hp,
      coinsEarned: baseCoins, xpEarned: baseXP,
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

  io.to(t.code).emit('tournament_bracket_update', { bracket: t.bracket, currentRound: t.currentRound });

  const currentRound = t.bracket[t.currentRound];
  if (!currentRound.every(m => m.done)) return;

  const winners = currentRound.map(m => m.winner).filter(Boolean);
  if (winners.length <= 1) { endTournament(t, winners[0] || currentRound[0].winner); return; }
  const nextRound = [];
  for (let i = 0; i < winners.length; i += 2) {
    if (winners[i+1]) nextRound.push({ p1: winners[i], p2: winners[i+1], winner: null, done: false, roomCode: null });
    else nextRound.push({ p1: winners[i], p2: null, winner: winners[i], done: true, roomCode: null });
  }
  t.bracket.push(nextRound); t.currentRound++;
  startTournamentRound(t);
}

function startTournamentRound(t) {
  io.to(t.code).emit('tournament_round_start', { round: t.currentRound + 1, bracket: t.bracket });
  t.bracket[t.currentRound].forEach((match, idx) => {
    if (match.done) return;
    const p1E = t.players.find(p => p.username === match.p1);
    const p2E = t.players.find(p => p.username === match.p2);
    if (!p1E || !p2E) return;

    for (const [, s] of io.sockets.sockets) {
      if (s.username === match.p1) p1E.socketId = s.id;
      if (s.username === match.p2) p2E.socketId = s.id;
    }

    const s1 = io.sockets.sockets.get(p1E.socketId);
    const s2 = io.sockets.sockets.get(p2E.socketId);
    if (!s1 || !s2) return;

    const room = makeRoom(p1E.socketId, match.p1);
    room.players.push({
      socketId: p2E.socketId, username: match.p2,
      hand: dealHand(match.p2), hp: 100, maxHp: 100, stamina: 30, maxStamina: 30,
      playedCard: null, playedIndex: -1, winStreak: 0,
    });
    room.state = 'playing'; room.tournamentCode = t.code; room.tournamentMatchIdx = idx;
    match.roomCode = room.code;
    s1.join(room.code); s2.join(room.code);

    [p1E, p2E].forEach((pe, pIdx) => {
      const sock = io.sockets.sockets.get(pe.socketId);
      const opp = pIdx === 0 ? p2E : p1E;
      const oppPd = getPlayer(opp.username);
      if (sock) sock.emit('game_start', {
        room: room.code, myIndex: pIdx, myHand: [...room.players[pIdx].hand],
        opponentName: oppPd.nickname || opp.username, opponentAvatar: oppPd.equippedAvatar || null,
        round: 1, maxRounds: 7, isTournament: true, tournamentCode: t.code,
        myHp: room.players[pIdx].hp, myMaxHp: room.players[pIdx].maxHp, myStamina: room.players[pIdx].stamina,
        oppHp: room.players[pIdx===0?1:0].hp, oppMaxHp: room.players[pIdx===0?1:0].maxHp,
      });
    });
  });
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

function endTournament(t, champion) {
  t.state = 'complete'; t.champion = champion;
  const pool = t.prizePool;
  const finalMatch = t.bracket[t.bracket.length - 1][0];
  const runnerUp = finalMatch.p1 === champion ? finalMatch.p2 : finalMatch.p1;
  const firstPrize = Math.floor(pool * 0.70), secondPrize = Math.floor(pool * 0.30);
  if (champion) { getPlayer(champion).coins += firstPrize; }
  if (runnerUp) { getPlayer(runnerUp).coins += secondPrize; }
  io.to(t.code).emit('tournament_over', { champion, tournamentCoinsEarned: 0, placement: null });
}

// ── Socket ────────────────────────────────────────────────────
io.on('connection', (socket) => {
  io.emit('online_count', { count: io.sockets.sockets.size });

  socket.on('register', ({ username }) => {
    if (!username || username.length < 2 || username.length > 20) return socket.emit('error', { message: 'Username 2–20 characters' });
    const pd = getPlayer(username.trim());
    socket.username = pd.username;
    emitPlayerData(socket);
  });

  socket.on('play_vs_bot', () => {
    if (!socket.username) return socket.emit('error', { message: 'Not registered' });
    const room = makeRoom(socket.id, socket.username);
    room.isBot = true;
    room.players.push({
      socketId: 'BOT', username: 'Gladiator Bot', avatar: 'Char 1',
      hand: dealHand('BOT'), hp: 80, maxHp: 80, stamina: 30, maxStamina: 30,
      playedCard: null, playedIndex: -1, winStreak: 0,
    });
    room.state = 'playing'; socket.join(room.code); socket.currentRoom = room.code;
    const p0 = room.players[0];
    io.to(socket.id).emit('game_start', {
      room: room.code, myIndex: 0, myHand: [...p0.hand],
      opponentName: 'Gladiator Bot', opponentAvatar: 'Char 1',
      round: 1, isTournament: false,
      myHp: p0.hp, myMaxHp: p0.maxHp, myStamina: p0.stamina,
      oppHp: 80, oppMaxHp: 80,
    });
  });

  socket.on('play_campaign_stage', ({ stageIndex }) => {
    const stage = CONFIG.CAMPAIGN_STAGES[stageIndex];
    if (!stage) return;
    const room = makeRoom(socket.id, socket.username);
    room.isBot = true; room.isCampaign = true; room.campaignStageIndex = stageIndex;
    room.players.push({
      socketId: 'BOT', username: stage.enemy, avatar: `Char ${6 + stageIndex}`,
      hand: stage.deck.map(id => ({ uuid: 'bot_'+id, cardId: id })),
      hp: stage.hp, maxHp: stage.hp, stamina: stage.stamina, maxStamina: stage.stamina,
      playedCard: null, playedIndex: -1,
    });
    room.state = 'playing'; socket.join(room.code); socket.currentRoom = room.code;
    const p0 = room.players[0];
    io.to(socket.id).emit('game_start', {
      room: room.code, myIndex: 0, myHand: [...p0.hand],
      opponentName: stage.enemy, opponentAvatar: `Char ${6 + stageIndex}`,
      round: 1, isCampaign: true,
      myHp: p0.hp, myMaxHp: p0.maxHp, myStamina: p0.stamina,
      oppHp: stage.hp, oppMaxHp: stage.hp,
    });
  });

  socket.on('find_match', () => {
    const pd = getPlayer(socket.username);
    const opponent = matchQueue.shift();
    if (opponent) {
      const oppSock = io.sockets.sockets.get(opponent.socketId);
      if (!oppSock) { matchQueue.push({ socketId: socket.id, username: socket.username }); return; }
      const room = makeRoom(socket.id, socket.username);
      const pd2 = getPlayer(opponent.username);
      room.players.push({
        socketId: opponent.socketId, username: opponent.username,
        hand: dealHand(opponent.username),
        hp: pd2.maxHp, maxHp: pd2.maxHp, stamina: pd2.maxStamina, maxStamina: pd2.maxStamina,
        playedCard: null, playedIndex: -1,
      });
      room.state = 'playing';
      socket.join(room.code); oppSock.join(room.code);
      socket.currentRoom = room.code; oppSock.currentRoom = room.code;
      room.players.forEach((p, idx) => {
        const opp = room.players[idx === 0 ? 1 : 0];
        const oppPd = getPlayer(opp.username);
        io.to(p.socketId).emit('game_start', {
          room: room.code, myIndex: idx, myHand: [...p.hand],
          opponentName: oppPd.nickname || opp.username, opponentAvatar: oppPd.equippedAvatar,
          round: 1, myHp: p.hp, myMaxHp: p.maxHp, oppHp: opp.hp, oppMaxHp: opp.maxHp,
        });
      });
    } else {
      matchQueue.push({ socketId: socket.id, username: socket.username });
      socket.emit('match_searching');
    }
  });

  socket.on('play_card', ({ cardIndex }) => {
    const room = rooms[socket.currentRoom];
    if (!room || room.state !== 'playing') return;
    const p = room.players.find(p => p.socketId === socket.id);
    if (!p || p.playedCard !== null) return;

    if (cardIndex >= 0 && cardIndex < p.hand.length) {
      p.playedIndex = cardIndex;
      p.playedCard = p.hand.splice(cardIndex, 1)[0];
    }
    
    const opp = room.players.find(p => p.username !== socket.username);
    if (opp && opp.socketId !== 'BOT') io.to(opp.socketId).emit('opponent_played');

    if (room.isBot && opp.socketId === 'BOT' && opp.playedCard === null) {
      const ridx = Math.floor(Math.random() * opp.hand.length);
      opp.playedCard = opp.hand.splice(ridx, 1)[0];
    }

    if (room.players.every(pl => pl.playedCard !== null || pl.hand.length === 0)) processRound(room);
  });

  socket.on('move_to_deck', ({ uuid }) => {
    const pd = getPlayer(socket.username);
    if (pd.deck.includes(uuid) || pd.deck.length >= 8) return;
    pd.spellBook = pd.spellBook.filter(id => id !== uuid);
    pd.deck.push(uuid);
    emitPlayerData(socket);
    saveDB();
  });

  socket.on('move_to_spellbook', ({ uuid }) => {
    const pd = getPlayer(socket.username);
    pd.deck = pd.deck.filter(id => id !== uuid);
    if (!pd.spellBook.includes(uuid)) pd.spellBook.push(uuid);
    emitPlayerData(socket);
    saveDB();
  });

  socket.on('purchase_card_pack', () => {
    const pd = getPlayer(socket.username);
    if (pd.coins < 200) return;
    pd.coins -= 200;
    const cards = Object.keys(CONFIG.BASE_CARDS);
    const cid = cards[Math.floor(Math.random() * cards.length)];
    const uuid = generateId();
    pd.collection[uuid] = { cardId: cid, xp: 0, level: 1, runes: [] };
    pd.spellBook.push(uuid);
    emitPlayerData(socket);
    saveDB();
  });

  socket.on('equip_avatar', ({ avatarId }) => {
    const pd = getPlayer(socket.username);
    pd.equippedAvatar = avatarId;
    emitPlayerData(socket);
    saveDB();
  });

  socket.on('disconnect', () => {
    const idx = matchQueue.findIndex(q => q.socketId === socket.id);
    if (idx >= 0) matchQueue.splice(idx, 1);
    io.emit('online_count', { count: io.sockets.sockets.size });
  });
});

function getFriendsList(username) {
  return (friends[username] || []).map(f => ({ username: f, nickname: getPlayer(f).nickname }));
}

function getFormattedPlayerData(p) {
  const today = new Date().toISOString().slice(0, 10);
  return { ...p, hasDailyReward: p.lastDailyRewardDate !== today && !p.username.startsWith('Guest_') };
}

function emitPlayerData(socket) {
  if (!socket.username) return;
  const p = getPlayer(socket.username);
  socket.emit('player_data', getFormattedPlayerData(p));
  socket.emit('registered', { playerData: p, shop: getShopData() });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 RPG server on port ${PORT}`));
