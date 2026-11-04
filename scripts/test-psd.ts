import { readPsd } from 'ag-psd';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { buildPsd } from '../src/psd.ts';
import { rasterizeEdges, rasterizeIslands } from '../src/raster.ts';
import type { ComboResult } from '../src/types.ts';
import { buildUVIslands } from '../src/uv.ts';

function makeTwoIslandGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
        2, 0, 0, 3, 0, 0, 3, 1, 0, 2, 1, 0,
      ],
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    new Float32BufferAttribute(
      [
        0, 0, 0.4, 0, 0.4, 0.4, 0, 0.4,
        0.6, 0.6, 1, 0.6, 1, 1, 0.6, 1,
      ],
      2,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return geometry;
}

async function main(): Promise<void> {
  const geometry = makeTwoIslandGeometry();
  const triangles = buildUVIslands(geometry, 'uv');
  if (triangles.islandCount !== 2) {
    throw new Error(`Expected 2 islands, got ${triangles.islandCount}`);
  }

  const resolution = 64;
  const padding = 2;
  const coverage = new Uint8Array(resolution * resolution);
  const unpaddedCoverage = new Uint8Array(resolution * resolution);
  const unpaddedMasks = await rasterizeIslands(triangles, resolution, unpaddedCoverage, 0);
  const masks = await rasterizeIslands(triangles, resolution, coverage, padding);
  if (masks.length !== 2) {
    throw new Error(`Expected 2 visible islands, got ${masks.length}`);
  }
  if (masks.some((mask) => mask.pixelCount <= 0)) {
    throw new Error('A rasterized island has no pixels.');
  }

  const unpaddedPixels = unpaddedMasks.reduce((total, mask) => total + mask.pixelCount, 0);
  const paddedPixels = masks.reduce((total, mask) => total + mask.pixelCount, 0);
  if (paddedPixels <= unpaddedPixels) {
    throw new Error(`Mask padding did not expand the islands (${unpaddedPixels} -> ${paddedPixels}).`);
  }

  const grew = masks.some(
    (mask, index) =>
      mask.width > unpaddedMasks[index].width || mask.height > unpaddedMasks[index].height,
  );
  if (!grew) {
    throw new Error('Padded masks have the same bounds as unpadded masks.');
  }

  const edgeLayer = await rasterizeEdges(triangles, resolution, 1);
  if (!edgeLayer || edgeLayer.pixelCount <= 0) {
    throw new Error('UV edge layer was not rasterized.');
  }
  if (!edgeLayer.data.some((value, index) => index % 4 === 3 && value === 0)) {
    throw new Error('UV edge layer has no transparent pixels.');
  }
  if (!edgeLayer.data.some((value, index) => index % 4 === 3 && value === 255)) {
    throw new Error('UV edge layer has no opaque pixels.');
  }

  const edgeCoverage = new Uint8Array(resolution * resolution);
  for (let y = 0; y < edgeLayer.height; y += 1) {
    const sourceRow = y * edgeLayer.width * 4;
    const targetRow = (edgeLayer.top + y) * resolution + edgeLayer.left;
    for (let x = 0; x < edgeLayer.width; x += 1) {
      if (edgeLayer.data[sourceRow + x * 4 + 3] !== 0) edgeCoverage[targetRow + x] = 255;
    }
  }

  const combo: ComboResult = {
    objectId: 'mesh-0',
    objectName: 'TestObject',
    objectPath: 'TestObject',
    uvLabel: 'UV0 (uv)',
    uvKey: 'uv',
    islandCount: masks.length,
    masks,
    edgeLayer,
  };
  const psdBuffer = buildPsd(resolution, resolution, [combo], coverage, edgeCoverage);
  const bytes = new Uint8Array(psdBuffer);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== '8BPS') {
    throw new Error('Generated file is not a PSD.');
  }

  const parsed = readPsd(psdBuffer, {
    useRawData: true,
    skipCompositeImageData: true,
  });
  const objectGroup = parsed.children?.[0];
  const uvGroup = objectGroup?.children?.[0];
  const layers = uvGroup?.children ?? [];

  if (layers.length !== 3) {
    throw new Error(`Expected 3 PSD layers, got ${layers.length}`);
  }

  const edge = layers[0];
  if (edge.name !== 'UV Edges') {
    throw new Error(`Expected the edge layer first, got ${edge.name}`);
  }
  if (edge.mask) {
    throw new Error('UV edge layer must not have a layer mask.');
  }

  const edgeIds = (edge.rawData?.channels ?? []).map((channel) => channel.id);
  for (const expected of [-1, 0, 1, 2]) {
    if (!edgeIds.includes(expected)) {
      throw new Error(`Expected edge channel ${expected}, got ${edgeIds.join(', ')}`);
    }
  }
  if (edgeIds.includes(-2)) {
    throw new Error('UV edge layer unexpectedly has a mask channel.');
  }

  for (const layer of layers.slice(1)) {
    if (!layer.mask) {
      throw new Error('Layer mask was not written.');
    }
    if ((layer.right ?? 0) <= (layer.left ?? 0) || (layer.bottom ?? 0) <= (layer.top ?? 0)) {
      throw new Error('Layer has invalid bounds.');
    }

    const ids = (layer.rawData?.channels ?? []).map((channel) => channel.id);
    for (const expected of [-2, -1, 0, 1, 2]) {
      if (!ids.includes(expected)) {
        throw new Error(`Expected channel ${expected}, got ${ids.join(', ')}`);
      }
    }

    const maskChannel = layer.rawData?.channels.find((channel) => channel.id === -2);
    if (!maskChannel?.data?.byteLength) {
      throw new Error('Mask channel data is empty.');
    }
  }

  const path = join(tmpdir(), 'mesh-to-uv-psd-test.psd');
  writeFileSync(path, bytes);
  console.log(
    JSON.stringify(
      {
        ok: true,
        islands: masks.length,
        layers: layers.length,
        padding,
        unpaddedPixels,
        paddedPixels,
        edgePixels: edgeLayer.pixelCount,
        psdBytes: bytes.byteLength,
        output: path,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
