// driver.js
const THREE = require('three');
const { getTerrainHeight, getSpawnPoint, getMapProps } = require('./maps');

const trunc1 = (val) => Math.round(val * 10) / 10;
const trunc2 = (val) => Math.round(val * 100) / 100;
const trunc3 = (val) => Math.round(val * 1000) / 1000;

const CONFIG = { maxBoost: 100, gravity: -0.06, jumpForce: 1.4, dodgeForce: 1.2 };

const MONOLITHS = [
    { x: 80, z: 80, r: 8, h: 80 }, { x: -80, z: 80, r: 8, h: 80 },
    { x: 80, z: -80, r: 8, h: 80 }, { x: -80, z: -80, r: 8, h: 80 },
    { x: 35, z: 0, r: 4, h: 40 }, { x: -35, z: 0, r: 4, h: 40 },
    { x: 0, z: 35, r: 4, h: 40 }, { x: 0, z: -35, r: 4, h: 40 }
];

class ServerTank {
    constructor(id, config, mapName, team, slotIndex) {
        this.id = id;
        this.config = config;
        this.mapName = mapName || 'bowl';
        this.team = team || 1;
        this.slotIndex = slotIndex || 0;

        this.driverId = null;
        this.gunnerId = null;

        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.quaternion = new THREE.Quaternion();
        this.surfaceNormal = new THREE.Vector3(0, 1, 0);
        this.flipAxis = new THREE.Vector3();

        // NEW: Gunner holds a state of which ability is currently equipped
        this.gunnerAbility = 'grapple';
        this.driverInputs = { moveX: 0, moveY: 0, isBoosting: false, triggerJump: false };
        this.gunnerInputs = { aimYaw: 0, aimPitch: 0, isFiring: false, triggerSecondary: false, switchAbility: false };

        this.respawn();
    }

    die() {
        this.isDead = true;
        this.respawnTimer = 3.0;
        this.position.set(0, -1000, 0);
        this.velocity.set(0, 0, 0);
        this.currentSpeed = 0;
        this.isFlipping = false;
        this.isGrappling = false;
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
        this.primaryHeat = 0;
        this.bombCooldown = 0;
        this.isOverheated = false;
	    this.jumpCooldown = 0;
        this.driverInputs.triggerJump = false;
	    this.liftState = 'idle';
        this.liftTimer = 0;
        this.liftActiveOffset = 5.0; // Start elevated in-game!
        this.actualTurretYOffset = 5.0;
        this.isGrappling = false;
    }

    getTeam(tankId) {
        let num = parseInt(tankId.replace('tank', ''));
        return num <= 3 ? 1 : 2;
    }

