function call(name, options) {
    return new Promise((resolve, reject) => wx[name](Object.assign({}, options, { success: resolve, fail: reject })));
}

async function confirm(content, title) {
    const result = await call('showModal', { title: title || '请确认', content, confirmText: '确认', cancelText: '取消' });
    return result.confirm;
}

async function privacy() {
    if (wx.requirePrivacyAuthorize) await call('requirePrivacyAuthorize');
}

async function restorePermission(scope, content) {
    if (!await confirm(content, '需要授权')) return false;
    const result = await call('openSetting');
    return !!(result.authSetting && result.authSetting[scope]);
}

async function albumPermission() {
    await privacy();
    const result = await call('getSetting');
    const state = result.authSetting && result.authSetting['scope.writePhotosAlbum'];
    if (state === true) return true;
    if (state === false) return restorePermission('scope.writePhotosAlbum', '请在微信设置中允许保存到相册，然后继续保存。');
    try { await call('authorize', { scope: 'scope.writePhotosAlbum' }); return true; } catch (error) {
        return restorePermission('scope.writePhotosAlbum', '相册权限未开启。可前往设置开启后继续保存。');
    }
}

async function saveAlbum(paths, progress) {
    if (!paths.length) throw new Error('没有可保存的图片。');
    let allowed;
    try { allowed = await albumPermission(); } catch (error) { throw new Error('相册授权未完成，尚未保存图片，请检查微信隐私授权和相册权限后重试。'); }
    if (!allowed) throw new Error('未获得相册权限，尚未保存图片。请开启权限后重试。');
    let saved = 0;
    for (let index = 0; index < paths.length; index += 1) {
        try {
            await call('saveImageToPhotosAlbum', { filePath: paths[index] });
            saved += 1;
            if (progress) progress(saved, paths.length);
        } catch (error) {
            throw new Error('已保存 ' + saved + '/' + paths.length + ' 页，其余未保存。请检查相册权限和空间后重试，重试可能产生重复图片。');
        }
    }
    return saved;
}

async function copy(text) {
    if (!text) throw new Error('没有可复制的文字。');
    try { await call('setClipboardData', { data: text }); } catch (error) { throw new Error('复制失败，请重试。'); }
}

module.exports = { call, confirm, privacy, restorePermission, saveAlbum, copy };
