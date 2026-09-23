#!/usr/bin/env python3
"""
Builds a cover letter .docx by cloning the sent letter and replacing only its text.

Styling is never re-specified: the template's own run properties are reused paragraph by
paragraph, so fonts (Calibri), colours (#2563EB, #5B6571), sizes, page size and margins come out
byte-identical to the letter that was actually sent. Anything rebuilt by hand would drift.

  python3 scripts/build-letter-docx.py --letter draft.txt --out "Name.docx"

The letter file is the plain-text house format: name, positioning, contact, To:/date, "Application
for ...", company line, salutation, body paragraphs, closing, signature, optional contact footer.
"""
import argparse, html, re, shutil, zipfile, pathlib, tempfile, os

# The tracked template is a fictional example: safe to publish, and structurally identical to a
# real one (same paragraph roles, fonts and colours), since every run overwrites its text anyway.
# COVER_LETTER_TEMPLATE lets a real letterhead live outside the repository, the same way
# COVER_LETTER_PROFILE keeps the real candidate profile out of it (src/candidate-profile.ts).
TEMPLATE = pathlib.Path(os.environ.get('COVER_LETTER_TEMPLATE') or (pathlib.Path(__file__).parent.parent / 'templates' / 'cover-letter-template.docx'))


def parse_letter(text):
    """
    Reads the plain-text house format structurally, by locating its landmark lines.

    Everything except the body is read from raw lines rather than blank-line-separated blocks.
    The header, the title and its company line, and the signature and its contact lines are all
    consecutive non-empty lines, so grouping by blank lines runs them together: the title would
    swallow the company, and the contact footer would vanish into the signature. Only body
    paragraphs are grouped, because those may legitimately wrap across several lines.
    """
    lines = [l.rstrip() for l in text.strip().split('\n')]

    def find(pattern, start=0):
        return next(i for i, l in enumerate(lines[start:], start) if re.match(pattern, l.strip()))

    def next_nonempty(i):
        return next(j for j in range(i + 1, len(lines)) if lines[j].strip())

    head = [i for i, l in enumerate(lines) if l.strip()][:3]
    name, positioning, contact = (lines[i].strip() for i in head)

    to_at = find(r'^(To:|An:)')
    recipient, date = re.split(r'\s{2,}', lines[to_at].strip(), maxsplit=1)

    title_at = find(r'^(Application for|Bewerbung als)')
    company_at = next_nonempty(title_at)

    sal_at = find(r'^(Dear |Hallo |Liebe|Sehr geehrte)', company_at + 1)
    close_at = find(r'^(Kind regards|Viele Gr|Freundliche Gr|Mit freundlichen)', sal_at + 1)

    body, cur = [], []
    for line in lines[sal_at + 1:close_at]:
        if line.strip():
            cur.append(line.strip())
        elif cur:
            body.append(' '.join(cur)); cur = []
    if cur:
        body.append(' '.join(cur))

    tail = [l.strip() for l in lines[close_at + 1:] if l.strip()]

    return {
        'name': name, 'positioning': positioning, 'contact': contact,
        'recipient': recipient.strip(), 'date': date.strip(),
        'title': lines[title_at].strip(), 'company': lines[company_at].strip(),
        'salutation': lines[sal_at].strip(),
        'body': body,
        'closing': lines[close_at].strip(),
        'signature': tail[0] if tail else '',
        'footer_lines': tail[1:],
    }


