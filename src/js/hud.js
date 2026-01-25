export class Hud {
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

        // Debug: Log every 60 frames (roughly once per second at 60fps)
        if (Math.random() < 0.016 && building.name !== "Building") {
            console.log(`${building.name}: bearing=${building.bearing.toFixed(1)}° heading=${heading.toFixed(1)}° relative=${relativeBearing.toFixed(1)}°`);
        }

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
