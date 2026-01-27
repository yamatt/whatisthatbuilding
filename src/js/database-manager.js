import SPL from 'spl.js';

export class DatabaseManager {
    MANIFEST_URL = "https://pub-6c56489c6f02474bafaba0f1b7bb961d.r2.dev/manifest.json";
    R2_BASE_URL = "https://pub-6c56489c6f02474bafaba0f1b7bb961d.r2.dev/";
    DB_NAME = "whatisthatbuilding";
    DB_VERSION = 1;
    DB_STORE_NAME = "databases";
    DEFAULT_SEARCH_RADIUS = 0.10; // degrees (~11km at equator)
    MIN_HEIGHT_METERS = 30;
    MIN_LEVELS = 5;
    METERS_PER_LEVEL = 3;
    MAX_BUILDINGS_RETURNED = 20;

    constructor(latitude, longitude) {
        this.latitude = latitude;
        this.longitude = longitude;
        this.spl = null;
        this.databases = [];
        this.db = null;
    }

    async initialize() {
        // Initialize spl.js
        this.spl = await SPL();

        // Initialize IndexedDB
        await this.initIndexedDB();
    }

    async initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => {
                console.error("Failed to open IndexedDB:", request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log("IndexedDB opened successfully");
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create object store for databases if it doesn't exist
                if (!db.objectStoreNames.contains(this.DB_STORE_NAME)) {
                    const objectStore = db.createObjectStore(this.DB_STORE_NAME, { keyPath: "id" });
                    objectStore.createIndex("updated_at", "updated_at", { unique: false });
                    console.log("Created object store:", this.DB_STORE_NAME);
                }
            };
        });
    }

    async downloadManifest() {
        console.log("Downloading manifest from:", this.MANIFEST_URL);
        try {
            const response = await fetch(this.MANIFEST_URL);
            if (!response.ok) {
                throw new Error(`Failed to download manifest: ${response.statusText}`);
            }
            const manifest = await response.json();
            console.log("Manifest downloaded:", manifest);
            return manifest;
        } catch (error) {
            console.error("Error downloading manifest:", error);
            throw new Error(`Unable to download manifest from ${this.MANIFEST_URL}. The database may not be available yet.`);
        }
    }

    isLocationInBoundingBox(bbox) {
        return (
            this.latitude >= bbox.minLat &&
            this.latitude <= bbox.maxLat &&
            this.longitude >= bbox.minLon &&
            this.longitude <= bbox.maxLon
        );
    }

    identifyRelevantDatabases(manifest) {
        if (!manifest.regions) {
            console.warn("No regions found in manifest");
            return [];
        }

        const relevantRegions = manifest.regions.filter(region => {
            const inBox = this.isLocationInBoundingBox(region.bbox);
            if (inBox) {
                console.log(`User location is in region: ${region.id}`);
            }
            return inBox;
        });

        return relevantRegions;
    }

    async downloadAndCacheDatabase(dbInfo) {
        const dbUrl = `${this.R2_BASE_URL}${dbInfo.db.object}`;
        const cacheKey = dbInfo.id;

        console.log(`Checking IndexedDB for database: ${dbInfo.id}`);

        // Try to get from IndexedDB
        const cachedData = await this.getFromIndexedDB(cacheKey);
        let arrayBuffer;

        if (cachedData && cachedData.updated_at === dbInfo.updated_at) {
            console.log(`Database ${dbInfo.id} found in IndexedDB (updated: ${cachedData.updated_at})`);
            arrayBuffer = cachedData.data;
        } else {
            if (cachedData) {
                console.log(`Database ${dbInfo.id} is outdated, downloading new version`);
            } else {
                console.log(`Downloading database ${dbInfo.id} from ${dbUrl}`);
            }

            const response = await fetch(dbUrl);
            if (!response.ok) {
                throw new Error(`Failed to download database ${dbInfo.id}: ${response.statusText}`);
            }

            arrayBuffer = await response.arrayBuffer();

            // Store in IndexedDB
            await this.saveToIndexedDB({
                id: cacheKey,
                data: arrayBuffer,
                updated_at: dbInfo.updated_at,
                size: arrayBuffer.byteLength
            });
            console.log(`Database ${dbInfo.id} stored in IndexedDB (${arrayBuffer.byteLength} bytes)`);
        }

        console.log(`Creating database instance for ${dbInfo.id}, size: ${arrayBuffer.byteLength} bytes`);
        const db = this.spl.db(new Uint8Array(arrayBuffer));
        console.log(`Database instance created:`, db);

        return { region: dbInfo.id, db };
    }

    async getFromIndexedDB(key) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.DB_STORE_NAME], "readonly");
            const objectStore = transaction.objectStore(this.DB_STORE_NAME);
            const request = objectStore.get(key);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                console.error("Failed to read from IndexedDB:", request.error);
                reject(request.error);
            };
        });
    }

    async saveToIndexedDB(data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.DB_STORE_NAME], "readwrite");
            const objectStore = transaction.objectStore(this.DB_STORE_NAME);
            const request = objectStore.put(data);

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                console.error("Failed to write to IndexedDB:", request.error);
                reject(request.error);
            };
        });
    }

    async queryBuildingsInDatabase(db, maxDistance = this.DEFAULT_SEARCH_RADIUS) {
        const minLat = this.latitude - maxDistance;
        const maxLat = this.latitude + maxDistance;
        const minLon = this.longitude - maxDistance;
        const maxLon = this.longitude + maxDistance;

        const query = `
            SELECT name, type, height, levels, latitude, longitude
            FROM features
            WHERE latitude BETWEEN ? AND ?
              AND longitude BETWEEN ? AND ?
              AND (height > ? OR levels > ?)
            ORDER BY height DESC
        `;

        const results = [];
        try {
            console.log(`Executing query with bounds: lat(${minLat}, ${maxLat}), lon(${minLon}, ${maxLon})`);
            console.log(`Database object:`, db);
            console.log(`Database type:`, typeof db);
            console.log(`Database prepare method:`, typeof db.prepare);

            // spl.js/sql.js API is synchronous
            const stmt = db.prepare(query);
            stmt.bind([minLat, maxLat, minLon, maxLon, this.MIN_HEIGHT_METERS, this.MIN_LEVELS]);

            while (stmt.step()) {
                const row = stmt.getAsObject();
                results.push({
                    name: row.name || "Building",
                    height: row.height || (row.levels * this.METERS_PER_LEVEL) || 0,
                    lat: row.latitude,
                    lon: row.longitude,
                    type: row.type
                });
            }

            stmt.free();
            console.log(`Query returned ${results.length} buildings`);
        } catch (error) {
            console.error("Error querying database:", error);
            throw error;
        }

        return results;
    }

    bearingDegrees(position_lat, position_lon, building_lat, building_lon) {
        const toRad = deg => deg * Math.PI / 180;
        const toDeg = rad => rad * 180 / Math.PI;

        const φ1 = toRad(position_lat);
        const φ2 = toRad(building_lat);
        const Δλ = toRad(building_lon - position_lon);

        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x =
            Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

        return (toDeg(Math.atan2(y, x)) + 360) % 360;
    }

    async getBuildings() {
        await this.initialize();

        const manifest = await this.downloadManifest();
        const relevantRegions = this.identifyRelevantDatabases(manifest);

        if (relevantRegions.length === 0) {
            console.warn("No databases found for user location");
            return [];
        }

        // Download and cache relevant databases
        const dbPromises = relevantRegions.map(region =>
            this.downloadAndCacheDatabase(region)
        );
        this.databases = await Promise.all(dbPromises);

        // Query all databases and combine results
        let allBuildings = [];
        for (const { region, db } of this.databases) {
            console.log(`Querying database: ${region}`);
            const buildings = await this.queryBuildingsInDatabase(db);
            allBuildings = allBuildings.concat(buildings);
        }

        // Calculate bearings and sort by height
        const buildingsWithBearings = allBuildings.map(b => ({
            ...b,
            bearing: this.bearingDegrees(
                this.latitude,
                this.longitude,
                b.lat,
                b.lon
            )
        }));

        // Get top tallest buildings
        const topBuildings = buildingsWithBearings
            .sort((a, b) => b.height - a.height)
            .slice(0, this.MAX_BUILDINGS_RETURNED);

        console.log(`Found ${allBuildings.length} buildings total, returning top ${this.MAX_BUILDINGS_RETURNED}:`,
            topBuildings.map(b => `${b.name} (${b.height}m) @ ${b.bearing.toFixed(1)}°`).join(', '));

        return topBuildings;
    }

    async cleanup() {
        // Close all database connections
        for (const { db } of this.databases) {
            await db.close();
        }
        this.databases = [];
    }
}
