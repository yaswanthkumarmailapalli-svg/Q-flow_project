package com.qflow.sih26137;

import android.speech.tts.TextToSpeech;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

/**
 * Q-FLOW native helpers for navigation (used by src/nav-device.js):
 *  - speak / stopSpeaking: Android TextToSpeech (the WebView has no speechSynthesis)
 *  - keepAwake: keeps the screen on while navigating (FLAG_KEEP_SCREEN_ON; no extra permission)
 *  - status: whether text-to-speech is ready
 * Registered in MainActivity (scripts/patch-android.js keeps that registration in place).
 */
@CapacitorPlugin(name = "QFlowNative")
public class QFlowNativePlugin extends Plugin {
    private TextToSpeech tts;
    private boolean ttsReady = false;

    @Override
    public void load() {
        tts = new TextToSpeech(getContext(), status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) {
                int r = tts.setLanguage(Locale.getDefault());
                if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                    r = tts.setLanguage(new Locale("en", "IN"));
                    if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(Locale.US);
                }
            }
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (tts == null || !ttsReady) { call.reject("Text-to-speech is not ready on this device"); return; }
        if (text == null || text.isEmpty()) { call.resolve(); return; }
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "qflow-" + System.currentTimeMillis());
        call.resolve();
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve();
    }

    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("tts", ttsReady);
        call.resolve(r);
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
    }
}
