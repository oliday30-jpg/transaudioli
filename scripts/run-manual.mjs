// Lance scripts/generate-manual.mjs comme process Electron plutôt que Node —
// même contournement que run.mjs pour ELECTRON_RUN_AS_NODE (voir ce fichier).
import { spawn } from 'node:child_process'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn('npx electron scripts/generate-manual.mjs', {
  stdio: 'inherit',
  env,
  shell: true
})

child.on('exit', (code) => process.exit(code ?? 0))
