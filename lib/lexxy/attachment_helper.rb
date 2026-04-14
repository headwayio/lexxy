module Lexxy
  # View helpers used by app/views/active_storage/blobs/_blob.html.erb to keep
  # the partial free of tag-concatenation logic. Included into ActionView::Base
  # by Lexxy::Engine.
  module AttachmentHelper
    # Two <svg> icons match attachment_icons.js on the JS side — keep the path
    # data in sync. (Preview = eye, download = arrow-into-tray.)
    PREVIEW_ICON_PATH = "M9 4C5.13 4 1.86 6.42 0.5 9.5C1.86 12.58 5.13 15 9 15C12.87 15 16.14 12.58 17.5 9.5C16.14 6.42 12.87 4 9 4ZM9 13C6.79 13 5 11.21 5 9C5 6.79 6.79 5 9 5C11.21 5 13 6.79 13 9C13 11.21 11.21 13 9 13ZM9 6.5C7.62 6.5 6.5 7.62 6.5 9C6.5 10.38 7.62 11.5 9 11.5C10.38 11.5 11.5 10.38 11.5 9C11.5 7.62 10.38 6.5 9 6.5Z".freeze
    DOWNLOAD_ICON_PATH = "M9 12L4 7h3V2h4v5h3L9 12zM3 14h12v2H3v-2z".freeze

    def lexxy_attachment_preview_action(blob)
      link_to rails_blob_path(blob, disposition: :inline),
              class: "attachment__action", target: "_blank", aria: { label: "Preview" } do
        lexxy_attachment_icon_svg(PREVIEW_ICON_PATH)
      end
    end

    def lexxy_attachment_download_action(blob)
      link_to url_for(blob),
              class: "attachment__action", download: blob.filename, aria: { label: "Download" } do
        lexxy_attachment_icon_svg(DOWNLOAD_ICON_PATH)
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

    private
      def lexxy_attachment_name_and_size(blob)
        tag.span(blob.filename, class: "attachment__name") +
          tag.span(number_to_human_size(blob.byte_size), class: "attachment__size")
      end

      def lexxy_attachment_icon_svg(path_data)
        tag.svg(tag.path(d: path_data), viewBox: "0 0 18 18", xmlns: "http://www.w3.org/2000/svg")
      end
  end
end
