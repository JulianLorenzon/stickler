package com.julianlorenzon.stickler;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Pictures shared to Stickler from other apps through Android's share menu (e.g. a screenshot of the Wi-Fi share
 * QR code). The picture waits here until the web side takes it: right at startup when the share launched the app,
 * or after the "shared" event when the app was already running.
 */
@CapacitorPlugin(name = "SharedImage")
public class SharedImagePlugin extends Plugin {

    /** Bigger pictures are ignored; screenshots are a few MB at most */
    private static final int MAX_BYTES = 25 * 1024 * 1024;

    private JSObject pending;

    @Override
    public void load() {
        if (receive(getActivity().getIntent())) {
            // Don't take the same picture again when the activity is recreated
            getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (receive(intent)) {
            notifyListeners("shared", new JSObject(), true);
        }
    }

    private boolean receive(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
        String type = intent.getType();
        if (type == null || !type.startsWith("image/")) return false;
        Uri uri = streamUri(intent);
        if (uri == null) return false;

        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) return false;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                if (out.size() > MAX_BYTES) {
                    Logger.warn("SharedImage", "Shared picture too big, ignored");
                    return false;
                }
            }
            String mime = getContext().getContentResolver().getType(uri);
            JSObject image = new JSObject();
            image.put("mimeType", mime != null && mime.startsWith("image/") ? mime : type);
            image.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            pending = image;
            return true;
        } catch (IOException | SecurityException e) {
            Logger.error("SharedImage", "Couldn't read the shared picture", e);
            return false;
        }
    }

    /** EXTRA_STREAM, or the first ClipData item that some apps send instead */
    @SuppressWarnings("deprecation")
    private static Uri streamUri(Intent intent) {
        Uri uri = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
            : intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) {
            ClipData clip = intent.getClipData();
            if (clip != null && clip.getItemCount() > 0) uri = clip.getItemAt(0).getUri();
        }
        return uri;
    }

    /** The waiting picture as { image: { mimeType, data (base64) } }, or {} when there is none */
    @PluginMethod
    public void take(PluginCall call) {
        JSObject ret = new JSObject();
        if (pending != null) {
            ret.put("image", pending);
            pending = null;
        }
        call.resolve(ret);
    }
}
