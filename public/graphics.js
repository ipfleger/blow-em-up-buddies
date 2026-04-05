// public/graphics.js
window.Graphics = {
    scene: null,
    camera: null,
    renderer: null,
    matchGroup: null,
    floorMesh: null,
    mapMaterials: {},
    activeEnvironmentProps: [],
    animatedUpdrafts: [],

    activeParticles: [],
    sparkGeo: new THREE.BoxGeometry(0.4, 0.4, 0.4),
    shatterGeo: new THREE.BoxGeometry(0.8, 0.8, 0.8),

    init: function() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0f0c1b);
        this.scene.fog = new THREE.FogExp2(0x0f0c1b, 0.015);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        this.renderer.domElement.style.position = 'absolute';
        this.renderer.domElement.style.top = '0';
        this.renderer.domElement.style.left = '0';
        this.renderer.domElement.style.zIndex = '1';
        document.body.insertBefore(this.renderer.domElement, document.getElementById('ui-layer'));

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(50, 100, 50);
        this.scene.add(dirLight);

        this.matchGroup = new THREE.Group();
        this.scene.add(this.matchGroup);

        this.initMaterials();

        const floorGeo = new THREE.PlaneGeometry(1000, 1000, 250, 250);
        floorGeo.rotateX(-Math.PI / 2);
        this.floorMesh = new THREE.Mesh(floorGeo, this.mapMaterials['bowl']);
        this.floorMesh.userData = { type: 'floor' };
        this.matchGroup.add(this.floorMesh);

        window.addEventListener('resize', () => this.onWindowResize());
        window.addEventListener('orientationchange', () => this.onWindowResize());
    },

    onWindowResize: function() {
        setTimeout(() => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        }, 100);
    },

    // ==========================================
    // MAP TEXTURE GENERATORS
    // ==========================================

    createBowlTexture: function() {
        const c = document.createElement('canvas'); c.width = 512; c.height = 512; const cx = c.getContext('2d');
        cx.fillStyle = '#2b3467'; cx.fillRect(0,0,512,512);
        cx.strokeStyle = '#6dcbc3'; cx.lineWidth = 4; cx.strokeRect(0,0,512,512);
        const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(20, 20);
        return tex;
    },

    createGauntletTexture: function() {
        const c = document.createElement('canvas'); c.width = 512; c.height = 512; const cx = c.getContext('2d');
        cx.fillStyle = '#e8d4a2'; cx.fillRect(0,0,512,512);
        cx.strokeStyle = 'rgba(61, 64, 91, 0.3)'; cx.lineWidth = 2;
        for(let i=0; i<=512; i+=32) {
            cx.beginPath(); cx.moveTo(i, 0); cx.lineTo(i, 512); cx.stroke();
            cx.beginPath(); cx.moveTo(0, i); cx.lineTo(512, i); cx.stroke();
        }
        const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(15, 15);
        return tex;
    },

    createShatteredTexture: function() {
        const c = document.createElement('canvas'); c.width = 512; c.height = 512; const cx = c.getContext('2d');
        cx.fillStyle = '#e07a5f'; cx.fillRect(0,0,512,512);
        cx.fillStyle = 'rgba(61, 64, 91, 0.15)';
        for(let x=10; x<512; x+=20) {
            for(let y=10; y<512; y+=20) {
                cx.beginPath(); cx.arc(x + (Math.random()*4-2), y + (Math.random()*4-2), 3, 0, Math.PI*2); cx.fill();
            }
        }
        const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(30, 30);
        return tex;
    },

    createStressTexture: function() {
        const c = document.createElement('canvas'); c.width = 512; c.height = 512; const cx = c.getContext('2d');
        cx.fillStyle = '#0f0c1b'; cx.fillRect(0,0,512,512);
        cx.strokeStyle = 'rgba(0, 255, 255, 0.15)'; cx.lineWidth = 2;
        for(let i=0; i<=512; i+=32) {
            cx.beginPath(); cx.moveTo(i, 0); cx.lineTo(i, 512); cx.stroke();
            cx.beginPath(); cx.moveTo(0, i); cx.lineTo(512, i); cx.stroke();
        }
        const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(30, 30);
        return tex;
    },

    createTechTexture: function() {
        const c = document.createElement('canvas'); c.width = 512; c.height = 512; const cx = c.getContext('2d');
        cx.fillStyle = '#1a1a24'; cx.fillRect(0,0,512,512); cx.strokeStyle = '#d44a8e'; cx.lineWidth = 3;
        for(let i=0; i<15; i++) { cx.beginPath(); cx.moveTo(Math.random()*512, 0); cx.lineTo(Math.random()*512, 512); cx.stroke(); }
        cx.strokeStyle = '#6dcbc3'; cx.lineWidth = 6; cx.strokeRect(20, 20, 472, 472);
        return new THREE.CanvasTexture(c);
    },

    initMaterials: function() {
        this.mapMaterials['bowl'] = new THREE.MeshStandardMaterial({ map: this.createBowlTexture(), flatShading: true });
        this.mapMaterials['geometric_gauntlet'] = new THREE.MeshStandardMaterial({ map: this.createGauntletTexture(), flatShading: true, roughness: 1.0 });
        this.mapMaterials['shattered_city'] = new THREE.MeshStandardMaterial({ map: this.createShatteredTexture(), flatShading: true, roughness: 0.9 });
        this.mapMaterials['stress_test'] = new THREE.MeshStandardMaterial({ map: this.createStressTexture(), flatShading: true, roughness: 0.8 });
    },

    // ==========================================
    // ENVIRONMENT & PROPS
    // ==========================================

