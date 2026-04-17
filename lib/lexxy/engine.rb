require_relative "attachable"
require_relative "attachment_icon_helper"
require_relative "attachment_helper"

require "active_storage/blob_with_preview_url"

module Lexxy
  class Engine < ::Rails::Engine
    isolate_namespace Lexxy

    config.lexxy = ActiveSupport::OrderedOptions.new

    if Lexxy.supports_editor_adapter?
      require_relative "../action_text/editor/lexxy_editor"

      initializer "lexxy.action_text_editor", before: "action_text.editors" do |app|
        app.config.action_text.editors[:lexxy] = {}
        app.config.action_text.editor = :lexxy
      end
    else
      # Rails 8.0/8.1 fallback: monkey-patch Action Text helpers
      require_relative "rich_text_area_tag"
      require_relative "form_helper"
      require_relative "form_builder"
      require_relative "action_text_tag"

      config.lexxy.override_action_text_defaults = true

      initializer "lexxy.initialize" do |app|
        app.config.to_prepare do
          ActionText::TagHelper.prepend(Lexxy::TagHelper)
          ActionView::Helpers::FormHelper.prepend(Lexxy::FormHelper)
          ActionView::Helpers::FormBuilder.prepend(Lexxy::FormBuilder)
          ActionView::Helpers::Tags::ActionText.prepend(Lexxy::ActionTextTag)

          Lexxy.override_action_text_defaults if app.config.lexxy.override_action_text_defaults
        end
      end
    end

    initializer "lexxy.attachable" do |app|
      app.config.to_prepare do
        ActionText::Attachable.singleton_class.prepend(Lexxy::Attachable)
        ActionView::Base.include(Lexxy::AttachmentIconHelper)
        ActionView::Base.include(Lexxy::AttachmentHelper)
      end
    end

    initializer "lexxy.assets" do |app|
      if Rails.application.config.respond_to?(:assets)
        app.config.assets.paths << root.join("app/assets/stylesheets")
        app.config.assets.paths << root.join("app/javascript")
      end
    end

    initializer "lexxy.attachment_attributes" do
      ActionText::Attachment::ATTRIBUTES.push("data-caption-hidden", "data-collapsed")
    end

    initializer "lexxy.sanitization" do |app|
      ActiveSupport.on_load(:action_text_content) do
        default_allowed_tags = Class.new.include(ActionText::ContentHelper).new.sanitizer_allowed_tags
        # SVG primitives (circle, rect, etc.) are allowlisted so SVG attachments
        # can render inline — ActiveStorage's binary-types list forces SVG blobs
        # to download, so the show-page partial embeds the raw SVG markup instead
        # of using an <img src="...">. Sanitizer still scrubs <script> children.
        ActionText::ContentHelper.allowed_tags = default_allowed_tags + %w[
          video audio source embed table tbody tr th td
          svg path circle ellipse line polyline polygon rect g defs use text tspan title desc
          linearGradient radialGradient stop clipPath mask pattern symbol marker
        ]

        default_allowed_attributes = Class.new.include(ActionText::ContentHelper).new.sanitizer_allowed_attributes
        ActionText::ContentHelper.allowed_attributes = default_allowed_attributes + %w[
          controls poster data-language style value start autoplay loop muted playsinline preload
          viewBox xmlns d fill download target aria-label
          cx cy r rx ry x y x1 y1 x2 y2 points transform stroke stroke-width stroke-linecap stroke-linejoin
          stroke-dasharray stroke-dashoffset stroke-opacity fill-opacity opacity offset stop-color stop-opacity
          gradientUnits gradientTransform spreadMethod patternUnits patternTransform clip-path mask
          font-family font-size font-weight text-anchor dominant-baseline preserveAspectRatio
          data-collapsed data-caption-hidden
        ]

        Loofah::HTML5::SafeList::ALLOWED_CSS_FUNCTIONS << "var"
      end
    end

    initializer "lexxy.blob_with_preview" do |app|
      ActiveSupport.on_load(:active_storage_blob) do
        prepend ActiveStorage::BlobWithPreviewUrl
      end
    end
  end
end
