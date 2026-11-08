"""Adapter around the original Handright 5.5.0 used by handwirte.py.
The vendored library is unmodified. Layout, Gaussian draws, DFS components,
per-page RNG and per-pixel rigid transforms are the original pipeline.
Optional finishing operates on the original ink mask, never character layout.
"""
from dataclasses import dataclass, asdict
from pathlib import Path
from functools import lru_cache
import math
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter, PngImagePlugin
from .resources import resource_font, resource_background, PRESETS

ASSETS = Path(__file__).resolve().parent / 'assets'
FONT = ASSETS/'LXGWWenKai-Regular.ttf'
sys.path.insert(0,str(Path(__file__).resolve().parent/'vendor'))
from handright import Template, handwrite
from handright import _core
from handright._exceptions import Error as HandrightError

END_CHARS = '，。'  # Match original GUI; caller can opt in to extended punctuation.
PAPERS = {'plain','ruled','grid'}


class RenderError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class LegacyFont(ImageFont.FreeTypeFont):
    """Restore Pillow <=9 getsize used by the unchanged original library."""
    def getsize(self, text, *args, **kwargs):
        size, offset = self.font.getsize(text, 'L')
        return size[0], size[1]+offset[1]
    def font_variant(self, **kwargs):
        return LegacyFont(self.path, kwargs.get('size',self.size), index=self.index)


@dataclass(frozen=True)
class RenderParams:
    # Legacy synthetic paper requests remain loadable; new UI explicitly selects originals.
    paper: str = 'ruled'
    width: int = 1240
    height: int = 1754
    font_size: int = 46
    line_spacing: int = 82
    margin: int = 98
    word_spacing: float = 3
    jitter: float = 1.4
    rotation: float = .05
    aa: bool = False
    ink_filter: bool = False
    seed: int = 42
    ink: str = 'black'
    max_pages: int = 20
    font_id: str = 'wenkai'
    background_id: str | None = None
    left_margin: float | None = None
    right_margin: float | None = None
    top_margin: float | None = None
    bottom_margin: float | None = None
    line_spacing_sigma: float = 0
    font_size_sigma: float | None = None
    word_spacing_sigma: float | None = None
    perturb_x_sigma: float | None = None
    perturb_y_sigma: float | None = None
    perturb_theta_sigma: float | None = None
    end_chars: str = END_CHARS

    def validate(self):
        if self.paper not in PAPERS or self.ink not in {'black','blue'}:
            raise RenderError('INVALID_STYLE','纸张或墨色选项无效')
        if self.background_id is not None and self.background_id not in PRESETS:
            raise RenderError('INVALID_BACKGROUND','未知的原背景选项')
        values = asdict(self)
        numbers = [v for k,v in values.items() if k not in {'seed','aa','ink_filter'} and isinstance(v,(float,int))]
        if not all(math.isfinite(v) for v in numbers):
            raise RenderError('INVALID_PARAMS','参数必须为有限数值')
        if not (400 <= self.width <= 7000 and 600 <= self.height <= 9333 and self.width*self.height <= 65_400_000):
            raise RenderError('CANVAS_TOO_LARGE','输出需在原最大背景 7000×9333 范围内')
        if not (18 <= self.font_size <= 400 and self.font_size <= self.line_spacing <= 600):
            raise RenderError('INVALID_PARAMS','字号不能大于行距')
        margins = [self.margin if v is None else v for v in (self.left_margin,self.right_margin,self.top_margin,self.bottom_margin)]
        if any(v < 0 for v in margins) or margins[0]+margins[1]+self.font_size > self.width or margins[2]+margins[3]+self.line_spacing > self.height:
            raise RenderError('INVALID_PARAMS','四边距、字号与纸张可用区域冲突')
        if not (-self.font_size/2 < self.word_spacing <= 100):
            raise RenderError('INVALID_PARAMS','字距超出原排版安全范围')
        sigmas = [self.line_spacing_sigma,self.font_size_sigma,self.word_spacing_sigma,self.perturb_x_sigma,self.perturb_y_sigma]
        if any(v is not None and not 0 <= v <= 50 for v in sigmas):
            raise RenderError('INVALID_PARAMS','扰动标准差需为 0 至 50')
        if not 0 <= self.jitter <= 50 or not 0 <= self.rotation <= .25 or (self.perturb_theta_sigma is not None and not 0 <= self.perturb_theta_sigma <= .25):
            raise RenderError('INVALID_PARAMS','笔画扰动超出安全范围')
        if not (1 <= self.max_pages <= 20) or not isinstance(self.seed,int) or isinstance(self.seed,bool) or not 0 <= self.seed <= 2**31-1:
            raise RenderError('INVALID_SEED','页数或整数种子无效')
        if not isinstance(self.end_chars,str) or len(self.end_chars)>100:
            raise RenderError('INVALID_PARAMS','标点悬挂参数无效')


