"""
Convert the supplied Excel workbook into a compact JSON feed for the dashboard.

Input:  ../UWB_Tango_WiFi7_customer_data.xlsx
Output: data/sites.json
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd


ROOT = Path(__file__).resolve().parent
WORKBOOK = ROOT.parent / "UWB_Tango_WiFi7_customer_data.xlsx"
OUTPUT = ROOT / "data" / "sites.json"


def first_non_null(series):
    for val in series:
        if pd.notnull(val):
            return val
    return None


def build_site_records(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Group by customer/site/address and roll up floor metrics."""
    sites: List[Dict[str, Any]] = []

    grouped = df.groupby(["accountName", "buildingName", "address"], dropna=False)
    for (customer, site, address), group in grouped:
        floors = []
        for _, row in group.iterrows():
            floors.append(
                {
                    "name": row["floorName"],
                    "aps": int(row["APsInFloor"]),
                    "ap9176": int(row["APModel9176I"]),
                    "ap9178": int(row["APModel9178I"]),
                    "areaSqFt": float(row["AImapArea"]),
                    "apDensity": float(row["AP Density"]),
                    "wlc1715": int(row["WLC version 17.15"]),
                    "connector32": int(row["Connector3.2"]),
                }
            )

        totals = {
            "floors": len(floors),
            "aps": int(group["APsInFloor"].sum()),
            "ap9176": int(group["APModel9176I"].sum()),
            "ap9178": int(group["APModel9178I"].sum()),
            "areaSqFt": float(group["AImapArea"].sum()),
            "apDensityAvg": float(group["AP Density"].mean()),
            "wlc1715": int(group["WLC version 17.15"].sum()),
            "connector32": int(group["Connector3.2"].sum()),
        }

        sites.append(
            {
                "customer": customer,
                "site": site,
                "address": address,
                "region": first_non_null(group["tenant_region"]) or "unknown",
                "vertical": first_non_null(group["Vertical"]) or "unknown",
                "dnsLicenseType": first_non_null(group["DNSLicenseType"]) or "unknown",
                "totals": totals,
                "floors": floors,
            }
        )

    return sites


def main() -> None:
    if not WORKBOOK.exists():
        raise SystemExit(f"Workbook not found at {WORKBOOK}")

    df = pd.read_excel(WORKBOOK, sheet_name="Raw data")

    numeric_cols = [
        "APsInFloor",
        "APModel9176I",
        "APModel9178I",
        "AImapArea",
        "AP Density",
        "WLC version 17.15",
        "Connector3.2",
    ]
    df[numeric_cols] = df[numeric_cols].fillna(0)
    df["floorName"] = df["floorName"].fillna("Unknown floor")
    df["buildingName"] = df["buildingName"].fillna("Unknown site")
    df["address"] = df["address"].fillna(df["buildingName"])

    wifi7 = df[(df["APModel9176I"] + df["APModel9178I"]) > 0].copy()

    sites = build_site_records(wifi7)
    payload = {
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "counts": {
            "customers": int(wifi7["accountName"].nunique()),
            "sites": int(len(sites)),
            "floors": int(len(wifi7)),
            "ap9176": int(wifi7["APModel9176I"].sum()),
            "ap9178": int(wifi7["APModel9178I"].sum()),
        },
        "sites": sites,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {OUTPUT} ({len(sites)} sites)")


if __name__ == "__main__":
    main()
