/**
 * Single source of icons. Import every icon from here, never from 'lucide-react' directly
 * (swapping the set is then a one-file change). Sizes: 20 inline/secondary, 24 rail/dock/primary, 16 only inside chips.
 * Stroke 1.75 everywhere (see ICON). Custom glyphs (Rover, Astronaut) follow lucide's grid: 24x24, round caps and joins.
 */
import { createLucideIcon } from 'lucide-react'

export {
  Bot,
  Hand,
  Keyboard,
  MousePointerClick,
  Brain,
  Cpu,
  CircleDashed,
  Ruler,
  Sigma,
  Upload,
  Zap,
  TrendingUp,
  Timer,
  Thermometer,
  Wind,
  Gauge,
  Target,
  Radio,
  BatteryLow,
  ChartNoAxesColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CircleX,
  Compass,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FileUp,
  Flag,
  FlaskConical,
  Footprints,
  House,
  Info,
  Layers,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Minus,
  MonitorOff,
  Moon,
  Mountain,
  OctagonX,
  Orbit,
  PackageOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Route,
  ShieldCheck,
  SkipBack,
  Sparkles,
  Square,
  Sun,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react'

/** Icon geometry contract. `sm` for lists/headers/inline buttons, `md` for rail, dock and primary buttons. */
export const ICON = { chip: 16, sm: 20, md: 24, stroke: 1.75 } as const

/** Perseverance-style rover in profile: six wheels (three visible), body, mast with camera head, arm in front. */
export const RoverIcon = createLucideIcon('rover', [
  ['circle', { cx: 5, cy: 18.5, r: 2.5, key: 'w1' }],
  ['circle', { cx: 12, cy: 18.5, r: 2.5, key: 'w2' }],
  ['circle', { cx: 19, cy: 18.5, r: 2.5, key: 'w3' }],
  ['path', { d: 'M3.5 15.5V11a1.5 1.5 0 0 1 1.5-1.5h11a1.5 1.5 0 0 1 1.5 1.5v4.5', key: 'body' }],
  ['path', { d: 'M3.5 12H2', key: 'rtg' }],
  ['path', { d: 'M15.5 9.5V6', key: 'mast' }],
  ['path', { d: 'M13.5 3h4v3h-4z', key: 'head' }],
  ['path', { d: 'M18 12.5h2.5l1.5 2', key: 'arm' }],
])

/** Astronaut in an EVA suit: helmet with visor, torso, arms. */
export const AstronautIcon = createLucideIcon('astronaut', [
  ['circle', { cx: 12, cy: 6.5, r: 4.5, key: 'helmet' }],
  ['path', { d: 'M9.8 5.2h4.4a1.8 1.8 0 0 1 0 3.6H9.8a1.8 1.8 0 0 1 0-3.6z', key: 'visor' }],
  ['path', { d: 'M8 12.5h8a2 2 0 0 1 2 2V21h-3.5v-4.5h-3V21H6v-6.5a2 2 0 0 1 2-2z', key: 'suit' }],
  ['path', { d: 'M6 14.5H4.5L3 18', key: 'armL' }],
  ['path', { d: 'M18 14.5h1.5L21 18', key: 'armR' }],
])
