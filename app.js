const map = L.map('map', {
  scrollWheelZoom: true,
  wheelPxPerZoomLevel: 80, // slower wheel zoom
  zoomSnap: 0.25,           // smoother fractional zoom
  zoomDelta: 0.25
});

let CartoDB_Positron = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
	attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
	subdomains: 'abcd',
	maxZoom: 20
}).addTo(map);

let CartoDB_DarkMatter = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
	attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
	subdomains: 'abcd',
	maxZoom: 20
}).addTo(map);

// Hospital icon with adaptive sizing based on zoom level
function getHospitalIcon(zoom) {
  const sizes = {
    6: 20,
    8: 24,
    10: 28,
    12: 32,
    14: 36,
    16: 40,
    18: 48,
    20: 56
  };
  
  // Find appropriate size for current zoom
  let size = 24; // default
  for (const [z, s] of Object.entries(sizes)) {
    if (zoom <= parseInt(z)) {
      size = s;
      break;
    }
  }
  
  return L.icon({
    iconUrl: './data/hospital.png',
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size]
  });
}

var hospitalIcon = getHospitalIcon(map.getZoom());

const disabledHospitals = new Set();

const timeClasses = [
  { label: "Ei voitu laskea" },
  { label: "0–15 min" },
  { label: "15–30 min" },
  { label: "30–45 min" },
  { label: "45–60 min" },
  { label: "60–90 min" },
  { label: "90–120 min" },
  { label: "120–180 min" },
  { label: "180+ min" }
];

let gridData = null;
let hospitalsData = null;
let vaestoruudukkoData = null;
let gridLayer = null;
let hospitalLayer = null;
let vaestoruudukkoLayer = null;
let plus65Layer = null;
let hvaBoundsData = null;
let hvaLayer = null;

const hospitalMarkersById = new Map();

const activeCountEl = document.getElementById("activeCount");
const avgTimeEl = document.getElementById("avgTime");
const hospitalListEl = document.getElementById("hospitalList");
const resetBtn = document.getElementById("resetBtn");

// Normalizes an ID value to a string or null
function normalizeId(value) {
  return value == null ? null : String(Math.floor(Number(value)));
}

// Gets the current travel time from properties, considering disabled hospitals
function getCurrentTravelTime(props) {
  for (let i = 1; i <= 5; i++) {
    const hospitalId = normalizeId(props[`hospital_${i}`]);
    const time = Number(props[`time_${i}`]);

    if (!hospitalId) continue;
    if (!Number.isFinite(time)) continue;
    if (!disabledHospitals.has(hospitalId)) {
      return time;
    }
  }
  return null;
}

// Gets the current hospital ID from properties
function getCurrentHospitalId(props) {
  for (let i = 1; i <= 5; i++) {
    const hospitalId = normalizeId(props[`hospital_${i}`]);
    const time = Number(props[`time_${i}`]);

    if (!hospitalId) continue;
    if (!Number.isFinite(time)) continue;
    if (!disabledHospitals.has(hospitalId)) {
      return hospitalId;
    }
  }
  return null;
}

// Gets the current hospital name from properties
function getCurrentHospitalName(props) {
  for (let i = 1; i <= 5; i++) {
    const hospitalId = normalizeId(props[`hospital_${i}`]);
    const time = Number(props[`time_${i}`]);
    const name = props[`name_${i}`];

    if (!hospitalId) continue;
    if (!Number.isFinite(time)) continue;
    if (!disabledHospitals.has(hospitalId)) {
      return name ?? hospitalId;
    }
  }
  return null;
}

// Returns a color based on travel time
function getColor(time) {
  if (time === null) return "#ffffff";
  if (time === 0) return "#ffffff";
  if (time <= 15) return "#9dff00";
  if (time <= 30) return "#d0ff00";
  if (time <= 45) return "#fffb00";
  if (time <= 60) return "#ffc400";
  if (time <= 90) return "#ff9900";
  if (time <= 120) return "#ff6600";
  if (time <= 180) return "#ff5100";
  return "#ff0000";
}

// Styles the grid feature based on travel time
function styleGridFeature(feature) {
  const time = getCurrentTravelTime(feature.properties);
  return {
    fillColor: getColor(time),
    weight: 0.3,
    opacity: 0.4,
    color: "#666",
    fillOpacity: 0.6
  };
}

