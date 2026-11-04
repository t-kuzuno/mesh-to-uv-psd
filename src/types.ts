import type { BufferGeometry } from 'three';

export type ModelFormat = 'fbx' | 'obj' | 'glb' | 'gltf';

export interface UVChannel {
  key: string;
  label: string;
  index: number;
  itemSize: number;
}

export interface MeshObject {
  id: string;
  name: string;
  path: string;
  geometry: BufferGeometry;
  uvChannels: UVChannel[];
  triangleCount: number;
}

export interface LoadedModel {
  fileName: string;
  format: ModelFormat;
  objects: MeshObject[];
  meshCount: number;
  withoutUvCount: number;
}

export interface Selection {
  objectId: string;
  uvKey: string;
}

export interface ConvertOptions {
  resolution: number;
  selections: Selection[];
}

export interface IslandMask {
  islandIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  triangleCount: number;
  pixelCount: number;
}

export interface ComboResult {
  objectId: string;
  objectName: string;
  objectPath: string;
  uvLabel: string;
  uvKey: string;
  islandCount: number;
  masks: IslandMask[];
}
