# Cisco Spaces WiFi7 Tango Dashboard

Interactive world view of Cisco Spaces customers running 9176/9178 APs. Zoom into a site to see floor-by-floor counts, density, and connector/WLC coverage.

## Run locally
1. Generate fresh data from the workbook (already included as `data/sites.json`):
   ```bash
   cd wifi7-dashboard
   python3 prepare_data.py
   ```
2. Serve the static files (needed so `fetch` can read the JSON):
   ```bash
   python3 -m http.server 8000
   ```
3. Open http://localhost:8000 in your browser. Give the map a few seconds to geocode sites the first time; results are cached in `localStorage`.

## Hosting on AWS EC2
1. Copy `wifi7-dashboard/` and `UWB_Tango_WiFi7_customer_data.xlsx` to the instance.
2. Run `python3 prepare_data.py` to regenerate `data/sites.json`.
3. Serve the folder with any static host (e.g., `python3 -m http.server 80`, Nginx, S3+CloudFront).
4. Keep the `data` folder alongside `index.html`.

## Geocoding notes
- Addresses are geocoded client-side via Nominatim and cached in `localStorage` (`wifi7_geocode_cache_v1`).
- To precompute and ship coordinates (avoids live geocode and speeds map load), run:
  ```bash
  cd wifi7-dashboard
  python3 geocode_addresses.py              # defaults to Photon
  ```
  This writes `data/geocoded_sites.json` that the map loads on startup.
- If Nominatim is blocked on your network, options:
  - Default: Photon (open source) via the script above.
  - Use Mapbox by setting `MAPBOX_TOKEN=<your-token>` before running the script.
  - Explicitly set `GEOCODER_PROVIDER=photon|nominatim|mapbox` to choose.
- To pre-seed coordinates for servers without a browser, drop a file at `data/geocoded_sites.json` shaped as:
  ```json
  [
    { "address": "11-12 Allerton Road, Rugby, CV23 0PA, United Kingdom", "lat": 52.365, "lng": -1.285 }
  ]
  ```
- Geocoding requests now send an explicit User-Agent (required by Nominatim). If markers are still missing, ensure the browser can reach `https://nominatim.openstreetmap.org/` or pre-seed `geocoded_sites.json`.
- You can export your local cache from the browser console:
  ```js
  const cache = JSON.parse(localStorage.getItem('wifi7_geocode_cache_v1') || '{}');
  const rows = Object.entries(cache).map(([address, coords]) => ({ address, ...coords }));
  console.log(JSON.stringify(rows, null, 2));
  ```

## Pushing to GitHub (`github.com/santpati/…`)
```bash
cd /Users/santpati/scripts
git init                       # if not already a repo
git add wifi7-dashboard UWB_Tango_WiFi7_customer_data.xlsx
git commit -m "Add WiFi7 Tango map dashboard"
git remote add origin git@github.com:santpati/<repo>.git   # replace with actual repo name
git push -u origin main
```
