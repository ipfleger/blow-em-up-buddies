// public/app.js
document.body.style.userSelect = 'none';
document.body.style.webkitUserSelect = 'none';
document.body.style.webkitTouchCallout = 'none';

const MAX_LOCK_DISTANCE = 150.0;

// Explicitly use window namespace to prevent redeclaration errors
window.hitFlashTimer = 0;
window.visualShutters = {};
window.isMatchActive = false;
window.myCurrentTankId = null;
window.myCurrentRole = null;
window.currentMapName = 'trenches';
window.currentMatchMode = 'FFA';

window.lobbyTanks = {};
window.activePings = [];
window.visualTanks = {};
window.bulletPool = [];
window.zonePool = [];

// Screen shake state
window.shakeTimer = 0;
window.shakeIntensity = 0;
window.shakeOffset = new THREE.Vector3();

// FOV state
window.targetFOV = 75;
window.currentFOV = 75;

// Death cam state
window.deathCamTimer = 0;
window.deathCamPos = null;
window.deathCamTarget = null;

// Kill feed state
window._killFeedEntries = [];
window._crosshairFrameCount = 0;

// Reusable raycaster for crosshair (avoid per-frame allocation)
window._reusableRaycaster = new THREE.Raycaster();
window._reusableVec2 = new THREE.Vector2(0, 0);

const pingGeo = new THREE.CylinderGeometry(1.5, 1.5, 60, 8); pingGeo.translate(0, 30, 0);
const bulletGeo = new THREE.CylinderGeometry(0.5, 0.5, 10.0, 8); bulletGeo.rotateX(Math.PI / 2);
const bulletMat = new THREE.MeshBasicMaterial({color: 0x6dcbc3});
const zoneGeo = new THREE.SphereGeometry(25, 32, 32);
const zoneMat = new THREE.MeshBasicMaterial({ color: 0x6dcbc3, transparent: true, opacity: 0.6, wireframe: false, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

window.minimapCanvas = document.getElementById('minimap');
window.minimapCtx = window.minimapCanvas ? window.minimapCanvas.getContext('2d') : null;

window.disposeHierarchy = function(node) {
    for (let i = node.children.length - 1; i >= 0; i--) { window.disposeHierarchy(node.children[i]); }
    if (node.isMesh) {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
            if (node.material.map) node.material.map.dispose();
            if (node.material.bumpMap) node.material.bumpMap.dispose();
            node.material.dispose();
        }
    }
};

window.cleanupVisualTank = function(tank) {
    if (!tank) return;
    if (tank.healthRing) {
        for (let mesh of tank.healthRing) {
            window.Graphics.matchGroup.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) mesh.material.dispose();
        }
        tank.healthRing = null;
    }
    if (tank.aimLine) {
        window.Graphics.matchGroup.remove(tank.aimLine);
        if (tank.aimLine.geometry) tank.aimLine.geometry.dispose();
        if (tank.aimLine.material) tank.aimLine.material.dispose();
        tank.aimLine = null;
    }
};

window.destroyLobbyTank = function(tId) {
    if (window.lobbyTanks[tId]) {
        window.cleanupVisualTank(window.lobbyTanks[tId]);
        window.disposeHierarchy(window.lobbyTanks[tId]);
        window.Graphics.matchGroup.remove(window.lobbyTanks[tId]);
        if (window.lobbyTanks[tId].turretRef) {
            window.disposeHierarchy(window.lobbyTanks[tId].turretRef);
            window.Graphics.matchGroup.remove(window.lobbyTanks[tId].turretRef);
        }
        delete window.lobbyTanks[tId];
    }
};

window.updateLobbyPreview = function(map, count) {
    if (window.isMatchActive) return;
    if (window.currentMapName !== map) {
        window.currentMapName = map || 'trenches';
        window.Graphics.rebuildMapGeometry(window.currentMapName);
        window.Graphics.loadEnvironmentProps(window.currentMapName);
    }
    let mockConfigs = {};
    for(let i=1; i<=count; i++) {
        let teamColor = (i <= Math.ceil(count / 2)) ? '#b4d455' : '#ff3366';
        mockConfigs[`tank${i}`] = { chassis:0, treads:0, turret:0, barrel:0, c1: teamColor, c2:'#222222' };
    }
    for (let tId in window.lobbyTanks) { if (!mockConfigs[tId]) window.destroyLobbyTank(tId); }
    let radius = 15; let angleStep = (Math.PI * 2) / count;
    for (let i = 1; i <= count; i++) {
        let tId = `tank${i}`;
        if (!window.lobbyTanks[tId]) window.lobbyTanks[tId] = window.TankFactory.createTank({ id: tId, ...mockConfigs[tId] }, window.Graphics.matchGroup);
        let angle = (i - 1) * angleStep; let px = Math.cos(angle) * radius; let pz = Math.sin(angle) * radius;
        let py = window.getTerrainHeight(px, pz, window.currentMapName);
        window.lobbyTanks[tId].position.set(px, py, pz); window.lobbyTanks[tId].rotation.y = -angle + Math.PI / 2;
        if (window.lobbyTanks[tId].turretRef) { window.lobbyTanks[tId].turretRef.position.set(px, py + 2.2, pz); window.lobbyTanks[tId].turretRef.rotation.y = -angle + Math.PI / 2; }
    }
};

window.onLobbyUpdate = function(lobby) {
    if (window.isMatchActive) return;
    // Cache tank configs for use during match (since config is no longer sent every tick)
    window._cachedTankConfigs = Object.assign({}, lobby.tankConfigs);
    if (window.currentMapName !== lobby.map) {
        window.currentMapName = lobby.map || 'trenches';
        window.Graphics.rebuildMapGeometry(window.currentMapName);
        window.Graphics.loadEnvironmentProps(window.currentMapName);
    }
    for (let tId in window.lobbyTanks) { if (!lobby.tankConfigs[tId]) window.destroyLobbyTank(tId); }
    let count = lobby.maxTanks || 6; let radius = 15; let angleStep = (Math.PI * 2) / count;
    for (let i = 1; i <= count; i++) {
        let tId = `tank${i}`; let conf = lobby.tankConfigs[tId]; if (!conf) continue;
        let existing = window.lobbyTanks[tId];
        let configChanged = !existing || !existing._lastConfig ||
            JSON.stringify(existing._lastConfig) !== JSON.stringify(conf);
        if (configChanged) {
            window.destroyLobbyTank(tId);
            let tankGroup = window.TankFactory.createTank({ id: tId, ...conf }, window.Graphics.matchGroup);
            tankGroup._lastConfig = { ...conf };
            window.lobbyTanks[tId] = tankGroup;
        }
        let tankGroup = window.lobbyTanks[tId];
        let angle = (i - 1) * angleStep; let px = Math.cos(angle) * radius; let pz = Math.sin(angle) * radius;
        let py = window.getTerrainHeight(px, pz, window.currentMapName);
        tankGroup.position.set(px, py, pz); tankGroup.rotation.y = -angle + Math.PI / 2;
        if (tankGroup.turretRef) { tankGroup.turretRef.position.set(px, py + 2.2, pz); tankGroup.turretRef.rotation.y = -angle + Math.PI / 2; }
    }
};

