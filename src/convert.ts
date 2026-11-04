import { buildPsd } from './psd';
import { rasterizeEdges, rasterizeIslands } from './raster';
import type { ComboResult, ConvertOptions, LoadedModel } from './types';
import { buildUVIslands } from './uv';

export interface ConversionResult {
  psd: ArrayBuffer;
  combos: ComboResult[];
  coverage: Uint8Array;
  edgeCoverage: Uint8Array;
  width: number;
  height: number;
  totalIslands: number;
  elapsedMs: number;
}

export interface ConversionCallbacks {
  onStatus?: (message: string) => void;
  onProgress?: (progress: number) => void;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function convertModel(
  model: LoadedModel,
  options: ConvertOptions,
  callbacks: ConversionCallbacks = {},
): Promise<ConversionResult> {
  const started = performance.now();
  const { resolution, selections } = options;
  const padding = Math.max(0, Math.floor(options.padding));
  const edgeWidth = Math.max(1, Math.floor(options.edgeWidth));
  const objects = new Map(model.objects.map((object) => [object.id, object]));
  const uniqueSelections = new Set<string>();
  const coverage = new Uint8Array(resolution * resolution);
  const edgeCoverage = new Uint8Array(resolution * resolution);
  const combos: ComboResult[] = [];

  const tasks = selections.filter((selection) => {
    const key = `${selection.objectId}\u0000${selection.uvKey}`;
    if (uniqueSelections.has(key)) return false;
    uniqueSelections.add(key);
    return objects.has(selection.objectId);
  });

  if (tasks.length === 0) {
    throw new Error('変換するオブジェクトとUVチャンネルを選択してください。');
  }

  for (let index = 0; index < tasks.length; index += 1) {
    const selection = tasks[index];
    const object = objects.get(selection.objectId)!;
    const uvChannel = object.uvChannels.find((channel) => channel.key === selection.uvKey);
    if (!uvChannel) continue;

    callbacks.onStatus?.(`UVアイランドを解析中: ${object.name} / ${uvChannel.label}`);
    callbacks.onProgress?.(index / tasks.length);
    await nextFrame();

    const triangles = buildUVIslands(object.geometry, selection.uvKey);
    if (triangles.islandCount === 0) continue;

    callbacks.onStatus?.(`マスクを生成中: ${object.name} / ${uvChannel.label}`);
    const masks = await rasterizeIslands(triangles, resolution, coverage, padding, (progress) => {
      callbacks.onProgress?.((index + progress * 0.75) / tasks.length);
    });

    if (masks.length === 0) continue;

    callbacks.onStatus?.(`UVエッジを生成中: ${object.name} / ${uvChannel.label}`);
    const edgeLayer = await rasterizeEdges(triangles, resolution, edgeWidth, (progress) => {
      callbacks.onProgress?.((index + 0.75 + progress * 0.25) / tasks.length);
    });

    if (edgeLayer) {
      for (let y = 0; y < edgeLayer.height; y += 1) {
        const sourceRow = y * edgeLayer.width * 4;
        const targetRow = (edgeLayer.top + y) * resolution + edgeLayer.left;

        for (let x = 0; x < edgeLayer.width; x += 1) {
          if (edgeLayer.data[sourceRow + x * 4 + 3] === 0) continue;
          edgeCoverage[targetRow + x] = 255;
        }
      }
    }

    combos.push({
      objectId: object.id,
      objectName: object.name,
      objectPath: object.path,
      uvLabel: uvChannel.label,
      uvKey: uvChannel.key,
      islandCount: masks.length,
      masks,
      edgeLayer,
    });
  }

  if (combos.length === 0) {
    throw new Error('選択されたUVチャンネルから表示可能なUVアイランドが見つかりませんでした。');
  }

  callbacks.onStatus?.('PSDを書き出し中...');
  callbacks.onProgress?.(0.95);
  await nextFrame();

  const psd = buildPsd(resolution, resolution, combos, coverage, edgeCoverage);
  const totalIslands = combos.reduce((total, combo) => total + combo.masks.length, 0);

  callbacks.onStatus?.('完了');
  callbacks.onProgress?.(1);

  return {
    psd,
    combos,
    coverage,
    edgeCoverage,
    width: resolution,
    height: resolution,
    totalIslands,
    elapsedMs: performance.now() - started,
  };
}
