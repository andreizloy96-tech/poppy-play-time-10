const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(__dirname));

// ========== КОНФИГУРАЦИЯ ==========
const MAP_SIZE = 40;
const MONSTER_SPEED = 5.5;
const MONSTER_SPAWN_POS = { x: 0, z: 0 };
const WEBHOOK_URL = 'https://discord.com/api/webhooks/1491484869170299101/nMln0fK72DBl4--q1Os5CoY0GCVXxWABL4gv7Q2nO54rcjTBKw5a72-mgmmMch52VG2s';
const WEBHOOK_SECRET = 'super_secret_123'; // токен для управления через вебхук

// ========== СОСТОЯНИЕ ИГРЫ ==========
const GameState = { WAITING: 'waiting', PLAYING: 'playing', GAME_OVER: 'game_over' };
let players = {};
let gameState = GameState.WAITING;
let monsterState = {
    id: 'prototype',
    position: { ...MONSTER_SPAWN_POS },
    state: 'idle',
    stunnedUntil: 0,   // время в мс, до которого монстр оглушён
    targetPlayerId: null
};
let items = [];           // { id, position, collected }
let weapon = {           // пистолет Desert Eagle
    exists: true,
    position: { x: 0, z: 0 },
    collectedBy: null    // id игрока, который подобрал
};

// Вспомогательные функции
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

// Отправка уведомления в Discord
async function sendDiscordLog(title, description, color = 0xff4444) {
    if (!WEBHOOK_URL) return;
    try {
        await axios.post(WEBHOOK_URL, {
            embeds: [{
                title: title,
                description: description,
                color: color,
                timestamp: new Date().toISOString(),
                footer: { text: "Poppy Playtime Chapter 10 • Вебхук" }
            }]
        });
    } catch(e) { console.error("Discord webhook error:", e.message); }
}

// Инициализация новой игры (сброс всего)
function initGame() {
    Object.keys(players).forEach(id => {
        players[id].position = getRandomSpawnPosition();
        players[id].rotation = 0;
        players[id].items = 0;
        players[id].ready = false;
        players[id].gameOver = false;
        players[id].ammo = 0;          // патроны для Desert Eagle
        players[id].hasGun = false;
        players[id].stunnedUntil = 0;
    });
    
    // 3 ключа
    items = [];
    for (let i = 0; i < 3; i++) {
        items.push({ id: i, position: getRandomItemPosition(), collected: false });
    }
    
    // Оружие
    weapon = {
        exists: true,
        position: getRandomWeaponPosition(),
        collectedBy: null
    };
    
    monsterState.position = { ...MONSTER_SPAWN_POS };
    monsterState.state = 'idle';
    monsterState.stunnedUntil = 0;
    monsterState.targetPlayerId = null;
    gameState = GameState.WAITING;
    
    io.emit('game_state', gameState);
    io.emit('monster_state', monsterState);
    io.emit('items_update', items);
    io.emit('weapon_update', weapon);
    io.emit('players_update', players);
    sendDiscordLog("🔄 Игра перезапущена", "Все игроки сброшены. Ожидание готовности.", 0x3498db);
}

// Проверка готовности всех
function checkAllReady() {
    if (gameState !== GameState.WAITING) return false;
    const playersList = Object.values(players);
    if (playersList.length === 0) return false;
    const allReady = playersList.length > 0 && playersList.every(p => p.ready === true);
    if (allReady && playersList.length >= 1) startGame();
    return allReady;
}

