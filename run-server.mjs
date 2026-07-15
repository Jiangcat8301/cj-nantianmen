// ponytail: one-shot server launcher script
import { spawn } from 'child_process';
import { join } from 'path';

const server = spawn('node', [
  join(import.meta.dirname, 'server', 'index.js'),
  '-c', process.env.APPDATA + '/cj-nantianmen/nantianmen-conf.json',
  '-D', process.env.APPDATA + '/cj-nantianmen/nantianmen.db'
], {
  cwd: import.meta.dirname,
  stdio: 'inherit',
  env: { ...process.env, NANTIANMEN_LOCAL_MODE: '1' }
});

server.on('exit', code => console.log('[server exited', code, ']'));
process.on('SIGINT', () => { server.kill(); process.exit(); });
