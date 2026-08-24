const config = {
  facilityLabel: "Palvelupiste",
  facilityLabelPlural: "Palvelupisteet",
  facilityDataUrl: "",
  gridDataUrl: "",
  populationDataUrl: "./data/vaestoruudukko.geojson",
  hvaDataUrl: "./data/hva.geojson",
  facilityIdProperty: "id",
  facilityNameProperty: "name",
  facilityTypeProperty: "type",
  gridIdProperty: "grid_id",
  gridIdLabel: "Alue",
  nearestFieldPrefix: "facility",
  iconUrl: null,
  iconAttribution: "",
  useDivIcon: false,
  areaSelectorId: null,
  defaultAreaSlug: "all",
  areaDataPatterns: null,
  addedFacilityCandidateDataUrl: null,
  addedFacilityTravelTimesUrlPattern: null,
  timeClasses: [
    { label: "Ei voitu laskea", max: null, color: "#ffffff" },
    { label: "0-15 min", max: 15, color: "#9dff00" },
    { label: "15-30 min", max: 30, color: "#d0ff00" },
    { label: "30-45 min", max: 45, color: "#fffb00" },
    { label: "45-60 min", max: 60, color: "#ffc400" },
    { label: "60-90 min", max: 90, color: "#ff9900" },
    { label: "90-120 min", max: 120, color: "#ff6600" },
    { label: "120-180 min", max: 180, color: "#ff5100" },
    { label: "180+ min", max: Infinity, color: "#ff0000" }
  ],
  ...window.ACCESSIBILITY_CONFIG
};

const map = L.map("map", {
  scrollWheelZoom: true,
  wheelPxPerZoomLevel: 80,
  zoomSnap: 0.25,
  zoomDelta: 0.25
});

if (config.iconAttribution) {
  map.attributionControl.addAttribution(config.iconAttribution);
}

const CartoDB_Positron = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 20
}).addTo(map);

const CartoDB_DarkMatter = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 20
});

