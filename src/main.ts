import './style.css';
import { convertModel } from './convert';
import type { ConversionResult } from './convert';
import { loadModelFile } from './loaders';
import type { LoadedModel, Selection } from './types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root was not found.');

app.innerHTML = `
  <div class="shell">
    <header class="hero">
      <span class="badge">Browser only · no upload</span>
      <h1>Mesh <span>→ UV PSD</span></h1>
      <p class="lead">
        FBX / OBJ / GLB を読み込み、UVアイランドごとにパディング付きマスクレイヤーを持つ PSD を生成します。
        UVメッシュのエッジを黒線で示すレイヤーもオブジェクト・UVチャンネルごとに追加されます。
      </p>
    </header>

    <main>
      <section class="card drop-card">
        <div
          id="dropzone"
          class="dropzone"
          role="button"
          tabindex="0"
          aria-label="3Dファイルを選択"
        >
          <div class="drop-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 16V4" />
              <path d="m7 9 5-5 5 5" />
              <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
            </svg>
          </div>
          <div class="drop-title" id="dropTitle">FBX / OBJ / GLB をドロップ</div>
          <div class="drop-sub">クリックしてファイルを選択 · 処理はすべてブラウザ内で完結します</div>
          <div class="format-row" aria-hidden="true">
            <span class="format">FBX</span>
            <span class="format">OBJ</span>
            <span class="format">GLB</span>
            <span class="format">GLTF</span>
          </div>
        </div>
        <input id="fileInput" type="file" accept=".fbx,.obj,.glb,.gltf" hidden />
        <div id="errorBox" class="error hidden" role="alert"></div>
      </section>

      <section id="workspace" class="workspace hidden">
        <div class="column">
          <section class="card">
            <div class="card-head">
              <div>
                <h2>オブジェクトとUVチャンネル</h2>
                <div id="fileMeta" class="file-meta"></div>
              </div>
              <button id="resetButton" class="ghost-button" type="button">別のファイル</button>
            </div>
            <div class="toolbar">
              <div class="toolbar-group">
                <button id="selectAllButton" class="small-button" type="button">全UVを選択</button>
                <button id="selectFirstButton" class="small-button" type="button">先頭UVのみ</button>
                <button id="clearButton" class="small-button" type="button">クリア</button>
              </div>
              <span class="hint">複数選択できます</span>
            </div>
            <div id="objectList" class="object-list"></div>
            <div id="noUvNotice" class="notice hidden"></div>
          </section>
        </div>

        <div class="column">
          <section class="card">
            <div class="card-head">
              <div>
                <h2>変換設定</h2>
                <p>UVアイランドを検出し、1アイランド = 1マスクレイヤーで出力します。UVエッジの黒線レイヤーも追加します。</p>
              </div>
            </div>
            <div class="card-body">
              <div class="settings-grid">
                <div class="field">
                  <label for="resolution">テクスチャ解像度</label>
                  <select id="resolution">
                    <option value="512">512 × 512</option>
                    <option value="1024">1024 × 1024</option>
                    <option value="2048" selected>2048 × 2048</option>
                    <option value="4096">4096 × 4096</option>
                  </select>
                  <p class="field-note">解像度が高いほどマスクが精細になりますが、PSDサイズと処理時間が増えます。</p>
                </div>

                <div class="settings-row">
                  <div class="field">
                    <label for="padding">マスクのパディング</label>
                    <select id="padding">
                      <option value="0">0 px</option>
                      <option value="1">1 px</option>
                      <option value="2">2 px</option>
                      <option value="4" selected>4 px</option>
                      <option value="8">8 px</option>
                      <option value="16">16 px</option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="edgeWidth">エッジ線の太さ</label>
                    <select id="edgeWidth">
                      <option value="1" selected>1 px</option>
                      <option value="2">2 px</option>
                      <option value="3">3 px</option>
                    </select>
                  </div>
                </div>
                <p class="field-note">パディングは各UVアイランドのマスクを外側へ拡張します。</p>

                <div class="summary-box">
                  <span>選択中のチャンネル</span>
                  <strong id="selectionCount">0</strong>
                </div>

                <button id="convertButton" class="primary-button" type="button" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 3v12" />
                    <path d="m7 10 5 5 5-5" />
                    <path d="M4 21h16" />
                  </svg>
                  <span>PSDに変換</span>
                </button>

                <div id="progressWrap" class="progress-wrap hidden">
                  <div class="progress-track">
                    <div id="progressBar" class="progress-bar"></div>
                  </div>
                  <div id="progressStatus" class="progress-status">待機中</div>
                </div>
              </div>
            </div>
          </section>

          <section id="resultCard" class="card result-card hidden">
            <div class="card-head">
              <div>
                <h2>変換完了</h2>
                <p>UVアイランドごとのマスクレイヤーを含むPSDを生成しました。</p>
              </div>
            </div>
            <div class="card-body">
              <div class="preview-frame">
                <canvas id="previewCanvas" width="512" height="512"></canvas>
                <span class="preview-label">UV ISLANDS</span>
              </div>
              <div id="stats" class="stats"></div>
              <p class="result-note">
                レイヤーは「オブジェクト → UVチャンネル → アイランド」のグループ構造です。
                各UVチャンネルの先頭には黒線の「UV Edges」レイヤー、各アイランドにはパディング付きのレイヤーマスクが適用されています。
              </p>
              <button id="downloadButton" class="primary-button" type="button">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 3v12" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M4 21h16" />
                </svg>
                <span>PSDをダウンロード</span>
              </button>
            </div>
          </section>
        </div>
      </section>
    </main>

    <footer class="hint" style="margin-top: 28px;">
      ファイルはサーバーに送信されません。UVが0〜1の範囲外にある部分はキャンバス外としてクリップされます。
    </footer>
  </div>
`;

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Element not found: ${selector}`);
  return element;
}

const dropzone = must<HTMLDivElement>('#dropzone');
const dropTitle = must<HTMLDivElement>('#dropTitle');
const fileInput = must<HTMLInputElement>('#fileInput');
const errorBox = must<HTMLDivElement>('#errorBox');
const workspace = must<HTMLElement>('#workspace');
const fileMeta = must<HTMLDivElement>('#fileMeta');
const objectList = must<HTMLDivElement>('#objectList');
const noUvNotice = must<HTMLDivElement>('#noUvNotice');
const resetButton = must<HTMLButtonElement>('#resetButton');
const selectAllButton = must<HTMLButtonElement>('#selectAllButton');
const selectFirstButton = must<HTMLButtonElement>('#selectFirstButton');
const clearButton = must<HTMLButtonElement>('#clearButton');
const resolutionSelect = must<HTMLSelectElement>('#resolution');
const paddingSelect = must<HTMLSelectElement>('#padding');
const edgeWidthSelect = must<HTMLSelectElement>('#edgeWidth');
const selectionCount = must<HTMLElement>('#selectionCount');
const convertButton = must<HTMLButtonElement>('#convertButton');
const progressWrap = must<HTMLDivElement>('#progressWrap');
const progressBar = must<HTMLDivElement>('#progressBar');
const progressStatus = must<HTMLDivElement>('#progressStatus');
const resultCard = must<HTMLElement>('#resultCard');
const previewCanvas = must<HTMLCanvasElement>('#previewCanvas');
const stats = must<HTMLDivElement>('#stats');
const downloadButton = must<HTMLButtonElement>('#downloadButton');

let model: LoadedModel | null = null;
let result: ConversionResult | null = null;
let busy = false;
let progressHideTimer = 0;

const htmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => htmlEscapes[character]);
}

function formatInt(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function setError(message: string): void {
  if (!message) {
    errorBox.hidden = true;
    errorBox.textContent = '';
    return;
  }
  errorBox.hidden = false;
  errorBox.textContent = message;
}

function clearResult(): void {
  result = null;
  resultCard.classList.add('hidden');
}

function setBusy(next: boolean): void {
  busy = next;
  resetButton.disabled = next;
  selectAllButton.disabled = next;
  selectFirstButton.disabled = next;
  clearButton.disabled = next;
  fileInput.disabled = next;
  resolutionSelect.disabled = next;
  paddingSelect.disabled = next;
  edgeWidthSelect.disabled = next;
  objectList.classList.toggle('is-busy', next);
  updateSelectionSummary();
}

function getSelections(): Selection[] {
  const selections: Selection[] = [];
  const rows = objectList.querySelectorAll<HTMLElement>('.object');

  for (const row of rows) {
    const objectInput = row.querySelector<HTMLInputElement>('input[data-role="object"]');
    if (!objectInput?.checked) continue;

    const objectId = objectInput.dataset.object;
    if (!objectId) continue;

    const uvInputs = row.querySelectorAll<HTMLInputElement>('input[data-role="uv"]');
    for (const uvInput of uvInputs) {
      if (!uvInput.checked || uvInput.disabled) continue;
      const uvKey = uvInput.dataset.uv;
      if (uvKey) selections.push({ objectId, uvKey });
    }
  }

  return selections;
}

function updateSelectionSummary(): void {
  const count = getSelections().length;
  selectionCount.textContent = String(count);
  convertButton.disabled = busy || !model || count === 0;
}

function refreshRows(): void {
  const rows = objectList.querySelectorAll<HTMLElement>('.object');

  for (const row of rows) {
    const objectInput = row.querySelector<HTMLInputElement>('input[data-role="object"]');
    if (!objectInput) continue;
    row.classList.toggle('is-off', !objectInput.checked);

    const uvInputs = row.querySelectorAll<HTMLInputElement>('input[data-role="uv"]');
    for (const uvInput of uvInputs) {
      uvInput.disabled = !objectInput.checked;
    }
  }

  updateSelectionSummary();
}

function renderObjectList(loaded: LoadedModel): void {
  const totalTriangles = loaded.objects.reduce((total, object) => total + object.triangleCount, 0);
  fileMeta.innerHTML = `
    <span class="chip"><strong>${loaded.format.toUpperCase()}</strong></span>
    <span class="chip"><strong>${loaded.objects.length}</strong> objects</span>
    <span class="chip"><strong>${formatInt(totalTriangles)}</strong> triangles</span>
    <span class="chip" title="${escapeHtml(loaded.fileName)}">${escapeHtml(loaded.fileName)}</span>
  `;

  objectList.innerHTML = loaded.objects
    .map((object) => {
      const path =
        object.path && object.path !== object.name
          ? `<div class="object-path" title="${escapeHtml(object.path)}">${escapeHtml(object.path)}</div>`
          : '';

      const uvChips = object.uvChannels
        .map(
          (channel, index) => `
            <label class="uv-chip">
              <input
                type="checkbox"
                data-role="uv"
                data-object="${escapeHtml(object.id)}"
                data-uv="${escapeHtml(channel.key)}"
                ${index === 0 ? 'checked' : ''}
              />
              <span>${escapeHtml(channel.label)}</span>
            </label>
          `,
        )
        .join('');

      return `
        <div class="object">
          <div class="object-head">
            <label class="check">
              <input type="checkbox" data-role="object" data-object="${escapeHtml(object.id)}" checked />
              <span class="object-name" title="${escapeHtml(object.name)}">${escapeHtml(object.name)}</span>
            </label>
            <span class="object-meta">${formatInt(object.triangleCount)} tris</span>
          </div>
          ${path}
          <div class="uv-chips">${uvChips}</div>
        </div>
      `;
    })
    .join('');

  if (loaded.withoutUvCount > 0) {
    noUvNotice.hidden = false;
    noUvNotice.textContent = `${loaded.withoutUvCount} 個のメッシュにはUVがないため除外しました。`;
  } else {
    noUvNotice.hidden = true;
    noUvNotice.textContent = '';
  }

  refreshRows();
}

function drawPreview(conversion: ConversionResult): void {
  const size = 512;
  previewCanvas.width = size;
  previewCanvas.height = size;
  const context = previewCanvas.getContext('2d');
  if (!context) return;

  const image = context.createImageData(size, size);
  const step = conversion.width / size;

  for (let y = 0; y < size; y += 1) {
    const startY = Math.floor(y * step);
    const endY = Math.min(conversion.height, Math.max(startY + 1, Math.floor((y + 1) * step)));

    for (let x = 0; x < size; x += 1) {
      const startX = Math.floor(x * step);
      const endX = Math.min(conversion.width, Math.max(startX + 1, Math.floor((x + 1) * step)));
      let edge = false;
      let covered = false;

      for (let sourceY = startY; sourceY < endY && !edge; sourceY += 1) {
        const row = sourceY * conversion.width;

        for (let sourceX = startX; sourceX < endX; sourceX += 1) {
          const index = row + sourceX;
          if (conversion.edgeCoverage[index]) {
            edge = true;
            break;
          }
          if (conversion.coverage[index]) covered = true;
        }
      }

      if (!edge && !covered) continue;

      const offset = (y * size + x) * 4;
      image.data[offset] = edge ? 0 : 255;
      image.data[offset + 1] = edge ? 0 : 255;
      image.data[offset + 2] = edge ? 0 : 255;
      image.data[offset + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
}

function showResult(conversion: ConversionResult): void {
  result = conversion;
  drawPreview(conversion);

  stats.innerHTML = `
    <div class="stat">
      <span>UV islands</span>
      <strong>${formatInt(conversion.totalIslands)}</strong>
    </div>
    <div class="stat">
      <span>Channels</span>
      <strong>${formatInt(conversion.combos.length)}</strong>
    </div>
    <div class="stat">
      <span>PSD size</span>
      <strong>${formatBytes(conversion.psd.byteLength)}</strong>
    </div>
    <div class="stat">
      <span>Time</span>
      <strong>${(conversion.elapsedMs / 1000).toFixed(1)}s</strong>
    </div>
  `;

  resultCard.classList.remove('hidden');
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function downloadResult(): void {
  if (!result || !model) return;

  const baseName = model.fileName.replace(/\.[^.]+$/, '');
  const blob = new Blob([result.psd], { type: 'image/vnd.adobe.photoshop' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseName}_uv_islands.psd`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function handleFile(file: File): Promise<void> {
  if (busy) return;

  clearResult();
  setError('');
  setBusy(true);
  dropzone.classList.add('is-loading');
  dropTitle.textContent = '読み込み中...';

  try {
    const loaded = await loadModelFile(file);
    model = loaded;
    workspace.classList.remove('hidden');
    renderObjectList(loaded);
    progressWrap.classList.add('hidden');
    progressBar.style.width = '0%';
    progressStatus.textContent = '待機中';
  } catch (error) {
    model = null;
    workspace.classList.add('hidden');
    clearResult();
    setError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
    dropzone.classList.remove('is-loading');
    dropTitle.textContent = 'FBX / OBJ / GLB をドロップ';
  }
}

