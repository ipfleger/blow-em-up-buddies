// public/lobby.js
window.socket = io();
window.myId = null;
window.currentRoomCode = "----";
window.myTankId = null;
window.myRole = null;
window.isSpectating = false;
window.isHost = false;

window.socket.on('connect', () => { window.myId = window.socket.id; });

function getValidName() {
    const name = document.getElementById('input-name').value.trim().toUpperCase();
    if (!name) { alert("Please enter a callsign to join!"); return null; }
    return name;
}

// --- AR PERMISSION HANDLING ---
document.addEventListener('DOMContentLoaded', () => {
    const btnAr = document.getElementById('btn-enable-ar');

    if (btnAr && window.DeviceOrientationEvent && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        btnAr.style.display = 'block';
    }

    if (btnAr) {
        btnAr.onclick = async () => {
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
                try {
                    const permission = await DeviceOrientationEvent.requestPermission();
                    if (permission === 'granted') {
                        enableARUI(btnAr);
                    } else {
                        alert("Permission denied. AR Aiming requires sensor access.");
                    }
                } catch (err) {
                    alert("HTTPS required for AR sensors.");
                }
            } else {
                enableARUI(btnAr);
            }
        };
    }

    function enableARUI(btn) {
        btn.innerText = 'AR ENABLED';
        btn.style.borderColor = 'var(--neon-green)';
        btn.style.color = 'var(--neon-green)';
        window.Controls.useAR = true;
        if (window.Controls.setupMotionControls) {
            window.Controls.setupMotionControls();
        }
    }
});

// --- STATE 1: START SCREEN ---
document.getElementById('btn-host').onclick = () => {
    let name = getValidName();
    if (name) {
        window.pendingHostName = name;
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('host-setup-screen').classList.remove('hidden');
        if (window.updateLobbyPreview) window.updateLobbyPreview(MAP_OPTIONS[hostMapIdx].id, hostTankCount);
    }
};

document.getElementById('btn-join').onclick = () => {
    let name = getValidName();
    if (name) {
        const code = document.getElementById('input-code').value.trim().toUpperCase();
        if (code.length === 4) window.socket.emit('join-game', { code: code, name: name });
    }
};

// --- STATE 2: HOST SETUP ---
const MAP_OPTIONS = [
    { id: 'stress_test', name: 'Stress Test' },
    { id: 'shattered_city', name: 'Shattered City' },
    { id: 'bowl', name: 'The Bowl' },
    { id: 'geometric_gauntlet', name: 'Gauntlet' },
    { id: 'flatland', name: 'Flatland' }
];
const MODE_OPTIONS = [
    { id: 'FFA', name: 'Free-For-All' },
    { id: '3v3', name: 'Team Match' }
];

let hostMapIdx = 0;
let hostTankCount = 6;
let hostModeIdx = 0;

function syncHostPreview() {
    if (window.updateLobbyPreview) window.updateLobbyPreview(MAP_OPTIONS[hostMapIdx].id, hostTankCount);
    if (window.currentRoomCode !== "----") {
        window.socket.emit('change-map', MAP_OPTIONS[hostMapIdx].id);
        window.socket.emit('change-mode', MODE_OPTIONS[hostModeIdx].id);
        window.socket.emit('change-tank-count', hostTankCount);
    }
}

