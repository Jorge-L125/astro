// Ajustes de OpenCode en el panel lateral: dónde corre el servidor, carpetas compartidas, modelo por
// defecto, proveedor compatible con OpenAI y GitHub Copilot. La contraseña y la clave se escriben aquí
// y viajan al proceso principal, que las guarda cifradas; nunca vuelven a la interfaz.

let current = null; // { copilot(ev) } del formulario abierto

const FORM = `
<article class="sheet ocform">
  <p class="label">Servidor de OpenCode</p>
  <div class="seg" data-f="mode"><button type="button" data-v="local">En este equipo</button><button type="button" data-v="remote">Otro servidor</button></div>
  <small class="hint" data-local>Astro ejecuta OpenCode en este equipo cuando lo necesita (hace falta tenerlo instalado; probado con la 1.19 y la 2.0).</small>
  <small class="hint" data-remote>Un servidor de OpenCode que ya está en marcha, por ejemplo en Docker o en otro equipo.</small>
  <label data-remote>Dirección<input name="url" type="url" spellcheck="false" placeholder="http://127.0.0.1:4096"></label>
  <label data-remote>Contraseña del servidor <button type="button" class="more" data-a="clearpw" hidden>Quitar la guardada</button><input name="password" type="password" autocomplete="off"></label>
  <label data-remote>Carpetas compartidas<small>Una por línea: carpeta de este equipo =&gt; la misma carpeta en el servidor</small><textarea name="pathMap" rows="2" spellcheck="false" placeholder="C:\\Users\\yo\\proyectos => /work"></textarea></label>
</article>
<article class="sheet ocform">
  <p class="label">Modelo por defecto</p>
  <select name="defaultModel" aria-label="Modelo por defecto"></select>
  <small class="hint" data-models>Conecta con el servidor para ver los modelos.</small>
</article>
<article class="sheet ocform" data-v1only>
  <p class="label">Proveedor compatible con OpenAI</p>
  <small class="hint">Cualquier servicio con la API de OpenAI: su URL base, los modelos que quieres usar y tu clave.</small>
  <label>Nombre<input name="oname" placeholder="Mi proveedor"></label>
  <label>URL base<input name="obase" type="url" spellcheck="false" placeholder="https://api.ejemplo.com/v1"></label>
  <label>Modelos<small>Separados por comas</small><input name="omodels" spellcheck="false" placeholder="gpt-4.1, mi-modelo"></label>
  <label>Clave de API <button type="button" class="more" data-a="clearkey" hidden>Quitar la guardada</button><input name="okey" type="password" autocomplete="off"></label>
</article>
<article class="sheet ocform" data-v1only>
  <p class="label">GitHub Copilot</p>
  <small class="hint">Se abre GitHub en el navegador; escribe allí el código que aparece aquí. Usa tu suscripción de Copilot.</small>
  <button type="button" class="opt" data-a="copilot">Conectar Copilot</button>
  <p class="ocmsg" data-copilot aria-live="polite"></p>
</article>
<article class="sheet ocform">
  <p class="ocmsg" data-status aria-live="polite"></p>
  <button type="button" class="btn" data-a="save">Guardar y probar</button>
</article>
<article class="sheet ocform">
  <p class="label">Bueno saber</p>
  <ul>
    <li>OpenCode no puede usar tu suscripción de Claude (Pro o Max): con ella, sigue usando Claude Code.</li>
    <li>Los modelos gratis de OpenCode pueden tardar o guardar lo que les envías para mejorar sus servicios: no los uses con código privado.</li>
    <li>Astro está probado con OpenCode 1.19 y 2.0.</li>
    <li data-v2only hidden>Con OpenCode 2.x los proveedores (incluidos un servicio compatible con OpenAI y GitHub Copilot) se conectan desde OpenCode con «opencode auth login»; sus modelos aparecen aquí.</li>
  </ul>
</article>`;

