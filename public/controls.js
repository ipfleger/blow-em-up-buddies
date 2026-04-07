// public/controls.js
window.Controls = {
    input: { moveX: 0, moveY: 0, aimYaw: 0, aimPitch: 0, isBoosting: false, triggerJump: false, holdingJump: false, isFiring: false, triggerSecondary: false, switchAbility: false },
    localAim: { yaw: 0, pitch: 0 },
    aimJoystick: { x: 0, y: 0 },
    keys: {}, touchBtns: { boost: false, jump: false, swap: false },
    specCam: { x: 0, y: 80, z: 0, yaw: 0, pitch: -Math.PI/4 },

    useAR: false,
    arInitDone: false,
    lastAlpha: null,
    baseRawPitch: null,
    latestRawPitch: 0,
    gravityX: 0, gravityY: 0, gravityZ: 0,
    smoothedLift: 0, poleDampener: 1,
    manualPitchOffset: 0,

    touchId: null, startXY: { x: 0, y: 0 },
    lastTapTime: 0, lastTapXY: { x: 0, y: 0 }, lockedTargetId: null,
    lobbyDragActive: false, lobbyDragStartX: 0, manualLobbyRot: 0,

    init: function() {
        this.joyBase = document.getElementById('joy-base');
        this.joyNub = document.getElementById('joy-nub');

        this.setupKeyboard();
        this.setupActionButtons();
        this.setupTouchControls();
        this.setupDesktopLobbyControls();
    },

    getShortestAngle: function(current, previous) {
        let diff = current - previous;
        while (diff < -180) diff += 360;
        while (diff > 180) diff -= 360;
        return diff;
    },

    getMappedLift: function(e) {
        let angle = window.orientation || 0;
        if (angle === 90) return e.acceleration.x || 0;
        if (angle === -90) return -(e.acceleration.x || 0);
        return e.acceleration.y || 0;
    },

    setupMotionControls: function() {
        if (this.arInitDone) return;
        this.arInitDone = true;

        window.addEventListener('deviceorientation', (e) => {
            if (!this.useAR || window.myCurrentRole !== 'gunner' || !window.isMatchActive) return;

            if (this.lastAlpha === null) { this.lastAlpha = e.alpha; return; }
            let deltaAlpha = this.getShortestAngle(e.alpha, this.lastAlpha);

            if (Math.abs(deltaAlpha) < 90) {
                let deltaRad = deltaAlpha * (Math.PI / 180);
                this.localAim.yaw += (deltaRad * 3.0 * this.poleDampener);
            }
            this.lastAlpha = e.alpha;
        });

        window.addEventListener('devicemotion', (e) => {
            if (!this.useAR || window.myCurrentRole !== 'gunner' || !window.isMatchActive) return;

            let ag = e.accelerationIncludingGravity;
            if (ag) {
                this.gravityX = (this.gravityX * 0.8) + ((ag.x || 0) * 0.2);
                this.gravityY = (this.gravityY * 0.8) + ((ag.y || 0) * 0.2);
                this.gravityZ = (this.gravityZ * 0.8) + ((ag.z || 0) * 0.2);

                let angle = window.orientation || 0;
                if (angle === 90) this.latestRawPitch = Math.atan2(this.gravityZ, -this.gravityX) * (180 / Math.PI);
                else if (angle === -90) this.latestRawPitch = Math.atan2(this.gravityZ, this.gravityX) * (180 / Math.PI);
                else this.latestRawPitch = Math.atan2(this.gravityZ, -this.gravityY) * (180 / Math.PI);

                if (this.baseRawPitch === null) this.baseRawPitch = this.latestRawPitch;

                let wristPitch = this.getShortestAngle(this.latestRawPitch, this.baseRawPitch);
                let angleFromFlat = Math.abs(90 - Math.abs(this.latestRawPitch));
                this.poleDampener = Math.min(1, angleFromFlat / 30);

                let rawLiftForce = this.getMappedLift(e);
                this.smoothedLift = (this.smoothedLift * 0.85) + (rawLiftForce * 0.15);

                let hybridPitchDeg = (wristPitch * 1.2) + (this.smoothedLift * 5.0);
                let pitchRad = hybridPitchDeg * (Math.PI / 180) + this.manualPitchOffset;

                pitchRad = Math.max(-Math.PI/2.05, Math.min(Math.PI/2.05, pitchRad));
                this.localAim.pitch = pitchRad;
            }
        });
    },

    raycastFromScreen: function(screenX, screenY) {
        const mouse = new THREE.Vector2();
        mouse.x = (screenX / window.innerWidth) * 2 - 1;
        mouse.y = -(screenY / window.innerHeight) * 2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, window.Graphics.camera);
        return raycaster.intersectObjects(window.Graphics.matchGroup.children, true);
    },

    setupTouchControls: function() {
        document.addEventListener('touchstart', e => {
            if (!window.isMatchActive) { this.lobbyDragActive = true; this.lobbyDragStartX = e.touches[0].clientX; }
            if(document.getElementById('start-screen').classList.contains('hidden') && document.getElementById('lobby-screen').classList.contains('hidden')) return;

            for(let t of e.changedTouches) {
                const target = document.elementFromPoint(t.clientX, t.clientY);
                if(target && (target.classList.contains('action-button') || target.id === 'btn-switch-seat')) continue;

                let now = Date.now();

                // Double-tap right side: recalibrate AR pitch
                if (this.useAR && t.clientX > window.innerWidth * 0.6) {
                    if (now - this.lastTapTime < 300) {
                        this.baseRawPitch = this.latestRawPitch;
                        this.lastTapTime = 0; continue;
                    }
                    this.lastTapTime = now;
                }

                let distFromLastTap = Math.hypot(t.clientX - this.lastTapXY.x, t.clientY - this.lastTapXY.y);

                if (now - this.lastTapTime < 300 && distFromLastTap < 40) {
                    const intersects = this.raycastFromScreen(t.clientX, t.clientY);
                    let hitPoint = null; let hitType = 'floor';
                    for (let i=0; i<intersects.length; i++) {
                        let obj = intersects[i].object;
                        if (!obj.visible || (obj.parent && !obj.parent.visible)) continue;
                        if (obj.userData && obj.userData.type) {
                            if (obj.userData.id === window.myCurrentTankId) continue;
                            hitPoint = intersects[i].point; hitType = obj.userData.type; break;
                        }
                    }
                    if (hitPoint && !window.isSpectating) {
                        if (hitType === 'tank') hitType = 'enemy';
                        if(window.socket) window.socket.emit('send-ping', { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z, type: hitType });
                    }
                    this.lastTapTime = 0; continue;
                }
                this.lastTapTime = now; this.lastTapXY = { x: t.clientX, y: t.clientY };

                if (t.clientX < window.innerWidth / 2 && this.touchId === null) {
                    this.touchId = t.identifier; this.startXY = { x: t.clientX, y: t.clientY };
                    this.joyBase.style.display = 'block'; this.joyBase.style.left = this.startXY.x + 'px'; this.joyBase.style.top = this.startXY.y + 'px';
                }
            }
        }, {passive: false});

        document.addEventListener('touchmove', e => {
            if (!window.isMatchActive && this.lobbyDragActive) {
                let dx = e.touches[0].clientX - this.lobbyDragStartX;
                this.manualLobbyRot -= dx * 0.01; this.lobbyDragStartX = e.touches[0].clientX;
            }
            if(document.getElementById('start-screen').classList.contains('hidden') && document.getElementById('lobby-screen').classList.contains('hidden')) return;
            e.preventDefault();

            for(let t of e.changedTouches) {
                if (t.identifier === this.touchId) {
                    let dx = t.clientX - this.startXY.x; let dy = t.clientY - this.startXY.y;
                    let dist = Math.hypot(dx, dy); if(dist > 40) { dx = (dx/dist)*40; dy = (dy/dist)*40; }
                    this.joyNub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

                    if (window.myCurrentRole === 'driver') { this.input.moveX = dx / 40; this.input.moveY = dy / 40; }
                    else if (window.myCurrentRole === 'gunner') {
                        // Joystick always available for aiming (supplementary when AR enabled)
                        this.aimJoystick.x = dx / 40; this.aimJoystick.y = dy / 40;
                    }
                    else if (window.myCurrentRole === 'spectator') { this.input.moveX = dx / 40; this.input.moveY = dy / 40; }
                } else if (window.myCurrentRole === 'gunner' && this.useAR) {
                    let dx = t.clientX - this.lastTapXY.x; let dy = t.clientY - this.lastTapXY.y;
                    this.localAim.yaw -= dx * 0.005;
                    this.manualPitchOffset -= dy * 0.005;
                    this.lastTapXY = { x: t.clientX, y: t.clientY };
                }
            }
        }, {passive: false});

        const endTouch = e => {
            this.lobbyDragActive = false;
            for(let t of e.changedTouches) {
                if(t.identifier === this.touchId) {
                    this.touchId = null; this.joyBase.style.display = 'none'; this.joyNub.style.transform = 'translate(-50%, -50%)';
                    this.input.moveX = 0; this.input.moveY = 0; this.aimJoystick.x = 0; this.aimJoystick.y = 0;
                }
            }
        };
        document.addEventListener('touchend', endTouch); document.addEventListener('touchcancel', endTouch);
    },

    setupDesktopLobbyControls: function() {
        document.addEventListener('mousedown', e => {
            if (!window.isMatchActive && e.target.tagName === 'CANVAS') { this.lobbyDragActive = true; this.lobbyDragStartX = e.clientX; }
        });
        document.addEventListener('mousemove', e => {
            if (!window.isMatchActive && this.lobbyDragActive) {
                let dx = e.clientX - this.lobbyDragStartX; this.manualLobbyRot -= dx * 0.01; this.lobbyDragStartX = e.clientX;
            }
        });
        document.addEventListener('mouseup', () => this.lobbyDragActive = false);
    },

    setupActionButtons: function() {
        const btnPrimary = document.getElementById('btn-primary');
        const btnSecondary = document.getElementById('btn-secondary');

        if (btnPrimary) {
            btnPrimary.addEventListener('touchstart', (e) => { e.preventDefault(); this.touchBtns.boost = true; });
            btnPrimary.addEventListener('touchend', (e) => { e.preventDefault(); this.touchBtns.boost = false; });
            btnPrimary.addEventListener('mousedown', () => { this.touchBtns.boost = true; });
            btnPrimary.addEventListener('mouseup', () => { this.touchBtns.boost = false; });
            btnPrimary.addEventListener('mouseleave', () => { this.touchBtns.boost = false; });
        }

        if (btnSecondary) {
            btnSecondary.addEventListener('touchstart', (e) => { e.preventDefault(); this.touchBtns.jump = true; });
            btnSecondary.addEventListener('touchend', (e) => { e.preventDefault(); this.touchBtns.jump = false; });
            btnSecondary.addEventListener('mousedown', () => { this.touchBtns.jump = true; });
            btnSecondary.addEventListener('mouseup', () => { this.touchBtns.jump = false; });
        }

        // Legacy support for old button IDs
        const btnBoost = document.getElementById('btn-boost');
        const btnJump = document.getElementById('btn-jump');
        if (btnBoost) {
            btnBoost.addEventListener('touchstart', (e) => { e.preventDefault(); this.touchBtns.boost = true; });
            btnBoost.addEventListener('touchend', (e) => { e.preventDefault(); this.touchBtns.boost = false; });
            btnBoost.addEventListener('mousedown', () => { this.touchBtns.boost = true; });
            btnBoost.addEventListener('mouseup', () => { this.touchBtns.boost = false; });
            btnBoost.addEventListener('mouseleave', () => { this.touchBtns.boost = false; });
        }
        if (btnJump) {
            btnJump.addEventListener('touchstart', (e) => { e.preventDefault(); this.touchBtns.jump = true; });
            btnJump.addEventListener('touchend', (e) => { e.preventDefault(); this.touchBtns.jump = false; });
            btnJump.addEventListener('mousedown', () => { this.touchBtns.jump = true; });
            btnJump.addEventListener('mouseup', () => { this.touchBtns.jump = false; });
        }
    },

    setupKeyboard: function() {
        window.addEventListener('keydown', e => { if (document.activeElement.tagName === 'INPUT') return; this.keys[e.code] = true; });
        window.addEventListener('keyup', e => this.keys[e.code] = false);
    },

    processKeyboard: function() {
        if (!window.isMatchActive) return;

        if (window.myCurrentRole === 'driver' || window.myCurrentRole === 'spectator') {
            if (this.keys['KeyW']) this.input.moveY = -1; else if (this.keys['KeyS']) this.input.moveY = 1; else if (!this.touchId) this.input.moveY = 0;
            if (this.keys['KeyA']) this.input.moveX = -1; else if (this.keys['KeyD']) this.input.moveX = 1; else if (!this.touchId) this.input.moveX = 0;

            this.input.isBoosting = Boolean(this.touchBtns.boost || this.keys['ShiftLeft'] || this.keys['ShiftRight']);
            this.input.holdingJump = Boolean(this.touchBtns.jump || this.keys['Space']);
            if (this.touchBtns.jump || this.keys['Space']) { this.input.triggerJump = true; this.keys['Space'] = false; this.touchBtns.jump = false;}
        }

        if (window.myCurrentRole === 'gunner' || window.myCurrentRole === 'spectator') {
            if (this.keys['ArrowUp']) this.aimJoystick.y = -1; else if (this.keys['ArrowDown']) this.aimJoystick.y = 1; else if (!this.touchId && window.myCurrentRole!=='spectator') this.aimJoystick.y = 0;
            if (this.keys['ArrowLeft']) this.aimJoystick.x = -1; else if (this.keys['ArrowRight']) this.aimJoystick.x = 1; else if (!this.touchId && window.myCurrentRole!=='spectator') this.aimJoystick.x = 0;

            this.input.isFiring = this.touchBtns.boost || this.keys['Space'];

            // Allow holding down the secondary action
            this.input.triggerSecondary = Boolean(this.touchBtns.jump || this.keys['ShiftLeft'] || this.keys['ShiftRight']);

            if (this.keys['KeyE']) {
                this.input.switchAbility = true; this.keys['KeyE'] = false;
            }
        }
    }
};

window.Controls.init();
