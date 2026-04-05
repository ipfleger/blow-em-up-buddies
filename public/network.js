// public/network.js
window.Network = {
    init: function() {
        this.setupSocketListeners();
        this.startInputSync();

        const btnSwitch = document.getElementById('btn-switch-seat');
        if (btnSwitch) btnSwitch.onclick = () => window.socket.emit('request-seat-swap');
    },

    setupSocketListeners: function() {
        if (!window.socket) return;

        window.socket.on('swap-requested', () => {
            if (confirm("Your teammate wants to swap seats! Accept?")) window.socket.emit('accept-swap');
        });

        window.socket.on('lobby-update', (lobby) => {
            if (window.onLobbyUpdate) window.onLobbyUpdate(lobby);
        });

        window.socket.on('launch-game', (mapName) => {
            if (window.onLaunchGame) window.onLaunchGame(mapName);
            // Notice: We no longer initialize WebRTC here!
        });

        // NEW: Receive the game state directly from Socket.io
        window.socket.on('state', (state) => {
            if (window.updateGame) window.updateGame(state);
        });

        window.socket.on('receive-ping', (data) => {
            if (window.onReceivePing) window.onReceivePing(data);
        });
    },

    startInputSync: function() {
        setInterval(() => {
            if (window.Controls && window.isMatchActive) {
                // Send inputs directly via socket
                window.socket.emit('input', window.Controls.input);

                // Clear triggers so they don't fire continuously
                window.Controls.input.triggerJump = false;
                window.Controls.input.triggerSecondary = false;
                window.Controls.input.switchAbility = false;
            }
        }, 1000 / 30); // 30 times a second
    }
};
