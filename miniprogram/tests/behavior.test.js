// 四组边界全部使用 wx stub；不证明微信真机、实际 OCR 引擎或实际 PNG 排版质量。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { environment, loadPage, PNG } = require('./wx-stub');
const api = require('../utils/api');
const store = require('../utils/store');
const ui = require('../utils/ui');
let env;
beforeEach(() => { env = environment(); });
const calls = name => env.state.calls.filter(call => call.name === name);
const event = id => ({ currentTarget: { dataset: { id } } });
const input = value => ({ detail: { value } });
const fixture = () => ({ text: '校对正文', sourceText: '识别原文', source: 'image', params: Object.assign({}, api.DEFAULT_PARAMS) });
const create = () => store.createWork(fixture(), env.state.render, api.DEFAULT_URL);
const managed = () => [...env.state.files.keys()].filter(file => file.startsWith('/wx-user/paper-works-v1/'));

// 边界一：真实接口契约、地址保护、失败可见。
test('接口：默认值、HTTPS 根地址及凭据拒绝', () => {
    assert.equal(api.getServiceUrl(), 'http://127.0.0.1:8765');
    assert.equal(api.normalizeUrl(' https://service.test/ '), 'https://service.test');
    ['http://service.test', 'https://user:secret@service.test', 'https://service.test/?key=secret', 'https://service.test/api', 'https://localhost', 'https://127.0.0.1', 'https://service.test:99999'].forEach(url => assert.throws(() => api.normalizeUrl(url)));
    env.state.platform = 'ios';
    assert.throws(() => api.ensureReachableUrl(api.DEFAULT_URL), /手机 localhost 不是电脑/);
    assert.equal(api.ensureReachableUrl('https://service.test'), 'https://service.test');
});
test('接口：health GET、OCR multipart file、render JSON 和默认参数准确', async () => {
    assert.equal((await api.health()).ready, true);
    const ocr = await api.ocr('/tmp/chosen-image');
    assert.equal(ocr.text, env.state.ocr.text);
    const upload = calls('uploadFile')[0].options;
    assert.equal(upload.name, 'file'); assert.equal(upload.url, api.DEFAULT_URL + '/api/ocr');
    assert.equal(upload.filePath, '/tmp/chosen-image'); assert.equal(upload.header, undefined);
    await api.render('原文\n换行', api.DEFAULT_PARAMS);
    const render = calls('request')[1].options;
    assert.equal(render.method, 'POST'); assert.equal(render.url, api.DEFAULT_URL + '/api/render');
    assert.deepEqual(render.data, Object.assign({ text: '原文\n换行' }, api.DEFAULT_PARAMS));
    assert.equal(calls('request')[0].options.method, 'GET');
    assert.equal(render.data.font, undefined);
});
test('接口：旧合成纸张归一化可重复，不能混入原背景四边距和扰动', () => {
    const old = {paper:'ruled',font_size:46,line_spacing:82,margin:98,seed:42,aa:true,ink_filter:true,ink:'black'};
    const once = api.normalizeParams(old);
    assert.deepEqual(api.normalizeParams(once), once);
    assert.equal(once.background_id, null); assert.equal(once.font_id, 'wenkai');
    assert.equal(once.left_margin, null); assert.equal(once.perturb_x_sigma, null);
    const home=loadPage('index'); home.selectPaper(event('grid'));
    const p=api.normalizeParams(home.data.params); assert.equal(p.left_margin,null); assert.equal(p.width,1240);
});
test('接口：HTTP 失败、坏 JSON、空 OCR、错误页数和外部文件地址被拒绝', async () => {
    env.state.response = { statusCode: 503, data: {} };
    await assert.rejects(api.health(), /HTTP 503/);
    env.state.response = { statusCode: 200, data: '<html>bad</html>' };
    await assert.rejects(api.ocr('/tmp/image'), /JSON/);
    env.state.response = null;
    env.state.render.page_count = 9;
    await assert.rejects(api.render('正文', api.DEFAULT_PARAMS), /响应不符合/);
    env.state.render.page_count = 2; env.state.render.pages[0] = 'https://evil.test/page.png';
    await assert.rejects(api.render('正文', api.DEFAULT_PARAMS), /响应不符合/);
    env.state.ocr.text = '';
    const home = loadPage('index'); home.onShow(); await home.chooseAlbum();
    assert.match(home.data.error, /没有识别到文字/); assert.equal(home.data.text, ''); assert.equal(home.data.busy, '');
});
test('接口：超时错误、种子不一致和非法 preview_chars', async () => {
    env.state.requestHook = options => options.fail({ errMsg: 'request:fail timeout' });
    await assert.rejects(api.health(), /超时/);
    env.state.requestHook = null; env.state.render.params.seed = 999;
    await assert.rejects(api.render('正文', api.DEFAULT_PARAMS), /参数与请求不一致/);
    assert.throws(() => api.normalizeParams({ preview_chars: 0 }), /预览字数/);
    assert.equal(api.normalizeParams({ preview_chars: 10 }).preview_chars, 10);
});
test('设置：onShow 刷新、保存失败不能提示成功、ready false 和连接防连点', async () => {
    const settings = loadPage('settings'); settings.onShow();
    settings.inputUrl(input('https://service.test'));
    env.state.failKey = 'paper.settings.v1'; settings.saveAddress();
    assert.match(settings.data.error, /未保存/); assert.equal(calls('showToast').length, 0);
    env.state.failKey = ''; settings.saveAddress(); assert.equal(api.getServiceUrl(), 'https://service.test');
    env.state.health.ready = false; await settings.testConnection(); assert.match(settings.data.status, /尚未就绪/);
    let pending; env.state.requestHook = options => { pending = options; };
    const promise = settings.testConnection(); const before = calls('request').length; await settings.testConnection(); assert.equal(calls('request').length, before);
    pending.success({ statusCode: 200, data: env.state.health }); await promise;
    api.saveServiceUrl('https://updated.test'); settings.onShow(); assert.equal(settings.data.serviceUrl, 'https://updated.test');
});

