export class Hud {
    FOV_DEGREES = 60;
    HEADING_DEADZONE = 2; // Ignore changes smaller than 2 degrees
    HEADING_SMOOTHING = 0.3; // Smooth heading updates (0 = no smoothing, 1 = instant)

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

        const heading = this.getSmoothedHeading();

        // Collect visible buildings with their x positions
        const visibleBuildings = [];
        this.buildings.forEach((building, i) => {
            const relativeBearing =
                ((building.bearing - heading + 540) % 360) - 180;

            // Check if in field of view
            if (Math.abs(relativeBearing) <= this.FOV_DEGREES / 2) {
                const pixelsPerDegree = window.innerWidth / this.FOV_DEGREES;
                const x = this.screenCenterX + relativeBearing * pixelsPerDegree;
                visibleBuildings.push({ building, x });
            }
        });

        // Sort by height (tallest first) to position them top to bottom
        visibleBuildings.sort((a, b) => (b.building.height || 0) - (a.building.height || 0));

        // Assign y positions across middle 50% of screen
        const screenTop = window.innerHeight * 0.25;
        const screenBottom = window.innerHeight * 0.75;
        const availableHeight = screenBottom - screenTop;

        visibleBuildings.forEach((item, index) => {
            const y = screenTop + (availableHeight / (visibleBuildings.length + 1)) * (index + 1);
            this.drawMarker(item.building, item.x, y);
        });

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

    drawMarker(building, x, y) {
        this.context.globalAlpha = 1;

        // Draw background box (taller for two lines)
        this.context.fillStyle = 'rgba(0,0,0,0.6)';
        this.context.fillRect(x - 60, y - 32, 120, 48);

        this.context.fillStyle = 'white';
        this.context.font = '16px sans-serif';
        this.context.textAlign = 'center';

        // Draw height on first line if available
        if (building.height && building.height > 0) {
            this.context.fillText(`${Math.round(building.height)}m`, x, y - 8);
            this.context.fillText(building.name, x, y + 12);
        } else {
            this.context.fillText(building.name, x, y);
        }
    }

    start() {
        this.resize()
        window.addEventListener('resize', () => this.resize());
        this.draw();
    }
}
