require_relative "rich_text_area_tag"
require_relative "form_helper"
require_relative "form_builder"
require_relative "action_text_tag"
require_relative "attachable"
require_relative "attachment_icon_helper"
require_relative "attachment_helper"

require "active_storage/blob_with_preview_url"

module Lexxy
  class Engine < ::Rails::Engine
    isolate_namespace Lexxy

    config.lexxy = ActiveSupport::OrderedOptions.new
    config.lexxy.override_action_text_defaults = true

    initializer "lexxy.initialize" do |app|
      app.config.to_prepare do
        # TODO: We need to move these extensions to Action Text
        ActionText::TagHelper.prepend(Lexxy::TagHelper)
        ActionView::Helpers::FormHelper.prepend(Lexxy::FormHelper)
        ActionView::Helpers::FormBuilder.prepend(Lexxy::FormBuilder)
        ActionView::Helpers::Tags::ActionText.prepend(Lexxy::ActionTextTag)
        ActionText::Attachable.singleton_class.prepend(Lexxy::Attachable)
        ActionView::Base.include(Lexxy::AttachmentIconHelper)
        ActionView::Base.include(Lexxy::AttachmentHelper)

        Lexxy.override_action_text_defaults if app.config.lexxy.override_action_text_defaults
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
        ActionText::ContentHelper.allowed_tags = default_allowed_tags + %w[ video audio source embed table tbody tr th td svg path ]

        default_allowed_attributes = Class.new.include(ActionText::ContentHelper).new.sanitizer_allowed_attributes
        ActionText::ContentHelper.allowed_attributes = default_allowed_attributes + %w[
          controls poster data-language style autoplay loop muted playsinline preload
          viewBox xmlns d fill download target aria-label
          data-collapsed data-caption-hidden
        ]

        Loofah::HTML5::SafeList::ALLOWED_CSS_FUNCTIONS << "var" # Allow CSS variables
      end
    end

    initializer "lexxy.blob_with_preview" do |app|
      ActiveSupport.on_load(:active_storage_blob) do
        prepend ActiveStorage::BlobWithPreviewUrl
      end
    end
  end
end