    update(delta, allTanks, mode, mapShutters = []) {
        if (this.isDead) {
            this.respawnTimer -= delta;
            if (this.respawnTimer <= 0) this.respawn();
            return;
        }

        let mapProps = getMapProps(this.mapName) || { platforms: [], obstacles: [], updrafts: [], cube: null };

        if (this.bombCooldown > 0) this.bombCooldown -= delta;

        this.fireReady = false;
        if (this.gunnerInputs.isFiring && this.bombCooldown <= 0) {
            this.bombCooldown = 2.0;
            this.fireReady = true;
        }

        // Handle ability swapping
        if (this.gunnerInputs.switchAbility) {
            this.gunnerAbility = this.gunnerAbility === 'grapple' ? 'lift' : 'grapple';
            this.gunnerInputs.switchAbility = false;
        }

        // Trigger chosen ability
        if (this.gunnerInputs.triggerSecondary) {
            if (this.gunnerAbility === 'grapple' && mapProps.cube) {
                let cubePos = new THREE.Vector3(mapProps.cube.x, mapProps.cube.y, mapProps.cube.z);
                if (!this.isGrappling && this.position.distanceTo(cubePos) < 250) {
                    this.isGrappling = true;
                } else {
                    this.isGrappling = false;
                }
            } else if (this.gunnerAbility === 'lift' && this.liftState === 'idle') {
                this.liftState = 'rising';
                this.liftTimer = 0.4;
            }
            this.gunnerInputs.triggerSecondary = false;
        }

        // Apply Grapple Pull Physics
        if (this.isGrappling && mapProps.cube) {
            let cubePos = new THREE.Vector3(mapProps.cube.x, mapProps.cube.y, mapProps.cube.z);
            let pullVec = cubePos.clone().sub(this.position);
            let dist = pullVec.length();

            if (dist > 8 && dist < 300) {
                pullVec.normalize();
                let pullStrength = 3.8;
                this.velocity.x += pullVec.x * pullStrength * delta;
                this.velocity.y += pullVec.y * pullStrength * delta;
                this.velocity.z += pullVec.z * pullStrength * delta;
                this.velocity.y += 0.8 * delta; // Upward assist
                this.isGrounded = false;
            } else {
                this.isGrappling = false;
            }
        }

        // --- DYNAMIC TURRET ELEVATION LOGIC ---
        // Base hover is 5.0 so the gunner sees over the chassis
        let activeElevation = 5.0;

        if (this.isGrappling) {
            activeElevation = 0.0; // Sink completely to the chassis
        } else if (this.liftState === 'rising') {
            this.liftActiveOffset += ((12.0 - 5.0) / 0.4) * delta;
            activeElevation = this.liftActiveOffset;
            this.liftTimer -= delta;
            if (this.liftTimer <= 0) { this.liftState = 'hovering'; this.liftTimer = 2.5; this.liftActiveOffset = 12.0; }
        } else if (this.liftState === 'hovering') {
            this.liftTimer -= delta;
            activeElevation = 12.0; // Max launch height
            if (this.liftTimer <= 0) this.liftState = 'descending';
        } else if (this.liftState === 'descending') {
            this.liftActiveOffset -= ((12.0 - 5.0) / 3.0) * delta;
            activeElevation = Math.max(5.0, this.liftActiveOffset);
            if (this.liftActiveOffset <= 5.0) { this.liftActiveOffset = 5.0; this.liftState = 'idle'; }
        } else {
            this.liftActiveOffset = 5.0;
        }

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
                if (mode === '3v3' && this.getTeam(this.id) === this.getTeam(otherId)) continue;
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
                    this.gunnerInputs.isFiring = true;
                    if (this.bombCooldown <= 0 && minDist > 30) this.gunnerInputs.triggerSecondary = true;
                } else this.gunnerInputs.isFiring = false;
            } else this.gunnerInputs.isFiring = false;
        }

        this.turretYaw = this.gunnerInputs.aimYaw;
        this.turretPitch = this.gunnerInputs.aimPitch;

        // --- BOT DRIVING LOGIC ---
        if (!this.driverId) {
            this.driverRethinkTimer = (this.driverRethinkTimer || 0) - delta;
            if (this.driverRethinkTimer <= 0) {
                this.driverRethinkTimer = 0.5 + Math.random();
                let bestDist = Infinity; this.targetRam = null;
                for (let oId in allTanks) {
                    if (oId === this.id || allTanks[oId].isDead) continue;
                    if (mode === '3v3' && this.getTeam(this.id) === this.getTeam(oId)) continue;
                    let dist = this.position.distanceTo(allTanks[oId].position);
                    if (dist < bestDist) { bestDist = dist; this.targetRam = allTanks[oId]; }
                }
            }

            if (this.targetRam && !this.targetRam.isDead) {
                let dx = this.targetRam.position.x - this.position.x; let dz = this.targetRam.position.z - this.position.z;
                let targetRot = Math.atan2(-dx, -dz);
                let diff = targetRot - this.hullRotation;
                while(diff < -Math.PI) diff += Math.PI*2; while(diff > Math.PI) diff -= Math.PI*2;

                if (diff > 0.2) this.driverInputs.moveX = -1; else if (diff < -0.2) this.driverInputs.moveX = 1; else this.driverInputs.moveX = 0;
                this.driverInputs.moveY = -1;

                if (Math.abs(diff) < 0.3 && this.position.distanceTo(this.targetRam.position) < 80) this.driverInputs.isBoosting = true;
                else this.driverInputs.isBoosting = false;

                if (Math.random() < 0.02) this.driverInputs.triggerJump = true;
            } else { this.driverInputs.moveX = 0; this.driverInputs.moveY = 0; this.driverInputs.isBoosting = false; }
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

        let targetSpeed = 0;
        if (Math.abs(this.driverInputs.moveY) > 0.1) {
            let straightBonus = (Math.abs(this.driverInputs.moveX) < 0.05) ? 1.15 : 1.0;
            targetSpeed = -this.driverInputs.moveY * 34 * straightBonus;
            if (this.isEffectivelyBoosting && this.boost > 0) { targetSpeed *= 2.8; this.boost -= 30 * delta; }
        }

        if (!this.isEffectivelyBoosting || Math.abs(this.driverInputs.moveY) < 0.1) this.boost = Math.min(CONFIG.maxBoost, this.boost + 10 * delta);

        let accelRate = this.isEffectivelyBoosting ? 8 : 4;
        this.currentSpeed += (targetSpeed - this.currentSpeed) * accelRate * delta;

        if (this.driverInputs.triggerJump && this.jumpCooldown <= 0) {
            if (this.isGrounded) {
                this.velocity.y = CONFIG.jumpForce; this.isGrounded = false;
                this.canDoubleJump = true; this.jumpCooldown = 0.15;
            } else if (this.canDoubleJump) {
                this.canDoubleJump = false; this.jumpCooldown = 0.5;
                let mag = Math.hypot(this.driverInputs.moveX, this.driverInputs.moveY);
                if (mag > 0.2) {
                    const normX = this.driverInputs.moveX / mag; const normY = this.driverInputs.moveY / mag;
                    const forwardPropulsion = -normY * 1.75; const sidePropulsion = -normX;
                    this.velocity.x += (dirX * forwardPropulsion + rightX * sidePropulsion) * CONFIG.dodgeForce;
                    this.velocity.z += (dirZ * forwardPropulsion + rightZ * sidePropulsion) * CONFIG.dodgeForce;
                    this.isFlipping = true; this.flipAngle = 0; this.flipAxis.set(normY, 0, -normX).normalize();
                } else this.velocity.y += CONFIG.jumpForce * 0.8;
            }
            this.driverInputs.triggerJump = false;
        }

        const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.hullRotation);
        if (this.isGrounded) {
            forward.projectOnPlane(this.surfaceNormal).normalize();
            this.lastClimbRate = (forward.y * this.currentSpeed) / 60;
        }

        if (Math.abs(this.currentSpeed) > 0.1) this.position.add(forward.multiplyScalar(this.currentSpeed * delta));

        if (!this.isGrounded) {
            this.velocity.y += CONFIG.gravity * 60 * delta;
            if (this.isEffectivelyBoosting && this.boost > 0) this.velocity.y += 0.04 * 60 * delta;
            this.position.x += this.velocity.x * 60 * delta; this.position.z += this.velocity.z * 60 * delta;
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

        if (wasGrounded && !this.isGrounded && this.lastClimbRate > 0) this.velocity.y = this.lastClimbRate * 1.25;
        if (this.position.y > ceilingY) { this.position.y = ceilingY; if (this.velocity.y > 0) this.velocity.y = -0.5; }

        const tiltQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.surfaceNormal);
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.hullRotation);
        const baseQuat = tiltQuat.multiply(yawQuat);

        if (this.isFlipping) {
            this.flipAngle += 15 * delta; if (this.flipAngle >= Math.PI * 2) { this.isFlipping = false; this.flipAngle = 0; }
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
            isGrappling: this.isGrappling || false,
            gunnerAbility: this.gunnerAbility,
            speed: trunc1(this.currentSpeed), config: this.config
        };
    }
}

module.exports = { ServerTank };