/** Formulario de ajustes de OpenCode. onSaved(ajustes públicos) tras guardar. */
export function opencodeForm(api, { onSaved } = {}) {
  const el = document.createElement('div');
  el.innerHTML = FORM;
  const q = sel => el.querySelector(sel);
  const field = name => el.querySelector(`[name="${name}"]`);
  let prefs = null, mode = 'local';

  const showMode = () => {
    q('[data-f="mode"]').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === mode)));
    el.querySelectorAll('[data-remote]').forEach(x => { x.hidden = mode !== 'remote'; });
    el.querySelectorAll('[data-local]').forEach(x => { x.hidden = mode !== 'local'; });
  };
  q('[data-f="mode"]').querySelectorAll('button').forEach(b => { b.onclick = () => { mode = b.dataset.v; showMode(); }; });

  const fill = p => {
    prefs = p;
    mode = p.mode;
    field('url').value = p.url || '';
    field('pathMap').value = (p.pathMap || []).map(m => `${m.host} => ${m.server}`).join('\n');
    field('oname').value = p.openai.name || '';
    field('obase').value = p.openai.baseURL || '';
    field('omodels').value = (p.openai.models || []).join(', ');
    for (const [name, has, clear] of [['password', p.hasPassword, 'clearpw'], ['okey', p.hasOpenaiKey, 'clearkey']]) {
      const input = field(name);
      input.value = '';
      input.disabled = !p.canEncrypt;
      input.placeholder = !p.canEncrypt ? 'Este equipo no permite guardarla cifrada' : has ? 'Guardada · escribe otra para cambiarla' : 'Opcional';
      q(`[data-a="${clear}"]`).hidden = !has;
    }
    showMode();
  };

  const loadModels = async () => {
    const sel = field('defaultModel');
    const r = await api.opencodeModels().catch(e => ({ ok: false, message: e.message, items: [] }));
    sel.innerHTML = '';
    const items = r.items.slice();
    if (prefs && !items.some(m => m.id === prefs.defaultModel)) items.unshift({ id: prefs.defaultModel, name: prefs.defaultModel, provider: 'no conectado' });
    for (const m of items) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = `${m.provider} · ${m.name}${m.free ? ' (gratis)' : ''}`;
      sel.append(o);
    }
    if (prefs) sel.value = prefs.defaultModel;
    q('[data-models]').textContent = r.ok ? 'Las sesiones nuevas con OpenCode empiezan con este modelo; lo puedes cambiar junto a la carpeta.' : 'No pude leer los modelos: ' + (r.message || 'OpenCode no responde.');
  };

  const status = async () => {
    const out = q('[data-status]');
    out.textContent = 'Probando la conexión…';
    const r = await api.opencodeStatus().catch(e => ({ ok: false, message: e.message }));
    out.textContent = r.ok
      ? `Conectado · OpenCode ${r.version}${r.supported ? '' : ' (Astro está probado con la 1.19 y la 2.0: esta versión puede fallar)'}`
      : 'Sin conexión: ' + (r.message || 'OpenCode no responde.');
    out.classList.toggle('err', !r.ok);
    // Con 2.x los proveedores se conectan desde OpenCode: esas dos tarjetas no valen.
    const v2 = !!(r.ok && r.api === 'v2');
    el.querySelectorAll('[data-v1only]').forEach(x => { x.hidden = v2; });
    el.querySelectorAll('[data-v2only]').forEach(x => { x.hidden = !v2; });
    if (r.ok) loadModels();
  };

  const save = async (extra = {}) => {
    const input = {
      mode,
      url: field('url').value,
      pathMap: field('pathMap').value.split('\n').map(l => l.split('=>')).filter(p => p.length === 2).map(([host, server]) => ({ host: host.trim(), server: server.trim() })),
      openai: { name: field('oname').value, baseURL: field('obase').value, models: field('omodels').value.split(',') },
      ...extra,
    };
    if (field('defaultModel').value) input.defaultModel = field('defaultModel').value;
    if (field('password').value) input.password = field('password').value;
    if (field('okey').value) input.openaiKey = field('okey').value;
    const p = await api.opencodeSave(input);
    fill(p);
    if (onSaved) onSaved(p);
    status();
  };
  q('[data-a="save"]').onclick = () => save();
  q('[data-a="clearpw"]').onclick = () => save({ password: '' });
  q('[data-a="clearkey"]').onclick = () => save({ openaiKey: '' });

  const copilotMsg = q('[data-copilot]');
  q('[data-a="copilot"]').onclick = async () => {
    copilotMsg.textContent = 'Pidiendo el código a GitHub…';
    const r = await api.opencodeCopilot().catch(e => ({ ok: false, message: e.message }));
    if (!r.ok) { copilotMsg.textContent = 'No pude empezar: ' + (r.message || 'OpenCode no responde.'); return; }
    const code = /([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(r.instructions || '');
    copilotMsg.textContent = code ? `Escribe este código en la página de GitHub que se abrió: ${code[1]}` : r.instructions || 'Sigue los pasos en la página de GitHub que se abrió.';
  };
  current = {
    copilot(ev) {
      if (!el.isConnected) return;
      copilotMsg.textContent = ev.ok ? 'Copilot conectado: sus modelos ya aparecen en la lista.' : 'Copilot no se conectó: ' + (ev.message || 'se canceló.');
      if (ev.ok) loadModels();
    },
  };

  api.opencodeSettings().then(p => { fill(p); loadModels(); status(); });
  return el;
}

/** Avisos del proceso principal sobre OpenCode (p. ej. Copilot ya autorizado). */
export function opencodeEvent(ev) {
  if (ev && ev.type === 'copilot' && current) current.copilot(ev);
}