document.getElementById('btn-cancel-host').onclick = () => {
    if (window.currentRoomCode !== "----") {
        document.getElementById('host-setup-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
    } else {
        document.getElementById('host-setup-screen').classList.add('hidden');
        document.getElementById('start-screen').classList.remove('hidden');
    }
};

document.getElementById('btn-map-prev').onclick = () => { hostMapIdx = (hostMapIdx - 1 + MAP_OPTIONS.length) % MAP_OPTIONS.length; document.getElementById('lbl-setup-map').innerText = MAP_OPTIONS[hostMapIdx].name; syncHostPreview(); };
document.getElementById('btn-map-next').onclick = () => { hostMapIdx = (hostMapIdx + 1) % MAP_OPTIONS.length; document.getElementById('lbl-setup-map').innerText = MAP_OPTIONS[hostMapIdx].name; syncHostPreview(); };
document.getElementById('btn-tank-prev').onclick = () => { hostTankCount = hostTankCount > 1 ? hostTankCount - 1 : 6; document.getElementById('lbl-setup-tanks').innerText = `${hostTankCount} Tank${hostTankCount>1?'s':''}`; syncHostPreview(); };
document.getElementById('btn-tank-next').onclick = () => { hostTankCount = hostTankCount < 6 ? hostTankCount + 1 : 1; document.getElementById('lbl-setup-tanks').innerText = `${hostTankCount} Tank${hostTankCount>1?'s':''}`; syncHostPreview(); };
document.getElementById('btn-mode-prev').onclick = () => { hostModeIdx = (hostModeIdx - 1 + MODE_OPTIONS.length) % MODE_OPTIONS.length; document.getElementById('lbl-setup-mode').innerText = MODE_OPTIONS[hostModeIdx].name; syncHostPreview(); };
document.getElementById('btn-mode-next').onclick = () => { hostModeIdx = (hostModeIdx + 1) % MODE_OPTIONS.length; document.getElementById('lbl-setup-mode').innerText = MODE_OPTIONS[hostModeIdx].name; syncHostPreview(); };

document.getElementById('btn-confirm-host').onclick = () => {
    if (window.currentRoomCode !== "----") {
        document.getElementById('host-setup-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
    } else {
        window.socket.emit('host-game', {
            name: window.pendingHostName,
            maxTanks: hostTankCount,
            map: MAP_OPTIONS[hostMapIdx].id,
            mode: MODE_OPTIONS[hostModeIdx].id
        });
    }
};

// --- STATE 3: THE HUB & GARAGE ---
document.getElementById('btn-leave-hub').onclick = () => {
    if (window.isHost) {
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('host-setup-screen').classList.remove('hidden');
    } else {
        if (confirm("Are you sure you want to leave the lobby?")) {
            window.location.reload();
        }
    }
};

window.socket.on('room-error', (msg) => alert(msg));

window.socket.on('room-joined', (data) => {
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('host-setup-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
    document.getElementById('lobby-code-display').innerText = `ROOM: ${data.code}`;
    window.currentRoomCode = data.code;

    if (data.isHost) {
        window.isHost = true;
        document.getElementById('btn-launch').classList.remove('hidden');
        document.getElementById('btn-confirm-host').innerHTML = '<i class="ph ph-check"></i>';
    }
});

document.getElementById('btn-open-garage').onclick = () => {
    if(!window.myTankId) return alert("You must claim a seat before opening the workshop!");
    document.getElementById('view-roster').classList.add('hidden');
    document.getElementById('view-garage').classList.remove('hidden');
};
document.getElementById('btn-close-garage').onclick = () => {
    document.getElementById('view-garage').classList.add('hidden');
    document.getElementById('view-roster').classList.remove('hidden');
};

document.getElementById('btn-ready').onclick = () => window.socket.emit('toggle-ready');
document.getElementById('btn-launch').onclick = () => window.socket.emit('start-match');

window.socket.on('lobby-update', (lobby) => {
    window.myTankId = null;
    window.myRole = null;
    window.isSpectating = false;
    let allReady = true;
    let assignedCount = 0;

    window.isHost = (lobby.host === window.myId);
    if (window.isHost) {
        hostTankCount = lobby.maxTanks;
        document.getElementById('lbl-setup-tanks').innerText = `${hostTankCount} Tank${hostTankCount>1?'s':''}`;
    }

    const grid = document.getElementById('roster-grid');
    grid.innerHTML = '';

    for (let i = 1; i <= lobby.maxTanks; i++) {
        let tId = `tank${i}`;
        let dId = `${tId}_driver`;
        let gId = `${tId}_gunner`;

        let dSocket = lobby.slots[dId];
        let gSocket = lobby.slots[gId];

        if (dSocket === window.myId) { window.myTankId = tId; window.myRole = 'driver'; }
        if (gSocket === window.myId) { window.myTankId = tId; window.myRole = 'gunner'; }
        if (dSocket) assignedCount++;
        if (gSocket) assignedCount++;

        let tankReady = (dSocket && lobby.ready[dSocket]) && (gSocket && lobby.ready[gSocket]);
        if ((dSocket && !lobby.ready[dSocket]) || (gSocket && !lobby.ready[gSocket])) allReady = false;

        let dHtml = `<div class="seat-circle" onclick="window.socket.emit('change-slot', '${dId}')" title="Driver"><i class="ph ph-steering-wheel"></i></div>`;
        if (dSocket) {
            let name = lobby.names[dSocket] || "PL";
            let initials = name.substring(0, 2).toUpperCase();
            let isDReady = lobby.ready[dSocket] ? 'ready' : '';
            let color = lobby.tankConfigs[tId].c1;
            dHtml = `<div class="seat-circle filled ${isDReady}" style="background: ${color}; border-color: ${color};" onclick="window.socket.emit('change-slot', '${dId}')">${initials}</div>`;
        }

        let gHtml = `<div class="seat-circle" onclick="window.socket.emit('change-slot', '${gId}')" title="Gunner"><i class="ph ph-crosshair"></i></div>`;
        if (gSocket) {
            let name = lobby.names[gSocket] || "PL";
            let initials = name.substring(0, 2).toUpperCase();
            let isGReady = lobby.ready[gSocket] ? 'ready' : '';
            let color = lobby.tankConfigs[tId].c1;
            gHtml = `<div class="seat-circle filled ${isGReady}" style="background: ${color}; border-color: ${color};" onclick="window.socket.emit('change-slot', '${gId}')">${initials}</div>`;
        }

        let iconSrc = lobby.icons[tId] ? `<img src="/icons/${lobby.icons[tId]}">` : '';

        let card = document.createElement('div');
        card.className = 'tank-icon-card';
        card.innerHTML = `
            <div class="tank-ready-check" style="display: ${tankReady ? 'flex' : 'none'};"><i class="ph ph-check"></i></div>
            <div class="tank-graphic">${iconSrc}</div>
            <div class="seats-container">
                ${dHtml}
                ${gHtml}
            </div>
        `;
        grid.appendChild(card);
    }

    if (assignedCount === 0) allReady = false;

    const readyBtn = document.getElementById('btn-ready');
    if (lobby.ready[window.myId]) {
        readyBtn.innerText = 'READY'; readyBtn.style.background = '#6dcbc3'; readyBtn.style.color = '#1f1c30';
    } else {
        readyBtn.innerText = 'READY UP'; readyBtn.style.background = '#b4d455'; readyBtn.style.color = '#1f1c30';
    }

    const launchBtn = document.getElementById('btn-launch');
    if (window.isHost) {
        if (allReady && assignedCount > 0) {
            launchBtn.innerText = 'LAUNCH MATCH';
            launchBtn.style.background = '#d44a8e';
            launchBtn.onclick = () => window.socket.emit('start-match');
        } else {
            launchBtn.innerText = 'NUDGE UNREADY';
            launchBtn.style.background = '#ff8c00';
            launchBtn.onclick = () => window.socket.emit('nudge-unready');
        }
    }
});

window.socket.on('receive-nudge', () => {
    const readyBtn = document.getElementById('btn-ready');
    if(readyBtn) {
        readyBtn.style.transform = 'scale(1.1)'; readyBtn.style.boxShadow = '0 0 20px #ff3366';
        setTimeout(() => { readyBtn.style.transform = 'scale(1.0)'; readyBtn.style.boxShadow = 'none'; }, 500);
    }
});

// --- GARAGE LOGIC ---
const PACKAGES = {
    top: [ { n: "Assault Package", tu: 0, ba: 0 }, { n: "Sniper Package", tu: 1, ba: 1 } ],
    bottom: [ { n: "Heavy Tracker", ch: 0, tr: 0 }, { n: "Hover Scout", ch: 1, tr: 1 } ]
};
let garageState = { topIdx: 0, botIdx: 0 };

function emitGarageUpdate() {
    if (!window.myTankId) return;

    let activeTopSwatch = document.querySelector('#color-palette-top .color-swatch.active');
    let colorTop = activeTopSwatch ? activeTopSwatch.dataset.hex : '#ff3366';

    let activeBotSwatch = document.querySelector('#color-palette-bot .color-swatch.active');
    let colorBot = activeBotSwatch ? activeBotSwatch.dataset.hex : '#b4d455';

    let tPack = PACKAGES.top[garageState.topIdx];
    let bPack = PACKAGES.bottom[garageState.botIdx];

    window.socket.emit('update-garage', window.myTankId, 'driver', { chassis: bPack.ch, treads: bPack.tr, c1: colorBot });
    window.socket.emit('update-garage', window.myTankId, 'gunner', { turret: tPack.tu, barrel: tPack.ba, c2: colorTop });
}

document.getElementById('btn-top-next').onclick = () => { garageState.topIdx = (garageState.topIdx + 1) % PACKAGES.top.length; document.getElementById('lbl-top-part').innerText = PACKAGES.top[garageState.topIdx].n; emitGarageUpdate(); };
document.getElementById('btn-top-prev').onclick = () => { garageState.topIdx = (garageState.topIdx - 1 + PACKAGES.top.length) % PACKAGES.top.length; document.getElementById('lbl-top-part').innerText = PACKAGES.top[garageState.topIdx].n; emitGarageUpdate(); };
document.getElementById('btn-bottom-next').onclick = () => { garageState.botIdx = (garageState.botIdx + 1) % PACKAGES.bottom.length; document.getElementById('lbl-bottom-part').innerText = PACKAGES.bottom[garageState.botIdx].n; emitGarageUpdate(); };
document.getElementById('btn-bottom-prev').onclick = () => { garageState.botIdx = (garageState.botIdx - 1 + PACKAGES.bottom.length) % PACKAGES.bottom.length; document.getElementById('lbl-bottom-part').innerText = PACKAGES.bottom[garageState.botIdx].n; emitGarageUpdate(); };

const colors = ['#b4d455', '#ff3366', '#6dcbc3', '#ffd700', '#ff8c00', '#d44a8e', '#8ab4f8', '#ffffff', '#222222'];

function buildPalette(containerId, isTop) {
    const pal = document.getElementById(containerId);
    if(!pal) return;
    pal.innerHTML = '';

    colors.forEach((c, idx) => {
        let div = document.createElement('div');
        let isActive = isTop ? (idx === 1) : (idx === 0);

        div.className = 'color-swatch' + (isActive ? ' active' : '');
        div.style.backgroundColor = c;
        div.dataset.hex = c;

        div.onclick = (e) => {
            document.querySelectorAll(`#${containerId} .color-swatch`).forEach(s => s.classList.remove('active'));
            e.target.classList.add('active');
            emitGarageUpdate();
        };
        pal.appendChild(div);
    });
}

buildPalette('color-palette-top', true);
buildPalette('color-palette-bot', false);

// --- Collapsible lobby drawer (mobile portrait) ---
const drawerHandle = document.getElementById('lobby-drawer-handle');
const lobbyContainer = document.getElementById('lobby-screen');

if (drawerHandle && lobbyContainer) {
    drawerHandle.addEventListener('click', () => {
        lobbyContainer.classList.toggle('drawer-expanded');
    });

    // Swipe-up to expand
    let swipeStartY = 0;
    drawerHandle.addEventListener('touchstart', e => { swipeStartY = e.changedTouches[0].clientY; }, { passive: true });
    drawerHandle.addEventListener('touchend', e => {
        let dy = swipeStartY - e.changedTouches[0].clientY;
        if (dy > 20) lobbyContainer.classList.add('drawer-expanded');
        else if (dy < -20) lobbyContainer.classList.remove('drawer-expanded');
    }, { passive: true });
}

// Sync inline ready button with main ready button
const inlineReadyBtn = document.getElementById('btn-ready-inline');
if (inlineReadyBtn) {
    inlineReadyBtn.addEventListener('click', () => window.socket.emit('toggle-ready'));
}

// Lobby update: sync inline fields
const origLobbyUpdate = window.socket._callbacks && window.socket._callbacks['$lobby-update'];
window.socket.on('lobby-update', (lobby) => {
    const codeInline = document.getElementById('lobby-code-inline');
    const seatInline = document.getElementById('lobby-seat-inline');
    if (codeInline && window.currentRoomCode) codeInline.textContent = 'ROOM: ' + window.currentRoomCode;
    if (seatInline) {
        seatInline.textContent = window.myRole ? window.myRole.toUpperCase() : '';
    }
});
