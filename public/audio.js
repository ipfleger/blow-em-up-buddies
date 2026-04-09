// public/audio.js
// AudioManager — synthesized sound effects via Web Audio API
window.AudioManager = (function () {
    'use strict';

    let ctx = null;
    let masterGain = null;
    let masterVolume = 0.5;

    // Currently active looping nodes
    const loops = {};

    // ─── Context helpers ────────────────────────────────────────────────────

    function getCtx() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = ctx.createGain();
            masterGain.gain.value = masterVolume;
            masterGain.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    function dst() {
        getCtx();
        return masterGain;
    }

    // ─── Primitive builders ─────────────────────────────────────────────────

    function createNoiseBuffer(durationSecs) {
        const c = getCtx();
        const len = Math.floor(c.sampleRate * durationSecs);
        const buf = c.createBuffer(1, len, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    }

    /**
     * One-shot oscillator.
     * @param {number} freq          Frequency in Hz
     * @param {string} type          OscillatorType ('sine','square','sawtooth','triangle')
     * @param {number} duration      Seconds
     * @param {number} gainVal       Peak gain (0–1)
     * @param {number} [fadeIn]      Attack time (s), default 0.01
     * @param {number} [fadeOut]     Release time (s), default 0.05
     * @param {number} [startTime]   AudioContext time to start, default now
     * @param {AudioNode} [output]   Destination node, default masterGain
     */
    function playTone(freq, type, duration, gainVal, fadeIn, fadeOut, startTime, output) {
        const c = getCtx();
        const t = (startTime !== undefined) ? startTime : c.currentTime;
        const fi = fadeIn || 0.01;
        const fo = Math.min(fadeOut || 0.05, duration * 0.5);
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gainVal, t + fi);
        g.gain.setValueAtTime(gainVal, t + duration - fo);
        g.gain.linearRampToValueAtTime(0.0001, t + duration);
        osc.connect(g);
        g.connect(output || dst());
        osc.start(t);
        osc.stop(t + duration + 0.01);
    }

    /**
     * Frequency-sweeping oscillator (one-shot).
     */
    function playSweep(startFreq, endFreq, type, duration, gainVal, startTime, output) {
        const c = getCtx();
        const t = (startTime !== undefined) ? startTime : c.currentTime;
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = type || 'sawtooth';
        osc.frequency.setValueAtTime(Math.max(0.1, startFreq), t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(0.1, endFreq), t + duration);
        g.gain.setValueAtTime(gainVal, t);
        g.gain.linearRampToValueAtTime(0.0001, t + duration);
        osc.connect(g);
        g.connect(output || dst());
        osc.start(t);
        osc.stop(t + duration + 0.01);
    }

    /**
     * Filtered white-noise burst.
     */
    function playNoise(duration, gainVal, filterFreq, filterType, startTime, output) {
        const c = getCtx();
        const t = (startTime !== undefined) ? startTime : c.currentTime;
        const src = c.createBufferSource();
        src.buffer = createNoiseBuffer(duration + 0.05);
        const flt = c.createBiquadFilter();
        flt.type = filterType || 'bandpass';
        flt.frequency.value = filterFreq || 800;
        flt.Q.value = 1.2;
        const g = c.createGain();
        g.gain.setValueAtTime(gainVal, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        src.connect(flt);
        flt.connect(g);
        g.connect(output || dst());
        src.start(t);
        src.stop(t + duration + 0.05);
    }

    // ─── Sound definitions ───────────────────────────────────────────────────

    const sounds = {

        // --- Boost -----------------------------------------------------------

        boostIgnition() {
            const c = getCtx();
            const t = c.currentTime;
            playSweep(80, 260, 'sawtooth', 0.18, 0.28, t);
            playNoise(0.14, 0.18, 600, 'bandpass', t);
            playTone(100, 'square', 0.2, 0.18, 0.01, 0.08, t);
        },

        boostStart() {
            if (loops.boost) return;
            const c = getCtx();
            const loopGain = c.createGain();
            loopGain.gain.setValueAtTime(0.0001, c.currentTime);
            loopGain.gain.linearRampToValueAtTime(0.18, c.currentTime + 0.12);
            loopGain.connect(dst());

            // Sawtooth engine tone
            const osc = c.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = 55;

            // Looping noise layer
            const noiseSrc = c.createBufferSource();
            noiseSrc.buffer = createNoiseBuffer(1.5);
            noiseSrc.loop = true;

            const flt = c.createBiquadFilter();
            flt.type = 'lowpass';
            flt.frequency.value = 350;
            flt.Q.value = 2.5;

            const noiseGain = c.createGain();
            noiseGain.gain.value = 0.06;

            osc.connect(flt);
            noiseSrc.connect(noiseGain);
            noiseGain.connect(flt);
            flt.connect(loopGain);

            osc.start();
            noiseSrc.start();

            loops.boost = { osc, noiseSrc, gain: loopGain };
            sounds.boostIgnition();
        },

        boostStop() {
            if (!loops.boost) return;
            const c = getCtx();
            const l = loops.boost;
            l.gain.gain.cancelScheduledValues(c.currentTime);
            l.gain.gain.setValueAtTime(l.gain.gain.value, c.currentTime);
            l.gain.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.25);
            loops.boost = null;
            setTimeout(() => { try { l.osc.stop(); l.noiseSrc.stop(); } catch (_) {} }, 350);
        },

        // --- Driver actions --------------------------------------------------

        jump() {
            const c = getCtx();
            const t = c.currentTime;
            playSweep(200, 480, 'sine', 0.18, 0.22, t);
            playTone(300, 'square', 0.08, 0.10, 0.005, 0.04, t);
        },

        land() {
            const c = getCtx();
            const t = c.currentTime;
            playNoise(0.18, 0.35, 160, 'lowpass', t);
            playTone(55, 'sine', 0.18, 0.40, 0.005, 0.12, t);
        },

        // --- Weapons ---------------------------------------------------------

        concussiveFire() {
            const c = getCtx();
            const t = c.currentTime;
            playSweep(140, 35, 'sine', 0.32, 0.55, t);
            playNoise(0.22, 0.42, 280, 'lowpass', t);
            playTone(900, 'square', 0.06, 0.16, 0.002, 0.03, t);
        },

        concussiveImpact() {
            const c = getCtx();
            const t = c.currentTime;
            playSweep(220, 28, 'sine', 0.42, 0.68, t);
            playNoise(0.38, 0.55, 120, 'lowpass', t);
            playTone(55, 'sine', 0.45, 0.45, 0.005, 0.35, t);
        },

        rapidFire() {
            // Single needle zap (call rapidly for burst effect)
            const c = getCtx();
            const t = c.currentTime;
            playSweep(1400, 700, 'square', 0.04, 0.15, t);
            playTone(900, 'sine', 0.03, 0.10, 0.001, 0.02, t);
        },

        rapidFireStart() {
            if (loops.rapidFire) return;
            const c = getCtx();
            const loopGain = c.createGain();
            loopGain.gain.setValueAtTime(0.0001, c.currentTime);
            loopGain.gain.linearRampToValueAtTime(0.12, c.currentTime + 0.06);
            loopGain.connect(dst());

            // Carrier oscillator modulated at "rapid fire" rate
            const osc = c.createOscillator();
            osc.type = 'square';
            osc.frequency.value = 820;

            const lfo = c.createOscillator();
            lfo.type = 'square';
            lfo.frequency.value = 14;

            const lfoGain = c.createGain();
            lfoGain.gain.value = 380;

            const flt = c.createBiquadFilter();
            flt.type = 'bandpass';
            flt.frequency.value = 950;
            flt.Q.value = 3.5;

            lfo.connect(lfoGain);
            lfoGain.connect(osc.frequency);
            osc.connect(flt);
            flt.connect(loopGain);

            osc.start();
            lfo.start();

            loops.rapidFire = { osc, lfo, gain: loopGain };
        },

        rapidFireStop() {
            if (!loops.rapidFire) return;
            const c = getCtx();
            const l = loops.rapidFire;
            l.gain.gain.cancelScheduledValues(c.currentTime);
            l.gain.gain.setValueAtTime(l.gain.gain.value, c.currentTime);
            l.gain.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.1);
            loops.rapidFire = null;
            setTimeout(() => { try { l.osc.stop(); l.lfo.stop(); } catch (_) {} }, 200);
        },

        // --- Feedback --------------------------------------------------------

        hitConfirm() {
            const c = getCtx();
            const t = c.currentTime;
            playTone(1900, 'sine', 0.09, 0.22, 0.001, 0.06, t);
            playTone(2550, 'sine', 0.05, 0.12, 0.001, 0.04, t + 0.04);
        },

        killConfirmed() {
            const c = getCtx();
            const t = c.currentTime;
            playTone(440, 'sine', 0.15, 0.30, 0.01, 0.05, t);
            playTone(554, 'sine', 0.13, 0.25, 0.01, 0.05, t + 0.10);
            playTone(659, 'sine', 0.13, 0.25, 0.01, 0.10, t + 0.20);
            playNoise(0.10, 0.14, 600, 'bandpass', t + 0.22);
        },

        tankDeath() {
            const c = getCtx();
            const t = c.currentTime;
            playSweep(320, 18, 'sawtooth', 0.55, 0.65, t);
            playNoise(0.55, 0.65, 180, 'lowpass', t);
            playTone(75, 'sine', 0.65, 0.55, 0.005, 0.55, t);
        },

        // --- CTF events ------------------------------------------------------

        flagPickup() {
            const c = getCtx();
            const t = c.currentTime;
            [440, 554, 659, 880].forEach((freq, i) => {
                playTone(freq, 'sine', 0.18, 0.30, 0.005, 0.08, t + i * 0.07);
            });
        },

        flagCapture() {
            const c = getCtx();
            const t = c.currentTime;
            [440, 550, 660, 880, 1100].forEach((freq, i) => {
                playTone(freq, 'triangle', 0.28, 0.38, 0.005, 0.10, t + i * 0.09);
            });
            playNoise(0.20, 0.22, 700, 'bandpass', t + 0.45);
        },

        flagAlert() {
            // Enemy picked up our flag
            const c = getCtx();
            const t = c.currentTime;
            [880, 660, 440].forEach((freq, i) => {
                playTone(freq, 'sine', 0.14, 0.28, 0.005, 0.06, t + i * 0.08);
            });
        },

        flagReturn() {
            // Flag returned to base (not captured)
            const c = getCtx();
            const t = c.currentTime;
            [660, 550, 440].forEach((freq, i) => {
                playTone(freq, 'sine', 0.15, 0.24, 0.005, 0.06, t + i * 0.08);
            });
        },

        // --- Health ----------------------------------------------------------

        lowHealthPulse() {
            const c = getCtx();
            const t = c.currentTime;
            playTone(58, 'sine', 0.08, 0.45, 0.005, 0.05, t);
            playTone(52, 'sine', 0.06, 0.32, 0.005, 0.04, t + 0.16);
        },

        // --- UI --------------------------------------------------------------

        uiClick() {
            const c = getCtx();
            const t = c.currentTime;
            playTone(820, 'sine', 0.04, 0.14, 0.001, 0.025, t);
        },
    };

    // ─── Low-health heartbeat manager ───────────────────────────────────────

    const LOW_HEALTH_THRESHOLD = 30;
    const LOW_HEALTH_PULSE_INTERVAL_MS = 850;

    let _lowHealthInterval = null;
    let _wasLowHealth = false;

    function checkLowHealth(health) {
        if (health > 0 && health < LOW_HEALTH_THRESHOLD) {
            if (!_wasLowHealth) {
                _wasLowHealth = true;
                _lowHealthInterval = setInterval(() => {
                    if (_wasLowHealth) sounds.lowHealthPulse();
                }, LOW_HEALTH_PULSE_INTERVAL_MS);
            }
        } else {
            if (_wasLowHealth) {
                _wasLowHealth = false;
                if (_lowHealthInterval) { clearInterval(_lowHealthInterval); _lowHealthInterval = null; }
            }
        }
    }

    // ─── Volume control ─────────────────────────────────────────────────────

    function setVolume(vol) {
        masterVolume = Math.max(0, Math.min(1, parseFloat(vol) || 0));
        if (masterGain) {
            masterGain.gain.cancelScheduledValues(getCtx().currentTime);
            masterGain.gain.setTargetAtTime(masterVolume, getCtx().currentTime, 0.02);
        }
        localStorage.setItem('buddies_volume', masterVolume);
    }

    function getVolume() {
        return masterVolume;
    }

    // Restore saved volume
    const _savedVol = localStorage.getItem('buddies_volume');
    if (_savedVol !== null) masterVolume = parseFloat(_savedVol) || 0.5;

    // ─── UI click sounds (delegated) ─────────────────────────────────────────

    document.addEventListener('click', (e) => {
        const btn = e.target && (e.target.tagName === 'BUTTON' ? e.target : e.target.closest('button'));
        if (btn) sounds.uiClick();
    }, true);

    // ─── Public API ──────────────────────────────────────────────────────────

    return {
        sounds,
        setVolume,
        getVolume,
        checkLowHealth,
    };
}());
