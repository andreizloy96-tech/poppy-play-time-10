const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

const MAP_SIZE = 40;
const MONSTER_SPEED = 5.5;
const WEBHOOK_URL = ''; // если хотите дискорд логи, вставьте сюда URL, иначе оставьте пустым
const WEBHOOK_SECRET = 'super_secret_123';

const GameState = { PLAYING: 'playing', GAME_OVER: 'game_over' };
let players = {};
let gameState = GameState.PLAYING;
let monsterState = {
    position: { x: 0, z: 0 },
    state: 'idle',
    stunnedUntil: 0,
    targetPlayerId: null
};
let items = [];
let weapon = { exists: true, position: { x: 0, z: 0 }, collectedBy: null };

function getRandomSpawnPosition() {
    const margin = 8;
    return { x: (Math.random() - 0.5) * (MAP_SIZE - margin) * 2, z: (Math.random() - 0.5) * (MAP_SIZE - margin) * 2 };
}
function getRandomItemPosition() {
    const margin = 5;
    return { x: (Math.random() - 0.5) * (MAP_SIZE - margin) * 2, z: (Math.random() - 0.5) * (MAP_SIZE - margin) * 2 };
}
function getRandomWeaponPosition() {
    const margin = 10;
    return { x: (Math.random() - 0.5) * (MAP_SIZE - margin) * 2, z: (Math.random() - 0.5) * (MAP_SIZE - margin) * 2 };
}

function initGame() {
    Object.keys(players).forEach(id => {
        players[id].position = getRandomSpawnPosition();
        players[id].rotation = 0;
        players[id].items = 0;
        players[id].gameOver = false;
        players[id].hasGun = false;
        players[id].ammo = 0;
        players[id].shotMonsterCount = 0;
    });
    items = [];
    for (let i = 0; i < 3; i++) items.push({ id: i, position: getRandomItemPosition(), collected: false });
    weapon = { exists: true, position: getRandomWeaponPosition(), collectedBy: null };
    monsterState = { position: { x: 0, z: 0 }, state: 'idle', stunnedUntil: 0, targetPlayerId: null };
    gameState = GameState.PLAYING;
    io.emit('game_state', gameState);
    io.emit('monster_state', monsterState);
    io.emit('items_update', items);
    io.emit('weapon_update', weapon);
    io.emit('players_update', players);
}

function endGame(winnerId = null) {
    if (gameState !== GameState.PLAYING) return;
    gameState = GameState.GAME_OVER;
    let ending = winnerId ? `Победитель: ${players[winnerId]?.name}` : "Все пойманы";
    io.emit('game_ended', { winner: winnerId ? players[winnerId].name : null, ending: ending });
    io.emit('game_state', gameState);
    setTimeout(() => { initGame(); }, 10000);
}

function handleCollectItem(playerId, itemId) {
    if (gameState !== GameState.PLAYING) return false;
    const player = players[playerId];
    const item = items.find(i => i.id === itemId);
    if (!player || !item || item.collected || player.gameOver) return false;
    const dx = player.position.x - item.position.x;
    const dz = player.position.z - item.position.z;
    if (Math.hypot(dx, dz) < 2.0) {
        item.collected = true;
        player.items++;
        io.emit('item_collected', { playerId, itemId, playerItems: player.items });
        io.emit('items_update', items);
        io.emit('players_update', players);
        if (player.items === 3) endGame(playerId);
        return true;
    }
    return false;
}

function handlePickupWeapon(playerId) {
    if (gameState !== GameState.PLAYING) return false;
    const player = players[playerId];
    if (!player || !weapon.exists || weapon.collectedBy) return false;
    const dx = player.position.x - weapon.position.x;
    const dz = player.position.z - weapon.position.z;
    if (Math.hypot(dx, dz) < 2.0) {
        weapon.exists = false;
        weapon.collectedBy = playerId;
        player.hasGun = true;
        player.ammo = 3;
        io.emit('weapon_update', weapon);
        io.emit('players_update', players);
        io.emit('weapon_picked', { playerId, ammo: player.ammo });
        return true;
    }
    return false;
}

function handleShoot(playerId) {
    if (gameState !== GameState.PLAYING) return false;
    const player = players[playerId];
    if (!player || !player.hasGun || player.ammo <= 0 || player.gameOver) return false;
    const dx = player.position.x - monsterState.position.x;
    const dz = player.position.z - monsterState.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 8.0) {
        player.ammo--;
        player.shotMonsterCount++;
        io.emit('players_update', players);
        io.emit('shot_fired', { playerId, ammoLeft: player.ammo, hit: true });
        const now = Date.now();
        monsterState.stunnedUntil = now + 5000;
        monsterState.state = 'stunned';
        io.emit('monster_state', monsterState);
        if (player.ammo === 0) player.hasGun = false;
        return true;
    } else {
        io.emit('shot_fired', { playerId, ammoLeft: player.ammo, hit: false });
        return false;
    }
}

