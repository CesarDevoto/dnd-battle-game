#!/usr/bin/env bash
#
# blender-export.sh — make a Blender-importable copy of a shipped GLB.
#
#   bash tools/blender-export.sh assets/models/owlbear.glb
#   bash tools/blender-export.sh assets/models/*.glb
#
# Output lands in blender-exports/ (gitignored). The shipped assets are NOT touched.
#
# WHY THIS EXISTS
# ---------------
# Blender's glTF importer supports Draco, NOT EXT_meshopt_compression — hence
# "extension EXT_meshopt_compression is not available in this addon version".
# Nothing is wrong with the models; Blender simply cannot read that extension.
#
# The game's GLBs also carry two other things Blender may reject depending on version:
#   • KHR_mesh_quantization  (int16 vertex data — cuts GPU memory; older Blender chokes)
#   • EXT_texture_webp       (Blender only added WebP support in 4.0)
#
# This strips all three, leaving plain vanilla glTF with PNG textures and
# `extensionsRequired: none`. Rigs, skins and animation clips all survive.
#
# ROUND-TRIPPING BACK INTO THE GAME
# ---------------------------------
# After editing in Blender, export a .glb and re-optimize it before committing — do NOT
# ship the fat uncompressed file, and do NOT use `gltf-transform meshopt`, whose prune pass
# silently strips Skin objects and breaks the rig. Use:
#
#   npx gltf-transform resize in.glb out.glb --width 512 --height 512
#   npx gltf-transform optimize out.glb final.glb --compress meshopt \
#       --prune false --simplify false --flatten false --join false \
#       --instance false --palette false --texture-compress false
#
# Texture size is what drives RAM (w*h*4 bytes, regardless of file size), so keep it at 512.
set -u
cd "$(dirname "$0")/.." || exit 1

OUT="blender-exports"
mkdir -p "$OUT"

if [ $# -eq 0 ]; then
  echo "usage: bash tools/blender-export.sh <file.glb> [more.glb ...]"
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for f in "$@"; do
  [ -f "$f" ] || { echo "skip (not found): $f"; continue; }
  base="$(basename "$f")"
  echo "→ $base"

  # 1. drop EXT_meshopt_compression (the one Blender explicitly rejects).
  #    Every other flag is off so nothing touches the mesh graph or the rig.
  npx --yes gltf-transform optimize "$f" "$TMP/a.glb" \
      --compress false --prune false --simplify false --flatten false \
      --join false --instance false --palette false --texture-compress false \
      >/dev/null 2>&1 || { echo "   FAILED (decompress)"; continue; }

  # 2. drop KHR_mesh_quantization → plain float32 vertex data
  npx --yes gltf-transform dequantize "$TMP/a.glb" "$TMP/b.glb" >/dev/null 2>&1 \
      || { echo "   FAILED (dequantize)"; continue; }

  # 3. webp → png. --formats "*" is REQUIRED: without it the command silently skips
  #    webp inputs and leaves EXT_texture_webp in extensionsRequired.
  npx --yes gltf-transform png "$TMP/b.glb" "$OUT/$base" --formats "*" >/dev/null 2>&1 \
      || { echo "   FAILED (png)"; continue; }

  echo "   → $OUT/$base"
done

echo
echo "Done. Import from $OUT/ — these have extensionsRequired: none."
