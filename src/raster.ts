import { NO_ISLAND } from './uv';
import type { UVTriangleSet } from './uv';
import type { EdgeLayer, IslandMask } from './types';

const EDGE_EPSILON = 1e-7;
const TRIANGLE_CHUNK = 20000;
const ROW_CHUNK = 128;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function dilateMask(mask: IslandMask, radius: number): void {
  if (radius <= 0 || mask.width === 0 || mask.height === 0) return;

  const { width, height, data } = mask;
  const r = Math.floor(radius);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let count = 0;
    const initial = Math.min(r, width);

    for (let x = 0; x < initial; x += 1) {
      if (data[(row + x) * 4] !== 0) count += 1;
    }

    for (let x = 0; x < width; x += 1) {
      const add = x + r;
      if (add < width && data[(row + add) * 4] !== 0) count += 1;
      const remove = x - r - 1;
      if (remove >= 0 && data[(row + remove) * 4] !== 0) count -= 1;
      data[(row + x) * 4 + 3] = count > 0 ? 255 : 0;
    }
  }

  for (let x = 0; x < width; x += 1) {
    let count = 0;
    const initial = Math.min(r, height);

    for (let y = 0; y < initial; y += 1) {
      if (data[(y * width + x) * 4 + 3] !== 0) count += 1;
    }

    for (let y = 0; y < height; y += 1) {
      const add = y + r;
      if (add < height && data[(add * width + x) * 4 + 3] !== 0) count += 1;
      const remove = y - r - 1;
      if (remove >= 0 && data[(remove * width + x) * 4 + 3] !== 0) count -= 1;
      data[(y * width + x) * 4] = count > 0 ? 255 : 0;
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    const value = data[i];
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = value;
  }
}

function clipLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  maxX: number,
  maxY: number,
): [number, number, number, number] | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0, maxX - x0, y0, maxY - y0];
  let t0 = 0;
  let t1 = 1;

  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }

    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }

  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

function drawLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number,
  plot: (x: number, y: number) => void,
): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  const startOffset = -Math.floor((thickness - 1) / 2);
  const endOffset = startOffset + thickness - 1;
  let error = dx + dy;

  while (true) {
    for (let oy = startOffset; oy <= endOffset; oy += 1) {
      for (let ox = startOffset; ox <= endOffset; ox += 1) {
        plot(x + ox, y + oy);
      }
    }

    if (x === x1 && y === y1) break;
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
}

