// Small pieces the desmume-wasm source tree references but doesn't define.
#include "types.h"
#include "utils/decrypt/header.h"
#include "utils/decrypt/decrypt.h"
#include "mic.h"

extern int emuLastError;

// Accept already-decrypted dumps (the normal case); reject encrypted ones,
// matching the behaviour of the published desmume-wasm build.
bool DecryptSecureArea(u8 *romheader, u8 *secure) {
  Header *header = (Header *)romheader;
  int romType = DetectRomType(*header, (char *)secure);
  if (romType == ROMTYPE_INVALID) return false;
  if (romType == ROMTYPE_ENCRSECURE) { emuLastError = -1001; return false; }
  return true;
}

// Microphone input is fed from main.cpp (Mic_ReadSample); nothing to set up here.
BOOL Mic_Init(void) { return TRUE; }
void Mic_Reset(void) {}
void Mic_DeInit(void) {}
void Mic_DoNoise(BOOL) {}
