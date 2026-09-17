/**
 * Strip annotation characters from a SAN move so two moves can be compared
 * by piece-and-destination only. Removes check (+), mate (#), and capture (x)
 * markers. Used when reconciling user moves against repertoire moves or
 * Lichess Masters opening data, where punctuation differences would otherwise
 * cause spurious mismatches.
 */
export function looseSan(san: string): string {
  return san.replace(/[+#x]/g, "").trim();
}
