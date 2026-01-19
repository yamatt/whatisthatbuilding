// 1. Get user's current position
navigator.geolocation.getCurrentPosition((position) => {
    const { latitude, longitude } = position.coords;
    console.log("Location", latitude, longitude)
    fetchBuildings(latitude, longitude);
});

async function fetchBuildings(lat, lon) {
    // 2. Overpass API Query
    // Finds buildings with height data within 5km (5000m)
    const offset = 0.15;
    const south = lat - offset;
    const west = lon - offset;
    const north = lat + offset;
    const east = lon + offset;

    // 2. Query only for buildings with 3-digit heights (100m+)
    // or 2-digit levels starting with 3 or more (30+ floors)
    const query = `
        [out:json][timeout:10];
        (
        way["building"]["height"~"^[1-9][0-9][0-9]"](${south},${west},${north},${east});
        relation["building"]["height"~"^[1-9][0-9][0-9]"](${south},${west},${north},${east});
        way["building"]["building:levels"~"^[3-9][0-9]"](${south},${west},${north},${east});
        );
        out center 15;
    `;
    const url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);

    const response = await fetch(url);
    const data = await response.json();

    // 3. Filter for the "Tallest" (Sorting by OSM tags)
    const buildings = data.elements
        .map(b => ({
            name: b.tags.name || "Building",
            height: parseFloat(b.tags.height || b.tags["building:levels"] * 3 || 0),
            lat: b.center.lat,
            lon: b.center.lon
        }))
        .sort((a, b) => b.height - a.height)
        .slice(0, 5); // Take top 5 tallest
    console.log("Buildings", buildings.length, buildings)
    renderMarkers(buildings);
}

function renderMarkers(buildings) {
    const container = document.querySelector('#building-markers');

    buildings.forEach(b => {
        createMarker(b, container)
    });
}

function createMarker(building, container) {
    const entity = document.createElement('a-entity');
    entity.setAttribute('gps-entity-place', `latitude: ${building.lat}; longitude: ${building.lon};`);

    // Add a visual 3D label (a text box)
    entity.setAttribute('geometry', 'primitive: box; height: 10; width: 10; depth: 0.1');
    entity.setAttribute('material', 'color: #00FF00; shader: flat; opacity: 0.8');
    entity.setAttribute('text', `value: ${building.name}\n${building.height}m; align: center; width: 50;`);

    // Ensure it faces the user
    entity.setAttribute('look-at', '[gps-camera]');

    container.appendChild(entity);
}