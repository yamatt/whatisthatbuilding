class Hud {
    FOV_DEGREES = 60;

    constructor(canvas_id, buildings) {
        this.canvas_id = canvas_id
        this.buildings = buildings;
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
        thiscanvas.height = window.innerHeight * dpr;

        this.canvas.style.width  = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';

        this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    draw() {
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.buildings.forEach(building => this.drawMarker(building));
        requestAnimationFrame(draw);
    }

    get screenCenterX () {
        return window.innerWidth / 2;
    }

    get screenCenterY () {
        return window.innerHeight / 2;
    }

    drawMarker(building) {
        building.relativeBearing = ((building.bearing - smoothedHeading + 540) % 360) - 180;

        const x = this.screenCenterX + building.screenOffsetX;
        const y = this.screenCenterY - 40;

        this.context.globalAlpha = building.alpha;

        this.context.fillStyle = 'rgba(0,0,0,0.6)';
        this.context.fillRect(x - 60, y - 24, 120, 32);

        this.context.fillStyle = 'white';
        this.context.font = '16px sans-serif';
        this.context.textAlign = 'center';
        this.context.fillText(b.name, x, y);
    }

    start() {
        this.resize()
        window.addEventListener('resize', resize);
    }
}

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

    async getBuildings() {
        const response = await fetch(this.url);
        const data = await response.json();

        const buildings = data.elements
        .map(b => ({
            name: b.tags.name || "Building",
            height: parseFloat(b.tags.height || b.tags["building:levels"] * 3 || 0),
            lat: b.center.lat,
            lon: b.center.lon
        }))
        .sort((a, b) => b.height - a.height)
        .slice(0, 5);

        return buildings;
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    const camera = new Camera("camera");
    camera.start();

    const { latitude, longitude } = (null, null)

    navigator.geolocation.getCurrentPosition((position) => {
        latitude = position.coords[0];
        longitude = position.coords[1];
    });

    console.log("Location", latitude, longitude)

    const buildingQuery = new Buildings(latitude, longitude);
    const buildings = await buildingQuery.getBuildings();

    const hud = new Hud("hud", buildings);
    hud.start();
});

