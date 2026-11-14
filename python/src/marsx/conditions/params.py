"""Sourced parameters: every number in the conditions engine carries its provenance.

``provenance`` follows the scorecard chips (PO §1.4.6): ``measured`` (instrument / published spec),
``derived`` (computed from sourced numbers), ``modeled`` (output of a published model) and
``assumption`` (team assumption, calibrable, never presented as data).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

Provenance = Literal["measured", "derived", "modeled", "assumption"]
PROVENANCES: frozenset[str] = frozenset({"measured", "derived", "modeled", "assumption"})


@dataclass(frozen=True, slots=True)
class Param:
    value: float
    unit: str
    provenance: Provenance
    source: str  # URL / citation, or the rationale when provenance == "assumption"
    note: str = ""

    def __post_init__(self) -> None:
        if self.provenance not in PROVENANCES:
            raise ValueError(f"unknown provenance {self.provenance!r}")
        if not self.source.strip():
            raise ValueError("every parameter needs a source (or an assumption rationale)")

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def assumption(value: float, unit: str, rationale: str, note: str = "") -> Param:
    return Param(value, unit, "assumption", f"team assumption: {rationale}", note)
