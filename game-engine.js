// game-engine.js
const THREE = require('three');
const { ServerTank } = require('./driver');
const { getTerrainHeight, getMapProps } = require('./maps');
const env = require('./environment');

const trunc2 = (val) => Math.round(val * 100) / 100;
const trunc1 = (val) => Math.round(val * 10) / 10;

class Match {
    constructor(roomId, configs, mode, mapName, matchDuration) {
        this.roomId = roomId;
        this.mode = mode || 'FFA';
        this.mapName = mapName || 'bowl';

        this.matchTimer = matchDuration || 300;
        this.matchOver = false;
        this.killStats = {};
        this.killFeed = [];

        this.tanks = {};
        if (configs) {
            let i = 0;
            let totalTanks = Object.keys(configs).length;
            for (let tId in configs) {
                let num = parseInt(tId.replace('tank', ''));
                let team = (this.mode === '3v3' || this.mode === 'CTF') ? (num <= Math.ceil(totalTanks / 2) ? 1 : 2) : num;
                let slotIndex = i % 3;

                this.tanks[tId] = new ServerTank(tId, configs[tId], this.mapName, team, slotIndex);
                this.killStats[tId] = { kills: 0, deaths: 0 };
                i++;
            }
        }
        this.playerMapping = {};

        this.bullets = [];
        this.blastZones = [];
        this.explosions = [];
        this.hits = [];
        this.shutters = this.mapName === 'geometric_gauntlet' ? JSON.parse(JSON.stringify(env.GAUNTLET_PROPS.shutters)) : [];

        if (this.mode === 'CTF') {
            const mapProps = getMapProps(this.mapName);
            const flagDefs = (mapProps && mapProps.flags && mapProps.flags.length === 2)
                ? mapProps.flags
                : [{ team: 1, x: -160, y: 2, z: 0 }, { team: 2, x: 160, y: 2, z: 0 }];
            this.flags = flagDefs.map(f => ({
                team: f.team,
                x: f.x, y: f.y, z: f.z,
                homeX: f.x, homeY: f.y, homeZ: f.z,
                carrierId: null
            }));
            this.scores = { 1: 0, 2: 0 };
        }
    }

    getTeam(tankId) {
        if (this.mode === 'FFA') return parseInt(tankId.replace('tank', ''));

        let num = parseInt(tankId.replace('tank', ''));
        let totalTanks = Object.keys(this.tanks).length;
        return num <= Math.ceil(totalTanks / 2) ? 1 : 2;
    }

    assignPlayer(socketId, tankId, role) {
        this.playerMapping[socketId] = { tankId, role };
        if (tankId && this.tanks[tankId]) {
            if (role === 'driver') this.tanks[tankId].driverId = socketId;
            if (role === 'gunner') this.tanks[tankId].gunnerId = socketId;
        }
    }

    removePlayer(socketId) {
        const mapping = this.playerMapping[socketId];
        if (mapping && mapping.tankId && this.tanks[mapping.tankId]) {
            if (mapping.role === 'driver') this.tanks[mapping.tankId].driverId = null;
            if (mapping.role === 'gunner') this.tanks[mapping.tankId].gunnerId = null;
            delete this.playerMapping[socketId];
        }
    }

