// Native page controllers + real local OCR/render/download endpoints.
// wx UI/FS callbacks remain a stub; this is NOT WeChat native or device execution.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { environment, loadPage } = require('./wx-stub');
const store = require('../utils/store');

test('原生页面控制器串联真实图片 OCR、校对、渲染与 PNG 下载', async () => {
  const env = environment();
  env.state.uploadHook = async options => {
    try { const bytes = fs.readFileSync(path.resolve(__dirname, '../../outputs/ocr-input.png')); const form = new FormData(); form.append('file', new Blob([bytes], {type:'image/png'}), 'source.png'); const response = await fetch(options.url, {method:'POST',body:form}); options.success({statusCode:response.status,data:await response.text()}); } catch(error) { options.fail({errMsg:error.message}); }
  };
  env.state.requestHook = async options => {
    try { const response = await fetch(options.url, {method:options.method,headers:options.header,body:options.method==='POST'?JSON.stringify(options.data):undefined}); options.success({statusCode:response.status,data:await response.json()}); } catch(error) { options.fail({errMsg:error.message}); }
  };
  env.state.downloadHook = async options => {
    try { const response = await fetch(options.url); const tempFilePath='/tmp/real-'+env.state.downloadCount; env.state.files.set(tempFilePath,Buffer.from(await response.arrayBuffer())); options.success({statusCode:response.status,tempFilePath}); } catch(error) { options.fail({errMsg:error.message}); }
  };
  const home = loadPage('index'); home.onShow();
  await home.chooseAlbum();
  assert.match(home.data.text,/把生活写成诗/);
  assert.match(home.data.ocrNote,/RapidOCR/);
  home.inputText({detail:{value:home.data.text+'\n经人工校对。'}});
  await home.loadResources();
  assert.equal(home.data.resourceError, '');
  assert.equal(home.data.fonts.filter(font => font.available).length, 5);
  home.selectFont({currentTarget:{dataset:{id:'yiqi'}}});
  home.selectBackground({currentTarget:{dataset:{id:'bg3'}}});
  home.inputSeed({detail:{value:'2026'}});
  await home.generate();
  assert.equal(home.data.resultSaved,true,home.data.error);
  const work=store.listWorks()[0];
  assert.equal(work.params.seed,2026);
  assert.match(work.text,/经人工校对/);
  assert.ok(!work.sourceText.includes('经人工校对'));
  const png=env.state.files.get(work.pages[0]);
  assert.equal(png.readUInt32BE(16),4000);
  assert.equal(png.readUInt32BE(20),5657);
  assert.equal(work.params.font_id, 'yiqi'); assert.equal(work.params.background_id, 'bg3');
  assert.equal(work.params.left_margin, 420); assert.equal(work.params.perturb_x_sigma, 3);
  fs.writeFileSync(path.resolve(__dirname,'../../outputs/native-controller-handwriting.png'),png);
  const works=loadPage('works');works.onShow();
  assert.equal(works.data.total,1);
  works.editWork({currentTarget:{dataset:{id:work.id}}});
  home.onShow();assert.equal(home.data.params.seed,2026);
  console.log('真实 OCR→人工校对→义启字体/原背景3→原Handright→PNG下载→完整参数历史恢复通过；微信UI/文件系统为stub。');
});
