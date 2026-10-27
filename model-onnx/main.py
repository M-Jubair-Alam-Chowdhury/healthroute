"""Department model server WITHOUT PyTorch (ONNX Runtime) — small enough for Render's free 512 MB instance.

Same API and same decision rule as real-model/main.py:
    POST /predict {"text": "chest pain; cough;"}
      -> {"mode": "single"|"multi"|"unsure", "top3_sum": 0.768, "departments": [["Respiratory", 0.619], ...]}

Files it needs (made once by export_onnx.py and stored in a free Hugging Face MODEL repo):
    model.int8.onnx (or model.fp32.onnx)   tokenizer.json   meta.json
They are downloaded at start-up (the free host's disk is wiped on every restart), unless they are already in MODEL_DIR.

Environment variables:
    ONNX_REPO    HF model repo holding the files, e.g. Nahraf-Chowdhury/InshaAllahHobe_v1-onnx   (required unless MODEL_DIR has them)
    ONNX_FILE    model.int8.onnx (default) or model.fp32.onnx
    HF_TOKEN     only if that repo is private
    MODEL_DIR    local folder with the files (default ./model_files)
    ALLOWED_ORIGINS  extra websites allowed to call this API (comma-separated; *.vercel.app is always allowed)
"""
import json
import os

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from tokenizers import Tokenizer

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.environ.get("MODEL_DIR", os.path.join(HERE, "model_files"))
ONNX_FILE = os.environ.get("ONNX_FILE", "model.int8.onnx")
ONNX_REPO = os.environ.get("ONNX_REPO", "")

# Same thresholds as real-model/main.py (found by calibrate_thresholds_2.ipynb); thresholds.json next to this file overrides.
THRESHOLDS = {"high": 0.66, "top3_min": 0.71, "max_k": 3, "use_ensemble": True}
_override = os.path.join(HERE, "thresholds.json")
if os.path.exists(_override):
    with open(_override) as f:
        THRESHOLDS.update(json.load(f))

# ---------------------------------------------------------------- get the files
need = [ONNX_FILE, "tokenizer.json", "meta.json"]
os.makedirs(MODEL_DIR, exist_ok=True)
if not all(os.path.exists(os.path.join(MODEL_DIR, n)) for n in need):
    if not ONNX_REPO:
        raise RuntimeError(f"Missing {need} in {MODEL_DIR} and ONNX_REPO is not set.")
    from huggingface_hub import hf_hub_download

    for n in need:
        hf_hub_download(ONNX_REPO, n, local_dir=MODEL_DIR)

# ---------------------------------------------------------------- load
meta = json.load(open(os.path.join(MODEL_DIR, "meta.json"), encoding="utf-8"))
id2dept = {int(k): v for k, v in meta["id2dept"].items()}
MAX_LEN = int(meta.get("max_len", 128))
tok = Tokenizer.from_file(os.path.join(MODEL_DIR, "tokenizer.json"))
tok.no_padding()
tok.enable_truncation(max_length=MAX_LEN)

so = ort.SessionOptions()
so.intra_op_num_threads = 1
so.inter_op_num_threads = 1
sess = ort.InferenceSession(os.path.join(MODEL_DIR, ONNX_FILE), sess_options=so, providers=["CPUExecutionProvider"])

# disease -> department matrix (turns disease probabilities into department probabilities)
M = np.zeros((int(meta["n_diseases"]), int(meta["n_depts"])), dtype=np.float32)
M[np.arange(int(meta["n_diseases"])), np.asarray(meta["disease_to_dept"])] = 1.0


def softmax(x: np.ndarray) -> np.ndarray:
    x = x - x.max(-1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(-1, keepdims=True)


def dept_probs(text: str) -> np.ndarray:
    """Department probabilities [n_depts] for one input (same maths as real-model/main.py)."""
    enc = tok.encode(text)
    ids = np.asarray([enc.ids], dtype=np.int64)
    mask = np.asarray([enc.attention_mask], dtype=np.int64)
    dis_logits, dep_logits = sess.run(None, {"input_ids": ids, "attention_mask": mask})
    p_dis, p_dep = softmax(dis_logits.astype(np.float32)), softmax(dep_logits.astype(np.float32))
    p = (p_dep + p_dis @ M) / 2 if THRESHOLDS["use_ensemble"] else p_dep
    return p[0]


def select_departments(p_row: np.ndarray, th: dict = THRESHOLDS) -> dict:
    order = np.argsort(-p_row)
    top_p = float(p_row[order[0]])
    s3 = float(p_row[order[: th["max_k"]]].sum())
    ids = order[: th["max_k"]]
    mode = "single" if top_p >= th["high"] else ("multi" if s3 >= th["top3_min"] else "unsure")
    return {"mode": mode, "top3_sum": round(s3, 3), "departments": [(id2dept[int(i)], round(float(p_row[i]), 3)) for i in ids]}


# ---------------------------------------------------------------- API
app = FastAPI(title="Symptom model (ONNX)")
_extra = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", *_extra],
    allow_origin_regex=r"https://[a-z0-9-]+\.vercel\.app",
    allow_methods=["*"],
    allow_headers=["*"],
)


class Req(BaseModel):
    text: str


@app.get("/")
def root():
    return {
        "service": "Multi-task DistilBERT department model (ONNX)",
        "file": ONNX_FILE,
        "departments": [id2dept[i] for i in range(len(id2dept))],
        "thresholds": THRESHOLDS,
    }


@app.post("/predict")
def predict(req: Req):
    return select_departments(dept_probs(req.text))