// 边界二：文件必须持久化后索引，失败回滚且只清理自己的文件。
test('持久化：全部 PNG 保存后才写索引，保留原文和相同 seed 参数', async () => {
    const record = await create();
    assert.deepEqual(record.params, api.DEFAULT_PARAMS); assert.equal(record.sourceText, '识别原文');
    assert.equal(record.text, '校对正文'); assert.equal(record.pages.length, 2);
    record.pages.forEach(file => assert.ok(env.state.files.has(file)));
    const indexWrite = env.state.calls.findIndex(call => call.name === 'setStorageSync' && call.options.key === 'paper.works.v1');
    const lastSave = env.state.calls.map(call => call.name).lastIndexOf('fs.saveFile');
    assert.ok(indexWrite > lastSave); assert.deepEqual(store.verifyPages(record), record.pages);
});
test('持久化：第二页下载失败、saveFile 失败和非 PNG 不创建成功历史', async () => {
    env.state.downloadFailAt = 2; await assert.rejects(create(), /未写入成功历史/);
    assert.deepEqual(store.listWorks(), []); assert.deepEqual(managed(), []);
    env.state.downloadFailAt = 0; env.state.saveFailAt = env.state.saveCount + 1;
    await assert.rejects(create(), /持久化失败/); assert.deepEqual(store.listWorks(), []); assert.deepEqual(managed(), []);
    env.state.saveFailAt = 0; env.state.invalidPng = true;
    await assert.rejects(create(), /有效 PNG/); assert.deepEqual(managed(), []);
});
test('持久化：索引写入失败回滚所有已保存文件', async () => {
    env.state.failKey = 'paper.works.v1';
    await assert.rejects(create(), /未写入成功历史/);
    assert.deepEqual(store.listWorks(), []); assert.deepEqual(managed(), []);
});
test('持久化：存储读取错误或坏索引不执行删除', async () => {
    await create(); const files = managed();
    env.state.readFail = true; assert.throws(() => store.cleanupOrphans(), /读取/); assert.deepEqual(managed(), files);
    env.state.readFail = false; env.state.storage.set('paper.works.v1', { invalid: true });
    assert.throws(() => store.cleanupOrphans(), /保护现有文件/); assert.deepEqual(managed(), files);
});
test('持久化：删除存储失败保留历史与文件，清理失败可在 onShow 重试', async () => {
    const record = await create(); env.state.failKey = 'paper.works.v1';
    assert.throws(() => store.deleteWork(record.id), /保存失败/); assert.equal(store.listWorks().length, 1); assert.equal(managed().length, 2);
    env.state.failKey = ''; env.state.unlinkFail = true;
    assert.equal(store.deleteWork(record.id).cleanupFailed, 2); assert.equal(store.listWorks().length, 0);
    env.state.files.set('/wx-user/other-app.png', PNG); env.state.files.set('/wx-user/paper-works-v1/unrelated.txt', Buffer.from('保留'));
    env.state.unlinkFail = false;
    const works = loadPage('works'); works.onShow(); assert.deepEqual(managed(), ['/wx-user/paper-works-v1/unrelated.txt']);
    assert.ok(env.state.files.has('/wx-user/other-app.png')); assert.equal(works.data.cleanupError, '');
});
test('持久化：切换作品页时不清理正在保存的未索引文件', async () => {
    let second;
    env.state.downloadHook = options => {
        if (env.state.downloadCount === 2) { second = options; return; }
        env.state.files.set('/tmp/first', PNG); options.success({ statusCode: 200, tempFilePath: '/tmp/first' });
    };
    const promise = create();
    // flush 已成功的第一张文件回调。
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(managed().length, 1); assert.ok(second);
    const works = loadPage('works'); works.onShow(); assert.equal(managed().length, 1);
    env.state.files.set('/tmp/second', PNG); second.success({ statusCode: 200, tempFilePath: '/tmp/second' });
    await promise; assert.equal(managed().length, 2); assert.equal(store.listWorks().length, 1);
});

