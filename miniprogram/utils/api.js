const DEFAULT_URL = 'http://127.0.0.1:8765';
const SETTINGS_KEY = 'paper.settings.v1';
const FONT_CHOICES = [{id:'liguofu',name:'李国夫手写体'},{id:'yiqi',name:'义启手写体'},{id:'qingye',name:'青叶手写体'},{id:'yunyan',name:'云烟体'},{id:'wenkai',name:'霞鹜文楷（附加）'}];
const ORIGINAL_PRESETS = {
    bg1: {width:3024,height:3342,font_size:100,line_spacing:143,left_margin:180,right_margin:100,top_margin:140,bottom_margin:70,word_spacing:5,line_spacing_sigma:0,font_size_sigma:2,word_spacing_sigma:2,perturb_x_sigma:3,perturb_y_sigma:3,perturb_theta_sigma:0.05},
    bg2: {width:7000,height:9333,font_size:200,line_spacing:300,left_margin:670,right_margin:590,top_margin:540,bottom_margin:210,word_spacing:4,line_spacing_sigma:2,font_size_sigma:10,word_spacing_sigma:2,perturb_x_sigma:5,perturb_y_sigma:5,perturb_theta_sigma:0.10},
    bg3: {width:4000,height:5657,font_size:130,line_spacing:270,left_margin:420,right_margin:330,top_margin:190,bottom_margin:520,word_spacing:7,line_spacing_sigma:0,font_size_sigma:2,word_spacing_sigma:2,perturb_x_sigma:3,perturb_y_sigma:3,perturb_theta_sigma:0.05}
};
const DEFAULT_PARAMS = Object.assign({paper:'plain',background_id:'bg1',font_id:'liguofu',seed:42,aa:false,ink_filter:false,ink:'black',end_chars:'，。'},ORIGINAL_PRESETS.bg1);

function message(error, fallback) {
    const detail = error && (error.message || error.errMsg);
    if (detail && /timeout/i.test(detail)) return '服务响应超时，请检查服务后重试。';
    if (detail && /fail|network|domain/i.test(detail)) return '无法连接服务，请检查 HTTPS 地址、网络及微信合法域名配置。';
    return detail || fallback;
}

function normalizeUrl(value) {
    const url = String(value || '').trim().replace(/\/+$/, '');
    if (url === DEFAULT_URL) return url;
    if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i.test(url)) {
        throw new Error('请输入 HTTPS 服务根地址（不含路径、账号、密码、查询参数或密钥）。');
    }
    const authority = url.slice(8);
    const host = authority.split(':')[0].toLowerCase();
    const port = authority.split(':')[1];
    if (host === 'localhost' || /^127\./.test(host) || host.indexOf('..') !== -1 || (port && (+port < 1 || +port > 65535))) {
        throw new Error('手机 localhost 不是电脑，请填写手机可访问的 HTTPS 地址。');
    }
    return url;
}

function getServiceUrl() {
    let settings;
    try { settings = wx.getStorageSync(SETTINGS_KEY); } catch (error) { throw new Error('读取服务设置失败，请在设置页重试。'); }
    if (settings === '' || settings === undefined || settings === null) return DEFAULT_URL;
    if (!settings || typeof settings.serviceUrl !== 'string') throw new Error('本地服务设置格式异常，请重新保存地址。');
    return normalizeUrl(settings.serviceUrl);
}

function saveServiceUrl(value) {
    const serviceUrl = normalizeUrl(value);
    try { wx.setStorageSync(SETTINGS_KEY, { serviceUrl }); } catch (error) { throw new Error('服务地址未保存：本地存储失败，请释放空间后重试。'); }
    return serviceUrl;
}

function ensureReachableUrl(value) {
    const url = normalizeUrl(value);
    if (url === DEFAULT_URL) {
        let platform = '';
        try { platform = (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()).platform; } catch (error) { /* 未知环境按真机处理。 */ }
        if (!['devtools', 'windows', 'mac', 'workbuddy'].includes(platform)) {
            throw new Error('手机 localhost 不是电脑。默认地址仅供 WorkBuddy / 开发预览，请在设置中配置可访问的 HTTPS 服务地址。');
        }
    }
    return url;
}

function decode(data) {
    if (typeof data !== 'string') return data;
    try { return JSON.parse(data); } catch (error) { throw new Error('服务返回的内容不是有效 JSON。'); }
}

