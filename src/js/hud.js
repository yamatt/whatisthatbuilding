export class Hud {
    FOV_DEGREES = 60;
    HEADING_DEADZONE = 5; // Ignore changes smaller than 2 degrees
    HEADING_SMOOTHING = 0.3; // Smooth heading updates (0 = no smoothing, 1 = instant)
    Y_POSITION_SMOOTHING = 0.15; // Smooth y position updates

    constructor(canvas_id, buildings, getHeading, buildingsManager, onRadiusChange) {
        this.canvas_id = canvas_id;
        this.buildings = buildings;
        this.getHeading = getHeading;
        this.buildingsManager = buildingsManager;
        this.onRadiusChange = onRadiusChange;
        this.smoothedHeading = 0;
        this.lastRawHeading = 0;
        this.smoothedYPositions = new Map(); // Track smoothed y positions per building
        this.manualHeadingOffset = 0; // Manual adjustment from swipe gestures
        this.touchStartX = null;
        this.touchStartY = null;
        this.touchStartOffset = 0;
        this.touchStartRadius = 0;
        this.swipeDirection = null; // 'horizontal' or 'vertical'
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

        const heading = this.getSmoothedHeading() + this.manualHeadingOffset;

        // Draw radius in top left
        this.drawRadiusDisplay();

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
            const targetY = screenTop + (availableHeight / (visibleBuildings.length + 1)) * (index + 1);

            // Get smoothed y position for this building
            const buildingId = `${item.building.lat},${item.building.lon}`;
            const currentY = this.smoothedYPositions.get(buildingId) ?? targetY;

            // Smooth the y position transition
            const smoothedY = currentY + (targetY - currentY) * this.Y_POSITION_SMOOTHING;
            this.smoothedYPositions.set(buildingId, smoothedY);

            this.drawMarker(item.building, item.x, smoothedY);
        });

        // Clean up y positions for buildings no longer visible
        const visibleIds = new Set(visibleBuildings.map(item => `${item.building.lat},${item.building.lon}`));
        for (const id of this.smoothedYPositions.keys()) {
            if (!visibleIds.has(id)) {
                this.smoothedYPositions.delete(id);
            }
        }

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

    drawRadiusDisplay() {
        if (!this.buildingsManager) return;

        const radiusMeters = this.buildingsManager.DEFAULT_SEARCH_RADIUS * 1000;
        const radiusText = radiusMeters >= 1000
            ? `${(radiusMeters / 1000).toFixed(1)}km`
            : `${Math.round(radiusMeters)}m`;

        this.context.fillStyle = 'white';
        this.context.font = '14px sans-serif';
        this.context.textAlign = 'left';
        this.context.fillText(`Radius: ${radiusText}`, 10, 20);
    }

    drawMarker(building, x, y) {
        this.context.globalAlpha = 1;

        // Draw background box (adjust for 3 lines if we have distance)
        const hasHeight = building.height && building.height > 0;
        const hasDistance = building.distance !== undefined;
        const lineCount = (hasHeight ? 1 : 0) + 1 + (hasDistance ? 1 : 0);
        const boxHeight = Math.max(48, lineCount * 20 + 8);

        this.context.fillStyle = 'rgba(0,0,0,0.6)';
        this.context.fillRect(x - 60, y - boxHeight / 2, 120, boxHeight);

        this.context.fillStyle = 'white';
        this.context.font = '16px sans-serif';
        this.context.textAlign = 'center';

        // Draw height on first line if available
        let textY = y - (lineCount - 1) * 10;
        if (hasHeight) {
            this.context.fillText(`${Math.round(building.height)}m`, x, textY);
            textY += 16;
        }

        // Draw building name
        this.context.fillText(building.name, x, textY);
        textY += 16;

        // Draw distance if available
        if (hasDistance) {
            const distanceText = building.distance < 1
                ? `${(building.distance * 1000).toFixed(0)}m`
                : `${building.distance.toFixed(2)}km`;
            this.context.fillText(distanceText, x, textY);
        }
    }

    start() {
        this.resize()
        window.addEventListener('resize', () => this.resize());
        this.setupTouchHandlers();
        this.draw();
    }

    setupTouchHandlers() {
        this.canvas.addEventListener('touchstart', (e) => {
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
            this.touchStartOffset = this.manualHeadingOffset;
            this.touchStartRadius = this.buildingsManager.DEFAULT_SEARCH_RADIUS;
            this.swipeDirection = null;
        });

        this.canvas.addEventListener('touchmove', (e) => {
            if (this.touchStartX === null || this.touchStartY === null) return;
            e.preventDefault();

            const touchX = e.touches[0].clientX;
            const touchY = e.touches[0].clientY;
            const deltaX = touchX - this.touchStartX;
            const deltaY = touchY - this.touchStartY;

            // Determine swipe direction if not yet determined
            if (!this.swipeDirection) {
                if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
                    this.swipeDirection = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
                }
            }

            if (this.swipeDirection === 'horizontal') {
                // Horizontal swipe - adjust heading offset
                const pixelsPerDegree = window.innerWidth / this.FOV_DEGREES;
                const degreesOffset = deltaX / pixelsPerDegree;
                this.manualHeadingOffset = this.touchStartOffset + degreesOffset;
            } else if (this.swipeDirection === 'vertical') {
                // Vertical swipe - adjust radius
                // Swipe down = increase radius, swipe up = decrease radius
                const radiusChangePerPixel = 0.05; // 50m per pixel
                const radiusChange = -deltaY * radiusChangePerPixel; // negative because down is positive Y
                const newRadius = Math.max(1, Math.min(100, this.touchStartRadius + radiusChange));
                this.buildingsManager.DEFAULT_SEARCH_RADIUS = newRadius;
            }
        });

        this.canvas.addEventListener('touchend', (e) => {
            // Check if this was a tap (no swipe direction determined)
            if (!this.swipeDirection) {
                // Reset manual heading offset on tap
                this.manualHeadingOffset = 0;
                console.log('Manual heading offset reset');
            } else if (this.swipeDirection === 'vertical' && this.onRadiusChange) {
                // If vertical swipe ended, trigger re-fetch
                this.onRadiusChange(this.buildingsManager.DEFAULT_SEARCH_RADIUS);
            }
            this.touchStartX = null;
            this.touchStartY = null;
            this.swipeDirection = null;
        });

        this.canvas.addEventListener('touchcancel', () => {
            this.touchStartX = null;
            this.touchStartY = null;
            this.swipeDirection = null;
        });
    }
}
