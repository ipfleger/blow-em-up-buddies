// public/map-builder.js
class MapBuilder {
    constructor(name) {
        this.name = name;
        this.props = { obstacles: [], platforms: [], updrafts: [], cube: null };
        this.terrainMods = [];
        this.spawnRules = null;
    }

    // ==========================================
    // 1. TERRAIN CARVING SCULPTORS
    // ==========================================

    setBaseTerrain(amplitude, scale) {
        this.terrainMods.push((x, z, h) => Math.sin(x * scale) * Math.cos(z * scale) * amplitude);
        return this;
    }

    addPlateau(cx, cz, radius, height, blendDist = 15) {
        this.terrainMods.push((x, z, h) => {
            let dist = Math.hypot(x - cx, z - cz);
            if (dist <= radius) return height;
            if (dist < radius + blendDist) {
                let t = (dist - radius) / blendDist;
                let smoothT = t * t * (3 - 2 * t);
                return height * (1 - smoothT) + h * smoothT;
            }
            return h;
        });
        return this;
    }

    addCanyonX(minX, maxX, depth, slopeLength = 50) {
        this.terrainMods.push((x, z, h) => {
            let newH = h;
            if (x >= minX && x <= maxX) newH = depth;
            else if (x >= minX - slopeLength && x < minX) {
                let t = (x - (minX - slopeLength)) / slopeLength;
                newH = h * (1 - t) + depth * t;
            }
            else if (x > maxX && x <= maxX + slopeLength) {
                let t = (x - maxX) / slopeLength;
                newH = depth * (1 - t) + h * t;
            }
            return Math.min(h, newH); // Math.min blends overlapping canyons!
        });
        return this;
    }

    addCanyonZ(minZ, maxZ, depth, slopeLength = 50) {
        this.terrainMods.push((x, z, h) => {
            let newH = h;
            if (z >= minZ && z <= maxZ) newH = depth;
            else if (z >= minZ - slopeLength && z < minZ) {
                let t = (z - (minZ - slopeLength)) / slopeLength;
                newH = h * (1 - t) + depth * t;
            }
            else if (z > maxZ && z <= maxZ + slopeLength) {
                let t = (z - maxZ) / slopeLength;
                newH = depth * (1 - t) + h * t;
            }
            return Math.min(h, newH);
        });
        return this;
    }

    addCustomTerrain(func) {
        this.terrainMods.push(func);
        return this;
    }


    // ==========================================
    // 2. PROP PLACEMENT PREFABS
    // ==========================================

    addPillar(x, z, radius, height) {
        this.props.obstacles.push({ x, z, r: radius, h: height });
        return this;
    }

    addPlatform(x, y, z, width, depth) {
        this.props.platforms.push({ x, y, z, w: width, d: depth });
        return this;
    }

    addUpdraft(x, z, radius, power) {
        this.props.updrafts.push({ x, z, r: radius, power });
        return this;
    }

    setGlowingCube(x, y, z) {
        this.props.cube = { x, y, z };
        return this;
    }

    addFlag(team, x, y, z) {
        if (!this.props.flags) this.props.flags = [];
        this.props.flags.push({ team, x, y, z });
        return this;
    }

    addBuilding(cx, cz, size, height, doorWidth) {
        let half = size / 2;
        let pRadius = 2.5;
        let spacing = 4.5;

        const buildWall = (startX, startZ, endX, endZ) => {
            let dist = Math.hypot(endX - startX, endZ - startZ);
            let steps = Math.floor(dist / spacing);
            for (let i = 0; i <= steps; i++) {
                let t = i / steps;
                let px = startX + (endX - startX) * t;
                let pz = startZ + (endZ - startZ) * t;

                if (Math.abs(px - cx) < doorWidth/2 && Math.abs(pz - cz) == half) continue;
                if (Math.abs(pz - cz) < doorWidth/2 && Math.abs(px - cx) == half) continue;

                this.addPillar(px, pz, pRadius, height);
            }
        };

        buildWall(cx - half, cz - half, cx + half, cz - half);
        buildWall(cx - half, cz + half, cx + half, cz + half);
        buildWall(cx - half, cz - half, cx - half, cz + half);
        buildWall(cx + half, cz - half, cx + half, cz + half);
        return this;
    }

    addStormRing(cx, cz, radius, count, size, power) {
        for (let i = 0; i < count; i++) {
            let angle = (i / count) * Math.PI * 2;
            this.addUpdraft(cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius, size, power);
        }
        return this;
    }

    addStaircase(startX, startZ, endX, endZ, startY, endY, steps, platSize) {
        for (let i = 0; i <= steps; i++) {
            let t = i / steps;
            let px = startX + (endX - startX) * t;
            let pz = startZ + (endZ - startZ) * t;
            let py = startY + (endY - startY) * t;
            this.addPlatform(px, py, pz, platSize, platSize);
        }
        return this;
    }

    // ==========================================
    // 3. COMPILATION
    // ==========================================

    setSpawns(func) {
        this.spawnRules = func;
        return this;
    }

    build() {
        return {
            props: this.props,
            getSpawn: this.spawnRules || ((team, index) => ({ x: team===1?-100:100, y: 20, z: (index%3-1)*40 })),
            getHeight: (x, z) => {
                let h = 0;
                for (let mod of this.terrainMods) { h = mod(x, z, h); }
                return h;
            }
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapBuilder;
} else {
    window.MapBuilder = MapBuilder;
}
