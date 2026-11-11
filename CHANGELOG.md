# Changelog

CheeseLab uses [semantic versioning](https://semver.org): patch = fixes, minor = new features, major = big changes.

## 1.3.3
- No more "Game saved" pop-ups: the in-game save is backed up quietly, and you only get a message if a backup fails.
- When a game starts with an existing in-game save, the message says "Your last in-game save is ready" (no message for a game without a save).
- "Back to game" is pinned to the bottom of the word sheets; the content above it scrolls underneath.

## 1.3.2
- The star and the saved-word count line up exactly (Saved tab and menu).

## 1.3.1
- Word sheet has a back button (top-left) to the Now, Saved words or Recent tab you came from; from the subtitles it goes to Now.

## 1.3.0
- One notification style for the whole app: a dark toast at the top with an icon (check, star, bin, warning or info) and an optional Undo. Replaces the three different styles used before.
- Portrait: the translate button is a slowly wobbling blob (still when Reduce Motion is on), slightly bigger and lighter.

## 1.2.6
- In portrait, the menu and word sheets always have the same height: exactly the bottom half of the screen.

## 1.2.5
- In portrait, the menu and the word sheets cover at most the bottom screen, so the game screen stays visible; longer content scrolls.
- Word sheets have the same grab handle as the menu.
- All cards in the sheets share the same padding and spacing (the Now text box now matches the others).

## 1.2.4
- Portrait: the translate button moved into the empty centre of the controls, between menu/fast forward and SELECT, and is a bit larger. Landscape is unchanged.

## 1.2.3
- The word sheet's sentence link now opens Google Translate (Korean to English) and is labelled "Google".

## 1.2.2
- Loading a game now shows a floating card with the game's icon, name and a progress bar, instead of a status line that pushed the start screen down.
- The movable subtitle box no longer snaps up and down, only to the left and right edges.

## 1.2.1
- In-box subtitles: the dotted underline on the second line is no longer cut off.
- The menu button turns amber while the menu is open, and fast forward stays amber while it's on.

## 1.2.0
- The in-box subtitles can be moved and resized: drag the grip on the top edge to move the box anywhere, and the corner handle to resize it.
- Text size follows the box height (always two lines) and only shrinks when a line would not fit the width.
- The box snaps to the screen edges, stays on screen, and remembers its place separately for portrait and landscape.
- New menu option "Reset subtitle box position" (shown in In box mode).

## 1.1.5
- In-box subtitles keep full width but get their rounded corners and side borders back.
- The box starts a few pixels higher, so the edge of the game's own text box no longer peeks out above it.

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
