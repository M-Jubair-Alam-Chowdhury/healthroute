"""Run ONCE (Google Colab is fine) to turn your PyTorch model into small ONNX files.

    pip install torch transformers onnx onnxruntime huggingface_hub numpy
    # put multitask_model.py (from your model repo) next to this file, then:
    python export_onnx.py --model Nahraf-Chowdhury/InshaAllahHobe_v1 --out onnx_out
    # optional: also upload the result to a (free) Hugging Face MODEL repo:
    #   huggingface-cli login        (a token with write access)
    python export_onnx.py --model Nahraf-Chowdhury/InshaAllahHobe_v1 --out onnx_out --upload Nahraf-Chowdhury/InshaAllahHobe_v1-onnx

It writes:  model.fp32.onnx  model.int8.onnx  tokenizer.json  meta.json
and PRINTS how far the ONNX probabilities drift from the PyTorch ones and whether the
single / multi / unsure decision changes. READ THAT OUTPUT before deploying: your thresholds
(high 0.66, top3_min 0.71) were calibrated on the PyTorch model.
"""
import argparse
import inspect
import json
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from multitask_model import MultiTaskDistilBert  # noqa: E402
from transformers import AutoTokenizer  # noqa: E402

TH = {"high": 0.66, "top3_min": 0.71, "max_k": 3}
MAX_LEN = 128
SAMPLES = [
    "chest pain; cough;", "i have a high fever and my body aches", "my skin is itchy and i have a rash on my arm",
    "stomach pain; vomiting;", "headache and dizziness", "pain when urinating; lower back pain;",
    "my tooth hurts and my gum is swollen", "blurry vision; red eyes;", "joint pain and stiffness in the morning",
    "i feel tired all the time and very thirsty", "short of breath; wheezing;", "fever; chills; sore throat;",
    "left hand tingling; neck stiffness;", "i feel weird", "pain",
]


def softmax(x):
    x = x - x.max(-1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(-1, keepdims=True)


def decide(p):
    order = np.argsort(-p)
    top, s3 = float(p[order[0]]), float(p[order[: TH["max_k"]]].sum())
    return "single" if top >= TH["high"] else ("multi" if s3 >= TH["top3_min"] else "unsure")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="HF repo id or folder of the PyTorch model")
    ap.add_argument("--out", default="onnx_out")
    ap.add_argument("--texts", help="optional text file, one test sentence per line (use REAL examples from your app)")
    ap.add_argument("--upload", help="HF model repo id to upload the result to")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    tok = AutoTokenizer.from_pretrained(a.model)
    model = MultiTaskDistilBert.from_pretrained(a.model).eval()
    cfg = model.config
    M = np.zeros((cfg.n_diseases, cfg.n_depts), dtype=np.float32)
    M[np.arange(cfg.n_diseases), np.asarray(cfg.disease_to_dept)] = 1.0

    # ---- export (fixed sample input, dynamic batch + length)
    enc = tok(["chest pain; cough;"], return_tensors="pt", padding=True, truncation=True, max_length=MAX_LEN)
    fp32 = os.path.join(a.out, "model.fp32.onnx")
    kw = {"dynamo": False} if "dynamo" in inspect.signature(torch.onnx.export).parameters else {}
    torch.onnx.export(
        model, (enc["input_ids"], enc["attention_mask"]), fp32,
        input_names=["input_ids", "attention_mask"], output_names=["disease_logits", "dept_logits"],
        dynamic_axes={"input_ids": {0: "batch", 1: "seq"}, "attention_mask": {0: "batch", 1: "seq"},
                      "disease_logits": {0: "batch"}, "dept_logits": {0: "batch"}},
        opset_version=17, do_constant_folding=True, **kw,
    )
    from onnxruntime.quantization import QuantType, quantize_dynamic
    int8 = os.path.join(a.out, "model.int8.onnx")
    quantize_dynamic(fp32, int8, weight_type=QuantType.QInt8)

    # ---- tokenizer + metadata
    tok.save_pretrained(a.out)  # writes tokenizer.json (fast tokenizer)
    assert os.path.exists(os.path.join(a.out, "tokenizer.json")), "no tokenizer.json: the tokenizer must be a *fast* one"
    meta = {"id2dept": {str(k): v for k, v in cfg.id2dept.items()}, "disease_to_dept": list(cfg.disease_to_dept),
            "n_diseases": cfg.n_diseases, "n_depts": cfg.n_depts, "max_len": MAX_LEN}
    json.dump(meta, open(os.path.join(a.out, "meta.json"), "w"), indent=1)

    # ---- compare PyTorch vs ONNX on test sentences
    import onnxruntime as ort
    texts = SAMPLES
    if a.texts:
        texts = [t.strip() for t in open(a.texts, encoding="utf-8") if t.strip()]
    sessions = {n: ort.InferenceSession(p, providers=["CPUExecutionProvider"]) for n, p in [("fp32", fp32), ("int8", int8)]}
    worst = {"fp32": 0.0, "int8": 0.0}
    flips = {"fp32": 0, "int8": 0}
    for t in texts:
        e = tok([t], return_tensors="pt", padding=True, truncation=True, max_length=MAX_LEN)
        with torch.no_grad():
            dl, pl = model(e["input_ids"], e["attention_mask"])
        ref = ((torch.softmax(pl.float(), -1).numpy() + torch.softmax(dl.float(), -1).numpy() @ M) / 2)[0]
        feed = {"input_ids": e["input_ids"].numpy().astype(np.int64), "attention_mask": e["attention_mask"].numpy().astype(np.int64)}
        for n, s in sessions.items():
            d_l, p_l = s.run(None, feed)
            p = ((softmax(p_l) + softmax(d_l) @ M) / 2)[0]
            worst[n] = max(worst[n], float(np.abs(p - ref).max()))
            flips[n] += decide(p) != decide(ref)
    print("\n==== PyTorch vs ONNX over %d sentences ====" % len(texts))
    for n in ("fp32", "int8"):
        size = os.path.getsize(fp32 if n == "fp32" else int8) / 1e6
        print(f"{n}: file {size:.0f} MB | largest probability difference {worst[n]:.4f} | decisions that changed: {flips[n]}/{len(texts)}")
    print("Rule of thumb: use int8 if its decisions changed on ~0 sentences and the difference is small (< 0.02);")
    print("otherwise use fp32 (bigger: may not fit Render's free 512 MB) or re-run your threshold calibration on int8 outputs.")

    if a.upload:
        from huggingface_hub import HfApi
        api = HfApi()
        api.create_repo(a.upload, repo_type="model", exist_ok=True)
        api.upload_folder(folder_path=a.out, repo_id=a.upload, repo_type="model",
                          allow_patterns=["model.*.onnx", "tokenizer.json", "meta.json"])
        print("uploaded to https://huggingface.co/" + a.upload)


if __name__ == "__main__":
    main()
