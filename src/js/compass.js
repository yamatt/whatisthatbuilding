export class Compass {
    COMPASS_WEIGHT = 0.02;  // Low weight = trust gyro more for smoothness
    GYRO_WEIGHT = 0.98;
    GYRO_DEADZONE = 2; // Ignore rotation rates smaller than 2 deg/s to prevent drift

    constructor() {
        this.heading = 0;
        this.lastTimestamp = null;
        this.enabled = false;
        this.compassHeading = null;
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
            'deviceorientationabsolute',
            this.onOrientation.bind(this),
            true
        );
        window.addEventListener('deviceorientation', this.onOrientation.bind(this), true);

        // Listen for gyroscope events
        window.addEventListener('devicemotion', this.onMotion.bind(this), true);

        this.enabled = true;
    }

    onOrientation(event) {
        let newHeading;

        // Prefer true compass when available
        if (typeof event.webkitCompassHeading === 'number') {
            newHeading = event.webkitCompassHeading;
        }
        // Android absolute fallback
        else if (event.absolute === true && typeof event.alpha === 'number') {
            newHeading = (360 - event.alpha) % 360;
        }
        else {
            return;
        }

        // Correct for screen orientation
        const screenAngle =
            screen.orientation?.angle ??
            window.orientation ??
            0;

        newHeading = (newHeading + screenAngle + 360) % 360;

        this.compassHeading = newHeading;

        // Initialize heading on first compass reading
        if (this.heading === 0 && this.compassHeading !== null) {
            this.heading = this.compassHeading;
        }
    }

    onMotion(event) {
        if (!event.rotationRate || this.compassHeading === null) {
            return;
        }

        const now = performance.now();

        if (this.lastTimestamp === null) {
            this.lastTimestamp = now;
            return;
        }

        const dt = (now - this.lastTimestamp) / 1000; // Convert to seconds
        this.lastTimestamp = now;

        // Get rotation rate around vertical axis (alpha/z-axis)
        // Negative because clockwise rotation increases heading
        let gyroRate = -(event.rotationRate.alpha || 0);

        // Apply deadzone to prevent drift from sensor noise
        if (Math.abs(gyroRate) < this.GYRO_DEADZONE) {
            gyroRate = 0;
        }

        // Integrate gyroscope to get heading change
        const gyroHeading = (this.heading + gyroRate * dt + 360) % 360;

        // Fuse gyroscope with compass using complementary filter
        const delta = ((this.compassHeading - gyroHeading + 540) % 360) - 180;

        this.heading = (
            gyroHeading * this.GYRO_WEIGHT +
            (gyroHeading + delta) * this.COMPASS_WEIGHT +
            360
        ) % 360;
    }
}
