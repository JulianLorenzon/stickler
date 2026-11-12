import { mount, unmount } from "svelte";
import StripCamera from "$/components/StripCamera.svelte";

/** The grey test as the camera read it: several frames put together */
export interface StripCapture {
  /** Per row, darkness of the 10..90% patches (median over the frames), as `readGreyStrip` gives it */
  measured: number[][];
  /** The last frame with the measured boxes drawn in, as a data URL */
  overlay: string;
  /** Darkest / brightest paper sample (median over the frames) */
  paperEvenness: number;
}

export const stripCameraAvailable = (): boolean => !!navigator.mediaDevices?.getUserMedia;

/**
 * Opens the camera screen and reads the continuous-roll grey test (`width` x `rowHeight` dots per row) as soon as it
 * is in view. Resolves undefined if the user backs out; rejects with the getUserMedia error if there's no camera
 * to use.
 */
export const captureGreyStrip = (width: number, rowHeight: number): Promise<StripCapture | undefined> =>
  new Promise((resolve, reject) => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const component = mount(StripCamera, {
      target,
      props: {
        width,
        rowHeight,
        onDone: (result, error) => {
          // Unmount after this callback returns, not from inside the component
          setTimeout(() => {
            unmount(component);
            target.remove();
          });
          if (error !== undefined) reject(error);
          else resolve(result);
        },
      },
    });
  });
