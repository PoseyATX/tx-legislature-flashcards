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

### Spaced repetition (Anki / SuperMemo SM-2)

Cards are **not** drawn at random. Each member is a card with SM-2 fields (`ease`, `interval`, `reps`, `due`, learning steps). The study queue is:

1. **Due learning / relearning** (failed cards on short steps: 1m → 10m)
2. **Due reviews** (most overdue first)
3. **New cards** in a fixed order (House by district, then Senate), capped at **20 new/day**

After each answer you grade with **Again / Hard / Good / Easy** (interval previews shown). Wrong answers return soon; mastered cards are scheduled days/months out.

Progress is stored in `localStorage` (`tx-leg-flashcards-srs-v2`).

### Mastery-based input (per card)

Input difficulty tracks that card’s SRS maturity:

| Mastery   | When                         | Input                         |
|-----------|------------------------------|-------------------------------|
| Learning  | New / learning steps         | Photo → 2-choice (+ district hint) |
| Young     | Early reviews                | Photo → 4-choice              |
| Familiar  | Growing interval             | Photo → 6-choice              |
| Strong    | Interval approaching mature  | Type **last name**            |
| Mastered  | Interval ≥ 21 days           | Type **full name**            |

### Mobile app UX

- **3D flip** — `Flip` rotates the card 180° (`transform: rotateY`) to the answer face
- **Swipe grade** — swipe **right = Got it** (Good), swipe **left = Missed** (Again); card flies off and the next drops in
- **Viewport-safe shell** — `100svh` / `100dvh` app grid, `overflow: hidden`, safe-area insets; no page scroll on iOS Safari / Android Chrome
- Chamber filter, optional Anki strip (Again/Hard/Good/Easy) on the back face
- Keys: `Space`/`F` flip · `←` missed · `→` got it · `1`–`4` fine grades when flipped

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
