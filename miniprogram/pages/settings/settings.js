const api = require('../../utils/api');

Page({
    data: { serviceUrl: api.DEFAULT_URL, savedUrl: api.DEFAULT_URL, error: '', status: '', engine: '', testing: false, dirty: false },
    onShow() {
        if (this.data.testing) return;
        try {
            const savedUrl = api.getServiceUrl();
            this.setData({ savedUrl, serviceUrl: this.data.dirty ? this.data.serviceUrl : savedUrl, error: '' });
        } catch (error) { this.setData({ error: error.message }); }
    },
    inputUrl(event) { if (!this.data.testing) this.setData({ serviceUrl: event.detail.value, dirty: true, status: '', engine: '', error: '' }); },
    saveAddress() {
        if (this.data.testing) return;
        try {
            const url = api.saveServiceUrl(this.data.serviceUrl);
            this.setData({ serviceUrl: url, savedUrl: url, dirty: false, status: '服务地址已保存，尚未测试连接。', engine: '', error: '' });
            wx.showToast({ title: '地址已保存', icon: 'none' });
        } catch (error) { this.setData({ error: error.message, status: '', engine: '' }); }
    },
    usePreview() {
        if (this.data.testing) return;
        this.setData({ serviceUrl: api.DEFAULT_URL, dirty: true, status: '', error: '', engine: '' });
    },
    async testConnection() {
        if (this.data.testing) return;
        this.setData({ testing: true, error: '', status: '正在检查服务连接…', engine: '' });
        try {
            const result = await api.health(this.data.serviceUrl);
            this.setData({ status: result.ready ? (result.original_resources_ready === false ? '连接成功，但原字体或背景缺失，请检查资源目录。' : '连接成功，服务已就绪。') + (this.data.dirty ? ' 地址尚未保存，请点击保存地址。' : '') : '服务可以连接，但引擎尚未就绪，请启动 OCR / 渲染引擎后重试。', engine: result.engine + (result.renderer ? ' · ' + result.renderer : '') });
        } catch (error) { this.setData({ error: api.message(error, '连接失败，请检查服务。'), status: '', engine: '' }); }
        finally { this.setData({ testing: false }); }
    },
});
