'use strict';
const $ = id => document.getElementById(id);
const FONT_CHOICES = [{ id: 'liguofu', name: '李国夫手写体' }, { id: 'yiqi', name: '义启手写体' }, { id: 'qingye', name: '青叶手写体' }, { id: 'yunyan', name: '云烟体' }, { id: 'wenkai', name: '霞鹜文楷（附加）' }];
const ORIGINAL_PRESETS = {
  bg1: { width: 3024, height: 3342, font_size: 100, line_spacing: 143, left_margin: 180, right_margin: 100, top_margin: 140, bottom_margin: 70, word_spacing: 5, line_spacing_sigma: 0, font_size_sigma: 2, word_spacing_sigma: 2, perturb_x_sigma: 3, perturb_y_sigma: 3, perturb_theta_sigma: .05 },
  bg2: { width: 7000, height: 9333, font_size: 200, line_spacing: 300, left_margin: 670, right_margin: 590, top_margin: 540, bottom_margin: 210, word_spacing: 4, line_spacing_sigma: 2, font_size_sigma: 10, word_spacing_sigma: 2, perturb_x_sigma: 5, perturb_y_sigma: 5, perturb_theta_sigma: .10 },
  bg3: { width: 4000, height: 5657, font_size: 130, line_spacing: 270, left_margin: 420, right_margin: 330, top_margin: 190, bottom_margin: 520, word_spacing: 7, line_spacing_sigma: 0, font_size_sigma: 2, word_spacing_sigma: 2, perturb_x_sigma: 3, perturb_y_sigma: 3, perturb_theta_sigma: .05 }
};
const LEGACY_PARAMS = { paper: 'ruled', font_id: 'wenkai', background_id: null, width: 1240, height: 1754, font_size: 46, line_spacing: 82, margin: 98, left_margin: null, right_margin: null, top_margin: null, bottom_margin: null, word_spacing: 3, line_spacing_sigma: 0, font_size_sigma: null, word_spacing_sigma: null, perturb_x_sigma: null, perturb_y_sigma: null, perturb_theta_sigma: null, end_chars: '，。', seed: 42, aa: false, ink_filter: false, ink: 'black' };
const DEFAULT_PARAMS = { ...LEGACY_PARAMS, ...ORIGINAL_PRESETS.bg1, paper: 'plain', font_id: 'liguofu', background_id: 'bg1' };
const REQUEST_KEYS = Object.keys(DEFAULT_PARAMS).concat('preview_chars');
const state = { busy: false, style: { ...DEFAULT_PARAMS }, resources: null, resourceError: '', raw: '', current: null, index: 0, retry: null, photos: [], photoSeq: 0, llm: { result: null, photoId: null } };
let toastTimer;
const db = new Promise((resolve, reject) => { const req = indexedDB.open('paperink-v1', 1); req.onupgradeneeded = () => req.result.createObjectStore('works', { keyPath: 'id' }); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error('本地存储不可用，请检查浏览器权限')); });
async function records(mode, action) { const database = await db; return new Promise((resolve, reject) => { const transaction = database.transaction('works', mode); const request = action(transaction.objectStore('works')); let result; request.onsuccess = () => { result = request.result; }; transaction.oncomplete = () => resolve(result); transaction.onerror = () => reject(new Error('本地保存未完成，可能空间不足')); }); }
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 2600); }
function busy(value, text) { state.busy = value; $('busy').hidden = !value; $('busy-text').textContent = text || ''; document.querySelectorAll('#home button, #home input, #home textarea, #home select').forEach(b => b.disabled = value); syncResourceControls(); syncLlmFields(); }
function error(err, retry) { $('error-text').textContent = err.message || String(err); $('error').hidden = false; state.retry = retry; $('retry').hidden = !retry; }
async function api(path, options = {}, timeout = 180000) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout); try { const response = await fetch(path, { ...options, signal: controller.signal }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || `服务请求失败（HTTP ${response.status}）`); return body; } catch (e) { if (e.name === 'AbortError') throw new Error('服务响应超时，请重试'); throw e; } finally { clearTimeout(timer); } }
function count() { $('count').textContent = `${$('text').value.length} / 10000 字`; }
function saveDraft() { try { localStorage.setItem('paperink-draft', JSON.stringify({ text: $('text').value, raw: state.raw, params: styleSnapshot(), llm: { enabled: $('llm-enable').checked, baseUrl: $('llm-base-url').value.trim(), model: $('llm-model').value.trim(), names: $('llm-names').value.trim() } })); } catch { toast('草稿未保存，存储不可用'); } }
function styleSnapshot() { return { ...state.style, font_size: +$('font-size').value, line_spacing: +$('line-spacing').value, seed: $('seed').value.trim() === '' ? '' : +$('seed').value, aa: $('aa').checked, ink_filter: $('ink-filter').checked }; }
function restoreParams(saved) {
  const legacy = saved && !Object.hasOwn(saved, 'background_id');
  const base = legacy || saved?.background_id === null ? { ...LEGACY_PARAMS, ...(legacy ? { aa: true, ink_filter: true } : {}) } : { ...DEFAULT_PARAMS, ...(ORIGINAL_PRESETS[saved?.background_id] || {}) };
  state.style = { ...base, ...saved }; syncStyleControls();
}
function syncStyleControls() {
  const p = state.style; $('font-size').value = p.font_size; $('font-value').value = p.font_size; $('line-spacing').min = p.font_size; $('line-spacing').value = p.line_spacing; $('line-value').value = p.line_spacing;
  $('seed').value = p.seed; $('aa').checked = p.aa; $('ink-filter').checked = p.ink_filter;
  document.querySelectorAll('[data-paper]').forEach(b => { const selected = p.background_id === null && b.dataset.paper === p.paper; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); });
  document.querySelectorAll('[data-ink]').forEach(b => b.classList.toggle('selected', b.dataset.ink === p.ink)); syncResourceControls();
}
function selectedResourceIssue() {
  if (!state.resources) return state.resourceError || '字体与背景目录尚未就绪，请重新检测资源；不会自动更换字体或背景。';
  const font = state.resources.fonts.find(f => f.id === state.style.font_id);
  const background = state.resources.backgrounds.find(b => b.id === state.style.background_id);
  const missing = [];
  if (!font?.available) missing.push(`所选字体 ${font?.name || state.style.font_id}`);
  if (state.style.background_id !== null && !background?.available) missing.push(`所选背景 ${background?.name || state.style.background_id}`);
  return missing.length ? `${missing.join('、')} 不可用，请检查本机资源目录或手动选择可用资源；不会静默替换。` : '';
}
function syncResourceControls() {
  const select = $('font-id'); select.replaceChildren();
  const fonts = FONT_CHOICES.map(choice => ({ ...choice, ...state.resources?.fonts.find(font => font.id === choice.id) }));
  if (!fonts.some(font => font.id === state.style.font_id)) fonts.push({ id: state.style.font_id, name: state.style.font_id });
  fonts.forEach(font => { const option = document.createElement('option'); option.value = font.id; option.disabled = !font.available; option.textContent = `${font.name}${font.available ? '' : state.resources ? ' · 资源缺失（不可选）' : ' · 未就绪（不可选）'}`; select.append(option); });
  select.value = state.style.font_id; select.disabled = state.busy || !state.resources;
  document.querySelectorAll('[data-background]').forEach(button => {
    const resource = state.resources?.backgrounds.find(b => b.id === button.dataset.background); const selected = state.style.background_id === button.dataset.background;
    button.disabled = state.busy || !resource?.available; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
    button.querySelector('small').textContent = resource?.available ? `${resource.width} × ${resource.height}` : state.resources ? '资源缺失 · 不可选' : '未就绪 · 不可选';
    const image = button.querySelector('img'); image.hidden = !resource?.available;
    if (resource?.available && image.getAttribute('src') !== resource.thumbnail) image.src = resource.thumbnail;
  });
  const missing = state.resources ? [...fonts.filter(f => !f.available).map(f => f.name), ...state.resources.backgrounds.filter(b => !b.available).map(b => b.name)] : [];
  const issue = selectedResourceIssue(); $('resource-note').textContent = issue || (missing.length ? `资源缺失（不可选）：${missing.join('、')}。只引用本机文件，不重新分发。` : '原字体与背景只引用本机文件；保留输入空白，不自动整理段落。切换背景会恢复原预设。');
  $('resource-note').classList.toggle('warning', Boolean(issue || missing.length)); $('resource-retry').hidden = Boolean(state.resources && !issue && !missing.length); $('resource-retry').disabled = state.busy;
}
async function loadResources() {
  try {
    const catalog = await api('/api/resources');
    if (!Array.isArray(catalog.fonts) || !Array.isArray(catalog.backgrounds) || catalog.fonts.some(f => !f || typeof f.id !== 'string' || typeof f.name !== 'string' || typeof f.available !== 'boolean') || catalog.backgrounds.some(b => !b || !ORIGINAL_PRESETS[b.id] || typeof b.name !== 'string' || typeof b.available !== 'boolean' || !b.preset || typeof b.preset !== 'object' || !Number.isInteger(b.width) || !Number.isInteger(b.height) || typeof b.thumbnail !== 'string' || b.thumbnail !== `/api/resources/backgrounds/${b.id}/thumbnail.png` || Object.keys(ORIGINAL_PRESETS[b.id]).some(key => !Number.isFinite(b.preset[key])))) throw new Error('字体背景目录响应无效，请检查服务版本。');
    state.resources = catalog; state.resourceError = '';
  } catch (e) { state.resources = null; state.resourceError = `资源目录未就绪：${e.message}；不会自动替换字体或背景。`; }
  syncResourceControls();
}
function setBackground(id) {
  const resource = state.resources?.backgrounds.find(b => b.id === id);
  if (!resource?.available) { error(new Error('所选原背景不可用，请检查本机资源目录')); return; }
  state.style = { ...LEGACY_PARAMS, ...styleSnapshot(), ...resource.preset, width: resource.width, height: resource.height, background_id: id, paper: 'plain' };
  syncStyleControls(); saveDraft();
}
function setPaper(paper) {
  const current = styleSnapshot(); state.style = { ...LEGACY_PARAMS, paper, font_id: current.font_id, ink: current.ink, seed: current.seed, aa: current.aa, ink_filter: current.ink_filter };
  syncStyleControls();
}
function setInk(ink) { state.style.ink = ink; document.querySelectorAll('[data-ink]').forEach(b => b.classList.toggle('selected', b.dataset.ink === ink)); }
function tab(name) { document.querySelectorAll('.tab-panel').forEach(p => p.hidden = p.id !== name); document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('selected', b.dataset.tab === name)); window.scrollTo({ top: 0, behavior: 'instant' }); if (name === 'works') loadWorks(); if (name === 'settings') checkHealth(); }
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => tab(b.dataset.tab));
document.querySelector('.brand').onclick = e => { e.preventDefault(); tab('home'); };
$('create-first').onclick = () => tab('home');
$('upload').onclick = $('album').onclick = () => { if (!state.busy) $('file').click(); };
$('camera').onclick = () => { if (!state.busy) $('camera-file').click(); };
$('manual').onclick = () => { $('editor-card').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('text').focus(); };
$('text').oninput = () => { count(); saveDraft(); };
$('retry').onclick = () => state.retry?.();
function addPhoto(file, data) {
  const photo = { id: ++state.photoSeq, file, name: file.name || '图片', url: URL.createObjectURL(file), text: data.text, ocrText: data.text, lines: data.lines || [], separator: state.photos.length ? '\n\n' : '', inserted: '', replacedText: '', note: `已识别 ${data.lines.length} 行 · ${data.elapsed_ms} ms · ${data.needs_review ? '部分文字建议重点校对' : '请核对文字与阅读顺序'}` };
  if (!state.photos.length) { photo.replacedText = $('text').value; $('text').value = photo.text; photo.inserted = photo.text; }
  else { photo.inserted = photo.separator + photo.text; $('text').value += photo.inserted; }
  state.photos.push(photo); state.llm.photoId = photo.id;
  state.raw = state.photos.map(item => item.ocrText).join('\n\n');
  $('original').textContent = state.raw; $('original-btn').hidden = !state.raw; $('original').hidden = true; $('original-btn').textContent = '对照原文';
  syncPhotos(); count(); saveDraft();
}
function syncPhotos() {
  const list = $('photos'); list.replaceChildren(); list.hidden = !state.photos.length;
  state.photos.forEach(photo => {
    const item = document.createElement('div'); item.className = 'photo-item';
    const image = document.createElement('img'); image.src = photo.url; image.alt = photo.name;
    const info = document.createElement('div'); info.className = 'photo-info';
    const name = document.createElement('strong'); name.textContent = photo.name;
    const meta = document.createElement('small'); meta.textContent = `${photo.lines.length} 行 · 可单独删除`;
    info.append(name, meta);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'photo-delete'; remove.setAttribute('aria-label', `删除照片 ${photo.name}`);
    remove.innerHTML = '<svg><use href="#i-trash"/></svg><span>删除</span>';
    remove.onclick = () => removePhoto(photo.id);
    item.append(image, info, remove); list.append(item);
  });
  const last = state.photos[state.photos.length - 1];
  $('source').hidden = !last;
  if (last) $('source-img').src = last.url;
  $('ocr-note').textContent = last ? (state.photos.length > 1 ? `${last.note} · 共 ${state.photos.length} 张照片` : last.note) : '';
  syncLlmPhotos();
}
function removePhoto(id) {
  if (state.busy) return;
  const index = state.photos.findIndex(photo => photo.id === id);
  if (index < 0) return;
  const [photo] = state.photos.splice(index, 1);
  const current = $('text').value;
  let next = current;
  let removed = false;
  if (photo.inserted && current.includes(photo.inserted)) {
    next = current.replace(photo.inserted, ''); removed = true;
    if (current === photo.inserted) next = photo.replacedText || '';
    next = next.replace(/\n{3,}/g, '\n\n');
    if (!next.trim()) next = '';
    const first = state.photos[0];
    if (first && first.separator && next.startsWith(first.separator)) { next = next.slice(first.separator.length); first.separator = ''; if (next.startsWith(first.text)) first.inserted = first.text; }
    if (index === state.photos.length) next = next.replace(/\n+$/, '');
  }
  $('text').value = next;
  URL.revokeObjectURL(photo.url);
  state.raw = state.photos.map(item => item.ocrText).join('\n\n');
  $('original').textContent = state.raw; $('original-btn').hidden = !state.raw;
  if (!state.raw) { $('original').hidden = true; $('original-btn').textContent = '对照原文'; }
  if (state.llm.result?.photoId === photo.id) { state.llm.result = null; $('llm-result').hidden = true; }
  syncPhotos(); count(); saveDraft();
  toast(removed ? '照片与对应识别文字已删除' : '照片已删除；正文中未找到其原始文字，可能已被手动修改，请自行核对');
}
async function recognizeFiles(files) {
  if (state.busy) return;
  const accepted = [];
  files.forEach(file => {
    if (file.size > 10 * 1024 * 1024) { error(new Error(`${file.name || '图片'} 超过 10 MB，已跳过`)); return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { error(new Error(`${file.name || '图片'} 不是 PNG、JPG 或 WEBP 图片，已跳过`)); return; }
    accepted.push(file);
  });
  if (!accepted.length) return;
  busy(true, accepted.length > 1 ? `正在提取图片文字 1/${accepted.length}` : '正在提取图片文字'); $('error').hidden = true;
  const failures = [];
  try {
    for (let index = 0; index < accepted.length; index++) {
      const file = accepted[index];
      if (accepted.length > 1) $('busy-text').textContent = `正在提取图片文字 ${index + 1}/${accepted.length}`;
      try {
        const form = new FormData(); form.append('file', file, file.name || 'image.png');
        const data = await api('/api/ocr', { method: 'POST', body: form });
        if (!data.text.trim()) { failures.push(`${file.name || '图片'}：没有识别到文字`); continue; }
        if ($('text').value.length + data.text.length > 10000) { failures.push(`${file.name || '图片'}：加入后会超过 10000 字`); continue; }
        addPhoto(file, data);
      } catch (e) { failures.push(`${file.name || '图片'}：${e.message}`); }
    }
    $('step2').classList.add('active');
    if (failures.length) error(new Error(failures.join('；')), failures.length < accepted.length ? () => recognizeFiles(accepted.filter(file => !state.photos.some(photo => photo.file === file))) : () => recognizeFiles(accepted));
    else toast(accepted.length > 1 ? `已添加 ${accepted.length} 张照片，可逐张删除` : '文字提取完成，请校对后生成');
  } finally { busy(false); }
}
$('file').onchange = e => { const files = Array.from(e.target.files || []); e.target.value = ''; if (files.length) recognizeFiles(files); };
$('camera-file').onchange = e => { const files = Array.from(e.target.files || []); e.target.value = ''; if (files.length) recognizeFiles(files); };
$('sample').onclick = async () => { if (state.busy) return; try { const response = await fetch('/api/sample'); if (!response.ok) throw new Error('示例图片尚未准备'); const blob = await response.blob(); await recognizeFiles([new File([blob], '示例文字.png', { type: 'image/png' })]); } catch (e) { error(e, () => $('sample').click()); } };
$('original-btn').onclick = () => { $('original').hidden = !$('original').hidden; $('original-btn').textContent = $('original').hidden ? '对照原文' : '收起原文'; };
$('copy').onclick = async () => { try { await navigator.clipboard.writeText($('text').value); toast('文字已复制'); } catch { toast('复制失败，请手动选择文字复制'); } };
const LLM_STATUS = { unchanged: ['一致', 'ok'], cross_agree: ['交叉一致', 'ok'], recheck_diff: ['重识别不同', 'warn'], conflict: ['存在分歧', 'bad'], reverted: ['已回退', 'bad'], recheck_missing: ['重识别缺行', 'warn'] };
function syncLlmPhotos() {
  const select = $('llm-photo');
  select.replaceChildren();
  state.photos.forEach(photo => { const option = document.createElement('option'); option.value = String(photo.id); option.textContent = `${photo.name} · ${photo.lines.length} 行`; select.append(option); });
  const target = state.photos.find(photo => String(photo.id) === String(state.llm.photoId)) || state.photos[state.photos.length - 1];
  state.llm.photoId = target ? target.id : null;
  if (target) select.value = String(target.id);
  const usable = Boolean(target) && $('llm-enable').checked && !state.busy;
  $('llm-photo').disabled = !usable; $('llm-run').disabled = !usable;
}
function syncLlmFields() {
  const enabled = $('llm-enable').checked;
  $('llm-fields').hidden = !enabled;
  if (!enabled) { $('llm-api-key').value = ''; state.llm.result = null; $('llm-result').hidden = true; }
  syncLlmPhotos();
  $('llm-apply').disabled = state.busy || !state.llm.result || !(state.llm.result.cross_validation?.lines || []).length;
  if (!enabled) $('llm-note').textContent = '启用后才需要填写接口地址、API Key 与模型名称。';
  else if (!state.photos.length) $('llm-note').textContent = '请先添加照片，再开始大模型校对。';
  else if (!state.llm.result && !state.busy) $('llm-note').textContent = '模型会先逐行校对 OCR，再独立重识别原图，最后交叉验证；结果不会自动覆盖正文。';
}
function restoreLlmConfig(saved) {
  if (!saved || typeof saved !== 'object') return;
  $('llm-enable').checked = saved.enabled === true;
  if (typeof saved.baseUrl === 'string') $('llm-base-url').value = saved.baseUrl;
  if (typeof saved.model === 'string') $('llm-model').value = saved.model;
  if (typeof saved.names === 'string') $('llm-names').value = saved.names;
  syncLlmFields();
}
function renderLlmResult(result, photo) {
  const validation = result.cross_validation || {};
  const rows = Array.isArray(validation.lines) ? validation.lines : [];
  const body = $('llm-diff'); body.replaceChildren();
  const cell = (row, value, className) => { const td = document.createElement('td'); td.textContent = value === null || value === undefined ? '' : String(value); if (className) td.className = className; row.append(td); return td; };
  rows.forEach(item => {
    const row = document.createElement('tr');
    cell(row, item.line, 'llm-line');
    cell(row, item.ocr);
    cell(row, item.proofread);
    cell(row, item.recognized === null || item.recognized === undefined ? '（未返回）' : item.recognized);
    cell(row, item.adopted, 'llm-adopted');
    const status = document.createElement('td');
    const [label, tone] = LLM_STATUS[item.status] || [item.status || '未知', ''];
    const tag = document.createElement('span'); tag.className = `tag ${tone}`; tag.textContent = label; status.append(tag);
    if (item.note) { const note = document.createElement('small'); note.textContent = item.note; status.append(note); }
    row.append(status); body.append(row);
  });
  const summary = [`${rows.length} 行`, `修改 ${validation.changed_lines || 0} 行`, `冲突 ${validation.conflict_lines || 0} 行`, `回退 ${validation.reverted_lines || 0} 行`];
  if (validation.line_count_match === false) summary.push('重识别行数不一致');
  $('llm-summary').textContent = summary.join(' · ');
  $('llm-original').textContent = result.original?.text || '';
  $('llm-result').hidden = false; $('llm-apply').disabled = !rows.length;
  $('llm-note').textContent = `大模型校对完成 · 照片「${photo.name}」 · ${result.elapsed_ms} ms · ${result.needs_review ? '存在需要人工确认的差异' : '未发现冲突'}`;
  $('llm-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function runLlm() {
  if (state.busy) return;
  const baseUrl = $('llm-base-url').value.trim(), apiKey = $('llm-api-key').value.trim(), model = $('llm-model').value.trim(), names = $('llm-names').value.trim();
  const photo = state.photos.find(item => String(item.id) === $('llm-photo').value) || state.photos[state.photos.length - 1];
  if (!photo) { error(new Error('请先添加照片并完成 OCR')); return; }
  if (!/^https?:\/\//i.test(baseUrl)) { error(new Error('请填写以 http:// 或 https:// 开头的 base_url')); return; }
  if (!apiKey) { error(new Error('请填写 api_key（仅本次请求使用，不会写入本地存储）')); return; }
  if (!model) { error(new Error('请填写模型名称 model_name')); return; }
  state.llm.result = null; $('llm-result').hidden = true;
  busy(true, '正在请求大模型校对与重识别'); $('error').hidden = true;
  $('llm-note').textContent = '正在请求大模型，可能需要几十秒；请保持页面打开。';
  let message = '';
  try {
    const form = new FormData();
    form.append('file', photo.file, photo.name);
    form.append('options', JSON.stringify({ base_url: baseUrl, api_key: apiKey, model_name: model, names, lines: photo.lines.map(line => ({ text: line.text })) }));
    const result = await api('/api/llm/proofread', { method: 'POST', body: form }, 300000);
    state.llm.result = { ...result, photoId: photo.id };
    renderLlmResult(result, photo);
    message = `大模型校对完成 · 照片「${photo.name}」 · ${result.elapsed_ms} ms · ${result.needs_review ? '存在需要人工确认的差异' : '未发现冲突'}`;
    toast('大模型校对完成，请对照差异后决定是否采用');
  } catch (e) {
    message = `大模型校对未完成：${e.message}`;
    error(e, runLlm);
  } finally { busy(false); $('llm-note').textContent = message; }
}
function applyLlmResult() {
  const result = state.llm.result;
  if (!result) return;
  const photo = state.photos.find(item => item.id === result.photoId);
  if (!photo) { error(new Error('对应照片已被删除，无法写入校对结果')); return; }
  const finalText = result.cross_validation?.final_text ?? result.final_text ?? '';
  const current = $('text').value;
  if (!photo.inserted || !current.includes(photo.inserted)) { error(new Error('正文中找不到这张照片对应的原始识别文字，可能已被手动修改；未自动覆盖，请对照后手动替换')); return; }
  const replacement = photo.separator + finalText;
  $('text').value = current.replace(photo.inserted, () => replacement);
  photo.text = finalText; photo.inserted = replacement;
  count(); saveDraft(); $('llm-apply').disabled = true;
  toast('已采用大模型最终结果；原始 OCR 仍可在“对照原文”中查看');
}
$('llm-enable').onchange = () => { syncLlmFields(); saveDraft(); };
$('llm-photo').onchange = () => { state.llm.photoId = +$('llm-photo').value; if (state.llm.result && state.llm.result.photoId !== state.llm.photoId) { state.llm.result = null; $('llm-result').hidden = true; } };
$('llm-run').onclick = runLlm;
$('llm-apply').onclick = applyLlmResult;
$('llm-keep').onclick = () => toast('已保留当前正文，大模型结果仅用于对照');
['llm-base-url', 'llm-model', 'llm-names'].forEach(id => $(id).oninput = saveDraft);
document.querySelectorAll('[data-paper]').forEach(b => b.onclick = () => { setPaper(b.dataset.paper); saveDraft(); });
document.querySelectorAll('[data-background]').forEach(b => b.onclick = () => setBackground(b.dataset.background));
$('font-id').onchange = () => { state.style = { ...styleSnapshot(), font_id: $('font-id').value }; syncResourceControls(); saveDraft(); };
$('resource-retry').onclick = loadResources;
document.querySelectorAll('[data-ink]').forEach(b => b.onclick = () => { setInk(b.dataset.ink); saveDraft(); });
$('advanced-toggle').onclick = () => { $('advanced').hidden = !$('advanced').hidden; $('advanced-arrow').textContent = $('advanced').hidden ? '＋' : '−'; };
$('font-size').oninput = () => { const font = +$('font-size').value; $('font-value').value = font; $('line-spacing').min = font; if (+$('line-spacing').value < font) $('line-spacing').value = font; $('line-value').value = $('line-spacing').value; saveDraft(); };
$('line-spacing').oninput = () => { $('line-value').value = $('line-spacing').value; saveDraft(); };
['seed', 'aa', 'ink-filter'].forEach(id => $(id).oninput = saveDraft);
function params() {
  const p = styleSnapshot(); if (!Number.isInteger(p.seed) || p.seed < 0 || p.seed > 2147483647) throw new Error('笔迹种子需为 0 至 2147483647 的整数');
  if (!Number.isInteger(p.font_size) || p.font_size < 18 || p.font_size > 400 || !Number.isInteger(p.line_spacing) || p.line_spacing < p.font_size || p.line_spacing > 600) throw new Error('字号需为 18 至 400，行距需在字号至 600 之间');
  const issue = selectedResourceIssue(); if (issue) throw new Error(issue); return p;
}
function showResult(record) { state.current = record; state.index = 0; $('result').hidden = false; $('result-note').textContent = `${record.pages.length} 页 · ${record.elapsed} ms`; displayPage(); $('step3').classList.add('active'); }
let pageUrl;
function displayPage() { const record = state.current; if (!record) return; if (pageUrl) URL.revokeObjectURL(pageUrl); pageUrl = URL.createObjectURL(record.pages[state.index]); $('result-img').src = pageUrl; $('page-info').textContent = `${state.index + 1} / ${record.pages.length}`; $('prev-page').disabled = state.index === 0; $('next-page').disabled = state.index === record.pages.length - 1; }
$('prev-page').onclick = () => { if (state.index > 0) { state.index--; displayPage(); } };
$('next-page').onclick = () => { if (state.index < state.current.pages.length - 1) { state.index++; displayPage(); } };
async function generate() { if (state.busy) return; const text = $('text').value; if (!text.trim()) { error(new Error('请先提取图片文字，或输入正文')); return; } let snapshot; try { snapshot = params(); } catch (e) { error(e); return; }
  busy(true, '正在逐笔生成手写作品'); $('error').hidden = true;
  try { const result = await api('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ...Object.fromEntries(REQUEST_KEYS.filter(key => snapshot[key] !== undefined).map(key => [key, snapshot[key]])) }) }); const pages = [];
    for (const path of result.pages) { const response = await fetch(path); if (!response.ok) throw new Error('结果图片下载失败，请重试'); const blob = await response.blob(); const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer()); if (![137,80,78,71,13,10,26,10].every((v,i) => head[i] === v)) throw new Error('服务返回的图片不是 PNG'); pages.push(blob); }
    const record = { id: result.task_id, text, raw: state.raw || text, params: { ...snapshot, ...(result.params && typeof result.params === 'object' && !Array.isArray(result.params) ? result.params : {}) }, pages, created: Date.now(), elapsed: result.elapsed_ms };
    await records('readwrite', s => s.put(record)); restoreParams(record.params); showResult(record); saveDraft(); toast('作品已保存到当前设备'); $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { error(e, generate); } finally { busy(false); displayPage(); }
}
$('generate').onclick = generate;
$('result-img').onclick = () => { if (state.current) { const viewer = document.createElement('dialog'); viewer.style.cssText = 'border:0;border-radius:14px;padding:10px;max-width:95vw;max-height:95vh;'; const image = document.createElement('img'); image.src = pageUrl; image.style.cssText = 'max-width:90vw;max-height:88vh;display:block;'; viewer.append(image); document.body.append(viewer); viewer.onclick = () => { viewer.close(); viewer.remove(); }; viewer.addEventListener('cancel', () => viewer.remove()); viewer.showModal(); } };
function download(blob, name) { const link = document.createElement('a'); const url = URL.createObjectURL(blob); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
$('download').onclick = () => { if (state.current) download(state.current.pages[state.index], `纸间-${state.current.id.slice(0,8)}-${state.index+1}.png`); };
$('download-all').onclick = () => { state.current?.pages.forEach((page, i) => download(page, `纸间-${state.current.id.slice(0,8)}-${i+1}.png`)); toast('已请求下载全部页，若浏览器拦截请允许多文件下载'); };
let workUrls = [];
async function loadWorks() { try { const list = (await records('readonly', s => s.getAll())).sort((a,b) => b.created-a.created).filter(w => (w.text + w.raw).includes($('search').value.trim())); workUrls.forEach(URL.revokeObjectURL); workUrls = []; $('works-list').replaceChildren(); $('empty-works').hidden = list.length > 0;
  list.forEach(record => { const card = document.createElement('article'); card.className = 'card work-card'; const image = document.createElement('img'); image.src = URL.createObjectURL(record.pages[0]); workUrls.push(image.src); image.alt = '作品缩略图'; const info = document.createElement('div'); info.className = 'work-info'; const title = document.createElement('h3'); title.textContent = record.text; const meta = document.createElement('p'); meta.textContent = `${new Date(record.created).toLocaleDateString()} · ${record.pages.length} 页 · 种子 ${record.params.seed}`; const actions = document.createElement('div'); actions.className = 'work-actions';
    const view = document.createElement('button'); view.textContent = '查看'; view.onclick = image.onclick = () => { tab('home'); showResult(record); $('result').scrollIntoView({ behavior: 'smooth' }); };
    const edit = document.createElement('button'); edit.textContent = '继续编辑'; edit.onclick = () => { tab('home'); $('text').value = record.text; state.raw = record.raw; state.llm.result = null; $('llm-result').hidden = true; $('original').textContent = state.raw; $('original-btn').hidden = false; restoreParams(record.params); count(); saveDraft(); $('editor-card').scrollIntoView({ behavior: 'smooth' }); };
    const del = document.createElement('button'); del.textContent = '删除'; del.onclick = async () => { if (!confirm('删除这份作品的本地图片、正文与记录？此操作不会删除其他作品。')) return; try { await records('readwrite', s => s.delete(record.id)); await api(`/api/tasks/${record.id}`, { method: 'DELETE' }); if (state.current?.id === record.id) { state.current = null; $('result').hidden = true; } loadWorks(); toast('作品已删除'); } catch (e) { toast('本地已删除，但服务文件清理可能未完成：'+e.message); loadWorks(); } };
    actions.append(view, edit, del); info.append(title, meta, actions); card.append(image, info); $('works-list').append(card);
  });
 } catch (e) { $('empty-works').hidden = true; toast(e.message); }
}
$('search').oninput = loadWorks;
async function checkHealth() { $('service-address').textContent = location.origin; $('health-status').textContent = '正在检测'; const resources = loadResources(); try { const data = await api('/api/health'); $('health-status').textContent = data.ready ? '连接正常' : '字体资源未就绪'; } catch { $('health-status').textContent = '服务未连接'; } await resources; }
$('health').onclick = checkHealth;
syncStyleControls(); syncPhotos(); syncLlmFields();
try { const draft = JSON.parse(localStorage.getItem('paperink-draft') || 'null'); if (draft) { $('text').value = draft.text || ''; state.raw = draft.raw || ''; restoreParams(draft.params || { paper: draft.paper ?? 'ruled', ink: draft.ink ?? 'black', seed: draft.seed === undefined ? 42 : +draft.seed }); $('original').textContent = state.raw; $('original-btn').hidden = !state.raw; restoreLlmConfig(draft.llm); count(); } } catch { toast('草稿读取失败，您仍可以输入文字'); }
checkHealth();