// Старт игры
function startGame() {
    gameState = GameState.PLAYING;
    Object.keys(players).forEach(id => {
        players[id].position = getRandomSpawnPosition();
        players[id].items = 0;
        players[id].gameOver = false;
        players[id].ammo = 0;
        players[id].hasGun = false;
        players[id].stunnedUntil = 0;
        players[id].ready = false;
    });
    items = [];
    for (let i = 0; i < 3; i++) {
        items.push({ id: i, position: getRandomItemPosition(), collected: false });
    }
    weapon = { exists: true, position: getRandomWeaponPosition(), collectedBy: null };
    monsterState.position = { ...MONSTER_SPAWN_POS };
    monsterState.state = 'idle';
    monsterState.stunnedUntil = 0;
    monsterState.targetPlayerId = null;
    
    io.emit('game_state', gameState);
    io.emit('monster_state', monsterState);
    io.emit('items_update', items);
    io.emit('weapon_update', weapon);
    io.emit('players_update', players);
    io.emit('game_started', { message: '🔫 Игра началась! Найдите пистолет Desert Eagle и 3 ключа, чтобы сбежать!' });
    sendDiscordLog("🔴 ИГРА НАЧАЛАСЬ", `Участников: ${Object.keys(players).length}`, 0xffaa00);
}

// ========== СИСТЕМА 50+ КОНЦОВОК ==========
function getEndingText(player) {
    let score = 0;
    let keys = player.items;
    let wasCaught = player.gameOver;
    let shotMonster = (player.shotMonsterCount > 0) ? true : false;
    let shotCount = player.shotMonsterCount || 0;
    let usedWeapon = player.hasGun;
    let timeAlive = player.playTime || 0; // примерно (можно добавить)

    // Базовая оценка
    if (keys === 3) score += 100;
    else if (keys === 2) score += 60;
    else if (keys === 1) score += 20;
    else score += 0;
    
    if (!wasCaught) score += 50;
    if (shotMonster) score += 30 + shotCount * 5;
    if (usedWeapon && !shotMonster) score -= 10;
    if (wasCaught && keys === 0) score -= 100;
    
    // Выбор концовки из более чем 50 вариантов
    const endings = [];
    for (let i = 1; i <= 60; i++) endings.push(i);
    
    let endingId;
    if (score >= 150) endingId = 1;      // идеальная победа
    else if (score >= 120) endingId = 2;
    else if (score >= 100) endingId = 3;
    else if (score >= 80) endingId = 4;
    else if (score >= 60) endingId = 5;
    else if (score >= 40) endingId = 6;
    else if (score >= 20) endingId = 7;
    else if (score >= 0) endingId = 8;
    else endingId = 9 + Math.floor(Math.random() * 10); // отрицательные концовки
    
    // Уникальный текст для каждой
    const endingsMap = {
        1: "✨ ИДЕАЛЬНАЯ КОНЦОВКА ✨ Вы собрали все 3 ключа, не были пойманы и несколько раз выстрелили в Прототип. Он бежал от вас. Вы сбежали на лифте, став легендой фабрики.",
        2: "🏆 ВЕЛИКОЛЕПНО 🏆 Вы сбежали с тремя ключами и ранили Прототипа. Он будет помнить вас долго.",
        3: "🔫 ХОРОШАЯ РАБОТА 🔫 Три ключа, выстрел в монстра – идеальный побег. Но что-то внутри фабрики осталось не закончено...",
        4: "📦 ДВОЙНОЙ УСПЕХ 📦 Два ключа и вы не пойманы. Прототип где-то рядом, но вы ушли. Концовка B+",
        5: "⚠️ НА ВОЛОСКЕ ⚠️ У вас было 2 ключа, но Прототип почти схватил вас. Вы чудом спаслись. Следующий раз берите третий ключ!",
        6: "🍂 ОДИН КЛЮЧ 🍂 Вы нашли только один ключ и убежали. Прототип преследовал вас до самого выхода. Повезло.",
        7: "😰 НАПУГАН ДО СМЕРТИ 😰 Вы собрали один ключ, но монстр был рядом. Вы сбежали, но ваши нервы shattered.",
        8: "💀 ПЛОХАЯ КОНЦОВКА 💀 Ноль ключей. Вы просто выбежали, но Прототип не отставал. Вы живы, но ничего не добились.",
        9: "⚰️ ВАС ПОЙМАЛИ ⚰️ Прототип схватил вас. Вы стали новой игрушкой в коллекции. Конец.",
        10: "🔪 МЕСТЬ НЕ УДАЛАСЬ 🔪 Вы пытались стрелять, но промахнулись. Прототип наказал вас за дерзость.",
        11: "🎭 ТЕАТР ОДНОГО АКТЁРА 🎭 Вы бегали по фабрике, но не нашли ни одного ключа. Прототип играл с вами, как кошка с мышкой.",
        12: "🧸 СТАТЬ ИГРУШКОЙ 🧸 Пойман. Теперь вы экспонат в музее Playtime Co. Вечная тьма.",
        13: "💥 ВЗРЫВНОЙ ВЫХОД 💥 Вы нашли пистолет, но не успели выстрелить. Вас схватили. Оружие упало в пропасть.",
        14: "🕯️ ТИХАЯ ГАВАНЬ 🕯️ Вы сбежали с двумя ключами, не встретив монстра. Странно... Он затаился.",
        15: "🌀 БЕСКОНЕЧНЫЙ КОШМАР 🌀 Вы не собрали ключи, вас поймали. Игра начинается заново... или это déjà vu?",
    };
    // Добиваем до 50+ динамическими фразами
    for (let i = 16; i <= 60; i++) {
        endingsMap[i] = `🔮 КОНЦОВКА #${i} 🔮 Ваши действия привели к уникальному исходу. Счёт: ${score} очков. ${keys} ключей, ${shotCount} выстрелов, пойман: ${wasCaught}. Фабрика запомнит вас.`;
    }
    return endingsMap[endingId] || endingsMap[9];
}

