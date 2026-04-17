// SVG strings shared between the attachment floating-controls (eye/collapse/
// edit/caption/delete buttons shown in the editor) and the preview modal
// chrome (close + download). Mirrors the pattern in toolbar_icons.js.
//
// The standalone show-page script in app/assets/javascript/lexxy-content-preview.js
// intentionally duplicates CLOSE and DOWNLOAD inline — it's a separate bundle
// that can't import from src/.
export default {
  preview: `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 4C5.13 4 1.86 6.42 0.5 9.5C1.86 12.58 5.13 15 9 15C12.87 15 16.14 12.58 17.5 9.5C16.14 6.42 12.87 4 9 4ZM9 13C6.79 13 5 11.21 5 9C5 6.79 6.79 5 9 5C11.21 5 13 6.79 13 9C13 11.21 11.21 13 9 13ZM9 6.5C7.62 6.5 6.5 7.62 6.5 9C6.5 10.38 7.62 11.5 9 11.5C10.38 11.5 11.5 10.38 11.5 9C11.5 7.62 10.38 6.5 9 6.5Z"/>
  </svg>`,

  collapse: `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 6.5L4 11.5L5.4 13L9 9.5L12.6 13L14 11.5L9 6.5Z"/>
  </svg>`,

  expand: `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 12.5L14 7.5L12.6 6L9 9.5L5.4 6L4 7.5L9 12.5Z"/>
  </svg>`,

  captionShow: `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 4h14v2H2V4zm0 4h10v2H2V8zm0 4h12v2H2v-2z"/>
  </svg>`,

  captionHide: `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 4h14v2H2V4zm0 4h10v2H2V8zm0 4h12v2H2v-2z" opacity="0.3"/>
    <path d="M1 1l16 16" stroke="currentColor" stroke-width="1.5" fill="none"/>
  </svg>`,

  edit: `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M13.293 1.293a1 1 0 011.414 0l2 2a1 1 0 010 1.414l-9 9A1 1 0 017 14H5a1 1 0 01-1-1v-2a1 1 0 01.293-.707l9-9zM6 12.586V13h.414l8.293-8.293-.414-.414L6 12.586z"/>
  </svg>`,

  delete: `<svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.2041 1.01074C12.2128 1.113 13 1.96435 13 3V4H15L15.1025 4.00488C15.6067 4.05621 16 4.48232 16 5C16 5.55228 15.5523 6 15 6H14.8457L14.1416 15.1533C14.0614 16.1953 13.1925 17 12.1475 17H5.85254L5.6582 16.9902C4.76514 16.9041 4.03607 16.2296 3.88184 15.3457L3.8584 15.1533L3.1543 6H3C2.44772 6 2 5.55228 2 5C2 4.44772 2.44772 4 3 4H5V3C5 1.89543 5.89543 1 7 1H11L11.2041 1.01074ZM5.85254 15H12.1475L12.8398 6H5.16016L5.85254 15ZM7 4H11V3H7V4Z"/>
  </svg>`,

  close: "<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M18 6L6 18M6 6l12 12\"/></svg>",

  download: "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4\"/><polyline points=\"7 10 12 15 17 10\"/><line x1=\"12\" y1=\"15\" x2=\"12\" y2=\"3\"/></svg>"
}
