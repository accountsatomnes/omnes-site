const io = new IntersectionObserver((entries) => {
  for (const e of entries) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

/* Nav dropdowns: click-toggle (CSS handles hover) */
document.querySelectorAll('.nav-dd-toggle').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = btn.closest('.nav-dd');
    const wasOpen = dd.classList.contains('open');
    document.querySelectorAll('.nav-dd.open').forEach(d => d.classList.remove('open'));
    if (!wasOpen) dd.classList.add('open');
  });
});
document.addEventListener('click', () => {
  document.querySelectorAll('.nav-dd.open').forEach(d => d.classList.remove('open'));
});

/* Simple accordion: any .acc-item with a .acc-q toggles .open on the item */
document.querySelectorAll('.acc-q').forEach(q => {
  q.addEventListener('click', () => {
    q.closest('.acc-item').classList.toggle('open');
  });
});

/* Tabs: .tabs > .tab[data-target] toggles .active on tab and matching .tab-panel id */
document.querySelectorAll('.tabs').forEach(tabs => {
  const panels = tabs.parentElement.querySelectorAll(':scope > .tab-panels > .tab-panel');
  tabs.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.target;
      panels.forEach(p => p.classList.toggle('active', p.id === target));
    });
  });
});

/* Legal TOC active-section tracker: marks the TOC link for the section currently in view */
(() => {
  const toc = document.querySelector('.legal-toc');
  if (!toc) return;
  const links = toc.querySelectorAll('a[href^="#"]');
  if (!links.length) return;
  const map = new Map();
  links.forEach(a => {
    const id = a.getAttribute('href').slice(1);
    const target = document.getElementById(id);
    if (target) map.set(target, a);
  });
  if (!map.size) return;

  const setActive = (link) => {
    links.forEach(l => l.classList.remove('active'));
    if (link) link.classList.add('active');
  };

  const obs = new IntersectionObserver((entries) => {
    // Find entries that are intersecting; pick the topmost one
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible.length) {
      setActive(map.get(visible[0].target));
    }
  }, { rootMargin: '-10% 0px -70% 0px', threshold: 0 });

  map.forEach((_, target) => obs.observe(target));

  // Smooth scroll on click
  links.forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + id);
    });
  });
})();

/* Sub-nav active-section tracker (OMN-style sticky in-page nav) */
(() => {
  const subnav = document.querySelector('.subnav');
  if (!subnav) return;
  const links = subnav.querySelectorAll('a[href^="#"]');
  if (!links.length) return;
  const map = new Map();
  links.forEach(a => {
    const id = a.getAttribute('href').slice(1);
    const target = document.getElementById(id);
    if (target) map.set(target, a);
  });
  if (!map.size) return;
  const setActive = (link) => {
    links.forEach(l => l.classList.remove('active'));
    if (link) link.classList.add('active');
  };
  const obs = new IntersectionObserver((entries) => {
    const visible = entries.filter(e => e.isIntersecting).sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible.length) setActive(map.get(visible[0].target));
  }, { rootMargin: '-15% 0px -70% 0px', threshold: 0 });
  map.forEach((_, target) => obs.observe(target));
  links.forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      const offset = subnav.getBoundingClientRect().height;
      const top = target.getBoundingClientRect().top + window.scrollY - offset - 8;
      window.scrollTo({ top, behavior: 'smooth' });
      history.replaceState(null, '', '#' + id);
    });
  });
})();

/* OMN page tabs: click a tab → show only that panel; supports /omn/#documents deep links */
(() => {
  const tabs = document.querySelectorAll('.omn-tab');
  const panels = document.querySelectorAll('.omn-panel');
  if (!tabs.length) return;

  const activate = (key, updateHash) => {
    if (!key) return;
    let matched = false;
    tabs.forEach(t => {
      const on = t.dataset.tab === key;
      t.classList.toggle('active', on);
      if (on) matched = true;
    });
    panels.forEach(p => p.classList.toggle('active', p.id === 'panel-' + key));
    if (matched && updateHash) history.replaceState(null, '', '#' + key);
  };

  tabs.forEach(t => {
    t.addEventListener('click', (e) => {
      e.preventDefault();
      activate(t.dataset.tab, true);
      // Scroll into view if tab is below the fold
      const tabsBar = document.querySelector('.omn-tabs-bar');
      const barTop = tabsBar.getBoundingClientRect().top;
      if (barTop < 0) {
        window.scrollTo({ top: window.scrollY + barTop, behavior: 'smooth' });
      }
    });
  });

  // Honor hash on initial load (e.g., /omn/#fees)
  const initial = (location.hash || '').replace('#', '');
  const validKeys = Array.from(tabs).map(t => t.dataset.tab);
  if (initial && validKeys.includes(initial)) activate(initial, false);

  window.addEventListener('hashchange', () => {
    const key = (location.hash || '').replace('#', '');
    if (validKeys.includes(key)) activate(key, false);
  });
})();

/* Hero scroll-takeover: expand the feature card to full-bleed as it scrolls into view */
(() => {
  const card = document.querySelector('.cb-takeover-card');
  if (!card) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const top = card.getBoundingClientRect().top;
    const start = vh * 0.46;
    const end = vh * 0.02;
    let p = (start - top) / (start - end);
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    card.style.setProperty('--p', p.toFixed(4));
  };
  const onScroll = () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  };
  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', update);
})();


/* Access Gate (terms of access modal) */
(function(){
  function init(){
    if (sessionStorage.getItem('omnes_access_agreed')) {
      var g = document.getElementById('accessGate'); if (g) g.style.display = 'none';
      return;
    }
    var btn = document.getElementById('btnAgree');
    if (!btn) return;
    btn.disabled = false;
    btn.classList.add('enabled');
    btn.addEventListener('click', function(){
      sessionStorage.setItem('omnes_access_agreed', '1');
      var g = document.getElementById('accessGate'); if (g) g.style.display = 'none';
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