window.onLaunchGame = function(mapName) {
    window.currentMapName = mapName || 'trenches'; window.isMatchActive = true;
    document.getElementById('lobby-screen').classList.add('hidden');
    for (let tId in window.lobbyTanks) { window.destroyLobbyTank(tId); }

    // Reset kill feed tracking
    window._lastKillFeedCount = 0;
    window._killFeedEntries = [];
    const feedEl = document.getElementById('kill-feed');
    if (feedEl) feedEl.innerHTML = '';

    // Ensure invuln flash element exists
    if (!document.getElementById('invuln-flash')) {
        const inv = document.createElement('div');
        inv.id = 'invuln-flash';
        document.body.appendChild(inv);
    }

    if (window.isSpectating) {
        document.getElementById('crosshair').classList.add('hidden');
        const specHint = document.getElementById('spectator-hint');
        if (specHint) specHint.classList.remove('hidden');
    } else {
        document.getElementById('crosshair').style.transition = 'transform 0.1s, background-color 0.1s, border-color 0.1s, border-radius 0.1s';
    }

    window.Graphics.rebuildMapGeometry(window.currentMapName);
    window.Graphics.loadEnvironmentProps(window.currentMapName);

    // Cleanup any existing visual tanks from a previous match
    for (let tId in window.visualTanks) {
        window.cleanupVisualTank(window.visualTanks[tId]);
        window.disposeHierarchy(window.visualTanks[tId]);
        window.Graphics.matchGroup.remove(window.visualTanks[tId]);
        if (window.visualTanks[tId].turretRef) {
            window.disposeHierarchy(window.visualTanks[tId].turretRef);
            window.Graphics.matchGroup.remove(window.visualTanks[tId].turretRef);
        }
    }
    window.visualTanks = {};

    // Role callout — shown every match start
    setTimeout(() => {
        if (window.myCurrentRole && window.myCurrentRole !== 'spectator') {
            const callout = document.getElementById('role-callout');
            if (callout) {
                callout.textContent = window.myCurrentRole === 'driver' ? 'YOU ARE THE DRIVER' : 'YOU ARE THE GUNNER';
                callout.classList.remove('hidden');
                callout.style.animation = 'none';
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        callout.style.animation = '';
                    });
                });
                setTimeout(() => callout.classList.add('hidden'), 2100);
            }
        }
    }, 300);

    // Tutorial — shown on first match only
    const hasSeenTutorial = localStorage.getItem('hasSeenTutorial');
    if (!hasSeenTutorial) {
        const tutOverlay = document.getElementById('tutorial-overlay');
        if (tutOverlay) tutOverlay.classList.remove('hidden');
    }
};

window.spawnVisualPing = function(x, y, z, type, ownerId) {
    let color = 0xffffff; if (type === 'enemy') color = 0xff3366; else if (type === 'obstacle') color = 0x00ccff;
    const material = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
    const pingMesh = new THREE.Mesh(pingGeo, material); pingMesh.position.set(x, y, z);
    window.Graphics.matchGroup.add(pingMesh);
    window.activePings.push({ mesh: pingMesh, life: 4.0, type: type, x: x, z: z, owner: ownerId });
};

window.onReceivePing = function(data) {
    for (let i = window.activePings.length - 1; i >= 0; i--) {
        if (window.activePings[i].owner === data.owner) {
            window.Graphics.matchGroup.remove(window.activePings[i].mesh);
            window.activePings.splice(i, 1);
        }
    }
    window.spawnVisualPing(data.x, data.y, data.z, data.type, data.owner);
};


