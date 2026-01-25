export class Buildings {
    DISTANCE = 0.10
    MAX_BUILDINGS = 15
    API_URL = "https://overpass-api.de/api/interpreter?data="

    constructor(latitude, longitude) {
        this.latitude = latitude
        this.longitude = longitude
    }

    get north() {
        return this.latitude + this.DISTANCE;
    }

    get south() {
        return this.latitude - this.DISTANCE;
    }

    get east() {
        return this.longitude + this.DISTANCE;
    }

    get west() {
        return this.longitude - this.DISTANCE;
    }

    get query() {
        return `
            [out:json][timeout:10];
            (
            way["building"]["height"~"^[1-9][0-9][0-9]"](${this.south},${this.west},${this.north},${this.east});
            relation["building"]["height"~"^[1-9][0-9][0-9]"](${this.south},${this.west},${this.north},${this.east});
            way["building"]["building:levels"~"^[3-9][0-9]"](${this.south},${this.west},${this.north},${this.east});
            );
            out center ${this.MAX_BUILDINGS};
        `
    }

    get url() {
        const encodedQuery = encodeURIComponent(this.query)
        return `${this.API_URL}${encodedQuery}`
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
        const response = await fetch(this.url);
        const data = await response.json();

        const buildings = data.elements
        .map(b => {
            const lat = b.center.lat;
            const lon = b.center.lon;

            const bearing = this.bearingDegrees(
                this.latitude,
                this.longitude,
                lat,
                lon
            );

            return {
                name: b.tags.name || "Building",
                height: parseFloat(b.tags.height || b.tags["building:levels"] * 3 || 0),
                lat,
                lon,
                bearing
            };
        })
        .sort((a, b) => b.height - a.height)
        .slice(0, this.MAX_BUILDINGS);

        console.log(`Found ${buildings.length} buildings:`,
            buildings.map(b => `${b.name} @ ${b.bearing.toFixed(1)}°`).join(', '));

        return buildings;
    }
}
