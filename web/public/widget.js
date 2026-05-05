(function() {
  'use strict';

  var API = 'https://api.rentthisapp.com';
  var APP = 'https://app.rentthisapp.com';

  // Find our script tag and read config
  var scripts = document.querySelectorAll('script[data-slug]');
  var scriptTag = scripts[scripts.length - 1];
  if (!scriptTag) { console.error('[ServiceOS] Missing data-slug attribute'); return; }

  var slug = scriptTag.getAttribute('data-slug');
  if (!slug) { console.error('[ServiceOS] data-slug is empty'); return; }

  var position = scriptTag.getAttribute('data-position') || 'bottom-right';
  var buttonText = scriptTag.getAttribute('data-button-text') || 'Book Now';
  var autoOpen = scriptTag.getAttribute('data-auto-open') === 'true';

  var config = null;
  var btn = null;
  var overlay = null;
  var savedOverflow = '';

  // Fetch config
  fetch(API + '/public/tenant/' + slug + '/widget-config')
    .then(function(r) { return r.ok ? r.json() : Promise.reject('Not found'); })
    .then(function(data) { config = data; init(); })
    .catch(function(e) { console.error('[ServiceOS] Widget config failed:', e); });

  function init() {
    var color = (config && config.primaryColor) || '#22C55E';

    // Create floating button
    btn = document.createElement('button');
    btn.id = 'serviceos-widget-btn';
    btn.textContent = buttonText;
    btn.setAttribute('aria-label', 'Open booking widget');
    var btnStyle = 'position:fixed;z-index:99999;' +
      (position === 'bottom-left' ? 'left:24px;' : 'right:24px;') +
      'bottom:24px;' +
      'background:' + color + ';' +
      'color:#000;border:none;cursor:pointer;' +
      'padding:14px 28px;border-radius:50px;' +
      'font-size:16px;font-weight:600;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 4px 14px rgba(0,0,0,0.15);' +
      'transition:transform 0.15s ease,box-shadow 0.15s ease;';
    btn.style.cssText = btnStyle;
    btn.onmouseenter = function() { btn.style.transform = 'scale(1.05)'; btn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.2)'; };
    btn.onmouseleave = function() { btn.style.transform = 'scale(1)'; btn.style.boxShadow = '0 4px 14px rgba(0,0,0,0.15)'; };
    btn.onclick = openModal;
    document.body.appendChild(btn);

    if (autoOpen) openModal();
  }

  function openModal() {
    if (overlay) return;
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    overlay = document.createElement('div');
    overlay.id = 'serviceos-widget-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;' +
      'background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;' +
      'animation:serviceos-fadein 0.2s ease;';
    overlay.onclick = function(e) { if (e.target === overlay) closeModal(); };

    var modal = document.createElement('div');
    modal.id = 'serviceos-widget-modal';
    modal.style.cssText = 'position:relative;width:90%;max-width:520px;height:85vh;max-height:800px;' +
      'background:#000;border:1px solid #3A3A3A;border-radius:20px;overflow:hidden;' +
      'box-shadow:0 25px 60px rgba(0,0,0,0.5);' +
      'animation:serviceos-scalein 0.2s ease;';

    var closeBtn = document.createElement('button');
    closeBtn.id = 'serviceos-widget-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.style.cssText = 'position:absolute;top:12px;right:12px;z-index:10;' +
      'width:32px;height:32px;border-radius:50%;border:none;cursor:pointer;' +
      'background:rgba(255,255,255,0.08);color:#FFFFFF;font-size:20px;line-height:32px;text-align:center;' +
      'font-family:sans-serif;transition:background 0.15s;';
    closeBtn.onmouseenter = function() { closeBtn.style.background = 'rgba(255,255,255,0.15)'; };
    closeBtn.onmouseleave = function() { closeBtn.style.background = 'rgba(255,255,255,0.08)'; };
    closeBtn.onclick = closeModal;

    var iframe = document.createElement('iframe');
    iframe.id = 'serviceos-widget-iframe';
    iframe.src = APP + '/site/book?slug=' + encodeURIComponent(slug) + '&embed=true';
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.setAttribute('allow', 'geolocation');

    modal.appendChild(closeBtn);
    modal.appendChild(iframe);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Inject keyframe animation (only once)
    if (!document.getElementById('serviceos-widget-styles')) {
      var style = document.createElement('style');
      style.id = 'serviceos-widget-styles';
      style.textContent =
        '@keyframes serviceos-fadein{from{opacity:0}to{opacity:1}}' +
        '@keyframes serviceos-scalein{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}';
      document.head.appendChild(style);
    }

    // Hide floating button while modal is open
    if (btn) btn.style.display = 'none';
  }

  function closeModal() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    document.body.style.overflow = savedOverflow;
    if (btn) btn.style.display = '';
  }

  // Listen for messages from iframe
  window.addEventListener('message', function(e) {
    // Only accept messages from our app
    if (e.origin !== APP) return;
    var data = e.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'serviceos-booking-complete') {
      if (typeof window.serviceosOnBooking === 'function') {
        window.serviceosOnBooking(data.booking || data);
      }
    }
    if (data.type === 'serviceos-close') {
      closeModal();
    }
  });

  // ESC key closes modal
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && overlay) closeModal();
  });

  // Expose global API
  window.ServiceOS = { open: openModal, close: closeModal };
})();
