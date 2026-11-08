# OCR 选型与未实现功能补全评估

> **实施后补充：**下文保留研究阶段的证据口径；其中“尚未执行/待验收”指该研究阶段。后续已完成真实 RapidOCR、独立渲染器、工作流 API 与原生页面控制器集成：Python 12 项和原生页面 24 项测试通过；两张受控印刷/文楷样本均完整识别。当前实现与真实验收边界请以同目录《工作流交付与自测报告.md》为准。字体原版与 OFL 已取得且哈希验证，未采用旧 Handright 依赖，也未修改原下载源码或运行原 EXE。

> 研究日期：2026-11-03。目标：图片 → 可校对文字 → 手写风格排版，明确要求本地数据保存。环境：Windows、Python 3.13；本报告的二进制兼容结论限定普通 CPython 3.13、Windows x64，不覆盖 32 位、Windows ARM64 或自由线程构建。
>
> 本轮仅研究并更新此报告：读取两份用户报告、恢复的 `handwirte.py` 与相关核心库文本；使用 WebSearch 发现来源、WebFetch 核对官方文档/源码、公开 GitHub REST 与 PyPI 元数据核对发行物。用户已发起的安装现已在本机落盘；本轮只读检查安装状态，并执行导入/签名/空输出对象核验，未运行图片识别或 benchmark，未启动原 GUI/exe，未下载字体/模型，未写或修改任何业务代码。下文图片调用示例均未执行。

## 0. 接口与官方字体下载——优先回报

### RapidOCR 最简接口

```python
from rapidocr import RapidOCR

engine = RapidOCR()
result = engine("C:/images/sample.jpg")
text = "\n".join(result.txts or ())
```

官方接口依据：https://rapidai.github.io/RapidOCRDocs/main/quickstart/ ；固定版本数据类：https://github.com/RapidAI/RapidOCR/blob/v3.10.0/python/rapidocr/utils/output.py 。当前完整流程主要返回 `txts`、`scores`、`boxes`；阶段耗时字段准确名称为 **`elapse_list`，不是 `elapses`**。`elapse` 是 `field(init=False)` 数据类字段，由 `__post_init__` 汇总阶段耗时，**不是 property，也不是本轮计时结果**。[R6][R8]

本机 2026-11-03 核验：普通 CPython **3.13.15 / AMD64**；`rapidocr 3.10.0`、`onnxruntime 1.31.1` 已被 `pip show` 查到且导入成功；ORT 可用 provider 列表包含 `CPUExecutionProvider`。这证明安装和导入门槛已过，**不证明模型加载、识别质量、速度或全离线运行已通过**。

### 霞鹜文楷 Regular（SIL OFL 1.1）

- 官方 TTF 下载：https://github.com/lxgw/LxgwWenKai/releases/download/v1.530/LXGWWenKai-Regular.ttf
- 固定版本授权：https://raw.githubusercontent.com/lxgw/LxgwWenKai/v1.530/OFL.txt
- 官方发布页：https://github.com/lxgw/LxgwWenKai/releases/tag/v1.530

版本 **v1.530**，官方发布于 **2026-10-17**；Regular 文件大小 **25,928,940 B**。直链来自公开发布 API 的 `browser_download_url`，不是拼接猜测。允许商用、软件嵌入和随软件分发，需保留版权/OFL；禁止单独出售字体，修改/子集化涉及保留名条款。未实际下载字体二进制。[F2][F3][F4]

## 1. 结论与选择条件

1. **Windows 本地 Python CPU OCR 首选 RapidOCR + ONNX Runtime。** 官方当前安装入口就是 `pip install rapidocr onnxruntime`。截至研究日，PyPI 为 `rapidocr 3.10.0`（2026-10-08）和 `onnxruntime 1.31.1`（2026-10-26）；后者确有 `cp313-cp313-win_amd64` wheel。官方发行元数据与本机安装/导入核验一致；本轮没有图片推理成功记录，不能据此承诺性能。[R1][R2][R3]
2. **中文印刷体：先用 RapidOCR 默认模型作为基线。中文手写输入：优先评估 PP-OCRv5 中文识别模型，必要时比较 PaddleOCR 原生推理。** RapidOCR 是推理部署方案，识别能力主要取决于选定模型，不能把“RapidOCR 对 PaddleOCR”当成完全独立算法比较。PP-OCRv5 官方明确说明升级中英复杂手写体识别，并列出印刷中文/手写中文评估场景；当前PaddleOCR3.7.0常规OCR已发布PP-OCRv6，不把v5叫作最新版本。对潦草连笔、个人笔迹没有准确率保证。[R4][P1][P2][P7][P8]
3. **最新 RapidOCR 默认已是 PP-OCRv6 small 检测/识别，加 PP-OCRv4 mobile 方向分类。** 不能沿用旧文档“默认 PP-OCRv4”的结论，也不能把 PP-OCRv5 的手写声明自动归给 PP-OCRv6。[R4][R5][P2]
4. **“本地保存”与“本地处理”必须拆开。** 微信小程序能保存本地文件/历史，但不能通过 `pip` 运行 Windows Python wheel。若要求照片、文字始终不离设备，则这四套 Python 安装方案不是现成的手机小程序端侧 OCR 方案；应另立端侧推理验证，或接受桌面本地工作流。[W1][W2][W3]
5. **字体默认选择官方 LXGW WenKai（霞鹜文楷）Regular，SIL OFL 1.1。** 提供固定版本官方 TTF 直链和对应授权文件。附件提到的义启手写体、云烟体、李国夫手写体、青叶手写体默认全部不随产品分发；本轮未取得这些具体文件的有效授权证明。[F1][F2][F3]
6. **补全分级：8 项低难度修复；灰度连通块＋alpha 抗锯齿中等；墨迹滤镜中等；真笔压、字形变体、连笔高难度，不承诺。** 难度针对报告描述的原桌面方案，不等于移植到微信端的整体难度；不沿用附件中的工期和性能承诺。

推荐链路：本地图片 → OCR → 用户校对文字/阅读顺序 → 合法字体的装饰性手写风格排版 → 本地保存原文、校对文、配置、结果图。定位为风格化排版，不用于签名、证明材料或冒充真实手写。

## 2. 证据范围和口径

### 2.1 附件材料

- `C:/Users/Grin/Downloads/技术拆解报告.md`：第 3、4、9、10 节，提供原 GUI、二值连通块渲染、缺陷和字体情况。
- `C:/Users/Grin/Downloads/未实现功能补全评估.md`：第 2～6 节，提供八项修复、AA/滤镜路线和作者声称的测试结果。

本轮还读取 `C:/Users/Grin/Downloads/handwirte.py`，以及 `C:/Users/Grin/Downloads/64741_697_distrj_XiaZaiBa/dist10/_extract/pyc/handright._core.py`、`handright._template.py`。这些文件带 decompyle3 恢复头，**是反编译文本，不是已核对原始字节码的源码真值**；例如恢复的 `_core.py:17` 含 Python 3 不可直接执行的 `4294967295L`，`_core.py:250`～252 的边界条件也疑似恢复异常。未运行它们，未重新核对字节码，也未读取或执行 `handright_pro.py`、测试脚本和结果图。因此，“已补完”“像素一致”“耗时/内存”等仍只是附件作者陈述，不是本轮验证。两份报告的编号体系不同：本报告八项按《未实现功能补全评估》第 2 节编号；本地源码证据见第 9.1 节。

### 2.2 事实分层

- **官方事实**：包版本、wheel 标签/大小、API、许可证、模型支持声明；逐项附官方 URL。
- **工程判断**：推荐顺序、难度、本地架构选择、验收要求；明确为评估，不冒充官方保证。
- **本机直接核验**：Python 3.13.15 AMD64；两个 OCR 包已安装且可导入；函数签名、输出字段、空对象行为及 ORT provider 查询成功。没有调用图片识别。
- **未验证项**：模型实际加载/离线首次推理、CPU 速度、OCR 准确率、内存峰值、手机端推理、字体跨设备视觉效果、Handright 与本机 Pillow 的整链兼容。

