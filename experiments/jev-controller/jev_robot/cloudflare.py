"""Jev-only Cloudflare client. No model fallback and no credential logging."""
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request


class JevError(RuntimeError):
    pass


def load_env(path):
    """Read only the two needed keys; never execute a shell dotenv file."""
    if path is None:
        return
    for line in Path(path).expanduser().read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() in ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"):
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


class CloudflareJev:
    def __init__(self, timeout=25):
        self.account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
        self.token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
        if not re.fullmatch(r"[a-fA-F0-9]{32}", self.account) or not self.token:
            raise JevError("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or use --env-file")
        self.timeout = timeout

    def __call__(self, request):
        req = urllib.request.Request(
            "https://api.cloudflare.com/client/v4/accounts/" + self.account + "/ai/run",
            data=json.dumps({"model": "typesafe/jev", "input": request}).encode(),
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"},
            method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as exc:
            # Provider error bodies can echo inputs. Never relay them or request headers.
            raise JevError("Jev HTTP %d; episode aborted, no fallback action" % exc.code) from None
        except (OSError, ValueError):
            raise JevError("Jev request failed or timed out; episode aborted") from None
        return payload


def parse(payload, allowed, confidence_floor):
    if not isinstance(payload, dict) or payload.get("success") is False:
        raise JevError("Jev returned an unsuccessful response")
    result = payload.get("result", payload)
    if isinstance(result, dict) and result.get("state") == "Completed":
        result = result.get("result")
    if not isinstance(result, dict):
        raise JevError("Malformed Jev response")
    answers = result.get("answers")
    if not isinstance(answers, dict) or not isinstance(answers.get("movement"), dict):
        raise JevError("Malformed Jev answer map")
    answer = answers["movement"]
    choice = answer.get("choice")
    confidence = answer.get("confidence")
    probs = answer.get("probabilities")
    number = lambda v: type(v) in (int, float) and 0 <= v <= 1
    if answer.get("type") != "choice" or choice not in allowed or not number(confidence):
        raise JevError("Invalid Jev movement answer")
    if not isinstance(probs, dict) or choice not in probs or any(
        k not in allowed or not number(v) for k, v in probs.items()
    ) or abs(sum(probs.values()) - 1) > 0.02:
        raise JevError("Invalid Jev probability distribution")
    if confidence < confidence_floor:
        raise JevError("Jev confidence below configured floor; episode aborted")
    return {"choice": choice, "confidence": confidence,
            "probabilities": probs, "served_model": result.get("model"),
            "usage": result.get("usage", {})}
