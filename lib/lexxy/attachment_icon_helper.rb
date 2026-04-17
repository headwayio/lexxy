module Lexxy
  # Short label shown inside .attachment__icon. Any extension not in the map
  # falls back to its uppercased form ("sql" → "SQL").
  #
  # Keep in sync with ICON_LABELS in src/helpers/html_helper.js and
  # app/assets/javascript/lexxy-content-preview.js — this is the canonical
  # Ruby mirror used by the show-page blob partial.
  module AttachmentIconHelper
    ICON_LABELS = {
      "md" => "M\u2193", "markdown" => "M\u2193",
      "png" => "IMG", "jpg" => "IMG", "jpeg" => "IMG", "webp" => "IMG", "svg" => "SVG",
      "bmp" => "IMG", "tiff" => "IMG", "tif" => "IMG", "ico" => "IMG", "avif" => "IMG", "heic" => "IMG",
      "docx" => "DOC", "xlsx" => "XLS", "pptx" => "PPT",
      "rar" => "ZIP", "webm" => "VID", "avi" => "VID"
    }.freeze

    def attachment_icon_label(extension)
      return "" if extension.blank?
      ICON_LABELS[extension.to_s.downcase] || extension.to_s.upcase
    end
  end
end
