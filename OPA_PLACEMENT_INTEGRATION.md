# OPA placement integration

The web app uses the existing OPA score API as placement scheme 1.

## Backend

Start the supplied backend from its own project directory:

```powershell
python app.py --train-code train_opa_score_resnet_ms.py --ckpt best.ckpt --arch resnet18 --device-target CPU
```

Expected endpoints:

- `GET http://127.0.0.1:8000/health`
- `POST http://127.0.0.1:8000/api/predict`

The current machine still needs a compatible MindSpore environment. The supplied
backend recommends Python 3.9.

## Frontend flow

`opa-placement.js`:

1. Builds candidate foreground positions from the selected precision level.
2. Expands the foreground-size search range according to the selected size level.
3. Creates position candidates for every searched size.
4. Uploads all candidates in one multipart request.
5. Returns the position and size of the highest-scoring candidate.

The five precision levels evaluate 6, 9, 12, 20, and 30 positions per searched
size. The size slider controls the search range rather than directly setting the
foreground size. Higher levels cover a wider range of smaller and larger
foreground candidates.
Schemes 2 and 3 are reserved in the adjustment panel and remain disabled.

If the OPA API is unavailable, `app.js` falls back to the original local
placement heuristic so image composition remains usable.