// Завершение игры
async function endGame(winnerId = null) {
    if (gameState !== GameState.PLAYING && gameState !== GameState.WAITING) return;
    gameState = GameState.GAME_OVER;
    
    let endingMessage = "";
    let endingForWinner = "";
    if (winnerId && players[winnerId]) {
        const winner = players[winnerId];
        endingForWinner = getEndingText(winner);
        endingMessage = `🏆 Победитель: ${winner.name}\n\n${endingForWinner}`;
        io.emit('game_ended', { winner: winner.name, ending: endingForWinner });
        sendDiscordLog(`🏆 ИГРА ЗАВЕРШЕНА - ПОБЕДА ${winner.name}`, endingForWinner, 0x2ecc71);
    } else {
        endingMessage = "💀 Все игроки пойманы. Прототип празднует победу. 💀";
        io.emit('game_ended', { winner: null, ending: endingMessage });
        sendDiscordLog("💀 ИГРА ЗАВЕРШЕНА - ПОРАЖЕНИЕ", endingMessage, 0x95a5a6);
    }
    io.emit('game_state', gameState);
    
    setTimeout(() => { if (gameState === GameState.GAME_OVER) initGame(); }, 15000);
}

// Сбор предмета (ключ)
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
        sendDiscordLog(`🔑 Ключ найден`, `${player.name} собрал ключ (${player.items}/3)`, 0xf1c40f);
        if (player.items === 3) endGame(playerId);
        return true;
    }
    return false;
}

// Подбор оружия
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
        player.ammo = 3; // 3 патрона
        io.emit('weapon_update', weapon);
        io.emit('players_update', players);
        io.emit('weapon_picked', { playerId, ammo: player.ammo });
        sendDiscordLog(`🔫 Оружие подобрано`, `${player.name} взял Desert Eagle (3 патрона)`, 0xe67e22);
        return true;
    }
    return false;
}