function updateMonster(deltaTime) {
    if (gameState !== GameState.PLAYING) return;
    const now = Date.now();
    if (monsterState.stunnedUntil > now) {
        if (monsterState.state !== 'stunned') { monsterState.state = 'stunned'; io.emit('monster_state', monsterState); }
        return;
    } else if (monsterState.state === 'stunned') {
        monsterState.state = 'idle';
        io.emit('monster_state', monsterState);
    }
    const alivePlayers = Object.values(players).filter(p => !p.gameOver);
    if (alivePlayers.length === 0) return;
    let closest = null, closestDist = Infinity;
    alivePlayers.forEach(p => {
        const d = Math.hypot(p.position.x - monsterState.position.x, p.position.z - monsterState.position.z);
        if (d < closestDist) { closestDist = d; closest = p; }
    });
    if (closest) {
        monsterState.state = 'chase';
        monsterState.targetPlayerId = closest.id;
        const dx = closest.position.x - monsterState.position.x;
        const dz = closest.position.z - monsterState.position.z;
        const len = Math.hypot(dx, dz);
        if (len > 0.1) {
            const move = MONSTER_SPEED * deltaTime;
            const stepX = (dx / len) * move;
            const stepZ = (dz / len) * move;
            monsterState.position.x += stepX;
            monsterState.position.z += stepZ;
            const limit = MAP_SIZE - 2;
            monsterState.position.x = Math.min(limit, Math.max(-limit, monsterState.position.x));
            monsterState.position.z = Math.min(limit, Math.max(-limit, monsterState.position.z));
        }
        if (Math.hypot(closest.position.x - monsterState.position.x, closest.position.z - monsterState.position.z) < 1.5 && !closest.gameOver && monsterState.stunnedUntil <= now) {
            closest.gameOver = true;
            io.emit('player_caught', { playerId: closest.id, playerName: closest.name });
            io.emit('players_update', players);
            const stillAlive = Object.values(players).some(p => !p.gameOver);
            if (!stillAlive) endGame(null);
        }
    } else {
        monsterState.state = 'idle';
        monsterState.targetPlayerId = null;
    }
    io.emit('monster_state', monsterState);
}

// Webhook для троллинга (тот же, что и раньше)
app.post('/webhook', (req, res) => {
    const { token, action, target, value, x, z } = req.body;
    if (token !== WEBHOOK_SECRET) return res.status(403).json({ error: "Invalid token" });
    const player = Object.values(players).find(p => p.name === target);
    if (!player) return res.status(404).json({ error: "Player not found" });
    switch(action) {
        case 'kill': player.gameOver = true; io.emit('player_caught', { playerId: player.id, playerName: player.name }); io.emit('players_update', players); break;
        case 'yeet': player.position.y = 10; io.emit('player_moved', { playerId: player.id, position: player.position, rotation: player.rotation }); break;
        case 'teleport': player.position.x = (x !== undefined) ? x : (Math.random() - 0.5) * MAP_SIZE; player.position.z = (z !== undefined) ? z : (Math.random() - 0.5) * MAP_SIZE; io.emit('player_moved', { playerId: player.id, position: player.position, rotation: player.rotation }); break;
        case 'strip': player.hasGun = false; player.ammo = 0; player.items = 0; io.emit('players_update', players); break;
        case 'stun': player.stunnedUntil = Date.now() + (value || 3000); break;
        case 'heal': player.gameOver = false; player.items = 3; player.hasGun = true; player.ammo = 3; io.emit('players_update', players); endGame(player.id); break;
        case 'set_items': player.items = Math.min(3, Math.max(0, value || 0)); io.emit('players_update', players); break;
        default: return res.status(400).json({ error: "Unknown action" });
    }
    res.json({ success: true, action, target });
});

io.on('connection', (socket) => {
    players[socket.id] = {
        id: socket.id,
        name: `Игрок${Object.keys(players).length+1}`,
        position: getRandomSpawnPosition(),
        rotation: 0,
        items: 0,
        gameOver: false,
        hasGun: false,
        ammo: 0,
        shotMonsterCount: 0
    };
    socket.emit('game_state', gameState);
    socket.emit('monster_state', monsterState);
    socket.emit('items_update', items);
    socket.emit('weapon_update', weapon);
    socket.emit('players_update', players);
    socket.emit('player_id', socket.id);
    socket.broadcast.emit('player_joined', { playerId: socket.id, player: players[socket.id] });
    
    socket.on('change_name', (newName) => { if(players[socket.id] && newName.trim()) players[socket.id].name = newName.trim().substring(0,20); io.emit('players_update', players); });
    socket.on('collect_item', (itemId) => handleCollectItem(socket.id, itemId));
    socket.on('pickup_weapon', () => handlePickupWeapon(socket.id));
    socket.on('shoot_monster', () => handleShoot(socket.id));
    socket.on('player_move', (data) => {
        if(players[socket.id] && !players[socket.id].gameOver) {
            const limit = MAP_SIZE - 1.5;
            data.position.x = Math.min(limit, Math.max(-limit, data.position.x));
            data.position.z = Math.min(limit, Math.max(-limit, data.position.z));
            players[socket.id].position = data.position;
            players[socket.id].rotation = data.rotation;
            socket.broadcast.emit('player_moved', { playerId: socket.id, position: players[socket.id].position, rotation: players[socket.id].rotation });
        }
    });
    socket.on('chat_message', (msg) => { if(players[socket.id] && msg.trim()) io.emit('chat_message', { playerId: socket.id, playerName: players[socket.id].name, message: msg.trim() }); });
    socket.on('disconnect', () => {
        if(players[socket.id]) delete players[socket.id];
        io.emit('player_left', { playerId: socket.id });
        io.emit('players_update', players);
        if(Object.keys(players).length === 0) initGame();
    });
});

let lastTime = Date.now();
setInterval(() => {
    const now = Date.now();
    let delta = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    updateMonster(delta);
}, 1000/60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Сервер на порту ${PORT}`); initGame(); });
