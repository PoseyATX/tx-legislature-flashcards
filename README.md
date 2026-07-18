# Texas Legislature Flash Cards

A browser-based flash card game to help you learn the faces and names of members of the **Texas Legislature** (House of Representatives and Senate).

**Live data sources**

- [Texas House Members](https://house.texas.gov/members)
- [Texas Senate Members](https://senate.texas.gov/members.php)

Photos and names are taken from those official directories for educational use.

## Play locally

No build step required — any static file server works:

```bash
# Python
python3 -m http.server 8080

# or Node
npx --yes serve .
```

Then open `http://localhost:8080`.

## Features

- **Photo → Name** — see an official portrait, pick the correct legislator
- **Name → Photo** — given a name, pick the matching portrait
- **District → Name** — given chamber + district, identify the member
- Filter by **House**, **Senate**, or **All**
- 2 / 4 / 6 multiple-choice difficulty
- Local score, streak, and best-streak tracking (browser `localStorage`)
- Keyboard: `1`–`6` choose, `Space` reveal, `N` next card

## Refresh member data

Member lists change after elections and special elections. Re-scrape from the official sites:

```bash
python3 scripts/scrape_members.py
```

This overwrites `data/members.json`. Commit the updated file when you want to ship a new snapshot.

### Dataset notes

- House: 150 members (89th Legislature snapshot at scrape time)
- Senate: 30 members when District 22 is vacant (vacant seats are excluded)
- Senate party affiliation is taken from the [Senate directory](https://senate.texas.gov/directory.php)
- House party is not published on the official members list, so it is left blank

## Project layout

```
├── index.html              # App shell
├── src/
│   ├── main.js             # Game logic
│   └── styles.css          # UI
├── data/
│   └── members.json        # Scraped member snapshot
└── scripts/
    └── scrape_members.py   # Refresh data from official sites
```

## Deploy (GitHub Pages)

1. Settings → Pages → Source: **Deploy from a branch**
2. Branch: `main` / folder: `/ (root)`
3. Site will serve `index.html` and load `data/members.json`

## License

Member photos and biographical presentation remain the property of the Texas House of Representatives and Texas Senate. This project is an independent educational tool and is not affiliated with the Texas Legislature.

Code in this repository is available under the MIT License (see `LICENSE`).
