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
window.currentMapName = 'stress_test';
window.currentMatchMode = 'FFA';

window.lobbyTanks = {};
window.activePings = [];
window.visualTanks = {};
window.bulletPool = [];
window.zonePool = [];

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

window.destroyLobbyTank = function(tId) {
    if (window.lobbyTanks[tId]) {
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
        window.currentMapName = map || 'bowl';
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
    if (window.currentMapName !== lobby.map) {
        window.currentMapName = lobby.map || 'bowl';
        window.Graphics.rebuildMapGeometry(window.currentMapName);
        window.Graphics.loadEnvironmentProps(window.currentMapName);
    }
    for (let tId in window.lobbyTanks) { if (!lobby.tankConfigs[tId]) window.destroyLobbyTank(tId); }
    let count = lobby.maxTanks || 6; let radius = 15; let angleStep = (Math.PI * 2) / count;
    for (let i = 1; i <= count; i++) {
        let tId = `tank${i}`; let conf = lobby.tankConfigs[tId]; if (!conf) continue;
        window.destroyLobbyTank(tId);
        let tankGroup = window.TankFactory.createTank({ id: tId, ...conf }, window.Graphics.matchGroup);
        window.lobbyTanks[tId] = tankGroup;
        let angle = (i - 1) * angleStep; let px = Math.cos(angle) * radius; let pz = Math.sin(angle) * radius;
        let py = window.getTerrainHeight(px, pz, window.currentMapName);
        tankGroup.position.set(px, py, pz); tankGroup.rotation.y = -angle + Math.PI / 2;
        if (tankGroup.turretRef) { tankGroup.turretRef.position.set(px, py + 2.2, pz); tankGroup.turretRef.rotation.y = -angle + Math.PI / 2; }
    }
};

window.onLaunchGame = function(mapName) {
    window.currentMapName = mapName || 'bowl'; window.isMatchActive = true;
    document.getElementById('lobby-screen').classList.add('hidden');
    for (let tId in window.lobbyTanks) { window.destroyLobbyTank(tId); }

    if (window.isSpectating) {
        document.getElementById('crosshair').classList.add('hidden');
        document.getElementById('btn-boost').classList.add('hidden');
        document.getElementById('btn-jump').classList.add('hidden');
        document.getElementById('hud-bars').classList.add('hidden');
    } else {
        document.getElementById('crosshair').style.transition = 'transform 0.1s, background-color 0.1s, border-color 0.1s, border-radius 0.1s';
    }

    window.Graphics.rebuildMapGeometry(window.currentMapName);
    window.Graphics.loadEnvironmentProps(window.currentMapName);
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
        document.getElementById('crosshair').classList.remove('hidden'); document.getElementById('btn-boost').classList.remove('hidden');
        document.getElementById('btn-jump').classList.remove('hidden'); document.getElementById('hud-bars').classList.remove('hidden');
        document.getElementById('btn-switch-seat').classList.remove('hidden');
        if (window.minimapCanvas) window.minimapCanvas.classList.remove('hidden');

        if (window.myCurrentRole === 'driver') {
            document.getElementById('btn-boost').innerText = 'BOOST';
            document.getElementById('btn-jump').innerText = 'JUMP';
            document.getElementById('crosshair').classList.add('hidden');
            document.getElementById('btn-ability-swap').classList.add('hidden');
        } else {
            document.getElementById('btn-boost').innerText = 'SHOOT';
            document.getElementById('btn-ability-swap').classList.remove('hidden');
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
            window.visualTanks[tId] = window.TankFactory.createTank({id: tId, ...sp.config}, window.Graphics.matchGroup);
            window.visualTanks[tId].wasDead = false;
            window.visualTanks[tId].traverse(child => { if (child.isMesh) child.userData = { type: 'tank', id: tId }; });
            window.visualTanks[tId].turretRef.traverse(child => { if (child.isMesh) child.userData = { type: 'tank', id: tId }; });
        }

        let tank = window.visualTanks[tId];

        if (sp.isDead && !tank.wasDead) { window.Graphics.createShatterParticles(tank.position); tank.turretRef.visible = false; }
        tank.wasDead = sp.isDead; tank.visible = !sp.isDead;
        if (!sp.isDead) tank.turretRef.visible = true;

        if (!sp.isDead) {
            let newTargetPos = new THREE.Vector3(sp.x, sp.y, sp.z);
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
            if (sp.isBoosting && sp.boost > 0) window.Graphics.emitSparks(tank, sp.rot, sp.config, sp.speed);

            // --- DRAW THE GRAPPLE LASER ---
            if (sp.isGrappling) {
                if (!tank.grappleLine) {
                    const lineMat = new THREE.LineBasicMaterial({ color: 0x00ffcc, linewidth: 4, transparent: true, opacity: 0.8 });
                    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
                    tank.grappleLine = new THREE.Line(lineGeo, lineMat);
                    window.Graphics.matchGroup.add(tank.grappleLine);
                }
                let mapProps = window.getMapProps(window.currentMapName);
                if (mapProps && mapProps.cube) {
                    let start = tank.turretRef.position.clone(); start.y += 0.5;
                    let end = new THREE.Vector3(mapProps.cube.x, mapProps.cube.y + Math.sin(Date.now() * 0.003) * 1.5, mapProps.cube.z);
                    tank.grappleLine.geometry.setFromPoints([start, end]);
                    tank.grappleLine.visible = true;
                }
            } else {
                if (tank.grappleLine) tank.grappleLine.visible = false;
            }

            if (tId === window.myCurrentTankId) {
                const barLabel = document.getElementById('bar-label'); const barFill = document.getElementById('bar-fill');
                if (window.myCurrentRole === 'driver') {
                    barLabel.innerText = 'BOOST CAPACITY'; barLabel.style.color = 'var(--neon-green)';
                    barFill.style.width = `${Math.max(0, sp.boost)}%`; barFill.style.background = sp.boost > 0 ? 'var(--neon-green)' : 'var(--neon-pink)';
                } else if (window.myCurrentRole === 'gunner') {
                    barLabel.innerText = 'BLAST READY'; barLabel.style.color = 'var(--neon-cyan)';
                    let blastPct = Math.max(0, 100 - (sp.bombCooldown / 2.0) * 100);
                    barFill.style.width = `${blastPct}%`; barFill.style.background = blastPct >= 100 ? 'var(--neon-cyan)' : 'var(--neon-orange)';

                    // Dynamically change button text based on equipped ability
                    document.getElementById('btn-jump').innerText = sp.gunnerAbility === 'grapple' ? 'GRAPPLE' : 'LIFT';
                }
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

    if (serverState.explosions) serverState.explosions.forEach(exp => { window.Graphics.createShatterParticles(new THREE.Vector3(exp.x, exp.y, exp.z), 40); });
    if (serverState.hits) {
        serverState.hits.forEach(hit => {
            window.Graphics.createShatterParticles(new THREE.Vector3(hit.x, hit.y, hit.z), 3, 0xffe600);
            if (hit.owner === window.myCurrentTankId && window.myCurrentRole === 'gunner') window.hitFlashTimer = 0.15;
        });
    }

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
};

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
        if (window.myCurrentRole === 'spectator') {
            let sSpeed = window.Controls.input.isBoosting ? 150 : 60;
            let forward = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), window.Controls.specCam.yaw);
            let right = new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0), window.Controls.specCam.yaw);
            window.Controls.specCam.x += (-window.Controls.input.moveY * forward.x + window.Controls.input.moveX * right.x) * sSpeed * delta; window.Controls.specCam.z += (-window.Controls.input.moveY * forward.z + window.Controls.input.moveX * right.z) * sSpeed * delta;
            window.Controls.specCam.yaw -= window.Controls.aimJoystick.x * 2.5 * delta; window.Controls.specCam.pitch -= window.Controls.aimJoystick.y * 2.5 * delta; window.Controls.specCam.pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, window.Controls.specCam.pitch));
            window.Graphics.camera.position.set(window.Controls.specCam.x, window.Controls.specCam.y, window.Controls.specCam.z); window.Graphics.camera.rotation.set(window.Controls.specCam.pitch, window.Controls.specCam.yaw, 0, 'YXZ');
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
                        window.Graphics.camera.up.set(0, 1, 0); window.Graphics.camera.fov = 75; window.Graphics.camera.updateProjectionMatrix();
                        const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0,1,0), tank.targetRot || 0);
                        const idealPos = tank.position.clone().add(forward.multiplyScalar(-24)); let camGround = window.getTerrainHeight(idealPos.x, idealPos.z, window.currentMapName); idealPos.y = Math.max(camGround + 8, tank.position.y + 12);
                        window.Graphics.camera.position.lerp(idealPos, 10 * delta); window.Graphics.camera.lookAt(tank.position.clone().add(new THREE.Vector3(0, 3, 0)));
                    } else if (window.myCurrentRole === 'gunner') {
                        window.Graphics.camera.up.set(0, 1, 0); window.Graphics.camera.fov = 85; window.Graphics.camera.updateProjectionMatrix();
                        let pitch = tank.targetTurretPitch || 0; let yaw = tank.targetTurretYaw || 0;
                        let aimDirX = -Math.sin(yaw) * Math.cos(pitch); let aimDirY = Math.sin(pitch); let aimDirZ = -Math.cos(yaw) * Math.cos(pitch);
                        const aimForward3D = new THREE.Vector3(aimDirX, aimDirY, aimDirZ).normalize();
                        let turretCenter = tank.turretRef.position.clone(); let idealDist = 14.0;
                        let idealPos = turretCenter.clone().add(aimForward3D.clone().multiplyScalar(-idealDist)); idealPos.y += 3.5;
                        let rayDir = idealPos.clone().sub(turretCenter).normalize(); let rayLength = turretCenter.distanceTo(idealPos);
                        const camRaycaster = new THREE.Raycaster(turretCenter, rayDir, 0, rayLength); const intersects = camRaycaster.intersectObjects(window.Graphics.matchGroup.children, true);
                        let finalDist = rayLength;
                        for (let i = 0; i < intersects.length; i++) { let obj = intersects[i].object; if (obj.userData && (obj.userData.type === 'obstacle' || obj.userData.type === 'floor')) { finalDist = Math.max(2.0, intersects[i].distance - 1.0); break; } }
                        let finalCamPos = turretCenter.clone().add(rayDir.multiplyScalar(finalDist)); window.Graphics.camera.position.lerp(finalCamPos, 15 * delta);
                        let lookAtPoint = turretCenter.clone().add(aimForward3D.multiplyScalar(200.0)); window.Graphics.camera.lookAt(lookAtPoint);
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
                    const raycaster = new THREE.Raycaster(); raycaster.setFromCamera(new THREE.Vector2(0, 0), window.Graphics.camera);
                    const intersects = raycaster.intersectObjects(window.Graphics.matchGroup.children, true); let hitObstacle = false;
                    for (let i = 0; i < intersects.length; i++) {
                        let obj = intersects[i].object; if (!obj.visible || (obj.parent && !obj.parent.visible)) continue;
                        if (obj.userData && obj.userData.type === 'obstacle') { hitObstacle = true; break; } else if (obj.userData && obj.userData.type === 'floor') break;
                    }
                    if (hitObstacle) { crosshair.style.borderColor = 'rgba(255, 140, 0, 0.9)'; crosshair.style.backgroundColor = 'rgba(255, 140, 0, 0.2)'; }
                    else { crosshair.style.borderColor = 'rgba(180, 212, 85, 0.5)'; crosshair.style.backgroundColor = 'transparent'; }
                }
            }
        }
    }
    window.Graphics.render();
}

setTimeout(() => { if (window.updateLobbyPreview) window.updateLobbyPreview('stress_test', 6); animate(); }, 500);
