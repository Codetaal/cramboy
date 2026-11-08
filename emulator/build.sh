#!/bin/bash
# Builds desmume-wasm (GPL-2) into nds.js + nds.wasm.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
UPSTREAM_COMMIT=1015846aa90741d22bd0e93286a7921e607685c2   # github.com/44670/desmume-wasm
if [ -z "$SRC" ]; then
  SRC=$HERE/desmume-wasm/desmume
  if [ ! -d "$SRC" ]; then
    git clone https://github.com/44670/desmume-wasm.git "$HERE/desmume-wasm"
    git -C "$HERE/desmume-wasm" checkout -q $UPSTREAM_COMMIT
  fi
fi
ZLIB=$HERE/zlib
if [ ! -f "$ZLIB/libz.a" ]; then
  git clone --depth 1 --branch v1.3.1 https://github.com/madler/zlib.git "$ZLIB"
  (cd "$ZLIB" && for f in adler32 compress crc32 deflate gzclose gzlib gzread gzwrite infback inffast inflate inftrees trees uncompr zutil; do emcc -O3 -DHAVE_UNISTD_H -c $f.c -o $f.o; done && emar rcs libz.a *.o)
fi
OUT=${OUT:-$HERE/../docs/build}
OBJ=${OBJ:-$HERE/obj}
SIMD=${SIMD:-0}
mkdir -p "$OUT" "$OBJ"
S=$SRC/src
FILES="armcpu.cpp arm_instructions.cpp bios.cpp cp15.cpp commandline.cpp common.cpp debug.cpp driver.cpp
Database.cpp emufile.cpp encrypt.cpp FIFO.cpp firmware.cpp GPU.cpp mc.cpp path.cpp readwrite.cpp wifi.cpp
MMU.cpp NDSSystem.cpp ROMReader.cpp render3D.cpp rtc.cpp saves.cpp slot1.cpp slot2.cpp SPU.cpp matrix.cpp
gfx3d.cpp thumb_instructions.cpp movie.cpp frontend/modules/Disassembler.cpp utils/advanscene.cpp utils/datetime.cpp
utils/guid.cpp utils/emufat.cpp utils/fsnitro.cpp utils/xstring.cpp utils/decrypt/crc.cpp utils/decrypt/decrypt.cpp
utils/decrypt/header.cpp utils/vfat.cpp utils/dlditool.cpp
utils/libfat/cache.cpp utils/libfat/directory.cpp utils/libfat/disc.cpp utils/libfat/fatdir.cpp utils/libfat/fatfile.cpp
utils/libfat/filetime.cpp utils/libfat/file_allocation_table.cpp utils/libfat/libfat.cpp utils/libfat/libfat_public_api.cpp
utils/libfat/lock.cpp utils/libfat/partition.cpp
utils/tinyxml/tinystr.cpp utils/tinyxml/tinyxml.cpp utils/tinyxml/tinyxmlerror.cpp utils/tinyxml/tinyxmlparser.cpp
utils/colorspacehandler/colorspacehandler.cpp
addons/slot2_auto.cpp addons/slot2_mpcf.cpp addons/slot2_paddle.cpp addons/slot2_gbagame.cpp addons/slot2_none.cpp
addons/slot2_rumblepak.cpp addons/slot2_guitarGrip.cpp addons/slot2_expMemory.cpp addons/slot2_piano.cpp addons/slot2_passme.cpp
addons/slot1_none.cpp addons/slot1_r4.cpp addons/slot1_retail_nand.cpp addons/slot1_retail_auto.cpp addons/slot1_retail_mcrom.cpp
addons/slot1_retail_mcrom_debug.cpp addons/slot1comp_mc.cpp addons/slot1comp_rom.cpp addons/slot1comp_protocol.cpp
filter/deposterize.cpp filter/xbrz.cpp cheatSystem.cpp texcache.cpp rasterize.cpp metaspu/metaspu.cpp version.cpp
libretro-common/compat/compat_getopt.c libretro-common/file/file_path.c libretro-common/compat/compat_strl.c
libretro-common/file/retro_dirent.c libretro-common/file/retro_stat.c
libretro-common/rthreads/async_job.c libretro-common/rthreads/rsemaphore.c libretro-common/rthreads/rthreads.c
libretro-common/encodings/encoding_utf.c"
COMMON="-O3 -DNDEBUG -DHAVE_LIBZ -D_GNU_SOURCE -I$S -I$S/libretro-common/include -I$S/frontend -I$ZLIB -Wno-everything"
[ "$SIMD" = 1 ] && COMMON="$COMMON -msimd128 -msse -msse2"
compile() {
  f=$1; o=$OBJ/$(echo "$f" | tr '/' '_').o
  if [ ! -f "$o" ] || [ "$S/$f" -nt "$o" ]; then
    case $f in *.c) emcc $COMMON -std=gnu11 -c "$S/$f" -o "$o";; *) em++ $COMMON -std=gnu++14 -c "$S/$f" -o "$o";; esac
  fi
}
export -f compile; export S OBJ COMMON ZLIB
echo $FILES | tr ' ' '\n' | grep -v '^$' | xargs -P ${JOBS:-8} -I{} bash -c 'compile {}'
em++ $COMMON -std=gnu++14 -c "$HERE/extra/main.cpp" -o "$OBJ/main.o"
em++ $COMMON -std=gnu++14 -c "$HERE/extra/wasm_extra.cpp" -o "$OBJ/wasm_extra.o"
EXPORTS='["_main","_malloc","_free","_realloc","_prepareRomBuffer","_loadROM","_reset","_runFrame","_getSymbol","_fillAudioBuffer","_setSampleRate","_savGetSize","_savGetPointer","_savUpdateChangeFlag","_emuSetOpt","_micWriteSamples"]'
em++ -O3 $OBJ/*.o -o "$OUT/nds.js" $ZLIB/libz.a -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=536870912 \
  -sEXPORTED_FUNCTIONS="$EXPORTS" -sEXPORTED_RUNTIME_METHODS='["HEAPU8"]' -sENVIRONMENT=web,worker,node -sFORCE_FILESYSTEM=1
ls -la "$OUT"
