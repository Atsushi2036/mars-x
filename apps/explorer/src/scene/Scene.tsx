import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace } from 'three'
import type { Dataset } from '@/core/data/loader'
import { LAYER_IDS, terrainUniforms } from './terrain-material'
import { ChunkManager } from './chunk-manager'
import { CameraRig } from './CameraRig'
import { Rover } from './Rover'
import { Sky } from './Sky'
import { Sun } from './Sun'
import { useApp } from '@/store/app'
import { cameraRig, useCamera } from '@/store/camera'
import { roverLive } from '@/store/rover'

declare global {
  interface Window {
    __marsx?: { ready: boolean; fps: number; frameCount: number; chunks: number; triangles: number; mode: string }
  }
}

function Terrain({ ds }: { ds: Dataset }) {
  const gl = useThree((s) => s.gl)
  const setProgress = useApp((s) => s.setProgress)
  const mgr = useMemo(
    () =>
      new ChunkManager(
        ds,
        (p) => {
          setProgress('mesh', p.mesh)
          setProgress('ortho', p.ortho)
        },
        Math.min(8, gl.capabilities.getMaxAnisotropy()),
      ),
    [ds, gl, setProgress],
  )
  useEffect(() => {
    void mgr.start()
    return () => mgr.dispose()
  }, [mgr])
  useFrame(({ camera }, dt) => {
    mgr.update(camera.position, dt)
    const w = window.__marsx
    if (w) {
      w.chunks = mgr.meshesReady
      w.triangles = mgr.triangles
    }
  })
  return <primitive object={mgr.group} />
}

/** Syncs layer state to the shared terrain uniforms. */
function LayerSync() {
  useEffect(() => {
    const apply = () => {
      const { layer, layerOpacity } = useApp.getState()
      terrainUniforms.uLayer.value = LAYER_IDS[layer]
      terrainUniforms.uLayerOpacity.value = layerOpacity
    }
    apply()
    return useApp.subscribe(apply)
  }, [])
  return null
}

/** Telemetry (4 Hz) and the Playwright hook window.__marsx. */
function Probes({ ds }: { ds: Dataset }) {
  const hf = ds.heightfield
  useEffect(() => {
    window.__marsx = { ready: false, fps: 0, frameCount: 0, chunks: 0, triangles: 0, mode: 'orbit' }
    return () => {
      delete window.__marsx
    }
  }, [])
  const acc = useMemo(() => ({ t: 0, frames: 0, ready: false }), [])
  useFrame(({ camera }, dt) => {
    const w = window.__marsx
    if (w) w.frameCount++
    acc.t += dt
    acc.frames++
    if (acc.t < 0.25) return
    const fps = acc.frames / acc.t
    acc.t = 0
    acc.frames = 0
    const mode = useCamera.getState().mode
    let x: number
    let z: number
    if (mode === 'fpv') {
      x = cameraRig.fpv.x
      z = cameraRig.fpv.z
    } else if (mode === 'chase') {
      x = roverLive.x
      z = roverLive.z
    } else {
      x = cameraRig.focus.x
      z = cameraRig.focus.z
    }
    const ll = hf.worldToLonLat(x, z)
    useApp.getState().setTelemetry({
      lat: ll.lat,
      lon: ll.lon,
      elevation: hf.sampleHeight(x, z),
      slopeDeg: hf.slopeDegAt(x, z),
      x,
      z,
      fps,
    })
    const s = useApp.getState()
    if (w) {
      w.fps = fps
      w.mode = mode
      if (!acc.ready && s.progress.mesh >= 1 && s.progress.ortho >= 1) {
        acc.ready = true
        s.setProgress('ready', 1)
        // let two frames with the final meshes go out before announcing readiness
        let n = 0
        const tick = () => {
          if (++n >= 2) w.ready = true
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }
    }
    void camera
  })
  return null
}

export default function Scene({ dataset }: { dataset: Dataset }) {
  const onCreated = useMemo(
    () =>
      ({ gl }: { gl: { domElement: HTMLCanvasElement } }) => {
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault()
          useApp.getState().setError('The WebGL context was lost. Reload the page to continue.')
        })
      },
    [],
  )
  return (
    <Canvas
      className="!absolute inset-0 touch-none"
      dpr={[1, 1.5]}
      shadows={{ type: PCFShadowMap }}
      gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace }}
      camera={{ fov: 55, near: 0.5, far: 9000, position: [0, 400, 600] }}
      onCreated={onCreated}
    >
      <Sky />
      <Sun />
      <LayerSync />
      <Terrain ds={dataset} />
      <Rover hf={dataset.heightfield} />
      <CameraRig hf={dataset.heightfield} />
      <Probes ds={dataset} />
    </Canvas>
  )
}