async function startConversion(): Promise<void> {
  if (!model || busy) return;

  const selections = getSelections();
  if (selections.length === 0) {
    setError('変換するオブジェクトとUVチャンネルを選択してください。');
    return;
  }

  setError('');
  clearResult();
  setBusy(true);
  if (progressHideTimer) {
    window.clearTimeout(progressHideTimer);
    progressHideTimer = 0;
  }
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressStatus.textContent = '準備中...';

  try {
    const conversion = await convertModel(
      model,
      {
        resolution: Number(resolutionSelect.value),
        padding: Number(paddingSelect.value),
        edgeWidth: Number(edgeWidthSelect.value),
        selections,
      },
      {
        onStatus: (message) => {
          progressStatus.textContent = message;
        },
        onProgress: (progress) => {
          progressBar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
        },
      },
    );

    showResult(conversion);
    progressHideTimer = window.setTimeout(() => {
      progressWrap.classList.add('hidden');
      progressHideTimer = 0;
    }, 450);
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
    progressWrap.classList.add('hidden');
  } finally {
    setBusy(false);
  }
}

function setAllCheckboxes(mode: 'all' | 'first' | 'none'): void {
  const rows = objectList.querySelectorAll<HTMLElement>('.object');

  for (const row of rows) {
    const objectInput = row.querySelector<HTMLInputElement>('input[data-role="object"]');
    if (!objectInput) continue;
    objectInput.checked = mode !== 'none';

    const uvInputs = row.querySelectorAll<HTMLInputElement>('input[data-role="uv"]');
    uvInputs.forEach((uvInput, index) => {
      uvInput.checked = mode === 'all' ? true : mode === 'first' ? index === 0 : false;
    });
  }

  refreshRows();
  clearResult();
}

