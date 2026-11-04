import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readPsd } from 'ag-psd';
import puppeteer from 'puppeteer-core';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 4173;
const deployedUrl = process.env.E2E_BASE_URL;
const baseUrl = deployedUrl ?? `http://127.0.0.1:${port}/`;
const workDir = mkdtempSync(join(tmpdir(), 'mesh-to-uv-psd-e2e-'));
const downloadDir = join(workDir, 'downloads');
const objPath = join(workDir, 'two-objects.obj');
const glbPath = join(workDir, 'two-uv-channels.glb');

writeFileSync(
  objPath,
  `o QuadA
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vt 0 0
vt 0.4 0
vt 0.4 0.4
vt 0 0.4
vt 0.6 0.6
vt 1 0.6
vt 1 1
vt 0.6 1
f 1/1 2/2 3/3
f 1/1 3/3 4/4
f 1/5 2/6 3/7
f 1/5 3/7 4/8
o QuadB
v 2 0 0
v 3 0 0
v 3 1 0
v 2 1 0
vt 0 0
vt 0.3 0
vt 0.3 0.3
vt 0 0.3
vt 0.5 0.5
vt 1 0.5
vt 1 1
vt 0.5 1
f 5/9 6/10 7/11
f 5/9 7/11 8/12
f 5/13 6/14 7/15
f 5/13 7/15 8/16
`,
  'utf8',
);

