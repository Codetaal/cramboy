# Changelog

CheeseLab uses [semantic versioning](https://semver.org): patch = fixes, minor = new features, major = big changes.

## 1.1.4
- In-box subtitles are now full width and stick to the bottom of the top screen, with square corners, top and bottom borders and no side borders.

## 1.1.3
- The subtitle bar never shows more than two lines, like the game's own text box.
- The subtitle bar is slightly see-through, with a blur and soft text shadow so it stays readable.
- The translate button always stays top-left on the main screen, also in bar mode; the bar sits on the bottom screen in landscape too. The separate star button in the bar is gone.

## 1.1.2
- The live subtitle bar now sits at the top of the bottom screen, so the main game screen stays clear.

## 1.1.1
- The in-game 가 button is now a translate icon on a soft square, matching the menu buttons.
- The button no longer shows the saved-word count (it's still in the words sheet).

## 1.1.0
- New look built with Tailwind CSS: cards, amber accent buttons and badges, and cleaner light and dark modes.
- All icons are Heroicons (MIT), including the sound toggle, menu and word sheets.
- Word sheets redesigned: Save star button, dictionary card with particle badges, highlighted sentence, and a segmented Now / Saved / Recent switch.
- Much smaller hand-written CSS; styles are built with `npm run build:css`.

## 1.0.5 (2026-11-10)

- All icons are now Heroicons (menu, fast forward, sound on/off, play, arrows, add, stars, links, close)
- Icons optically aligned with the text next to them (row arrows, stars, buttons)

## 1.0.4 (2026-11-10)

- Renamed the app to CheeseLab
- The gold CheeseLab flask is the app icon again; the blue DS icon is kept in docs/icons/unused

## 1.0.3 (2026-11-10)

- New CheeseLab DS icon: the CheeseLab flask on a blue sky with a round gold "DS" badge in the top corner
- CheeseLab master logo saved in docs/icons/cheeselab-logo-512.png
- Removed the slogan from the start screen

## 1.0.2 (2026-11-10)

- Game icons in the list are no longer cut off at the corners

## 1.0.1 (2026-11-10)

- Support link on the start screen

## 1.0.0 (2026-11-10)

First release as CheeseLab DS.

- DS emulator (desmume-wasm, built from source) as an iPhone Home Screen web app, works offline
- Korean subtitles read live from game memory for Pokémon HeartGold/SoulSilver (Gen 4) and Black/White (Gen 5)
- Subtitle modes: in the game's own text box, as a bar, or off (tap 가)
- Tap a word: offline dictionary with particle and verb-ending handling; save words with their sentence; export to Anki
- iOS-style start screen with a game library (3 recent, All Games, swipe to remove, undo)
- Light and dark mode, following the iPhone setting
- Controls below the screens or floating, with press animations
- Save export/import (.dsz/.sav/.dsv) and memory snapshots for adding new games
- Checks that opened files are DS games
