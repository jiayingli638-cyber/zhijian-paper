"""Differential test against unmodified Handright 5.5.0, same resources and seed.
The font adapter only implements removed Pillow getsize via the same FreeType metrics.
"""
from pathlib import Path
import sys
import numpy as np
from PIL import Image, ImageFont
from backend import renderer
from backend.resources import dist_dir
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'backend/vendor'))
from handright import Template, handwrite
DIST = dist_dir()

class LegacyFont(ImageFont.FreeTypeFont):
    def getsize(self, text, *args, **kwargs):
        size, offset = self.font.getsize(text, 'L')
        return size[0], size[1] + offset[1]
    def font_variant(self, **kwargs):
        return LegacyFont(self.path, kwargs.get('size',self.size),index=self.index)


def test_old_pipeline_matches_original_same_font_background_seed(monkeypatch):
    font = DIST/'Fonts/李国夫手写体.ttf'
    bg = Image.open(DIST/'background/background_01.jpg').convert('RGB').resize((756,835))
    p = renderer.RenderParams(width=756,height=835,font_size=25,line_spacing=36,margin=45,word_spacing=1.25,jitter=.75,rotation=.05,aa=False,ink_filter=False,seed=2026)
    text = '一、需求的基础与过程\n　　需求是人们需要和希望的表达，软件应保留自然字形和原来的纸张。\n　　认真记录每一天，字距、行距与笔画有轻微变化。'
    monkeypatch.setattr(renderer,'FONT',font)
    monkeypatch.setattr(renderer,'_paper',lambda params:bg.copy())
    original = list(handwrite(text,Template(background=bg,font=LegacyFont(str(font),25),font_size=25,line_spacing=36,left_margin=45,right_margin=45,top_margin=45,bottom_margin=45,word_spacing=1.25,line_spacing_sigma=0,font_size_sigma=.5,word_spacing_sigma=.5,perturb_x_sigma=.75,perturb_y_sigma=.75,perturb_theta_sigma=.05,end_chars='，。'),seed=2026))[0]
    actual = renderer.render_pages(text,p)[0]
    changed = np.any(np.asarray(original)!=np.asarray(actual),axis=2)
    ratio = float(changed.mean())
    original.save(ROOT/'outputs/handwriting-restore/red-original.png')
    actual.save(ROOT/'outputs/handwriting-restore/red-before.png')
    assert ratio == 0, f'原字体/原背景/同文字/同seed仍有{ratio:.2%}像素不同，不能称为原程序效果'
