<div align="center">

# HealthRoute AI

**Describe your symptoms. Find the right hospital department. Get directions.**

A mobile-first health navigation app for Bangladesh that turns plain-language symptoms into the medical department you should visit, then shows the nearest hospitals that have it.

[Live demo](#) · [Model on Hugging Face](https://huggingface.co/Nahraf-Chowdhury/InshaAllahHobe_v1) · [Report a bug](../../issues)

<!-- Replace with a real screenshot or GIF -->
<!-- ![App screenshot](docs/screenshot.png) -->

</div>

---

> ⚠️ **This app does not diagnose diseases.** It suggests which hospital department (for example, cardiology) is most likely to suit the symptoms a person describes. It is a navigation aid, not medical advice. In an emergency, use the SOS button or call **999** immediately.

## The problem

In a big city like Dhaka, many people don't know whether to see a cardiologist, a neurologist or a general physician, or which nearby hospital even has that department. Going to the wrong place wastes time when time matters.

## What it does

1. **Collect symptoms** by tapping a 3D body map, typing in a chat-style box, or both.
2. **Classify** the text with an AI model that predicts one of 13 hospital departments.
3. **Assess risk level** with a second model.
4. **Show nearby hospitals** that have that department, using the phone's location and Google Maps.
5. **Navigate** with nearest-hospital selection, a "change hospital" option and directions.

## Features

- **Interactive body map**: male and female models, with external, internal-organ and bone layers, and Front / Back / Head close-up / Hands / Feet views
- **Free-text symptom input**: body-map taps and dropdown choices are written into the same text box (for example `chest pain; left hand tingling;`)
- **Department classifier**: fine-tuned text model covering 13 departments
- **Risk level model**: a separate classifier that reports the urgency of the described symptoms (NOT DEVELOPED YET)
- **Nearest hospital finder**: browser geolocation plus Google Maps, with data for hospitals in Dhaka
- **SOS button**: one tap to call the emergency number
- **Fits one phone screen**: the input flow is designed for mobile first

## How it works

```
Body map taps ─┐
Dropdown picks ├─► Symptom text ──► Department model ──► "cardiology"
Typed text    ─┘   "chest pain;"  └► Risk model       ──► "medium"
                                              │
                                              ▼
                       Hospital–department table (Dhaka)
                                              │
                                              ▼
                       Nearest hospitals on a map + directions
```

The body-map UI only collects input. All decisions happen in the models and the backend.

## The models

| | Department classifier | Risk classifier |
|---|---|---|
| Task | Symptom text → 1 of 13 departments | Symptom text → risk level |
| Base | DistilBERT, fine-tuned | - |
| Hosted at | [`Nahraf-Chowdhury/InshaAllahHobe_v1`](https://huggingface.co/Nahraf-Chowdhury/InshaAllahHobe_v1) | - |
| Runs | In the browser via ONNX + `transformers.js`, or through an API | - |

### Training data

Training data was generated from a symptom dictionary grouped by department, then expanded with patient-style phrasings (informal wording, shuffled symptom order, unimportant symptoms mixed in) so the model copes with how people really describe what they feel. Mental-health rows are excluded from the current prototype. Training was done on a Colab GPU.

## Results

Evaluated on a held-out test split of N examples (13 departments).

| Model | Accuracy | Macro F1 | Top-3 accuracy |
|---|---|---|---|
| Department head | 0.900 | 0.904 | 0.994 |

## API

Both endpoints accept JSON `POST` requests with `Content-Type: application/json`.

**Department**

```http
POST {MODEL_API}/predict
{ "text": "chest pain; left hand tingling;" }
```

**Risk**

```http
POST {RISK_API}/risk
{ "text": "chest pain; left hand tingling;", "sex": "female" }
```

### Environment variables

| Variable | Description |
|---|---|
| `MODEL_API` | Base URL of the department classifier |
| `RISK_API` | Base URL of the risk classifier |
| `GOOGLE_MAPS_API_KEY` | Key for maps and directions |

## Hospital data

`hospital_departments.csv has two columns, `hospital` and `department`. It maps 18 Dhaka hospitals to the 13 department names the classifier uses, so a prediction can be matched directly to hospitals that offer it.

## Roadmap

- [ ] Add more common Bangladeshi conditions with help from doctors
- [ ] Support Bangla symptom input
- [ ] Expand hospital coverage beyond Dhaka
- [ ] Add mental-health departments
- [ ] Evaluate the models with clinicians
- [ ] Add blood collection feature

## Team

| Name | Role |
|---|---|
| Nahraf Chowdhury | Model training |
| SYH Shanto | Hospital and department data |
| Inzamumul Haque | Frontend and body-map UI |
| Rawnak Tanvir Dihan | Symptom Data |
| Md. Nazif Wasit | Backend |
| Mehrab Murshad | Backend |

## Limitations

- Predictions depend on how well the description matches the training data. Vague or unusual wording shows no suggestions.
- Hospital and department data is only as current as the last update.
- The app has not been clinically validated.

## License

Distributed under the _MIT_ License. See `LICENSE` for details.

## Acknowledgements

- [Hugging Face](https://huggingface.co) for model hosting
- [DistilBERT](https://huggingface.co/distilbert-base-uncased) as the base model
