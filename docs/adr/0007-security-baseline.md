# ADR-0007: Security baseline

- Status: Accepted (2026-11-14) — security-senior holds veto
- Deciders: security-senior

## Decision
- Strict CSP enforced from the first preview: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` + HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP same-origin. No COEP.
- Everything self-hosted (tiles, data, fonts); no third-party runtime requests.
- No user code execution in the MVP (the lab uses parameters, not code).
- `run.json` uploads: size check, parsed in a worker, strict zod schema (finite numbers, bbox, max lengths), text-only rendering.
- ONNX drag-and-drop (veto lifted with controls): WASM backend only; protobuf pre-validation (ai.onnx domains, bounded opset, no external data, node cap, no Loop/Scan/If, bounded Expand/Tile/ConstantOfShape); dedicated worker with `connect-src 'none'`, WASM binary passed from the main thread; 1 thread; message validation; `terminate()` on error/timeout; models never leave the browser or get shared by URL.
- Supply chain: exact versions, lockfiles, ≥7-day release age, `pnpm audit`, `pip-audit`, gitleaks; no pickle anywhere; TLS always verified; SHA-256 on downloads.
- Exports: SDF from fixed templates, XML-escaped, **no `<plugin>` or user URIs**; self-contained GLB; ZIP with fixed paths; ATTRIBUTION.txt.
- Live localhost agent bridge: deferred (no same-origin policy on WebSockets; needs pairing token and Origin checks).

## Accepted risks
`style-src 'unsafe-inline'` (Radix), single-thread ONNX (no COEP).