window.updateGame = function(serverState) {
    window.currentMatchMode = serverState.mode; window.currentMapName = serverState.map;

    let myMapping = serverState.assignments[window.myId];
    if (myMapping) { window.myCurrentTankId = myMapping.tankId; window.myCurrentRole = myMapping.role; }
    else if (window.isSpectating) { window.myCurrentRole = 'spectator'; }

    if (!window.isSpectating) {
        const btnCluster = document.getElementById('btn-cluster');
        const crosshair = document.getElementById('crosshair');
        const switchSeat = document.getElementById('btn-switch-seat');
        const specHint = document.getElementById('spectator-hint');
        if (btnCluster) btnCluster.classList.remove('hidden');
        if (switchSeat) switchSeat.classList.remove('hidden');
        if (window.minimapCanvas) window.minimapCanvas.classList.remove('hidden');
        if (specHint) specHint.classList.add('hidden');

        const btnPrimary = document.getElementById('btn-primary');
        const btnSecondary = document.getElementById('btn-secondary');

        if (window.myCurrentRole === 'driver') {
            if (btnPrimary) btnPrimary.textContent = 'A';
            if (btnSecondary) btnSecondary.textContent = 'B';
            if (crosshair) crosshair.classList.add('hidden');
        } else if (window.myCurrentRole === 'gunner') {
            if (btnPrimary) btnPrimary.textContent = 'A';
            if (btnSecondary) btnSecondary.textContent = 'B';
            if (crosshair) crosshair.classList.remove('hidden');
        }
    }

    if (window.minimapCtx && !window.isSpectating) {
        window.minimapCtx.clearRect(0, 0, window.minimapCanvas.width, window.minimapCanvas.height); window.minimapCtx.strokeStyle = 'rgba(109, 203, 195, 0.3)';
        let center = window.minimapCanvas.width / 2; window.minimapCtx.beginPath(); window.minimapCtx.arc(center, center, center, 0, Math.PI*2); window.minimapCtx.stroke(); window.minimapCtx.fillStyle = 'rgba(212, 74, 142, 0.5)';
        let activeObstacles = window.GameEnv ? (window.GameEnv.MONOLITHS || []) : [];
        activeObstacles.forEach(m => { window.minimapCtx.beginPath(); window.minimapCtx.arc(center + (m.x/400)*center, center + (m.z/400)*center, (m.r/400)*center, 0, Math.PI*2); window.minimapCtx.fill(); });
    }

    for (let tId in serverState.tanks) {
        let sp = serverState.tanks[tId];
        if (!window.visualTanks[tId]) {
            const cachedConf = (window._cachedTankConfigs && window._cachedTankConfigs[tId]) || {};
            window.visualTanks[tId] = window.TankFactory.createTank({id: tId, ...cachedConf}, window.Graphics.matchGroup);
            window.visualTanks[tId].wasDead = false;
            window.visualTanks[tId].traverse(child => { if (child.isMesh) child.userData = { type: 'tank', id: tId }; });
            window.visualTanks[tId].turretRef.traverse(child => { if (child.isMesh) child.userData = { type: 'tank', id: tId }; });
        }

        let tank = window.visualTanks[tId];

        if (sp.isDead && !tank.wasDead) {
            window.Graphics.createShatterParticles(tank.position);
            tank.turretRef.visible = false;
            // Death cam for own tank — try to follow killer if known
            if (tId === window.myCurrentTankId) {
                window.deathCamTimer = 2.0;
                const killerTank = sp.lastKiller && window.visualTanks[sp.lastKiller] ? window.visualTanks[sp.lastKiller] : null;
                if (killerTank) {
                    window.deathCamKillerId = sp.lastKiller;
                    window.deathCamPos = killerTank.position.clone().add(new THREE.Vector3(0, 40, 30));
                    window.deathCamTarget = killerTank.position.clone();
                } else {
                    window.deathCamKillerId = null;
                    window.deathCamPos = tank.position.clone().add(new THREE.Vector3(0, 40, 30));
                    window.deathCamTarget = tank.position.clone();
                }
                window._respawnCountdown = 3.0;
            }
            // Audio: tank death / kill confirmation
            if (window.AudioManager) {
                const KILL_CONFIRM_WINDOW_MS = 1500;
                if (tId === window.myCurrentTankId) {
                    window.AudioManager.sounds.tankDeath();
                } else if (window._lastHitByMe && window._lastHitByMe[tId] && (Date.now() - window._lastHitByMe[tId]) < KILL_CONFIRM_WINDOW_MS) {
                    window.AudioManager.sounds.killConfirmed();
                } else {
                    window.AudioManager.sounds.tankDeath();
                }
            }
        }

        // Invulnerability flash when just respawned
        if (!sp.isDead && tank.wasDead) {
            if (tId === window.myCurrentTankId) {
                const inv = document.getElementById('invuln-flash');
                if (inv) {
                    inv.classList.add('active');
                    setTimeout(() => inv.classList.remove('active'), 1500);
                }
            }
        }

        tank.wasDead = sp.isDead; tank.visible = !sp.isDead;
        if (!sp.isDead) tank.turretRef.visible = true;

        if (!sp.isDead) {
            let newTargetPos = new THREE.Vector3(sp.x, sp.y, sp.z);

            // Landing impact detection
            let prevY = tank.lastNetPos ? tank.lastNetPos.y : sp.y;
            let wasAirborne = tank.wasAirborne || false;
            let isGrounded = (sp.y <= window.getTerrainHeight(sp.x, sp.z, window.currentMapName) + 0.5);
            let landingVel = prevY - sp.y;
            if (wasAirborne && isGrounded && landingVel > 1.5) {
                window.Graphics.createShatterParticles(newTargetPos.clone(), Math.floor(landingVel * 4), 0x888888);
                if (tId === window.myCurrentTankId) {
                    window.shakeTimer = 0.2;
                    window.shakeIntensity = Math.min(1.5, landingVel * 0.2);
                    if (window.AudioManager) window.AudioManager.sounds.land();
                }
            }
            tank.wasAirborne = !isGrounded;

            tank.serverVelocity = tank.lastNetPos ? newTargetPos.clone().sub(tank.lastNetPos).multiplyScalar(30) : new THREE.Vector3(0,0,0);
            tank.lastNetPos = newTargetPos.clone(); tank.targetPos = newTargetPos.clone();
            tank.targetQuat = new THREE.Quaternion(sp.qx, sp.qy, sp.qz, sp.qw);
            tank.targetRot = sp.rot;

            if (tank.targetTurretYaw === undefined || !(tId === window.myCurrentTankId && window.myCurrentRole === 'gunner')) {
                tank.targetTurretYaw = sp.turretYaw; tank.targetTurretPitch = sp.turretPitch;
            }
	        tank.targetTurretYOffset = sp.turretYOffset || 0;
            if (tank.position.distanceTo(tank.targetPos) > 15) {
                tank.position.copy(tank.targetPos); tank.quaternion.copy(tank.targetQuat);
            }
            if (sp.isBoosting && sp.boost > 0) {
                const cachedConf = (window._cachedTankConfigs && window._cachedTankConfigs[tId]) || {};
                window.Graphics.emitSparks(tank, sp.rot, cachedConf, sp.speed);
            }

            // --- HEALTH RING (segmented, around tank base) ---
            if (!tank.healthRing) {
                tank.healthRing = [];
                const ringGeo = new THREE.TorusGeometry(2.5, 0.2, 6, 8, Math.PI * 2 / 5 * 0.8);
                for (let seg = 0; seg < 5; seg++) {
                    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.85 });
                    const mesh = new THREE.Mesh(ringGeo, mat);
                    mesh.rotation.x = Math.PI / 2;
                    mesh.rotation.z = seg * (Math.PI * 2 / 5);
                    window.Graphics.matchGroup.add(mesh);
                    tank.healthRing.push(mesh);
                }
            }
            let segsAlive = Math.ceil(sp.health / 20);
            for (let seg = 0; seg < 5; seg++) {
                let ringMesh = tank.healthRing[seg];
                ringMesh.visible = seg < segsAlive;
                ringMesh.position.set(sp.x, sp.y + 0.3, sp.z);
                let ringColor = segsAlive > 3 ? 0x00ff88 : segsAlive > 1 ? 0xffaa00 : 0xff2222;
                ringMesh.material.color.setHex(ringColor);
            }

            // --- TEAMMATE AIM INDICATOR LINE ---
            let isTeamTank = window.currentMatchMode === '3v3' && window.myCurrentTankId &&
                (parseInt(tId.replace('tank','')) <= Math.ceil(Object.keys(serverState.tanks).length/2)) ===
                (parseInt(window.myCurrentTankId.replace('tank','')) <= Math.ceil(Object.keys(serverState.tanks).length/2));
            let isMyTank = (tId === window.myCurrentTankId);
            if (!isMyTank && (isTeamTank || window.currentMatchMode !== '3v3')) {
                // Show aim line for all tanks (helps coord for nearby teammates)
                if (!tank.aimLine) {
                    const lMat = new THREE.LineBasicMaterial({ color: 0x6dcbc3, transparent: true, opacity: 0.3 });
                    const lGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
                    tank.aimLine = new THREE.Line(lGeo, lMat);
                    window.Graphics.matchGroup.add(tank.aimLine);
                }
                let barrelStart = tank.turretRef ? tank.turretRef.position.clone() : new THREE.Vector3(sp.x, sp.y + 2.2, sp.z);
                let yaw = sp.turretYaw; let pitch = sp.turretPitch;
                let aimDir = new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw)*Math.cos(pitch));
                let barrelEnd = barrelStart.clone().addScaledVector(aimDir, 30);
                tank.aimLine.geometry.setFromPoints([barrelStart, barrelEnd]);
                tank.aimLine.visible = true;
            } else if (tank.aimLine) {
                tank.aimLine.visible = false;
            }

            // --- HUD RING INDICATOR (replaces hud-bars for player's tank) ---
            if (tId === window.myCurrentTankId) {
                // Low-health audio heartbeat
                if (window.AudioManager) window.AudioManager.checkLowHealth(sp.health);

                const ringFill = document.getElementById('ring-fill');
                const btnPrimary = document.getElementById('btn-primary');
                const CIRCUMFERENCE = 276.46;
                if (ringFill) {
                    let pct = 1.0;
                    if (window.myCurrentRole === 'driver') {
                        pct = Math.max(0, sp.boost) / 100;
                        ringFill.style.stroke = pct > 0.2 ? 'var(--neon-cyan)' : 'var(--neon-pink)';
                        if (btnPrimary) btnPrimary.textContent = 'A';
                    } else if (window.myCurrentRole === 'gunner') {
                        pct = Math.max(0, 1 - sp.bombCooldown / 1.25);
                        ringFill.style.stroke = pct >= 1 ? 'var(--neon-cyan)' : '#ff8c00';
                        if (btnPrimary) btnPrimary.textContent = 'A';
                    }
                    ringFill.style.strokeDashoffset = CIRCUMFERENCE * (1 - pct);
                }

                // Health vignette
                const vignette = document.getElementById('health-vignette');
                if (vignette) {
                    if (sp.health < 50) {
                        let intensity = (50 - sp.health) / 50;
                        vignette.style.background = `radial-gradient(ellipse at center, transparent 40%, rgba(255,30,30,${intensity * 0.6}) 100%)`;
                    } else {
                        vignette.style.background = 'none';
                    }
                }

                // FOV shift when boosting (3a)
                window.targetFOV = (sp.isBoosting && sp.boost > 0) ? 95 : (window.myCurrentRole === 'driver' ? 75 : 85);
            }

            if (window.minimapCtx && !window.isSpectating) {
                let totalTanks = Object.keys(serverState.tanks).length;
                let myTeam = window.myCurrentTankId ? (parseInt(window.myCurrentTankId.replace('tank','')) <= Math.ceil(totalTanks/2) ? 1 : 2) : 0;
                let otherTeam = parseInt(tId.replace('tank','')) <= Math.ceil(totalTanks/2) ? 1 : 2;
                let dotColor = '#ff3366';
                if (tId === window.myCurrentTankId) dotColor = '#b4d455'; else if (window.currentMatchMode === '3v3' && myTeam === otherTeam) dotColor = '#6dcbc3';
                let center = window.minimapCanvas.width / 2;
                window.minimapCtx.fillStyle = dotColor; window.minimapCtx.beginPath(); window.minimapCtx.arc(center + (sp.x/400)*center, center + (sp.z/400)*center, 4, 0, Math.PI*2); window.minimapCtx.fill();
            }
        } else {
            // Clean up health ring for dead tanks
            if (tank.healthRing) {
                for (let mesh of tank.healthRing) { mesh.visible = false; }
            }
        }
    }


    for(let i=0; i<window.bulletPool.length; i++) window.bulletPool[i].visible = false;
    if (serverState.bullets) {
        for(let i=0; i<serverState.bullets.length; i++) {
            if (!window.bulletPool[i]) { let m = new THREE.Mesh(bulletGeo, bulletMat); window.Graphics.matchGroup.add(m); window.bulletPool.push(m); }
            let bData = serverState.bullets[i];
            window.bulletPool[i].position.set(bData.x, bData.y, bData.z);
            window.bulletPool[i].lookAt(window.bulletPool[i].position.clone().add(new THREE.Vector3(bData.dx, bData.dy, bData.dz)));
            window.bulletPool[i].visible = true;
        }
    }

    for(let i=0; i<window.zonePool.length; i++) window.zonePool[i].visible = false;
    if (serverState.blastZones) {
        for(let i=0; i<serverState.blastZones.length; i++) {
            if (!window.zonePool[i]) { let m = new THREE.Mesh(zoneGeo, zoneMat); window.Graphics.matchGroup.add(m); window.zonePool.push(m); }
            let zData = serverState.blastZones[i];
            window.zonePool[i].position.set(zData.x, zData.y + 1.0, zData.z); window.zonePool[i].visible = true;
            let progress = 1.0 - (zData.life / 1.2); let scale = Math.max(0.01, Math.pow(progress, 0.2));
            window.zonePool[i].scale.setScalar(scale); window.zonePool[i].material.opacity = 0.2 * (1.0 - progress);
        }
    }

    // Trim pools if they've grown too large relative to current active count
    const activeBulletCount = (serverState.bullets || []).length;
    while (window.bulletPool.length > Math.max(20, activeBulletCount * 2)) {
        let excess = window.bulletPool.pop();
        window.Graphics.matchGroup.remove(excess);
        if (excess.geometry) excess.geometry.dispose();
    }
    const activeZoneCount = (serverState.blastZones || []).length;
    while (window.zonePool.length > Math.max(10, activeZoneCount * 2)) {
        let excess = window.zonePool.pop();
        window.Graphics.matchGroup.remove(excess);
        if (excess.geometry) excess.geometry.dispose();
    }

    if (serverState.explosions) serverState.explosions.forEach(exp => {
        window.Graphics.createShatterParticles(new THREE.Vector3(exp.x, exp.y, exp.z), 40);
        if (window.AudioManager) window.AudioManager.sounds.concussiveImpact();
    });
    if (serverState.hits) {
        serverState.hits.forEach(hit => {
            window.Graphics.createShatterParticles(new THREE.Vector3(hit.x, hit.y, hit.z), 3, 0xffe600);
            if (hit.owner === window.myCurrentTankId && window.myCurrentRole === 'gunner') {
                window.hitFlashTimer = 0.15;
                // Camera punch forward
                window.shakeTimer = 0.12;
                window.shakeIntensity = 0.4;
                // Floating damage number
                spawnDamageNumber(hit.x, hit.y, hit.z, hit.damage || 6);
                // Track for kill-confirm detection
                if (hit.targetId) {
                    if (!window._lastHitByMe) window._lastHitByMe = {};
                    window._lastHitByMe[hit.targetId] = Date.now();
                }
                if (window.AudioManager) window.AudioManager.sounds.hitConfirm();
            }
        });
    }

    // Screen shake on being hit by concussive blast (check health drop)
    for (let tId in serverState.tanks) {
        if (tId === window.myCurrentTankId) {
            let sp = serverState.tanks[tId];
            let prevHealth = window._prevHealth || 100;
            let dmg = prevHealth - sp.health;
            if (dmg > 10 && !sp.isDead) {
                window.shakeTimer = 0.3;
                window.shakeIntensity = Math.min(3.0, dmg * 0.05);
                // Chromatic aberration on heavy damage
                if (dmg > 20) window._chromaticTimer = 0.4;
            }
            window._prevHealth = sp.health;
            if (sp.isDead) window._prevHealth = 100;
        }
    }

    // Cache last state for scoreboard
    window._lastServerState = serverState;

    if (serverState.shutters) {
        serverState.shutters.forEach(s => {
            if (window.visualShutters && window.visualShutters[s.id]) {
                if (s.health <= 0 && window.visualShutters[s.id].visible) {
                    window.visualShutters[s.id].visible = false;
                    window.Graphics.createShatterParticles(window.visualShutters[s.id].position, 30, 0x1f1c30);
                }
            }
        });
    }

    // --- CTF FLAGS ---
    if (serverState.flags) {
        if (!window.ctfFlagMeshes) window.ctfFlagMeshes = {};
        if (!window._prevFlagCarriers) window._prevFlagCarriers = {};
        serverState.flags.forEach(flag => {
            const key = `team${flag.team}`;
            const prevCarrier = window._prevFlagCarriers[key];
            const currCarrier = flag.carrierId || null;

            // Detect pickup / drop events for audio
            if (window.AudioManager && prevCarrier !== undefined) {
                if (!prevCarrier && currCarrier) {
                    // Flag was just picked up
                    if (currCarrier === window.myCurrentTankId) {
                        window.AudioManager.sounds.flagPickup();
                    } else {
                        window.AudioManager.sounds.flagAlert();
                    }
                }
                // Flag drop/capture handled by the CTF score section below
            }
            window._prevFlagCarriers[key] = currCarrier;
            if (!window.ctfFlagMeshes[key]) {
                const color = flag.team === 1 ? 0xb4d455 : 0xff3366;
                const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.0, transparent: true, opacity: 0.92 });
                const mesh = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12), mat);
                mesh.userData = { type: 'ctfFlag', team: flag.team };
                window.Graphics.matchGroup.add(mesh);
                window.ctfFlagMeshes[key] = mesh;
            }
            const mesh = window.ctfFlagMeshes[key];
            const pulse = Math.sin(Date.now() * 0.004) * 0.5 + 0.5;
            mesh.material.emissiveIntensity = 1.5 + pulse;
            mesh.scale.setScalar(1.0 + pulse * 0.1);
            const flagStatus = flag.carrierId ? 'carried' : 'home';
            if (flag.carrierId && window.visualTanks[flag.carrierId] && !window.visualTanks[flag.carrierId].wasDead) {
                const carrier = window.visualTanks[flag.carrierId];
                mesh.position.set(carrier.position.x, carrier.position.y + 7, carrier.position.z);
            } else {
                mesh.position.set(flag.homeX, flag.homeY + 3 + Math.sin(Date.now() * 0.003) * 1.0, flag.homeZ);
            }
        });

        // --- CTF FLAG HUD STATUS ---
        let flagHudEl = document.getElementById('ctf-flag-hud');
        if (!flagHudEl) {
            flagHudEl = document.createElement('div');
            flagHudEl.id = 'ctf-flag-hud';
            flagHudEl.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);display:flex;gap:16px;z-index:100;pointer-events:none;font-family:"Courier New",monospace;font-size:0.85rem;';
            const uiLayer = document.getElementById('ui-layer');
            if (uiLayer) uiLayer.appendChild(flagHudEl);
        }
        flagHudEl.innerHTML = serverState.flags.map(flag => {
            const teamColor = flag.team === 1 ? '#b4d455' : '#ff3366';
            let status, icon;
            if (flag.carrierId) {
            const carrierName = flag.carrierId === window.myCurrentTankId ? 'YOU' : `T${flag.carrierId.replace('tank', '')}`;
                status = `⚡ CARRIED BY ${carrierName}`;
                icon = '🚩';
            } else {
                status = '🏠 HOME';
                icon = flag.team === 1 ? '🟢' : '🔴';
            }
            return `<div style="background:rgba(0,0,0,0.7);padding:4px 10px;border-radius:4px;border:1px solid ${teamColor};color:${teamColor};">${icon} T${flag.team}: ${status}</div>`;
        }).join('');
    } else {
        const flagHudEl = document.getElementById('ctf-flag-hud');
        if (flagHudEl) flagHudEl.remove();
    }

    // --- CTF SCORE HUD ---
    if (serverState.mode === 'CTF' && serverState.scores) {
        // Detect score change → flag capture audio
        if (window.AudioManager) {
            if (!window._prevCTFScores) window._prevCTFScores = {};
            for (const team in serverState.scores) {
                const prev = window._prevCTFScores[team] || 0;
                if (serverState.scores[team] > prev) {
                    window.AudioManager.sounds.flagCapture();
                }
            }
            window._prevCTFScores = Object.assign({}, serverState.scores);
        }

        let scoreEl = document.getElementById('ctf-scores');
        if (!scoreEl) {
            scoreEl = document.createElement('div');
            scoreEl.id = 'ctf-scores';
            scoreEl.style.cssText = 'position:fixed;top:50px;left:50%;transform:translateX(-50%);color:white;font-size:1.6rem;font-family:"Courier New",monospace;z-index:100;text-shadow:0 0 8px rgba(0,0,0,0.8);letter-spacing:0.1em;pointer-events:none;';
            const uiLayer = document.getElementById('ui-layer');
            if (uiLayer) uiLayer.appendChild(scoreEl);
        }
        scoreEl.innerHTML = `<span style="color:#b4d455">${serverState.scores[1] || 0}</span> <span style="color:#aaa">—</span> <span style="color:#ff3366">${serverState.scores[2] || 0}</span>`;
    } else {
        const scoreEl = document.getElementById('ctf-scores');
        if (scoreEl) scoreEl.remove();
    }

    // --- MATCH TIMER HUD ---
    if (window.isMatchActive) {
        const timerEl = document.getElementById('match-timer');
        if (timerEl) {
            if (serverState.matchTimer !== undefined) {
                const t = Math.max(0, serverState.matchTimer);
                const mins = Math.floor(t / 60);
                const secs = Math.floor(t % 60);
                timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
                timerEl.classList.remove('hidden');
                if (t <= 30) timerEl.classList.add('timer-low');
                else timerEl.classList.remove('timer-low');
            }
        }
    }

    // --- KILL FEED ---
    if (serverState.killFeed && serverState.killFeed.length > 0) {
        const feedEl = document.getElementById('kill-feed');
        if (feedEl && window.isMatchActive) {
            feedEl.classList.remove('hidden');
            const now = Date.now();
            // Add new entries
            const lastSeen = window._lastKillFeedCount || 0;
            if (serverState.killFeed.length > lastSeen) {
                for (let ki = lastSeen; ki < serverState.killFeed.length; ki++) {
                    const kf = serverState.killFeed[ki];
                    const weaponIcon = kf.weapon === 'concussive' ? '💥' : kf.weapon === 'rapid' ? '🔫' : '🚗';
                    const entry = document.createElement('div');
                    entry.className = 'kill-feed-entry';
                    entry.textContent = `${kf.killer} ${weaponIcon} ${kf.victim}`;
                    feedEl.appendChild(entry);
                    window._killFeedEntries.push({ el: entry, born: now });
                    // Keep max 5
                    while (feedEl.children.length > 5) feedEl.removeChild(feedEl.firstChild);
                }
            }
            window._lastKillFeedCount = serverState.killFeed.length;
            // Fade out old entries
            window._killFeedEntries = window._killFeedEntries.filter(fe => {
                const age = (now - fe.born) / 1000;
                if (age > 3) { fe.el.remove(); return false; }
                fe.el.style.opacity = Math.max(0, 1 - (age - 2.5) / 0.5);
                return true;
            });
        }
    }

    // --- END-OF-MATCH OVERLAY ---
    if (serverState.matchOver) {
        const endEl = document.getElementById('end-screen');
        if (endEl && endEl.classList.contains('hidden')) {
            endEl.classList.remove('hidden');
            // Determine winner
            let winText = 'TIME UP!';
            let subText = '';
            if (serverState.mode === 'CTF' && serverState.scores) {
                const s1 = serverState.scores[1] || 0;
                const s2 = serverState.scores[2] || 0;
                if (s1 > s2) { winText = '🟢 TEAM 1 WINS'; subText = `${s1} — ${s2}`; }
                else if (s2 > s1) { winText = '🔴 TEAM 2 WINS'; subText = `${s1} — ${s2}`; }
                else { winText = 'DRAW!'; subText = `${s1} — ${s2}`; }
            }
            // Build stats table
            let statsRows = '';
            if (serverState.killStats) {
                const sorted = Object.entries(serverState.killStats).sort((a, b) => b[1].kills - a[1].kills);
                sorted.forEach(([tid, stat]) => {
                    const isMine = (tid === window.myCurrentTankId);
                    statsRows += `<tr class="${isMine ? 'highlight' : ''}"><td>${tid}</td><td>${stat.kills}</td><td>${stat.deaths}</td></tr>`;
                });
            }
            endEl.innerHTML = `
                <div class="end-card interactive">
                    <div class="end-title">${winText}</div>
                    <div class="end-subtitle">${subText || 'MATCH COMPLETE'}</div>
                    <div class="end-stats">
                        <table><thead><tr><th>TANK</th><th>KILLS</th><th>DEATHS</th></tr></thead>
                        <tbody>${statsRows}</tbody></table>
                    </div>
                    <button onclick="window.location.reload()" class="primary-btn" style="touch-action:manipulation;">RETURN TO LOBBY</button>
                </div>`;
        }
    }
};

