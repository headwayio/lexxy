// Normalize HTML whitespace for comparison.
// Simpler than Ruby's Nokogiri-based normalize_html, but sufficient for
// comparing clean Lexical-generated HTML against expected strings.
export function normalizeHtml(html) {
  return html
    .replace(/\n/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .replace(/\s*data-bullet-depth="[^"]*"/g, "")
    .replace(/\s*data-list-item-type="[^"]*"/g, "")
    .replace(/\s*collapsed="[^"]*"/g, "")
    .trim()
}
