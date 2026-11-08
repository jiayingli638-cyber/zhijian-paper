const api = require('./api');
const HISTORY_KEY = 'paper.works.v1';
const DRAFT_KEY = 'paper.draft.v1';
const DIRECTORY = 'paper-works-v1';
const inFlight = new Set();

function root() { return wx.env.USER_DATA_PATH + '/' + DIRECTORY; }
function owned(path) { return typeof path === 'string' && path.indexOf(root() + '/') === 0 && /^[a-f0-9-]+-page-\d{3,}\.png$/.test(path.slice(root().length + 1)); }
function storageError(action) { return new Error(action + '失败：本地存储不可用或空间不足，请释放空间后重试。'); }
function read(key) { try { return wx.getStorageSync(key); } catch (error) { throw storageError('读取'); } }
function write(key, value) { try { wx.setStorageSync(key, value); } catch (error) { throw storageError('保存'); } }

function listWorks() {
    const records = read(HISTORY_KEY);
    if (records === '' || records === null || records === undefined) return [];
    if (!Array.isArray(records) || records.some(item => !item || typeof item.id !== 'string' || typeof item.text !== 'string' || typeof item.sourceText !== 'string' || !['image', 'text'].includes(item.source) || !Number.isFinite(item.createdAt) || !Array.isArray(item.pages) || !item.pages.length || item.pages.some(path => !owned(path)) || !item.params)) throw new Error('本地作品索引格式异常，已停止写入和清理，以保护现有文件。');
    records.forEach(item => api.normalizeParams(item.params));
    return records;
}

function getWork(id) {
    const record = listWorks().find(item => item.id === id);
    if (!record) throw new Error('作品已不存在，请刷新列表。');
    return record;
}

function loadDraft() {
    const value = read(DRAFT_KEY);
    if (value === '' || value === undefined || value === null) return null;
    if (!value || typeof value.text !== 'string' || typeof value.sourceText !== 'string' || !['text', 'image'].includes(value.source)) throw new Error('本地草稿格式异常，请重新输入文字。');
    return Object.assign({}, value, { params: api.normalizeParams(value.params) });
}

function saveDraft(draft) {
    write(DRAFT_KEY, { text: draft.text, sourceText: draft.sourceText, source: draft.source, params: api.normalizeParams(draft.params) });
}

function ensureDirectory() {
    const fs = wx.getFileSystemManager();
    try { fs.accessSync(root()); } catch (error) {
        try { fs.mkdirSync(root(), true); } catch (mkdirError) { throw new Error('无法创建作品保存目录，请检查本地空间。'); }
    }
    return fs;
}

function persist(tempFilePath, filePath) {
    const fs = ensureDirectory();
    const bytes = new Uint8Array(fs.readFileSync(tempFilePath));
    if (bytes.length < 8 || [137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => bytes[index] !== value)) throw new Error('服务文件不是有效 PNG，未保存为作品。');
    return new Promise((resolve, reject) => {
        fs.saveFile({ tempFilePath, filePath,
            success(result) {
                const saved = result.savedFilePath || filePath;
                if (saved !== filePath || !owned(saved)) { reject(new Error('图片未保存到本程序的持久目录。')); return; }
                try { fs.accessSync(saved); resolve(saved); } catch (error) { reject(new Error('图片持久化失败，请重试。')); }
            },
            fail() { reject(new Error('图片持久化失败，请释放小程序空间后重试。')); }
        });
    });
}

function removeFiles(paths) {
    const fs = wx.getFileSystemManager();
    let failed = 0;
    paths.forEach(path => {
        if (!owned(path)) { failed += 1; return; }
        try { fs.unlinkSync(path); } catch (error) {
            if (!/ENOENT|no such file|not exist/i.test(error.message || error.errMsg || '')) failed += 1;
        }
    });
    return failed;
}

// 仅扫描本程序专属目录；索引不可读时不执行清理。
function cleanupOrphans() {
    const records = listWorks();
    const referenced = new Set();
    records.forEach(record => record.pages.forEach(path => referenced.add(path)));
    const fs = wx.getFileSystemManager();
    try { fs.accessSync(root()); } catch (error) {
        if (/ENOENT|no such file|not exist/i.test(error.message || error.errMsg || '')) return 0;
        throw new Error('无法访问本程序文件目录，清理未完成，请重试。');
    }
    let names;
    try { names = fs.readdirSync(root()); } catch (error) { throw new Error('读取本程序文件目录失败，清理未完成。'); }
    const unreferenced = names.map(name => root() + '/' + name).filter(path => owned(path) && !referenced.has(path) && !inFlight.has(path));
    return removeFiles(unreferenced);
}

async function createWork(input, response, serviceUrl) {
    listWorks();
    const params = api.normalizeParams(input.params);
    const id = Date.now().toString(16) + '-' + Math.random().toString(16).slice(2, 10);
    const pages = [];
    const attempted = [];
    try {
        for (let index = 0; index < response.pages.length; index += 1) {
            const path = root() + '/' + id + '-page-' + String(index + 1).padStart(3, '0') + '.png';
            attempted.push(path);
            inFlight.add(path);
            const temporary = await api.download(response.pages[index], serviceUrl);
            pages.push(await persist(temporary, path));
        }
        const record = { id, text: input.text, sourceText: input.sourceText, source: input.source, params, pages, createdAt: Date.now(), taskId: response.task_id, elapsedMs: response.elapsed_ms };
        const records = listWorks();
        write(HISTORY_KEY, [record].concat(records));
        return record;
    } catch (error) {
        const failed = removeFiles(attempted);
        throw new Error((error.message || '作品保存失败。') + (failed ? ' 部分文件清理未完成，请在作品页重试清理。' : '') + ' 未写入成功历史。');
    } finally { attempted.forEach(path => inFlight.delete(path)); }
}

function deleteWork(id) {
    const records = listWorks();
    const record = records.find(item => item.id === id);
    if (!record) throw new Error('作品已不存在，请刷新列表。');
    write(HISTORY_KEY, records.filter(item => item.id !== id));
    const failed = removeFiles(record.pages);
    return { cleanupFailed: failed };
}

function verifyPages(record) {
    const fs = wx.getFileSystemManager();
    if (!record.pages.every(path => owned(path))) throw new Error('本地图片路径异常。');
    try { record.pages.forEach(path => fs.accessSync(path)); } catch (error) { throw new Error('本地图片文件已丢失，仍可恢复原文和样式重新生成。'); }
    return record.pages;
}

module.exports = { listWorks, getWork, loadDraft, saveDraft, createWork, deleteWork, cleanupOrphans, verifyPages };
