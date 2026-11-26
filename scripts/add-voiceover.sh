#!/usr/bin/env bash
# Synthesizes studio voiceover for assets/demo-walkthrough.mp4 using Gemini 3.8 Flash TTS
# (`gemini-api tts`) and proportionally syncs + muxes broadcast-normalized AAC audio cleanly
# into assets/demo-walkthrough-narrated.mp4 (and optionally replaces assets/demo-walkthrough.mp4
# with --replace-main).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VOICE="${VOICE:-Charon}"
MODEL="${MODEL:-gemini-3.8-flash-tts}"
DRY_RUN=0
REUSE_WAV=0
REPLACE_MAIN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --voice) VOICE="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --reuse-wav) REUSE_WAV=1; shift ;;
    --replace-main) REPLACE_MAIN=1; shift ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

IN_MP4="$ROOT_DIR/assets/demo-walkthrough.mp4"
OUT_WAV="$ROOT_DIR/assets/demo-walkthrough-voiceover.wav"
OUT_MP4="$ROOT_DIR/assets/demo-walkthrough-narrated.mp4"
SCRIPT_TMP="$(mktemp /tmp/pascal_structural_vo_XXXXXX.txt)"
trap 'rm -f "$SCRIPT_TMP"' EXIT

# Extract the clean ```text narration block from docs/WALKTHROUGH-SCRIPT.md
awk '/^```text$/{flag=1; next} /^```$/{flag=0} flag' "$ROOT_DIR/docs/WALKTHROUGH-SCRIPT.md" > "$SCRIPT_TMP"

if [[ ! -s "$SCRIPT_TMP" ]]; then
  echo "Failed to extract narration text from docs/WALKTHROUGH-SCRIPT.md" >&2
  exit 1
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "Dry-run preview (zero API cost):"
  gemini-api tts -f "$SCRIPT_TMP" -m "$MODEL" --voice "$VOICE" --language en-US --out "$OUT_WAV" --dry-run --output-format json
  exit 0
fi

if [[ ! -f "$IN_MP4" ]]; then
  echo "Missing $IN_MP4; run bun run render:walkthrough first." >&2
  exit 1
fi

if [[ "$REUSE_WAV" == "1" && -f "$OUT_WAV" ]]; then
  WAV_PATH="$OUT_WAV"
  echo "Reusing existing voiceover WAV: $WAV_PATH"
else
  echo "Synthesizing narration via $MODEL (voice=$VOICE)..."
  WAV_PATH="$(gemini-api tts -f "$SCRIPT_TMP" -m "$MODEL" --voice "$VOICE" --language en-US --out "$OUT_WAV")"
  echo "Generated voiceover WAV: $WAV_PATH"
fi

VID_DUR="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$IN_MP4")"
AUD_DUR="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$WAV_PATH")"
echo "Video duration: ${VID_DUR}s | Audio duration: ${AUD_DUR}s"

# Proportionally align video pacing to voiceover length (with +0.4s clean outro hold)
TARGET_DUR="$(python3 -c 'import sys; v=float(sys.argv[1]); a=float(sys.argv[2]); print(f"{max(v, a + 0.4):.2f}")' "$VID_DUR" "$AUD_DUR")"
PTS_SCALE="$(python3 -c 'import sys; v=float(sys.argv[1]); t=float(sys.argv[2]); print(f"{max(1.0, t / v):.4f}")' "$VID_DUR" "$TARGET_DUR")"
echo "Muxing proportionally synced video (setpts=${PTS_SCALE}*PTS, dur=${TARGET_DUR}s) + loudnorm AAC audio into $OUT_MP4..."

ffmpeg -y \
  -i "$IN_MP4" \
  -i "$WAV_PATH" \
  -filter_complex "[0:v]setpts=${PTS_SCALE}*PTS,fps=24[v];[1:a]loudnorm=I=-16:TP=-1.5:LRA=11[a]" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -ar 48000 \
  -t "$TARGET_DUR" \
  -movflags +faststart \
  "$OUT_MP4"

if [[ "$REPLACE_MAIN" == "1" ]]; then
  cp -f "$OUT_MP4" "$IN_MP4"
  echo "Updated main video: $IN_MP4 ($(du -h "$IN_MP4" | cut -f1))"
fi

echo "Ready: $OUT_MP4 ($(du -h "$OUT_MP4" | cut -f1))"
