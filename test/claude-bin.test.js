const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveClaude, scriptFromShim } = require('../src/claude-bin');

// Estas pruebas crean archivos reales y los buscan con reglas de rutas de Windows.
const onWindows = { skip: process.platform !== 'win32' && 'solo en Windows' };

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-bin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Shim que genera npm en Windows para paquetes con "bin".
const NPM_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*
`;

function npmInstall(dir) {
  const cli = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, '');
  fs.writeFileSync(path.join(dir, 'claude.cmd'), NPM_SHIM);
  return cli;
}

test('en macOS/Linux, si no lo encuentra, deja el nombre para que el error sea ENOENT', t => {
  const r = resolveClaude('claude', { platform: 'darwin', env: { PATH: '' }, home: tmpDir(t) });
  assert.deepEqual(r, { command: 'claude', args: [], env: {} });
});

test('en macOS encuentra claude fuera del PATH (app abierta desde el Finder)', t => {
  const home = tmpDir(t);
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude'), '');
  const r = resolveClaude('claude', { platform: 'darwin', env: { PATH: '' }, home });
  assert.equal(r.command, path.join(bin, 'claude'));
  assert.deepEqual(r.args, []);
});

test('en macOS un claude de npm (enlace a cli.js) se ejecuta con el Node de Electron', t => {
  const home = tmpDir(t);
  const cli = path.join(home, 'lib', 'cli.js');
  const bin = path.join(home, 'bin');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.mkdirSync(bin);
  fs.writeFileSync(cli, '#!/usr/bin/env node');
  try { fs.symlinkSync(cli, path.join(bin, 'claude')); } catch { return t.skip('el sistema no permite crear enlaces'); }
  const r = resolveClaude('claude', { platform: 'darwin', env: { PATH: bin }, home, nodePath: '/Electron' });
  assert.equal(r.command, '/Electron');
  assert.equal(fs.realpathSync(r.args[0]), fs.realpathSync(cli));
  assert.equal(r.env.ELECTRON_RUN_AS_NODE, '1');
});

test('un cli.js se ejecuta con el Node de Electron', () => {
  const r = resolveClaude('/opt/claude/cli.js', { platform: 'linux', nodePath: '/electron' });
  assert.deepEqual(r, { command: '/electron', args: ['/opt/claude/cli.js'], env: { ELECTRON_RUN_AS_NODE: '1' } });
});

test('en Windows prefiere claude.exe del PATH', onWindows, t => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'claude.exe'), '');
  fs.writeFileSync(path.join(dir, 'claude.cmd'), NPM_SHIM);
  const r = resolveClaude('claude', { platform: 'win32', env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' } });
  assert.equal(r.command.toLowerCase(), path.join(dir, 'claude.exe').toLowerCase());
  assert.deepEqual(r.args, []);
});

test('en Windows un claude.cmd de npm se lanza sin shell vía su cli.js', onWindows, t => {
  const dir = tmpDir(t);
  const cli = npmInstall(dir);
  const r = resolveClaude('claude', { platform: 'win32', env: { PATH: dir, PATHEXT: '.EXE;.CMD' }, nodePath: 'electron.exe' });
  assert.equal(r.command, 'electron.exe');
  assert.equal(path.resolve(r.args[0]).toLowerCase(), path.resolve(cli).toLowerCase());
  assert.equal(r.env.ELECTRON_RUN_AS_NODE, '1');
});

test('un .cmd que no se entiende da un error claro', onWindows, t => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'claude.cmd'), '@echo off\r\nalgo raro %*\r\n');
  assert.throws(() => resolveClaude('claude', { platform: 'win32', env: { PATH: dir, PATHEXT: '.CMD' } }), { code: 'not_found' });
});

test('si no está en el PATH devuelve el nombre para que el error sea ENOENT', () => {
  const r = resolveClaude('claude', { platform: 'win32', env: { PATH: '', PATHEXT: '.EXE' } });
  assert.equal(r.command, 'claude');
});

test('scriptFromShim ignora archivos sin ruta a un .js', t => {
  const dir = tmpDir(t);
  const f = path.join(dir, 'x.cmd');
  fs.writeFileSync(f, '@echo hola');
  assert.equal(scriptFromShim(f), null);
  assert.equal(scriptFromShim(path.join(dir, 'no-existe.cmd')), null);
});
