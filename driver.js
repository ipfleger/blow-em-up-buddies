// driver.js
const THREE = require('three');
const { getTerrainHeight, getSpawnPoint, getMapProps } = require('./maps');

const trunc1 = (val) => Math.round(val * 10) / 10;
const trunc2 = (val) => Math.round(val * 100) / 100;
const trunc3 = (val) => Math.round(val * 1000) / 1000;

const CONFIG = { maxBoost: 100, gravity: -0.04, jumpForce: 3.5, dodgeForce: 4.0 };

const MONOLITHS = [
    // Tall corner obelisks
    { x: 200, z: 200, r: 6, h: 70 }, { x: -200, z: 200, r: 6, h: 70 },
    { x: 200, z: -200, r: 6, h: 70 }, { x: -200, z: -200, r: 6, h: 70 },
    // Medium canyon-edge monoliths
    { x: 40, z: 60, r: 8, h: 45 }, { x: -40, z: 60, r: 8, h: 45 },
    { x: 40, z: -60, r: 8, h: 45 }, { x: -40, z: -60, r: 8, h: 45 },
    // Central area pillars
    { x: 35, z: 0, r: 4, h: 40 }, { x: -35, z: 0, r: 4, h: 40 },
    { x: 0, z: 35, r: 4, h: 40 }, { x: 0, z: -35, r: 4, h: 40 },
    // Outer scattered monoliths
    { x: 300, z: 0, r: 10, h: 55 }, { x: -300, z: 0, r: 10, h: 55 },
    { x: 0, z: 300, r: 10, h: 55 }, { x: 0, z: -300, r: 10, h: 55 },
    { x: 150, z: -250, r: 5, h: 80 }, { x: -150, z: 250, r: 5, h: 80 },
];

class ServerTank {
    constructor(id, config, mapName, team, slotIndex) {
        this.id = id;
        this.config = config;
        this.mapName = mapName || 'trenches';
        this.team = team || 1;
        this.slotIndex = slotIndex || 0;

        this.driverId = null;
        this.gunnerId = null;

        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.quaternion = new THREE.Quaternion();
        this.surfaceNormal = new THREE.Vector3(0, 1, 0);
        this.flipAxis = new THREE.Vector3();

        this.gunnerAbility = 'rapid';
        this.driverInputs = { moveX: 0, moveY: 0, isBoosting: false, triggerJump: false, holdingJump: false };
        this.gunnerInputs = { aimYaw: 0, aimPitch: 0, isFiring: false, triggerSecondary: false, switchAbility: false };

        this.respawn();
    }

    die(killerId) {
        this.isDead = true;
        this.respawnTimer = 3.0;
        this.lastKiller = killerId || null;
        this.position.set(0, -1000, 0);
        this.velocity.set(0, 0, 0);
        this.currentSpeed = 0;
        this.isFlipping = false;
    }

    respawn() {
        this.isDead = false;
        let spawn = getSpawnPoint(this.mapName, this.team, this.slotIndex);
        this.position.set(spawn.x, spawn.y, spawn.z);
        this.velocity.set(0, 0, 0);
        this.currentSpeed = 0;
        this.hullRotation = this.team === 1 ? -Math.PI/2 : Math.PI/2;
        this.turretYaw = this.hullRotation;
        this.turretPitch = 0;
        this.boost = CONFIG.maxBoost;
        this.health = 100;
        this.isGrounded = false;
        this.bombCooldown = 0;
        this.rapidCooldown = 0;
	    this.jumpCooldown = 0;
        this.dodgeInvulnTimer = 0;
        this.respawnInvuln = 1.5;
        this.driverInputs.triggerJump = false;
        this.driverInputs.holdingJump = false;
        this.wasBoostingLastTick = false;
        this.actualTurretYOffset = 12.0;
    }