// --- Floating damage number spawn ---
const _dmgNumbersContainer = document.getElementById('dmg-numbers');
function spawnDamageNumber(worldX, worldY, worldZ, damage) {
    const container = _dmgNumbersContainer;
    if (!container) return;
    const el = document.createElement('div');
    el.textContent = '-' + Math.round(damage);
    el.style.cssText = 'position:absolute;color:#ffe600;font-weight:bold;font-size:1.1rem;font-family:Courier New,monospace;text-shadow:0 0 6px #000;pointer-events:none;transition:none;';
    // Project world pos to screen
    const vec = new THREE.Vector3(worldX, worldY + 3, worldZ);
    vec.project(window.Graphics.camera);
    let sx = (vec.x * 0.5 + 0.5) * window.innerWidth;
    let sy = (-vec.y * 0.5 + 0.5) * window.innerHeight;
    el.style.left = sx + 'px'; el.style.top = sy + 'px';
    el.style.transform = 'translate(-50%, -50%)';
    container.appendChild(el);
    let life = 0;
    const tick = () => {
        life += 0.016;
        el.style.top = (sy - life * 60) + 'px';
        el.style.opacity = Math.max(0, 1 - life / 0.8);
        if (life < 0.8) requestAnimationFrame(tick);
        else el.remove();
    };
    requestAnimationFrame(tick);
}

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);

    if (window.Controls) window.Controls.processKeyboard();

    if (!window.isMatchActive) {
        let screenStart = document.getElementById('start-screen'); let screenHost = document.getElementById('host-setup-screen');
        if (!screenStart.classList.contains('hidden') || !screenHost.classList.contains('hidden')) {
            window.Graphics.camera.position.lerp(new THREE.Vector3(0, 60, 90), 5 * delta); window.Graphics.camera.lookAt(0, 0, 0);
            if (window.Controls) window.Controls.manualLobbyRot = 0;
        } else {
            let targetX = 0, targetZ = 0;
            if (window.myCurrentTankId && window.lobbyTanks && window.lobbyTanks[window.myCurrentTankId]) {
                targetX = window.lobbyTanks[window.myCurrentTankId].position.x; targetZ = window.lobbyTanks[window.myCurrentTankId].position.z;
            } else if (window.lobbyTanks && window.lobbyTanks['tank1']) {
                targetX = window.lobbyTanks['tank1'].position.x; targetZ = window.lobbyTanks['tank1'].position.z;
            }
            let camOffset = new THREE.Vector3(0, 15, 30); camOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), window.Controls ? window.Controls.manualLobbyRot : 0);
            let idealPos = new THREE.Vector3(targetX, 0, targetZ).add(camOffset); let py = window.getTerrainHeight(targetX, targetZ, window.currentMapName); idealPos.y += py;
            window.Graphics.camera.position.lerp(idealPos, 8 * delta); window.Graphics.camera.lookAt(targetX, py + 2, targetZ);
        }
    } else {
        // --- FOV LERP (3a) ---
        window.currentFOV = THREE.MathUtils.lerp(window.currentFOV, window.targetFOV, delta / 0.2);

        // --- SCREEN SHAKE (3b) ---
        if (window.shakeTimer > 0) {
            window.shakeTimer -= delta;
            let s = window.shakeIntensity * (window.shakeTimer / 0.3);
            window.shakeOffset.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.5, (Math.random() - 0.5) * s);
        } else {
            window.shakeOffset.set(0, 0, 0);
        }

        if (window.myCurrentRole === 'spectator') {
            // If locked onto a specific tank, follow that tank
            if (window.spectatorFollowTank && window.visualTanks[window.spectatorFollowTank] && !window.visualTanks[window.spectatorFollowTank].wasDead) {
                const followTank = window.visualTanks[window.spectatorFollowTank];
                const idealPos = followTank.position.clone().add(new THREE.Vector3(0, 35, 25));
                window.Graphics.camera.position.lerp(idealPos, 8 * delta);
                window.Graphics.camera.lookAt(followTank.position);
            } else {
                // Free-fly spectator camera
                let sSpeed = window.Controls.input.isBoosting ? 150 : 60;
                let forward = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), window.Controls.specCam.yaw);
                let right = new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0), window.Controls.specCam.yaw);
                window.Controls.specCam.x += (-window.Controls.input.moveY * forward.x + window.Controls.input.moveX * right.x) * sSpeed * delta;
                window.Controls.specCam.z += (-window.Controls.input.moveY * forward.z + window.Controls.input.moveX * right.z) * sSpeed * delta;
                window.Controls.specCam.yaw -= window.Controls.aimJoystick.x * 2.5 * delta;
                window.Controls.specCam.pitch -= window.Controls.aimJoystick.y * 2.5 * delta;
                window.Controls.specCam.pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, window.Controls.specCam.pitch));
                window.Graphics.camera.position.set(window.Controls.specCam.x, window.Controls.specCam.y, window.Controls.specCam.z);
                window.Graphics.camera.rotation.set(window.Controls.specCam.pitch, window.Controls.specCam.yaw, 0, 'YXZ');
            }
        }

        if (window.myCurrentRole === 'gunner') {
            let bestTarget = null; let bestDot = 0.96; let camDir = new THREE.Vector3(0,0,-1).applyQuaternion(window.Graphics.camera.quaternion);
            for (let tId in window.visualTanks) {
                if (tId === window.myCurrentTankId || window.visualTanks[tId].wasDead) continue;
                let totalTanks = Object.keys(window.visualTanks).length;
                let myTeam = parseInt(window.myCurrentTankId.replace('tank','')) <= Math.ceil(totalTanks / 2) ? 1 : 2; let theirTeam = parseInt(tId.replace('tank','')) <= Math.ceil(totalTanks / 2) ? 1 : 2;
                if (window.currentMatchMode === '3v3' && myTeam === theirTeam) continue;
                let tPos = window.visualTanks[tId].position.clone(); tPos.y += 1.5;
                let dirToTarget = tPos.clone().sub(window.Graphics.camera.position).normalize(); let dot = camDir.dot(dirToTarget); let dist = window.Graphics.camera.position.distanceTo(tPos);
                if (dot > bestDot && dist < MAX_LOCK_DISTANCE) { bestDot = dot; bestTarget = tId; }
            }
            window.Controls.lockedTargetId = bestTarget;
            if (Math.abs(window.Controls.aimJoystick.x) > 0.01 || Math.abs(window.Controls.aimJoystick.y) > 0.01) {
                let expX = Math.pow(Math.abs(window.Controls.aimJoystick.x), 2.5) * Math.sign(window.Controls.aimJoystick.x); let expY = Math.pow(Math.abs(window.Controls.aimJoystick.y), 2.5) * Math.sign(window.Controls.aimJoystick.y);
                let friction = window.Controls.lockedTargetId ? 0.4 : 1.0; window.Controls.localAim.yaw -= expX * 4.5 * friction * delta; window.Controls.localAim.pitch += -expY * 2.5 * friction * delta;
            }
            if (window.Controls.lockedTargetId) {
                let targetTank = window.visualTanks[window.Controls.lockedTargetId]; let targetPos = targetTank.position.clone(); targetPos.y += 1.5;
                let dirToTarget = targetPos.clone().sub(window.Graphics.camera.position).normalize();
                let targetYaw = Math.atan2(-dirToTarget.x, -dirToTarget.z); let targetPitch = Math.asin(dirToTarget.y);
                let diffYaw = targetYaw - window.Controls.localAim.yaw; while (diffYaw < -Math.PI) diffYaw += Math.PI * 2; while (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
                window.Controls.localAim.yaw += diffYaw * 3.0 * delta; window.Controls.localAim.pitch += (targetPitch - window.Controls.localAim.pitch) * 3.0 * delta;
            }
            window.Controls.localAim.pitch = Math.max(-Math.PI / 2.05, Math.min(Math.PI / 2.05, window.Controls.localAim.pitch));
            window.Controls.input.aimYaw = window.Controls.localAim.yaw; window.Controls.input.aimPitch = window.Controls.localAim.pitch;
        }

        window.Graphics.updateParticles(delta);

        for (let i = window.activePings.length - 1; i >= 0; i--) {
            const p = window.activePings[i]; p.life -= delta;
            if (p.life <= 0) { window.Graphics.matchGroup.remove(p.mesh); if (p.mesh.material) p.mesh.material.dispose(); window.activePings.splice(i, 1); }
            else { p.mesh.scale.y = Math.max(0, p.life / 4.0); }
        }

        // --- RESPAWN COUNTDOWN ---
        if (window._respawnCountdown > 0) {
            window._respawnCountdown -= delta;
            const respawnEl = document.getElementById('respawn-overlay');
            if (respawnEl) {
                const secs = Math.ceil(window._respawnCountdown);
                respawnEl.textContent = `RESPAWNING IN ${secs}...`;
                respawnEl.classList.remove('hidden');
            }
        } else {
            const respawnEl = document.getElementById('respawn-overlay');
            if (respawnEl && !respawnEl.classList.contains('hidden')) respawnEl.classList.add('hidden');
        }

        // --- DEATH CAM (3g) ---
        if (window.deathCamTimer > 0) {
            window.deathCamTimer -= delta;
            // Follow killer tank if known
            if (window.deathCamKillerId && window.visualTanks[window.deathCamKillerId]) {
                const killerPos = window.visualTanks[window.deathCamKillerId].position;
                window.deathCamPos = killerPos.clone().add(new THREE.Vector3(0, 40, 30));
                window.deathCamTarget = killerPos.clone();
            }
            if (window.deathCamPos && window.deathCamTarget) {
                window.Graphics.camera.position.lerp(window.deathCamPos, 8 * delta);
                window.Graphics.camera.lookAt(window.deathCamTarget);
            }
            // Allow aim joystick to orbit during death
            if (window.Controls) {
                window._deathCamOrbit = window._deathCamOrbit || 0;
                window._deathCamOrbit += window.Controls.aimJoystick.x * 2 * delta;
            }
            if (window.deathCamTimer <= 0) {
                window.deathCamPos = null; window.deathCamTarget = null;
                window.deathCamKillerId = null; window._deathCamOrbit = 0;
            }
        } else {
            for (let tId in window.visualTanks) {
                let tank = window.visualTanks[tId];
                if (tank.targetPos && !tank.wasDead) {
                    if (tank.serverVelocity) tank.targetPos.add(tank.serverVelocity.clone().multiplyScalar(delta));
                    tank.position.lerp(tank.targetPos, 10 * delta); tank.quaternion.slerp(tank.targetQuat, 12 * delta);
                    let visualGroundY = window.getTerrainHeight(tank.position.x, tank.position.z, window.currentMapName); if (tank.position.y < visualGroundY) tank.position.y = visualGroundY;
                    tank.currentTurretYOffset = THREE.MathUtils.lerp(tank.currentTurretYOffset || 0, tank.targetTurretYOffset || 0, 15 * delta);
                    tank.turretRef.position.copy(tank.position); tank.turretRef.position.y += 2.2 + tank.currentTurretYOffset;

                    if (tId === window.myCurrentTankId && window.myCurrentRole === 'gunner') { tank.targetTurretYaw = window.Controls.localAim.yaw; tank.targetTurretPitch = window.Controls.localAim.pitch; }
                    tank.turretRef.rotation.y = THREE.MathUtils.lerp(tank.turretRef.rotation.y, tank.targetTurretYaw || 0, 20 * delta); tank.pitchRef.rotation.x = THREE.MathUtils.lerp(tank.pitchRef.rotation.x, (tank.targetTurretPitch || 0), 20 * delta);

                    if (tId === window.myCurrentTankId) {
                        if (window.myCurrentRole === 'driver') {
                            window.Graphics.camera.up.set(0, 1, 0);
                            window.Graphics.camera.fov = window.currentFOV;
                            window.Graphics.camera.updateProjectionMatrix();
                            const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0,1,0), tank.targetRot || 0);
                            const idealPos = tank.position.clone().add(forward.multiplyScalar(-24)); let camGround = window.getTerrainHeight(idealPos.x, idealPos.z, window.currentMapName); idealPos.y = Math.max(camGround + 8, tank.position.y + 12);
                            let finalPos = idealPos.clone().add(window.shakeOffset);
                            window.Graphics.camera.position.lerp(finalPos, 10 * delta); window.Graphics.camera.lookAt(tank.position.clone().add(new THREE.Vector3(0, 3, 0)));
                        } else if (window.myCurrentRole === 'gunner') {
                            window.Graphics.camera.up.set(0, 1, 0);
                            window.Graphics.camera.fov = window.currentFOV;
                            window.Graphics.camera.updateProjectionMatrix();
                            let pitch = tank.targetTurretPitch || 0; let yaw = tank.targetTurretYaw || 0;
                            let aimDirX = -Math.sin(yaw) * Math.cos(pitch); let aimDirY = Math.sin(pitch); let aimDirZ = -Math.cos(yaw) * Math.cos(pitch);
                            const aimForward3D = new THREE.Vector3(aimDirX, aimDirY, aimDirZ).normalize();
                            let turretCenter = tank.turretRef.position.clone(); let idealDist = 14.0;
                            let idealPos = turretCenter.clone().add(aimForward3D.clone().multiplyScalar(-idealDist)); idealPos.y += 3.5;
                            let rayDir = idealPos.clone().sub(turretCenter).normalize(); let rayLength = turretCenter.distanceTo(idealPos);
                            const camRaycaster = new THREE.Raycaster(turretCenter, rayDir, 0, rayLength); const intersects = camRaycaster.intersectObjects(window.Graphics.matchGroup.children, true);
                            let finalDist = rayLength;
                            for (let i = 0; i < intersects.length; i++) { let obj = intersects[i].object; if (obj.userData && (obj.userData.type === 'obstacle' || obj.userData.type === 'floor')) { finalDist = Math.max(2.0, intersects[i].distance - 1.0); break; } }
                            let finalCamPos = turretCenter.clone().add(rayDir.multiplyScalar(finalDist)).add(window.shakeOffset);
                            window.Graphics.camera.position.lerp(finalCamPos, 15 * delta);
                            let lookAtPoint = turretCenter.clone().add(aimForward3D.multiplyScalar(200.0)); window.Graphics.camera.lookAt(lookAtPoint);
                        }
                    }
                }
            }
        }

        if (window.myCurrentRole === 'gunner') {
            const crosshair = document.getElementById('crosshair');
            if (window.hitFlashTimer > 0) {
                window.hitFlashTimer -= delta;
                crosshair.style.borderColor = 'rgba(255, 255, 255, 0.9)'; crosshair.style.backgroundColor = 'rgba(255, 255, 255, 0.4)';
                crosshair.style.transform = 'translate(-50%, -50%) scale(1.3)'; crosshair.style.borderRadius = '50%';
            } else {
                if (window.Controls.lockedTargetId) {
                    crosshair.style.borderColor = 'rgba(255, 51, 102, 1.0)'; crosshair.style.backgroundColor = 'rgba(255, 51, 102, 0.2)';
                    crosshair.style.transform = 'translate(-50%, -50%) scale(0.6) rotate(45deg)'; crosshair.style.borderRadius = '4px';
                } else {
                    crosshair.style.transform = 'translate(-50%, -50%) scale(1.0) rotate(0deg)'; crosshair.style.borderRadius = '50%';
                    // Throttle raycasting to every 3rd frame
                    window._crosshairFrameCount = (window._crosshairFrameCount || 0) + 1;
                    if (window._crosshairFrameCount % 3 === 0) {
                        window._reusableRaycaster.setFromCamera(window._reusableVec2, window.Graphics.camera);
                        const intersects = window._reusableRaycaster.intersectObjects(window.Graphics.matchGroup.children, true);
                        let hitObstacle = false;
                        for (let i = 0; i < intersects.length; i++) {
                            let obj = intersects[i].object; if (!obj.visible || (obj.parent && !obj.parent.visible)) continue;
                            if (obj.userData && obj.userData.type === 'obstacle') { hitObstacle = true; break; } else if (obj.userData && obj.userData.type === 'floor') break;
                        }
                        window._crosshairHitObstacle = hitObstacle;
                    }
                    if (window._crosshairHitObstacle) { crosshair.style.borderColor = 'rgba(255, 140, 0, 0.9)'; crosshair.style.backgroundColor = 'rgba(255, 140, 0, 0.2)'; }
                    else { crosshair.style.borderColor = 'rgba(180, 212, 85, 0.5)'; crosshair.style.backgroundColor = 'transparent'; }
                }
            }
        }

        // --- SCREEN SPACE EFFECTS ---
        const canvas = window.Graphics.renderer.domElement;
        // Motion blur during boost
        const myTankData = window.visualTanks[window.myCurrentTankId];
        const isBoosting = myTankData && myTankData.lastNetPos && window.myCurrentRole === 'driver' &&
            window.Controls && window.Controls.input.isBoosting;
        canvas.style.filter = isBoosting ? 'blur(1px)' : '';

        // Chromatic aberration on heavy damage
        if (window._chromaticTimer > 0) {
            window._chromaticTimer -= delta;
            const t = window._chromaticTimer / 0.4;
            canvas.style.filter = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='c'><feColorMatrix type='matrix' values='1 0 0 0 ${t*0.04} 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0'/></filter></svg>#c")`;
        } else if (!isBoosting) {
            canvas.style.filter = '';
        }

        // --- SCOREBOARD (TAB key) ---
        const showScoreboard = window.Controls && window.Controls.keys && window.Controls.keys['Tab'];
        const scoreboardEl = document.getElementById('scoreboard-overlay');
        if (scoreboardEl) {
            if (showScoreboard && window._lastServerState && window._lastServerState.killStats) {
                if (scoreboardEl.classList.contains('hidden')) {
                    scoreboardEl.classList.remove('hidden');
                    const ks = window._lastServerState.killStats;
                    const sorted = Object.entries(ks).sort((a, b) => b[1].kills - a[1].kills);
                    let rows = sorted.map(([tid, s]) =>
                        `<tr class="${tid === window.myCurrentTankId ? 'scoreboard-myrow' : ''}"><td>${tid}</td><td>${s.kills}</td><td>${s.deaths}</td></tr>`
                    ).join('');
                    scoreboardEl.innerHTML = `<h3>SCOREBOARD</h3><table class="scoreboard-table"><thead><tr><th>TANK</th><th>K</th><th>D</th></tr></thead><tbody>${rows}</tbody></table>`;
                }
            } else {
                if (!scoreboardEl.classList.contains('hidden')) scoreboardEl.classList.add('hidden');
            }
        }
    }
    window.Graphics.render();
}

setTimeout(() => { if (window.updateLobbyPreview) window.updateLobbyPreview('stress_test', 6); animate(); }, 500);
