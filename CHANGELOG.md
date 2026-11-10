# Changelog

CheeseLab uses [semantic versioning](https://semver.org): patch = fixes, minor = new features, major = big changes.

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
