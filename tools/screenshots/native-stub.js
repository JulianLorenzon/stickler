// Fake Android bridge: answers BLE plugin calls and emits two scan results
(() => {
  localStorage.setItem("last_printer", JSON.stringify({ deviceId: "DC:0D:30:12:34:56", name: "D11s_3456", autoConnect: true }));
  let scanCb;
  const reply = (m, data) => setTimeout(() => window.Capacitor.fromNative({
    callbackId: m.callbackId, pluginId: m.pluginId, methodName: m.methodName, success: true, data, save: true }), 30);
  const P = (n) => ({ name: n, rtype: "promise" });
  window.Capacitor = window.Capacitor || {};
  window.Capacitor.PluginHeaders = [
    { name: "BluetoothLe", methods: ["initialize", "isEnabled", "requestEnable", "requestLEScan", "stopLEScan",
      "connect", "disconnect", "startNotifications", "writeWithoutResponse"].map(P)
      .concat([{ name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "promise" }]) },
    { name: "App", methods: ["minimizeApp", "exitApp"].map(P)
      .concat([{ name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "promise" }]) },
  ];
  window.androidBridge = {
    postMessage(str) {
      const m = JSON.parse(str);
      if (m.type === "message" || m.callbackId) {
        if (m.methodName === "addListener" && m.options?.eventName === "onScanResult") { scanCb = m; return; }
        // Shots press the Android back button with window.__stubBack()
        if (m.methodName === "addListener" && m.options?.eventName === "backButton") {
          window.__stubBack = () => reply(m, { canGoBack: false });
          return;
        }
        if (m.methodName === "isEnabled") return reply(m, { value: true });
        if (m.methodName === "requestLEScan") {
          reply(m, {});
          // Shots can set window.__stubScan to [[deviceId, name, rssi], …] for other printers
          const found = window.__stubScan || [["DC:0D:30:12:34:56", "D11s_3456", -55], ["DC:0D:30:AB:CD:EF", "FICHERO_ABCD", -82]];
          found.forEach(([deviceId, name, rssi], i) =>
            setTimeout(() => reply(scanCb, { device: { deviceId, name }, rssi }), 200 + i * 100));
          return;
        }
        if (m.methodName === "connect") {
          window.__connectCalls = (window.__connectCalls || 0) + 1;
          // Shots that set window.__stubConnect get a connection (the printer never answers commands);
          // otherwise the "connecting" spinner stays
          if (window.__stubConnect) return reply(m, {});
          return;
        }
        return reply(m, {});
      }
    },
  };
})();
