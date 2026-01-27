import SPL from 'spl.js';

export class DatabaseManager {
    MANIFEST_URL = "https://pub-6c56489c6f02474bafaba0f1b7bb961d.r2.dev/manifest.json";
    R2_BASE_URL = "https://pub-6c56489c6f02474bafaba0f1b7bb961d.r2.dev/";
    CACHE_NAME = "whatisthatbuilding-db-v1";
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
    }

    async initialize() {
        // Initialize spl.js
        this.spl = await SPL();
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
        const cache = await caches.open(this.CACHE_NAME);

        console.log(`Checking cache for database: ${dbInfo.id}`);
        let response = await cache.match(dbUrl);

        if (!response) {
            console.log(`Downloading database ${dbInfo.id} from ${dbUrl}`);
            response = await fetch(dbUrl);
            if (!response.ok) {
                throw new Error(`Failed to download database ${dbInfo.id}: ${response.statusText}`);
            }

            // Cache the response for future use
            await cache.put(dbUrl, response.clone());
            console.log(`Database ${dbInfo.id} cached successfully`);
        } else {
            console.log(`Database ${dbInfo.id} found in cache`);
        }

        const arrayBuffer = await response.arrayBuffer();
        console.log(`Creating database instance for ${dbInfo.id}, size: ${arrayBuffer.byteLength} bytes`);
        const sqliteDb = this.spl.db(new Uint8Array(arrayBuffer));
        console.log(`Database instance created:`, sqliteDb);

        return { region: dbInfo.id, db: sqliteDb };
    }

    async queryBuildingsInDatabase(db, maxDistance = this.DEFAULT_SEARCH_RADIUS) {
        // Use a larger bounding box to fetch candidates, then filter by distance
        const searchRadius = maxDistance * 1.5; // Get extra candidates to account for diagonal distance
        const minLat = this.latitude - searchRadius;
        const maxLat = this.latitude + searchRadius;
        const minLon = this.longitude - searchRadius;
        const maxLon = this.longitude + searchRadius;

        const query = `
            SELECT name, type, height, levels, latitude, longitude
            FROM features
            WHERE latitude BETWEEN ? AND ?
              AND longitude BETWEEN ? AND ?
              AND (height > ? OR levels > ?)
        `;

        const results = [];
        try {
            console.log(`Executing query with bounds: lat(${minLat}, ${maxLat}), lon(${minLon}, ${maxLon})`);
            console.log(`Filtering for radius: ${maxDistance} degrees`);
            console.log(`Database object:`, db);
            console.log(`Database type:`, typeof db);
            console.log(`Database prepare method:`, typeof db.prepare);

            // spl.js/sql.js API is synchronous
            const stmt = db.prepare(query);
            stmt.bind([minLat, maxLat, minLon, maxLon, this.MIN_HEIGHT_METERS, this.MIN_LEVELS]);

            while (stmt.step()) {
                const row = stmt.getAsObject();

                // Calculate actual distance from user location
                const distance = this.calculateDistance(
                    this.latitude,
                    this.longitude,
                    row.latitude,
                    row.longitude
                );

                // Only include if within radius
                if (distance <= maxDistance) {
                    results.push({
                        name: row.name || "Building",
                        height: row.height || (row.levels * this.METERS_PER_LEVEL) || 0,
                        lat: row.latitude,
                        lon: row.longitude,
                        type: row.type,
                        distance: distance
                    });
                }
            }

            stmt.free();
            console.log(`Query returned ${results.length} buildings within radius`);
        } catch (error) {
            console.error("Error querying database:", error);
            throw error;
        }

        return results;
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        // Haversine formula to calculate distance between two points on Earth
        const R = 6371; // Earth's radius in kilometers
        const toRad = deg => deg * Math.PI / 180;

        const φ1 = toRad(lat1);
        const φ2 = toRad(lat2);
        const Δφ = toRad(lat2 - lat1);
        const Δλ = toRad(lon2 - lon1);

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        // Convert to degrees (approximate)
        return distance / 111; // 1 degree ≈ 111 km
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
