import { readPsd } from 'ag-psd';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { buildPsd } from '../src/psd.ts';
import { rasterizeIslands } from '../src/raster.ts';
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
  const coverage = new Uint8Array(resolution * resolution);
  const masks = await rasterizeIslands(triangles, resolution, coverage);
  if (masks.length !== 2) {
    throw new Error(`Expected 2 visible islands, got ${masks.length}`);
  }
  if (masks.some((mask) => mask.pixelCount <= 0)) {
    throw new Error('A rasterized island has no pixels.');
  }

  const combo: ComboResult = {
    objectId: 'mesh-0',
    objectName: 'TestObject',
    objectPath: 'TestObject',
    uvLabel: 'UV0 (uv)',
    uvKey: 'uv',
    islandCount: masks.length,
    masks,
  };
  const psdBuffer = buildPsd(resolution, resolution, [combo], coverage);
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

  if (layers.length !== 2) {
    throw new Error(`Expected 2 PSD layers, got ${layers.length}`);
  }

  for (const layer of layers) {
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
