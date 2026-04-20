// Shared Configuration for Server & Client
const CONFIG = {
  ELEMENTS: {
    // Octagon cycle: Water > Fire > Earth > Air > Arcane > Dark > Light > Physical > Water
    water:    { name: 'Water',    color: '#3498db', icon: '💧', strongAgainst: ['fire'], weakAgainst: ['physical'] },
    fire:     { name: 'Fire',     color: '#e74c3c', icon: '🔥', strongAgainst: ['earth'], weakAgainst: ['water'] },
    earth:    { name: 'Earth',    color: '#27ae60', icon: '🪨', strongAgainst: ['air'], weakAgainst: ['fire'] },
    air:      { name: 'Air',      color: '#ecf0f1', icon: '💨', strongAgainst: ['arcane'], weakAgainst: ['earth'] },
    arcane:   { name: 'Arcane',   color: '#9b59b6', icon: '🔮', strongAgainst: ['dark'], weakAgainst: ['air'] },
    dark:     { name: 'Dark',     color: '#2c3e50', icon: '🌑', strongAgainst: ['light'], weakAgainst: ['arcane'] },
    light:    { name: 'Light',    color: '#f1c40f', icon: '✨', strongAgainst: ['physical'], weakAgainst: ['dark'] },
    physical: { name: 'Physical', color: '#95a5a6', icon: '⚔️', strongAgainst: ['water'], weakAgainst: ['light'] }
  },

  BASE_CARDS: {
    // Water
    water_splash: { id: 'water_splash', name: 'Splash', type: 'water', rarity: 'common', baseDmg: 10, baseBlock: 0, cost: 5, effect: null, desc: 'A basic water attack.' },
    healing_rain: { id: 'healing_rain', name: 'Healing Rain', type: 'water', rarity: 'rare', baseDmg: 5, baseBlock: 5, cost: 10, effect: 'heal', effectValue: 10, desc: 'Heals you for 10 HP.' },
    // Fire
    fire_punch: { id: 'fire_punch', name: 'Fire Punch', type: 'fire', rarity: 'common', baseDmg: 12, baseBlock: 0, cost: 6, effect: null, desc: 'A basic fire attack.' },
    fireball: { id: 'fireball', name: 'Fireball', type: 'fire', rarity: 'rare', baseDmg: 18, baseBlock: 0, cost: 12, effect: 'burn', effectValue: 3, desc: 'Applies burn for 3 damage/turn.' },
    // Earth
    rock_throw: { id: 'rock_throw', name: 'Rock Throw', type: 'earth', rarity: 'common', baseDmg: 8, baseBlock: 5, cost: 5, effect: null, desc: 'A sturdy earth attack.' },
    stone_wall: { id: 'stone_wall', name: 'Stone Wall', type: 'earth', rarity: 'rare', baseDmg: 0, baseBlock: 20, cost: 10, effect: null, desc: 'Massive block increase.' },
    // Air
    wind_slash: { id: 'wind_slash', name: 'Wind Slash', type: 'air', rarity: 'common', baseDmg: 9, baseBlock: 2, cost: 4, effect: null, desc: 'A swift air attack.' },
    tornado: { id: 'tornado', name: 'Tornado', type: 'air', rarity: 'rare', baseDmg: 15, baseBlock: 0, cost: 12, effect: 'draw', effectValue: 1, desc: 'Draws an extra card.' },
    // Arcane
    magic_missile: { id: 'magic_missile', name: 'Magic Missile', type: 'arcane', rarity: 'common', baseDmg: 11, baseBlock: 0, cost: 5, effect: null, desc: 'A basic arcane attack.' },
    mana_drain: { id: 'mana_drain', name: 'Mana Drain', type: 'arcane', rarity: 'epic', baseDmg: 5, baseBlock: 0, cost: 8, effect: 'drain_stamina', effectValue: 5, desc: 'Drains 5 stamina from opponent.' },
    // Dark
    shadow_strike: { id: 'shadow_strike', name: 'Shadow Strike', type: 'dark', rarity: 'common', baseDmg: 14, baseBlock: 0, cost: 7, effect: null, desc: 'A swift dark attack.' },
    life_leech: { id: 'life_leech', name: 'Life Leech', type: 'dark', rarity: 'epic', baseDmg: 8, baseBlock: 0, cost: 10, effect: 'lifesteal', effectValue: 1.0, desc: 'Heals for 100% of damage dealt.' },
    // Light
    holy_smite: { id: 'holy_smite', name: 'Holy Smite', type: 'light', rarity: 'common', baseDmg: 12, baseBlock: 2, cost: 6, effect: null, desc: 'A basic light attack.' },
    blinding_light: { id: 'blinding_light', name: 'Blinding Light', type: 'light', rarity: 'rare', baseDmg: 5, baseBlock: 0, cost: 9, effect: 'lower_damage', effectValue: 5, desc: 'Lowers opponent next damage by 5.' },
    // Physical
    sword_slash: { id: 'sword_slash', name: 'Sword Slash', type: 'physical', rarity: 'common', baseDmg: 13, baseBlock: 0, cost: 6, effect: null, desc: 'A basic physical attack.' },
    shield_bash: { id: 'shield_bash', name: 'Shield Bash', type: 'physical', rarity: 'rare', baseDmg: 6, baseBlock: 12, cost: 8, effect: null, desc: 'Blocks and deals damage.' }
  },

  RUNES: {
    sharpness: { id: 'sharpness', name: 'Rune of Sharpness', type: 'damage_up', value: 3, cost: 200, desc: '+3 Base Damage' },
    vitality: { id: 'vitality', name: 'Rune of Vitality', type: 'hp_up', value: 10, cost: 300, desc: '+10 Max HP for Hero' },
    endurance: { id: 'endurance', name: 'Rune of Endurance', type: 'stamina_up', value: 5, cost: 300, desc: '+5 Max Stamina' }
  },

  CAMPAIGN_STAGES: [
    { id: 1, name: 'Stage 1: Forest Edge', description: 'A goblin scout blocks the path.', enemy: 'Goblin Scout', opponentHp: 30, hp: 30, stamina: 20, deck: ['rock_throw', 'sword_slash'] },
    { id: 2, name: 'Stage 2: Deep Thicket', description: 'A hulking troll guards the trail.', enemy: 'Woodland Troll', opponentHp: 50, hp: 50, stamina: 30, deck: ['rock_throw', 'stone_wall', 'water_splash'] },
    { id: 3, name: 'Stage 3: River Crossing', description: 'A water spirit rises from the stream.', enemy: 'Water Spirit', opponentHp: 60, hp: 60, stamina: 40, deck: ['water_splash', 'healing_rain'] },
    { id: 4, name: 'Stage 4: Cave Entrance', description: 'A rogue apprentice stands guard.', enemy: 'Rogue Apprentice', opponentHp: 80, hp: 80, stamina: 50, deck: ['fire_punch', 'magic_missile', 'shadow_strike'] },
    { id: 5, name: 'Stage 5: The Dark Lair', description: 'The Kidnapper Mage awaits your final challenge!', enemy: 'Kidnapper Mage', opponentHp: 150, hp: 150, stamina: 80, deck: ['fireball', 'mana_drain', 'life_leech', 'blinding_light'] }
  ]
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
