from PIL import Image
from backend.renderer import RenderParams, render_pages


def test_text_becomes_a_real_png_with_visible_ink():
    pages = render_pages("把文字写成温柔的模样。\nHELLO 2026", RenderParams(seed=42))
    assert len(pages) == 1
    assert isinstance(pages[0], Image.Image)
    assert pages[0].size == (1240, 1754)
    import numpy as np
    assert np.asarray(pages[0].convert("L")).min() < 80


def test_same_integer_seed_reproduces_pixels():
    a = render_pages("认真记录每一天。", RenderParams(seed=2026))[0]
    b = render_pages("认真记录每一天。", RenderParams(seed=2026))[0]
    assert a.tobytes() == b.tobytes()


def test_all_three_papers_work_and_long_text_paginates():
    for paper in ("plain", "ruled", "grid"):
        assert len(render_pages("这是一页手写文字。", RenderParams(paper=paper))) == 1
    pages = render_pages("文字排版测试。"*160, RenderParams())
    assert len(pages) > 1


def test_aa_and_filter_are_real_switches():
    import numpy as np
    clean = render_pages("把生活写成诗。", RenderParams(paper="plain", aa=False, ink_filter=False))[0]
    smooth = render_pages("把生活写成诗。", RenderParams(paper="plain", aa=True, ink_filter=False))[0]
    filtered = render_pages("把生活写成诗。", RenderParams(paper="plain", aa=True, ink_filter=True))[0]
    assert clean.tobytes() != smooth.tobytes()
    assert smooth.tobytes() != filtered.tobytes()
    assert len(np.unique(np.asarray(smooth)[:500, :, 0])) > len(np.unique(np.asarray(clean)[:500, :, 0]))


def test_preview_limit_does_not_limit_full_export():
    text = "文字排版测试。" * 160
    assert len(render_pages(text, RenderParams(), preview_chars=30)) == 1
    assert len(render_pages(text, RenderParams())) > 1


def test_streamed_original_pages_match_list_api_and_limit_before_extra_render():
    import pytest
    from backend.renderer import iter_render_pages, RenderError
    text = '分页文字。' * 100
    params = RenderParams(width=500, height=600, margin=40, max_pages=20)
    expected=render_pages(text,params)
    actual=list(iter_render_pages(text,params))
    assert len(expected)>1 and [page.tobytes() for page in actual]==[page.tobytes() for page in expected]
    limited=iter_render_pages(text,RenderParams(width=500,height=600,margin=40,max_pages=1))
    assert next(limited).size==(500,600)
    with pytest.raises(RenderError,match='页'): next(limited)


def test_invalid_parameters_and_empty_input_have_clear_errors():
    import pytest
    from backend.renderer import RenderError
    with pytest.raises(RenderError, match="请输入"):
        render_pages(" ")
    with pytest.raises(RenderError):
        render_pages("正文", RenderParams(width=7001, height=9333))
    with pytest.raises(RenderError):
        render_pages("正文", RenderParams(font_size=100, line_spacing=50))
