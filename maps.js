// public/maps.js
const Builder = typeof window !== 'undefined' ? window.MapBuilder : require('./map-builder');

const MapRegistry = {

    // --- MAP 1: THE BOWL ---
    bowl: new Builder('bowl')
        .addCustomTerrain((x, z, h) => {
            let dist = Math.hypot(x, z);
            let base = 0;
            if (dist < 50) base = 12;
            else if (dist < 90) base = 12 * (0.5 * (1 + Math.cos(((dist - 50) / 40) * Math.PI)));
            base += Math.sin(x * 0.025) * Math.cos(z * 0.025) * 1.5;
            if (dist > 240) base += Math.pow(dist - 240, 2) * 0.04;
            return base;
        })
        .setSpawns((team, index) => ({ x: team === 1 ? -120 : 120, y: 20, z: (index % 3 - 1) * 40 }))
        .build(),

    // --- MAP 2: FLATLAND ---
    flatland: new Builder('flatland')
        .setSpawns((team, index) => ({ x: team === 1 ? -100 : 100, y: 0, z: (index % 3 - 1) * 40 }))
        .build(),

    // --- MAP 3: STRESS TEST (THE BIG 'H') ---
    stress_test: new Builder('stress_test')
        .setBaseTerrain(2.0, 0.05)
        .addPlateau(0, 0, 70, 0, 15) // Safe center zone

        // 1. THE CANYON SYSTEM (The 'H' Shape to the North)
        .addCanyonX(-160, -100, -60, 40) // West Canyon
        .addCanyonX(100, 160, -60, 40)   // East Canyon
        .addCanyonZ(120, 180, -60, 40)   // The Cross-Trench connecting them

        // 2. THE TUNNEL ROOF
        // We place a platform directly over the cross-trench.
        // It spans X from -100 to 100, and Z from 120 to 180
        .addPlatform(0, 10, 150, 200, 60)

        // 3. PARKOUR PLATFORMS
        // Stairs leading from the bottom of the East Canyon (-60) up to the Tunnel Roof (10)
        .addStaircase(130, 80, 50, 150, -50, 10, 6, 12)

        // 4. CENTRAL POINT OF INTEREST
        .addBuilding(0, 0, 40, 40, 16)
        .addPlatform(0, 40, 0, 48, 48) // The building roof
        .setGlowingCube(0, 4, 0)
        .addStormRing(0, 0, 55, 16, 15, 4.5)

        // 5. THE DRAG STRIP (To the South)
        .addPlateau(0, -150, 80, 0, 20)
        .addPillar(-50, -150, 6, 25)
        .addPillar(0, -150, 6, 25)
        .addPillar(50, -150, 6, 25)

        // Spawns
        .setSpawns((team, index) => ({ x: team === 1 ? -45 : 45, y: 10, z: (index % 3 - 1) * 20 }))
        .build(),

    // --- MAP 4: TRENCHES (CTF) — Alien Asteroid ---
    trenches: new Builder('trenches')
        // Wide central canyon dividing the two halves
        .addCanyonX(-35, 35, -15, 60)

        // Impact craters scattered across the map (raised rims for air launches)
        .addCustomTerrain((x, z, h) => {
            const craters = [
                { cx: 150, cz: 150, R: 55, D: 10 },
                { cx: -150, cz: 150, R: 55, D: 10 },
                { cx: 150, cz: -150, R: 55, D: 10 },
                { cx: -150, cz: -150, R: 55, D: 10 },
                { cx: 80, cz: -200, R: 40, D: 8 },
                { cx: -80, cz: 200, R: 40, D: 8 },
                { cx: 0, cz: 300, R: 50, D: 9 },
                { cx: 0, cz: -300, R: 50, D: 9 },
                { cx: -250, cz: 0, R: 45, D: 8 },
                { cx: 250, cz: 0, R: 45, D: 8 },
            ];
            let delta = 0;
            for (const { cx, cz, R, D } of craters) {
                const dist = Math.hypot(x - cx, z - cz);
                if (dist < R) {
                    delta += -D * Math.cos(Math.PI * dist / R);
                } else if (dist < R * 1.3) {
                    delta += 3 * (1 - (dist - R) / (R * 0.3));
                }
            }
            return h + delta;
        })

        // Monoliths — tall obelisks and medium cover objects
        // Corner obelisks
        .addPillar(200, 200, 6, 70)
        .addPillar(-200, 200, 6, 70)
        .addPillar(200, -200, 6, 70)
        .addPillar(-200, -200, 6, 70)
        // Canyon-edge monoliths
        .addPillar(40, 60, 8, 45)
        .addPillar(-40, 60, 8, 45)
        .addPillar(40, -60, 8, 45)
        .addPillar(-40, -60, 8, 45)
        // Central area pillars
        .addPillar(35, 0, 4, 40)
        .addPillar(-35, 0, 4, 40)
        .addPillar(0, 35, 4, 40)
        .addPillar(0, -35, 4, 40)
        // Outer scattered monoliths
        .addPillar(300, 0, 10, 55)
        .addPillar(-300, 0, 10, 55)
        .addPillar(0, 300, 10, 55)
        .addPillar(0, -300, 10, 55)
        .addPillar(150, -250, 5, 80)
        .addPillar(-150, 250, 5, 80)

        // CTF flag home positions — wide apart on the expanded map
        .addFlag(1, -300, 2, 0)
        .addFlag(2, 300, 2, 0)

        .setSpawns((team, index) => ({ x: team === 1 ? -280 : 280, y: 5, z: (index % 3 - 1) * 50 }))
        .build()
};


