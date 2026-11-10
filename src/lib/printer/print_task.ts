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
  abstract printInit(): Promise<void>;
  abstract printPage(image: EncodedImage, quantity: number): Promise<void>;
  abstract waitForFinished(): Promise<void>;
  abstract printEnd(): Promise<void>;
}
