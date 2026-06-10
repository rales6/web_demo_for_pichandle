#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OPA Placement Score Backend API

This backend exposes a local HTTP API for frontend integration.
It loads a MindSpore ResNet18 + MLP Head model and predicts a 0-100 placement score.

Required files in the same directory:
- app.py
- train_opa_score_resnet_ms.py
- best.ckpt

Run:
    python app.py --train-code train_opa_score_resnet_ms.py --ckpt best.ckpt --arch resnet18 --device-target CPU

API:
    GET  /health
    POST /api/predict
"""

import argparse
import importlib.util
import sys
import os
import threading
from io import BytesIO
from pathlib import Path
from typing import List

import mindspore as ms
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image


DEFAULT_CONFIG = {
    "train_code": "train_opa_score_resnet_ms.py",
    "ckpt": "best.ckpt",
    "arch": "resnet18",
    "image_size": 224,
    "device_target": "CPU",
    "device_id": 0,
    "context_mode": "PYNATIVE",
}

STATE = {
    "module": None,
    "network": None,
    "config": DEFAULT_CONFIG.copy(),
    "loaded": False,
}

PREDICT_LOCK = threading.Lock()


def parse_args():
    parser = argparse.ArgumentParser(description="Run local OPA backend API.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--train-code", default=DEFAULT_CONFIG["train_code"])
    parser.add_argument("--ckpt", default=DEFAULT_CONFIG["ckpt"])
    parser.add_argument("--arch", default=DEFAULT_CONFIG["arch"], choices=["resnet18", "resnet34", "resnet50"])
    parser.add_argument("--image-size", type=int, default=DEFAULT_CONFIG["image_size"])
    parser.add_argument("--device-target", default=DEFAULT_CONFIG["device_target"], choices=["CPU", "GPU", "Ascend"])
    parser.add_argument("--device-id", type=int, default=DEFAULT_CONFIG["device_id"])
    parser.add_argument("--context-mode", default=DEFAULT_CONFIG["context_mode"], choices=["GRAPH", "PYNATIVE"])
    return parser.parse_args()


def set_context(device_target: str, device_id: int, context_mode: str):
    mode = ms.GRAPH_MODE if context_mode == "GRAPH" else ms.PYNATIVE_MODE
    try:
        ms.set_context(mode=mode, device_target=device_target, device_id=device_id)
    except TypeError:
        ms.set_context(mode=mode, device_target=device_target)


def import_training_module(train_code_path: Path):
    train_code_path = train_code_path.resolve()
    if not train_code_path.exists():
        raise FileNotFoundError(f"Training code not found: {train_code_path}")

    module_name = "opa_train_module"
    spec = importlib.util.spec_from_file_location(module_name, str(train_code_path))
    module = importlib.util.module_from_spec(spec)

    # MindSpore GRAPH_MODE may need to import this module by name.
    sys.modules[module_name] = module
    spec.loader.exec_module(module)

    for name in ["build_model", "IMAGENET_MEAN", "IMAGENET_STD"]:
        if not hasattr(module, name):
            raise AttributeError(f"Training code does not define required object: {name}")

    return module


def load_model():
    cfg = STATE["config"]
    train_code = Path(cfg["train_code"])
    ckpt = Path(cfg["ckpt"])

    if not train_code.exists():
        raise FileNotFoundError(f"Training code not found: {train_code}")
    if not ckpt.exists():
        raise FileNotFoundError(f"Checkpoint not found: {ckpt}")

    set_context(cfg["device_target"], cfg["device_id"], cfg["context_mode"])

    module = import_training_module(train_code)
    network = module.build_model(cfg["arch"])

    params = ms.load_checkpoint(str(ckpt))
    not_loaded = ms.load_param_into_net(network, params)
    network.set_train(False)

    STATE["module"] = module
    STATE["network"] = network
    STATE["loaded"] = True

    print("=" * 70, flush=True)
    print("OPA backend model loaded", flush=True)
    print("=" * 70, flush=True)
    print(f"Train code: {train_code}", flush=True)
    print(f"Checkpoint: {ckpt}", flush=True)
    print(f"Arch: {cfg['arch']}", flush=True)
    print(f"Device: {cfg['device_target']} | mode={cfg['context_mode']}", flush=True)
    print(f"MindSpore not_loaded: {not_loaded}", flush=True)
    print("=" * 70, flush=True)


def preprocess_image_bytes(module, content: bytes, image_size: int):
    image = Image.open(BytesIO(content)).convert("RGB").resize((image_size, image_size), Image.BILINEAR)
    array = np.asarray(image, dtype=np.float32) / 255.0
    array = array.transpose(2, 0, 1)
    array = (array - module.IMAGENET_MEAN) / module.IMAGENET_STD
    array = np.expand_dims(array.astype(np.float32), axis=0)
    return array


def predict_bytes(filename: str, content: bytes):
    if not STATE["loaded"]:
        raise RuntimeError("Model is not loaded.")

    module = STATE["module"]
    network = STATE["network"]
    image_size = int(STATE["config"]["image_size"])

    array = preprocess_image_bytes(module, content, image_size)
    tensor = ms.Tensor(array, ms.float32)

    # Keep single-threaded inference to avoid MindSpore runtime concurrency issues.
    with PREDICT_LOCK:
        prediction = network(tensor)

    score = float(prediction.asnumpy().reshape(-1)[0])
    return {
        "filename": filename,
        "score": round(score, 4),
    }


app = FastAPI(title="OPA Placement Score Backend API", version="1.0.0")

# For local frontend development.
# In production, replace "*" with the actual frontend domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event():
    load_model()


@app.get("/health")
def health():
    return {
        "status": "ok" if STATE["loaded"] else "not_loaded",
        "model": {
            "arch": STATE["config"]["arch"],
            "image_size": STATE["config"]["image_size"],
            "device_target": STATE["config"]["device_target"],
            "output": "0-100 placement score",
        },
    }


@app.post("/api/predict")
async def predict(images: List[UploadFile] = File(...)):
    """
    Frontend should send multipart/form-data.

    Field name:
        images

    Supports one image or multiple images.
    """
    if not images:
        raise HTTPException(status_code=400, detail="No image uploaded. Form field name must be 'images'.")

    results = []
    for file in images:
        content_type = file.content_type or ""
        if not content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"Uploaded file is not an image: {file.filename}")

        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail=f"Uploaded image is empty: {file.filename}")

        try:
            results.append(predict_bytes(file.filename or "uploaded_image", content))
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Inference failed for {file.filename}: {repr(exc)}")

    scores = [item["score"] for item in results]
    return JSONResponse({
        "code": 0,
        "message": "success",
        "score": scores[0],
        "scores": scores,
        "results": results,
    })


if __name__ == "__main__":
    args = parse_args()
    STATE["config"] = {
        "train_code": args.train_code,
        "ckpt": args.ckpt,
        "arch": args.arch,
        "image_size": args.image_size,
        "device_target": args.device_target,
        "device_id": args.device_id,
        "context_mode": args.context_mode,
    }

    import uvicorn

    # Render 会通过环境变量 PORT 分配公网访问端口；本地没有 PORT 时使用命令行参数。
    port = int(os.environ.get("PORT", args.port))

    # 云端部署必须监听 0.0.0.0，不能只监听 127.0.0.1。
    uvicorn.run(app, host=args.host or "0.0.0.0", port=port)