def normalize_text(text):
    # Original _preprocess_text only normalizes CR/LF. Preserve spaces, full-width
    # indentation, exact paragraphs and characters; never reconstruct from OCR lines.
    return text.replace('\r\n','\n').replace('\r','\n')


def font_path(font_id='wenkai'):
    try:
        path = FONT if font_id == 'wenkai' else resource_font(font_id)
    except ValueError:
        raise RenderError('INVALID_FONT','未知字体选项')
    if not path.is_file():
        raise RenderError('FONT_MISSING','所选字体文件不存在，请检查原资源目录设置')
    return path


@lru_cache(maxsize=12)
def _glyphs(path, modified_ns):
    from fontTools.ttLib import TTFont
    with TTFont(path,lazy=True) as tf:
        return frozenset(tf.getBestCmap())


def _paper(p):
    if p.background_id:
        path = resource_background(p.background_id)
        if not path.is_file():
            raise RenderError('BACKGROUND_MISSING','所选背景文件不存在，请检查原资源目录设置')
        with Image.open(path) as image:
            if image.size != (p.width,p.height):
                raise RenderError('BACKGROUND_SIZE_MISMATCH','原背景尺寸与排版参数不一致，请重新选择背景恢复预设')
            return image.convert('RGB')
    image = Image.new('RGB',(p.width,p.height),'#fffefa')
    d=ImageDraw.Draw(image)
    if p.paper == 'ruled':
        for y in range(p.margin+p.line_spacing,p.height-p.margin+1,p.line_spacing):
            d.line((p.margin-15,y,p.width-p.margin+15,y),fill='#dbe0e4')
    elif p.paper == 'grid':
        for x in range(p.margin,p.width-p.margin+1,p.line_spacing):
            d.line((x,p.margin,x,p.height-p.margin),fill='#e6e8e9')
        for y in range(p.margin,p.height-p.margin+1,p.line_spacing):
            d.line((p.margin,y,p.width-p.margin,y),fill='#e6e8e9')
    return image


def original_template(params, background=None, fill=None):
    background = _paper(params) if background is None else background
    # Original GUI chose pure black fill=0. Use RGB black for exactly the same pixels.
    if fill is None:
        fill = (0,0,0) if params.ink=='black' else (22,40,80)
    return Template(background=background,font_size=params.font_size,
        font=LegacyFont(str(font_path(params.font_id)),params.font_size),
        line_spacing=params.line_spacing,fill=fill,
        left_margin=params.margin if params.left_margin is None else params.left_margin,
        right_margin=params.margin if params.right_margin is None else params.right_margin,
        top_margin=params.margin if params.top_margin is None else params.top_margin,
        bottom_margin=params.margin if params.bottom_margin is None else params.bottom_margin,
        word_spacing=params.word_spacing,line_spacing_sigma=params.line_spacing_sigma,
        font_size_sigma=params.font_size*.02 if params.font_size_sigma is None else params.font_size_sigma,
        word_spacing_sigma=params.font_size*.02 if params.word_spacing_sigma is None else params.word_spacing_sigma,
        perturb_x_sigma=params.jitter if params.perturb_x_sigma is None else params.perturb_x_sigma,
        perturb_y_sigma=params.jitter if params.perturb_y_sigma is None else params.perturb_y_sigma,
        perturb_theta_sigma=params.rotation if params.perturb_theta_sigma is None else params.perturb_theta_sigma,
        end_chars=params.end_chars)


