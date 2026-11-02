import lang_en from "$/locale/dicts/en.json";
import lang_nl from "$/locale/dicts/nl.json";
import lang_de from "$/locale/dicts/de.json";
import lang_es from "$/locale/dicts/es.json";
import lang_pl from "$/locale/dicts/pl.json";

export type TranslationKey = keyof typeof lang_en;
export type TranslationDict = Record<TranslationKey, string>;

/** Only languages with a complete, current translation: a half-done one mixes in English on every screen */
export const langPack = {
  /** English (fallback) */
  en: lang_en,
  /** Dutch */
  nl: lang_nl as TranslationDict,
  /** German */
  de: lang_de as TranslationDict,
  /** Spanish */
  es: lang_es as TranslationDict,
  /** Polish */
  pl: lang_pl as TranslationDict,
} as const;

export type SupportedLanguage = keyof typeof langPack;

export const languageNames = Object.assign(
  {},
  ...Object.entries(langPack).map(([k, v]) => ({
    [k]: v["lang.name"] ?? k,
  })),
) as Record<SupportedLanguage, string>;
