class Camera {
    CONSTRAINTS = {
        video: { facingMode: 'environment' }
    }

    constructor(el_id) {
        this.el_id = el_id
    }

    get el() {
        return document.getElementById(this.el_id);
    }

    async start() {
        const stream = await navigator.mediaDevices.getUserMedia(this.CONSTRAINTS);
        this.el.srcObject = stream;
        this.el.play();
    }
}

class Buildings {
    OFFSET = 0.15
    API_URL = "https://overpass-api.de/api/interpreter?data="

    constructor(latitude, longitude) {
        this.latitude = latitude
        this.longitude = longitude
    }

    get north() {
        return this.latitude + this.OFFSET;
    }

    get south() {
        return this.latitude - this.OFFSET;
    }

    get east() {
        return this.longitude + this.OFFSET;
    }

    get west() {
        return this.longitude - this.OFFSET;
    }

    get query() {
        return `
            [out:json][timeout:10];
            (
            way["building"]["height"~"^[1-9][0-9][0-9]"](${this.south},${this.west},${this.north},${this.east});
            relation["building"]["height"~"^[1-9][0-9][0-9]"](${this.south},${this.west},${this.north},${this.east});
            way["building"]["building:levels"~"^[3-9][0-9]"](${this.south},${this.west},${this.north},${this.east});
            );
            out center 15;
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

            return {
                name: b.tags.name || "Building",
                height: parseFloat(b.tags.height || b.tags["building:levels"] * 3 || 0),
                lat,
                lon,
                bearing: this.bearingDegrees(
                    this.latitude,
                    this.longitude,
                    lat,
                    lon
                )
            };
        })
        .sort((a, b) => b.height - a.height)
        .slice(0, 5);

        return buildings;
    }
}

class Hud {
    FOV_DEGREES = 60;

    constructor(canvas_id, buildings, getHeading) {
        this.canvas_id = canvas_id;
        this.buildings = buildings;
        this.getHeading = getHeading;
    }

    get canvas() {
        return document.getElementById(this.canvas_id);
    }

    get context() {
        return this.canvas.getContext('2d');
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width  = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;

        this.canvas.style.width  = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';

        this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    draw() {
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.buildings.forEach((building, i) => this.drawMarker(building, i));
        requestAnimationFrame(() => this.draw());
    }

    get screenCenterX () {
        return window.innerWidth / 2;
    }

    get screenCenterY () {
        return window.innerHeight / 2;
    }

    drawMarker(building) {
        const heading = this.getHeading ? this.getHeading() : 0;

        const relativeBearing =
            ((building.bearing - heading + 540) % 360) - 180;

        // Outside field of view → don't draw
        if (Math.abs(relativeBearing) > this.FOV_DEGREES / 2) {
            return;
        }

        const pixelsPerDegree = window.innerWidth / this.FOV_DEGREES;
        const x =
            this.screenCenterX + relativeBearing * pixelsPerDegree;
        const y = this.screenCenterY - 40;

        this.context.globalAlpha = 1;

        this.context.fillStyle = 'rgba(0,0,0,0.6)';
        this.context.fillRect(x - 60, y - 24, 120, 32);

        this.context.fillStyle = 'white';
        this.context.font = '16px sans-serif';
        this.context.textAlign = 'center';
        this.context.fillText(building.name, x, y);
    }

    start() {
        this.resize()
        window.addEventListener('resize', () => this.resize());
        this.draw();
    }
}

class Compass {
    SMOOTHING = 0.1;

    constructor() {
        this.heading = 0;
        this.alpha = 0;
        this.enabled = false;
    }

    async start() {
        if (
            typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function'
        ) {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission !== 'granted') {
                return;
            }
        }

        window.addEventListener(
            'deviceorientation',
            this.onOrientation.bind(this),
            true
        );

        this.enabled = true;
    }

    onOrientation(event) {
        let newHeading;

        if (typeof event.webkitCompassHeading === 'number') {
            newHeading = event.webkitCompassHeading;
        } else if (typeof event.alpha === 'number') {
            newHeading = 360 - event.alpha;
        } else {
            return;
        }

        const delta =
            ((newHeading - this.heading + 540) % 360) - 180;

        this.heading =
            (this.heading + delta * this.SMOOTHING + 360) % 360;
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    const camera = new Camera("camera");
    camera.start();

    navigator.geolocation.getCurrentPosition(async (position) => {
        const latitude  = position.coords.latitude;
        const longitude = position.coords.longitude;

        console.log("Location", latitude, longitude);

        const compass = new Compass();
        await compass.start();

        const buildingQuery = new Buildings(latitude, longitude);
        const buildings = await buildingQuery.getBuildings();

        const hud = new Hud("hud", buildings, () => compass.heading);

        hud.getHeading = () => compass.heading;

        hud.start();
    });
});

