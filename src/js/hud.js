export class Hud {
    FOV_DEGREES = 60;
    HEADING_DEADZONE = 2; // Ignore changes smaller than 2 degrees
    HEADING_SMOOTHING = 0.15; // Smooth heading updates (0 = no smoothing, 1 = instant)

    constructor(canvas_id, buildings, getHeading) {
        this.canvas_id = canvas_id;
        this.buildings = buildings;
        this.getHeading = getHeading;
        this.smoothedHeading = 0;
        this.lastRawHeading = 0;
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

    getSmoothedHeading() {
        const rawHeading = this.getHeading ? this.getHeading() : 0;

        // Calculate shortest angular distance
        let delta = ((rawHeading - this.lastRawHeading + 540) % 360) - 180;

        // Apply deadzone - ignore small changes
        if (Math.abs(delta) < this.HEADING_DEADZONE) {
            return this.smoothedHeading;
        }

        // Smooth the heading using exponential moving average
        delta = ((rawHeading - this.smoothedHeading + 540) % 360) - 180;
        this.smoothedHeading = (this.smoothedHeading + delta * this.HEADING_SMOOTHING + 360) % 360;
        this.lastRawHeading = rawHeading;

        return this.smoothedHeading;
    }

    drawMarker(building) {
        const heading = this.getSmoothedHeading();

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
