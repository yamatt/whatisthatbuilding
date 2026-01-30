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
            let buildings = await databaseManager.getBuildings();

            const hud = new Hud("hud", buildings, () => compass.heading, databaseManager, async (newRadius) => {
                console.log(`Radius changed to ${newRadius.toFixed(1)}km, re-fetching buildings...`);
                try {
                    buildings = await databaseManager.getBuildings();
                    hud.buildings = buildings;
                    hud.smoothedYPositions.clear(); // Reset smoothed positions
                } catch (error) {
                    console.error("Error re-fetching buildings:", error);
                    errors.addError(`Failed to update buildings: ${error.message}`);
                }
            });

            hud.getHeading = () => compass.heading;

            hud.start();
        } catch (error) {
            console.error("Error loading buildings:", error);
            errors.addError(`Failed to load buildings: ${error.message}`);
        }
    });
});

