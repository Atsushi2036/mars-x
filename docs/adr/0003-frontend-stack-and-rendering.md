# ADR-0003: Frontend stack and terrain rendering

- Status: Accepted (2026-11-14)
- Deciders: frontend-senior, ux-ui-designer, security-senior

## Decision
- Vite 8 + React 19 + TypeScript + Tailwind 4 + shadcn/ui + zustand + Geist (self-hosted). UI in English.
- three.js 0.187 + React Three Fiber 9 + drei on **WebGL2**. Heavy logic lives in framework-free TS modules.
- Terrain: chunked mesh with LOD built in a Web Worker from raw `Uint16` heights; heights also kept on CPU (`sampleHeight`, `normalAt`) for camera, rover and planners — never raycast per frame.
- Ortho: tiled pyramid (WebP, KTX2 when available), HiRISE RED band with declared false-colour tint; layers composed in one material (`onBeforeCompile`).
- Workers + Comlink + transferables for terrain decode, planning, RL lab and ONNX inference.
- Layout "mission control": full-bleed canvas, dark collapsible mode rail, contextual inspector, telemetry bar; mobile bottom nav + bottom sheets + virtual joystick.
- Budgets: 60 fps on integrated GPU (dpr ≤ 1.5), initial JS < 350 KB gzip, critical assets < 15 MB, LCP < 2.5 s, zero console errors.

## Alternatives discarded
- WebGPU/TSL: official status unverified, migration risk in 24 h → roadmap.
- CesiumJS (Earth-centric, heavy), Babylon.js, deck.gl (2.5D).
- Next.js: no SSR/SEO need.
- `PlaneGeometry` + `displacementMap` only: heights would live only on the GPU.
- PNG16 heightmaps: browsers decode to 8 bits (~0.8 m steps).
- SharedArrayBuffer / WASM threads: require COOP/COEP; not needed at this scale → roadmap.
