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

## Amendment (2026-11-14): `connect-src 'self' blob:` on the page CSP
- Cause: three.js `GLTFLoader` (r187) decodes embedded GLB textures with `ImageBitmapLoader`, which creates a `blob:` URL per image and reads it with `fetch()` (`GLTFLoader.js:3445`, `ImageBitmapLoader.js:175`); under `connect-src 'self'` the rover rendered untextured with CSP violations.
- Decision (security-senior): add exactly `blob:` to `connect-src` of the page policy — no `data:`, `https:` or wildcards. `blob:` is not network egress and a document can only read blobs created by its own origin, so no exfiltration or third-party contact is opened. Residual risk: negligible (accepted).
- The ONNX policy worker keeps its own CSP with `connect-src 'none'` (no `blob:`).
- Preferred follow-up after the hackathon: externalise GLB textures with gltf-transform (same-origin `.webp`) and remove `blob:` again.
