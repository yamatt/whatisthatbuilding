import { Camera } from './camera.js';
import { Errors } from './errors.js';
import { Buildings } from './buildings.js';
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

        const buildingQuery = new Buildings(latitude, longitude);
        const buildings = await buildingQuery.getBuildings();

        const hud = new Hud("hud", buildings, () => compass.heading);

        hud.getHeading = () => compass.heading;

        hud.start();
    });
});

