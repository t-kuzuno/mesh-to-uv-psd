import type { BufferGeometry } from 'three';

export const NO_ISLAND = 0xffffffff;

export interface UVTriangleSet {
  triangleCount: number;
  cornerUV: Float32Array;
  islandOfTriangle: Uint32Array;
  islandCount: number;
  islandTriangleCounts: Uint32Array;
}

const UV_QUANTIZATION = 100000;

function find(parent: Int32Array, value: number): number {
  let root = value;

  while (parent[root] !== root) {
    root = parent[root];
  }

  let current = value;
  while (parent[current] !== current) {
    const next = parent[current];
    parent[current] = root;
    current = next;
  }

  return root;
}

function union(parent: Int32Array, rank: Uint8Array, a: number, b: number): void {
  let rootA = find(parent, a);
  let rootB = find(parent, b);
  if (rootA === rootB) return;

  if (rank[rootA] < rank[rootB]) {
    const swap = rootA;
    rootA = rootB;
    rootB = swap;
  }

  parent[rootB] = rootA;
  if (rank[rootA] === rank[rootB]) rank[rootA] += 1;
}

export function buildUVIslands(geometry: BufferGeometry, uvKey: string): UVTriangleSet {
  const uv = geometry.getAttribute(uvKey);
  const position = geometry.getAttribute('position');
  if (!uv || !position) {
    return {
      triangleCount: 0,
      cornerUV: new Float32Array(0),
      islandOfTriangle: new Uint32Array(0),
      islandCount: 0,
      islandTriangleCounts: new Uint32Array(0),
    };
  }

  const index = geometry.getIndex();
  const sourceVertexCount = index ? index.count : position.count;
  const triangleCount = Math.floor(sourceVertexCount / 3);
  const cornerUV = new Float32Array(triangleCount * 6);
  const cornerWeld = new Int32Array(triangleCount * 3);
  const validTriangles = new Uint8Array(triangleCount);
  const weldMap = new Map<string, number>();
  const edgeMap = new Map<number, number>();
  const maxWeldId = Math.max(1, triangleCount * 3);
  const parent = new Int32Array(triangleCount);
  const rank = new Uint8Array(triangleCount);

  for (let i = 0; i < triangleCount; i += 1) parent[i] = i;

  let weldCount = 0;

  for (let t = 0; t < triangleCount; t += 1) {
    let valid = true;

    for (let c = 0; c < 3; c += 1) {
      const sourceIndex = t * 3 + c;
      const vertexIndex = index ? index.getX(sourceIndex) : sourceIndex;

      if (vertexIndex < 0 || vertexIndex >= uv.count || vertexIndex >= position.count) {
        valid = false;
        break;
      }

      const u = uv.getX(vertexIndex);
      const v = uv.getY(vertexIndex);
      if (!Number.isFinite(u) || !Number.isFinite(v)) {
        valid = false;
        break;
      }

      const offset = t * 6 + c * 2;
      cornerUV[offset] = u;
      cornerUV[offset + 1] = v;

      const iu = Math.round(u * UV_QUANTIZATION);
      const iv = Math.round(v * UV_QUANTIZATION);
      const key = `${iu},${iv}`;
      let weldId = weldMap.get(key);
      if (weldId === undefined) {
        weldId = weldCount;
        weldCount += 1;
        weldMap.set(key, weldId);
      }
      cornerWeld[t * 3 + c] = weldId;
    }

    if (!valid) continue;
    validTriangles[t] = 1;

    for (let c = 0; c < 3; c += 1) {
      const a = cornerWeld[t * 3 + c];
      const b = cornerWeld[t * 3 + ((c + 1) % 3)];
      if (a === b) continue;
      const key = a < b ? a * maxWeldId + b : b * maxWeldId + a;
      const previous = edgeMap.get(key);

      if (previous === undefined) {
        edgeMap.set(key, t);
      } else {
        union(parent, rank, previous, t);
      }
    }
  }

  const rootToIsland = new Int32Array(triangleCount).fill(-1);
  const islandOfTriangle = new Uint32Array(triangleCount).fill(NO_ISLAND);
  const islandTriangleCounts: number[] = [];
  let islandCount = 0;

  for (let t = 0; t < triangleCount; t += 1) {
    if (!validTriangles[t]) continue;

    const root = find(parent, t);
    let islandIndex = rootToIsland[root];

    if (islandIndex < 0) {
      islandIndex = islandCount;
      islandCount += 1;
      rootToIsland[root] = islandIndex;
      islandTriangleCounts.push(0);
    }

    islandOfTriangle[t] = islandIndex;
    islandTriangleCounts[islandIndex] += 1;
  }

  edgeMap.clear();

  return {
    triangleCount,
    cornerUV,
    islandOfTriangle,
    islandCount,
    islandTriangleCounts: Uint32Array.from(islandTriangleCounts),
  };
}
