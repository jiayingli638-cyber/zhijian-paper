"""Local resource registry. Originals are referenced read-only, never redistributed."""
from pathlib import Path
import os
from functools import lru_cache
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIST = Path('C:/Users/Grin/Downloads/64741_697_distrj_XiaZaiBa/dist10')
FONT_FILES = {
    'liguofu': ('李国夫手写体', '李国夫手写体.ttf'),
    'yiqi': ('义启手写体', '义启手写体.ttf'),
    'qingye': ('青叶手写体', '青叶手写体.ttf'),
    'yunyan': ('云烟体', '云烟体.ttf'),
}
# Values transcribed from supplied handwirte.py change_box2; tuple typos corrected.
PRESETS = {
    'bg1': dict(width=3024,height=3342,font_size=100,line_spacing=143,left_margin=180,right_margin=100,top_margin=140,bottom_margin=70,word_spacing=5,line_spacing_sigma=0,font_size_sigma=2,word_spacing_sigma=2,perturb_x_sigma=3,perturb_y_sigma=3,perturb_theta_sigma=.05),
    'bg2': dict(width=7000,height=9333,font_size=200,line_spacing=300,left_margin=670,right_margin=590,top_margin=540,bottom_margin=210,word_spacing=4,line_spacing_sigma=2,font_size_sigma=10,word_spacing_sigma=2,perturb_x_sigma=5,perturb_y_sigma=5,perturb_theta_sigma=.10),
    'bg3': dict(width=4000,height=5657,font_size=130,line_spacing=270,left_margin=420,right_margin=330,top_margin=190,bottom_margin=520,word_spacing=7,line_spacing_sigma=0,font_size_sigma=2,word_spacing_sigma=2,perturb_x_sigma=3,perturb_y_sigma=3,perturb_theta_sigma=.05),
}


def dist_dir():
    return Path(os.environ.get('PAPERINK_RESOURCE_DIR', str(DEFAULT_DIST))).expanduser().resolve()


def resource_font(font_id):
    if font_id == 'wenkai':
        return ROOT/'backend/assets/LXGWWenKai-Regular.ttf'
    if font_id not in FONT_FILES:
        raise ValueError('未知字体标识')
    return dist_dir()/'Fonts'/FONT_FILES[font_id][1]


def resource_background(background_id):
    if background_id not in PRESETS:
        raise ValueError('未知背景标识')
    return dist_dir()/'background'/('background_0'+background_id[-1]+'.jpg')


def catalog():
    fonts = [{'id':id,'name':name,'available':resource_font(id).is_file(),'local_only':True} for id,(name,_) in FONT_FILES.items()]
    fonts.append({'id':'wenkai','name':'霞鹜文楷（附加）','available':resource_font('wenkai').is_file(),'local_only':False})
    backgrounds=[]
    for id,preset in PRESETS.items():
        path=resource_background(id)
        backgrounds.append({'id':id,'name':'原背景'+id[-1],'available':path.is_file(),'width':preset['width'],'height':preset['height'],'preset':preset,'thumbnail':'/api/resources/backgrounds/'+id+'/thumbnail.png'})
    return {'fonts':fonts,'backgrounds':backgrounds,'default_font':'liguofu','default_background':'bg1','renderer':'Handright 5.5.0 original pipeline','note':'原四种字体与三套背景只引用您本机已有文件，不复制入小程序或重新分发；公开发布前请核对资源授权。'}
