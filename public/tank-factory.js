// public/tank-factory.js
window.TankFactory = {

    // 1. TOON SHADER ASSETS
    toonGradient: null,
    outlineShader: null,

    initToonAssets: function() {
        if (this.toonGradient) return;
        const canvas = document.createElement('canvas');
        canvas.width = 4; canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#444444'; ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = '#888888'; ctx.fillRect(1, 0, 1, 1);
        ctx.fillStyle = '#cccccc'; ctx.fillRect(2, 0, 1, 1);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(3, 0, 1, 1);
        this.toonGradient = new THREE.CanvasTexture(canvas);
        this.toonGradient.magFilter = THREE.NearestFilter;
        this.toonGradient.minFilter = THREE.NearestFilter;

        this.outlineShader = new THREE.ShaderMaterial({
            uniforms: { strokeColor: { value: new THREE.Color(0x111111) }, strokeWidth: { value: 0.15 } },
            vertexShader: `uniform float strokeWidth; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * strokeWidth, 1.0); }`,
            fragmentShader: `uniform vec3 strokeColor; void main() { gl_FragColor = vec4(strokeColor, 1.0); }`,
            side: THREE.BackSide, depthWrite: true
        });
    },

    applyOutline: function(mesh, customWidth = 0.15) {
        const outMat = this.outlineShader.clone();
        outMat.uniforms.strokeWidth.value = customWidth;
        const outline = new THREE.Mesh(mesh.geometry, outMat);
        mesh.add(outline);
    },

    createEntityTexture: function(hexColorStr, isDamaged = false) {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = hexColorStr;
        ctx.fillRect(0, 0, 256, 256);

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(40, 40); ctx.lineTo(216, 40); ctx.lineTo(216, 120);
        ctx.moveTo(40, 216); ctx.lineTo(120, 216);
        ctx.moveTo(160, 160); ctx.lineTo(190, 160); ctx.lineTo(190, 190);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        for(let x = 12; x < 256; x += 16) {
            for(let y = 12; y < 256; y += 16) {
                ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI*2); ctx.fill();
            }
        }

        if (isDamaged) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            for(let i=0; i<20; i++) {
                ctx.beginPath(); ctx.arc(Math.random()*256, Math.random()*256, 5 + Math.random()*25, 0, Math.PI*2); ctx.fill();
            }
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.lineWidth = 3;
            for(let i=0; i<8; i++) {
                ctx.beginPath();
                let sX = Math.random()*256; let sY = Math.random()*256;
                ctx.moveTo(sX, sY);
                for(let j=0; j<5; j++) {
                    sX += (Math.random()-0.5)*50; sY += (Math.random()-0.5)*50;
                    ctx.lineTo(sX, sY);
                }
                ctx.stroke();
            }
        }
        return new THREE.CanvasTexture(canvas);
    },

    setDamageState: function(tankGroup, isDamaged) {
        if (!tankGroup.userData.materials) return;
        const mats = tankGroup.userData.materials;
        if (tankGroup.userData.chassisMesh) tankGroup.userData.chassisMesh.material = isDamaged ? mats.mainDamaged : mats.main;
        if (tankGroup.userData.turretMesh) tankGroup.userData.turretMesh.material = isDamaged ? mats.accentDamaged : mats.accent;
    },

    PARTS: {
        chassis: [
            { name: "Heavy Box", build: (mat, factory) => {
                const mesh = new THREE.Mesh(new THREE.BoxGeometry(9, 4.5, 18), mat);
                mesh.position.y = 4.5;
                mesh.castShadow = true;
                factory.applyOutline(mesh);
                return mesh;
            }}
        ],
        treads: [
            { name: "Link Tracks", isHover: false, build: (mat, factory) => {
                const group = new THREE.Group();
                const treadWidth = 3.5;
                const xOffset = 6.45;

                const curvePoints = [
                    new THREE.Vector3(0, 8.2, -8),     new THREE.Vector3(0, 8.2, 8),
                    new THREE.Vector3(0, 7.1, 10.6),   new THREE.Vector3(0, 4.5, 11.7),
                    new THREE.Vector3(0, 1.9, 10.6),   new THREE.Vector3(0, -0.2, 3.5),
                    new THREE.Vector3(0, -0.2, -3.5),  new THREE.Vector3(0, 1.9, -10.6),
                    new THREE.Vector3(0, 4.5, -11.7),  new THREE.Vector3(0, 7.1, -10.6)
                ];
                const trackCurve = new THREE.CatmullRomCurve3(curvePoints, true, 'centripetal', 0.5);
                const linkGeo = new THREE.BoxGeometry(treadWidth, 0.4, 1.8);

                const instancedLinks = new THREE.InstancedMesh(linkGeo, mat, 104);
                const outMat = factory.outlineShader.clone();
                outMat.uniforms.strokeWidth.value = 0.08;
                const instancedOutlines = new THREE.InstancedMesh(linkGeo, outMat, 104);

                let instanceIdx = 0;
                const dummy = new THREE.Object3D();

                [-xOffset, xOffset].forEach(sideX => {
                    [[sideX, 4.5, 8, 3.5], [sideX, 4.5, -8, 3.5], [sideX, 1.5, 3.5, 1.5], [sideX, 1.5, -3.5, 1.5]].forEach(w => {
                        const cyl = new THREE.CylinderGeometry(w[3], w[3], treadWidth - 0.2, 16);
                        cyl.rotateZ(Math.PI / 2);
                        const wheel = new THREE.Mesh(cyl, mat);
                        wheel.position.set(w[0], w[1], w[2]);
                        factory.applyOutline(wheel, 0.1);
                        group.add(wheel);
                    });

                    for (let i = 0; i < 52; i++) {
                        let t = i / 52;
                        const pos = trackCurve.getPointAt(t);
                        const tangent = trackCurve.getTangentAt(t).normalize();
                        const binormal = new THREE.Vector3(1, 0, 0);
                        const normal = new THREE.Vector3().crossVectors(tangent, binormal).normalize();

                        const matrix = new THREE.Matrix4();
                        matrix.makeBasis(binormal, normal, tangent);

                        dummy.quaternion.setFromRotationMatrix(matrix);
                        dummy.position.set(sideX, pos.y, pos.z);
                        dummy.updateMatrix();

                        instancedLinks.setMatrixAt(instanceIdx, dummy.matrix);
                        instancedOutlines.setMatrixAt(instanceIdx, dummy.matrix);
                        instanceIdx++;
                    }
                });
                group.add(instancedLinks, instancedOutlines);
                return group;
            }}
        ],
        turret: [
            { name: "Smooth Dome", build: (mat, factory) => {
                const mesh = new THREE.Mesh(new THREE.SphereGeometry(3.5, 32, 32), mat);
                mesh.castShadow = true;
                factory.applyOutline(mesh);
                return mesh;
            }}
        ],
        barrel: [
            { name: "Plasma Rail", build: (mat, factory, glowMat) => {
                const group = new THREE.Group();
                const railGeo = new THREE.BoxGeometry(1.2, 1.5, 8);
                const mesh = new THREE.Mesh(railGeo, mat);
                mesh.position.set(0, 0, -4.5);
                factory.applyOutline(mesh);

                const coreMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 8.2), glowMat);
                coreMesh.position.set(0, 0, -4.5);

                group.add(mesh, coreMesh);
                return group;
            }}
        ]
    },

    createTank: function(sp, sceneGroup) {
        this.initToonAssets();

        const group = new THREE.Group();

        // CRASH FIX: Modulo ensures we never ask for a part that doesn't exist
        let chIdx = (sp.chassis || 0) % this.PARTS.chassis.length;
        let trIdx = (sp.treads || 0) % this.PARTS.treads.length;
        let tuIdx = (sp.turret || 0) % this.PARTS.turret.length;
        let baIdx = (sp.barrel || 0) % this.PARTS.barrel.length;

        let colorMain = typeof sp.c1 === 'number' ? '#' + sp.c1.toString(16).padStart(6, '0') : (sp.c1 || '#b4d455');
        let colorAccent = typeof sp.c2 === 'number' ? '#' + sp.c2.toString(16).padStart(6, '0') : (sp.c2 || '#ff3366');
        let colorDark = '#2b2b36';

        let texMain = this.createEntityTexture(colorMain, false);
        let texMainDamaged = this.createEntityTexture(colorMain, true);
        let texAccent = this.createEntityTexture(colorAccent, false);
        let texAccentDamaged = this.createEntityTexture(colorAccent, true);
        let texDark = this.createEntityTexture(colorDark, false);

        let matMain = new THREE.MeshToonMaterial({ map: texMain, gradientMap: this.toonGradient });
        let matMainDamaged = new THREE.MeshToonMaterial({ map: texMainDamaged, gradientMap: this.toonGradient });
        let matAccent = new THREE.MeshToonMaterial({ map: texAccent, gradientMap: this.toonGradient });
        let matAccentDamaged = new THREE.MeshToonMaterial({ map: texAccentDamaged, gradientMap: this.toonGradient });
        let matTread = new THREE.MeshToonMaterial({ map: texDark, gradientMap: this.toonGradient });

        let matGlow = new THREE.MeshStandardMaterial({
            color: colorAccent, emissive: colorAccent, emissiveIntensity: 2.0,
            transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false
        });

        const hullGroup = new THREE.Group();

        const chassisMesh = this.PARTS.chassis[chIdx].build(matMain, this);
        const treadsMesh = this.PARTS.treads[trIdx].build(matTread, this);

        hullGroup.add(chassisMesh, treadsMesh);
        group.add(hullGroup);

        const turretGroup = new THREE.Group();
        const pitchGroup = new THREE.Group();

        const turretMesh = this.PARTS.turret[tuIdx].build(matAccent, this);
        turretGroup.add(turretMesh);

        const barrelMesh = this.PARTS.barrel[baIdx].build(matAccent, this, matGlow);
        pitchGroup.add(barrelMesh);

        turretGroup.add(pitchGroup);

        sceneGroup.add(group);
        sceneGroup.add(turretGroup);

        group.turretRef = turretGroup;
        group.pitchRef = pitchGroup;

        group.scale.set(0.33, 0.33, 0.33);
        turretGroup.scale.set(0.33, 0.33, 0.33);
        turretGroup.position.set(0, 8.8 * 0.33, 0);

        group.userData.materials = { main: matMain, mainDamaged: matMainDamaged, accent: matAccent, accentDamaged: matAccentDamaged };
        group.userData.chassisMesh = chassisMesh;
        group.userData.turretMesh = turretMesh;

        return group;
    }
};
