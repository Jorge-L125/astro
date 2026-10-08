// Atajos de teclado escritos como los muestra cada sistema: "Ctrl+Shift+Espacio" o "⌘⇧Espacio".
export const isMac = (platform = globalThis.navigator?.platform || '') => /mac/i.test(platform);

const NAMES = {
  commandorcontrol: ['Ctrl', '⌘'], cmdorctrl: ['Ctrl', '⌘'], command: ['Cmd', '⌘'], cmd: ['Cmd', '⌘'],
  control: ['Ctrl', '⌃'], ctrl: ['Ctrl', '⌃'], alt: ['Alt', '⌥'], option: ['Alt', '⌥'],
  shift: ['Shift', '⇧'], super: ['Win', '⌘'], space: ['Espacio', 'Espacio'],
};

export function formatAccel(accel, mac = isMac()) {
  const parts = String(accel).split('+').map(k => (NAMES[k.toLowerCase()] || [k, k])[mac ? 1 : 0]);
  // En macOS los símbolos van pegados: "⌘⇧Espacio".
  return parts.join(mac ? '' : '+');
}

// "Alt+N" o "⌥N": el modificador de los atajos de sesión.
export const altKey = (key, mac = isMac()) => (mac ? '⌥' : 'Alt+') + key;
