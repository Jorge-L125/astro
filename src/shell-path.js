// En macOS, una app abierta desde el Finder o el Dock arranca con un PATH mínimo (/usr/bin:/bin…),
// sin lo que añaden ~/.zshrc o Homebrew. Claude Code y los comandos que lance (git, node, pnpm…)
// lo necesitan, así que se le pregunta al shell de login del usuario.
const { execFileSync } = require('child_process');

const MARK = '__ASTRO_PATH__';

function loginShellPath({ shell = process.env.SHELL || '/bin/zsh', run = execFileSync } = {}) {
  try {
    const out = run(shell, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], {
      encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = new RegExp(`${MARK}(.*?)${MARK}`).exec(out); // los .zshrc pueden imprimir cosas alrededor
    return m && m[1] ? m[1] : null;
  } catch {
    return null;
  }
}

// Une dos PATH sin repetir carpetas; las del actual van primero.
function mergePath(current, extra, sep = ':') {
  const seen = new Set();
  return [...String(current || '').split(sep), ...String(extra || '').split(sep)]
    .filter(d => d && !seen.has(d) && seen.add(d))
    .join(sep);
}

module.exports = { loginShellPath, mergePath };