function checkResponse(response) {
    const body = decode(response.data);
    if (!Number.isInteger(response.statusCode) || response.statusCode < 200 || response.statusCode >= 300) {
        const detail = body && body.error && body.error.message;
        throw new Error(detail || ('服务请求失败（HTTP ' + response.statusCode + '），请检查服务后重试。'));
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('服务响应格式不正确。');
    return body;
}

function request(url, path, method, data) {
    return new Promise((resolve, reject) => {
        wx.request({ url: url + path, method, data, timeout: method === 'POST' ? 180000 : 15000,
            header: { 'content-type': 'application/json' },
            success(response) { try { resolve(checkResponse(response)); } catch (error) { reject(error); } },
            fail(error) { reject(new Error(message(error, '服务连接失败。'))); }
        });
    });
}

async function health(value) {
    const url = ensureReachableUrl(value || getServiceUrl());
    const result = await request(url, '/api/health', 'GET');
    if (typeof result.ready !== 'boolean' || typeof result.engine !== 'string' || !result.engine.trim()) throw new Error('健康检查响应缺少 ready / engine。');
    return result;
}

function ocr(filePath, value) {
    const url = ensureReachableUrl(value || getServiceUrl());
    return new Promise((resolve, reject) => {
        wx.uploadFile({ url: url + '/api/ocr', filePath, name: 'file', timeout: 180000,
            success(response) {
                try {
                    const result = checkResponse(response);
                    if (typeof result.text !== 'string' || !Array.isArray(result.lines) || typeof result.engine !== 'string' || !Number.isFinite(result.elapsed_ms) || !Number.isFinite(result.width) || !Number.isFinite(result.height) || result.width <= 0 || result.height <= 0 || result.lines.some(line => !line || typeof line.text !== 'string' || !Number.isFinite(line.score) || !Array.isArray(line.box))) throw new Error('OCR 响应不符合约定，请检查服务版本。');
                    resolve(result);
                } catch (error) { reject(error); }
            },
            fail(error) { reject(new Error(message(error, '图片识别失败，请重试。'))); }
        });
    });
}

function normalizeParams(params) {
    const legacy = params && params.font_size !== undefined && !Object.prototype.hasOwnProperty.call(params,'background_id');
    const base = legacy || params && params.background_id === null ? {paper:'plain',font_id:'wenkai',background_id:null,width:1240,height:1754,font_size:46,line_spacing:82,margin:98,word_spacing:3,seed:42,aa:legacy,ink_filter:legacy,ink:'black',left_margin:null,right_margin:null,top_margin:null,bottom_margin:null,line_spacing_sigma:0,font_size_sigma:null,word_spacing_sigma:null,perturb_x_sigma:null,perturb_y_sigma:null,perturb_theta_sigma:null,end_chars:'，。'} : Object.assign({}, DEFAULT_PARAMS, params && ORIGINAL_PRESETS[params.background_id]);
    const p = Object.assign({}, base, params);
    if (!['plain','ruled','grid'].includes(p.paper) || !['black','blue'].includes(p.ink) || !FONT_CHOICES.some(font=>font.id===p.font_id) || (p.background_id!==null && !ORIGINAL_PRESETS[p.background_id]) || !Number.isInteger(p.font_size) || p.font_size<18 || p.font_size>400 || !Number.isInteger(p.line_spacing) || p.line_spacing<p.font_size || p.line_spacing>600 || !Number.isInteger(p.seed) || p.seed<0 || p.seed>2147483647 || typeof p.aa!=='boolean' || typeof p.ink_filter!=='boolean') throw new Error('样式参数不正确：行距不能小于字号，请检查字体、背景或整数种子。');
    const keys=['paper','font_id','background_id','width','height','font_size','line_spacing','margin','word_spacing','seed','aa','ink_filter','ink','left_margin','right_margin','top_margin','bottom_margin','line_spacing_sigma','font_size_sigma','word_spacing_sigma','perturb_x_sigma','perturb_y_sigma','perturb_theta_sigma','end_chars'];
    const normalized={}; keys.forEach(key=>{if(p[key]!==undefined) normalized[key]=p[key];});
    if(p.preview_chars!==undefined){if(!Number.isInteger(p.preview_chars)||p.preview_chars<=0||p.preview_chars>10000)throw new Error('预览字数必须是正整数。');normalized.preview_chars=p.preview_chars;}
    return normalized;
}

async function resources(value) {
    const url=ensureReachableUrl(value||getServiceUrl());
    const result=await request(url,'/api/resources','GET');
    if(!Array.isArray(result.fonts)||!Array.isArray(result.backgrounds))throw new Error('字体背景目录响应无效');
    return result;
}

async function render(text, params, value) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('请先输入或识别文字。');
    const url = ensureReachableUrl(value || getServiceUrl());
    const body = Object.assign({ text }, normalizeParams(params));
    const result = await request(url, '/api/render', 'POST', body);
    if (typeof result.task_id !== 'string' || !result.task_id || !Number.isInteger(result.page_count) || result.page_count < 1 || !Array.isArray(result.pages) || result.pages.length !== result.page_count || result.pages.some(path => typeof path !== 'string' || !/^\/api\/files\/[a-f0-9-]{16,64}\/page-\d{3,}\.png$/i.test(path)) || !Number.isFinite(result.elapsed_ms) || !result.params || typeof result.params !== 'object') throw new Error('生成响应不符合约定，未保存为作品。');
    if (Object.keys(body).filter(key=>key!=='text').some(key => result.params[key] !== undefined && result.params[key] !== body[key])) throw new Error('服务返回的样式参数与请求不一致，请检查服务版本，未保存为作品。');
    return result;
}

function download(path, value) {
    const url = ensureReachableUrl(value);
    if (!/^\/api\/files\/[a-f0-9-]{16,64}\/page-\d{3,}\.png$/i.test(path)) throw new Error('图片地址不是约定的服务文件路径。');
    return new Promise((resolve, reject) => {
        wx.downloadFile({ url: url + path, timeout: 120000,
            success(result) {
                if (result.statusCode !== 200 || !result.tempFilePath) { reject(new Error('图片下载失败（HTTP ' + result.statusCode + '）。')); return; }
                resolve(result.tempFilePath);
            },
            fail(error) { reject(new Error(message(error, '图片下载失败。'))); }
        });
    });
}

module.exports = { DEFAULT_URL, DEFAULT_PARAMS, FONT_CHOICES, ORIGINAL_PRESETS, resources, getServiceUrl, saveServiceUrl, normalizeUrl, ensureReachableUrl, normalizeParams, health, ocr, render, download, message };
