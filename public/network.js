// public/network.js
window.Network = {
    init: function() {
        this.setupSocketListeners();
        this.startInputSync();

        const btnSwitch = document.getElementById('btn-switch-seat');
        if (btnSwitch) btnSwitch.onclick = () => window.socket.emit('request-seat-swap');

        // Swap overlay buttons
        const swapAccept = document.getElementById('swap-accept');
        const swapDeny = document.getElementById('swap-deny');
        const swapOverlay = document.getElementById('swap-overlay');
        if (swapAccept) swapAccept.onclick = () => {
            window.socket.emit('accept-swap');
            if (swapOverlay) swapOverlay.classList.add('hidden');
        };
        if (swapDeny) swapDeny.onclick = () => {
            if (swapOverlay) swapOverlay.classList.add('hidden');
        };
    },

    setupSocketListeners: function() {
        if (!window.socket) return;

        window.socket.on('swap-requested', () => {
            const swapOverlay = document.getElementById('swap-overlay');
            if (swapOverlay) swapOverlay.classList.remove('hidden');
        });

        window.socket.on('lobby-update', (lobby) => {
            if (window.onLobbyUpdate) window.onLobbyUpdate(lobby);
        });

        window.socket.on('launch-game', (mapName) => {
            if (window.onLaunchGame) window.onLaunchGame(mapName);
        });

        // Receive the game state directly from Socket.io
        window.socket.on('state', (state) => {
            if (window.updateGame) window.updateGame(state);
        });

        window.socket.on('receive-ping', (data) => {
            if (window.onReceivePing) window.onReceivePing(data);
        });

        // Host transfer notification
        window.socket.on('host-transferred', (newHostId) => {
            if (newHostId === window.myId) {
                window.isHost = true;
                const launchBtn = document.getElementById('btn-launch');
                if (launchBtn) launchBtn.classList.remove('hidden');
            }
        });
    },

    startInputSync: function() {
        setInterval(() => {
            if (window.Controls && window.isMatchActive) {
                window.socket.emit('input', window.Controls.input);

                window.Controls.input.triggerJump = false;
                window.Controls.input.triggerSecondary = false;
                window.Controls.input.switchAbility = false;
            }
        }, 1000 / 30);
    }
};

setTimeout(() => window.Network.init(), 100);