不采用第三方博客的“准确率/速度排行榜”，不把不同项目官方在不同模型、数据、CPU、线程、输入尺寸下的 benchmark 拼成实测对比。后文 MB 统一为十进制 `1 MB = 1,000,000 B`；wheel/压缩包大小不是安装后磁盘体积、RAM 或 exe 大小。

## 3. 四种 OCR 的适用性与 CPU 接入比较

| 方案 | 中文印刷文字 | 中文手写输入 | Windows CPU 接入 | Python 3.13 证据 | 许可证与建议 |
|---|---|---|---|---|---|
| **RapidOCR / ONNX Runtime** | 官方默认支持中文；适合作为图片文字识别基线，不自动保证段落/表格还原 | 可路由 PP-OCRv5 中文 mobile/server 模型；上游有 handwriting 声明。默认 v6 small 的中文手写专项能力本轮没有独立证据 | 两包安装、单次调用；需 ORT 运行库及图像处理依赖；无需 Paddle/PyTorch/CUDA | rapidocr `py3-none-any`、Python 范围含 3.13且分类器列出 3.13；ORT 有 Windows cp313 wheel；关键原生依赖也有 wheel | RapidOCR Apache-2.0；ORT MIT；模型归属另保留。**首选本地 CPU 部署**。[R1–R8] |
| **PaddleOCR / PaddlePaddle** | 官方通用 OCR 检测＋识别，模型和预处理选项较丰富 | PP-OCRv5_rec 同时声明中文和手写场景支持；是需重点评估的候选，不保证任意个人手写 | 需另装 CPU PaddlePaddle，理解 PaddleOCR/PaddleX、模型档位与预处理配置；比 RapidOCR 接入面大 | PaddlePaddle 3.3.1 有 Windows cp313 wheel；官方列 Python 3.13。但官方 Windows支持说明列专业版/企业版，当前环境为家庭中文版，不能据此声称该 SKU 已获官方验证 | PaddleOCR、PaddlePaddle Apache-2.0。**模型定制/原生对照候选**。[P1–P6] |
| **EasyOCR / PyTorch** | 官方支持 `ch_sim`、`ch_tra`，可识别中文和英文混合场景 | 官方 README 仍将 handwritten support 放在“What's coming next”和路线图，不能承诺开箱即用中文手写 | API 很简洁，但 Windows 官方要求先选配 torch/torchvision CPU 版；还依赖 scipy、scikit-image 等 | EasyOCR 1.7.2是纯 Python wheel，未明确列本机3.13验证；当前 torch有cp313、torchvision有平台纯Python wheel；旧版匹配对也有cp313证据，仍需集成验收 | EasyOCR Apache-2.0；torch/torchvision和模型上游另核授权。**已有PyTorch环境可选，不为中文手写优先引入**。[E1–E5] |
| **Tesseract / pytesseract** | 官方设计面向印刷文本，有 `chi_sim`/`chi_tra`；适合规则扫描页，可作传统CPU基线 | 官方 FAQ 明确：可以试，但不会很好，主要面向印刷文本，建议找专门手写项目 | 不是一个pip包解决：需exe/Leptonica等运行依赖＋语言traineddata＋Python wrapper；需设置PATH或可执行文件位置 | pytesseract 0.3.13纯Python、Python>=3.8；Tesseract是独立进程，不依赖CPython C扩展ABI。但不能把范围声明当成本机3.13成功测试 | 引擎、tessdata_fast、pytesseract Apache-2.0；Windows安装器是官方文档推荐的第三方构建。**不作为中文手写主方案**。[T1–T5] |

**重要区别：**OCR读手写，与文字输出成手写字体是两个模块。选择手写字体不会改善 OCR；选择能读手写的 OCR 也不会生成新笔迹。

**分发授权边界：**四种OCR主项目的Apache-2.0及ORT的MIT是宽松许可，不要求将独立业务代码一律开源；仍需随分发保留许可证、版权及适用NOTICE，Apache修改文件需注明修改。依赖和具体模型权重不能仅因主项目开源就省略授权检查。RapidOCR官方说明模型源于PaddleOCR并由上游权利人持有版权；本轮未核到逐个默认模型的完整授权/哈希清单，README提到的`MODEL_LICENSES.md`链接读取返回404。因此公开发布前仍需保存所选模型的具体来源、授权和校验值，用户自训练/第三方模型另审；不把仓库代码LICENSE自动当作任意模型许可。[R13][P4][E5][T4]

## 4. 安装体积：可核实的发行物与不可核实的总量

### 4.1 官方元数据中的下载大小

| 方案 | 主要发行物 | 官方大小 | 尚未计入 |
|---|---|---:|---|
| RapidOCR | `rapidocr-3.10.0-py3-none-any.whl` | 27,288,134 B，27.29 MB | 其余依赖、解释器、VC运行库、字体、可选模型 |
| ONNX Runtime CPU | `onnxruntime-1.31.1-cp313-cp313-win_amd64.whl` | 14,888,304 B，14.89 MB | 同上。与RapidOCR两项小计42.18 MB，不是完整安装体积 |
| PaddleOCR | `paddleocr-3.7.0-py3-none-any.whl` | 146,750 B，0.147 MB | 此小包不等于完整OCR；主要代码/依赖还在PaddleX等 |
| PaddlePaddle CPU | `paddlepaddle-3.3.1-cp313-cp313-win_amd64.whl` | 104,794,530 B，104.79 MB | PaddleX及其他依赖、下载模型/预处理模型、解释器 |
| EasyOCR | `easyocr-1.7.2-py3-none-any.whl` | 2,870,178 B，2.87 MB | torch、torchvision、scipy/scikit-image、OCR权重 |
| PyTorch参考 | `torch-2.15.0-cp313-cp313-win_amd64.whl` | 126,736,947 B，126.74 MB | PyTorch官方CPU索引包与PyPI包不能混淆；此处只是PyPI发行物大小 |
| torchvision参考 | `torchvision-0.29.2-py3-none-win_amd64.whl` | 1,379,121 B，1.38 MB | 平台纯Python wheel不应因没有cp313字样就被判定不支持3.13 |
| EasyOCR模型压缩包 | 默认CRAFT `craft_mlt_25k.zip`＋简中 `zh_sim_g2.zip` | 77,251,756＋20,288,076 B，合计97.54 MB | 解压大小、其他语言/检测器；不是模型RAM |
| pytesseract | `pytesseract-0.3.13-py3-none-any.whl` | 14,705 B，0.0147 MB | **不含Tesseract引擎**、语言数据、解释器 |
| Tesseract语言数据 | tessdata_fast的`chi_sim.traineddata`＋`eng.traineddata` | 2,469,156＋4,113,088 B，合计6.58 MB | 引擎安装器及Leptonica等；不同安装器的总包大小未核定 |

大小来源：对应版本PyPI JSON的`urls[].size`，以及官方GitHub release assets/contents API，均只读查询。[R1][R2][P4][P5][E2–E5][T3–T5]

### 4.2 RapidOCR并非“只占42 MB”

RapidOCR还依赖OpenCV headless、NumPy、Shapely、pyclipper、Pillow、PyYAML、OmegaConf、requests等。研究日Windows发行物中，OpenCV headless约43.83 MB、NumPy约12.57 MB、Shapely约1.79 MB、Pillow 13约7.28 MB。将这些和RapidOCR、ORT、pyclipper、PyYAML相加，**仅已列关键wheel小计约107.90 MB**；不是完整依赖闭包，也未包含Python和字体，更不是安装后占用。[R1][D1–D6]

