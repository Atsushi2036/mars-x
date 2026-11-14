"""Canonical JSON used for content hashes (scenario, suite, policy card).

marsx canonical JSON v1: keys sorted, no insignificant whitespace, UTF-8, ``allow_nan=False``.
(Close to RFC 8785; numbers are serialised with Python's shortest repr.)
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sha256_json(obj: Any) -> str:
    return hashlib.sha256(canonical_json(obj).encode("utf-8")).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
