import SPL from 'spl.js';

export class DatabaseManager {
    MANIFEST_URL = "https://pub-6c56489c6f02474bafaba0f1b7bb961d.r2.dev/manifest.json";
    R2_BASE_URL = "https://pub-6c56489c6f02474bafaba0f1b7bb961d.r2.dev/";
    CACHE_NAME = "whatisthatbuilding-db-v1";
    DEFAULT_SEARCH_RADIUS = 25; // kilometers (~15 miles)
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
        console.log(`Loading database ${dbInfo.id}, size: ${arrayBuffer.byteLength} bytes`);

        // Create database from ArrayBuffer using spl.js
        const sqliteDb = await this.spl.db(arrayBuffer);
        console.log(`Database ${dbInfo.id} loaded successfully`);

        return { region: dbInfo.id, db: sqliteDb };
    }

    async queryBuildingsInDatabase(db, maxDistance = this.DEFAULT_SEARCH_RADIUS) {
        // Convert distance from km to degrees for bounding box (approximate)
        const searchRadiusDegrees = (maxDistance / 111) * 2;
        const minLat = this.latitude - searchRadiusDegrees;
        const maxLat = this.latitude + searchRadiusDegrees;
        const minLon = this.longitude - searchRadiusDegrees;
        const maxLon = this.longitude + searchRadiusDegrees;

        const results = [];
        try {
            console.log(`Querying database for location: (${this.latitude}, ${this.longitude}), radius: ${maxDistance} km`);

            // Query with actual location bounds
            const query = `SELECT name, type, height, latitude, longitude FROM features WHERE latitude > ${minLat} AND latitude < ${maxLat} AND longitude > ${minLon} AND longitude < ${maxLon} AND height > ${this.MIN_HEIGHT_METERS}`;

            const queryResult = await db.exec(query).get.rows;

            // Process results if any
            if (queryResult && queryResult.length > 0) {
                for (const row of queryResult) {
                    const building = {
                        name: row[0] || "Building",
                        type: row[1],
                        height: row[2],
                        lat: row[3],
                        lon: row[4]
                    };

                    // Calculate actual distance from user location (in kilometers)
                    const distance = this.calculateDistance(
                        this.latitude,
                        this.longitude,
                        building.lat,
                        building.lon
                    );

                    // Only include if within radius
                    if (distance <= maxDistance) {
                        results.push({
                            name: building.name,
                            height: building.height || 0,
                            lat: building.lat,
                            lon: building.lon,
                            type: building.type,
                            distance: distance
                        });
                    }
                }
            }

            console.log(`Found ${results.length} buildings within ${maxDistance} km`);
        } catch (error) {
            console.error("Error querying database:", error);
            throw error;
        }

        return results;
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        // Haversine formula to calculate distance between two points on Earth (returns kilometers)
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

        return distance; // Distance in kilometers
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