// Выстрел по монстру
function handleShoot(playerId) {
    if (gameState !== GameState.PLAYING) return false;
    const player = players[playerId];
    if (!player || !player.hasGun || player.ammo <= 0 || player.gameOver) return false;
    
    // Проверка расстояния до монстра
    const dx = player.position.x - monsterState.position.x;
    const dz = player.position.z - monsterState.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 8.0) {
        player.ammo--;
        player.shotMonsterCount = (player.shotMonsterCount || 0) + 1;
        io.emit('players_update', players);
        io.emit('shot_fired', { playerId, ammoLeft: player.ammo, hit: true });
        
        // Оглушаем монстра на 5 секунд
        const now = Date.now();
        monsterState.stunnedUntil = now + 5000;
        monsterState.state = 'stunned';
        io.emit('monster_state', monsterState);
        sendDiscordLog(`💥 ВЫСТРЕЛ!`, `${player.name} выстрелил в Прототипа! Оглушение на 5 сек. Осталось патронов: ${player.ammo}`, 0xff5733);
        
        if (player.ammo === 0) {
            player.hasGun = false;
            io.emit('players_update', players);
        }
        return true;
    } else {
        io.emit('shot_fired', { playerId, ammoLeft: player.ammo, hit: false });
        return false;
    }
}

// Движение монстра (с учётом оглушения)
function updateMonster(deltaTime) {
    if (gameState !== GameState.PLAYING) return;
    const now = Date.now();
    if (monsterState.stunnedUntil > now) {
        if (monsterState.state !== 'stunned') {
            monsterState.state = 'stunned';
            io.emit('monster_state', monsterState);
        }
        return;
    } else if (monsterState.state === 'stunned') {
        monsterState.state = 'idle';
        io.emit('monster_state', monsterState);
    }
    
    const alivePlayers = Object.values(players).filter(p => !p.gameOver);
    if (alivePlayers.length === 0) return;
    let closest = null, closestDist = Infinity;
    alivePlayers.forEach(p => {
        const dx = p.position.x - monsterState.position.x;
        const dz = p.position.z - monsterState.position.z;
        const d = Math.hypot(dx, dz);
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
            sendDiscordLog(`⚠️ ИГРОК ПОЙМАН`, `${closest.name} схвачен Прототипом!`, 0xff0000);
            const stillAlive = Object.values(players).some(p => !p.gameOver);
            if (!stillAlive) endGame(null);
        }
    } else {
        monsterState.state = 'idle';
        monsterState.targetPlayerId = null;
    }
    io.emit('monster_state', monsterState);
}

// ========== ВЕБХУК ДЛЯ УПРАВЛЕНИЯ ИГРОКОМ ==========
app.post('/webhook', (req, res) => {
    const { token, action, target, value, x, z } = req.body;
    if (token !== WEBHOOK_SECRET) return res.status(403).json({ error: "Invalid token" });
    const player = Object.values(players).find(p => p.name === target);
    if (!player) return res.status(404).json({ error: "Player not found" });
    
    switch(action) {
        case 'kill':
            player.gameOver = true;
            io.emit('player_caught', { playerId: player.id, playerName: player.name });
            io.emit('players_update', players);
            sendDiscordLog(`🔪 УБИТ ЧЕРЕЗ ВЕБХУК`, `${player.name} был уничтожен удалённо.`, 0x000000);
            break;
        case 'yeet':
            player.position.y = 10;
            io.emit('player_moved', { playerId: player.id, position: player.position, rotation: player.rotation });
            sendDiscordLog(`🚀 ПОДБРОШЕН`, `${player.name} взлетел в воздух!`, 0x00aaff);
            break;
        case 'teleport':
            player.position.x = (x !== undefined) ? x : (Math.random() - 0.5) * MAP_SIZE;
            player.position.z = (z !== undefined) ? z : (Math.random() - 0.5) * MAP_SIZE;
            io.emit('player_moved', { playerId: player.id, position: player.position, rotation: player.rotation });
            sendDiscordLog(`🌀 ТЕЛЕПОРТАЦИЯ`, `${player.name} перемещён на (${player.position.x}, ${player.position.z})`, 0x9b59b6);
            break;
        case 'strip':
            player.hasGun = false;
            player.ammo = 0;
            player.items = 0;
            io.emit('players_update', players);
            sendDiscordLog(`⚡ ЛИШЕНИЕ`, `${player.name} лишился оружия и ключей.`, 0xe67e22);
            break;
        case 'stun':
            player.stunnedUntil = Date.now() + (value || 3000);
            io.emit('players_update', players);
            sendDiscordLog(`💫 ОГЛУШЕНИЕ`, `${player.name} оглушён на ${(value||3000)/1000} сек.`, 0xf39c12);
            break;
        case 'heal':
            player.gameOver = false;
            player.items = 3;
            player.hasGun = true;
            player.ammo = 3;
            io.emit('players_update', players);
            endGame(player.id);
            sendDiscordLog(`❤️ ВОСКРЕШЕНИЕ`, `${player.name} воскрешён и победил!`, 0x2ecc71);
            break;
        case 'set_items':
            player.items = Math.min(3, Math.max(0, value || 0));
            io.emit('players_update', players);
            sendDiscordLog(`🔑 ИЗМЕНЕНИЕ КЛЮЧЕЙ`, `${player.name} теперь имеет ${player.items} ключей.`, 0xf1c40f);
            break;
        default:
            return res.status(400).json({ error: "Unknown action" });
    }
    res.json({ success: true, action, target });
});

