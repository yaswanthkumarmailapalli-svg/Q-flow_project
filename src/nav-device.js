/* =========================================================
   Q-FLOW — NAVIGATION: device helpers (voice output, keep screen awake)
   Plain browser script (global qflowNavDevice). Loaded on results.html.

   Android app: uses Q-FLOW's own native plugin "QFlowNative"
   (android/app/src/main/java/com/qflow/sih26137/QFlowNativePlugin.java):
     speak({ text }), stopSpeaking(), keepAwake({ on }), status() -> { tts }
   because Android's WebView has no speechSynthesis.
   Browsers: window.speechSynthesis (only if it has voices) and the Screen Wake Lock API.
   Voice is optional: setting "qflowNavVoice" ('on' default / 'off').
   ========================================================= */
const qflowNavDevice = (() => {
  const VOICE_KEY = 'qflowNavVoice';
  const cap = () => (typeof window !== 'undefined' ? window.Capacitor : null);
  const native = () => {
    const C = cap();
    return !!(C && (typeof C.isNativePlatform === 'function' ? C.isNativePlatform() : !!window.androidBridge));
  };
  // Calls the native plugin through whichever bridge API this Capacitor runtime exposes.
  function nativeCall(method, options) {
    const C = cap();
    if (!C) return Promise.reject(new Error('No native bridge'));
    if (C.Plugins && C.Plugins.QFlowNative && typeof C.Plugins.QFlowNative[method] === 'function') return C.Plugins.QFlowNative[method](options || {});
    if (typeof C.registerPlugin === 'function') { const p = C.registerPlugin('QFlowNative'); if (p && typeof p[method] === 'function') return p[method](options || {}); }
    if (typeof C.nativePromise === 'function') return C.nativePromise('QFlowNative', method, options || {});
    return Promise.reject(new Error('No native bridge'));
  }

  let webVoices = false;
  if (typeof window !== 'undefined' && window.speechSynthesis && typeof window.speechSynthesis.getVoices === 'function') {
    const check = () => { try { webVoices = window.speechSynthesis.getVoices().length > 0; } catch (e) { webVoices = false; } };
    check();
    if (window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener('voiceschanged', check);
  }
  let lastText = '', lastAt = 0, wakeLock = null, wantAwake = false;

  function voiceOn() { try { return localStorage.getItem(VOICE_KEY) !== 'off'; } catch (e) { return true; } }

  return {
    voiceOn,
    setVoice(on) { try { localStorage.setItem(VOICE_KEY, on ? 'on' : 'off'); } catch (e) { /* ignore */ } if (!on) this.stopSpeaking(); },
    voiceAvailable() { return native() || webVoices; },
    // Speaks one instruction (newest wins). The same text within 4 s is not repeated.
    speak(text) {
      if (!text || !voiceOn()) return;
      const t = Date.now();
      if (text === lastText && t - lastAt < 4000) return;
      lastText = text; lastAt = t;
      if (native()) { nativeCall('speak', { text }).catch(() => {}); return; }
      if (webVoices) {
        try {
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(text);
          u.rate = 1; u.lang = (navigator.language || 'en-IN');
          window.speechSynthesis.speak(u);
        } catch (e) { /* voice is optional */ }
      }
    },
    stopSpeaking() {
      if (native()) nativeCall('stopSpeaking').catch(() => {});
      else if (webVoices) try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    },
    // Keeps the screen on during navigation (so the WebView keeps receiving GPS updates).
    keepAwake(on) {
      wantAwake = on;
      if (native()) { nativeCall('keepAwake', { on }).catch(() => {}); return; }
      if (on && navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen').then((l) => { if (wantAwake) wakeLock = l; else l.release().catch(() => {}); }).catch(() => {});
      } else if (!on && wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    },
    // A browser wake lock is released when the page is hidden; take it again on return.
    resumeAwake() { if (wantAwake && !native() && !wakeLock) this.keepAwake(true); }
  };
})();