function getFacilityIcon(feature, zoom) {
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

  let size = 24;
  for (const [z, s] of Object.entries(sizes)) {
    if (zoom <= parseInt(z, 10)) {
      size = s;
      break;
    }
  }

  if (!config.useDivIcon && config.iconUrl) {
    return L.icon({
      iconUrl: config.iconUrl,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2]
    });
  }

  const facilityType =
    feature.properties[config.facilityTypeProperty] ?? "Tuntematon";

  const stationTypeClasses = {
    Paloasema: "station-paloasema",
    Vapaapalokunta: "station-vpk",
    VPK: "station-vpk",
    PVPK: "station-pvpk",
    TPK: "station-tpk",
    SPK: "station-spk",
    Muu: "station-muu",
    Tuntematon: "station-tuntematon"
  };
  const colorClass = stationTypeClasses[facilityType] ?? "station-default";

  return L.divIcon({
    className: `firestation-marker ${colorClass}`,
    html: '<span aria-hidden="true"></span>',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
}


const disabledFacilities = new Set();

const timeClasses = config.timeClasses;

let gridData = null;
let facilitiesData = null;
let populationData = null;
let candidateGridData = null;
let gridLayer = null;
let facilityLayer = null;
let addedFacilityLayer = null;
let populationLayer = null;
let plus65Layer = null;
let hvaBoundsData = null;
let hvaLayer = null;
let areaOptions = [];
let selectedAreaSlug = config.defaultAreaSlug;

const facilityMarkersById = new Map();
const addedFacilities = [];
const addedFacilityTimesCache = new Map();
let addedFacilityTravelTimesUrlPattern = null;
let nextAddedFacilityNumber = 1;

const activeCountEl = document.getElementById("activeCount");
const totalCountEl = document.getElementById("totalCount");
const avgTimeEl = document.getElementById("avgTime");
const facilityListEl = document.getElementById("facilityList");
const facilityTypeListEl = document.getElementById("facilityTypeList");
const areaSelectEl = config.areaSelectorId ? document.getElementById(config.areaSelectorId) : null;
const resetBtn = document.getElementById("resetBtn");

function normalizeId(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;

  const numericValue = Number(text);
  if (Number.isFinite(numericValue) && /^\d+(\.0+)?$/.test(text)) {
    return String(Math.floor(numericValue));
  }
  return text;
}

function safeFilename(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "unknown";
}

const accessibilitySlugByHvaCode = {
  "01": "ita_uusimaa",
  "02": "keski_uusimaa",
  "03": "lansi_uusimaa",
  "04": "vantaa_kerava",
  "05": "varsinais_suomi",
  "06": "satakunta",
  "07": "kanta_hame",
  "08": "pirkanmaa",
  "09": "paijat_hame",
  "10": "kymenlaakso",
  "11": "etela_karjala",
  "12": "etela_savo",
  "13": "pohjois_savo",
  "14": "pohjois_karjala",
  "15": "keski_suomi",
  "16": "etela_pohjanmaa",
  "17": "pohjanmaa",
  "18": "keski_pohjanmaa",
  "19": "pohjois_pohjanmaa",
  "20": "kainuu",
  "21": "lappi",
  "90": "helsingin_kaupunki"
};

function normalizeHvaCode(value) {
  if (value == null) return null;
  return String(value).trim().padStart(2, "0");
}

function getNearestId(props, index) {
  return normalizeId(props[`${config.nearestFieldPrefix}_${index}`]);
}

function getExistingAccess(props) {
  for (let i = 1; i <= 5; i++) {
    const facilityId = getNearestId(props, i);
    const time = Number(props[`time_${i}`]);
    const name = props[`name_${i}`];

    if (!facilityId) continue;
    if (!Number.isFinite(time)) continue;
    if (!disabledFacilities.has(facilityId)) {
      return {
        id: facilityId,
        name: name ?? facilityId,
        time,
        simulated: false
      };
    }
  }
  return null;
}

function getAddedAccess(props) {
  const gridId = normalizeId(props[config.gridIdProperty] ?? props.grid_id ?? props.grd_id);
  if (!gridId) return null;

  let best = null;
  for (const facility of addedFacilities) {
    const time = Number(facility.times?.[gridId]);
    if (!Number.isFinite(time)) continue;
    if (!best || time < best.time) {
      best = {
        id: facility.id,
        name: facility.name,
        time,
        simulated: true
      };
    }
  }
  return best;
}

function getCurrentAccess(props) {
  const existing = getExistingAccess(props);
  const added = getAddedAccess(props);

  if (!existing) return added;
  if (!added) return existing;
  return added.time < existing.time ? added : existing;
}

function getCurrentTravelTime(props) {
  return getCurrentAccess(props)?.time ?? null;
}

function getCurrentFacilityName(props) {
  return getCurrentAccess(props)?.name ?? null;
}

function getColor(time) {
  const timeClass = getTimeClass(time);
  return timeClasses[timeClass]?.color ?? "#ffffff";
}

function getTimeClass(time) {
  if (time === null || time === 0) return 0;

  for (let i = 1; i < timeClasses.length; i++) {
    if (timeClasses[i].exclusiveMax ? time < timeClasses[i].max : time <= timeClasses[i].max) {
      return i;
    }
  }

  return timeClasses.length - 1;
}

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
    : value > 7 ? "#1aff00"
    : value > 5 ? "#62ff87"
    : value > 3 ? "#79ffb8"
    : value >= 2 ? "#9fecff"
    : value >= 1 ? "#00aeff"
    : value > 0 ? "#ffffff"
    : "#ffffff";
}

function stylePopulationFeature(feature) {
  const population = feature.properties.vaesto ?? feature.properties.population;
  return {
    fillColor: getVaestoColor(population),
    weight: 1,
    opacity: 0,
    color: "#ffffff",
    fillOpacity: 0.8
  };
}

function onEachPopulationFeature(feature, layer) {
  const population = feature.properties.vaesto ?? feature.properties.population ?? 0;
  layer.bindTooltip(`Väestö: ${Number(population).toLocaleString("fi-FI")}`, {
    sticky: true,
    className: "grid-tooltip"
  });
}

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

function style65PlusFeature(feature) {
  const population = feature.properties.vaesto ?? 0;
  const plus65 = feature.properties.ika_65_ ?? 0;
  const percentage = population > 0 ? plus65 / population * 100 : 0;
  return {
    fillColor: get65PlusColor(percentage),
    weight: 1,
    opacity: 0,
    color: "#ffffff",
    fillOpacity: 0.8
  };
}

