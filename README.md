# Who's Who · Texas Legislature

Mobile-first flash cards to learn **faces and names** of Texas House and Senate members.

Built for people who need this on their phone between meetings—not for power users who want settings menus.

## How to use (the whole app)

1. **See a face**
2. **Tap the card** (or **Show name**) to flip
3. **Swipe right** or tap **Know them** if you had it
4. **Swipe left** or tap **Don't know** if you didn't

That's it. No quizzes to type through. No scrolling. No chamber pickers.

Under the hood, **SM-2 spaced repetition** (Anki-style) brings missed faces back soon and spaces out the ones you know.

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
