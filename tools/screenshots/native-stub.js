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
        if (m.methodName === "isEnabled") return reply(m, { value: true });
        if (m.methodName === "requestLEScan") {
          reply(m, {});
          setTimeout(() => reply(scanCb, { device: { deviceId: "DC:0D:30:12:34:56", name: "D11s_3456" }, rssi: -55 }), 200);
          setTimeout(() => reply(scanCb, { device: { deviceId: "DC:0D:30:AB:CD:EF", name: "FICHERO_ABCD" }, rssi: -82 }), 300);
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
