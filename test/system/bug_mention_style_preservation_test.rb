require "application_system_test_case"

class BugMentionStylePreservationTest < ApplicationSystemTestCase
  setup do
    visit edit_post_path(posts(:empty))
  end

  test "v1: inserting a mention into bold text preserves surrounding formatting" do
    find_editor.toggle_command("bold")
    find_editor.send "Hello 1"

    click_on_prompt "Peter Johnson"
    find_editor.send " there"

    assert_editor_html do
      assert_selector "p > b > strong", text: "Hello "
      assert_selector %(p > action-text-attachment[content-type="application/vnd.actiontext.mention"])
      assert_selector "p > b > strong", text: " there"
    end
  end

  test "v2: selecting the mention with the keyboard preserves surrounding formatting" do
    find_editor.toggle_command("bold")
    find_editor.send "Hello 1"
    find_editor.send :enter
    find_editor.send " there"

    assert_editor_html do
      assert_selector "p > b > strong", text: "Hello "
      assert_selector %(p > action-text-attachment[content-type="application/vnd.actiontext.mention"])
      assert_selector "p > b > strong", text: " there"
    end
  end
end