export async function rasterizeIslands(
  data: UVTriangleSet,
  resolution: number,
  coverage: Uint8Array,
  padding = 0,
  onProgress?: (progress: number) => void,
): Promise<IslandMask[]> {
  if (data.islandCount === 0 || resolution <= 0) return [];

  const pixelCount = resolution * resolution;
  const pad = Math.max(0, Math.floor(padding));
  const islandMap = new Int32Array(pixelCount).fill(-1);
  const minX = new Int32Array(data.islandCount).fill(resolution);
  const minY = new Int32Array(data.islandCount).fill(resolution);
  const maxX = new Int32Array(data.islandCount).fill(-1);
  const maxY = new Int32Array(data.islandCount).fill(-1);
  const { cornerUV, islandOfTriangle } = data;

  for (let t = 0; t < data.triangleCount; t += 1) {
    const islandIndex = islandOfTriangle[t];
    if (islandIndex === NO_ISLAND) continue;

    const offset = t * 6;
    const ax = cornerUV[offset] * resolution;
    const ay = (1 - cornerUV[offset + 1]) * resolution;
    const bx = cornerUV[offset + 2] * resolution;
    const by = (1 - cornerUV[offset + 3]) * resolution;
    const cx = cornerUV[offset + 4] * resolution;
    const cy = (1 - cornerUV[offset + 5]) * resolution;

    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < EDGE_EPSILON) continue;

    const sign = area > 0 ? 1 : -1;
    const triMinX = Math.min(ax, bx, cx);
    const triMaxX = Math.max(ax, bx, cx);
    const triMinY = Math.min(ay, by, cy);
    const triMaxY = Math.max(ay, by, cy);
    const startX = Math.max(0, Math.floor(triMinX));
    const endX = Math.min(resolution - 1, Math.ceil(triMaxX) - 1);
    const startY = Math.max(0, Math.floor(triMinY));
    const endY = Math.min(resolution - 1, Math.ceil(triMaxY) - 1);

    if (startX > endX || startY > endY) continue;

    if (startX < minX[islandIndex]) minX[islandIndex] = startX;
    if (startY < minY[islandIndex]) minY[islandIndex] = startY;
    if (endX > maxX[islandIndex]) maxX[islandIndex] = endX;
    if (endY > maxY[islandIndex]) maxY[islandIndex] = endY;

    const edge0A = -(cy - by);
    const edge0B = cx - bx;
    const edge0C = (cy - by) * bx - (cx - bx) * by;
    const edge1A = -(ay - cy);
    const edge1B = ax - cx;
    const edge1C = (ay - cy) * cx - (ax - cx) * cy;
    const edge2A = -(by - ay);
    const edge2B = bx - ax;
    const edge2C = (by - ay) * ax - (bx - ax) * ay;

    for (let y = startY; y <= endY; y += 1) {
      const py = y + 0.5;
      const rowOffset = y * resolution;
      let e0 = edge0A * (startX + 0.5) + edge0B * py + edge0C;
      let e1 = edge1A * (startX + 0.5) + edge1B * py + edge1C;
      let e2 = edge2A * (startX + 0.5) + edge2B * py + edge2C;

      for (let x = startX; x <= endX; x += 1) {
        if (
          sign * e0 >= -EDGE_EPSILON &&
          sign * e1 >= -EDGE_EPSILON &&
          sign * e2 >= -EDGE_EPSILON
        ) {
          islandMap[rowOffset + x] = islandIndex;
        }
        e0 += edge0A;
        e1 += edge1A;
        e2 += edge2A;
      }
    }

    if (t > 0 && t % TRIANGLE_CHUNK === 0) {
      onProgress?.((t / data.triangleCount) * 0.6);
      await nextFrame();
    }
  }

  const masks: Array<IslandMask | null> = new Array(data.islandCount).fill(null);

  for (let islandIndex = 0; islandIndex < data.islandCount; islandIndex += 1) {
    if (maxX[islandIndex] < minX[islandIndex] || maxY[islandIndex] < minY[islandIndex]) continue;

    const left = Math.max(0, minX[islandIndex] - pad);
    const top = Math.max(0, minY[islandIndex] - pad);
    const right = Math.min(resolution - 1, maxX[islandIndex] + pad);
    const bottom = Math.min(resolution - 1, maxY[islandIndex] + pad);
    const width = right - left + 1;
    const height = bottom - top + 1;

    masks[islandIndex] = {
      islandIndex,
      left,
      top,
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      triangleCount: data.islandTriangleCounts[islandIndex] ?? 0,
      pixelCount: 0,
    };
  }

  for (let y = 0; y < resolution; y += 1) {
    const rowOffset = y * resolution;

    for (let x = 0; x < resolution; x += 1) {
      const islandIndex = islandMap[rowOffset + x];
      if (islandIndex < 0) continue;

      const mask = masks[islandIndex];
      if (!mask) continue;

      const localX = x - mask.left;
      const localY = y - mask.top;
      const maskOffset = (localY * mask.width + localX) * 4;
      mask.data[maskOffset] = 255;
      mask.data[maskOffset + 1] = 255;
      mask.data[maskOffset + 2] = 255;
      mask.data[maskOffset + 3] = 255;
    }

    if (y > 0 && y % ROW_CHUNK === 0) {
      onProgress?.(0.6 + (y / resolution) * 0.15);
      await nextFrame();
    }
  }

  const result: IslandMask[] = [];
  const visibleMasks = masks.filter((mask): mask is IslandMask => mask !== null);

  for (let index = 0; index < visibleMasks.length; index += 1) {
    const mask = visibleMasks[index];
    dilateMask(mask, pad);

    let pixelCount = 0;
    for (let localY = 0; localY < mask.height; localY += 1) {
      const sourceRow = localY * mask.width * 4;
      const targetRow = (mask.top + localY) * resolution;

      for (let localX = 0; localX < mask.width; localX += 1) {
        if (mask.data[sourceRow + localX * 4] === 0) continue;
        mask.data[sourceRow + localX * 4 + 1] = 255;
        mask.data[sourceRow + localX * 4 + 2] = 255;
        mask.data[sourceRow + localX * 4 + 3] = 255;
        coverage[targetRow + mask.left + localX] = 255;
        pixelCount += 1;
      }
    }

    mask.pixelCount = pixelCount;
    if (pixelCount > 0) result.push(mask);

    onProgress?.(0.75 + ((index + 1) / visibleMasks.length) * 0.25);
    if (index > 0 && index % 8 === 0) await nextFrame();
  }

  onProgress?.(1);
  return result;
}

