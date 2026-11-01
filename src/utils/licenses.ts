/** licenses.json, written by vite-plugin-licenses.ts at build time */

export interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  url?: string;
  text?: string;
}

export interface LicensesFile {
  /** The repository's NOTICE: copyright and the MIT notices of the projects it's derived from */
  notice: string;
  /** The repository's LICENSE: the GNU GPL version 3 */
  app: string;
  packages: LicenseEntry[];
}
