import type { EncodedImage, LabelType } from "./types";

export interface PrintTaskOptions {
  totalPages: number;
  density: number;
  speed: number;
  labelType: LabelType;
  statusPollIntervalMs: number;
  statusTimeoutMs: number;
}

export abstract class AbstractPrintTask {
  protected cancelled = false;

  /**
   * Stop after the copy that is being printed: the copies still to come are left out. A copy can't be stopped
   * halfway, the printer waits for the rest of its image.
   */
  cancel(): void {
    this.cancelled = true;
  }

  abstract printInit(): Promise<void>;
  abstract printPage(image: EncodedImage, quantity: number): Promise<void>;
  abstract waitForFinished(): Promise<void>;
  abstract printEnd(): Promise<void>;
}