    applyInput(socketId, input) {
        const mapping = this.playerMapping[socketId];
        if (mapping && mapping.role === 'spectator') return;
        if (!input || typeof input !== 'object') return;

        if (mapping && this.tanks[mapping.tankId]) {
            const tank = this.tanks[mapping.tankId];
            if (mapping.role === 'driver') {
                const mx = +input.moveX; const my = +input.moveY;
                if (!isFinite(mx) || !isFinite(my)) return;
                tank.driverInputs.moveX = Math.max(-1, Math.min(1, mx || 0));
                tank.driverInputs.moveY = Math.max(-1, Math.min(1, my || 0));
                tank.driverInputs.isBoosting = Boolean(input.isBoosting);
                tank.driverInputs.holdingJump = Boolean(input.holdingJump);
                if (input.triggerJump === true) tank.driverInputs.triggerJump = true;
            } else if (mapping.role === 'gunner') {
                const ay = +input.aimYaw; const ap = +input.aimPitch;
                if (!isFinite(ay) || !isFinite(ap)) return;
                tank.gunnerInputs.aimYaw = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, ay || 0));
                tank.gunnerInputs.aimPitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, ap || 0));
                tank.gunnerInputs.isFiring = Boolean(input.isFiring);
                tank.gunnerInputs.triggerSecondary = Boolean(input.triggerSecondary);
            }
        }
    }

    swapSeats(tankId) {
        const tank = this.tanks[tankId];
        if (!tank) return;
        const oldDriver = tank.driverId; const oldGunner = tank.gunnerId;
        tank.driverId = oldGunner; tank.gunnerId = oldDriver;
        if (oldGunner) this.playerMapping[oldGunner].role = 'driver';
        if (oldDriver) this.playerMapping[oldDriver].role = 'gunner';
    }

    tick(delta) {
        const state = { tanks: {}, assignments: this.playerMapping, mode: this.mode, map: this.mapName };
        const tankIds = Object.keys(this.tanks);

        // --- MATCH TIMER ---
        if (!this.matchOver) {
            this.matchTimer -= delta;
            if (this.matchTimer <= 0) {
                this.matchTimer = 0;
                this.matchOver = true;
            }
        }

        // Check CTF win condition
        if (this.mode === 'CTF' && this.scores) {
            if (this.scores[1] >= 3 || this.scores[2] >= 3) this.matchOver = true;
        }

        state.matchTimer = trunc1(this.matchTimer);
        state.matchOver = this.matchOver;
        state.killStats = this.killStats;
        state.killFeed = this.killFeed.slice(-5);

        this.explosions = [];
        this.hits = [];

        // When match is over, don't process further game logic
        if (this.matchOver) {
            for (let id of tankIds) state.tanks[id] = this.tanks[id].getNetworkState();
            state.bullets = [];
            state.blastZones = [];
            state.hits = [];
            state.shutters = this.shutters;
            if (this.mode === 'CTF' && this.flags) {
                state.flags = this.flags.map(f => ({ team: f.team, x: trunc1(f.x), y: trunc1(f.y), z: trunc1(f.z), homeX: f.homeX, homeY: f.homeY, homeZ: f.homeZ, carrierId: f.carrierId }));
                state.scores = { 1: this.scores[1], 2: this.scores[2] };
            }
            return state;
        }

        for (let id of tankIds) {
            let t = this.tanks[id];
            // Pass CTF flag state to tank for bot AI
            if (this.mode === 'CTF' && this.flags) t._ctfFlags = this.flags;
            t.update(delta, this.tanks, this.mode, this.shutters);

            let barrelBaseY = t.position.y + 2.2 + t.actualTurretYOffset;
            let cameraY = t.position.y + 3.4 + t.actualTurretYOffset;

            // --- FIRE WEAPONS ---
            if (t.fireConcussive || t.fireRapid) {
                let absYaw = t.turretYaw; let absPitch = t.turretPitch;
                let camDirX = -Math.sin(absYaw) * Math.cos(absPitch);
                let camDirY = Math.sin(absPitch);
                let camDirZ = -Math.cos(absYaw) * Math.cos(absPitch);

                let targetX = t.position.x + (camDirX * 40);
                let targetY = cameraY + (camDirY * 40);
                let targetZ = t.position.z + (camDirZ * 40);

                let aimVecX = targetX - t.position.x; let aimVecY = targetY - barrelBaseY; let aimVecZ = targetZ - t.position.z;
                let dist = Math.hypot(aimVecX, aimVecY, aimVecZ);
                let dX = aimVecX / dist; let dY = aimVecY / dist; let dZ = aimVecZ / dist;

                if (t.fireConcussive) {
                    this.bullets.push({ type: 'concussive', owner: id, x: t.position.x + dX*4.5, y: barrelBaseY + dY*4.5, z: t.position.z + dZ*4.5, dx: dX, dy: dY, dz: dZ, speed: 180, life: 1.5 });
                }
                if (t.fireRapid) {
                    let spreadX = (Math.random() - 0.5) * 0.04;
                    let spreadY = (Math.random() - 0.5) * 0.04;
                    let spreadZ = (Math.random() - 0.5) * 0.04;
                    this.bullets.push({ type: 'rapid', owner: id, x: t.position.x + dX*4.5, y: barrelBaseY + dY*4.5, z: t.position.z + dZ*4.5, dx: dX + spreadX, dy: dY + spreadY, dz: dZ + spreadZ, speed: 300, life: 0.8 });
                }
            }
        }

        // --- RAYCAST CCD LOOP ---
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            let b = this.bullets[i];
            let oldX = b.x, oldY = b.y, oldZ = b.z;

            // --- RAPID-FIRE SEMI-SEEKING ---
            if (b.type === 'rapid') {
                let bestTarget = null; let bestDist = 60; let coneCosThreshold = Math.cos(15 * Math.PI / 180);
                let bLen = Math.hypot(b.dx, b.dy, b.dz);
                for (let tId in this.tanks) {
                    if (tId === b.owner || this.tanks[tId].isDead) continue;
                    let isTeammate = ((this.mode === '3v3' || this.mode === 'CTF') && this.getTeam(tId) === this.getTeam(b.owner));
                    if (isTeammate) continue;
                    let target = this.tanks[tId];
                    let tdx = target.position.x - b.x; let tdy = target.position.y - b.y; let tdz = target.position.z - b.z;
                    let dist = Math.hypot(tdx, tdy, tdz);
                    if (dist > 0 && dist < bestDist) {
                        let dot = (b.dx * tdx + b.dy * tdy + b.dz * tdz) / (bLen * dist);
                        if (dot > coneCosThreshold) { bestDist = dist; bestTarget = { dx: tdx/dist, dy: tdy/dist, dz: tdz/dist }; }
                    }
                }
                if (bestTarget) {
                    let seekStr = 0.8 * delta;
                    b.dx += (bestTarget.dx - b.dx) * seekStr;
                    b.dy += (bestTarget.dy - b.dy) * seekStr;
                    b.dz += (bestTarget.dz - b.dz) * seekStr;
                    let newLen = Math.hypot(b.dx, b.dy, b.dz);
                    if (newLen > 0) { b.dx /= newLen; b.dy /= newLen; b.dz /= newLen; }
                }
            }

            b.x += b.dx * b.speed * delta; b.y += b.dy * b.speed * delta; b.z += b.dz * b.speed * delta;
            b.life -= delta;

            let hit = false;
            let segDx = b.x - oldX; let segDy = b.y - oldY; let segDz = b.z - oldZ;
            let segLenSqXZ = segDx * segDx + segDz * segDz;

            for (let tId in this.tanks) {
                if (tId === b.owner || this.tanks[tId].isDead) continue;
                let target = this.tanks[tId];

                let t = 0;
                if (segLenSqXZ > 0) t = Math.max(0, Math.min(1, ((target.position.x - oldX) * segDx + (target.position.z - oldZ) * segDz) / segLenSqXZ));
                let cX = oldX + t * segDx, cZ = oldZ + t * segDz, cY = oldY + t * segDy;

                if (Math.hypot(cX - target.position.x, cZ - target.position.z) < 3.0 && Math.abs(cY - target.position.y) < 3.0) {
                    hit = true;
                    if (b.type === 'concussive') {
                        this.blastZones.push({ x: cX, y: cY, z: cZ, life: 1.2, owner: b.owner, hasPulsed: false });
                    } else if (b.type === 'rapid') {
                        let isTeammate = ((this.mode === '3v3' || this.mode === 'CTF') && this.getTeam(tId) === this.getTeam(b.owner));
                        if (!isTeammate && target.dodgeInvulnTimer <= 0 && target.respawnInvuln <= 0) {
                            const dmg = 9;
                            target.health -= dmg;
                            this.hits.push({ x: trunc2(cX), y: trunc2(cY), z: trunc2(cZ), owner: b.owner, targetId: tId, damage: dmg });
                            if (target.health <= 0) {
                                target.die(b.owner);
                                this._recordKill(b.owner, tId, 'rapid');
                            }
                        }
                    }
                    break;
                }
            }

            if (!hit && this.shutters) {
                for (let s of this.shutters) {
                    if (s.health <= 0) continue;
                    let t = 0;
                    if (segLenSqXZ > 0) t = Math.max(0, Math.min(1, ((s.x - oldX) * segDx + (s.z - oldZ) * segDz) / segLenSqXZ));
                    let cX = oldX + t * segDx, cZ = oldZ + t * segDz, cY = oldY + t * segDy;

                    if (Math.hypot(cX - s.x, cZ - s.z) < s.r && Math.abs(cY - s.y) < 5) {
                        if (b.type === 'concussive') {
                            s.health -= 50;
                            this.blastZones.push({ x: cX, y: cY, z: cZ, life: 1.2, owner: b.owner, hasPulsed: false });
                        } else {
                            s.health -= 6;
                        }
                        hit = true; break;
                    }
                }
            }

            if (!hit) {
                let gY = getTerrainHeight(b.x, b.z, this.mapName);
                if (b.y <= gY) {
                    if (b.type === 'concussive') {
                        this.blastZones.push({ x: b.x, y: gY, z: b.z, life: 1.2, owner: b.owner, hasPulsed: false });
                    }
                    hit = true;
                }
            }

            if (hit || b.life <= 0) this.bullets.splice(i, 1);
        }

        // --- LINGERING CONCUSSIVE BARRIER PHYSICS ---
        for (let i = this.blastZones.length - 1; i >= 0; i--) {
            let z = this.blastZones[i];
            z.life -= delta;

            let radius = 25;

            for (let tId in this.tanks) {
                let target = this.tanks[tId];
                if (target.isDead) continue;

                let dx = target.position.x - z.x; let dy = target.position.y - z.y; let dz = target.position.z - z.z;
                let dist = Math.hypot(dx, dy, dz);

                if (dist < radius) {
                    let intensity = 1 - (dist / radius);
                    let pushDirX = dx / (dist || 1);
                    let pushDirZ = dz / (dist || 1);

                    if (!z.hasPulsed) {
                        target.velocity.x += pushDirX * 14.0 * intensity;
                        target.velocity.z += pushDirZ * 14.0 * intensity;
                        target.velocity.y += 2.0 * intensity;
                        target.isGrounded = false;

                        let isTeammate = ((this.mode === '3v3' || this.mode === 'CTF') && this.getTeam(tId) === this.getTeam(z.owner));
                        if (!isTeammate && target.respawnInvuln <= 0) {
                            const dmg = 65 * intensity;
                            target.health -= dmg;
                            if (target.health <= 0) {
                                target.die(z.owner);
                                this._recordKill(z.owner, tId, 'concussive');
                            }
                        }
                    } else {
                        target.velocity.x += pushDirX * 1.5 * delta;
                        target.velocity.z += pushDirZ * 1.5 * delta;
                    }
                }
            }

            z.hasPulsed = true;
            if (z.life <= 0) this.blastZones.splice(i, 1);
        }

        for (let i = 0; i < tankIds.length; i++) {
            for (let j = i + 1; j < tankIds.length; j++) {
                let p1 = this.tanks[tankIds[i]]; let p2 = this.tanks[tankIds[j]];
                if (p1.isDead || p2.isDead) continue;
                let dx = p1.position.x - p2.position.x; let dz = p1.position.z - p2.position.z; let dy = p1.position.y - p2.position.y;
                let dist = Math.hypot(dx, dz);
                if (dist < 4.0 && Math.abs(dy) < 3.0) {
                    if (dist === 0) { dx = 1; dz = 0; dist = 1; }
                    let push = (4.0 - dist) * 0.5; let normX = dx / dist; let normZ = dz / dist;
                    p1.position.x += normX * push; p1.position.z += normZ * push;
                    p2.position.x -= normX * push; p2.position.z -= normZ * push;

                    let p1Ramming = p1.driverInputs.isBoosting && Math.abs(p1.currentSpeed) > 85;
                    let p2Ramming = p2.driverInputs.isBoosting && Math.abs(p2.currentSpeed) > 85;

                    if (p1Ramming || p2Ramming) {
                        let isTeammate = ((this.mode === '3v3' || this.mode === 'CTF') && this.getTeam(tankIds[i]) === this.getTeam(tankIds[j]));
                        let f1X = -Math.sin(p1.hullRotation); let f1Z = -Math.cos(p1.hullRotation);
                        let f2X = -Math.sin(p2.hullRotation); let f2Z = -Math.cos(p2.hullRotation);
                        let t1X = f1X * Math.sign(p1.currentSpeed); let t1Z = f1Z * Math.sign(p1.currentSpeed);
                        let t2X = f2X * Math.sign(p2.currentSpeed); let t2Z = f2Z * Math.sign(p2.currentSpeed);
                        let angleDot = t1X * t2X + t1Z * t2Z;

                        if (p1Ramming && p2Ramming && angleDot < -0.5) {
                            if (!isTeammate) {
                                if (p1.respawnInvuln <= 0) { p1.health -= 50; }
                                if (p2.respawnInvuln <= 0) { p2.health -= 50; }
                            }
                            if (p1.health <= 0) { p1.die(tankIds[j]); this._recordKill(tankIds[j], tankIds[i], 'ram'); }
                            if (p2.health <= 0) { p2.die(tankIds[i]); this._recordKill(tankIds[i], tankIds[j], 'ram'); }
                            p1.velocity.x += t1X * -1.5; p1.velocity.z += t1Z * -1.5; p1.velocity.y = 0.4;
                            p2.velocity.x += t2X * -1.5; p2.velocity.z += t2Z * -1.5; p2.velocity.y = 0.4;
                            p1.currentSpeed = 0; p2.currentSpeed = 0;
                        } else {
                            let p1RammingP2 = (t1X * -normX + t1Z * -normZ) > 0.5; let p2RammingP1 = (t2X * normX + t2Z * normZ) > 0.5;
                            if (p1Ramming && p1RammingP2 && !p2RammingP1) {
                                if (!isTeammate && p2.respawnInvuln <= 0) {
                                    p2.health -= 90;
                                    if (p2.health <= 0) { p2.die(tankIds[i]); this._recordKill(tankIds[i], tankIds[j], 'ram'); }
                                }
                                p1.currentSpeed *= 0.5;
                                p2.velocity.x -= normX * 1.5; p2.velocity.z -= normZ * 1.5; p2.velocity.y = 0.5;
                            }
                            else if (p2Ramming && p2RammingP1 && !p1RammingP2) {
                                if (!isTeammate && p1.respawnInvuln <= 0) {
                                    p1.health -= 90;
                                    if (p1.health <= 0) { p1.die(tankIds[j]); this._recordKill(tankIds[j], tankIds[i], 'ram'); }
                                }
                                p2.currentSpeed *= 0.5;
                                p1.velocity.x += normX * 1.5; p1.velocity.z += normZ * 1.5; p1.velocity.y = 0.5;
                            }
                            else { p1.currentSpeed *= 0.3; p2.currentSpeed *= 0.3; p1.velocity.x += normX * 0.5; p1.velocity.z += normZ * 0.5; p2.velocity.x -= normX * 0.5; p2.velocity.z -= normZ * 0.5; }
                        }
                    } else {
                        // Non-ramming collision: apply bounce with 0.6 restitution
                        const bounce = 0.6;
                        let relVelX = p1.velocity.x - p2.velocity.x;
                        let relVelZ = p1.velocity.z - p2.velocity.z;
                        let relVelAlongNorm = relVelX * normX + relVelZ * normZ;
                        if (relVelAlongNorm < 0) {
                            let impulse = -(1 + bounce) * relVelAlongNorm * 0.5;
                            p1.velocity.x += impulse * normX; p1.velocity.z += impulse * normZ;
                            p2.velocity.x -= impulse * normX; p2.velocity.z -= impulse * normZ;
                        }
                        p1.currentSpeed *= 0.8; p2.currentSpeed *= 0.8;
                    }
                }
            }
        }

        for (let id of tankIds) state.tanks[id] = this.tanks[id].getNetworkState();

        // --- CTF FLAG LOGIC ---
        if (this.mode === 'CTF' && this.flags) {
            for (let flag of this.flags) {
                if (flag.carrierId) {
                    const carrier = this.tanks[flag.carrierId];
                    if (!carrier || carrier.isDead) {
                        // Carrier died — reset flag to home position
                        flag.carrierId = null;
                        flag.x = flag.homeX; flag.y = flag.homeY; flag.z = flag.homeZ;
                    } else {
                        // Flag follows the carrier
                        flag.x = carrier.position.x;
                        flag.y = carrier.position.y + 5;
                        flag.z = carrier.position.z;

                        // Check if carrier has returned to their own flag's home base
                        const carrierTeam = this.getTeam(flag.carrierId);
                        const ownFlag = this.flags.find(f => f.team === carrierTeam);
                        const ownFlagAtHome = ownFlag && Math.hypot(ownFlag.x - ownFlag.homeX, ownFlag.z - ownFlag.homeZ) < 1;
                        if (ownFlag && ownFlag.carrierId === null && ownFlagAtHome) {
                            const dist = Math.hypot(carrier.position.x - ownFlag.homeX, carrier.position.z - ownFlag.homeZ);
                            if (dist < 12) {
                                this.scores[carrierTeam] = (this.scores[carrierTeam] || 0) + 1;
                                flag.carrierId = null;
                                flag.x = flag.homeX; flag.y = flag.homeY; flag.z = flag.homeZ;
                            }
                        }
                    }
                } else {
                    // Flag is at rest — check if any enemy tank picks it up
                    for (const tId of tankIds) {
                        const tank = this.tanks[tId];
                        if (tank.isDead) continue;
                        const tankTeam = this.getTeam(tId);
                        if (tankTeam === flag.team) continue; // Can't pick up own flag
                        const alreadyCarrying = this.flags.some(f => f.carrierId === tId);
                        if (alreadyCarrying) continue;
                        const dist = Math.hypot(tank.position.x - flag.x, tank.position.z - flag.z);
                        if (dist < 8) {
                            flag.carrierId = tId;
                            break;
                        }
                    }
                }
            }

            state.flags = this.flags.map(f => ({
                team: f.team,
                x: trunc1(f.x), y: trunc1(f.y), z: trunc1(f.z),
                homeX: f.homeX, homeY: f.homeY, homeZ: f.homeZ,
                carrierId: f.carrierId
            }));
            state.scores = { 1: this.scores[1], 2: this.scores[2] };
        }

        state.bullets = this.bullets.map(b => ({
            x: trunc2(b.x), y: trunc2(b.y), z: trunc2(b.z),
            dx: trunc2(b.dx), dy: trunc2(b.dy), dz: trunc2(b.dz)
        }));

        state.blastZones = this.blastZones.map(z => ({
            x: trunc1(z.x), y: trunc1(z.y), z: trunc1(z.z), life: trunc2(z.life)
        }));

        state.hits = this.hits;
        state.shutters = this.shutters;
        return state;
    }

    _recordKill(killerId, victimId, weapon) {
        const ts = Date.now();
        if (!this.killStats[killerId]) this.killStats[killerId] = { kills: 0, deaths: 0 };
        if (!this.killStats[victimId]) this.killStats[victimId] = { kills: 0, deaths: 0 };
        this.killStats[killerId].kills++;
        this.killStats[victimId].deaths++;
        this.killFeed.push({ killer: killerId, victim: victimId, weapon: weapon || 'unknown', timestamp: ts });
        if (this.killFeed.length > 20) this.killFeed.shift();
    }
}

const matches = {};
module.exports = {
    createMatch: (id, configs, mode, mapName) => matches[id] = new Match(id, configs, mode, mapName),
    deleteMatch: (id) => delete matches[id],
    getMatch: (id) => matches[id],
    getAllMatches: () => matches
};
