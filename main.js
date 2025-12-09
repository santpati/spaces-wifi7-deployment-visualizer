const state = {
  rawSites: [],
  filteredSites: [],
  selectedSite: null,
  map: null,
  clusters: null,
  geocodeCache: loadCache(),
  geocodeQueue: [],
  geocodeTimer: null,
};

const cacheKey = "wifi7_geocode_cache_v1";
const geocodeDelayMs = 900;

document.addEventListener("DOMContentLoaded", bootstrap);

async function bootstrap() {
  const payload = await fetch("data/sites.json").then((r) => r.json());
  state.rawSites = payload.sites.map((site, idx) => ({
    ...site,
    id: idx,
    totals: { ...site.totals, totalAPs: site.totals.ap9176 + site.totals.ap9178 },
  }));

  await loadGeocodeOverrides();
  setupHero(payload.counts);
  setupFilters();
  initMap();
  applyFilters();
}

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(cacheKey) || "{}");
  } catch (err) {
    return {};
  }
}

async function loadGeocodeOverrides() {
  // Optional file to seed coordinates (data/geocoded_sites.json)
  try {
    const res = await fetch("data/geocoded_sites.json");
    if (!res.ok) return;
    const overrides = await res.json();
    overrides.forEach((row) => {
      state.geocodeCache[row.address] = { lat: row.lat, lng: row.lng };
    });
  } catch (err) {
    // Ignore missing file
  }
}

function setupHero(counts) {
  const stats = [
    { label: "Customers", value: counts.customers },
    { label: "Sites", value: counts.sites },
    { label: "Floors", value: counts.floors },
    { label: "APs 9176", value: counts.ap9176 },
    { label: "APs 9178", value: counts.ap9178 },
  ];
  const container = document.getElementById("hero-stats");
  container.innerHTML = stats
    .map(
      (stat) => `
      <div class="stat-card">
        <strong>${formatNumber(stat.value)}</strong>
        <span class="muted">${stat.label}</span>
      </div>`
    )
    .join("");
}

function setupFilters() {
  const regions = Array.from(new Set(state.rawSites.map((s) => s.region))).sort();
  const verticals = Array.from(new Set(state.rawSites.map((s) => s.vertical))).sort();

  populateSelect("region", ["all", ...regions], "All regions");
  populateSelect("vertical", ["all", ...verticals], "All verticals");

  const maxAps = Math.max(...state.rawSites.map((s) => s.totals.totalAPs));
  const minApsInput = document.getElementById("minAps");
  minApsInput.max = Math.min(2000, Math.max(100, maxAps));
  document.getElementById("minApsValue").textContent = minApsInput.value;

  document.getElementById("search").addEventListener("input", debounce(applyFilters, 200));
  document.getElementById("region").addEventListener("change", applyFilters);
  document.getElementById("vertical").addEventListener("change", applyFilters);
  document.getElementById("ap9176").addEventListener("change", applyFilters);
  document.getElementById("ap9178").addEventListener("change", applyFilters);
  minApsInput.addEventListener("input", () => {
    document.getElementById("minApsValue").textContent = minApsInput.value;
    applyFilters();
  });
}

function populateSelect(id, values, defaultLabel) {
  const el = document.getElementById(id);
  el.innerHTML = values
    .map((val) => {
      const label = val === "all" ? defaultLabel : val;
      return `<option value="${val}">${label}</option>`;
    })
    .join("");
}

function initMap() {
  state.map = L.map("map", { worldCopyJump: true }).setView([20, 0], 2.2);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap, &copy; <a href="https://carto.com/">CARTO</a>',
  }).addTo(state.map);

  state.clusters = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    maxClusterRadius: 55,
    disableClusteringAtZoom: 10,
  });
  state.map.addLayer(state.clusters);
}

