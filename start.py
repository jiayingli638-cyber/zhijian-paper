"""Run from any working directory: python /absolute/path/start.py"""
import os
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))
if __name__ == "__main__":
    import uvicorn
    from backend.app import app
    print("本机工作流验证入口：http://127.0.0.1:8765")
    print("原生小程序工程：" + str(ROOT / "miniprogram"))
    uvicorn.run(app, host="127.0.0.1", port=8765, access_log=False)
