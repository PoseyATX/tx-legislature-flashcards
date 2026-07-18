#!/usr/bin/env python3
"""
Scrape Texas Legislature member data from official sources.

Sources:
  - House:  https://house.texas.gov/members
  - Senate: https://senate.texas.gov/members.php
  - Senate parties: https://senate.texas.gov/directory.php

Writes data/members.json for the flashcard app.
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HOUSE_URL = "https://house.texas.gov/members"
SENATE_URL = "https://senate.texas.gov/members.php"
SENATE_DIRECTORY_URL = "https://senate.texas.gov/directory.php"
USER_AGENT = "TXLegislatureFlashcards/1.0 (+https://github.com/PoseyATX/tx-legislature-flashcards; educational)"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", errors="replace")


def scrape_house() -> list[dict]:
    page = fetch(HOUSE_URL)
    match = re.search(r':members="(\[.*)', page)
    if not match:
        raise RuntimeError("Could not find embedded House members JSON on house.texas.gov/members")

    start = match.start(1)
    end = page.find(']"', start)
    if end < 0:
        raise RuntimeError("Could not parse House members JSON attribute")

    raw = html_lib.unescape(page[start : end + 1])
    rows = json.loads(raw)

    members: list[dict] = []
    for row in rows:
        if not row.get("active"):
            continue

        name_raw = html_lib.unescape(row["member_name"])
        if "," in name_raw:
            last, first = name_raw.split(",", 1)
            display = f"{first.strip()} {last.strip()}"
        else:
            display = name_raw

        bill_code = row["member_bill_code"]
        members.append(
            {
                "id": f"H-{bill_code}",
                "name": display,
                "nameSort": name_raw,
                "chamber": "House",
                "district": int(row["id"]),
                "photo": f"https://house.texas.gov/images/members/{bill_code}.jpg",
                "url": str(row["link"]).replace("\\/", "/"),
                "party": None,
            }
        )

    return members


def scrape_senate() -> list[dict]:
    page = fetch(SENATE_URL)
    blocks = re.findall(
        r'<div class="mempicdiv"><a href="(member\.php\?d=(\d+))">'
        r'<img src="([^"]+)" alt="([^"]*)"></a><br>'
        r'<a href="[^"]+">([^<]+)</a><br>'
        r'<span class="shrinkb">District (\d+)</span></div>',
        page,
    )

    parties = scrape_senate_parties()
    members: list[dict] = []

    for _href, dist, img, _alt, name, _dist2 in blocks:
        name = re.sub(r"\s+", " ", html_lib.unescape(name)).strip()
        # Vacant seats use a placeholder label
        if "Constituent Services" in name:
            continue

        if not img.startswith("http"):
            img = "https://senate.texas.gov/" + img.lstrip("/")

        district = int(dist)
        members.append(
            {
                "id": f"S-{district}",
                "name": name,
                "nameSort": name,
                "chamber": "Senate",
                "district": district,
                "photo": img,
                "url": f"https://senate.texas.gov/member.php?d={district}",
                "party": parties.get(district),
            }
        )

    return members


def scrape_senate_parties() -> dict[int, str]:
    page = fetch(SENATE_DIRECTORY_URL)
    pairs = re.findall(
        r"member\.php\?d=(\d+)[^>]*>.*?</a>.*?>(Democrat|Republican)<",
        page,
        flags=re.S | re.I,
    )
    return {int(district): party.title() for district, party in pairs}


def build_dataset() -> dict:
    house = scrape_house()
    senate = scrape_senate()
    members = sorted(
        house + senate,
        key=lambda m: (0 if m["chamber"] == "House" else 1, m["district"], m["name"]),
    )

    return {
        "meta": {
            "houseSource": HOUSE_URL,
            "senateSource": SENATE_URL,
            "scrapedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "legislature": "89th Legislature",
            "houseCount": len(house),
            "senateCount": len(senate),
            "totalCount": len(members),
            "notes": (
                "Vacant seats are excluded. House party affiliation is not published on the "
                "official members list; Senate party is taken from the Senate directory."
            ),
        },
        "members": members,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Scrape TX Legislature members into JSON")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "data" / "members.json",
        help="Output JSON path (default: data/members.json)",
    )
    args = parser.parse_args()

    dataset = build_dataset()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dataset, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    meta = dataset["meta"]
    print(
        f"Wrote {meta['totalCount']} members "
        f"({meta['houseCount']} House, {meta['senateCount']} Senate) → {args.output}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 — CLI entrypoint
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