function onEach65PlusFeature(feature, layer) {
  const population = feature.properties.vaesto ?? 0;
  const plus65 = feature.properties.ika_65_ ?? 0;
  const percentage = population > 0 ? (plus65 / population * 100).toFixed(1) : "0.0";
  layer.bindTooltip(`Väestö: ${Number(population).toLocaleString("fi-FI")}<br>65+: ${Number(plus65).toLocaleString("fi-FI")} (${percentage}%)`, {
    sticky: true,
    className: "grid-tooltip"
  });
}

function updateLegend() {
  const visible = new Set();
  if (gridLayer && map.hasLayer(gridLayer)) visible.add("Saavutettavuusanalyysi");
  if (populationLayer && map.hasLayer(populationLayer)) visible.add("Väestöruudukko");
  if (plus65Layer && map.hasLayer(plus65Layer)) visible.add("Yli 65-vuotiaiden osuus");

  document.querySelectorAll(".legend-section").forEach(section => {
    const layerName = section.dataset.layer;
    section.style.display = visible.has(layerName) ? "block" : "none";
  });
}

function getAreaOption(slug) {
  return areaOptions.find(option => option.slug === slug) ?? areaOptions[0];
}

function areaUrl(pattern, area) {
  if (!pattern || !area) return null;
  return pattern
    .replaceAll("{slug}", area.slug)
    .replaceAll("{accessibilitySlug}", area.accessibilitySlug ?? area.slug)
    .replaceAll("{code}", area.code ?? "")
    .replaceAll("{name}", area.name);
}

function getDataUrlsForArea(area) {
  if (!area || area.slug === "all" || !config.areaDataPatterns) {
    return {
      facilityDataUrl: config.facilityDataUrl,
      gridDataUrl: config.gridDataUrl,
      gridFallbackDataUrl: null,
      populationDataUrl: config.populationDataUrl,
      addedFacilityCandidateDataUrl: config.addedFacilityCandidateDataUrl,
      addedFacilityTravelTimesUrlPattern: config.addedFacilityTravelTimesUrlPattern
    };
  }

  if (config.areaDataByCode && area.code && config.areaDataByCode[area.code]) {
    return {
      gridFallbackDataUrl: null,
      addedFacilityCandidateDataUrl: null,
      addedFacilityTravelTimesUrlPattern: null,
      ...config.areaDataByCode[area.code]
    };
  }

  return {
    facilityDataUrl: areaUrl(config.areaDataPatterns.facilityDataUrl, area),
    gridDataUrl: areaUrl(config.areaDataPatterns.gridDataUrl, area),
    gridFallbackDataUrl: areaUrl(config.areaDataPatterns.gridFallbackDataUrl, area),
    populationDataUrl: areaUrl(config.areaDataPatterns.populationDataUrl, area),
    addedFacilityCandidateDataUrl: areaUrl(config.areaDataPatterns.addedFacilityCandidateDataUrl, area),
    addedFacilityTravelTimesUrlPattern: areaUrl(config.areaDataPatterns.addedFacilityTravelTimesUrlPattern, area)
  };
}