结论是“依赖面相对简洁、无须引入完整训练框架”，而非“极小包”“一定能打成20 MB”。原拆解报告关于裁剪未用NumPy/SciPy的建议，不能直接应用到新OCR工作流——RapidOCR本身确实使用NumPy/OpenCV。

### 4.3 模型档位不能漏算，也不能重复计算

Paddle官方模型表列的**存储大小**：

- PP-OCRv5 mobile：检测4.7 MB＋中文识别16 MB；server：检测84.3 MB＋中文识别81 MB。[P1][P2]
- PP-OCRv6 small：检测9.6 MB＋识别20.4 MB；medium：59.4 MB＋73.3 MB；tiny：1.9 MB＋4.4 MB。[P1][P2]

这些是Paddle文档里的模型大小，**不是RapidOCR转换后ONNX文件的实测大小**，也不含所有方向分类、展开模型。RapidOCR官方说明默认权重预打包进wheel，不能把默认模型再加一次；选择非默认档位则可能另下载。[R4]

最终exe、完整环境和运行内存均未测量。若日后实施，需分别记录网络下载量、环境落盘量、模型缓存和峰值内存，不用一个“安装体积”混称四者。

## 5. RapidOCR在Windows Python3.13的可行性与接口

### 5.1 兼容证据链与限制

1. `rapidocr 3.10.0`：`Requires-Python: >=3.8,<4`，分类器明确列Python3.13，分发为`py3-none-any`。[R1]
2. `onnxruntime 1.31.1`：`Requires-Python: >=3.11`，确有`onnxruntime-1.31.1-cp313-cp313-win_amd64.whl`。[R2]
3. 原生依赖发行物：NumPy、Pillow、Shapely、pyclipper、PyYAML有cp313 Windows x64 wheel；OpenCV headless为`cp37-abi3-win_amd64`稳定ABI wheel。它不需要名称写成cp313才能用于普通CPython3.13。[D1–D6]
4. ORT官方要求Windows Visual C++2019运行库，推荐最新受支持运行库；这是运行库，不是要求安装完整Visual Studio。CPU版不需要CUDA/cuDNN。[R3]

**判断：本机安装和导入已通过；模型推理与整条渲染链仍待验收。** 本轮 `python --version` 为 3.13.15；`python -m pip show rapidocr onnxruntime` 返回 3.10.0/1.31.1；实际导入 `RapidOCR`、`RapidOCROutput`、`onnxruntime` 成功，provider 列表为 `AzureExecutionProvider`、`CPUExecutionProvider`。没有执行 `engine(image)`，没有新增安装/升级/降级动作，也没有检查全部依赖一致性；因此可写“已安装、可导入”，不可写“已跑通 OCR”“CPU 性能已验证”。Python3.13自由线程ABI不在本结论范围内，已核查的ORT文件是普通cp313，不是cp313t。

### 5.2 官方安装入口——仅供后续实施参考

```bash
python -m pip install rapidocr onnxruntime
```

本报告的可追溯候选版本：`rapidocr==3.10.0`、`onnxruntime==1.31.1`。固定这两个包并不等于锁定全部传递依赖；本轮不生成或验证lock文件。不要误用旧包名`rapidocr_onnxruntime`的接口示例。[R1][R2][R6]

### 5.3 最简本地图片调用

```python
from rapidocr import RapidOCR

engine = RapidOCR()
result = engine("C:/images/sample.jpg")
text = "\n".join(result.txts or ())
```

这是官方`RapidOCR()`＋`engine(image)`调用的本地路径版本，加了空文本处理；不是运行结果。对象可复用以免重复初始化。输入除了字符串路径，还支持`Path`、图像编码`bytes`、`PIL.Image.Image`、`np.ndarray`。默认优先使用本地路径；不要照抄官方远程测试图片URL到离线产品。[R6][R7]

对NumPy输入需确认通道：三通道数组按OpenCV的BGR使用；文件/PIL输入走内部转换。直接使用文件路径可降低RGB/BGR混淆风险。[R7]

### 5.4 返回数据——不是旧接口的二元组

当前常规全流程返回`RapidOCROutput`数据类，通过字段访问；**不要写 `result, elapse = engine(image)`** 来套用旧包教程。[R6][R8]

| 字段 | 正常成功结果 | 空结果/注意事项 |
|---|---|---|
| `boxes` | NumPy数组，`(N,4,2)`；每行文字的四点框 | Optional，可为`None`，访问`.shape`前先检查 |
| `txts` | `Tuple[str]`，与boxes对应 | Optional，可为`None`；拼接时使用`result.txts or ()` |
| `scores` | `Tuple[float]`，行级置信度 | Optional，可为`None`；不是保证正确的概率，也不是百分制 |
| `img` | 原图NumPy数组 | 空数据类可为`None`；一般不写入历史JSON |
| `elapse_list` | `List[Union[float, None]]`；检测/方向分类/识别阶段耗时，单位秒 | 默认空列表；准确名称不是`elapses`，不等于包含模型初始化/文件IO的端到端时间 |
| `elapse` | 数据类字段`float = field(init=False)`；`__post_init__`对`elapse_list`内float求和 | **不是property**；空对象实际值为0，并非本轮性能测试 |
| `word_results` | 开启`return_word_box=True`时的单字/词级结果 | 输出构造还存在按行嵌套、关闭时占位的情况；声明类型和实际嵌套不能机械等同，不作为首版存储契约 |
| `viser` | `Optional[VisRes]`，可视化辅助实例 | 默认`None`，不是正文/历史JSON字段 |

固定v3.10.0官方源码与已安装`rapidocr/utils/output.py:17`～35一致。直接核验`dataclasses.fields`得到全部8个字段：`img`、`boxes`、`txts`、`scores`、`word_results`、`elapse_list`、`elapse`、`viser`；`len(RapidOCROutput()) == 0`、`txts is None`、`elapse == 0`。这是空数据类核验，不是空白图片识别测试。

`rapidocr/main.py:225`～269还显示：不同阶段开关/中间输出可能返回`TextDetOutput`、`TextClsOutput`或`TextRecOutput`；默认全流程成功返回`RapidOCROutput`，无有效结果返回空对象。不要将“有检测框但没有文本”当成成功正文，也不要假定任意阶段配置总返回同一种对象。[R8][R9]

### 5.5 最容易与本地历史对接的JSON结构

官方`result.to_json()`返回**Python列表/字典，不是JSON字符串**，每项为：

```json
[
  {
    "box": [[10, 20], [180, 20], [180, 60], [10, 60]],
    "txt": "示例文字",
    "score": 0.95
  }
]
```

以上坐标/文本/分数只是结构示意，**不是OCR输出实测**。无有效框、文本或分数时`to_json()`返回`None`；本地数据层可将其规范成空列表。来源为固定v3.10.0的`output.py`和`to_json.py`。[R8][R10]

建议另存`rawText`、`editedText`、`ocrVersion`、`modelProfile`、图片尺寸、校对后阅读顺序、字体版本、排版参数、seed和输出文件引用。OCR行序不自动等于完整段落语义，复杂分栏需用户校对；`boxes`若自行入JSON，应转为普通列表。只保存必要字段，不保存庞大的`img`数组。

### 5.6 默认CPU配置和中文手写候选

v3.10.0默认：Det/Rec均为`onnxruntime + ch + small + PP-OCRv6`；Cls为`onnxruntime + ch + mobile + PP-OCRv4`。`use_cuda=false`、`use_dml=false`，是CPU路线。[R5]

若输入包含中文手写，可明确选PP-OCRv5的中文识别档位，在同一验收素材上与默认v6比较。例如以下是依据官方路由的**候选配置说明，不是已验证的最佳组合**：