    update(delta, allTanks, mode, mapShutters = []) {
        if (this.isDead) {
            this.respawnTimer -= delta;
            if (this.respawnTimer <= 0) this.respawn();
            return;
        }

        let mapProps = getMapProps(this.mapName) || { platforms: [], obstacles: [], updrafts: [], cube: null };

        // --- WEAPON COOLDOWNS ---
        if (this.bombCooldown > 0) this.bombCooldown -= delta;
        if (this.rapidCooldown > 0) this.rapidCooldown -= delta;
        if (this.dodgeInvulnTimer > 0) this.dodgeInvulnTimer -= delta;
        if (this.respawnInvuln > 0) this.respawnInvuln -= delta;

        this.fireConcussive = false;
        this.fireRapid = false;

        // PRIMARY WEAPON: Massive Concussive Blast (Slow)
        if (this.gunnerInputs.isFiring && this.bombCooldown <= 0) {
            this.bombCooldown = 1.25; // Long cooldown
            this.fireConcussive = true;
        }

        // SECONDARY WEAPON: Rapid Fire Machine Gun
        if (this.gunnerInputs.triggerSecondary && this.rapidCooldown <= 0) {
            this.rapidCooldown = 0.12; // Extremely fast
            this.fireRapid = true;
        }

        // --- DYNAMIC TURRET ELEVATION LOGIC ---
        // LIFTED BY DEFAULT: Permanently set elevation to 12.0 (max height)
        let activeElevation = 12.0;

        // Tether physics to ceilings
        let ceilingY = 1000;
        if (mapProps.platforms) {
            for (let p of mapProps.platforms) {
                if (Math.abs(this.position.x - p.x) <= p.w/2 + 2 && Math.abs(this.position.z - p.z) <= p.d/2 + 2) {
                    if (this.position.y < p.y - 2.5) ceilingY = Math.min(ceilingY, p.y - 5.0);
                }
            }
        }

        let idealTurretY = this.position.y + 2.2 + activeElevation;
        let constrainedTurretY = Math.min(idealTurretY, ceilingY - 2.0);
        if (idealTurretY - constrainedTurretY > 15.0) constrainedTurretY = idealTurretY;

        let targetOffset = constrainedTurretY - (this.position.y + 2.2);
        let springDiff = targetOffset - this.actualTurretYOffset;
        this.actualTurretYOffset += springDiff * 12 * delta;

        // --- BOT AIMING LOGIC ---
        if (!this.gunnerId) {
            let bestTarget = null; let minDist = Infinity;
            for (let otherId in allTanks) {
                if (otherId === this.id || allTanks[otherId].isDead) continue;
                if (mode === '3v3' && this.team === allTanks[otherId].team) continue;
                let dist = this.position.distanceTo(allTanks[otherId].position);
                if (dist < minDist && dist < 150) { minDist = dist; bestTarget = allTanks[otherId]; }
            }
            if (bestTarget) {
                let aimVec = bestTarget.position.clone().add(new THREE.Vector3(0, 1.5, 0)).sub(this.position.clone().add(new THREE.Vector3(0, 2.2, 0)));
                let targetYaw = Math.atan2(-aimVec.x, -aimVec.z);
                let distXZ = Math.hypot(aimVec.x, aimVec.z); let targetPitch = Math.atan2(aimVec.y, distXZ);

                let diffYaw = targetYaw - this.gunnerInputs.aimYaw;
                while (diffYaw < -Math.PI) diffYaw += Math.PI * 2; while (diffYaw > Math.PI) diffYaw -= Math.PI * 2;

                this.gunnerInputs.aimYaw += diffYaw * 4 * delta;
                this.gunnerInputs.aimPitch += (targetPitch - this.gunnerInputs.aimPitch) * 4 * delta;

                if (Math.abs(diffYaw) < 0.2 && Math.abs(targetPitch - this.gunnerInputs.aimPitch) < 0.2) {
                    if (this.bombCooldown <= 0) this.gunnerInputs.isFiring = true;
                    else this.gunnerInputs.isFiring = false;

                    if (this.rapidCooldown <= 0) this.gunnerInputs.triggerSecondary = true;
                    else this.gunnerInputs.triggerSecondary = false;
                } else {
                    this.gunnerInputs.isFiring = false;
                    this.gunnerInputs.triggerSecondary = false;
                }
            } else {
                this.gunnerInputs.isFiring = false;
                this.gunnerInputs.triggerSecondary = false;
            }
        }

        this.turretYaw = this.gunnerInputs.aimYaw;
        this.turretPitch = this.gunnerInputs.aimPitch;

        // --- BOT DRIVING LOGIC ---
        if (!this.driverId) {
            this.driverRethinkTimer = (this.driverRethinkTimer || 0) - delta;

            // Health retreat: if below 30 health, flee from nearest enemy
            if (this.health < 30) {
                if (this.driverRethinkTimer <= 0) {
                    this.driverRethinkTimer = 0.5 + Math.random();
                    let nearestEnemy = null; let bestDist = Infinity;
                    for (let oId in allTanks) {
                        if (oId === this.id || allTanks[oId].isDead) continue;
                        if (mode === '3v3' && this.team === allTanks[oId].team) continue;
                        let dist = this.position.distanceTo(allTanks[oId].position);
                        if (dist < bestDist) { bestDist = dist; nearestEnemy = allTanks[oId]; }
                    }
                    this.retreatFrom = nearestEnemy;
                }
                if (this.retreatFrom && !this.retreatFrom.isDead) {
                    let dx = this.position.x - this.retreatFrom.position.x;
                    let dz = this.position.z - this.retreatFrom.position.z;
                    let fleeRot = Math.atan2(-dx, -dz);
                    let diff = fleeRot - this.hullRotation;
                    while(diff < -Math.PI) diff += Math.PI*2; while(diff > Math.PI) diff -= Math.PI*2;
                    if (diff > 0.2) this.driverInputs.moveX = -1; else if (diff < -0.2) this.driverInputs.moveX = 1; else this.driverInputs.moveX = 0;
                    this.driverInputs.moveY = -1;
                    this.driverInputs.isBoosting = false;
                } else { this.driverInputs.moveX = 0; this.driverInputs.moveY = 0; this.driverInputs.isBoosting = false; }
            } else {
                // Normal bot driving
                this.patrolTimer = (this.patrolTimer || 5) - delta;
                if (this.patrolTimer <= 0) {
                    this.patrolTimer = 5;
                    this.patrolTarget = { isDead: false, position: new THREE.Vector3(
                        this.position.x + (Math.random() - 0.5) * 200,
                        0,
                        this.position.z + (Math.random() - 0.5) * 200
                    )};
                }

                if (this.driverRethinkTimer <= 0) {
                    this.driverRethinkTimer = 0.5 + Math.random();

                    // CTF awareness
                    let ctfTarget = null;
                    if (mode === 'CTF' && this._ctfFlags) {
                        const myTeam = this.team;
                        const enemyFlag = this._ctfFlags.find(f => f.team !== myTeam);
                        const ownFlag = this._ctfFlags.find(f => f.team === myTeam);
                        const iCarryFlag = enemyFlag && enemyFlag.carrierId === this.id;
                        const enemyCarriesOwnFlag = ownFlag && ownFlag.carrierId && ownFlag.carrierId !== this.id;

                        if (iCarryFlag && ownFlag) {
                            // Head to own base to score
                            ctfTarget = { isDead: false, position: new THREE.Vector3(ownFlag.homeX, ownFlag.homeY, ownFlag.homeZ) };
                        } else if (enemyCarriesOwnFlag) {
                            // Chase the flag carrier
                            ctfTarget = allTanks[ownFlag.carrierId];
                        } else if (enemyFlag && !enemyFlag.carrierId) {
                            // Grab enemy flag
                            ctfTarget = { isDead: false, position: new THREE.Vector3(enemyFlag.x, enemyFlag.y, enemyFlag.z) };
                        }
                    }

                    if (ctfTarget) {
                        this.targetRam = ctfTarget;
                    } else {
                        // Standard: find nearest enemy
                        let bestDist = Infinity; this.targetRam = null;
                        for (let oId in allTanks) {
                            if (oId === this.id || allTanks[oId].isDead) continue;
                            if (mode === '3v3' && this.team === allTanks[oId].team) continue;
                            let dist = this.position.distanceTo(allTanks[oId].position);
                            if (dist < bestDist) { bestDist = dist; this.targetRam = allTanks[oId]; }
                        }
                        // Fall back to patrol if no nearby enemy
                        if (!this.targetRam) this.targetRam = this.patrolTarget;
                    }
                }

                if (this.targetRam && !this.targetRam.isDead) {
                    let dx = this.targetRam.position.x - this.position.x; let dz = this.targetRam.position.z - this.position.z;
                    let targetRot = Math.atan2(-dx, -dz);
                    let diff = targetRot - this.hullRotation;
                    while(diff < -Math.PI) diff += Math.PI*2; while(diff > Math.PI) diff -= Math.PI*2;

                    // Obstacle avoidance: check forward direction for pillars
                    let fwdX = -Math.sin(this.hullRotation); let fwdZ = -Math.cos(this.hullRotation);
                    let avoidance = 0;
                    let activeObstacles = (mapProps.obstacles && mapProps.obstacles.length > 0) ? mapProps.obstacles : MONOLITHS;
                    for (let obs of activeObstacles) {
                        if (this.position.y > obs.h + 2) continue;
                        let odx = obs.x - this.position.x; let odz = obs.z - this.position.z;
                        let dot = fwdX * odx + fwdZ * odz;
                        if (dot > 0 && dot < 15) {
                            let cross = fwdX * odz - fwdZ * odx;
                            let dist = Math.hypot(odx, odz);
                            if (dist < obs.r + 8) { avoidance = cross > 0 ? -1 : 1; break; }
                        }
                    }

                    if (avoidance !== 0) {
                        this.driverInputs.moveX = avoidance;
                    } else if (diff > 0.2) {
                        this.driverInputs.moveX = -1;
                    } else if (diff < -0.2) {
                        this.driverInputs.moveX = 1;
                    } else {
                        this.driverInputs.moveX = 0;
                    }
                    this.driverInputs.moveY = -1;

                    let dist = this.position.distanceTo(this.targetRam.position);
                    if (Math.abs(diff) < 0.3 && dist < 80 && this.targetRam !== this.patrolTarget) this.driverInputs.isBoosting = true;
                    else this.driverInputs.isBoosting = false;

                    if (Math.random() < 0.02) this.driverInputs.triggerJump = true;
                } else { this.driverInputs.moveX = 0; this.driverInputs.moveY = 0; this.driverInputs.isBoosting = false; }
            }
        }

        let oldX = this.position.x; let oldZ = this.position.z;
        if (this.jumpCooldown > 0) this.jumpCooldown -= delta;

        if (Math.abs(this.driverInputs.moveX) > 0.1) {
            let turnSpeed = this.isGrounded ? 3.0 : 1.8;
            this.hullRotation -= this.driverInputs.moveX * turnSpeed * delta;
        }

        let dirX = -Math.sin(this.hullRotation); let dirZ = -Math.cos(this.hullRotation);
        const rightX = -Math.cos(this.hullRotation); const rightZ = Math.sin(this.hullRotation);

        if (this.driverInputs.isBoosting && this.currentSpeed > 50 && this.isGrounded && Math.abs(this.driverInputs.moveX) < 0.1) {
            let bestTarget = null; let smallestAngle = 0.26;
            for (let otherId in allTanks) {
                if (otherId === this.id) continue;
                let target = allTanks[otherId]; if (target.isDead) continue;
                let dx = target.position.x - this.position.x; let dz = target.position.z - this.position.z;
                let dist = Math.hypot(dx, dz);
                if (dist > 10 && dist < 80) {
                    dx /= dist; dz /= dist; let dot = dirX * dx + dirZ * dz;
                    if (dot > Math.cos(smallestAngle)) { smallestAngle = Math.acos(dot); bestTarget = { x: dx, z: dz }; }
                }
            }
            if (bestTarget) {
                let cross = dirX * bestTarget.z - dirZ * bestTarget.x;
                this.hullRotation += (cross > 0 ? -5.0 * delta : 5.0 * delta);
                dirX = -Math.sin(this.hullRotation); dirZ = -Math.cos(this.hullRotation);
            }
        }

        if (this.driverInputs.isBoosting) this.boostLingerTimer = 0.25;
        else if (this.boostLingerTimer > 0) this.boostLingerTimer -= delta;
        this.isEffectivelyBoosting = (this.driverInputs.isBoosting || this.boostLingerTimer > 0);

        // --- BOOST IMPULSE KICK ---
        let justStartedBoosting = this.driverInputs.isBoosting && !this.wasBoostingLastTick;
        if (justStartedBoosting && Math.abs(this.driverInputs.moveY) > 0.1 && this.boost > 0) {
            this.currentSpeed += 15 * Math.sign(-this.driverInputs.moveY);
        }
        this.wasBoostingLastTick = this.driverInputs.isBoosting;

        let targetSpeed = 0;
        if (Math.abs(this.driverInputs.moveY) > 0.1) {
            let straightBonus = (Math.abs(this.driverInputs.moveX) < 0.05) ? 1.15 : 1.0;
            targetSpeed = -this.driverInputs.moveY * 34 * straightBonus;
            if (this.isEffectivelyBoosting && this.boost > 0) { targetSpeed *= 2.8; this.boost -= 30 * delta; }
        }

        if (!this.isEffectivelyBoosting || Math.abs(this.driverInputs.moveY) < 0.1) this.boost = Math.min(CONFIG.maxBoost, this.boost + 10 * delta);

        let accelRate = this.isEffectivelyBoosting ? 8 : 4;
        this.currentSpeed += (targetSpeed - this.currentSpeed) * accelRate * delta;

        // --- VARIABLE JUMP HEIGHT ---
        if (!this.isGrounded && !this.driverInputs.holdingJump && this.velocity.y > 0 && this._wasHoldingJump) {
            this.velocity.y *= 0.5;
        }
        this._wasHoldingJump = this.driverInputs.holdingJump;

        if (this.driverInputs.triggerJump && this.jumpCooldown <= 0) {
            if (this.isGrounded) {
                this.velocity.y = CONFIG.jumpForce; this.isGrounded = false;
                this.canDoubleJump = true; this.jumpCooldown = 0.15;
                this._wasHoldingJump = true;
            } else if (this.canDoubleJump) {
                this.canDoubleJump = false; this.jumpCooldown = 0.5;
                let mag = Math.hypot(this.driverInputs.moveX, this.driverInputs.moveY);
                if (mag > 0.2) {
                    const normX = this.driverInputs.moveX / mag; const normY = this.driverInputs.moveY / mag;
                    const forwardPropulsion = -normY * 1.75; const sidePropulsion = -normX;
                    // Keep some upward velocity for floaty aerial flip; always ensure minimum upward boost
                    this.velocity.y = this.velocity.y > 0 ? Math.max(this.velocity.y * 0.5, CONFIG.jumpForce * 0.4) : CONFIG.jumpForce * 0.4;
                    this.velocity.x += (dirX * forwardPropulsion + rightX * sidePropulsion) * CONFIG.dodgeForce;
                    this.velocity.z += (dirZ * forwardPropulsion + rightZ * sidePropulsion) * CONFIG.dodgeForce;
                    this.isFlipping = true; this.flipAngle = 0; this.flipAxis.set(normY, 0, -normX).normalize();
                    this.dodgeInvulnTimer = 0.15;
                } else this.velocity.y += CONFIG.jumpForce * 1.2;
            }
            this.driverInputs.triggerJump = false;
        }

        const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.hullRotation);
        if (this.isGrounded) {
            forward.projectOnPlane(this.surfaceNormal).normalize();
            this.lastClimbRate = forward.y * this.currentSpeed;
        }

