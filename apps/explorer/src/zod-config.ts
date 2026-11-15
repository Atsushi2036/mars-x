import { z } from 'zod'

// zod 4 probes `new Function('')` to JIT its parsers; under our CSP (no unsafe-eval) that is a reported violation.
// jitless = interpreted parsers. Imported first from main.tsx so it is set before any schema is constructed.
z.config({ jitless: true })
