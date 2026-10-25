import { useEffect, useState } from 'react';

// Chrome fires this once, often before React mounts — keep it for the banner
let deferredPrompt = null;
const listeners = new Set();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  listeners.forEach((fn) => fn());
});

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = () => /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || isIOS();

// Shown once every time the link is opened in the browser, until the app is installed.
export default function InstallPrompt() {
  const [, force] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const update = () => force((n) => n + 1);
    listeners.add(update);
    const done = () => setInstalled(true);
    window.addEventListener('appinstalled', done);
    return () => {
      listeners.delete(update);
      window.removeEventListener('appinstalled', done);
    };
  }, []);

  if (installed || hidden) return null;
  const canPrompt = !!deferredPrompt;
  // desktop: only offer when the browser can really install
  if (!canPrompt && !isMobile()) return null;

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') setInstalled(true);
    else setHidden(true);
  };

  return (
    <div className="install-banner" role="dialog" aria-label="App install karein">
      <img src="/icon-192.png" alt="" />
      <div className="install-text">
        <b>WA Sender app install karein</b>
        {canPrompt ? (
          <span>Phone ki home screen par app jaisa khulega — jaldi aur poori screen me.</span>
        ) : isIOS() ? (
          <span>
            Safari me neeche <b style={{ display: 'inline' }}>Share button</b> dabayein, phir <b style={{ display: 'inline' }}>"Add to Home Screen"</b>.
          </span>
        ) : (
          <span>
            Browser menu <b style={{ display: 'inline' }}>⋮</b> dabayein, phir <b style={{ display: 'inline' }}>"Install app"</b> ya{' '}
            <b style={{ display: 'inline' }}>"Add to Home screen"</b>.
          </span>
        )}
      </div>
      <div className="install-actions">
        {canPrompt && (
          <button className="primary" onClick={install}>
            Install
          </button>
        )}
        <button className="link-btn" onClick={() => setHidden(true)}>
          {canPrompt ? 'Baad me' : 'Theek hai'}
        </button>
      </div>
    </div>
  );
}
