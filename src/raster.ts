import { NO_ISLAND } from './uv';
import type { UVTriangleSet } from './uv';
import type { IslandMask } from './types';

const EDGE_EPSILON = 1e-7;
const TRIANGLE_CHUNK = 20000;
const ROW_CHUNK = 128;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function rasterizeIslands(
  data: UVTriangleSet,
  resolution: number,
  coverage: Uint8Array,
  onProgress?: (progress: number) => void,
): Promise<IslandMask[]> {
  if (data.islandCount === 0 || resolution <= 0) return [];

  const pixelCount = resolution * resolution;
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
      onProgress?.((t / data.triangleCount) * 0.65);
      await nextFrame();
    }
  }

  const masks: Array<IslandMask | null> = new Array(data.islandCount).fill(null);

  for (let islandIndex = 0; islandIndex < data.islandCount; islandIndex += 1) {
    if (maxX[islandIndex] < minX[islandIndex] || maxY[islandIndex] < minY[islandIndex]) continue;

    const width = maxX[islandIndex] - minX[islandIndex] + 1;
    const height = maxY[islandIndex] - minY[islandIndex] + 1;
    masks[islandIndex] = {
      islandIndex,
      left: minX[islandIndex],
      top: minY[islandIndex],
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
      mask.pixelCount += 1;
      coverage[rowOffset + x] = 255;
    }

    if (y > 0 && y % ROW_CHUNK === 0) {
      onProgress?.(0.65 + (y / resolution) * 0.35);
      await nextFrame();
    }
  }

  const result: IslandMask[] = [];
  for (const mask of masks) {
    if (mask && mask.pixelCount > 0) result.push(mask);
  }

  onProgress?.(1);
  return result;
}