```python
from rapidocr import EngineType, ModelType, OCRVersion, RapidOCR

engine = RapidOCR(params={
    "Det.engine_type": EngineType.ONNXRUNTIME,
    "Det.lang_type": "ch",
    "Det.model_type": ModelType.MOBILE,
    "Det.ocr_version": OCRVersion.PPOCRV5,
    "Rec.engine_type": EngineType.ONNXRUNTIME,
    "Rec.lang_type": "ch",
    "Rec.model_type": ModelType.MOBILE,
    "Rec.ocr_version": OCRVersion.PPOCRV5,
})
```

方向分类在此未改动，保留默认。中文v5的mobile/server路由已列入官方模型表；server不能未经测试就宣称手写更准确。非默认权重需预先下载/准备，并且ONNX转换与原Paddle推理仍应在同一数据上核对。[R4][P2]

CPU线程可通过`EngineConfig.onnxruntime.intra_op_num_threads`、`inter_op_num_threads`配置，默认值均为`-1`；源码配置是依据，不推荐使用未经核实的`ORT_CPU_NUM_THREADS`环境变量“万能优化”。线程值日后按机器与并发场景验证，不在本报告承诺最佳值。[R5]

### 5.7 离线能力：避免两个常见误判

- **不是“每次启动必联网下载默认模型”。** 官方模型文档说明PyPI wheel预打包默认权重；源码checkout的models目录仅有占位文件，不能据源码目录就否认wheel的打包策略。[R4][R11]
- **不是“所有路径都天然离线”。** 换模型会触发下载；远程图片URL会联网；`result.vis()`首次可下载可视化字体。业务仅需文字时省略`vis()`；需要可视化时预置合法本地字体。[R4][R6]

官方提供`rapidocr config`、`rapidocr download_models`、`rapidocr download_models --config config.yaml`准备模型。参数中有`Global.model_root_dir`和Det/Cls/Rec各自的`model_path`/`model_dir`。后续打包应固定模型版本/来源、完整本地路径及字体，不依赖运行期公网下载；断网重启后能识别本地图片才算完成离线验收。[R5][R12]

## 6. 其他方案的接口与集成注意点

### 6.1 PaddleOCR

CPU PaddlePaddle需独立安装，`pip install paddleocr`并不包含全部推理引擎；普通OCR不需要`paddleocr[all]`、VL或整套文档理解能力。[P3]

官方Paddle安装指南列出的CPU命令为：

```bash
python -m pip install paddlepaddle==3.3.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
python -m pip install paddleocr
```

本轮PyPI另查到3.3.1 cp313 Windows wheel。**指南命令版本3.3.0与PyPI3.3.1分开记载**，不把不同渠道版本假装成同一验证组合。官方说明列Windows10/11专业/企业版；当前Windows11家庭中文版需自行验证，不能说一定不兼容，也不能声称在官方已验证范围。[P5][P6]

候选调用，限定有手写声明的v5 mobile并关闭不必要的文档模型：

```python
from paddleocr import PaddleOCR

ocr = PaddleOCR(
    ocr_version="PP-OCRv5",
    device="cpu",
    text_detection_model_name="PP-OCRv5_mobile_det",
    text_recognition_model_name="PP-OCRv5_mobile_rec",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
)
results = ocr.predict("C:/images/sample.jpg")
```

结果对象官方提供`json`、`save_to_json()`等能力；典型`res.json["res"]`内有`rec_texts`、`rec_scores`、`rec_polys`。若按行匹配框，使用过滤后的`rec_polys`，不要假设检测框`dt_polys`与阈值过滤后的`rec_texts`永远同长。上述代码未执行；最终以所固定PaddleOCR版本API为准。[P1]

### 6.2 EasyOCR

官方要求Windows先依PyTorch官方说明安装torch/torchvision，CPU选择CUDA=None。之后`pip install easyocr`。[E1]

```python
import easyocr

reader = easyocr.Reader(["ch_sim", "en"], gpu=False)
rows = reader.readtext("C:/images/sample.jpg")
```

`rows`默认是列表，每项`(四点框, 文本, 置信度)`；`detail=0`只给文本列表。`Reader`加载一次复用。首次模型下载到`~/.EasyOCR/model`，离线部署需提前准备。官方仍将手写支持列为未来事项。[E1]

Python3.13不能靠旧经验笼统判定“不支持PyTorch”。PyTorch官方Windows安装页面列Python3.10～3.14，包含3.13。当前torch有cp313 Windows wheel；torchvision 0.29.2为`py3-none-win_amd64`且依赖torch>=2.14.0。历史`torchvision0.24.0 + torch2.9.0`也有明确cp313 wheel并声明固定依赖关系。**这些只是可配对发行物的证据，不是EasyOCR1.7.2与最新框架的成功集成测试。** 不建议为本项目优先引入这一较大的依赖链。[E2][E3]

### 6.3 Tesseract

官方安装文档区分引擎与traineddata，并推荐UB Mannheim Windows安装器；后者是官方文档推荐的第三方构建，不是Tesseract团队自行发布的统一Windows pip wheel。[T1]

```python
import pytesseract

text = pytesseract.image_to_string(
    "C:/images/sample.jpg",
    lang="chi_sim+eng",
    config="--oem 1 --psm 6",
)
```

此例的`--psm 6`只是假设图片为单一规则文本块，不适用于所有布局。exe不在PATH时需指定`pytesseract.pytesseract.tesseract_cmd`；中文traineddata需放到正确目录。`image_to_data()`可获取框/置信度等TSV信息。tessdata_fast整数模型可用LSTM `--oem 1`，不能用legacy `--oem 0/2`，也不能直接用fast整数模型微调。[T3][T4]

## 7. 本地数据保存：微信与Windows的现实边界

### 7.1 不把“存本地”默认转成云数据库

| 数据 | 微信小程序建议 | Windows本地Python建议 |
|---|---|---|
| 设置、轻量历史索引 | `wx.setStorage`保存可JSON序列化对象 | 本地JSON；历史增多时SQLite，首版无须强加数据库 |
| 原图/背景/结果页 | `wx.env.USER_DATA_PATH`内的用户文件；临时文件需copy/save | 用户选定的本地目录，独立项目ID/文件名 |
| OCR行结果与校对文 | 小数据可缓存；较大正文按项目存用户文件JSON | JSON保存行框/分数＋原文/校对文 |
| 字体与模型 | 字体可缓存；Python wheel不能在小程序安装。端侧模型另评估 | 本地固定版本的模型、TTF、授权文件 |

微信官方当前说明：`wx.setStorage`单key最大1 MB、总10 MB；用户主动删除或系统因空间清理时可能丢失。图片不要转base64塞进这个缓存。[W1]

小程序**本地用户文件与缓存文件合计200 MB**，通过`wx.env.USER_DATA_PATH`获取读写目录；本地临时文件只保证当前生命周期有效，重启后不保证。用户文件也不是永久备份，会随代码包清理。不要沿用旧文章的10 MB文件限额，也不要把`setStorage`10 MB与用户文件200 MB混为一谈。[W2]

工程建议：配置、历史索引本地持久化；成功保存原图/正文/输出后再更新索引；用户可清理缓存、删除项目、导出备份。预览和导出的参数快照、字体版本、seed应一起保存，不把seed等同于“模拟某个真实人的笔迹”。

### 7.2 三种可选择的处理边界

1. **严格设备内处理：**照片与文字不发给远程服务。Windows本地RapidOCR可满足桌面场景；手机小程序还需独立验证JS/WASM或平台端侧推理。四套Python发行物不等于现成微信端运行方案。本轮没有找到并验证可直接拿来替代Python wheel的完整小程序方案，故不承诺。
2. **小程序本地保存＋远端暂态OCR：**历史/结果存手机，但图片处理仍上传服务器；“不长期保存”不等于“数据不离设备”。这是一种需要另行同意的架构选项，本报告不默认采用、不部署服务。
3. **小程序＋用户自己的电脑局域网伴随程序：**理论上可研究。官方允许基础库2.4.0起与局域网非本机IP通信，因此不能写“正式小程序完全禁止任何局域网IP”；但手机localhost是手机自身，不是电脑，且网络权限、设备在线、安全、局域网发现、跨平台行为均需验证，整体不属于最简CPU库接入。[W3]

