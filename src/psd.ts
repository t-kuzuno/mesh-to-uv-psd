import { writePsd } from 'ag-psd';
import type { Layer, PixelData, Psd, SectionDividerType } from 'ag-psd';
import type { ComboResult } from './types';

function createGroup(name: string): Layer {
  return {
    name,
    opened: true,
    hidden: false,
    sectionDivider: {
      type: 1 as SectionDividerType,
      key: 'pass',
      subType: 0,
    },
    children: [],
  };
}

export function buildPsd(
  width: number,
  height: number,
  combos: ComboResult[],
  coverage: Uint8Array,
): ArrayBuffer {
  const objectGroups = new Map<string, Layer>();
  const rootLayers: Layer[] = [];

  for (const combo of combos) {
    let objectGroup = objectGroups.get(combo.objectId);
    if (!objectGroup) {
      objectGroup = createGroup(combo.objectName);
      objectGroups.set(combo.objectId, objectGroup);
      rootLayers.push(objectGroup);
    }

    const uvGroup = createGroup(combo.uvLabel);
    objectGroup.children!.push(uvGroup);

    for (const mask of combo.masks) {
      const imageData: PixelData = {
        data: mask.data,
        width: mask.width,
        height: mask.height,
      };

      uvGroup.children!.push({
        name: `Island ${String(mask.islandIndex + 1).padStart(3, '0')}`,
        top: mask.top,
        left: mask.left,
        imageData,
        mask: {
          top: mask.top,
          left: mask.left,
          defaultColor: 0,
          positionRelativeToLayer: true,
          imageData,
        },
      });
    }
  }

  const composite = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < coverage.length; i += 1) {
    if (!coverage[i]) continue;
    const offset = i * 4;
    composite[offset] = 255;
    composite[offset + 1] = 255;
    composite[offset + 2] = 255;
    composite[offset + 3] = 255;
  }

  const psd: Psd = {
    width,
    height,
    children: rootLayers,
    imageData: {
      data: composite,
      width,
      height,
    },
  };

  return writePsd(psd, {
    noBackground: true,
    generateThumbnail: false,
  });
}
