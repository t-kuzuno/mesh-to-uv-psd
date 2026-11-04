import { LoadingManager, Mesh } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { LoadedModel, MeshObject, ModelFormat, UVChannel } from './types';

function getFormat(fileName: string): ModelFormat {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'fbx' || extension === 'obj' || extension === 'glb' || extension === 'gltf') {
    return extension;
  }
  throw new Error('対応形式は .fbx / .obj / .glb / .gltf です。');
}

function uvIndex(key: string): number {
  if (key === 'uv') return 0;
  const match = /^uv(\d+)$/.exec(key);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function findUVChannels(geometry: BufferGeometry): UVChannel[] {
  const channels: UVChannel[] = [];

  for (const [key, attribute] of Object.entries(geometry.attributes)) {
    if (!/^uv\d*$/.test(key) || attribute.itemSize < 2 || attribute.count === 0) continue;
    const index = uvIndex(key);
    channels.push({
      key,
      index,
      label: `UV${index} (${key})`,
      itemSize: attribute.itemSize,
    });
  }

  return channels.sort((a, b) => a.index - b.index);
}

function objectPath(object: Object3D): string {
  const names: string[] = [];
  let current: Object3D | null = object;

  while (current) {
    if (current.name) names.push(current.name);
    current = current.parent;
  }

  return names.reverse().join(' / ') || object.type;
}

function collectObjects(root: Object3D): { objects: MeshObject[]; meshCount: number; withoutUvCount: number } {
  const objects: MeshObject[] = [];
  const nameCounts = new Map<string, number>();
  let meshCount = 0;
  let withoutUvCount = 0;

  root.traverse((child) => {
    if (!(child as Mesh).isMesh) return;

    const mesh = child as Mesh;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    if (!position || position.count === 0) return;

    meshCount += 1;
    const uvChannels = findUVChannels(geometry);
    if (uvChannels.length === 0) {
      withoutUvCount += 1;
      return;
    }

    const baseName = mesh.name || `Mesh ${objects.length + 1}`;
    const occurrence = (nameCounts.get(baseName) ?? 0) + 1;
    nameCounts.set(baseName, occurrence);
    const uniqueName = occurrence === 1 ? baseName : `${baseName} #${occurrence}`;
    const indexAttributes = geometry.getIndex();
    const triangleCount = Math.floor((indexAttributes?.count ?? position.count) / 3);

    objects.push({
      id: `mesh-${objects.length}`,
      name: uniqueName,
      path: objectPath(mesh),
      geometry,
      uvChannels,
      triangleCount,
    });
  });

  return { objects, meshCount, withoutUvCount };
}

function createGLTFLoader(): GLTFLoader {
  const manager = new LoadingManager();
  const loader = new GLTFLoader(manager);
  const dracoLoader = new DRACOLoader(manager);
  loader.setDRACOLoader(dracoLoader);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

async function parseGLTF(data: ArrayBuffer | string): Promise<Object3D> {
  const loader = createGLTFLoader();
  return new Promise<Object3D>((resolve, reject) => {
    loader.parse(
      data,
      '',
      (gltf) => resolve(gltf.scene),
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

async function parseFBX(data: ArrayBuffer): Promise<Object3D> {
  return new Promise<Object3D>((resolve, reject) => {
    try {
      const loader = new FBXLoader(new LoadingManager());
      resolve(loader.parse(data, ''));
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function loadModelFile(file: File): Promise<LoadedModel> {
  const format = getFormat(file.name);
  let root: Object3D;

  if (format === 'fbx') {
    root = await parseFBX(await file.arrayBuffer());
  } else if (format === 'obj') {
    root = new OBJLoader().parse(await file.text());
  } else if (format === 'glb') {
    root = await parseGLTF(await file.arrayBuffer());
  } else {
    root = await parseGLTF(await file.text());
  }

  const collected = collectObjects(root);

  if (collected.objects.length === 0) {
    throw new Error(
      collected.meshCount === 0
        ? 'メッシュが見つかりませんでした。'
        : 'UVを持つメッシュが見つかりませんでした。',
    );
  }

  return {
    fileName: file.name,
    format,
    objects: collected.objects,
    meshCount: collected.meshCount,
    withoutUvCount: collected.withoutUvCount,
  };
}