def iter_render_pages(text: str, params: RenderParams = RenderParams(), *, preview_chars=None):
    params.validate()
    if not isinstance(text,str) or not text.strip():
        raise RenderError('EMPTY_TEXT','请输入或先识别文字')
    if len(text)>10000:
        raise RenderError('TEXT_TOO_LONG','每次最多生成 10000 字')
    text=normalize_text(text)
    if preview_chars is not None:
        if not isinstance(preview_chars,int) or not 1 <= preview_chars <= 10000:
            raise RenderError('INVALID_PREVIEW','预览字数需为 1 至 10000')
        text=text[:preview_chars]
    font=font_path(params.font_id)
    available=_glyphs(str(font),font.stat().st_mtime_ns)
    missing=sorted({c for c in text if not c.isspace() and ord(c) not in available})
    if missing:
        raise RenderError('UNSUPPORTED_GLYPH','所选字体缺少这些字符，请换字体或校对：'+' '.join(missing[:12]))
    template=original_template(params)
    def bounded_mapper(render, drafts):
        # Guard before rendering page 21; unchanged original renderer and RNG.
        for index, draft in enumerate(drafts):
            if index >= params.max_pages:
                raise RenderError('TOO_MANY_PAGES','超过配置的最多页数，请拆分正文')
            yield render(draft)
    try:
        if not params.aa and not params.ink_filter:
            # Direct original call: no replacements to layout or drawing functions.
            stream=handwrite(text,template,seed=params.seed,mapper=bounded_mapper)
        else:
            # Render the SAME original pixel transforms into an L ink mask, then finish.
            mask_template=original_template(params,Image.new('L',template.get_size(),0),255)
            stream=handwrite(text,mask_template,seed=params.seed,mapper=bounded_mapper)
        for page in stream:
            if params.aa or params.ink_filter:
                alpha=page
                if params.aa:
                    alpha=alpha.filter(ImageFilter.GaussianBlur(.28))
                if params.ink_filter:
                    # Uniform mild alpha adjustment. No extra RNG can change strokes.
                    alpha=alpha.point(lambda v: round(v*.96))
                    alpha=alpha.filter(ImageFilter.GaussianBlur(.12))
                page=template.get_background().copy()
                page.paste(template.get_fill(),(0,0,page.width,page.height),alpha)
            yield page
    except HandrightError as error:
        raise RenderError('LAYOUT_ERROR','原手写排版失败：'+str(error))


def render_pages(text: str, params: RenderParams = RenderParams(), *, preview_chars=None):
    """Compatibility list API; service and CLI stream to avoid retaining big pages."""
    pages=[]
    for page in iter_render_pages(text,params,preview_chars=preview_chars):
        if (len(pages)+1)*params.width*params.height > 200_000_000:
            raise RenderError('MEMORY_LIMIT','多页大图请使用逐页生成接口，避免一次驻留过多图片')
        pages.append(page)
    return pages


def save_png(image,destination,params):
    metadata=PngImagePlugin.PngInfo()
    metadata.add_text('Software','PaperInk / original Handright 5.5.0')
    metadata.add_text('Description','AI-generated handwriting-style typography; not an authentic handwritten document')
    metadata.add_text('Seed',str(params.seed))
    metadata.add_text('Font',params.font_id)
    metadata.add_text('Background',params.background_id or params.paper)
    with Path(destination).open('xb') as stream:
        image.save(stream,format='PNG',pnginfo=metadata)