async function fetchJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label}-aineiston lataus epäonnistui: ${response.status}`);
  }
  return response.json();
}

async function fetchJsonWithFallback(url, fallbackUrl, label) {
  try {
    return await fetchJson(url, label);
  } catch (error) {
    if (!fallbackUrl || fallbackUrl === url) {
      throw error;
    }
    console.warn(`${label} not available from ${url}. Falling back to ${fallbackUrl}.`);
    return fetchJson(fallbackUrl, label);
  }
}

function hasTravelTimes(data) {
  return data?.features?.some(feature => {
    const props = feature.properties ?? {};
    return Object.keys(props).some(key => key.startsWith("time_"));
  }) ?? false;
}

function buildAreaOptions() {
  const hvaOptions = hvaBoundsData.features.map(feature => {
    const properties = feature.properties ?? {};
    const name = properties.nimi ?? properties.name ?? "Tuntematon";
    const code = normalizeHvaCode(properties.hyvinvointialue);
    return {
      slug: safeFilename(name),
      accessibilitySlug: accessibilitySlugByHvaCode[code] ?? safeFilename(name),
      name,
      code,
      feature
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "fi"));

  areaOptions = [
    { slug: "all", name: "Koko maa", code: null, feature: null },
    ...hvaOptions
  ];
}

function updateAreaSelector() {
  if (!areaSelectEl) return;

  areaSelectEl.innerHTML = "";
  for (const option of areaOptions) {
    const item = document.createElement("option");
    item.value = option.slug;
    item.textContent = option.name;
    areaSelectEl.appendChild(item);
  }
  areaSelectEl.value = selectedAreaSlug;
}

function tooltipHtml(props) {
  const time = getCurrentTravelTime(props);
  const access = getCurrentAccess(props);
  const facilityName = access?.name;
  const gridId = props[config.gridIdProperty] ?? props.grid_id ?? props.grd_id ?? "-";
  const population = props.population ?? props.vaesto ?? "-";

  if (time === null || time === 0) {
    return `
      <div>
        <strong>${config.gridIdLabel}: </strong> ${gridId}<br>
        <strong>Väkiluku: </strong> ${population}<br>
        <strong>Matka-aika: </strong> Laskenta epäonnistui
      </div>
    `;
  }

  return `
    <div>
      <strong>${config.gridIdLabel}: </strong> ${gridId}<br>
      <strong>Väkiluku: </strong> ${population}<br>
      <strong>${config.facilityLabel}: </strong> ${facilityName}${access?.simulated ? " (lisätty)" : ""}<br>
      <strong>Matka-aika: </strong> ${time.toFixed(1)} min
    </div>
  `;
}

function onEachGridFeature(feature, layer) {
  layer.bindTooltip(tooltipHtml(feature.properties), {
    sticky: true,
    className: "grid-tooltip"
  });
}

function updateGridStyles() {
  if (!gridLayer) return;

  gridLayer.eachLayer(layer => {
    layer.setStyle(styleGridFeature(layer.feature));
    layer.setTooltipContent(tooltipHtml(layer.feature.properties));
  });
}

function getFacilityId(feature) {
  return normalizeId(feature.properties[config.facilityIdProperty]);
}

function getFacilityName(feature) {
  const id = getFacilityId(feature);
  return feature.properties[config.facilityNameProperty] ?? id;
}

function getFacilityType(feature) {
  return feature.properties[config.facilityTypeProperty] ?? "Tuntematon";
}

function refreshMapState() {
  updateGridStyles();
  updateFacilityMarkers();
  updateFacilityTypeList();
  updateFacilityList();
  updateStats();
  updatePopulationTable();
}

function updateFacilityMarkers() {
  for (const feature of facilitiesData.features) {
    const facilityId = getFacilityId(feature);
    const marker = facilityMarkersById.get(facilityId);
    if (!marker) continue;

    const disabled = disabledFacilities.has(facilityId);
    marker.setOpacity(disabled ? 0.4 : 1.0);
  }
}

function getFacilityTypeSummaries() {
  const summariesByType = new Map();

  for (const feature of facilitiesData.features) {
    const type = getFacilityType(feature);
    const facilityId = getFacilityId(feature);

    if (!summariesByType.has(type)) {
      summariesByType.set(type, { type, total: 0, active: 0 });
    }

    const summary = summariesByType.get(type);
    summary.total += 1;
    if (!disabledFacilities.has(facilityId)) {
      summary.active += 1;
    }
  }

  return [...summariesByType.values()].sort((a, b) => a.type.localeCompare(b.type, "fi"));
}

function updateFacilityTypeList() {
  if (!facilityTypeListEl) return;

  facilityTypeListEl.innerHTML = "";

  for (const summary of getFacilityTypeSummaries()) {
    const row = document.createElement("div");
    row.className = `facility-type-item ${summary.active === 0 ? "disabled" : ""}`;

    const label = document.createElement("label");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = summary.active === summary.total;
    checkbox.indeterminate = summary.active > 0 && summary.active < summary.total;
    checkbox.addEventListener("change", () => toggleFacilityType(summary.type, checkbox.checked));

    const name = document.createElement("span");
    name.textContent = summary.type;

    const count = document.createElement("span");
    count.className = "facility-type-count";
    count.textContent = `${summary.active}/${summary.total}`;

    label.appendChild(checkbox);
    label.appendChild(name);
    label.appendChild(count);
    row.appendChild(label);

    facilityTypeListEl.appendChild(row);
  }
}

function updateFacilityList() {
  facilityListEl.innerHTML = "";

  for (const facility of addedFacilities) {
    const row = document.createElement("div");
    row.className = "facility-item added-facility-item";

    const text = document.createElement("span");
    text.textContent = `${facility.name} (${facility.originGridId})`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-added-facility";
    removeButton.textContent = "Poista";
    removeButton.addEventListener("click", () => removeAddedFacility(facility.id));

    row.appendChild(text);
    row.appendChild(removeButton);
    facilityListEl.appendChild(row);
  }

  const features = [...facilitiesData.features].sort((a, b) => {
    const nameA = (getFacilityName(a) ?? "").toLowerCase();
    const nameB = (getFacilityName(b) ?? "").toLowerCase();
    return nameA.localeCompare(nameB, "fi");
  });

  for (const feature of features) {
    const facilityId = getFacilityId(feature);
    const name = getFacilityName(feature);
    const disabled = disabledFacilities.has(facilityId);

    const row = document.createElement("div");
    row.className = `facility-item ${disabled ? "disabled" : ""}`;

    const label = document.createElement("label");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !disabled;
    checkbox.addEventListener("change", () => toggleFacility(facilityId));

    const text = document.createElement("span");
    text.textContent = name;

    label.appendChild(checkbox);
    label.appendChild(text);
    row.appendChild(label);

    facilityListEl.appendChild(row);
  }
}

function updateStats() {
  const total = facilitiesData.features.length + addedFacilities.length;
  activeCountEl.textContent = String(facilitiesData.features.length - disabledFacilities.size + addedFacilities.length);
  if (totalCountEl) {
    totalCountEl.textContent = String(total);
  }

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

function updatePopulationTable() {
  let totalPopulation = 0;
  for (const feature of gridData.features) {
    const population = Number(feature.properties.population ?? feature.properties.vaesto ?? 0);
    totalPopulation += Number.isFinite(population) ? population : 0;
  }

  const classCounts = new Array(timeClasses.length).fill(0);

  for (const feature of gridData.features) {
    const time = getCurrentTravelTime(feature.properties);
    const population = Number(feature.properties.population ?? feature.properties.vaesto ?? 0);
    const pop = Number.isFinite(population) ? population : 0;

    classCounts[getTimeClass(time)] += pop;
  }

  const tbody = document.getElementById("populationTableBody");
  tbody.innerHTML = "";

  for (let i = 0; i < timeClasses.length; i++) {
    const percentage = totalPopulation > 0 ? (classCounts[i] / totalPopulation * 100).toFixed(1) : "0.0";
    const row = document.createElement("tr");
    const labelCell = document.createElement("td");
    const percentCell = document.createElement("td");
    const totalCell = document.createElement("td");
    labelCell.textContent = timeClasses[i].label;
    percentCell.textContent = `${percentage}%`;
    totalCell.textContent = totalPopulation > 0 ? classCounts[i].toLocaleString("fi-FI") : "0";
    row.appendChild(labelCell);
    row.appendChild(percentCell);
    row.appendChild(totalCell);
    tbody.appendChild(row);
  }
}

function updateFacilityIcons() {
  const currentZoom = map.getZoom();

  for (const feature of facilitiesData.features) {
    const facilityId = getFacilityId(feature);
    const marker = facilityMarkersById.get(facilityId);

    if (!marker) continue;

    marker.setIcon(
      getFacilityIcon(feature, currentZoom)
    );
  }
}

function toggleFacility(facilityId) {
  if (disabledFacilities.has(facilityId)) {
    disabledFacilities.delete(facilityId);
  } else {
    disabledFacilities.add(facilityId);
  }

  refreshMapState();
}

function toggleFacilityType(facilityType, enabled) {
  for (const feature of facilitiesData.features) {
    if (getFacilityType(feature) !== facilityType) continue;

    const facilityId = getFacilityId(feature);
    if (enabled) {
      disabledFacilities.delete(facilityId);
    } else {
      disabledFacilities.add(facilityId);
    }
  }

  refreshMapState();
}

function pointToFacilityMarker(feature, latlng) {
  const facilityId = getFacilityId(feature);
  const name = getFacilityName(feature);
  const facilityType = getFacilityType(feature);
  const marker = L.marker(latlng, {
    icon: getFacilityIcon(feature,map.getZoom())
  });

  marker.bindPopup(`<strong>${name}</strong><br>Tyyppi: ${facilityType}`);
  marker.on("mouseover", () => marker.openPopup());
  marker.on("mouseout", () => marker.closePopup());
  marker.on("click", event => {
    L.DomEvent.stopPropagation(event);
    toggleFacility(facilityId);
  });

  facilityMarkersById.set(facilityId, marker);
  return marker;
}

async function loadData() {
  hvaBoundsData = await fetchJson(config.hvaDataUrl, "Hyvinvointialueiden");
  buildAreaOptions();
  updateAreaSelector();

  gridLayer = L.geoJSON(null, {
    style: styleGridFeature,
    onEachFeature: onEachGridFeature
  }).addTo(map);

  populationLayer = L.geoJSON(null, {
    style: stylePopulationFeature,
    onEachFeature: onEachPopulationFeature,
    renderer: L.canvas({ padding: 0.5 }),
    minZoom: 0
  });

  plus65Layer = L.geoJSON(null, {
    style: style65PlusFeature,
    onEachFeature: onEach65PlusFeature,
    renderer: L.canvas({ padding: 0.5 }),
    minZoom: 0
  });

  facilityLayer = L.geoJSON(null, {
    pointToLayer: pointToFacilityMarker
  }).addTo(map);

  addedFacilityLayer = L.layerGroup().addTo(map);

  hvaLayer = L.geoJSON(null, {
    style: { color: "#0f0092", weight: 2, opacity: 0.8, fillOpacity: 0 },
    interactive: false
  }).addTo(map);

  hvaLayer.bringToFront();

  const groupedOverlays = {
    Kartat: {
      "Väestöruudukko": populationLayer,
      "Yli 65-vuotiaiden osuus": plus65Layer,
      "Saavutettavuusanalyysi": gridLayer
    }
  };

  const options = {
    exclusiveGroups: ["Kartat"],
    groupCheckboxes: true
  };

  const baseLayers = {
    "Ei pohjakarttaa": L.tileLayer("", { attribution: "" }),
    "Tumma kartta": CartoDB_DarkMatter,
    "Vaalea kartta": CartoDB_Positron
  };

  L.control.groupedLayers(baseLayers, groupedOverlays, options).addTo(map);

  await loadSelectedArea(selectedAreaSlug);
}

async function loadSelectedArea(areaSlug) {
  const area = getAreaOption(areaSlug);
  selectedAreaSlug = area.slug;
  if (areaSelectEl) {
    areaSelectEl.disabled = true;
  }

  try {
    const urls = getDataUrlsForArea(area);
    const useGridAsPopulation = urls.populationDataUrl === urls.gridDataUrl;
    const [nextGridData, nextFacilitiesData, nextPopulationData, nextCandidateGridData] = await Promise.all([
      fetchJsonWithFallback(urls.gridDataUrl, urls.gridFallbackDataUrl, "Saavutettavuusaineiston"),
      fetchJson(urls.facilityDataUrl, config.facilityLabelPlural),
      useGridAsPopulation ? Promise.resolve(null) : fetchJson(urls.populationDataUrl, "Väestöruudukon"),
      urls.addedFacilityCandidateDataUrl ? fetchJson(urls.addedFacilityCandidateDataUrl, "Lisättävien paloasemien ruudukon") : Promise.resolve(null)
    ]);

    gridData = nextGridData;
    if (!hasTravelTimes(gridData)) {
      throw new Error(`Saavutettavuusaineisto ${urls.gridDataUrl} ei sisällä matka-aikoja.`);
    }
    facilitiesData = nextFacilitiesData;
    populationData = useGridAsPopulation ? gridData : nextPopulationData;
    candidateGridData = nextCandidateGridData;
    addedFacilityTravelTimesUrlPattern = urls.addedFacilityTravelTimesUrlPattern;

    disabledFacilities.clear();
    facilityMarkersById.clear();
    clearAddedFacilities();

    gridLayer.clearLayers();
    populationLayer.clearLayers();
    plus65Layer.clearLayers();
    facilityLayer.clearLayers();
    addedFacilityLayer.clearLayers();
    hvaLayer.clearLayers();

    gridLayer.addData(gridData);
    populationLayer.addData(populationData);
    plus65Layer.addData(populationData);
    facilityLayer.addData(facilitiesData);
    hvaLayer.addData(area.slug === "all" ? hvaBoundsData : area.feature);
    hvaLayer.bringToFront();

    fitAreaBounds(area);
    refreshMapState();
    updateLegend();
  } finally {
    if (areaSelectEl) {
      areaSelectEl.disabled = false;
      areaSelectEl.value = selectedAreaSlug;
    }
  }
}

function addedFacilitiesEnabled() {
  return Boolean(candidateGridData?.features?.length && addedFacilityTravelTimesUrlPattern);
}

function nearestCandidateGridPoint(latlng) {
  if (!candidateGridData?.features?.length) return null;

  let best = null;
  for (const feature of candidateGridData.features) {
    const coordinates = feature.geometry?.coordinates;
    if (!coordinates || coordinates.length < 2) continue;
    const candidateLatLng = L.latLng(coordinates[1], coordinates[0]);
    const distance = map.distance(latlng, candidateLatLng);
    if (!best || distance < best.distance) {
      best = { feature, latlng: candidateLatLng, distance };
    }
  }
  return best;
}

function addedFacilityTimesUrl(originGridId) {
  return addedFacilityTravelTimesUrlPattern.replaceAll("{id}", encodeURIComponent(originGridId));
}

async function loadAddedFacilityTimes(originGridId) {
  if (addedFacilityTimesCache.has(originGridId)) {
    return addedFacilityTimesCache.get(originGridId);
  }

  const data = await fetchJson(addedFacilityTimesUrl(originGridId), "Ruudusta ruutuun -matka-aikojen");
  const times = data.times ?? data;
  addedFacilityTimesCache.set(originGridId, times);
  return times;
}

function clearAddedFacilities() {
  addedFacilities.length = 0;
  nextAddedFacilityNumber = 1;
  if (addedFacilityLayer) {
    addedFacilityLayer.clearLayers();
  }
}

function removeAddedFacility(facilityId) {
  const index = addedFacilities.findIndex(facility => facility.id === facilityId);
  if (index === -1) return;

  const [facility] = addedFacilities.splice(index, 1);
  if (facility.marker) {
    addedFacilityLayer.removeLayer(facility.marker);
  }
  refreshMapState();
}

async function addFacilityFromMapClick(latlng) {
  if (!addedFacilitiesEnabled()) return;

  const nearest = nearestCandidateGridPoint(latlng);
  if (!nearest) return;

  const originGridId = normalizeId(nearest.feature.properties?.grd_id ?? nearest.feature.properties?.grid_id);
  if (!originGridId) return;

  try {
    const times = await loadAddedFacilityTimes(originGridId);
    const id = `added_${Date.now()}_${nextAddedFacilityNumber}`;
    const name = `Lisätty paloasema ${nextAddedFacilityNumber}`;
    nextAddedFacilityNumber += 1;

    const marker = L.circleMarker(nearest.latlng, {
      radius: 9,
      color: "#111",
      weight: 2,
      fillColor: "#00c2a8",
      fillOpacity: 0.95
    }).addTo(addedFacilityLayer);
    marker.bindPopup(`<strong>${name}</strong><br>Ruutu: ${originGridId}<br>Klikkaa poistaaksesi`);
    marker.on("click", event => {
      L.DomEvent.stopPropagation(event);
      removeAddedFacility(id);
    });

    addedFacilities.push({
      id,
      name,
      originGridId,
      times,
      marker
    });
    refreshMapState();
  } catch (error) {
    console.error(error);
    alert(`Paloaseman lisääminen epäonnistui.\n${error.message}`);
  }
}

function fitAreaBounds(area) {
  if (area?.feature) {
    const selectedHvaLayer = L.geoJSON(area.feature);
    const selectedBounds = selectedHvaLayer.getBounds();
    if (selectedBounds.isValid()) {
      map.fitBounds(selectedBounds);
      return;
    }
  }

  const bounds = gridLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds);
  } else {
    map.setView([61.0, 27.0], 8);
  }

}

if (areaSelectEl) {
  areaSelectEl.addEventListener("change", () => {
    loadSelectedArea(areaSelectEl.value).catch(error => {
      console.error(error);
      alert(`Alueen lataus epäonnistui.\n${error.message}`);
    });
  });
}

resetBtn.addEventListener("click", () => {
  disabledFacilities.clear();
  clearAddedFacilities();
  refreshMapState();
  updateLegend();
});

loadData().catch(error => {
  console.error(error);
  alert(`Kartta-aineiston lataus epäonnistui.\n${error.message}`);
});

map.on("zoomend", updateFacilityIcons);
map.on("overlayadd overlayremove", updateLegend);
map.on("click", event => {
  addFacilityFromMapClick(event.latlng);
});