// Returns a graduated color for vaestoruudukko values
// Lower population values get lighter blue fills, higher values get darker blue.
function getVaestoColor(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "#ffffff";
  value = Number(value);
  return value > 500 ? "#ff0000"
       : value > 100 ? "#ff2600"
       : value > 50 ? "#ff7300"
       : value > 30 ? "#ffae00"
       : value > 20 ? "#eaff00"
       : value > 15 ? "#fbff05"
       : value > 10 ? "#b7ff00"
       : value > 7  ? "#1aff00"
       : value > 5  ? "#62ff87"
       : value > 3  ? "#79ffb8"
       : value >= 2   ? "#9fecff"
       : value >= 1   ? "#00aeff"
       : value > 0   ? "#ffffff"
       : "#ffffff";
}

// Applies the population-based style to each vaestoruudukko polygon
function styleVaestoruudukkoFeature(feature) {
  const vaesto = feature.properties.vaesto ?? feature.properties.population;
  return {
    fillColor: getVaestoColor(vaesto),
    weight: 1,
    opacity: 0,
    color: "#ffffff",
    fillOpacity: 0.8
  };
}

// Attaches a simple tooltip to each vaestoruudukko feature showing the population value
function onEachVaestoruudukkoFeature(feature, layer) {
  const vaesto = feature.properties.vaesto ?? feature.properties.population ?? 0;
  layer.bindTooltip(`Väestö: ${vaesto.toLocaleString()}`, {
    sticky: true,
    className: "grid-tooltip"
  });
}

// Returns a color for 65+ population percentage, with higher percentages getting darker red fills
function get65PlusColor(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "#ffffff";
  value = Number(value);
  return value > 80 ? "#ff0000"
      : value > 60 ? "#ff8800"
      : value > 40 ? "#f2ff00"
      : value > 20 ? "#77ff00"
      : value > 0 ? "#04ff00"
      : "#ffffff";
}

// Styles the feature based on the percentage of 65+ population. Higher percentages get darker red fills.
function style65PlusFeature(feature) {
  const vaesto = feature.properties.vaesto ?? 0;
  const plus65 = feature.properties.ika_65_ ?? 0;
  const percentage = vaesto > 0 ? (plus65 / vaesto * 100) : 0;
  return {
    fillColor: get65PlusColor(percentage),
    weight: 1,
    opacity: 0,
    color: "#ffffff",
    fillOpacity: 0.8
  };
}

// Attaches a tooltip to each feature showing the population, 65+ count, and percentage of 65+ in the population
function onEach65PlusFeature(feature, layer) {
  const vaesto = feature.properties.vaesto ?? 0;
  const plus65 = feature.properties.ika_65_ ?? 0;
  layer.bindTooltip(`Väestö: ${vaesto.toLocaleString()}<br>65+: ${plus65.toLocaleString()} (${vaesto > 0 ? (plus65 / vaesto * 100).toFixed(1) : "0.0"}%)`, {
    sticky: true,
    className: "grid-tooltip"
  });
}

// show/hide legend sections based on which layers are currently visible
function updateLegend() {
  const visible = new Set();
  if (map.hasLayer(gridLayer)) visible.add("Saavutettavuuskartta");
  if (map.hasLayer(vaestoruudukkoLayer)) visible.add("Väestöruudukko");
  if (map.hasLayer(plus65Layer)) visible.add("Yli 65-vuotiaiden osuus");

  document.querySelectorAll(".legend-section").forEach(section => {
    const layerName = section.dataset.layer;
    section.style.display = visible.has(layerName) ? "block" : "none";
  });
}

// Generates HTML for tooltips
function tooltipHtml(props) {
  const time = getCurrentTravelTime(props);
  const hospitalName = getCurrentHospitalName(props);
  const gridId = props.grid_id ?? "-";
  const population = props.population ?? props.vaesto ?? "-";

  if (time === null || time === 0) {
    return `
      <div>
        <strong>Postinumero: </strong> ${gridId}<br>
        <strong>Väkiluku: </strong> ${population}<br>
        <strong>Matka-aika: </strong> Laskenta epäonnistui
      </div>
    `;
  }

  return `
    <div>
      <strong>Postinumero: </strong> ${gridId}<br>
      <strong>Väkiluku: </strong> ${population}<br>
      <strong>Sairaala: </strong> ${hospitalName}<br>
      <strong>Matka-aika: </strong> ${time.toFixed(1)} min
    </div>
  `;
}

// Binds tooltip to grid features
function onEachGridFeature(feature, layer) {
  layer.bindTooltip(tooltipHtml(feature.properties), {
    sticky: true,
    className: "grid-tooltip"
  });
}

