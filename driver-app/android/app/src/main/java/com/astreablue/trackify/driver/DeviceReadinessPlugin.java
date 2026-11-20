package com.astreablue.trackify.driver;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Read-only Android readiness checks for the Driver App.
 *
 * This never reads a GPS fix, trip, account, or credential. It reports only
 * whether Android will allow the capabilities the driver has already chosen
 * to use, and opens the relevant system settings when asked.
 */
@CapacitorPlugin(name = "DeviceReadiness")
public class DeviceReadinessPlugin extends Plugin {
    @PluginMethod
    public void getStatus(PluginCall call) {
        Context context = getContext();
        boolean foregroundLocation = has(context, Manifest.permission.ACCESS_FINE_LOCATION)
            || has(context, Manifest.permission.ACCESS_COARSE_LOCATION);
        boolean backgroundLocation = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            ? foregroundLocation
            : has(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION);

        boolean notificationPermission = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || has(context, Manifest.permission.POST_NOTIFICATIONS);
        boolean notifications = notificationPermission
            && NotificationManagerCompat.from(context).areNotificationsEnabled();

        String batteryOptimization = "not_applicable";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            batteryOptimization = power != null
                && power.isIgnoringBatteryOptimizations(context.getPackageName())
                    ? "unrestricted"
                    : "optimized";
        }

        JSObject result = new JSObject();
        result.put("foregroundLocation", foregroundLocation ? "granted" : "denied");
        result.put("backgroundLocation", backgroundLocation ? "granted" : "denied");
        result.put("notifications", notifications ? "granted" : "denied");
        result.put("batteryOptimization", batteryOptimization);
        call.resolve(result);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        open(call, new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getContext().getPackageName())
        ));
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        // Open Android's own optimization list. Requesting an exemption inside
        // the app needs a restricted Play permission; the driver stays in
        // control here and Trackify remains store-compliant.
        open(call, new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
    }

    private boolean has(Context context, String permission) {
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void open(PluginCall call, Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Android settings could not be opened.", error);
        }
    }
}
