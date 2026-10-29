package com.wifimedic.companion;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.RouteInfo;
import android.net.Uri;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.telephony.TelephonyManager;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.net.UnknownHostException;
import java.net.URLConnection;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    private static final int REQ_WIFI = 1001;
    private static final Pattern LOSS_PATTERN = Pattern.compile("(?i)(\\d+(?:\\.\\d+)?)%\\s*packet\\s*loss");
    private static final Pattern AVG_PATTERN = Pattern.compile("(?i)(?:rtt|round-trip)[^=]*=\\s*[\\d.]+/([\\d.]+)/");
    private static final Pattern TIME_PATTERN = Pattern.compile("(?i)time[=<]\\s*([\\d.]+)\\s*ms");

    private WebView webView;
    private WifiManager wifiManager;
    private ConnectivityManager connectivityManager;
    private final ExecutorService executor = Executors.newCachedThreadPool();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);

        boolean dark = isSystemDark();
        applySystemBars(dark);

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setBackgroundColor(Color.parseColor(dark ? "#151916" : "#F1EFE8"));
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (ActivityNotFoundException ignored) {
                    }
                    return true;
                }
                return false;
            }
        });
        webView.addJavascriptInterface(new Bridge(), "Android");
        webView.loadUrl("file:///android_asset/index.html");
    }

    private boolean isSystemDark() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    private void applySystemBars(boolean dark) {
        runOnUiThread(() -> {
            Window window = getWindow();
            int background = Color.parseColor(dark ? "#151916" : "#F1EFE8");
            window.setStatusBarColor(background);
            window.setNavigationBarColor(background);
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
            if (!dark) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                }
            }
            window.getDecorView().setSystemUiVisibility(flags);
            if (webView != null) {
                webView.setBackgroundColor(background);
            }
        });
    }

    private boolean hasWifiPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            return checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED;
        }
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestWifiPermission() {
        runOnUiThread(() -> {
            if (hasWifiPermission()) {
                if (webView != null) {
                    webView.evaluateJavascript("window.onAndroidPermission && window.onAndroidPermission(true);", null);
                }
                return;
            }
            List<String> perms = new ArrayList<>();
            if (Build.VERSION.SDK_INT >= 33) {
                perms.add(Manifest.permission.NEARBY_WIFI_DEVICES);
            } else {
                perms.add(Manifest.permission.ACCESS_FINE_LOCATION);
            }
            requestPermissions(perms.toArray(new String[0]), REQ_WIFI);
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_WIFI) {
            boolean granted = hasWifiPermission();
            if (webView != null) {
                webView.evaluateJavascript("window.onAndroidPermission && window.onAndroidPermission(" + granted + ");", null);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        if (webView != null) {
            webView.removeJavascriptInterface("Android");
            webView.destroy();
        }
        super.onDestroy();
    }

    private interface Task {
        String run() throws Exception;
    }

    private void async(String callbackId, Task task) {
        executor.execute(() -> {
            String payload;
            try {
                payload = task.run();
            } catch (Exception error) {
                try {
                    JSONObject failure = new JSONObject();
                    failure.put("ok", false);
                    failure.put("error", String.valueOf(error.getMessage() == null ? error : error.getMessage()));
                    payload = failure.toString();
                } catch (Exception ignored) {
                    payload = "{\"ok\":false,\"error\":\"未知错误\"}";
                }
            }
            respond(callbackId, payload);
        });
    }

    private void respond(String callbackId, String payload) {
        runOnUiThread(() -> {
            if (webView == null) return;
            String script = "window.__androidResolve && window.__androidResolve("
                    + JSONObject.quote(callbackId) + "," + JSONObject.quote(payload) + ");";
            webView.evaluateJavascript(script, null);
        });
    }

    private class Bridge {
        @JavascriptInterface
        public void overview(String callbackId) {
            async(callbackId, MainActivity.this::overviewJson);
        }

        @JavascriptInterface
        public void wifiInfo(String callbackId) {
            async(callbackId, MainActivity.this::wifiInfoJson);
        }

        @JavascriptInterface
        public void scanWifi(String callbackId) {
            async(callbackId, MainActivity.this::scanWifiJson);
        }

        @JavascriptInterface
        public void ping(String host, int count, String callbackId) {
            async(callbackId, () -> pingJson(host, count));
        }

        @JavascriptInterface
        public void dnsTest(String callbackId) {
            async(callbackId, MainActivity.this::dnsJson);
        }

        @JavascriptInterface
        public void tcpTest(String callbackId) {
            async(callbackId, MainActivity.this::tcpJson);
        }

        @JavascriptInterface
        public void httpTest(String callbackId) {
            async(callbackId, MainActivity.this::httpJson);
        }

        @JavascriptInterface
        public void speedTest(String callbackId) {
            async(callbackId, MainActivity.this::speedJson);
        }

        @JavascriptInterface
        public void requestWifiPermission() {
            MainActivity.this.requestWifiPermission();
        }

        @JavascriptInterface
        public void openWifiSettings() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS));
                } catch (ActivityNotFoundException error) {
                    Toast.makeText(MainActivity.this, "当前系统无法打开 Wi-Fi 设置", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void setDarkMode(boolean dark) {
            applySystemBars(dark);
        }

        @JavascriptInterface
        public void toast(String text) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, text, Toast.LENGTH_SHORT).show());
        }
    }

    private String overviewJson() throws Exception {
        JSONObject result = new JSONObject();
        Network active = connectivityManager == null ? null : connectivityManager.getActiveNetwork();
        NetworkCapabilities capabilities = active == null || connectivityManager == null
                ? null : connectivityManager.getNetworkCapabilities(active);
        LinkProperties link = active == null || connectivityManager == null
                ? null : connectivityManager.getLinkProperties(active);

        String type = "未连接";
        boolean online = false;
        int downKbps = 0;
        if (capabilities != null) {
            online = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) type = "Wi-Fi";
            else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) type = "移动网络";
            else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) type = "以太网";
            else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) type = "VPN";
            else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH)) type = "蓝牙共享";
            downKbps = capabilities.getLinkDownstreamBandwidthKbps();
        }

        String ipv4 = "—";
        String gateway = "—";
        JSONArray dns = new JSONArray();
        String iface = "—";
        if (link != null) {
            if (link.getInterfaceName() != null) iface = link.getInterfaceName();
            for (LinkAddress address : link.getLinkAddresses()) {
                if (address.getAddress() instanceof Inet4Address) {
                    ipv4 = address.getAddress().getHostAddress();
                    break;
                }
            }
            for (RouteInfo route : link.getRoutes()) {
                if (route.isDefaultRoute() && route.getGateway() instanceof Inet4Address) {
                    gateway = route.getGateway().getHostAddress();
                    break;
                }
            }
            for (InetAddress address : link.getDnsServers()) {
                if (!address.isLoopbackAddress() && !address.isAnyLocalAddress()) {
                    dns.put(address.getHostAddress());
                }
            }
        }

        TelephonyManager telephony = (TelephonyManager) getSystemService(Context.TELEPHONY_SERVICE);
        String operator = "—";
        try {
            if (telephony != null && telephony.getNetworkOperatorName() != null
                    && telephony.getNetworkOperatorName().length() > 0) {
                operator = telephony.getNetworkOperatorName();
            }
        } catch (SecurityException ignored) {
        }

        result.put("ok", true);
        result.put("online", online);
        result.put("type", type);
        result.put("interfaceName", iface);
        result.put("ipv4", ipv4);
        result.put("gateway", gateway);
        result.put("dns", dns);
        result.put("downKbps", downKbps);
        result.put("operator", operator);
        result.put("wifiEnabled", wifiManager != null && wifiManager.isWifiEnabled());
        result.put("wifiPermission", hasWifiPermission());
        result.put("device", Build.MANUFACTURER + " " + Build.MODEL);
        result.put("android", "Android " + Build.VERSION.RELEASE);
        result.put("timestamp", System.currentTimeMillis());
        try {
            result.put("wifi", new JSONObject(wifiInfoJson()));
        } catch (Exception error) {
            result.put("wifi", new JSONObject().put("ok", false).put("error", "无法读取 Wi-Fi 信息"));
        }
        return result.toString();
    }

    private String cleanSsid(String value) {
        if (value == null) return "";
        String clean = value.trim();
        if (clean.length() >= 2 && clean.startsWith("\"") && clean.endsWith("\"")) {
            clean = clean.substring(1, clean.length() - 1);
        }
        if ("<unknown ssid>".equalsIgnoreCase(clean) || "0x".equals(clean)) return "";
        return clean;
    }

    private int signalPercent(int rssi) {
        if (rssi <= -100) return 0;
        if (rssi >= -50) return 100;
        return Math.max(0, Math.min(100, 2 * (rssi + 100)));
    }

    private String bandForFrequency(int frequency) {
        if (frequency >= 5925) return "6 GHz";
        if (frequency >= 4900) return "5 GHz";
        if (frequency >= 2400) return "2.4 GHz";
        return frequency > 0 ? frequency + " MHz" : "—";
    }

    private String securityText(String capabilities) {
        if (capabilities == null || capabilities.length() == 0) return "开放 / 未知";
        String upper = capabilities.toUpperCase(Locale.US);
        if (upper.contains("WPA3")) return "WPA3";
        if (upper.contains("WPA2")) return "WPA2";
        if (upper.contains("WPA")) return "WPA";
        if (upper.contains("WEP")) return "WEP";
        if (upper.contains("EAP")) return "企业级";
        return "开放网络";
    }

    private String wifiInfoJson() throws Exception {
        JSONObject result = new JSONObject();
        result.put("ok", true);
        result.put("permission", hasWifiPermission());
        result.put("enabled", wifiManager != null && wifiManager.isWifiEnabled());
        if (wifiManager == null) {
            result.put("ok", false);
            result.put("error", "系统未提供 Wi-Fi 服务");
            return result.toString();
        }
        if (!hasWifiPermission()) {
            result.put("ok", false);
            result.put("error", "需要授予附近设备 / 位置权限才能读取 Wi-Fi 名称。");
            return result.toString();
        }
        WifiInfo info;
        try {
            info = wifiManager.getConnectionInfo();
        } catch (SecurityException error) {
            result.put("ok", false);
            result.put("error", "系统拒绝了 Wi-Fi 信息读取请求。");
            return result.toString();
        }
        if (info == null) {
            result.put("ok", false);
            result.put("error", "当前没有可用的 Wi-Fi 连接。");
            return result.toString();
        }
        String ssid = cleanSsid(info.getSSID());
        if (ssid.length() == 0) {
            result.put("ok", false);
            result.put("error", "当前没有连接到 Wi-Fi。");
            result.put("ssid", "");
            result.put("bssid", "");
            return result.toString();
        }
        int rssi = info.getRssi();
        int frequency = info.getFrequency();
        result.put("ssid", ssid);
        result.put("bssid", info.getBSSID() == null ? "—" : info.getBSSID());
        result.put("rssi", rssi);
        result.put("signal", signalPercent(rssi));
        result.put("frequency", frequency);
        result.put("band", bandForFrequency(frequency));
        result.put("linkSpeed", info.getLinkSpeed());
        result.put("ip", info.getIpAddress() == 0 ? "—" : intToIp(info.getIpAddress()));
        result.put("security", "—");
        try {
            List<ScanResult> scans = wifiManager.getScanResults();
            if (scans != null) {
                for (ScanResult scan : scans) {
                    if (scan.BSSID != null && scan.BSSID.equalsIgnoreCase(info.getBSSID())) {
                        result.put("security", securityText(scan.capabilities));
                        break;
                    }
                }
            }
        } catch (SecurityException ignored) {
        }
        return result.toString();
    }

    private String scanWifiJson() throws Exception {
        JSONObject result = new JSONObject();
        if (wifiManager == null) {
            result.put("ok", false);
            result.put("error", "系统未提供 Wi-Fi 服务");
            result.put("networks", new JSONArray());
            return result.toString();
        }
        if (!wifiManager.isWifiEnabled()) {
            result.put("ok", false);
            result.put("error", "Wi-Fi 未开启，请先在系统设置中打开。");
            result.put("networks", new JSONArray());
            return result.toString();
        }
        if (!hasWifiPermission()) {
            result.put("ok", false);
            result.put("error", "需要授予附近设备 / 位置权限才能扫描周边网络。");
            result.put("networks", new JSONArray());
            return result.toString();
        }
        try {
            wifiManager.startScan();
        } catch (SecurityException error) {
            result.put("ok", false);
            result.put("error", "系统拒绝了扫描请求。");
            result.put("networks", new JSONArray());
            return result.toString();
        } catch (Exception ignored) {
        }
        Thread.sleep(700);
        List<ScanResult> scans = wifiManager.getScanResults();
        List<ScanResult> cleaned = new ArrayList<>();
        if (scans != null) {
            for (ScanResult scan : scans) {
                if (scan != null && cleanSsid(scan.SSID).length() > 0) cleaned.add(scan);
            }
        }
        Collections.sort(cleaned, (left, right) -> Integer.compare(right.level, left.level));
        String currentBssid = "";
        try {
            WifiInfo info = wifiManager.getConnectionInfo();
            if (info != null && info.getBSSID() != null) currentBssid = info.getBSSID();
        } catch (SecurityException ignored) {
        }
        JSONArray networks = new JSONArray();
        int limit = Math.min(cleaned.size(), 12);
        for (int index = 0; index < limit; index++) {
            ScanResult scan = cleaned.get(index);
            JSONObject item = new JSONObject();
            item.put("ssid", cleanSsid(scan.SSID));
            item.put("bssid", scan.BSSID == null ? "" : scan.BSSID);
            item.put("rssi", scan.level);
            item.put("signal", signalPercent(scan.level));
            item.put("frequency", scan.frequency);
            item.put("band", bandForFrequency(scan.frequency));
            item.put("security", securityText(scan.capabilities));
            item.put("current", scan.BSSID != null && scan.BSSID.equalsIgnoreCase(currentBssid));
            networks.put(item);
        }
        result.put("ok", true);
        result.put("networks", networks);
        result.put("scannedAt", System.currentTimeMillis());
        return result.toString();
    }

    private String pingJson(String host, int count) throws Exception {
        JSONObject result = new JSONObject();
        if (host == null || host.trim().length() == 0) {
            result.put("ok", false);
            result.put("error", "目标地址为空");
            return result.toString();
        }
        int packets = Math.max(1, Math.min(8, count));
        String output = "";
        int exitCode = -1;
        long start = System.currentTimeMillis();
        boolean processFinished = false;
        try {
            List<String> command = new ArrayList<>();
            command.add("/system/bin/ping");
            command.add("-c");
            command.add(String.valueOf(packets));
            command.add("-W");
            command.add("2");
            command.add(host);
            Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
            output = readAll(process.getInputStream());
            processFinished = process.waitFor(7, TimeUnit.SECONDS);
            if (processFinished) {
                exitCode = process.exitValue();
            } else {
                process.destroy();
            }
        } catch (Exception error) {
            output = "";
        }
        long duration = System.currentTimeMillis() - start;
        Double avg = parseAverage(output);
        double loss = parseLoss(output);
        if (avg == null) {
            long reachStart = System.currentTimeMillis();
            try {
                boolean reachable = InetAddress.getByName(host).isReachable(3000);
                if (reachable) {
                    avg = (double) (System.currentTimeMillis() - reachStart);
                    loss = 0;
                }
            } catch (Exception ignored) {
            }
        }
        boolean ok = avg != null && loss < 100;
        if (!ok && processFinished && exitCode == 0 && output.contains("time=")) {
            Matcher matcher = TIME_PATTERN.matcher(output);
            if (matcher.find()) {
                avg = Double.parseDouble(matcher.group(1));
                ok = true;
            }
        }
        result.put("ok", ok);
        result.put("host", host);
        result.put("avg", avg == null ? JSONObject.NULL : round(avg));
        result.put("loss", round(loss));
        result.put("duration", duration);
        result.put("received", ok ? Math.max(1, packets) : 0);
        result.put("sent", packets);
        if (!ok) result.put("error", "目标不可达或没有收到响应");
        return result.toString();
    }

    private Double parseAverage(String output) {
        Matcher avgMatcher = AVG_PATTERN.matcher(output);
        if (avgMatcher.find()) {
            try {
                return Double.parseDouble(avgMatcher.group(1));
            } catch (NumberFormatException ignored) {
            }
        }
        Matcher timeMatcher = TIME_PATTERN.matcher(output);
        double total = 0;
        int count = 0;
        while (timeMatcher.find()) {
            try {
                total += Double.parseDouble(timeMatcher.group(1));
                count += 1;
            } catch (NumberFormatException ignored) {
            }
        }
        return count > 0 ? total / count : null;
    }

    private double parseLoss(String output) {
        Matcher matcher = LOSS_PATTERN.matcher(output);
        if (matcher.find()) {
            try {
                return Double.parseDouble(matcher.group(1));
            } catch (NumberFormatException ignored) {
            }
        }
        return 100;
    }

    private String dnsJson() throws Exception {
        String[] domains = {"baidu.com", "qq.com", "aliyun.com", "taobao.com", "google.com"};
        JSONArray results = new JSONArray();
        int success = 0;
        double totalMs = 0;
        for (String domain : domains) {
            JSONObject item = new JSONObject();
            item.put("domain", domain);
            long start = System.currentTimeMillis();
            try {
                InetAddress[] addresses = resolveWithTimeout(domain, 4000);
                long elapsed = System.currentTimeMillis() - start;
                item.put("ok", addresses != null && addresses.length > 0);
                item.put("ms", round(elapsed));
                item.put("addresses", addresses == null ? 0 : addresses.length);
                if (addresses != null && addresses.length > 0) {
                    success += 1;
                    totalMs += elapsed;
                }
            } catch (Exception error) {
                item.put("ok", false);
                item.put("ms", System.currentTimeMillis() - start);
                item.put("error", "解析失败");
            }
            results.put(item);
        }
        JSONObject result = new JSONObject();
        result.put("ok", success > 0);
        result.put("results", results);
        result.put("success", success);
        result.put("total", domains.length);
        result.put("avg", success > 0 ? round(totalMs / success) : JSONObject.NULL);
        return result.toString();
    }

    private InetAddress[] resolveWithTimeout(final String host, long timeoutMs) throws Exception {
        ExecutorService one = Executors.newSingleThreadExecutor();
        Future<InetAddress[]> future = one.submit(() -> InetAddress.getAllByName(host));
        try {
            return future.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (Exception error) {
            if (error instanceof UnknownHostException) throw error;
            throw new UnknownHostException(host);
        } finally {
            one.shutdownNow();
        }
    }

    private String tcpJson() throws Exception {
        String[][] targets = {
                {"百度", "www.baidu.com"},
                {"腾讯", "www.qq.com"},
                {"阿里云", "www.aliyun.com"}
        };
        JSONArray results = new JSONArray();
        int success = 0;
        double totalMs = 0;
        for (String[] target : targets) {
            JSONObject item = new JSONObject();
            item.put("name", target[0]);
            item.put("host", target[1]);
            long start = System.currentTimeMillis();
            Socket socket = new Socket();
            try {
                socket.connect(new InetSocketAddress(target[1], 443), 3500);
                long elapsed = System.currentTimeMillis() - start;
                item.put("ok", true);
                item.put("ms", round(elapsed));
                success += 1;
                totalMs += elapsed;
            } catch (Exception error) {
                item.put("ok", false);
                item.put("ms", System.currentTimeMillis() - start);
                item.put("error", "连接失败");
            } finally {
                try {
                    socket.close();
                } catch (IOException ignored) {
                }
            }
            results.put(item);
        }
        JSONObject result = new JSONObject();
        result.put("ok", success > 0);
        result.put("results", results);
        result.put("success", success);
        result.put("total", targets.length);
        result.put("avg", success > 0 ? round(totalMs / success) : JSONObject.NULL);
        return result.toString();
    }

    private String httpJson() throws Exception {
        String[][] targets = {
                {"百度", "https://www.baidu.com/"},
                {"腾讯", "https://www.qq.com/"},
                {"阿里云", "https://www.aliyun.com/"}
        };
        JSONArray results = new JSONArray();
        int success = 0;
        double totalMs = 0;
        for (String[] target : targets) {
            JSONObject item = new JSONObject();
            item.put("name", target[0]);
            item.put("host", target[1]);
            long start = System.currentTimeMillis();
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(target[1]).openConnection();
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(5000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestMethod("GET");
                connection.setRequestProperty("User-Agent", "WiFiMedic-Android/1.0");
                int code = connection.getResponseCode();
                long elapsed = System.currentTimeMillis() - start;
                boolean ok = code > 0 && code < 500;
                item.put("ok", ok);
                item.put("code", code);
                item.put("ms", round(elapsed));
                if (ok) {
                    success += 1;
                    totalMs += elapsed;
                }
            } catch (Exception error) {
                item.put("ok", false);
                item.put("ms", System.currentTimeMillis() - start);
                item.put("error", "HTTP 访问失败");
            } finally {
                if (connection != null) connection.disconnect();
            }
            results.put(item);
        }
        JSONObject result = new JSONObject();
        result.put("ok", success > 0);
        result.put("results", results);
        result.put("success", success);
        result.put("total", targets.length);
        result.put("avg", success > 0 ? round(totalMs / success) : JSONObject.NULL);
        return result.toString();
    }

    private String speedJson() throws Exception {
        String[] urls = {
                "https://speed.cloudflare.com/__down?bytes=3000000",
                "https://mirrors.aliyun.com/ubuntu/ls-lR.gz"
        };
        for (String url : urls) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(6000);
                connection.setReadTimeout(12000);
                connection.setRequestProperty("User-Agent", "WiFiMedic-Android/1.0");
                connection.setRequestProperty("Range", "bytes=0-2499999");
                connection.setInstanceFollowRedirects(true);
                long start = System.currentTimeMillis();
                InputStream stream = connection.getInputStream();
                byte[] buffer = new byte[32768];
                int read;
                long total = 0;
                while ((read = stream.read(buffer)) > 0 && total < 2500000) {
                    total += read;
                }
                stream.close();
                long elapsed = System.currentTimeMillis() - start;
                if (total < 64 * 1024 || elapsed < 50) continue;
                double mbps = (total * 8.0) / (elapsed / 1000.0) / 1000000.0;
                JSONObject result = new JSONObject();
                result.put("ok", true);
                result.put("mbps", round(mbps));
                result.put("bytes", total);
                result.put("ms", elapsed);
                result.put("source", url.contains("cloudflare") ? "Cloudflare" : "阿里云镜像");
                return result.toString();
            } catch (Exception ignored) {
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
        JSONObject failure = new JSONObject();
        failure.put("ok", false);
        failure.put("error", "当前网络无法完成下载测速");
        return failure.toString();
    }

    private String readAll(InputStream stream) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = stream.read(buffer)) > 0) {
            output.write(buffer, 0, read);
        }
        return output.toString("UTF-8");
    }

    private String intToIp(int ip) {
        return (ip & 0xff) + "." + ((ip >> 8) & 0xff) + "." + ((ip >> 16) & 0xff) + "." + ((ip >> 24) & 0xff);
    }

    private double round(double value) {
        return Math.round(value * 10.0) / 10.0;
    }
}