function makeGLB() {
  const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
  const uv0 = [0, 0, 0.4, 0, 0.4, 0.4, 0, 0.4];
  const uv1 = [0.6, 0.6, 1, 0.6, 1, 1, 0.6, 1];
  const indices = [0, 1, 2, 0, 2, 3];
  const positionBytes = Buffer.alloc(positions.length * 4);
  const uv0Bytes = Buffer.alloc(uv0.length * 4);
  const uv1Bytes = Buffer.alloc(uv1.length * 4);
  const indexBytes = Buffer.alloc(indices.length * 2);

  positions.forEach((value, index) => positionBytes.writeFloatLE(value, index * 4));
  uv0.forEach((value, index) => uv0Bytes.writeFloatLE(value, index * 4));
  uv1.forEach((value, index) => uv1Bytes.writeFloatLE(value, index * 4));
  indices.forEach((value, index) => indexBytes.writeUInt16LE(value, index * 2));

  const positionOffset = 0;
  const uv0Offset = positionBytes.length;
  const uv1Offset = uv0Offset + uv0Bytes.length;
  const indexOffset = uv1Offset + uv1Bytes.length;
  const bin = Buffer.concat([positionBytes, uv0Bytes, uv1Bytes, indexBytes]);

  const gltf = {
    asset: { version: '2.0', generator: 'mesh-to-uv-psd test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'TwoUVQuads' }],
    meshes: [
      {
        name: 'TwoUVQuads',
        primitives: [
          {
            attributes: { POSITION: 0, TEXCOORD_0: 1, TEXCOORD_1: 2 },
            indices: 3,
            mode: 4,
          },
        ],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 4,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: positionOffset, byteLength: positionBytes.length },
      { buffer: 0, byteOffset: uv0Offset, byteLength: uv0Bytes.length },
      { buffer: 0, byteOffset: uv1Offset, byteLength: uv1Bytes.length },
      { buffer: 0, byteOffset: indexOffset, byteLength: indexBytes.length },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  const jsonBuffer = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4;
  const binPadding = (4 - (bin.length % 4)) % 4;
  const jsonChunkLength = jsonBuffer.length + jsonPadding;
  const binChunkLength = bin.length + binPadding;
  const totalLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;
  const glb = Buffer.alloc(totalLength);

  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(totalLength, 8);
  glb.writeUInt32LE(jsonChunkLength, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  jsonBuffer.copy(glb, 20);
  glb.fill(0x20, 20 + jsonBuffer.length, 20 + jsonChunkLength);
  const binChunkStart = 20 + jsonChunkLength;
  glb.writeUInt32LE(binChunkLength, binChunkStart);
  glb.writeUInt32LE(0x004e4942, binChunkStart + 4);
  bin.copy(glb, binChunkStart + 8);
  return glb;
}

writeFileSync(glbPath, makeGLB());

function startPreview() {
  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--port', String(port), '--strictPort'],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    },
  );
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await delay(250);
  }
  throw new Error('Vite preview server did not start.');
}

function countLayers(children) {
  if (!children) return 0;
  let count = 0;
  for (const child of children) {
    if (child.children) count += countLayers(child.children);
    else count += 1;
  }
  return count;
}

function countEdgeLayers(children) {
  if (!children) return 0;
  let count = 0;
  for (const child of children) {
    if (child.children) count += countEdgeLayers(child.children);
    else if (child.name === 'UV Edges') count += 1;
  }
  return count;
}

async function waitForFile(directory, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(directory).filter((name) => name.endsWith('.psd'));
    if (files.length > 0) return join(directory, files[0]);
    await delay(250);
  }
  throw new Error('PSD download did not appear.');
}

const server = deployedUrl ? null : startPreview();
let browser;

try {
  await waitForServer();

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,1000'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
  });
  const { mkdirSync } = await import('node:fs');
  mkdirSync(downloadDir, { recursive: true });

  await page.goto(baseUrl, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#dropzone');

  const input = await page.$('#fileInput');
  await input.uploadFile(objPath);

  await page.waitForSelector('#workspace:not(.hidden)', { timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelectorAll('#objectList .object').length === 2,
    { timeout: 30000 },
  );

  const selectedCount = await page.$eval('#selectionCount', (element) => element.textContent);
  if (selectedCount !== '2') {
    throw new Error(`Expected 2 selected channels, got ${selectedCount}`);
  }

  await page.screenshot({ path: join(workDir, 'ui-loaded.png'), fullPage: true });

  await page.click('#convertButton');
  await page.waitForSelector('#resultCard:not(.hidden)', { timeout: 120000 });

  const stats = await page.$eval('#stats', (element) => element.textContent?.replace(/\s+/g, ' ').trim());
  const previewVisible = await page.$eval('#previewCanvas', (canvas) => {
    const context = canvas.getContext('2d');
    if (!context) return false;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return true;
    }
    return false;
  });

  if (!previewVisible) {
    throw new Error('Preview canvas is empty.');
  }

  await page.click('#downloadButton');
  const psdPath = await waitForFile(downloadDir);
  const bytes = readFileSync(psdPath);
  if (bytes.subarray(0, 4).toString('ascii') !== '8BPS') {
    throw new Error('Downloaded file is not a PSD.');
  }

  const parsed = readPsd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
    useRawData: true,
    skipCompositeImageData: true,
  });
  const layers = countLayers(parsed.children);
  if (layers !== 6) {
    throw new Error(`Expected 6 PSD layers, got ${layers}`);
  }
  const edgeLayers = countEdgeLayers(parsed.children);
  if (edgeLayers !== 2) {
    throw new Error(`Expected 2 UV edge layers, got ${edgeLayers}`);
  }

  await page.screenshot({ path: join(workDir, 'ui-result.png'), fullPage: true });

  const downloadDir2 = join(workDir, 'downloads-glb');
  const { mkdirSync: mkdirSync2 } = await import('node:fs');
  mkdirSync2(downloadDir2, { recursive: true });
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir2,
  });

  const input2 = await page.$('#fileInput');
  await input2.uploadFile(glbPath);
  await page.waitForFunction(
    () =>
      document.querySelectorAll('#objectList .object').length === 1 &&
      document.querySelectorAll('#objectList input[data-role="uv"]').length === 2,
    { timeout: 30000 },
  );

  const initialUvSelection = await page.$eval('#selectionCount', (element) => element.textContent);
  if (initialUvSelection !== '1') {
    throw new Error(`Expected the first UV channel to be selected by default, got ${initialUvSelection}`);
  }

  await page.click('#selectAllButton');
  const allUvSelection = await page.$eval('#selectionCount', (element) => element.textContent);
  if (allUvSelection !== '2') {
    throw new Error(`Expected 2 selected UV channels, got ${allUvSelection}`);
  }

  await page.click('#convertButton');
  await page.waitForSelector('#resultCard:not(.hidden)', { timeout: 120000 });
  const glbStats = await page.$eval('#stats', (element) =>
    element.textContent?.replace(/\s+/g, ' ').trim(),
  );

  await page.click('#downloadButton');
  const glbPsdPath = await waitForFile(downloadDir2);
  const glbBytes = readFileSync(glbPsdPath);
  const glbParsed = readPsd(
    glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength),
    { useRawData: true, skipCompositeImageData: true },
  );
  const glbLayers = countLayers(glbParsed.children);
  if (glbLayers !== 4) {
    throw new Error(`Expected 4 PSD layers from the two UV channels, got ${glbLayers}`);
  }
  const glbEdgeLayers = countEdgeLayers(glbParsed.children);
  if (glbEdgeLayers !== 2) {
    throw new Error(`Expected 2 UV edge layers from the two UV channels, got ${glbEdgeLayers}`);
  }

  await page.screenshot({ path: join(workDir, 'ui-multi-uv.png'), fullPage: true });

  if (consoleErrors.length > 0) {
    throw new Error(`Browser errors: ${consoleErrors.join(' | ')}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        selectedChannels: selectedCount,
        stats,
        psdBytes: bytes.byteLength,
        psdLayers: layers,
        edgeLayers,
        multiUvStats: glbStats,
        multiUvPsdLayers: glbLayers,
        multiUvEdgeLayers: glbEdgeLayers,
        screenshots: [
          join(workDir, 'ui-loaded.png'),
          join(workDir, 'ui-result.png'),
          join(workDir, 'ui-multi-uv.png'),
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
  await delay(500);
  if (existsSync(downloadDir)) {
    // leave temp files for inspection
  }
}
