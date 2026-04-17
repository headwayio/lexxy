module Lexxy
  # View helpers for app/views/active_storage/blobs/_blob.html.erb. Registered
  # as a controller helper by Lexxy::Engine so it's available anywhere the
  # blob partial renders (ActionText show-page output, direct renders).
  module AttachmentHelper
    INLINE_IMAGE_CONTENT_TYPES = %w[ image/gif image/webp image/avif image/svg+xml ].freeze

    # Route the _blob.html.erb partial to a per-content-type sub-partial so
    # each type's markup lives in its own file rather than a multi-branch if/
    # elsif stack. The sub-partials are colocated in app/views/active_storage/
    # blobs/ alongside _blob.html.erb.
    def lexxy_blob_partial(blob)
      case
      when blob.video?                                           then "active_storage/blobs/blob_video"
      when blob.audio?                                           then "active_storage/blobs/blob_audio"
      when INLINE_IMAGE_CONTENT_TYPES.include?(blob.content_type) then "active_storage/blobs/blob_inline_image"
      when blob.representable?                                   then "active_storage/blobs/blob_image"
      else                                                            "active_storage/blobs/blob_file"
      end
    end

    def lexxy_attachment_preview_action(blob)
      link_to rails_blob_path(blob, disposition: :inline),
              class: "attachment__action", target: "_blank", title: "Open", aria: { label: "Open" } do
        lexxy_inline_svg("lexxy/preview.svg")
      end
    end

    def lexxy_attachment_download_action(blob)
      link_to url_for(blob),
              class: "attachment__action", download: blob.filename, title: "Download", aria: { label: "Download" } do
        lexxy_inline_svg("lexxy/download.svg")
      end
    end

    # SVGs are forced to download by ActiveStorage's binary-types list (a
    # security default — SVGs can embed <script>). Embed the SVG markup
    # directly so the browser renders it; the ActionText sanitizer strips
    # <script> children before render, and Lexxy::Engine extends the
    # allowlist to cover common SVG primitives.
    def lexxy_attachment_image_tag(blob)
      if blob.content_type == "image/svg+xml"
        blob.download.sub(/\A<\?xml[^>]*\?>\s*/, "").html_safe
      else
        image_tag(url_for(blob))
      end
    end

    def lexxy_attachment_actions(blob)
      tag.div(
        lexxy_attachment_preview_action(blob) + lexxy_attachment_download_action(blob),
        class: "attachment__actions"
      )
    end

    def lexxy_attachment_preview_caption(blob, icon_label)
      tag.figcaption(class: "attachment__caption") do
        tag.span(icon_label, class: "attachment__icon") +
          tag.span(lexxy_attachment_name_and_size(blob), class: "attachment__caption-text")
      end
    end

    def lexxy_attachment_file_caption(blob)
      tag.figcaption(lexxy_attachment_name_and_size(blob), class: "attachment__caption")
    end

    # Read the SVG file from the engine's asset paths and emit it inline so
    # CSS can theme its paths via currentColor (an <img> tag can't). Cached
    # once per filename for the lifetime of the process.
    def lexxy_inline_svg(path)
      LEXXY_INLINE_SVG_CACHE[path] ||= Lexxy::Engine.root.join("app", "assets", "images", path).read.html_safe
    end

    LEXXY_INLINE_SVG_CACHE = {}
    private_constant :LEXXY_INLINE_SVG_CACHE

    private
      # When the ActionText::Attachment has a caption and the editor-managed
      # `data-caption-hidden` flag is NOT set, we display the caption as the
      # name and suppress the size on image/video previews (caption carries the
      # meaningful label). Otherwise fall back to the original filename + size.
      # `blob` here is actually the ActionText::Attachment (passed by
      # ActionText via `object: attachment`); method_missing delegates to the
      # real ActiveStorage::Blob for filename, byte_size, content_type, etc.
      def lexxy_attachment_name_and_size(blob)
        caption = lexxy_attachment_caption(blob)
        if caption
          display_name = caption
          show_size = !blob.content_type.to_s.start_with?("image/", "video/")
        else
          display_name = blob.filename
          show_size = true
        end

        name_tag = tag.span(display_name, class: "attachment__name")
        size_tag = show_size ? tag.span(number_to_human_size(blob.byte_size), class: "attachment__size") : "".html_safe
        name_tag + size_tag
      end

      # Returns the non-hidden caption string, or nil if no caption is set or
      # if it's explicitly hidden via the editor's caption-toggle.
      def lexxy_attachment_caption(blob)
        return nil unless blob.respond_to?(:caption) && blob.respond_to?(:node)
        return nil if blob.node["data-caption-hidden"].present?

        caption = blob.caption
        caption if caption.present?
      end
  end
end
