#!/usr/bin/env bash
# Clone prior-art references for the annotation layer.
# All clones are --depth 1; the two giants are sparse-checked-out to the
# directories worth reading.
set -uo pipefail
cd "$(dirname "$0")"

full() {  # full <name> <url>
  [ -d "$1" ] && { echo "== $1 already present"; return 0; }
  echo "== cloning $1"
  git clone --quiet --depth 1 "$2" "$1" || echo "!! FAILED $1"
}

sparse() { # sparse <name> <url> <path...>
  [ -d "$1" ] && { echo "== $1 already present"; return 0; }
  local name="$1" url="$2"; shift 2
  echo "== sparse-cloning $name"
  git clone --quiet --depth 1 --filter=blob:none --sparse "$url" "$name" \
    && git -C "$name" sparse-checkout set "$@" \
    || echo "!! FAILED $name"
}

# --- element mode (primary) -------------------------------------------------
full   siteping        https://github.com/NeosiaNexus/SitePing.git
full   floating-ui     https://github.com/floating-ui/floating-ui.git
full   figma-clone     https://github.com/adrianhajdin/figma_clone.git
sparse react           https://github.com/facebook/react.git \
       packages/react-devtools-shared/src/backend/views
sparse storybook       https://github.com/storybookjs/storybook.git \
       code/core/src/highlight

# --- text mode -------------------------------------------------------------
full   text-annotator  https://github.com/recogito/text-annotator-js.git
full   hypothesis      https://github.com/hypothesis/client.git
full   web-highlighter https://github.com/alienzhou/web-highlighter.git
full   apache-annotator https://github.com/apache/incubator-annotator.git

# --- image mode (deferred) -------------------------------------------------
full   annotorious     https://github.com/annotorious/annotorious.git

echo
echo "== done"
du -sh ./*/ 2>/dev/null | sort -h