普通公网通信需合法配置HTTPS/WSS域名，不能将localhost作为服务器域名；开发工具关闭域名校验不是正式发布能力。若用户只要求本地**保存**而未明确禁止上传，也不能替用户推断允许上传，应先确认以上边界。[W3]

**本轮建议：本地保存方案已经明确；OCR库推荐限定在Windows本地处理层。若最终必须纯手机端、全离线，端侧推理是继续研究的关键门槛，而不是换一个pip包就能解决。**

### 7.3 原生微信小程序迁移：建议拆分，不直接移植Python GUI

以下是**技术方案评估，不是已实现或已上线的应用**。采用原生WXML/WXSS/JavaScript界面；业务数据用显式JSON契约，桌面Python负责本地OCR和高分辨率渲染的能力研究。

| 层 | 推荐职责/能力 | 关键边界 | 评估 |
|---|---|---|---|
| 图片输入 | `wx.chooseMedia`选择相册/拍照图片，获得临时文件路径 | 选择图片只提供输入，不自带OCR；临时路径不是永久保存 | 低～中，需真机/权限验收 |
| OCR | 桌面本地RapidOCR为基线；手机端严格离线方案另研究 | Python wheel和ORT Windows provider不能直接进入小程序JS运行时 | 小程序端侧整链高；已有Python层接入低～中 |
| 人工校对 | 显示原图、OCR行框、原文/校对文和阅读顺序 | OCR框/置信度不等于完整文档结构；生成前允许纠错 | 中 |
| 轻量排版预览 | 原生`canvas type="2d"`配合法网络字体与本地配置 | 官方支持新Canvas2D；全字形旋转/平移不等于原库连通块扰动 | 中，效果简化需显式说明 |
| 原效果复现 | 保留连通块、灰度边缘、alpha和滤镜 | 需重做JS图像管线或在经同意的Python处理层输出成图，不能把`fillText`称为等价移植 | 中～高，需专项验证 |
| 高分辨率导出 | 默认留在桌面Python层研究，微信显示预览/接收结果 | 官方Canvas组件当前提示2D最大1365×1365，且过大画布可能使Android崩溃；**不能把原7000×9333整页画布直接承诺到微信端** | 高分辨率手机端导出另研究 |
| 历史与结果 | 本地JSON索引/用户文件；删除与导出由用户控制 | 本地缓存不是备份；手机与电脑并不共享文件路径 | 中 |

以上平台能力依据官方`wx.chooseMedia`、Canvas组件与字体/文件系统文档；难度是本报告工程判断，未跑真机。[W2][W4][W5][W7]

**若允许远端OCR/渲染，最清晰的边界是“小程序负责输入/校对/展示，Python服务负责OCR和大图渲染”，但该选项需先取得用户对上传的同意。** `wx.uploadFile`通过HTTPS POST、`multipart/form-data`上传本地文件，核心参数为`url`、`filePath`、`name`；响应`data`是字符串、`statusCode`是HTTP状态码，进入success回调不等于HTTP成功或识别成功。[W3][W6] 本轮没有创建接口、域名、服务器或云数据库，也不依赖GitHub Connector或私有API。

处理层与界面之间可预先约定：OCR响应包含图片尺寸、原始文本、`{box, txt, score}`行列表、库版本/模型档位；生成请求只接受校对后的正文、合法字体标识、模板参数和整数seed；生成结果返回任务ID、页数与图片引用。**这是字段契约建议，不是现存HTTP API。** 应限制图片像素/体积、正文长度、输出分辨率和并发；不接受客户端任意服务器字体路径，也不自动抓取用户传来的外部URL。图片/文字不得混入调试日志；若用暂态服务器处理，要明确清理时间和访问隔离。

**推进顺序建议：**桌面本地OCR样本验收 → 校对文与配置契约 → 八项修复语义 → AA/有限滤镜验收 → 原生小程序轻预览及本地历史 → 根据隐私边界决定手机端离线研究或用户同意的处理层。此顺序不包含工期承诺，也不等于必须先把旧Tkinter程序全面重写。

## 8. 可合法分发的中文字体

### 8.1 默认候选：LXGW WenKai Regular，固定v1.530

官方GitHub最新release元数据：v1.530，2026-10-17发布。以下直链均来自官方release的`browser_download_url`，不是第三方字体站或按文件名猜测。[F2][F3]

- **Regular TTF直接下载：**
  https://github.com/lxgw/LxgwWenKai/releases/download/v1.530/LXGWWenKai-Regular.ttf
- **对应版本OFL授权文件直链：**
  https://raw.githubusercontent.com/lxgw/LxgwWenKai/v1.530/OFL.txt
- **对应版本发布页：**
  https://github.com/lxgw/LxgwWenKai/releases/tag/v1.530
- **官方整包下载（可选，不建议小程序装全部字重）：**
  https://github.com/lxgw/LxgwWenKai/releases/download/v1.530/lxgw-wenkai-v1.530.zip

Regular为25,928,940 B，约25.93 MB；整包zip为81,919,348 B，约81.92 MB。没有实际下载或校验字体二进制，大小取官方asset元数据。[F3]

仓库说明基于Klee One，具有教科书体风格、兼具仿宋与楷体特点，支持简繁中文；并非个人笔迹复刻。完整版字库较大，适合先做桌面风格化候选，不保证单一字体达到附件里的商业字体效果。[F1]

### 8.2 OFL1.1允许什么、必须做什么

- 允许使用、嵌入、修改、随软件分发，包括商业软件；不能将字体本身单独出售。
- 随字体提供版权声明和完整OFL条款，可作为可读授权文件/元数据；字体及其修改版继续遵守OFL。
- 输出的图片/文档不因使用字体就必须采用OFL。
- 修改、删字、转换格式通常属于Modified Version，要处理Reserved Font Names。此项目声明包括`LXGW`及中文保留名称，并给出有条件的重编译/网页交付子集例外。**不能把该例外概括为所有改版/小程序字体都可保留原名。** 首版用原版TTF最清晰；后续子集方案逐条满足授权，必要时改名或向作者确认。[F4]

授权随字体版本一起保存。OFL不替代业务内容版权许可；本报告是技术授权核查，不是正式法律意见。

### 8.3 微信端字体加载和体积限制

官方`wx.loadFontFace`支持HTTPS或Data URL；`scopes`含`native`时可用于Canvas2D。Data URL从基础库3.7.9支持，旧版作用域默认行为不同；建议TTF/WOFF，低版本iOS的WOFF2不兼容，还需正确Content-Type和CORS。[W4]

25.93 MB TTF不应直接当轻量首包资源。**官方GitHub下载直链用于取得合法源字体，不等于适合作为小程序运行时字体CDN。** 运行时可研究自有静态资源托管或预缓存＋适配，但不上传用户文字来生成“动态子集”；严格离线还要覆盖字体首次获取流程。Data URL会膨胀并占内存，也不宜当大字库首选。

如果子集化，需满足OFL保留名条款并明确目标字符覆盖，避免OCR包含的生僻字变成缺字方框。只下载一次并缓存字体不会改变其分发授权义务。[F4][W2][W4]

### 8.4 四款附件字体默认不分发

附件《技术拆解报告》第1节称以下字体为商业字体：**义启手写体、云烟体、李国夫手写体、青叶手写体**。本轮未找到并核实这四个具体文件的权利人授权合同、版本和可再分发许可，不能将附件的版权断言升级为本轮独立法律结论。

保守方案：不从附件软件包提取后随小程序、桌面包、资源服务器或字体下载入口再分发。若将来使用，必须拿到覆盖软件嵌入、客户端下发、服务器使用及对应商业场景的明确授权；“免费下载”“个人可用”“用户上传”都不自动赋予产品再分发权。默认仅提供已核授权的开源字体。

