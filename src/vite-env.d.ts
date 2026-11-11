/// <reference types="svelte" />
/// <reference types="vite/client" />
declare const __APP_VERSION__: string | undefined;
declare const __APP_COMMIT__: string | undefined;
declare const __BUILD_DATE__: string;

// not declared in ts lib, experimental feature
declare type FontData = {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly style: string;
};

declare function queryLocalFonts(): Promise<ReadonlyArray<FontData>>;


// JsBarcode's encoders, used without its renderer
declare module "jsbarcode/bin/barcodes/index.js" {
  type Encoded = { data: string; text?: string; options?: { textAlign?: string; height?: number } };
  const encoders: Record<
    string,
    new (data: string, options: object) => { valid(): boolean; encode(): Encoded | Encoded[] }
  >;
  export default encoders;
}