function applyFilters() {
  const search = document.getElementById("search").value.toLowerCase();
  const region = document.getElementById("region").value;
  const vertical = document.getElementById("vertical").value;
  const wants9176 = document.getElementById("ap9176").checked;
  const wants9178 = document.getElementById("ap9178").checked;
  const minAps = Number(document.getElementById("minAps").value);

  state.filteredSites = state.rawSites.filter((site) => {
    const has9176 = site.totals.ap9176 > 0;
    const has9178 = site.totals.ap9178 > 0;
    const wantsAny = wants9176 || wants9178;
    const matchesModel = wantsAny && ((wants9176 && has9176) || (wants9178 && has9178));
    if (!matchesModel) return false;

    if (region !== "all" && site.region !== region) return false;
    if (vertical !== "all" && site.vertical !== vertical) return false;
    if (site.totals.totalAPs < minAps) return false;

    if (search) {
      const haystack = `${site.customer} ${site.site} ${site.address}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  if (state.selectedSite && !state.filteredSites.some((s) => s.id === state.selectedSite.id)) {
    state.selectedSite = null;
    renderPanel(null);
  }

  renderList();
  renderMap();
  updateFilteredStats();
}

function renderList() {
  const list = document.getElementById("site-list");
  list.innerHTML = state.filteredSites
    .slice(0, 150)
    .map(
      (site) => `
      <article class="site-card" data-id="${site.id}">
        <div class="meta">${site.customer}</div>
        <h3>${site.site}</h3>
        <div class="meta">${site.address}</div>
        <div class="counts">
          <span class="marker-chip">${site.totals.totalAPs} APs</span>
          <span class="tag">9176: ${site.totals.ap9176}</span>
          <span class="tag">9178: ${site.totals.ap9178}</span>
          <span class="tag">${site.totals.floors} floors</span>
        </div>
      </article>`
    )
    .join("");

  list.querySelectorAll(".site-card").forEach((card) => {
    card.addEventListener("click", () => {
      const site = state.filteredSites.find((s) => s.id === Number(card.dataset.id));
      focusSite(site);
    });
  });
}

function renderMap() {
  state.clusters.clearLayers();
  const markers = [];

  state.filteredSites.forEach((site) => {
    if (site.lat && site.lng) {
      markers.push(addMarker(site));
      return;
    }

    const cached = state.geocodeCache[site.address];
    if (cached) {
      site.lat = cached.lat;
      site.lng = cached.lng;
      markers.push(addMarker(site));
      return;
    }

    queueGeocode(site);
  });

  if (markers.length) {
    const bounds = L.latLngBounds(markers.map((m) => m.getLatLng()));
    state.map.fitBounds(bounds.pad(0.25));
  }
}

function addMarker(site) {
  const icon = L.divIcon({
    className: "ap-marker",
    html: `
      <div class="bubble">
        <div class="count">${site.totals.totalAPs}</div>
        <div class="mix">${site.totals.ap9176}/${site.totals.ap9178}</div>
      </div>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });

  const marker = L.marker([site.lat, site.lng], { icon });
  marker.bindPopup(`<strong>${site.customer}</strong><br>${site.site}<br>${site.address}`);
  marker.on("click", () => focusSite(site, marker));
  state.clusters.addLayer(marker);
  site.marker = marker;
  return marker;
}

function focusSite(site, marker) {
  state.selectedSite = site;
  renderPanel(site);
  if (site.lat && site.lng) {
    state.map.flyTo([site.lat, site.lng], Math.max(state.map.getZoom(), 6));
    if (marker) marker.openPopup();
    else if (site.marker) site.marker.openPopup();
  } else {
    queueGeocode(site);
  }
}

function renderPanel(site) {
  const title = document.getElementById("panel-title");
  const body = document.getElementById("panel-body");
  const badges = document.getElementById("panel-badges");

  if (!site) {
    title.textContent = "Nothing selected";
    body.innerHTML = '<p class="muted">Click a marker or pick from the list to see floor details.</p>';
    badges.innerHTML = "";
    return;
  }

  title.textContent = site.site;
  badges.innerHTML = `
    <span class="badge">${site.customer}</span>
    <span class="badge">${site.region}</span>
    <span class="badge">${site.vertical}</span>
    <span class="badge">${site.dnsLicenseType}</span>
  `;

  const metric = (label, value) => `
    <div class="metric">
      <strong>${value}</strong>
      <span class="muted">${label}</span>
    </div>`;

  const floorRows = site.floors
    .map(
      (floor) => `
        <div class="floor">
          <div>
            <div>${floor.name}</div>
            <div class="label">${formatNumber(floor.areaSqFt)} sq ft</div>
          </div>
          <div>
            <div class="label">APs</div>
            <div>${floor.aps}</div>
          </div>
          <div>
            <div class="label">9176/9178</div>
            <div>${floor.ap9176}/${floor.ap9178}</div>
          </div>
          <div>
            <div class="label">Density</div>
            <div>${floor.apDensity.toFixed(2)}</div>
          </div>
        </div>`
    )
    .join("");

  body.innerHTML = `
    <p>${site.address}</p>
    <div class="metric-row">
      ${metric("Total APs", site.totals.totalAPs)}
      ${metric("9176", site.totals.ap9176)}
      ${metric("9178", site.totals.ap9178)}
      ${metric("Floors", site.totals.floors)}
      ${metric("Connector 3.2", site.totals.connector32)}
      ${metric("WLC 17.15", site.totals.wlc1715)}
    </div>
    <div class="floors">
      ${floorRows}
    </div>
  `;
}

function queueGeocode(site) {
  if (site._queued) return;
  site._queued = true;
  state.geocodeQueue.push(site);
  if (!state.geocodeTimer) processQueue();
}

async function processQueue() {
  if (!state.geocodeQueue.length) {
    state.geocodeTimer = null;
    return;
  }

  const site = state.geocodeQueue.shift();
  site._queued = false;
  await geocodeSite(site);
  state.geocodeTimer = setTimeout(processQueue, geocodeDelayMs);
}

async function geocodeSite(site) {
  try {
    const coords = await fetchGeocode(site.address);
    if (!coords) return;
    state.geocodeCache[site.address] = coords;
    localStorage.setItem(cacheKey, JSON.stringify(state.geocodeCache));
    site.lat = coords.lat;
    site.lng = coords.lng;
    if (!state.filteredSites.some((s) => s.id === site.id)) return;
    addMarker(site);
  } catch (err) {
    console.warn("Geocoding failed", site.address, err);
  }
}

async function fetchGeocode(address) {
  // Try Nominatim, then fall back to Photon if blocked
  const providers = [
    {
      name: "nominatim",
      url: `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        address
      )}&limit=1&addressdetails=0`,
      parse: (data) => (data.length ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } : null),
      options: {
        headers: {
          "Accept-Language": "en",
          "User-Agent": "Cisco-Spaces-WiFi7-Dashboard/1.0 (contact: dashboard@cisco.com)",
        },
      },
    },
    {
      name: "photon",
      url: `https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=1&lang=en`,
      parse: (data) =>
        data.features && data.features.length
          ? {
              lat: parseFloat(data.features[0].geometry.coordinates[1]),
              lng: parseFloat(data.features[0].geometry.coordinates[0]),
            }
          : null,
      options: {
        headers: {
          "User-Agent": "Cisco-Spaces-WiFi7-Dashboard/1.0 (contact: dashboard@cisco.com)",
        },
      },
    },
  ];

  for (const provider of providers) {
    try {
      const res = await fetch(provider.url, provider.options);
      if (!res.ok) continue;
      const data = await res.json();
      const coords = provider.parse(data);
      if (coords) return coords;
    } catch (err) {
      continue; // move to next provider
    }
  }
  return null;
}

function updateFilteredStats() {
  const totals = state.filteredSites.reduce(
    (acc, site) => {
      acc.sites += 1;
      acc.customers.add(site.customer);
      acc.ap9176 += site.totals.ap9176;
      acc.ap9178 += site.totals.ap9178;
      acc.floors += site.totals.floors;
      acc.aps += site.totals.totalAPs;
      return acc;
    },
    { sites: 0, customers: new Set(), ap9176: 0, ap9178: 0, floors: 0, aps: 0 }
  );

  const stats = [
    { label: "Filtered sites", value: totals.sites },
    { label: "Customers", value: totals.customers.size },
    { label: "APs total", value: totals.aps },
    { label: "9176", value: totals.ap9176 },
    { label: "9178", value: totals.ap9178 },
    { label: "Floors", value: totals.floors },
  ];

  const container = document.getElementById("panel-body");
  if (!state.selectedSite) {
    container.innerHTML = stats
      .map(
        (stat) => `
        <div class="metric">
          <strong>${formatNumber(stat.value)}</strong>
          <span class="muted">${stat.label}</span>
        </div>`
      )
      .join("");
  }
}

function formatNumber(num) {
  return Number(num).toLocaleString("en-US");
}

function debounce(fn, wait = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