## 9. 未实现功能的补全评估

### 9.1 八项低难度修复

以下按两份报告的八项范围整理，并与恢复文本交叉核对。**未改代码、未启动原 GUI 或做渲染回归**；低难度指局部逻辑/接线，不代表无需验收。表内`handwirte.py`均指`C:/Users/Grin/Downloads/handwirte.py`。

| # | 修复项 | 本地恢复文本证据 | 建议范围与验收 | 难度 |
|---|---|---|---|---|
| 1 | 背景2/3预设类型规范 | `handwirte.py:423`～435、445～457共**26个**一元组赋值，非“18个逗号” | 规范为数值；实测参数框与版心。**不能仅据一元组断言两个预设必崩**，见后文Tcl核验 | 低 |
| 2 | 预览字数输入 | `handwirte.py:41`固定500；81～84读取全局量，558～561只创建控件 | 正整数纳入任务参数；预览字数变更生效，不限制正式导出全文 | 低 |
| 3 | 防导出覆盖 | `handwirte.py:70`～74枚举后固定页号文件名 | 每任务独立ID/目录和页号；存在文件时拒绝或显式确认，时间戳单独使用仍可能碰撞 | 低 |
| 4 | 标点禁则 | `handwirte.py:65`、98均指定`end_chars="，。"`；恢复`handright._template.py:19`有更完整集合 | 按选定版本默认或明确维护禁则集；覆盖闭括号/问叹号，不硬背数量 | 低 |
| 5 | 随机种子 | `handwirte.py:69`、102调用未传seed；恢复`handright._core.py:19`有seed参数，141～147使用hash | 推荐整数seed；记录字体、库版本与参数；不承诺跨环境像素一致 | 低 |
| 6 | 重复预览/导出与3.13线程API | `handwirte.py:115`～116只创建一次Thread，124/127/153/156访问旧`isAlive`且不调用 | 改用`is_alive()`语义；每次新任务创建Thread，防重入；3.13下旧属性不存在，会先抛AttributeError | 低，需线程回归 |
| 7 | TXT空行 | `handwirte.py:197`～200逐行读取后再补换行 | 保留原换行；检查中文UTF-8、CRLF、尾行无换行 | 低 |
| 8 | 输入/异常反馈 | `handwirte.py:52`～76、85～111渲染/IO未捕获；143～146、172～175只捕获start且裸except | 主线程校验并快照参数；工作任务返回明确错误；异常不吞，不留假成功索引 | 低，需边界回归 |

**两项容易被旧报告误导的运行时差异：**

- 本机普通Python3.13.15直接查询`hasattr(threading.Thread(), "isAlive")`为False。恢复代码在到达`start()`的try块之前就访问此属性；因此3.13不能沿用“只是方法与True比较恒假、首次还能渲染”的叙述。正式API为`is_alive()`，同一个Thread只能start一次。[A1]
- 本机无窗口`tkinter.Tcl()`探测得到Tcl8.6.15；`Tcl.call("format", "%s", (200,))`返回字符串`"200"`，**不是`"(200,)"`**。Tkinter传参会经Tcl对象转换，一元组未必在Entry中显示Python的repr。本轮未启动Entry或原GUI，故不据此反向宣称预设可用；准确结论是“有26个可规范的元组赋值，原报告的必然ValueError因果链未被验证”。[A5]

主线程负责控件读取/更新，工作线程只做OCR/渲染；使用任务结果队列由UI事件循环接收。Tkinter有跨线程转发机制，但依赖事件循环与具体API，不能笼统称绝对非线程安全。[A5]

补充但不另计八项：`handwirte.py:185`～188手工拆路径，需标准路径API和大小写/无扩展名处理；534～537重复Entry；530～533抗锯齿/滤镜字符串回调`click_1`在全文件无实现。另有`handwirte.py:212`～213的`doc.Close`、`word.Quit`没有括号，在通常COM调用语义下不执行关闭/退出，需核实资源释放；`.doc`读取依赖本机Word COM，不应视为小程序能力。没有OCR图像输入入口，OCR接入是新增输入链路，**不属于八项旧缺陷修复**。

如果重做微信界面，不搬Tkinter控件或Thread代码；保留任务状态、防重入、校对、参数快照和错误反馈的验收语义即可。

### 9.2 抗锯齿：灰度连通块＋alpha，中等

原报告描述“二值掩膜 → 找连通块 → 变换后硬写纯色背景”。仅给复选框补`command`、或把`Image.new("1")`改成`"L"`，不足以保留抗锯齿边缘。

建议保留墨迹层的流程：

1. 在`L`灰度掩膜上排版，保留字形边缘覆盖率。
2. 连通域用阈值确定核心拓扑；**低alpha边缘也要分配给正确连通块并保留**，不能只搬`>127`像素，否则仍丢抗锯齿。阈值、细小点画、相邻块边缘归属是中等难点。
3. 对每块携带灰度/alpha做平移与旋转；避免仅逐像素四舍五入前向散射导致旋转空洞，需考虑逆向采样/重采样。
4. 写入墨迹alpha层，最终与背景合成；确定相交块采用最大覆盖还是source-over，两者效果不相同。
5. 检查裁边、缺笔、透明背景、缩略预览与正式图的差异。

Pillow官方`paste`支持L mask的中间值混合；`Image.alpha_composite`要求同模式、同尺寸的RGBA/LA图像。此处支持的是“有灰度层才能混合”的API事实，不证明附件改造版正确。[A2]

超采样后降采样可作为较简洁的替代AA路线；因此**“所有AA都必须fork handright”过于绝对**。背景/字形与所有以像素计的字号、边距、间距、平移sigma要同步按倍率缩放，**旋转角sigma是角度，不应随像素倍率放大**。最终需用灰度/彩色模式做LANCZOS降采样；二值`1`/调色板`P`模式不应当作保留灰度AA的最终层。倍率k使像素数量约增至k²倍，不能承诺“几乎免费”。[A2]

只做整页模糊或把现有低分辨率结果放大再缩小，不能恢复已经丢失的字形细节。若必须按报告要求保留灰度连通块并控制墨迹层，确需改渲染器/维护一个受控改版，但不等于任何抗锯齿方式都只能fork。

### 9.3 滤镜：中等，先限定为视觉后处理

建议首版范围：轻微逐块墨量差异、alpha噪声、有限模糊/纸张纹理，和AA共用墨迹层；不把静态噪声称为真实笔压或物理飞白。

难点在参数耦合、分辨率归一化、低墨量下的可读性、背景被误滤、预览/导出一致和大图内存。默认低强度、可关闭；滤镜不得改变校对文字/阅读顺序。

**不必固定SciPy为必需依赖。** 可按质量目标评估Pillow/OpenCV已有滤镜；仅为gaussian_filter再引入SciPy会增大依赖。附件用SciPy的路线可作为材料，但本轮未验证性能或效果。[A2][R1]

内存应按实际同时存活的数组算：7000×9333约6533万像素；单张uint8 alpha约65.33 MB，float32 alpha约261.32 MB，float32 RGB约783.97 MB。多个全图临时数组会累加；ROI/条带合成能减少合成临时峰值，但如果完整背景/alpha/连通域标签仍在，不能宣称内存恒定。这些是数据类型推算，不是内存测试。

### 9.4 真笔压、字形变体与连笔：高难度、不承诺

字体轮廓、二值连通块不是按时间排序的真实笔画轨迹，也没有压力/速度采样。轮廓骨架化不能自动恢复正确笔顺、交叉处连接和起收笔；因此“拿中心线＋扫掠”不是完整方案。多字体混合也不等于一致书写风格下的同字变体。

