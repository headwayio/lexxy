// Configure Prism for manual highlighting mode
// This must be set before importing prismjs
window.Prism = window.Prism || {}
window.Prism.manual = true

import "prismjs"

// Import base language dependencies first
import "prismjs/components/prism-clike"
import "prismjs/components/prism-markup"
import "prismjs/components/prism-markup-templating"

// Languages also bundled by @lexical/code for in-editor highlighting
import "prismjs/components/prism-c"
import "prismjs/components/prism-cpp"
import "prismjs/components/prism-css"
import "prismjs/components/prism-java"
import "prismjs/components/prism-javascript"
import "prismjs/components/prism-markdown"
import "prismjs/components/prism-objectivec"
import "prismjs/components/prism-powershell"
import "prismjs/components/prism-python"
import "prismjs/components/prism-rust"
import "prismjs/components/prism-sql"
import "prismjs/components/prism-swift"
import "prismjs/components/prism-typescript"

// Additional languages for common use cases
import "prismjs/components/prism-ruby"
import "prismjs/components/prism-php"
import "prismjs/components/prism-go"
import "prismjs/components/prism-bash"
import "prismjs/components/prism-json"
import "prismjs/components/prism-diff"
import "prismjs/components/prism-yaml"
import "prismjs/components/prism-kotlin"
import "prismjs/components/prism-docker"
import "prismjs/components/prism-graphql"
import "prismjs/components/prism-jsx"
import "prismjs/components/prism-tsx"
import "prismjs/components/prism-scss"
import "prismjs/components/prism-regex"
import "prismjs/components/prism-toml"
import "prismjs/components/prism-lua"
import "prismjs/components/prism-elixir"
import "prismjs/components/prism-erlang"
import "prismjs/components/prism-hcl"
