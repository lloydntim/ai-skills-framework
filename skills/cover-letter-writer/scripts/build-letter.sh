#!/usr/bin/env bash
# Builds a cover letter .docx from the plain-text house format, converts it to PDF through Word so
# the rendering is identical to the letters already sent, and verifies it fits on one page.
#
#   ./scripts/build-letter.sh draft.txt "/path/to/<Name> - Company Cover Letter - DD MM YY"
#
# Uses templates/cover-letter-template.docx (a fictional example, safe to publish) unless
# COVER_LETTER_TEMPLATE points at a real letterhead kept outside the repository.
set -euo pipefail

LETTER="${1:?usage: build-letter.sh <letter.txt> <output basename without extension>}"
BASE="${2:?usage: build-letter.sh <letter.txt> <output basename without extension>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

python3 "$HERE/build-letter-docx.py" --letter "$LETTER" --out "$BASE.docx"

if [ ! -d "/Applications/Microsoft Word.app" ]; then
  echo "Microsoft Word not found. The .docx is ready; export it to PDF yourself." >&2
  exit 0
fi

osascript "$HERE/docx-to-pdf.applescript" "$BASE.docx" "$BASE.pdf" >/dev/null
pages=$(pdfinfo "$BASE.pdf" 2>/dev/null | awk '/^Pages:/{print $2}')
echo "$BASE.pdf  ($pages page(s))"

if [ "${pages:-1}" -gt 1 ]; then
  cat >&2 <<'WARN'

  WARNING: the letter runs to more than one page.
  Every sent letter fits on one. Cut a whole weaker point rather than compressing
  every sentence, then rebuild. Word count alone does not predict this: 355 words
  with the contact footer fits, 399 does not.
WARN
  exit 1
fi
