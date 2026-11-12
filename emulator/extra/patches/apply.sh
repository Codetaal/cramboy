#!/bin/bash
# Small fixes to the upstream desmume-wasm source, applied by build.sh (safe to run more than once).
set -e
S=$1
# mc.cpp: the backup device shares the frontend's in-memory save file (savFile). Its destructor
# deleted that shared object, so the next emulator reset (which loading a save state does) crashed.
if ! grep -q "CHEESELAB: keep shared savFile" "$S/mc.cpp"; then
  python3 - "$S/mc.cpp" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = "BackupDevice::~BackupDevice()\n{\n\tdelete fpMC;\n\tfpMC = NULL;\n}"
new = ("BackupDevice::~BackupDevice()\n{\n\textern EMUFILE_MEMORY* savFile; // CHEESELAB: keep shared savFile\n"
       "\tif (fpMC != savFile) delete fpMC;\n\tfpMC = NULL;\n}")
assert s.count(old) == 1, 'mc.cpp destructor not found'
open(p, 'w').write(s.replace(old, new))
PY
  echo "patched mc.cpp (savFile)"
fi
# mc.cpp: loading a save state for a game without save memory called ensure(0), which seeks to
# position -1 and makes the in-memory save file try to grow to 4 GB (std::length_error).
if ! grep -q "CHEESELAB: no save memory" "$S/mc.cpp"; then
  python3 - "$S/mc.cpp" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = "\tensure(data.size(), fpMC);\n"
new = "\tif (data.size() != 0) ensure(data.size(), fpMC); // CHEESELAB: no save memory\n"
assert s.count(old) == 1, 'ensure(data.size()) not found'
open(p, 'w').write(s.replace(old, new))
PY
  echo "patched mc.cpp (empty save)"
fi
# slot1.cpp / slot2.cpp: this build leaves some device slots empty (R4, debug), but looking a device
# up by ID (done when loading a save state) didn't skip the empty ones and crashed.
for f in slot1 slot2; do
  if ! grep -q "CHEESELAB: skip empty" "$S/$f.cpp"; then
    python3 - "$S/$f.cpp" "$f" <<'PY'
import sys
p, f = sys.argv[1], sys.argv[2]; s = open(p).read()
old = "\t\tif (%s_List[i]->info()->id() == ID)\n" % f
new = "\t\tif (%s_List[i] && %s_List[i]->info()->id() == ID) // CHEESELAB: skip empty slots\n" % (f, f)
assert s.count(old) == 1, f + ' getTypeByID not found'
open(p, 'w').write(s.replace(old, new))
PY
    echo "patched $f.cpp"
  fi
done
