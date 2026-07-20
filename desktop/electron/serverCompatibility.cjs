const path = require('path')

const CLIENT_VERSION = require(path.join(__dirname, '..', 'package.json')).version

function evaluateServerHealth(statusCode, body) {
  const online = statusCode === 200 && body?.status === 'ok' && body?.service === 'nantianmen'
  const serverVersion = body?.version || null
  return {
    online,
    compatible: online && serverVersion === CLIENT_VERSION,
    clientVersion: CLIENT_VERSION,
    serverVersion,
    activeRequests: Number(body?.active_requests) || 0,
  }
}

function versionMismatchMessage(status) {
  return `Server/Client version mismatch: Desktop ${status.clientVersion}, Server ${status.serverVersion || 'unknown'}. Stop the existing Server and start the matching version.`
}

module.exports = { CLIENT_VERSION, evaluateServerHealth, versionMismatchMessage }