// Updates styles of grid layers
function updateGridStyles() {
  if (!gridLayer) return;

  gridLayer.eachLayer(layer => {
    layer.setStyle(styleGridFeature(layer.feature));
    layer.setTooltipContent(tooltipHtml(layer.feature.properties));
  });
}

// Updates opacity of hospital markers based on disabled status
function updateHospitalMarkers() {
  for (const feature of hospitalsData.features) {
    const hospitalId = normalizeId(feature.properties.hospital_id);
    const marker = hospitalMarkersById.get(hospitalId);
    if (!marker) continue;

    const disabled = disabledHospitals.has(hospitalId);
    marker.setOpacity(disabled ? 0.4 : 1.0);
  }
}

// Updates the hospital list UI
function updateHospitalList() {
  hospitalListEl.innerHTML = "";

  const features = [...hospitalsData.features].sort((a, b) => {
    const nameA = (a.properties.name ?? "").toLowerCase();
    const nameB = (b.properties.name ?? "").toLowerCase();
    return nameA.localeCompare(nameB);
  });

  for (const feature of features) {
    const hospitalId = normalizeId(feature.properties.hospital_id);
    const name = feature.properties.name ?? hospitalId;
    const disabled = disabledHospitals.has(hospitalId);

    const row = document.createElement("div");
    row.className = `hospital-item ${disabled ? "disabled" : ""}`;

    const label = document.createElement("label");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !disabled;
    checkbox.addEventListener("change", () => toggleHospital(hospitalId));

    const text = document.createElement("span");
    text.textContent = name;

    label.appendChild(checkbox);
    label.appendChild(text);
    row.appendChild(label);

    hospitalListEl.appendChild(row);
  }
}

// Updates statistics like active count and average time
function updateStats() {
  const total = hospitalsData.features.length;
  activeCountEl.textContent = String(total - disabledHospitals.size);

  let sum = 0;
  let count = 0;

  for (const feature of gridData.features) {
    const time = getCurrentTravelTime(feature.properties);
    if (time !== null) {
      sum += time;
      count += 1;
    }
  }

  avgTimeEl.textContent = count > 0 ? (sum / count).toFixed(1) : "-";
}

// Updates the population table with time classes
function updatePopulationTable() {
  let totalPopulation = 0;
  for (const feature of gridData.features) {
    const pop = feature.properties.population || feature.properties.vaesto || 0;
    totalPopulation += pop;
  }

  const classCounts = new Array(timeClasses.length).fill(0);

  for (const feature of gridData.features) {
    const time = getCurrentTravelTime(feature.properties);
    const pop = feature.properties.population || feature.properties.vaesto || 0;

    if (time === null || time === 0) {
      classCounts[0] += pop;
    } else if (time <= 15) {
      classCounts[1] += pop;
    } else if (time <= 30) {
      classCounts[2] += pop;
    } else if (time <= 45) {
      classCounts[3] += pop;
    } else if (time <= 60) {
      classCounts[4] += pop;
    } else if (time <= 90) {
      classCounts[5] += pop;
    } else if (time <= 120) {
      classCounts[6] += pop;
    } else if (time <= 180) {
      classCounts[7] += pop;
    } else {
      classCounts[8] += pop;
    }
  }

  const tbody = document.getElementById("populationTableBody");
  tbody.innerHTML = "";

  for (let i = 0; i < timeClasses.length; i++) {
    const percentage = totalPopulation > 0 ? (classCounts[i] / totalPopulation * 100).toFixed(1) : "0.0";
    const row = document.createElement("tr");
    const labelCell = document.createElement("td");
    const totalCell = document.createElement("td");
    totalCell.textContent = totalPopulation > 0 ? classCounts[i].toLocaleString() : "0";
    labelCell.textContent = timeClasses[i].label;
    const percentCell = document.createElement("td");
    percentCell.textContent = percentage + "%";
    row.appendChild(labelCell);
    row.appendChild(percentCell);
    row.appendChild(totalCell);
    tbody.appendChild(row);
  }
}


// Updates hospital icons based on zoom
function updateHospitalIcons() {
  const currentZoom = map.getZoom();
  const newIcon = getHospitalIcon(currentZoom);
  
  for (const marker of hospitalMarkersById.values()) {
    marker.setIcon(newIcon);
  }
}

// Toggles a hospital's disabled status and updates UI
function toggleHospital(hospitalId) {
  if (disabledHospitals.has(hospitalId)) {
    disabledHospitals.delete(hospitalId);
  } else {
    disabledHospitals.add(hospitalId);
  }

  updateGridStyles();
  updateHospitalMarkers();
  updateHospitalList();
  updateStats();
  updatePopulationTable();
}