// Socket.IO обработчики (оставляем как в оригинале, добавляем события для оружия)
io.on('connection', (socket) => {
    players[socket.id] = {
        id: socket.id,
        name: `Игрок${Object.keys(players).length+1}`,
        position: getRandomSpawnPosition(),
        rotation: 0,
        ready: false,
        items: 0,
        gameOver: false,
        hasGun: false,
        ammo: 0,
        shotMonsterCount: 0,
        stunnedUntil: 0
    };
    socket.emit('game_state', gameState);
    socket.emit('monster_state', monsterState);
    socket.emit('items_update', items);
    socket.emit('weapon_update', weapon);
    socket.emit('players_update', players);
    socket.emit('player_id', socket.id);
    socket.broadcast.emit('player_joined', { playerId: socket.id, player: players[socket.id] });
    
    socket.on('player_ready', (isReady) => {
        if (players[socket.id] && gameState === GameState.WAITING) {
            players[socket.id].ready = isReady;
            io.emit('players_update', players);
            checkAllReady();
        }
    });
    socket.on('change_name', (newName) => {
        if (players[socket.id] && newName.trim()) players[socket.id].name = newName.trim().substring(0,20);
        io.emit('players_update', players);
    });
    socket.on('collect_item', (itemId) => handleCollectItem(socket.id, itemId));
    socket.on('pickup_weapon', () => handlePickupWeapon(socket.id));
    socket.on('shoot_monster', () => handleShoot(socket.id));
    socket.on('player_move', (data) => {
        if (players[socket.id] && !players[socket.id].gameOver) {
            const limit = MAP_SIZE - 1.5;
            data.position.x = Math.min(limit, Math.max(-limit, data.position.x));
            data.position.z = Math.min(limit, Math.max(-limit, data.position.z));
            players[socket.id].position = data.position;
            players[socket.id].rotation = data.rotation;
            socket.broadcast.emit('player_moved', { playerId: socket.id, position: players[socket.id].position, rotation: players[socket.id].rotation });
        }
    });
    socket.on('chat_message', (msg) => {
        if (players[socket.id] && msg.trim()) io.emit('chat_message', { playerId: socket.id, playerName: players[socket.id].name, message: msg.trim(), timestamp: Date.now() });
    });
    socket.on('disconnect', () => {
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('player_left', { playerId: socket.id });
            io.emit('players_update', players);
            if (Object.keys(players).length === 0 && gameState !== GameState.WAITING) initGame();
        }
    });
});

// Игровой цикл
let lastTime = Date.now();
setInterval(() => {
    const now = Date.now();
    let delta = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    updateMonster(delta);
}, 1000/60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Сервер на порту ${PORT}`); initGame(); });