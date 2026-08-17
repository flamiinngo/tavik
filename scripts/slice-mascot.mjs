#!/usr/bin/env node
/**
 * Slice the Tavik character sheet into per-state assets.
 *
 * The supplied sheet is a 4x2 grid on a transparent background. Poses are named
 * for the product state they serve rather than for what they depict, so call
 * sites read as intent (`verified`) rather than as art direction
 * (`bird-with-shield`). If a pose is redrawn, the filename stays correct.
 *
 * Naive grid slicing is not enough: several poses overhang their cell, so a
 * fixed 384x512 crop catches a fragment of the neighbour. Column-projection
 * heuristics are not enough either — a fragment sitting close to the pose merges
 * with it. So each cell is treated as a bitmap: its alpha channel is segmented
 * into connected components, the largest is taken to be the intended pose, and
 * every other component is erased before cropping. A fragment that is not
 * touching the pose cannot survive that, whatever its size or position.
 *
 * The sheet is the source of truth and stays committed at
 * public/mascot/tavik-character-sheet.png. This script is re-runnable.
 *
 * Run:  npm run mascot:slice
 */

import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sheetPath = join(projectRoot, "public", "mascot", "tavik-character-sheet.png");
const outDir = join(projectRoot, "public", "mascot");

const COLUMNS = 4;
const ROWS = 2;

/** Alpha at or below this is antialiasing fringe, not content. */
const ALPHA_THRESHOLD = 16;
/** Transparent padding kept around the cropped pose, in source pixels. */
const PADDING = 8;
/** Emitted widths. */
const WIDTHS = [192, 384];

/**
 * Grid position → product state.
 *
 * Restraint is deliberate: the brief calls for the mascot in a handful of
 * meaningful places, not everywhere. Each entry maps to a real state the product
 * can actually be in.
 */
const POSES = [
  { col: 0, row: 0, name: "hero", use: "Marketing hero. Standing, hands on hips, authoritative." },
  { col: 1, row: 0, name: "analyzing", use: "Progress and analysis sequences. Moving forward." },
  { col: 2, row: 0, name: "alert", use: "Violation detected (RED). Crouched, alert." },
  { col: 3, row: 0, name: "watching", use: "Dashboard idle. Arms crossed, on watch." },
  { col: 0, row: 1, name: "standby", use: "Empty states and onboarding. Front-facing, wings folded." },
  { col: 1, row: 1, name: "profile", use: "Small avatar, notifications, work-log header." },
  { col: 2, row: 1, name: "working", use: "Tavik Work Log. Seated with a laptop, working." },
  { col: 3, row: 1, name: "verified", use: "Boundary verified (GREEN). Holding a shield." },
];

const meta = await sharp(sheetPath).metadata();
if (meta.width !== 1536 || meta.height !== 1024) {
  console.error(
    `Expected a 1536x1024 sheet, found ${meta.width}x${meta.height}. Update the ` +
      `grid maths before slicing, or the poses will be cropped incorrectly.`,
  );
  process.exit(1);
}

const { data, info } = await sharp(sheetPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const sheetWidth = info.width;
const channels = info.channels;
const cellWidth = Math.round(meta.width / COLUMNS);
const cellHeight = Math.round(meta.height / ROWS);

/**
 * Label connected components of the cell's alpha mask and return the largest.
 *
 * Iterative flood fill with an explicit stack — the components here span
 * hundreds of thousands of pixels, deep enough that recursion would overflow.
 * 8-connectivity, so a pose joined only diagonally (a cape tip, a claw) stays
 * one component rather than being split and partly erased.
 */
function largestComponent(mask, width, height) {
  const labels = new Int32Array(width * height).fill(-1);
  let bestLabel = -1;
  let bestSize = 0;
  let nextLabel = 0;

  const stack = [];
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || labels[seed] !== -1) continue;

    const label = nextLabel++;
    let size = 0;
    stack.push(seed);
    labels[seed] = label;

    while (stack.length > 0) {
      const index = stack.pop();
      size++;
      const x = index % width;
      const y = (index / width) | 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = ny * width + nx;
          if (mask[neighbour] && labels[neighbour] === -1) {
            labels[neighbour] = label;
            stack.push(neighbour);
          }
        }
      }
    }

    if (size > bestSize) {
      bestSize = size;
      bestLabel = label;
    }
  }

  return { labels, bestLabel, bestSize };
}

await mkdir(outDir, { recursive: true });

for (const pose of POSES) {
  const x0 = pose.col * cellWidth;
  const y0 = pose.row * cellHeight;

  // Copy the cell out of the sheet, building an alpha mask alongside it.
  const cell = Buffer.alloc(cellWidth * cellHeight * 4);
  const mask = new Uint8Array(cellWidth * cellHeight);

  for (let y = 0; y < cellHeight; y++) {
    for (let x = 0; x < cellWidth; x++) {
      const source = ((y0 + y) * sheetWidth + (x0 + x)) * channels;
      const target = (y * cellWidth + x) * 4;
      cell[target] = data[source];
      cell[target + 1] = data[source + 1];
      cell[target + 2] = data[source + 2];
      const alpha = data[source + 3];
      cell[target + 3] = alpha;
      mask[y * cellWidth + x] = alpha > ALPHA_THRESHOLD ? 1 : 0;
    }
  }

  const { labels, bestLabel, bestSize } = largestComponent(mask, cellWidth, cellHeight);
  if (bestLabel === -1) {
    console.error(`cell (${pose.col},${pose.row}) is empty — skipping ${pose.name}`);
    continue;
  }

  // Erase everything that is not the pose, and measure what remains.
  let minX = cellWidth;
  let minY = cellHeight;
  let maxX = -1;
  let maxY = -1;
  let erased = 0;

  for (let y = 0; y < cellHeight; y++) {
    for (let x = 0; x < cellWidth; x++) {
      const index = y * cellWidth + x;
      if (labels[index] === bestLabel) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else if (cell[index * 4 + 3] !== 0) {
        cell[index * 4 + 3] = 0;
        erased++;
      }
    }
  }

  const left = Math.max(0, minX - PADDING);
  const top = Math.max(0, minY - PADDING);
  const region = {
    left,
    top,
    width: Math.min(cellWidth - 1, maxX + PADDING) - left + 1,
    height: Math.min(cellHeight - 1, maxY + PADDING) - top + 1,
  };

  const cleaned = sharp(cell, {
    raw: { width: cellWidth, height: cellHeight, channels: 4 },
  }).extract(region);

  const cropped = await cleaned.png().toBuffer();

  for (const width of WIDTHS) {
    const suffix = width === Math.max(...WIDTHS) ? "" : `@${width}`;
    const base = `tavik-${pose.name}${suffix}`;
    const resized = sharp(cropped).resize({ width });

    await resized.clone().png({ compressionLevel: 9 }).toFile(join(outDir, `${base}.png`));
    await resized.clone().webp({ quality: 90 }).toFile(join(outDir, `${base}.webp`));
  }

  console.log(
    `• tavik-${pose.name.padEnd(10)} ${String(region.width).padStart(3)}x${region.height}` +
      `  kept ${bestSize.toLocaleString()}px` +
      (erased > 0 ? `, erased ${erased.toLocaleString()}px of neighbour bleed` : "") +
      `  — ${pose.use}`,
  );
}

console.log(
  `\nWrote ${POSES.length * WIDTHS.length * 2} files to public/mascot/.\n` +
    `Import them through src/components/mascot/Tavik.tsx, not by path, so the\n` +
    `pose-to-state mapping stays in one place.`,
);