dropzone.addEventListener('click', () => {
  if (!busy) fileInput.click();
});

dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!busy) fileInput.click();
  }
});

for (const eventName of ['dragenter', 'dragover']) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!busy) dropzone.classList.add('is-dragging');
  });
}

dropzone.addEventListener('dragleave', (event) => {
  event.preventDefault();
  if (!dropzone.contains(event.relatedTarget as Node | null)) {
    dropzone.classList.remove('is-dragging');
  }
});

dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('is-dragging');
  const file = event.dataTransfer?.files?.[0];
  if (file) void handleFile(file);
});

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) void handleFile(file);
});

objectList.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
  refreshRows();
  clearResult();
});

selectAllButton.addEventListener('click', () => setAllCheckboxes('all'));
selectFirstButton.addEventListener('click', () => setAllCheckboxes('first'));
clearButton.addEventListener('click', () => setAllCheckboxes('none'));

resetButton.addEventListener('click', () => {
  if (busy) return;
  model = null;
  clearResult();
  setError('');
  workspace.classList.add('hidden');
  objectList.innerHTML = '';
  fileInput.value = '';
  if (progressHideTimer) {
    window.clearTimeout(progressHideTimer);
    progressHideTimer = 0;
  }
  progressWrap.classList.add('hidden');
  progressBar.style.width = '0%';
  updateSelectionSummary();
});

convertButton.addEventListener('click', () => {
  void startConversion();
});

downloadButton.addEventListener('click', downloadResult);