如后续研究，需有合法笔画/轨迹数据、变宽渲染或经过专项验证的生成模型，并检查中文字形可读性、缺字、风格一致和资源成本。本轮仅评估其高难度；不承诺真实笔压、不承诺模仿特定个人笔迹、不承诺输出无法被识别为风格化生成内容。

### 9.5 对附件结论的必要校正

- **Handright不是可直接沿用“MIT”标签的依赖。** 当前官方Handright8.2.0及仓库LICENSE为BSD-3-Clause。原exe中历史版本究竟适用何种许可，本轮未取得其原始授权文件，不能断言；采用当前库时应按当前BSD许可分发。[A3][A4] 恢复的GUI脚本有作者署名，但未核到其再分发许可；核心库开源不能自动推出整个GUI、背景图片及捆绑字体均可随产品分发。
- Handright8.2.0的依赖要求`Pillow>=8.3.2,<11`。**本机pip show查到Pillow12.3.0，未安装Handright**；现有Pillow已超出该约束，最新发行的Pillow13也不满足。Python3.13存在Pillow10.4.0 Windows wheel，可作为隔离环境的兼容候选，但Handright本轮未验证3.13实际运行。**RapidOCR已可导入不代表整条渲染链自动兼容。** 不在现有环境主动降级Pillow，不用`--no-deps`忽略约束；后续先做独立环境依赖解析与渲染验收。[A3][D7]
- 报告称“纯黑块覆盖产生加深”：若每次确实写同一RGB黑色，重复覆盖本身不会变得比黑更黑；只有alpha/墨量模型等才会产生额外混合效果。
- 报告“AA几乎免费”“滤镜不额外吃内存”“3552→1263 MB”等是附件作者测试声称，不可换算到本机/手机；灰度、alpha、float临时数组确有资源成本。
- 若“257级”指单通道8位灰度，超过0～255的256级上限；若统计RGB元组则要明示统计定义。本轮未看到测试脚本，不能采纳成准确指标。
- 种子只保证给定实现和环境下的随机过程可追溯，不是某人笔迹模型，也不保证换库版本后像素一致。恢复`handright._core.py:141`使用`hash(seed)`；字符串seed受Python进程hash随机化影响，不应直接承诺跨重启复现。优先整数seed，并在固定实现中验收。
- 反编译文本可能出现语法/控制流恢复错误，不直接作为Python3.13产品源码；当前Handright和样本历史接口也不同，不能只升级Python就直接运行老GUI。八项“低”是局部功能范围分级，不是整个旧程序升级到3.13或迁移小程序的总难度。
- 八项预设修复范围保持低难度，但报告的“18个逗号”“一元组必显示为repr并导致ValueError”须分别改成26处静态赋值与待GUI回归结论；本轮Tcl无窗口探测已说明后一个推断不能直接成立。

## 10. 后续验收计划——本轮未执行

### OCR验收

- 使用同一批经授权且有人工真值的中文印刷、规整手写、潦草/连笔、旋转、阴影、小字、混合中英图；分组报告，不给一个笼统“中文准确率”。
- 固定库版本、模型档位、预处理、图像尺寸、CPU型号、线程。RapidOCR v6默认与v5 mobile/server分开记，Paddle同模型原生推理作转换一致性对照。
- 分开统计冷启动、热推理、总延迟和内存；计算CER/漏行及阅读顺序错误；低置信度校对，不把score当真实正确率。
- 断网后重启识别本地文件，核对是否仍请求模型/字体/远程图片；包、模型、字体授权与校验值随版本固定。

### 本地保存/渲染验收

- 冷启动后历史/原文/校对文/结果可恢复；文件保存失败时索引不出现成功项目；可删除和导出备份。
- AA关闭/开启、滤镜关闭/开启、不同背景和尺寸、重复相同字、缺字/生僻字、参数极值与多页输出。
- 字体加载失败有明确提示，不静默用另一字体输出；OFL文件和版权说明可被用户查看。
- 微信端在真实iOS/Android/Windows微信分别验证；开发者工具可预览不能替代端侧OCR或字体兼容验收。

## 11. 官方证据索引

以下为2026-11-03访问/查询的一手来源。`latest`/`main`页面会变化；关键接口另引用固定v3.10.0，字体固定v1.530，大小引用版本PyPI JSON。没有GitHub Connector授权也能读取这些公开来源；本轮没有使用未授权Connector。

### RapidOCR / ORT

- [R1] RapidOCR PyPI及3.10.0元数据（版本、Python要求、分类器、依赖、wheel大小）：https://pypi.org/project/rapidocr/ ；https://pypi.org/pypi/rapidocr/3.10.0/json
- [R2] ONNX Runtime PyPI及1.31.1元数据（Python要求、cp313 Windows CPU wheel、大小、MIT）：https://pypi.org/project/onnxruntime/ ；https://pypi.org/pypi/onnxruntime/1.31.1/json
- [R3] ORT官方安装与Windows运行库要求：https://onnxruntime.ai/docs/install/
- [R4] RapidOCR官方模型表、默认权重预打包和v5/v6路由：https://rapidai.github.io/RapidOCRDocs/main/model_list/
- [R5] RapidOCR固定v3.10.0配置（CPU默认、线程、本地模型路径）：https://github.com/RapidAI/RapidOCR/blob/v3.10.0/python/rapidocr/config.yaml
- [R6] 官方快速开始（安装、字段、vis字体下载）：https://rapidai.github.io/RapidOCRDocs/main/quickstart/
- [R7] 固定版本输入类型、EXIF和通道处理：https://github.com/RapidAI/RapidOCR/blob/v3.10.0/python/rapidocr/utils/load_image.py
- [R8] 固定版本RapidOCROutput、Optional字段、to_json：https://github.com/RapidAI/RapidOCR/blob/v3.10.0/python/rapidocr/utils/output.py
- [R9] 固定版本主调用/空结果/阶段返回：https://github.com/RapidAI/RapidOCR/blob/v3.10.0/python/rapidocr/main.py
- [R10] 固定版本JSON字段box/txt/score：https://github.com/RapidAI/RapidOCR/blob/v3.10.0/python/rapidocr/utils/to_json.py
- [R11] 仓库模型占位目录（不等于PyPI wheel内容）：https://api.github.com/repos/RapidAI/RapidOCR/contents/python/rapidocr/models?ref=v3.10.0
- [R12] 官方使用教程、config/download_models命令：https://rapidai.github.io/RapidOCRDocs/main/install_usage/rapidocr/usage/
- [R13] RapidOCR许可证与模型归属说明：https://github.com/RapidAI/RapidOCR/blob/v3.10.0/LICENSE ；https://github.com/RapidAI/RapidOCR

### PaddleOCR / PaddlePaddle

- [P1] 官方OCR管线、模型大小、predict和结果字段：https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/OCR.html
- [P2] 官方识别模型能力与v5 handwriting声明：https://www.paddleocr.ai/latest/en/version3.x/module_usage/text_recognition.html
- [P3] 官方安装、可选依赖与独立推理引擎：https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/installation.en.md
- [P4] PaddleOCR3.7.0发行/依赖/许可证：https://pypi.org/pypi/paddleocr/3.7.0/json ；https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE
- [P5] PaddlePaddle3.3.1 cp313 Windows wheel和大小：https://pypi.org/pypi/paddlepaddle/3.3.1/json
- [P6] 官方Python3.13、Windows SKU、CPU安装指南：https://www.paddlepaddle.org.cn/documentation/docs/zh/install/index_cn.html ；https://www.paddlepaddle.org.cn/documentation/docs/zh/install/pip/windows-pip.html
- [P7] PP-OCRv5官方算法说明，明确中英复杂手写与印刷评估场景：https://www.paddleocr.ai/main/version3.x/algorithm/PP-OCRv5/PP-OCRv5.html
- [P8] PaddleOCR官方README与3.7.0/PP-OCRv6发布说明：https://github.com/PaddlePaddle/PaddleOCR ；https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/README.md