// 边界三：页面校对、参数约束、防连点、真实错误重试与草稿恢复。
test('首页：选择原背景恢复原字号、四边距和笔画扰动，字体与原文不被替换', () => {
    const home = loadPage('index'); home.onShow();
    home.inputText(input('　　同一正文\n保留换行')); home.selectFont(event('yiqi'));
    home.selectBackground(event('bg2'));
    assert.equal(home.data.params.font_id, 'yiqi');
    assert.equal(home.data.params.background_id, 'bg2');
    assert.equal(home.data.params.font_size, 200); assert.equal(home.data.params.line_spacing, 300);
    assert.equal(home.data.params.left_margin, 670); assert.equal(home.data.params.right_margin, 590);
    assert.equal(home.data.params.top_margin, 540); assert.equal(home.data.params.bottom_margin, 210);
    assert.equal(home.data.params.perturb_theta_sigma, 0.10);
    assert.equal(home.data.text, '　　同一正文\n保留换行');
    const fresh = loadPage('index'); fresh.onShow(); assert.deepEqual(fresh.data.params, home.data.params);
});
test('首页：OCR 校对保留识别原文，复制正文接真实 wx API', async () => {
    const home = loadPage('index'); home.onShow(); await home.chooseAlbum();
    home.inputText(input('人工校对后的正文'));
    assert.equal(home.data.sourceText, env.state.ocr.text); assert.equal(home.data.source, 'image');
    home.finishText(); await home.copyText(); assert.equal(calls('setClipboardData')[0].options.data, '人工校对后的正文');
    const fresh = loadPage('index'); fresh.onShow(); assert.equal(fresh.data.text, '人工校对后的正文'); assert.equal(fresh.data.sourceText, env.state.ocr.text);
});
test('首页：读取资源目录并显示缩略图，缺失资源不静默替换或生成', async () => {
    const home = loadPage('index');
    env.state.requestHook = options => options.success({ statusCode: 200, data: {
        fonts: api.FONT_CHOICES.map(font => Object.assign({}, font, {available: font.id !== 'liguofu'})),
        backgrounds: Object.keys(api.ORIGINAL_PRESETS).map(id => ({id, name: '原背景' + id.slice(-1), available: true, thumbnail: '/api/resources/backgrounds/' + id + '/thumbnail.png', preset: api.ORIGINAL_PRESETS[id]}))
    } });
    await home.loadResources();
    assert.equal(home.data.resourcesLoading, false); assert.equal(home.data.resourceError, '');
    assert.equal(home.data.backgrounds[0].thumbnailUrl, api.DEFAULT_URL + '/api/resources/backgrounds/bg1/thumbnail.png');
    home.inputText(input('原文')); await home.generate();
    assert.match(home.data.error, /字体.*缺失/); assert.equal(calls('request').filter(call => call.options.method === 'POST').length, 0);
    assert.equal(home.data.params.font_id, 'liguofu');
});
test('首页：字号变大自动提高行距，低行距被钳制，草稿写失败可见', () => {
    const home = loadPage('index'); home.onShow(); home.changeSpacing(input(54)); home.changeFont(input(72));
    assert.equal(home.data.params.line_spacing, 100); home.changeSpacing(input(10)); assert.equal(home.data.params.line_spacing, 72);
    env.state.failKey = 'paper.draft.v1'; home.inputText(input('草稿')); home.finishText(); assert.match(home.data.storageError, /本地存储/);
    env.state.failKey = ''; assert.equal(home.saveDraft(), true); assert.equal(home.data.storageError, '');
    home.inputSeed(input('invalid')); assert.equal(home.finishSeed(), false);
});
test('首页：生成锁防连点，忙时输入不污染请求快照', async () => {
    const home = loadPage('index'); home.onShow(); home.inputText(input('快照原文'));
    let pending; env.state.requestHook = options => { pending = options; };
    const first = home.generate(); await home.generate(); home.inputText(input('不该被采用'));
    assert.equal(calls('request').length, 1); assert.equal(home.data.text, '快照原文'); assert.equal(home.data.busy, 'render');
    pending.success({ statusCode: 200, data: env.state.render }); await first;
    assert.equal(home.data.busy, ''); assert.equal(home.data.resultSaved, true); assert.equal(store.listWorks()[0].text, '快照原文');
});
test('首页：生成失败可重试相同参数，不制造假结果', async () => {
    const home = loadPage('index'); home.onShow(); home.inputText(input('重试原文')); home.inputSeed(input('123'));
    env.state.response = { statusCode: 500, data: {} }; await home.generate();
    assert.equal(home.data.resultSaved, false); assert.deepEqual(home.data.resultPages, []); assert.equal(home.data.retryAction, 'render');
    const body = calls('request')[0].options.data; env.state.response = null; await home.retry();
    assert.deepEqual(calls('request')[1].options.data, body); assert.equal(store.listWorks()[0].params.seed, 123);
});
test('首页：本地失败不算成功，重试保存不重新 render 且保留生成快照', async () => {
    const home = loadPage('index'); home.onShow(); home.inputText(input('渲染原文'));
    env.state.failKey = 'paper.works.v1'; await home.generate();
    assert.equal(home.data.resultSaved, false); assert.equal(home.data.retryAction, 'archive'); assert.equal(store.listWorks().length, 0);
    home.inputText(input('后来编辑的正文')); env.state.failKey = '';
    await home.retryLocalSave(); assert.equal(calls('request').length, 1); assert.equal(home.data.resultSaved, true);
    assert.equal(store.listWorks()[0].text, '渲染原文'); assert.equal(home.data.text, '后来编辑的正文');
    await home.copyResultText(); assert.equal(calls('setClipboardData').at(-1).options.data, '渲染原文');
});
test('首页：手机默认 localhost 失败可见，配置 HTTPS 后重试', async () => {
    env.state.platform = 'android';
    const home = loadPage('index'); home.onShow(); home.inputText(input('正文')); await home.generate();
    assert.match(home.data.error, /手机 localhost 不是电脑/); assert.equal(calls('request').length, 0);
    api.saveServiceUrl('https://service.test'); home.onShow(); await home.retry();
    assert.equal(calls('request')[0].options.url, 'https://service.test/api/render'); assert.equal(home.data.resultSaved, true);
});
test('首页：拍照拒绝可恢复授权并重试，取消不写入 OCR', async () => {
    const home = loadPage('index'); home.onShow(); env.state.chooseFail = 'chooseMedia:fail auth deny'; await home.takePhoto();
    assert.equal(calls('openSetting').length, 1); assert.equal(home.data.retryAction, 'choose');
    env.state.chooseFail = ''; await home.retry(); assert.equal(calls('uploadFile').length, 1);
    env.state.chooseFail = 'chooseMedia:fail cancel'; await home.chooseAlbum(); assert.equal(calls('uploadFile').length, 1); assert.equal(home.data.busy, '');
});

