// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const gameEngine = require('./game-engine');
const maps = require('./maps');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));
app.get('/maps.js', (req, res) => res.sendFile(path.join(__dirname, 'maps.js')));
app.get('/environment.js', (req, res) => res.sendFile(path.join(__dirname, 'environment.js')));
app.get('/map-builder.js', (req, res) => res.sendFile(path.join(__dirname, 'map-builder.js')));

const activeRooms = new Map();
const activeLobbies = {};

function genCode() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }
function broadcastLobby(roomCode) { io.to(roomCode).emit('lobby-update', activeLobbies[roomCode]); }

let availableIcons = [];
const iconsDir = path.join(__dirname, 'public', 'icons');
if (fs.existsSync(iconsDir)) { availableIcons = fs.readdirSync(iconsDir).filter(file => file.endsWith('.svg')); }
function getRandomIcons(count) {
    if (availableIcons.length === 0) return [];
    let shuffled = [...availableIcons].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

const PALETTE = ['#b4d455', '#ff3366', '#6dcbc3', '#ffd700', '#ff8c00', '#d44a8e'];

function applyDefaultColors(lobby) {
    let count = lobby.maxTanks;
    for (let i = 1; i <= count; i++) {
        let conf = lobby.tankConfigs[`tank${i}`];
        if (!conf) {
            conf = { chassis: 0, treads: 0, turret: 0, barrel: 0, c1: '', c2: '' };
            lobby.tankConfigs[`tank${i}`] = conf;
        }
        if (lobby.mode === '3v3') {
            conf.c1 = (i <= Math.ceil(count / 2)) ? '#b4d455' : '#ff3366';
            conf.c2 = '#222222';
        } else {
            conf.c1 = PALETTE[(i - 1) % PALETTE.length];
            conf.c2 = PALETTE[(i) % PALETTE.length];
        }
    }
}

io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('host-game', (data) => {
        const playerName = typeof data === 'string' ? data : data.name;
        const maxTanks = data.maxTanks || 6;
        const mapName = data.map || 'bowl';
        const modeName = data.mode || 'FFA';

        currentRoom = genCode();
        socket.join(currentRoom);
        activeRooms.set(currentRoom, new Map());

        const assignedIcons = getRandomIcons(maxTanks);

        let dynamicConfigs = {};
        let dynamicSlots = {};
        let dynamicIcons = {};

        for (let i = 1; i <= maxTanks; i++) {
            dynamicConfigs[`tank${i}`] = { chassis:0, treads:0, turret:0, barrel:0, c1: '', c2: '' };
            dynamicSlots[`tank${i}_driver`] = null;
            dynamicSlots[`tank${i}_gunner`] = null;
            dynamicIcons[`tank${i}`] = assignedIcons[i - 1];
        }

        activeLobbies[currentRoom] = {
            host: socket.id,
            names: { [socket.id]: playerName },
            mode: modeName,
            map: mapName,
            maxTanks: maxTanks,
            spectators: [],
            tankConfigs: dynamicConfigs,
            ready: {},
            icons: dynamicIcons,
            slots: dynamicSlots
        };

        applyDefaultColors(activeLobbies[currentRoom]);

        socket.emit('room-joined', { code: currentRoom, isHost: true });
        broadcastLobby(currentRoom);
    });

    socket.on('join-game', (data) => {
        const code = data.code;
        const name = data.name;
        if (activeRooms.has(code) && activeLobbies[code]) {
            currentRoom = code;
            socket.join(currentRoom);
            activeLobbies[code].names[socket.id] = name;
            socket.emit('room-joined', { code: currentRoom, isHost: false });
            broadcastLobby(currentRoom);
        } else {
            socket.emit('room-error', 'Invalid Code');
        }
    });

    socket.on('change-slot', (newSlot) => {
        if (!currentRoom || !activeLobbies[currentRoom]) return;
        let lobby = activeLobbies[currentRoom];

        lobby.spectators = lobby.spectators.filter(id => id !== socket.id);

        if (newSlot === 'spectator') {
            for (let s in lobby.slots) { if (lobby.slots[s] === socket.id) lobby.slots[s] = null; }
            if(!lobby.spectators.includes(socket.id)) lobby.spectators.push(socket.id);
            broadcastLobby(currentRoom);
            return;
        }

        if (lobby.slots[newSlot] === socket.id) {
            lobby.slots[newSlot] = null;
            broadcastLobby(currentRoom); return;
        }
        if (lobby.slots[newSlot] === null) {
            for (let s in lobby.slots) { if (lobby.slots[s] === socket.id) lobby.slots[s] = null; }
            lobby.slots[newSlot] = socket.id;
            broadcastLobby(currentRoom);
        }
    });

    socket.on('change-mode', (modeStr) => {
        if (!currentRoom || !activeLobbies[currentRoom] || activeLobbies[currentRoom].host !== socket.id) return;
        activeLobbies[currentRoom].mode = modeStr;
        applyDefaultColors(activeLobbies[currentRoom]);
        broadcastLobby(currentRoom);
    });

    socket.on('change-map', (mapStr) => {
        if (!currentRoom || !activeLobbies[currentRoom] || activeLobbies[currentRoom].host !== socket.id) return;
        activeLobbies[currentRoom].map = mapStr;
        broadcastLobby(currentRoom);
    });

    socket.on('change-tank-count', (newCount) => {
        if (!currentRoom || !activeLobbies[currentRoom] || activeLobbies[currentRoom].host !== socket.id) return;
        let lobby = activeLobbies[currentRoom];

        let totalPlayers = Object.keys(lobby.names).length;
        if (totalPlayers > newCount * 2) {
            socket.emit('room-error', `Cannot reduce to ${newCount} tanks. You have ${totalPlayers} players in the lobby!`);
            return;
        }

        lobby.maxTanks = newCount;

        for (let i = 1; i <= newCount; i++) {
            if (lobby.slots[`tank${i}_driver`] === undefined) lobby.slots[`tank${i}_driver`] = null;
            if (lobby.slots[`tank${i}_gunner`] === undefined) lobby.slots[`tank${i}_gunner`] = null;
            if (!lobby.tankConfigs[`tank${i}`]) {
                 lobby.tankConfigs[`tank${i}`] = { chassis:0, treads:0, turret:0, barrel:0, c1: '', c2: '' };
            }
        }

        for (let i = newCount + 1; i <= 6; i++) {
            let dSlot = `tank${i}_driver`;
            let gSlot = `tank${i}_gunner`;

            if (lobby.slots[dSlot]) { lobby.spectators.push(lobby.slots[dSlot]); lobby.slots[dSlot] = null; }
            if (lobby.slots[gSlot]) { lobby.spectators.push(lobby.slots[gSlot]); lobby.slots[gSlot] = null; }

            delete lobby.tankConfigs[`tank${i}`];
        }

        applyDefaultColors(lobby);
        broadcastLobby(currentRoom);
    });

    socket.on('send-ping', (data) => { if (currentRoom) io.to(currentRoom).emit('receive-ping', data); });

    socket.on('update-garage', (tankId, role, state) => {
        if(!currentRoom || !activeLobbies[currentRoom]) return;
        let conf = activeLobbies[currentRoom].tankConfigs[tankId];
        if (role === 'driver') { conf.chassis = state.chassis; conf.treads = state.treads; conf.c1 = state.c1; }
        else { conf.turret = state.turret; conf.barrel = state.barrel; conf.c2 = state.c2; }
        broadcastLobby(currentRoom);
    });

    socket.on('toggle-ready', () => {
        if (!currentRoom || !activeLobbies[currentRoom]) return;
        let lobby = activeLobbies[currentRoom];
        lobby.ready[socket.id] = !lobby.ready[socket.id];
        broadcastLobby(currentRoom);
    });

    socket.on('nudge-unready', () => {
        if (!currentRoom || !activeLobbies[currentRoom] || activeLobbies[currentRoom].host !== socket.id) return;
        let lobby = activeLobbies[currentRoom];
        for (let slot in lobby.slots) {
            let pid = lobby.slots[slot];
            if (pid && !lobby.ready[pid]) io.to(pid).emit('receive-nudge');
        }
        lobby.spectators.forEach(pid => {
            if (!lobby.ready[pid]) io.to(pid).emit('receive-nudge');
        });
    });

    socket.on('start-match', () => {
        if (currentRoom && activeLobbies[currentRoom].host === socket.id) {
            let lobby = activeLobbies[currentRoom];
            gameEngine.createMatch(currentRoom, lobby.tankConfigs, lobby.mode, lobby.map);

            for (let slot in lobby.slots) {
                let pId = lobby.slots[slot];
                if (pId) {
                    let parts = slot.split('_');
                    gameEngine.getMatch(currentRoom).assignPlayer(pId, parts[0], parts[1]);
                }
            }
            lobby.spectators.forEach(pId => {
                gameEngine.getMatch(currentRoom).assignPlayer(pId, null, 'spectator');
            });

            io.to(currentRoom).emit('launch-game', lobby.map);
        }
    });

    socket.on('request-seat-swap', () => {
        let match = gameEngine.getMatch(currentRoom); if(!match) return;
        let myMapping = match.playerMapping[socket.id]; if(!myMapping) return;
        let tankId = myMapping.tankId; let tank = match.tanks[tankId];
        let otherPlayerId = (myMapping.role === 'driver') ? tank.gunnerId : tank.driverId;

        if (!otherPlayerId) match.swapSeats(tankId);
        else io.to(otherPlayerId).emit('swap-requested', socket.id);
    });

    socket.on('accept-swap', () => {
        let match = gameEngine.getMatch(currentRoom);
        if(match && match.playerMapping[socket.id]) match.swapSeats(match.playerMapping[socket.id].tankId);
    });

    // Handle WebSocket Inputs Instead of WebRTC
    socket.on('input', (input) => {
        let match = gameEngine.getMatch(currentRoom);
        if (match) match.applyInput(socket.id, input);
    });

    socket.on('disconnect', () => {
        if (currentRoom) {
            if (activeLobbies[currentRoom]) {
                for (let s in activeLobbies[currentRoom].slots) {
                    if (activeLobbies[currentRoom].slots[s] === socket.id) activeLobbies[currentRoom].slots[s] = null;
                }
                activeLobbies[currentRoom].spectators = activeLobbies[currentRoom].spectators.filter(id => id !== socket.id);
                broadcastLobby(currentRoom);
            }
            if (activeRooms.has(currentRoom)) {
                activeRooms.get(currentRoom).delete(socket.id);
                let match = gameEngine.getMatch(currentRoom);
                if (match) match.removePlayer(socket.id);

                if (activeRooms.get(currentRoom).size === 0) {
                    activeRooms.delete(currentRoom);
                    delete activeLobbies[currentRoom];
                    gameEngine.deleteMatch(currentRoom);
                }
            }
        }
    });
});

let lastTick = Date.now();
setInterval(() => {
    let now = Date.now();
    let delta = Math.min((now - lastTick) / 1000, 0.1);
    lastTick = now;

    const matches = gameEngine.getAllMatches();
    for (let id in matches) {
        let state = matches[id].tick(delta);

        // Broadcast the state directly to everyone in this room via WebSockets
        io.to(id).emit('state', state);
    }
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
