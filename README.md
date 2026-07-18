# Who's Who · Texas Legislature

Mobile-first flash cards to learn **faces and names** of Texas House and Senate members.

Built for people who need this on their phone between meetings—not for power users who want settings menus.

## How to use (the whole app)

1. **See a face** (official headshot, **5:7** frame — House standard 125×175)
2. **Tap the correct name** from 2–4 multiple-choice options (harder as you improve)
3. Right answer → XP + streak juice · wrong → card returns sooner (SM-2)
4. **Don't know** skips and counts as a miss

Under the hood, **SM-2 spaced repetition** and **Capitol ranks / XP** keep score honest.

## Why this exists

Lobbyists, staff, journalists, and folks around the Capitol shouldn't have to reverse-engineer a study app. This branch (`mobile-simple`) optimizes for:

- **One-thumb use** on iOS Safari / Android Chrome
- **Zero vertical scroll** (`100svh` shell)
- **Big portrait**, big buttons, obvious swipe stamps
- **Forgiving UX** — tap anywhere on the card to flip; dock always visible

## Run locally

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## Data

Official directories (educational use):

- [Texas House Members](https://house.texas.gov/members)
- [Texas Senate Members](https://senate.texas.gov/members.php)

Refresh:

```bash
python3 scripts/scrape_members.py
```

## Branches

| Branch | Intent |
|--------|--------|
| `main` | Full SRS UI (mastery inputs, filters, fine grades) |
| `mobile-simple` | **This** — politician / staff friendly, flip + swipe only |

## Support

If this saves you a hallway panic before a committee hearing, [buy a coffee on Ko-fi](https://ko-fi.com/poseyatx) — keeps the lights on and the model fed.

## Credits

Project: [PoseyATX](https://github.com/PoseyATX) · [Matthew C. Posey](https://www.linkedin.com/in/matthew-c-posey/) · [Ko-fi](https://ko-fi.com/poseyatx)

## License

MIT for code. Member photos/names remain property of the Texas House and Senate.