export async function rasterizeEdges(
  data: UVTriangleSet,
  resolution: number,
  lineWidth = 1,
  onProgress?: (progress: number) => void,
): Promise<EdgeLayer | null> {
  if (data.triangleCount === 0 || resolution <= 0) return null;

  const pixelCount = resolution * resolution;
  const edgeMap = new Uint8Array(pixelCount);
  const thickness = Math.max(1, Math.floor(lineWidth));
  let edgeMinX = resolution;
  let edgeMinY = resolution;
  let edgeMaxX = -1;
  let edgeMaxY = -1;

  const plot = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= resolution || y >= resolution) return;
    edgeMap[y * resolution + x] = 255;
    if (x < edgeMinX) edgeMinX = x;
    if (y < edgeMinY) edgeMinY = y;
    if (x > edgeMaxX) edgeMaxX = x;
    if (y > edgeMaxY) edgeMaxY = y;
  };

  for (let t = 0; t < data.triangleCount; t += 1) {
    if (data.islandOfTriangle[t] === NO_ISLAND) continue;

    const offset = t * 6;
    const scale = resolution - 1;
    const points = [
      [data.cornerUV[offset] * scale, (1 - data.cornerUV[offset + 1]) * scale],
      [data.cornerUV[offset + 2] * scale, (1 - data.cornerUV[offset + 3]) * scale],
      [data.cornerUV[offset + 4] * scale, (1 - data.cornerUV[offset + 5]) * scale],
    ] as const;

    for (let edge = 0; edge < 3; edge += 1) {
      const [x0, y0] = points[edge];
      const [x1, y1] = points[(edge + 1) % 3];
      const clipped = clipLine(x0, y0, x1, y1, resolution - 1, resolution - 1);
      if (!clipped) continue;
      drawLine(
        Math.round(clipped[0]),
        Math.round(clipped[1]),
        Math.round(clipped[2]),
        Math.round(clipped[3]),
        thickness,
        plot,
      );
    }

    if (t > 0 && t % TRIANGLE_CHUNK === 0) {
      onProgress?.((t / data.triangleCount) * 0.9);
      await nextFrame();
    }
  }

  if (edgeMaxX < edgeMinX || edgeMaxY < edgeMinY) return null;

  const width = edgeMaxX - edgeMinX + 1;
  const height = edgeMaxY - edgeMinY + 1;
  const rgba = new Uint8ClampedArray(width * height * 4);
  let pixels = 0;

  for (let y = 0; y < height; y += 1) {
    const sourceRow = (edgeMinY + y) * resolution + edgeMinX;
    const targetRow = y * width;

    for (let x = 0; x < width; x += 1) {
      if (edgeMap[sourceRow + x] === 0) continue;
      const offset = (targetRow + x) * 4;
      rgba[offset] = 0;
      rgba[offset + 1] = 0;
      rgba[offset + 2] = 0;
      rgba[offset + 3] = 255;
      pixels += 1;
    }
  }

  onProgress?.(1);

  return {
    left: edgeMinX,
    top: edgeMinY,
    width,
    height,
    data: rgba,
    pixelCount: pixels,
  };
}