// 边界四：相册权限与部分失败、作品筛选、确认删除、onShow / switchTab 恢复。
test('相册：拒绝后 openSetting 恢复并保存全部页', async () => {
    env.state.auth = false;
    const progress = []; assert.equal(await ui.saveAlbum(['/p1', '/p2'], (count, total) => progress.push([count, total])), 2);
    assert.equal(calls('openSetting').length, 1); assert.deepEqual(progress, [[1, 2], [2, 2]]);
});
test('相册：不授权不能保存，隐私拒绝和部分失败不能报全部成功', async () => {
    env.state.auth = false; env.state.openAllowed = false;
    await assert.rejects(ui.saveAlbum(['/p1']), /未获得/); assert.equal(calls('saveImageToPhotosAlbum').length, 0);
    env.state.privacyFail = true; await assert.rejects(ui.saveAlbum(['/p1']), /隐私授权/);
    env.state.privacyFail = false; env.state.auth = true; env.state.albumFailAt = 2;
    await assert.rejects(ui.saveAlbum(['/p1', '/p2', '/p3']), /已保存 1\/3 页/);
});
test('相册：首页防重复保存，全部成功后才提示完成', async () => {
    const home = loadPage('index'); home.onShow(); home.inputText(input('正文')); await home.generate();
    env.state.auth = true; env.state.albumFailAt = 2; await home.saveAll();
    assert.match(home.data.error, /已保存 1\/2/); assert.equal(calls('showToast').filter(call => /已保存全部/.test(call.options.title)).length, 0);
    env.state.albumFailAt = 0; const promise = home.saveAll(); await home.saveAll(); await promise;
    assert.equal(calls('saveImageToPhotosAlbum').length, 4);
    assert.equal(calls('showToast').filter(call => /已保存全部/.test(call.options.title)).length, 1);
});
test('作品：onShow、原文搜索与筛选、查看复制、确认取消 / 删除', async () => {
    const record = await create();
    const works = loadPage('works'); works.onShow(); assert.equal(works.data.total, 1);
    works.search(input('识别原文')); assert.equal(works.data.works.length, 1);
    works.selectFilter(event('text')); assert.equal(works.data.works.length, 0); works.clearSearch();
    works.viewWork(event(record.id)); assert.equal(works.data.viewerPages.length, 2); await works.copyText();
    assert.equal(calls('setClipboardData')[0].options.data, record.text);
    env.state.modalConfirm = false; await works.deleteWork(event(record.id)); assert.equal(store.listWorks().length, 1);
    env.state.modalConfirm = true; await works.deleteWork(event(record.id)); assert.equal(store.listWorks().length, 0); assert.equal(works.data.selected, null); assert.equal(managed().length, 0);
    works.startCreate(); assert.equal(calls('switchTab').at(-1).options.url, '/pages/index/index');
});
test('作品：恢复编辑经 switchTab / onShow，原文和 seed 不丢失', async () => {
    const record = await create(); const works = loadPage('works'); works.onShow();
    works.editWork(event(record.id)); assert.equal(env.app.globalData.editWorkId, record.id);
    assert.equal(calls('switchTab').at(-1).options.url, '/pages/index/index');
    const home = loadPage('index'); home.onShow(); assert.equal(env.app.globalData.editWorkId, '');
    assert.equal(home.data.text, record.text); assert.equal(home.data.sourceText, record.sourceText); assert.deepEqual(home.data.params, record.params);
    env.app.globalData.homeBusy = true; works.editWork(event(record.id)); assert.match(works.data.error, /首页正在处理/);
});
test('作品：文件丢失仍可恢复文字，索引读取失败不当作空成功', async () => {
    const record = await create(); env.state.files.delete(record.pages[0]);
    const works = loadPage('works'); works.onShow(); works.viewWork(event(record.id)); assert.match(works.data.fileError, /丢失/); assert.deepEqual(works.data.viewerPages, []);
    works.editWork(event(record.id)); const home = loadPage('index'); home.onShow(); assert.equal(home.data.text, record.text); assert.equal(home.data.resultSaved, false);
    env.state.readFail = true; works.onShow(); assert.match(works.data.error, /读取/); assert.deepEqual(works.data.works, []);
});
