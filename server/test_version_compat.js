#!/usr/bin/env node
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import Fastify from 'fastify'
import llmRoutes from './routes/llm.js'
import serverPackage from './package.json' with { type: 'json' }

let failed = false
async function check(name, fn) {
  try { await fn(); console.log(`✓ ${name}`) }
  catch (e) { failed = true; console.error(`✗ ${name}: ${e.message}`) }
}

await check('health publishes the server version', async () => {
  const app = Fastify()
  try {
    await app.register(llmRoutes)
    const response = await app.inject({ method: 'GET', url: '/v1/health' })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().version, serverPackage.version)
  } finally { await app.close() }
})

await check('desktop rejects a mismatched server with both versions in the message', async () => {
  const compatibility = await import('../desktop/electron/serverCompatibility.cjs')
  const { evaluateServerHealth, versionMismatchMessage, CLIENT_VERSION } = compatibility.default
  const status = evaluateServerHealth(200, { status: 'ok', service: 'nantianmen', version: '9.9.9' })
  assert.equal(status.online, true)
  assert.equal(status.compatible, false)
  assert.equal(evaluateServerHealth(200, { status: 'ok', service: 'nantianmen' }).compatible, false)
  assert.equal(evaluateServerHealth(200, { status: 'ok', service: 'nantianmen', version: CLIENT_VERSION }).compatible, true)
  const message = versionMismatchMessage(status)
  assert.match(message, new RegExp(CLIENT_VERSION.replaceAll('.', '\\.')))
  assert.match(message, /9\.9\.9/)
})

await check('CLI refuses a mismatched server with an explicit message', async () => {
  const fake = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', service: 'nantianmen', version: '9.9.9' }))
  })
  await new Promise((resolve, reject) => fake.listen(38299, '127.0.0.1', resolve).once('error', reject))
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['../cli/index.js', '--host', '127.0.0.1', '--port', '38299', 'health'], {
        cwd: new URL('.', import.meta.url),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = '', stderr = ''
      child.stdout.on('data', d => stdout += d)
      child.stderr.on('data', d => stderr += d)
      child.on('error', reject)
      child.on('close', code => resolve({ code, output: stdout + stderr }))
    })
    assert.notEqual(result.code, 0, result.output)
    assert.match(result.output, /version mismatch/i)
    assert.match(result.output, /9\.9\.9/)
    assert.match(result.output, new RegExp(serverPackage.version.replaceAll('.', '\\.')))
  } finally { await new Promise(resolve => fake.close(resolve)) }
})

if (failed) process.exit(1)
console.log('\nALL VERSION COMPATIBILITY TESTS PASSED')
