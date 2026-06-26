import "server-only";
import sharp from "sharp";

/**
 * Knock out the flat light background that gemini-2.5-flash-image bakes in when
 * asked for a transparent tile (it draws an opaque light-gray "transparency"
 * checkerboard instead of real alpha). Tiles must be alpha-transparent so they
 * composite cleanly on the isometric grid.
 *
 * Strategy: magic-wand flood-fill from the image borders. A pixel is treated as
 * background only if it is BOTH light-and-near-gray AND connected to an edge
 * through other background pixels. Connectivity is the key — it keys the whole
 * checkerboard/white surround while preserving light pixels INSIDE the building
 * (cream sauce, pale noodles, window glass), which the border can't reach.
 */

// A pixel counts as background-colored if it's bright and nearly desaturated.
function isBgColor(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min <= 28 && (r + g + b) / 3 >= 188;
}

export async function removeBackground(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const channels = 4 as const; // ensureAlpha guarantees RGBA
  const px = (x: number, y: number) => (y * width + x) * channels;

  const visited = new Uint8Array(width * height);
  // Typed stack of pixel indices (x,y packed) — BFS/DFS over the border region.
  const stack: number[] = [];

  const seed = (x: number, y: number) => {
    const i = y * width + x;
    if (visited[i]) return;
    const o = i * channels;
    if (isBgColor(data[o], data[o + 1], data[o + 2])) {
      visited[i] = 1;
      stack.push(x, y);
    }
  };

  // Seed every border pixel that looks like background.
  for (let x = 0; x < width; x++) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    seed(0, y);
    seed(width - 1, y);
  }

  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    data[px(x, y) + 3] = 0; // make transparent

    // 4-connected neighbours
    const tryNext = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
      const ni = ny * width + nx;
      if (visited[ni]) return;
      const o = ni * channels;
      if (isBgColor(data[o], data[o + 1], data[o + 2])) {
        visited[ni] = 1;
        stack.push(nx, ny);
      }
    };
    tryNext(x - 1, y);
    tryNext(x + 1, y);
    tryNext(x, y - 1);
    tryNext(x, y + 1);
  }

  // Sprites render at <=~95px on screen, so a full-res ~1k PNG is ~2.6MB of dead
  // weight. Downscale to 512px max + palette-quantise: pixel-art has a limited
  // palette, so this is near-lossless but ~10-20x smaller (huge first-load win).
  return sharp(data, { raw: { width, height, channels } })
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
    .png({ palette: true, quality: 90, effort: 7 })
    .toBuffer();
}