// ==========================================
// ENGINE EXPORT LOGIC (Do not touch)
// ==========================================

const CACHE_SIZE = 1000; const HALF_SIZE = CACHE_SIZE / 2;
const heightCache = {};

function precomputeCache(mapName) {
    if (!MapRegistry[mapName]) return;
    heightCache[mapName] = new Array(CACHE_SIZE + 1);
    for (let x = 0; x <= CACHE_SIZE; x++) {
        heightCache[mapName][x] = new Float32Array(CACHE_SIZE + 1);
        for (let z = 0; z <= CACHE_SIZE; z++) {
            heightCache[mapName][x][z] = MapRegistry[mapName].getHeight(x - HALF_SIZE, z - HALF_SIZE);
        }
    }
}

function getTerrainHeight(x, z, mapName = 'trenches') {
    // Safety check: if mapName is missing or invalid, fallback to trenches
    if (!mapName || !MapRegistry[mapName]) mapName = 'trenches';

    let activeMap = MapRegistry[mapName];

    // FIX: If cache doesn't exist yet, build it now
    if (!heightCache[mapName]) {
        precomputeCache(mapName);
    }

    let gridX = x + HALF_SIZE;
    let gridZ = z + HALF_SIZE;

    // Boundary check for the cache array
    if (gridX < 0 || gridX >= CACHE_SIZE || gridZ < 0 || gridZ >= CACHE_SIZE) {
        return activeMap.getHeight(x, z);
    }

    let x0 = Math.floor(gridX);
    let x1 = Math.min(x0 + 1, CACHE_SIZE);
    let z0 = Math.floor(gridZ);
    let z1 = Math.min(z0 + 1, CACHE_SIZE);

    let tx = gridX - x0;
    let tz = gridZ - z0;

    let h00 = heightCache[mapName][x0][z0];
    let h10 = heightCache[mapName][x1][z0];
    let h01 = heightCache[mapName][x0][z1];
    let h11 = heightCache[mapName][x1][z1];

    let h0 = h00 * (1 - tx) + h10 * tx;
    let h1 = h01 * (1 - tx) + h11 * tx;
    return h0 * (1 - tz) + h1 * tz;
}

function getSpawnPoint(mapName, team, index) {
    let activeMap = MapRegistry[mapName] || MapRegistry['trenches'];
    return activeMap.getSpawn(team, index);
}

function getMapProps(mapName) {
    let activeMap = MapRegistry[mapName] || MapRegistry['trenches'];
    return activeMap.props;
}

// At the bottom of maps.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getTerrainHeight,
        getSpawnPoint,
        getMapProps,
        MapRegistry // Export the registry so the engine can see all maps
    };
} else {
    window.getTerrainHeight = getTerrainHeight;
    window.getSpawnPoint = getSpawnPoint;
    window.getMapProps = getMapProps;
}
