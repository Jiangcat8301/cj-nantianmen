// Readline helpers — stdlib only.
//
// Two modes:
// - interactive (TTY): each prompt reads a fresh line, prints the question.
// - piped (non-TTY): pre-reads all lines from stdin, dispatches in order.
//   This makes `nantianmen setup` scriptable from CI.
import readline from 'node:readline'

let _pipeLines = null
async function ensurePipeReady() {
  if (_pipeLines !== null) return _pipeLines
  if (process.stdin.isTTY) return null
  const lines = []
  const rl = readline.createInterface({ input: process.stdin })
  for await (const line of rl) lines.push(line)
  rl.close()
  _pipeLines = lines
  process.stdin.destroy?.()
  return _pipeLines
}

export async function prompt(question) {
  const piped = await ensurePipeReady()
  if (piped !== null) {
    const v = piped.shift() ?? ''
    process.stdout.write(question + v + '\n')
    return v.trim()
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (ans) => { rl.close(); resolve(ans.trim()) })
  })
}

export async function askSecret(question) {
  const piped = await ensurePipeReady()
  if (piped !== null) {
    const v = piped.shift() ?? ''
    process.stdout.write(question + '*'.repeat(v.length) + '\n')
    return v
  }
  process.stdout.write(question)
  return new Promise((resolve) => {
    let buf = ''
    const handler = (ch) => {
      const c = ch.toString()
      if (c === '\r' || c === '\n' || c === '\u0004') {
        process.stdin.removeListener('data', handler)
        process.stdin.setRawMode?.(false)
        process.stdout.write('\n')
        resolve(buf)
      } else if (c === '\u0003') {
        process.exit(1)
      } else if (c === '\u0008' || c === '\u007f') {
        if (buf.length > 0) { buf = buf.slice(0, -1); process.stdout.write('\b \b') }
      } else if (c.length === 1) {
        buf += c
        process.stdout.write('*')
      }
    }
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    process.stdin.on('data', handler)
  })
}
