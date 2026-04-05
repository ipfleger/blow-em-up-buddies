// public/network.js
window.Network = {
    pc: null,
    dataChannel: null,

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
            window.socket.emit('start-webrtc');
            this.initWebRTC();
        });

        window.socket.on('webrtc-answer', (answer) => {
            if (this.pc) this.pc.setRemoteDescription(new RTCSessionDescription(answer));
        });

        window.socket.on('ice-candidate', (data) => {
            if (this.pc) this.pc.addIceCandidate(new RTCIceCandidate(data));
        });

        window.socket.on('receive-ping', (data) => {
            if (window.onReceivePing) window.onReceivePing(data);
        });
    },

    initWebRTC: function() {
        this.pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        this.dataChannel = this.pc.createDataChannel("game");

        this.dataChannel.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.type === 'state' && window.updateGame) window.updateGame(data.payload);
        };

        this.pc.onicecandidate = (e) => {
            if(e.candidate) window.socket.emit('ice-candidate', { candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid });
        };

        this.pc.createOffer()
            .then(o => this.pc.setLocalDescription(o))
            .then(() => window.socket.emit('webrtc-offer', { type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp }));
    },

    startInputSync: function() {
        setInterval(() => {
            if(this.dataChannel && this.dataChannel.readyState === 'open' && window.Controls) {
                this.dataChannel.send(JSON.stringify({ type: 'input', payload: window.Controls.input }));
                window.Controls.input.triggerJump = false;
                window.Controls.input.triggerSecondary = false;
                if(window.Controls.touchBtns.jump) window.Controls.touchBtns.jump = false;
            }
        }, 1000/30);
    }
};

setTimeout(() => window.Network.init(), 100);
