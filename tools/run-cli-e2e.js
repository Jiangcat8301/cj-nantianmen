// ponytail: end-to-end CLI test. Spawns server detached, runs CLI commands one by one.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SERVER_DIR = path.resolve('../server')
const CLI_DIR = path.resolve('../cli')

function cleanup() {
  for (const f of ['nantianmen-conf.json', 'nantianmen.db', 'nantianmen.db-wal', 'nantianmen.db-shm']) {
    try { fs.rmSync(path.join(SERVER_DIR, f), { force: true }) } catch {}
  }
  try { fs.rmSync(path.join(os.homedir(), '.nantianmen', 'config.json'), { force: true }) } catch {}
}

function step(label) { console.log(`\n=== ${label} ===`) }
function pass(msg) { console.log(`✓ ${msg}`) }
function fail(msg) { console.error(`✗ ${msg}`); process.exit(1) }

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function waitForHealth(timeoutMs = 5000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch('http://127.0.0.1:38271/v1/health')
      if (r.ok) return true
    } catch {}
    await sleep(150)
  }
  throw new Error('server did not become healthy')
}

// ponytail: spawn CLI subcommand. stdin is 'ignore' for non-interactive calls.
// For interactive setup we pipe a multi-line payload.
function cli(args, { stdin = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['index.js', ...args], {
      cwd: CLI_DIR,
      env: { ...process.env },
      stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })
    let out = '', err = ''
    child.stdout.on('data', d => { out += d.toString() })
    child.stderr.on('data', d => { err += d.toString() })
    if (stdin) {
      child.stdin.write(stdin)
      child.stdin.end()
    }
    child.on('close', code => resolve({ code, out, err }))
    child.on('error', reject)
  })
}

async function main() {
  cleanup()
  await sleep(500)
  // ponytail: kill prior detached server. Two passes because detached child
  // may still be holding conf.json open when first pass runs.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { execSync } = await import('node:child_process')
      execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 38271 -State Listen -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"`, { stdio: 'ignore', shell: true })
    } catch {}
    await sleep(800)
  }
  // final cleanup pass — old detached server is fully dead now
  for (const f of ['nantianmen-conf.json', 'nantianmen.db', 'nantianmen.db-wal', 'nantianmen.db-shm']) {
    try { fs.rmSync(path.join(SERVER_DIR, f), { force: true }) } catch {}
  }
  await sleep(300)

  // ponytail: detached + unref'd; listeners should NOT block CLI calls.
  const server = spawn('node', ['index.js'], { cwd: SERVER_DIR, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  server.unref()

  try {
    await waitForHealth()
    pass('server up')

    step('1) status (pre-setup)')
    {
      const r = await cli(['status'])
      if (r.code !== 0) fail(`status exit ${r.code}: ${r.err}`)
      console.log(r.out)
      if (!r.out.includes('initialized')) fail(`expected initialized in output`)
      pass(`status returned: ${r.out.trim()}`)
    }

    step('2) setup (interactive, fed via stdin)')
    {
      const input = [
        '0.0.0.0',
        '38271',
        '1',
        './nantianmen.db',
        'secret-pass-1',
        'secret-pass-1',
        '', // trailing newline
      ].join('\n')
      const r = await cli(['setup'], { stdin: input })
      if (r.code !== 0) fail(`setup exit ${r.code}: ${r.err}`)
      console.log(r.out)
      pass('setup returned success')
    }

    // ponytail: brief pause so server re-reads conf + flips to db-backed mode
    await sleep(500)

    step('3) status (post-setup)')
    {
      const r = await cli(['status'])
      if (r.code !== 0) fail(`status exit ${r.code}`)
      console.log(r.out)
      if (!r.out.includes('"initialized":true')) fail(`expected initialized=true`)
      pass('status now reflects initialized=true')
    }

    step('4) health (validates password reaches server correctly)')
    {
      const r = await cli(['health'])
      if (r.code !== 0) fail(`health exit ${r.code}: ${r.err}`)
      console.log(r.out)
      if (!r.out.includes('"status": "ok"')) fail(`health not ok: ${r.out}`)
      pass('health 200 ok')
    }

    step('5) wrong password rejected')
    {
      const r = await cli(['-P', 'wrong-password', 'settings'])
      if (r.code === 0) fail(`wrong password should fail: ${r.out}`)
      pass(`wrong password rejected (exit ${r.code})`)
    }

    step('6) settings (admin auth via header works)')
    {
      const r = await cli(['settings'])
      if (r.code !== 0) fail(`settings exit ${r.code}: ${r.err}`)
      console.log(r.out)
      if (!r.out.includes('"host": "0.0.0.0"')) fail(`settings didn't reflect setup`)
      pass('settings returned host=0.0.0.0')
    }

    step('7) login re-saves md5 to config.json')
    {
      const r = await cli(['login'], { stdin: 'secret-pass-1\n' })
      if (r.code !== 0) fail(`login exit ${r.code}: ${r.err}`)
      console.log(r.out)
      pass('login succeeded')
    }

    step('8) password change')
    {
      const input = ['secret-pass-1', 'newpass-2', 'newpass-2', ''].join('\n')
      const r = await cli(['password'], { stdin: input })
      if (r.code !== 0) fail(`password change exit ${r.code}: ${r.err}`)
      console.log(r.out)
      pass('password change 200')
    }

    step('9) old password now fails (salt rotated)')
    {
      const r = await cli(['-P', 'secret-pass-1', 'settings'])
      if (r.code === 0) fail(`old password should fail after change: ${r.out}`)
      pass(`old password rejected (exit ${r.code})`)
    }

    step('10) new password works')
    {
      const r = await cli(['-P', 'newpass-2', 'settings'])
      if (r.code !== 0) fail(`new password should work: ${r.out} ${r.err}`)
      pass('new password accepted')
    }

    console.log('\n✓ ALL CLI TESTS PASSED')
  } finally {
    try { process.kill(server.pid, 'SIGTERM') } catch {}
    await sleep(300)
    try { process.kill(server.pid, 'SIGKILL') } catch {}
  }
}

main().catch(e => { console.error(e); process.exit(1) })
