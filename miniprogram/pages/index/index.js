const api = require('../../utils/api');
const store = require('../../utils/store');
const ui = require('../../utils/ui');

Page({
    data: {
        text: '', sourceText: '', source: 'text', imagePath: '', ocrNote: '', ocrLines: [],
        params: Object.assign({}, api.DEFAULT_PARAMS), seedInput: '42',
        fonts: api.FONT_CHOICES.map(font => Object.assign({}, font, { available: null })),
        backgrounds: Object.keys(api.ORIGINAL_PRESETS).map(id => ({ id, name: '原背景' + id.slice(-1), available: null, thumbnailUrl: '' })),
        resourcesLoading: false, resourceError: '',
        papers: [{ id: 'plain', name: '白纸' }, { id: 'ruled', name: '横线' }, { id: 'grid', name: '方格' }],
        inks: [{ id: 'black', name: '黑色' }, { id: 'blue', name: '蓝色' }],
        busy: '', statusText: '', focusText: false, showOriginal: false,
        error: '', retryAction: '', storageError: '', serviceHint: '',
        resultPages: [], resultText: '', resultIndex: 0, resultSaved: false, resultNote: '', albumProgress: '', restored: false,
    },

    onLoad() { this.loadResources(); },

    async loadResources() {
        if (this.data.resourcesLoading || this.data.busy) return;
        this.setData({ resourcesLoading: true, resourceError: '' });
        try {
            const url = api.getServiceUrl();
            this._resourceUrl = url;
            const result = await api.resources(url);
            this.setData({ fonts: result.fonts, backgrounds: result.backgrounds.map(item => Object.assign({}, item, { thumbnailUrl: item.available ? url + item.thumbnail : '' })) });
        } catch (error) { this.setData({ resourceError: api.message(error, '原字体与背景目录未读取，请检查服务后重试。') }); }
        finally { this.setData({ resourcesLoading: false }); }
    },

    onShow() {
        try {
            const url = api.getServiceUrl();
            this.setData({ serviceHint: url === api.DEFAULT_URL ? '当前为开发预览地址；手机需在设置中配置 HTTPS。' : '图片与文字将发送到您配置的服务，仅作品在本地保存。' });
            if (this._resourceUrl && this._resourceUrl !== url) this.loadResources();
        } catch (error) { this.setData({ storageError: error.message }); }
        if (this.data.busy) return;
        const app = getApp();
        if (app.globalData.editWorkId) {
            const id = app.globalData.editWorkId;
            try {
                const work = store.getWork(id);
                this.applyDraft(work);
                let fileError = '';
                try { store.verifyPages(work); } catch (error) { fileError = error.message; }
                this._pending = null;
                this._resultWorkId = work.id;
                this._initialized = true;
                this.setData({ resultPages: fileError ? [] : work.pages, resultText: work.text, resultSaved: !fileError, resultIndex: 0, resultNote: '已恢复历史原文与相同种子参数，可继续编辑。', restored: true, error: fileError, retryAction: fileError ? 'render' : '', storageError: '' });
                app.globalData.editWorkId = '';
                this.saveDraft();
            } catch (error) { this.setData({ error: error.message, retryAction: '' }); app.globalData.editWorkId = ''; }
        } else {
            if (!this._initialized) {
                try { const draft = store.loadDraft(); if (draft) this.applyDraft(draft); this._initialized = true; }
                catch (error) { this.setData({ storageError: error.message }); }
            }
            if (this._resultWorkId) {
                try { store.verifyPages(store.getWork(this._resultWorkId)); }
                catch (error) { this._resultWorkId = ''; this.setData({ resultPages: [], resultSaved: false, error: error.message, retryAction: 'render' }); }
            }
        }
    },

    onHide() { if (this._initialized) this.saveDraft(); },
    onUnload() { if (this._initialized) this.saveDraft(); },

    applyDraft(draft) {
        this.setData({ text: draft.text, sourceText: draft.sourceText, source: draft.source, params: api.normalizeParams(draft.params), seedInput: String(draft.params.seed), imagePath: '', ocrNote: '', ocrLines: [], error: '', retryAction: '', showOriginal: false, focusText: false });
    },

    setBusy(busy, statusText) {
        getApp().globalData.homeBusy = !!busy;
        this.setData({ busy, statusText: statusText || '' });
    },

    saveDraft() {
        try { store.saveDraft(this.data); this._initialized = true; this.setData({ storageError: '' }); return true; }
        catch (error) { this.setData({ storageError: error.message }); return false; }
    },

    inputText(event) {
        if (this.data.busy) return;
        const text = event.detail.value;
        this._initialized = true;
        const updates = { text, restored: false, error: '', retryAction: '' };
        if (this.data.source === 'text') updates.sourceText = text;
        this.setData(updates);
    },

    finishText() { this.setData({ focusText: false }); this.saveDraft(); },

    async inputEntry() {
        if (this.data.busy) return;
        this.setData({ focusText: true });
        try { await ui.call('pageScrollTo', { selector: '#proofread', duration: 200 }); } catch (error) { /* 文本框仍可直接编辑。 */ }
    },

    async useExample() {
        if (this.data.busy) return;
        if (this.data.text.trim() && !await ui.confirm('将替换当前正文为示例文字，是否继续？', '使用示例')) return;
        if (this.data.busy) return;
        const text = '清晨的光落在纸上，\n把平凡的日子，写成温柔的篇章。\n\n愿每一个认真生活的瞬间，\n都值得被好好收藏。';
        this._pending = null;
        this._resultWorkId = '';
        this.setData({ text, sourceText: text, source: 'text', imagePath: '', ocrNote: '', ocrLines: [], error: '', retryAction: '', restored: false, resultPages: [], resultSaved: false, resultNote: '' });
        this.saveDraft();
        this.inputEntry();
    },

    takePhoto() { return this.chooseImage('camera'); },
    chooseAlbum() { return this.chooseImage('album'); },

    async chooseImage(sourceType) {
        if (this.data.busy) return;
        this.setBusy('choose', '正在选择图片');
        try {
            await ui.privacy();
            const result = await ui.call('chooseMedia', { count: 1, mediaType: ['image'], sourceType: [sourceType], sizeType: ['compressed'] });
            const path = result.tempFiles[0].tempFilePath;
            if (this.data.text.trim() && !await ui.confirm('识别成功后会替换当前正文，是否继续？', '识别新图片')) return;
            this.setData({ imagePath: path, error: '', retryAction: '' });
            await this.performOcr(path);
        } catch (error) {
            const detail = error.errMsg || error.message || '';
            if (/cancel/i.test(detail)) return;
            if (/auth|permission|deny/i.test(detail)) {
                const scope = sourceType === 'camera' ? 'scope.camera' : 'scope.album';
                try { await ui.restorePermission(scope, '请在微信设置中允许访问' + (sourceType === 'camera' ? '相机' : '相册') + '，然后重新选择图片。'); } catch (permissionError) { /* 保留失败提示供重试。 */ }
            }
            this._retrySource = sourceType;
            this.setData({ error: error.message || '选择图片失败，请检查相机 / 相册和隐私授权后重试。', retryAction: 'choose' });
        } finally { this.setBusy(''); }
    },

    async performOcr(path) {
        this.setBusy('ocr', '正在识别图片，请稍候');
        try {
            const result = await api.ocr(path);
            if (!result.text.trim()) throw new Error('没有识别到文字，请换一张清晰图片后重试。');
            const low = result.lines.filter(line => line.score < 0.8).length;
            this._pending = null;
            this._resultWorkId = '';
            this.setData({ text: result.text, sourceText: result.text, source: 'image', ocrLines: result.lines.map((line, index) => ({ id: index, text: line.text, low: line.score < 0.8, confidence: Math.round(line.score * 100) })), ocrNote: result.engine + ' · ' + result.lines.length + ' 行' + (low ? ' · ' + low + ' 行建议重点校对' : '') + ' · ' + result.elapsed_ms + ' ms', error: '', retryAction: '', restored: false, showOriginal: false, resultPages: [], resultSaved: false, resultNote: '' });
            this.saveDraft();
        } catch (error) { this.setData({ error: api.message(error, '识别失败。'), retryAction: 'ocr' }); }
    },

    removeImage() {
        if (this.data.busy) return;
        const untouched = this.data.source === 'image' && this.data.text === this.data.sourceText;
        const updates = { imagePath: '', ocrNote: '', ocrLines: [], showOriginal: false, error: '', retryAction: '', restored: false };
        if (untouched) Object.assign(updates, { text: '', sourceText: '', source: 'text' });
        else if (this.data.source === 'image') Object.assign(updates, { source: 'text', sourceText: this.data.text });
        this.setData(updates);
        this.saveDraft();
        wx.showToast({ title: untouched ? '图片与识别文字已删除' : '图片已删除，正文已保留', icon: 'none' });
    },

    toggleOriginal() { this.setData({ showOriginal: !this.data.showOriginal }); },

    selectFont(event) {
        const id = event.currentTarget.dataset.id;
        const font = this.data.fonts.find(item => item.id === id);
        if (!font || this.data.busy) return;
        if (font.available === false) { this.setData({ error: '所选原字体文件缺失，请检查服务资源目录。', retryAction: '' }); return; }
        this.updateParam('font_id', id);
    },
    selectBackground(event) {
        const id = event.currentTarget.dataset.id;
        const background = this.data.backgrounds.find(item => item.id === id);
        if (!background || this.data.busy) return;
        if (background.available === false) { this.setData({ error: '所选原背景文件缺失，请检查服务资源目录。', retryAction: '' }); return; }
        this.setData({ params: Object.assign({}, this.data.params, api.ORIGINAL_PRESETS[id], { background_id: id }), error: '', retryAction: '' });
        this.saveDraft();
    },
    restorePreset() {
        if (this.data.params.background_id) this.selectBackground({ currentTarget: { dataset: { id: this.data.params.background_id } } });
    },
    selectPaper(event) {
        if (this.data.busy) return;
        const legacy = api.normalizeParams({ paper: event.currentTarget.dataset.id, font_size: 46, line_spacing: 82 });
        this.setData({ params: Object.assign({}, legacy, { font_id: this.data.params.font_id, seed: this.data.params.seed, aa: this.data.params.aa, ink_filter: this.data.params.ink_filter, ink: this.data.params.ink }), error: '', retryAction: '' });
        this.saveDraft();
    },
    selectInk(event) { this.updateParam('ink', event.currentTarget.dataset.id); },
    changeFont(event) {
        if (this.data.busy) return;
        const font = Number(event.detail.value);
        this.setData({ params: Object.assign({}, this.data.params, { font_size: font, line_spacing: Math.max(this.data.params.line_spacing, font) }), error: '', retryAction: '' });
        this.saveDraft();
    },
    changeSpacing(event) { this.updateParam('line_spacing', Math.max(Number(event.detail.value), this.data.params.font_size)); },
    changeAA(event) { this.updateParam('aa', event.detail.value); },
    changeFilter(event) { this.updateParam('ink_filter', event.detail.value); },
    updateParam(key, value) {
        if (this.data.busy) return;
        this.setData({ params: Object.assign({}, this.data.params, { [key]: value }), error: '', retryAction: '' });
        this.saveDraft();
    },
    inputSeed(event) { if (!this.data.busy) this.setData({ seedInput: event.detail.value }); },
    finishSeed() {
        if (!/^\d+$/.test(this.data.seedInput)) { this.setData({ error: '种子须为 0–2147483647 的整数。', retryAction: '' }); return false; }
        const seed = Number(this.data.seedInput);
        if (!Number.isInteger(seed) || seed > 2147483647) { this.setData({ error: '种子须为 0–2147483647 的整数。', retryAction: '' }); return false; }
        this.setData({ params: Object.assign({}, this.data.params, { seed }), error: '', retryAction: '' });
        this.saveDraft();
        return true;
    },

    async generate() {
        if (this.data.busy) return;
        if (!this.data.text.trim()) { this.setData({ error: '请先选择图片识别，或输入文字。', retryAction: '' }); return; }
        if (!this.finishSeed()) return;
        let params;
        try { params = api.normalizeParams(this.data.params); } catch (error) { this.setData({ error: error.message, retryAction: '' }); return; }
        const font = this.data.fonts.find(item => item.id === params.font_id);
        const background = this.data.backgrounds.find(item => item.id === params.background_id);
        if (font && font.available === false || background && background.available === false) {
            this.setData({ error: font && font.available === false ? '所选字体文件缺失，请检查原资源目录，或手动选择其他字体。' : '所选背景文件缺失，请检查原资源目录。', retryAction: '' }); return;
        }
        const input = { text: this.data.text, sourceText: this.data.sourceText, source: this.data.source, params };
        this.setBusy('render', '正在生成手写 PNG，请稍候');
        this._pending = null;
        this._resultWorkId = '';
        this.setData({ error: '', retryAction: '', resultPages: [], resultText: input.text, resultSaved: false, resultIndex: 0, resultNote: '', albumProgress: '' });
        try {
            const serviceUrl = api.getServiceUrl();
            const response = await api.render(input.text, params, serviceUrl);
            this._pending = { input, response, serviceUrl };
            this.setData({ resultPages: response.pages.map(path => serviceUrl + path), resultNote: '生成已返回，正在持久保存全部图片。' });
            await this.archivePending();
        } catch (error) { this.setData({ error: api.message(error, '生成失败。'), retryAction: 'render' }); }
        finally { this.setBusy(''); }
    },

    async archivePending() {
        const pending = this._pending;
        if (!pending) return;
        this.setBusy('archive', '正在保存全部图片与本地历史');
        try {
            const work = await store.createWork(pending.input, pending.response, pending.serviceUrl);
            this._pending = null;
            this._resultWorkId = work.id;
            this.setData({ resultPages: work.pages, resultText: work.text, resultSaved: true, resultIndex: 0, resultNote: '已持久保存到本机 · ' + work.pages.length + ' 页 · ' + work.elapsedMs + ' ms', error: '', retryAction: '' });
        } catch (error) { this.setData({ resultSaved: false, resultNote: '本地保存未完成，不计为成功作品。', error: error.message, retryAction: 'archive' }); }
    },

    async retryLocalSave() {
        if (this.data.busy || !this._pending) return;
        try { await this.archivePending(); } finally { this.setBusy(''); }
    },

    async retry() {
        if (this.data.busy) return;
        if (this.data.retryAction === 'render') return this.generate();
        if (this.data.retryAction === 'choose') return this.chooseImage(this._retrySource || 'album');
        if (this.data.retryAction === 'ocr') {
            if (!this.data.imagePath) return this.chooseAlbum();
            try { await this.performOcr(this.data.imagePath); } finally { this.setBusy(''); }
        } else if (this.data.retryAction === 'archive') {
            if (!this._pending) return;
            try { await this.archivePending(); } finally { this.setBusy(''); }
        }
    },

    changePage(event) { this.setData({ resultIndex: event.detail.current }); },
    async previewImage(event) {
        if (this.data.busy || !this.data.resultPages.length) return;
        const index = Number(event.currentTarget.dataset.index || 0);
        try { await ui.call('previewImage', { current: this.data.resultPages[index], urls: this.data.resultPages }); } catch (error) { this.setData({ error: '图片预览失败，请重试。', retryAction: '' }); }
    },
    async saveAll() {
        if (this.data.busy || !this.data.resultSaved) return;
        this.setBusy('album', '正在保存到相册');
        this.setData({ albumProgress: '', error: '', retryAction: '' });
        try {
            const count = await ui.saveAlbum(this.data.resultPages, (saved, total) => this.setData({ albumProgress: '已保存 ' + saved + '/' + total + ' 页' }));
            wx.showToast({ title: '已保存全部 ' + count + ' 页', icon: 'none' });
        } catch (error) { this.setData({ error: error.message, retryAction: '' }); }
        finally { this.setBusy(''); }
    },
    async copyText() { try { await ui.copy(this.data.text); } catch (error) { this.setData({ error: error.message, retryAction: '' }); } },
    async copyResultText() { try { await ui.copy(this.data.resultText); } catch (error) { this.setData({ error: error.message, retryAction: '' }); } },
    openSettings() { wx.switchTab({ url: '/pages/settings/settings', fail: () => this.setData({ error: '无法打开设置，请点击底部设置重试。', retryAction: '' }) }); },
});
