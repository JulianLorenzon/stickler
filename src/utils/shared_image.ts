import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/** SharedImagePlugin.java: pictures shared to the app through Android's share menu */
interface SharedImagePlugin {
  take(): Promise<{ image?: { mimeType: string; data: string } }>;
  addListener(event: "shared", listener: () => void): Promise<PluginListenerHandle>;
}

const SharedImage = registerPlugin<SharedImagePlugin>("SharedImage");

const toFile = (mimeType: string, base64: string): File => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new File([bytes], `shared.${mimeType.split("/")[1] ?? "png"}`, { type: mimeType });
};

/**
 * Calls `onImage` for every picture shared to the app, including one that launched it. Android app only.
 * Returns a function that stops listening.
 */
export const onSharedImage = (onImage: (file: File) => void): (() => void) => {
  if (Capacitor.getPlatform() !== "android") return () => {};

  const take = async () => {
    try {
      const { image } = await SharedImage.take();
      if (image) onImage(toFile(image.mimeType, image.data));
    } catch (e) {
      console.error("Shared picture", e);
    }
  };

  // Rejects when the plugin is missing (an older native build): then there is nothing to listen to
  const handle = SharedImage.addListener("shared", take).catch(() => undefined);
  take();
  return () => void handle.then((h) => h?.remove());
};
