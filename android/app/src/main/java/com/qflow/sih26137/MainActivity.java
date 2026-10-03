package com.qflow.sih26137;


import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(QFlowNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
