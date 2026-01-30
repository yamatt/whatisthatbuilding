import { Camera } from './camera.js';
import { Errors } from './errors.js';
import { DatabaseManager } from './database-manager.js';
import { Hud } from './hud.js';
import { Compass } from './compass.js';

window.addEventListener('DOMContentLoaded', async () => {

    const errors = new Errors("errors")

    const camera = new Camera("camera");
    camera.start();

    navigator.geolocation.getCurrentPosition(async (position) => {
        const latitude  = position.coords.latitude;
        const longitude = position.coords.longitude;

        console.log("Location", latitude, longitude);

        const compass = new Compass();
        await compass.start();

        try {
            const databaseManager = new DatabaseManager(latitude, longitude);
            const buildings = await databaseManager.getBuildings();
            const buildingsManager = databaseManager.buildingsManager;

            const hud = new Hud("hud", buildings, () => compass.heading, buildingsManager);

            hud.getHeading = () => compass.heading;

            hud.start();
        } catch (error) {
            console.error("Error loading buildings:", error);
            errors.addError(`Failed to load buildings: ${error.message}`);
        }
    });
});

