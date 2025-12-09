"""
Geocode site addresses and write data/geocoded_sites.json for offline marker placement.

Uses OpenStreetMap Nominatim; please keep rate to ~1 request/sec per usage policy.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests

ROOT = Path(__file__).resolve().parent
SITES = ROOT / "data" / "sites.json"
OUTPUT = ROOT / "data" / "geocoded_sites.json"

USER_AGENT = "Cisco-Spaces-WiFi7-Dashboard/1.0 (contact: dashboard@cisco.com)"
REQUEST_DELAY_SEC = 1.1
MAPBOX_TOKEN = os.getenv("MAPBOX_TOKEN")
GEOCODER_PROVIDER = os.getenv("GEOCODER_PROVIDER", "photon").lower()


def load_sites() -> List[str]:
    data = json.loads(SITES.read_text())
    addresses = {site["address"] for site in data["sites"] if site.get("address")}
    return sorted(addresses)


def load_existing() -> Dict[str, Dict[str, float]]:
    if not OUTPUT.exists():
        return {}
    try:
        existing_list = json.loads(OUTPUT.read_text())
        return {row["address"]: {"lat": row["lat"], "lng": row["lng"]} for row in existing_list}
    except Exception:
        return {}


def geocode(address: str) -> Optional[Dict[str, float]]:
    """Geocode via selected provider (photon default, nominatim, mapbox)."""
    provider = GEOCODER_PROVIDER
    errors: List[Tuple[str, str]] = []

    for choice in [provider, "photon", "nominatim"]:
        if choice == "mapbox" and not MAPBOX_TOKEN:
            continue
        if choice == "mapbox" and MAPBOX_TOKEN:
            url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{requests.utils.quote(address)}.json"
            params = {"access_token": MAPBOX_TOKEN, "limit": 1, "language": "en"}
            headers = {"User-Agent": USER_AGENT}
        elif choice == "photon":
            url = "https://photon.komoot.io/api/"
            params = {"q": address, "limit": 1, "lang": "en"}
            headers = {"User-Agent": USER_AGENT}
        else:  # nominatim
            url = "https://nominatim.openstreetmap.org/search"
            params = {"format": "json", "q": address, "limit": 1, "addressdetails": 0}
            headers = {"User-Agent": USER_AGENT, "Accept-Language": "en"}

        try:
            res = requests.get(url, params=params, headers=headers, timeout=25)
            res.raise_for_status()
            data = res.json()
            if choice == "mapbox":
                features = data.get("features", [])
                if not features:
                    continue
                lon, lat = features[0]["center"]
                return {"address": address, "lat": float(lat), "lng": float(lon)}
            if choice == "photon":
                features = data.get("features", [])
                if not features:
                    continue
                coords = features[0]["geometry"]["coordinates"]  # [lon, lat]
                return {"address": address, "lat": float(coords[1]), "lng": float(coords[0])}
            if not data:
                continue
            return {"address": address, "lat": float(data[0]["lat"]), "lng": float(data[0]["lon"])}
        except Exception as exc:  # noqa: BLE001
            errors.append((choice, str(exc)))
            continue

    if errors:
        print(f"Failed to geocode {address}; errors: {errors}")
    return None


def main():
    addresses = load_sites()
    existing = load_existing()
    out_rows = []
    new_count = 0
    for idx, address in enumerate(addresses, 1):
        if address in existing:
            out_rows.append({"address": address, **existing[address]})
            continue
        print(f"[{idx}/{len(addresses)}] geocoding {address} ...", flush=True)
        result = geocode(address)
        if result:
            out_rows.append(result)
            new_count += 1
        else:
            print(f"  no result for {address}")
        time.sleep(REQUEST_DELAY_SEC)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out_rows, indent=2))
    print(f"Wrote {OUTPUT} with {len(out_rows)} rows ({new_count} new)")


if __name__ == "__main__":
    main()
