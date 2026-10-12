/*
 * dc-lite.js — runtime minimal (vanilla, sans dépendance) pour les pages exportées.
 *
 * Chaque page contient une classe `Component extends DCLogic` (état + renderVals()).
 * Le HTML est déjà rendu dans son état initial ; ce script ne fait que :
 *   - data-dc-tpl-<attr>="... {{ clé }} ..."  → recalcule l'attribut à chaque setState()
 *   - data-dc-on="click:nomFonction"            → branche l'événement sur renderVals().nomFonction
 *   - data-dc-ref="nomFonction"                 → appelle renderVals().nomFonction(element) au montage
 *
 * Pour une intégration dans un framework (React, Vue, Astro…), ces attributs
 * indiquent exactement quelles valeurs sont dynamiques et quels handlers brancher.
 */
(function () {
  'use strict';

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) {
      const p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
      this.state = Object.assign({}, this.state, p);
      if (this.__render) this.__render();
    }
    renderVals() { return {}; }
  }

  function lookup(vals, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), vals);
  }

  function mount(Comp, props) {
    const root = document.querySelector('[data-dc-root]') || document.body;
    const inst = new Comp(props || {});
    let vals = inst.renderVals();

    const bound = [];
    root.querySelectorAll('*').forEach((el) => {
      for (const a of Array.from(el.attributes)) {
        if (a.name.indexOf('data-dc-tpl-') === 0) bound.push([el, a.name.slice(12), a.value]);
      }
    });

    inst.__render = () => {
      vals = inst.renderVals();
      for (const [el, name, tpl] of bound) {
        const v = tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
          const r = lookup(vals, k); return r == null ? '' : String(r);
        });
        if (el.getAttribute(name) !== v) el.setAttribute(name, v);
      }
    };

    root.querySelectorAll('[data-dc-on]').forEach((el) => {
      el.getAttribute('data-dc-on').split(/\s*;\s*/).forEach((pair) => {
        const [evt, fn] = pair.split(':');
        if (!evt || !fn) return;
        el.addEventListener(evt, (e) => { const f = lookup(vals, fn); if (typeof f === 'function') f(e); });
      });
    });

    inst.__render();
    root.querySelectorAll('[data-dc-ref]').forEach((el) => {
      const f = lookup(vals, el.getAttribute('data-dc-ref'));
      if (typeof f === 'function') f(el);
    });
    if (typeof inst.componentDidMount === 'function') inst.componentDidMount();
    return inst;
  }

  window.DCLogic = DCLogic;
  window.DCLite = { mount };
})();
