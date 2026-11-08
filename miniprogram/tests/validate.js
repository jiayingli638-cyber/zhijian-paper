// 确定性源码校验，不替代微信原生编译和真机验证。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? files(path.join(dir, item.name)) : [path.join(dir, item.name)]); }
const all = files(root);
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function local(from, reference) {
    const destination = reference.startsWith('/') ? path.join(root, reference.slice(1)) : path.resolve(path.dirname(from), reference);
    assert.ok(destination.startsWith(root + path.sep), '引用越出工作区：' + reference);
    assert.ok(fs.existsSync(destination), '引用不存在：' + destination);
    const relative = path.relative(root, destination);
    let current = root;
    relative.split(path.sep).forEach(part => { assert.ok(fs.readdirSync(current).includes(part), '引用大小写不一致：' + reference); current = path.join(current, part); });
    return destination;
}
let jsonCount = 0;
all.filter(file => file.endsWith('.json')).forEach(file => { json(file); jsonCount += 1; });
const app = json(path.join(root, 'app.json'));
const project = json(path.join(root, 'project.config.json'));
assert.equal(path.resolve(root, project.miniprogramRoot), root);
assert.equal(project.compileType, 'miniprogram');
assert.equal(app.lazyCodeLoading, 'requiredComponents');
assert.ok(app.pages.length > 0);
assert.equal(app.window.navigationStyle || 'default', 'default');
assert.deepEqual(app.tabBar.list.map(tab => tab.text), ['首页', '作品', '设置']);
assert.equal(app.tabBar.selectedColor, '#3478f6');
assert.ok(project.packOptions.ignore.some(item => item.type === 'folder' && item.value === 'tests'));
app.pages.forEach(page => ['.js', '.json', '.wxml', '.wxss'].forEach(ext => local(path.join(root, 'app.json'), page + ext)));
app.tabBar.list.forEach(tab => {
    assert.ok(app.pages.includes(tab.pagePath));
    ['iconPath', 'selectedIconPath'].forEach(key => {
        const file = local(path.join(root, 'app.json'), tab[key]);
        const png = fs.readFileSync(file);
        assert.ok(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
        assert.ok(png.length <= 40 * 1024); assert.ok(png.readUInt32BE(16) <= 81); assert.ok(png.readUInt32BE(20) <= 81);
    });
});
const source = all.filter(file => !file.includes(path.sep + 'tests' + path.sep) && !file.includes(path.sep + '.workbuddy' + path.sep));
source.filter(file => file.endsWith('.json')).forEach(file => {
    const config = json(file);
    Object.values(config.usingComponents || {}).forEach(reference => {
        ['.js', '.json', '.wxml'].forEach(ext => local(file, reference + ext));
    });
});
all.filter(file => file.endsWith('.js')).forEach(file => {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
});
source.filter(file => file.endsWith('.js')).forEach(file => {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/\b(document|window|localStorage)\s*\.|\bfetch\s*\(/.test(text), '禁止浏览器 API：' + file);
    for (const match of text.matchAll(/require\(['"]([^'"]+)['"]\)/g)) local(file, /\.(js|json)$/.test(match[1]) ? match[1] : match[1] + '.js');
});
let bindingCount = 0;
source.filter(file => file.endsWith('.wxml')).forEach(file => {
    const text = fs.readFileSync(file, 'utf8');
    const js = fs.readFileSync(file.replace(/\.wxml$/, '.js'), 'utf8');
    assert.ok(!/<\/?(?:html|body|head|div|span|img|script|a)(?:\s|>)/i.test(text), '禁止 HTML 标签：' + file);
    for (const match of text.matchAll(/{{([\s\S]*?)}}/g)) assert.ok(!/\?\.|\?\?|=>|\w+\s*\(/.test(match[1]), 'WXML 不支持的表达式：' + match[0]);
    for (const match of text.matchAll(/(?:bind|catch)(?::)?(?:tap|input|blur|change|confirm|submit|error)=["']([a-zA-Z]\w*)["']/g)) {
        assert.ok(new RegExp('\\b' + match[1] + '\\s*\\(').test(js), '未接线事件：' + match[1] + ' in ' + file); bindingCount += 1;
    }
    for (const match of text.matchAll(/\b(?:src|import|include)=["']([^"']+)["']/g)) {
        if (!match[1].includes('{{') && !/^https?:/.test(match[1])) local(file, match[1]);
    }
    const stack = [];
    for (const match of text.matchAll(/<\s*(\/?)\s*([\w:-]+)([^>]*?)>/g)) {
        if (match[1]) assert.equal(stack.pop(), match[2], 'WXML 标签不匹配：' + file);
        else if (!/\/\s*$/.test(match[3])) stack.push(match[2]);
    }
    assert.equal(stack.length, 0, 'WXML 标签未闭合：' + file);
});
source.filter(file => file.endsWith('.wxss')).forEach(file => {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/background(?:-image)?\s*:[^;]*url\(/.test(text), '禁止 WXSS 本地背景图引用');
    for (const match of text.matchAll(/@import\s+['"]([^'"]+)['"]/g)) local(file, match[1]);
    assert.equal((text.match(/{/g) || []).length, (text.match(/}/g) || []).length, 'WXSS 花括号不匹配');
});
console.log('源码校验通过：' + jsonCount + ' 个严格 JSON、全部 JS 语法、3 页原生结构、6 张 PNG、' + bindingCount + ' 个事件接线及本地引用。');
console.log('此校验不等同于微信原生编译 / WorkBuddy 预览 / 真机验证。');
