import { get, readable, writable } from "svelte/store";
import { Capacitor } from "@capacitor/core";
import {
  AppConfigSchema,
  CsvParamsSchema,
  UserFontSchema,
  UserIconSchema,
  LastPrinterSchema,
  KnownPrinterSchema,
  PrinterIdSchema,
  type LastPrinter,
  type KnownPrinter,
  type PrinterId,
  type CsvParams,
  type UserFont,
  type UserIcon,
  type AppConfig,
  type AutomationProps,
  type ConnectionState,
} from "$/types";
import {
  Utils,
  instantiateClient,
  type HeartbeatData,
  type PrinterClient,
  type PrinterInfo,
  type PrinterModelMeta,
} from "$/lib/printer";
import { Toasts } from "$/utils/toasts";
import { tr } from "$/utils/i18n";
import { LocalStoragePersistence, writablePersisted } from "$/utils/persistence";
import { APP_CONFIG_DEFAULTS, CSV_DEFAULT, OBJECT_DEFAULTS_TEXT } from "$/defaults";
import z from "zod";
import { FileUtils } from "$/utils/file_utils";

export const fontCache = writable<string[]>([OBJECT_DEFAULTS_TEXT.fontFamily]);
export const appConfig = writablePersisted<AppConfig>("config", AppConfigSchema, APP_CONFIG_DEFAULTS);
export const userIcons = writablePersisted<UserIcon[]>("user_icons", z.array(UserIconSchema), []);
export const userFonts = writablePersisted<UserFont[]>("user_fonts", z.array(UserFontSchema), []);
export const loadedFonts = writable<FontFace[]>([]);

export const connectionState = writable<ConnectionState>("disconnected");
export const connectedPrinterName = writable<string>("");
/** Address of the printer connected via native BLE (undefined for Web Bluetooth or when disconnected) */
export const connectedDeviceId = writable<string | undefined>();
export const printerClient = writable<PrinterClient>();
export const heartbeatData = writable<HeartbeatData>();
export const printerInfo = writable<PrinterInfo>();
export const printerMeta = writable<PrinterModelMeta | undefined>();
export const heartbeatFails = writable<number>(0);
/** Single "last printer" of earlier versions; only read to fill knownPrinters */
const legacyLastPrinter = (): LastPrinter | null => {
  try {
    return LocalStoragePersistence.loadAndValidateObject("last_printer", LastPrinterSchema) ?? null;
  } catch {
    return null;
  }
};

/** Printers connected before via native BLE, for one-tap and automatic reconnecting */
export const knownPrinters = writablePersisted<KnownPrinter[]>(
  "known_printers",
  z.array(KnownPrinterSchema),
  (() => {
    const last = legacyLastPrinter();
    return last ? [{ deviceId: last.deviceId, name: last.name, lastUsed: 0 }] : [];
  })(),
);

/** Connect to a known printer when the app opens (native only) */
export const autoReconnect = writablePersisted<boolean>("auto_reconnect", z.boolean(), legacyLastPrinter()?.autoConnect ?? true);
/**
 * Printer the label sizes are shown for: the connected one, else the last one connected or picked in the size menu
 */
export const designPrinter = writablePersisted<PrinterId>("design_printer", PrinterIdSchema, "d11s");
/** Printer connection sheet visibility, so any component can ask the user to connect */
export const printerSheetOpen = writable<boolean>(false);
export const csvData = writablePersisted<CsvParams>("csv_params", CsvParamsSchema, { data: CSV_DEFAULT });

userFonts.subscribe(FileUtils.loadFonts);

export const automation = readable<AutomationProps | undefined>(
  (() => {
    try {
      return LocalStoragePersistence.loadAutomation() ?? undefined;
    } catch (e) {
      console.error(e);
    }
    return undefined;
  })(),
);

export const initClient = () => {
  printerClient.update((prevClient: PrinterClient) => {
    let newClient: PrinterClient = prevClient;

    if (prevClient !== undefined) {
      prevClient.disconnect();
    }

    newClient = instantiateClient();

    const conf = get(appConfig);

    if (conf.packetIntervalMs !== undefined) {
      newClient.setPacketInterval(conf.packetIntervalMs);
    }

    // Protocol trace for the console. Not in the Play build: nothing can read its console (no logcat output, no
    // WebView inspector), so the lines would go nowhere
    if (!Capacitor.isNativePlatform() || Capacitor.DEBUG) {
      newClient.on("packetsent", (e) => {
        console.debug(`>> ${Utils.bufToHex(e.packet.toBytes())}`);
      });

      newClient.on("packetreceived", (e) => {
        console.debug(`<< ${Utils.bufToHex(e.packet.toBytes())}`);
      });
    }

    newClient.on("connect", (e) => {
      console.debug("onConnect");
      heartbeatFails.set(0);
      connectionState.set("connected");
      connectedPrinterName.set(e.info.deviceName ?? "unknown");
    });

    newClient.on("printerinfofetched", (e) => {
      console.debug("printerInfoFetched");
      printerInfo.set(e.info);
      const meta = newClient.getModelMetadata();
      printerMeta.set(meta);
      designPrinter.set(meta.driver);
    });

    newClient.on("disconnect", () => {
      console.debug("onDisconnect");
      connectionState.set("disconnected");
      connectedPrinterName.set("");
      connectedDeviceId.set(undefined);
      printerInfo.set({});
      printerMeta.set(undefined);
    });

    newClient.on("heartbeat", (e) => {
      heartbeatFails.set(0);
      heartbeatData.set(e.data);
    });

    newClient.on("heartbeatfailed", (e) => {
      const maxFails = 5;
      heartbeatFails.set(e.failedAttempts);

      console.warn(`Heartbeat failed ${e.failedAttempts}/${maxFails}`);
      if (e.failedAttempts >= maxFails) {
        Toasts.error(get(tr)("connector.disconnect.heartbeat"));
        newClient.disconnect();
      }
    });

    return newClient;
  });
};