        if (Math.abs(this.currentSpeed) > 0.1) this.position.add(forward.multiplyScalar(this.currentSpeed * delta));

        if (!this.isGrounded) {
            this.velocity.y += CONFIG.gravity * 60 * delta;
            if (this.isEffectivelyBoosting && this.boost > 0) {
                this.velocity.y += 0.12 * 60 * delta;
                const airForward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.hullRotation);
                this.velocity.x += airForward.x * 0.08 * 60 * delta;
                this.velocity.z += airForward.z * 0.08 * 60 * delta;
            }
            this.position.x += this.velocity.x * 60 * delta; this.position.z += this.velocity.z * 60 * delta;
            this.velocity.x *= Math.pow(0.85, 60 * delta); this.velocity.z *= Math.pow(0.85, 60 * delta);
            this.surfaceNormal.lerp(new THREE.Vector3(0, 1, 0), 5 * delta).normalize();
        } else {
            this.position.x += this.velocity.x * 60 * delta; this.position.z += this.velocity.z * 60 * delta;
            this.velocity.x *= Math.pow(0.2, delta); this.velocity.z *= Math.pow(0.2, delta);
        }

        this.position.y += this.velocity.y * 60 * delta;

        let currentGroundY = getTerrainHeight(this.position.x, this.position.z, this.mapName);
        const offset = 2.0;
        const hR = getTerrainHeight(this.position.x + offset, this.position.z, this.mapName);
        const hU = getTerrainHeight(this.position.x, this.position.z + offset, this.mapName);
        this.surfaceNormal.set(currentGroundY - hR, offset, currentGroundY - hU).normalize();

        let obstacles = mapProps.obstacles || []; let updrafts = mapProps.updrafts || [];
        if (this.mapName === 'geometric_gauntlet') { obstacles = []; updrafts = []; }
        else if (obstacles.length === 0 && this.mapName !== 'flatland') obstacles = MONOLITHS;

        for (let m of obstacles) {
            if (this.position.y > m.h + 2) continue;
            let dx = this.position.x - m.x; let dz = this.position.z - m.z;
            let dist = Math.hypot(dx, dz); let minDist = 3.0 + m.r;
            if (dist < minDist) {
                if (dist === 0) { dx = 1; dz = 0; dist = 1; }
                let push = minDist - dist; this.position.x += (dx / dist) * push; this.position.z += (dz / dist) * push;
                let dot = this.velocity.x * (dx/dist) + this.velocity.z * (dz/dist);
                if (dot < 0) { this.velocity.x -= (dx/dist) * dot * 1.5; this.velocity.z -= (dz/dist) * dot * 1.5; }
                this.currentSpeed *= 0.5;
            }
        }

        for (let u of updrafts) {
            if (this.position.y < 50) {
                let dist = Math.hypot(this.position.x - u.x, this.position.z - u.z);
                if (dist < u.r) { this.velocity.y = u.power; this.isGrounded = false; }
            }
        }

        let highestGround = -1000;
        let sampleOffsets = [ {x: 0, z: 0}, {x: 2, z: 0}, {x: -2, z: 0}, {x: 0, z: 3}, {x: 0, z: -3} ];

        for (let pt of sampleOffsets) {
            let rotX = pt.x * Math.cos(-this.hullRotation) - pt.z * Math.sin(-this.hullRotation);
            let rotZ = pt.x * Math.sin(-this.hullRotation) + pt.z * Math.cos(-this.hullRotation);
            let sX = this.position.x + rotX; let sZ = this.position.z + rotZ;
            let h = getTerrainHeight(sX, sZ, this.mapName);
            if (this.mapName === 'geometric_gauntlet') {
                for (let s of mapShutters) { if (s.health > 0 && Math.hypot(sX - s.x, sZ - s.z) < s.r) h = Math.max(h, s.y); }
            } else if (mapProps.platforms) {
                for (let p of mapProps.platforms) {
                    if (Math.abs(sX - p.x) <= p.w/2 && Math.abs(sZ - p.z) <= p.d/2) {
                        if (this.position.y >= p.y - 3.0) h = Math.max(h, p.y);
                    }
                }
            }
            if (h > highestGround) highestGround = h;
        }

        let newGroundY = highestGround;

        if (newGroundY > this.position.y + 3.0) {
            this.position.x = oldX; this.position.z = oldZ;
            this.velocity.x *= 0.5; this.velocity.z *= 0.5; this.currentSpeed *= 0.5;
            newGroundY = getTerrainHeight(this.position.x, this.position.z, this.mapName);
        }

        let stickThreshold = (this.isGrounded && this.velocity.y <= 0) ? 4.0 : 0.5;
        let isSteep = this.surfaceNormal.y < 0.6; let wasGrounded = this.isGrounded;

        if (this.position.y <= newGroundY) {
            this.position.y = newGroundY;
            if (!isSteep) { this.velocity.y = 0; this.isGrounded = true; this.canDoubleJump = false; this.isFlipping = false; }
            else { this.velocity.x += this.surfaceNormal.x * 20 * delta; this.velocity.z += this.surfaceNormal.z * 20 * delta; this.isGrounded = false; }
        } else if (this.position.y <= newGroundY + stickThreshold && this.velocity.y <= 0 && !isSteep) {
            this.position.y = newGroundY; this.velocity.y = 0; this.isGrounded = true; this.canDoubleJump = false; this.isFlipping = false;
        } else this.isGrounded = false;

        if (wasGrounded && !this.isGrounded && this.lastClimbRate > 0) this.velocity.y = this.lastClimbRate * 3.5;
        if (this.position.y > ceilingY) { this.position.y = ceilingY; if (this.velocity.y > 0) this.velocity.y = -0.5; }

        const tiltQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.surfaceNormal);
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.hullRotation);
        const baseQuat = tiltQuat.multiply(yawQuat);

        if (this.isFlipping) {
            this.flipAngle += 20 * delta; if (this.flipAngle >= Math.PI * 2) { this.isFlipping = false; this.flipAngle = 0; }
            const flipQuat = new THREE.Quaternion().setFromAxisAngle(this.flipAxis, this.flipAngle);
            this.quaternion.copy(baseQuat).multiply(flipQuat);
        } else this.quaternion.slerp(baseQuat, 12 * delta);

        const LIMIT = 450;
        if (this.position.x > LIMIT) { this.position.x = LIMIT; this.velocity.x *= -0.5; this.currentSpeed *= -0.5; }
        if (this.position.x < -LIMIT) { this.position.x = -LIMIT; this.velocity.x *= -0.5; this.currentSpeed *= -0.5; }
        if (this.position.z > LIMIT) { this.position.z = LIMIT; this.velocity.z *= -0.5; this.currentSpeed *= -0.5; }
        if (this.position.z < -LIMIT) { this.position.z = -LIMIT; this.velocity.z *= -0.5; this.currentSpeed *= -0.5; }
    }

    getNetworkState() {
        return {
            x: trunc2(this.position.x), y: trunc2(this.position.y), z: trunc2(this.position.z),
            qx: trunc3(this.quaternion.x), qy: trunc3(this.quaternion.y), qz: trunc3(this.quaternion.z), qw: trunc3(this.quaternion.w),
            rot: trunc3(this.hullRotation), turretYaw: trunc3(this.turretYaw), turretPitch: trunc3(this.turretPitch),
	        turretYOffset: trunc2(this.actualTurretYOffset), boost: Math.floor(this.boost), health: trunc1(this.health),
            bombCooldown: trunc1(this.bombCooldown), isDead: this.isDead,
            isBoosting: this.isEffectivelyBoosting && Math.abs(this.driverInputs.moveY) > 0.1,
            gunnerAbility: this.gunnerAbility,
            speed: trunc1(this.currentSpeed),
            respawnInvuln: this.respawnInvuln > 0,
            lastKiller: this.isDead ? (this.lastKiller || null) : null
        };
    }
}

module.exports = { ServerTank };