rebuildMapGeometry: function(mapName) {
        // Safety: default to bowl if map is undefined
        const activeMapName = mapName || 'bowl';

        // Update visual materials first
        this.floorMesh.material = this.mapMaterials[activeMapName] || this.mapMaterials['bowl'];

        if (activeMapName === 'shattered_city') {
            this.scene.background = new THREE.Color(0x1a1525);
            this.scene.fog = new THREE.FogExp2(0x2a1a3a, 0.007);
        } else {
            this.scene.background = new THREE.Color(0x1f1c30);
            this.scene.fog = null;
        }

        const pos = this.floorMesh.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            // Use the safe map name here
            pos.setY(i, window.getTerrainHeight(pos.getX(i), pos.getZ(i), activeMapName));
        }
        this.floorMesh.geometry.computeVertexNormals();
        this.floorMesh.geometry.attributes.position.needsUpdate = true;
    },

    loadEnvironmentProps: function(mapName) {
        for (let prop of this.activeEnvironmentProps) {
            this.matchGroup.remove(prop);
            if (prop.geometry) prop.geometry.dispose();
            if (prop.material) prop.material.dispose();
        }
        this.activeEnvironmentProps = [];
        this.animatedUpdrafts = [];
        window.visualShutters = {};

        // Fetch the dynamically generated props from the MapBuilder
        const props = window.getMapProps(mapName);

        // Standard Materials
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1a24, roughness: 0.9, metalness: 0.5 });
        const platMat = new THREE.MeshStandardMaterial({ color: 0x2b2b36, roughness: 0.4, metalness: 0.8 });
        const stormMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.25, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });

        // 1. Render Obstacles/Pillars
        if (props.obstacles) {
            props.obstacles.forEach(obs => {
                const mesh = new THREE.Mesh(new THREE.CylinderGeometry(obs.r, obs.r, obs.h, 12), wallMat);
                mesh.position.set(obs.x, obs.h / 2, obs.z);
                mesh.userData = { type: 'obstacle' };
                this.matchGroup.add(mesh);
                this.activeEnvironmentProps.push(mesh);
            });
        }

        // 2. Render Platforms
        if (props.platforms) {
            props.platforms.forEach(p => {
                const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.w, 5, p.d), platMat);
                mesh.position.set(p.x, p.y - 2.5, p.z);
                mesh.userData = { type: 'obstacle' };
                this.matchGroup.add(mesh);
                this.activeEnvironmentProps.push(mesh);
            });
        }

        // 3. Render Updrafts (Storms)
        if (props.updrafts) {
            props.updrafts.forEach(u => {
                const geo = new THREE.CylinderGeometry(u.r, u.r, 200, 16, 1, true); geo.translate(0, 100, 0);
                const mesh = new THREE.Mesh(geo, stormMat);
                mesh.position.set(u.x, -50, u.z);
                this.matchGroup.add(mesh);
                this.activeEnvironmentProps.push(mesh);
                this.animatedUpdrafts.push(mesh);
            });
        }

        // 4. Render Objectives (Cube)
        if (props.cube) {
            const cubeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.0 });
            const cube = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), cubeMat);
            cube.position.set(props.cube.x, props.cube.y, props.cube.z);
            cube.userData = { isCube: true, baseY: props.cube.y };
            this.matchGroup.add(cube);
            this.activeEnvironmentProps.push(cube);
            this.animatedUpdrafts.push(cube);
        }
    },

    // ==========================================
    // PARTICLES & EFFECTS
    // ==========================================

    emitSparks: function(tankMesh, rawRot, config, speed) {
        const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0,1,0), rawRot);
        const isReverse = speed < 0;
        const offsetMult = isReverse ? 2.5 : -2.5;
        const exhaustPos = tankMesh.position.clone().add(forward.clone().multiplyScalar(offsetMult));
        exhaustPos.y += 0.8;

        const sparkMat = new THREE.MeshBasicMaterial({ color: parseInt(config.c1.replace('#', '0x')) });

        for(let i=0; i<2; i++) {
            const spark = new THREE.Mesh(this.sparkGeo, sparkMat);
            spark.position.copy(exhaustPos);
            this.matchGroup.add(spark);

            const scatter = new THREE.Vector3((Math.random()-0.5)*3, Math.random()*2, (Math.random()-0.5)*3);
            const vel = forward.clone().multiplyScalar(isReverse ? 3 : -3).add(scatter);
            this.activeParticles.push({ mesh: spark, vel: vel, life: 0.5 });
        }
    },

    createShatterParticles: function(position, count = 40, pColor = 0xff3366) {
        for(let i=0; i<count; i++) {
            const pMat = new THREE.MeshBasicMaterial({ color: pColor });
            const p = new THREE.Mesh(this.shatterGeo, pMat);
            p.position.copy(position);
            this.matchGroup.add(p);

            this.activeParticles.push({
                mesh: p,
                vel: new THREE.Vector3((Math.random() - 0.5)*8, (Math.random()*6), (Math.random() - 0.5)*8),
                life: 1.5
            });
        }
    },

    updateParticles: function(delta) {
        for (let i = this.activeParticles.length - 1; i >= 0; i--) {
            const pt = this.activeParticles[i];
            pt.vel.y += -0.015 * 60 * delta;
            pt.mesh.position.addScaledVector(pt.vel, 60 * delta);
            pt.mesh.rotation.x += 0.2;
            pt.mesh.rotation.y += 0.2;
            pt.life -= delta;

            if (pt.life > 0) {
                pt.mesh.scale.setScalar(Math.max(0, pt.life * 2));
            } else {
                if (pt.mesh.material) pt.mesh.material.dispose();
                this.matchGroup.remove(pt.mesh);
                this.activeParticles.splice(i, 1);
            }
        }

        for (let i = 0; i < this.animatedUpdrafts.length; i++) {
            let obj = this.animatedUpdrafts[i];
            if (obj.userData && obj.userData.isCube) {
                obj.rotation.x += 2.0 * delta;
                obj.rotation.y += 3.0 * delta;
                obj.position.y = obj.userData.baseY + Math.sin(Date.now() * 0.003) * 1.5;
            } else {
                obj.rotation.y += 1.5 * delta;
                if (obj.material) {
                    obj.material.opacity = 0.25 + Math.sin(Date.now() * 0.004 + i) * 0.15;
                }
            }
        }
    },

    render: function() {
        this.renderer.render(this.scene, this.camera);
    }
};

window.Graphics.init();