// Creates a marker for a hospital point
function pointToHospitalMarker(feature, latlng) {
  const hospitalId = normalizeId(feature.properties.hospital_id);
  const name = feature.properties.name ?? hospitalId;
  const hospitalType = feature.properties.type ?? "Tuntematon";
  const marker = L.marker(latlng, {
    icon: hospitalIcon
  });

  marker.bindPopup(`<strong>${name}</strong><br>Tyyppi: ${hospitalType}`);
  
  // Show popup on hover
  marker.on("mouseover", () => marker.openPopup());
  marker.on("mouseout", () => marker.closePopup());
  
  // Toggle hospital on click
  marker.on("click", () => toggleHospital(hospitalId));

  hospitalMarkersById.set(hospitalId, marker);
  return marker;
}

// Loads data from GeoJSON files and initializes the map
async function loadData() {
  const [gridResponse, hospitalsResponse, hvaBoundsResponse, vaestoruudukkoResponse] = await Promise.all([
    fetch("./data/manner-suomi_postinumerot.geojson"),
    fetch("./data/manner-suomi_sairaalat.geojson"),
    fetch("./data/hva_rajat.geojson"),
    fetch("./data/vaestoruudukko.geojson")
  ]);

  if (!gridResponse.ok) {
    throw new Error(`Failed to load grid.geojson: ${gridResponse.status}`);
  }
  if (!hospitalsResponse.ok) {
    throw new Error(`Failed to load hospitals.geojson: ${hospitalsResponse.status}`);
  }
  if(!hvaBoundsResponse.ok) {
    throw new Error(`Failed to load hva.geojson: ${hvaBoundsResponse.status}`);
  }
  if(!vaestoruudukkoResponse.ok) {
    throw new Error(`Failed to load vaestoruudukko.geojson: ${vaestoruudukkoResponse.status}`);
  }

  gridData = await gridResponse.json();
  hospitalsData = await hospitalsResponse.json();
  hvaBoundsData = await hvaBoundsResponse.json();
  vaestoruudukkoData = await vaestoruudukkoResponse.json();

  gridLayer = L.geoJSON(gridData, {
    style: styleGridFeature,
    onEachFeature: onEachGridFeature
  }).addTo(map);

  vaestoruudukkoLayer = L.geoJSON(vaestoruudukkoData, {
    style: styleVaestoruudukkoFeature,
    onEachFeature: onEachVaestoruudukkoFeature
  })

  plus65Layer = L.geoJSON(vaestoruudukkoData, {
    style: style65PlusFeature,
    onEachFeature: onEach65PlusFeature
  })

  hospitalLayer = L.geoJSON(hospitalsData, {
    pointToLayer: pointToHospitalMarker
  }).addTo(map);

  hvaLayer = L.geoJSON(hvaBoundsData, {
    style: { color: "#0f0092", weight: 2, opacity: 0.8, fillOpacity: 0 },
    interactive: false
  }).addTo(map);

  hvaLayer.bringToFront();

  var groupedOverlays = {
          "Kartat":{
            "Väestöruudukko":vaestoruudukkoLayer,
            "Yli 65-vuotiaiden osuus":plus65Layer,
            "Saavutettavuusanalyysi":gridLayer
          }

      };

  var options = {
    // Make the "Kartat" group exclusive (radio buttons).
    exclusiveGroups: ["Kartat"],
    // Show a checkbox next to non-exclusive group labels for toggling all
    groupCheckboxes: true
  };

  // Use the custom grouped layer control, not "L.control.layers"
  var baseLayers = {
    "Tummat kartat": CartoDB_DarkMatter,
    "Vaaleat kartat": CartoDB_Positron
  };

  L.control.groupedLayers(baseLayers, groupedOverlays, options).addTo(map);

  const bounds = gridLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds);
  } else {
    map.setView([61.0, 27.0], 8);
  }

  updateHospitalList();
  updateHospitalMarkers();
  updateStats();
  updatePopulationTable();
  updateLegend();
}

resetBtn.addEventListener("click", () => {
  disabledHospitals.clear();
  updateGridStyles();
  updateHospitalMarkers();
  updateHospitalList();
  updateStats();
  updatePopulationTable();
  updateLegend();
});

loadData().catch(error => {
  console.error(error);
  alert(`Failed to load map data.\n${error.message}`);
});

// Update hospital icons when user zooms
map.on('zoomend', updateHospitalIcons);
map.on("overlayadd overlayremove", updateLegend);