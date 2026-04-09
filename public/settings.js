// public/settings.js
// Loads, saves, and applies game settings via localStorage

window.GameSettings = {
    defaults: {
        sensitivity: 1.0,
        volume: 0.5,
        quality: 'medium',
        arEnabled: false
    },

    current: {},

    load: function() {
        try {
            const saved = JSON.parse(localStorage.getItem('gameSettings') || '{}');
            this.current = Object.assign({}, this.defaults, saved);
        } catch(e) {
            this.current = Object.assign({}, this.defaults);
        }
        this.apply();
    },

    save: function() {
        try {
            localStorage.setItem('gameSettings', JSON.stringify(this.current));
        } catch(e) {}
    },

    apply: function() {
        // Apply volume
        if (window.AudioManager) window.AudioManager.setVolume(this.current.volume);

        // Apply sensitivity to Controls
        if (window.Controls) window.Controls.sensitivityMultiplier = this.current.sensitivity;

        // Apply quality to Graphics
        if (window.Graphics) {
            const qualityMap = { low: 0.4, medium: 1.0, high: 2.0 };
            window.Graphics.particleQuality = qualityMap[this.current.quality] || 1.0;
        }

        // Apply AR setting
        if (window.Controls) {
            window.Controls.useAR = Boolean(this.current.arEnabled);
            if (this.current.arEnabled && window.Controls.setupMotionControls) {
                window.Controls.setupMotionControls();
            }
        }
    },

    reset: function() {
        this.current = Object.assign({}, this.defaults);
        this.save();
        this.apply();
        this.syncUI();
    },

    syncUI: function() {
        const sliderSens = document.getElementById('slider-sensitivity');
        const sliderVol = document.getElementById('slider-volume');
        const selectQuality = document.getElementById('select-quality');
        const chkAr = document.getElementById('chk-ar');
        const lblSensitivity = document.getElementById('lbl-sensitivity');

        if (sliderSens) { sliderSens.value = this.current.sensitivity; }
        if (lblSensitivity) { lblSensitivity.textContent = parseFloat(this.current.sensitivity).toFixed(1) + 'x'; }
        if (sliderVol) { sliderVol.value = this.current.volume; }
        if (selectQuality) { selectQuality.value = this.current.quality; }
        if (chkAr) { chkAr.checked = Boolean(this.current.arEnabled); }
    },

    initUI: function() {
        const sliderSens = document.getElementById('slider-sensitivity');
        const sliderVol = document.getElementById('slider-volume');
        const selectQuality = document.getElementById('select-quality');
        const chkAr = document.getElementById('chk-ar');
        const btnReset = document.getElementById('btn-settings-reset');
        const lblSensitivity = document.getElementById('lbl-sensitivity');

        if (sliderSens) {
            sliderSens.addEventListener('input', () => {
                this.current.sensitivity = parseFloat(sliderSens.value);
                if (lblSensitivity) lblSensitivity.textContent = this.current.sensitivity.toFixed(1) + 'x';
                this.save(); this.apply();
            });
        }

        if (sliderVol) {
            sliderVol.addEventListener('input', () => {
                this.current.volume = parseFloat(sliderVol.value);
                this.save(); this.apply();
            });
        }

        if (selectQuality) {
            selectQuality.addEventListener('change', () => {
                this.current.quality = selectQuality.value;
                this.save(); this.apply();
            });
        }

        if (chkAr) {
            chkAr.addEventListener('change', () => {
                this.current.arEnabled = chkAr.checked;
                this.save(); this.apply();
            });
        }

        if (btnReset) {
            btnReset.addEventListener('click', () => {
                this.reset();
            });
        }

        this.syncUI();
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.GameSettings.load();
    window.GameSettings.initUI();
});