def set_text(para_xml, text):
    """Replaces a paragraph's text, keeping its first run's properties and dropping the rest."""
    runs = re.findall(r'<w:r(?:\s[^>]*)?>.*?</w:r>', para_xml, re.S)
    if not runs:
        return para_xml
    first = runs[0]
    rpr = re.search(r'<w:rPr>.*?</w:rPr>', first, re.S)
    rpr = rpr.group(0) if rpr else ''
    new_run = f'<w:r>{rpr}<w:t xml:space="preserve">{html.escape(text)}</w:t></w:r>'
    body = para_xml
    for r in runs:
        body = body.replace(r, '', 1)
    return body.replace('</w:p>', new_run + '</w:p>')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--letter', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--template', default=str(TEMPLATE))
    args = ap.parse_args()

    letter = parse_letter(pathlib.Path(args.letter).read_text())

    tmp = pathlib.Path(tempfile.mkdtemp())
    with zipfile.ZipFile(args.template) as z:
        z.extractall(tmp)

    doc = (tmp / 'word' / 'document.xml').read_text()
    paras = re.findall(r'<w:p\b[^>]*>.*?</w:p>', doc, re.S)

    # Template paragraph roles, in order. Body paragraphs reuse the template's 6 body paragraphs;
    # when the letter has a different count, the last body paragraph is cloned or trimmed.
    fixed = [
        (0, letter['name']), (1, letter['positioning']), (2, letter['contact']),
        (3, letter['recipient']), (4, letter['date']), (5, letter['title']), (6, letter['company']),
        (7, letter['salutation']),
    ]
    BODY_START, BODY_END = 8, 13          # template body paragraphs 8..13 inclusive
    CLOSE, SIGN = 14, 15

    new_paras = list(paras)
    for idx, text in fixed:
        new_paras[idx] = set_text(paras[idx], text)

    body_template = paras[BODY_START]
    body_xml = [set_text(body_template, t) for t in letter['body']]

    new_paras[CLOSE] = set_text(paras[CLOSE], letter['closing'])
    new_paras[SIGN] = set_text(paras[SIGN], letter['signature'])

    # The signature and its contact lines are ONE paragraph separated by <w:br/>, not separate
    # paragraphs. Emitting them as paragraphs inherits paragraph spacing and leaves visible gaps
    # between the phone number and the links, which the sent letters do not have.
    sig_xml = new_paras[SIGN]
    if letter['footer_lines']:
        name_rpr = '<w:rPr><w:b/><w:sz w:val="23"/></w:rPr>'
        line_rpr = '<w:rPr><w:color w:val="5B6571"/><w:sz w:val="18"/></w:rPr>'
        runs = f'<w:r>{name_rpr}<w:t xml:space="preserve">{html.escape(letter["signature"])}</w:t></w:r>'
        for line in letter['footer_lines']:
            runs += f'<w:r>{line_rpr}<w:br/><w:t xml:space="preserve">{html.escape(line)}</w:t></w:r>'

        ppr = '<w:pPr><w:spacing w:after="0"/></w:pPr>'
        sig_xml = f'<w:p>{ppr}{runs}</w:p>'

    rebuilt = new_paras[:BODY_START] + body_xml + [new_paras[CLOSE], sig_xml]

    out_doc = doc
    for p in paras:
        out_doc = out_doc.replace(p, '\x00', 1)
    parts = out_doc.split('\x00')
    out_doc = parts[0] + ''.join(rebuilt) + parts[-1]
    (tmp / 'word' / 'document.xml').write_text(out_doc)

    # The running footer names the role, so it must track the letter.
    fpath = tmp / 'word' / 'footer1.xml'
    if fpath.exists():
        f = fpath.read_text()
        role = letter['title'].replace('Application for ', '').replace('Bewerbung als ', '')
        runs = re.findall(r'<w:r(?:\s[^>]*)?>.*?</w:r>', f, re.S)
        if runs:
            rpr = re.search(r'<w:rPr>.*?</w:rPr>', runs[0], re.S)
            rpr = rpr.group(0) if rpr else ''
            keep = f
            for r in runs:
                keep = keep.replace(r, '', 1)
            new = f'<w:r>{rpr}<w:t xml:space="preserve">{html.escape(letter["name"].title())}  |  {html.escape(role)}</w:t></w:r>'
            fpath.write_text(keep.replace('</w:p>', new + '</w:p>', 1))

    out = pathlib.Path(args.out)
    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(tmp):
            for name in files:
                full = pathlib.Path(root) / name
                z.write(full, full.relative_to(tmp))
    shutil.rmtree(tmp)
    print(f"{out}  ({len(letter['body'])} body paragraphs, {len(letter['footer_lines'])} footer lines)")


if __name__ == '__main__':
    main()
