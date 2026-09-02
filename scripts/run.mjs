// VS Code's integrated terminal exports ELECTRON_RUN_AS_NODE, which makes
// electron.exe start as plain Node instead of the Electron app (require('electron')
// then resolves to a path string instead of the API). Electron checks whether the
// key exists at all, so setting it to an empty value isn't enough — it must be deleted
// before the child process is spawned.
import { spawn } from 'node:child_process'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const subcommand = process.argv[2]
const child = spawn(`npx electron-vite ${subcommand}`, {
  stdio: 'inherit',
  env,
  shell: true
})

child.on('exit', (code) => process.exit(code ?? 0))
