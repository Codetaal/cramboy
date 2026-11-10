# Working on CheeseLab DS

## Release workflow (agreed with the owner)
1. Make changes locally and test them (browser tests with Playwright).
2. **Show a proposal first** (screenshots or a clear summary) and wait for an explicit OK before pushing. Committing locally is fine; pushing is not, until approved.
3. On approval, for every release:
   - Bump the semantic version in **both** `docs/emu.js` (`APP_VERSION`) and `docs/sw.js` (`VERSION = 'cheeselab-vX.Y.Z'`):
     patch = fixes, minor = new features, major = big changes.
   - Add an entry to `CHANGELOG.md`.
   - Push to `main`, then create and push a git tag `vX.Y.Z`.

## Don'ts
- Never rename the IndexedDB name `ds-korean` in `docs/kv.js`: it would wipe users' saves, games and saved words.
- No ROMs, Nintendo assets or game artwork in the repo. Game icons are only read from the user's own ROM at runtime.
- Keep the owner's work email out of commits.

## Layout
- `docs/` is the published site (GitHub Pages): `emu.js` frontend, `kr/` Korean subtitle reader, dictionary and overlay.
- `emulator/` builds desmume-wasm into `docs/build/`.
- `tools/` dictionary and icon generators; `tests/` unit tests (`node tests/*.test.js`).
