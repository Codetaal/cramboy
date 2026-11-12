#!/bin/bash
# Builds the 44VBA GBA core (GPL-3.0, a VBA-Next fork) into docs/build-gba/gba.js + gba.wasm.
# The module is created with createGBA() so it never clashes with the DS emulator's global Module.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
UPSTREAM_COMMIT=e98726a   # github.com/44670/44vba
SRC=${SRC:-$HERE/44vba}
if [ ! -d "$SRC" ]; then
  git clone https://github.com/44670/44vba.git "$SRC"
  git -C "$SRC" checkout -q $UPSTREAM_COMMIT
fi
OUT=${OUT:-$HERE/../docs/build-gba}
mkdir -p "$OUT"
DEFS="-DUSE_KEYBOARD -DFRONTEND_SUPPORTS_RGB565 -DHAVE_STDINT_H -DINLINE=inline -DLSB_FIRST -DUSE_STATIC_WRAM -DUSE_CHEATS=1"
INC="-I$SRC/src -I$SRC/libretro -I$SRC/libretro-common/include"
EXPORTS='["_main","_emuGetSymbol","_emuRunFrame","_emuSetSampleRate","_emuLoadROM","_emuUpdateSavChangeFlag","_emuResetCpu","_emuStateBuffer","_emuStateSave","_emuStateLoad"]'
em++ -O3 -flto $DEFS $INC -Wno-everything \
  "$HERE/gba/main.cpp" "$SRC/src/gba.cpp" "$SRC/src/memory.cpp" "$SRC/src/sound.cpp" "$SRC/src/system.cpp" \
  "$SRC/src/ui.cpp" "$SRC/libretro/libretro.cpp" \
  -o "$OUT/gba.js" -sMODULARIZE=1 -sEXPORT_NAME=createGBA -sENVIRONMENT=web,worker,node \
  -sEXPORTED_FUNCTIONS="$EXPORTS" -sEXPORTED_RUNTIME_METHODS='["HEAPU8"]' -sINITIAL_MEMORY=134217728
ls -la "$OUT"
