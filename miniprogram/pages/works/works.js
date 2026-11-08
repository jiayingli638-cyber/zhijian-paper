const store = require('../../utils/store');
const ui = require('../../utils/ui');
const api = require('../../utils/api');
const PAPERS = { plain: '白纸', ruled: '横线', grid: '方格' };

function dateText(value) {
    const d = new Date(value);
    return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

Page({
    data: {
        query: '', filter: 'all', filters: [{ id: 'all', name: '全部' }, { id: 'image', name: '图片识别' }, { id: 'text', name: '文字创作' }],
        works: [], total: 0, error: '', cleanupError: '', busy: false,
        selected: null, viewerPages: [], viewerIndex: 0, fileError: '', albumProgress: '',
    },

    onShow() { this.refresh(); },
    refresh() {
        try {
            const records = store.listWorks();
            this._records = records;
            this.setData({ total: records.length, error: '' });
            this.applyFilter();
            const remaining = store.cleanupOrphans();
            this.setData({ cleanupError: remaining ? '还有 ' + remaining + ' 个本程序文件未清理，请释放空间或重试清理。' : '' });
            if (this.data.selected) {
                const current = records.find(record => record.id === this.data.selected.id);
                if (!current) this.closeViewer();
            }
        } catch (error) { this._records = []; this.setData({ error: error.message, works: [] }); }
    },
    applyFilter() {
        const query = this.data.query.trim().toLowerCase();
        const works = (this._records || []).filter(record => (this.data.filter === 'all' || record.source === this.data.filter) && (!query || record.text.toLowerCase().includes(query) || record.sourceText.toLowerCase().includes(query))).map(record => ({
            id: record.id, title: record.text.trim().split('\n')[0].slice(0, 26) || '未命名作品', summary: record.text.replace(/\s+/g, ' ').slice(0, 72),
            cover: record.pages[0], meta: dateText(record.createdAt), description: record.pages.length + ' 页 · ' + (record.params.background_id ? '原背景' + record.params.background_id.slice(-1) : PAPERS[record.params.paper]) + ' · ' + (api.FONT_CHOICES.find(font => font.id === record.params.font_id) || { name: '历史字体' }).name,
        }));
        this.setData({ works });
    },
    search(event) { this.setData({ query: event.detail.value }); this.applyFilter(); },
    selectFilter(event) { this.setData({ filter: event.currentTarget.dataset.id }); this.applyFilter(); },
    clearSearch() { this.setData({ query: '', filter: 'all' }); this.applyFilter(); },

    viewWork(event) {
        if (this.data.busy) return;
        try {
            const record = store.getWork(event.currentTarget.dataset.id);
            let pages = []; let fileError = '';
            try { pages = store.verifyPages(record); } catch (error) { fileError = error.message; }
            this.setData({ selected: record, viewerPages: pages, viewerIndex: 0, fileError, albumProgress: '', error: '' });
            ui.call('pageScrollTo', { scrollTop: 0, duration: 200 }).catch(() => {});
        } catch (error) { this.setData({ error: error.message }); }
    },
    closeViewer() { if (!this.data.busy) this.setData({ selected: null, viewerPages: [], fileError: '', albumProgress: '' }); },
    changePage(event) { this.setData({ viewerIndex: event.detail.current }); },
    async previewImage(event) {
        if (!this.data.viewerPages.length || this.data.busy) return;
        const index = Number(event.currentTarget.dataset.index || 0);
        try { await ui.call('previewImage', { current: this.data.viewerPages[index], urls: this.data.viewerPages }); } catch (error) { this.setData({ error: '图片预览失败，请重试。' }); }
    },

    editWork(event) {
        if (this.data.busy) return;
        if (getApp().globalData.homeBusy) { this.setData({ error: '首页正在处理，请等待完成后再恢复历史。' }); return; }
        const id = event.currentTarget.dataset.id;
        try { store.getWork(id); } catch (error) { this.setData({ error: error.message }); return; }
        getApp().globalData.editWorkId = id;
        wx.switchTab({ url: '/pages/index/index', fail: () => { getApp().globalData.editWorkId = ''; this.setData({ error: '无法返回首页，请重试。' }); } });
    },

    async deleteWork(event) {
        if (this.data.busy) return;
        this.setData({ busy: true, error: '' });
        const id = event.currentTarget.dataset.id;
        try {
            if (!await ui.confirm('将删除这份本地历史及本程序保存的图片。已保存到手机相册的图片不会删除。此操作无法恢复。', '删除作品')) return;
            const result = store.deleteWork(id);
            if (this.data.selected && this.data.selected.id === id) this.setData({ selected: null, viewerPages: [] });
            this.refresh();
            if (result.cleanupFailed) this.setData({ cleanupError: '历史已移除，但部分本程序文件清理未完成，请重试清理。' });
            else wx.showToast({ title: '已删除本地作品', icon: 'none' });
        } catch (error) { this.setData({ error: error.message }); }
        finally { this.setData({ busy: false }); }
    },
    async saveAll() {
        if (this.data.busy || !this.data.selected || !this.data.viewerPages.length) return;
        this.setData({ busy: true, albumProgress: '', error: '' });
        try {
            const pages = store.verifyPages(this.data.selected);
            const count = await ui.saveAlbum(pages, (saved, total) => this.setData({ albumProgress: '已保存 ' + saved + '/' + total + ' 页' }));
            wx.showToast({ title: '已保存全部 ' + count + ' 页', icon: 'none' });
        } catch (error) { this.setData({ error: error.message }); }
        finally { this.setData({ busy: false }); }
    },
    async copyText() {
        if (!this.data.selected) return;
        try { await ui.copy(this.data.selected.text); } catch (error) { this.setData({ error: error.message }); }
    },
    startCreate() { wx.switchTab({ url: '/pages/index/index', fail: () => this.setData({ error: '无法打开首页，请点击底部首页重试。' }) }); },
});