### EasyOCR / PyTorch

- [E1] 官方README（中文、CPU安装、模型缓存、手写路线图、输出）：https://github.com/JaidedAI/EasyOCR
- [E2] EasyOCR1.7.2、当前及可配对历史框架发行元数据：https://pypi.org/pypi/easyocr/1.7.2/json ；https://pypi.org/pypi/torch/2.15.0/json ；https://pypi.org/pypi/torchvision/0.29.2/json ；https://pypi.org/pypi/torch/2.9.0/json ；https://pypi.org/pypi/torchvision/0.24.0/json
- [E3] PyTorch官方安装选择：https://pytorch.org/get-started/locally/
- [E4] 模型配置与官方release资产大小：https://github.com/JaidedAI/EasyOCR/blob/v1.7.2/easyocr/config.py ；https://api.github.com/repos/JaidedAI/EasyOCR/releases/tags/v1.3 ；https://api.github.com/repos/JaidedAI/EasyOCR/releases/tags/pre-v1.1.6
- [E5] EasyOCR Apache-2.0：https://github.com/JaidedAI/EasyOCR/blob/master/LICENSE

### Tesseract

- [T1] 官方安装（引擎与traineddata、UB Mannheim推荐、Apache2）：https://tesseract-ocr.github.io/tessdoc/Installation.html
- [T2] 官方FAQ手写限制：https://tesseract-ocr.github.io/tessdoc/FAQ.html#can-i-use-tesseract-for-handwriting-recognition
- [T3] pytesseract发行物和Python要求：https://pypi.org/pypi/pytesseract/0.3.13/json
- [T4] 官方wrapper用法及语言参数：https://github.com/madmaze/pytesseract ；tessdata_fast官方授权/OEM说明：https://github.com/tesseract-ocr/tessdata_fast
- [T5] 语言包官方大小元数据：https://api.github.com/repos/tesseract-ocr/tessdata_fast/contents/chi_sim.traineddata ；https://api.github.com/repos/tesseract-ocr/tessdata_fast/contents/eng.traineddata

### 原生依赖

- [D1] OpenCV headless5.0.0.93、ABI/大小：https://pypi.org/pypi/opencv-python-headless/5.0.0.93/json
- [D2] NumPy2.5.4 cp313：https://pypi.org/pypi/numpy/2.5.4/json
- [D3] Pillow13.0.0 cp313：https://pypi.org/pypi/pillow/13.0.0/json
- [D4] Shapely2.2.0 cp313：https://pypi.org/pypi/shapely/2.2.0/json
- [D5] pyclipper1.4.0 cp313：https://pypi.org/pypi/pyclipper/1.4.0/json
- [D6] PyYAML6.0.3 cp313：https://pypi.org/pypi/PyYAML/6.0.3/json
- [D7] Pillow10.4.0 cp313及大小：https://pypi.org/pypi/pillow/10.4.0/json

### 微信本地能力

- [W1] wx.setStorage，1 MB/key、10 MB总量、清理条件：https://developers.weixin.qq.com/miniprogram/dev/api/storage/wx.setStorage.html
- [W2] 官方文件系统，USER_DATA_PATH、临时/用户文件、200 MB总量：https://developers.weixin.qq.com/miniprogram/dev/framework/ability/file-system.html
- [W3] 官方网络边界、局域网非本机IP及localhost限制：https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html
- [W4] wx.loadFontFace，HTTPS/Data URL、Canvas2D、TTF/WOFF、版本/CORS：https://developers.weixin.qq.com/miniprogram/dev/api/ui/font/wx.loadFontFace.html
- [W5] 原生Canvas组件、新2D接口与画布尺寸/Android风险提示：https://developers.weixin.qq.com/miniprogram/dev/component/canvas.html
- [W6] wx.uploadFile，HTTPS multipart上传、参数与响应：https://developers.weixin.qq.com/miniprogram/dev/api/network/upload/wx.uploadFile.html
- [W7] wx.chooseMedia，相册/拍照与临时文件：https://developers.weixin.qq.com/miniprogram/dev/api/media/video/wx.chooseMedia.html

### 字体与渲染基础

- [F1] LXGW WenKai官方仓库、中文覆盖与风格：https://github.com/lxgw/LxgwWenKai
- [F2] v1.530官方发布：https://github.com/lxgw/LxgwWenKai/releases/tag/v1.530
- [F3] 固定v1.530官方发布asset原始大小/直链：https://api.github.com/repos/lxgw/LxgwWenKai/releases/tags/v1.530
- [F4] 固定v1.530的OFL1.1、保留名及额外许可：https://github.com/lxgw/LxgwWenKai/blob/v1.530/OFL.txt ；https://raw.githubusercontent.com/lxgw/LxgwWenKai/v1.530/OFL.txt
- [A1] Python3.13 Thread.start/is_alive：https://docs.python.org/3.13/library/threading.html#threading.Thread.start ；https://docs.python.org/3.13/library/threading.html#threading.Thread.is_alive
- [A2] Pillow官方Image合成与mask API：https://pillow.readthedocs.io/en/stable/reference/Image.html
- [A3] Handright当前版本、BSD许可及Pillow<11依赖：https://pypi.org/project/handright/ ；https://pypi.org/pypi/handright/8.2.0/json
- [A4] Handright实际许可证与官方教程：https://github.com/Gsllchb/Handright/blob/master/LICENSE.txt ；https://github.com/Gsllchb/Handright/blob/master/docs/tutorial.md
- [A5] Python3.13 Tkinter/Tcl解释器与线程模型：https://docs.python.org/zh-cn/3.13/library/tkinter.html 。本报告另执行无GUI的Tcl元组转换探测；该探测是本机观察，不冒充官方对旧程序Entry行为的保证。

---

**评估阶段建议（历史记录）：**Windows本地OCR首选RapidOCR3.10.0＋ORT1.31.1；真实手写需比较模型档位。八项局部补全低、灰度AA与有限滤镜中、真笔压/字形变体高。上述评估阶段的“未实现、未安装、默认文楷”等描述保留为当时证据，当前实现状态以下方补充和《工作流交付与自测报告》为准。

## 12. 实施与原效果恢复后补充

用户已选择本地保存与本机Python处理。真实图片→RapidOCR→人工校对→PNG API、原生页面控制器真实HTTP及移动浏览器全流程已通过；微信UI/FS行为测试使用明确stub，不替代微信原生编译或真机验收。未执行断网整链及真实潦草手写泛化准确率评测。

用户进一步要求沿用原程序逻辑与资源，不以新排版方案或文楷替代。已确认原核心版本 **Handright5.5.0**，从该版本发行物取得未修改源码并保留实际BSD3许可（`backend/vendor/handright-5.5.0.dist-info/LICENSE.txt`）。使用Pillow指标兼容适配，恢复原二值草稿、字体锚点/字宽、四边距、字号/字距sigma、每页RNG与连通笔画dx/dy/theta；不直接执行失真的反编译源码，不升级到8.2替代原核心。

四原字体、三原背景及原预设已本机只读接入，默认李国夫+背景1；文楷/OFL仅为附加选项。切背景恢复原预设，缺失资源不静默替换，历史保留完整资源ID和参数。固定444字/同李国夫字体/同原背景1/seed2026：恢复版相对同版本原库当前环境基线 **0像素差**；此验证不表示未知seed旧EXE截图逐像素匹配。

AA/filter默认关闭。可选轻后处理不改变原库布局和随机数，但不是9.2节设想的完整灰度轮廓抗锯齿。支持原背景2的7000×9333尺寸；API/CLI逐页保存与释放，避免多页大图累积。原字体/背景不随ZIP重新分发；公开使用仍需核对授权。当前16后端测试、27原生行为及真实页面串联通过，详细边界、对照图、运行方法与测量见《工作流交付与自测报告》。
