#!/usr/bin/env bash
# Saves a job advert as a Word document and a PDF, so the application does not depend on a posting
# that will be taken down and the spec opens anywhere without a Markdown viewer.
#
#   ./scripts/build-job-spec.sh advert.txt "/path/to/Company - Role Job Spec - DD MM YY"
#
# The advert text is copied unedited, one paragraph per line. The first line becomes the title.
# Reads no model and no network: textutil makes the .docx, Word makes the PDF, as build-letter.sh does.
set -euo pipefail

SPEC="${1:?usage: build-job-spec.sh <advert.txt> <output basename without extension>}"
BASE="${2:?usage: build-job-spec.sh <advert.txt> <output basename without extension>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTML="$(mktemp -t job-spec).html"
trap 'rm -f "$HTML"' EXIT

python3 - "$SPEC" "$HTML" <<'PY'
import html, sys
lines = [l.strip() for l in open(sys.argv[1], encoding='utf-8').read().split('\n') if l.strip()]
out = ['<html><head><meta charset="utf-8"><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt} p{margin:0 0 6pt 0}</style></head><body>']
for i, line in enumerate(lines):
    out.append(f'<h1>{html.escape(line)}</h1>' if i == 0 else f'<p>{html.escape(line)}</p>')
out.append('</body></html>')
open(sys.argv[2], 'w', encoding='utf-8').write('\n'.join(out))
PY

textutil -convert docx -output "$BASE.docx" "$HTML"

if [ ! -d "/Applications/Microsoft Word.app" ]; then
  echo "Microsoft Word not found. The .docx is ready; export it to PDF yourself." >&2
  exit 0
fi

osascript "$HERE/docx-to-pdf.applescript" "$BASE.docx" "$BASE.pdf" >/dev/null
echo "$BASE.pdf  ($(pdfinfo "$BASE.pdf" 2>/dev/null | awk '/^Pages:/{print $2}') page(s))"
