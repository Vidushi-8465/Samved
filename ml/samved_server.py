"""SAMVED inference HTTP server.

This service loads the model artifacts produced by Samved_ML.ipynb and
exposes a small JSON API for the dashboard:

- GET  /health
- POST /samved/predict

Request body example:
{
  "ch4_ppm": 150,
  "h2s_ppm": 1.2,
  "co_ppm": 8,
  "o2_percent": 20.7,
  "heart_rate_bpm": 74,
  "spo2_percent": 98,
  "ch4_delta": 3,
  "h2s_delta": 0.05,
  "o2_delta": 0.02,
  "hr_delta": 1,
  "spo2_delta": 0,
  "motion_state": 1
}

Run:
  python ml/samved_server.py
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "samved_model.pkl"
FEATURES_PATH = ROOT / "samved_feature_names.pkl"

LABEL_MAP = {0: "SAFE", 1: "WARNING", 2: "DANGER"}
ACTIONS = {
    "SAFE": "Continue work. Monitor regularly.",
    "WARNING": "Caution. Supervisor alerted. Prepare to exit.",
    "DANGER": "EXIT IMMEDIATELY. Emergency protocol activated.",
}
TREND_LABELS = {
    "stable": "Stable",
    "rising": "Rising - monitor closely",
    "critical": "Critical - rapid deterioration",
}
HARD_LIMITS = {
    "o2_percent": 16.0,
    "h2s_ppm": 50.0,
    "co_ppm": 200.0,
    "ch4_ppm": 5000.0,
    "spo2_percent": 90.0,
    "motion_state": 2,
}

MODEL = joblib.load(MODEL_PATH)
FEATURES = joblib.load(FEATURES_PATH)


class TrendWindow:
    def __init__(self, size: int = 5):
        self.size = size
        self.values: list[int] = []

    def push(self, value: int) -> str:
        self.values.append(value)
        if len(self.values) > self.size:
            self.values = self.values[-self.size :]

        if len(self.values) < 3:
            return "stable"

        delta = self.values[-1] - self.values[-3]
        if delta >= 20:
            return "critical"
        if delta >= 8:
            return "rising"
        return "stable"


WINDOW = TrendWindow(size=5)


def _json_response(handler: BaseHTTPRequestHandler, status_code: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status_code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(body)


def _check_hard_limits(reading: dict[str, Any]) -> tuple[bool, str | None]:
    checks = [
        (reading.get("o2_percent", 21), "<=", HARD_LIMITS["o2_percent"], "O2 critically low"),
        (reading.get("h2s_ppm", 0), ">=", HARD_LIMITS["h2s_ppm"], "H2S at IDLH level"),
        (reading.get("co_ppm", 0), ">=", HARD_LIMITS["co_ppm"], "CO approaching IDLH"),
        (reading.get("ch4_ppm", 0), ">=", HARD_LIMITS["ch4_ppm"], "CH4 explosive risk zone"),
        (reading.get("spo2_percent", 100), "<=", HARD_LIMITS["spo2_percent"], "SpO2 critically low - hypoxia"),
        (reading.get("motion_state", 0), "==", HARD_LIMITS["motion_state"], "Fall detected"),
    ]

    for value, op, limit, reason in checks:
        triggered = (
            op == "<=" and value <= limit
            or op == ">=" and value >= limit
            or op == "==" and value == limit
        )
        if triggered:
            return True, reason
    return False, None


def _predict(reading: dict[str, Any]) -> dict[str, Any]:
    override, reason = _check_hard_limits(reading)

    if override:
        status = "DANGER"
        confidence = {"SAFE": 0.0, "WARNING": 0.0, "DANGER": 1.0}
        risk_score = 100
    else:
        sample = pd.DataFrame([reading])[FEATURES]
        proba = MODEL.predict_proba(sample)[0]
        status = LABEL_MAP[MODEL.predict(sample)[0]]
        confidence = {
            "SAFE": round(float(proba[0]), 3),
            "WARNING": round(float(proba[1]), 3),
            "DANGER": round(float(proba[2]), 3),
        }
        risk_score = int(proba[2] * 100)

    trend = WINDOW.push(risk_score)

    return {
        "status": status,
        "risk_score": risk_score,
        "trend": trend,
        "trend_label": TREND_LABELS.get(trend, trend),
        "action": ACTIONS[status],
        "confidence": confidence,
        "hard_limit_triggered": override,
        "override_reason": reason,
        "alert_local_buzzer": status == "DANGER",
        "alert_supervisor": status in ("WARNING", "DANGER"),
        "alert_sos": status == "DANGER" and override,
        "alert_fall": reading.get("motion_state") == 2,
        "timestamp_ms": __import__("time").time_ns() // 1_000_000,
    }


class SamvedHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        return

    def do_OPTIONS(self) -> None:
        _json_response(self, 204, {})

    def do_GET(self) -> None:
        if self.path == "/health":
            _json_response(
                self,
                200,
                {
                    "ok": True,
                    "service": "samved-server",
                    "model_loaded": True,
                    "features": len(FEATURES),
                },
            )
            return

        _json_response(self, 404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path != "/samved/predict":
            _json_response(self, 404, {"error": "Not found"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            _json_response(self, 400, {"error": "Invalid JSON"})
            return

        missing = [key for key in FEATURES if key not in payload]
        if missing:
            _json_response(self, 400, {"error": "Missing required fields", "missing": missing})
            return

        try:
            reading = {key: float(payload[key]) for key in FEATURES}
            reading["motion_state"] = int(payload["motion_state"])
        except (TypeError, ValueError):
            _json_response(self, 400, {"error": "All inputs must be numeric"})
            return

        try:
            result = _predict(reading)
        except Exception as exc:  # pragma: no cover - defensive API boundary
            _json_response(self, 500, {"error": "Prediction failed", "details": str(exc)})
            return

        _json_response(self, 200, result)


def main() -> None:
    host = "0.0.0.0"
    port = 5000
    server = HTTPServer((host, port), SamvedHandler)
    print(f"SAMVED server running on http://{host}:{port}")
    print("Health: GET /health")
    print("Predict: POST /samved/predict")
    server.serve_forever()


if __name__ == "__main__":
    main()
