// 仅模拟 wx 回调与本地状态，用于 Node 页面行为测试，不是微信运行时或真实 OCR。
const path = require('node:path');
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function createWx() {
    const state = {
        storage: new Map(), files: new Map(), dirs: new Set(['/wx-user']), calls: [],
        platform: 'devtools', readFail: false, writeFail: false, failKey: '', unlinkFail: false, saveFailAt: 0, saveCount: 0,
        downloadFailAt: 0, downloadCount: 0, invalidPng: false, auth: undefined, authorizeFail: false, openAllowed: true, privacyFail: false,
        albumFailAt: 0, albumCount: 0, modalConfirm: true, switchFail: false, chooseFail: '', response: null, requestHook: null, downloadHook: null, uploadHook: null,
        health: { ready: true, engine: '测试夹具引擎' },
        ocr: { text: '识别原文\n第二行', lines: [{ text: '识别原文', score: 0.7, box: [[0, 0], [10, 0], [10, 10], [0, 10]] }], engine: '测试夹具引擎', elapsed_ms: 12, width: 100, height: 100 },
        render: { task_id: 'fixture-task', page_count: 2, pages: ['/api/files/00000000-0000-4000-8000-000000000001/page-001.png', '/api/files/00000000-0000-4000-8000-000000000001/page-002.png'], elapsed_ms: 23, params: {} },
    };
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const record = (name, options) => { state.calls.push({ name, options }); };
    const fs = {
        accessSync(file) { if (!state.files.has(file) && !state.dirs.has(file)) throw new Error('ENOENT: no such file'); },
        mkdirSync(dir) { state.dirs.add(dir); },
        readFileSync(file) { if (!state.files.has(file)) throw new Error('ENOENT'); const b = state.files.get(file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
        saveFile(options) {
            record('fs.saveFile', options); state.saveCount += 1;
            if (state.saveCount === state.saveFailAt) { options.fail({ errMsg: 'saveFile:fail quota' }); return; }
            if (!state.files.has(options.tempFilePath)) { options.fail({ errMsg: 'saveFile:fail ENOENT' }); return; }
            state.files.set(options.filePath, state.files.get(options.tempFilePath)); state.files.delete(options.tempFilePath);
            options.success({ savedFilePath: options.filePath });
        },
        unlinkSync(file) { record('fs.unlinkSync', { file }); if (state.unlinkFail) throw new Error('permission denied'); if (!state.files.delete(file)) throw new Error('ENOENT: no such file'); },
        readdirSync(dir) { return [...state.files.keys()].filter(file => file.startsWith(dir + '/') && !file.slice(dir.length + 1).includes('/')).map(file => file.slice(dir.length + 1)); },
    };
    const wx = {
        env: { USER_DATA_PATH: '/wx-user' },
        getDeviceInfo() { return { platform: state.platform }; },
        getStorageSync(key) { record('getStorageSync', { key }); if (state.readFail) throw new Error('读取失败'); return state.storage.has(key) ? clone(state.storage.get(key)) : ''; },
        setStorageSync(key, value) { record('setStorageSync', { key, value: clone(value) }); if (state.writeFail || state.failKey === key) throw new Error('写入失败'); state.storage.set(key, clone(value)); },
        getFileSystemManager() { return fs; },
        request(options) { record('request', options); if (state.requestHook) return state.requestHook(options); options.success(state.response || { statusCode: 200, data: clone(options.method === 'GET' ? state.health : state.render) }); },
        uploadFile(options) { record('uploadFile', options); if (state.uploadHook) return state.uploadHook(options); options.success(state.response || { statusCode: 200, data: JSON.stringify(state.ocr) }); },
        downloadFile(options) {
            record('downloadFile', options); state.downloadCount += 1;
            if (state.downloadHook) return state.downloadHook(options);
            if (state.downloadCount === state.downloadFailAt) { options.success({ statusCode: 500 }); return; }
            const tempFilePath = '/tmp/png-' + state.downloadCount;
            state.files.set(tempFilePath, state.invalidPng ? Buffer.from('not-png') : PNG);
            options.success({ statusCode: 200, tempFilePath });
        },
        chooseMedia(options) { record('chooseMedia', options); if (state.chooseFail) options.fail({ errMsg: state.chooseFail }); else options.success({ tempFiles: [{ tempFilePath: '/tmp/chosen-image' }] }); },
        requirePrivacyAuthorize(options) { record('requirePrivacyAuthorize', options); if (state.privacyFail) options.fail({ errMsg: 'privacy:fail' }); else options.success({}); },
        showModal(options) { record('showModal', options); options.success({ confirm: state.modalConfirm, cancel: !state.modalConfirm }); },
        getSetting(options) { record('getSetting', options); options.success({ authSetting: { 'scope.writePhotosAlbum': state.auth } }); },
        authorize(options) { record('authorize', options); if (state.authorizeFail) options.fail({ errMsg: 'authorize:fail deny' }); else { state.auth = true; options.success({}); } },
        openSetting(options) { record('openSetting', options); state.auth = state.openAllowed; options.success({ authSetting: { 'scope.writePhotosAlbum': state.openAllowed, 'scope.camera': state.openAllowed, 'scope.album': state.openAllowed } }); },
        saveImageToPhotosAlbum(options) { record('saveImageToPhotosAlbum', options); state.albumCount += 1; if (state.albumCount === state.albumFailAt) options.fail({ errMsg: 'saveImageToPhotosAlbum:fail' }); else options.success({}); },
        setClipboardData(options) { record('setClipboardData', options); options.success({}); },
        previewImage(options) { record('previewImage', options); options.success({}); },
        pageScrollTo(options) { record('pageScrollTo', options); options.success({}); },
        switchTab(options) { record('switchTab', options); if (state.switchFail && options.fail) options.fail({ errMsg: 'switchTab:fail' }); else if (options.success) options.success({}); },
        showToast(options) { record('showToast', options); },
    };
    return { wx, state, fs };
}

function loadPage(name) {
    const file = path.resolve(__dirname, '../pages/' + name + '/' + name + '.js');
    let definition;
    global.Page = value => { definition = value; };
    delete require.cache[file];
    require(file);
    const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) });
    page.setData = changes => { Object.keys(changes).forEach(key => { if (changes[key] === undefined) throw new Error('setData 不接受 undefined: ' + key); page.data[key] = changes[key]; }); };
    return page;
}

function environment() {
    const env = createWx();
    global.wx = env.wx;
    env.app = { globalData: { editWorkId: '', homeBusy: false } };
    global.getApp = () => env.app;
    return env;
}

module.exports = { environment, loadPage, PNG };
